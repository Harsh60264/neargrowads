$script:ProductionAdminDeletionProjectRef = 'axbjzmdokfoftzfgwiql'
$script:ProductionAdminDeletionMigrationVersion = '20261102100000'
$script:ProductionAdminDeletionManualMigrationVersion = '20261031010000'
$script:ProductionAdminDeletionDatabaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$script:ProductionAdminDeletionDatabasePort = '5432'
$script:ProductionAdminDeletionDatabaseName = 'postgres'
$script:ProductionAdminDeletionDatabaseUser = "postgres.$script:ProductionAdminDeletionProjectRef"
$script:ProductionAdminDeletionScriptDirectory = $PSScriptRoot
$script:ProductionAdminDeletionForeignKeys = @(
  'public.admin_users|invited_by|public.admin_users|id',
  'public.admin_sessions|user_id|public.admin_users|id',
  'public.admin_audit_logs|actor_id|public.admin_users|id',
  'public.admin_audit_logs|target_id|public.admin_users|id',
  'public.admin_ownership_transfers|from_user_id|public.admin_users|id',
  'public.admin_ownership_transfers|to_user_id|public.admin_users|id',
  'public.site_content_cms|updated_by|public.admin_users|id',
  'public.site_content_cms|published_by|public.admin_users|id',
  'public.service_store_payment_settings|razorpay_test_verified_by|public.admin_users|id',
  'public.service_store_payment_settings|updated_by|public.admin_users|id',
  'public.service_store_payment_audit|actor_id|public.admin_users|id',
  'public.site_content_revisions|actor_id|public.admin_users|id',
  'public.security_events|actor_id|public.admin_users|id',
  'public.security_alerts|acknowledged_by|public.admin_users|id',
  'public.security_alerts|resolved_by|public.admin_users|id',
  'public.security_detection_rules|updated_by|public.admin_users|id'
)

function Assert-ProductionAdminDeletionTarget {
  param([Parameter(Mandatory = $true)][string]$ProjectRef)

  if ($ProjectRef -cne $script:ProductionAdminDeletionProjectRef) {
    throw "ProjectRef must exactly match the pinned Production project ref $script:ProductionAdminDeletionProjectRef."
  }
}

function Get-ProductionAdminDeletionMigrationInventory {
  param([Parameter(Mandatory = $true)][string]$MigrationDirectory)

  $files = @(Get-ChildItem -LiteralPath $MigrationDirectory -Filter '*.sql' -File | Sort-Object Name)
  $inventory = @{}
  foreach ($file in $files) {
    if ($file.Name -notmatch '^(\d{14})_(.+)\.sql$') {
      throw "Migration filename does not use the expected timestamp_name.sql format: $($file.Name)"
    }
    $version = $Matches[1]
    if ($inventory.ContainsKey($version)) {
      throw "Duplicate local migration version: $version"
    }
    $inventory[$version] = $Matches[2]
  }

  if (-not $inventory.ContainsKey($script:ProductionAdminDeletionMigrationVersion)) {
    throw "Required Migration 36 file is missing: $($script:ProductionAdminDeletionMigrationVersion)"
  }
  if ($inventory[$script:ProductionAdminDeletionMigrationVersion] -cne 'secure_archived_admin_permanent_deletion') {
    throw 'Migration 36 has an unexpected filename; stop and review the release contents.'
  }
  if (@($inventory.Keys | Where-Object { $_ -gt $script:ProductionAdminDeletionMigrationVersion }).Count -gt 0) {
    throw 'A local migration newer than Migration 36 exists; review the production release scope before continuing.'
  }
  if (-not $inventory.ContainsKey($script:ProductionAdminDeletionManualMigrationVersion)) {
    throw "Expected SQL-Editor verification migration is missing: $($script:ProductionAdminDeletionManualMigrationVersion)"
  }
  if ($inventory[$script:ProductionAdminDeletionManualMigrationVersion] -cne 'complete_admin_temporary_password_setup') {
    throw 'The SQL-Editor verification migration has an unexpected filename; stop and review the release contents.'
  }

  return $inventory
}

function Invoke-ProductionAdminDeletionReadOnlyQuery {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRef,
    [Parameter(Mandatory = $true)][string]$PsqlPath,
    [Parameter(Mandatory = $true)][string]$Sql
  )

  Assert-ProductionAdminDeletionTarget -ProjectRef $ProjectRef
  if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
    throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
  }
  $versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
    throw "PostgreSQL 18 psql is required. Detected: $versionOutput"
  }

  $environmentHelper = Join-Path $script:ProductionAdminDeletionScriptDirectory 'psqlEnvironment.ps1'
  if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
    throw "PostgreSQL TLS environment helper was not found: $environmentHelper"
  }
  . $environmentHelper

  $temporarySqlPath = Join-Path $env:TEMP ("neargrow-production-readonly-" + [guid]::NewGuid().ToString('N') + '.psql')
  $temporaryOutputPath = Join-Path $env:TEMP ("neargrow-production-readonly-output-" + [guid]::NewGuid().ToString('N') + '.txt')
  $savedEnvironment = $null

  try {
    [System.IO.File]::WriteAllText($temporarySqlPath, $Sql, [System.Text.UTF8Encoding]::new($false))
    $savedEnvironment = Enter-StagingPsqlEnvironment
    $arguments = @(
      '--no-psqlrc',
      '--host', $script:ProductionAdminDeletionDatabaseHost,
      '--port', $script:ProductionAdminDeletionDatabasePort,
      '--username', $script:ProductionAdminDeletionDatabaseUser,
      '--dbname', $script:ProductionAdminDeletionDatabaseName,
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
    if ($psqlExitCode -ne 0) {
      throw 'The read-only Production verification query failed. No migration was run.'
    }
    if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
      throw 'The Production verification query returned no output file.'
    }
    return @(Get-Content -LiteralPath $temporaryOutputPath)
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

function Confirm-ProductionAdminDeletionDatabase {
  param([Parameter(Mandatory = $true)][string]$ProjectRef)

  Assert-ProductionAdminDeletionTarget -ProjectRef $ProjectRef
  Write-Output ''
  Write-Output 'READ-ONLY PRODUCTION DATABASE TARGET'
  Write-Output "Project ref: $script:ProductionAdminDeletionProjectRef"
  Write-Output "Host:        $script:ProductionAdminDeletionDatabaseHost"
  Write-Output "Port:        $script:ProductionAdminDeletionDatabasePort"
  Write-Output "Database:    $script:ProductionAdminDeletionDatabaseName"
  Write-Output "Username:    $script:ProductionAdminDeletionDatabaseUser"
  Write-Output 'TLS:         verify-full using the configured PostgreSQL root certificate'
  Write-Output 'The query sets default_transaction_read_only=on and contains no migration or account writes.'
  $confirmation = Read-Host 'Type the exact Production project ref shown above to continue'
  if ($confirmation -cne $script:ProductionAdminDeletionProjectRef) {
    throw 'Production project reference confirmation did not match; no database connection was opened.'
  }
}

function Test-ProductionAdminDeletionMigrationLedger {
  param(
    [Parameter(Mandatory = $true)][string[]]$QueryOutput,
    [Parameter(Mandatory = $true)][hashtable]$LocalMigrations,
    [Parameter(Mandatory = $true)][ValidateSet('Preflight', 'PostMigration')][string]$Phase,
    [switch]$AllowSchemaEvidenceFallback
  )

  $ledgerCheck = @($QueryOutput | Where-Object { $_ -like 'CHECK|migration_ledger|*' } | Select-Object -First 1)
  $ledgerState = if ($ledgerCheck.Count -eq 1) { ($ledgerCheck[0] -split '\|', 4)[2] } else { 'MALFORMED' }
  $knownUnavailableStates = @('ABSENT_SCHEMA', 'ABSENT_TABLE', 'INACCESSIBLE', 'EMPTY')
  $alternateLedgers = @($QueryOutput | Where-Object { $_ -like 'LEDGER_CANDIDATE|*' })
  if ($ledgerState -ne 'READABLE') {
    if ($ledgerCheck.Count -eq 1) {
      Write-Host "REVIEW | migration_ledger | application migration execution history is unavailable | state=$ledgerState | $(($ledgerCheck[0] -split '\|', 4)[3])"
    } else {
      Write-Host 'FAIL | migration_ledger | application migration execution history is unavailable: missing or malformed migration-history diagnostic.'
    }

    if (@($QueryOutput | Where-Object { $_ -like 'MIGRATION|*' }).Count -gt 0) {
      Write-Host 'FAIL | migration_ledger | migration rows were returned despite a non-readable ledger state.'
      return $false
    }
    if ($Phase -eq 'PostMigration') {
      Write-Host 'FAIL | migration_ledger | post-migration verification requires a readable ledger.'
      return $false
    }
    if ($alternateLedgers.Count -gt 0) {
      foreach ($candidate in $alternateLedgers) {
        Write-Host "REVIEW | alternate_migration_ledger_candidate | $candidate"
      }
      Write-Host 'FAIL | migration_history_unverified | reconcile alternate ledger evidence before using schema fallback.'
      return $false
    }
    if ($AllowSchemaEvidenceFallback -and $knownUnavailableStates -contains $ledgerState) {
      Write-Host 'REVIEW | migration_history_unverified | no migration version is inferred or marked applied; live schema checks are the only evidence in this mode.'
      return $true
    }
    Write-Host 'FAIL | migration_history_unverified | use -SchemaEvidenceFallback only after reviewing external Production deployment evidence.'
    return $false
  }

  Write-Host "PASS | migration_ledger | $($ledgerCheck[0])"
  $ledgerReady = $true
  $migrationRows = @($QueryOutput | Where-Object { $_ -like 'MIGRATION|*' })
  if ($migrationRows.Count -eq 0) {
    Write-Host 'FAIL | migration_ledger | ledger is marked readable but no migration rows were returned.'
    return $false
  }

  $databaseMigrations = @{}
  foreach ($line in $migrationRows) {
    $parts = $line.Split([char]124, 3)
    if ($parts.Count -ne 3 -or $parts[1] -notmatch '^\d{14}$') {
      Write-Host "FAIL | malformed_migration_history | $line"
      $ledgerReady = $false
      continue
    }
    if ($databaseMigrations.ContainsKey($parts[1])) {
      Write-Host "FAIL | duplicate_migration_history | $($parts[1])"
      $ledgerReady = $false
      continue
    }
    $databaseMigrations[$parts[1]] = $parts[2]
  }

  foreach ($version in @($LocalMigrations.Keys | Sort-Object)) {
    $localName = $LocalMigrations[$version]
    if ($databaseMigrations.ContainsKey($version)) {
      if ($databaseMigrations[$version] -cne $localName) {
        Write-Host "FAIL | migration_name_mismatch | $version | local=$localName | database=$($databaseMigrations[$version])"
        $ledgerReady = $false
      } elseif ($version -eq $script:ProductionAdminDeletionMigrationVersion -and $Phase -eq 'Preflight') {
        Write-Host "FAIL | migration_36_already_recorded | $version | $localName"
        $ledgerReady = $false
      } else {
        Write-Host "PASS | migration_applied | $version | $localName"
      }
      continue
    }

    if ($version -eq $script:ProductionAdminDeletionMigrationVersion -and $Phase -eq 'Preflight') {
      Write-Host "PASS | migration_36_not_applied | $version | $localName"
    } else {
      Write-Host "FAIL | migration_missing_from_history | $version | $localName"
      $ledgerReady = $false
    }
  }

  foreach ($version in @($databaseMigrations.Keys | Sort-Object)) {
    if (-not $LocalMigrations.ContainsKey($version)) {
      Write-Host "FAIL | unrecognized_database_migration | $version | $($databaseMigrations[$version])"
      $ledgerReady = $false
    }
  }

  if ($Phase -eq 'PostMigration' -and -not $databaseMigrations.ContainsKey($script:ProductionAdminDeletionMigrationVersion)) {
    Write-Host 'FAIL | migration_36_not_recorded | Migration 36 must appear in Production migration history after execution.'
    $ledgerReady = $false
  }
  return $ledgerReady
}

function Test-ProductionAdminDeletionSchemaEvidenceLedger {
  param([Parameter(Mandatory = $true)][string[]]$QueryOutput)

  $ledgerChecks = @($QueryOutput | Where-Object { $_ -like 'CHECK|migration_ledger|*' })
  if ($ledgerChecks.Count -ne 1) {
    Write-Host 'FAIL | schema_evidence_ledger | exactly one migration-ledger diagnostic is required.'
    return $false
  }

  $parts = $ledgerChecks[0].Split([char]124, 4)
  $allowedUnavailableStates = @('ABSENT_SCHEMA', 'ABSENT_TABLE', 'EMPTY')
  if ($parts.Count -ne 4) {
    Write-Host 'FAIL | schema_evidence_ledger | migration-ledger diagnostic is malformed.'
    return $false
  }
  if ($allowedUnavailableStates -notcontains $parts[2]) {
    Write-Host "FAIL | schema_evidence_ledger | schema evidence mode requires an absent or empty application ledger; state=$($parts[2]). Use the history-based verifier when the ledger is readable."
    return $false
  }

  if (@($QueryOutput | Where-Object { $_ -like 'MIGRATION|*' }).Count -gt 0) {
    Write-Host 'FAIL | schema_evidence_ledger | migration versions were returned despite the absent/empty ledger diagnostic.'
    return $false
  }
  $alternateLedgers = @($QueryOutput | Where-Object { $_ -like 'LEDGER_CANDIDATE|*' })
  if ($alternateLedgers.Count -gt 0) {
    foreach ($candidate in $alternateLedgers) {
      Write-Host "FAIL | alternate_migration_ledger_candidate | $candidate"
    }
    return $false
  }

  Write-Host "REVIEW | migration_history_unverified | $($parts[2]) | no historical versions are inferred or written."
  return $true
}

function Test-ProductionAdminDeletionForeignKeys {
  param(
    [Parameter(Mandatory = $true)][string[]]$QueryOutput,
    [Parameter(Mandatory = $true)][ValidateSet('Preflight', 'PostMigration')][string]$Phase
  )

  $actualForeignKeys = @()
  foreach ($line in $QueryOutput | Where-Object { $_ -like 'ADMIN_FK|*' }) {
    $parts = $line.Split([char]124, 9)
    if ($parts.Count -ne 9) {
      Write-Host "FAIL | malformed_admin_foreign_key | $line"
      return $false
    }
    if ($parts[8] -ne 'true') {
      Write-Host "FAIL | malformed_admin_foreign_key | $line"
      return $false
    }
    $actualForeignKeys += "$($parts[1]).$($parts[2])|$($parts[3])|$($parts[4]).$($parts[5])|$($parts[6])"
  }

  $expected = foreach ($foreignKey in $script:ProductionAdminDeletionForeignKeys) {
    $parts = $foreignKey.Split('|', 4)
    $targetTable = if ($Phase -eq 'Preflight' -or $parts[0] -eq 'public.admin_sessions') {
      'public.admin_users'
    } else {
      'public.admin_identity_history'
    }
    "$($parts[0])|$($parts[1])|$targetTable|$($parts[3])"
  }
  if ($Phase -eq 'PostMigration' -and
    @($actualForeignKeys | Where-Object {
      $_ -like 'public.service_store_payment_settings|cashfree_test_verified_by|*'
    }).Count -gt 0) {
    $expected += 'public.service_store_payment_settings|cashfree_test_verified_by|public.admin_identity_history|id'
  }

  $actualPairs = @($actualForeignKeys | Sort-Object)
  $expectedPairs = @($expected | Sort-Object)
  $passed = $actualForeignKeys.Count -eq $expected.Count -and (Compare-Object $actualPairs $expectedPairs).Count -eq 0
  foreach ($foreignKey in $actualForeignKeys | Sort-Object) {
    Write-Host "INFO | admin_foreign_key | $foreignKey"
  }
  if ($passed) {
    Write-Host "PASS | admin_foreign_keys | all $($expected.Count) expected Admin references have the expected target for $Phase."
  } else {
    Write-Host "FAIL | admin_foreign_keys | expected exactly $($expected.Count) known Admin references and the phase-appropriate targets; found $($actualForeignKeys.Count)."
  }
  return $passed
}

function Write-ProductionAdminDeletionChecks {
  param(
    [Parameter(Mandatory = $true)][string[]]$QueryOutput,
    [Parameter(Mandatory = $true)][ValidateSet('Preflight', 'PostMigration')][string]$Phase
  )

  $passed = $true
  $checks = @($QueryOutput | Where-Object { $_ -like 'CHECK|*' -and $_ -notlike 'CHECK|migration_ledger|*' })
  $expectedNames = @(
    'production_target'
  )
  if ($Phase -eq 'Preflight') {
    $expectedNames += @(
      'admin_schema_prerequisites',
      'identity_history_setup_prerequisite',
      'admin_core_access',
      'admin_auth_identity_fk',
      'uuid_generation_prerequisite',
      'migration_36_objects_absent'
    )
  } else {
    $expectedNames += @(
      'migration_36_schema',
      'trigger_function_public.sync_admin_identity_history()',
      'trigger_function_public.lock_admin_email_reservation(text)',
      'trigger_function_public.guard_admin_email_reservation()',
      'trigger_function_public.guard_auth_email_reservation()',
      'trigger_function_public.guard_admin_permanent_deletion_in_progress()',
      'trigger_admin_users_sync_identity_history',
      'trigger_admin_users_guard_reserved_email',
      'trigger_auth_users_guard_reserved_email',
      'trigger_admin_users_guard_pending_permanent_deletion',
      'table_admin_identity_history',
      'table_admin_permanent_deletion_jobs',
      'table_admin_permanent_deletion_email_reservations',
      'identity_history_backfill'
    )
    $expectedNames += @(
      'rpc_public.get_admin_permanent_deletion_state(uuid)',
      'rpc_public.begin_admin_permanent_deletion(uuid,uuid,text,text)',
      'rpc_public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)',
      'rpc_public.complete_admin_permanent_deletion(uuid,uuid)'
    )
    $expectedNames += @(
      'migration_36_table_definitions',
      'migration_36_table_constraints',
      'function_definition_sync_admin_identity_history',
      'function_definition_lock_admin_email_reservation',
      'function_definition_guard_admin_email_reservation',
      'function_definition_guard_auth_email_reservation',
      'function_definition_guard_admin_permanent_deletion_in_progress',
      'function_definition_get_admin_permanent_deletion_state',
      'function_definition_begin_admin_permanent_deletion',
      'function_definition_record_admin_permanent_deletion_failure',
      'function_definition_complete_admin_permanent_deletion',
      'migration_36_function_overloads',
      'migration_36_foreign_keys'
    )
  }

  $actualNames = @()
  foreach ($line in $checks) {
    $parts = $line.Split([char]124, 4)
    if ($parts.Count -ne 4) {
      Write-Host "FAIL | malformed_database_check | $line"
      $passed = $false
    } elseif ($parts[2] -ne 'PASS') {
      Write-Host "FAIL | database_check | $line"
      $passed = $false
    } else {
      $actualNames += $parts[1]
      Write-Host $line
    }
  }
  foreach ($expectedName in $expectedNames) {
    if ($actualNames -notcontains $expectedName) {
      Write-Host "FAIL | missing_database_check | $expectedName"
      $passed = $false
    }
  }
  foreach ($actualName in $actualNames | Sort-Object -Unique) {
    if ($expectedNames -notcontains $actualName) {
      Write-Host "FAIL | unexpected_database_check | $actualName"
      $passed = $false
    }
  }
  if ($actualNames.Count -ne $expectedNames.Count) {
    Write-Host "FAIL | database_check_count | expected $($expectedNames.Count) checks; received $($actualNames.Count)."
    $passed = $false
  }
  return $passed
}
