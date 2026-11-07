import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fromSupabaseServiceEnquiry } from './serviceEnquirySerialization';

const serverSource = readFileSync(resolve(import.meta.dirname, '..', 'server.ts'), 'utf8');

const storedEnquiry = {
  id: 'opaque-enquiry-id',
  request_reference: 'NGQ-EXAMPLE',
  customer_name: 'Example Customer',
  customer_email: 'customer@example.com',
  customer_phone: '+911234567890',
  customer_business_name: 'Example Business',
  service_interest: 'Search advertising',
  selected_packages: [],
  request_note: '',
  status: 'received',
  created_at: '2026-11-06T08:30:00.000Z',
  customer_location_latitude: '28.6139',
  customer_location_longitude: '77.209',
  customer_location_accuracy_meters: '125000',
  customer_location_locality: 'x'.repeat(161),
  customer_location_captured_at: '2026-11-06T08:30:00.000Z',
  customer_location_consent: true,
};

test('Admin enquiry response includes a consented stored location with valid coordinates', () => {
  const enquiry = fromSupabaseServiceEnquiry(storedEnquiry);

  assert.deepEqual(enquiry.location, {
    latitude: 28.6139,
    longitude: 77.209,
    accuracyMeters: 125000,
    capturedAt: '2026-11-06T08:30:00.000Z',
    consent: true,
  });
  assert.equal(enquiry.id, 'opaque-enquiry-id');
  assert.equal('customer_location_consent' in enquiry, false);
});

test('Admin enquiry response omits location unless consent is true and coordinates are valid', () => {
  const withoutConsent = fromSupabaseServiceEnquiry({
    ...storedEnquiry,
    customer_location_consent: false,
  });
  const invalidCoordinates = fromSupabaseServiceEnquiry({
    ...storedEnquiry,
    customer_location_latitude: 91,
  });

  assert.equal('location' in withoutConsent, false);
  assert.equal('location' in invalidCoordinates, false);
});

test('Admin enquiry SELECT explicitly requests location columns and route remains protected', () => {
  const adminEnquiries = serverSource.slice(
    serverSource.indexOf("app.get('/api/admin/service-enquiries'"),
    serverSource.indexOf("app.", serverSource.indexOf("app.get('/api/admin/service-enquiries'") + 5),
  );

  assert.match(serverSource, /service_enquiry_requests\?select=[^']*customer_location_latitude[^']*customer_location_longitude[^']*customer_location_accuracy_meters[^']*customer_location_locality[^']*customer_location_captured_at[^']*customer_location_consent/);
  assert.match(adminEnquiries, /if \(!requireAdmin\(req, res\)\) return/);
  assert.match(adminEnquiries, /readServiceEnquiries\(\)/);
});
