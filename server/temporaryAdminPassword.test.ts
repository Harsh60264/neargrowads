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

test('generates strong random temporary passwords and applies a 24-hour expiry', () => {
  const password = generateTemporaryAdminPassword();
  assert.equal(password.length, 32);
  assert.match(password, /[a-z]/);
  assert.match(password, /[A-Z]/);
  assert.match(password, /\d/);
  assert.match(password, /[^A-Za-z0-9]/);
  assert.equal(Date.parse(temporaryPasswordExpiresAt(1_000)), 1_000 + TEMPORARY_ADMIN_PASSWORD_TTL_MS);
  assert.equal(isTemporaryPasswordExpired(temporaryPasswordExpiresAt(1_000), 1_000), false);
  assert.equal(isTemporaryPasswordExpired(temporaryPasswordExpiresAt(1_000), 1_000 + TEMPORARY_ADMIN_PASSWORD_TTL_MS), true);
  assert.equal(isTemporaryPasswordExpired('not-a-date', 1_000), true);
});

test('temporary passwords deny all CMS access until replaced, including Co-Owners', () => {
  for (const role of ['owner', 'super_admin', 'custom_admin']) {
    assert.equal(adminCmsAccessAllowed({ status: 'active', mustChangePassword: true }), false, role);
    assert.equal(adminCmsAccessAllowed({ status: 'active', mustChangePassword: false }), true, role);
  }
  assert.equal(adminCmsAccessAllowed({ status: 'disabled', mustChangePassword: false }), false);
  assert.equal(adminCmsAccessAllowed({ status: 'active', archivedAt: '2026-10-29T00:00:00Z' }), false);
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
    assert.match(email.subject, /NearGrow Ads/);
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

test('delivery sends one provider request, never returns the password, and reports provider failure', async () => {
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
  const result = await sendTemporaryAdminPasswordEmail(input, 'test-api-key', 'NearGrow Ads <no-reply@neargrowads.com>', send);
  assert.equal(result, undefined);
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
  assert.equal(requests, 1, 'provider failure must not trigger an automatic resend');
});

test('creation preserves independent Auth identities, rate limits, forced replacement, and delivery cleanup', () => {
  const lifecycleMigration = readFileSync(new URL('../supabase/migrations/20261029100000_admin_temporary_password_lifecycle.sql', import.meta.url), 'utf8');
  const inviteRoute = serverSource.slice(
    serverSource.indexOf("app.post('/api/admin/users/invite'"),
    serverSource.indexOf("app.put('/api/admin/users/:id'"),
  );
  assert.match(inviteRoute, /requireOwner\(req, res\)/);
  assert.match(inviteRoute, /enforceAdminRateLimit\(req, res, adminAccountCreateAttempts/);
  assert.match(inviteRoute, /\['owner', 'super_admin', 'custom_admin'\]/);
  assert.match(inviteRoute, /auth\/v1\/admin\/users/);
  assert.match(inviteRoute, /email_confirm: false/);
  assert.match(inviteRoute, /temporary_password_expires_at: temporaryPasswordExpiry/);
  assert.match(inviteRoute, /setSupabaseUserPassword\(newlyCreatedAuthUserId, generateTemporaryAdminPassword\(\)\)/);
  assert.match(inviteRoute, /deleteSupabaseUser\(newlyCreatedAuthUserId\)/);
  assert.match(inviteRoute, /temporary-password onboarding email was not accepted/);
  assert.match(inviteRoute, /username_duplicate_check/);
  assert.doesNotMatch(inviteRoute, /res\.json\(\{[^}]*password\s*:/s);
  assert.doesNotMatch(inviteRoute, /setSupabaseUserPassword\(actor\.id/);
  assert.match(serverSource, /adminCmsAccessAllowed\(identity\)/);
  assert.match(serverSource, /req\.path !== '\/auth\/first-password'/);
  assert.match(serverSource, /Change your temporary password before refreshing administrator activity/);
  assert.match(serverSource, /temporary_password_expires_at: null/);
  assert.match(serverSource, /expireTemporaryAdminPassword\(identity\)/);
  assert.match(serverSource, /app\.get\('\/api\/cron\/admin-temporary-password-expiry'/);
  assert.ok(serverSource.indexOf("\n  });\n\n  app.get('/api/cron/admin-temporary-password-expiry'") > serverSource.indexOf("app.get('/api/health'"));
  assert.match(serverSource, /ADMIN_TEMP_PASSWORD_EXPIRY_CRON_SECRET/);
  assert.match(serverSource, /adminTemporaryPasswordCronAttempts/);
  const passwordResetRoute = serverSource.slice(
    serverSource.indexOf("app.post('/api/admin/users/:id/password'"),
    serverSource.indexOf("app.post('/api/admin/auth/first-password'"),
  );
  assert.match(passwordResetRoute, /if \(target\.isPrimaryOwner\)/);
  assert.doesNotMatch(passwordResetRoute, /target\.role === 'owner'/);
  assert.match(adminSettingsSource, /Set New Temporary Password/);
  assert.doesNotMatch(adminSettingsSource, /user\.role === 'owner'\} title/);
  assert.match(serverSource, /supabaseAuthRequest\('user', \{\s*method: 'PUT',\s*body: JSON\.stringify\(\{ password: newPassword \}\)/);
  assert.match(serverSource, /auth\.password\.temporary_changed/);
  assert.match(serverSource, /consume_admin_temporary_password_login/);
  assert.match(lifecycleMigration, /temporary_password_used_at timestamptz/);
  assert.match(lifecycleMigration, /for update/i);
  assert.match(lifecycleMigration, /temporary_password_used_at is not null/i);
  assert.match(lifecycleMigration, /to service_role/i);
});

test('password mutations and session revocation remain scoped to the intended Auth identity', () => {
  const identityMigration = readFileSync(new URL('../supabase/migrations/20261019000000_admin_identity_and_access.sql', import.meta.url), 'utf8');
  const lifecycleMigration = readFileSync(new URL('../supabase/migrations/20261029100000_admin_temporary_password_lifecycle.sql', import.meta.url), 'utf8');
  const createAdminRoute = serverSource.slice(
    serverSource.indexOf("app.post('/api/admin/users/invite'"),
    serverSource.indexOf("app.put('/api/admin/users/:id'"),
  );
  const managedResetRoute = serverSource.slice(
    serverSource.indexOf("app.post('/api/admin/users/:id/password'"),
    serverSource.indexOf("app.post('/api/admin/auth/first-password'"),
  );
  const firstPasswordRoute = serverSource.slice(
    serverSource.indexOf("app.post('/api/admin/auth/first-password'"),
    serverSource.indexOf("app.get('/api/admin/sessions'"),
  );
  const profilePasswordRoute = serverSource.slice(
    serverSource.indexOf("app.post('/api/admin/profile/password'"),
    serverSource.indexOf("app.get('/api/admin/security-monitoring/website-activity'"),
  );
  const recoveryRoute = serverSource.slice(
    serverSource.indexOf("app.post('/api/admin/users/:id/recovery'"),
    serverSource.indexOf("app.post('/api/admin/users/:id/cancel'"),
  );

  for (const role of ['owner', 'super_admin', 'custom_admin']) {
    assert.match(identityMigration, /id uuid primary key references auth\.users\(id\)/i);
    assert.match(createAdminRoute, /created\.id/);
    assert.match(createAdminRoute, /userId = created\.id/);
    assert.match(createAdminRoute, /id: userId,[\s\S]*?is_primary_owner: false/);
    assert.match(firstPasswordRoute, /const identity = currentAdmin\(res\)!/);
    assert.match(firstPasswordRoute, /reauthenticateAdminRequest\([\s\S]*?identity,[\s\S]*?currentPassword/);
    assert.match(firstPasswordRoute, /user_id: `eq\.\$\{identity\.id\}`/);
    assert.match(profilePasswordRoute, /const identity = currentAdmin\(res\)!/);
    assert.match(profilePasswordRoute, /reauthenticateAdminRequest\(req, res, identity, currentPassword/);
    assert.match(profilePasswordRoute, /user_id: `eq\.\$\{identity\.id\}`/);
    assert.equal(adminCmsAccessAllowed({ status: 'active', mustChangePassword: true }), false, role);
  }

  assert.match(firstPasswordRoute, /if \(identity\.isPrimaryOwner \|\| identity\.mustChangePassword !== true\)/);
  assert.match(firstPasswordRoute, /supabaseAuthRequest\('user',[\s\S]*?\}, accessToken\)/);
  assert.match(firstPasswordRoute, /const userQuery = new URLSearchParams\(\{ id: `eq\.\$\{identity\.id\}` \}\)/);
  assert.match(firstPasswordRoute, /currentSessionId \? \{ id: `neq\.\$\{currentSessionId\}` \}/);
  assert.match(profilePasswordRoute, /supabaseAuthRequest\('user',[\s\S]*?\}, accessToken\)/);
  assert.match(profilePasswordRoute, /const userQuery = new URLSearchParams\(\{ id: `eq\.\$\{identity\.id\}` \}\)/);
  assert.match(managedResetRoute, /requireOwner\(req, res\)/);
  assert.match(managedResetRoute, /if \(target\.isPrimaryOwner\)/);
  assert.match(managedResetRoute, /setSupabaseUserPassword\(target\.id, newPassword\)/);
  assert.match(managedResetRoute, /user_id: `eq\.\$\{target\.id\}`/);
  assert.match(recoveryRoute, /requireOwner\(req, res\)/);
  assert.match(recoveryRoute, /if \(target\.isPrimaryOwner\)/);
  assert.match(recoveryRoute, /p_actor_id: actor\.id/);
  assert.match(recoveryRoute, /p_target_id: target\.id/);
  assert.doesNotMatch(firstPasswordRoute, /req\.body\.(?:id|userId|email)/);
  assert.doesNotMatch(profilePasswordRoute, /req\.body\.(?:id|userId|email)/);
  assert.doesNotMatch(firstPasswordRoute, /setSupabaseUserPassword\(/);
  assert.doesNotMatch(recoveryRoute, /setSupabaseUserPassword\(/);
  assert.match(lifecycleMigration, /target_row\.is_primary_owner is distinct from false/i);
  assert.match(lifecycleMigration, /target_row\.status is distinct from 'active'/i);
  assert.match(lifecycleMigration, /target_row\.archived_at is not null/i);
  assert.match(lifecycleMigration, /target_row\.temporary_password_expires_at <= consumed_at/i);
  assert.match(lifecycleMigration, /target_row\.temporary_password_used_at is not null/i);
  assert.match(lifecycleMigration, /from public, anon, authenticated/i);
  assert.match(lifecycleMigration, /to service_role/i);
  assert.match(lifecycleMigration, /for update/i);
  assert.match(lifecycleMigration, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(lifecycleMigration, /\bdelete\s+from\s+public\.admin_users\b/i);
});
