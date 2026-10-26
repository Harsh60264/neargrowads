export type WebsiteDevice = 'mobile' | 'desktop' | 'tablet';

const VISITOR_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PATH_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._~-]{0,79}$/;
const STATIC_PUBLIC_PATHS = new Set([
  '/',
  '/services',
  '/catalogue',
  '/about',
  '/work',
  '/blog',
  '/contact',
  '/get-started',
  '/privacy-policy',
  '/terms-and-conditions',
  '/thank-you',
]);

export function isWebsiteVisitorId(value: unknown): value is string {
  return typeof value === 'string' && VISITOR_ID_PATTERN.test(value);
}

export function normalizeWebsiteActivityPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) return undefined;
  const pathOnly = value.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
  if (!pathOnly.startsWith('/') || pathOnly === '/admin' || pathOnly.startsWith('/admin/')) return undefined;
  if (STATIC_PUBLIC_PATHS.has(pathOnly)) return pathOnly;

  const segments = pathOnly.slice(1).split('/');
  if (segments.length !== 2 || !['blog', 'services', 'catalogue'].includes(segments[0])) return '/other';
  if (!SAFE_PATH_SEGMENT.test(segments[1])) return '/other';
  return `/${segments[0]}/${segments[1].toLowerCase()}`;
}

export function websiteDeviceFromUserAgent(userAgent: string | undefined): WebsiteDevice {
  const value = userAgent || '';
  if (/ipad|tablet|playbook|silk/i.test(value) || (/android/i.test(value) && !/mobile/i.test(value))) {
    return 'tablet';
  }
  if (/mobile|iphone|ipod|android/i.test(value)) return 'mobile';
  return 'desktop';
}

export interface WebsiteActivityRateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

export class WebsiteActivityRateLimiter {
  private readonly requests = new Map<string, number[]>();

  allow(key: string, now: number, { maxRequests, windowMs }: WebsiteActivityRateLimitOptions): boolean {
    if (!this.requests.has(key) && this.requests.size >= 5000) {
      for (const [storedKey, timestamps] of this.requests) {
        if (!timestamps.some((timestamp) => now - timestamp < windowMs)) this.requests.delete(storedKey);
      }
      if (this.requests.size >= 5000) return false;
    }
    const recent = (this.requests.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maxRequests) {
      this.requests.set(key, recent);
      return false;
    }
    recent.push(now);
    this.requests.set(key, recent);
    return true;
  }
}
