import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizePartnerEmail,
  normalizePartnerMobile,
  normalizePartnerName,
  partnerPasswordIsStrong,
  validatePartnerRegistration,
} from './partnerAuth';

test('partner registration validation requires isolated profile fields and a strong password', () => {
  assert.equal(normalizePartnerEmail('  Partner@Example.COM  '), 'partner@example.com');
  assert.equal(normalizePartnerMobile('+91 (98765) 43210'), '+919876543210');
  assert.equal(normalizePartnerName('  Delivery   Partner  '), 'Delivery Partner');
  assert.equal(partnerPasswordIsStrong('Password123!'), true);
  assert.equal(partnerPasswordIsStrong('password123'), false);

  assert.deepEqual(validatePartnerRegistration({
    email: 'partner@example.com',
    password: 'Password123!',
    mobileNumber: '+91 98765 43210',
    fullName: 'Delivery Partner',
  }), {
    valid: true,
    email: 'partner@example.com',
    password: 'Password123!',
    mobileNumber: '+919876543210',
    fullName: 'Delivery Partner',
  });
});

test('partner registration rejects malformed email, mobile, name and weak passwords', () => {
  assert.equal(validatePartnerRegistration({
    email: 'not-an-email',
    password: 'Password123!',
    mobileNumber: '+91 98765 43210',
    fullName: 'Delivery Partner',
  }).valid, false);
  assert.equal(validatePartnerRegistration({
    email: 'partner@example.com',
    password: 'weak',
    mobileNumber: '+91 98765 43210',
    fullName: 'Delivery Partner',
  }).valid, false);
  assert.equal(validatePartnerRegistration({
    email: 'partner@example.com',
    password: 'Password123!',
    mobileNumber: '12',
    fullName: 'Delivery Partner',
  }).valid, false);
});

test('partner SQL migration is isolated by separate tables, RLS and service-role-only grants', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261123120000_partner_identity_isolation.sql', import.meta.url), 'utf8');
  assert.match(migration, /create table if not exists public\.partner_profiles/i);
  assert.match(migration, /create table if not exists public\.partner_sessions/i);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
  assert.match(migration, /alter table public\.partner_profiles enable row level security/i);
  assert.match(migration, /alter table public\.partner_sessions enable row level security/i);
  assert.match(migration, /revoke all on public\.partner_profiles, public\.partner_sessions\s+from public, anon, authenticated/i);
  assert.match(migration, /grant all on public\.partner_profiles, public\.partner_sessions\s+to service_role/i);
  assert.doesNotMatch(migration, /grant .*to authenticated|create policy/i);
});

test('partner routes and authorization keep partner sessions separate from CMS admin middleware', () => {
  const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(server, /PARTNER_SESSION_COOKIE = 'neargrow_partner_session'/);
  assert.match(server, /app\.post\('\/api\/partners\/register'/);
  assert.match(server, /app\.post\('\/api\/partners\/login'/);
  assert.match(server, /app\.post\('\/api\/partners\/logout'/);
  assert.match(server, /app\.post\('\/api\/partners\/auth\/recovery'/);
  assert.match(server, /app\.post\('\/api\/partners\/auth\/complete'/);
  assert.match(server, /app\.get\('\/api\/partners\/dashboard'/);
  assert.match(server, /app_metadata: \{ account_type: 'partner' \}/);
  assert.match(server, /adminRows\.length/);
  assert.match(server, /readPartnerProfile\(userId\)/);
  assert.match(server, /partner_sessions/);
  assert.doesNotMatch(server, /res\.locals\.partnerIdentity\s*=\s*res\.locals\.adminIdentity/);
  assert.match(app, /currentPath === '\/partners\/dashboard'/);
  assert.match(app, /currentPath === '\/partners\/recovery'/);
});
