export interface PartnerRegistrationInput {
  email: string;
  password: string;
  mobileNumber: string;
  fullName: string;
}

export interface PartnerRegistrationValidation {
  valid: boolean;
  email?: string;
  password?: string;
  mobileNumber?: string;
  fullName?: string;
  message?: string;
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
  if (!email) return { valid: false, message: 'Enter a valid email address.' };
  if (!fullName) return { valid: false, message: 'Enter your full name.' };
  if (!mobileNumber) return { valid: false, message: 'Enter a valid mobile number.' };
  if (!partnerPasswordIsStrong(password)) {
    return { valid: false, message: 'Use 12 or more characters with at least three character types.' };
  }
  return { valid: true, email, password, mobileNumber, fullName };
}
