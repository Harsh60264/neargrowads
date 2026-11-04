import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const originalMigration = readFileSync(
  new URL('../supabase/migrations/20261022150000_create_service_orders_and_payment_settings.sql', import.meta.url),
  'utf8',
);
const cashfreeMigration = readFileSync(
  new URL('../supabase/migrations/20261103100000_add_cashfree_service_payment_persistence.sql', import.meta.url),
  'utf8',
);
const cashfreeProductionMigration = readFileSync(
  new URL('../supabase/migrations/20261103214800_add_cashfree_production_mode.sql', import.meta.url),
  'utf8',
);
const adminPermanentDeletionMigration = readFileSync(
  new URL('../supabase/migrations/20261102100000_secure_archived_admin_permanent_deletion.sql', import.meta.url),
  'utf8',
);
const stagingRunner = readFileSync(new URL('../scripts/apply-staging-supabase-migrations.ps1', import.meta.url), 'utf8');
const stagingVerifier = readFileSync(new URL('../scripts/verify-staging-supabase-migrations.ps1', import.meta.url), 'utf8');
const stagingCashfreeCommon = readFileSync(
  new URL('../scripts/cashfreeStagingVerification.Common.ps1', import.meta.url),
  'utf8',
);
const stagingCashfreePreflight = readFileSync(
  new URL('../scripts/verify-staging-cashfree-migration-preflight.ps1', import.meta.url),
  'utf8',
);
const stagingCashfreePost = readFileSync(
  new URL('../scripts/verify-staging-cashfree-migration-post.ps1', import.meta.url),
  'utf8',
);
const deployment = readFileSync(new URL('../docs/deployment.md', import.meta.url), 'utf8');
const stagingRunbook = readFileSync(new URL('../docs/staging-migration-runner.md', import.meta.url), 'utf8');

test('Cashfree persistence migration preserves the existing Razorpay order model and payment RPC', () => {
  assert.match(originalMigration, /provider text NOT NULL DEFAULT 'razorpay' CHECK \(provider = 'razorpay'\)/i);
  assert.match(originalMigration, /currency text NOT NULL DEFAULT 'INR' CHECK \(currency = 'INR'\)/i);
  assert.match(originalMigration, /FUNCTION public\.confirm_service_order_payment/i);
  assert.match(originalMigration, /order_row\.payment_status <> 'pending'/i);

  assert.match(cashfreeMigration, /CHECK \(provider IN \('razorpay', 'cashfree'\)\)/i);
  assert.match(cashfreeMigration, /provider = 'razorpay' AND currency = 'INR'/i);
  assert.match(cashfreeMigration, /provider = 'cashfree' AND currency = 'INR'/i);
  assert.doesNotMatch(cashfreeMigration, /currency ~ '\^\[A-Z\]\{3\}\$'/i);
  assert.match(cashfreeMigration, /provider_order_id IS NOT NULL[\s\S]*?payment_status = 'pending'[\s\S]*?payment_session_id IS NULL[\s\S]*?cashfree_order_id IS NULL/i);
  assert.match(cashfreeMigration, /payment_session_id IS NOT NULL[\s\S]*?cashfree_order_id IS NOT NULL/i);
  assert.match(cashfreeMigration, /length\(btrim\(provider_order_id\)\) > 0/i);
  assert.match(cashfreeMigration, /length\(btrim\(payment_session_id\)\) > 0/i);
  assert.match(cashfreeMigration, /cashfree_test_enabled boolean NOT NULL DEFAULT false/i);
  assert.match(cashfreeMigration, /cashfree_order_id text/i);
  assert.match(cashfreeMigration, /total_amount_inr_paise bigint[\s\S]*?GENERATED ALWAYS AS \(total_amount_paise\) STORED/i);
  assert.match(cashfreeMigration, /explicitly denominated in INR paise/i);
  assert.match(cashfreeMigration, /CREATE OR REPLACE FUNCTION public\.process_cashfree_webhook_event/i);
  assert.match(cashfreeMigration, /CREATE OR REPLACE FUNCTION public\.set_cashfree_test_gateway/i);
  assert.doesNotMatch(cashfreeMigration, /DROP FUNCTION/i);
  assert.doesNotMatch(cashfreeMigration, /DELETE FROM public\.service_store_payment_audit/i);
});

test('Cashfree webhook ledger keeps durable deduplication and reconciliation metadata without age-based deletion', () => {
  assert.match(cashfreeMigration, /CREATE TABLE IF NOT EXISTS public\.cashfree_webhook_events/i);
  assert.match(cashfreeMigration, /event_fingerprint text NOT NULL/i);
  assert.match(cashfreeMigration, /UNIQUE \(event_fingerprint\)/i);
  assert.match(cashfreeMigration, /SHA-256 fingerprint of the exact verified raw webhook body/i);
  assert.match(cashfreeMigration, /Detects byte-identical retries only/i);
  assert.match(cashfreeMigration, /Retain fingerprints and provider identifiers; do not purge solely by age/i);
  assert.match(cashfreeMigration, /provider_payment_id text/i);
  assert.match(cashfreeMigration, /cashfree_webhook_events_provider_payment_id_idx/i);
  assert.match(cashfreeMigration, /CREATE TABLE IF NOT EXISTS public\.cashfree_payment_attempts/i);
  assert.match(cashfreeMigration, /CREATE TABLE IF NOT EXISTS public\.cashfree_checkout_intents/i);
  assert.match(cashfreeMigration, /client_idempotency_hash text NOT NULL/i);
  assert.match(cashfreeMigration, /request_fingerprint text NOT NULL/i);
  assert.match(cashfreeMigration, /provider_idempotency_key text NOT NULL UNIQUE/i);
  assert.match(cashfreeMigration, /provider_idempotency_key ~ '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-8\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$'/i);
  assert.match(cashfreeMigration, /provider_request_started boolean NOT NULL DEFAULT false/i);
  assert.match(cashfreeMigration, /intent_expires_at timestamptz NOT NULL/i);
  assert.match(cashfreeMigration, /create_attempt_count BETWEEN 0 AND 3/i);
  assert.match(cashfreeMigration, /PERFORM pg_advisory_xact_lock\(hashtextextended\(p_client_idempotency_hash, 0\)\)/i);
  assert.match(cashfreeMigration, /ON DELETE SET NULL/i);
  assert.match(cashfreeMigration, /complete_cashfree_checkout_intent/i);
  assert.match(cashfreeMigration, /prepare_cashfree_checkout_create/i);
  assert.match(cashfreeMigration, /mark_cashfree_checkout_intent_ambiguous/i);
  assert.match(cashfreeMigration, /GRANT EXECUTE ON FUNCTION public\.claim_cashfree_checkout_intent[\s\S]*?TO service_role/i);
  assert.match(cashfreeMigration, /REVOKE ALL ON TABLE public\.cashfree_checkout_intents FROM anon, authenticated, PUBLIC/i);
  assert.match(cashfreeMigration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.cashfree_checkout_intents TO service_role/i);
  assert.doesNotMatch(cashfreeMigration, /GRANT DELETE ON TABLE public\.cashfree_checkout_intents/i);
  assert.doesNotMatch(cashfreeMigration, /DELETE FROM public\.cashfree_checkout_intents|DROP TABLE public\.cashfree_checkout_intents/i);
  assert.match(cashfreeMigration, /CONSTRAINT cashfree_payment_attempts_provider_payment_id_key UNIQUE \(provider_payment_id\)/i);
  assert.match(cashfreeMigration, /payment_status = CASE[\s\S]*?stored_attempt\.payment_status = 'SUCCESS' THEN 'SUCCESS'/i);
  assert.match(cashfreeMigration, /order_row\.payment_status = 'paid'[\s\S]*?additional_successful_attempt/i);
  assert.match(cashfreeMigration, /confirm_service_order_payment\([\s\S]*?p_payment_amount_paise/i);
  assert.match(cashfreeMigration, /cashfree_payment_attempts ENABLE ROW LEVEL SECURITY/i);
  assert.match(cashfreeMigration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.cashfree_payment_attempts TO service_role/i);
  assert.match(cashfreeMigration, /REVOKE ALL ON FUNCTION public\.process_cashfree_webhook_event/i);
  assert.match(cashfreeMigration, /REVOKE ALL ON FUNCTION public\.set_cashfree_test_gateway/i);
  assert.match(cashfreeMigration, /service_orders_provider_payment_id_idx/i);
  assert.match(cashfreeMigration, /service_order_id uuid REFERENCES public\.service_orders\(id\) ON DELETE SET NULL/i);
  assert.match(cashfreeMigration, /ALTER TABLE public\.cashfree_webhook_events ENABLE ROW LEVEL SECURITY/i);
  assert.match(cashfreeMigration, /REVOKE ALL ON TABLE public\.cashfree_webhook_events FROM anon, authenticated, PUBLIC/i);
  assert.match(cashfreeMigration, /REVOKE ALL ON TABLE public\.cashfree_webhook_events FROM service_role/i);
  assert.match(cashfreeMigration, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.cashfree_webhook_events TO service_role/i);
  assert.doesNotMatch(cashfreeMigration, /DELETE FROM public\.cashfree_webhook_events|DROP TABLE public\.cashfree_webhook_events/i);
  assert.doesNotMatch(cashfreeMigration, /payload jsonb|raw_body|webhook_secret|access_token|GRANT DELETE/i);
});

test('Cashfree Production migration is additive, owner-gated, mode-bound, and keeps Razorpay test-only', () => {
  assert.match(cashfreeProductionMigration, /^BEGIN;/);
  assert.match(cashfreeProductionMigration, /COMMIT;\s*$/);
  assert.match(cashfreeProductionMigration, /cashfree_production_enabled boolean NOT NULL DEFAULT false/i);
  assert.match(cashfreeProductionMigration, /cashfree_production_verified_by uuid[\s\S]*?REFERENCES public\.admin_identity_history\(id\) ON DELETE SET NULL/i);
  assert.match(cashfreeProductionMigration, /checkout_mode text NOT NULL DEFAULT 'sandbox'/i);
  assert.match(cashfreeProductionMigration, /provider = 'razorpay' AND provider_mode = 'test'/i);
  assert.match(cashfreeProductionMigration, /provider = 'cashfree' AND provider_mode IN \('test', 'live'\)/i);
  assert.match(cashfreeProductionMigration, /p_checkout_mode IS DISTINCT FROM 'production'/i);
  assert.match(cashfreeProductionMigration, /provider_mode = 'live'/i);
  assert.match(cashfreeProductionMigration, /cashfree_production_gateway_readiness/i);
  assert.match(cashfreeProductionMigration, /cashfree_production_enabled = p_enable/i);
  assert.match(cashfreeProductionMigration, /role = 'owner' AND is_primary_owner = true/i);
  assert.match(cashfreeProductionMigration, /REVOKE ALL ON FUNCTION public\.set_cashfree_production_gateway[\s\S]*?FROM PUBLIC, anon, authenticated/i);
  assert.match(cashfreeProductionMigration, /GRANT EXECUTE ON FUNCTION public\.set_cashfree_production_gateway[\s\S]*?TO service_role/i);
  assert.doesNotMatch(cashfreeProductionMigration, /INSERT INTO supabase_migrations|DROP TABLE public\.service_orders|DELETE FROM public\.service_orders/i);
});

test('Cashfree readiness RPC checks exact required signatures, RLS, service-role access and public revocation', () => {
  const requiredSignatures = [
    'public.claim_cashfree_checkout_intent(text,text,text,text,text,text,text,text,text,text,jsonb,bigint,text,boolean)',
    'public.prepare_cashfree_checkout_create(uuid,uuid)',
    'public.mark_cashfree_checkout_intent_ambiguous(uuid,uuid,text)',
    'public.complete_cashfree_checkout_intent(uuid,uuid,text,text,bigint,text)',
    'public.process_cashfree_webhook_event(text,text,text,text,text,text,bigint,text,boolean)',
    'public.set_cashfree_test_gateway(uuid,boolean)',
    'public.confirm_service_order_payment(text,text,bigint)',
    'public.cashfree_gateway_readiness()',
  ];
  const readinessFunction = cashfreeMigration.slice(
    cashfreeMigration.indexOf('CREATE OR REPLACE FUNCTION public.cashfree_gateway_readiness()'),
  );
  for (const signature of requiredSignatures) {
    assert.ok(readinessFunction.includes(`'${signature}'`), `Missing exact readiness signature: ${signature}`);
  }
  assert.match(readinessFunction, /to_regprocedure\(procedure_signature\)/i);
  assert.match(readinessFunction, /has_function_privilege\('service_role',\s*procedure_oid,\s*'EXECUTE'\)/i);
  assert.match(readinessFunction, /acl_entry\.grantee IN \(0,\s*anon_oid,\s*authenticated_oid\)/i);
  assert.match(readinessFunction, /NOT has_table_privilege\('service_role'/i);
  assert.match(readinessFunction, /relrowsecurity/i);
  assert.match(readinessFunction, /cashfree_gateway_readiness\(\)\s+FROM PUBLIC, anon, authenticated/i);
  assert.match(readinessFunction, /cashfree_gateway_readiness\(\)\s+TO service_role/i);
});

test('Migration 37 verifier attribution points to retained Migration 36 identity history', () => {
  assert.match(adminPermanentDeletionMigration, /CREATE TABLE IF NOT EXISTS public\.admin_identity_history/i);
  assert.match(adminPermanentDeletionMigration, /REFERENCES public\.admin_identity_history\(id\)/i);
  assert.match(
    cashfreeMigration,
    /cashfree_test_verified_by uuid\s+REFERENCES public\.admin_identity_history\(id\) ON DELETE SET NULL/i,
  );
  assert.match(stagingCashfreePost, /source\.attname = 'cashfree_test_verified_by'/i);
  assert.match(stagingCashfreePost, /fk\.confrelid = 'public\.admin_identity_history'::regclass/i);
  assert.match(stagingCashfreePost, /fk\.confdeltype = 'n'/i);
});

test('Staging migration inventory recognizes 37 files without bulk-queuing migrations 35-37', () => {
  for (const script of [stagingRunner, stagingVerifier]) {
    assert.match(script, /allMigrationFiles\.Count -ne 37/i);
    assert.match(script, /20261031010000_complete_admin_temporary_password_setup\.sql/i);
    assert.match(script, /20261102100000_secure_archived_admin_permanent_deletion\.sql/i);
    assert.match(script, /20261103100000_add_cashfree_service_payment_persistence\.sql/i);
  }
  assert.match(stagingRunner, /exactly migrations 4 through 34/i);
  assert.match(stagingRunner, /Out-of-band migration 35; never queued/i);
  assert.match(stagingRunner, /Migration 36; never bulk-queued/i);
  assert.match(stagingRunner, /Migration 37; requires dedicated Staging preflight and verifier/i);
  assert.doesNotMatch(stagingRunner, /migrationNames\s*=\s*@\([\s\S]*?20261103100000_add_cashfree_service_payment_persistence\.sql/i);
  assert.match(stagingVerifier, /exactly 31 migrations in the staging application range \(4-34\)/i);
});

test('Cashfree Staging preflight and post-verifier are pinned, read-only and fail closed', () => {
  assert.match(stagingCashfreeCommon, /CashfreeProductionProjectRef = 'axbjzmdokfoftzfgwiql'/i);
  assert.match(stagingCashfreeCommon, /CashfreeStagingProjectRef = 'kdaixomygsuxadofoieb'/i);
  assert.match(stagingCashfreeCommon, /\$script:CashfreeStagingPoolerHost = 'aws-0-eu-west-1\.pooler\.supabase\.com'/i);
  assert.match(stagingCashfreeCommon, /\$script:CashfreeStagingDatabaseUser = "postgres\.\$script:CashfreeStagingProjectRef"/i);
  assert.match(stagingCashfreeCommon, /\$expectedDatabaseUser = "postgres\.\$script:CashfreeStagingProjectRef"/i);
  assert.match(stagingCashfreeCommon, /Database username does not match the pinned Staging project/i);
  assert.match(stagingCashfreeCommon, /'--username', \$script:CashfreeStagingDatabaseUser/i);
  assert.match(stagingCashfreeCommon, /The Production project reference is prohibited/i);
  assert.match(stagingCashfreeCommon, /ProjectRef must exactly match the pinned Staging project reference/i);
  assert.match(stagingCashfreeCommon, /TLS:\s+verify-full/i);
  assert.match(stagingCashfreeCommon, /Enter-StagingPsqlEnvironment/i);
  assert.match(stagingCashfreeCommon, /BEGIN TRANSACTION READ ONLY/i);
  assert.match(stagingCashfreeCommon, /Type the exact Staging project ref shown above to continue/i);

  assert.match(stagingCashfreePreflight, /migration36_live_prerequisites/i);
  assert.match(stagingCashfreePreflight, /current_user = 'postgres'/i);
  assert.match(stagingCashfreePreflight, /payment_schema_and_permissions/i);
  assert.match(stagingCashfreePreflight, /cashfree_objects_absent/i);
  assert.match(stagingCashfreePreflight, /migration_ledger/i);
  assert.match(stagingCashfreePreflight, /\[switch\]\$SchemaEvidenceOnly/i);
  assert.match(stagingCashfreePreflight, /MIGRATION_HISTORY\|ABSENT_SCHEMA/i);
  assert.match(stagingCashfreePreflight, /MIGRATION_HISTORY\|EMPTY/i);
  assert.match(stagingCashfreePreflight, /LEDGER_CANDIDATE/i);
  assert.match(stagingCashfreePreflight, /migration36_schema_evidence/i);
  assert.match(stagingCashfreePreflight, /RAZORPAY_BASELINE/i);
  assert.match(stagingCashfreePreflight, /Migration 37 and every other newer version are absent/i);
  assert.match(stagingCashfreePreflight, /version::text > '20261102100000'/i);
  assert.doesNotMatch(stagingCashfreePreflight, /^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/im);

  assert.match(stagingCashfreePost, /ExpectedRazorpayOrderCount/i);
  assert.match(stagingCashfreePost, /ExpectedRazorpayOrderFingerprint/i);
  assert.match(stagingCashfreePost, /\[switch\]\$SchemaEvidenceOnly/i);
  assert.match(stagingCashfreePost, /MIGRATION_HISTORY\|ABSENT_SCHEMA/i);
  assert.match(stagingCashfreePost, /SCHEMA EVIDENCE PASS.*UNVERIFIED/i);
  for (const name of [
    'validated_constraints_and_foreign_keys',
    'indexes_valid',
    'rls_and_grants',
    'rpc_signatures_and_grants',
    'cashfree_readiness_and_disabled_default',
    'razorpay_history_preserved',
    'migration_ledger',
  ]) {
    assert.ok(stagingCashfreePost.includes(name), `Post-migration verifier is missing ${name}`);
  }
  assert.match(stagingCashfreePost, /cashfree_gateway_readiness\(\)/i);
  assert.match(stagingCashfreePost, /current_user = 'postgres'/i);
  assert.match(stagingCashfreePost, /all exact checkout, webhook, gateway and payment-confirmation RPCs/i);
  assert.match(stagingCashfreePost, /LEFT JOIN pg_attrdef column_default[\s\S]*?pg_get_expr\(column_default\.adbin, column_default\.adrelid\)/i);
  assert.doesNotMatch(stagingCashfreePost, /pg_get_expr\(adbin, adrelid\)/i);
  assert.match(stagingCashfreePost, /version::text <> '20261103100000'/i);
  assert.match(stagingCashfreePost, /OVERALL: FAIL — STOP/i);
  assert.match(stagingCashfreeCommon, /function Test-CashfreeSchemaEvidenceOnly/i);
  assert.match(stagingCashfreeCommon, /ABSENT_SCHEMA','ABSENT_TABLE','EMPTY/i);
  assert.match(stagingCashfreeCommon, /accepts only absent or empty history/i);
  assert.match(stagingCashfreeCommon, /exact Migration 36 tables, columns, validated keys/i);
  assert.match(stagingCashfreeCommon, /Get-CashfreeMigration36SchemaDiagnosticsSql/i);
  assert.match(stagingCashfreeCommon, /migration36_constraints_and_indexes/i);
  assert.match(stagingCashfreeCommon, /migration36_admin_foreign_keys/i);
  const adminForeignKeyCheck = stagingCashfreeCommon.match(
    /WITH expected\(source_table, source_column, target_table, target_column\) AS \([\s\S]*?CHECK\|migration36_admin_foreign_keys\|[\s\S]*?Migration 37 Cashfree attribution FK/,
  )?.[0];
  assert.ok(adminForeignKeyCheck, 'Migration 36 and 37 Admin foreign keys must have an explicit combined check.');
  assert.match(adminForeignKeyCheck, /count\(\*\)=16 FROM actual_historical/i);
  assert.match(adminForeignKeyCheck, /EXCEPT[\s\S]*actual_historical/i);
  assert.match(adminForeignKeyCheck, /bool_and\(validated\) FROM actual_historical/i);
  assert.match(
    adminForeignKeyCheck,
    /source_table='public\.service_store_payment_settings'\s+AND source_column='cashfree_test_verified_by'/i,
  );
  assert.match(adminForeignKeyCheck, /count\(\*\)=1 FROM cashfree_fk/i);
  assert.match(adminForeignKeyCheck, /service_store_payment_settings_cashfree_test_verified_by_fkey/i);
  assert.match(adminForeignKeyCheck, /target_table='public\.admin_identity_history'/i);
  assert.match(adminForeignKeyCheck, /validated\s+AND delete_action='n'/i);
  assert.match(adminForeignKeyCheck, /actual_historical\s+EXCEPT SELECT \* FROM expected/i);
  assert.match(stagingCashfreeCommon, /Failed subchecks:/i);
  assert.match(stagingCashfreeCommon, /begin_admin_permanent_deletion[\s\S]*?public\.lock_admin_email_reservation/i);
  assert.doesNotMatch(
    stagingCashfreeCommon,
    /WHEN 'begin_admin_permanent_deletion' THEN\s+p\.prosrc ILIKE '%pg_advisory_xact_lock%'/i,
  );
  assert.match(stagingCashfreeCommon, /migration36_function_\s*'\s*\|\|\s*label/i);
});

test('deployment notes keep Cashfree persistence separate from enabling checkout', () => {
  assert.match(deployment, /20261103100000_add_cashfree_service_payment_persistence\.sql/);
  assert.match(deployment, /INR-only/i);
  assert.match(deployment, /payment_session_id/i);
  assert.match(deployment, /webhook/i);
  assert.match(deployment, /byte-identical/i);
  assert.match(deployment, /stable provider event identity/i);
  assert.match(deployment, /HMAC-SHA256 verification/i);
  assert.match(deployment, /atomic/i);
  assert.match(deployment, /do not purge records solely because they are old/i);
  assert.match(deployment, /Idempotency-Key/i);
  assert.match(deployment, /90-second atomic claim lease/i);
  assert.match(deployment, /24-hour checkout lifetime/i);
  assert.match(deployment, /safe retry after failure\/timeout with the \*same\* `x-idempotency-key`/i);
  assert.match(deployment, /CASHFREE_SANDBOX_CLIENT_SECRET/);
  assert.match(deployment, /POST \/api\/catalogue\/cashfree\/orders/);
  assert.match(deployment, /\/api\/payments\/cashfree\/test-webhook/);
  assert.match(deployment, /Service Store → Payments & Gateway/);
  assert.match(deployment, /-SchemaEvidenceOnly/);
  assert.match(deployment, /Migration history UNVERIFIED/i);
  assert.match(deployment, /end-to-end Sandbox/i);
  assert.doesNotMatch(deployment, /Store Settings → Payment Receiving/);
});

test('Staging runbook documents the separate Migration 37 preflight and post-verification sequence', () => {
  assert.match(stagingRunbook, /Cashfree Migration 37/i);
  assert.match(stagingRunbook, /verify-staging-cashfree-migration-preflight\.ps1/i);
  assert.match(stagingRunbook, /verify-staging-cashfree-migration-post\.ps1/i);
  assert.match(stagingRunbook, /ExpectedRazorpayOrderCount/i);
  assert.match(stagingRunbook, /ExpectedRazorpayOrderFingerprint/i);
  assert.match(stagingRunbook, /never inserts or fabricates ledger rows/i);
  assert.match(stagingRunbook, /Cashfree remains disabled/i);
  assert.match(stagingRunbook, /SchemaEvidenceOnly/);
  assert.match(stagingRunbook, /alternate migration-ledger candidates/i);
  assert.match(stagingRunbook, /Migration history UNVERIFIED/i);
});
