import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LOCALDROP_PURCHASE_TERMS_VERSION,
  LOCALDROP_WILDCARD_AMOUNT_PAISE,
  LOCALDROP_WILDCARD_PACKAGE_CODE,
  LOCALDROP_WILDCARD_QUANTITY,
  buildLocalDropBusinessOrderEmail,
  sendLocalDropBusinessOrderConfirmation,
  prepareLocalDropBusinessPurchase,
} from './localDropBusinessOrders.ts';

const validPurchase = {
  fullName: 'Ada Lovelace',
  businessName: 'Analytical Engines',
  email: 'ADA@example.com',
  mobileNumber: '+91 98765 43210',
  businessAddress: '12 Main Road, Noida, India',
  preferredPromotionAreas: 'Sector 5, Sector 6',
  additionalNote: 'Call before delivery.',
  consent: true,
};

test('prepares the fixed WildCard package and normalizes business purchase data', () => {
  const purchase = prepareLocalDropBusinessPurchase({
    ...validPurchase,
    quantity: 1,
    amountPaise: 1,
    priceInr: 0.01,
  });

  assert.ok(purchase);
  assert.equal(purchase.orderInput.customerEmail, 'ada@example.com');
  assert.deepEqual(purchase.lineItems.map(({ packageCode, quantity, lineSubtotalInr }) => ({
    packageCode, quantity, lineSubtotalInr,
  })), [{
    packageCode: LOCALDROP_WILDCARD_PACKAGE_CODE,
    quantity: LOCALDROP_WILDCARD_QUANTITY,
    lineSubtotalInr: LOCALDROP_WILDCARD_AMOUNT_PAISE / 100,
  }]);
  assert.equal(purchase.amountPaise, LOCALDROP_WILDCARD_AMOUNT_PAISE);
  assert.equal(purchase.termsVersion, LOCALDROP_PURCHASE_TERMS_VERSION);
  assert.deepEqual(purchase.orderInput.packages, []);
});

test('rejects missing required fields, invalid consent, and overlong optional fields', () => {
  for (const invalid of [
    { ...validPurchase, consent: false },
    { ...validPurchase, fullName: '' },
    { ...validPurchase, businessName: '' },
    { ...validPurchase, email: 'not-an-email' },
    { ...validPurchase, mobileNumber: 'bad' },
    { ...validPurchase, businessAddress: '  ' },
    { ...validPurchase, preferredPromotionAreas: 'x'.repeat(501) },
    { ...validPurchase, additionalNote: 'x'.repeat(2001) },
  ]) {
    assert.equal(prepareLocalDropBusinessPurchase(invalid), undefined);
  }
});

test('accepts fresh consented GPS evidence and rejects invalid or stale location data', () => {
  const now = Date.parse('2026-11-27T18:00:00.000Z');
  const location = {
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 12,
    capturedAt: '2026-11-27T17:59:30.000Z',
    consent: true,
  };
  const purchase = prepareLocalDropBusinessPurchase({ ...validPurchase, location }, now);
  assert.equal(purchase?.location?.latitude, location.latitude);

  assert.equal(prepareLocalDropBusinessPurchase({
    ...validPurchase,
    location: { ...location, consent: false },
  }, now), undefined);
  assert.equal(prepareLocalDropBusinessPurchase({
    ...validPurchase,
    location: { ...location, capturedAt: '2026-10-01T00:00:00.000Z' },
  }, now), undefined);
  assert.equal(prepareLocalDropBusinessPurchase({
    ...validPurchase,
    location: { ...location, accuracyMeters: 50_001 },
  }, now), undefined);
});

test('business-order migration is additive and restricts public and unauthenticated access', () => {
  const migration = readFileSync(
    new URL('../supabase/migrations/20261206120000_localdrop_wildcard_business_orders.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.wildcard_business_orders/);
  assert.match(migration, /REFERENCES public\.service_orders\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /fulfillment_status text NOT NULL DEFAULT 'pending'/);
  assert.match(migration, /ALTER TABLE public\.wildcard_business_orders ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.wildcard_business_orders FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /(?:DROP\s+TABLE|TRUNCATE|ALTER\s+SYSTEM|CREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY)/i);
  assert.match(migration, /Only verified Production payments can enter fulfillment/);
  assert.match(migration, /admin_update_localdrop_business_order_fulfillment/);
});

test('purchase confirmation email escapes customer content and uses a stable provider idempotency key', async () => {
  const email = buildLocalDropBusinessOrderEmail({
    orderReference: 'NGO-ABCDEF0123456789ABCDEF01',
    customerName: '<Ada>',
    customerEmail: 'ada@example.com',
    businessName: 'A & B',
  });
  assert.match(email.html, /&lt;Ada&gt;/);
  assert.match(email.html, /A &amp; B/);
  assert.match(email.text, /A & B/);

  let captured: { url: string; init?: RequestInit } | undefined;
  await sendLocalDropBusinessOrderConfirmation({
    orderReference: 'NGO-ABCDEF0123456789ABCDEF01',
    customerName: 'Ada',
    customerEmail: 'ada@example.com',
    businessName: 'Analytical Engines',
  }, 'test-api-key', 'NearGrow Ads <orders@neargrowads.com>', async (input, init) => {
    captured = { url: String(input), init };
    return new Response('{}', { status: 200 });
  });
  assert.equal(captured?.url, 'https://api.resend.com/emails');
  const headers = new Headers(captured?.init?.headers);
  assert.equal(headers.get('Idempotency-Key'), 'localdrop-business-order-NGO-ABCDEF0123456789ABCDEF01');
});
