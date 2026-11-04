[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [switch]$SchemaEvidenceOnly,

  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
$commonPath = Join-Path $PSScriptRoot 'cashfreeStagingVerification.Common.ps1'
if (-not (Test-Path -LiteralPath $commonPath -PathType Leaf)) {
  throw 'Cashfree Staging verification helper is missing.'
}
. $commonPath

$sql = @'
SELECT 'CHECK|target_identity|' ||
  CASE WHEN current_database() = 'postgres'
    AND current_user = 'postgres'
    AND NOT pg_is_in_recovery()
  THEN 'PASS' ELSE 'FAIL' END ||
  '|connected to the pinned Staging database and role';

SELECT 'CHECK|migration36_live_prerequisites|' ||
  CASE WHEN
    to_regclass('public.admin_identity_history') IS NOT NULL
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.admin_identity_history'))
    AND has_table_privilege('service_role', 'public.admin_identity_history', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.admin_identity_history', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.admin_identity_history', 'SELECT')
    AND to_regclass('public.admin_permanent_deletion_jobs') IS NOT NULL
    AND to_regclass('public.admin_permanent_deletion_email_reservations') IS NOT NULL
    AND to_regprocedure('public.sync_admin_identity_history()') IS NOT NULL
    AND to_regprocedure('public.get_admin_permanent_deletion_state(uuid)') IS NOT NULL
    AND to_regprocedure('public.begin_admin_permanent_deletion(uuid,uuid,text,text)') IS NOT NULL
    AND to_regprocedure('public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)') IS NOT NULL
    AND to_regprocedure('public.complete_admin_permanent_deletion(uuid,uuid)') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = to_regclass('public.admin_users')
        AND tgname = 'admin_users_sync_identity_history'
        AND tgfoid = to_regprocedure('public.sync_admin_identity_history()')
        AND tgtype = 29
        AND tgenabled = 'O'
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint fk
      JOIN pg_attribute source ON source.attrelid = fk.conrelid AND source.attnum = fk.conkey[1]
      WHERE fk.contype = 'f'
        AND fk.conrelid = to_regclass('public.service_store_payment_settings')
        AND source.attname = 'updated_by'
        AND fk.confrelid = to_regclass('public.admin_identity_history')
        AND fk.convalidated
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint fk
      JOIN pg_attribute source ON source.attrelid = fk.conrelid AND source.attnum = fk.conkey[1]
      WHERE fk.contype = 'f'
        AND fk.conrelid = to_regclass('public.service_store_payment_settings')
        AND source.attname = 'razorpay_test_verified_by'
        AND fk.confrelid = to_regclass('public.admin_identity_history')
        AND fk.convalidated
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Migration 36 retained identity history, live RPCs, trigger and attribution FK prerequisites exist';

/* CASHFREE_MIGRATION36_SCHEMA_EVIDENCE */

SELECT 'CHECK|payment_schema_and_permissions|' ||
  CASE WHEN
    to_regclass('public.service_orders') IS NOT NULL
    AND to_regclass('public.service_store_payment_settings') IS NOT NULL
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.service_orders'))
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.service_store_payment_settings'))
    AND has_table_privilege('service_role', 'public.service_orders', 'SELECT,INSERT,UPDATE')
    AND has_table_privilege('service_role', 'public.service_store_payment_settings', 'SELECT,INSERT,UPDATE')
    AND NOT has_table_privilege('anon', 'public.service_orders', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.service_orders', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.service_store_payment_settings', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.service_store_payment_settings', 'SELECT')
    AND (SELECT count(*) = 8 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'service_orders'
        AND column_name IN ('provider','provider_mode','provider_order_id','provider_payment_id',
          'payment_status','currency','total_amount_paise','tracking_token_hash'))
    AND (SELECT count(*) = 4 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'service_store_payment_settings'
        AND column_name IN ('razorpay_test_enabled','razorpay_test_verified_key_id',
          'razorpay_test_verified_at','razorpay_test_verified_by'))
    AND EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.service_orders')
        AND conname = 'service_orders_provider_check'
        AND convalidated
        AND pg_get_constraintdef(oid) ILIKE '%provider = ''razorpay''%'
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.service_orders')
        AND conname = 'service_orders_currency_check'
        AND convalidated
        AND pg_get_constraintdef(oid) ILIKE '%currency = ''INR''%'
    )
    AND to_regprocedure('public.confirm_service_order_payment(text,text,bigint)') IS NOT NULL
    AND has_function_privilege('service_role',
      'public.confirm_service_order_payment(text,text,bigint)', 'EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.confirm_service_order_payment(text,text,bigint)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated',
      'public.confirm_service_order_payment(text,text,bigint)', 'EXECUTE')
  THEN 'PASS' ELSE 'FAIL' END ||
  '|existing payment tables, RLS, service-role access, Razorpay/INR constraints and confirmation RPC are intact';

SELECT 'CHECK|cashfree_objects_absent|' ||
  CASE WHEN
    NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'service_orders'
        AND column_name IN ('payment_session_id','cashfree_order_id','total_amount_inr_paise'))
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'service_store_payment_settings'
        AND column_name IN ('cashfree_test_enabled','cashfree_test_verified_at','cashfree_test_verified_by'))
    AND to_regclass('public.cashfree_checkout_intents') IS NULL
    AND to_regclass('public.cashfree_payment_attempts') IS NULL
    AND to_regclass('public.cashfree_webhook_events') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE '%cashfree%')
    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('service_orders_provider_payment_session_id_uidx',
          'service_orders_cashfree_order_id_uidx','service_orders_provider_payment_id_idx',
          'cashfree_webhook_events_service_order_id_idx','cashfree_webhook_events_provider_order_id_idx',
          'cashfree_webhook_events_provider_payment_id_idx','cashfree_payment_attempts_service_order_id_idx',
          'cashfree_payment_attempts_provider_order_id_idx','cashfree_checkout_intents_recovery_idx'))
    AND NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname IN ('service_orders_cashfree_checkout_identifiers_check',
        'cashfree_webhook_events_event_fingerprint_key','cashfree_payment_attempts_provider_payment_id_key',
        'cashfree_checkout_intents_client_key','cashfree_checkout_intents_lease_check'))
  THEN 'PASS' ELSE 'FAIL' END ||
  '|no Cashfree Migration 37 columns, relations, RPCs, constraints or indexes exist';

SELECT 'RAZORPAY_BASELINE|' || count(*)::text || '|' ||
  md5(coalesce(string_agg(row_fingerprint, '' ORDER BY order_id), ''))
FROM (
  SELECT id::text AS order_id,
    md5(jsonb_build_array(
      id, order_reference, tracking_token_hash, customer_name, customer_email, customer_phone,
      customer_business_name, customer_onboarding_notes, line_items::text, total_amount_paise,
      currency, provider, provider_mode, provider_order_id, provider_payment_id, payment_status,
      fulfillment_status, provider_snapshot::text,
      extract(epoch FROM paid_at), extract(epoch FROM created_at), extract(epoch FROM updated_at)
    )::text) AS row_fingerprint
  FROM public.service_orders
  WHERE provider = 'razorpay'
) razorpay_orders;

SELECT to_regnamespace('supabase_migrations') IS NOT NULL AS migration_schema_exists \gset
\if :migration_schema_exists
  SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS migration_table_exists \gset
  \if :migration_table_exists
    SELECT has_schema_privilege(current_user, 'supabase_migrations', 'USAGE')
      AND has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT')
      AS migration_history_readable \gset
    \if :migration_history_readable
      SELECT count(*) = 0 AS migration_history_empty
        FROM supabase_migrations.schema_migrations \gset
      \if :migration_history_empty
        SELECT 'MIGRATION_HISTORY|EMPTY|ledger is readable but has no rows';
      \else
        SELECT 'MIGRATION_HISTORY|READABLE|ledger has rows; exact versions are checked below';
      \endif
      WITH migration_state AS (
        SELECT
          count(*) FILTER (WHERE version::text = '20261102100000') = 1
            AND bool_and(name = 'secure_archived_admin_permanent_deletion')
              FILTER (WHERE version::text = '20261102100000') AS migration36_exact,
          count(*) FILTER (WHERE version::text = '20261103100000') = 0 AS migration37_absent,
          count(*) FILTER (WHERE version::text > '20261102100000') = 0 AS no_newer_unknown_versions
        FROM supabase_migrations.schema_migrations
      )
      SELECT 'CHECK|migration_ledger|' ||
        CASE WHEN migration36_exact AND migration37_absent AND no_newer_unknown_versions
          THEN 'PASS' ELSE 'FAIL' END ||
        '|readable ledger records exact Migration 36; Migration 37 and every other newer version are absent'
      FROM migration_state;
    \else
      SELECT 'MIGRATION_HISTORY|UNREADABLE|ledger permissions are unavailable';
      SELECT 'CHECK|migration_ledger|FAIL|migration history table is not readable; reconcile history before continuing';
    \endif
  \else
    SELECT 'MIGRATION_HISTORY|ABSENT_TABLE|migration history table is absent';
    SELECT 'CHECK|migration_ledger|FAIL|migration history table is absent; reconcile history before continuing';
  \endif
\else
  SELECT 'MIGRATION_HISTORY|ABSENT_SCHEMA|migration history schema is absent';
  SELECT 'CHECK|migration_ledger|FAIL|migration history schema is absent; reconcile history before continuing';
\endif

SELECT 'LEDGER_CANDIDATE|' || table_schema || '.' || table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'supabase_migrations')
  AND table_schema NOT IN ('auth', 'realtime', 'storage')
  AND table_type = 'BASE TABLE'
  AND table_name ~* '(migration|schema_history|flyway|knex|prisma|drizzle)'
ORDER BY table_schema, table_name;
'@

$sql = $sql.Replace('/* CASHFREE_MIGRATION36_SCHEMA_EVIDENCE */', (Get-CashfreeMigration36SchemaEvidenceCheckSql))
$expectedChecks = @(
  'target_identity',
  'migration36_live_prerequisites',
  'migration36_table_definitions',
  'migration36_table_security',
  'migration36_triggers',
  'migration36_function_sync_admin_identity_history',
  'migration36_function_lock_admin_email_reservation',
  'migration36_function_guard_admin_email_reservation',
  'migration36_function_guard_auth_email_reservation',
  'migration36_function_guard_admin_permanent_deletion_in_progress',
  'migration36_function_get_admin_permanent_deletion_state',
  'migration36_function_begin_admin_permanent_deletion',
  'migration36_function_record_admin_permanent_deletion_failure',
  'migration36_function_complete_admin_permanent_deletion',
  'migration36_function_overloads',
  'migration36_constraints_and_indexes',
  'migration36_internal_foreign_keys',
  'migration36_identity_history_backfill',
  'migration36_admin_foreign_keys',
  'migration36_schema_evidence',
  'payment_schema_and_permissions',
  'cashfree_objects_absent',
  'migration_ledger'
)
$evidenceChecks = @($expectedChecks | Where-Object { $_ -ne 'migration_ledger' })
$queryOutput = Invoke-CashfreeStagingReadOnlyQuery -ProjectRef $ProjectRef -PsqlPath $PsqlPath -Sql $sql
if ($null -eq $queryOutput -or @($queryOutput).Count -eq 0 -or
  @($queryOutput | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -eq 0) {
  throw 'Cashfree Staging preflight returned no query rows. Aborting before check parsing; no readiness result was accepted.'
}
$queryOutput = @(Add-CashfreeMigration36SchemaAggregate -QueryOutput $queryOutput)
foreach ($columnDifference in $queryOutput | Where-Object { $_ -like 'COLUMN_DIFF|*' }) {
  Write-Output "INFO | $columnDifference"
}
if ($SchemaEvidenceOnly) {
  $checksPassed = Test-CashfreeSchemaEvidenceOnly -QueryOutput $queryOutput `
    -Phase Preflight -ExpectedCheckNames $evidenceChecks
} else {
  $checksPassed = Assert-CashfreeStagingCheckRows -QueryOutput $queryOutput -ExpectedNames $expectedChecks
}
$baseline = @($queryOutput | Where-Object { $_ -match '^RAZORPAY_BASELINE\|\d+\|[0-9a-f]{32}$' })
if ($baseline.Count -ne 1) {
  Write-Output 'FAIL | Razorpay baseline | missing or malformed non-PII baseline fingerprint'
  $checksPassed = $false
} else {
  Write-Output "RAZORPAY_BASELINE | $($baseline[0].Substring('RAZORPAY_BASELINE|'.Length))"
}

Write-Output ''
if ($checksPassed) {
  if ($SchemaEvidenceOnly) {
    Write-Output 'OVERALL: SCHEMA EVIDENCE PASS — prerequisites match; Migration history is UNVERIFIED.'
  } else {
    Write-Output 'OVERALL: PASS — Staging is eligible for a separately reviewed Migration 37 apply.'
  }
  Write-Output 'No migration was executed and no migration history was written.'
} else {
  Write-Output 'OVERALL: FAIL — STOP; reconcile every failed prerequisite or history condition first.'
  exit 1
}
