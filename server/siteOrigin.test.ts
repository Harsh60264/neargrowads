import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CANONICAL_PRODUCTION_ORIGIN,
  isProductionDeployment,
  resolveSiteOrigin,
} from './siteOrigin';

test('production SITE_URL must use the canonical www origin', () => {
  assert.throws(() => resolveSiteOrigin(undefined, true), /SITE_URL/);
  assert.equal(resolveSiteOrigin(CANONICAL_PRODUCTION_ORIGIN, true), CANONICAL_PRODUCTION_ORIGIN);
  assert.equal(resolveSiteOrigin(`${CANONICAL_PRODUCTION_ORIGIN}/`, true), CANONICAL_PRODUCTION_ORIGIN);

  for (const invalidOrigin of [
    'not a URL',
    'http://localhost:3000',
    'https://localhost',
    'https://neargrowads.in',
    'https://neargrowads.com',
    'http://www.neargrowads.com',
    'https://neargrowads.com/admin',
    'https://www.neargrowads.com.evil.example',
    'https://user:password@www.neargrowads.com',
  ]) {
    assert.throws(() => resolveSiteOrigin(invalidOrigin, true), /SITE_URL|Production SITE_URL/, invalidOrigin);
  }
});

test('Preview and local site origins remain configurable', () => {
  assert.equal(resolveSiteOrigin('https://preview.example.test', false), 'https://preview.example.test');
  assert.equal(resolveSiteOrigin('http://localhost:3000', false), 'http://localhost:3000');
  assert.equal(resolveSiteOrigin('https://neargrowads.com', false), 'https://neargrowads.com');
});

test('production detection distinguishes Vercel Preview deployments', () => {
  assert.equal(isProductionDeployment('production', 'production'), true);
  assert.equal(isProductionDeployment('preview', 'production'), false);
  assert.equal(isProductionDeployment(undefined, 'production'), true);
  assert.equal(isProductionDeployment(undefined, 'development'), false);
});
