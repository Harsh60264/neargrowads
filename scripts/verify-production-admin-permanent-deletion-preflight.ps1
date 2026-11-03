[CmdletBinding()]
param(
  [string]$ProjectRef = 'axbjzmdokfoftzfgwiql',
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [switch]$SchemaEvidenceFallback
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'productionAdminDeletionCheck.Common.ps1')
Assert-ProductionAdminDeletionTarget -ProjectRef $ProjectRef

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDirectory = Join-Path $repoRoot 'supabase\migrations'
$localMigrations = Get-ProductionAdminDeletionMigrationInventory -MigrationDirectory $migrationDirectory
$migrationFile = Join-Path $migrationDirectory '20261102100000_secure_archived_admin_permanent_deletion.sql'
Write-Output "Migration 36 SHA-256: $((Get-FileHash -LiteralPath $migrationFile -Algorithm SHA256).Hash)"

$sql = @'
SET default_transaction_read_only = on;
SELECT 'CHECK|production_target|' ||
  CASE WHEN current_database() = 'postgres'
    AND current_user = 'postgres'
    AND to_regclass('auth.users') IS NOT NULL
    AND has_schema_privilege(current_user, 'auth', 'USAGE')
    AND has_schema_privilege(current_user, 'public', 'CREATE')
    AND has_table_privilege(current_user, 'auth.users', 'TRIGGER')
  THEN 'PASS' ELSE 'FAIL' END ||
  '|database=' || current_database() || ';role=' || current_user ||
  ';auth_trigger_privilege=' || has_table_privilege(current_user, 'auth.users', 'TRIGGER');

SELECT 'CHECK|admin_schema_prerequisites|' ||
  CASE WHEN
    to_regclass('public.admin_users') IS NOT NULL
    AND to_regclass('public.admin_sessions') IS NOT NULL
    AND to_regclass('public.admin_audit_logs') IS NOT NULL
    AND to_regclass('public.admin_ownership_transfers') IS NOT NULL
    AND to_regclass('public.site_content_cms') IS NOT NULL
    AND to_regclass('public.service_store_payment_settings') IS NOT NULL
    AND to_regclass('public.service_store_payment_audit') IS NOT NULL
    AND to_regclass('public.site_content_revisions') IS NOT NULL
    AND to_regclass('public.security_events') IS NOT NULL
    AND to_regclass('public.security_alerts') IS NOT NULL
    AND to_regclass('public.security_detection_rules') IS NOT NULL
    AND (
      SELECT count(*) = 17
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'admin_users' AND column_name IN (
            'id', 'email', 'role', 'status', 'is_primary_owner', 'created_at',
            'updated_at', 'username', 'permissions', 'archived_at',
            'must_change_password', 'temporary_password_expires_at',
            'temporary_password_used_at', 'invitation_generation'
          ))
          OR (table_name = 'admin_sessions' AND column_name = 'user_id')
          OR (table_name = 'admin_audit_logs' AND column_name IN ('actor_id', 'target_id'))
        )
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|required Admin/CMS tables and deletion prerequisite columns must exist';

SELECT 'CHECK|identity_history_setup_prerequisite|' ||
  CASE WHEN
    to_regprocedure('public.get_active_admin_session(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.complete_admin_temporary_password_setup(uuid,uuid)') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.get_active_admin_session(uuid,uuid)')
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        )
        AND lower(pg_get_functiondef(p.oid)) LIKE '%account.temporary_password_expires_at > clock_timestamp()%'
        AND lower(pg_get_functiondef(p.oid)) LIKE '%account.status = ''active''%'
        AND lower(pg_get_functiondef(p.oid)) LIKE '%account.archived_at is null%'
    )
    AND EXISTS (
      SELECT 1
      FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.complete_admin_temporary_password_setup(uuid,uuid)')
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        )
        AND lower(pg_get_functiondef(p.oid)) LIKE '%target_row.must_change_password is distinct from true%'
        AND lower(pg_get_functiondef(p.oid)) LIKE '%target_row.temporary_password_expires_at <= clock_timestamp()%'
        AND lower(pg_get_functiondef(p.oid)) LIKE '%for update%'
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|SQL-Editor setup RPCs must have the verified active-account, expiry and locking safeguards';

SELECT 'CHECK|admin_core_access|' ||
  CASE WHEN (
    SELECT count(*) = 4
    FROM pg_class relation
    WHERE relation.oid IN (
      to_regclass('public.admin_users'),
      to_regclass('public.admin_sessions'),
      to_regclass('public.admin_audit_logs'),
      to_regclass('public.admin_ownership_transfers')
    )
      AND relation.relrowsecurity
      AND has_table_privilege('service_role', relation.oid, 'SELECT')
      AND has_table_privilege('service_role', relation.oid, 'INSERT')
      AND has_table_privilege('service_role', relation.oid, 'UPDATE')
      AND has_table_privilege('service_role', relation.oid, 'DELETE')
      AND has_table_privilege('service_role', relation.oid, 'TRUNCATE')
      AND has_table_privilege('service_role', relation.oid, 'REFERENCES')
      AND has_table_privilege('service_role', relation.oid, 'TRIGGER')
      AND NOT has_table_privilege('anon', relation.oid, 'SELECT')
      AND NOT has_table_privilege('anon', relation.oid, 'INSERT')
      AND NOT has_table_privilege('anon', relation.oid, 'UPDATE')
      AND NOT has_table_privilege('anon', relation.oid, 'DELETE')
      AND NOT has_table_privilege('authenticated', relation.oid, 'SELECT')
      AND NOT has_table_privilege('authenticated', relation.oid, 'INSERT')
      AND NOT has_table_privilege('authenticated', relation.oid, 'UPDATE')
      AND NOT has_table_privilege('authenticated', relation.oid, 'DELETE')
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
        WHERE acl.grantee = 0
      )
  ) THEN 'PASS' ELSE 'FAIL' END ||
  '|Admin core tables must retain RLS, service_role CRUD and no PUBLIC/anon/authenticated direct DML';

SELECT 'CHECK|admin_auth_identity_fk|' ||
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    WHERE constraint_row.contype = 'f'
      AND constraint_row.conrelid = to_regclass('public.admin_users')
      AND constraint_row.confrelid = to_regclass('auth.users')
      AND constraint_row.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('public.admin_users') AND attname = 'id' AND NOT attisdropped)
      ]::smallint[]
      AND constraint_row.confkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = to_regclass('auth.users') AND attname = 'id' AND NOT attisdropped)
      ]::smallint[]
      AND constraint_row.confdeltype = 'c'
      AND constraint_row.convalidated
  ) THEN 'PASS' ELSE 'FAIL' END ||
  '|admin_users.id must reference auth.users.id with validated ON DELETE CASCADE';

SELECT 'CHECK|uuid_generation_prerequisite|' ||
  CASE WHEN to_regprocedure('gen_random_uuid()') IS NOT NULL
  THEN 'PASS' ELSE 'FAIL' END ||
  '|gen_random_uuid() must resolve for deletion generation rotation';

SELECT 'CHECK|migration_36_objects_absent|' ||
  CASE WHEN
    to_regclass('public.admin_identity_history') IS NULL
    AND to_regclass('public.admin_permanent_deletion_jobs') IS NULL
    AND to_regclass('public.admin_permanent_deletion_email_reservations') IS NULL
    AND to_regprocedure('public.get_admin_permanent_deletion_state(uuid)') IS NULL
    AND to_regprocedure('public.begin_admin_permanent_deletion(uuid,uuid,text,text)') IS NULL
    AND to_regprocedure('public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)') IS NULL
    AND to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid)') IS NULL
    AND to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid,boolean,boolean)') IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_trigger t
      WHERE NOT t.tgisinternal
        AND (
          t.tgname IN (
            'admin_users_sync_identity_history',
            'admin_users_guard_reserved_email',
            'auth_users_guard_reserved_email',
            'admin_users_guard_pending_permanent_deletion'
          )
        )
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Migration 36 tables, functions and trigger names must not be partially installed';

SELECT to_regnamespace('supabase_migrations') IS NOT NULL AS migration_schema_present \gset
\if :migration_schema_present
SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS migration_table_present \gset
\if :migration_table_present
SELECT has_schema_privilege(current_user, 'supabase_migrations', 'USAGE')
  AND has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT')
  AS migration_table_readable \gset
\if :migration_table_readable
SELECT count(*) > 0 AS migration_ledger_has_rows
FROM supabase_migrations.schema_migrations \gset
\if :migration_ledger_has_rows
SELECT 'CHECK|migration_ledger|READABLE|ledger table exists, SELECT is allowed, and rows are present';
SELECT 'MIGRATION|' || version::text || '|' || coalesce(name, '')
FROM supabase_migrations.schema_migrations
ORDER BY version;
\else
SELECT 'CHECK|migration_ledger|EMPTY|ledger table is readable but contains no rows';
\endif
\else
SELECT 'CHECK|migration_ledger|INACCESSIBLE|ledger table exists but current role lacks SELECT';
\endif
\else
SELECT 'CHECK|migration_ledger|ABSENT_TABLE|supabase_migrations.schema_migrations does not exist';
\endif
\else
SELECT 'CHECK|migration_ledger|ABSENT_SCHEMA|supabase_migrations schema does not exist';
\endif

SELECT 'LEDGER_CANDIDATE|' || table_schema || '.' || table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'supabase_migrations')
  AND table_schema NOT IN ('auth', 'realtime', 'storage')
  AND table_type = 'BASE TABLE'
  AND table_name ~* '(migration|schema_history|flyway|knex|prisma|drizzle)'
ORDER BY table_schema, table_name;

SELECT 'ADMIN_FK|' ||
  source_namespace.nspname || '|' ||
  source_table.relname || '|' ||
  array_to_string(ARRAY(
    SELECT source_column.attname
    FROM unnest(foreign_key.conkey) WITH ORDINALITY AS source_key(attnum, ordinality)
    JOIN pg_attribute source_column
      ON source_column.attrelid = source_table.oid
      AND source_column.attnum = source_key.attnum
    ORDER BY source_key.ordinality
  ), ',') || '|' ||
  target_namespace.nspname || '|' ||
  target_table.relname || '|' ||
  array_to_string(ARRAY(
    SELECT target_column.attname
    FROM unnest(foreign_key.confkey) WITH ORDINALITY AS target_key(attnum, ordinality)
    JOIN pg_attribute target_column
      ON target_column.attrelid = target_table.oid
      AND target_column.attnum = target_key.attnum
    ORDER BY target_key.ordinality
  ), ',') || '|' || foreign_key.conname
FROM pg_constraint foreign_key
JOIN pg_class source_table ON source_table.oid = foreign_key.conrelid
JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
JOIN pg_class target_table ON target_table.oid = foreign_key.confrelid
JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
WHERE foreign_key.contype = 'f'
  AND source_namespace.nspname = 'public'
  AND source_table.relname IN (
    'admin_users',
    'admin_sessions',
    'admin_audit_logs',
    'admin_ownership_transfers',
    'site_content_cms',
    'service_store_payment_settings',
    'service_store_payment_audit',
    'site_content_revisions',
    'security_events',
    'security_alerts',
    'security_detection_rules'
  )
  AND foreign_key.confrelid = to_regclass('public.admin_users')
ORDER BY source_namespace.nspname, source_table.relname, foreign_key.conname;
'@

Confirm-ProductionAdminDeletionDatabase -ProjectRef $ProjectRef
$queryOutput = Invoke-ProductionAdminDeletionReadOnlyQuery -ProjectRef $ProjectRef -PsqlPath $PsqlPath -Sql $sql
$checksPassed = Write-ProductionAdminDeletionChecks -QueryOutput $queryOutput -Phase Preflight
$ledgerPassed = Test-ProductionAdminDeletionMigrationLedger `
  -QueryOutput $queryOutput -LocalMigrations $localMigrations -Phase Preflight `
  -AllowSchemaEvidenceFallback:$SchemaEvidenceFallback
$foreignKeysPassed = Test-ProductionAdminDeletionForeignKeys -QueryOutput $queryOutput -Phase Preflight

$ledgerStateLine = @($queryOutput | Where-Object { $_ -like 'CHECK|migration_ledger|*' } | Select-Object -First 1)
$ledgerState = if ($ledgerStateLine.Count -eq 1) { ($ledgerStateLine[0] -split '\|', 4)[2] } else { 'MALFORMED' }
$fallbackUsed = $SchemaEvidenceFallback -and $ledgerState -in @('ABSENT_SCHEMA', 'ABSENT_TABLE', 'INACCESSIBLE', 'EMPTY')
$overallPassed = $checksPassed -and $ledgerPassed -and $foreignKeysPassed
Write-Output ''
if ($overallPassed -and $fallbackUsed) {
  Write-Output 'OVERALL: SCHEMA EVIDENCE PASS - Migration 36 prerequisites match the reviewed live schema; migration history remains unverified and no versions were inferred or recorded.'
  Write-Output 'REVIEW REQUIRED: reconcile Production deployment/SQL Editor records before approval; this result does not prove migrations 1-35 were applied.'
} else {
  Write-Output "OVERALL: $(if ($overallPassed) { 'PASS - migration ledger and Migration 36 prerequisites verified' } else { 'FAIL - STOP; resolve every failed or unverified prerequisite' })"
}
if (-not $overallPassed) { exit 1 }
