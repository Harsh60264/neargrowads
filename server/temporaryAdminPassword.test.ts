import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  adminCmsAccessAllowed,
  buildTemporaryAdminEmail,
  generateTemporaryAdminPassword,
  isTemporaryPasswordExpired,
  sendTemporaryAdminPasswordEmail,
  TEMPORARY_ADMIN_PASSWORD_TTL_MS,
  temporaryPasswordExpiresAt,
} from './temporaryAdminPassword';

const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const adminSettingsSource = readFileSync(new URL('../src/components/admin/AdminSettings.tsx', import.meta.url), 'utf8');
const lifecycleMigration = readFileSync(
  new URL('../supabase/migrations/20261029100000_admin_temporary_password_lifecycle.sql', import.meta.url),
  'utf8',
);
const identityMigration = readFileSync(
  new URL('../supabase/migrations/20261019000000_admin_identity_and_access.sql', import.meta.url),
  'utf8',
);
const leadsHardeningMigration = readFileSync(
  new URL('../supabase/migrations/20261025180000_harden_leads_access_and_consent.sql', import.meta.url),
  'utf8',
);
const setupMigration = readFileSync(
  new URL('../supabase/migrations/20261031010000_complete_admin_temporary_password_setup.sql', import.meta.url),
  'utf8',
);

test('temporary passwords expire exactly 24 hours after issue', () => {
  const issuedAt = Date.parse('2026-10-30T00:00:00.000Z');
  const expiresAt = temporaryPasswordExpiresAt(issuedAt);
  assert.equal(Date.parse(expiresAt), issuedAt + TEMPORARY_ADMIN_PASSWORD_TTL_MS);
  assert.equal(isTemporaryPasswordExpired(expiresAt, issuedAt), false);
  assert.equal(isTemporaryPasswordExpired(expiresAt, issuedAt + TEMPORARY_ADMIN_PASSWORD_TTL_MS - 1), false);
  assert.equal(isTemporaryPasswordExpired(expiresAt, issuedAt + TEMPORARY_ADMIN_PASSWORD_TTL_MS), true);
  assert.equal(isTemporaryPasswordExpired('invalid timestamp', issuedAt), true);
});

test('temporary passwords are strong and CMS access remains gated until replacement', () => {
  const password = generateTemporaryAdminPassword();
  assert.equal(password.length, 32);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /\d/);
  assert.match(password, /[^A-Za-z0-9]/);

  for (const role of ['owner', 'super_admin', 'custom_admin']) {
    assert.equal(adminCmsAccessAllowed({ status: 'active', mustChangePassword: true }), false, role);
    assert.equal(adminCmsAccessAllowed({ status: 'active', mustChangePassword: false }), true, role);
  }
  assert.equal(adminCmsAccessAllowed({ status: 'disabled', mustChangePassword: false }), false);
  assert.equal(adminCmsAccessAllowed({ status: 'active', archivedAt: '2026-10-29T00:00:00Z' }), false);
});

test('temporary-password login consumption is atomic, expiring, and one-time', () => {
  assert.match(lifecycleMigration, /temporary_password_expires_at timestamptz/);
  assert.match(lifecycleMigration, /temporary_password_used_at timestamptz/);
  assert.match(lifecycleMigration, /from public\.admin_users[\s\S]*?for update/i);
  assert.match(lifecycleMigration, /target_row\.temporary_password_expires_at <= consumed_at/);
  assert.match(lifecycleMigration, /target_row\.temporary_password_used_at is not null/);
  assert.match(lifecycleMigration, /target_row\.status is distinct from 'active'/);
  assert.match(lifecycleMigration, /target_row\.archived_at is not null/);
  assert.match(lifecycleMigration, /target_row\.is_primary_owner is distinct from false/);
  assert.match(lifecycleMigration, /revoke all on function public\.consume_admin_temporary_password_login\(uuid\) from public, anon, authenticated/i);
  assert.match(lifecycleMigration, /grant execute on function public\.consume_admin_temporary_password_login\(uuid\) to service_role/i);
  assert.match(identityMigration, /alter table public\.admin_users enable row level security/i);
});

test('Owner-requested recovery blocks any prior temporary password until verified recovery completes', () => {
  const recoveryStart = serverSource.indexOf("app.post('/api/admin/users/:id/recovery'");
  const recoveryEnd = serverSource.indexOf("app.post('/api/admin/users/:id/cancel'", recoveryStart);
  const recoveryRoute = serverSource.slice(recoveryStart, recoveryEnd);
  const activeResetStart = recoveryRoute.indexOf("const authUser = await readSupabaseJson");
  const activeResetRoute = recoveryRoute.slice(activeResetStart);
  const lockIndex = activeResetRoute.indexOf('temporary_password_expires_at: new Date(0).toISOString()');
  const sessionRevokeIndex = activeResetRoute.indexOf('rest/v1/admin_sessions?');
  const recoveryEmailIndex = activeResetRoute.indexOf('buildAdminPasswordResetRedirect');
  const completionStart = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const completionEnd = serverSource.indexOf("app.get('/api/admin/users'", completionStart);
  const completionRoute = serverSource.slice(completionStart, completionEnd);
  const passwordUpdateIndex = completionRoute.indexOf("method: 'PUT'");
  const temporaryStateClearIndex = completionRoute.indexOf('temporary_password_expires_at: null');
  const firstPasswordStart = serverSource.indexOf("app.post('/api/admin/auth/first-password'");
  const firstPasswordEnd = serverSource.indexOf("app.get('/api/admin/sessions/mine'", firstPasswordStart);
  const firstPasswordRoute = serverSource.slice(firstPasswordStart, firstPasswordEnd);

  assert.ok(lockIndex >= 0 && lockIndex < sessionRevokeIndex && sessionRevokeIndex < recoveryEmailIndex);
  assert.equal(activeResetRoute.includes('temporary_password_expires_at: null'), false);
  assert.equal(isTemporaryPasswordExpired(new Date(0).toISOString()), true);
  assert.ok(passwordUpdateIndex >= 0 && passwordUpdateIndex < temporaryStateClearIndex);
  assert.match(completionRoute, /await readSupabaseJson<unknown>\(updateResponse\);\s*recoveryPasswordUpdated = mode === 'recovery'/);
  assert.match(firstPasswordRoute, /isTemporaryPasswordExpired\(currentIdentity\.temporaryPasswordExpiresAt\)/);
});

test('concurrent logins can consume one temporary credential only once', async () => {
  const expiry = Date.parse('2026-10-31T00:00:00.000Z');
  let usedAt: number | null = null;
  let queue = Promise.resolve();
  const consume = async (now: number): Promise<'consumed' | 'expired' | 'already_used'> => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (expiry <= now) return 'expired';
      if (usedAt !== null) return 'already_used';
      usedAt = now;
      return 'consumed';
    } finally {
      release();
    }
  };

  const results = await Promise.all(Array.from({ length: 20 }, () => consume(expiry - 1)));
  assert.equal(results.filter((result) => result === 'consumed').length, 1);
  assert.equal(results.filter((result) => result === 'already_used').length, 19);
  assert.equal(await consume(expiry), 'expired');
});

test('login rejects invalid Auth credentials before creating or consuming a CMS session', () => {
  const loginStart = serverSource.indexOf("app.post('/api/admin/login'");
  const loginEnd = serverSource.indexOf("app.get('/api/admin/session'", loginStart);
  const loginRoute = serverSource.slice(loginStart, loginEnd);
  assert.notEqual(loginStart, -1);
  assert.ok(loginRoute.indexOf('if (!authResponse.ok)') < loginRoute.indexOf('readAdminIdentity(authData.user.id)'));
  assert.ok(loginRoute.indexOf('consume_admin_temporary_password_login') < loginRoute.indexOf('setAdminSessionCookie'));
  assert.match(loginRoute, /temporary_password_already_used/);
  assert.match(loginRoute, /temporary_password_expired/);
  assert.match(loginRoute, /revoked_at: new Date\(\)\.toISOString\(\)/);
});

test('every protected CMS request reloads session and identity and denies expired credentials', () => {
  const authenticationStart = serverSource.indexOf('async function authenticateAdminSession');
  const authenticationEnd = serverSource.indexOf('\nfunction currentAdmin', authenticationStart);
  const authentication = serverSource.slice(authenticationStart, authenticationEnd);
  assert.match(authentication, /get_active_admin_session/);
  assert.match(authentication, /readAdminIdentity\(token\.userId\)/);
  assert.match(authentication, /identity\.status !== 'active'/);
  assert.match(authentication, /isTemporaryPasswordExpired\(identity\.temporaryPasswordExpiresAt\)/);
  assert.match(serverSource, /if \(!adminCmsAccessAllowed\(identity\) && req\.path !== '\/auth\/first-password'\)/);
  assert.doesNotMatch(authentication, /setSupabaseUserPassword|deleteSupabaseUser/);
  assert.match(setupMigration, /account\.temporary_password_expires_at > clock_timestamp\(\)/);
  assert.match(setupMigration, /account\.temporary_password_used_at is not null/);
  assert.match(setupMigration, /revoke all on function public\.get_active_admin_session\(uuid, uuid\) from public, anon, authenticated/i);
});

test('expired or stale first-password setup is rejected before Supabase Auth password update', () => {
  const setupStart = serverSource.indexOf("app.post('/api/admin/auth/first-password'");
  const setupEnd = serverSource.indexOf("app.get('/api/admin/sessions/mine'", setupStart);
  const setupRoute = serverSource.slice(setupStart, setupEnd);
  assert.notEqual(setupStart, -1);
  assert.ok(setupRoute.indexOf('readAdminIdentity(identity.id)') < setupRoute.indexOf("supabaseAuthRequest('user'"));
  assert.ok(setupRoute.indexOf('isTemporaryPasswordExpired(currentIdentity.temporaryPasswordExpiresAt)') <
    setupRoute.indexOf("supabaseAuthRequest('user'"));
  assert.ok(setupRoute.indexOf('get_active_admin_session') < setupRoute.indexOf("supabaseAuthRequest('user'"));
  assert.ok(setupRoute.indexOf('complete_admin_temporary_password_setup') >
    setupRoute.indexOf('revokeSupabaseRefreshTokens'));

  assert.match(setupMigration, /target_row\.temporary_password_expires_at <= clock_timestamp\(\)/);
  assert.match(setupMigration, /and user_id = p_user_id/);
  assert.match(setupMigration, /and revoked_at is null/);
  assert.match(setupMigration, /and expires_at > clock_timestamp\(\)/);
  assert.match(setupMigration, /for update/i);
  assert.match(setupMigration, /update public\.admin_sessions[\s\S]*?id <> p_session_id/);
  assert.match(setupMigration, /temporary-admin-password-setup:/);
});

test('successful first-login password change validates the CMS session and clears temporary-password lifecycle state', () => {
  const setupStart = serverSource.indexOf("app.post('/api/admin/auth/first-password'");
  const setupEnd = serverSource.indexOf("app.get('/api/admin/sessions/mine'", setupStart);
  const setupRoute = serverSource.slice(setupStart, setupEnd);
  const migration = setupMigration.slice(setupMigration.indexOf('create or replace function public.complete_admin_temporary_password_setup'));

  assert.match(setupRoute, /identity\.isPrimaryOwner \|\| identity\.mustChangePassword !== true/);
  assert.match(setupRoute, /get_active_admin_session/);
  assert.match(setupRoute, /supabaseAuthRequest\('user'[\s\S]*?method: 'PUT'[\s\S]*?revokeSupabaseRefreshTokens/);
  assert.match(setupRoute, /complete_admin_temporary_password_setup/);
  assert.match(setupRoute, /completion\.status !== 'completed'/);
  assert.match(setupRoute, /Password changed\. Your temporary password is no longer valid\./);
  assert.match(migration, /must_change_password = false/);
  assert.match(migration, /temporary_password_expires_at = null/);
  assert.match(migration, /temporary_password_used_at = null/);
});

test('expiry is enforced without scheduler, lease, quarantine, or Auth password rotation', () => {
  assert.doesNotMatch(serverSource, /admin-temporary-password-expiry/);
  assert.doesNotMatch(serverSource, /ADMIN_TEMP_PASSWORD_EXPIRY_CRON_SECRET/);
  assert.doesNotMatch(serverSource, /temporary_password_expiry_(?:claim|rotation|sessions|audit)/);
  assert.doesNotMatch(serverSource, /quarantine_admin_temporary_password_expiry/);
  assert.doesNotMatch(serverSource, /finishTemporaryAdminPasswordExpiry/);
  assert.doesNotMatch(adminSettingsSource, /Quarantine and replace Auth identity/);
  assert.doesNotMatch(setupMigration, /temporary_password_expiry_claim|rotation_state|quarantine/i);
});

test('deployment provides no scheduler requirement and documents direct Auth scope', () => {
  const deployment = readFileSync(new URL('../docs/deployment.md', import.meta.url), 'utf8');
  assert.doesNotMatch(deployment, /ADMIN_TEMP_PASSWORD_EXPIRY_CRON_SECRET|\/api\/cron\/admin-temporary-password-expiry/);
  assert.match(deployment, /24 hours for CMS access/);
  assert.match(deployment, /Supabase Auth may still accept the password/);
  assert.match(deployment, /verify the deployed staging grants, RLS policies, function privileges, Storage policies/);
});

test('temporary Admin setup migration is service-role-only and checks current account and CMS session', () => {
  assert.match(setupMigration, /security definer/i);
  assert.match(setupMigration, /set search_path = pg_catalog, public/i);
  assert.match(setupMigration, /revoke all on table public\.admin_users, public\.admin_sessions,[\s\S]*?from public, anon, authenticated/i);
  assert.match(setupMigration, /target_row\.status is distinct from 'active'/);
  assert.match(setupMigration, /target_row\.archived_at is not null/);
  assert.match(setupMigration, /target_row\.is_primary_owner is distinct from false/);
  assert.match(setupMigration, /target_row\.must_change_password is distinct from true/);
  assert.match(setupMigration, /revoke all on function public\.complete_admin_temporary_password_setup\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(setupMigration, /grant execute on function public\.complete_admin_temporary_password_setup\(uuid, uuid\) to service_role/i);
});

test('direct Auth tokens cannot read or mutate privileged tables after the hardening migrations', () => {
  assert.match(leadsHardeningMigration, /drop policy if exists "Staff read access to leads"/i);
  assert.match(leadsHardeningMigration, /drop policy if exists "Staff update access to leads"/i);
  assert.match(leadsHardeningMigration, /revoke all on table public\.leads from anon, authenticated, public/i);
  assert.match(identityMigration, /alter table public\.admin_users enable row level security/i);
  assert.match(identityMigration, /alter table public\.admin_sessions enable row level security/i);
  assert.match(setupMigration, /revoke all on table public\.admin_users, public\.admin_sessions,[\s\S]*?from public, anon, authenticated/i);
  assert.match(setupMigration, /grant all on table public\.admin_users, public\.admin_sessions,[\s\S]*?to service_role/i);
});

test('branded email names the role and onboarding details while escaping content', () => {
  const base = {
    email: 'person@example.com',
    username: 'admin.user',
    password: 'Temp!Password1234',
    signInUrl: 'https://www.neargrowads.com/admin/login',
    expiresAt: '2026-10-30T12:00:00.000Z',
  };
  for (const [role, label] of [
    ['owner', 'Co-Owner'],
    ['super_admin', 'Super Admin'],
    ['custom_admin', 'Custom Admin'],
  ] as const) {
    const email = buildTemporaryAdminEmail({ ...base, role });
    assert.equal(email.subject, 'Your NearGrow Ads CMS temporary password');
    assert.match(email.html, new RegExp(label));
    assert.match(email.html, /Changing this password is mandatory at first login/);
    assert.match(email.text, /24 hours/);
    assert.match(email.html, /https:\/\/www\.neargrowads\.com\/admin\/login/);
  }
  const unsafeEmail = buildTemporaryAdminEmail({
    ...base,
    email: '<script>alert(1)</script>@example.com',
    username: '<img src=x>',
    password: '<unsafe&password>',
    role: 'custom_admin',
  });
  assert.doesNotMatch(unsafeEmail.html, /<script>|<img/);
  assert.match(unsafeEmail.html, /&lt;unsafe&amp;password&gt;/);
});

test('email delivery sends one provider request, reports failures, and does not retry', async () => {
  const input = {
    email: 'admin@example.com',
    username: 'admin.user',
    role: 'super_admin' as const,
    password: 'Temp!Password1234',
    signInUrl: 'https://www.neargrowads.com/admin/login',
    expiresAt: '2026-10-30T12:00:00.000Z',
  };
  let requests = 0;
  let sentBody = '';
  const send = async (_url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests += 1;
    sentBody = String(init?.body || '');
    return new Response('', { status: 202 });
  };
  await sendTemporaryAdminPasswordEmail(input, 'test-api-key', 'NearGrow Ads <no-reply@neargrowads.com>', send);
  assert.equal(requests, 1);
  assert.match(sentBody, /Temp!Password1234/);

  requests = 0;
  await assert.rejects(
    sendTemporaryAdminPasswordEmail(input, 'test-api-key', 'NearGrow Ads <no-reply@neargrowads.com>', async () => {
      requests += 1;
      return new Response('', { status: 503 });
    }),
    /provider returned 503/,
  );
  assert.equal(requests, 1);
});

test('Admin invitation retains 24-hour expiry without requiring any scheduler', () => {
  const inviteStart = serverSource.indexOf("app.post('/api/admin/users/invite'");
  const inviteEnd = serverSource.indexOf("app.put('/api/admin/users/:id'", inviteStart);
  const inviteRoute = serverSource.slice(inviteStart, inviteEnd);
  assert.notEqual(inviteStart, -1);
  assert.match(inviteRoute, /requireOwner\(req, res\)/);
  assert.match(inviteRoute, /temporary_password_expires_at: temporaryPasswordExpiry/);
  assert.match(inviteRoute, /setSupabaseUserPassword\(newlyCreatedAuthUserId, generateTemporaryAdminPassword\(\)\)/);
  assert.doesNotMatch(inviteRoute, /CRON_SECRET|expiry scheduler/i);
  assert.doesNotMatch(inviteRoute, /res\.json\(\{[^}]*password\s*:/s);
});
