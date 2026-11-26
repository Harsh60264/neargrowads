[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$BackupEvidencePath,
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [switch]$Apply,
  [switch]$AcknowledgeUnrestoredBackup
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"
$migrationFileName = '20261126120000_create_partner_workspace.sql'
$expectedMigrationHash = '93C004F7B3D4BF772FEBF12804B5C508956AF0CB3C7CABEBB78D9E1239FEE756'

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if ($AcknowledgeUnrestoredBackup -and -not $Apply) {
  throw '-AcknowledgeUnrestoredBackup is available only with -Apply; no Production connection was opened.'
}
if ([string]::IsNullOrWhiteSpace($BackupEvidencePath) -or
  -not (Test-Path -LiteralPath $BackupEvidencePath -PathType Leaf)) {
  throw "A verified backup manifest is required before connecting to Production. Run scripts\backup-production-partner-workspace.ps1 -ProjectRef '$expectedProjectRef' and pass its backup-evidence.json with -BackupEvidencePath."
}
if ($databaseUser -cne "postgres.$ProjectRef") {
  throw 'The Production database identity does not match the pinned project.'
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}
$versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 psql is required. Detected: $versionOutput"
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFileName"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
  throw "The pinned partner workspace migration is missing: $migrationFileName"
}
$actualMigrationHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
if ($actualMigrationHash -cne $expectedMigrationHash) {
  throw "Partner workspace migration hash mismatch. Expected $expectedMigrationHash; found $actualMigrationHash. Nothing was connected or applied."
}
$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
if ($migrationSql -match '(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;' -or
  $migrationSql -match '(?im)^\s*(?:INSERT\s+INTO\s+supabase_migrations|CREATE\s+SCHEMA\s+supabase_migrations)') {
  throw 'The pinned migration must not manage transaction boundaries or fabricate migration history.'
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper

function Invoke-ProductionPartnerPsql {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Sql,
    [switch]$SingleTransaction
  )

  $temporarySqlPath = Join-Path $env:TEMP ("neargrow-production-partner-workspace-" + [guid]::NewGuid().ToString('N') + '.psql')
  $temporaryOutputPath = Join-Path $env:TEMP ("neargrow-production-partner-workspace-output-" + [guid]::NewGuid().ToString('N') + '.txt')
  $savedEnvironment = $null
  try {
    [System.IO.File]::WriteAllText(
      $temporarySqlPath,
      $Sql,
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
      '--output', $temporaryOutputPath
    )
    if ($SingleTransaction) {
      $arguments += '--single-transaction'
    }
    $arguments += @('--file', $temporarySqlPath)

    $diagnostics = @(& $PsqlPath @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      $diagnosticText = ($diagnostics | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) {
          $_.Exception.Message
        } else {
          [string]$_
        }
      }) -join "`n"
      $postgresErrorMatch = [regex]::Match(
        $diagnosticText,
        '(?im)\bERROR:\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)'
      )
      if ($postgresErrorMatch.Success) {
        $sqlState = $postgresErrorMatch.Groups[1].Value.ToUpperInvariant()
        $safeMessage = $postgresErrorMatch.Groups[2].Value.Trim() `
          -replace '(?i)\b(?:postgres(?:ql)?|https?)://\S+', '[redacted]' `
          -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+', '$1=[redacted]' `
          -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]' `
          -replace '"[^"]*"|''[^'']*''', '[redacted]' `
          -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[redacted-email]' `
          -replace '(?i)(?<!\d)(?:\+?\d[\s().-]*){10,15}(?!\d)', '[redacted-phone]' `
          -replace '\b[A-Za-z0-9_-]{32,}\b', '[redacted-token]' `
          -replace '\s+', ' '
        if ($safeMessage.Length -gt 180) {
          $safeMessage = $safeMessage.Substring(0, 180) + '...'
        }
        if ([string]::IsNullOrWhiteSpace($safeMessage)) {
          $safeMessage = 'PostgreSQL reported an error; message redacted.'
        }
        $stateText = if ([string]::IsNullOrWhiteSpace($sqlState)) { 'unavailable' } else { $sqlState }
        throw "Pinned Production psql operation failed (exit code $exitCode, SQLSTATE $stateText): $safeMessage. DETAIL, HINT, CONTEXT and SQL text were omitted."
      }
      throw "Pinned Production psql operation failed (exit code $exitCode); raw diagnostics were omitted."
    }
    if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
      throw 'Pinned Production psql returned no output file.'
    }
    return @(Get-Content -LiteralPath $temporaryOutputPath -ErrorAction Stop)
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

function Assert-VerifiedBackupEvidence {
  param([switch]$ArchiveOnly)

  if ([string]::IsNullOrWhiteSpace($BackupEvidencePath)) {
    throw "A verified backup evidence manifest is required. First run scripts\backup-production-partner-workspace.ps1 -ProjectRef '$expectedProjectRef', then pass its backup-evidence.json with -BackupEvidencePath."
  }
  $evidenceVerifier = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
  if (-not (Test-Path -LiteralPath $evidenceVerifier -PathType Leaf)) {
    throw "The independent backup evidence verifier is missing: $evidenceVerifier"
  }
  $powerShell = (Get-Command pwsh -ErrorAction Stop).Source
  $verificationArguments = @(
    '-NoProfile', '-File', $evidenceVerifier,
    '-EvidencePath', $BackupEvidencePath,
    '-PgRestorePath', $PgRestorePath
  )
  if ($ArchiveOnly) {
    $verificationArguments += '-ArchiveOnly'
  }
  $verificationOutput = @(& $powerShell @verificationArguments 2>&1)
  $verificationExitCode = $LASTEXITCODE
  foreach ($line in $verificationOutput) {
    Write-Output ([string]$line)
  }
  $expectedMarker = if ($ArchiveOnly) {
    'BACKUP ARCHIVE PASS - RESTORE DRILL FAILED; FULL RESTORE UNVERIFIED'
  } else {
    'BACKUP EVIDENCE PASS'
  }
  if ($verificationExitCode -ne 0 -or
    -not (@($verificationOutput | ForEach-Object { [string]$_ }) -contains $expectedMarker)) {
    throw 'Independent backup evidence verification failed; no migration was applied.'
  }
  $evidence = Get-Content -LiteralPath $BackupEvidencePath -Raw | ConvertFrom-Json -DateKind String
  $backupConfirmation = if ($ArchiveOnly) {
    "ARCHIVE-ONLY EVIDENCE REVIEWED SHA256=$($evidence.sha256) FOR $expectedProjectRef"
  } else {
    "BACKUP EVIDENCE REVIEWED SHA256=$($evidence.sha256) FOR $expectedProjectRef"
  }
  $backupTyped = Read-Host "Review the evidence and its exclusions above; type exactly: $backupConfirmation"
  if ($backupTyped -cne $backupConfirmation) {
    throw 'Production backup evidence was not confirmed; no migration was applied.'
  }
  $coverageConfirmation = "BACKUP LIMITATIONS ACKNOWLEDGED FOR $expectedProjectRef"
  $coverageTyped = Read-Host "Confirm Storage object bytes and project-level configuration/secrets have separate recovery procedures; type exactly: $coverageConfirmation"
  if ($coverageTyped -cne $coverageConfirmation) {
    throw 'Backup coverage limitations were not acknowledged; no migration was applied.'
  }
  $recoveryRoute = Read-Host 'Identify the reachable authorized Supabase recovery/on-call route (do not enter credentials)'
  if ([string]::IsNullOrWhiteSpace($recoveryRoute)) {
    throw 'An authorized recovery route is required; no production write was attempted.'
  }
  if ($ArchiveOnly) {
    $riskConfirmation = "I ACKNOWLEDGE RESTORE DRILL FAILED AND APPROVE MIGRATION-SPECIFIC RECOVERY FOR 20261126120000 TO PRODUCTION $expectedProjectRef"
    $riskTyped = Read-Host "Full restoreability is unverified. Confirm the transaction-only rollback and forward-recovery limits; type exactly: $riskConfirmation"
    if ($riskTyped -cne $riskConfirmation) {
      throw 'Unrestored-archive migration-specific recovery risk was not acknowledged; no production write was attempted.'
    }
    Write-Output 'Recovery procedure: SQL errors roll back the complete single transaction; an uncertain commit is checked read-only and never retried.'
    Write-Output 'Post-commit application rollback keeps this additive schema and any partner data; do not drop database objects or restore the archive.'
    return
  }
  $recoveryConfirmation = "FORWARD RECOVERY READY FOR $expectedProjectRef"
  $recoveryTyped = Read-Host "Confirm the authorized in-place restore/incident procedure and acknowledge that post-commit recovery is forward-only and may lose later writes; type exactly: $recoveryConfirmation"
  if ($recoveryTyped -cne $recoveryConfirmation) {
    throw 'Production recovery readiness was not confirmed; no production write was attempted.'
  }

  Write-Output "Backup created (UTC): $([DateTimeOffset]::Parse([string]$evidence.backupCreatedAtUtc).ToUniversalTime().ToString('o'))"
  Write-Output "Backup evidence SHA-256: $($evidence.sha256)"
  Write-Output 'Backup archive integrity, Auth/data coverage, and isolated restore: independently verified.'
  Write-Output 'Storage files and Supabase project-level configuration remain outside pg_dump coverage.'
  Write-Output 'Authorized forward-recovery route: operator-confirmed.'
}

function Invoke-PartnerWorkspaceSchemaVerifier {
  param([switch]$PostMigration)

  $verifierPath = if ($PostMigration) {
    Join-Path $PSScriptRoot 'verify-production-partner-workspace-post-migration.ps1'
  } else {
    Join-Path $PSScriptRoot 'verify-production-partner-schema.ps1'
  }
  if (-not (Test-Path -LiteralPath $verifierPath -PathType Leaf)) {
    throw "Required read-only partner schema verifier is missing: $verifierPath"
  }
  $powerShell = (Get-Command pwsh -ErrorAction Stop).Source
  $verifierArguments = @(
    '-NoProfile', '-File', $verifierPath,
    '-ProjectRef', $expectedProjectRef,
    '-PsqlPath', $PsqlPath
  )
  if (-not $PostMigration) {
    $verifierArguments += '-SchemaEvidenceOnly'
  }
  $verifierOutput = @(& $powerShell @verifierArguments 2>&1)
  $verifierExitCode = $LASTEXITCODE
  foreach ($line in $verifierOutput) {
    Write-Output ([string]$line)
  }
  if ($verifierExitCode -ne 0) {
    throw "Read-only partner schema verification failed (exit code $verifierExitCode); no migration was applied by the preflight."
  }
  $expectedMarker = if ($PostMigration) {
    'SCHEMA EVIDENCE PASS - post-migration schema is complete; migration history remains UNVERIFIED.'
  } else {
    'SCHEMA EVIDENCE PASS - identity prerequisites match and workspace objects are absent; migration history remains UNVERIFIED.'
  }
  if (-not (@($verifierOutput | ForEach-Object { [string]$_ }) -contains $expectedMarker)) {
    throw 'The read-only schema verifier exited without its exact expected schema-evidence result.'
  }
}

Write-Output 'ONE-TIME PRODUCTION PARTNER WORKSPACE MIGRATION'
Write-Output "Project ref: $expectedProjectRef"
Write-Output "Host:        $databaseHost"
Write-Output "Port:        $databasePort"
Write-Output "Database:    $databaseName"
Write-Output "User:        $databaseUser"
Write-Output 'TLS:         verify-full using the configured PostgreSQL root certificate'
Write-Output "Migration:   $migrationFileName"
Write-Output "SHA-256:     $expectedMigrationHash"
Write-Output 'Migration history remains UNVERIFIED; this workflow never creates or modifies ledger rows.'
Write-Output 'Migration scope is limited to partner workspace objects and the private partner-proofs bucket configuration.'
if ($AcknowledgeUnrestoredBackup) {
  Write-Output 'RECOVERY WARNING: the archive is integrity-checked but the full restore drill FAILED; restoreability remains UNVERIFIED.'
  Write-Output 'The opt-in path is only for this additive migration and requires a separate explicit recovery-risk acknowledgement.'
}

Invoke-PartnerWorkspaceSchemaVerifier
Assert-VerifiedBackupEvidence -ArchiveOnly:$AcknowledgeUnrestoredBackup
if (-not $Apply) {
  Write-Output 'PREFLIGHT ONLY - no Production SQL write was attempted.'
  Write-Output 'A separate -Apply run repeats every gate and requires a distinct exact Production migration confirmation.'
  return
}

$confirmation = Read-Host 'Type the exact Production project ref shown above to authorize the pinned target'
if ($confirmation -cne $expectedProjectRef) {
  throw 'Production project reference confirmation did not match; no migration was applied.'
}
$applyConfirmation = "APPLY MIGRATION 20261126120000 SHA256=$expectedMigrationHash TO PRODUCTION $expectedProjectRef"
$applyTyped = Read-Host "Type exactly: $applyConfirmation"
if ($applyTyped -cne $applyConfirmation) {
  throw 'Migration confirmation did not match; no migration was applied.'
}

$writeGuardSql = @'
DO $prestate_guard$
DECLARE
  workspace_object_present boolean;
  invalid_partner_bucket boolean;
  required_role_count integer;
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR pg_is_in_recovery()
     OR current_setting('transaction_read_only') <> 'off'
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('public.admin_users') IS NULL
     OR to_regclass('public.partner_profiles') IS NULL
     OR to_regclass('public.partner_sessions') IS NULL
     OR to_regclass('storage.buckets') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'storage'
         AND relation.relname = 'buckets'
         AND relation.relkind IN ('r', 'p')
     )
     OR to_regnamespace('supabase_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Pinned Production target, identity prerequisites, writable transaction, or absent-history state failed';
  END IF;
  SELECT count(*) INTO required_role_count
  FROM pg_roles
  WHERE rolname IN ('anon', 'authenticated', 'service_role');
  IF required_role_count <> 3 OR to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'Required Supabase roles or UUID generator are unavailable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_users'
      AND column_name = 'id' AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_users'
      AND column_name = 'is_primary_owner' AND data_type = 'boolean'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_users'
      AND column_name = 'status' AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'admin_users'
      AND column_name = 'role' AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class source_table ON source_table.oid = constraint_row.conrelid
    JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
    JOIN pg_class target_table ON target_table.oid = constraint_row.confrelid
    JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
    WHERE source_namespace.nspname = 'public'
      AND source_table.relname = 'partner_sessions'
      AND constraint_row.conname = 'partner_sessions_user_id_fkey'
      AND constraint_row.contype = 'f'
      AND constraint_row.convalidated
      AND constraint_row.confdeltype = 'c'
      AND target_namespace.nspname = 'public'
      AND target_table.relname = 'partner_profiles'
      AND EXISTS (
        SELECT 1
        FROM pg_attribute source_attribute
        JOIN pg_attribute target_attribute
          ON target_attribute.attrelid = target_table.oid
          AND target_attribute.attname = 'id'
          AND target_attribute.attnum > 0
          AND NOT target_attribute.attisdropped
        WHERE source_attribute.attrelid = source_table.oid
          AND source_attribute.attname = 'user_id'
          AND source_attribute.attnum > 0
          AND NOT source_attribute.attisdropped
          AND constraint_row.conkey = ARRAY[source_attribute.attnum]::smallint[]
          AND constraint_row.confkey = ARRAY[target_attribute.attnum]::smallint[]
      )
  ) THEN
    RAISE EXCEPTION 'The reviewed Primary Owner authorization dependencies changed';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'partner_campaigns', 'partner_campaign_assignments', 'partner_campaign_sites',
        'partner_campaign_requests', 'partner_damage_reports', 'partner_proofs',
        'partner_stock_movements', 'partner_withdrawal_requests', 'partner_coin_ledger',
        'partner_campaign_assignments_partner_active', 'partner_campaign_sites_campaign',
        'partner_campaign_requests_partner', 'partner_damage_reports_partner',
        'partner_proofs_partner_recent', 'partner_proofs_review_queue',
        'partner_stock_movements_proof_unique', 'partner_stock_movements_partner_recent',
        'partner_withdrawal_requests_partner', 'partner_coin_ledger_proof_unique',
        'partner_coin_ledger_withdrawal_unique', 'partner_coin_ledger_partner_recent'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_proc procedure
    JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'create_partner_campaign_assignment', 'submit_partner_proof',
        'review_partner_proof', 'request_partner_withdrawal',
        'review_partner_withdrawal', 'review_partner_campaign_request',
        'review_partner_damage_report'
      )
  ) INTO workspace_object_present;
  IF workspace_object_present THEN
    RAISE EXCEPTION 'Partner workspace objects already exist; refusing partial or duplicate application';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'partner-proofs'
      AND (
        name IS DISTINCT FROM 'partner-proofs'
        OR
        public IS DISTINCT FROM false
        OR file_size_limit IS DISTINCT FROM 2097152
        OR allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg', 'image/png', 'image/webp']
      )
  ) INTO invalid_partner_bucket;
  IF invalid_partner_bucket THEN
    RAISE EXCEPTION 'The existing partner-proofs bucket configuration conflicts with the reviewed migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE relation.relkind IN ('r', 'p')
      AND namespace.nspname NOT IN (
        'pg_catalog', 'information_schema', 'auth', 'storage',
        'realtime', 'vault', 'extensions'
      )
      AND (
        relation.relname ILIKE '%migrat%'
        OR relation.relname ILIKE '%schema_history%'
        OR relation.relname ILIKE '%version%'
      )
  ) THEN
    RAISE EXCEPTION 'An alternate migration-history candidate appeared; refusing an untracked Production write';
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
  [void](Invoke-ProductionPartnerPsql -Sql $writeSql -SingleTransaction)
} catch {
  throw "The Production migration did not return a confirmed successful COMMIT. Single-transaction mode rolls back SQL errors; if the connection failed during COMMIT, the outcome may be uncertain. Do not retry; run the independent read-only post-verifier. $($_.Exception.Message)"
}

Write-Output 'Migration psql completed successfully. Starting independent read-only post-verification.'
try {
  Invoke-PartnerWorkspaceSchemaVerifier -PostMigration
} catch {
  throw "The migration committed, but independent post-verification failed. Do not deploy the application or retry the migration. $($_.Exception.Message)"
}
Write-Output 'POST-VERIFICATION PASS - workspace schema complete; migration history remains UNVERIFIED. No Vercel deployment was started.'
