[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,

  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',

  [switch]$DryRun,

  [switch]$PreflightOnly
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
if ($allMigrationFiles.Count -ne 35 -or $allMigrationFiles[-1].Name -cne $manualSqlEditorMigrationName) {
  throw "Expected 35 repository migration files, with $manualSqlEditorMigrationName as the verification-only final migration."
}
if ($allMigrationFiles.Name -contains $rejectedRetryMigrationName) {
  throw "The rejected migration must not be present in the repository inventory: $rejectedRetryMigrationName"
}

if ($DryRun) {
  Write-Output "DRY RUN ONLY - no SQL will be executed and no database connection will be opened."
  Write-Output "Staging project ref: $ProjectRef"
  Write-Output 'Planned runner-managed migrations (4-34):'
  $migrationNames | ForEach-Object { Write-Output "  $_" }
  Write-Output "Verification-only; already applied manually in SQL Editor and never queued: $manualSqlEditorMigrationName"
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
WITH checks AS (
  SELECT
    current_database() = 'postgres'
      AND current_user = 'postgres'
      AND NOT pg_is_in_recovery() AS expected_database,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') AS uuid_extension,
    to_regprocedure('gen_random_uuid()') IS NOT NULL AS uuid_function,
    to_regclass('auth.users') IS NOT NULL AS auth_users,
    (
      SELECT count(*) = 3
      FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated', 'service_role')
    ) AS supabase_roles,
    to_regclass('public.leads') IS NOT NULL AS leads_table,
    COALESCE((
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = to_regclass('public.leads')
    ), false) AS leads_rls,
    (
      SELECT count(*) = 3
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'leads'
        AND policyname IN (
          'Public anonymous insert of leads',
          'Staff read access to leads',
          'Staff update access to leads'
        )
    ) AS leads_policies,
    (
      SELECT count(*) = 4
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
    ) AS admin_tables_rls,
    to_regprocedure('public.accept_admin_ownership_transfer(uuid,uuid)') IS NOT NULL
      AS owner_transfer_rpc,
    (
      SELECT count(*) = 4
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'admin_users'
        AND column_name IN (
          'username',
          'last_login_at',
          'last_password_reset_at',
          'must_change_password'
        )
    ) AS admin_account_columns,
    EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = to_regclass('public.admin_users')
        AND conname = 'admin_users_username_format'
    ) AS username_constraint,
    EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'admin_users'
        AND indexname = 'admin_users_username_unique'
    ) AS username_index,
    has_table_privilege('service_role', 'public.admin_users', 'INSERT')
      AS service_role_admin_access
)
SELECT CASE WHEN
  expected_database AND uuid_extension AND uuid_function AND auth_users AND supabase_roles
  AND leads_table AND leads_rls AND leads_policies AND admin_tables_rls
  AND owner_transfer_rpc AND admin_account_columns AND username_constraint
  AND username_index AND service_role_admin_access
THEN 'PREREQUISITES_OK' ELSE 'PREREQUISITES_FAIL' END
FROM checks;

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
    throw 'The first three migration prerequisites could not all be verified. No migrations were run.'
  }

  if ($preflightText -notcontains 'MANUAL_SQL_EDITOR_MIGRATION_OK' -or
    $preflightText -contains 'MANUAL_SQL_EDITOR_MIGRATION_FAIL') {
    $preflightText | ForEach-Object { Write-Host "$_" }
    throw "The manually applied migration $manualSqlEditorMigrationName is not verified by actual database objects and privileges. No migrations were run; this runner will never execute that migration."
  }

  if ($PreflightOnly) {
    Write-Output 'Read-only staging prerequisites and manually applied migration object/permission checks passed. No migrations were run.'
    return
  }

  $historyAvailable = $preflightText -contains 'MIGRATION_HISTORY_PRESENT'
  $databaseAppliedVersions = @(
    foreach ($line in $preflightText) {
      if ($line -match '^APPLIED\|(\d{14})$') { $Matches[1] }
    }
  )

  if (-not $historyAvailable) {
    Write-Warning 'Supabase migration history is unavailable; only this script local log can identify prior runner successes.'
  }
  $historyConfirmation = Read-Host 'Type I CONFIRM NO UNTRACKED MIGRATIONS 4-34 ARE APPLIED after checking staging history'
  if ($historyConfirmation -cne 'I CONFIRM NO UNTRACKED MIGRATIONS 4-34 ARE APPLIED') {
    throw 'Untracked migration confirmation did not match; no migration files were run.'
  }

  $priorSuccessfulNames = @()
  $priorFailedNames = @()
  if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $logPath) {
      $parts = @($line.Split([char]124) | ForEach-Object { $_.Trim() })
      if ($parts.Count -ge 3 -and $parts[1] -eq 'SUCCESS' -and $migrationNames -contains $parts[2]) {
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
    Write-Output 'All migrations 4-34 are already recorded as applied; nothing to do.'
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
