import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ADMIN_SECTION_ACTIONS,
  DEFAULT_SUPER_ADMIN_PERMISSIONS,
  validateAdminPermissions,
} from '../shared/adminPermissions';

test('permission matrix matches supported actions and includes Page Content publishing', () => {
  assert.deepEqual(ADMIN_SECTION_ACTIONS.content, ['view', 'edit', 'publish']);
  assert.deepEqual(ADMIN_SECTION_ACTIONS.dashboard, ['view']);
  assert.deepEqual(ADMIN_SECTION_ACTIONS.securityMonitoring, ['view', 'edit']);
});

test('server permission validation accepts supported Page Content publishing and rejects invented actions', () => {
  assert.deepEqual(validateAdminPermissions({ content: { view: true, publish: true } }), {
    content: { view: true, publish: true },
  });
  assert.equal(validateAdminPermissions({ dashboard: { view: true, publish: true } }), undefined);
  assert.equal(validateAdminPermissions({ unknownSection: { view: true } }), undefined);
  assert.equal(validateAdminPermissions({ content: { publish: true } }), undefined);
});

test('Super Admin defaults include normal content actions but exclude Security Monitoring', () => {
  assert.equal(DEFAULT_SUPER_ADMIN_PERMISSIONS.content?.publish, true);
  assert.equal(DEFAULT_SUPER_ADMIN_PERMISSIONS.caseStudies?.delete, true);
  assert.equal(DEFAULT_SUPER_ADMIN_PERMISSIONS.blogs?.publish, true);
  assert.equal(DEFAULT_SUPER_ADMIN_PERMISSIONS.securityMonitoring, undefined);
});

test('Page Content publishing is permission-gated and privileged routes remain protected', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const adminPage = readFileSync(new URL('../src/components/admin/AdminPage.tsx', import.meta.url), 'utf8');
  const permissionMapStart = server.indexOf('function requiredAdminPermission(');
  const permissionMapEnd = server.indexOf('async function writeAdminAudit(', permissionMapStart);
  const permissionMap = server.slice(permissionMapStart, permissionMapEnd);
  assert.match(permissionMap, /pathName === '\/site-content\/publish' && req\.method === 'POST'\) return \{ section: 'content', action: 'publish' \}/);
  assert.match(server, /function hasPermission\(identity: AdminIdentity[\s\S]*?if \(identity\.role === 'owner'\) return true;/);
  assert.match(adminPage, /user\.role === 'owner' \|\| user\.permissions\[key\]\?\.(?:view|\[action\])/);
  assert.match(server, /if \(req\.path === '\/security-monitoring\/rules' && !identity\.isPrimaryOwner\)/);
  assert.match(server, /app\.post\('\/api\/admin\/users\/:id\/permanent-delete'[\s\S]*?requireOwner\(req, res\)/);
  assert.match(server, /app\.put\('\/api\/admin\/payment-settings'[\s\S]*?requireOwner\(req, res\)/);
});
