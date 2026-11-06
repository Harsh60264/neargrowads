import { validateCustomerLocation, type CustomerLocation } from '../src/data/customerLocation';

export function readCustomerLocation(row: Record<string, unknown>): CustomerLocation | undefined {
  return validateCustomerLocation({
    latitude: typeof row.customer_location_latitude === 'string' ? Number(row.customer_location_latitude) : row.customer_location_latitude,
    longitude: typeof row.customer_location_longitude === 'string' ? Number(row.customer_location_longitude) : row.customer_location_longitude,
    accuracyMeters: typeof row.customer_location_accuracy_meters === 'string' ? Number(row.customer_location_accuracy_meters) : row.customer_location_accuracy_meters,
    capturedAt: row.customer_location_captured_at,
    locality: row.customer_location_locality,
    consent: row.customer_location_consent,
  });
}

export function withCustomerLocation(row: Record<string, unknown>): Record<string, unknown> {
  const { customer_location_latitude: _latitude, customer_location_longitude: _longitude,
    customer_location_accuracy_meters: _accuracy, customer_location_locality: _locality,
    customer_location_captured_at: _capturedAt, customer_location_consent: _consent, ...safeRow } = row;
  const location = readCustomerLocation(row);
  return location ? { ...safeRow, location } : safeRow;
}
