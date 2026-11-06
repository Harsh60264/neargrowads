import { strict as assert } from 'node:assert';
import test from 'node:test';
import { validateCustomerLocation } from './customerLocation';

const valid = {
  latitude: 28.6139,
  longitude: 77.209,
  accuracyMeters: 25,
  capturedAt: '2026-11-06T08:30:00.000Z',
  consent: true,
};

test('accepts a consented coordinate within safe bounds', () => {
  assert.deepEqual(validateCustomerLocation(valid), valid);
});

test('rejects invalid coordinates, accuracy, timestamp or consent', () => {
  assert.equal(validateCustomerLocation({ ...valid, latitude: 91 }), undefined);
  assert.equal(validateCustomerLocation({ ...valid, accuracyMeters: 0 }), undefined);
  assert.equal(validateCustomerLocation({ ...valid, capturedAt: 'not-a-date' }), undefined);
  assert.equal(validateCustomerLocation({ ...valid, consent: false }), undefined);
});

test('accepts missing location for legacy submissions', () => {
  assert.equal(validateCustomerLocation(undefined), undefined);
});
