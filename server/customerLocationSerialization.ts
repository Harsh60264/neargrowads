import type { CustomerLocation } from '../src/data/customerLocation';

function storedNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readCustomerLocation(row: Record<string, unknown>): CustomerLocation | undefined {
  const latitude = storedNumber(row.customer_location_latitude);
  const longitude = storedNumber(row.customer_location_longitude);
  const accuracyMeters = storedNumber(row.customer_location_accuracy_meters);
  const capturedAt = row.customer_location_captured_at;
  if (row.customer_location_consent !== true ||
    latitude === undefined || latitude < -90 || latitude > 90 ||
    longitude === undefined || longitude < -180 || longitude > 180 ||
    accuracyMeters === undefined || accuracyMeters <= 0 ||
    typeof capturedAt !== 'string' || Number.isNaN(Date.parse(capturedAt))) return undefined;

  const locality = typeof row.customer_location_locality === 'string'
    ? row.customer_location_locality.trim()
    : '';
  return {
    latitude,
    longitude,
    accuracyMeters,
    capturedAt,
    consent: true,
    ...(locality && locality.length <= 160 ? { locality } : {}),
  };
}

export function withCustomerLocation(row: Record<string, unknown>): Record<string, unknown> {
  const { customer_location_latitude: _latitude, customer_location_longitude: _longitude,
    customer_location_accuracy_meters: _accuracy, customer_location_locality: _locality,
    customer_location_captured_at: _capturedAt, customer_location_consent: _consent, ...safeRow } = row;
  const location = readCustomerLocation(row);
  return location ? { ...safeRow, location } : safeRow;
}
