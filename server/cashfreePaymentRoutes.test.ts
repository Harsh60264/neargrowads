import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createCashfreeAvailabilityHandler,
  createCashfreeActivationHandler,
  createCashfreeAdminReadinessHandler,
  createCashfreeOrderHandler,
  createCashfreeWebhookHandler,
  type CashfreeHttpHandler,
  type CashfreeHttpRequest,
  type CashfreeHttpResponse,
  type CashfreeServerConfig,
} from './cashfreePaymentRoutes.ts';
import type { CashfreeGatewayReadiness } from './cashfreeAdmin.ts';
import type { ServiceOrderPackage } from './serviceOrders.ts';
import { canAccessServiceStoreAction, serviceStoreAdminAction } from './serviceStoreAuthorization.ts';

const webhookSecret = 'sandbox-webhook-secret';
const servicePackageId = '123e4567-e89b-42d3-a456-426614174000';
const providerOrderId = 'NGO-000000000000400080000000';
const cashfreeOrderId = '123456789';
const checkoutIdempotencyKey = 'checkout_key_0123456789abcdef0123456789abcdef';
const readyReadiness: CashfreeGatewayReadiness = {
  status: 'enabled',
  credentialsConfigured: true,
  environmentEnabled: true,
  providerConfigurationConfirmed: true,
  webhookConfigured: true,
  migrationReady: true,
  enabled: true,
};

interface CashfreeIntent {
  status: 'missing' | 'claimed' | 'busy' | 'conflict' | 'completed' | 'expired' | 'manual_reconciliation';
  action?: 'create' | 'reconcile';
  intent_id?: string;
  service_order_id?: string;
  order_reference?: string;
  provider_idempotency_key?: string;
  claim_token?: string;
  create_attempt_count?: number;
  expires_at?: string;
  total_amount_paise?: number;
  currency?: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
}

class MockResponse implements CashfreeHttpResponse {
  statusCode = 200;
  body: unknown;
  headers = new Map<string, string>();

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }
}

function request(body?: unknown, headers: Record<string, string> = {}): CashfreeHttpRequest {
  const normalizedHeaders: Record<string, string> = { 'idempotency-key': checkoutIdempotencyKey, ...headers };
  return {
    body,
    header: (name) => normalizedHeaders[name.toLowerCase()],
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  };
}

async function invoke(handler: CashfreeHttpHandler, req: CashfreeHttpRequest) {
  const res = new MockResponse();
  await handler(req, res);
  return res;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const validOrderBody = {
  customerName: 'Ada Lovelace',
  customerEmail: 'ADA@example.com',
  customerPhone: '+91 98765 43210',
  customerBusinessName: 'Analytical Engines',
  onboardingNotes: '',
  consent: true,
  packages: [{ packageId: servicePackageId, quantity: 2, priceInr: 0.01 }],
};

const publishedPackage: ServiceOrderPackage = {
  id: servicePackageId,
  packageCode: 'GROW-001',
  title: 'Published Growth Package',
  billingType: 'one_time',
  priceInr: 100,
  discountedPriceInr: 75.25,
  quantitySupported: true,
};

function sequentialIds(): () => string {
  let counter = 0;
  return () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}

function makeOrderHandler(
  overrides: Partial<Parameters<typeof createCashfreeOrderHandler>[0]> = {},
  locationPatchResponse: Response = jsonResponse([{ id: 'database-order-id' }]),
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const databaseCalls: { path: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse({
      cf_order_id: cashfreeOrderId,
      order_id: providerOrderId,
      order_amount: 150.5,
      order_currency: 'INR',
      order_status: 'ACTIVE',
      payment_session_id: 'sandbox-session-token',
    });
  };
  const claim: CashfreeIntent = {
    status: 'claimed',
    action: 'create',
    intent_id: 'intent-id',
    service_order_id: 'database-order-id',
    order_reference: providerOrderId,
    provider_idempotency_key: '00000000-0000-4000-8000-000000000099',
    claim_token: 'claim-token',
    create_attempt_count: 0,
    expires_at: '2099-01-01T00:00:00.000Z',
  };
  let claimCount = 0;
  const handler = createCashfreeOrderHandler({
    getConfig: () => ({ clientId: 'sandbox-client-id', clientSecret: 'sandbox-client-secret' }),
    getReadiness: async () => readyReadiness,
    getReturnUrl: (reference) => `https://neargrowads.com/catalogue?cashfree_order_id=${reference}`,
    readPublishedPackages: async () => [publishedPackage],
    databaseRequest: async (path, init) => {
      databaseCalls.push({ path, init });
      if (path.includes('/claim_cashfree_checkout_intent')) {
        claimCount += 1;
        if (claimCount === 1) return jsonResponse({ status: 'missing' });
        const payload = JSON.parse(String(init?.body)) as {
          p_order_reference: string;
          p_provider_idempotency_key: string;
          p_total_amount_paise: number;
          p_currency: string;
          p_customer_name: string;
          p_customer_email: string;
          p_customer_phone: string;
        };
        return jsonResponse({
          ...claim,
          order_reference: payload.p_order_reference,
          provider_idempotency_key: payload.p_provider_idempotency_key,
          total_amount_paise: payload.p_total_amount_paise,
          currency: payload.p_currency,
          customer_name: payload.p_customer_name,
          customer_email: payload.p_customer_email,
          customer_phone: payload.p_customer_phone,
        });
      }
      if (init?.method === 'PATCH' && path.includes('/service_orders?')) return locationPatchResponse;
      if (path.endsWith('/prepare_cashfree_checkout_create')) return jsonResponse(true);
      if (path.includes('/complete_cashfree_checkout_intent')) {
        const payload = JSON.parse(String(init?.body)) as { p_payment_session_id?: string };
        return jsonResponse({ status: 'completed', payment_session_id: payload.p_payment_session_id });
      }
      if (path.endsWith('/mark_cashfree_checkout_intent_ambiguous')) return jsonResponse(true);
      return jsonResponse({ code: 'unexpected_database_request' }, 500);
    },
    allowOrder: () => true,
    fetcher,
    createId: sequentialIds(),
    ...overrides,
  });
  return { handler, calls, databaseCalls };
}

interface WebhookFixtureOptions {
  payment?: Record<string, unknown>;
  order?: Record<string, unknown>;
  databaseRequest?: (path: string, init?: RequestInit) => Promise<Response>;
  fetcher?: typeof fetch;
  config?: CashfreeServerConfig;
  mode?: 'sandbox' | 'production';
}

function webhookPayload(paymentId = '987654321') {
  return {
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: {
      order: { order_id: providerOrderId },
      payment: { cf_payment_id: paymentId },
    },
  };
}

function signedWebhook(
  payload: unknown,
  timestamp = '1617695238078',
  secret = webhookSecret,
): CashfreeHttpRequest {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(timestamp).update(rawBody).digest('base64');
  const req = request(undefined, {
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': signature,
  });
  req.rawBody = rawBody;
  return req;
}

function createWebhookFixture(options: WebhookFixtureOptions = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const databaseCalls: { path: string; init?: RequestInit }[] = [];
  const payment = options.payment ?? {
    cf_payment_id: '987654321',
    order_id: providerOrderId,
    order_amount: 150.5,
    order_currency: 'INR',
    payment_amount: 150.5,
    payment_currency: 'INR',
    payment_status: 'SUCCESS',
    is_captured: true,
  };
  const fetcher: typeof fetch = options.fetcher || (async (input, init) => {
    calls.push({ url: String(input), init });
    return jsonResponse([payment]);
  });
  const databaseRequest = options.databaseRequest || (async (path, init) => {
    databaseCalls.push({ path, init });
    if (path.startsWith('rest/v1/service_orders?')) {
      return jsonResponse(options.order ? [options.order] : [{
        id: 'database-order-id',
        provider_order_id: providerOrderId,
        cashfree_order_id: cashfreeOrderId,
        total_amount_paise: 15050,
        currency: 'INR',
        provider_mode: 'test',
      }]);
    }
    return jsonResponse('paid');
  });
  return {
    handler: createCashfreeWebhookHandler({
      mode: options.mode,
      getConfig: () => options.config || ({
        mode: 'sandbox',
        apiBaseUrl: 'https://sandbox.cashfree.com/pg',
        clientId: 'sandbox-client-id',
        clientSecret: webhookSecret,
      }),
      databaseRequest,
      fetcher,
    }),
    calls,
    databaseCalls,
  };
}

test('Create Order uses published discounted prices, validates INR paise, and persists the intent before returning a session', async () => {
  const { handler, calls, databaseCalls } = makeOrderHandler();
  const result = await invoke(handler, request(validOrderBody));
  const requestBody = JSON.parse(String(calls[0]?.init?.body));
  const claimPayload = JSON.parse(String(databaseCalls[1]?.init?.body));
  const completionPayload = JSON.parse(String(databaseCalls[3]?.init?.body));

  assert.equal(result.statusCode, 201, JSON.stringify({ body: result.body, calls, databaseCalls }));
  assert.equal(calls.length, 1);
  assert.deepEqual(databaseCalls.map((call) => call.path), [
    'rest/v1/rpc/claim_cashfree_checkout_intent',
    'rest/v1/rpc/claim_cashfree_checkout_intent',
    'rest/v1/rpc/prepare_cashfree_checkout_create',
    'rest/v1/rpc/complete_cashfree_checkout_intent',
  ]);
  assert.equal(JSON.parse(String(databaseCalls[0]?.init?.body)).p_create_if_missing, false);
  assert.equal(JSON.parse(String(databaseCalls[1]?.init?.body)).p_create_if_missing, true);
  assert.equal(claimPayload.p_currency, 'INR');
  assert.equal(claimPayload.p_total_amount_paise, 15050);
  assert.equal(claimPayload.p_order_reference, requestBody.order_id);
  assert.equal(claimPayload.p_provider_idempotency_key,
    new Headers(calls[0]?.init?.headers).get('x-idempotency-key'));
  assert.equal(claimPayload.p_tracking_token_hash.length, 64);
  assert.equal(calls[0].url, 'https://sandbox.cashfree.com/pg/orders');
  assert.equal(requestBody.order_id, providerOrderId);
  assert.equal(requestBody.order_amount, 150.5);
  assert.equal(requestBody.order_currency, 'INR');
  assert.equal(requestBody.customer_details.customer_phone, '919876543210');
  assert.equal(requestBody.order_meta.return_url, `https://neargrowads.com/catalogue?cashfree_order_id=${providerOrderId}`);
  assert.equal(new Headers(calls[0].init?.headers).get('x-api-version'), '2026-01-01');
  assert.ok(new Headers(calls[0].init?.headers).get('x-idempotency-key'));
  assert.equal(completionPayload.p_total_amount_paise, 15050);
  assert.equal(completionPayload.p_currency, 'INR');
  assert.equal((result.body as Record<string, unknown>).paymentSessionId, 'sandbox-session-token');
  assert.equal((result.body as Record<string, unknown>).trackingToken, checkoutIdempotencyKey);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('Production Create Order uses only the live API, mode-bound persistence RPCs and server-verified INR response', async () => {
  const { handler, calls, databaseCalls } = makeOrderHandler({
    getConfig: () => ({
      mode: 'production',
      apiBaseUrl: 'https://api.cashfree.com/pg',
      clientId: 'production-client-id',
      clientSecret: 'production-client-secret',
    }),
    getReadiness: async () => ({
      ...readyReadiness,
      mode: 'production',
      status: 'enabled',
    }),
  });
  const result = await invoke(handler, request(validOrderBody));
  const claimPath = databaseCalls.find((call) => call.path.includes('claim_cashfree_checkout_intent'))?.path;
  const claimBody = JSON.parse(String(databaseCalls.find((call) =>
    call.path.includes('claim_cashfree_checkout_intent'))?.init?.body)) as Record<string, unknown>;

  assert.equal(result.statusCode, 201, JSON.stringify({ body: result.body, calls, databaseCalls }));
  assert.equal(calls[0]?.url, 'https://api.cashfree.com/pg/orders');
  assert.equal((calls[0]?.init?.headers as Record<string, string>)['x-client-id'], 'production-client-id');
  assert.match(claimPath || '', /claim_cashfree_checkout_intent_for_mode$/);
  assert.equal(claimBody.p_checkout_mode, 'production');
  assert.equal(databaseCalls.some((call) => call.path.includes('complete_cashfree_checkout_intent_for_mode')), true);
  assert.equal((result.body as Record<string, unknown>).mode, 'production');
  assert.equal((result.body as Record<string, unknown>).realPaymentsEnabled, true);
});

test('Production Create Order fails closed for Sandbox readiness and never calls either provider', async () => {
  const { handler, calls } = makeOrderHandler({
    getConfig: () => ({
      mode: 'production',
      apiBaseUrl: 'https://api.cashfree.com/pg',
      clientId: 'production-client-id',
      clientSecret: 'production-client-secret',
    }),
  });
  const result = await invoke(handler, request(validOrderBody));
  assert.equal(result.statusCode, 503);
  assert.equal(calls.length, 0);
});

test('Cashfree availability is visible only after Sandbox configuration, migration schema, and Owner activation are confirmed', async (t) => {
  await t.test('missing configuration fails closed without database calls', async () => {
    const handler = createCashfreeAvailabilityHandler({
      getReadiness: async () => ({ ...readyReadiness, status: 'not_configured', credentialsConfigured: false }),
    });
    const result = await invoke(handler, request());
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
      available: false,
      migrationReady: true,
      provider: 'cashfree',
      mode: 'sandbox',
      realPaymentsEnabled: false,
    });
  });

  await t.test('disabled environment opt-in fails closed without database calls', async () => {
    const handler = createCashfreeAvailabilityHandler({
      getReadiness: async () => ({ ...readyReadiness, status: 'sandbox_configured', environmentEnabled: false }),
    });
    const result = await invoke(handler, request());
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
      available: false,
      migrationReady: true,
      provider: 'cashfree',
      mode: 'sandbox',
      realPaymentsEnabled: false,
    });
  });

  await t.test('migration schema and enabled setting return Sandbox availability only', async () => {
    const handler = createCashfreeAvailabilityHandler({
      getReadiness: async () => ({ ...readyReadiness, status: 'enabled', enabled: true }),
    });
    const result = await invoke(handler, request());
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
      available: true,
      migrationReady: true,
      provider: 'cashfree',
      mode: 'sandbox',
      realPaymentsEnabled: false,
    });
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(JSON.stringify(result.body).includes('secret'), false);
  });

  await t.test('disabled Owner setting preserves migration readiness but disables checkout', async () => {
    const handler = createCashfreeAvailabilityHandler({
      getReadiness: async () => ({ ...readyReadiness, status: 'ready_for_testing', enabled: false }),
    });
    const result = await invoke(handler, request());
    assert.deepEqual(result.body, {
      available: false,
      migrationReady: true,
      provider: 'cashfree',
      mode: 'sandbox',
      realPaymentsEnabled: false,
    });
  });

  await t.test('ready-for-testing is not available until the Owner explicitly enables the gateway', async () => {
    const handler = createCashfreeAvailabilityHandler({
      getReadiness: async () => ({ ...readyReadiness, status: 'ready_for_testing', enabled: false }),
    });
    const result = await invoke(handler, request());
    assert.equal((result.body as Record<string, unknown>).available, false);
  });

  await t.test('missing migration table fails closed without exposing details', async () => {
    const handler = createCashfreeAvailabilityHandler({
      getReadiness: async () => ({ ...readyReadiness, status: 'database_migration_missing', migrationReady: false }),
    });
    const result = await invoke(handler, request());
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, {
      available: false,
      migrationReady: false,
      provider: 'cashfree',
      mode: 'sandbox',
      realPaymentsEnabled: false,
    });
  });

  await t.test('provider or webhook attestation removal immediately disables public checkout', async () => {
    for (const field of ['providerConfigurationConfirmed', 'webhookConfigured'] as const) {
      const handler = createCashfreeAvailabilityHandler({
        getReadiness: async () => ({ ...readyReadiness, status: 'enabled', enabled: true, [field]: false }),
      });
      const result = await invoke(handler, request());
      assert.equal((result.body as Record<string, unknown>).available, false, field);
    }
  });

  await t.test('readiness infrastructure failure fails closed without leaking details', async () => {
    const handler = createCashfreeAvailabilityHandler({
      getReadiness: async () => { throw new Error('private database details'); },
      getMode: () => 'production',
    });
    const result = await invoke(handler, request());
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.stringify(result.body).includes('private database details'), false);
    assert.equal((result.body as Record<string, unknown>).mode, 'production');
    assert.equal((result.body as Record<string, unknown>).realPaymentsEnabled, false);
  });
});

test('Create Order requires a stable client idempotency key before any provider or database write', async () => {
  const { handler, calls, databaseCalls } = makeOrderHandler();
  const result = await invoke(handler, request(validOrderBody, { 'idempotency-key': 'short' }));
  assert.equal(result.statusCode, 400);
  assert.equal(calls.length, 0);
  assert.equal(databaseCalls.length, 0);
});

test('Create Order fails closed when the server-generated return URL does not match the merchant order reference', async () => {
  const { handler, calls } = makeOrderHandler({
    getReturnUrl: () => 'https://attacker.example/return?cashfree_order_id=other-order',
  });
  const result = await invoke(handler, request(validOrderBody));
  assert.equal(result.statusCode, 503);
  assert.equal(calls.length, 0);
  assert.equal(JSON.stringify(result.body).includes('payment_session_id'), false);
});

test('Create Order persists explicitly consented location before creating the Cashfree order', async () => {
  const { handler, calls, databaseCalls } = makeOrderHandler();
  const result = await invoke(handler, request({
    ...validOrderBody,
    location: {
      latitude: 28.6139,
      longitude: 77.209,
      accuracyMeters: 25,
      capturedAt: '2026-11-06T08:30:00.000Z',
      consent: true,
    },
  }));
  const locationPatch = databaseCalls.find((call) => call.init?.method === 'PATCH');
  assert.equal(result.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.equal(locationPatch?.path, 'rest/v1/service_orders?id=eq.database-order-id&select=id');
  assert.deepEqual(JSON.parse(String(locationPatch?.init?.body)), {
    customer_location_latitude: 28.6139,
    customer_location_longitude: 77.209,
    customer_location_accuracy_meters: 25,
    customer_location_captured_at: '2026-11-06T08:30:00.000Z',
    customer_location_locality: null,
    customer_location_consent: true,
  });
  assert.equal(locationPatch?.init?.headers && new Headers(locationPatch.init.headers).get('Prefer'), 'return=representation');
});

test('Create Order omits location persistence when the customer does not share location', async () => {
  const { handler, calls, databaseCalls } = makeOrderHandler();
  const result = await invoke(handler, request(validOrderBody));
  assert.equal(result.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.equal(databaseCalls.some((call) => call.init?.method === 'PATCH'), false);
});

test('Create Order fails closed when location update matched no order', async () => {
  const { handler, calls, databaseCalls } = makeOrderHandler({}, jsonResponse([]));
  const result = await invoke(handler, request({
    ...validOrderBody,
    location: {
      latitude: 28.6139,
      longitude: 77.209,
      accuracyMeters: 25,
      capturedAt: '2026-11-06T08:30:00.000Z',
      consent: true,
    },
  }));
  assert.equal(result.statusCode, 503);
  assert.equal(calls.length, 0);
  assert.equal(databaseCalls.some((call) => call.path.endsWith('/rpc/prepare_cashfree_checkout_create')), false);
  assert.equal(databaseCalls.some((call) => call.path.includes('/complete_cashfree_checkout_intent')), false);
});

test('Create Order fails closed for missing credentials, disabled opt-in, disabled gateway, and missing migration', async (t) => {
  for (const scenario of [
    { name: 'credentials', override: { getConfig: () => undefined } },
    { name: 'environment opt-in', override: { getReadiness: async () => ({ ...readyReadiness, environmentEnabled: false }) } },
    { name: 'provider attestation', override: { getReadiness: async () => ({ ...readyReadiness, providerConfigurationConfirmed: false }) } },
    { name: 'webhook attestation', override: { getReadiness: async () => ({ ...readyReadiness, webhookConfigured: false }) } },
    { name: 'gateway opt-in', override: { getReadiness: async () => ({ ...readyReadiness, enabled: false }) } },
    { name: 'migration/database unavailable', override: { getReadiness: async () => { throw new Error('schema missing'); } } },
  ]) {
    await t.test(scenario.name, async () => {
      const { handler, calls, databaseCalls } = makeOrderHandler(scenario.override);
      const result = await invoke(handler, request(validOrderBody));
      assert.equal(result.statusCode, 503);
      assert.equal(calls.length, 0);
      assert.equal(databaseCalls.length, 0);
      assert.equal(JSON.stringify(result.body).includes('secret'), false);
    });
  }
  await t.test('missing checkout-intent RPC', async () => {
    let providerCalls = 0;
    const { handler, databaseCalls } = makeOrderHandler({
      databaseRequest: async (path, init) => {
        databaseCalls.push({ path, init });
        return new Response('function not found', { status: 404 });
      },
      fetcher: async () => {
        providerCalls += 1;
        return jsonResponse({});
      },
    });
    const result = await invoke(handler, request(validOrderBody));
    assert.equal(result.statusCode, 503);
    assert.equal(providerCalls, 0);
    assert.equal(databaseCalls.length, 1);
  });
});

test('Create Order fails closed when the persisted intent has no valid customer phone', async () => {
  const providerCalls: string[] = [];
  let claimCount = 0;
  const { handler, databaseCalls } = makeOrderHandler({
    databaseRequest: async (path, init) => {
      databaseCalls.push({ path, init });
      if (path.endsWith('/rpc/claim_cashfree_checkout_intent')) {
        claimCount += 1;
        if (claimCount === 1) return jsonResponse({ status: 'missing' });
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        const claim = {
          status: 'claimed',
          action: 'create',
          intent_id: 'intent-id',
          service_order_id: 'database-order-id',
          order_reference: body.p_order_reference,
          provider_idempotency_key: body.p_provider_idempotency_key,
          claim_token: 'claim-token',
          create_attempt_count: 0,
          expires_at: '2099-01-01T00:00:00.000Z',
          total_amount_paise: body.p_total_amount_paise,
          currency: 'INR',
          customer_name: body.p_customer_name,
          customer_email: body.p_customer_email,
        };
        return jsonResponse(claim);
      }
      return jsonResponse(true);
    },
    fetcher: async (input) => {
      providerCalls.push(String(input));
      return jsonResponse({});
    },
  });
  const result = await invoke(handler, request(validOrderBody));
  assert.equal(result.statusCode, 503);
  assert.deepEqual(providerCalls, []);
  assert.equal(databaseCalls.some((call) => call.path.endsWith('/rpc/prepare_cashfree_checkout_create')), false);
  assert.doesNotMatch(JSON.stringify(result.body), /phone|customer/i);
});

test('Create Order rejects mismatched provider responses, keeps the intent pending and never returns a session', async (t) => {
  const validResponse = {
    cf_order_id: cashfreeOrderId,
    order_id: providerOrderId,
    order_amount: 150.5,
    order_currency: 'INR',
    order_status: 'ACTIVE',
    payment_session_id: 'must-not-be-returned',
  };
  for (const [name, patch] of [
    ['merchant order mismatch', { order_id: 'different-order' }],
    ['amount mismatch', { order_amount: 150.49 }],
    ['currency mismatch', { order_currency: 'USD' }],
    ['inactive Create Order response', { order_status: 'EXPIRED' }],
    ['missing payment session', { payment_session_id: '' }],
  ] as const) {
    await t.test(name, async () => {
      const { handler, databaseCalls } = makeOrderHandler({
        fetcher: async () => jsonResponse({ ...validResponse, ...patch }),
      });
      const result = await invoke(handler, request(validOrderBody));
      assert.equal(result.statusCode, 503);
      assert.deepEqual(databaseCalls.map((call) => call.path), [
        'rest/v1/rpc/claim_cashfree_checkout_intent',
        'rest/v1/rpc/claim_cashfree_checkout_intent',
        'rest/v1/rpc/prepare_cashfree_checkout_create',
        'rest/v1/rpc/mark_cashfree_checkout_intent_ambiguous',
      ]);
      assert.equal(JSON.stringify(result.body).includes('must-not-be-returned'), false);
    });
  }
});

test('ambiguous Create Order retry reconciles first and reuses the same provider identity', async (t) => {
  await t.test('provider response lost but Get Order finds the order', async () => {
    let providerCall = 0;
    let catalogueReads = 0;
    const calls: { url: string; init?: RequestInit }[] = [];
    let claimCount = 0;
    const { handler } = makeOrderHandler({
      databaseRequest: async (path, init) => {
        if (path.includes('/claim_cashfree_checkout_intent')) {
          claimCount += 1;
          if (claimCount === 1) return jsonResponse({ status: 'missing' });
          return jsonResponse({
            status: 'claimed',
            action: claimCount === 2 ? 'create' : 'reconcile',
            intent_id: 'intent-id',
            service_order_id: 'database-order-id',
            order_reference: providerOrderId,
            provider_idempotency_key: '00000000-0000-4000-8000-000000000099',
            claim_token: `claim-token-${claimCount}`,
            create_attempt_count: claimCount === 2 ? 0 : 1,
            total_amount_paise: 15050,
            currency: 'INR',
            customer_name: 'Ada Lovelace',
            customer_email: 'ada@example.com',
            customer_phone: '+91 98765 43210',
            expires_at: '2099-01-01T00:00:00.000Z',
          });
        }
        if (path.endsWith('/prepare_cashfree_checkout_create')) return jsonResponse(true);
        if (path.includes('/complete_cashfree_checkout_intent')) {
          const payload = JSON.parse(String(init?.body)) as { p_payment_session_id: string };
          return jsonResponse({ status: 'completed', payment_session_id: payload.p_payment_session_id });
        }
        return jsonResponse(true);
      },
      readPublishedPackages: async () => {
        catalogueReads += 1;
        return [{
          ...publishedPackage,
          discountedPriceInr: catalogueReads === 1 ? 75.25 : 99.99,
        }];
      },
      fetcher: async (input, init) => {
        calls.push({ url: String(input), init });
        providerCall += 1;
        if (providerCall === 1) throw new DOMException('timeout', 'TimeoutError');
        return jsonResponse({
          cf_order_id: cashfreeOrderId,
          order_id: providerOrderId,
          order_amount: 150.5,
          order_currency: 'INR',
          order_status: 'ACTIVE',
          payment_session_id: 'reconciled-session',
        });
      },
    });
    const first = await invoke(handler, request(validOrderBody));
    const second = await invoke(handler, request(validOrderBody));
    assert.equal(first.statusCode, 503);
    assert.equal(second.statusCode, 201);
    assert.equal(catalogueReads, 1, 'a retry must use the persisted, originally validated price snapshot');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, 'https://sandbox.cashfree.com/pg/orders');
    assert.equal(calls[1].url, `https://sandbox.cashfree.com/pg/orders/${providerOrderId}`);
    assert.equal(new Headers(calls[0].init?.headers).get('x-idempotency-key'), '00000000-0000-4000-8000-000000000099');
    assert.equal((JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>).order_id, providerOrderId);
    assert.equal((JSON.parse(String(calls[1].init?.body || '{}')) as Record<string, unknown>).order_id, undefined);
    assert.equal((second.body as Record<string, unknown>).paymentSessionId, 'reconciled-session');
  });

  await t.test('Get Order 404 retries Create Order with the same stable order ID and idempotency key', async () => {
    const providerCalls: { url: string; init?: RequestInit }[] = [];
    let claimCount = 0;
    const { handler } = makeOrderHandler({
      databaseRequest: async (path, init) => {
        if (path.endsWith('/claim_cashfree_checkout_intent')) {
          claimCount += 1;
          if (claimCount === 1) return jsonResponse({ status: 'missing' });
          const claim: CashfreeIntent = {
            status: 'claimed',
            action: claimCount === 2 ? 'create' : 'reconcile',
            intent_id: 'intent-id',
            service_order_id: 'database-order-id',
            order_reference: providerOrderId,
            provider_idempotency_key: '00000000-0000-4000-8000-000000000099',
            claim_token: `claim-token-${claimCount}`,
            create_attempt_count: claimCount === 2 ? 0 : 1,
            total_amount_paise: 15050,
            currency: 'INR',
            customer_name: 'Ada Lovelace',
            customer_email: 'ada@example.com',
            customer_phone: '+91 98765 43210',
            expires_at: '2099-01-01T00:00:00.000Z',
          };
          return jsonResponse(claim);
        }
        if (path.endsWith('/complete_cashfree_checkout_intent')) {
          const payload = JSON.parse(String(init?.body)) as { p_payment_session_id: string };
          return jsonResponse({ status: 'completed', payment_session_id: payload.p_payment_session_id });
        }
        return jsonResponse(true);
      },
      fetcher: async (input, init) => {
        providerCalls.push({ url: String(input), init });
        return providerCalls.length === 1
          ? (() => { throw new DOMException('timeout', 'TimeoutError'); })()
          : providerCalls.length === 2
            ? new Response(null, { status: 404 })
            : jsonResponse({
              cf_order_id: cashfreeOrderId,
              order_id: providerOrderId,
              order_amount: 150.5,
              order_currency: 'INR',
              order_status: 'ACTIVE',
              payment_session_id: 'retried-session',
            });

      },
    });
    assert.equal((await invoke(handler, request(validOrderBody))).statusCode, 503);
    assert.equal((await invoke(handler, request(validOrderBody))).statusCode, 201);
    assert.deepEqual(providerCalls.map((call) => call.url), [
      'https://sandbox.cashfree.com/pg/orders',
      `https://sandbox.cashfree.com/pg/orders/${providerOrderId}`,
      'https://sandbox.cashfree.com/pg/orders',
    ]);
    assert.equal(new Headers(providerCalls[0].init?.headers).get('x-idempotency-key'), '00000000-0000-4000-8000-000000000099');
    assert.equal(new Headers(providerCalls[2].init?.headers).get('x-idempotency-key'), '00000000-0000-4000-8000-000000000099');
    assert.equal((JSON.parse(String(providerCalls[2].init?.body)) as Record<string, unknown>).order_id, providerOrderId);
  });

  await t.test('Get Order 404 retries require a valid unexpired intent timestamp', async (t) => {
    for (const scenario of [
      { name: 'expired timezone-offset timestamp', expiresAt: '2026-11-02T16:00:00-07:00', retryCreate: false },
      { name: 'malformed timestamp', expiresAt: 'not-a-timestamp', retryCreate: false },
      { name: 'missing timestamp', expiresAt: undefined, retryCreate: false },
      { name: 'future fractional timestamp with timezone offset', expiresAt: '2026-11-04T00:00:00.123456+05:30', retryCreate: true },
    ]) {
      await t.test(scenario.name, async () => {
        let claimCount = 0;
        const providerCalls: string[] = [];
        const failureKinds: string[] = [];
        const { handler } = makeOrderHandler({
          now: () => Date.parse('2026-11-03T00:00:00Z'),
          databaseRequest: async (path, init) => {
            if (path.endsWith('/claim_cashfree_checkout_intent')) {
              claimCount += 1;
              if (claimCount === 1) return jsonResponse({ status: 'missing' });
              const claim: CashfreeIntent = {
                status: 'claimed',
                action: claimCount === 2 ? 'create' : 'reconcile',
                intent_id: 'intent-id',
                service_order_id: 'database-order-id',
                order_reference: providerOrderId,
                provider_idempotency_key: '00000000-0000-4000-8000-000000000099',
                claim_token: 'claim-token',
                create_attempt_count: claimCount === 2 ? 0 : 1,
                total_amount_paise: 15050,
                currency: 'INR',
                customer_name: 'Ada Lovelace',
                customer_email: 'ada@example.com',
                customer_phone: '+91 98765 43210',
                ...(scenario.expiresAt === undefined ? {} : { expires_at: scenario.expiresAt }),
              };
              return jsonResponse(claim);
            }
            if (path.endsWith('/mark_cashfree_checkout_intent_ambiguous')) {
              failureKinds.push(String(JSON.parse(String(init?.body)).p_failure_kind));
              return jsonResponse(true);
            }
            if (path.endsWith('/prepare_cashfree_checkout_create')) return jsonResponse(true);
            if (path.endsWith('/complete_cashfree_checkout_intent')) {
              return jsonResponse({ status: 'completed', payment_session_id: 'recovered-session' });
            }
            return jsonResponse(true);
          },
          fetcher: async (input) => {
            const url = String(input);
            providerCalls.push(url);
            if (url.endsWith('/orders')) {
              if (providerCalls.length === 1) throw new DOMException('timeout', 'TimeoutError');
              return jsonResponse({
                cf_order_id: cashfreeOrderId,
                order_id: providerOrderId,
                order_amount: 150.5,
                order_currency: 'INR',
                order_status: 'ACTIVE',
                payment_session_id: 'retried-session',
              });
            }
            return new Response('not found', { status: 404 });
          },
        });
        const first = await invoke(handler, request(validOrderBody));
        const retry = await invoke(handler, request(validOrderBody));
        assert.equal(first.statusCode, 503);
        assert.equal(providerCalls[1], `https://sandbox.cashfree.com/pg/orders/${providerOrderId}`);
        assert.equal(providerCalls.length, scenario.retryCreate ? 3 : 2);
        if (scenario.retryCreate) {
          assert.equal(retry.statusCode, 201);
          assert.deepEqual(failureKinds, ['provider_outcome_unknown']);
        } else {
          assert.equal(retry.statusCode, 503);
          assert.deepEqual(failureKinds, ['provider_outcome_unknown', 'manual_reconciliation_required']);
        }
      });
    }
  });

  await t.test('unknown Get Order state does not create another provider order', async () => {
    const providerCalls: string[] = [];
    let claimCount = 0;
    const { handler } = makeOrderHandler({
      databaseRequest: async (path) => {
        if (path.endsWith('/claim_cashfree_checkout_intent')) {
          claimCount += 1;
          if (claimCount === 1) return jsonResponse({ status: 'missing' });
          return jsonResponse({
            status: 'claimed',
            action: claimCount === 2 ? 'create' : 'reconcile',
            intent_id: 'intent-id',
            service_order_id: 'database-order-id',
            order_reference: providerOrderId,
            provider_idempotency_key: '00000000-0000-4000-8000-000000000099',
            claim_token: `claim-${claimCount}`,
            create_attempt_count: 1,
            total_amount_paise: 15050,
            currency: 'INR',
            customer_name: 'Ada Lovelace',
            customer_email: 'ada@example.com',
            customer_phone: '+91 98765 43210',
            expires_at: '2099-01-01T00:00:00.000Z',
          });
        }
        return jsonResponse(true);
      },
      fetcher: async (input) => {
        providerCalls.push(String(input));
        if (providerCalls.length === 1) throw new DOMException('timeout', 'TimeoutError');
        return new Response('unavailable', { status: 503 });
      },
    });
    assert.equal((await invoke(handler, request(validOrderBody))).statusCode, 503);
    const retry = await invoke(handler, request(validOrderBody));
    assert.equal(retry.statusCode, 503);
    assert.deepEqual(providerCalls, [
      'https://sandbox.cashfree.com/pg/orders',
      `https://sandbox.cashfree.com/pg/orders/${providerOrderId}`,
    ]);
  });

  await t.test('provider order created but local completion failed; retry reconciles without a second POST', async () => {
    let claimCount = 0;
    let completionCount = 0;
    const providerCalls: string[] = [];
    const { handler } = makeOrderHandler({
      databaseRequest: async (path, init) => {
        if (path.endsWith('/claim_cashfree_checkout_intent')) {
          claimCount += 1;
          if (claimCount === 1) return jsonResponse({ status: 'missing' });
          return jsonResponse({
            status: 'claimed',
            action: claimCount === 2 ? 'create' : 'reconcile',
            intent_id: 'intent-id',
            service_order_id: 'database-order-id',
            order_reference: providerOrderId,
            provider_idempotency_key: '00000000-0000-4000-8000-000000000099',
            claim_token: `claim-${claimCount}`,
            create_attempt_count: claimCount === 2 ? 0 : 1,
            total_amount_paise: 15050,
            currency: 'INR',
            customer_name: 'Ada Lovelace',
            customer_email: 'ada@example.com',
            customer_phone: '+91 98765 43210',
            expires_at: '2099-01-01T00:00:00.000Z',
          });
        }
        if (path.endsWith('/complete_cashfree_checkout_intent')) {
          completionCount += 1;
          if (completionCount === 1) return jsonResponse({ code: 'database_unavailable' }, 503);
          const payload = JSON.parse(String(init?.body)) as { p_payment_session_id: string };
          return jsonResponse({ status: 'completed', payment_session_id: payload.p_payment_session_id });
        }
        return jsonResponse(true);
      },
      fetcher: async (input) => {
        providerCalls.push(String(input));
        return jsonResponse({
          cf_order_id: cashfreeOrderId,
          order_id: providerOrderId,
          order_amount: 150.5,
          order_currency: 'INR',
          order_status: 'ACTIVE',
          payment_session_id: 'persisted-after-reconciliation',
        });
      },
    });
    const first = await invoke(handler, request(validOrderBody));
    const retry = await invoke(handler, request(validOrderBody));
    assert.equal(first.statusCode, 503);
    assert.equal(JSON.stringify(first.body).includes('persisted-after-reconciliation'), false);
    assert.equal(retry.statusCode, 201);
    assert.equal(JSON.stringify(retry.body).includes('persisted-after-reconciliation'), true);
    assert.deepEqual(providerCalls, [
      'https://sandbox.cashfree.com/pg/orders',
      `https://sandbox.cashfree.com/pg/orders/${providerOrderId}`,
    ]);
  });
});

test('concurrent checkout requests create at most one provider order', async () => {
  let newIntentClaimed = false;
  let providerCalls = 0;
  let claimedOrderReference = '';
  const { handler } = makeOrderHandler({
    databaseRequest: async (path, init) => {
      if (!path.endsWith('/claim_cashfree_checkout_intent')) {
        if (path.endsWith('/complete_cashfree_checkout_intent')) {
          const payload = JSON.parse(String(init?.body)) as { p_payment_session_id: string };
          return jsonResponse({ status: 'completed', payment_session_id: payload.p_payment_session_id });
        }
        return jsonResponse(true);
      }
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (!payload.p_create_if_missing) return jsonResponse({ status: 'missing' });
      if (newIntentClaimed) return jsonResponse({ status: 'busy' });
      newIntentClaimed = true;
      claimedOrderReference = String(payload.p_order_reference);
      return jsonResponse({
        status: 'claimed',
        action: 'create',
        intent_id: 'intent-id',
        service_order_id: 'database-order-id',
        order_reference: payload.p_order_reference,
        provider_idempotency_key: payload.p_provider_idempotency_key,
        claim_token: 'claim-token',
        create_attempt_count: 0,
        total_amount_paise: payload.p_total_amount_paise,
        currency: 'INR',
        customer_name: payload.p_customer_name,
        customer_email: payload.p_customer_email,
        customer_phone: payload.p_customer_phone,
        expires_at: '2099-01-01T00:00:00.000Z',
      });
    },
    fetcher: async () => {
      providerCalls += 1;
      return jsonResponse({
        cf_order_id: cashfreeOrderId,
        order_id: claimedOrderReference,
        order_amount: 150.5,
        order_currency: 'INR',
        order_status: 'ACTIVE',
        payment_session_id: 'single-session',
      });
    },
  });
  const results = await Promise.all([
    invoke(handler, request(validOrderBody)),
    invoke(handler, request(validOrderBody)),
  ]);
  assert.equal(providerCalls, 1);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [201, 202]);
});

test('completed intents return the persisted session without another provider request', async () => {
  let providerCalls = 0;
  const { handler } = makeOrderHandler({
    fetcher: async () => {
      providerCalls += 1;
      return jsonResponse({});
    },
    databaseRequest: async () => jsonResponse({
      status: 'completed',
      service_order_id: 'database-order-id',
      order_reference: providerOrderId,
      payment_session_id: 'durable-session',
      cashfree_order_id: cashfreeOrderId,
      total_amount_paise: 15050,
      currency: 'INR',
    }),
  });
  const result = await invoke(handler, request(validOrderBody));
  assert.equal(result.statusCode, 200);
  assert.equal(providerCalls, 0);
  assert.equal((result.body as Record<string, unknown>).paymentSessionId, 'durable-session');
});

test('intent conflict, concurrent claim and failed completion fail closed', async (t) => {
  for (const status of ['conflict', 'busy', 'expired', 'manual_reconciliation'] as const) {
    await t.test(status, async () => {
      let providerCalls = 0;
      const { handler } = makeOrderHandler({
        databaseRequest: async () => jsonResponse({ status }),
        fetcher: async () => {
          providerCalls += 1;
          return jsonResponse({});
        },
      });
      const result = await invoke(handler, request(validOrderBody));
      assert.equal(result.statusCode, status === 'conflict' ? 409 : status === 'expired' ? 410 : status === 'busy' ? 202 : 503);
      assert.equal(providerCalls, 0);
    });
  }
  await t.test('failed local completion remains pending and returns no session', async () => {
    const { handler } = makeOrderHandler({
      databaseRequest: async (path) => {
        if (path.endsWith('/complete_cashfree_checkout_intent')) {
          return jsonResponse({ code: 'database_unavailable' }, 503);
        }
        if (path.endsWith('/mark_cashfree_checkout_intent_ambiguous')) return jsonResponse(true);
        if (path.endsWith('/prepare_cashfree_checkout_create')) return jsonResponse(true);
        return jsonResponse({
          status: 'claimed',
          action: 'create',
          intent_id: 'intent-id',
          service_order_id: 'database-order-id',
          order_reference: providerOrderId,
          provider_idempotency_key: '00000000-0000-4000-8000-000000000099',
          claim_token: 'claim-token',
          create_attempt_count: 0,
          expires_at: '2099-01-01T00:00:00.000Z',
          total_amount_paise: 15050,
          currency: 'INR',
          customer_name: 'Ada Lovelace',
          customer_email: 'ada@example.com',
          customer_phone: '+91 98765 43210',
        });
      },
    });
    const result = await invoke(handler, request(validOrderBody));
    assert.equal(result.statusCode, 503);
    assert.equal(JSON.stringify(result.body).includes('sandbox-session-token'), false);
  });
});

test('database uniqueness and atomic intent claims are represented in migration and tests document bounded recovery', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261103100000_add_cashfree_service_payment_persistence.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /cashfree_checkout_intents_client_key UNIQUE \(client_idempotency_hash\)/i);
  assert.match(migration, /PERFORM pg_advisory_xact_lock\(hashtextextended\(p_client_idempotency_hash, 0\)\)/i);
  assert.match(migration, /provider_request_started boolean NOT NULL DEFAULT false/i);
  assert.match(migration, /intent_expires_at timestamptz NOT NULL/i);
  assert.match(migration, /create_attempt_count BETWEEN 0 AND 3/i);
  assert.match(migration, /lease_expires_at = now\(\) \+ interval '90 seconds'/i);
});

/* Preserve the rest of the route-level tests below. */

test('webhook rejects missing/bad signatures before parsing or database/provider calls', async (t) => {
  const fixture = createWebhookFixture();
  await t.test('missing headers', async () => {
    const result = await invoke(fixture.handler, {
      ...request(),
      rawBody: Buffer.from('{'),
    } as CashfreeHttpRequest);
    assert.equal(result.statusCode, 400);
    assert.equal(fixture.databaseCalls.length, 0);
    assert.equal(fixture.calls.length, 0);
  });

  await t.test('Production webhook rejects Sandbox signatures, mismatched deployment mode, and Sandbox orders', async () => {
    const productionConfig: CashfreeServerConfig = {
      mode: 'production',
      apiBaseUrl: 'https://api.cashfree.com/pg',
      clientId: 'production-client-id',
      clientSecret: 'production-webhook-secret',
    };
    const wrongSignature = createWebhookFixture({
      mode: 'production',
      config: productionConfig,
    });
    const rejected = await invoke(wrongSignature.handler, signedWebhook(webhookPayload()));
    assert.equal(rejected.statusCode, 400);
    assert.equal(wrongSignature.databaseCalls.length, 0);
    assert.equal(wrongSignature.calls.length, 0);

    const wrongDeployment = createWebhookFixture({
      mode: 'production',
      config: {
        mode: 'sandbox',
        apiBaseUrl: 'https://sandbox.cashfree.com/pg',
        clientId: 'sandbox-client-id',
        clientSecret: webhookSecret,
      },
    });
    const crossMode = await invoke(
      wrongDeployment.handler,
      signedWebhook(webhookPayload(), '1617695238078', webhookSecret),
    );
    assert.equal(crossMode.statusCode, 400);
    assert.equal(wrongDeployment.databaseCalls.length, 0);

    const sandboxOrder = createWebhookFixture({
      mode: 'production',
      config: productionConfig,
      order: {
        provider_order_id: providerOrderId,
        cashfree_order_id: cashfreeOrderId,
        total_amount_paise: 15050,
        currency: 'INR',
        provider_mode: 'test',
      },
    });
    const rejectedSandboxOrder = await invoke(
      sandboxOrder.handler,
      signedWebhook(webhookPayload(), '1617695238078', productionConfig.clientSecret),
    );
    assert.equal(rejectedSandboxOrder.statusCode, 503);
    assert.equal(sandboxOrder.calls.length, 0);
  });
  await t.test('Production webhook verifies against live Cashfree and uses mode-bound idempotent persistence', async () => {
    const config: CashfreeServerConfig = {
      mode: 'production',
      apiBaseUrl: 'https://api.cashfree.com/pg',
      clientId: 'production-client-id',
      clientSecret: 'production-webhook-secret',
    };
    const fixture = createWebhookFixture({
      mode: 'production',
      config,
      order: {
        id: 'database-order-id',
        provider_order_id: providerOrderId,
        cashfree_order_id: cashfreeOrderId,
        total_amount_paise: 15050,
        currency: 'INR',
        provider_mode: 'live',
      },
    });
    const event = signedWebhook(webhookPayload(), '1617695238078', config.clientSecret);
    const first = await invoke(fixture.handler, event);
    const retry = await invoke(fixture.handler, signedWebhook(webhookPayload(), '1617695238078', config.clientSecret));
    const processCall = fixture.databaseCalls.find((call) =>
      call.path.includes('process_cashfree_webhook_event_for_mode'));
    const payload = JSON.parse(String(processCall?.init?.body)) as Record<string, unknown>;
    assert.equal(first.statusCode, 200);
    assert.equal(retry.statusCode, 200);
    assert.equal(fixture.calls.every((call) => call.url.startsWith('https://api.cashfree.com/pg/')), true);
    assert.equal(fixture.databaseCalls.filter((call) =>
      call.path.includes('process_cashfree_webhook_event_for_mode')).length, 2);
    assert.equal(payload.p_checkout_mode, 'production');
    assert.equal(payload.p_event_fingerprint, JSON.parse(String(
      fixture.databaseCalls.filter((call) => call.path.includes('process_cashfree_webhook_event_for_mode'))[1]?.init?.body,
    )).p_event_fingerprint);
  });
  await t.test('missing timestamp or signature', async () => {
    const headerCases: Record<string, string>[] = [
      { 'x-webhook-signature': 'missing-timestamp' },
      { 'x-webhook-timestamp': '1617695238078' },
    ];
    for (const headers of headerCases) {
      const req = request(undefined, headers);
      req.rawBody = Buffer.from(JSON.stringify(webhookPayload()));
      const result = await invoke(fixture.handler, req);
      assert.equal(result.statusCode, 400);
    }
    assert.equal(fixture.databaseCalls.length, 0);
  });
  await t.test('tampered payload', async () => {
    const signed = signedWebhook(webhookPayload());
    signed.rawBody = Buffer.from(`${signed.rawBody!.toString()} `);
    const result = await invoke(fixture.handler, signed);
    assert.equal(result.statusCode, 400);
    assert.equal(fixture.databaseCalls.length, 0);
    assert.equal(fixture.calls.length, 0);
  });
  await t.test('malformed timestamp', async () => {
    const result = await invoke(fixture.handler, signedWebhook(webhookPayload(), '1617695238'));
    assert.equal(result.statusCode, 400);
    assert.equal(fixture.databaseCalls.length, 0);
  });
});

test('webhook parses malformed JSON only after a valid HMAC and performs no database writes', async () => {
  const fixture = createWebhookFixture();
  const rawBody = Buffer.from('{"type":');
  const timestamp = '1617695238078';
  const signature = createHmac('sha256', webhookSecret).update(timestamp).update(rawBody).digest('base64');
  const req = request(undefined, {
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': signature,
  });
  req.rawBody = rawBody;
  const result = await invoke(fixture.handler, req);
  assert.equal(result.statusCode, 400);
  assert.equal(fixture.databaseCalls.length, 0);
});

test('webhook independently verifies order, payment state, amount and INR before atomic persistence', async (t) => {
  for (const [name, payment] of [
    ['wrong order', { order_id: 'other-order' }],
    ['wrong amount', { payment_amount: 150.49 }],
    ['wrong currency', { payment_currency: 'USD' }],
    ['forged uncaptured success', { payment_status: 'SUCCESS', is_captured: false }],
    ['non-success claimed captured', { payment_status: 'FAILED', is_captured: true }],
  ] as const) {
    await t.test(name, async () => {
      const fixture = createWebhookFixture({
        payment: {
          cf_payment_id: '987654321',
          order_id: providerOrderId,
          order_amount: 150.5,
          order_currency: 'INR',
          payment_amount: 150.5,
          payment_currency: 'INR',
          payment_status: 'SUCCESS',
          is_captured: true,
          ...payment,
        },
      });
      const result = await invoke(fixture.handler, signedWebhook(webhookPayload()));
      assert.equal(result.statusCode, 503);
      assert.equal(fixture.databaseCalls.filter((call) => call.path.includes('process_cashfree')).length, 0);
    });
  }
});

test('webhook mismatched stored order details are never confirmed', async (t) => {
  for (const order of [
    { id: 'order', cashfree_order_id: cashfreeOrderId, total_amount_paise: 15050, currency: 'USD' },
    { id: 'order', cashfree_order_id: null, total_amount_paise: 15050, currency: 'INR' },
    { id: 'order', provider_order_id: 'different-order', cashfree_order_id: cashfreeOrderId, total_amount_paise: 15050, currency: 'INR' },
  ]) {
    await t.test(JSON.stringify(order), async () => {
      const fixture = createWebhookFixture({ order });
      const result = await invoke(fixture.handler, signedWebhook(webhookPayload()));
      assert.equal(result.statusCode, 503);
      assert.equal(fixture.calls.length, 0);
      assert.equal(fixture.databaseCalls.some((call) => call.path.includes('process_cashfree')), false);
    });
  }
});

test('webhook for a missing order is acknowledged, but a pre-persistence Cashfree order is retryable', async (t) => {
  await t.test('unmatched merchant order', async () => {
    const fixture = createWebhookFixture({
      databaseRequest: async () => jsonResponse([]),
    });
    const result = await invoke(fixture.handler, signedWebhook(webhookPayload()));
    assert.equal(result.statusCode, 200);
    assert.equal(fixture.calls.length, 0);
  });
  await t.test('checkout intent exists but provider identifiers are not committed yet', async () => {
    const fixture = createWebhookFixture({
      order: {
        id: 'database-order-id',
        provider_order_id: providerOrderId,
        cashfree_order_id: null,
        total_amount_paise: 15050,
        currency: 'INR',
      },
    });
    const result = await invoke(fixture.handler, signedWebhook(webhookPayload()));
    assert.equal(result.statusCode, 503);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.databaseCalls.some((call) => call.path.includes('process_cashfree')), false);
  });
});

test('concurrent webhook retries use durable stable provider IDs and atomically confirm once', async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  const seenFingerprints = new Set<string>();
  const seenPayments = new Set<string>();
  let confirmations = 0;
  const fixture = createWebhookFixture({
    databaseRequest: async (path, init) => {
      calls.push({ path, init });
      if (path.startsWith('rest/v1/service_orders?')) {
        return jsonResponse([{
          id: 'database-order-id',
          provider_order_id: providerOrderId,
          cashfree_order_id: cashfreeOrderId,
          total_amount_paise: 15050,
          currency: 'INR',
        }]);
      }
      const payload = JSON.parse(String(init?.body));
      seenFingerprints.add(payload.p_event_fingerprint);
      const key = `${payload.p_provider_order_id}:${payload.p_cashfree_order_id}:${payload.p_provider_payment_id}`;
      if (seenPayments.has(key)) return jsonResponse('already_paid');
      seenPayments.add(key);
      confirmations += 1;
      return jsonResponse('paid');
    },
  });
  const [first, duplicate] = await Promise.all([
    invoke(fixture.handler, signedWebhook(webhookPayload())),
    invoke(fixture.handler, signedWebhook(webhookPayload())),
  ]);
  const rpcPayloads = calls.filter((call) => call.path.includes('process_cashfree')).map((call) =>
    JSON.parse(String(call.init?.body)));

  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(confirmations, 1);
  assert.equal(seenFingerprints.size, 1);
  assert.equal(rpcPayloads.length, 2);
  assert.ok(rpcPayloads.every((payload) =>
    payload.p_provider_order_id === providerOrderId &&
    payload.p_cashfree_order_id === cashfreeOrderId &&
    payload.p_provider_payment_id === '987654321'));
});

test('different successful attempts for one Cashfree order keep distinct durable attempt IDs', async () => {
  const payloads: Record<string, unknown>[] = [];
  let providerAttempt = 0;
  const payment = {
    order_id: providerOrderId,
    order_amount: 150.5,
    order_currency: 'INR',
    payment_amount: 150.5,
    payment_currency: 'INR',
    payment_status: 'SUCCESS',
    is_captured: true,
  };
  const fixture = createWebhookFixture({
    fetcher: async () => jsonResponse([{
      ...payment,
      cf_payment_id: providerAttempt++ === 0 ? 'payment-attempt-one' : 'payment-attempt-two',
    }]),
    databaseRequest: async (path, init) => {
      if (path.startsWith('rest/v1/service_orders?')) {
        return jsonResponse([{
          id: 'database-order-id',
          provider_order_id: providerOrderId,
          cashfree_order_id: cashfreeOrderId,
          total_amount_paise: 15050,
          currency: 'INR',
        }]);
      }
      payloads.push(JSON.parse(String(init?.body)));
      return jsonResponse(payloads.length === 1 ? 'paid' : 'additional_successful_attempt');
    },
  });
  const one = await invoke(fixture.handler, signedWebhook(webhookPayload('payment-attempt-one')));
  const two = await invoke(fixture.handler, signedWebhook(webhookPayload('payment-attempt-two')));
  assert.equal(one.statusCode, 200);
  assert.equal(two.statusCode, 200);
  assert.equal(payloads[0].p_provider_payment_id, 'payment-attempt-one');
  assert.equal(payloads[1].p_provider_payment_id, 'payment-attempt-two');
  assert.equal(payloads[0].p_provider_order_id, payloads[1].p_provider_order_id);
});

test('provider/database webhook failures return retryable errors and do not claim success', async (t) => {
  await t.test('provider timeout', async () => {
    const fixture = createWebhookFixture({ fetcher: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
    const result = await invoke(fixture.handler, signedWebhook(webhookPayload()));
    assert.equal(result.statusCode, 503);
    assert.equal(fixture.databaseCalls.some((call) => call.path.includes('process_cashfree')), false);
  });
  await t.test('database RPC failure', async () => {
    const fixture = createWebhookFixture({
      databaseRequest: async (path) => path.startsWith('rest/v1/service_orders?')
        ? jsonResponse([{
          id: 'database-order-id',
          provider_order_id: providerOrderId,
          cashfree_order_id: cashfreeOrderId,
          total_amount_paise: 15050,
          currency: 'INR',
        }])
        : jsonResponse({ code: 'database_unavailable' }, 503),
    });
    const result = await invoke(fixture.handler, signedWebhook(webhookPayload()));
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.body, { message: 'Webhook processing failed.' });
  });

  await t.test('replayed verified event succeeds after a transient atomic RPC failure', async () => {
    let attempts = 0;
    const rpcPayloads: Record<string, unknown>[] = [];
    const fixture = createWebhookFixture({
      databaseRequest: async (path, init) => {
        if (path.startsWith('rest/v1/service_orders?')) {
          return jsonResponse([{
            id: 'database-order-id',
            provider_order_id: providerOrderId,
            cashfree_order_id: cashfreeOrderId,
            total_amount_paise: 15050,
            currency: 'INR',
          }]);
        }
        rpcPayloads.push(JSON.parse(String(init?.body)));
        attempts += 1;
        return attempts === 1 ? jsonResponse({ code: 'transient_failure' }, 503) : jsonResponse('paid');
      },
    });
    const event = signedWebhook(webhookPayload());
    const first = await invoke(fixture.handler, event);
    const retry = await invoke(fixture.handler, event);
    assert.equal(first.statusCode, 503);
    assert.equal(retry.statusCode, 200);
    assert.equal(rpcPayloads.length, 2);
    assert.equal(rpcPayloads[0].p_provider_payment_id, rpcPayloads[1].p_provider_payment_id);
    assert.equal(rpcPayloads[0].p_event_fingerprint, rpcPayloads[1].p_event_fingerprint);
  });
});

test('Primary Owner activation route refuses unauthorized, cross-origin, and unconfigured requests', async (t) => {
  let gatewayWrites = 0;
  const ready: CashfreeGatewayReadiness = {
    status: 'ready_for_testing',
    credentialsConfigured: true,
    environmentEnabled: true,
    providerConfigurationConfirmed: true,
    webhookConfigured: true,
    migrationReady: true,
    enabled: false,
  };
  const dependencies = {
    requireOwner: (_req: CashfreeHttpRequest, res: CashfreeHttpResponse) => {
      res.status(403).json({ message: 'Primary Owner only.' });
      return false;
    },
    isSameOrigin: () => true,
    currentAdmin: () => ({ id: 'co-owner-id' }),
    reauthenticate: async () => true,
    getReadiness: async () => ready,
    setGateway: async () => { gatewayWrites += 1; return true; },
    recordChange: () => undefined,
  };
  const handler = createCashfreeActivationHandler(dependencies);
  await t.test('unauthorized actor', async () => {
    const result = await invoke(handler, request({ enable: true, confirmMode: 'test', password: 'secret' }));
    assert.equal(result.statusCode, 403);
    assert.equal(gatewayWrites, 0);
  });
  await t.test('same-origin check is a handler requirement', async () => {
    const result = await invoke(createCashfreeActivationHandler({
      ...dependencies,
      requireOwner: () => true,
      isSameOrigin: () => false,
    }), request({ enable: true, confirmMode: 'test', password: 'secret' }));
    assert.equal(result.statusCode, 403);
    assert.equal(gatewayWrites, 0);
  });
  await t.test('missing sandbox configuration', async () => {
    const result = await invoke(createCashfreeActivationHandler({
      ...dependencies,
      requireOwner: () => true,
      isSameOrigin: () => true,
      getReadiness: async () => ({ ...ready, status: 'sandbox_configured' }),
    }), request({ enable: true, confirmMode: 'test', password: 'secret' }));
    assert.equal(result.statusCode, 503);
    assert.equal(gatewayWrites, 0);
  });
  await t.test('missing migration and readiness failures fail closed', async () => {
    const missingMigration = await invoke(createCashfreeActivationHandler({
      ...dependencies,
      requireOwner: () => true,
      getReadiness: async () => ({ ...ready, status: 'database_migration_missing', migrationReady: false }),
    }), request({ enable: true, confirmMode: 'test', password: 'secret' }));
    const unavailable = await invoke(createCashfreeActivationHandler({
      ...dependencies,
      requireOwner: () => true,
      getReadiness: async () => { throw new Error('schema query failed'); },
    }), request({ enable: true, confirmMode: 'test', password: 'secret' }));
    assert.equal(missingMigration.statusCode, 503);
    assert.equal(unavailable.statusCode, 503);
    assert.equal(gatewayWrites, 0);
  });
  await t.test('provider or webhook attestations cannot be bypassed by a ready status', async () => {
    for (const field of ['providerConfigurationConfirmed', 'webhookConfigured'] as const) {
      const result = await invoke(createCashfreeActivationHandler({
        ...dependencies,
        requireOwner: () => true,
        getReadiness: async () => ({ ...ready, [field]: false }),
      }), request({ enable: true, confirmMode: 'test', password: 'secret' }));
      assert.equal(result.statusCode, 503, field);
      assert.equal(gatewayWrites, 0);
    }
  });
  await t.test('authenticated sandbox activation persists and audits only the requested mode', async () => {
    let actor: string | undefined;
    let enabled: boolean | undefined;
    let reauthenticated = false;
    let recorded = false;
    const result = await invoke(createCashfreeActivationHandler({
      ...dependencies,
      requireOwner: () => true,
      isSameOrigin: () => true,
      currentAdmin: () => ({ id: 'primary-owner-id' }),
      reauthenticate: async (_req, _res, identity, password, message) => {
        reauthenticated = identity.id === 'primary-owner-id' &&
          password === 'owner-password' && message.includes('Primary Owner');
        return reauthenticated;
      },
      setGateway: async (actorId, enable) => {
        actor = actorId;
        enabled = enable;
        gatewayWrites += 1;
        return true;
      },
      recordChange: (actorId, enable) => {
        recorded = actorId === 'primary-owner-id' && enable;
      },
    }), request({ enable: true, confirmMode: 'test', password: 'owner-password' }));
    assert.equal(result.statusCode, 200);
    assert.equal(actor, 'primary-owner-id');
    assert.equal(enabled, true);
    assert.equal(reauthenticated, true);
    assert.equal(recorded, true);
  });

});

test('Cashfree admin readiness is Primary Owner-only and never returns secrets', async (t) => {
    const secretCanary = 'cashfree-secret-must-not-leak';
    const readiness = {
      status: 'ready_for_testing' as const,
      credentialsConfigured: true,
      environmentEnabled: true,
      providerConfigurationConfirmed: true,
      webhookConfigured: true,
      migrationReady: true,
      enabled: false,
      secret: secretCanary,
    };
    const handler = createCashfreeAdminReadinessHandler({
      requireOwner: () => true,
      getReadiness: async () => ({
        ...readiness,
      }),
      getEnvironmentDiagnostics: () => ({
        reason: 'mixed_environment_configuration',
        requestedMode: 'production',
        mode: 'production',
        productionDeployment: true,
        credentialsConfigured: true,
        clientIdConfigured: true,
        clientIdValid: true,
        clientSecretConfigured: true,
        clientSecretValid: true,
        environmentEnabled: false,
        providerConfigurationConfirmed: true,
        webhookConfigured: true,
        sandboxCredentialsPresent: true,
        sandboxFlagsEnabled: false,
      }),
    });

    const result = await invoke(handler, request());
    assert.equal(result.statusCode, 200);
    const readinessBody = result.body as Record<string, unknown>;
    const environmentDiagnostics = readinessBody.environmentDiagnostics as Record<string, unknown>;
    assert.equal(environmentDiagnostics.reason, 'mixed_environment_configuration');
    assert.doesNotMatch(JSON.stringify(result.body), new RegExp(secretCanary));
    const failedResult = await invoke(createCashfreeAdminReadinessHandler({
      requireOwner: () => true,
      getReadiness: async () => { throw new Error(`private detail ${secretCanary}`); },
      getMode: () => 'production',
    }), request());
    assert.equal(failedResult.statusCode, 503);
    assert.equal((failedResult.body as Record<string, unknown>).mode, 'production');
    assert.doesNotMatch(JSON.stringify(failedResult.body), new RegExp(secretCanary));
    await t.test('rejects non-Owner access before readiness lookup', async () => {
      let lookedUp = false;
      const forbidden = await invoke(createCashfreeAdminReadinessHandler({
        requireOwner: (_req, res) => {
          res.status(403).json({ message: 'Primary Owner only.' });
          return false;
        },
        getReadiness: async () => {
          lookedUp = true;
          return readiness;
        },
      }), request());
      assert.equal(forbidden.statusCode, 403);
      assert.equal(lookedUp, false);
    });
});

test('Production activation requires explicit Production confirmation and reauthenticated Primary Owner', async () => {
  let writtenMode: string | undefined;
  const handler = createCashfreeActivationHandler({
    mode: 'production',
    requireOwner: () => true,
    isSameOrigin: () => true,
    currentAdmin: () => ({ id: 'primary-owner-id' }),
    reauthenticate: async (_req, _res, identity, password) =>
      identity.id === 'primary-owner-id' && password === 'recent-owner-password',
    getReadiness: async () => ({
      mode: 'production',
      status: 'ready_for_live',
      credentialsConfigured: true,
      environmentEnabled: true,
      providerConfigurationConfirmed: true,
      webhookConfigured: true,
      migrationReady: true,
      enabled: false,
    }),
    setGateway: async (_actorId, enable, mode) => {
      if (enable) writtenMode = mode;
      return true;
    },
    recordChange: () => undefined,
  });
  const wrongMode = await invoke(handler, request({
    enable: true,
    confirmMode: 'test',
    password: 'recent-owner-password',
  }));
  assert.equal(wrongMode.statusCode, 400);
  assert.equal(writtenMode, undefined);
  const enabled = await invoke(handler, request({
    enable: true,
    confirmMode: 'production',
    password: 'recent-owner-password',
  }));
  assert.equal(enabled.statusCode, 200);
  assert.deepEqual(enabled.body, { success: true, enabled: true, mode: 'production' });
  assert.equal(writtenMode, 'production');
});

test('Admin Orders and Fulfilment routes use the live Service Store action permission checks', () => {
  assert.equal(serviceStoreAdminAction('/orders', 'GET'), 'view');
  assert.equal(serviceStoreAdminAction('/orders/123/fulfillment', 'PATCH'), 'edit');
  assert.equal(serviceStoreAdminAction('/orders', 'PATCH'), undefined);
  assert.equal(serviceStoreAdminAction('/payment-settings/cashfree', 'POST'), 'edit');
  assert.equal(serviceStoreAdminAction('/payment-settings/cashfree', 'GET'), 'view');
  assert.equal(canAccessServiceStoreAction('custom_admin', { serviceStore: { view: true } }, 'view'), true);
  assert.equal(canAccessServiceStoreAction('custom_admin', { serviceStore: { view: true } }, 'edit'), false);
  assert.equal(canAccessServiceStoreAction('custom_admin', { serviceStore: { view: true, edit: true } }, 'edit'), true);
  assert.equal(canAccessServiceStoreAction('co_owner', { serviceStore: { view: false, edit: true } }, 'edit'), false);
  assert.equal(canAccessServiceStoreAction('owner', {}, 'edit'), true);
});

test('Cashfree schema remains isolated from Razorpay and permanent-delete structures', () => {
  const cashfreeMigration = readFileSync(
    new URL('../supabase/migrations/20261103100000_add_cashfree_service_payment_persistence.sql', import.meta.url),
    'utf8',
  );
  const razorpayMigration = readFileSync(
    new URL('../supabase/migrations/20261022150000_create_service_orders_and_payment_settings.sql', import.meta.url),
    'utf8',
  );
  const permanentDeleteMigration = readFileSync(
    new URL('../supabase/migrations/20261102100000_secure_archived_admin_permanent_deletion.sql', import.meta.url),
    'utf8',
  );
  assert.match(razorpayMigration, /provider text NOT NULL DEFAULT 'razorpay'/);
  assert.match(razorpayMigration, /FUNCTION public\.confirm_service_order_payment/);
  assert.match(cashfreeMigration, /provider = 'razorpay' AND currency = 'INR'/);
  assert.doesNotMatch(cashfreeMigration, /DROP FUNCTION[^;]*(?:permanent_deletion|admin_identity_history)/i);
  assert.doesNotMatch(cashfreeMigration, /DROP TABLE[^;]*(?:admin_permanent_deletion_jobs|admin_identity_history)/i);
  assert.match(permanentDeleteMigration, /public\.admin_permanent_deletion_jobs/);
  assert.match(cashfreeMigration, /cashfree_test_verified_by uuid[\s\S]*?REFERENCES public\.admin_identity_history\(id\) ON DELETE SET NULL/);
});
