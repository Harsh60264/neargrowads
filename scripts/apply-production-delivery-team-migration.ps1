[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$BackupEvidencePath,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [switch]$Apply,
  [switch]$AcknowledgeUnrestoredBackup
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"
$migrationFileName = '20261127120000_admin_delivery_team_management.sql'
$expectedMigrationHash = 'F0A5EDD1A70DB9C13A5C6BCECEDCF70B6468B4A2CD90438B619DCFA181E775DF'

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if ($AcknowledgeUnrestoredBackup -and -not $Apply) {
  throw '-AcknowledgeUnrestoredBackup is available only with -Apply.'
}
if ($Apply -and -not $AcknowledgeUnrestoredBackup) {
  throw 'The full restore drill is FAILED / UNVERIFIED; production apply requires -AcknowledgeUnrestoredBackup.'
}
if ($databaseUser -cne "postgres.$ProjectRef") {
  throw 'The Production database identity does not match the pinned project.'
}
foreach ($toolPath in @($PsqlPath, $PgRestorePath)) {
  if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) {
    throw "Required PostgreSQL 18 tool was not found: $toolPath"
  }
  $toolVersion = (& $toolPath --version 2>&1 | Out-String).Trim()
  $toolName = [System.IO.Path]::GetFileNameWithoutExtension($toolPath)
  $versionPattern = '^' + [regex]::Escape($toolName) + ' \(PostgreSQL\) 18(?:\.|\s|$)'
  if ($LASTEXITCODE -ne 0 -or $toolVersion -notmatch $versionPattern) {
    throw "PostgreSQL 18 is required for $toolPath. Detected: $toolVersion"
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFileName"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
  throw "The pinned Delivery Team migration is missing: $migrationFileName"
}
if ((Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -cne $expectedMigrationHash) {
  throw "Delivery Team migration hash mismatch. Expected $expectedMigrationHash. Nothing was connected or applied."
}
$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
if ($migrationSql -match '(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;' -or
  $migrationSql -match '(?im)^\s*(?:INSERT\s+INTO|CREATE\s+SCHEMA)\s+supabase_migrations') {
  throw 'The pinned migration must not manage transaction boundaries or fabricate migration history.'
}
if ($migrationSql -match '(?i)\b(?:DROP\s+TABLE|TRUNCATE|CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY)\b') {
  throw 'The pinned migration contains an operation that is not allowed by the transactional recovery gate.'
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper

$preflightSql = @'
BEGIN TRANSACTION READ ONLY;
WITH checks(name, passed) AS (
  VALUES
    ('production target', current_database() = 'postgres' AND current_user = 'postgres' AND NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'on'),
    ('required WildCard tables and storage', to_regclass('public.admin_users') IS NOT NULL AND to_regclass('public.partner_profiles') IS NOT NULL AND to_regclass('public.partner_campaigns') IS NOT NULL AND to_regclass('public.partner_campaign_assignments') IS NOT NULL AND to_regclass('public.partner_campaign_sites') IS NOT NULL AND to_regclass('public.partner_campaign_requests') IS NOT NULL AND to_regclass('public.partner_damage_reports') IS NOT NULL AND to_regclass('public.partner_proofs') IS NOT NULL AND to_regclass('public.partner_stock_movements') IS NOT NULL AND to_regclass('public.partner_withdrawal_requests') IS NOT NULL AND to_regclass('public.partner_coin_ledger') IS NOT NULL AND to_regclass('storage.buckets') IS NOT NULL),
    ('required Supabase roles and UUID generator', (SELECT count(*) = 3 FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) AND to_regprocedure('gen_random_uuid()') IS NOT NULL),
    ('private proof bucket', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE)),
    ('migration history remains absent', to_regnamespace('supabase_migrations') IS NULL),
    ('no prior Delivery Team migration objects', to_regclass('public.delivery_team_settings') IS NULL AND to_regclass('public.delivery_team_activity') IS NULL AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'partner_coin_ledger' AND column_name IN ('administrator_id', 'admin_previous_balance', 'admin_resulting_balance', 'admin_reset', 'idempotency_key')) OR (table_name = 'partner_stock_movements' AND column_name IN ('administrator_id', 'previous_balance', 'resulting_balance', 'idempotency_key')) OR (table_name = 'partner_damage_reports' AND column_name = 'review_note'))) AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('assert_delivery_team_admin', 'delivery_team_available_coins', 'get_partner_coin_summary', 'get_delivery_team_overview', 'get_delivery_team_partners', 'get_delivery_team_partner_detail', 'get_delivery_team_campaigns', 'admin_adjust_partner_coins', 'admin_manage_partner_stock', 'admin_create_partner_campaign_assignment', 'admin_update_partner_campaign_status', 'admin_set_delivery_team_low_stock_threshold', 'admin_review_partner_proof', 'admin_review_partner_campaign_request', 'admin_review_partner_damage_report', 'admin_review_partner_withdrawal')) AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('delivery_team_activity_recent', 'delivery_team_activity_partner_recent', 'partner_coin_ledger_idempotency_unique', 'partner_stock_movements_idempotency_unique')) AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN ('partner_coin_ledger_entry_integrity_check', 'partner_coin_ledger_admin_balance_check', 'partner_coin_ledger_admin_reset_check', 'partner_stock_movements_admin_balance_check')) AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polname IN ('delivery_team_settings_no_direct_access', 'delivery_team_activity_no_direct_access'))),
    ('existing coin ledger data satisfies new constraints', NOT EXISTS (SELECT 1 FROM public.partner_coin_ledger WHERE NOT ((entry_type = 'earning' AND amount > 0 AND proof_id IS NOT NULL AND withdrawal_request_id IS NULL) OR (entry_type = 'withdrawal' AND amount < 0 AND proof_id IS NULL AND withdrawal_request_id IS NOT NULL)))),
    ('coin and stock balances are not negative', NOT EXISTS (SELECT 1 FROM public.partner_coin_ledger GROUP BY partner_profile_id HAVING sum(CASE WHEN (entry_type = 'earning' AND status IN ('approved', 'settled')) OR (entry_type = 'withdrawal' AND status IN ('requested', 'settled')) THEN amount ELSE 0 END) < 0) AND NOT EXISTS (SELECT 1 FROM public.partner_stock_movements GROUP BY assignment_id HAVING sum(quantity) < 0)),
    ('base withdrawal function exists', to_regprocedure('public.request_partner_withdrawal(uuid,integer)') IS NOT NULL)
)
SELECT name || '|' || CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
FROM checks
ORDER BY name;
ROLLBACK;
'@

function Invoke-PinnedProductionPsql {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Sql,
    [switch]$SingleTransaction
  )

  $temporarySqlPath = Join-Path $env:TEMP ("neargrow-delivery-team-migration-" + [guid]::NewGuid().ToString('N') + '.sql')
  $temporaryOutputPath = Join-Path $env:TEMP ("neargrow-delivery-team-migration-" + [guid]::NewGuid().ToString('N') + '.txt')
  $savedEnvironment = $null
  try {
    [System.IO.File]::WriteAllText($temporarySqlPath, $Sql, [System.Text.UTF8Encoding]::new($false))
    $savedEnvironment = Enter-StagingPsqlEnvironment
    $arguments = @(
      '--no-psqlrc', '--host', $databaseHost, '--port', $databasePort,
      '--username', $databaseUser, '--dbname', $databaseName, '--password',
      '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose',
      '--set', 'SHOW_CONTEXT=always', '--no-align', '--tuples-only',
      '--field-separator', '|', '--output', $temporaryOutputPath
    )
    if ($SingleTransaction) {
      $arguments += '--single-transaction'
    }
    $arguments += @('--file', $temporarySqlPath)
    $diagnostics = @(& $PsqlPath @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    $postgresErrorLines = @($diagnostics | Where-Object {
      ([string]$_) -match '(?im)\b(?:ERROR|FATAL):'
    })
    if ($exitCode -ne 0 -or $postgresErrorLines.Length -gt 0) {
      throw (Get-SafeMigrationPsqlFailureSummary -ExitCode $exitCode -Diagnostics $diagnostics)
    }
    if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
      throw 'Pinned Production psql returned no output file.'
    }
    return [pscustomobject]@{
      ExitCode = $exitCode
      Output = @(Get-Content -LiteralPath $temporaryOutputPath)
    }
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
}

function Get-SafeMigrationPsqlFailureSummary {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ExitCode,
    [Parameter(Mandatory = $true)]
    [string[]]$Diagnostics
  )

  $diagnosticText = ($Diagnostics | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) {
      $_.Exception.Message
    } else {
      [string]$_
    }
  }) -join "`n"
  $errorMatch = [regex]::Match(
    $diagnosticText,
    '(?im)\b(?:ERROR|FATAL):\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)'
  )
  $locationMatch = [regex]::Match(
    $diagnosticText,
    '(?im)^psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL):'
  )

  if (-not $errorMatch.Success) {
    return "Pinned Production psql operation failed (exit code $ExitCode); no PostgreSQL ERROR/FATAL line was available. Raw diagnostics and credentials were omitted."
  }

  $sqlState = $errorMatch.Groups[1].Value.ToUpperInvariant()
  $safeMessage = $errorMatch.Groups[2].Value.Trim() `
    -replace '(?i)\b(?:postgres(?:ql)?|https?)://\S+', '[redacted]' `
    -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+', '$1=[redacted]' `
    -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]' `
    -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[redacted-email]' `
    -replace '(?i)(?<!\d)(?:\+?\d[\s().-]*){10,15}(?!\d)', '[redacted-phone]' `
    -replace '\b(?:eyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{10,}){1,2}|(?:sk|pk|sbp|ghp|gho|glpat|xox[baprs])_[A-Za-z0-9_-]{20,})\b', '[redacted-token]' `
    -replace '\s+', ' '
  if ($safeMessage.Length -gt 240) {
    $safeMessage = $safeMessage.Substring(0, 240) + '...'
  }
  if ([string]::IsNullOrWhiteSpace($safeMessage)) {
    $safeMessage = 'PostgreSQL reported an error; message redacted.'
  }

  $stateText = if ([string]::IsNullOrWhiteSpace($sqlState)) { 'unavailable' } else { $sqlState }
  $locationText = if ($locationMatch.Success) {
    "SQL input line $($locationMatch.Groups[1].Value)"
  } else {
    'SQL input line unavailable'
  }
  return "Pinned Production psql operation failed (exit code $ExitCode, SQLSTATE $stateText, $locationText): $safeMessage. Raw diagnostics, query text, and credentials were omitted."
}

function Get-ValidatedPreflightResults {
  param(
    [Parameter(Mandatory = $true)]
    [int]$PsqlExitCode,
    [Parameter(Mandatory = $true)]
    [string[]]$Output
  )

  if ($PsqlExitCode -ne 0) {
    throw "Read-only Delivery Team migration preflight psql failed with exit code $PsqlExitCode."
  }

  $expectedChecks = @(
    'production target',
    'required WildCard tables and storage',
    'required Supabase roles and UUID generator',
    'private proof bucket',
    'migration history remains absent',
    'no prior Delivery Team migration objects',
    'existing coin ledger data satisfies new constraints',
    'coin and stock balances are not negative',
    'base withdrawal function exists'
  )
  $commandTagPattern = '^(?:BEGIN|COMMIT|ROLLBACK|SET|DO|CREATE (?:TABLE|INDEX|FUNCTION|POLICY|TRIGGER|VIEW|SEQUENCE|SCHEMA)|ALTER (?:TABLE|FUNCTION|SCHEMA)|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|GRANT|REVOKE)$'
  $results = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)

  foreach ($line in $Output) {
    $trimmedLine = ([string]$line).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmedLine)) {
      continue
    }
    if ($trimmedLine -match $commandTagPattern) {
      continue
    }

    $resultMatch = [regex]::Match($trimmedLine, '^([^|]+)\|(PASS|FAIL)$')
    if (-not $resultMatch.Success) {
      throw "Read-only Delivery Team migration preflight returned unexpected psql output: $trimmedLine"
    }
    $checkName = $resultMatch.Groups[1].Value
    if ($expectedChecks -notcontains $checkName) {
      throw "Read-only Delivery Team migration preflight returned an unexpected check: $checkName"
    }
    if ($results.ContainsKey($checkName)) {
      throw "Read-only Delivery Team migration preflight returned a duplicate check: $checkName"
    }
    if ($resultMatch.Groups[2].Value -cne 'PASS') {
      throw "Read-only Delivery Team migration preflight failed: $checkName"
    }
    $results.Add($checkName, $trimmedLine)
  }

  $missingChecks = @($expectedChecks | Where-Object { -not $results.ContainsKey($_) })
  if ($missingChecks.Count -gt 0) {
    throw "Read-only Delivery Team migration preflight omitted required checks: $($missingChecks -join ', ')"
  }
  if ($results.Count -ne $expectedChecks.Count) {
    throw "Read-only Delivery Team migration preflight returned $($results.Count) unique checks; expected $($expectedChecks.Count)."
  }

  return @($expectedChecks | ForEach-Object { $results[$_] })
}

function Get-VerifiedBackupEvidencePath {
  if (-not [string]::IsNullOrWhiteSpace($BackupEvidencePath)) {
    return $BackupEvidencePath
  }
  $backupRoot = Join-Path $env:LOCALAPPDATA 'NearGrowAds\ProductionBackups'
  if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    throw 'The standard local ProductionBackups directory was not found. Create fresh backup evidence first.'
  }
  $manifest = Get-ChildItem -LiteralPath $backupRoot -Directory -Filter 'partner-workspace-*' |
    Sort-Object -Property LastWriteTimeUtc -Descending |
    ForEach-Object { Join-Path $_.FullName 'backup-evidence.json' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($manifest)) {
    throw 'No Production backup evidence manifest was found. Create fresh backup evidence first.'
  }
  return $manifest
}

function Assert-VerifiedBackupEvidence {
  $evidencePath = Get-VerifiedBackupEvidencePath
  $evidenceVerifier = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
  if (-not (Test-Path -LiteralPath $evidenceVerifier -PathType Leaf)) {
    throw 'The independent backup evidence verifier is missing.'
  }
  $powerShell = (Get-Command pwsh -ErrorAction Stop).Source
  $verificationOutput = @(& $powerShell -NoProfile -File $evidenceVerifier `
    -EvidencePath $evidencePath -PgRestorePath $PgRestorePath -ArchiveOnly 2>&1)
  $verificationExitCode = $LASTEXITCODE
  foreach ($line in $verificationOutput) {
    Write-Output ([string]$line)
  }
  if ($verificationExitCode -ne 0 -or
    -not (@($verificationOutput | ForEach-Object { [string]$_ }) -contains 'BACKUP ARCHIVE PASS - RESTORE DRILL FAILED; FULL RESTORE UNVERIFIED')) {
    throw 'Independent archive evidence verification failed; no Production migration was attempted.'
  }
  $evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json -DateKind String
  Write-Output "Backup evidence: $evidencePath"
  Write-Output "Verified archive SHA-256: $($evidence.sha256)"
  $backupConfirmation = "ARCHIVE-ONLY EVIDENCE REVIEWED SHA256=$($evidence.sha256) FOR $expectedProjectRef"
  if ((Read-Host "Review the failed restore status and coverage limits; type exactly: $backupConfirmation") -cne $backupConfirmation) {
    throw 'Archive-only backup evidence was not confirmed; no Production migration was attempted.'
  }
  $coverageConfirmation = "BACKUP LIMITATIONS ACKNOWLEDGED FOR $expectedProjectRef"
  if ((Read-Host "Acknowledge Storage payload and Supabase project configuration exclusions; type exactly: $coverageConfirmation") -cne $coverageConfirmation) {
    throw 'Backup coverage limitations were not acknowledged; no Production migration was attempted.'
  }
  if ([string]::IsNullOrWhiteSpace((Read-Host 'Identify the reachable authorized Supabase recovery/on-call route (do not enter credentials)'))) {
    throw 'An authorized recovery route is required; no Production migration was attempted.'
  }
  $riskConfirmation = "I ACKNOWLEDGE RESTORE DRILL FAILED AND APPROVE MIGRATION-SPECIFIC RECOVERY FOR 20261127120000 TO PRODUCTION $expectedProjectRef"
  if ((Read-Host "Full restoreability is UNVERIFIED. Confirm transaction rollback and forward-recovery limits; type exactly: $riskConfirmation") -cne $riskConfirmation) {
    throw 'Unrestored-archive migration-specific recovery risk was not acknowledged; no Production migration was attempted.'
  }
  return $evidencePath
}

Write-Output 'PINNED PRODUCTION DELIVERY TEAM MIGRATION PREFLIGHT'
Write-Output "Project ref: $expectedProjectRef"
Write-Output "Host:        $databaseHost"
Write-Output "Port:        $databasePort"
Write-Output "Database:    $databaseName"
Write-Output "User:        $databaseUser"
Write-Output "TLS:         verify-full using the configured PostgreSQL root certificate"
Write-Output "Migration:   $migrationFileName"
Write-Output "SHA-256:     $expectedMigrationHash"
Write-Output 'Migration history remains UNVERIFIED; this runner never creates or modifies ledger rows.'

$preflightExecution = Invoke-PinnedProductionPsql -Sql $preflightSql
$preflightResults = Get-ValidatedPreflightResults `
  -PsqlExitCode $preflightExecution.ExitCode `
  -Output $preflightExecution.Output
foreach ($result in $preflightResults) {
  Write-Output "PASS $($result -replace '\|', ': ')"
}

if (-not $Apply) {
  Write-Output 'PREFLIGHT ONLY - no Production SQL write was attempted.'
  return
}

$verifiedEvidencePath = Assert-VerifiedBackupEvidence
$confirmation = Read-Host 'Type the exact Production project ref shown above to authorize the pinned target'
if ($confirmation -cne $expectedProjectRef) {
  throw 'Production project reference confirmation did not match; no migration was applied.'
}
$applyConfirmation = "APPLY MIGRATION 20261127120000 SHA256=$expectedMigrationHash TO PRODUCTION $expectedProjectRef"
if ((Read-Host "Type exactly: $applyConfirmation") -cne $applyConfirmation) {
  throw 'Migration confirmation did not match; no migration was applied.'
}

$writeGuardSql = @'
DO $prestate_guard$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR pg_is_in_recovery()
     OR current_setting('transaction_read_only') <> 'off'
     OR to_regnamespace('supabase_migrations') IS NOT NULL
     OR to_regclass('public.admin_users') IS NULL
     OR to_regclass('public.partner_profiles') IS NULL
     OR to_regclass('public.partner_coin_ledger') IS NULL
     OR to_regclass('public.partner_stock_movements') IS NULL
     OR to_regclass('public.partner_campaigns') IS NULL
     OR to_regclass('public.partner_campaign_assignments') IS NULL
     OR to_regclass('public.partner_campaign_sites') IS NULL
     OR to_regclass('public.partner_campaign_requests') IS NULL
     OR to_regclass('public.partner_damage_reports') IS NULL
     OR to_regclass('public.partner_proofs') IS NULL
     OR to_regclass('public.partner_withdrawal_requests') IS NULL
     OR to_regclass('storage.buckets') IS NULL
     OR to_regprocedure('gen_random_uuid()') IS NULL
     OR (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')) <> 3
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE)
     OR to_regclass('public.delivery_team_settings') IS NOT NULL
     OR to_regclass('public.delivery_team_activity') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'partner_coin_ledger' AND column_name IN ('administrator_id', 'admin_previous_balance', 'admin_resulting_balance', 'admin_reset', 'idempotency_key'))
           OR (table_name = 'partner_stock_movements' AND column_name IN ('administrator_id', 'previous_balance', 'resulting_balance', 'idempotency_key'))
           OR (table_name = 'partner_damage_reports' AND column_name = 'review_note'))
     )
     OR EXISTS (
       SELECT 1 FROM public.partner_coin_ledger
       WHERE NOT ((entry_type = 'earning' AND amount > 0 AND proof_id IS NOT NULL AND withdrawal_request_id IS NULL)
         OR (entry_type = 'withdrawal' AND amount < 0 AND proof_id IS NULL AND withdrawal_request_id IS NOT NULL))
     )
     OR EXISTS (
       SELECT 1 FROM public.partner_coin_ledger GROUP BY partner_profile_id
       HAVING sum(CASE WHEN (entry_type = 'earning' AND status IN ('approved', 'settled'))
           OR (entry_type = 'withdrawal' AND status IN ('requested', 'settled'))
         THEN amount ELSE 0 END) < 0
     )
     OR EXISTS (
       SELECT 1 FROM public.partner_stock_movements GROUP BY assignment_id HAVING sum(quantity) < 0
     )
     OR EXISTS (
       SELECT 1 FROM pg_proc
       WHERE pronamespace = 'public'::regnamespace
         AND proname IN (
           'assert_delivery_team_admin', 'delivery_team_available_coins',
           'get_partner_coin_summary', 'get_delivery_team_overview',
           'get_delivery_team_partners', 'get_delivery_team_partner_detail',
           'get_delivery_team_campaigns', 'admin_adjust_partner_coins',
           'admin_manage_partner_stock', 'admin_create_partner_campaign_assignment',
           'admin_update_partner_campaign_status', 'admin_set_delivery_team_low_stock_threshold',
           'admin_review_partner_proof', 'admin_review_partner_campaign_request',
           'admin_review_partner_damage_report', 'admin_review_partner_withdrawal'
         )
     )
     OR EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname IN ('partner_coin_ledger_entry_integrity_check', 'partner_coin_ledger_admin_balance_check', 'partner_coin_ledger_admin_reset_check', 'partner_stock_movements_admin_balance_check')
     )
     OR EXISTS (
       SELECT 1 FROM pg_policy
       WHERE polname IN ('delivery_team_settings_no_direct_access', 'delivery_team_activity_no_direct_access')
     )
     OR EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relname IN (
           'delivery_team_activity_recent', 'delivery_team_activity_partner_recent',
           'partner_coin_ledger_idempotency_unique', 'partner_stock_movements_idempotency_unique'
         )
     ) THEN
    RAISE EXCEPTION 'Pinned Production target, migration history, prerequisites, or untouched Delivery Team state failed';
  END IF;
END;
$prestate_guard$;
'@

$writeSql = @"
SET lock_timeout = '5s';
SET statement_timeout = '300s';
$writeGuardSql
$migrationSql
"@
try {
  [void](Invoke-PinnedProductionPsql -Sql $writeSql -SingleTransaction)
} catch {
  throw "The Production migration did not return a confirmed successful COMMIT. Single-transaction mode rolls back SQL errors; if the connection failed during COMMIT, the outcome may be uncertain. Do not retry; run the independent read-only verifier. $($_.Exception.Message)"
}

Write-Output "Migration psql completed successfully. Independently verifying with reviewed archive $verifiedEvidencePath."
$verifierPath = Join-Path $PSScriptRoot 'verify-production-delivery-team-post-migration.ps1'
if (-not (Test-Path -LiteralPath $verifierPath -PathType Leaf)) {
  throw 'Migration committed, but the independent Delivery Team verifier is missing. Do not deploy or retry.'
}
$powerShell = (Get-Command pwsh -ErrorAction Stop).Source
$verifierOutput = @(& $powerShell -NoProfile -File $verifierPath -ProjectRef $expectedProjectRef -PsqlPath $PsqlPath 2>&1)
$verifierExitCode = $LASTEXITCODE
foreach ($line in $verifierOutput) {
  Write-Output ([string]$line)
}
if ($verifierExitCode -ne 0 -or
  -not (@($verifierOutput | ForEach-Object { [string]$_ }) -contains 'DELIVERY TEAM SCHEMA EVIDENCE PASS - migration history remains UNVERIFIED.')) {
  throw 'Migration committed, but independent read-only verification failed. Do not deploy or retry.'
}
Write-Output 'POST-VERIFICATION PASS - Delivery Team schema is complete; migration history remains UNVERIFIED. No Vercel deployment was started.'
