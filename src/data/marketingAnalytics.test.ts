import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GTM_NOSCRIPT_URL,
  getGtmNoscriptRedirectLocation,
  getPublicMarketingPagePath,
  MARKETING_ANALYTICS_CONSENT_KEY,
  MARKETING_ANALYTICS_CONSENT_COOKIE,
  readMarketingAnalyticsConsent,
  saveMarketingAnalyticsConsent,
  updateGoogleConsent,
} from './marketingAnalytics';

function withBrowserMocks(run: (storage: Map<string, string>, consentEvents: unknown[][]) => void, storageUnavailable = false): void {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const storage = new Map<string, string>();
  const consentEvents: unknown[][] = [];
  let cookie = '';
  const cookieDocument = {
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      const nextCookie = value.split(';', 1)[0];
      const nextName = nextCookie.split('=', 1)[0];
      const remainingCookies = cookie.split(';').map((part) => part.trim())
        .filter((part) => part && part.split('=', 1)[0] !== nextName);
      cookie = [...remainingCookies, nextCookie].join('; ');
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem(key: string) {
          if (storageUnavailable) throw new Error('Storage unavailable');
          return storage.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          if (storageUnavailable) throw new Error('Storage unavailable');
          storage.set(key, value);
        },
      },
      location: { protocol: 'https:' },
      gtag: (...event: unknown[]) => consentEvents.push(event),
    },
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: cookieDocument });
  try {
    run(storage, consentEvents);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

test('allows public website routes and normalizes trailing slashes', () => {
  assert.equal(getPublicMarketingPagePath('/'), '/');
  assert.equal(getPublicMarketingPagePath('/about/'), '/about');
  assert.equal(getPublicMarketingPagePath('/services/google-ads'), '/services/google-ads');
  assert.equal(getPublicMarketingPagePath('/blog/growth-guide'), '/blog/growth-guide');
  assert.equal(getPublicMarketingPagePath('/gmb-audit'), '/gmb-audit');
});

test('excludes admin, partner-account, authentication, and unsupported routes', () => {
  for (const pathname of [
    '/admin',
    '/admin/accept-invite',
    '/partners/dashboard',
    '/partners/login',
    '/partners/register',
    '/partners/recovery',
    '/partners/portal-preview',
    '/partners/localdrop/private',
    '/unknown-route',
    '/blog/private%40example.com',
  ]) {
    assert.equal(getPublicMarketingPagePath(pathname), undefined, pathname);
  }
});

test('route events cannot include query strings or fragments', () => {
  assert.equal(getPublicMarketingPagePath('/contact?email=private@example.com'), undefined);
  assert.equal(getPublicMarketingPagePath('/contact#phone'), undefined);
});

test('no-script GTM fallback requires consent and a same-origin public referrer', () => {
  const cookie = `${MARKETING_ANALYTICS_CONSENT_COOKIE}=accepted`;
  const origin = 'https://www.neargrowads.com';
  assert.equal(getGtmNoscriptRedirectLocation(cookie, `${origin}/about`, origin), GTM_NOSCRIPT_URL);
  assert.equal(getGtmNoscriptRedirectLocation(undefined, `${origin}/about`, origin), undefined);
  assert.equal(getGtmNoscriptRedirectLocation(cookie, `${origin}/partners/dashboard`, origin), undefined);
  assert.equal(getGtmNoscriptRedirectLocation(cookie, `${origin}/contact?token=private`, origin), undefined);
  assert.equal(getGtmNoscriptRedirectLocation(cookie, 'https://attacker.example/about', origin), undefined);
});

test('persists accepted and rejected consent choices for future page loads', () => {
  withBrowserMocks((storage) => {
    assert.equal(readMarketingAnalyticsConsent(), null);
    saveMarketingAnalyticsConsent('accepted');
    assert.equal(storage.get(MARKETING_ANALYTICS_CONSENT_KEY), 'accepted');
    assert.equal(readMarketingAnalyticsConsent(), 'accepted');
    saveMarketingAnalyticsConsent('rejected');
    assert.equal(storage.get(MARKETING_ANALYTICS_CONSENT_KEY), 'rejected');
    assert.equal(readMarketingAnalyticsConsent(), 'rejected');
  });
});

test('uses the consent cookie when browser storage is unavailable', () => {
  withBrowserMocks(() => {
    saveMarketingAnalyticsConsent('rejected');
    assert.equal(readMarketingAnalyticsConsent(), 'rejected');
  }, true);
});

test('updates Google consent grants and withdraws with analytics only', () => {
  withBrowserMocks((_storage, consentEvents) => {
    updateGoogleConsent('accepted');
    updateGoogleConsent('rejected');
    assert.deepEqual(consentEvents, [
      ['consent', 'update', {
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      }],
      ['consent', 'update', {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      }],
    ]);
  });
});
