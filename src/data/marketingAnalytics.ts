export type MarketingAnalyticsConsent = 'accepted' | 'rejected' | null;

export const MARKETING_ANALYTICS_CONSENT_KEY = 'neargrow-analytics-consent-v1';
export const MARKETING_ANALYTICS_CONSENT_COOKIE = 'neargrow_analytics_consent';
export const GTM_NOSCRIPT_URL = 'https://www.googletagmanager.com/ns.html?id=GTM-P6G98T5X';

const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const PUBLIC_STATIC_PATHS = new Set([
  '/',
  '/services',
  '/catalogue',
  '/work',
  '/about',
  '/blog',
  '/contact',
  '/get-started',
  '/partners/localdrop',
  '/privacy-policy',
  '/terms-and-conditions',
  '/thank-you',
]);

export function getPublicMarketingPagePath(pathname: string): string | undefined {
  if (!pathname.startsWith('/') || pathname.includes('?') || pathname.includes('#')) return undefined;
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (PUBLIC_STATIC_PATHS.has(normalizedPath)) return normalizedPath;
  if (/^\/(?:services|blog)\/[a-z0-9-]+$/.test(normalizedPath)) return normalizedPath;
  return undefined;
}

export function getGtmNoscriptRedirectLocation(
  cookieHeader: string | undefined,
  referrer: string | undefined,
  requestOrigin: string,
): string | undefined {
  const consentCookie = `${MARKETING_ANALYTICS_CONSENT_COOKIE}=accepted`;
  if (!referrer || !cookieHeader?.split(';').some((part) => part.trim() === consentCookie)) return undefined;

  let referrerUrl: URL;
  try {
    referrerUrl = new URL(referrer);
  } catch {
    return undefined;
  }
  if (referrerUrl.origin !== requestOrigin || referrerUrl.search ||
    !getPublicMarketingPagePath(referrerUrl.pathname)) return undefined;
  return GTM_NOSCRIPT_URL;
}

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  return document.cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length);
}

export function readMarketingAnalyticsConsent(): MarketingAnalyticsConsent {
  try {
    const saved = window.localStorage.getItem(MARKETING_ANALYTICS_CONSENT_KEY);
    if (saved === 'accepted' || saved === 'rejected') return saved;
  } catch {
    // The consent cookie is also available when browser storage is disabled.
  }
  const cookie = readCookie(MARKETING_ANALYTICS_CONSENT_COOKIE);
  return cookie === 'accepted' || cookie === 'rejected' ? cookie : null;
}

export function saveMarketingAnalyticsConsent(consent: Exclude<MarketingAnalyticsConsent, null>): void {
  try {
    window.localStorage.setItem(MARKETING_ANALYTICS_CONSENT_KEY, consent);
  } catch {
    // Keep the first-party cookie as the persistence fallback.
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${MARKETING_ANALYTICS_CONSENT_COOKIE}=${consent}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
}

export function updateGoogleConsent(consent: MarketingAnalyticsConsent): void {
  if (typeof window.gtag !== 'function') return;
  const granted = consent === 'accepted';
  window.gtag('consent', 'update', {
    analytics_storage: granted ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    neargrowLoadTagManager?: () => void;
  }
}
