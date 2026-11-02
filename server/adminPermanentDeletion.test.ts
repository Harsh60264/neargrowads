import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canPermanentlyDeleteAdmin,
  decideAdminAuthCleanup,
  isPermanentDeletionConfirmationValid,
} from './adminPermanentDeletion';

const migration = readFileSync(
  new URL('../supabase/migrations/20261102100000_secure_archived_admin_permanent_deletion.sql', import.meta.url),
  'utf8',
);
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const sqlRaceTest = readFileSync(
  new URL('../supabase/tests/admin_permanent_deletion_auth_email_race.sql', import.meta.url),
  'utf8',
);

const primaryOwner = { id: 'owner-id', isPrimaryOwner: true };
const archivedAdmin = {
  id: 'archived-id',
  role: 'custom_admin',
  status: 'disabled',
  isPrimaryOwner: false,
  archivedAt: '2026-10-31T12:00:00.000Z',
  wasRemoved: false,
  ownershipTransferCount: 0,
};

test('only the Primary Owner can initiate deletion of an archived delegated account', () => {
  assert.equal(canPermanentlyDeleteAdmin(primaryOwner, archivedAdmin), true);
  assert.equal(canPermanentlyDeleteAdmin({ id: 'admin-id', isPrimaryOwner: false }, archivedAdmin), false);
});

test('removal is eligible while active, Primary Owner, Co-Owner, and current accounts are protected', () => {
  assert.equal(canPermanentlyDeleteAdmin(primaryOwner, { ...archivedAdmin, archivedAt: null, wasRemoved: true }), true);
  assert.equal(canPermanentlyDeleteAdmin(primaryOwner, { ...archivedAdmin, id: primaryOwner.id }), false);
  assert.equal(canPermanentlyDeleteAdmin(primaryOwner, { ...archivedAdmin, role: 'owner' }), false);
  assert.equal(canPermanentlyDeleteAdmin(primaryOwner, { ...archivedAdmin, isPrimaryOwner: true }), false);
  assert.equal(canPermanentlyDeleteAdmin(primaryOwner, { ...archivedAdmin, status: 'active' }), false);
  assert.equal(canPermanentlyDeleteAdmin(primaryOwner, { ...archivedAdmin, archivedAt: null }), false);
});

test('ownership-transfer history disqualifies an otherwise archived account', () => {
  assert.equal(canPermanentlyDeleteAdmin(primaryOwner, { ...archivedAdmin, ownershipTransferCount: 1 }), false);
});

test('typed irreversible confirmation must identify the target email and contain DELETE', () => {
  assert.equal(isPermanentDeletionConfirmationValid('old-admin@example.test', ' OLD-ADMIN@example.test ', 'DELETE'), true);
  assert.equal(isPermanentDeletionConfirmationValid('old-admin@example.test', 'other@example.test', 'DELETE'), false);
  assert.equal(isPermanentDeletionConfirmationValid('old-admin@example.test', 'old-admin@example.test', 'delete'), false);
});

test('Auth cleanup deletes only the exact target identity and verifies email reuse after absence', () => {
  assert.equal(decideAdminAuthCleanup(
    'archived-id',
    'old-admin@example.test',
    { id: 'archived-id', email: 'old-admin@example.test' },
    { id: 'archived-id', email: 'old-admin@example.test' },
  ), 'delete-auth-user');
  assert.equal(decideAdminAuthCleanup('archived-id', 'old-admin@example.test', undefined, undefined), 'finalize');
  assert.equal(decideAdminAuthCleanup(
    'archived-id',
    'old-admin@example.test',
    undefined,
    { id: 'new-id', email: 'old-admin@example.test' },
  ), 'identity-conflict');
  assert.equal(decideAdminAuthCleanup(
    'archived-id',
    'old-admin@example.test',
    { id: 'archived-id', email: 'other@example.test' },
    undefined,
  ), 'identity-conflict');
});

test('retry state is durable while retained identity FKs preserve audit attribution', () => {
  assert.match(migration, /target_id uuid primary key references public\.admin_identity_history\(id\)/i);
  assert.match(migration, /status in \('auth_delete_pending', 'completed'\)/i);
  assert.match(migration, /email text primary key/i);
  assert.match(migration, /delete from public\.admin_users\s+where id = p_target_id/i);
  assert.match(migration, /create table if not exists public\.admin_identity_history/i);
  assert.match(migration, /REFERENCES public\.admin_identity_history\(id\)/i);
  assert.doesNotMatch(migration, /delete from public\.admin_audit_logs/i);
  assert.doesNotMatch(migration, /disable trigger|drop constraint[^;]*admin_audit/i);
});

test('the migration blocks Auth and CMS email claims while reserved and checks Auth identities inside completion', () => {
  assert.match(migration, /guard_admin_email_reservation/i);
  assert.match(migration, /admin_permanent_deletion_email_reservations/i);
  assert.match(migration, /create trigger auth_users_guard_reserved_email\s+before insert or update of email on auth\.users/i);
  assert.match(migration, /for key share/i);
  assert.match(migration, /tgfoid <> 'public\.guard_auth_email_reservation\(\)'::regprocedure/i);
  assert.match(migration, /tgtype <> 23/i);
  assert.match(migration, /tgenabled <> 'O'/i);
  assert.match(migration, /tgqual is not null/i);
  assert.match(migration, /tgnargs <> 0/i);
  assert.match(migration, /existing trigger auth_users_guard_reserved_email has an unexpected definition/i);
  assert.doesNotMatch(migration, /drop trigger[^;]*on auth\.users/i);
  assert.match(migration, /delete from public\.admin_permanent_deletion_email_reservations/i);
  assert.match(migration, /from auth\.users as auth_user[\s\S]*auth_user\.id = p_target_id[\s\S]*lower\(auth_user\.email\) = job_row\.target_email/i);
  assert.match(migration, /drop function if exists public\.complete_admin_permanent_deletion\(uuid, uuid, boolean, boolean\)/i);
});

test('all migration triggers are installed idempotently and reject unexpected pre-existing definitions', () => {
  const triggerNames = [
    'admin_users_sync_identity_history',
    'admin_users_guard_reserved_email',
    'auth_users_guard_reserved_email',
    'admin_users_guard_pending_permanent_deletion',
  ];

  assert.doesNotMatch(migration, /drop trigger/i);
  for (const triggerName of triggerNames) {
    assert.match(migration, new RegExp(`tgname = '${triggerName}'`, 'i'));
    assert.match(migration, new RegExp(`existing trigger ${triggerName} has an unexpected definition`, 'i'));
  }
  assert.equal((migration.match(/tgenabled <> 'O'/gi) ?? []).length, triggerNames.length);
});

test('email claims, reservation creation, and finalization share a transaction-scoped advisory lock', () => {
  assert.match(migration, /create or replace function public\.lock_admin_email_reservation/i);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*hashtextextended\(lower\(p_email\), 0\)/i);
  assert.match(migration, /guard_admin_email_reservation\(\)[\s\S]*lock_admin_email_reservation\(lower\(new\.email\)\)/i);
  assert.match(migration, /guard_auth_email_reservation\(\)[\s\S]*lock_admin_email_reservation\(lower\(new\.email\)\)/i);
  assert.match(migration, /lock_admin_email_reservation\(target_row\.email\)/i);
  assert.match(migration, /lock_admin_email_reservation\(job_row\.target_email\)[\s\S]*for update/i);
  assert.match(migration, /revoke all on function public\.lock_admin_email_reservation\(text\) from public, anon, authenticated/i);
});

test('parallel requests serialize on the target row and only one permanent-deletion job can exist', () => {
  assert.match(migration, /target_id uuid primary key/i);
  assert.match(migration, /where id = p_target_id\s+for update/i);
  assert.match(migration, /where target_id = p_target_id\s+for update/i);
  assert.match(migration, /email text primary key/i);
});

test('starting cleanup revokes CMS sessions and invalidates invitation and temporary-password state', () => {
  const start = migration.indexOf('create or replace function public.begin_admin_permanent_deletion');
  const end = migration.indexOf('create or replace function public.record_admin_permanent_deletion_failure', start);
  const beginFunction = migration.slice(start, end);

  assert.match(beginFunction, /invitation_generation = gen_random_uuid\(\)/i);
  assert.match(beginFunction, /must_change_password = false/i);
  assert.match(beginFunction, /temporary_password_expires_at = null/i);
  assert.match(beginFunction, /temporary_password_used_at = null/i);
  assert.match(beginFunction, /update public\.admin_sessions[\s\S]*revoked_at = started_at_value/i);
});

test('reserved emails are released only after completion locks the reservation and checks Auth identities directly', () => {
  const finalizeStart = migration.indexOf('create or replace function public.complete_admin_permanent_deletion');
  const finalizeFunction = migration.slice(finalizeStart);

  assert.match(finalizeFunction, /where reservation\.target_id = p_target_id[\s\S]*for update/i);
  assert.match(finalizeFunction, /from auth\.users as auth_user/i);
  assert.match(finalizeFunction, /return jsonb_build_object\('status', 'auth_identity_present'\)/i);
  assert.match(finalizeFunction, /delete from public\.admin_users\s+where id = p_target_id/i);
  assert.match(finalizeFunction, /exists \(select 1 from public\.admin_users where id = p_target_id\)/i);
  assert.match(finalizeFunction, /exists \(select 1 from public\.admin_users where email = job_row\.target_email\)/i);
  assert.match(finalizeFunction, /delete from public\.admin_permanent_deletion_email_reservations/i);
  assert.ok(finalizeFunction.indexOf('from auth.users as auth_user') <
    finalizeFunction.indexOf('delete from public.admin_users'));
  assert.ok(finalizeFunction.indexOf('delete from public.admin_permanent_deletion_email_reservations') <
    finalizeFunction.indexOf("set status = 'completed'"));
});

test('failed cleanup remains retryable and audit records retain original actor and target identifiers', () => {
  assert.match(migration, /last_error_stage = p_stage/i);
  assert.match(migration, /last_error_code = left\(coalesce\(p_error_code/i);
  assert.match(migration, /where target_id = p_target_id and status = 'auth_delete_pending'/i);
  assert.match(migration, /'originalActorId', job_row\.actor_id/i);
  assert.match(migration, /'identityId', p_target_id/i);
  assert.match(migration, /REFERENCES public\.admin_identity_history\(id\)/i);
});

test('a pending deletion cannot be restored or reassigned before finalization', () => {
  assert.match(migration, /guard_admin_permanent_deletion_in_progress/i);
  assert.match(migration, /new\.status <> 'disabled'/i);
  assert.match(migration, /new\.email is distinct from old\.email/i);
  assert.match(migration, /new\.role is distinct from old\.role/i);
  assert.match(migration, /new\.is_primary_owner is distinct from old\.is_primary_owner/i);
});

test('the deletion route requires the Primary Owner, fresh re-authentication, and delegates final Auth verification to SQL', () => {
  const routeStart = server.indexOf("app.post('/api/admin/users/:id/permanent-delete'");
  const routeEnd = server.indexOf('\n  app.', routeStart + 1);
  const route = server.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0);
  assert.match(route, /requireOwner\(req, res\)/);
  assert.match(route, /actor\.role !== 'owner' \|\| !actor\.isPrimaryOwner/);
  assert.match(route, /reauthenticateAdminRequest\(/);
  assert.match(route, /begin_admin_permanent_deletion/);
  assert.match(route, /findSupabaseUserByEmail\(targetEmail\)/);
  assert.match(route, /decideAdminAuthCleanup\(targetId, targetEmail/);
  assert.match(route, /deleteSupabaseUser\(targetId\)/);
  assert.doesNotMatch(route, /p_auth_identity_absent|p_email_identity_absent/);
  assert.match(route, /completed\.status === 'auth_identity_present'/);
  assert.ok(route.indexOf('begin_admin_permanent_deletion') < route.indexOf('deleteSupabaseUser(targetId)'));
  assert.ok(route.indexOf('deleteSupabaseUser(targetId)') < route.indexOf('complete_admin_permanent_deletion'));
});

test('SQL race regression inserts a competing Auth identity after verification and asserts reservation serialization', () => {
  assert.match(sqlRaceTest, /server-side Auth absence check completed/i);
  assert.match(sqlRaceTest, /insert into auth\.users/i);
  assert.match(sqlRaceTest, /complete_admin_permanent_deletion/i);
  assert.match(sqlRaceTest, /direct-check@example\.test/i);
  assert.match(sqlRaceTest, /auth_identity_present/i);
  assert.match(sqlRaceTest, /email_reusable_only_after_cleanup/i);
  assert.match(sqlRaceTest, /rollback/i);
});
