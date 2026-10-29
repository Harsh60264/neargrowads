export const CANONICAL_PRODUCTION_ORIGIN = 'https://www.neargrowads.com';

export function isProductionDeployment(
  vercelEnvironment = process.env.VERCEL_ENV,
  nodeEnvironment = process.env.NODE_ENV,
): boolean {
  return vercelEnvironment === 'production' ||
    (nodeEnvironment === 'production' && vercelEnvironment !== 'preview');
}

export function resolveSiteOrigin(configuredSiteUrl: string | undefined, production: boolean): string {
  if (!configuredSiteUrl) throw new Error('SITE_URL must be configured with the canonical HTTPS origin.');

  let parsed: URL;
  try {
    parsed = new URL(configuredSiteUrl);
  } catch {
    throw new Error('SITE_URL must be a valid absolute URL.');
  }

  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && parsed.hostname === 'localhost')) ||
    parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('SITE_URL must be an HTTPS origin without a path, query or fragment (HTTP localhost is allowed outside production).');
  }

  if (production && parsed.origin !== CANONICAL_PRODUCTION_ORIGIN) {
    throw new Error(`Production SITE_URL must be exactly ${CANONICAL_PRODUCTION_ORIGIN}.`);
  }

  return parsed.origin;
}
