import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local test port.');
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function startLocalServer(
  mode: 'development' | 'test' | 'production',
  notificationWebhookUrl = '',
): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
  process: ChildProcess;
  dataDirectory?: string;
}> {
  const port = await reservePort();
  const dataDirectory = mode === 'production'
    ? await mkdtemp(path.join(os.tmpdir(), 'neargrow-audit-test-'))
    : undefined;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: mode,
      PORT: String(port),
      DISABLE_HMR: 'true',
      DOTENV_CONFIG_PATH: path.join(os.tmpdir(), `neargrow-no-env-${randomUUID()}`),
      SUPABASE_URL: '',
      SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      ADMIN_OWNER_USER_ID: '',
      ADMIN_SESSION_SECRET: '',
      SITE_URL: mode === 'production' ? 'https://localhost' : '',
      PERSISTENT_DATA_DIR: dataDirectory || '',
      N8N_LEAD_WEBHOOK_URL: notificationWebhookUrl,
      N8N_WEBHOOK_SECRET: '',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local ${mode} server exited before becoming ready.`);
    try {
      await fetch(`${baseUrl}/api/__health_probe`);
      return {
        baseUrl,
        process: child,
        ...(dataDirectory ? { dataDirectory } : {}),
        stop: async () => {
          child.kill();
          await new Promise<void>((resolve) => {
            if (child.exitCode !== null) resolve();
            else {
              child.once('exit', () => resolve());
              setTimeout(resolve, 5_000).unref();
            }
          });
          if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true });
        },
      };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  child.kill();
  throw new Error(`Local ${mode} server did not become ready.`);
}

const validLead = (submissionId: string) => ({
  submissionId,
  name: 'Synthetic Audit Visitor',
  businessName: 'Synthetic Audit Company',
  email: 'synthetic@example.test',
  phone: '+1 555 0100',
  serviceInterest: 'general-consultation',
  message: 'A synthetic enquiry for the local API regression check.',
  consent: true,
  sourcePage: '/get-started',
});

test('lead API confirms memory-mode persistence and makes retries idempotent in test mode', async () => {
  const server = await startLocalServer('test');
  try {
    const submissionId = randomUUID();
    const payload = validLead(submissionId);
    const submit = () => fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const firstResponse = await submit();
    assert.equal(firstResponse.status, 201);
    const firstResult = await firstResponse.json() as {
      success: boolean;
      saved: boolean;
      leadId: string;
      notificationStatus: string;
    };
    assert.equal(firstResult.success, true);
    assert.equal(firstResult.saved, true);
    assert.equal(firstResult.leadId, submissionId);
    assert.equal(firstResult.notificationStatus, 'not_configured');

    const retryResponse = await submit();
    assert.equal(retryResponse.status, 200);
    const retryResult = await retryResponse.json() as {
      success: boolean;
      saved: boolean;
      duplicate: boolean;
      leadId: string;
    };
    assert.equal(retryResult.success, true);
    assert.equal(retryResult.saved, true);
    assert.equal(retryResult.duplicate, true);
    assert.equal(retryResult.leadId, submissionId);

    const conflictingResponse = await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, message: 'Different content reusing this submission identifier.' }),
    });
    assert.equal(conflictingResponse.status, 409);

    const noConsentResponse = await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validLead(randomUUID()), consent: false }),
    });
    assert.equal(noConsentResponse.status, 400);
  } finally {
    await server.stop();
  }
});

test('lead notification HTTP failures remain distinct from saved leads and changing XFF cannot evade throttling', async () => {
  const webhookRequests: Array<{ idempotencyKey: string; body: string }> = [];
  const webhookServer = createHttpServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      const idempotencyHeader = req.headers['idempotency-key'];
      webhookRequests.push({
        idempotencyKey: Array.isArray(idempotencyHeader)
          ? idempotencyHeader[0] || ''
          : idempotencyHeader || '',
        body,
      });
      res.statusCode = 500;
      res.end('synthetic notification failure');
    });
  });
  await new Promise<void>((resolve, reject) => {
    webhookServer.once('error', reject);
    webhookServer.listen(0, '127.0.0.1', resolve);
  });
  const webhookAddress = webhookServer.address();
  if (!webhookAddress || typeof webhookAddress === 'string') throw new Error('Could not start the local webhook test server.');
  const server = await startLocalServer('development', `http://127.0.0.1:${webhookAddress.port}`);
  try {
    const firstPayload = validLead(randomUUID());
    const firstResponse = await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.1' },
      body: JSON.stringify(firstPayload),
    });
    assert.equal(firstResponse.status, 201);
    const firstResult = await firstResponse.json() as {
      success: boolean;
      saved: boolean;
      leadId: string;
      notificationStatus: string;
    };
    assert.equal(firstResult.success, true);
    assert.equal(firstResult.saved, true);
    assert.equal(firstResult.leadId, firstPayload.submissionId);
    assert.equal(firstResult.notificationStatus, 'failed');
    assert.equal(webhookRequests[0]?.idempotencyKey, firstPayload.submissionId);
    assert.equal((JSON.parse(webhookRequests[0]?.body || '{}') as { id?: string }).id, firstPayload.submissionId);

    for (let index = 1; index < 10; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${index + 1}` },
        body: JSON.stringify(validLead(randomUUID())),
      });
      assert.equal(response.status, 201);
    }

    const throttledResponse = await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.99' },
      body: JSON.stringify(validLead(randomUUID())),
    });
    assert.equal(throttledResponse.status, 429);
    assert.equal(webhookRequests.length, 10);
  } finally {
    await server.stop();
    await new Promise<void>((resolve, reject) => {
      webhookServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('production lead API rejects submissions when durable database configuration is absent', async () => {
  const server = await startLocalServer('production');
  try {
    const response = await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validLead(randomUUID())),
    });
    assert.equal(response.status, 503);
    const result = await response.json() as { success: boolean; message: string };
    assert.equal(result.success, false);
    assert.match(result.message, /storage|Supabase/i);

    const paymentResponse = await fetch(`${server.baseUrl}/api/catalogue/payment-availability`);
    assert.equal(paymentResponse.status, 503);
    const paymentAvailability = await paymentResponse.json() as { available?: boolean; message?: string };
    assert.equal(paymentAvailability.available, false);
    assert.match(paymentAvailability.message || '', /payment/i);

    const missingPage = await fetch(`${server.baseUrl}/this-route-does-not-exist`);
    assert.equal(missingPage.status, 404);
  } finally {
    await server.stop();
  }
});
