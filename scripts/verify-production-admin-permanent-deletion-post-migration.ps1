[CmdletBinding()]
param(
  [string]$ProjectRef = 'axbjzmdokfoftzfgwiql',
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'productionAdminDeletionCheck.Common.ps1')
Assert-ProductionAdminDeletionTarget -ProjectRef $ProjectRef

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDirectory = Join-Path $repoRoot 'supabase\migrations'
$localMigrations = Get-ProductionAdminDeletionMigrationInventory -MigrationDirectory $migrationDirectory
$migrationFile = Join-Path $migrationDirectory '20261102100000_secure_archived_admin_permanent_deletion.sql'
Write-Output "Verified Migration 36 SHA-256: $((Get-FileHash -LiteralPath $migrationFile -Algorithm SHA256).Hash)"

$sql = @'
SET default_transaction_read_only = on;
SELECT 'CHECK|production_target|' ||
  CASE WHEN current_database() = 'postgres'
    AND current_user = 'postgres'
    AND to_regclass('auth.users') IS NOT NULL
  THEN 'PASS' ELSE 'FAIL' END ||
  '|database=' || current_database() || ';role=' || current_user;

SELECT 'CHECK|migration_36_schema|' ||
  CASE WHEN
    to_regclass('public.admin_identity_history') IS NOT NULL
    AND to_regclass('public.admin_permanent_deletion_jobs') IS NOT NULL
    AND to_regclass('public.admin_permanent_deletion_email_reservations') IS NOT NULL
    AND to_regprocedure('public.get_admin_permanent_deletion_state(uuid)') IS NOT NULL
    AND to_regprocedure('public.begin_admin_permanent_deletion(uuid,uuid,text,text)') IS NOT NULL
    AND to_regprocedure('public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)') IS NOT NULL
    AND to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid,boolean,boolean)') IS NULL
  THEN 'PASS' ELSE 'FAIL' END ||
  '|required Migration 36 tables and exact RPC signatures exist; caller-trusted legacy overload is absent';

WITH expected_trigger_functions(signature) AS (
  VALUES
    ('public.sync_admin_identity_history()'),
    ('public.lock_admin_email_reservation(text)'),
    ('public.guard_admin_email_reservation()'),
    ('public.guard_auth_email_reservation()'),
    ('public.guard_admin_permanent_deletion_in_progress()')
),
function_checks AS (
  SELECT expected.signature,
    COALESCE(
      procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      ),
      false
    ) AS passed
  FROM expected_trigger_functions expected
  LEFT JOIN pg_proc procedure ON procedure.oid = to_regprocedure(expected.signature)
)
SELECT 'CHECK|trigger_function_' || signature || '|' ||
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END ||
  '|SECURITY DEFINER, fixed search_path, postgres owner and no public/client EXECUTE'
FROM function_checks
ORDER BY signature;

WITH expected_triggers(schema_name, table_name, trigger_name, function_signature, trigger_type) AS (
  VALUES
    ('public', 'admin_users', 'admin_users_sync_identity_history', 'public.sync_admin_identity_history()', 29),
    ('public', 'admin_users', 'admin_users_guard_reserved_email', 'public.guard_admin_email_reservation()', 23),
    ('auth', 'users', 'auth_users_guard_reserved_email', 'public.guard_auth_email_reservation()', 23),
    ('public', 'admin_users', 'admin_users_guard_pending_permanent_deletion', 'public.guard_admin_permanent_deletion_in_progress()', 19)
),
trigger_checks AS (
  SELECT expected.trigger_name,
    EXISTS (
      SELECT 1
      FROM pg_trigger actual
      JOIN pg_class relation ON relation.oid = actual.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = expected.schema_name
        AND relation.relname = expected.table_name
        AND actual.tgname = expected.trigger_name
        AND NOT actual.tgisinternal
        AND actual.tgfoid = to_regprocedure(expected.function_signature)
        AND actual.tgtype = expected.trigger_type
        AND actual.tgenabled = 'O'
        AND actual.tgqual IS NULL
        AND actual.tgnargs = 0
    ) AS passed
  FROM expected_triggers expected
)
SELECT 'CHECK|trigger_' || trigger_name || '|' ||
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END ||
  '|expected trigger is enabled on the exact table and handler'
FROM trigger_checks
ORDER BY trigger_name;

WITH expected_functions(signature) AS (
  VALUES
    ('public.get_admin_permanent_deletion_state(uuid)'),
    ('public.begin_admin_permanent_deletion(uuid,uuid,text,text)'),
    ('public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)'),
    ('public.complete_admin_permanent_deletion(uuid,uuid)')
),
function_checks AS (
  SELECT expected.signature, procedure.oid,
    COALESCE(
      procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      )
      AND has_function_privilege('service_role', procedure.oid, 'EXECUTE'),
      false
    ) AS passed
  FROM expected_functions expected
  LEFT JOIN pg_proc procedure ON procedure.oid = to_regprocedure(expected.signature)
)
SELECT 'CHECK|rpc_' || signature || '|' ||
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END ||
  '|SECURITY DEFINER, fixed search_path, service_role EXECUTE only'
FROM function_checks
ORDER BY signature;

WITH expected_tables(table_name) AS (
  VALUES
    ('admin_identity_history'),
    ('admin_permanent_deletion_jobs'),
    ('admin_permanent_deletion_email_reservations')
),
table_checks AS (
  SELECT expected.table_name, relation.oid,
    COALESCE(
      relation.relrowsecurity
      AND (
        SELECT bool_and(has_table_privilege('service_role', relation.oid, privilege))
        FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) required(privilege)
      )
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
      ),
      false
    ) AS passed
  FROM expected_tables expected
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass('public.' || expected.table_name)
)
SELECT 'CHECK|table_' || table_name || '|' ||
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END ||
  '|RLS enabled, service_role privileges present, no direct PUBLIC/anon/authenticated access'
FROM table_checks
ORDER BY table_name;

SELECT 'CHECK|identity_history_backfill|' ||
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM public.admin_users current_admin
    LEFT JOIN public.admin_identity_history history ON history.id = current_admin.id
    WHERE history.id IS NULL
      OR history.email IS DISTINCT FROM current_admin.email
      OR history.role IS DISTINCT FROM current_admin.role
      OR history.is_primary_owner IS DISTINCT FROM current_admin.is_primary_owner
      OR history.created_at IS DISTINCT FROM current_admin.created_at
      OR history.deleted_at IS NOT NULL
  ) THEN 'PASS' ELSE 'FAIL' END ||
  '|every current Admin identity has a matching retained history row';

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
  AND foreign_key.confrelid IN (
    to_regclass('public.admin_users'),
    to_regclass('public.admin_identity_history')
  )
ORDER BY source_namespace.nspname, source_table.relname, foreign_key.conname;
'@

Confirm-ProductionAdminDeletionDatabase -ProjectRef $ProjectRef
$queryOutput = Invoke-ProductionAdminDeletionReadOnlyQuery -ProjectRef $ProjectRef -PsqlPath $PsqlPath -Sql $sql
$checksPassed = Write-ProductionAdminDeletionChecks -QueryOutput $queryOutput -Phase PostMigration
$ledgerPassed = Test-ProductionAdminDeletionMigrationLedger `
  -QueryOutput $queryOutput -LocalMigrations $localMigrations -Phase PostMigration
$foreignKeysPassed = Test-ProductionAdminDeletionForeignKeys -QueryOutput $queryOutput -Phase PostMigration

$overallPassed = $checksPassed -and $ledgerPassed -and $foreignKeysPassed
Write-Output ''
Write-Output "OVERALL: $(if ($overallPassed) { 'PASS - Production Migration 36 verification complete' } else { 'FAIL - stop rollout and investigate; do not alter Admin accounts' })"
if (-not $overallPassed) { exit 1 }
