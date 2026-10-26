import type { SiteContent } from './siteContent';

const allowedInternalRoutes = new Set([
  '/', '/services', '/catalogue', '/work', '/about', '/blog', '/contact',
  '/get-started', '/privacy-policy', '/terms-and-conditions',
]);

export function isSafePublicDestination(value: string): boolean {
  const destination = value.trim();
  if (!destination || /[\u0000-\u001f\\]/.test(destination)) return false;
  if (destination.startsWith('#')) return /^#[a-zA-Z0-9_-]+$/.test(destination);
  if (destination.startsWith('/')) {
    if (destination.startsWith('//')) return false;
    try {
      const url = new URL(destination, 'https://public.neargrow.invalid');
      if (url.origin !== 'https://public.neargrow.invalid') return false;
      return allowedInternalRoutes.has(url.pathname) ||
        /^\/services\/[a-z0-9-]+$/.test(url.pathname) ||
        /^\/catalogue\/[a-z0-9-]+$/.test(url.pathname) ||
        /^\/blog\/[a-z0-9-]+$/.test(url.pathname);
    } catch {
      return false;
    }
  }
  if (/^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(destination)) return true;
  if (/^tel:\+?[0-9(). -]{5,30}$/i.test(destination)) return true;
  try {
    const url = new URL(destination);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getCtaDestination(content: SiteContent, id: string, fallback: string): string {
  const configured = content.ctaDestinations?.[id];
  return configured && isSafePublicDestination(configured) ? configured : fallback;
}

export function followPublicDestination(destination: string, onNavigate: (path: string) => void): void {
  if (!isSafePublicDestination(destination)) return;
  if (destination.startsWith('#')) {
    document.getElementById(destination.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  } else if (destination.startsWith('/')) {
    onNavigate(destination);
  } else {
    window.location.assign(destination);
  }
}
