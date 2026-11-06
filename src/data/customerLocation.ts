export interface CustomerLocation {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  consent: true;
  locality?: string;
}

export function validateCustomerLocation(value: unknown): CustomerLocation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const latitude = input.latitude;
  const longitude = input.longitude;
  const accuracyMeters = input.accuracyMeters;
  const capturedAt = input.capturedAt;
  const locality = input.locality;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0 || accuracyMeters > 100_000 ||
    input.consent !== true || typeof capturedAt !== 'string' || Number.isNaN(Date.parse(capturedAt)) ||
    capturedAt.length > 64 || (locality !== undefined && (typeof locality !== 'string' || locality.length > 160))) {
    return undefined;
  }
  return {
    latitude,
    longitude,
    accuracyMeters,
    capturedAt,
    consent: true,
    ...(typeof locality === 'string' && locality.trim() ? { locality: locality.trim() } : {}),
  };
}
