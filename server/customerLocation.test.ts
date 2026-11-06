import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const serverSource = readFileSync(resolve(root, 'server.ts'), 'utf8');
const migration = readFileSync(resolve(root, 'supabase/migrations/20261106120000_add_optional_customer_location.sql'), 'utf8');

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
  assert.match(cashfreeSource, /service_orders\?id=eq\.\$\{encodeURIComponent\(intent\.serviceOrderId\)\}/);
});
