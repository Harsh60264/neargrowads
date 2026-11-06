import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { readCustomerLocation, withCustomerLocation } from './customerLocationSerialization';

const root = resolve(import.meta.dirname, '..');
const serverSource = readFileSync(resolve(root, 'server.ts'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20261106120000_add_optional_customer_location.sql'), 'utf8');

const persistedLocation = {
  customer_location_latitude: 28.6139,
  customer_location_longitude: 77.209,
  customer_location_accuracy_meters: 25,
  customer_location_locality: 'New Delhi',
  customer_location_captured_at: '2026-11-06T08:30:00.000Z',
  customer_location_consent: true,
};

test('persists location in protected order and enquiry records without public tracking exposure', () => {
  assert.match(serverSource, /customer_location_latitude/);
  assert.match(serverSource, /customer_location_consent/);
  assert.match(serverSource, /service_orders\?select=id,order_reference[\s\S]*customer_location_consent/);
  assert.match(serverSource, /service_orders\?select=id,order_reference,customer_name,customer_email,customer_phone/);
  assert.match(migration, /ALTER TABLE public\.service_orders/);
  assert.match(migration, /ALTER TABLE public\.service_enquiry_requests/);
  assert.match(migration, /ALTER TABLE public\.leads/);
});

test('does not place location in Cashfree provider request metadata', () => {
  const cashfreeSource = readFileSync(resolve(root, 'server/cashfreePaymentRoutes.ts'), 'utf8');
  assert.doesNotMatch(cashfreeSource, /notes:\s*\{[^}]*location/i);
  assert.match(cashfreeSource, /service_orders\?id=eq\.\$\{encodeURIComponent\(intent\.serviceOrderId\)\}&select=id/);
  assert.match(cashfreeSource, /Prefer: 'return=representation'/);
  assert.match(cashfreeSource, /updatedOrders\.length !== 1/);
});

test('consented database rows serialize location for protected admin responses', () => {
  const row = { id: 'opaque-order-id', ...persistedLocation };
  assert.deepEqual(readCustomerLocation(row), {
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 25,
    capturedAt: '2026-11-06T08:30:00.000Z',
    consent: true,
    locality: 'New Delhi',
  });
  assert.deepEqual(withCustomerLocation(row), {
    id: 'opaque-order-id',
    location: {
      latitude: 28.6139,
      longitude: 77.209,
      accuracyMeters: 25,
      capturedAt: '2026-11-06T08:30:00.000Z',
      consent: true,
      locality: 'New Delhi',
    },
  });
});

test('unconsented rows omit location from the admin response', () => {
  const row = { id: 'opaque-order-id', ...persistedLocation, customer_location_consent: false };
  assert.equal(readCustomerLocation(row), undefined);
  assert.deepEqual(withCustomerLocation(row), { id: 'opaque-order-id' });
});

test('enquiry submission persists the validated optional location and admin enquiry reads are protected', () => {
  const enquiryInsert = serverSource.slice(
    serverSource.indexOf('async function createServiceEnquiry'),
    serverSource.indexOf('async function readServiceEnquiries'),
  );
  const adminEnquiries = serverSource.slice(
    serverSource.indexOf("app.get('/api/admin/service-enquiries'"),
    serverSource.indexOf("app.", serverSource.indexOf("app.get('/api/admin/service-enquiries'") + 5),
  );
  assert.match(enquiryInsert, /withOptionalCustomerLocation\([\s\S]*input\.location/);
  assert.match(serverSource, /const location = input\.location === undefined \? undefined : validateCustomerLocation\(input\.location\)/);
  assert.match(adminEnquiries, /if \(!requireAdmin\(req, res\)\) return/);
  assert.match(adminEnquiries, /readServiceEnquiries\(\)/);
  assert.match(serverSource, /fromSupabaseServiceEnquiry/);
});
