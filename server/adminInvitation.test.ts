import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildAdminInvitationRedirect,
  decideAdminInvitationCompletion,
  decideAdminInvitationRecovery,
  type AdminInvitationIdentity,
} from './adminInvitation';
import { clearAdminAuthCallbackVerifier, readAdminAuthCallback } from '../src/components/admin/adminAuthCallback';

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

test('recovers verified pending identities and disabled identities without changing a Co-Owner identity', () => {
  assert.equal(decideAdminInvitationRecovery(pendingIdentity, verifiedAuthUser), 'password_recovery');
  assert.equal(decideAdminInvitationRecovery({
    ...pendingIdentity,
    role: 'owner',
    status: 'disabled',
  }, verifiedAuthUser), 'password_recovery');
  assert.equal(decideAdminInvitationRecovery({
    ...pendingIdentity,
    status: 'disabled',
  }, { ...verifiedAuthUser, email_confirmed_at: undefined }), 'signup');
  assert.equal(decideAdminInvitationRecovery({
    ...pendingIdentity,
    role: 'owner',
    status: 'disabled',
    isPrimaryOwner: true,
  }, verifiedAuthUser), 'reject');
  assert.equal(decideAdminInvitationRecovery({
    ...pendingIdentity,
    status: 'active',
  }, verifiedAuthUser), 'reject');
});

test('invitation recovery redirects to the production onboarding route with a generation', () => {
  assert.equal(
    buildAdminInvitationRedirect('https://www.neargrowads.com', 'recovery', '2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62'),
    'https://www.neargrowads.com/admin/accept-invite?mode=recovery&invitation_generation=2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62',
  );
  assert.equal(
    buildAdminInvitationRedirect('https://www.neargrowads.com/', 'invite', '2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62', true),
    'https://www.neargrowads.com/admin/accept-invite?mode=invite&invitation_generation=2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62&setup=temporary',
  );
});

test('callback retains the current invitation generation and rejects expired callbacks', () => {
  const callback = readAdminAuthCallback(
    '?mode=recovery&invitation_generation=2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62&access_token=abcdefghijklmnopqrstuvwxyz123456',
    '',
    { length: 0, key: () => null, getItem: () => null },
  );
  assert.equal(callback.invitationGeneration, '2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62');
  assert.equal(readAdminAuthCallback(
    '?invitation_generation=not-a-uuid&access_token=abcdefghijklmnopqrstuvwxyz',
    '',
    { length: 0, key: () => null, getItem: () => null },
  ).invitationGeneration, undefined);
});

test('completion rejects null and blank inputs, wrong email, and cancelled invitations', () => {
  const completionSql = readFileSync(new URL('../supabase/migrations/20261028200000_secure_admin_invitation_recovery.sql', import.meta.url), 'utf8');

  assert.match(completionSql, /if p_user_id is null[\s\S]*?or not found/i);
  assert.match(completionSql, /or p_email is null[\s\S]*?or p_email ~ '\^\[\[:space:\]\]\*\$'/i);
  assert.match(completionSql, /or p_must_change_password is null/i);
  assert.match(completionSql, /or p_invitation_generation is null/i);
  assert.match(completionSql, /target_row\.email is distinct from lower\(btrim\(p_email\)\)/i);
  assert.match(completionSql, /target_row\.invitation_generation is distinct from p_invitation_generation/i);
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

test('pre-existing NULL-generation invitations require owner reissue before setup', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261028200000_secure_admin_invitation_recovery.sql', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const recoveryStart = serverSource.indexOf("app.post('/api/admin/users/:id/recovery'");
  const recoveryEnd = serverSource.indexOf("app.post('/api/admin/users/:id/cancel'", recoveryStart);
  const recoveryRoute = serverSource.slice(recoveryStart, recoveryEnd);
  const completionRouteStart = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const completionRouteEnd = serverSource.indexOf("app.get('/api/admin/users'", completionRouteStart);
  const completionRoute = serverSource.slice(completionRouteStart, completionRouteEnd);
  const migrationColumnSetup = migration.slice(0, migration.indexOf('drop function'));

  assert.match(migration, /add column if not exists invitation_generation uuid;/i);
  assert.doesNotMatch(migrationColumnSetup, /update public\.admin_users[\s\S]*?invitation_generation\s*=/i);
  assert.match(migration, /target_row\.status is distinct from 'pending' and target_row\.status is distinct from 'disabled'/i);
  assert.match(recoveryRoute, /p_invitation_generation: invitationGeneration/);
  assert.match(recoveryRoute, /buildAdminInvitationRedirect\([\s\S]*?'recovery',\s*invitationGeneration/);
  assert.match(completionRoute, /mode === 'invite' \|\| identity\.status === 'pending' \|\| invitationGeneration !== undefined/);
});

test('active invitation retries require current-generation acceptance audit and reach the idempotent RPC', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261028200000_secure_admin_invitation_recovery.sql', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const completionRouteStart = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const completionRouteEnd = serverSource.indexOf("app.get('/api/admin/users'", completionRouteStart);
  const completionRoute = serverSource.slice(completionRouteStart, completionRouteEnd);

  assert.match(migration, /target_row\.invitation_generation is distinct from p_invitation_generation[\s\S]*?if target_row\.status = 'active'[\s\S]*?details ->> 'invitationGeneration' = p_invitation_generation::text/i);
  assert.match(migration, /'invitationGeneration', p_invitation_generation/i);
  assert.match(completionRoute, /mode === 'invite' && identity\.status !== 'active' && decideAdminInvitationCompletion/);
  assert.match(completionRoute, /if \(mode === 'invite' && identity\.status === 'active'\) \{[\s\S]*?status === 'already_accepted'/);
});

test('completion and cancellation lock the same admin row and atomically audit their state change', () => {
  const completionSql = readFileSync(new URL('../supabase/migrations/20261028200000_secure_admin_invitation_recovery.sql', import.meta.url), 'utf8');
  const cancellationSql = readFileSync(new URL('../supabase/migrations/20261028130000_atomic_admin_invitation_cancellation.sql', import.meta.url), 'utf8');

  assert.match(completionSql, /from public\.admin_users[\s\S]*?where id = p_user_id[\s\S]*?for update/i);
  assert.match(completionSql, /target_row\.status is distinct from 'pending'/i);
  assert.match(completionSql, /update public\.admin_users[\s\S]*?insert into public\.admin_audit_logs/i);
  assert.match(completionSql, /target_row\.is_primary_owner/i);
  assert.match(completionSql, /set search_path = pg_catalog, public/i);
  assert.match(completionSql, /revoke all on function public\.complete_admin_invitation\(uuid, text, boolean, uuid\) from public, anon, authenticated/i);
  assert.match(completionSql, /grant execute on function public\.complete_admin_invitation\(uuid, text, boolean, uuid\) to service_role/i);
  assert.match(completionSql, /revoke all on function public\.prepare_admin_invitation_recovery\(uuid, uuid, uuid\) from public, anon, authenticated/i);
  assert.match(completionSql, /grant execute on function public\.prepare_admin_invitation_recovery\(uuid, uuid, uuid\) to service_role/i);
  assert.match(cancellationSql, /from public\.admin_users[\s\S]*?where id = p_target_id[\s\S]*?for update/i);
  assert.match(cancellationSql, /set status = 'disabled'/i);
});

test('recovery rotates the invitation generation under lock and clears disabled CMS access', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261028200000_secure_admin_invitation_recovery.sql', import.meta.url), 'utf8');
  assert.match(migration, /where id = p_target_id[\s\S]*?for update/i);
  assert.match(migration, /where id = p_actor_id[\s\S]*?is_primary_owner[\s\S]*?for share/i);
  assert.match(migration, /status = 'pending'[\s\S]*?invitation_generation = p_invitation_generation/i);
  assert.match(migration, /permissions = case when target_row\.status = 'disabled' then '\{\}'::jsonb/i);
  assert.match(migration, /username = case when target_row\.status = 'disabled' then null/i);
  assert.match(migration, /'admin\.invitation\.reissued'/i);
  assert.match(migration, /target_row\.invitation_generation is distinct from p_invitation_generation/i);
  assert.match(migration, /drop function if exists public\.complete_admin_invitation\(uuid, text, boolean\)/i);
});

test('recovery is Owner-authorized, keeps Co-Owners independent, and never sets Auth passwords server-side', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const recoveryStart = serverSource.indexOf("app.post('/api/admin/users/:id/recovery'");
  const recoveryEnd = serverSource.indexOf("app.post('/api/admin/users/:id/cancel'", recoveryStart);
  const recoveryRoute = serverSource.slice(recoveryStart, recoveryEnd);
  const completionStart = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const completionEnd = serverSource.indexOf("app.get('/api/admin/users'", completionStart);
  const completionRoute = serverSource.slice(completionStart, completionEnd);

  assert.match(recoveryRoute, /requireOwner\(req, res\)/);
  assert.match(recoveryRoute, /reauthenticateAdminRequest\(req, res, actor/);
  assert.match(recoveryRoute, /p_actor_id: actor\.id/);
  assert.match(recoveryRoute, /p_target_id: target\.id/);
  assert.match(recoveryRoute, /if \(target\.isPrimaryOwner\)/);
  assert.doesNotMatch(recoveryRoute, /setSupabaseUserPassword/);
  assert.match(completionRoute, /supabaseAuthRequest\('user'[\s\S]*?method: 'PUT'[\s\S]*?body: JSON\.stringify\(\{ password \}\)/);
  assert.match(completionRoute, /!authUser\.id \|\| !authUser\.email \|\| !authUser\.email_confirmed_at/);
});

test('duplicate email routes to existing history; access editing cannot reactivate without onboarding', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../src/components/admin/AdminSettings.tsx', import.meta.url), 'utf8');
  assert.match(serverSource, /email: `eq\.\$\{email\}`,[\s\S]*?select: 'id,email,username,role,status,is_primary_owner,archived_at'/);
  assert.match(serverSource, /target\.status !== status && !\(target\.status === 'active' && status === 'disabled'\)/);
  assert.match(settingsSource, /View Existing Account/);
  assert.match(settingsSource, /Re-invite \/ Recover CMS Access/);
  assert.match(settingsSource, /Cancel Invitation/);
  assert.match(settingsSource, /Remove CMS Access/);
  assert.match(settingsSource, /user\.emailVerified && user\.mustChangePassword\) return 'Pending Setup'/);
  assert.match(settingsSource, /status === 'cancelled'\) return 'Cancelled'/);
  assert.match(settingsSource, /status === 'removed'\) return 'Removed · Auth retained'/);
});

test('new invitations stay pending when reusing verified Auth identities without changing their passwords', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const inviteStart = serverSource.indexOf("app.post('/api/admin/users/invite'");
  const inviteEnd = serverSource.indexOf("app.put('/api/admin/users/:id'", inviteStart);
  const inviteRoute = serverSource.slice(inviteStart, inviteEnd);
  assert.match(inviteRoute, /if \(role === 'owner' && authUser\) \{[\s\S]*?status = 'pending'/);
  assert.match(inviteRoute, /\} else if \(authUser\) \{[\s\S]*?status = 'pending'/);
  assert.match(inviteRoute, /invitation_generation: invitationGeneration/);
  assert.doesNotMatch(inviteRoute, /setSupabaseUserPassword\(userId, initialPassword/);
  assert.match(inviteRoute, /sendPasswordRecovery = Boolean\(authUser\.email_confirmed_at\)/);
});

test('recovery requires Owner reauthentication and login remains status-gated', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const recoveryStart = serverSource.indexOf("app.post('/api/admin/users/:id/recovery'");
  const recoveryEnd = serverSource.indexOf("app.post('/api/admin/users/:id/cancel'", recoveryStart);
  const recoveryRoute = serverSource.slice(recoveryStart, recoveryEnd);
  const loginStart = serverSource.indexOf("app.post('/api/admin/login'");
  const loginEnd = serverSource.indexOf("app.get('/api/admin/session'", loginStart);
  const loginRoute = serverSource.slice(loginStart, loginEnd);
  assert.match(recoveryRoute, /requireOwner\(req, res\)/);
  assert.match(recoveryRoute, /reauthenticateAdminRequest/);
  assert.match(recoveryRoute, /prepare_admin_invitation_recovery/);
  const completionRouteStart = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const completionRouteEnd = serverSource.indexOf("app.get('/api/admin/users'", completionRouteStart);
  const completionRoute = serverSource.slice(completionRouteStart, completionRouteEnd);
  const generationCheck = completionRoute.indexOf('generationRows[0]?.invitation_generation !== invitationGeneration');
  const passwordUpdate = completionRoute.indexOf('if (password !== undefined)');
  assert.notEqual(generationCheck, -1);
  assert.ok(passwordUpdate > generationCheck);
  assert.match(loginRoute, /identity\.status === 'pending'/);
  assert.match(loginRoute, /This administrator account is pending/);
  assert.match(loginRoute, /setAdminSessionCookie/);
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
  assert.match(pendingRecoveryBranch, /p_invitation_generation: invitationGeneration/);
  assert.match(pendingRecoveryBranch, /completion\.status !== 'accepted'/);
});

test('cancellation rotates generations and archive/recovery preserve identity and history', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261028230000_admin_account_archiving.sql', import.meta.url), 'utf8');
  const cancelStart = migration.indexOf('create or replace function public.cancel_admin_invitation');
  const recoveryStart = migration.indexOf('create or replace function public.prepare_admin_invitation_recovery');
  const archiveStart = migration.indexOf('create or replace function public.archive_admin_account');
  const cancelSql = migration.slice(cancelStart, recoveryStart);
  const recoverySql = migration.slice(recoveryStart, archiveStart);
  const archiveSql = migration.slice(archiveStart);

  assert.match(migration, /add column if not exists archived_at timestamptz/i);
  assert.match(cancelSql, /role = 'owner'[\s\S]*?status = 'active'[\s\S]*?is_primary_owner[\s\S]*?for share/i);
  assert.match(cancelSql, /status = 'disabled'[\s\S]*?invitation_generation = gen_random_uuid\(\)/i);
  assert.match(cancelSql, /insert into public\.admin_audit_logs[\s\S]*?'admin\.invitation\.cancelled'/i);
  assert.match(recoverySql, /invitation_generation = p_invitation_generation[\s\S]*?archived_at = null/i);
  assert.match(recoverySql, /'previouslyArchived', target_row\.archived_at is not null/i);
  assert.match(archiveSql, /status is distinct from 'disabled'/i);
  assert.match(archiveSql, /set archived_at = archived_at_value[\s\S]*?invitation_generation = gen_random_uuid\(\)/i);
  assert.match(archiveSql, /'admin\.archived'/i);
  assert.match(migration, /grant execute on function public\.archive_admin_account\(uuid, uuid\) to service_role/i);
});

test('admin account routes enforce reauthentication and archive via a soft-archive RPC', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const cancelStart = serverSource.indexOf("app.post('/api/admin/users/:id/cancel'");
  const archiveStart = serverSource.indexOf("app.post('/api/admin/users/:id/archive'");
  const passwordStart = serverSource.indexOf("app.post('/api/admin/users/:id/password'", archiveStart);
  const cancelRoute = serverSource.slice(cancelStart, archiveStart);
  const archiveRoute = serverSource.slice(archiveStart, passwordStart);

  assert.match(cancelRoute, /requireOwner\(req, res\)/);
  assert.match(cancelRoute, /reauthenticateAdminRequest/);
  assert.match(cancelRoute, /actor\.isPrimaryOwner/);
  assert.match(cancelRoute, /cancellation\.status !== 'cancelled' && cancellation\.status !== 'already_cancelled'/);
  assert.match(archiveRoute, /requireOwner\(req, res\)/);
  assert.match(archiveRoute, /reauthenticateAdminRequest/);
  assert.match(archiveRoute, /actor\.isPrimaryOwner/);
  assert.match(archiveRoute, /target\.status !== 'disabled'/);
  assert.match(archiveRoute, /rpc\/archive_admin_account/);
  assert.match(archiveRoute, /Auth identity and audit history were retained/);
  assert.doesNotMatch(archiveRoute, /auth\/v1\/admin\/users\/.*DELETE/i);
});

test('admin account management surfaces direct recovery, archive state, and backend-synced statuses', () => {
  const settingsSource = readFileSync(new URL('../src/components/admin/AdminSettings.tsx', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');

  assert.match(serverSource, /archived_at[\s\S]*?archivedAt:/);
  assert.match(settingsSource, /Recover \/ Re-invite CMS Access/);
  assert.match(settingsSource, /Restore \/ Re-invite CMS Access/);
  assert.match(settingsSource, /Cancel Invitation/);
  assert.match(settingsSource, /\/archive`/);
  assert.match(settingsSource, /if \(user\.archivedAt\) return 'archived'/);
  assert.match(settingsSource, /\['Archived', invitationCounts\.archived\]/);
  assert.match(settingsSource, /value="archived">Archived/);
  assert.match(settingsSource, /activeDelegatedUsers = delegatedUsers\.filter\(\(user\) =>\s*!user\.archivedAt/);
});

test('invitation setup isolates an existing CMS browser session on both client and server', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const authActionSource = readFileSync(new URL('../src/components/admin/AdminAuthAction.tsx', import.meta.url), 'utf8');
  const callbackSource = readFileSync(new URL('../src/components/admin/adminAuthCallback.ts', import.meta.url), 'utf8');
  const pageSource = readFileSync(new URL('../src/components/admin/AdminPage.tsx', import.meta.url), 'utf8');
  const vercelSource = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  const completeStart = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const completeEnd = serverSource.indexOf("app.post('/api/admin/users/:id/recovery'", completeStart);
  const completeRoute = serverSource.slice(completeStart, completeEnd);
  const contextStart = serverSource.indexOf("app.get('/api/admin/auth/invitation-context'");
  const contextEnd = serverSource.indexOf("app.post('/api/admin/auth/recovery'", contextStart);
  const contextRoute = serverSource.slice(contextStart, contextEnd);

  assert.match(contextRoute, /authenticateAdminSession\(req\)/);
  assert.match(contextRoute, /hasActiveAdminSession:\s*Boolean\(identity\)/);
  assert.match(completeRoute, /if \(await authenticateAdminSession\(req\)\)[\s\S]*?status\(409\)/);
  assert.doesNotMatch(completeRoute, /setAdminSessionCookie/);
  assert.match(authActionSource, /sessionGate !== 'ready'/);
  assert.match(authActionSource, /Sign out this browser and continue/);
  assert.match(authActionSource, /credentials:\s*'same-origin'/);
  assert.match(authActionSource, /autoComplete="new-password"/);
  assert.match(authActionSource, /clearAdminAuthCallbackVerifier\(window\.localStorage/);
  assert.match(callbackSource, /storage\.removeItem\(key\)/);
  assert.match(pageSource, /autoComplete="current-password"/);
  assert.match(serverSource, /Referrer-Policy', 'no-referrer'/);
  assert.match(vercelSource, /"value": "no-referrer"/);
  assert.match(vercelSource, /no-store, max-age=0/);
});

test('admin session controls are owner-only for cross-account management and keep self sign-out', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../src/components/admin/AdminSettings.tsx', import.meta.url), 'utf8');
  const sessionsStart = serverSource.indexOf("app.get('/api/admin/sessions'");
  const revokeStart = serverSource.indexOf("app.delete('/api/admin/sessions/:id'", sessionsStart);
  const sessionDirectory = serverSource.slice(sessionsStart, revokeStart);
  const revokeEnd = serverSource.indexOf("app.post('/api/admin/users/:id/sessions/revoke'", revokeStart);
  const revokeRoute = serverSource.slice(revokeStart, revokeEnd);
  const managedRevokeEnd = serverSource.indexOf("app.post('/api/admin/users/:id/password'", revokeEnd);
  const managedRevokeRoute = serverSource.slice(revokeEnd, managedRevokeEnd);

  assert.match(sessionDirectory, /currentAdmin\(res\)\?\.isPrimaryOwner/);
  assert.match(settingsSource, /\{isPrimaryOwner && <Panel title="Active Sessions"/);
  assert.match(revokeRoute, /target\.user_id !== identity\.id/);
  assert.match(revokeRoute, /if \(!identity\.isPrimaryOwner\)/);
  assert.match(revokeRoute, /reauthenticateAdminRequest/);
  assert.match(revokeRoute, /target\.id === readAdminSession\(req\)\?\.sessionId/);
  assert.match(managedRevokeRoute, /requireOwner\(req, res\)/);
  assert.match(managedRevokeRoute, /actor\.isPrimaryOwner/);
  assert.match(managedRevokeRoute, /writeAdminAudit/);
});

test('Admin Accounts accordion is collapsed initially, keyboard-operable, and warns without discarding edits', () => {
  const settingsSource = readFileSync(new URL('../src/components/admin/AdminSettings.tsx', import.meta.url), 'utf8');

  assert.match(settingsSource, /useState<string \| null>\(null\)/);
  assert.match(settingsSource, /<button type="button" aria-expanded=\{expandedUserId === user\.id\}/);
  assert.match(settingsSource, /aria-controls=\{`admin-account-details-\$\{user\.id\}`\}/);
  assert.match(settingsSource, /Keep them unsaved and open another account/);
  assert.match(settingsSource, /savedUserAccess\.current\.set\(user\.id, adminUserAccessSnapshot\(user\)\)/);
});

test('branded email instructions configure the distinct Supabase invitation and recovery templates safely', () => {
  const templateGuide = readFileSync(new URL('../docs/supabase-admin-auth-email-templates.md', import.meta.url), 'utf8');

  assert.match(templateGuide, /Authentication → Email Templates/);
  assert.match(templateGuide, /## Invite user/);
  assert.match(templateGuide, /## Confirm signup/);
  assert.match(templateGuide, /## Reset password/);
  assert.match(templateGuide, /{{ \.ConfirmationURL }}/);
  assert.match(templateGuide, /Accept Invitation &amp; Set Up Account/);
  assert.match(templateGuide, /Reset your NearGrow Ads CMS password/);
});

test('consumed PKCE verifier is removed without touching unrelated Supabase Auth storage', () => {
  const values = new Map([
    ['sb-project-auth-token-code-verifier', 'one-time-code-verifier'],
    ['sb-other-auth-token-code-verifier', 'unrelated-verifier'],
    ['sb-project-auth-token', 'persistent-auth-session'],
  ]);
  const storage = {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    removeItem(key: string) { values.delete(key); },
  };

  clearAdminAuthCallbackVerifier(storage, 'one-time-code-verifier');

  assert.equal(values.has('sb-project-auth-token-code-verifier'), false);
  assert.equal(values.get('sb-other-auth-token-code-verifier'), 'unrelated-verifier');
  assert.equal(values.get('sb-project-auth-token'), 'persistent-auth-session');
});
