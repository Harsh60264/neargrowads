import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const common = readFileSync(new URL('../scripts/productionAdminDeletionCheck.Common.ps1', import.meta.url), 'utf8');
const preflight = readFileSync(
  new URL('../scripts/verify-production-admin-permanent-deletion-preflight.ps1', import.meta.url),
  'utf8',
);
const postMigration = readFileSync(
  new URL('../scripts/verify-production-admin-permanent-deletion-post-migration.ps1', import.meta.url),
  'utf8',
);
const locationPreflight = readFileSync(
  new URL('../scripts/verify-production-optional-customer-location-preflight.ps1', import.meta.url),
  'utf8',
);
const deployment = readFileSync(new URL('../docs/deployment.md', import.meta.url), 'utf8');

function assertBalancedPsqlConditionals(sql: string) {
  const stack: { elseSeen: boolean }[] = [];
  for (const [index, line] of sql.split(/\r?\n/).entries()) {
    const directive = line.match(/^\s*\\(if|else|endif)\b/)?.[1];
    if (directive === 'if') {
      stack.push({ elseSeen: false });
    } else if (directive === 'else') {
      assert.ok(stack.length > 0, `unmatched \\else on SQL line ${index + 1}`);
      assert.equal(stack.at(-1)?.elseSeen, false, `duplicate \\else on SQL line ${index + 1}`);
      stack[stack.length - 1].elseSeen = true;
    } else if (directive === 'endif') {
      assert.ok(stack.length > 0, `unmatched \\endif on SQL line ${index + 1}`);
      stack.pop();
    }
  }
  assert.equal(stack.length, 0, 'unclosed \\if directive');
}

test('Production migration scripts are pinned to the exact Production project and endpoint', () => {
  assert.match(common, /\$script:ProductionAdminDeletionProjectRef = 'axbjzmdokfoftzfgwiql'/);
  assert.match(common, /\$script:ProductionAdminDeletionDatabaseHost = 'aws-0-ap-northeast-2\.pooler\.supabase\.com'/);
  assert.match(common, /\$script:ProductionAdminDeletionDatabasePort = '5432'/);
  assert.match(common, /\$script:ProductionAdminDeletionDatabaseName = 'postgres'/);
  assert.match(common, /\$script:ProductionAdminDeletionDatabaseUser = "postgres\.\$script:ProductionAdminDeletionProjectRef"/);
  for (const script of [preflight, postMigration]) {
    assert.match(script, /\[string\]\$ProjectRef = 'axbjzmdokfoftzfgwiql'/);
    assert.match(script, /Assert-ProductionAdminDeletionTarget -ProjectRef \$ProjectRef/);
  }
  assert.match(common, /if \(\$ProjectRef -cne \$script:ProductionAdminDeletionProjectRef\)/);
});

test('optional customer location Production preflight is pinned, read-only and hash-gated', () => {
  assert.match(locationPreflight, /\$expectedProjectRef = 'axbjzmdokfoftzfgwiql'/);
  assert.match(locationPreflight, /\$expectedMigrationHash = '[0-9A-F]{64}'/);
  assert.match(locationPreflight, /Invoke-ProductionAdminDeletionReadOnlyQuery/);
  assert.match(locationPreflight, /CHECK\|location_security/);
  assert.match(locationPreflight, /CHECK\|location_state/);
  assert.match(locationPreflight, /PRE_MIGRATION_GO/);
  assert.match(locationPreflight, /UNAVAILABLE\|ledger relation is absent/);
  assert.match(locationPreflight, /to_regclass\('supabase_migrations\.schema_migrations'\)/);
  assert.match(locationPreflight, /\\if :migration_ledger_readable[\s\S]*FROM supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(locationPreflight, /^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/im);
});

test('both Production database scripts set the session read-only and run only inspection SQL', () => {
  for (const script of [preflight, postMigration]) {
    const sql = script.match(/\$sql = @'\r?\n([\s\S]*?)\r?\n'@/)?.[1];
    assert.ok(sql, 'expected a SQL block');
    assertBalancedPsqlConditionals(sql);
    assert.match(sql, /^SET default_transaction_read_only = on;/);
    assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/im);
  }
  assert.match(common, /--no-psqlrc/);
  assert.match(common, /--host', \$script:ProductionAdminDeletionDatabaseHost/);
  assert.match(common, /'--password'/);
});

test('Production preflight compares migration history instead of assuming it is complete', () => {
  assert.match(preflight, /supabase_migrations\.schema_migrations/);
  assert.match(common, /migration_missing_from_history/);
  assert.match(common, /unrecognized_database_migration/);
  assert.match(common, /migration_name_mismatch/);
  assert.doesNotMatch(common, /known_sql_editor_migration_not_in_ledger/);
  assert.match(common, /migration_36_not_applied/);
  assert.match(common, /migration_36_not_recorded/);
  for (const status of ['ABSENT_SCHEMA', 'ABSENT_TABLE', 'INACCESSIBLE', 'EMPTY', 'READABLE']) {
    assert.match(preflight, new RegExp(`migration_ledger\\\\|${status}`));
  }
  assert.match(preflight, /AllowSchemaEvidenceFallback:\$SchemaEvidenceFallback/);
  assert.match(preflight, /does not prove migrations 1-35 were applied/);
});

test('Supabase service migration ledgers are not treated as application history', () => {
  for (const script of [preflight, postMigration]) {
    assert.match(
      script,
      /AND table_schema NOT IN \('auth', 'realtime', 'storage'\)/,
    );
  }
  assert.match(common, /application migration execution history is unavailable/);
  assert.match(common, /AllowSchemaEvidenceFallback -and \$knownUnavailableStates -contains \$ledgerState/);
  assert.match(common, /alternate_migration_ledger_candidate/);
});

test('fallback still requires complete live prerequisites and never accepts partial Migration 36 state', () => {
  for (const check of [
    'admin_core_access',
    'admin_auth_identity_fk',
    'uuid_generation_prerequisite',
    'identity_history_setup_prerequisite',
    'migration_36_objects_absent',
  ]) {
    assert.match(preflight, new RegExp(`CHECK\\\\|${check}`));
  }
  assert.match(common, /migration_history_unverified/);
  assert.match(common, /AllowSchemaEvidenceFallback -and \$knownUnavailableStates -contains \$ledgerState/);
  assert.match(common, /LEDGER_CANDIDATE/);
});

test('the 16 Admin foreign keys are explicitly inventoried and sessions remain on admin_users', () => {
  const foreignKeyEntries = common.match(/'public\.[a-z_]+\|[a-z_]+\|public\.admin_users\|id'/g) ?? [];
  assert.equal(foreignKeyEntries.length, 16);
  assert.match(common, /'public\.admin_sessions\|user_id\|public\.admin_users\|id'/);
  assert.match(common, /Phase -eq 'Preflight' -or \$parts\[0\] -eq 'public\.admin_sessions'/);
  assert.match(common, /expected exactly \$\(\$expected\.Count\) known Admin references/);
  assert.match(common, /if \(\$Phase -eq 'PostMigration'[\s\S]*?cashfree_test_verified_by/);
  assert.match(common, /public\.service_store_payment_settings\|cashfree_test_verified_by\|public\.admin_identity_history\|id/);
});

test('Production post-check covers Auth triggers, trigger-function privileges, RPC grants and RLS', () => {
  assert.match(postMigration, /'auth', 'users', 'auth_users_guard_reserved_email'/);
  assert.match(postMigration, /pg_get_userbyid\(procedure\.proowner\) = 'postgres'/);
  assert.match(postMigration, /has_function_privilege\('service_role', procedure\.oid, 'EXECUTE'\)/);
  assert.match(postMigration, /relation\.relrowsecurity/);
  assert.match(postMigration, /identity_history_backfill/);
});

test('schema-evidence post-check is explicit and does not weaken history verification', () => {
  assert.match(postMigration, /\[switch\]\$SchemaEvidenceOnly/);
  assert.match(postMigration, /if \(-not \$SchemaEvidenceOnly\) \{\s*\$localMigrations = Get-ProductionAdminDeletionMigrationInventory/s);
  assert.match(postMigration, /if \(\$SchemaEvidenceOnly\)\s*\{\s*Test-ProductionAdminDeletionSchemaEvidenceLedger/s);
  assert.match(postMigration, /Test-ProductionAdminDeletionMigrationLedger `[\s\S]*?-Phase PostMigration/);
  assert.match(common, /function Test-ProductionAdminDeletionSchemaEvidenceLedger/);
  assert.ok(common.includes("$allowedUnavailableStates = @('ABSENT_SCHEMA', 'ABSENT_TABLE', 'EMPTY')"));
  assert.match(common, /schema evidence mode requires an absent or empty application ledger/);
  assert.match(common, /migration versions were returned despite the absent\/empty ledger diagnostic/);
  assert.match(common, /alternate_migration_ledger_candidate/);
  assert.match(postMigration, /SCHEMA EVIDENCE PASS:/);
  assert.match(postMigration, /MIGRATION HISTORY: NOT VERIFIED\./);
  assert.match(postMigration, /does not prove migrations 1-35 ran/);
  assert.match(deployment, /-SchemaEvidenceOnly/);
  assert.match(deployment, /not proof that migrations 1–35 ran/);
});

test('schema-evidence checks Migration 36 definitions and preserves exact historical FK verification', () => {
  for (const check of [
    'migration_36_table_definitions',
    'migration_36_table_constraints',
    'migration_36_function_overloads',
    'migration_36_foreign_keys',
  ]) {
    assert.ok(postMigration.includes(`CHECK|${check}`));
    assert.match(common, new RegExp(`'${check}'`));
  }
  assert.match(postMigration, /expected_functions\(label, signature, service_role_execute, required_fragments\)/);
  assert.match(postMigration, /pg_get_constraintdef\(constraint_row\.oid\)/);
  assert.match(postMigration, /identity_history_backfill/);
  assert.match(postMigration, /'auth', 'users', 'auth_users_guard_reserved_email'/);
  assert.match(common, /all \$\(\$expected\.Count\) expected Admin references/);
  assert.match(common, /\$parts\[8\] -ne 'true'/);
});
