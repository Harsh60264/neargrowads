[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',

  [switch]$DryRun,

  [switch]$PreflightOnly,

  [switch]$PermanentDeleteOnly
)

$ErrorActionPreference = 'Stop'
$psqlEnvironmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $psqlEnvironmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL environment isolation helper is missing.'
}
. $psqlEnvironmentHelper

$stagingProjectRef = 'kdaixomygsuxadofoieb'
$productionProjectRef = 'axbjzmdokfoftzfgwiql'
$projectRefPattern = '^[a-z0-9]{20}$'
$manualSqlEditorMigrationName = '20261031010000_complete_admin_temporary_password_setup.sql'
$permanentDeletionMigrationName = '20261102100000_secure_archived_admin_permanent_deletion.sql'
$rejectedRetryMigrationName = '20261030230000_retry_temporary_admin_password_expiry.sql'
$migrationNames = @(
  '20261021000000_grant_leads_storage_permissions.sql',
  '20261021100000_create_service_catalogue.sql',
  '20261021110000_create_service_enquiries.sql',
  '20261021130000_create_site_content_cms.sql',
  '20261021170000_create_site_media_storage_bucket.sql',
  '20261022120000_refine_service_catalogue_enquiries.sql',
  '20261022150000_create_service_orders_and_payment_settings.sql',
  '20261023130000_add_service_package_discounted_price.sql',
  '20261023150000_add_site_content_revision_workflow.sql',
  '20261024100000_create_case_studies_cms.sql',
  '20261024110000_add_case_study_published_snapshots.sql',
  '20261024120000_case_study_image_layout_and_categories.sql',
  '20261024130000_sync_case_study_categories.sql',
  '20261025100000_create_website_services_cms.sql',
  '20261025110000_admin_session_idle_timeout.sql',
  '20261025150000_allow_mascot_accessory_assets.sql',
  '20261025180000_harden_leads_access_and_consent.sql',
  '20261025210000_add_service_catalogue_categories.sql',
  '20261026120000_prevent_site_content_draft_overwrites.sql',
  '20261027100000_publish_mascot_settings_only.sql',
  '20261027110000_publish_mascot_settings_only.sql',
  '20261027130000_create_security_monitoring.sql',
  '20261027140000_create_website_activity.sql',
  '20261027150000_create_serverless_cms_documents.sql',
  '20261028130000_atomic_admin_invitation_cancellation.sql',
  '20261028150000_add_lead_notification_status.sql',
  '20261028160000_complete_admin_invitation_atomically.sql',
  '20261028200000_secure_admin_invitation_recovery.sql',
  '20261028230000_admin_account_archiving.sql',
  '20261029100000_admin_temporary_password_lifecycle.sql',
  '20261029230000_allow_delegated_coowner_invitation_cancellation.sql'
)
$standardMigrationNames = @($migrationNames)

if ($ProjectRef -ceq $productionProjectRef) {
  throw 'The Production project reference is prohibited.'
}
if ($ProjectRef -cnotmatch $projectRefPattern -or $ProjectRef -cne $stagingProjectRef) {
  throw 'ProjectRef must exactly match the verified staging project reference.'
}

$migrationDirectory = Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\migrations'
$migrationFiles = foreach ($name in $migrationNames) {
  $path = Join-Path $migrationDirectory $name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required migration file is missing: $name"
  }
  Get-Item -LiteralPath $path
}

if ($migrationFiles.Count -ne 31) {
  throw 'The migration list must contain exactly migrations 4 through 34.'
}
if ($migrationNames -contains $manualSqlEditorMigrationName -or
  $migrationNames -contains $rejectedRetryMigrationName) {
  throw 'The manually applied verification-only migration and rejected retry migration must never be queued.'
}
$allMigrationFiles = @(Get-ChildItem -LiteralPath $migrationDirectory -Filter '*.sql' | Sort-Object Name)
if ($allMigrationFiles.Count -ne 36 -or $allMigrationFiles[-1].Name -cne $permanentDeletionMigrationName) {
  throw "Expected 36 repository migration files, with $permanentDeletionMigrationName as the newest migration."
}
if ($allMigrationFiles.Name -contains $rejectedRetryMigrationName) {
  throw "The rejected migration must not be present in the repository inventory: $rejectedRetryMigrationName"
}

if ($PermanentDeleteOnly) {
  $migrationNames = @($permanentDeletionMigrationName)
  $migrationFiles = @(Get-Item -LiteralPath (Join-Path $migrationDirectory $permanentDeletionMigrationName))
}

if ($DryRun) {
  Write-Output "DRY RUN ONLY - no SQL will be executed and no database connection will be opened."
  Write-Output "Staging project ref: $ProjectRef"
  if ($PermanentDeleteOnly) {
    Write-Output 'Planned migration (36 only; migrations 1-35 will not run):'
  } else {
    Write-Output 'Planned runner-managed migrations (4-34):'
  }
  $migrationNames | ForEach-Object { Write-Output "  $_" }
  Write-Output "Verification-only and never queued: $manualSqlEditorMigrationName"
  return
}

$databaseHost = 'aws-0-eu-west-1.pooler.supabase.com'
$databasePort = 5432
$databaseName = 'postgres'
$databaseUser = "postgres.$stagingProjectRef"
$logDirectory = Join-Path $env:LOCALAPPDATA 'NearGrowAds\staging-migration-logs'
$logPath = Join-Path $logDirectory "$ProjectRef.log"
$preflightScriptPath = Join-Path $env:TEMP ("neargrow-staging-preflight-" + [guid]::NewGuid().ToString('N') + '.psql')
$temporaryDriverPath = Join-Path $env:TEMP ("neargrow-staging-migrations-" + [guid]::NewGuid().ToString('N') + '.psql')
$preflightOutputPath = Join-Path $env:TEMP ("neargrow-staging-preflight-" + [guid]::NewGuid().ToString('N') + '.txt')
$migrationOutputPath = Join-Path $env:TEMP ("neargrow-staging-output-" + [guid]::NewGuid().ToString('N') + '.txt')

Write-Output ''
Write-Output 'TARGET DATABASE - verify this is the NEW staging project'
Write-Output "Project ref: $ProjectRef"
Write-Output "Host:        $databaseHost"
Write-Output "Port:        $databasePort"
Write-Output "Database:    $databaseName"
Write-Output "User:        $databaseUser"
Write-Output 'Connection mode: Supabase Session Pooler (session mode), TLS required.'
Write-Output 'Host and username are fixed to this staging project; arbitrary endpoints are not accepted.'

$confirmation = Read-Host 'Type the exact staging project ref shown above to continue'
if ($confirmation -cne $ProjectRef) {
  throw 'Project reference confirmation did not match; no database connection was opened.'
}

if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}

$versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 psql is required. Detected: $versionOutput"
}

$preflightSql = @'
WITH admin_tables AS (
  SELECT count(*) AS found_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'admin_users',
      'admin_sessions',
      'admin_audit_logs',
      'admin_ownership_transfers'
    )
    AND c.relkind = 'r'
    AND c.relrowsecurity
),
leads_policy_check AS (
  SELECT
    count(*) FILTER (
      WHERE policyname IN (
        'Public anonymous insert of leads',
        'Staff read access to leads',
        'Staff update access to leads'
      )
    ) AS expected_policy_count,
    COALESCE(
      count(*) FILTER (
        WHERE policyname IN (
          'Public anonymous insert of leads',
          'Staff read access to leads',
          'Staff update access to leads'
        )
      ) = 3
      OR (
        count(*) FILTER (
          WHERE policyname IN (
            'Public anonymous insert of leads',
            'Staff read access to leads',
            'Staff update access to leads'
          )
        ) = 0
        AND leads.oid IS NOT NULL
        AND NOT has_table_privilege('anon', leads.oid, 'SELECT')
        AND NOT has_table_privilege('anon', leads.oid, 'INSERT')
        AND NOT has_table_privilege('anon', leads.oid, 'UPDATE')
        AND NOT has_table_privilege('anon', leads.oid, 'DELETE')
        AND NOT has_table_privilege('authenticated', leads.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', leads.oid, 'INSERT')
        AND NOT has_table_privilege('authenticated', leads.oid, 'UPDATE')
        AND NOT has_table_privilege('authenticated', leads.oid, 'DELETE')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_attribute column_entry
          WHERE column_entry.attrelid = leads.oid
            AND column_entry.attnum > 0
            AND NOT column_entry.attisdropped
            AND (
              has_column_privilege('anon', leads.oid, column_entry.attnum, 'SELECT')
              OR has_column_privilege('anon', leads.oid, column_entry.attnum, 'INSERT')
              OR has_column_privilege('anon', leads.oid, column_entry.attnum, 'UPDATE')
              OR has_column_privilege('authenticated', leads.oid, column_entry.attnum, 'SELECT')
              OR has_column_privilege('authenticated', leads.oid, column_entry.attnum, 'INSERT')
              OR has_column_privilege('authenticated', leads.oid, column_entry.attnum, 'UPDATE')
            )
        )
      ),
      false
    ) AS passed
  FROM (VALUES (to_regclass('public.leads'))) AS leads(oid)
  LEFT JOIN pg_policies policy_entry
    ON policy_entry.schemaname = 'public'
    AND policy_entry.tablename = 'leads'
  GROUP BY leads.oid
),
account_column_check AS (
  SELECT count(*) AS found_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'admin_users'
    AND column_name IN (
      'username',
      'last_login_at',
      'last_password_reset_at',
      'must_change_password'
    )
),
prerequisite_checks(check_name, passed, detail) AS (
  SELECT 'database_name_is_postgres', current_database() = 'postgres',
    'current_database=' || current_database()
  UNION ALL
  SELECT 'database_role_is_postgres', current_user = 'postgres',
    'current_user=' || current_user
  UNION ALL
  SELECT 'database_is_not_standby', NOT pg_is_in_recovery(),
    'pg_is_in_recovery=' || pg_is_in_recovery()::text
  UNION ALL
  SELECT 'uuid_ossp_extension', EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'),
    'uuid-ossp extension must exist'
  UNION ALL
  SELECT 'gen_random_uuid_function', to_regprocedure('gen_random_uuid()') IS NOT NULL,
    'gen_random_uuid() must resolve'
  UNION ALL
  SELECT 'auth_users_relation', to_regclass('auth.users') IS NOT NULL,
    'auth.users must exist'
  UNION ALL
  SELECT 'supabase_roles', (
      SELECT count(*) = 3 FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')
    ), 'anon, authenticated, and service_role must exist'
  UNION ALL
  SELECT 'leads_relation', to_regclass('public.leads') IS NOT NULL,
    'public.leads must exist'
  UNION ALL
  SELECT 'leads_rls', COALESCE((
      SELECT relrowsecurity FROM pg_class
      WHERE oid = to_regclass('public.leads')
    ), false), 'RLS must be enabled on public.leads'
  UNION ALL
  SELECT 'expected_leads_policies', passed,
    CASE
      WHEN expected_policy_count = 3 THEN 'all 3 original lead policies are present'
      WHEN expected_policy_count = 0 AND passed THEN 'original policies are absent and anon/authenticated table and column grants are denied'
      ELSE 'found ' || expected_policy_count::text || ' of 3 original lead policies; partial policy sets or client grants are rejected'
    END
  FROM leads_policy_check
  UNION ALL
  SELECT 'admin_tables_rls', found_count = 4,
    'found ' || found_count::text || ' of 4 expected RLS-enabled Admin tables'
  FROM admin_tables
  UNION ALL
  SELECT 'ownership_transfer_rpc',
    to_regprocedure('public.accept_admin_ownership_transfer(uuid,uuid)') IS NOT NULL,
    'public.accept_admin_ownership_transfer(uuid,uuid) must exist'
  UNION ALL
  SELECT 'admin_account_columns', found_count = 4,
    'found ' || found_count::text || ' of 4 expected account columns'
  FROM account_column_check
  UNION ALL
  SELECT 'admin_username_constraint', EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.admin_users')
        AND conname = 'admin_users_username_format'
    ), 'admin_users_username_format must exist'
  UNION ALL
  SELECT 'admin_username_unique_index', EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'admin_users'
        AND indexname = 'admin_users_username_unique'
    ), 'admin_users_username_unique must exist'
  UNION ALL
  SELECT 'service_role_admin_access',
    CASE
      WHEN to_regclass('public.admin_users') IS NULL THEN false
      ELSE has_table_privilege('service_role', to_regclass('public.admin_users'), 'INSERT')
    END,
    'service_role must have INSERT on public.admin_users'
)
SELECT 'PREREQUISITE|' || check_name || '|' ||
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END || '|' ||
       replace(detail, '|', '/')
FROM prerequisite_checks
UNION ALL
SELECT CASE WHEN bool_and(passed) THEN 'PREREQUISITES_OK' ELSE 'PREREQUISITES_FAIL' END
FROM prerequisite_checks;

WITH auth_relation AS (
  SELECT to_regclass('auth.users') AS relation_oid
),
auth_trigger_checks(check_name, passed, detail) AS (
  SELECT 'public_schema_create',
    has_schema_privilege(current_user, 'public', 'CREATE'),
    'migration creates SECURITY DEFINER functions in public'
  UNION ALL
  SELECT 'auth_schema_usage',
    has_schema_privilege(current_user, 'auth', 'USAGE'),
    'migration resolves auth.users in the auth schema'
  UNION ALL
  SELECT 'auth_users_trigger_privilege',
    COALESCE(has_table_privilege(current_user, relation_oid, 'TRIGGER'), false),
    'CREATE TRIGGER requires TRIGGER privilege on auth.users; table ownership is not required'
  FROM auth_relation
  UNION ALL
  SELECT 'plpgsql_language_usage',
    has_language_privilege(current_user, 'plpgsql', 'USAGE'),
    'migration creates PL/pgSQL functions'
),
auth_trigger_summary AS (
  SELECT bool_and(passed) AS passed FROM auth_trigger_checks
)
SELECT 'AUTH_TRIGGER_CHECK|' || check_name || '|' ||
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END || '|' ||
       replace(detail, '|', '/')
FROM auth_trigger_checks
UNION ALL
SELECT CASE WHEN passed
  THEN 'AUTH_EMAIL_TRIGGER_PRIVILEGES_OK'
  ELSE 'AUTH_EMAIL_TRIGGER_PRIVILEGES_FAIL'
END
FROM auth_trigger_summary;

WITH target_tables AS (
  SELECT c.oid, c.relname, c.relowner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (
      c.oid = to_regclass('public.admin_users')
      OR EXISTS (
        SELECT 1
        FROM pg_constraint fk
        WHERE fk.contype = 'f'
          AND fk.confrelid = to_regclass('public.admin_users')
          AND fk.conrelid = c.oid
          AND NOT (
            c.oid = to_regclass('public.admin_sessions')
            AND (
              SELECT array_agg(a.attname::text ORDER BY k.ordinality)
              FROM unnest(fk.conkey) WITH ORDINALITY AS k(attnum, ordinality)
              JOIN pg_attribute a ON a.attrelid = fk.conrelid AND a.attnum = k.attnum
            ) = ARRAY['user_id']::text[]
          )
      )
      OR c.oid IN (
        to_regclass('public.admin_identity_history'),
        to_regclass('public.admin_permanent_deletion_jobs'),
        to_regclass('public.admin_permanent_deletion_email_reservations')
      )
    )
),
owned_existing_functions AS (
  SELECT p.oid, p.proname, p.proowner
  FROM pg_proc p
  WHERE p.oid IN (
    to_regprocedure('public.sync_admin_identity_history()'),
    to_regprocedure('public.lock_admin_email_reservation(text)'),
    to_regprocedure('public.guard_admin_email_reservation()'),
    to_regprocedure('public.guard_auth_email_reservation()'),
    to_regprocedure('public.guard_admin_permanent_deletion_in_progress()'),
    to_regprocedure('public.get_admin_permanent_deletion_state(uuid)'),
    to_regprocedure('public.begin_admin_permanent_deletion(uuid,uuid,text,text)'),
    to_regprocedure('public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)'),
    to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid)'),
    to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid,boolean,boolean)')
  )
),
ddl_checks(check_name, passed, detail) AS (
  SELECT 'public_schema_create',
    has_schema_privilege(current_user, 'public', 'CREATE'),
    'CREATE on public is required for migration objects'
  UNION ALL
  SELECT 'admin_fk_table_ownership', NOT EXISTS (
      SELECT 1
      FROM target_tables t
      WHERE NOT (
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
        OR pg_has_role(current_user, t.relowner, 'USAGE')
      )
    ),
    'migration ALTERs admin_users and each referencing table except admin_sessions.user_id; existing permanent-deletion tables are also altered'
  UNION ALL
  SELECT 'existing_function_ownership', NOT EXISTS (
      SELECT 1
      FROM owned_existing_functions f
      WHERE NOT (
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
        OR pg_has_role(current_user, f.proowner, 'USAGE')
      )
    ),
    'CREATE OR REPLACE and DROP FUNCTION require ownership of pre-existing migration functions'
)
SELECT 'MIGRATION_DDL_CHECK|' || check_name || '|' ||
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END || '|' ||
       replace(detail, '|', '/')
FROM ddl_checks
UNION ALL
SELECT CASE WHEN bool_and(passed) THEN 'MIGRATION_DDL_PRIVILEGES_OK'
  ELSE 'MIGRATION_DDL_PRIVILEGES_FAIL' END
FROM ddl_checks;

WITH expected_columns(schema_name, table_name, column_name) AS (
  VALUES
    ('public', 'admin_users', 'id'),
    ('public', 'admin_users', 'email'),
    ('public', 'admin_users', 'role'),
    ('public', 'admin_users', 'status'),
    ('public', 'admin_users', 'permissions'),
    ('public', 'admin_users', 'is_primary_owner'),
    ('public', 'admin_users', 'invited_by'),
    ('public', 'admin_users', 'created_at'),
    ('public', 'admin_users', 'updated_at'),
    ('public', 'admin_users', 'username'),
    ('public', 'admin_users', 'archived_at'),
    ('public', 'admin_users', 'must_change_password'),
    ('public', 'admin_users', 'temporary_password_expires_at'),
    ('public', 'admin_users', 'temporary_password_used_at'),
    ('public', 'admin_users', 'invitation_generation'),
    ('public', 'admin_sessions', 'user_id'),
    ('public', 'admin_sessions', 'revoked_at'),
    ('public', 'admin_audit_logs', 'actor_id'),
    ('public', 'admin_audit_logs', 'target_id'),
    ('public', 'admin_audit_logs', 'action'),
    ('public', 'admin_audit_logs', 'section'),
    ('public', 'admin_audit_logs', 'details'),
    ('public', 'admin_audit_logs', 'created_at'),
    ('public', 'admin_ownership_transfers', 'from_user_id'),
    ('public', 'admin_ownership_transfers', 'to_user_id'),
    ('auth', 'users', 'id'),
    ('auth', 'users', 'email')
),
expected_identity_foreign_keys(table_name, column_name) AS (
  VALUES
    ('admin_users', 'invited_by'),
    ('admin_sessions', 'user_id'),
    ('admin_audit_logs', 'actor_id'),
    ('admin_audit_logs', 'target_id'),
    ('admin_ownership_transfers', 'from_user_id'),
    ('admin_ownership_transfers', 'to_user_id'),
    ('site_content_cms', 'updated_by'),
    ('site_content_cms', 'published_by'),
    ('service_store_payment_settings', 'razorpay_test_verified_by'),
    ('service_store_payment_settings', 'updated_by'),
    ('service_store_payment_audit', 'actor_id'),
    ('site_content_revisions', 'actor_id')
),
object_checks(object_name, passed, detail) AS (
  SELECT c.table_name || '.' || c.column_name,
    EXISTS (
      SELECT 1
      FROM pg_namespace schema_entry
      JOIN pg_class table_entry
        ON table_entry.relnamespace = schema_entry.oid
      JOIN pg_attribute column_entry
        ON column_entry.attrelid = table_entry.oid
      WHERE schema_entry.nspname = c.schema_name
        AND table_entry.relname = c.table_name
        AND column_entry.attname = c.column_name
        AND column_entry.attnum > 0
        AND NOT column_entry.attisdropped
    ),
    'required migration-36 dependency column'
  FROM expected_columns c
  UNION ALL
  SELECT fk.table_name || '.' || fk.column_name || ' foreign key',
    (
      SELECT count(*) = 1
      FROM pg_constraint constraint_row
      JOIN pg_attribute attribute_row
        ON attribute_row.attrelid = constraint_row.conrelid
        AND attribute_row.attname = fk.column_name
        AND constraint_row.conkey = ARRAY[attribute_row.attnum]::smallint[]
      JOIN pg_attribute referenced_attribute
        ON referenced_attribute.attrelid = constraint_row.confrelid
        AND referenced_attribute.attname = 'id'
        AND constraint_row.confkey = ARRAY[referenced_attribute.attnum]::smallint[]
      WHERE constraint_row.contype = 'f'
        AND constraint_row.conrelid = to_regclass('public.' || fk.table_name)
        AND constraint_row.confrelid = to_regclass('public.admin_users')
    ),
    'exactly one single-column Admin identity foreign key for retained attribution'
  FROM expected_identity_foreign_keys fk
),
object_summary AS (
  SELECT bool_and(passed) AS passed FROM object_checks
)
SELECT 'MIGRATION36_OBJECT|' || object_name || '|' ||
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END || '|' ||
       replace(detail, '|', '/')
FROM object_checks
UNION ALL
SELECT CASE WHEN passed THEN 'MIGRATION36_OBJECTS_OK'
  ELSE 'MIGRATION36_OBJECTS_FAIL' END
FROM object_summary;

WITH expected_tables(table_name) AS (
  VALUES
    ('admin_identity_history'),
    ('admin_permanent_deletion_jobs'),
    ('admin_permanent_deletion_email_reservations')
),
expected_functions(function_name) AS (
  VALUES
    ('sync_admin_identity_history'),
    ('lock_admin_email_reservation'),
    ('guard_admin_email_reservation'),
    ('guard_auth_email_reservation'),
    ('guard_admin_permanent_deletion_in_progress'),
    ('get_admin_permanent_deletion_state'),
    ('begin_admin_permanent_deletion'),
    ('record_admin_permanent_deletion_failure'),
    ('complete_admin_permanent_deletion')
),
expected_triggers(table_name, trigger_name) AS (
  VALUES
    ('public.admin_users', 'admin_users_sync_identity_history'),
    ('public.admin_users', 'admin_users_guard_reserved_email'),
    ('auth.users', 'auth_users_guard_reserved_email'),
    ('public.admin_users', 'admin_users_guard_pending_permanent_deletion')
),
expected_foreign_keys(table_name, column_name) AS (
  VALUES
    ('admin_users', 'invited_by'),
    ('admin_sessions', 'user_id'),
    ('admin_audit_logs', 'actor_id'),
    ('admin_audit_logs', 'target_id'),
    ('admin_ownership_transfers', 'from_user_id'),
    ('admin_ownership_transfers', 'to_user_id'),
    ('site_content_cms', 'updated_by'),
    ('site_content_cms', 'published_by'),
    ('service_store_payment_settings', 'razorpay_test_verified_by'),
    ('service_store_payment_settings', 'updated_by'),
    ('service_store_payment_audit', 'actor_id'),
    ('site_content_revisions', 'actor_id'),
    ('security_events', 'actor_id'),
    ('security_alerts', 'acknowledged_by'),
    ('security_alerts', 'resolved_by'),
    ('security_detection_rules', 'updated_by')
),
expected_foreign_key_checks AS (
  SELECT
    expected.table_name,
    expected.column_name,
    (
      SELECT count(*)
      FROM pg_constraint constraint_row
      JOIN pg_attribute local_attribute
        ON local_attribute.attrelid = constraint_row.conrelid
        AND local_attribute.attname = expected.column_name
        AND constraint_row.conkey = ARRAY[local_attribute.attnum]::smallint[]
      JOIN pg_attribute referenced_attribute
        ON referenced_attribute.attrelid = constraint_row.confrelid
        AND referenced_attribute.attname = 'id'
        AND constraint_row.confkey = ARRAY[referenced_attribute.attnum]::smallint[]
      WHERE constraint_row.contype = 'f'
        AND constraint_row.conrelid = to_regclass('public.' || expected.table_name)
        AND constraint_row.confrelid = to_regclass('public.admin_users')
    ) AS matching_count
  FROM expected_foreign_keys expected
),
foreign_key_diagnostics AS (
  SELECT
    'MIGRATION36_FK|public.' || table_name || '.' || column_name || '|' ||
    CASE WHEN matching_count = 1 THEN 'PASS' ELSE 'FAIL' END || '|' ||
    CASE
      WHEN matching_count = 1 THEN 'exactly one single-column foreign key references public.admin_users(id)'
      ELSE 'expected exactly one single-column foreign key to public.admin_users(id); found ' ||
        matching_count::text
    END AS diagnostic,
    matching_count = 1 AS passed
  FROM expected_foreign_key_checks
  UNION ALL
  SELECT
    'MIGRATION36_FK|unexpected ' ||
    format('%I.%I constraint %I', source_schema.nspname, source_table.relname, constraint_row.conname) ||
    '|FAIL|' || replace(pg_get_constraintdef(constraint_row.oid), '|', '/') AS diagnostic,
    false AS passed
  FROM pg_constraint constraint_row
  JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
  JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
  JOIN pg_attribute local_attribute
    ON local_attribute.attrelid = constraint_row.conrelid
    AND local_attribute.attnum = ANY(constraint_row.conkey)
  JOIN pg_attribute referenced_attribute
    ON referenced_attribute.attrelid = constraint_row.confrelid
    AND referenced_attribute.attnum = ANY(constraint_row.confkey)
  WHERE constraint_row.contype = 'f'
    AND constraint_row.confrelid = to_regclass('public.admin_users')
    AND NOT EXISTS (
      SELECT 1
      FROM expected_foreign_keys expected
      WHERE source_schema.nspname = 'public'
        AND expected.table_name = source_table.relname
        AND expected.column_name = local_attribute.attname
        AND cardinality(constraint_row.conkey) = 1
        AND constraint_row.conkey = ARRAY[local_attribute.attnum]::smallint[]
        AND referenced_attribute.attname = 'id'
        AND constraint_row.confkey = ARRAY[referenced_attribute.attnum]::smallint[]
    )
),
foreign_key_state AS (
  SELECT bool_and(passed) AS passed FROM foreign_key_diagnostics
),
target_objects_absent AS (
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM pg_class relation
      JOIN pg_namespace schema_entry ON schema_entry.oid = relation.relnamespace
      JOIN expected_tables expected ON expected.table_name = relation.relname
      WHERE schema_entry.nspname = 'public'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_proc function_entry
      JOIN pg_namespace schema_entry ON schema_entry.oid = function_entry.pronamespace
      JOIN expected_functions expected ON expected.function_name = function_entry.proname
      WHERE schema_entry.nspname = 'public'
        AND function_entry.oid <> COALESCE(
          to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid,boolean,boolean)')::oid,
          0::oid
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_trigger trigger_entry
      JOIN expected_triggers expected
        ON expected.trigger_name = trigger_entry.tgname
        AND to_regclass(expected.table_name) = trigger_entry.tgrelid
      WHERE NOT trigger_entry.tgisinternal
    ) AS passed
)
SELECT diagnostic FROM foreign_key_diagnostics
UNION ALL
SELECT CASE
  WHEN target_objects_absent.passed AND foreign_key_state.passed
    THEN 'MIGRATION36_STATE_NOT_APPLIED'
  ELSE 'MIGRATION36_STATE_UNEXPECTED'
END
FROM target_objects_absent
CROSS JOIN foreign_key_state;

WITH expected_functions(signature) AS (
  VALUES
    ('public.get_active_admin_session(uuid,uuid)'),
    ('public.complete_admin_temporary_password_setup(uuid,uuid)')
),
function_checks AS (
  SELECT
    CASE
      WHEN p.oid IS NULL THEN false
      ELSE p.prosecdef
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        )
    END AS passed
  FROM expected_functions expected
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(expected.signature)
),
expected_tables(table_name) AS (
  VALUES
    ('admin_users'),
    ('admin_sessions'),
    ('admin_audit_logs'),
    ('admin_ownership_transfers')
),
table_checks AS (
  SELECT
    CASE
      WHEN relation.oid IS NULL THEN false
      ELSE relation.relrowsecurity
        AND (
          SELECT bool_and(has_table_privilege('service_role', relation.oid, privilege))
          FROM unnest(ARRAY[
            'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
          ]) AS required(privilege)
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
        )
    END AS passed
  FROM expected_tables expected
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass('public.' || expected.table_name)
),
migration_objects AS (
  SELECT
    to_regclass('public.admin_audit_logs') IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'admin_audit_logs'
          AND column_name = 'idempotency_key'
      )
      AND EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_class idx ON idx.oid = i.indexrelid
        WHERE i.indrelid = to_regclass('public.admin_audit_logs')
          AND idx.relname = 'admin_audit_logs_idempotency_key_unique'
          AND i.indisunique
          AND i.indisvalid
          AND i.indpred IS NOT NULL
          AND pg_get_indexdef(i.indexrelid) ~* '\(idempotency_key\)'
      )
      AND (SELECT count(*) = 2 AND bool_and(passed) FROM function_checks)
      AND (SELECT count(*) = 4 AND bool_and(passed) FROM table_checks) AS passed
)
SELECT CASE WHEN passed
  THEN 'MANUAL_SQL_EDITOR_MIGRATION_OK'
  ELSE 'MANUAL_SQL_EDITOR_MIGRATION_FAIL'
END
FROM migration_objects;

SELECT COALESCE(to_regclass('supabase_migrations.schema_migrations') IS NOT NULL, false) AS history_exists \gset
\if :history_exists
  SELECT 'MIGRATION_HISTORY_PRESENT';
  SELECT 'APPLIED|' || version::text
  FROM supabase_migrations.schema_migrations
  ORDER BY version;
\else
  SELECT 'MIGRATION_HISTORY_UNAVAILABLE';
\endif
'@

$savedEnvironment = $null

try {
  [System.IO.File]::WriteAllText(
    $preflightScriptPath,
    $preflightSql,
    [System.Text.UTF8Encoding]::new($false)
  )
  $savedEnvironment = Enter-StagingPsqlEnvironment

  $connectionArguments = @(
    '--no-psqlrc',
    '--host', $databaseHost,
    '--port', "$databasePort",
    '--username', $databaseUser,
    '--dbname', $databaseName,
    '--password',
    '--set', 'ON_ERROR_STOP=1',
    '--no-align',
    '--tuples-only'
  )

  Write-Output ''
  Write-Output 'Checking database prerequisites and migration history (read-only).'
  & $PsqlPath @connectionArguments --output $preflightOutputPath --file $preflightScriptPath
  $preflightExitCode = $LASTEXITCODE
  $preflightText = if (Test-Path -LiteralPath $preflightOutputPath -PathType Leaf) {
    Get-Content -LiteralPath $preflightOutputPath
  } else {
    @()
  }

  if ($preflightExitCode -ne 0) {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) | PREFLIGHT_FAILED | psql_exit=$preflightExitCode"
    throw 'Read-only staging preflight failed. No migration files were run; inspect the local log and psql output.'
  }

  if ($preflightText -notcontains 'PREREQUISITES_OK') {
    $preflightText | ForEach-Object { Write-Host "$_" }
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) | PREREQUISITES_FAILED"
    throw 'One or more prerequisite checks failed. Read the PREREQUISITE|...|FAIL|... lines above; no migrations were run.'
  }

  if ($preflightText -notcontains 'MANUAL_SQL_EDITOR_MIGRATION_OK' -or
    $preflightText -contains 'MANUAL_SQL_EDITOR_MIGRATION_FAIL') {
    $preflightText | ForEach-Object { Write-Host "$_" }
    throw "The manually applied migration $manualSqlEditorMigrationName is not verified by actual database objects and privileges. No migrations were run; this runner will never execute that migration."
  }

  if ($PermanentDeleteOnly -and (
    $preflightText -notcontains 'AUTH_EMAIL_TRIGGER_PRIVILEGES_OK' -or
    $preflightText -contains 'AUTH_EMAIL_TRIGGER_PRIVILEGES_FAIL'
  )) {
    $preflightText | ForEach-Object { Write-Host "$_" }
    throw 'The connected role is not verified as able to create the public trigger function and trigger on auth.users. No migration was run.'
  }

  if ($PermanentDeleteOnly -and (
    $preflightText -notcontains 'MIGRATION_DDL_PRIVILEGES_OK' -or
    $preflightText -contains 'MIGRATION_DDL_PRIVILEGES_FAIL'
  )) {
    $preflightText | Where-Object { $_ -like 'MIGRATION_DDL_CHECK|*' } | ForEach-Object { Write-Host "$_" }
    throw 'The connected role does not have verified ownership rights for all existing tables/functions that migration 36 changes. No migration was run.'
  }

  if ($PermanentDeleteOnly -and (
    $preflightText -notcontains 'MIGRATION36_OBJECTS_OK' -or
    $preflightText -contains 'MIGRATION36_OBJECTS_FAIL'
  )) {
    $preflightText | Where-Object { $_ -like 'MIGRATION36_OBJECT|*' } | ForEach-Object { Write-Host "$_" }
    throw 'One or more actual database objects required by migration 36 are missing. No migration was run.'
  }

  if ($PermanentDeleteOnly -and (
    $preflightText -notcontains 'MIGRATION36_STATE_NOT_APPLIED' -or
    $preflightText -contains 'MIGRATION36_STATE_UNEXPECTED'
  )) {
    $preflightText | Where-Object { $_ -like 'MIGRATION36_STATE_*' } | ForEach-Object { Write-Host "$_" }
    $preflightText | Where-Object { $_ -like 'MIGRATION36_FK|*' } | ForEach-Object { Write-Host "$_" }
    throw 'Migration 36 is already applied or the database contains a partial/conflicting migration-36 state. No migration was run.'
  }

  $historyAvailable = $preflightText -contains 'MIGRATION_HISTORY_PRESENT'
  $databaseAppliedVersions = @(
    foreach ($line in $preflightText) {
      if ($line -match '^APPLIED\|(\d{14})$') { $Matches[1] }
    }
  )

  if ($PermanentDeleteOnly) {
    $knownMigrationLogNames = @($standardMigrationNames + $permanentDeletionMigrationName)
    if (-not (Test-Path -LiteralPath $logPath -PathType Leaf)) {
      throw 'The local Staging migration log is missing. Migration 36 cannot be reconciled against the recorded runner history.'
    }

    $loggedSuccesses = @()
    $loggedFailures = @()
    foreach ($line in Get-Content -LiteralPath $logPath) {
      $parts = @($line.Split([char]124) | ForEach-Object { $_.Trim() })
      if ($parts.Count -ge 3 -and $parts[1] -eq 'SUCCESS') {
        $loggedSuccesses += $parts[2]
      } elseif ($parts.Count -ge 3 -and $parts[1] -eq 'FAILED_MIGRATION') {
        $loggedFailures += $parts[2]
      }
    }

    $unexpectedSuccesses = @($loggedSuccesses | Where-Object { $knownMigrationLogNames -notcontains $_ })
    $missingEarlierMigrations = @(
      foreach ($name in $standardMigrationNames) {
        if (@($loggedSuccesses | Where-Object { $_ -ceq $name }).Count -eq 0) { $name }
      }
    )
    $duplicateEarlierMigrations = @(
      foreach ($name in $standardMigrationNames) {
        if (@($loggedSuccesses | Where-Object { $_ -ceq $name }).Count -gt 1) { $name }
      }
    )

    if ($unexpectedSuccesses.Count -gt 0 -or
      $loggedFailures.Count -gt 0 -or
      $missingEarlierMigrations.Count -gt 0 -or
      $duplicateEarlierMigrations.Count -gt 0 -or
      $loggedSuccesses -contains $permanentDeletionMigrationName) {
      $unexpectedSuccesses | ForEach-Object { Write-Host "UNEXPECTED SUCCESS LOG ENTRY | $_" }
      $loggedFailures | ForEach-Object { Write-Host "FAILED MIGRATION LOG ENTRY | $_" }
      $missingEarlierMigrations | ForEach-Object { Write-Host "MISSING EARLIER SUCCESS LOG ENTRY | $_" }
      $duplicateEarlierMigrations | ForEach-Object { Write-Host "DUPLICATE EARLIER SUCCESS LOG ENTRY | $_" }
      throw 'The local Staging migration log does not establish one clean success entry for every runner-managed migration 4-34, or migration 36 is already logged. No migration was run.'
    }

    if ($historyAvailable -and
      $databaseAppliedVersions -contains $permanentDeletionMigrationName.Substring(0, 14)) {
      throw 'Staging migration history already records migration 36. No migration was run.'
    }

    Write-Output 'MIGRATION36_LOG_EVIDENCE_OK | all 31 runner-managed migrations 4-34 are logged exactly once; no known migration failures or unexpected success entries'
    Write-Output 'MIGRATION36_STATE_NOT_APPLIED | required dependencies pass; migration-36 target objects are absent and expected Admin foreign keys still reference admin_users'

    if (-not $historyAvailable) {
      Write-Warning 'Supabase migration history is unavailable. The local log and live dependency/state checks do not certify complete migration history or absence of manual schema drift.'
    } else {
      $unverifiedEarlierMigrations = @(
        foreach ($name in $standardMigrationNames) {
          $version = $name.Substring(0, 14)
          if ($databaseAppliedVersions -notcontains $version -and $loggedSuccesses -notcontains $name) {
            $name
          }
        }
      )
      if ($unverifiedEarlierMigrations.Count -gt 0) {
        $unverifiedEarlierMigrations | ForEach-Object { Write-Host "UNVERIFIED EARLIER MIGRATION | $_" }
        throw 'Migration 36 is blocked: migrations 4-34 must be recorded in Supabase history or this runner local success log.'
      }
    }
  }

  if ($PreflightOnly) {
    Write-Output 'Read-only staging prerequisite and migration-35 object/permission checks passed. No migrations were run.'
    if ($PermanentDeleteOnly) {
      Write-Output 'Read-only Auth TRIGGER privilege, migration DDL ownership, and migration-36 dependency-object checks passed. No migrations were run.'
    }
    return
  }

  if ($PermanentDeleteOnly) {
    $historyConfirmation = Read-Host 'Type I CONFIRM THE REPORTED MIGRATION 36 EVIDENCE IS REVIEWED; APPLY MIGRATION 36 ONLY'
    if ($historyConfirmation -cne 'I CONFIRM THE REPORTED MIGRATION 36 EVIDENCE IS REVIEWED; APPLY MIGRATION 36 ONLY') {
      throw 'Migration-36 evidence confirmation did not match; no migration files were run.'
    }
  } else {
    $historyConfirmation = Read-Host 'Type I CONFIRM NO UNTRACKED MIGRATIONS 4-34 ARE APPLIED after checking staging history'
    if ($historyConfirmation -cne 'I CONFIRM NO UNTRACKED MIGRATIONS 4-34 ARE APPLIED') {
      throw 'Untracked migration confirmation did not match; no migration files were run.'
    }
  }

  $priorSuccessfulNames = @()
  $priorFailedNames = @()
  if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $logPath) {
      $parts = @($line.Split([char]124) | ForEach-Object { $_.Trim() })
      if ($parts.Count -ge 3 -and $parts[1] -eq 'SUCCESS' -and
        ($standardMigrationNames -contains $parts[2] -or $permanentDeletionMigrationName -ceq $parts[2])) {
        $priorSuccessfulNames += $parts[2]
      } elseif ($parts.Count -ge 4 -and $parts[1] -eq 'FAILED_MIGRATION' -and $migrationNames -contains $parts[2]) {
        $priorFailedNames += $parts[2]
      }
    }
  }

  if ($priorFailedNames.Count -gt 0) {
    throw "A previous run logged a failed migration ($($priorFailedNames[-1])). Inspect staging and the local log; the runner will not retry a possibly partial migration."
  }

  $pendingMigrations = @(
    foreach ($file in $migrationFiles) {
      $version = $file.Name.Substring(0, 14)
      if ($databaseAppliedVersions -contains $version) {
        Write-Host "Skipping migration already recorded in Supabase history: $($file.Name)"
      } elseif ($priorSuccessfulNames -contains $file.Name) {
        Write-Host "Skipping migration already completed by this runner: $($file.Name)"
      } else {
        $file
      }
    }
  )

  if ($pendingMigrations.Count -eq 0) {
    Write-Output 'All selected migrations are already recorded as applied; nothing to do.'
    return
  }

  Write-Output ''
  Write-Output "The following $($pendingMigrations.Count) migration(s) will run on staging:"
  $pendingMigrations | ForEach-Object { Write-Output "  $($_.Name)" }
  $applyConfirmation = Read-Host "Type APPLY STAGING $ProjectRef to execute these migrations in order"
  if ($applyConfirmation -cne "APPLY STAGING $ProjectRef") {
    throw "Apply confirmation did not match; no migration files were run."
  }

  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $driverLines = [System.Collections.Generic.List[string]]::new()
  foreach ($file in $pendingMigrations) {
    $driverLines.Add("SELECT '__BEGIN__|$($file.Name)';")
    $driverLines.Add((Get-Content -LiteralPath $file.FullName -Raw))
    $driverLines.Add("SELECT '__SUCCESS__|$($file.Name)';")
  }
  [System.IO.File]::WriteAllText(
    $temporaryDriverPath,
    ($driverLines -join [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )

  Write-Output ''
  Write-Output "Running migration files in order. psql will prompt for the staging database password."
  & $PsqlPath @connectionArguments --output $migrationOutputPath --file $temporaryDriverPath
  $migrationExitCode = $LASTEXITCODE
  $migrationText = if (Test-Path -LiteralPath $migrationOutputPath -PathType Leaf) {
    Get-Content -LiteralPath $migrationOutputPath
  } else {
    @()
  }

  $successMarkers = @(
    foreach ($line in $migrationText) {
      if ($line.StartsWith('__SUCCESS__') -and $line.Length -gt 11 -and $line[11] -eq [char]124) {
        $name = $line.Substring(12)
        if ($migrationNames -contains $name) { $name }
      }
    }
  )
  foreach ($name in $successMarkers) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) | SUCCESS | $name"
    Write-Output "SUCCESS: $name"
  }

  if ($migrationExitCode -ne 0) {
    $migrationText | ForEach-Object { Write-Host "$_" }
    $beginMarkers = @(
      foreach ($line in $migrationText) {
        if ($line.StartsWith('__BEGIN__') -and $line.Length -gt 9 -and $line[9] -eq [char]124) {
          $name = $line.Substring(10)
          if ($migrationNames -contains $name) { $name }
        }
      }
    )
    $failedName = $beginMarkers | Where-Object { $successMarkers -notcontains $_ } | Select-Object -Last 1
    if ($failedName) {
      Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) | FAILED_MIGRATION | $failedName | psql_exit=$migrationExitCode"
      Write-Host "Migration failed: $failedName. Execution stopped; inspect the staging database before any retry."
    } else {
      Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) | FAILED_CONNECTION_OR_RUNNER | psql_exit=$migrationExitCode"
      Write-Host "psql exited with code $migrationExitCode before a migration failure could be identified."
    }
    throw "Migration run stopped immediately after psql reported an error."
  }

  Write-Output "All selected staging migrations completed successfully. Local log: $logPath"
} finally {
  foreach ($temporaryPath in @($preflightScriptPath, $temporaryDriverPath, $preflightOutputPath, $migrationOutputPath)) {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
}
