import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { decideAdminInvitationCompletion, type AdminInvitationIdentity } from './adminInvitation';
import { readAdminAuthCallback } from '../src/components/admin/adminAuthCallback';

const pendingIdentity: AdminInvitationIdentity = {
  id: '2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62',
  email: 'admin@example.com',
  role: 'super_admin',
  status: 'pending',
  isPrimaryOwner: false,
};
const verifiedAuthUser = {
  id: pendingIdentity.id,
  email: pendingIdentity.email,
  email_confirmed_at: '2026-10-28T12:00:00.000Z',
};

test('allows a verified pending invitation, including a non-primary Co-Owner', () => {
  assert.equal(decideAdminInvitationCompletion(pendingIdentity, verifiedAuthUser), 'complete');
  assert.equal(decideAdminInvitationCompletion({
    ...pendingIdentity,
    role: 'owner',
  }, verifiedAuthUser), 'complete');
});

test('rejects missing verification, mismatched identities, and Primary Owner activation', () => {
  assert.equal(decideAdminInvitationCompletion(pendingIdentity, {
    ...verifiedAuthUser,
    email_confirmed_at: undefined,
  }), 'reject');
  assert.equal(decideAdminInvitationCompletion(pendingIdentity, {
    ...verifiedAuthUser,
    id: 'f46dd026-fc56-4865-b4c7-f213f2c5076b',
  }), 'reject');
  assert.equal(decideAdminInvitationCompletion(pendingIdentity, {
    ...verifiedAuthUser,
    email: 'other@example.com',
  }), 'reject');
  assert.equal(decideAdminInvitationCompletion({
    ...pendingIdentity,
    role: 'owner',
    isPrimaryOwner: true,
  }, verifiedAuthUser), 'reject');
});

test('rejects an expired Supabase verification callback before setup can be submitted', () => {
  const callback = readAdminAuthCallback(
    '?error=access_denied&error_code=otp_expired',
    '',
    { length: 0, key: () => null, getItem: () => null },
  );
  assert.equal(callback.accessToken, undefined);
  assert.match(callback.error || '', /missing, invalid, or expired/i);
});

test('rejects cancelled or disabled invitations and only permits repeat completion after acceptance audit', () => {
  assert.equal(decideAdminInvitationCompletion({
    ...pendingIdentity,
    status: 'disabled',
  }, verifiedAuthUser), 'reject');
  assert.equal(decideAdminInvitationCompletion({
    ...pendingIdentity,
    status: 'active',
  }, verifiedAuthUser), 'reject');
  assert.equal(decideAdminInvitationCompletion({
    ...pendingIdentity,
    status: 'active',
  }, verifiedAuthUser, true), 'already_accepted');
});

test('completion rejects null and blank inputs, wrong email, and cancelled invitations', () => {
  const completionSql = readFileSync(new URL('../supabase/migrations/20261028160000_complete_admin_invitation_atomically.sql', import.meta.url), 'utf8');

  assert.match(completionSql, /if p_user_id is null[\s\S]*?or not found/i);
  assert.match(completionSql, /or p_email is null[\s\S]*?or btrim\(p_email\) = ''/i);
  assert.match(completionSql, /or p_must_change_password is null/i);
  assert.match(completionSql, /target_row\.email is distinct from lower\(p_email\)/i);
  assert.match(completionSql, /target_row\.status is distinct from 'pending'/i);

  assert.equal(decideAdminInvitationCompletion(pendingIdentity, {
    ...verifiedAuthUser,
    email: 'other@example.com',
  }), 'reject');
  assert.equal(decideAdminInvitationCompletion({
    ...pendingIdentity,
    status: 'disabled',
  }, verifiedAuthUser), 'reject');
});

test('completion and cancellation lock the same admin row and atomically audit their state change', () => {
  const completionSql = readFileSync(new URL('../supabase/migrations/20261028160000_complete_admin_invitation_atomically.sql', import.meta.url), 'utf8');
  const cancellationSql = readFileSync(new URL('../supabase/migrations/20261028130000_atomic_admin_invitation_cancellation.sql', import.meta.url), 'utf8');

  assert.match(completionSql, /from public\.admin_users[\s\S]*?where id = p_user_id[\s\S]*?for update/i);
  assert.match(completionSql, /target_row\.status is distinct from 'pending'/i);
  assert.match(completionSql, /update public\.admin_users[\s\S]*?insert into public\.admin_audit_logs/i);
  assert.match(completionSql, /target_row\.is_primary_owner/i);
  assert.match(completionSql, /set search_path = pg_catalog, public/i);
  assert.match(completionSql, /revoke all on function public\.complete_admin_invitation\(uuid, text, boolean\) from public, anon, authenticated/i);
  assert.match(completionSql, /grant execute on function public\.complete_admin_invitation\(uuid, text, boolean\) to service_role/i);
  assert.match(cancellationSql, /from public\.admin_users[\s\S]*?where id = p_target_id[\s\S]*?for update/i);
  assert.match(cancellationSql, /set status = 'disabled'/i);
});

test('pending password recovery uses the same atomic invitation completion RPC', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const pendingRecoveryStart = serverSource.indexOf('if (identity.status === \'pending\') {', serverSource.indexOf("app.post('/api/admin/auth/complete'"));
  const pendingRecoveryEnd = serverSource.indexOf('} else {', pendingRecoveryStart);
  const pendingRecoveryBranch = serverSource.slice(pendingRecoveryStart, pendingRecoveryEnd);

  assert.notEqual(pendingRecoveryStart, -1);
  assert.match(pendingRecoveryBranch, /rest\/v1\/rpc\/complete_admin_invitation/);
  assert.match(pendingRecoveryBranch, /p_user_id: identity\.id/);
  assert.match(pendingRecoveryBranch, /p_email: identity\.email/);
  assert.match(pendingRecoveryBranch, /p_must_change_password: false/);
  assert.match(pendingRecoveryBranch, /completion\.status !== 'accepted'/);
});
