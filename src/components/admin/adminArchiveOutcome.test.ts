import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ADMIN_ARCHIVE_PARTIAL_SUCCESS_MESSAGE,
  getAdminArchiveOutcome,
} from './adminArchiveOutcome';

test('confirmed archive and Auth revocation are reported as complete success', () => {
  assert.deepEqual(getAdminArchiveOutcome({
    status: 'success',
    cmsAccess: 'removed',
    authSessionRevocation: 'confirmed',
    message: 'Administrator archived and sessions revoked.',
  }), {
    message: 'Administrator archived and sessions revoked.',
    warning: false,
  });
});

test('successful CMS archive with unconfirmed Auth revocation is reported as partial success', () => {
  assert.deepEqual(getAdminArchiveOutcome({
    status: 'partial_success',
    cmsAccess: 'removed',
    authSessionRevocation: 'not_confirmed',
    message: ADMIN_ARCHIVE_PARTIAL_SUCCESS_MESSAGE,
  }), {
    message: ADMIN_ARCHIVE_PARTIAL_SUCCESS_MESSAGE,
    warning: true,
  });
});

test('failed or inconsistent archive results are not reported as success', () => {
  assert.throws(() => getAdminArchiveOutcome({
    status: 'failure',
    cmsAccess: 'unchanged',
    authSessionRevocation: 'not_attempted',
    message: 'The administrator record could not be archived.',
  }), /The administrator record could not be archived/);

  assert.throws(() => getAdminArchiveOutcome({
    status: 'success',
    cmsAccess: 'removed',
    authSessionRevocation: 'not_confirmed',
    message: 'Incorrect success claim.',
  }), /archive result could not be confirmed/);

  const source = readFileSync(new URL('./AdminSettings.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(!response\.ok\) \{\s*throw new SettingsApiError/);
  assert.match(source, /catch \(reason\) \{\s*setError\(reason instanceof Error \? reason\.message/);
  assert.match(source, /await loadData\(\);/);
  assert.match(source, /noticeIsWarning \? 'border-amber-300\/30 bg-amber-950\/25 text-amber-100'/);
  assert.match(source, /const archiveUser = async[\s\S]*?getAdminArchiveOutcome\(result\)/);
  const serverSource = readFileSync(new URL('../../../server.ts', import.meta.url), 'utf8');
  const archiveStart = serverSource.indexOf("app.post('/api/admin/users/:id/archive'");
  const archiveEnd = serverSource.indexOf("app.post('/api/admin/users/:id/password'", archiveStart);
  const archiveRoute = serverSource.slice(archiveStart, archiveEnd);
  assert.match(archiveRoute, /result\.status !== 'archived' && result\.status !== 'already_archived'[\s\S]*?status\(409\)/);
  assert.match(archiveRoute, /catch \(error\)[\s\S]*?status\(503\)\.json/);
});
