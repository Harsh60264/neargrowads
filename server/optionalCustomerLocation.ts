import type { CustomerLocation } from '../src/data/customerLocation';

export function withOptionalCustomerLocation<T extends Record<string, unknown>>(
  payload: T,
  location: CustomerLocation | undefined,
): T {
  if (!location) return payload;
  return {
    ...payload,
    customer_location_latitude: location.latitude,
    customer_location_longitude: location.longitude,
    customer_location_accuracy_meters: location.accuracyMeters,
    customer_location_locality: location.locality ?? null,
    customer_location_captured_at: location.capturedAt,
    customer_location_consent: true,
  };
}
