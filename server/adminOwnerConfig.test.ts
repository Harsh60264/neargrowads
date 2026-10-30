import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  resolveAdminOwnerConfiguration,
  STAGING_SUPABASE_PROJECT_REF,
  validatePreviewAdminConfiguration,
} from './adminOwnerConfig';

const ownerId = '2ca7a30c-7bdd-4fa8-83d6-e1fd29e5af62';
const productionOwnerId = '6bd253f5-6485-4d49-9e03-171281c093d4';
const stagingProjectRef = STAGING_SUPABASE_PROJECT_REF;
const stagingOwnerEmail = 'staging-owner@example.com';

function fakeSupabaseJwt(ref: string, role: 'anon' | 'service_role'): string {
  const payload = Buffer.from(JSON.stringify({ ref, role }), 'utf8').toString('base64url');
  return `header.${payload}.signature`;
}

function previewEnvironment(): NodeJS.ProcessEnv {
  const anonKey = fakeSupabaseJwt(stagingProjectRef, 'anon');
  const serviceRoleKey = fakeSupabaseJwt(stagingProjectRef, 'service_role');
  return {
    ADMIN_OWNER_USER_ID: ownerId,
    ADMIN_OWNER_EMAIL: stagingOwnerEmail,
    ADMIN_STAGING_OWNER_USER_ID: ownerId,
    ADMIN_STAGING_OWNER_EMAIL: stagingOwnerEmail,
    ADMIN_STAGING_SUPABASE_PROJECT_REF: stagingProjectRef,
    SUPABASE_URL: `https://${stagingProjectRef}.supabase.co`,
    SUPABASE_ANON_KEY: anonKey,
    ADMIN_STAGING_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    ADMIN_SESSION_SECRET: 'staging-session-secret-that-is-at-least-32-characters',
    ADMIN_STAGING_SESSION_SECRET: 'staging-session-secret-that-is-at-least-32-characters',
    SITE_URL: 'https://neargrowads-git-staging-preview.vercel.app',
    VERCEL_ENV: 'preview',
  };
}

test('accepts a configured Production Owner identity without modifying its source identity', () => {
  assert.deepEqual(resolveAdminOwnerConfiguration({
    ADMIN_OWNER_USER_ID: ownerId,
    ADMIN_OWNER_EMAIL: 'owner@example.com',
    SUPABASE_URL: 'https://production-project.supabase.co',
    VERCEL_ENV: 'production',
  }), {
    ownerId,
    ownerEmail: 'owner@example.com',
  });
});

test('accepts a distinct Owner only in Preview when the Supabase URL matches the staging project ref', () => {
  const environment = previewEnvironment();
  validatePreviewAdminConfiguration(environment);
  assert.deepEqual(resolveAdminOwnerConfiguration(environment), {
    ownerId,
    ownerEmail: stagingOwnerEmail,
  });
});

test('identifies the failing Preview configuration variable without exposing its value', () => {
  const environment = previewEnvironment();
  const cases: Array<[Partial<NodeJS.ProcessEnv>, string]> = [
    [{ ADMIN_STAGING_SUPABASE_PROJECT_REF: '' }, 'ADMIN_STAGING_SUPABASE_PROJECT_REF'],
    [{ SUPABASE_URL: 'https://wrong-project.supabase.co' }, 'SUPABASE_URL'],
    [{ ADMIN_STAGING_OWNER_USER_ID: '' }, 'ADMIN_OWNER_USER_ID / ADMIN_STAGING_OWNER_USER_ID'],
    [{ ADMIN_STAGING_OWNER_EMAIL: '' }, 'ADMIN_OWNER_EMAIL / ADMIN_STAGING_OWNER_EMAIL'],
    [{ SUPABASE_ANON_KEY: '' }, 'SUPABASE_ANON_KEY / ADMIN_STAGING_SUPABASE_ANON_KEY'],
    [{ SUPABASE_SERVICE_ROLE_KEY: 'different' }, 'SUPABASE_SERVICE_ROLE_KEY / ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY'],
    [{ SITE_URL: '' }, 'SITE_URL'],
    [{ ADMIN_SESSION_SECRET: '' }, 'ADMIN_SESSION_SECRET'],
    [{ ADMIN_STAGING_SESSION_SECRET: 'different-secret' }, 'ADMIN_SESSION_SECRET / ADMIN_STAGING_SESSION_SECRET'],
  ];

  for (const [changes, expectedVariable] of cases) {
    assert.throws(
      () => validatePreviewAdminConfiguration({ ...environment, ...changes }),
      (error: unknown) => error instanceof Error &&
        'configurationVariable' in error &&
        error.configurationVariable === expectedVariable &&
        !error.message.includes('different-secret'),
    );
  }
});

test('fails closed for missing, incorrect, or mutually consistent non-staging project settings', () => {
  const environment = previewEnvironment();
  for (const changes of [
    { ADMIN_STAGING_SUPABASE_PROJECT_REF: '' },
    { ADMIN_STAGING_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst' },
    { SUPABASE_URL: 'https://axbjzmdokfoftzfgwiql.supabase.co' },
    { SUPABASE_URL: 'https://another-project.supabase.co', ADMIN_STAGING_SUPABASE_PROJECT_REF: 'anotherprojectref123' },
  ]) {
    assert.throws(
      () => validatePreviewAdminConfiguration({ ...environment, ...changes }),
      /verified staging project|staging project/i,
    );
  }
});

test('rejects missing and mismatched staging-only owner and key bindings', () => {
  const environment = previewEnvironment();
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    ADMIN_STAGING_OWNER_USER_ID: '',
  }), /ADMIN_STAGING_OWNER_USER_ID/i);
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    ADMIN_STAGING_OWNER_EMAIL: 'production-owner@example.com',
  }), /ADMIN_STAGING_OWNER_EMAIL/i);
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    ADMIN_STAGING_SUPABASE_ANON_KEY: 'different-staging-key',
  }), /ADMIN_STAGING_SUPABASE_ANON_KEY/i);
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY: '',
  }), /ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY/i);
});

test('rejects detectable Production JWT keys and wrong Supabase key roles in Preview', () => {
  const environment = previewEnvironment();
  const productionServiceKey = fakeSupabaseJwt('axbjzmdokfoftzfgwiql', 'service_role');
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    SUPABASE_SERVICE_ROLE_KEY: productionServiceKey,
    ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY: productionServiceKey,
  }), /Production Supabase project/i);

  const wrongRole = fakeSupabaseJwt(stagingProjectRef, 'service_role');
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    SUPABASE_ANON_KEY: wrongRole,
    ADMIN_STAGING_SUPABASE_ANON_KEY: wrongRole,
  }), /unexpected Supabase JWT role/i);
});

test('rejects Production Owner identity reuse when the Production identity is explicitly available', () => {
  const environment = previewEnvironment();
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    ADMIN_OWNER_USER_ID: productionOwnerId,
    ADMIN_STAGING_OWNER_USER_ID: productionOwnerId,
    ADMIN_PRODUCTION_OWNER_USER_ID: productionOwnerId,
  }), /must not match ADMIN_PRODUCTION_OWNER_USER_ID/i);
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    ADMIN_OWNER_EMAIL: 'production-owner@example.com',
    ADMIN_STAGING_OWNER_EMAIL: 'production-owner@example.com',
    ADMIN_PRODUCTION_OWNER_EMAIL: 'production-owner@example.com',
  }), /must not match ADMIN_PRODUCTION_OWNER_EMAIL/i);
});

test('rejects a Production SITE_URL and missing Preview session secret', () => {
  const environment = previewEnvironment();
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    SITE_URL: 'https://www.neargrowads.com',
  }), /non-Production HTTPS origin/i);
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    ADMIN_SESSION_SECRET: '',
  }), /ADMIN_SESSION_SECRET/i);
  assert.throws(() => validatePreviewAdminConfiguration({
    ...environment,
    ADMIN_STAGING_SESSION_SECRET: 'different-staging-secret-that-is-long-enough',
  }), /ADMIN_STAGING_SESSION_SECRET/i);
});

test('staging-only configuration is prohibited outside Vercel Preview', () => {
  assert.throws(() => resolveAdminOwnerConfiguration({
    ...previewEnvironment(),
    VERCEL_ENV: 'production',
  }), /only be set/i);
});

test('requires a valid owner UUID and a strict lowercase email', () => {
  const validEnvironment = {
    ADMIN_OWNER_USER_ID: ownerId,
    ADMIN_OWNER_EMAIL: 'owner@example.com',
    SUPABASE_URL: 'https://production-project.supabase.co',
    VERCEL_ENV: 'production',
  };
  assert.throws(() => resolveAdminOwnerConfiguration({
    ...validEnvironment,
    ADMIN_OWNER_USER_ID: 'not-an-id',
  }), /UUID/i);
  assert.throws(() => resolveAdminOwnerConfiguration({
    ...validEnvironment,
    ADMIN_OWNER_EMAIL: 'Owner@example.com',
  }), /lowercase/i);
  assert.throws(() => resolveAdminOwnerConfiguration({
    ...validEnvironment,
    ADMIN_OWNER_EMAIL: '',
  }), /lowercase/i);
});

test('bootstrap binds only the configured verified Auth identity and respects the database owner flag', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const start = serverSource.indexOf('async function ensurePrimaryOwnerAccount()');
  const end = serverSource.indexOf('\nfunction fromSupabaseLead', start);
  const bootstrap = serverSource.slice(start, end);

  assert.match(bootstrap, /authUser\.id !== ownerId[\s\S]*authUser\.email\?\.toLowerCase\(\) !== ownerEmail[\s\S]*!authUser\.email_confirmed_at/);
  assert.match(bootstrap, /select: 'id,email,role,status,is_primary_owner'/);
  assert.match(bootstrap, /ownerRecord\.is_primary_owner !== true/);
  assert.match(bootstrap, /is_primary_owner: true/);
  assert.doesNotMatch(bootstrap, /setSupabaseUserPassword|revokeSupabaseRefreshTokens/);
});

test('Vercel Preview validates its pinned environment before application routes can access Supabase', () => {
  const serverSource = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const createApplicationStart = serverSource.indexOf('async function createApplication(');
  const createApplication = serverSource.slice(createApplicationStart);

  assert.match(createApplication, /if \(process\.env\.VERCEL_ENV === 'preview'\)\s*\{\s*validatePreviewAdminConfiguration\(process\.env\);/);
  assert.ok(createApplication.indexOf('validatePreviewAdminConfiguration(process.env)') <
    createApplication.indexOf('ensurePrimaryOwnerAccount()'));
});
