const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUPABASE_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
export const STAGING_SUPABASE_PROJECT_REF = 'kdaixomygsuxadofoieb';
const PRODUCTION_SUPABASE_PROJECT_REF = 'axbjzmdokfoftzfgwiql';

export interface AdminOwnerConfiguration {
  ownerId: string;
  ownerEmail: string;
}

export function resolveAdminOwnerConfiguration(environment: NodeJS.ProcessEnv): AdminOwnerConfiguration {
  const ownerId = environment.ADMIN_OWNER_USER_ID || '';
  if (!UUID_PATTERN.test(ownerId)) {
    throw new Error('ADMIN_OWNER_USER_ID must be the configured Owner account UUID.');
  }

  const ownerEmail = environment.ADMIN_OWNER_EMAIL || '';
  if (ownerEmail !== ownerEmail.trim() || ownerEmail !== ownerEmail.toLowerCase() ||
    ownerEmail.length > 254 || !EMAIL_PATTERN.test(ownerEmail)) {
    throw new Error('ADMIN_OWNER_EMAIL must be a valid lowercase email address.');
  }

  const stagingProjectRef = environment.ADMIN_STAGING_SUPABASE_PROJECT_REF || '';
  if (environment.VERCEL_ENV === 'preview') {
    if (!SUPABASE_PROJECT_REF_PATTERN.test(stagingProjectRef) ||
      stagingProjectRef !== STAGING_SUPABASE_PROJECT_REF) {
      throw new Error('ADMIN_STAGING_SUPABASE_PROJECT_REF must exactly match the verified staging project in Preview.');
    }

    let supabaseUrl: URL;
    try {
      supabaseUrl = new URL(environment.SUPABASE_URL || '');
    } catch {
      throw new Error('SUPABASE_URL must identify the verified staging Supabase project in Preview.');
    }
    if (supabaseUrl.protocol !== 'https:' ||
      supabaseUrl.hostname !== `${STAGING_SUPABASE_PROJECT_REF}.supabase.co` ||
      (supabaseUrl.pathname !== '/' && supabaseUrl.pathname !== '') ||
      supabaseUrl.search || supabaseUrl.hash || supabaseUrl.username || supabaseUrl.password) {
      throw new Error('SUPABASE_URL must exactly match the verified staging project.');
    }

    const stagingOwnerId = environment.ADMIN_STAGING_OWNER_USER_ID || '';
    const stagingOwnerEmail = environment.ADMIN_STAGING_OWNER_EMAIL || '';
    if (!UUID_PATTERN.test(stagingOwnerId) || stagingOwnerId !== ownerId) {
      throw new Error('ADMIN_OWNER_USER_ID must match the separate Preview-only ADMIN_STAGING_OWNER_USER_ID.');
    }
    if (!EMAIL_PATTERN.test(stagingOwnerEmail) ||
      stagingOwnerEmail !== stagingOwnerEmail.trim() ||
      stagingOwnerEmail !== stagingOwnerEmail.toLowerCase() ||
      stagingOwnerEmail !== ownerEmail) {
      throw new Error('ADMIN_OWNER_EMAIL must match the separate Preview-only ADMIN_STAGING_OWNER_EMAIL.');
    }
  } else if (stagingProjectRef) {
    throw new Error('ADMIN_STAGING_SUPABASE_PROJECT_REF may only be set for a Vercel Preview deployment.');
  }

  return { ownerId, ownerEmail };
}

function decodeSupabaseJwtClaims(key: string): Record<string, unknown> | undefined {
  const parts = key.split('.');
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof decoded === 'object' && decoded !== null
      ? decoded as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function validatePreviewKey(key: string, expectedRole: 'anon' | 'service_role', name: string): void {
  const claims = decodeSupabaseJwtClaims(key);
  if (!claims) return;

  if (claims.role !== expectedRole) {
    throw new Error(`${name} has an unexpected Supabase JWT role for Preview.`);
  }
  const claimRef = typeof claims.ref === 'string'
    ? claims.ref
    : typeof claims.iss === 'string'
      ? (() => {
        try {
          const issuer = new URL(claims.iss as string);
          return issuer.hostname.endsWith('.supabase.co')
            ? issuer.hostname.slice(0, -'.supabase.co'.length)
            : undefined;
        } catch {
          return undefined;
        }
      })()
      : undefined;

  if (claimRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    throw new Error(`${name} is bound to the Production Supabase project, not Preview staging.`);
  }
  if (claimRef !== STAGING_SUPABASE_PROJECT_REF) {
    throw new Error(`${name} does not contain a verifiable binding to the verified staging project.`);
  }
}

export function validatePreviewAdminConfiguration(environment: NodeJS.ProcessEnv): void {
  if (environment.VERCEL_ENV !== 'preview') return;

  resolveAdminOwnerConfiguration(environment);

  const bindings = [
    ['SUPABASE_ANON_KEY', 'ADMIN_STAGING_SUPABASE_ANON_KEY', 'anon'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY', 'service_role'],
  ] as const;
  for (const [keyName, stagingKeyName, role] of bindings) {
    const key = environment[keyName] || '';
    const stagingKey = environment[stagingKeyName] || '';
    if (!key || !stagingKey) {
      throw new Error(`${keyName} and its separate Preview-only ${stagingKeyName} binding are required.`);
    }
    if (key !== stagingKey) {
      throw new Error(`${keyName} must match its separate Preview-only ${stagingKeyName} binding.`);
    }
    validatePreviewKey(key, role, keyName);
  }

  const siteUrl = environment.SITE_URL || '';
  try {
    const parsedSiteUrl = new URL(siteUrl);
    if (parsedSiteUrl.protocol !== 'https:' || parsedSiteUrl.origin === 'https://www.neargrowads.com' ||
      parsedSiteUrl.username || parsedSiteUrl.password || parsedSiteUrl.pathname !== '/' ||
      parsedSiteUrl.search || parsedSiteUrl.hash) {
      throw new Error();
    }
  } catch {
    throw new Error('Preview SITE_URL must be a non-Production HTTPS origin.');
  }

  if (!environment.ADMIN_SESSION_SECRET || environment.ADMIN_SESSION_SECRET.length < 32) {
    throw new Error('Preview ADMIN_SESSION_SECRET must be at least 32 characters.');
  }
  if (!environment.ADMIN_STAGING_SESSION_SECRET ||
    environment.ADMIN_SESSION_SECRET !== environment.ADMIN_STAGING_SESSION_SECRET) {
    throw new Error('ADMIN_SESSION_SECRET must match a separate Preview-only ADMIN_STAGING_SESSION_SECRET value.');
  }
  if (environment.ADMIN_PRODUCTION_OWNER_USER_ID &&
    environment.ADMIN_PRODUCTION_OWNER_USER_ID === environment.ADMIN_OWNER_USER_ID) {
    throw new Error('Preview ADMIN_OWNER_USER_ID must not match ADMIN_PRODUCTION_OWNER_USER_ID.');
  }
  if (environment.ADMIN_PRODUCTION_OWNER_EMAIL &&
    environment.ADMIN_PRODUCTION_OWNER_EMAIL.toLowerCase() === environment.ADMIN_OWNER_EMAIL?.toLowerCase()) {
    throw new Error('Preview ADMIN_OWNER_EMAIL must not match ADMIN_PRODUCTION_OWNER_EMAIL.');
  }
}
