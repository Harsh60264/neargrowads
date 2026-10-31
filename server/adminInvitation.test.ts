import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildAdminInvitationRedirect,
  buildAdminPasswordResetRedirect,
  decideAdminInvitationCompletion,
  decideAdminInvitationRecovery,
  isCurrentPendingAdminInvitation,
  isValidAdminInvitationGeneration,
  type AdminInvitationIdentity,
} from './adminInvitation';
import { isSameOriginHost } from './adminAuthOrigin';
import { revokeSupabaseRefreshTokensWithAccessToken } from './supabaseAuthSessions';
import {
  clearAdminAuthCallbackVerifier,
  readAdminAuthCallback,
  readAdminAuthRoute,
} from '../src/components/admin/adminAuthCallback';

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
  assert.match(callback.error || '', /invalid, expired, or already used/i);
});

test('invitation generations must be strict UUIDs belonging to a current pending delegated invitation', () => {
  const generation = pendingIdentity.id;
  assert.equal(isValidAdminInvitationGeneration(generation), true);
  assert.equal(isValidAdminInvitationGeneration(undefined), false);
  assert.equal(isValidAdminInvitationGeneration('not-a-uuid'), false);
  assert.equal(isValidAdminInvitationGeneration('2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62-extra'), false);

  const currentInvitation = {
    id: pendingIdentity.id,
    email: pendingIdentity.email,
    invitation_generation: generation,
    status: 'pending',
    is_primary_owner: false,
  };
  assert.equal(isCurrentPendingAdminInvitation(currentInvitation, generation), true);
  assert.equal(isCurrentPendingAdminInvitation({ ...currentInvitation, invitation_generation: 'f46dd026-fc56-4865-b4c7-f213f2c5076b' }, generation), false);
  assert.equal(isCurrentPendingAdminInvitation({ ...currentInvitation, status: 'disabled' }, generation), false);
  assert.equal(isCurrentPendingAdminInvitation({ ...currentInvitation, is_primary_owner: true }, generation), false);
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

test('builds password reset redirects for the configured custom domain with a template query separator', () => {
  assert.equal(
    buildAdminPasswordResetRedirect('https://staging.neargrowads.com'),
    'https://staging.neargrowads.com/admin/password-reset?mode=recovery',
  );
  assert.equal(
    buildAdminPasswordResetRedirect('https://www.neargrowads.com'),
    'https://www.neargrowads.com/admin/password-reset?mode=recovery',
  );
});

test('accepts same-origin callbacks on the custom staging and production domains only', () => {
  assert.equal(isSameOriginHost('https://staging.neargrowads.com', 'staging.neargrowads.com'), true);
  assert.equal(isSameOriginHost('https://www.neargrowads.com', 'www.neargrowads.com'), true);
  assert.equal(isSameOriginHost('https://staging.neargrowads.com', 'www.neargrowads.com'), false);
  assert.equal(isSameOriginHost('https://www.neargrowads.com', 'staging.neargrowads.com'), false);
  assert.equal(isSameOriginHost('https://attacker.example', 'staging.neargrowads.com'), false);
  assert.equal(isSameOriginHost(undefined, 'staging.neargrowads.com'), false);
});

test('accepts a one-time token hash in a fresh browser without a PKCE verifier', () => {
  const callback = readAdminAuthCallback(
    '?mode=recovery&token_hash=one-time-token-hash-value&type=recovery',
    '',
    { length: 0, key: () => null, getItem: () => null },
    'recovery',
  );

  assert.equal(callback.tokenHash, 'one-time-token-hash-value');
  assert.equal(callback.tokenType, 'recovery');
  assert.equal(callback.codeVerifier, undefined);
  assert.equal(callback.error, undefined);
});

test('a recovery callback without a token is rejected before setup can be submitted', () => {
  const callback = readAdminAuthCallback(
    '?mode=recovery',
    '',
    { length: 0, key: () => null, getItem: () => null },
    'recovery',
  );

  assert.equal(callback.tokenHash, undefined);
  assert.equal(callback.accessToken, undefined);
  assert.equal(callback.authorizationCode, undefined);
  assert.equal(callback.error, undefined);

  const authActionSource = readFileSync(new URL('../src/components/admin/AdminAuthAction.tsx', import.meta.url), 'utf8');
  assert.match(authActionSource, /!hasCallback && !callback\.error[\s\S]*?This password-reset link is missing, expired, or already used/);
  assert.match(authActionSource, /disabled=\{!hasCallback \|\| busy \|\| callbackAttempted \|\| !passwordIsStrong \|\| password !== confirmPassword\}/);
});

test('recovery callback failures ask for a new recovery email, not invitation setup', () => {
  const callback = readAdminAuthCallback(
    '?error=access_denied&error_code=otp_expired',
    '',
    { length: 0, key: () => null, getItem: () => null },
    'recovery',
  );

  assert.match(callback.error || '', /password-reset link.*invalid, expired, or already used.*new recovery email/i);
});

test('only recovery-mode GET invitation-context checks bypass CMS-session middleware', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const middlewareStart = serverSource.indexOf("const authExemptPaths = ['/login'");
  const middlewareEnd = serverSource.indexOf('try {', middlewareStart);
  const middleware = serverSource.slice(middlewareStart, middlewareEnd);
  const contextStart = serverSource.indexOf("app.get('/api/admin/auth/invitation-context'");
  const contextEnd = serverSource.indexOf("app.post('/api/admin/auth/recovery'", contextStart);
  const contextRoute = serverSource.slice(contextStart, contextEnd);
  const authActionSource = readFileSync(new URL('../src/components/admin/AdminAuthAction.tsx', import.meta.url), 'utf8');

  assert.match(middleware, /req\.method === 'GET'[\s\S]*?req\.path === '\/auth\/invitation-context'[\s\S]*?req\.query\.mode === 'recovery'/);
  assert.match(middleware, /authExemptPaths\.includes\(req\.path\) \|\| isRecoveryContextCheck/);
  assert.match(authActionSource, /new URLSearchParams\(\{ mode \}\)/);
  assert.match(contextRoute, /authenticateAdminSession\(req\)/);
  assert.match(contextRoute, /hasActiveAdminSession:\s*Boolean\(identity\)/);
  assert.doesNotMatch(contextRoute, /email|invitation_generation|permissions|role/i);
});

test('callback completion verifies token hashes server-side without requiring a CMS session', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const start = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const end = serverSource.indexOf("app.get('/api/admin/users'", start);
  const completionRoute = serverSource.slice(start, end);

  assert.match(completionRoute, /if \(await authenticateAdminSession\(req\)\)[\s\S]*?status\(409\)/);
  assert.doesNotMatch(completionRoute, /requireAdmin\(req,\s*res\)/);
  assert.match(completionRoute, /supabaseAuthRequest\('verify'[\s\S]*?token_hash:\s*tokenHash,\s*type:\s*tokenType/);
  assert.ok(completionRoute.indexOf('isValidAdminInvitationGeneration(invitationGeneration)') <
    completionRoute.indexOf("supabaseAuthRequest('verify'"));
  assert.ok(completionRoute.indexOf('isCurrentPendingAdminInvitation(currentInvitation, invitationGeneration)') <
    completionRoute.indexOf("supabaseAuthRequest('verify'"));
  assert.match(completionRoute, /status:\s*'eq\.pending'/);
  assert.match(completionRoute, /is_primary_owner:\s*'eq\.false'/);
  assert.match(completionRoute, /invitationSetup === true/);
  assert.match(completionRoute, /identity\.id !== pendingInvitation\.id[\s\S]*?identity\.status !== 'pending'/);
  assert.match(completionRoute, /const allowedTypes = mode === 'invite' \? \['signup', 'invite'\] : \['recovery'\]/);
  assert.match(completionRoute, /mode === 'recovery'\s*\? 'The password-reset request is incomplete or invalid/);
  assert.match(completionRoute, /mode === 'recovery'\s*\? 'Verify this email address before resetting the password/);
  assert.match(completionRoute, /identity\.email !== authUser\.email\.toLowerCase\(\)/);
  assert.match(completionRoute, /identity\.status === 'disabled'/);
  assert.match(completionRoute, /revokeSupabaseRefreshTokens\(verifiedAccessToken,\s*identity\.id\)/);
  assert.equal((completionRoute.match(/revokeSupabaseRefreshTokens\(verifiedAccessToken,\s*identity\.id\)/g) || []).length, 1);
  assert.doesNotMatch(serverSource, /auth\/v1\/admin\/users\/\$\{encodeURIComponent\(userId\)\}\/logout/);
  assert.match(completionRoute, /password-reset link is invalid, expired, or already used\. Request a new recovery email\./);
  assert.match(completionRoute, /if \(error instanceof SupabaseRequestError && \[400, 401, 403\]\.includes\(error\.status\) &&[\s\S]*?mode !== 'recovery' \|\| recoveryCleanupStage === 'not_started'[\s\S]*?status\(401\)\.json\(\{ message: invalidLinkMessage \}\)/);
  assert.match(serverSource, /sameSite:\s*'strict'[\s\S]*?path:\s*'\/api\/admin'/);
  assert.doesNotMatch(serverSource.slice(
    serverSource.indexOf('function setAdminSessionCookie'),
    serverSource.indexOf('function safeStringEqual'),
  ), /domain:/i);
});

test('temporary invitation callback requires explicit action and retains invite state while scrubbing the URL', () => {
  const search = '?mode=invite&invitation_generation=2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62&setup=temporary&token_hash=synthetic-test-token-hash&type=signup';
  const route = readAdminAuthRoute(search);
  const callback = readAdminAuthCallback(
    search,
    '',
    { length: 0, key: () => null, getItem: () => null },
    route.mode,
    true,
  );
  const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const authActionSource = readFileSync(new URL('../src/components/admin/AdminAuthAction.tsx', import.meta.url), 'utf8');
  const cleanupIndex = authActionSource.indexOf('window.history.replaceState');
  const callbackCaptureIndex = authActionSource.indexOf('readAdminAuthCallback(');

  assert.equal(route.mode, 'invite');
  assert.equal(route.temporaryCredential, true);
  assert.equal(callback.invitationGeneration, '2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62');
  assert.equal(callback.tokenType, 'signup');
  assert.equal(callback.error, undefined);
  assert.ok(callbackCaptureIndex < cleanupIndex);
  assert.match(appSource, /mode=\{callbackRoute\.mode\}[\s\S]*temporaryCredential=\{callbackRoute\.temporaryCredential\}[\s\S]*invitationSetup/);
  assert.match(authActionSource, /Verify invitation & continue/);
  assert.doesNotMatch(authActionSource, /attemptedAutomaticCompletion|sessionGate !== 'ready'.*completeSetup/);
  assert.match(authActionSource, /callbackAttempted \|\| sessionGate !== 'ready'/);
});

test('stale or absent invitation state is rejected before Supabase token verification', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const start = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const end = serverSource.indexOf("app.get('/api/admin/users'", start);
  const route = serverSource.slice(start, end);
  const generationCheck = route.indexOf('isCurrentPendingAdminInvitation(currentInvitation, invitationGeneration)');
  const verifyCall = route.indexOf("supabaseAuthRequest('verify'");

  assert.ok(generationCheck >= 0);
  assert.ok(verifyCall > generationCheck);
  assert.match(route, /This invitation is missing, invalid, expired, or no longer current\. Ask the Primary Owner to resend setup\./);
  assert.match(route, /pendingInvitation\s*&&[\s\S]*?identity\.id !== pendingInvitation\.id/);
});

test('previously consumed verification callbacks direct the recipient to reissue rather than retry', () => {
  const callback = readAdminAuthCallback(
    '?error=access_denied&error_code=otp_expired',
    '',
    { length: 0, key: () => null, getItem: () => null },
    'invite',
  );
  const authActionSource = readFileSync(new URL('../src/components/admin/AdminAuthAction.tsx', import.meta.url), 'utf8');

  assert.match(callback.error || '', /invalid, expired, or already used.*resend setup/i);
  assert.match(authActionSource, /callbackAttempted && error[\s\S]*?will not be submitted again/);
  assert.doesNotMatch(authActionSource, /Retry setup/);
});

test('Primary Owner sign-in and ordinary password recovery remain separate and available', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const pageSource = readFileSync(new URL('../src/components/admin/AdminPage.tsx', import.meta.url), 'utf8');
  const loginStart = serverSource.indexOf("app.post('/api/admin/login'");
  const loginEnd = serverSource.indexOf("app.get('/api/admin/session'", loginStart);
  const recoveryStart = serverSource.indexOf("app.post('/api/admin/auth/recovery'");
  const recoveryEnd = serverSource.indexOf("app.post('/api/admin/users/:id/recovery'", recoveryStart);
  const recoveryRoute = serverSource.slice(recoveryStart, recoveryEnd);
  const loginRoute = serverSource.slice(loginStart, loginEnd);

  assert.match(pageSource, /fetch\('\/api\/admin\/login'/);
  assert.match(loginRoute, /supabaseAuthRequest\('token\?grant_type=password'/);
  assert.match(recoveryRoute, /buildAdminPasswordResetRedirect\(adminAuthRedirectOrigin\(req\)\)/);
  assert.match(recoveryRoute, /supabaseAuthRequest\(`recover\?\$\{query\}`/);
  assert.match(pageSource, /Forgot password\? Send a secure recovery email/);
  assert.match(pageSource, /aria-label=\{showLoginPassword \? 'Hide password' : 'Show password'\}/);
});

test('admin setup fields and invitation history label credential visibility and delivery accurately', () => {
  const authActionSource = readFileSync(new URL('../src/components/admin/AdminAuthAction.tsx', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../src/components/admin/AdminSettings.tsx', import.meta.url), 'utf8');

  assert.match(authActionSource, /aria-label=\{showPassword \? 'Hide new password' : 'Show new password'\}/);
  assert.match(authActionSource, /aria-label=\{showConfirmPassword \? 'Hide confirmation password' : 'Show confirmation password'\}/);
  assert.match(settingsSource, /Verification Requested · Delivery Unconfirmed/);
  assert.doesNotMatch(settingsSource, /Invitation Sent · Email Not Verified/);
});

test('recovery completes pending CMS setup despite failed global Auth-session revocation', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const start = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const end = serverSource.indexOf("app.get('/api/admin/users'", start);
  const completionRoute = serverSource.slice(start, end);
  const passwordUpdateIndex = completionRoute.indexOf("method: 'PUT'");
  const sessionsRevocationIndex = completionRoute.indexOf("rest/v1/admin_sessions?");
  const finalSessionRevocationIndex = completionRoute.indexOf("rest/v1/admin_sessions?", sessionsRevocationIndex + 1);
  const refreshRevocationIndex = completionRoute.indexOf('revokeSupabaseRefreshTokens(verifiedAccessToken, identity.id)');
  const invitationCompletionIndex = completionRoute.lastIndexOf("'rest/v1/rpc/complete_admin_invitation'");
  const auditIndex = completionRoute.indexOf("writeAdminAudit(identity.id, 'auth.password.recovered'");
  const authActionSource = readFileSync(new URL('../src/components/admin/AdminAuthAction.tsx', import.meta.url), 'utf8');

  assert.ok(passwordUpdateIndex > completionRoute.indexOf("supabaseAuthRequest('verify'"));
  assert.ok(sessionsRevocationIndex < passwordUpdateIndex);
  assert.ok(finalSessionRevocationIndex > passwordUpdateIndex && finalSessionRevocationIndex < refreshRevocationIndex);
  assert.ok(refreshRevocationIndex > passwordUpdateIndex && refreshRevocationIndex < invitationCompletionIndex);
  assert.ok(invitationCompletionIndex > refreshRevocationIndex);
  assert.ok(auditIndex > passwordUpdateIndex);
  assert.match(completionRoute, /catch \(error\) \{\s*recoveryRefreshTokenRevocationFailed = true;[\s\S]*?if \(mode === 'invite'\) \{/);
  assert.match(completionRoute, /Your password and Admin setup are complete, and existing CMS sessions were revoked\. Warning: Supabase Auth sessions could not be globally revoked/);
  assert.match(completionRoute, /recoveryPasswordUpdateStarted = mode === 'recovery'/);
  assert.match(completionRoute, /recoveryPasswordUpdated = mode === 'recovery'/);
  assert.match(completionRoute, /recoveryPasswordUpdated\)[\s\S]*?password was changed and existing CMS sessions were revoked, but recovery cleanup did not finish/);
  assert.match(completionRoute, /recoveryPasswordUpdateStarted\)[\s\S]*?could not confirm whether your password was changed\. The account remains pending[\s\S]*?Do not retry this link/);
  assert.match(completionRoute, /recoveryAdminSessionsRevoked[\s\S]*?system could not confirm that existing CMS sessions were revoked/);
  assert.match(completionRoute, /finalSessionSweepComplete: recoveryFinalSessionSweepComplete/);
  assert.match(completionRoute, /recoveryFinalSessionSweepComplete[\s\S]*?account remains pending[\s\S]*?Treat any existing Admin session as potentially active/);
  assert.match(completionRoute, /recoveryCleanupStage === 'not_started'/);
  assert.match(completionRoute, /recoveryCleanupStage,[\s\S]*?adminSessionsRevoked: recoveryAdminSessionsRevoked,[\s\S]*?finalSessionSweepComplete: recoveryFinalSessionSweepComplete,[\s\S]*?refreshTokensRevoked: recoveryRefreshTokensRevoked/);
  assert.match(authActionSource, /let recoveryOutcomeUnknown = mode === 'recovery'/);
  assert.match(authActionSource, /recoveryOutcomeUnknown[\s\S]*?could not confirm whether your password was changed or whether all Admin sessions were revoked[\s\S]*?potentially active/);
});

test('verified pending Co-Owner recovery activates by invitation generation, not temporary-password RPC', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const invitationMigration = readFileSync(
    new URL('../supabase/migrations/20261028200000_secure_admin_invitation_recovery.sql', import.meta.url),
    'utf8',
  );
  const completionRouteStart = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const completionRouteEnd = serverSource.indexOf("app.get('/api/admin/users'", completionRouteStart);
  const completionRoute = serverSource.slice(completionRouteStart, completionRouteEnd);
  const invitationRpc = invitationMigration.slice(
    invitationMigration.indexOf('create or replace function public.complete_admin_invitation'),
    invitationMigration.indexOf('create or replace function public.prepare_admin_invitation_recovery'),
  );

  assert.match(completionRoute, /if \(identity\.status === 'pending'\)[\s\S]*?complete_admin_invitation[\s\S]*?p_must_change_password: false,[\s\S]*?p_invitation_generation: invitationGeneration/);
  assert.match(invitationRpc, /target_row\.is_primary_owner is distinct from false/i);
  assert.match(invitationRpc, /target_row\.invitation_generation is distinct from p_invitation_generation/i);
  assert.doesNotMatch(invitationRpc, /target_row\.role|role\s*=\s*'owner'/i);
  assert.doesNotMatch(completionRoute.slice(completionRoute.indexOf("if (mode === 'recovery') {")), /complete_admin_temporary_password_setup/);
});

test('global refresh-token revocation uses the user JWT, rejects 404s, and accepts successful logout', async () => {
  const accessToken = 'header.payload.signature';
  const expectedUserId = pendingIdentity.id;
  const requests: Array<{ pathname: string; method: string | undefined; token: string | undefined }> = [];
  const readResponse = async (response: Response): Promise<unknown> => {
    if (!response.ok) throw new Error(`Supabase request failed (${response.status}).`);
    const body = await response.text();
    return body ? JSON.parse(body) : undefined;
  };
  const request = async (pathname: string, init?: RequestInit, token?: string): Promise<Response> => {
    requests.push({ pathname, method: init?.method, token });
    return pathname === 'user'
      ? new Response(JSON.stringify({ id: expectedUserId }), { status: 200 })
      : new Response(null, { status: 204 });
  };

  await revokeSupabaseRefreshTokensWithAccessToken(accessToken, expectedUserId, request, readResponse);
  assert.deepEqual(requests, [{
    pathname: 'user',
    method: 'GET',
    token: accessToken,
  }, {
    pathname: 'logout?scope=global',
    method: 'POST',
    token: accessToken,
  }]);

  await assert.rejects(
    revokeSupabaseRefreshTokensWithAccessToken(accessToken, expectedUserId, async (pathname) => pathname === 'user'
      ? new Response(JSON.stringify({ id: expectedUserId }), { status: 200 })
      : new Response(null, { status: 404 }), readResponse),
    /Supabase request failed \(404\)/,
  );
  await assert.rejects(
    revokeSupabaseRefreshTokensWithAccessToken(expectedUserId, expectedUserId, request, readResponse),
    /access token could not be verified/,
  );
});

test('global sign-out rejects a JWT for a different account before calling logout', async () => {
  const accessToken = 'header.payload.signature';
  const requests: string[] = [];
  const request = async (pathname: string): Promise<Response> => {
    requests.push(pathname);
    return new Response(JSON.stringify({ id: 'f46dd026-fc56-4865-b4c7-f213f2c5076b' }), { status: 200 });
  };
  const readResponse = async (response: Response): Promise<unknown> => JSON.parse(await response.text());

  await assert.rejects(
    revokeSupabaseRefreshTokensWithAccessToken(accessToken, pendingIdentity.id, request, readResponse),
    /access token could not be verified/,
  );
  assert.deepEqual(requests, ['user']);
});

test('cross-account lifecycle responses never claim global Auth revocation without the target JWT', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const route = (start: string, end: string): string => {
    const routeStart = serverSource.indexOf(start);
    const routeEnd = serverSource.indexOf(end, routeStart);
    assert.ok(routeStart >= 0 && routeEnd > routeStart, `Could not locate route ${start}`);
    return serverSource.slice(routeStart, routeEnd);
  };
  const accessUpdate = route("app.put('/api/admin/users/:id'", "app.post('/api/admin/users/:id/recovery'");
  const recoveryRequest = route("app.post('/api/admin/users/:id/recovery'", "app.post('/api/admin/users/:id/cancel'");
  const cancellation = route("app.post('/api/admin/users/:id/cancel'", "app.post('/api/admin/users/:id/archive'");
  const archive = route("app.post('/api/admin/users/:id/archive'", "app.post('/api/admin/users/:id/password'");
  const temporaryPassword = route("app.post('/api/admin/users/:id/password'", "app.post('/api/admin/auth/first-password'");
  const sessionRevocation = route("app.post('/api/admin/users/:id/sessions/revoke'", "app.delete('/api/admin/users/:id'");
  const deletion = route("app.delete('/api/admin/users/:id'", "app.post('/api/admin/profile/password'");

  assert.doesNotMatch(serverSource, /revokeSupabaseRefreshTokens\((?:target(?:Id)?\.id|targetId|userId|newlyCreatedAuthUserId)/);
  for (const crossAccountRoute of [accessUpdate, recoveryRequest, cancellation, archive, sessionRevocation, deletion]) {
    assert.match(crossAccountRoute, /Supabase Auth sessions? could not be globally revoked|does not independently confirm global Supabase Auth-session revocation/);
  }
  assert.match(temporaryPassword, /setSupabaseUserPassword\(target\.id,\s*newPassword\)/);
  assert.match(temporaryPassword, /invalidates the account’s existing Auth sessions/);
  assert.doesNotMatch(temporaryPassword, /revokeSupabaseRefreshTokens/);
  assert.match(serverSource, /async function setSupabaseUserPassword\(userId: string, password: string\)[\s\S]*?auth\/v1\/admin\/users\/\$\{encodeURIComponent\(userId\)\}[\s\S]*?method: 'PUT'/);
  assert.match(accessUpdate, /status\(503\)/);
  assert.match(recoveryRequest, /status\(503\)/);
  assert.match(cancellation, /status\(503\)/);
  assert.match(archive, /status\(503\)/);
  assert.match(archive, /Supabase Auth sessions could not be globally revoked/);
  assert.match(sessionRevocation, /status\(503\)/);
  assert.match(deletion, /status\(503\)/);
  assert.doesNotMatch(serverSource, /Supabase refresh tokens were revoked/);
});

test('protected CMS requests continue to validate the live CMS session and Admin account state', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const activeSessionMigration = readFileSync(new URL('../supabase/migrations/20261025110000_admin_session_idle_timeout.sql', import.meta.url), 'utf8');
  const sessionStart = serverSource.indexOf('async function authenticateAdminSession');
  const sessionEnd = serverSource.indexOf('\nasync function ', sessionStart + 1);
  const authenticateSession = serverSource.slice(sessionStart, sessionEnd);
  const middlewareStart = serverSource.indexOf("app.use('/api/admin'");
  const middlewareEnd = serverSource.indexOf('\n  });', middlewareStart);
  const adminMiddleware = serverSource.slice(middlewareStart, middlewareEnd);

  assert.ok(sessionStart >= 0 && sessionEnd > sessionStart);
  assert.match(authenticateSession, /readAdminSession/);
  assert.match(authenticateSession, /get_active_admin_session/);
  assert.match(authenticateSession, /status !== 'active'/);
  assert.match(activeSessionMigration, /session\.revoked_at is null/i);
  assert.match(activeSessionMigration, /session\.expires_at > clock_timestamp\(\)/i);
  assert.match(adminMiddleware, /authenticateAdminSession\(req\)/);
  assert.match(adminMiddleware, /adminCmsAccessAllowed\(identity\)/);
});

test('self-service password changes revoke CMS sessions before fallible post-update cleanup', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const firstPasswordStart = serverSource.indexOf("app.post('/api/admin/auth/first-password'");
  const firstPasswordEnd = serverSource.indexOf("app.get('/api/admin/sessions/mine'", firstPasswordStart);
  const firstPasswordRoute = serverSource.slice(firstPasswordStart, firstPasswordEnd);
  const profilePasswordStart = serverSource.indexOf("app.post('/api/admin/profile/password'");
  const profilePasswordEnd = serverSource.indexOf('\n  app.', profilePasswordStart + 1);
  const profilePasswordRoute = serverSource.slice(profilePasswordStart, profilePasswordEnd);
  const profilePasswordUpdateIndex = profilePasswordRoute.indexOf("method: 'PUT'");
  const profileCmsRevocationIndex = profilePasswordRoute.indexOf("rest/v1/admin_sessions?");
  const profileAuthRevocationIndex = profilePasswordRoute.indexOf('revokeSupabaseRefreshTokens(accessToken, identity.id)');
  const profileMetadataIndex = profilePasswordRoute.indexOf("last_password_reset_at:");
  const profileAuditIndex = profilePasswordRoute.indexOf("writeAdminAudit(identity.id, 'auth.password.changed'");

  assert.match(firstPasswordRoute, /supabaseAuthRequest\('user'[\s\S]*?method: 'PUT'[\s\S]*?accessToken\)\)[\s\S]*?revokeSupabaseRefreshTokens\(accessToken,\s*identity\.id\)/);
  assert.match(profilePasswordRoute, /supabaseAuthRequest\('user'[\s\S]*?method: 'PUT'[\s\S]*?accessToken\)\)[\s\S]*?revokeSupabaseRefreshTokens\(accessToken,\s*identity\.id\)/);
  assert.ok(profilePasswordUpdateIndex < profileCmsRevocationIndex);
  assert.ok(profileCmsRevocationIndex < profileAuthRevocationIndex);
  assert.ok(profileCmsRevocationIndex < profileMetadataIndex && profileCmsRevocationIndex < profileAuditIndex);
  assert.match(profilePasswordRoute, /if \(passwordUpdateStarted && !cmsSessionsRevoked\)[\s\S]*?CMS session revocation after password change failed/);
  assert.match(profilePasswordRoute, /if \(passwordUpdateStarted\)[\s\S]*?res\.clearCookie\(ADMIN_SESSION_COOKIE/);
  assert.match(profilePasswordRoute, /password changed, but CMS session revocation could not be confirmed[\s\S]*?other Admin sessions may still be active/);
  assert.match(profilePasswordRoute, /password changed and CMS sessions were revoked, but Supabase Auth session revocation could not be confirmed/);
  assert.match(profilePasswordRoute, /Administrator password change failed\.', error instanceof Error \? error\.name : 'Unknown error'/);
  assert.doesNotMatch(profilePasswordRoute, /Administrator password change failed:', error\)/);
});

test('recovery retries require fresh one-time verification and never treat a reused token as success', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const start = serverSource.indexOf("app.post('/api/admin/auth/complete'");
  const end = serverSource.indexOf("app.get('/api/admin/users'", start);
  const completionRoute = serverSource.slice(start, end);
  const verifyIndex = completionRoute.indexOf("supabaseAuthRequest('verify'");
  const passwordUpdateIndex = completionRoute.indexOf("method: 'PUT'");
  const authActionSource = readFileSync(new URL('../src/components/admin/AdminAuthAction.tsx', import.meta.url), 'utf8');

  assert.ok(verifyIndex >= 0 && verifyIndex < passwordUpdateIndex);
  assert.match(completionRoute, /const allowedTypes = mode === 'invite' \? \['signup', 'invite'\] : \['recovery'\]/);
  assert.match(completionRoute, /error instanceof SupabaseRequestError && \[400, 401, 403\]\.includes\(error\.status\)/);
  assert.match(authActionSource, /if \(busy \|\| notice \|\| callbackAttempted \|\| sessionGate !== 'ready'\) return/);
  assert.match(authActionSource, /recoveryOutcomeUnknown[\s\S]*?request a new recovery email/);
});

test('recovery rejects incorrect identities and inactive account states', () => {
  assert.equal(decideAdminInvitationRecovery({
    ...pendingIdentity,
    email: 'different@example.com',
  }, verifiedAuthUser), 'reject');
  assert.equal(decideAdminInvitationRecovery({
    ...pendingIdentity,
    id: 'f46dd026-fc56-4865-b4c7-f213f2c5076b',
  }, verifiedAuthUser), 'reject');
  assert.equal(decideAdminInvitationRecovery({
    ...pendingIdentity,
    status: 'active',
  }, verifiedAuthUser), 'reject');
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
  assert.match(completionRoute, /mode === 'invite' \|\| invitationSetup === true \|\| invitationGeneration !== undefined/);
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
  const generationCheck = completionRoute.indexOf('isCurrentPendingAdminInvitation(currentInvitation, invitationGeneration)');
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
  assert.match(archiveRoute, /record was archived and CMS access remains blocked/);
  assert.doesNotMatch(archiveRoute, /auth\/v1\/admin\/users\/.*DELETE/i);
});

test('Primary Owner can cancel delegated Co-Owner invitations but never the Primary Owner record', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261029230000_allow_delegated_coowner_invitation_cancellation.sql', import.meta.url), 'utf8');
  const completionMigration = readFileSync(new URL('../supabase/migrations/20261028200000_secure_admin_invitation_recovery.sql', import.meta.url), 'utf8');
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const settingsSource = readFileSync(new URL('../src/components/admin/AdminSettings.tsx', import.meta.url), 'utf8');
  const functionStart = migration.indexOf('create or replace function public.cancel_admin_invitation');
  const functionEnd = migration.indexOf('revoke all on function public.cancel_admin_invitation');
  const cancellationSql = migration.slice(functionStart, functionEnd);
  const cancelStart = serverSource.indexOf("app.post('/api/admin/users/:id/cancel'");
  const cancelEnd = serverSource.indexOf("app.post('/api/admin/users/:id/archive'", cancelStart);
  const cancelRoute = serverSource.slice(cancelStart, cancelEnd);

  assert.match(cancellationSql, /where id = p_actor_id[\s\S]*?role = 'owner'[\s\S]*?status = 'active'[\s\S]*?is_primary_owner[\s\S]*?for share/i);
  assert.match(cancellationSql, /where id = p_target_id[\s\S]*?for update/i);
  assert.match(cancellationSql, /target_row\.is_primary_owner is distinct from false/i);
  assert.doesNotMatch(cancellationSql, /target_row\.role\s*=\s*'owner'/i);
  assert.match(cancellationSql, /target_row\.status <> 'pending'/i);
  assert.match(cancellationSql, /set status = 'disabled'[\s\S]*?invitation_generation = gen_random_uuid\(\)/i);
  assert.match(cancellationSql, /set revoked_at = cancelled_at[\s\S]*?where user_id = p_target_id/i);
  assert.match(cancellationSql, /insert into public\.admin_audit_logs[\s\S]*?'admin\.invitation\.cancelled'/i);
  assert.match(migration, /revoke all on function public\.cancel_admin_invitation\(uuid, uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.cancel_admin_invitation\(uuid, uuid\) to service_role/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);

  assert.match(completionMigration, /where id = p_user_id[\s\S]*?for update/i);
  assert.match(completionMigration, /target_row\.invitation_generation is distinct from p_invitation_generation/i);
  assert.match(completionMigration, /target_row\.is_primary_owner is distinct from false/i);
  assert.match(completionMigration, /target_row\.status is distinct from 'pending'/i);
  assert.match(cancelRoute, /reauthenticateAdminRequest\(req, res, actor/);
  assert.match(cancelRoute, /if \(!actor\.isPrimaryOwner\)/);
  assert.match(cancelRoute, /if \(target\.isPrimaryOwner\)/);
  assert.doesNotMatch(cancelRoute, /target\.role === 'owner'/);
  assert.match(cancelRoute, /p_actor_id: actor\.id,[\s\S]*?p_target_id: target\.id/);
  assert.match(serverSource, /isPrimaryOwner: row\.is_primary_owner === true/);
  assert.match(serverSource, /isPrimaryOwner: user\.is_primary_owner === true/);
  assert.match(settingsSource, /user\.status === 'pending' && !user\.isPrimaryOwner/);
  assert.doesNotMatch(settingsSource, /user\.status === 'pending' && user\.role !== 'owner'/);
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
  assert.match(templateGuide, /href="\{\{ \.RedirectTo \}\}&amp;token_hash=\{\{ \.TokenHash \}\}&amp;type=signup"/);
  assert.match(templateGuide, /href="\{\{ \.RedirectTo \}\}&amp;token_hash=\{\{ \.TokenHash \}\}&amp;type=recovery"/);
  assert.match(templateGuide, /The manually issued \*\*Invite user\*\* template uses Supabase's `\{\{ \.ConfirmationURL \}\}`/);
  assert.match(templateGuide, /token-hash verification succeeds only once/);
  assert.match(templateGuide, /Accept Invitation &amp; Set Up Account/);
  assert.match(templateGuide, /Reset your NearGrow Ads CMS password/);

  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.equal((serverSource.match(/buildAdminPasswordResetRedirect\(adminAuthRedirectOrigin\(req\)\)/g) || []).length, 2);
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
