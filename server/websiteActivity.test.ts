import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWebsiteVisitorId,
  normalizeWebsiteActivityPath,
  websiteDeviceFromUserAgent,
  WebsiteActivityRateLimiter,
} from './websiteActivity';

test('validates opaque browser identifiers without accepting arbitrary input', () => {
  assert.equal(isWebsiteVisitorId('8e03978e-40d5-43e8-bc93-6894a57f9324'), true);
  assert.equal(isWebsiteVisitorId('not-a-uuid'), false);
  assert.equal(isWebsiteVisitorId('8e03978e-40d5-43e8-bc93-6894a57f9324?x=1'), false);
});

test('normalizes public routes and removes query strings, fragments, and unsafe path data', () => {
  assert.equal(normalizeWebsiteActivityPath('/blog/Example-Post/?email=private#details'), '/blog/example-post');
  assert.equal(normalizeWebsiteActivityPath('/services'), '/services');
  assert.equal(normalizeWebsiteActivityPath('/admin'), undefined);
  assert.equal(normalizeWebsiteActivityPath('/admin/security-monitoring'), undefined);
  assert.equal(normalizeWebsiteActivityPath('/blog/private%40example.com'), '/other');
  assert.equal(normalizeWebsiteActivityPath('/reset/secret-token'), '/other');
  assert.equal(normalizeWebsiteActivityPath('/'), '/');
  assert.equal(normalizeWebsiteActivityPath(`/${'a'.repeat(600)}`), undefined);
});

test('classifies only coarse device classes without storing user-agent detail', () => {
  assert.equal(websiteDeviceFromUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'tablet');
  assert.equal(websiteDeviceFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'), 'mobile');
  assert.equal(websiteDeviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'desktop');
});

test('rate-limits requests per key and permits traffic again after the window', () => {
  const limiter = new WebsiteActivityRateLimiter();
  const options = { maxRequests: 2, windowMs: 60_000 };
  assert.equal(limiter.allow('visitor', 1_000, options), true);
  assert.equal(limiter.allow('visitor', 2_000, options), true);
  assert.equal(limiter.allow('visitor', 3_000, options), false);
  assert.equal(limiter.allow('visitor', 61_001, options), true);
});

test('caps rate-limit key storage and reclaims expired keys', () => {
  const limiter = new WebsiteActivityRateLimiter();
  const options = { maxRequests: 1, windowMs: 1_000 };
  for (let index = 0; index < 5000; index += 1) {
    assert.equal(limiter.allow(`key-${index}`, 1_000, options), true);
  }
  assert.equal(limiter.allow('overflow', 1_500, options), false);
  assert.equal(limiter.allow('after-expiry', 2_001, options), true);
});
