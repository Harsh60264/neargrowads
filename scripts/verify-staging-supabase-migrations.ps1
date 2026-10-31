[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$ProjectRef = 'kdaixomygsuxadofoieb',

  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
$stagingProjectRef = 'kdaixomygsuxadofoieb'
$productionProjectRef = 'axbjzmdokfoftzfgwiql'
$poolerHost = 'aws-0-eu-west-1.pooler.supabase.com'
$poolerPort = 5432
$databaseName = 'postgres'
$databaseUser = "postgres.$stagingProjectRef"
$manualSqlEditorMigrationName = '20261031010000_complete_admin_temporary_password_setup.sql'
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDirectory = Join-Path $repoRoot 'supabase\migrations'
$logPath = Join-Path $env:LOCALAPPDATA "NearGrowAds\staging-migration-logs\$stagingProjectRef.log"
$psqlEnvironmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'

if (-not (Test-Path -LiteralPath $psqlEnvironmentHelper -PathType Leaf)) {
  throw "PostgreSQL environment helper was not found: $psqlEnvironmentHelper"
}
. $psqlEnvironmentHelper

if ($ProjectRef -ceq $productionProjectRef) {
  throw 'The Production project reference is prohibited.'
}
if ($ProjectRef -cne $stagingProjectRef -or $ProjectRef -notmatch '^[a-z0-9]{20}$') {
  throw 'ProjectRef must exactly match the verified staging project reference.'
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}

$versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 psql is required. Detected: $versionOutput"
}

$allMigrationFiles = @(Get-ChildItem -LiteralPath $migrationDirectory -Filter '*.sql' | Sort-Object Name)
if ($allMigrationFiles.Count -ne 35) {
  throw "Expected 35 repository migration files; found $($allMigrationFiles.Count)."
}
$manualSqlEditorMigration = @($allMigrationFiles | Where-Object { $_.Name -ceq $manualSqlEditorMigrationName })
if ($manualSqlEditorMigration.Count -ne 1) {
  throw "The manually applied verification-only migration is missing or duplicated: $manualSqlEditorMigrationName"
}
$expectedMigrationNames = @(
  $allMigrationFiles |
    Select-Object -Skip 3 |
    Where-Object { $_.Name -cne $manualSqlEditorMigrationName } |
    ForEach-Object { $_.Name }
)
if ($expectedMigrationNames.Count -ne 31) {
  throw 'Expected exactly 31 migrations in the staging application range (4-34).'
}
if ($allMigrationFiles[-1].Name -cne $manualSqlEditorMigrationName) {
  throw "The verification-only migration must remain the newest repository migration: $manualSqlEditorMigrationName"
}

$logPassed = $false
$logSuccessNames = @()
$logFailures = @()
if (Test-Path -LiteralPath $logPath -PathType Leaf) {
  foreach ($line in Get-Content -LiteralPath $logPath) {
    $parts = @($line.Split([char]124) | ForEach-Object { $_.Trim() })
    if ($parts.Count -ge 3 -and $parts[1] -eq 'SUCCESS') {
      $logSuccessNames += $parts[2]
    } elseif ($parts.Count -ge 3 -and $parts[1] -eq 'FAILED_MIGRATION') {
      $logFailures += $parts[2]
    }
  }
}
$successCounts = @{}
foreach ($name in $logSuccessNames) {
  if ($expectedMigrationNames -contains $name) {
    $successCounts[$name] = 1 + [int]$successCounts[$name]
  }
}
$missingLogNames = @($expectedMigrationNames | Where-Object { -not $successCounts.ContainsKey($_) })
$duplicateLogNames = @($expectedMigrationNames | Where-Object { $successCounts.ContainsKey($_) -and $successCounts[$_] -ne 1 })
$extraLogNames = @($logSuccessNames | Where-Object { $expectedMigrationNames -notcontains $_ })
$logPassed = (Test-Path -LiteralPath $logPath -PathType Leaf) -and
  $logSuccessNames.Count -eq 31 -and
  $missingLogNames.Count -eq 0 -and
  $duplicateLogNames.Count -eq 0 -and
  $extraLogNames.Count -eq 0 -and
  $logFailures.Count -eq 0

Write-Output 'NearGrowAds staging migration verification'
Write-Output "Project ref: $stagingProjectRef"
Write-Output "Local migration log: $(if (Test-Path -LiteralPath $logPath) { 'present' } else { 'missing' })"
if ($logPassed) {
  Write-Output 'PASS | MIGRATION_LOG | exactly 31 runner-managed migrations (4-34); no failed entries'
} else {
  Write-Output "FAIL | MIGRATION_LOG | expected 31 runner-managed migrations (4-34); success entries=$($logSuccessNames.Count); missing=$($missingLogNames.Count); duplicate=$($duplicateLogNames.Count); unexpected=$($extraLogNames.Count); failures=$($logFailures.Count)"
  foreach ($name in $missingLogNames) { Write-Output "  MISSING_LOG_SUCCESS | $name" }
  foreach ($name in $duplicateLogNames) { Write-Output "  DUPLICATE_LOG_SUCCESS | $name" }
  foreach ($name in $extraLogNames) { Write-Output "  UNEXPECTED_LOG_SUCCESS | $name" }
  foreach ($name in $logFailures) { Write-Output "  FAILED_LOG_ENTRY | $name" }
}

$sql = @'
WITH expected_tables(name) AS (
  VALUES
    ('leads'),
    ('admin_users'),
    ('admin_sessions'),
    ('admin_audit_logs'),
    ('admin_ownership_transfers'),
    ('service_packages'),
    ('service_enquiry_requests'),
    ('site_content_cms'),
    ('site_content_revisions'),
    ('service_store_payment_settings'),
    ('service_store_payment_audit'),
    ('service_orders'),
    ('case_studies'),
    ('case_study_categories'),
    ('website_services'),
    ('service_catalogue_categories'),
    ('security_events'),
    ('security_alerts'),
    ('security_detection_rules'),
    ('website_activity'),
    ('serverless_cms_documents')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('admin_users', 'username'),
    ('admin_users', 'last_login_at'),
    ('admin_users', 'last_password_reset_at'),
    ('admin_users', 'must_change_password'),
    ('admin_users', 'invitation_generation'),
    ('admin_users', 'archived_at'),
    ('admin_users', 'temporary_password_expires_at'),
    ('admin_users', 'temporary_password_used_at'),
    ('admin_users', 'is_primary_owner'),
    ('admin_audit_logs', 'idempotency_key'),
    ('admin_sessions', 'last_activity_at'),
    ('leads', 'notification_status'),
    ('leads', 'consent_status'),
    ('service_packages', 'discounted_price'),
    ('service_packages', 'category_id'),
    ('service_enquiry_requests', 'customer_business_name'),
    ('service_enquiry_requests', 'service_interest'),
    ('service_enquiry_requests', 'consent'),
    ('case_studies', 'published_content'),
    ('case_studies', 'image_placement'),
    ('case_studies', 'image_opacity'),
    ('case_study_categories', 'is_custom'),
    ('service_catalogue_categories', 'show_in_catalogue'),
    ('serverless_cms_documents', 'version')
),
expected_rpcs(name, signature) AS (
  VALUES
    ('complete_admin_invitation', 'public.complete_admin_invitation(uuid,text,boolean,uuid)'),
    ('prepare_admin_invitation_recovery', 'public.prepare_admin_invitation_recovery(uuid,uuid,uuid)'),
    ('cancel_admin_invitation', 'public.cancel_admin_invitation(uuid,uuid)'),
    ('archive_admin_account', 'public.archive_admin_account(uuid,uuid)'),
    ('consume_admin_temporary_password_login', 'public.consume_admin_temporary_password_login(uuid)'),
    ('get_active_admin_session', 'public.get_active_admin_session(uuid,uuid)'),
    ('complete_admin_temporary_password_setup', 'public.complete_admin_temporary_password_setup(uuid,uuid)')
),
expected_buckets(bucket_id, is_public, size_limit) AS (
  VALUES
    ('site-media', true, 104857600::bigint),
    ('case-study-media', false, 15728640::bigint),
    ('cms-uploads', true, 15728640::bigint)
),
checks AS (
  SELECT
    'TABLE'::text AS category,
    t.name AS object_name,
    (to_regclass('public.' || t.name) IS NOT NULL) AS passed,
    CASE WHEN to_regclass('public.' || t.name) IS NOT NULL THEN 'relation exists' ELSE 'missing relation' END AS detail
  FROM expected_tables t

  UNION ALL

  SELECT
    'COLUMN',
    c.table_name || '.' || c.column_name,
    EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = c.table_name
        AND actual.column_name = c.column_name
    ),
    CASE WHEN EXISTS (
      SELECT 1
      FROM information_schema.columns actual
      WHERE actual.table_schema = 'public'
        AND actual.table_name = c.table_name
        AND actual.column_name = c.column_name
    ) THEN 'column exists' ELSE 'missing column' END
  FROM expected_columns c

  UNION ALL

  SELECT
    'ADMIN_RPC',
    f.name,
    COALESCE(
      p.prosecdef
      AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND has_function_privilege('service_role', p.oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ),
      false
    ),
    CASE
      WHEN p.oid IS NULL THEN 'missing exact signature: ' || f.signature
      WHEN NOT p.prosecdef THEN 'not SECURITY DEFINER'
      WHEN has_function_privilege('anon', p.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
        OR EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) THEN 'execution is not restricted from PUBLIC/anon/authenticated'
      WHEN NOT has_function_privilege('service_role', p.oid, 'EXECUTE') THEN 'service_role lacks EXECUTE'
      ELSE 'SECURITY DEFINER; execute granted only to service_role'
    END
  FROM expected_rpcs f
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.signature)

  UNION ALL

  SELECT
    'ADMIN_TABLE_PRIVILEGE',
    expected.table_name,
    COALESCE(
      (
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
      ),
      false
    ),
    CASE
      WHEN relation.oid IS NULL THEN 'Admin table is missing'
      WHEN EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(relation.relacl, acldefault('r', relation.relowner))) acl
        WHERE acl.grantee = 0
      ) THEN 'PUBLIC has direct table privileges'
      WHEN has_table_privilege('anon', relation.oid, 'SELECT')
        OR has_table_privilege('anon', relation.oid, 'INSERT')
        OR has_table_privilege('anon', relation.oid, 'UPDATE')
        OR has_table_privilege('anon', relation.oid, 'DELETE')
        OR has_table_privilege('authenticated', relation.oid, 'SELECT')
        OR has_table_privilege('authenticated', relation.oid, 'INSERT')
        OR has_table_privilege('authenticated', relation.oid, 'UPDATE')
        OR has_table_privilege('authenticated', relation.oid, 'DELETE')
        THEN 'anon/authenticated have direct table privileges'
      WHEN NOT (
        SELECT bool_and(has_table_privilege('service_role', relation.oid, privilege))
        FROM unnest(ARRAY[
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ]) AS required(privilege)
      ) THEN 'service_role is missing one or more table privileges'
      ELSE 'direct client/PUBLIC grants removed; service_role has all table privileges'
    END
  FROM (VALUES
    ('admin_users'),
    ('admin_sessions'),
    ('admin_audit_logs'),
    ('admin_ownership_transfers')
  ) AS expected(table_name)
  LEFT JOIN pg_class relation
    ON relation.oid = to_regclass('public.' || expected.table_name)

  UNION ALL

  SELECT
    'TEMP_PASSWORD_MIGRATION',
    'admin_audit_logs_idempotency_key_unique',
    EXISTS (
      SELECT 1
      FROM pg_index index_entry
      JOIN pg_class index_relation ON index_relation.oid = index_entry.indexrelid
      WHERE index_entry.indrelid = to_regclass('public.admin_audit_logs')
        AND index_relation.relname = 'admin_audit_logs_idempotency_key_unique'
        AND index_entry.indisunique
        AND index_entry.indisvalid
        AND index_entry.indpred IS NOT NULL
        AND pg_get_indexdef(index_entry.indexrelid) ~* '\(idempotency_key\)'
    ),
    CASE WHEN EXISTS (
      SELECT 1
      FROM pg_index index_entry
      JOIN pg_class index_relation ON index_relation.oid = index_entry.indexrelid
      WHERE index_entry.indrelid = to_regclass('public.admin_audit_logs')
        AND index_relation.relname = 'admin_audit_logs_idempotency_key_unique'
        AND index_entry.indisunique
        AND index_entry.indisvalid
        AND index_entry.indpred IS NOT NULL
        AND pg_get_indexdef(index_entry.indexrelid) ~* '\(idempotency_key\)'
    ) THEN 'unique partial idempotency index exists' ELSE 'missing or invalid idempotency index' END

  UNION ALL

  SELECT
    'TEMP_PASSWORD_MIGRATION',
    'RPC implementation safeguards',
    COALESCE(
      session_rpc.prosecdef
      AND lower(pg_get_functiondef(session_rpc.oid)) LIKE '%account.temporary_password_expires_at > clock_timestamp()%'
      AND lower(pg_get_functiondef(session_rpc.oid)) LIKE '%account.temporary_password_used_at is not null%'
      AND lower(pg_get_functiondef(session_rpc.oid)) LIKE '%account.status = ''active''%'
      AND lower(pg_get_functiondef(session_rpc.oid)) LIKE '%account.archived_at is null%'
      AND setup_rpc.prosecdef
      AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%target_row.is_primary_owner is distinct from false%'
      AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%target_row.must_change_password is distinct from true%'
      AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%target_row.temporary_password_expires_at <= clock_timestamp()%'
      AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%for update%'
      AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%temporary-admin-password-setup:%'
      AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%on conflict (idempotency_key)%',
      false
    ),
    CASE
      WHEN session_rpc.oid IS NULL OR setup_rpc.oid IS NULL THEN 'one or both exact-signature RPCs are missing'
      WHEN NOT (
        session_rpc.prosecdef
        AND lower(pg_get_functiondef(session_rpc.oid)) LIKE '%account.temporary_password_expires_at > clock_timestamp()%'
        AND lower(pg_get_functiondef(session_rpc.oid)) LIKE '%account.temporary_password_used_at is not null%'
        AND lower(pg_get_functiondef(session_rpc.oid)) LIKE '%account.status = ''active''%'
        AND lower(pg_get_functiondef(session_rpc.oid)) LIKE '%account.archived_at is null%'
      ) THEN 'session RPC lacks expected active-account/expiry safeguards'
      WHEN NOT (
        setup_rpc.prosecdef
        AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%target_row.is_primary_owner is distinct from false%'
        AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%target_row.must_change_password is distinct from true%'
        AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%target_row.temporary_password_expires_at <= clock_timestamp()%'
        AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%for update%'
        AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%temporary-admin-password-setup:%'
        AND lower(pg_get_functiondef(setup_rpc.oid)) LIKE '%on conflict (idempotency_key)%'
      ) THEN 'setup RPC lacks expected owner/expiry/locking/audit safeguards'
      ELSE 'RPC definitions contain expected owner/expiry/locking/audit safeguards'
    END
  FROM (
    SELECT
      to_regprocedure('public.get_active_admin_session(uuid,uuid)') AS session_oid,
      to_regprocedure('public.complete_admin_temporary_password_setup(uuid,uuid)') AS setup_oid
  ) expected
  LEFT JOIN pg_proc session_rpc ON session_rpc.oid = expected.session_oid
  LEFT JOIN pg_proc setup_rpc ON setup_rpc.oid = expected.setup_oid

  UNION ALL

  SELECT
    'STORAGE_BUCKET',
    b.bucket_id,
    COALESCE(actual.public = b.is_public AND actual.file_size_limit = b.size_limit, false),
    CASE
      WHEN actual.id IS NULL THEN 'missing bucket'
      WHEN actual.public IS DISTINCT FROM b.is_public THEN 'unexpected public flag'
      WHEN actual.file_size_limit IS DISTINCT FROM b.size_limit THEN 'unexpected file size limit'
      ELSE 'bucket configuration matches expected values'
    END
  FROM expected_buckets b
  LEFT JOIN storage.buckets actual ON actual.id = b.bucket_id

  UNION ALL

  SELECT
    'STORAGE_POLICY',
    'storage.objects RLS and write access',
    COALESCE(
      (SELECT c.relrowsecurity
       FROM pg_class c
       WHERE c.oid = to_regclass('storage.objects'))
      AND NOT EXISTS (
        SELECT 1
        FROM pg_policies policy
        WHERE policy.schemaname = 'storage'
          AND policy.tablename = 'objects'
          AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND EXISTS (
            SELECT 1
            FROM unnest(policy.roles) AS role_entries(role_name)
            WHERE role_name::text IN ('anon', 'authenticated', 'public')
          )
      ),
      false
    ),
    CASE
      WHEN to_regclass('storage.objects') IS NULL THEN 'storage.objects is missing'
      WHEN NOT (
        SELECT c.relrowsecurity
        FROM pg_class c
        WHERE c.oid = to_regclass('storage.objects')
      ) THEN 'RLS is disabled on storage.objects'
      WHEN EXISTS (
        SELECT 1
        FROM pg_policies policy
        WHERE policy.schemaname = 'storage'
          AND policy.tablename = 'objects'
          AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          AND EXISTS (
            SELECT 1
            FROM unnest(policy.roles) AS role_entries(role_name)
            WHERE role_name::text IN ('anon', 'authenticated', 'public')
          )
      ) THEN 'found anonymous/authenticated/PUBLIC object-write policy'
      ELSE 'RLS enabled; no anonymous/authenticated/PUBLIC object-write policy'
    END

  UNION ALL

  SELECT
    'LEADS_ACCESS',
    'leads direct API grants',
    CASE
      WHEN to_regclass('public.leads') IS NULL THEN false
      ELSE NOT has_table_privilege('anon', 'public.leads', 'SELECT')
        AND NOT has_table_privilege('anon', 'public.leads', 'INSERT')
        AND NOT has_table_privilege('authenticated', 'public.leads', 'SELECT')
        AND NOT has_table_privilege('authenticated', 'public.leads', 'INSERT')
        AND has_table_privilege('service_role', 'public.leads', 'SELECT')
        AND has_table_privilege('service_role', 'public.leads', 'INSERT')
    END,
    CASE
      WHEN to_regclass('public.leads') IS NULL THEN 'public.leads relation is missing'
      WHEN has_table_privilege('anon', 'public.leads', 'SELECT')
        OR has_table_privilege('anon', 'public.leads', 'INSERT')
        OR has_table_privilege('authenticated', 'public.leads', 'SELECT')
        OR has_table_privilege('authenticated', 'public.leads', 'INSERT')
        THEN 'anon/authenticated have direct table grants'
      WHEN NOT has_table_privilege('service_role', 'public.leads', 'SELECT')
        OR NOT has_table_privilege('service_role', 'public.leads', 'INSERT')
        THEN 'service_role table grants are missing'
      ELSE 'direct client grants removed; service_role grants present'
    END
)
SELECT category || '|' || object_name || '|' ||
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END || '|' ||
       replace(detail, '|', '/')
FROM checks
ORDER BY category, object_name;
'@

$temporarySqlPath = Join-Path $env:TEMP ("neargrow-staging-verify-" + [guid]::NewGuid().ToString('N') + '.psql')
$temporaryOutputPath = Join-Path $env:TEMP ("neargrow-staging-verify-output-" + [guid]::NewGuid().ToString('N') + '.txt')
$savedEnvironment = $null

Write-Output ''
Write-Output 'READ-ONLY STAGING DATABASE TARGET'
Write-Output "Project ref: $stagingProjectRef"
Write-Output "Host:        $poolerHost"
Write-Output "Port:        $poolerPort (Session Pooler session mode)"
Write-Output "Database:    $databaseName"
Write-Output "Username:    $databaseUser"
Write-Output 'TLS:         required'
Write-Output 'The verifier runs SELECT-only checks; it does not apply or record migrations.'

$confirmation = Read-Host 'Type the exact staging project ref shown above to continue'
if ($confirmation -cne $stagingProjectRef) {
  throw 'Project reference confirmation did not match; no database connection was opened.'
}

try {
  [System.IO.File]::WriteAllText($temporarySqlPath, $sql, [System.Text.UTF8Encoding]::new($false))
  $savedEnvironment = Enter-StagingPsqlEnvironment

  $arguments = @(
    '--no-psqlrc',
    '--host', $poolerHost,
    '--port', "$poolerPort",
    '--username', $databaseUser,
    '--dbname', $databaseName,
    '--password',
    '--set', 'ON_ERROR_STOP=1',
    '--no-align',
    '--tuples-only',
    '--field-separator', '|',
    '--output', $temporaryOutputPath,
    '--file', $temporarySqlPath
  )

  & $PsqlPath @arguments
  $psqlExitCode = $LASTEXITCODE
  $results = if (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf) {
    Get-Content -LiteralPath $temporaryOutputPath
  } else {
    @()
  }

  if ($psqlExitCode -ne 0) {
    Write-Output 'FAIL | DATABASE_CHECK | psql verification query did not complete successfully'
    exit 1
  }

  $databaseFailures = @()
  foreach ($line in $results) {
    $parts = $line.Split([char]124, 4)
    if ($parts.Count -ne 4 -or $parts[2] -notin @('PASS', 'FAIL')) {
      $databaseFailures += 'Malformed verification output'
      continue
    }
    Write-Output "$($parts[2]) | $($parts[0]) | $($parts[1]) | $($parts[3])"
    if ($parts[2] -eq 'FAIL') {
      $databaseFailures += "$($parts[0]) $($parts[1]): $($parts[3])"
    }
  }

  $databasePassed = $databaseFailures.Count -eq 0 -and $results.Count -gt 0
  if (-not $databasePassed) {
    foreach ($failure in $databaseFailures) { Write-Output "MISSING/INVALID | $failure" }
  }

  $overallPassed = $logPassed -and $databasePassed
  Write-Output ''
  Write-Output "OVERALL: $(if ($overallPassed) { 'PASS' } else { 'FAIL' })"
  Write-Output "Migration log: $(if ($logPassed) { 'PASS' } else { 'FAIL' }); database checks: $(if ($databasePassed) { 'PASS' } else { 'FAIL' })"
  if (-not $overallPassed) { exit 1 }
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  foreach ($temporaryPath in @($temporarySqlPath, $temporaryOutputPath)) {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}
