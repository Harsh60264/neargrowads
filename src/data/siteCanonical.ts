export const CANONICAL_PRODUCTION_ORIGIN = 'https://www.neargrowads.com';

const localDropCanonicalPaths = new Set([
  '/partners/localdrop',
  '/partners/portal-preview',
]);

export function resolveCanonicalPageOrigin(pathname: string, fallbackOrigin: string): string {
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  return localDropCanonicalPaths.has(normalizedPath)
    ? CANONICAL_PRODUCTION_ORIGIN
    : fallbackOrigin;
}
