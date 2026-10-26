import assert from 'node:assert/strict';
import test from 'node:test';
import { blogSeoAdminPermission } from './blogSeoPermissions';

test('maps SEO results to blog view permission and scan persistence to blog edit permission', () => {
  assert.deepEqual(blogSeoAdminPermission('/blogs/seo-health', 'GET'), {
    section: 'blogs',
    action: 'view',
  });
  assert.deepEqual(blogSeoAdminPermission('/blogs/seo-health/scan', 'POST'), {
    section: 'blogs',
    action: 'edit',
  });
});

test('does not grant blog permissions to unsupported SEO routes or methods', () => {
  assert.equal(blogSeoAdminPermission('/blogs/seo-health', 'POST'), undefined);
  assert.equal(blogSeoAdminPermission('/blogs/seo-health/scan', 'GET'), undefined);
  assert.equal(blogSeoAdminPermission('/blogs/seo-health/other', 'GET'), undefined);
});
