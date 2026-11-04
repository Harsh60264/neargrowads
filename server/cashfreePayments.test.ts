import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  cashfreeWebhookFingerprint,
  cashfreeEnvironmentWebhookFingerprint,
  isCashfreeWebhookTimestamp,
  parseCashfreeWebhook,
  verifyCashfreePayment,
  verifyCashfreeWebhookSignature,
  resolveCashfreeEnvironment,
} from './cashfreePayments.ts';

const webhookSecret = 'sandbox-webhook-secret';
const timestamp = '1617695238078';
const rawBody = Buffer.from('{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"NGO-123"},"payment":{"cf_payment_id":"987654321"}}}');
const signatureFor = (body: Buffer, time: string) =>
  createHmac('sha256', webhookSecret).update(time).update(body).digest('base64');

test('Cashfree webhook signature binds the exact raw body and documented millisecond timestamp', () => {
  const signature = signatureFor(rawBody, timestamp);
  assert.equal(verifyCashfreeWebhookSignature(rawBody, timestamp, signature, webhookSecret), true);
  assert.equal(verifyCashfreeWebhookSignature(Buffer.from(`${rawBody.toString()} `), timestamp, signature, webhookSecret), false);
  assert.equal(verifyCashfreeWebhookSignature(rawBody, '1617695238079', signature, webhookSecret), false);
  assert.equal(verifyCashfreeWebhookSignature(rawBody, timestamp, `${signature.slice(0, -2)}??`, webhookSecret), false);
});

test('timestamp format is checked without an undocumented replay freshness window', () => {
  assert.equal(isCashfreeWebhookTimestamp(timestamp), true);
  assert.equal(isCashfreeWebhookTimestamp('1617695238'), false);
  assert.equal(isCashfreeWebhookTimestamp('1617695238078x'), false);
  assert.equal(isCashfreeWebhookTimestamp('99999999999999'), false);
  assert.equal(verifyCashfreeWebhookSignature(rawBody, timestamp, signatureFor(rawBody, timestamp), webhookSecret), true);
});

test('webhook parser extracts only Cashfree stable order and payment identifiers', () => {
  assert.deepEqual(parseCashfreeWebhook(JSON.parse(rawBody.toString())), {
    eventType: 'PAYMENT_SUCCESS_WEBHOOK',
    providerOrderId: 'NGO-123',
    providerPaymentId: '987654321',
  });
  assert.equal(parseCashfreeWebhook({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: {} }), undefined);
  assert.equal(parseCashfreeWebhook({
    type: 'ORDER_STATUS_WEBHOOK',
    data: { order: { order_id: 'NGO-123' }, payment: { cf_payment_id: '987654321' } },
  }), undefined);
});

test('provider payment verification requires matching identifiers, INR amounts, and captured success', () => {
  const expected = { providerOrderId: 'NGO-123', providerPaymentId: '987654321', amountPaise: 1250 };
  const payment = {
    order_id: 'NGO-123',
    cf_payment_id: '987654321',
    order_amount: 12.5,
    order_currency: 'INR',
    payment_amount: 12.5,
    payment_currency: 'INR',
    payment_status: 'SUCCESS',
    is_captured: true,
  };
  assert.deepEqual(verifyCashfreePayment(payment, expected), {
    providerPaymentId: expected.providerPaymentId,
    status: 'SUCCESS',
    amountPaise: 1250,
  });
  assert.equal(verifyCashfreePayment({ ...payment, payment_amount: 12.49 }, expected), undefined);
  assert.equal(verifyCashfreePayment({ ...payment, order_amount: 12.49 }, expected), undefined);
  assert.equal(verifyCashfreePayment({ ...payment, payment_currency: 'USD' }, expected), undefined);
  assert.equal(verifyCashfreePayment({ ...payment, cf_payment_id: 'other' }, expected), undefined);
  assert.equal(verifyCashfreePayment({ ...payment, is_captured: false }, expected), undefined);
  assert.equal(verifyCashfreePayment({
    ...payment,
    payment_status: 'PENDING',
    is_captured: false,
  }, expected)?.status, 'PENDING');
  assert.equal(verifyCashfreePayment({ ...payment, order_amount: 12.501 }, expected), undefined);
});

test('migration persists attempt-level idempotency and limits the processor RPC to service role', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261103100000_add_cashfree_service_payment_persistence.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CONSTRAINT cashfree_payment_attempts_provider_payment_id_key UNIQUE \(provider_payment_id\)/i);
  assert.match(migration, /ON CONFLICT \(provider_payment_id\) DO UPDATE/i);
  assert.match(migration, /FOR UPDATE/i);
  assert.match(migration, /confirm_service_order_payment\(/i);
  assert.match(migration, /payment_status = 'SUCCESS' THEN 'SUCCESS'/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.process_cashfree_webhook_event/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.process_cashfree_webhook_event[\s\S]*?TO service_role/i);
});

test('webhook fingerprint remains an exact-body deduplication hint, not payment-attempt identity', () => {
  const first = Buffer.from('{"x":1,"y":2}');
  const reordered = Buffer.from('{"y":2,"x":1}');
  assert.equal(cashfreeWebhookFingerprint(first), cashfreeWebhookFingerprint(Buffer.from(first)));
  assert.notEqual(cashfreeWebhookFingerprint(first), cashfreeWebhookFingerprint(reordered));
});

test('Cashfree mode resolution selects separate APIs and fails closed on mixed or invalid deployment configuration', () => {
  const sandbox = resolveCashfreeEnvironment({
    VERCEL_ENV: 'preview',
    CASHFREE_MODE: 'sandbox',
    CASHFREE_SANDBOX_CLIENT_ID: 'sandbox-id',
    CASHFREE_SANDBOX_CLIENT_SECRET: 'sandbox-secret',
    CASHFREE_SANDBOX_ENABLED: 'false',
  });
  assert.equal(sandbox?.mode, 'sandbox');
  assert.equal(sandbox?.apiBaseUrl, 'https://sandbox.cashfree.com/pg');
  assert.equal(sandbox?.enabled, false);

  const production = resolveCashfreeEnvironment({
    VERCEL_ENV: 'production',
    CASHFREE_MODE: 'production',
    CASHFREE_PRODUCTION_CLIENT_ID: 'production-id',
    CASHFREE_PRODUCTION_CLIENT_SECRET: 'production-secret',
    CASHFREE_PRODUCTION_ENABLED: 'false',
    CASHFREE_SANDBOX_ENABLED: 'false',
    CASHFREE_SANDBOX_PROVIDER_CONFIGURED: 'false',
    CASHFREE_SANDBOX_WEBHOOK_CONFIGURED: 'false',
  });
  assert.equal(production?.mode, 'production');
  assert.equal(production?.apiBaseUrl, 'https://api.cashfree.com/pg');
  assert.equal(production?.enabled, false);
  assert.equal(production?.clientId, 'production-id');
  assert.equal(production?.clientSecret, 'production-secret');

  assert.equal(resolveCashfreeEnvironment({
    VERCEL_ENV: 'production',
    CASHFREE_MODE: 'production',
    CASHFREE_SANDBOX_CLIENT_SECRET: 'sandbox-secret',
  }), undefined);
  assert.equal(resolveCashfreeEnvironment({
    VERCEL_ENV: 'production',
    CASHFREE_MODE: 'sandbox',
    CASHFREE_SANDBOX_CLIENT_SECRET: 'sandbox-secret',
  }), undefined);
  assert.equal(resolveCashfreeEnvironment({
    VERCEL_ENV: 'preview',
    CASHFREE_MODE: 'production',
    CASHFREE_PRODUCTION_CLIENT_SECRET: 'production-secret',
  }), undefined);
  assert.equal(resolveCashfreeEnvironment({
    VERCEL_ENV: 'production',
    CASHFREE_MODE: 'invalid',
  }), undefined);
  assert.equal(resolveCashfreeEnvironment({
    VERCEL_ENV: 'production',
  }), undefined);
});

test('environment-scoped webhook fingerprints do not deduplicate across modes', () => {
  assert.notEqual(
    cashfreeEnvironmentWebhookFingerprint('sandbox', rawBody),
    cashfreeEnvironmentWebhookFingerprint('production', rawBody),
  );
});
