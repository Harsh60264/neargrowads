import assert from 'node:assert/strict';
import test from 'node:test';
import { getVercelInitializationDiagnostic, restoreOriginalApiUrl } from './vercelFunctionHandler';

test('reports Preview configuration variable names without leaking error messages', () => {
  const diagnostic = getVercelInitializationDiagnostic(
    Object.assign(new Error('contains a secret value'), {
      name: 'PreviewConfigurationError',
      configurationVariable: 'SUPABASE_SERVICE_ROLE_KEY',
    }),
  );

  assert.deepEqual(diagnostic, {
    errorName: 'PreviewConfigurationError',
    errorCategory: 'preview_configuration',
    configurationVariable: 'SUPABASE_SERVICE_ROLE_KEY',
  });
  assert.equal(JSON.stringify(diagnostic).includes('secret'), false);
});

test('categorizes unknown initialization failures without logging their messages', () => {
  const diagnostic = getVercelInitializationDiagnostic(new Error('contains a credential'));

  assert.deepEqual(diagnostic, {
    errorName: 'Error',
    errorCategory: 'application_initialization',
  });
  assert.equal(JSON.stringify(diagnostic).includes('credential'), false);
});

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
