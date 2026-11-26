export const CANONICAL_PRODUCTION_ORIGIN = 'https://www.neargrowads.com';

const canonicalProductionPaths = new Set([
  '/partners/localdrop',
  '/partners/portal-preview',
  '/gmb-audit',
]);

export function resolveCanonicalPageOrigin(pathname: string, fallbackOrigin: string): string {
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  return canonicalProductionPaths.has(normalizedPath)
    ? CANONICAL_PRODUCTION_ORIGIN
    : fallbackOrigin;
}
