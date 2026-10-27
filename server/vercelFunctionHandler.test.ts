import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreOriginalApiUrl } from './vercelFunctionHandler';

test('restores nested API path and preserves the original query string', () => {
  const req = {
    url: '/api/handler?__vercel_original_api_path=%2Fapi%2Fadmin%2Fsession&filter=published&tag=one&tag=two',
  };

  assert.equal(restoreOriginalApiUrl(req), true);
  assert.equal(req.url, '/api/admin/session?filter=published&tag=one&tag=two');
});

test('does not dispatch requests without an internal API path marker', () => {
  const req = { url: '/api/handler?filter=published' };

  assert.equal(restoreOriginalApiUrl(req), false);
  assert.equal(req.url, '/api/handler?filter=published');
});

test('rejects internal paths outside the API namespace', () => {
  const req = {
    url: '/api/handler?__vercel_original_api_path=%2Fadmin',
  };

  assert.equal(restoreOriginalApiUrl(req), false);
  assert.equal(req.url, '/api/handler?__vercel_original_api_path=%2Fadmin');
});
