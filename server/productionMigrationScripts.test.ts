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
  assert.match(common, /expected exactly 16 known Admin references/);
});

test('Production post-check covers Auth triggers, trigger-function privileges, RPC grants and RLS', () => {
  assert.match(postMigration, /'auth', 'users', 'auth_users_guard_reserved_email'/);
  assert.match(postMigration, /pg_get_userbyid\(procedure\.proowner\) = 'postgres'/);
  assert.match(postMigration, /has_function_privilege\('service_role', procedure\.oid, 'EXECUTE'\)/);
  assert.match(postMigration, /relation\.relrowsecurity/);
  assert.match(postMigration, /identity_history_backfill/);
});
