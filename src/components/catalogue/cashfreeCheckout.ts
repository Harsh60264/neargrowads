export interface CashfreeCartItem {
  packageId: string;
  quantity: number;
}

import type { CustomerLocation } from '../../data/customerLocation';

export interface CashfreeCustomer {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerBusinessName: string;
  onboardingNotes: string;
  location?: CustomerLocation;
}

export interface CashfreeCheckoutSnapshot extends CashfreeCustomer {
  packages: CashfreeCartItem[];
}

export interface CashfreeReturnRecord {
  clientIdempotencyKey: string;
  snapshotFingerprint: string;
  orderReference?: string;
  packages: CashfreeCartItem[];
}

export interface CashfreeTrackedOrder {
  order_reference: string;
  provider: 'cashfree';
  currency: 'INR';
  provider_mode?: 'test' | 'live';
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  cashfree_attempt_status?: 'SUCCESS' | 'NOT_ATTEMPTED' | 'FAILED' | 'USER_DROPPED' | 'VOID' | 'CANCELLED' | 'PENDING' | null;
  fulfillment_status?: string;
  [key: string]: unknown;
}

export type CashfreeCheckoutMode = 'sandbox' | 'production';

export interface CatalogueCheckoutOption {
  provider: 'razorpay' | 'cashfree' | undefined;
  available: boolean;
  label: string;
}

export function catalogueCheckoutOption(options: {
  razorpayAvailable: boolean;
  cashfreeAvailable: boolean;
  cashfreeMode: CashfreeCheckoutMode | null;
  availabilityChecked: boolean;
}): CatalogueCheckoutOption {
  if (options.razorpayAvailable) {
    return { provider: 'razorpay', available: true, label: 'Buy Now · Razorpay Test Checkout' };
  }
  if (options.cashfreeAvailable && options.cashfreeMode) {
    const mode = options.cashfreeMode === 'production' ? 'Production' : 'Sandbox';
    return { provider: 'cashfree', available: true, label: `Buy Now · Cashfree ${mode} Checkout` };
  }
  return {
    provider: undefined,
    available: false,
    label: options.availabilityChecked
      ? 'Online payment currently unavailable'
      : 'Checking secure payment availability…',
  };
}

export type CashfreeCustomerPaymentStatus = 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded';

export const CASHFREE_RETURN_STORAGE_KEY = 'neargrow-cashfree-checkout-attempts';
export const CASHFREE_PRODUCTION_RETURN_STORAGE_KEY = 'neargrow-cashfree-production-checkout-attempts';

function returnStorageKey(mode: CashfreeCheckoutMode): string {
  return mode === 'production' ? CASHFREE_PRODUCTION_RETURN_STORAGE_KEY : CASHFREE_RETURN_STORAGE_KEY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function cashfreeSnapshotFingerprint(
  snapshot: CashfreeCheckoutSnapshot,
  cryptoSource: Pick<Crypto, 'subtle'> = globalThis.crypto,
): Promise<string> {
  const canonicalSnapshot = JSON.stringify({
    customerName: snapshot.customerName.trim(),
    customerEmail: snapshot.customerEmail.trim().toLowerCase(),
    customerPhone: snapshot.customerPhone.trim(),
    customerBusinessName: snapshot.customerBusinessName.trim(),
    onboardingNotes: snapshot.onboardingNotes.trim(),
    location: snapshot.location,
    packages: [...snapshot.packages]
      .map(({ packageId, quantity }) => ({ packageId, quantity }))
  });
  const digest = await cryptoSource.subtle.digest('SHA-256', new TextEncoder().encode(canonicalSnapshot));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createCashfreeIdempotencyKey(cryptoSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  const bytes = cryptoSource.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function isCashfreeSandboxAvailable(value: unknown): boolean {
  return isCashfreeAvailable(value, 'sandbox');
}

export function isCashfreeAvailable(
  value: unknown,
  expectedMode?: CashfreeCheckoutMode,
): boolean {
  return isRecord(value) &&
    value.available === true &&
    value.provider === 'cashfree' &&
    (value.mode === 'sandbox' || value.mode === 'production') &&
    (!expectedMode || value.mode === expectedMode) &&
    value.migrationReady === true &&
    value.realPaymentsEnabled === (value.mode === 'production');
}

export function cashfreeAvailabilityMode(value: unknown): CashfreeCheckoutMode | undefined {
  if (!isRecord(value) || value.provider !== 'cashfree' ||
    (value.mode !== 'sandbox' && value.mode !== 'production') ||
    value.realPaymentsEnabled !== (value.available === true && value.mode === 'production')) return undefined;
  return value.mode === 'sandbox' || value.mode === 'production' ? value.mode : undefined;
}

function isCartItem(value: unknown): value is CashfreeCartItem {
  if (!isRecord(value)) return false;
  return typeof value.packageId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.packageId) &&
    Number.isInteger(value.quantity) &&
    Number(value.quantity) >= 1 &&
    Number(value.quantity) <= 50;
}

export function readCashfreeReturnRecords(
  storage: Pick<Storage, 'getItem'>,
  mode: CashfreeCheckoutMode = 'sandbox',
): CashfreeReturnRecord[] {
  const raw = storage.getItem(returnStorageKey(mode));
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Stored checkout recovery data is invalid. Do not start another payment attempt.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Stored checkout recovery data is invalid. Do not start another payment attempt.');
  }
  const records: CashfreeReturnRecord[] = [];
  for (const record of parsed) {
    if (!isRecord(record) ||
      typeof record.clientIdempotencyKey !== 'string' ||
      !/^[A-Za-z0-9_-]{32,100}$/.test(record.clientIdempotencyKey) ||
      typeof record.snapshotFingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/.test(record.snapshotFingerprint) ||
      !Array.isArray(record.packages) ||
      record.packages.length < 1 ||
      record.packages.length > 12 ||
      !record.packages.every(isCartItem) ||
      new Set(record.packages.map((item) => item.packageId)).size !== record.packages.length ||
      (record.orderReference !== undefined &&
        (typeof record.orderReference !== 'string' || !/^NGO-[A-F0-9]{24}$/.test(record.orderReference)))) {
      throw new Error('Stored checkout recovery data is invalid. Do not start another payment attempt.');
    }
    records.push({
      clientIdempotencyKey: record.clientIdempotencyKey,
      snapshotFingerprint: record.snapshotFingerprint,
      ...(typeof record.orderReference === 'string' ? { orderReference: record.orderReference } : {}),
      packages: record.packages,
    });
  }
  return records;
}

export function writeCashfreeReturnRecord(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  record: CashfreeReturnRecord,
  mode: CashfreeCheckoutMode = 'sandbox',
): void {
  const records = readCashfreeReturnRecords(storage, mode);
  storage.setItem(returnStorageKey(mode), JSON.stringify([
    ...records.filter((item) => item.clientIdempotencyKey !== record.clientIdempotencyKey),
    record,
  ]));
}

export function removeCashfreeReturnRecord(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  orderReference: string,
  mode: CashfreeCheckoutMode = 'sandbox',
): void {
  const records = readCashfreeReturnRecords(storage, mode)
    .filter((record) => record.orderReference !== orderReference);
  storage.setItem(returnStorageKey(mode), JSON.stringify(records));
}

export function isVerifiedCashfreeSuccess(
  order: unknown,
  expectedReference: string,
  expectedMode?: CashfreeCheckoutMode,
): order is CashfreeTrackedOrder {
  return isRecord(order) &&
    order.order_reference === expectedReference &&
    order.provider === 'cashfree' &&
    order.currency === 'INR' &&
    order.payment_status === 'paid' &&
    (!expectedMode || order.provider_mode === (expectedMode === 'production' ? 'live' : 'test'));
}

export function cashfreeCustomerPaymentStatus(order: CashfreeTrackedOrder): CashfreeCustomerPaymentStatus {
  if (order.payment_status !== 'pending') return order.payment_status;
  if (order.cashfree_attempt_status === 'FAILED') return 'failed';
  if (order.cashfree_attempt_status === 'CANCELLED' ||
    order.cashfree_attempt_status === 'USER_DROPPED' ||
    order.cashfree_attempt_status === 'VOID') return 'cancelled';
  return 'pending';
}

export async function fetchCashfreeOrderStatus(
  orderReference: string,
  trackingToken: string,
  fetcher: typeof fetch = globalThis.fetch,
  expectedMode?: CashfreeCheckoutMode,
): Promise<CashfreeTrackedOrder> {
  const response = await fetcher(`/api/catalogue/orders/${encodeURIComponent(orderReference)}/track`, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ trackingToken }),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok || !isRecord(body) || !isRecord(body.order)) {
    const message = isRecord(body) && typeof body.message === 'string'
      ? body.message
      : 'Order status could not be loaded.';
    throw new Error(message);
  }
  const order = body.order;
  const paymentStatus = (['pending', 'paid', 'failed', 'refunded'] as const)
    .find((status) => status === order.payment_status);
  const attemptStatus = order.cashfree_attempt_status;
  const parsedAttemptStatus = (['SUCCESS', 'NOT_ATTEMPTED', 'FAILED', 'USER_DROPPED', 'VOID', 'CANCELLED', 'PENDING'] as const)
    .find((status) => status === attemptStatus);
  const validAttemptStatus = attemptStatus === undefined || attemptStatus === null || parsedAttemptStatus !== undefined;
  if (order.order_reference !== orderReference || order.provider !== 'cashfree' ||
    order.currency !== 'INR' ||
    (expectedMode && order.provider_mode !== (expectedMode === 'production' ? 'live' : 'test')) ||
    (order.provider_mode !== undefined && order.provider_mode !== 'test' && order.provider_mode !== 'live') ||
    !paymentStatus || !validAttemptStatus) {
    throw new Error('The server returned an invalid Cashfree order status.');
  }
  return {
    order_reference: orderReference,
    provider: 'cashfree',
    currency: 'INR',
    ...(order.provider_mode === 'test' || order.provider_mode === 'live' ? { provider_mode: order.provider_mode } : {}),
    payment_status: paymentStatus,
    ...(attemptStatus === undefined ? {} : { cashfree_attempt_status: parsedAttemptStatus ?? null }),
    ...(typeof order.fulfillment_status === 'string' ? { fulfillment_status: order.fulfillment_status } : {}),
  };
}

export async function getOrCreateCashfreeAttempt(
  snapshot: CashfreeCheckoutSnapshot,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  cryptoSource: Crypto = globalThis.crypto,
  mode: CashfreeCheckoutMode = 'sandbox',
): Promise<CashfreeReturnRecord> {
  const snapshotFingerprint = await cashfreeSnapshotFingerprint(snapshot, cryptoSource);
  const existing = readCashfreeReturnRecords(storage, mode)
    .find((record) => record.snapshotFingerprint === snapshotFingerprint);
  const record: CashfreeReturnRecord = {
    clientIdempotencyKey: existing?.clientIdempotencyKey || createCashfreeIdempotencyKey(cryptoSource),
    snapshotFingerprint,
    ...(existing?.orderReference ? { orderReference: existing.orderReference } : {}),
    packages: snapshot.packages.map(({ packageId, quantity }) => ({ packageId, quantity })),
  };
  writeCashfreeReturnRecord(storage, record, mode);
  return record;
}
