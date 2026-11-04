[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [Parameter(Mandatory = $true)]
  [ValidateRange(0, [long]::MaxValue)]
  [long]$ExpectedRazorpayOrderCount,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{32}$')]
  [string]$ExpectedRazorpayOrderFingerprint,

  [switch]$SchemaEvidenceOnly,

  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
$commonPath = Join-Path $PSScriptRoot 'cashfreeStagingVerification.Common.ps1'
if (-not (Test-Path -LiteralPath $commonPath -PathType Leaf)) {
  throw 'Cashfree Staging verification helper is missing.'
}
. $commonPath

$sqlTemplate = @'
SELECT 'CHECK|target_identity|' ||
  CASE WHEN current_database() = 'postgres'
    AND current_user = 'postgres'
    AND NOT pg_is_in_recovery()
  THEN 'PASS' ELSE 'FAIL' END ||
  '|connected to the pinned Staging database and role';

/* CASHFREE_MIGRATION36_SCHEMA_EVIDENCE */

SELECT 'CHECK|cashfree_tables_and_columns|' ||
  CASE WHEN
    (SELECT count(*) = 3 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname IN ('cashfree_checkout_intents','cashfree_payment_attempts','cashfree_webhook_events'))
    AND (SELECT count(*) = 12 FROM pg_attribute
      WHERE attrelid = 'public.service_orders'::regclass
        AND attname IN ('provider','provider_mode','provider_order_id','provider_payment_id',
          'payment_status','currency','total_amount_paise','tracking_token_hash',
          'payment_session_id','cashfree_order_id','total_amount_inr_paise','id')
        AND NOT attisdropped)
    AND (SELECT count(*) = 4 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'service_store_payment_settings'
        AND column_name IN ('cashfree_test_enabled','cashfree_test_verified_at',
          'cashfree_test_verified_by','id'))
    AND (SELECT count(*) = 9 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cashfree_webhook_events'
        AND column_name IN ('id','service_order_id','event_fingerprint','event_type',
          'provider_order_id','provider_payment_id','processing_status','received_at','processed_at'))
    AND (SELECT count(*) = 9 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cashfree_webhook_events')
    AND (SELECT count(*) = 10 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cashfree_payment_attempts'
        AND column_name IN ('id','service_order_id','provider_order_id','cashfree_order_id',
          'provider_payment_id','payment_status','payment_amount_paise','currency','first_seen_at','last_seen_at'))
    AND (SELECT count(*) = 10 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cashfree_payment_attempts')
    AND (SELECT count(*) = 16 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cashfree_checkout_intents'
        AND column_name IN ('id','client_idempotency_hash','request_fingerprint','service_order_id',
          'order_reference','provider_idempotency_key','state','claim_token','lease_expires_at',
          'intent_expires_at','create_attempt_count','provider_request_started','cashfree_order_id',
          'failure_kind','created_at','updated_at'))
    AND (SELECT count(*) = 16 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cashfree_checkout_intents')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('cashfree_checkout_intents','cashfree_payment_attempts','cashfree_webhook_events')
        AND column_name ~* '(raw_body|payload|secret|payment_session_id)')
    AND EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'service_store_payment_settings'
        AND column_name = 'cashfree_test_enabled' AND data_type = 'boolean'
        AND is_nullable = 'NO' AND column_default = 'false')
    AND EXISTS (
      SELECT 1
      FROM pg_attribute attribute
      LEFT JOIN pg_attrdef column_default
        ON column_default.adrelid = attribute.attrelid
        AND column_default.adnum = attribute.attnum
      WHERE attribute.attrelid = 'public.service_orders'::regclass
        AND attribute.attname = 'total_amount_inr_paise'
        AND attribute.attgenerated = 's'
        AND pg_get_expr(column_default.adbin, column_default.adrelid) = 'total_amount_paise'
        AND NOT attribute.attisdropped
    )
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Cashfree tables and required persistence columns exist with the expected disabled/default and INR-paise shape';

SELECT 'CHECK|validated_constraints_and_foreign_keys|' ||
  CASE WHEN
    (SELECT count(*) = 14 AND bool_and(convalidated)
      FROM pg_constraint WHERE conrelid = 'public.cashfree_checkout_intents'::regclass)
    AND (SELECT count(*) = 6 AND bool_and(convalidated)
      FROM pg_constraint WHERE conrelid = 'public.cashfree_payment_attempts'::regclass)
    AND (SELECT count(*) = 6 AND bool_and(convalidated)
      FROM pg_constraint WHERE conrelid = 'public.cashfree_webhook_events'::regclass)
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.service_orders'::regclass
        AND conname = 'service_orders_provider_check' AND convalidated
        AND pg_get_constraintdef(oid) ILIKE '%razorpay%' AND pg_get_constraintdef(oid) ILIKE '%cashfree%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.service_orders'::regclass
        AND conname = 'service_orders_currency_check' AND convalidated
        AND pg_get_constraintdef(oid) ILIKE '%razorpay%' AND pg_get_constraintdef(oid) ILIKE '%cashfree%'
        AND pg_get_constraintdef(oid) ILIKE '%INR%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.service_orders'::regclass
        AND conname = 'service_orders_cashfree_checkout_identifiers_check' AND convalidated)
    AND EXISTS (
      SELECT 1 FROM pg_constraint fk
      JOIN pg_attribute source ON source.attrelid = fk.conrelid AND source.attnum = fk.conkey[1]
      WHERE fk.contype = 'f' AND fk.convalidated
        AND fk.conrelid = 'public.service_store_payment_settings'::regclass
        AND source.attname = 'cashfree_test_verified_by'
        AND fk.confrelid = 'public.admin_identity_history'::regclass
        AND fk.confdeltype = 'n'
    )
    AND (SELECT count(*) = 3 FROM pg_constraint fk
      WHERE fk.contype = 'f' AND fk.convalidated
        AND fk.conrelid IN ('public.cashfree_checkout_intents'::regclass,
          'public.cashfree_payment_attempts'::regclass,'public.cashfree_webhook_events'::regclass)
        AND fk.confrelid = 'public.service_orders'::regclass
        AND fk.confdeltype = 'n')
    AND NOT EXISTS (
      SELECT 1 FROM (VALUES
        ('public.cashfree_checkout_intents'::regclass),
        ('public.cashfree_payment_attempts'::regclass),
        ('public.cashfree_webhook_events'::regclass)
      ) AS expected(relation)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint fk
        JOIN pg_attribute source ON source.attrelid = fk.conrelid AND source.attnum = fk.conkey[1]
        WHERE fk.contype = 'f' AND fk.convalidated
          AND fk.conrelid = expected.relation
          AND source.attname = 'service_order_id'
          AND fk.confrelid = 'public.service_orders'::regclass
          AND fk.confdeltype = 'n'
      )
    )
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_webhook_events'::regclass
        AND conname = 'cashfree_webhook_events_event_fingerprint_key'
        AND contype = 'u' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_payment_attempts'::regclass
        AND conname = 'cashfree_payment_attempts_provider_payment_id_key'
        AND contype = 'u' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_checkout_intents'::regclass
        AND conname = 'cashfree_checkout_intents_client_key'
        AND contype = 'u' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_checkout_intents'::regclass
        AND conname = 'cashfree_checkout_intents_provider_idempotency_key_key'
        AND contype = 'u' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_checkout_intents'::regclass
        AND conname = 'cashfree_checkout_intents_order_reference_key'
        AND contype = 'u' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_checkout_intents'::regclass
        AND conname = 'cashfree_checkout_intents_cashfree_order_id_key'
        AND contype = 'u' AND convalidated)
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_payment_attempts'::regclass
        AND conname = 'cashfree_payment_attempts_payment_amount_paise_check'
        AND contype = 'c' AND convalidated
        AND pg_get_constraintdef(oid) ILIKE '%payment_amount_paise > 0%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_payment_attempts'::regclass
        AND conname = 'cashfree_payment_attempts_currency_check'
        AND contype = 'c' AND convalidated
        AND pg_get_constraintdef(oid) ILIKE '%currency = ''INR''%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.cashfree_checkout_intents'::regclass
        AND conname = 'cashfree_checkout_intents_lease_check'
        AND contype = 'c' AND convalidated)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|provider-aware INR constraints, validated uniqueness, and history-preserving SET NULL FKs are valid';

WITH expected_indexes(name, unique_required) AS (
  VALUES
    ('service_orders_provider_payment_session_id_uidx', true),
    ('service_orders_cashfree_order_id_uidx', true),
    ('service_orders_provider_payment_id_idx', false),
    ('cashfree_webhook_events_service_order_id_idx', false),
    ('cashfree_webhook_events_provider_order_id_idx', false),
    ('cashfree_webhook_events_provider_payment_id_idx', false),
    ('cashfree_payment_attempts_service_order_id_idx', false),
    ('cashfree_payment_attempts_provider_order_id_idx', false),
    ('cashfree_checkout_intents_recovery_idx', false)
), index_checks AS (
  SELECT e.name, n.oid IS NOT NULL AND i.indisvalid AND i.indisready
      AND i.indisunique = e.unique_required AS passed
  FROM expected_indexes e
  LEFT JOIN pg_class idx ON idx.relname = e.name
  LEFT JOIN pg_namespace n ON n.oid = idx.relnamespace AND n.nspname = 'public'
  LEFT JOIN pg_index i ON i.indexrelid = idx.oid
)
SELECT 'CHECK|indexes_valid|' ||
  CASE WHEN (SELECT count(*) = 9 AND bool_and(passed) FROM index_checks)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|all nine named Cashfree persistence and provider indexes exist and are valid';

SELECT 'CHECK|rls_and_grants|' ||
  CASE WHEN
    (SELECT count(*) = 5 AND bool_and(c.relrowsecurity)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('service_orders',
        'service_store_payment_settings','cashfree_checkout_intents',
        'cashfree_payment_attempts','cashfree_webhook_events'))
    AND has_table_privilege('service_role','public.cashfree_checkout_intents','SELECT,INSERT,UPDATE')
    AND has_table_privilege('service_role','public.cashfree_payment_attempts','SELECT,INSERT,UPDATE')
    AND has_table_privilege('service_role','public.cashfree_webhook_events','SELECT,INSERT,UPDATE')
    AND NOT has_table_privilege('service_role','public.cashfree_checkout_intents','DELETE')
    AND NOT has_table_privilege('service_role','public.cashfree_payment_attempts','DELETE')
    AND NOT has_table_privilege('service_role','public.cashfree_webhook_events','DELETE')
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE n.nspname = 'public'
        AND c.relname IN ('cashfree_checkout_intents','cashfree_payment_attempts','cashfree_webhook_events')
        AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'service_role')
        AND acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE')
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE n.nspname = 'public'
        AND c.relname IN ('cashfree_checkout_intents','cashfree_payment_attempts','cashfree_webhook_events')
        AND acl.grantee NOT IN (c.relowner, (SELECT oid FROM pg_roles WHERE rolname = 'service_role'))
    )
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE n.nspname = 'public'
        AND c.relname IN ('cashfree_checkout_intents','cashfree_payment_attempts','cashfree_webhook_events')
        AND acl.grantee IN (0,
          (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
          (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'))
        AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
    )
    AND NOT has_table_privilege('anon','public.cashfree_checkout_intents','SELECT')
    AND NOT has_table_privilege('authenticated','public.cashfree_checkout_intents','SELECT')
    AND NOT has_table_privilege('anon','public.cashfree_payment_attempts','SELECT')
    AND NOT has_table_privilege('authenticated','public.cashfree_payment_attempts','SELECT')
    AND NOT has_table_privilege('anon','public.cashfree_webhook_events','SELECT')
    AND NOT has_table_privilege('authenticated','public.cashfree_webhook_events','SELECT')
  THEN 'PASS' ELSE 'FAIL' END ||
  '|RLS is enabled; Cashfree ledgers are service-role-only, with no client or PUBLIC table grants or delete access';

WITH expected_functions(signature) AS (
  VALUES
    ('public.claim_cashfree_checkout_intent(text,text,text,text,text,text,text,text,text,text,jsonb,bigint,text,boolean)'),
    ('public.prepare_cashfree_checkout_create(uuid,uuid)'),
    ('public.mark_cashfree_checkout_intent_ambiguous(uuid,uuid,text)'),
    ('public.complete_cashfree_checkout_intent(uuid,uuid,text,text,bigint,text)'),
    ('public.process_cashfree_webhook_event(text,text,text,text,text,text,bigint,text,boolean)'),
    ('public.set_cashfree_test_gateway(uuid,boolean)'),
    ('public.confirm_service_order_payment(text,text,bigint)'),
    ('public.cashfree_gateway_readiness()')
), function_checks AS (
  SELECT p.oid IS NOT NULL
    AND p.prosecdef
    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE acl.privilege_type = 'EXECUTE'
        AND acl.grantee NOT IN (p.proowner, (SELECT oid FROM pg_roles WHERE rolname = 'service_role'))
    ) AS passed
  FROM expected_functions e
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
)
SELECT 'CHECK|rpc_signatures_and_grants|' ||
  CASE WHEN (SELECT count(*) = 8 AND bool_and(passed) FROM function_checks)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|all exact checkout, webhook, gateway and payment-confirmation RPCs are SECURITY DEFINER and service-role-only';

SELECT 'CHECK|cashfree_readiness_and_disabled_default|' ||
  CASE WHEN public.cashfree_gateway_readiness()
    AND NOT EXISTS (SELECT 1 FROM public.service_store_payment_settings
      WHERE cashfree_test_enabled IS DISTINCT FROM false)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|readiness RPC passes and Cashfree remains disabled by default';

SELECT 'CHECK|razorpay_history_preserved|' ||
  CASE WHEN
    (SELECT count(*) FROM public.service_orders WHERE provider = 'razorpay') = {0}
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
    ), '')) = '{1}'
    AND NOT EXISTS (SELECT 1 FROM public.service_orders
      WHERE provider = 'razorpay' AND (currency <> 'INR'
        OR payment_session_id IS NOT NULL OR cashfree_order_id IS NOT NULL))
  THEN 'PASS' ELSE 'FAIL' END ||
  '|pre-migration Razorpay row count and non-PII content fingerprint match; historical rows remain INR and Cashfree fields are null';

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
          count(*) FILTER (WHERE version::text = '20261103100000') = 1
            AND bool_and(name = 'add_cashfree_service_payment_persistence')
              FILTER (WHERE version::text = '20261103100000') AS migration37_exact,
          count(*) FILTER (
            WHERE version::text > '20261102100000'
              AND version::text <> '20261103100000'
          ) = 0 AS no_unexpected_newer_versions
        FROM supabase_migrations.schema_migrations
      )
      SELECT 'CHECK|migration_ledger|' ||
        CASE WHEN migration36_exact AND migration37_exact AND no_unexpected_newer_versions
          THEN 'PASS' ELSE 'FAIL' END ||
        '|readable ledger records exact Migrations 36 and 37 with no other newer versions'
      FROM migration_state;
    \else
      SELECT 'MIGRATION_HISTORY|UNREADABLE|ledger permissions are unavailable';
      SELECT 'CHECK|migration_ledger|FAIL|migration history table is not readable; no history is inferred';
    \endif
  \else
    SELECT 'MIGRATION_HISTORY|ABSENT_TABLE|migration history table is absent';
    SELECT 'CHECK|migration_ledger|FAIL|migration history table is absent; no history is inferred';
  \endif
\else
  SELECT 'MIGRATION_HISTORY|ABSENT_SCHEMA|migration history schema is absent';
  SELECT 'CHECK|migration_ledger|FAIL|migration history schema is absent; no history is inferred';
\endif

SELECT 'LEDGER_CANDIDATE|' || table_schema || '.' || table_name
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'supabase_migrations')
  AND table_schema NOT IN ('auth', 'realtime', 'storage')
  AND table_type = 'BASE TABLE'
  AND table_name ~* '(migration|schema_history|flyway|knex|prisma|drizzle)'
ORDER BY table_schema, table_name;
'@

$sqlTemplate = $sqlTemplate.Replace('/* CASHFREE_MIGRATION36_SCHEMA_EVIDENCE */', (Get-CashfreeMigration36SchemaEvidenceCheckSql))
$sql = $sqlTemplate -f $ExpectedRazorpayOrderCount, $ExpectedRazorpayOrderFingerprint
$expectedChecks = @(
  'target_identity',
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
  'cashfree_tables_and_columns',
  'validated_constraints_and_foreign_keys',
  'indexes_valid',
  'rls_and_grants',
  'rpc_signatures_and_grants',
  'cashfree_readiness_and_disabled_default',
  'razorpay_history_preserved',
  'migration_ledger'
)
$evidenceChecks = @($expectedChecks | Where-Object { $_ -ne 'migration_ledger' })
$queryOutput = Invoke-CashfreeStagingReadOnlyQuery -ProjectRef $ProjectRef -PsqlPath $PsqlPath -Sql $sql
if ($null -eq $queryOutput -or @($queryOutput).Count -eq 0 -or
  @($queryOutput | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -eq 0) {
  throw 'Cashfree Staging post-verification returned no query rows. Aborting before check parsing; no readiness result was accepted.'
}
$queryOutput = @(Add-CashfreeMigration36SchemaAggregate -QueryOutput $queryOutput)
foreach ($columnDifference in $queryOutput | Where-Object { $_ -like 'COLUMN_DIFF|*' }) {
  Write-Output "INFO | $columnDifference"
}
$passed = if ($SchemaEvidenceOnly) {
  Test-CashfreeSchemaEvidenceOnly -QueryOutput $queryOutput `
    -Phase PostMigration -ExpectedCheckNames $evidenceChecks
} else {
  Assert-CashfreeStagingCheckRows -QueryOutput $queryOutput -ExpectedNames $expectedChecks
}
if ($passed) {
  Write-Output ''
  if ($SchemaEvidenceOnly) {
    Write-Output 'OVERALL: SCHEMA EVIDENCE PASS — Migration 37 schema and preservation checks match; Migration history is UNVERIFIED.'
  } else {
    Write-Output 'OVERALL: PASS — Migration 37 schema, permissions, readiness, disabled default and Razorpay baseline verified.'
  }
} else {
  Write-Output ''
  Write-Output 'OVERALL: FAIL — STOP; do not enable Cashfree or deploy until every failed check is resolved.'
  exit 1
}
