import { normalizeIndianState } from '../shared/indianStates';
import type {
  PartnerLocation,
  PartnerLocationComponents,
  PartnerLocationSubmission,
} from '../shared/partnerLocation';

export interface PartnerRegistrationInput {
  email: string;
  password: string;
  mobileNumber: string;
  fullName: string;
  state: string;
  preferredDeliveryAreas: string[];
  registrationLocation?: PartnerLocationSubmission | null;
}

export interface PartnerRegistrationValidation {
  valid: boolean;
  email?: string;
  password?: string;
  mobileNumber?: string;
  fullName?: string;
  state?: string;
  preferredDeliveryAreas?: string[];
  registrationLocation?: PartnerLocationSubmission | null;
  message?: string;
}

const LOCATION_COMPONENT_KEYS = ['locality', 'city', 'district', 'state', 'postalCode', 'country'] as const;
const LOCATION_SOURCES = ['gps_reverse_geocoded', 'gps_manual', 'manual_no_gps'] as const;

function normalizeLocationComponents(value: unknown): PartnerLocationComponents | undefined | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const components: PartnerLocationComponents = {
    locality: null,
    city: null,
    district: null,
    state: null,
    postalCode: null,
    country: null,
  };
  for (const key of LOCATION_COMPONENT_KEYS) {
    const component = record[key];
    if (component === null) continue;
    if (typeof component !== 'string') return undefined;
    const normalized = component.trim().replace(/\s+/g, ' ');
    if (normalized.length > 120) return undefined;
    components[key] = normalized || null;
  }
  return components;
}

export function validatePartnerLocation(value: unknown): PartnerLocation | undefined | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const address = typeof input.address === 'string'
    ? input.address.trim().replace(/\s+/g, ' ')
    : '';
  const latitude = input.latitude;
  const longitude = input.longitude;
  const accuracyMeters = input.accuracyMeters;
  const capturedAt = input.capturedAt;
  const capturedAtMs = typeof capturedAt === 'string' ? Date.parse(capturedAt) : NaN;
  const source = LOCATION_SOURCES.find((candidate) => candidate === input.source);
  const components = normalizeLocationComponents(input.components);
  if (address.length < 3 || address.length > 500 ||
    (latitude !== null && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
    (longitude !== null && (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) ||
    (accuracyMeters !== null && (typeof accuracyMeters !== 'number' || !Number.isFinite(accuracyMeters) || accuracyMeters <= 0 || accuracyMeters > 50_000)) ||
    (capturedAt !== null && (typeof capturedAt !== 'string' || !Number.isFinite(capturedAtMs))) ||
    !source ||
    components === undefined) return undefined;

  const hasLatitude = typeof latitude === 'number';
  const hasLongitude = typeof longitude === 'number';
  const hasGps = hasLatitude && hasLongitude;
  if (hasLatitude !== hasLongitude) return undefined;
  if (source === 'manual_no_gps') {
    if (hasGps || accuracyMeters !== null || capturedAt !== null || components !== null) return undefined;
  } else if (!hasGps || typeof accuracyMeters !== 'number' || typeof capturedAt !== 'string' ||
    (source === 'gps_manual' && components !== null) ||
    (source === 'gps_reverse_geocoded' && components === null)) {
    return undefined;
  }
  const normalizedLatitude = typeof latitude === 'number' ? latitude : null;
  const normalizedLongitude = typeof longitude === 'number' ? longitude : null;
  return {
    address,
    latitude: normalizedLatitude,
    longitude: normalizedLongitude,
    accuracyMeters: typeof accuracyMeters === 'number' ? accuracyMeters : null,
    capturedAt: typeof capturedAt === 'string' ? new Date(capturedAtMs).toISOString() : null,
    source,
    components,
  };
}

export function normalizePartnerLocationSubmission(value: unknown): PartnerLocationSubmission | undefined | null {
  const location = validatePartnerLocation(value);
  if (location === undefined || location === null) return location;
  if (location.latitude !== null) {
    const capturedAtMs = Date.parse(location.capturedAt || '');
    if (capturedAtMs < Date.now() - 30 * 60_000 || capturedAtMs > Date.now() + 60_000) return undefined;
  }
  const input = value as Record<string, unknown>;
  const locationToken = input.locationToken;
  if (location.source === 'gps_reverse_geocoded') {
    if (typeof locationToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(locationToken)) return undefined;
    return { ...location, locationToken };
  }
  if (locationToken !== undefined && locationToken !== null && locationToken !== '') return undefined;
  return location;
}

export interface PartnerAuthSignupUser {
  id?: string;
  email?: string;
  email_confirmed_at?: string | null;
}

export function parsePartnerAuthSignupUser(value: unknown): PartnerAuthSignupUser | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const response = value as Record<string, unknown>;
  const user = response.user && typeof response.user === 'object' && !Array.isArray(response.user)
    ? response.user as Record<string, unknown>
    : response;
  const emailConfirmedAt = user.email_confirmed_at !== undefined
    ? user.email_confirmed_at
    : response.email_confirmed_at;
  return {
    id: typeof user.id === 'string' ? user.id : typeof response.id === 'string' ? response.id : undefined,
    email: typeof user.email === 'string' ? user.email : typeof response.email === 'string' ? response.email : undefined,
    email_confirmed_at: typeof emailConfirmedAt === 'string' || emailConfirmedAt === null
      ? emailConfirmedAt
      : undefined,
  };
}

export function normalizePartnerEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return undefined;
  return email;
}

export function normalizePartnerMobile(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length > 24) return undefined;
  const compact = trimmed.replace(/[\s()-]/g, '');
  const normalized = compact.startsWith('+') ? `+${compact.slice(1).replace(/\D/g, '')}` : compact.replace(/\D/g, '');
  const digits = normalized.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return undefined;
  return normalized;
}

export function normalizePartnerName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return undefined;
  return name;
}

export function partnerPasswordIsStrong(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 200) return false;
  const types = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
  ].filter(Boolean).length;
  return types >= 3;
}

export function normalizePreferredDeliveryAreas(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return [];
  const rawAreas: unknown[] | undefined = typeof value === 'string'
    ? value.split(/[,\n]/)
    : Array.isArray(value) ? value : undefined;
  if (!rawAreas || rawAreas.length > 2000 ||
    (typeof value === 'string' && value.length > 2000)) return undefined;

  const areas: string[] = [];
  const seen = new Set<string>();
  let totalCharacters = 0;
  for (const rawArea of rawAreas) {
    if (typeof rawArea !== 'string') return undefined;
    const area = rawArea.trim().replace(/\s+/g, ' ');
    if (!area) continue;
    if (area.length > 80) return undefined;
    totalCharacters += area.length;
    if (totalCharacters > 2000) return undefined;
    const key = area.toLocaleLowerCase('en-IN');
    if (!seen.has(key)) {
      seen.add(key);
      areas.push(area);
    }
  }
  return areas.length <= 2000 ? areas : undefined;
}

export function buildPartnerAuthRedirect(siteUrl: string, mode: 'signup' | 'recovery'): string {
  const url = new URL(
    mode === 'signup' ? '/partners/portal-preview' : '/partners/recovery',
    siteUrl,
  );
  url.searchParams.set('mode', mode);
  if (mode === 'signup') url.searchParams.set('confirmed', '1');
  return url.toString();
}

export function validatePartnerRegistration(value: unknown): PartnerRegistrationValidation {
  if (!value || typeof value !== 'object') {
    return { valid: false, message: 'Enter a valid partner registration.' };
  }
  const input = value as Record<string, unknown>;
  const email = normalizePartnerEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : undefined;
  const mobileNumber = normalizePartnerMobile(input.mobileNumber);
  const fullName = normalizePartnerName(input.fullName);
  const state = normalizeIndianState(input.state);
  const preferredDeliveryAreas = normalizePreferredDeliveryAreas(input.preferredDeliveryAreas);
  let registrationLocation: PartnerLocationSubmission | null | undefined;
  if (Object.hasOwn(input, 'registrationLocation')) {
    registrationLocation = normalizePartnerLocationSubmission(input.registrationLocation);
    if (registrationLocation === undefined) {
      return { valid: false, message: 'Check the optional registration location and try again.' };
    }
  }
  if (!email) return { valid: false, message: 'Enter a valid email address.' };
  if (!fullName) return { valid: false, message: 'Enter your full name.' };
  if (!mobileNumber) return { valid: false, message: 'Enter a valid mobile number.' };
  if (!state) return { valid: false, message: 'Select an Indian state or union territory.' };
  if (!preferredDeliveryAreas) return { valid: false, message: 'Check the preferred delivery areas and try again.' };
  if (!partnerPasswordIsStrong(password)) {
    return { valid: false, message: 'Use 12 or more characters with at least three character types.' };
  }
  return {
    valid: true,
    email,
    password,
    mobileNumber,
    fullName,
    state,
    preferredDeliveryAreas,
    ...(registrationLocation !== undefined ? { registrationLocation } : {}),
  };
}
