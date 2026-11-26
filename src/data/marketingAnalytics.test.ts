import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GTM_NOSCRIPT_URL,
  getGtmNoscriptRedirectLocation,
  getPublicMarketingPagePath,
  MARKETING_ANALYTICS_CONSENT_COOKIE,
} from './marketingAnalytics';

test('allows public website routes and normalizes trailing slashes', () => {
  assert.equal(getPublicMarketingPagePath('/'), '/');
  assert.equal(getPublicMarketingPagePath('/about/'), '/about');
  assert.equal(getPublicMarketingPagePath('/services/google-ads'), '/services/google-ads');
  assert.equal(getPublicMarketingPagePath('/blog/growth-guide'), '/blog/growth-guide');
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
