[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [switch]$SchemaEvidenceOnly,
  [switch]$PostMigration37,
  [switch]$PostMigration38,
  [long]$ExpectedRazorpayOrderCount = -1,
  [string]$ExpectedRazorpayOrderFingerprint
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if ($PostMigration37 -and $PostMigration38) {
  throw 'Select only one post-migration verification mode.'
}
if ($PostMigration37 -or $PostMigration38) {
  if ($ExpectedRazorpayOrderCount -lt 0 -or
    $ExpectedRazorpayOrderFingerprint -notmatch '^[0-9a-f]{32}$') {
    throw 'Migration 37 post-verification requires the pre-migration Razorpay count and 32-character fingerprint.'
  }
} elseif ($ExpectedRazorpayOrderCount -ne -1 -or
  -not [string]::IsNullOrEmpty($ExpectedRazorpayOrderFingerprint)) {
  throw 'Razorpay baseline values are accepted only with a post-migration mode.'
}
if ($ProjectRef -notmatch '^[a-z0-9]{20}$' -or
  $databaseUser -cne "postgres.$ProjectRef") {
  throw 'The Production database identity does not match the pinned project.'
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}
$versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw 'PostgreSQL 18 psql is required.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDirectory = Join-Path $repoRoot 'supabase\migrations'
$migrationFiles = @(
  @{ Version = '20261102100000'; Name = 'secure_archived_admin_permanent_deletion' },
  @{ Version = '20261103100000'; Name = 'add_cashfree_service_payment_persistence' },
  @{ Version = '20261103214800'; Name = 'add_cashfree_production_mode' }
)
foreach ($migration in $migrationFiles) {
  $path = Join-Path $migrationDirectory "$($migration.Version)_$($migration.Name).sql"
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required reviewed migration file is missing: $($migration.Version)_$($migration.Name).sql"
  }
  $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
  Write-Output "LOCAL_MIGRATION|$($migration.Version)|$($migration.Name)|SHA256=$hash"
}

Write-Output ''
Write-Output 'READ-ONLY PRODUCTION CASHFREE DATABASE TARGET'
Write-Output "Project ref: $expectedProjectRef"
Write-Output "Host:        $databaseHost"
Write-Output "Port:        $databasePort"
Write-Output "Database:    $databaseName"
Write-Output 'TLS:         verify-full using the configured PostgreSQL root certificate'
Write-Output 'The query runs in one read-only transaction. It does not apply or record migrations.'
$confirmation = Read-Host 'Type the exact Production project ref shown above to continue'
if ($confirmation -cne $expectedProjectRef) {
  throw 'Production project reference confirmation did not match; no database connection was opened.'
}
if ($SchemaEvidenceOnly) {
  $evidenceConfirmation = Read-Host 'Type exactly I APPROVE SCHEMA EVIDENCE ONLY - HISTORY UNVERIFIED to continue'
  if ($evidenceConfirmation -cne 'I APPROVE SCHEMA EVIDENCE ONLY - HISTORY UNVERIFIED') {
    throw 'Schema-evidence-only confirmation did not match; no database connection was opened.'
  }
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper

$sql = @'
SELECT 'CHECK|target_identity|' ||
  CASE WHEN current_database() = 'postgres'
    AND current_user = 'postgres'
    AND NOT pg_is_in_recovery()
    AND to_regclass('auth.users') IS NOT NULL
  THEN 'PASS' ELSE 'FAIL' END ||
  '|fixed Production host/user, postgres database, primary and Auth schema';

SELECT 'CHECK|migration36_prerequisites|' ||
  CASE WHEN
    to_regclass('public.admin_users') IS NOT NULL
    AND to_regclass('public.admin_sessions') IS NOT NULL
    AND to_regclass('public.admin_audit_logs') IS NOT NULL
    AND to_regclass('public.admin_ownership_transfers') IS NOT NULL
    AND to_regclass('public.service_store_payment_settings') IS NOT NULL
    AND to_regclass('public.service_store_payment_audit') IS NOT NULL
    AND to_regprocedure('public.get_active_admin_session(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.complete_admin_temporary_password_setup(uuid,uuid)') IS NOT NULL
    AND to_regclass('public.admin_identity_history') IS NOT NULL
    AND to_regclass('public.admin_permanent_deletion_jobs') IS NOT NULL
    AND to_regclass('public.admin_permanent_deletion_email_reservations') IS NOT NULL
  THEN 'PASS' ELSE 'FAIL' END ||
  '|required existing Admin/CMS/payment and Migration 36 relations and setup routines';

SELECT to_regclass('public.admin_identity_history') IS NOT NULL
  AND to_regclass('public.admin_users') IS NOT NULL AS migration36_identity_tables_exist \gset
\if :migration36_identity_tables_exist
  SELECT 'CHECK|migration36_identity_backfill|' ||
    CASE WHEN NOT EXISTS (
      SELECT 1 FROM public.admin_users current_admin
      LEFT JOIN public.admin_identity_history identity_history
        ON identity_history.id=current_admin.id
      WHERE identity_history.id IS NULL
    ) THEN 'PASS' ELSE 'FAIL' END ||
    '|every current Admin identity has its retained history row; no identity values are returned';
\else
  SELECT 'CHECK|migration36_identity_backfill|FAIL|identity-history or Admin table is absent';
\endif

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
), actual_columns AS (
  SELECT relation.relname AS table_name, attribute.attname AS column_name,
    format_type(attribute.atttypid, attribute.atttypmod) AS type_name,
    attribute.attnotnull AS is_not_null,
    COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expression
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname = 'public'
    AND relation.relname IN ('admin_identity_history','admin_permanent_deletion_jobs',
      'admin_permanent_deletion_email_reservations')
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
)
SELECT 'CHECK|migration36_table_definitions|' ||
  CASE WHEN (SELECT count(*) FROM actual_columns) = 19
    AND NOT EXISTS (
      SELECT 1 FROM expected_columns expected
      LEFT JOIN actual_columns actual USING (table_name, column_name)
      WHERE actual.column_name IS NULL
        OR actual.type_name IS DISTINCT FROM expected.type_name
        OR actual.is_not_null IS DISTINCT FROM expected.is_not_null
        OR actual.default_expression IS DISTINCT FROM expected.default_expression
    )
    AND NOT EXISTS (
      SELECT 1 FROM actual_columns actual
      LEFT JOIN expected_columns expected USING (table_name, column_name)
      WHERE expected.column_name IS NULL
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Migration 36 table columns, types, nullability and defaults';

WITH expected_functions(signature, service_role_required) AS (
  VALUES
    ('public.sync_admin_identity_history()', false),
    ('public.lock_admin_email_reservation(text)', false),
    ('public.guard_admin_email_reservation()', false),
    ('public.guard_auth_email_reservation()', false),
    ('public.guard_admin_permanent_deletion_in_progress()', false),
    ('public.get_admin_permanent_deletion_state(uuid)', true),
    ('public.begin_admin_permanent_deletion(uuid,uuid,text,text)', true),
    ('public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)', true),
    ('public.complete_admin_permanent_deletion(uuid,uuid)', true)
), function_checks AS (
  SELECT expected.signature,
    COALESCE(procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
      AND CASE WHEN expected.service_role_required
        THEN has_function_privilege('service_role', procedure.oid, 'EXECUTE')
        ELSE NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      END
      AND NOT has_function_privilege('anon', procedure.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) acl
        WHERE acl.privilege_type = 'EXECUTE'
          AND acl.grantee <> procedure.proowner
          AND (NOT expected.service_role_required
            OR acl.grantee <> (SELECT oid FROM pg_roles WHERE rolname = 'service_role'))
      ), false) AS passed
  FROM expected_functions expected
  LEFT JOIN pg_proc procedure ON procedure.oid = to_regprocedure(expected.signature)
)
SELECT 'CHECK|migration36_functions_and_grants|' ||
  CASE WHEN count(*) = 9 AND bool_and(passed)
      AND NOT EXISTS (
        SELECT 1 FROM pg_proc unexpected
        JOIN pg_namespace namespace ON namespace.oid = unexpected.pronamespace
        WHERE namespace.nspname = 'public'
          AND unexpected.proname IN (
            'sync_admin_identity_history','lock_admin_email_reservation',
            'guard_admin_email_reservation','guard_auth_email_reservation',
            'guard_admin_permanent_deletion_in_progress',
            'get_admin_permanent_deletion_state','begin_admin_permanent_deletion',
            'record_admin_permanent_deletion_failure','complete_admin_permanent_deletion'
          )
          AND NOT EXISTS (
            SELECT 1 FROM function_checks expected
            WHERE unexpected.oid = to_regprocedure(expected.signature)
          )
      )
    THEN 'PASS' ELSE 'FAIL' END ||
  '|exact Migration 36 SECURITY DEFINER signatures, fixed search_path, four service-role RPC grants and revoked helper/public execution'
FROM function_checks;

WITH required_setup_functions(signature, source_fragment) AS (
  VALUES
    ('public.get_active_admin_session(uuid,uuid)',
      '%account.temporary_password_expires_at > clock_timestamp()%'),
    ('public.complete_admin_temporary_password_setup(uuid,uuid)',
      '%target_row.temporary_password_expires_at <= clock_timestamp()%')
), function_checks AS (
  SELECT required.signature,
    COALESCE(procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
      AND has_function_privilege('service_role',procedure.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',procedure.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',procedure.oid,'EXECUTE')
      AND lower(pg_get_functiondef(procedure.oid)) LIKE required.source_fragment
      AND NOT EXISTS (SELECT 1 FROM aclexplode(
        COALESCE(procedure.proacl,acldefault('f',procedure.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'),false) AS passed
  FROM required_setup_functions required
  LEFT JOIN pg_proc procedure ON procedure.oid=to_regprocedure(required.signature)
)
SELECT 'CHECK|migration36_admin_setup_rpcs|' ||
  CASE WHEN count(*)=2 AND bool_and(passed) THEN 'PASS' ELSE 'FAIL' END ||
  '|Admin session/setup RPCs preserve active-account and reauthentication guards'
FROM function_checks;

WITH expected_tables(table_name) AS (
  VALUES ('admin_identity_history'), ('admin_permanent_deletion_jobs'),
    ('admin_permanent_deletion_email_reservations')
), table_checks AS (
  SELECT expected.table_name, relation.oid,
    COALESCE(relation.relrowsecurity
      AND has_table_privilege('service_role', relation.oid, 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('anon', relation.oid, 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('authenticated', relation.oid, 'SELECT,INSERT,UPDATE,DELETE')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
        WHERE acl.grantee = 0
      ), false) AS passed
  FROM expected_tables expected
  LEFT JOIN pg_class relation ON relation.oid = to_regclass('public.' || expected.table_name)
)
SELECT 'CHECK|migration36_table_security|' ||
  CASE WHEN count(*) = 3 AND bool_and(passed) THEN 'PASS' ELSE 'FAIL' END ||
  '|Migration 36 tables retain RLS, service-role access and no direct client/PUBLIC DML'
FROM table_checks;

WITH expected_admin_fks(source_table, source_column) AS (
  VALUES
    ('admin_users','invited_by'),
    ('admin_sessions','user_id'),
    ('admin_audit_logs','actor_id'),
    ('admin_audit_logs','target_id'),
    ('admin_ownership_transfers','from_user_id'),
    ('admin_ownership_transfers','to_user_id'),
    ('site_content_cms','updated_by'),
    ('site_content_cms','published_by'),
    ('service_store_payment_settings','razorpay_test_verified_by'),
    ('service_store_payment_settings','updated_by'),
    ('service_store_payment_audit','actor_id'),
    ('site_content_revisions','actor_id'),
    ('security_events','actor_id'),
    ('security_alerts','acknowledged_by'),
    ('security_alerts','resolved_by'),
    ('security_detection_rules','updated_by')
), actual_admin_fks AS (
  SELECT source.relname AS source_table, source_column.attname AS source_column,
    target.relname AS target_table, target_namespace.nspname AS target_schema,
    foreign_key.convalidated
  FROM pg_constraint foreign_key
  JOIN pg_class source ON source.oid = foreign_key.conrelid
  JOIN pg_namespace source_namespace ON source_namespace.oid = source.relnamespace
  JOIN pg_attribute source_column ON source_column.attrelid = source.oid
    AND source_column.attnum = foreign_key.conkey[1]
  JOIN pg_class target ON target.oid = foreign_key.confrelid
  JOIN pg_namespace target_namespace ON target_namespace.oid = target.relnamespace
  WHERE foreign_key.contype = 'f'
    AND source_namespace.nspname = 'public'
    AND EXISTS (SELECT 1 FROM expected_admin_fks expected
      WHERE expected.source_table = source.relname
        AND expected.source_column = source_column.attname)
), shape AS (
  SELECT count(*) = 16 AND bool_and(convalidated) AS validated,
    count(*) FILTER (WHERE target_schema = 'public' AND target_table = 'admin_users') = 16
      AS legacy_shape,
    count(*) FILTER (WHERE target_schema = 'public' AND target_table = 'admin_identity_history'
      AND NOT (source_table = 'admin_sessions' AND source_column = 'user_id')) = 15
      AND count(*) FILTER (WHERE source_table = 'admin_sessions'
        AND source_column = 'user_id' AND target_schema = 'public'
        AND target_table = 'admin_users') = 1 AS history_shape,
    count(*) = (SELECT count(*) FROM expected_admin_fks) AS exact_count
  FROM actual_admin_fks
)
SELECT 'CHECK|admin_fk_compatibility|' ||
  CASE WHEN exact_count AND validated AND (legacy_shape OR history_shape)
    THEN 'PASS' ELSE 'FAIL' END ||
  '|recognized legacy or Migration 36 Admin FK shape; validated; no PII read; legacy=' ||
  legacy_shape::text || ';history=' || history_shape::text
FROM shape;

WITH required_constraints(table_name,constraint_name,definition_fragment) AS (
  VALUES
    ('admin_identity_history','admin_identity_history_pkey','PRIMARY KEY (id)'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_pkey','PRIMARY KEY (target_id)'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_target_id_fkey','admin_identity_history(id) ON DELETE RESTRICT'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_actor_id_fkey','admin_identity_history(id) ON DELETE RESTRICT'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_status_check','auth_delete_pending'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_attempt_count_check','attempt_count > 0'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_email_lowercase','target_email = lower(target_email)'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_completion_state','completed_at IS NOT NULL'),
    ('admin_permanent_deletion_email_reservations','admin_permanent_deletion_email_reservations_pkey','PRIMARY KEY (email)'),
    ('admin_permanent_deletion_email_reservations','admin_permanent_deletion_email_reservations_target_id_key','UNIQUE (target_id)'),
    ('admin_permanent_deletion_email_reservations','admin_permanent_deletion_email_reservations_target_id_fkey','admin_permanent_deletion_jobs(target_id) ON DELETE RESTRICT'),
    ('admin_permanent_deletion_email_reservations','admin_permanent_deletion_reservation_email_lowercase','email = lower(email)')
), actual_constraints AS (
  SELECT relation.relname AS table_name, constraint_row.conname,
    constraint_row.convalidated, pg_get_constraintdef(constraint_row.oid) AS definition
  FROM pg_constraint constraint_row
  JOIN pg_class relation ON relation.oid=constraint_row.conrelid
  JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
  WHERE namespace.nspname='public'
    AND relation.relname IN ('admin_identity_history','admin_permanent_deletion_jobs',
      'admin_permanent_deletion_email_reservations')
)
SELECT 'CHECK|migration36_constraints|' ||
  CASE WHEN (SELECT count(*)=12 FROM required_constraints)
    AND (SELECT count(*)=12 FROM actual_constraints)
    AND NOT EXISTS (
      SELECT 1 FROM required_constraints expected
      LEFT JOIN actual_constraints actual
        ON actual.table_name=expected.table_name
       AND actual.conname=expected.constraint_name
      WHERE actual.conname IS NULL OR NOT actual.convalidated
        OR actual.definition NOT ILIKE '%' || expected.definition_fragment || '%'
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|required validated Migration 36 constraints exist on their expected relations';

SELECT 'CHECK|migration36_state|' ||
  CASE WHEN
    (SELECT count(*) = 3 FROM pg_class relation JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname IN ('admin_identity_history','admin_permanent_deletion_jobs',
          'admin_permanent_deletion_email_reservations'))
    AND to_regprocedure('public.get_admin_permanent_deletion_state(uuid)') IS NOT NULL
    AND to_regprocedure('public.begin_admin_permanent_deletion(uuid,uuid,text,text)') IS NOT NULL
    AND to_regprocedure('public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)') IS NOT NULL
    AND to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid,boolean,boolean)') IS NULL
    AND (SELECT count(*) = 4 FROM pg_trigger trigger_row
      WHERE NOT trigger_row.tgisinternal AND trigger_row.tgname IN (
        'admin_users_sync_identity_history','admin_users_guard_reserved_email',
        'auth_users_guard_reserved_email','admin_users_guard_pending_permanent_deletion'))
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Migration 36 is complete; required tables/RPCs/triggers exist and unsafe legacy overload is absent';

WITH expected_triggers(table_name, trigger_name, function_signature, trigger_type) AS (
  VALUES
    ('admin_users','admin_users_sync_identity_history','public.sync_admin_identity_history()',29),
    ('admin_users','admin_users_guard_reserved_email','public.guard_admin_email_reservation()',23),
    ('users','auth_users_guard_reserved_email','public.guard_auth_email_reservation()',23),
    ('admin_users','admin_users_guard_pending_permanent_deletion',
      'public.guard_admin_permanent_deletion_in_progress()',19)
), trigger_checks AS (
  SELECT expected.trigger_name,
    EXISTS (
      SELECT 1 FROM pg_trigger actual
      JOIN pg_class relation ON relation.oid=actual.tgrelid
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname=CASE WHEN expected.table_name='users' THEN 'auth' ELSE 'public' END
        AND relation.relname=expected.table_name
        AND actual.tgname=expected.trigger_name
        AND actual.tgfoid=to_regprocedure(expected.function_signature)
        AND actual.tgtype=expected.trigger_type
        AND actual.tgenabled='O'
        AND NOT actual.tgisinternal
        AND actual.tgqual IS NULL
        AND actual.tgnargs=0
    ) AS passed
  FROM expected_triggers expected
)
SELECT 'CHECK|migration36_triggers|' ||
  CASE WHEN count(*)=4 AND bool_and(passed) THEN 'PASS' ELSE 'FAIL' END ||
  '|exact enabled Migration 36 trigger names, relations, handlers and event types'
FROM trigger_checks;

WITH expected_fks(source_table, source_column, target_table, target_column) AS (
  VALUES
    ('admin_permanent_deletion_jobs','target_id','admin_identity_history','id'),
    ('admin_permanent_deletion_jobs','actor_id','admin_identity_history','id'),
    ('admin_permanent_deletion_email_reservations','target_id','admin_permanent_deletion_jobs','target_id')
), actual_fks AS (
  SELECT source.relname AS source_table, source_column.attname AS source_column,
    target.relname AS target_table, target_column.attname AS target_column,
    foreign_key.convalidated, foreign_key.confdeltype
  FROM pg_constraint foreign_key
  JOIN pg_class source ON source.oid=foreign_key.conrelid
  JOIN pg_class target ON target.oid=foreign_key.confrelid
  JOIN pg_attribute source_column ON source_column.attrelid=source.oid
    AND source_column.attnum=foreign_key.conkey[1]
  JOIN pg_attribute target_column ON target_column.attrelid=target.oid
    AND target_column.attnum=foreign_key.confkey[1]
  WHERE foreign_key.contype='f'
    AND source.oid IN (to_regclass('public.admin_permanent_deletion_jobs'),
      to_regclass('public.admin_permanent_deletion_email_reservations'))
), matching AS (
  SELECT count(*)=3 AND bool_and(actual.convalidated AND actual.confdeltype='r')
    AND NOT EXISTS (
      SELECT 1 FROM expected_fks expected
      WHERE NOT EXISTS (SELECT 1 FROM actual_fks actual
        WHERE actual.source_table=expected.source_table
          AND actual.source_column=expected.source_column
          AND actual.target_table=expected.target_table
          AND actual.target_column=expected.target_column
          AND actual.convalidated AND actual.confdeltype='r')
    ) AS passed
  FROM actual_fks actual
  WHERE EXISTS (SELECT 1 FROM expected_fks expected
    WHERE expected.source_table=actual.source_table AND expected.source_column=actual.source_column)
)
SELECT 'CHECK|migration36_internal_foreign_keys|' ||
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END ||
  '|three validated Migration 36 internal FKs retain expected targets and ON DELETE RESTRICT'
FROM matching;

SELECT
  (
    to_regclass('public.cashfree_checkout_intents') IS NOT NULL
    OR to_regclass('public.cashfree_payment_attempts') IS NOT NULL
    OR to_regclass('public.cashfree_webhook_events') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND ((table_name='service_orders' AND column_name IN
        ('payment_session_id','cashfree_order_id','total_amount_inr_paise'))
       OR (table_name='service_store_payment_settings' AND column_name IN
        ('cashfree_test_enabled','cashfree_test_verified_at','cashfree_test_verified_by'))))
    OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace=to_regnamespace('public')
      AND proname IN ('cashfree_gateway_readiness','claim_cashfree_checkout_intent',
        'prepare_cashfree_checkout_create','mark_cashfree_checkout_intent_ambiguous',
        'complete_cashfree_checkout_intent','process_cashfree_webhook_event',
        'set_cashfree_test_gateway'))
    OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN
      ('service_orders_cashfree_checkout_identifiers_check',
       'cashfree_webhook_events_event_fingerprint_key',
       'cashfree_payment_attempts_provider_payment_id_key',
       'cashfree_checkout_intents_client_key','cashfree_checkout_intents_lease_check'))
    OR EXISTS (SELECT 1 FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='public' AND relation.relkind='i' AND relation.relname IN
      ('service_orders_provider_payment_session_id_uidx','service_orders_cashfree_order_id_uidx',
       'service_orders_provider_payment_id_idx','cashfree_webhook_events_service_order_id_idx',
       'cashfree_webhook_events_provider_order_id_idx','cashfree_webhook_events_provider_payment_id_idx',
       'cashfree_payment_attempts_service_order_id_idx','cashfree_payment_attempts_provider_order_id_idx',
       'cashfree_checkout_intents_recovery_idx'))
  ) AS migration37_any_object \gset
SELECT
  (
    (SELECT count(*) = 3 FROM pg_class relation JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname='public' AND relation.relname IN
        ('cashfree_checkout_intents','cashfree_payment_attempts','cashfree_webhook_events'))
    AND (SELECT count(*) = 6 FROM information_schema.columns WHERE table_schema='public'
      AND ((table_name='service_orders' AND column_name IN
        ('payment_session_id','cashfree_order_id','total_amount_inr_paise'))
       OR (table_name='service_store_payment_settings' AND column_name IN
        ('cashfree_test_enabled','cashfree_test_verified_at','cashfree_test_verified_by'))))
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='service_store_payment_settings' AND column_name='cashfree_test_enabled'
      AND data_type='boolean' AND is_nullable='NO' AND column_default='false')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.service_orders')
      AND conname='service_orders_provider_check' AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%razorpay%'
      AND pg_get_constraintdef(oid) LIKE '%cashfree%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.service_orders')
      AND conname='service_orders_currency_check' AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%provider = ''razorpay''%'
      AND pg_get_constraintdef(oid) LIKE '%provider = ''cashfree''%'
      AND pg_get_constraintdef(oid) LIKE '%currency = ''INR''%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.service_orders')
      AND conname='service_orders_cashfree_checkout_identifiers_check' AND convalidated)
    AND to_regprocedure('public.cashfree_gateway_readiness()') IS NOT NULL
    AND to_regprocedure('public.claim_cashfree_checkout_intent(text,text,text,text,text,text,text,text,text,text,jsonb,bigint,text,boolean)') IS NOT NULL
    AND to_regprocedure('public.prepare_cashfree_checkout_create(uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.mark_cashfree_checkout_intent_ambiguous(uuid,uuid,text)') IS NOT NULL
    AND to_regprocedure('public.complete_cashfree_checkout_intent(uuid,uuid,text,text,bigint,text)') IS NOT NULL
    AND to_regprocedure('public.process_cashfree_webhook_event(text,text,text,text,text,text,bigint,text,boolean)') IS NOT NULL
    AND to_regprocedure('public.set_cashfree_test_gateway(uuid,boolean)') IS NOT NULL
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.service_orders')
      AND conname='service_orders_provider_check' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.service_orders')
      AND conname='service_orders_currency_check' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.service_orders')
      AND conname='service_orders_cashfree_checkout_identifiers_check' AND convalidated)
    AND (
      SELECT count(*)=4 FROM pg_constraint
      WHERE conname IN ('cashfree_webhook_events_event_fingerprint_key',
        'cashfree_payment_attempts_provider_payment_id_key',
        'cashfree_checkout_intents_client_key','cashfree_checkout_intents_lease_check')
        AND convalidated
    )
    AND EXISTS (SELECT 1 FROM pg_constraint fk
      JOIN pg_attribute source ON source.attrelid=fk.conrelid AND source.attnum=fk.conkey[1]
      JOIN pg_attribute target ON target.attrelid=fk.confrelid AND target.attnum=fk.confkey[1]
      WHERE fk.contype='f' AND fk.convalidated AND fk.confdeltype='n'
        AND fk.conrelid=to_regclass('public.service_store_payment_settings')
        AND fk.confrelid=to_regclass('public.admin_identity_history')
        AND source.attname='cashfree_test_verified_by' AND target.attname='id')
    AND EXISTS (SELECT 1 FROM pg_attribute generated_column
      JOIN pg_attrdef generated_default
        ON generated_default.adrelid=generated_column.attrelid
       AND generated_default.adnum=generated_column.attnum
      WHERE generated_column.attrelid=to_regclass('public.service_orders')
        AND generated_column.attname='total_amount_inr_paise'
        AND generated_column.attgenerated='s'
        AND pg_get_expr(generated_default.adbin,generated_default.adrelid)='total_amount_paise')
    AND to_regclass('public.service_orders_provider_payment_session_id_uidx') IS NOT NULL
    AND to_regclass('public.service_orders_cashfree_order_id_uidx') IS NOT NULL
    AND to_regclass('public.service_orders_provider_payment_id_idx') IS NOT NULL
    AND to_regclass('public.cashfree_webhook_events_provider_order_id_idx') IS NOT NULL
    AND to_regclass('public.cashfree_webhook_events_service_order_id_idx') IS NOT NULL
    AND to_regclass('public.cashfree_webhook_events_provider_payment_id_idx') IS NOT NULL
    AND to_regclass('public.cashfree_payment_attempts_service_order_id_idx') IS NOT NULL
    AND to_regclass('public.cashfree_payment_attempts_provider_order_id_idx') IS NOT NULL
    AND to_regclass('public.cashfree_checkout_intents_recovery_idx') IS NOT NULL
    AND (
      SELECT count(*)=9
      FROM pg_index index_row
      JOIN pg_class index_relation ON index_relation.oid=index_row.indexrelid
      JOIN pg_namespace namespace ON namespace.oid=index_relation.relnamespace
      WHERE namespace.nspname='public' AND index_relation.relname IN
        ('service_orders_provider_payment_session_id_uidx','service_orders_cashfree_order_id_uidx',
         'service_orders_provider_payment_id_idx','cashfree_webhook_events_service_order_id_idx',
         'cashfree_webhook_events_provider_order_id_idx','cashfree_webhook_events_provider_payment_id_idx',
         'cashfree_payment_attempts_service_order_id_idx','cashfree_payment_attempts_provider_order_id_idx',
         'cashfree_checkout_intents_recovery_idx')
        AND index_row.indisvalid AND index_row.indisready
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_index index_row
      JOIN pg_class index_relation ON index_relation.oid=index_row.indexrelid
      WHERE index_relation.relname IN
        ('service_orders_provider_payment_session_id_uidx','service_orders_cashfree_order_id_uidx')
        AND NOT index_row.indisunique
    )
  ) AS migration37_complete \gset
SELECT 'CHECK|migration37_schema_state|' ||
  CASE WHEN :'migration37_any_object' = 'f' THEN 'PASS'
    WHEN :'migration37_complete' = 't' THEN 'PASS' ELSE 'FAIL' END ||
  '|state=' || CASE WHEN :'migration37_any_object' = 'f' THEN 'ABSENT'
    WHEN :'migration37_complete' = 't' THEN 'COMPLETE' ELSE 'PARTIAL_OR_DRIFTED' END;

WITH required_tables(table_name) AS (
  VALUES ('service_orders'),('service_store_payment_settings'),
    ('cashfree_checkout_intents'),('cashfree_payment_attempts'),('cashfree_webhook_events')
), access_checks AS (
  SELECT required.table_name, relation.oid,
    COALESCE(relation.relrowsecurity
      AND has_table_privilege('service_role',relation.oid,'SELECT,INSERT,UPDATE')
      AND NOT has_table_privilege('anon',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('authenticated',relation.oid,'SELECT,INSERT,UPDATE,DELETE')
      AND NOT EXISTS (
        SELECT 1 FROM aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) acl
        WHERE acl.grantee=0
      ),false) AS passed
  FROM required_tables required
  LEFT JOIN pg_class relation ON relation.oid=to_regclass('public.'||required.table_name)
)
SELECT 'CHECK|migration37_table_security|' ||
  CASE WHEN :'migration37_any_object' = 'f' THEN 'PASS'
    WHEN :'migration37_complete' = 't' AND count(*)=5 AND bool_and(passed) THEN 'PASS'
    ELSE 'FAIL' END ||
  '|when Migration 37 exists, protected payment tables require RLS, service-role DML and no PUBLIC/client DML'
FROM access_checks;

\if :migration37_complete
SELECT 'CHECK|migration37_readiness|' ||
  CASE WHEN public.cashfree_gateway_readiness() THEN 'PASS' ELSE 'FAIL' END ||
  '|Migration 37 readiness RPC must confirm schema, RLS and service-role grants';
\else
SELECT 'CHECK|migration37_readiness|' ||
  CASE WHEN :'migration37_any_object' = 'f' THEN 'PASS' ELSE 'FAIL' END ||
  '|readiness RPC evaluated only for a complete Migration 37 schema';
\endif

SELECT
  (
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='service_store_payment_settings' AND column_name IN
        ('cashfree_production_enabled','cashfree_production_verified_at',
         'cashfree_production_verified_by'))
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='cashfree_checkout_intents' AND column_name='checkout_mode')
    OR to_regprocedure('public.cashfree_production_gateway_readiness()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace=to_regnamespace('public')
      AND proname IN ('claim_cashfree_checkout_intent_for_mode',
        'complete_cashfree_checkout_intent_for_mode','process_cashfree_webhook_event_for_mode',
        'set_cashfree_production_gateway'))
    OR EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='cashfree_checkout_intents_checkout_mode_check')
    OR EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid=to_regclass('public.service_orders')
        AND conname='service_orders_provider_mode_check'
        AND pg_get_constraintdef(oid) LIKE '%cashfree%'
        AND pg_get_constraintdef(oid) LIKE '%live%')
  ) AS migration38_any_object \gset
SELECT
  (
    (SELECT count(*) = 3 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='service_store_payment_settings'
      AND column_name IN ('cashfree_production_enabled','cashfree_production_verified_at',
        'cashfree_production_verified_by'))
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='service_store_payment_settings' AND column_name='cashfree_production_enabled'
      AND data_type='boolean' AND is_nullable='NO' AND column_default='false')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='service_store_payment_settings' AND column_name='cashfree_production_verified_by'
      AND data_type='uuid' AND is_nullable='YES')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='cashfree_checkout_intents' AND column_name='checkout_mode'
      AND data_type='text' AND is_nullable='NO' AND column_default LIKE '''sandbox''%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.service_orders')
      AND conname='service_orders_provider_mode_check' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.cashfree_checkout_intents')
      AND conname='cashfree_checkout_intents_checkout_mode_check' AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%sandbox%'
      AND pg_get_constraintdef(oid) LIKE '%production%')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.service_orders')
      AND conname='service_orders_provider_mode_check' AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%provider = ''razorpay''%'
      AND pg_get_constraintdef(oid) LIKE '%provider_mode = ''test''%'
      AND pg_get_constraintdef(oid) LIKE '%provider = ''cashfree''%'
      AND pg_get_constraintdef(oid) LIKE
        '%provider_mode = ANY (ARRAY[''test''::text, ''live''::text])%')
    AND EXISTS (SELECT 1 FROM pg_constraint fk
      JOIN pg_attribute source ON source.attrelid=fk.conrelid AND source.attnum=fk.conkey[1]
      JOIN pg_attribute target ON target.attrelid=fk.confrelid AND target.attnum=fk.confkey[1]
      WHERE fk.contype='f' AND fk.convalidated AND fk.confdeltype='n'
        AND fk.conrelid=to_regclass('public.service_store_payment_settings')
        AND fk.confrelid=to_regclass('public.admin_identity_history')
        AND source.attname='cashfree_production_verified_by' AND target.attname='id')
    AND to_regprocedure('public.claim_cashfree_checkout_intent_for_mode(text,text,text,text,text,text,text,text,text,text,jsonb,bigint,text,boolean,text)') IS NOT NULL
    AND to_regprocedure('public.complete_cashfree_checkout_intent_for_mode(uuid,uuid,text,text,bigint,text,text)') IS NOT NULL
    AND to_regprocedure('public.process_cashfree_webhook_event_for_mode(text,text,text,text,text,text,bigint,text,boolean,text)') IS NOT NULL
    AND to_regprocedure('public.set_cashfree_production_gateway(uuid,boolean)') IS NOT NULL
    AND to_regprocedure('public.cashfree_production_gateway_readiness()') IS NOT NULL
  ) AS migration38_complete \gset
SELECT 'CHECK|migration38_schema_state|' ||
  CASE WHEN :'migration38_any_object' = 'f' THEN 'PASS'
    WHEN :'migration38_complete' = 't' AND :'migration37_complete' = 't' THEN 'PASS' ELSE 'FAIL' END ||
  '|state=' || CASE WHEN :'migration38_any_object' = 'f' THEN 'ABSENT'
    WHEN :'migration38_complete' = 't' AND :'migration37_complete' = 't' THEN 'COMPLETE'
    ELSE 'PARTIAL_OR_DRIFTED' END;

\if :migration38_complete
SELECT 'CHECK|migration38_readiness|' ||
  CASE WHEN public.cashfree_production_gateway_readiness() THEN 'PASS' ELSE 'FAIL' END ||
  '|Migration 38 readiness RPC must confirm mode-bound schema and service-role-only contracts';
\else
SELECT 'CHECK|migration38_readiness|' ||
  CASE WHEN :'migration38_any_object' = 'f' THEN 'PASS' ELSE 'FAIL' END ||
  '|readiness RPC evaluated only for a complete Migration 38 schema';
\endif

\if :migration37_complete
  \if :migration38_complete
    SELECT 'CHECK|cashfree_disabled|' ||
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.service_store_payment_settings
          WHERE cashfree_test_enabled IS DISTINCT FROM false
             OR cashfree_production_enabled IS DISTINCT FROM false)
      THEN 'PASS' ELSE 'FAIL' END ||
      '|Sandbox and Production activation values must remain false';
  \else
    SELECT 'CHECK|cashfree_disabled|' ||
      CASE WHEN NOT EXISTS (SELECT 1 FROM public.service_store_payment_settings
          WHERE cashfree_test_enabled IS DISTINCT FROM false)
      THEN 'PASS' ELSE 'FAIL' END ||
      '|Sandbox activation must remain false; Production setting is absent';
  \endif
\else
  SELECT 'CHECK|cashfree_disabled|' ||
    CASE WHEN :'migration37_any_object' = 'f' AND :'migration38_any_object' = 'f'
      THEN 'PASS' ELSE 'FAIL' END ||
    '|activation state is only accepted when Cashfree objects are absent or complete';
\endif

SELECT to_regclass('public.service_orders') IS NOT NULL AS service_orders_exists \gset
\if :service_orders_exists
  SELECT 'CHECK|razorpay_order_compatibility|' ||
    CASE WHEN count(*) FILTER (WHERE currency IS DISTINCT FROM 'INR'
        OR provider_mode IS DISTINCT FROM 'test') = 0 THEN 'PASS' ELSE 'FAIL' END ||
    '|Razorpay orders=' || count(*)::text ||
    ';incompatible currency/mode rows=' ||
      count(*) FILTER (WHERE currency IS DISTINCT FROM 'INR'
        OR provider_mode IS DISTINCT FROM 'test')::text
  FROM public.service_orders
  WHERE provider = 'razorpay';
\else
  SELECT 'CHECK|razorpay_order_compatibility|FAIL|service_orders table is absent';
\endif

SELECT to_regnamespace('supabase_migrations') IS NOT NULL AS migration_schema_exists \gset
\if :migration_schema_exists
  SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS migration_table_exists \gset
  \if :migration_table_exists
    SELECT has_schema_privilege(current_user, 'supabase_migrations', 'USAGE')
      AND has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT')
      AS migration_history_readable \gset
    \if :migration_history_readable
      SELECT count(*) > 0 AS migration_history_has_rows
        FROM supabase_migrations.schema_migrations \gset
      \if :migration_history_has_rows
        SELECT 'MIGRATION_HISTORY|READABLE|exact versions and names checked';
        SELECT 'MIGRATION_VERSION|' || version::text || '|' || coalesce(name,'')
        FROM supabase_migrations.schema_migrations
        WHERE version::text IN ('20261102100000','20261103100000','20261103214800')
        ORDER BY version;
        SELECT 'CHECK|migration_ledger|' ||
          CASE WHEN
            (SELECT count(*) = 1 AND bool_and(name='secure_archived_admin_permanent_deletion')
              FROM supabase_migrations.schema_migrations WHERE version::text='20261102100000')
            AND (
              (:'migration37_complete' = 't' AND
                (SELECT count(*)=1 AND bool_and(name='add_cashfree_service_payment_persistence')
                 FROM supabase_migrations.schema_migrations WHERE version::text='20261103100000')
                OR (:'migration37_any_object' = 'f' AND
                  (SELECT count(*)=0 FROM supabase_migrations.schema_migrations
                   WHERE version::text='20261103100000')))
            )
            AND (
              (:'migration38_complete' = 't' AND
                (SELECT count(*)=1 AND bool_and(name='add_cashfree_production_mode')
                 FROM supabase_migrations.schema_migrations WHERE version::text='20261103214800')
                OR (:'migration38_any_object' = 'f' AND
                  (SELECT count(*)=0 FROM supabase_migrations.schema_migrations
                   WHERE version::text='20261103214800')))
            )
          THEN 'PASS' ELSE 'FAIL' END ||
          '|readable ledger must match exact Migration 36/37/38 names and live object states';
      \else
        SELECT 'MIGRATION_HISTORY|EMPTY|readable ledger contains no rows';
        SELECT 'CHECK|migration_ledger|FAIL|empty ledger does not establish Production migration history';
      \endif
    \else
      SELECT 'MIGRATION_HISTORY|UNREADABLE|SELECT access is unavailable';
      SELECT 'CHECK|migration_ledger|FAIL|migration history is present but unreadable';
    \endif
  \else
    SELECT 'MIGRATION_HISTORY|ABSENT_TABLE|schema_migrations table is absent';
    SELECT 'CHECK|migration_ledger|FAIL|migration history table is absent; history remains unverified';
  \endif
\else
  SELECT 'MIGRATION_HISTORY|ABSENT_SCHEMA|supabase_migrations schema is absent';
  SELECT 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified';
\endif

SELECT 'LEDGER_CANDIDATE|' || table_schema || '.' || table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog','information_schema','supabase_migrations',
  'auth','realtime','storage')
  AND table_type='BASE TABLE'
  AND table_name ~* '(migration|schema_history|flyway|knex|prisma|drizzle)'
ORDER BY table_schema,table_name;
'@

if ($PostMigration38) {
  $sql += @'

SELECT 'CHECK|migration38_post_state|' ||
  CASE WHEN :'migration37_any_object' = 't'
    AND :'migration37_complete' = 't'
    AND :'migration38_any_object' = 't'
    AND :'migration38_complete' = 't'
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Migrations 37 and 38 must both be complete';
'@
}

if ($PostMigration37) {
  $sql += @'

SELECT 'CHECK|migration37_post_state|' ||
  CASE WHEN :'migration37_any_object' = 't'
    AND :'migration37_complete' = 't'
    AND :'migration38_any_object' = 'f'
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Migration 37 must be complete and Migration 38 must remain absent';
'@
}

if ($PostMigration37 -or $PostMigration38) {
  $expectedRazorpayCountSql = $ExpectedRazorpayOrderCount.ToString(
    [Globalization.CultureInfo]::InvariantCulture
  )
  $sql += @"

SELECT 'CHECK|razorpay_baseline_preserved|' ||
  CASE WHEN count(*) = $expectedRazorpayCountSql
    AND md5(coalesce((
      SELECT string_agg(row_fingerprint, '' ORDER BY order_id)
      FROM (
        SELECT id::text AS order_id,
          md5(jsonb_build_array(
            id, order_reference, tracking_token_hash, customer_name, customer_email, customer_phone,
            customer_business_name, customer_onboarding_notes, line_items::text, total_amount_paise,
            currency, provider, provider_mode, provider_order_id, provider_payment_id, payment_status,
            fulfillment_status, provider_snapshot::text,
            extract(epoch FROM paid_at), extract(epoch FROM created_at), extract(epoch FROM updated_at)
          )::text) AS row_fingerprint
        FROM public.service_orders WHERE provider = 'razorpay'
      ) historical_orders
    ), '')) = '$ExpectedRazorpayOrderFingerprint'
    AND count(*) FILTER (WHERE currency IS DISTINCT FROM 'INR'
      OR provider_mode IS DISTINCT FROM 'test'
      OR payment_session_id IS NOT NULL OR cashfree_order_id IS NOT NULL) = 0
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Razorpay count and non-PII content fingerprint match the immediately pre-migration baseline'
FROM public.service_orders
WHERE provider = 'razorpay';
"@
}

$temporarySqlPath = Join-Path $env:TEMP ("neargrow-production-cashfree-" + [guid]::NewGuid().ToString('N') + '.psql')
$temporaryOutputPath = Join-Path $env:TEMP ("neargrow-production-cashfree-output-" + [guid]::NewGuid().ToString('N') + '.txt')
$savedEnvironment = $null
$diagnostics = [System.Collections.Generic.List[string]]::new()
$queryOutput = @()
$checksPassed = $false
try {
  [System.IO.File]::WriteAllText(
    $temporarySqlPath,
    "BEGIN TRANSACTION READ ONLY;$([Environment]::NewLine)$sql$([Environment]::NewLine)COMMIT;",
    [System.Text.UTF8Encoding]::new($false)
  )
  $savedEnvironment = Enter-StagingPsqlEnvironment
  $arguments = @(
    '--no-psqlrc',
    '--host', $databaseHost,
    '--port', $databasePort,
    '--username', $databaseUser,
    '--dbname', $databaseName,
    '--password',
    '--set', 'ON_ERROR_STOP=1',
    '--set', 'VERBOSITY=verbose',
    '--no-align',
    '--tuples-only',
    '--field-separator', '|',
    '--output', $temporaryOutputPath,
    '--file', $temporarySqlPath
  )
  $processOutput = @(& $PsqlPath @arguments 2>&1)
  foreach ($message in $processOutput) {
    $line = [string]$message
    if ($line -match '^\s*Password(?: for user .*)?:\s*$') {
      Write-Host -NoNewline $line
    } elseif (-not [string]::IsNullOrWhiteSpace($line)) {
      $diagnostics.Add($line)
    }
  }
  $exitCode = $LASTEXITCODE
  $diagnosticText = $diagnostics -join "`n"
  if ($exitCode -ne 0) {
    if ($diagnosticText -match '(?i)(password|SASL|authentication) .*failed|no password supplied') {
      throw "Production database authentication failed for the pinned target (psql exit code $exitCode); no credentials were logged."
    }
    if ($diagnosticText -match '(?i)(certificate|SSL|TLS|hostname verification)') {
      throw "Production database TLS verification failed (psql exit code $exitCode); TLS verification was not weakened."
    }
    if ($diagnosticText -match '(?i)(could not connect|connection refused|connection timed out|could not translate host)') {
      throw "Could not connect to the pinned Production database (psql exit code $exitCode)."
    }
    $postgresErrorMatch = [regex]::Match(
      $diagnosticText, '(?im)\bERROR:\s+([0-9A-Z]{5}):\s*([^\r\n]*)'
    )
    if ($postgresErrorMatch.Success) {
      $postgresSqlState = $postgresErrorMatch.Groups[1].Value.ToUpperInvariant()
      $safeMessage = $postgresErrorMatch.Groups[2].Value.Trim() `
        -replace '"[^"]*"|''[^'']*''', '[redacted]' `
        -replace '(?i)\b(?:postgres(?:ql)?|https?)://\S+', '[redacted]' `
        -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+', '$1=[redacted]' `
        -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[redacted]' `
        -replace '\s+', ' '
      if ($safeMessage.Length -gt 180) {
        $safeMessage = $safeMessage.Substring(0, 180) + '...'
      }
      if ([string]::IsNullOrWhiteSpace($safeMessage)) {
        $safeMessage = 'PostgreSQL reported an error; message redacted.'
      }
      throw "Read-only Production preflight query failed (SQLSTATE $postgresSqlState): $safeMessage No result was accepted."
    }
    throw "The read-only Production preflight query failed (psql exit code $exitCode); no result was accepted."
  }
  if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf) -or
    (Get-Item -LiteralPath $temporaryOutputPath).Length -eq 0) {
    throw 'The Production psql process returned an empty verification output; no result was accepted.'
  }
  try {
    $queryOutput = @(Get-Content -LiteralPath $temporaryOutputPath -ErrorAction Stop)
  } catch {
    throw 'The Production verification output could not be read; no result was accepted.'
  }
  if ($queryOutput.Count -eq 0) {
    throw 'The Production psql process returned no verification rows; no result was accepted.'
  }
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  foreach ($path in @($temporarySqlPath, $temporaryOutputPath)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}

$expectedChecks = @(
  'target_identity','migration36_prerequisites','migration36_identity_backfill',
  'migration36_table_definitions',
  'migration36_functions_and_grants','migration36_admin_setup_rpcs',
  'migration36_table_security','admin_fk_compatibility',
  'migration36_constraints','migration36_state','migration37_schema_state',
  'migration36_triggers','migration36_internal_foreign_keys','migration37_table_security',
  'migration37_readiness','migration38_schema_state','migration38_readiness',
  'cashfree_disabled','razorpay_order_compatibility','migration_ledger'
)
if ($PostMigration37) {
  $expectedChecks += @('migration37_post_state','razorpay_baseline_preserved')
} elseif ($PostMigration38) {
  $expectedChecks += @('migration38_post_state','razorpay_baseline_preserved')
}
$checkRows = @($queryOutput | Where-Object { $_ -like 'CHECK|*' })
$migrationHistoryRows = @($queryOutput | Where-Object { $_ -like 'MIGRATION_HISTORY|*' })
$migrationVersionRows = @($queryOutput | Where-Object { $_ -like 'MIGRATION_VERSION|*' })
$alternateLedgerRows = @($queryOutput | Where-Object { $_ -like 'LEDGER_CANDIDATE|*' })
$migrationLedgerCheckRows = @($checkRows | Where-Object { ($_ -split '\|', 4)[1] -eq 'migration_ledger' })
$absentSchemaLedgerFailure = 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
$historySchemaAbsent = $migrationHistoryRows.Count -eq 1 `
  -and $migrationHistoryRows[0] -like 'MIGRATION_HISTORY|ABSENT_SCHEMA|*'
$schemaEvidenceHistoryAbsent = $SchemaEvidenceOnly `
  -and $historySchemaAbsent `
  -and $migrationVersionRows.Count -eq 0 `
  -and $alternateLedgerRows.Count -eq 0 `
  -and $migrationLedgerCheckRows.Count -eq 1 `
  -and $migrationLedgerCheckRows[0] -ceq $absentSchemaLedgerFailure
$passedNames = @()
$checksPassed = $true
if ($historySchemaAbsent -and
  ($migrationLedgerCheckRows.Count -ne 1 -or $migrationLedgerCheckRows[0] -cne $absentSchemaLedgerFailure)) {
  Write-Output 'FAIL | migration_ledger | absent history schema does not match the migration-ledger check result.'
  $checksPassed = $false
}
foreach ($row in $checkRows) {
  $parts = $row.Split([char]124, 4)
  if ($parts.Count -ne 4 -or $parts[2] -notin @('PASS','FAIL')) {
    Write-Output "FAIL | malformed check row | $row"
    $checksPassed = $false
    continue
  }
  if ($parts[1] -eq 'migration_ledger' -and $parts[2] -eq 'FAIL' -and $schemaEvidenceHistoryAbsent) {
    Write-Output 'UNVERIFIED | migration_ledger | Supabase migration-history schema is absent; no migration versions were inferred or recorded.'
    continue
  }
  if ($parts[2] -eq 'PASS') { $passedNames += $parts[1] }
  Write-Output "$($parts[2]) | $($parts[1]) | $($parts[3])"
  if ($parts[2] -ne 'PASS') { $checksPassed = $false }
}
foreach ($name in $expectedChecks) {
  if ($passedNames -notcontains $name -and -not ($name -eq 'migration_ledger' -and $schemaEvidenceHistoryAbsent)) {
    Write-Output "FAIL | missing or failed check | $name"
    $checksPassed = $false
  }
}
foreach ($name in $passedNames | Sort-Object -Unique) {
  if ($expectedChecks -notcontains $name) {
    Write-Output "FAIL | unexpected check | $name"
    $checksPassed = $false
  }
}
if ($checkRows.Count -ne $expectedChecks.Count -or
  (Compare-Object @($checkRows | ForEach-Object { ($_ -split '\|',4)[1] } | Sort-Object) @($expectedChecks | Sort-Object)).Count -ne 0) {
  Write-Output "FAIL | check set | expected exactly $($expectedChecks.Count) named checks."
  $checksPassed = $false
}
foreach ($row in @($migrationHistoryRows) + @($migrationVersionRows)) {
  Write-Output $row
}
foreach ($row in $alternateLedgerRows) {
  Write-Output "REVIEW | alternate migration-history candidate | $row"
  $checksPassed = $false
}
Write-Output ''
if ($checksPassed) {
  if ($schemaEvidenceHistoryAbsent) {
    Write-Output 'OVERALL: SCHEMA EVIDENCE PASS — Production schema, security, disabled state and Razorpay compatibility checks passed; MIGRATION HISTORY UNVERIFIED.'
  } else {
    Write-Output 'OVERALL: PASS — Production schema, migration history, disabled state and Razorpay compatibility checks passed.'
  }
  Write-Output 'This read-only preflight does not authorize or execute migrations, change variables, or enable checkout.'
} else {
  Write-Output 'OVERALL: FAIL — STOP; investigate every failed, missing, partial or unverified prerequisite.'
  exit 1
}
