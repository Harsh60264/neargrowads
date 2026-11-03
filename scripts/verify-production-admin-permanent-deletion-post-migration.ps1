[CmdletBinding()]
param(
  [string]$ProjectRef = 'axbjzmdokfoftzfgwiql',
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [switch]$SchemaEvidenceOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'productionAdminDeletionCheck.Common.ps1')
Assert-ProductionAdminDeletionTarget -ProjectRef $ProjectRef

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDirectory = Join-Path $repoRoot 'supabase\migrations'
$migrationFile = Join-Path $migrationDirectory '20261102100000_secure_archived_admin_permanent_deletion.sql'
Write-Output "Verified Migration 36 SHA-256: $((Get-FileHash -LiteralPath $migrationFile -Algorithm SHA256).Hash)"
$localMigrations = $null
if (-not $SchemaEvidenceOnly) {
  $localMigrations = Get-ProductionAdminDeletionMigrationInventory -MigrationDirectory $migrationDirectory
}

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
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) privilege
        WHERE has_table_privilege('anon', relation.oid, privilege)
          OR has_table_privilege('authenticated', relation.oid, privilege)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
        WHERE acl.grantee = 0
      )
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
        WHERE acl.grantee NOT IN (relation.relowner, 'service_role'::regrole)
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

WITH expected_columns(table_name, column_name, type_name, is_not_null, default_expression) AS (
  VALUES
    ('admin_identity_history', 'id', 'uuid', true, ''),
    ('admin_identity_history', 'email', 'text', true, ''),
    ('admin_identity_history', 'role', 'text', true, ''),
    ('admin_identity_history', 'is_primary_owner', 'boolean', true, 'false'),
    ('admin_identity_history', 'created_at', 'timestamp with time zone', true, ''),
    ('admin_identity_history', 'deleted_at', 'timestamp with time zone', false, ''),
    ('admin_permanent_deletion_jobs', 'target_id', 'uuid', true, ''),
    ('admin_permanent_deletion_jobs', 'actor_id', 'uuid', true, ''),
    ('admin_permanent_deletion_jobs', 'target_email', 'text', true, ''),
    ('admin_permanent_deletion_jobs', 'status', 'text', true, ''),
    ('admin_permanent_deletion_jobs', 'attempt_count', 'integer', true, '1'),
    ('admin_permanent_deletion_jobs', 'started_at', 'timestamp with time zone', true, 'now()'),
    ('admin_permanent_deletion_jobs', 'last_attempted_at', 'timestamp with time zone', true, 'now()'),
    ('admin_permanent_deletion_jobs', 'completed_at', 'timestamp with time zone', false, ''),
    ('admin_permanent_deletion_jobs', 'last_error_stage', 'text', false, ''),
    ('admin_permanent_deletion_jobs', 'last_error_code', 'text', false, ''),
    ('admin_permanent_deletion_email_reservations', 'email', 'text', true, ''),
    ('admin_permanent_deletion_email_reservations', 'target_id', 'uuid', true, ''),
    ('admin_permanent_deletion_email_reservations', 'created_at', 'timestamp with time zone', true, 'now()')
),
actual_columns AS (
  SELECT relation.relname AS table_name,
    attribute.attname AS column_name,
    format_type(attribute.atttypid, attribute.atttypmod) AS type_name,
    attribute.attnotnull AS is_not_null,
    COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expression
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname = 'public'
    AND relation.relname IN (
      'admin_identity_history',
      'admin_permanent_deletion_jobs',
      'admin_permanent_deletion_email_reservations'
    )
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
)
SELECT 'CHECK|migration_36_table_definitions|' ||
  CASE WHEN
    (SELECT count(*) FROM actual_columns) = (SELECT count(*) FROM expected_columns)
    AND NOT EXISTS (
      SELECT 1
      FROM expected_columns expected
      LEFT JOIN actual_columns actual
        ON actual.table_name = expected.table_name
        AND actual.column_name = expected.column_name
      WHERE actual.column_name IS NULL
        OR actual.type_name IS DISTINCT FROM expected.type_name
        OR actual.is_not_null IS DISTINCT FROM expected.is_not_null
        OR actual.default_expression IS DISTINCT FROM expected.default_expression
    )
    AND NOT EXISTS (
      SELECT 1 FROM actual_columns actual
      LEFT JOIN expected_columns expected
        ON expected.table_name = actual.table_name
        AND expected.column_name = actual.column_name
      WHERE expected.column_name IS NULL
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|the three Migration 36 tables have exactly the expected columns, types, nullability and defaults';

WITH expected_constraints(table_name, constraint_name, constraint_type, required_fragments, referenced_table) AS (
  VALUES
    ('admin_identity_history', 'admin_identity_history_pkey', 'p', ARRAY['primary key', 'id']::text[], null::text),
    ('admin_permanent_deletion_jobs', 'admin_permanent_deletion_jobs_pkey', 'p', ARRAY['primary key', 'target_id']::text[], null::text),
    ('admin_permanent_deletion_jobs', 'admin_permanent_deletion_jobs_target_id_fkey', 'f', ARRAY['foreign key', 'target_id', 'references', 'admin_identity_history', 'id']::text[], 'admin_identity_history'),
    ('admin_permanent_deletion_jobs', 'admin_permanent_deletion_jobs_actor_id_fkey', 'f', ARRAY['foreign key', 'actor_id', 'references', 'admin_identity_history', 'id']::text[], 'admin_identity_history'),
    ('admin_permanent_deletion_jobs', 'admin_permanent_deletion_jobs_status_check', 'c', ARRAY['status', 'auth_delete_pending', 'completed']::text[], null::text),
    ('admin_permanent_deletion_jobs', 'admin_permanent_deletion_jobs_attempt_count_check', 'c', ARRAY['attempt_count', '> 0']::text[], null::text),
    ('admin_permanent_deletion_jobs', 'admin_permanent_deletion_email_lowercase', 'c', ARRAY['target_email', '=', 'lower']::text[], null::text),
    ('admin_permanent_deletion_jobs', 'admin_permanent_deletion_completion_state', 'c', ARRAY['status', 'completed', 'completed_at', 'auth_delete_pending', 'or']::text[], null::text),
    ('admin_permanent_deletion_email_reservations', 'admin_permanent_deletion_email_reservations_pkey', 'p', ARRAY['primary key', 'email']::text[], null::text),
    ('admin_permanent_deletion_email_reservations', 'admin_permanent_deletion_email_reservations_target_id_key', 'u', ARRAY['unique', 'target_id']::text[], null::text),
    ('admin_permanent_deletion_email_reservations', 'admin_permanent_deletion_email_reservations_target_id_fkey', 'f', ARRAY['foreign key', 'target_id', 'references', 'admin_permanent_deletion_jobs', 'id']::text[], 'admin_permanent_deletion_jobs'),
    ('admin_permanent_deletion_email_reservations', 'admin_permanent_deletion_reservation_email_lowercase', 'c', ARRAY['email', '=', 'lower']::text[], null::text)
),
actual_constraints AS (
  SELECT relation.relname AS table_name,
    constraint_row.conname AS constraint_name,
    constraint_row.contype AS constraint_type,
    constraint_row.convalidated AS is_validated,
    lower(pg_get_constraintdef(constraint_row.oid)) AS definition,
    constraint_row.confrelid AS referenced_table,
    constraint_row.confdeltype AS delete_action
  FROM pg_constraint constraint_row
  JOIN pg_class relation ON relation.oid = constraint_row.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname IN (
      'admin_identity_history',
      'admin_permanent_deletion_jobs',
      'admin_permanent_deletion_email_reservations'
    )
),
actual_indexes AS (
  SELECT index_relation.relname AS index_name,
    table_relation.relname AS table_name,
    index_row.indisunique AND index_row.indisvalid AND index_row.indisready AS is_expected_unique_index
  FROM pg_index index_row
  JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
  JOIN pg_class table_relation ON table_relation.oid = index_row.indrelid
  JOIN pg_namespace namespace ON namespace.oid = table_relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND table_relation.relname IN (
      'admin_identity_history',
      'admin_permanent_deletion_jobs',
      'admin_permanent_deletion_email_reservations'
    )
),
expected_indexes(index_name, table_name) AS (
  VALUES
    ('admin_identity_history_pkey', 'admin_identity_history'),
    ('admin_permanent_deletion_jobs_pkey', 'admin_permanent_deletion_jobs'),
    ('admin_permanent_deletion_email_reservations_pkey', 'admin_permanent_deletion_email_reservations'),
    ('admin_permanent_deletion_email_reservations_target_id_key', 'admin_permanent_deletion_email_reservations')
)
SELECT 'CHECK|migration_36_table_constraints|' ||
  CASE WHEN
    (SELECT count(*) FROM actual_constraints) = (SELECT count(*) FROM expected_constraints)
    AND (SELECT count(*) FROM actual_indexes) = (SELECT count(*) FROM expected_indexes)
    AND NOT EXISTS (
      SELECT 1
      FROM expected_indexes expected
      LEFT JOIN actual_indexes actual
        ON actual.index_name = expected.index_name
        AND actual.table_name = expected.table_name
      WHERE actual.index_name IS NULL
        OR NOT actual.is_expected_unique_index
    )
    AND NOT EXISTS (
      SELECT 1
      FROM expected_constraints expected
      LEFT JOIN actual_constraints actual
        ON actual.table_name = expected.table_name
        AND actual.constraint_name = expected.constraint_name
      WHERE actual.constraint_name IS NULL
        OR actual.constraint_type IS DISTINCT FROM expected.constraint_type
        OR NOT actual.is_validated
        OR NOT COALESCE((
          SELECT bool_and(position(fragment in actual.definition) > 0)
          FROM unnest(expected.required_fragments) fragment
        ), true)
        OR (expected.constraint_type = 'f' AND (
          actual.referenced_table <> to_regclass('public.' || expected.referenced_table)
          OR actual.delete_action <> 'r'
        ))
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|the Migration 36 tables have exactly the expected validated keys, foreign keys and checks';

WITH expected_functions(label, signature, service_role_execute, required_fragments) AS (
  VALUES
    ('sync_admin_identity_history', 'public.sync_admin_identity_history()', null::boolean,
      ARRAY['if tg_op = ''delete'' then', 'set email = old.email', 'deleted_at = coalesce(deleted_at, clock_timestamp())', 'on conflict (id) do update', 'deleted_at = null']::text[]),
    ('lock_admin_email_reservation', 'public.lock_admin_email_reservation(text)', null::boolean,
      ARRAY['pg_advisory_xact_lock', 'hashtextextended(lower(p_email), 0)']::text[]),
    ('guard_admin_email_reservation', 'public.guard_admin_email_reservation()', null::boolean,
      ARRAY['reservation.email = lower(new.email)', 'errcode = ''23505''', 'admin_permanent_deletion_email_reservations_pkey']::text[]),
    ('guard_auth_email_reservation', 'public.guard_auth_email_reservation()', null::boolean,
      ARRAY['reservation.email = lower(new.email)', 'for key share', 'errcode = ''23505''']::text[]),
    ('guard_admin_permanent_deletion_in_progress', 'public.guard_admin_permanent_deletion_in_progress()', null::boolean,
      ARRAY['job.status = ''auth_delete_pending''', 'new.email is distinct from old.email', 'new.status <> ''disabled''', 'raise exception']::text[]),
    ('get_admin_permanent_deletion_state', 'public.get_admin_permanent_deletion_state(uuid)', true::boolean,
      ARRAY['role = ''owner''', 'is_primary_owner', 'candidate.role <> ''owner''', 'public.admin_ownership_transfers', 'pendingdeletions']::text[]),
    ('begin_admin_permanent_deletion', 'public.begin_admin_permanent_deletion(uuid,uuid,text,text)', true::boolean,
      ARRAY['p_confirmation is distinct from ''delete''', 'role = ''owner''', 'public.lock_admin_email_reservation', 'public.admin_permanent_deletion_email_reservations', 'public.admin_sessions', 'admin.permanent_deletion.started']::text[]),
    ('record_admin_permanent_deletion_failure', 'public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)', true::boolean,
      ARRAY['role = ''owner''', 'invalid permanent-deletion stage', 'left(coalesce(p_error_code, ''unknown''), 80)']::text[]),
    ('complete_admin_permanent_deletion', 'public.complete_admin_permanent_deletion(uuid,uuid)', true::boolean,
      ARRAY['from auth.users', 'delete from public.admin_users', 'delete from public.admin_permanent_deletion_email_reservations', 'admin.permanently_deleted', 'status = ''completed''']::text[])
),
function_checks AS (
  SELECT expected.label, expected.service_role_execute, procedure.oid,
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
      )
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
        WHERE acl.grantee NOT IN (procedure.proowner, 'service_role'::regrole)
          AND acl.privilege_type = 'EXECUTE'
      )
      AND (
        expected.service_role_execute IS NULL
        OR has_function_privilege('service_role', procedure.oid, 'EXECUTE') = expected.service_role_execute
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(expected.required_fragments) fragment
        WHERE position(
          fragment IN regexp_replace(lower(procedure.prosrc), '\s+', ' ', 'g')
        ) = 0
      ),
      false
    ) AS passed
  FROM expected_functions expected
  LEFT JOIN pg_proc procedure ON procedure.oid = to_regprocedure(expected.signature)
)
SELECT 'CHECK|function_definition_' || label || '|' ||
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END ||
  '|expected security, grants and required Migration 36 implementation clauses'
FROM function_checks
ORDER BY label;

SELECT 'CHECK|migration_36_function_overloads|' ||
  CASE WHEN count(*) = 9 THEN 'PASS' ELSE 'FAIL' END ||
  '|exactly the nine expected Migration 36 routines exist without extra overloads'
FROM pg_proc procedure
JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'public'
  AND procedure.prokind = 'f'
  AND procedure.proname IN (
    'sync_admin_identity_history',
    'lock_admin_email_reservation',
    'guard_admin_email_reservation',
    'guard_auth_email_reservation',
    'guard_admin_permanent_deletion_in_progress',
    'get_admin_permanent_deletion_state',
    'begin_admin_permanent_deletion',
    'record_admin_permanent_deletion_failure',
    'complete_admin_permanent_deletion'
  );

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
  ), ',') || '|' || foreign_key.conname || '|' || foreign_key.convalidated::text
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

SELECT 'CHECK|migration_36_foreign_keys|' ||
  CASE WHEN count(*) = 3
    AND bool_and(foreign_key.convalidated AND foreign_key.confdeltype = 'r')
    AND count(*) FILTER (
      WHERE source_table.relname = 'admin_permanent_deletion_jobs'
        AND foreign_key.conname = 'admin_permanent_deletion_jobs_target_id_fkey'
        AND target_table.relname = 'admin_identity_history'
    ) = 1
    AND count(*) FILTER (
      WHERE source_table.relname = 'admin_permanent_deletion_jobs'
        AND foreign_key.conname = 'admin_permanent_deletion_jobs_actor_id_fkey'
        AND target_table.relname = 'admin_identity_history'
    ) = 1
    AND count(*) FILTER (
      WHERE source_table.relname = 'admin_permanent_deletion_email_reservations'
        AND foreign_key.conname = 'admin_permanent_deletion_email_reservations_target_id_fkey'
        AND target_table.relname = 'admin_permanent_deletion_jobs'
    ) = 1
  THEN 'PASS' ELSE 'FAIL' END ||
  '|all three Migration 36 foreign keys are validated and retain their expected targets and RESTRICT behavior'
FROM pg_constraint foreign_key
JOIN pg_class source_table ON source_table.oid = foreign_key.conrelid
JOIN pg_class target_table ON target_table.oid = foreign_key.confrelid
JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
WHERE foreign_key.contype = 'f'
  AND source_namespace.nspname = 'public'
  AND source_table.relname IN (
    'admin_permanent_deletion_jobs',
    'admin_permanent_deletion_email_reservations'
  );
'@

Confirm-ProductionAdminDeletionDatabase -ProjectRef $ProjectRef
$queryOutput = Invoke-ProductionAdminDeletionReadOnlyQuery -ProjectRef $ProjectRef -PsqlPath $PsqlPath -Sql $sql
$checksPassed = Write-ProductionAdminDeletionChecks -QueryOutput $queryOutput -Phase PostMigration
$ledgerPassed = if ($SchemaEvidenceOnly) {
  Test-ProductionAdminDeletionSchemaEvidenceLedger -QueryOutput $queryOutput
} else {
  Test-ProductionAdminDeletionMigrationLedger `
    -QueryOutput $queryOutput -LocalMigrations $localMigrations -Phase PostMigration
}
$foreignKeysPassed = Test-ProductionAdminDeletionForeignKeys -QueryOutput $queryOutput -Phase PostMigration

$overallPassed = $checksPassed -and $ledgerPassed -and $foreignKeysPassed
Write-Output ''
if ($SchemaEvidenceOnly) {
  if ($overallPassed) {
    Write-Output 'SCHEMA EVIDENCE PASS: Migration 36 objects and checked live schema state match the expected definitions.'
    Write-Output 'MIGRATION HISTORY: NOT VERIFIED. This does not prove migrations 1-35 ran; no historical version was inferred or written.'
  } else {
    Write-Output 'SCHEMA EVIDENCE FAIL: stop rollout and investigate; do not alter Admin accounts.'
  }
} else {
  Write-Output "OVERALL: $(if ($overallPassed) { 'PASS - Production Migration 36 schema and migration ledger verification complete' } else { 'FAIL - stop rollout and investigate; do not alter Admin accounts' })"
}
if (-not $overallPassed) { exit 1 }
