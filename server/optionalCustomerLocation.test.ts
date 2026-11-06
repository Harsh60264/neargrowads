import assert from 'node:assert/strict';
import test from 'node:test';
import { withOptionalCustomerLocation } from './optionalCustomerLocation';

const base = { request_reference: 'NGQ-test' };
const location = {
  latitude: 28.6139,
  longitude: 77.209,
  accuracyMeters: 25,
  capturedAt: '2026-11-06T08:30:00.000Z',
  consent: true as const,
};

test('omits optional columns for legacy-schema submissions without location', () => {
  assert.deepEqual(withOptionalCustomerLocation(base, undefined), base);
});

test('includes every location field when consent is explicit', () => {
  assert.deepEqual(withOptionalCustomerLocation(base, location), {
    ...base,
    customer_location_latitude: 28.6139,
    customer_location_longitude: 77.209,
    customer_location_accuracy_meters: 25,
    customer_location_locality: null,
    customer_location_captured_at: '2026-11-06T08:30:00.000Z',
    customer_location_consent: true,
  });
});
