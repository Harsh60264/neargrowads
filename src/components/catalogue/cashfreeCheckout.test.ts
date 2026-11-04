import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CASHFREE_RETURN_STORAGE_KEY,
  CASHFREE_PRODUCTION_RETURN_STORAGE_KEY,
  cashfreeAvailabilityMode,
  cashfreeCustomerPaymentStatus,
  fetchCashfreeOrderStatus,
  getOrCreateCashfreeAttempt,
  isCashfreeSandboxAvailable,
  isCashfreeAvailable,
  isVerifiedCashfreeSuccess,
  readCashfreeReturnRecords,
  removeCashfreeReturnRecord,
  type CashfreeCheckoutSnapshot,
} from './cashfreeCheckout.ts';

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const firstPackageId = '123e4567-e89b-42d3-a456-426614174000';
const secondPackageId = '123e4567-e89b-42d3-a456-426614174001';
const orderReference = 'NGO-0123456789ABCDEF01234567';

function snapshot(packages = [{ packageId: firstPackageId, quantity: 2 }]): CashfreeCheckoutSnapshot {
  return {
    customerName: 'Ada Lovelace',
    customerEmail: 'ADA@example.com',
    customerPhone: '+91 98765 43210',
    customerBusinessName: 'Analytical Engines',
    onboardingNotes: 'Launch campaign',
    packages,
  };
}

function trackedOrder(paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded' = 'paid') {
  return {
    order_reference: orderReference,
    provider: 'cashfree',
    currency: 'INR',
    payment_status: paymentStatus,
    fulfillment_status: 'pending',
  };
}

test('Cashfree checkout stays disabled unless sandbox and migration readiness are explicitly confirmed', () => {
  const ready = { available: true, provider: 'cashfree', mode: 'sandbox', migrationReady: true, realPaymentsEnabled: false };
  assert.equal(isCashfreeSandboxAvailable(ready), true);
  assert.equal(isCashfreeSandboxAvailable({ ...ready, available: false }), false);
  assert.equal(isCashfreeSandboxAvailable({ ...ready, provider: 'razorpay' }), false);
  assert.equal(isCashfreeSandboxAvailable({ ...ready, mode: 'live' }), false);
  assert.equal(isCashfreeSandboxAvailable({ ...ready, migrationReady: false }), false);
  assert.equal(isCashfreeSandboxAvailable({ ...ready, realPaymentsEnabled: true }), false);
  assert.equal(isCashfreeSandboxAvailable(null), false);
  const live = {
    available: true,
    provider: 'cashfree',
    mode: 'production',
    migrationReady: true,
    realPaymentsEnabled: true,
  };
  assert.equal(isCashfreeAvailable(live), true);
  assert.equal(isCashfreeAvailable(live, 'sandbox'), false);
  assert.equal(cashfreeAvailabilityMode({ ...live, available: false, realPaymentsEnabled: false }), 'production');
  assert.equal(cashfreeAvailabilityMode({ ...live, available: false }), undefined);
  assert.equal(isCashfreeAvailable({ ...live, realPaymentsEnabled: false }), false);
});

test('Sandbox and Production recovery keys are isolated and cannot reuse the other mode session', async () => {
  const storage = new MemoryStorage();
  const sandbox = await getOrCreateCashfreeAttempt(snapshot(), storage);
  const production = await getOrCreateCashfreeAttempt(snapshot(), storage, globalThis.crypto, 'production');
  assert.equal(readCashfreeReturnRecords(storage, 'sandbox')[0]?.clientIdempotencyKey, sandbox.clientIdempotencyKey);
  assert.equal(readCashfreeReturnRecords(storage, 'production')[0]?.clientIdempotencyKey, production.clientIdempotencyKey);
  assert.notEqual(sandbox.clientIdempotencyKey, production.clientIdempotencyKey);
  assert.ok(storage.getItem(CASHFREE_RETURN_STORAGE_KEY));
  assert.ok(storage.getItem(CASHFREE_PRODUCTION_RETURN_STORAGE_KEY));
});

test('one idempotency key is stored before checkout and reused for identical retry snapshots', async () => {
  const storage = new MemoryStorage();
  const firstAttempt = await getOrCreateCashfreeAttempt(snapshot(), storage);
  const retryAttempt = await getOrCreateCashfreeAttempt(snapshot(), storage);

  assert.match(firstAttempt.clientIdempotencyKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(retryAttempt.clientIdempotencyKey, firstAttempt.clientIdempotencyKey);
  assert.equal(retryAttempt.snapshotFingerprint, firstAttempt.snapshotFingerprint);
  assert.equal(storage.getItem(CASHFREE_RETURN_STORAGE_KEY)?.includes('ADA@example.com'), false);
  assert.equal(readCashfreeReturnRecords(storage).length, 1);
});

test('changed cart or customer snapshot starts a separate checkout intent without replacing an earlier retry key', async () => {
  const storage = new MemoryStorage();
  const firstAttempt = await getOrCreateCashfreeAttempt(snapshot(), storage);
  const changedAttempt = await getOrCreateCashfreeAttempt(snapshot([
    { packageId: firstPackageId, quantity: 1 },
    { packageId: secondPackageId, quantity: 1 },
  ]), storage);
  const firstRetry = await getOrCreateCashfreeAttempt(snapshot(), storage);

  assert.notEqual(changedAttempt.clientIdempotencyKey, firstAttempt.clientIdempotencyKey);
  assert.equal(firstRetry.clientIdempotencyKey, firstAttempt.clientIdempotencyKey);
  assert.equal(readCashfreeReturnRecords(storage).length, 2);
});

test('corrupt recovery data blocks a new key rather than risking duplicate provider orders', async () => {
  const storage = new MemoryStorage();
  storage.setItem(CASHFREE_RETURN_STORAGE_KEY, '{broken');
  await assert.rejects(getOrCreateCashfreeAttempt(snapshot(), storage), /Do not start another payment attempt/);
});

test('Cashfree return records retain the cart and retry key until the server confirms payment', async () => {
  const storage = new MemoryStorage();
  const attempt = await getOrCreateCashfreeAttempt(snapshot(), storage);
  const record = { ...attempt, orderReference };
  storage.setItem(CASHFREE_RETURN_STORAGE_KEY, JSON.stringify([record]));

  const pending = await fetchCashfreeOrderStatus(orderReference, attempt.clientIdempotencyKey, async (_input, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(JSON.parse(String(init?.body)).trackingToken, attempt.clientIdempotencyKey);
    return new Response(JSON.stringify({ order: trackedOrder('pending') }), { status: 200 });
  });
  assert.equal(isVerifiedCashfreeSuccess(pending, orderReference), false);
  assert.equal(readCashfreeReturnRecords(storage)[0]?.packages[0]?.packageId, firstPackageId);

  for (const paymentStatus of ['failed', 'refunded'] as const) {
    const nonSuccessful = await fetchCashfreeOrderStatus(orderReference, attempt.clientIdempotencyKey, async () =>
      new Response(JSON.stringify({ order: trackedOrder(paymentStatus) }), { status: 200 }));
    assert.equal(isVerifiedCashfreeSuccess(nonSuccessful, orderReference), false);
    assert.equal(readCashfreeReturnRecords(storage).length, 1, `${paymentStatus} status must preserve recovery details`);
  }

  for (const attemptStatus of ['CANCELLED', 'USER_DROPPED', 'VOID'] as const) {
    const cancelled = await fetchCashfreeOrderStatus(orderReference, attempt.clientIdempotencyKey, async () =>
      new Response(JSON.stringify({
        order: { ...trackedOrder('pending'), cashfree_attempt_status: attemptStatus },
      }), { status: 200 }));
    assert.equal(cashfreeCustomerPaymentStatus(cancelled), 'cancelled');
    assert.equal(isVerifiedCashfreeSuccess(cancelled, orderReference), false);
    assert.equal(readCashfreeReturnRecords(storage).length, 1, 'cancelled attempts must preserve the cart and retry key');
  }

  const paid = await fetchCashfreeOrderStatus(orderReference, attempt.clientIdempotencyKey, async () =>
    new Response(JSON.stringify({ order: trackedOrder('paid') }), { status: 200 }));
  assert.equal(isVerifiedCashfreeSuccess(paid, orderReference), true);
  removeCashfreeReturnRecord(storage, orderReference);
  assert.equal(readCashfreeReturnRecords(storage).length, 0);
});

test('payment return rejects forged provider, currency, reference and status data', async (t) => {
  for (const [name, patch] of [
    ['provider', { provider: 'razorpay' }],
    ['currency', { currency: 'USD' }],
    ['reference', { order_reference: 'NGO-FFFFFFFFFFFFFFFFFFFFFFFF' }],
    ['payment state', { payment_status: 'paid_by_browser' }],
    ['attempt state', { cashfree_attempt_status: 'paid_by_browser' }],
  ] as const) {
    await t.test(name, async () => {
      await assert.rejects(
        fetchCashfreeOrderStatus(orderReference, 'tracking-token', async () =>
          new Response(JSON.stringify({ order: { ...trackedOrder(), ...patch } }), { status: 200 })),
        /invalid Cashfree order status/,
      );
    });

  }
  assert.equal(isVerifiedCashfreeSuccess(trackedOrder('pending'), orderReference), false);
});

test('Production payment verification rejects Sandbox-mode order status', async () => {
  await assert.rejects(
    fetchCashfreeOrderStatus(orderReference, 'tracking-token', async () =>
      new Response(JSON.stringify({
        order: { ...trackedOrder(), provider_mode: 'test' },
      }), { status: 200 }), 'production'),
    /invalid Cashfree order status/,
  );
  const liveOrder = await fetchCashfreeOrderStatus(orderReference, 'tracking-token', async () =>
    new Response(JSON.stringify({
      order: { ...trackedOrder(), provider_mode: 'live' },
    }), { status: 200 }), 'production');
  assert.equal(isVerifiedCashfreeSuccess(liveOrder, orderReference, 'production'), true);
});

test('order status network errors remain retryable and do not infer payment success', async () => {
  await assert.rejects(
    fetchCashfreeOrderStatus(orderReference, 'tracking-token', async () => {
      throw new Error('network timeout');
    }),
    /network timeout/,
  );
  assert.equal(isVerifiedCashfreeSuccess({ ...trackedOrder(), payment_status: 'paid' }, 'NGO-FFFFFFFFFFFFFFFFFFFFFFFF'), false);
});
