$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\cashfreeStagingVerification.Common.ps1')

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw "FAIL: $Message"
  }
}

function Get-ExpectedFailure {
  param([scriptblock]$Action)
  try {
    & $Action
  } catch {
    return $_.Exception.Message
  }
  throw 'Expected the operation to fail closed, but it returned successfully.'
}

$emptyOutputError = Get-ExpectedFailure {
  Resolve-CashfreeStagingQueryOutput -ExitCode 0 -QueryOutput @() -Diagnostics @()
}
Assert-True ($emptyOutputError -match 'empty verification output') 'Empty psql output must fail closed.'

$queryFailureError = Get-ExpectedFailure {
  Resolve-CashfreeStagingQueryOutput -ExitCode 1 -QueryOutput @() -Diagnostics @('ERROR: relation is unavailable')
}
Assert-True ($queryFailureError -match 'reported a database error') 'A failed psql query must report a sanitized error.'

$authenticationError = Get-ExpectedFailure {
  Resolve-CashfreeStagingQueryOutput -ExitCode 2 -QueryOutput @() -Diagnostics @(
    'FATAL: password authentication failed for user; supplied value=offline-test-secret'
  )
}
Assert-True ($authenticationError -match 'database authentication failed') 'Authentication errors must be identified.'
Assert-True ($authenticationError -notmatch 'offline-test-secret') 'Authentication diagnostics must not leak supplied values.'

$successOutput = @(
  Resolve-CashfreeStagingQueryOutput -ExitCode 0 `
    -QueryOutput @('CHECK|sample|PASS|offline fixture') `
    -Diagnostics @()
)
$parsedResult = @(Assert-CashfreeStagingCheckRows -QueryOutput $successOutput -ExpectedNames @('sample'))
Assert-True ($parsedResult[-1] -eq $true) 'Valid mocked query output should parse successfully.'

$emptyParserResult = @(Assert-CashfreeStagingCheckRows -QueryOutput @() -ExpectedNames @('sample'))
Assert-True ($emptyParserResult[-1] -eq $false) 'The check parser must reject empty input without parameter-binding failure.'

$diagnosticNames = @(Get-CashfreeMigration36SchemaDiagnosticNames)
$migration36DiagnosticsSql = Get-CashfreeMigration36SchemaDiagnosticsSql
Assert-True ($migration36DiagnosticsSql.Contains(
  "('admin_permanent_deletion_email_reservations', 'created_at', 'timestamp with time zone', true, 'now()')"
)) 'The Staging verifier must expect the now() default defined by Migration 36 and the Production verifier.'
Assert-True ($migration36DiagnosticsSql.Contains("'COLUMN_DIFF|'")) `
  'The read-only schema diagnostic must emit per-column metadata differences.'
Assert-True ($migration36DiagnosticsSql.Contains('expected_type=') -and
  $migration36DiagnosticsSql.Contains('actual_type=') -and
  $migration36DiagnosticsSql.Contains('expected_not_null=') -and
  $migration36DiagnosticsSql.Contains('actual_not_null=') -and
  $migration36DiagnosticsSql.Contains('expected_default=') -and
  $migration36DiagnosticsSql.Contains('actual_default=')) `
  'Per-column diagnostics must show expected and actual type, nullability, and default.'
$evidenceChecks = @('target_identity') + $diagnosticNames + @('migration36_schema_evidence')
$validMigration36Rows = @($diagnosticNames | ForEach-Object { "CHECK|$_|PASS|offline fixture" })
$emptyLedgerEvidence = @(
  'CHECK|target_identity|PASS|offline fixture'
) + $validMigration36Rows + @(
  'CHECK|migration_ledger|FAIL|empty ledger',
  'MIGRATION_HISTORY|EMPTY|offline fixture'
)
$emptyLedgerEvidence = @(Add-CashfreeMigration36SchemaAggregate -QueryOutput $emptyLedgerEvidence)
Assert-True (Test-CashfreeSchemaEvidenceOnly -QueryOutput $emptyLedgerEvidence `
  -Phase Preflight -ExpectedCheckNames $evidenceChecks) 'Explicit schema evidence may accept a readable but empty ledger.'

$unreadableLedgerEvidence = @(
  'CHECK|target_identity|PASS|offline fixture'
) + $validMigration36Rows + @(
  'CHECK|migration_ledger|FAIL|unreadable ledger',
  'MIGRATION_HISTORY|UNREADABLE|offline fixture'
)
$unreadableLedgerEvidence = @(Add-CashfreeMigration36SchemaAggregate -QueryOutput $unreadableLedgerEvidence)
Assert-True (-not (Test-CashfreeSchemaEvidenceOnly -QueryOutput $unreadableLedgerEvidence `
  -Phase Preflight -ExpectedCheckNames $evidenceChecks)) 'An unreadable ledger must never use schema evidence fallback.'

$alternateLedgerEvidence = $emptyLedgerEvidence + 'LEDGER_CANDIDATE|custom.migration_history'
Assert-True (-not (Test-CashfreeSchemaEvidenceOnly -QueryOutput $alternateLedgerEvidence `
  -Phase Preflight -ExpectedCheckNames $evidenceChecks)) 'Alternate migration-history candidates must block schema evidence fallback.'

$partialMigration36Rows = @(
  'CHECK|target_identity|PASS|offline fixture',
  'CHECK|migration36_table_definitions|FAIL|offline missing expected table column'
) + @($diagnosticNames | Where-Object { $_ -ne 'migration36_table_definitions' } |
  ForEach-Object { "CHECK|$_|PASS|offline fixture" }) +
  @('CHECK|migration_ledger|FAIL|empty ledger', 'MIGRATION_HISTORY|EMPTY|offline fixture')
$partialMigration36Rows = @(Add-CashfreeMigration36SchemaAggregate -QueryOutput $partialMigration36Rows)
$aggregateFailure = $partialMigration36Rows -join "`n"
Assert-True ($aggregateFailure -match 'migration36_schema_evidence\|FAIL\|Failed subchecks: migration36_table_definitions') `
  "A partial Migration 36 schema must produce one failed aggregate naming its failed subcheck. Aggregate: $aggregateFailure"
Assert-True (-not (Test-CashfreeSchemaEvidenceOnly -QueryOutput $partialMigration36Rows `
  -Phase Preflight -ExpectedCheckNames $evidenceChecks)) 'Partial Migration 36 state must fail the evidence-only gate.'

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cashfree-preflight-test-" + [guid]::NewGuid().ToString('N'))
$appDataPath = Join-Path $tempRoot 'appdata'
$postgresDirectory = Join-Path $appDataPath 'postgresql'
$mockPsqlPath = Join-Path $tempRoot 'mock-psql.ps1'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$preflightPath = Join-Path $repoRoot 'scripts\verify-staging-cashfree-migration-preflight.ps1'

New-Item -ItemType Directory -Path $postgresDirectory -Force | Out-Null
[System.IO.File]::WriteAllText(
  (Join-Path $postgresDirectory 'root.crt'),
  'offline placeholder; the mocked psql process never makes a connection',
  [System.Text.UTF8Encoding]::new($false)
)

$mockPsql = @'
if ($args[0] -eq '--version') {
  Write-Output 'psql (PostgreSQL) 18.0'
  $global:LASTEXITCODE = 0
  return
}

if ($env:CASHFREE_MOCK_PSQL_MODE -eq 'authentication') {
  Write-Error 'FATAL: password authentication failed for user postgres.kdaixomygsuxadofoieb' -ErrorAction Continue
  $global:LASTEXITCODE = 2
  return
}

$outputIndex = [Array]::IndexOf($args, '--output')
if ($outputIndex -lt 0 -or $outputIndex + 1 -ge $args.Count) {
  [Console]::Error.WriteLine('ERROR: expected --output argument')
  $global:LASTEXITCODE = 3
  return
}

$outputFile = $args[$outputIndex + 1]
if ($env:CASHFREE_MOCK_PSQL_MODE -eq 'empty') {
  [System.IO.File]::WriteAllText($outputFile, '')
  $global:LASTEXITCODE = 0
  return
}

$rows = switch ($env:CASHFREE_MOCK_PSQL_MODE) {
  'evidence-absent' {
    @(
      'CHECK|target_identity|PASS|offline mock',
      'CHECK|migration36_live_prerequisites|PASS|offline mock',
      'CHECK|payment_schema_and_permissions|PASS|offline mock',
      'CHECK|cashfree_objects_absent|PASS|offline mock',
      'CHECK|migration_ledger|FAIL|offline missing ledger',
      'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    )
    break
  }
  'evidence-unexpected-ledger' {
    @(
      'CHECK|target_identity|PASS|offline mock',
      'CHECK|migration36_live_prerequisites|PASS|offline mock',
      'CHECK|payment_schema_and_permissions|PASS|offline mock',
      'CHECK|cashfree_objects_absent|PASS|offline mock',
      'CHECK|migration_ledger|FAIL|unexpected ledger state',
      'MIGRATION_HISTORY|READABLE|offline fixture'
    )
    break
  }
  'evidence-partial-cashfree' {
    @(
      'CHECK|target_identity|PASS|offline mock',
      'CHECK|migration36_live_prerequisites|PASS|offline mock',
      'CHECK|payment_schema_and_permissions|PASS|offline mock',
      'CHECK|cashfree_objects_absent|FAIL|partial Cashfree objects exist',
      'CHECK|migration_ledger|FAIL|offline missing ledger',
      'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    )
    break
  }
  'evidence-partial-migration36' {
    @(
      'CHECK|target_identity|PASS|offline mock',
      'CHECK|migration36_live_prerequisites|PASS|offline mock',
      'CHECK|payment_schema_and_permissions|PASS|offline mock',
      'CHECK|cashfree_objects_absent|PASS|offline mock',
      'CHECK|migration_ledger|FAIL|offline missing ledger',
      'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    )
    break
  }
  'evidence-schema-mismatch' {
    @(
      'CHECK|target_identity|PASS|offline mock',
      'CHECK|migration36_live_prerequisites|PASS|offline mock',
      'CHECK|payment_schema_and_permissions|PASS|offline mock',
      'CHECK|cashfree_objects_absent|PASS|offline mock',
      'CHECK|migration_ledger|FAIL|offline missing ledger',
      'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    )
    break
  }
  'post-evidence-success' {
    @(
      'CHECK|target_identity|PASS|offline mock',
      'CHECK|cashfree_tables_and_columns|PASS|offline mock',
      'CHECK|validated_constraints_and_foreign_keys|PASS|offline mock',
      'CHECK|indexes_valid|PASS|offline mock',
      'CHECK|rls_and_grants|PASS|offline mock',
      'CHECK|rpc_signatures_and_grants|PASS|offline mock',
      'CHECK|cashfree_readiness_and_disabled_default|PASS|offline mock',
      'CHECK|razorpay_history_preserved|PASS|offline mock',
      'CHECK|migration_ledger|FAIL|offline missing ledger',
      'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    )
    break
  }
  default {
    @(
  'CHECK|target_identity|PASS|offline mock',
  'CHECK|migration36_live_prerequisites|PASS|offline mock',
  'CHECK|payment_schema_and_permissions|PASS|offline mock',
  'CHECK|cashfree_objects_absent|PASS|offline mock',
  'CHECK|migration_ledger|PASS|offline mock',
  'MIGRATION_HISTORY|READABLE|offline fixture'
    )
  }
}
$diagnosticNames = @(
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
  'migration36_admin_foreign_keys'
)
foreach ($name in $diagnosticNames) {
  $status = 'PASS'
  if ($env:CASHFREE_MOCK_PSQL_MODE -eq 'evidence-schema-mismatch' -and
    $name -eq 'migration36_table_definitions') {
    $status = 'FAIL'
  }
  if ($env:CASHFREE_MOCK_PSQL_MODE -eq 'evidence-partial-migration36' -and
    $name -eq 'migration36_table_definitions') {
    $status = 'FAIL'
  }
  $rows += "CHECK|$name|$status|offline mock subcheck"
}
$rows += 'RAZORPAY_BASELINE|0|d41d8cd98f00b204e9800998ecf8427e'
if ($env:CASHFREE_MOCK_PSQL_MODE -eq 'evidence-schema-mismatch') {
  $rows += 'COLUMN_DIFF|admin_permanent_deletion_email_reservations|created_at|difference=MISMATCH|expected_type=timestamp with time zone|actual_type=timestamp with time zone|expected_not_null=true|actual_not_null=true|expected_default=now()|actual_default=<none>'
}
[System.IO.File]::WriteAllLines($outputFile, $rows)
$global:LASTEXITCODE = 0
'@
[System.IO.File]::WriteAllText($mockPsqlPath, $mockPsql, [System.Text.UTF8Encoding]::new($false))

function Invoke-MockedPreflight {
  param(
    [ValidateSet('empty', 'authentication', 'success', 'evidence-absent',
      'evidence-unexpected-ledger', 'evidence-partial-cashfree', 'evidence-schema-mismatch',
      'evidence-partial-migration36')][string]$Mode,
    [switch]$SchemaEvidenceOnly
  )

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $arguments = @(
      '-NoProfile',
      '-File', $preflightPath,
      '-ProjectRef', 'kdaixomygsuxadofoieb',
      '-PsqlPath', $mockPsqlPath
    )
  if ($SchemaEvidenceOnly) {
    $arguments += '-SchemaEvidenceOnly'
  }
  foreach ($argument in $arguments) {
    $startInfo.ArgumentList.Add($argument)
  }
  $startInfo.Environment['APPDATA'] = $appDataPath
  $startInfo.Environment['TEMP'] = $tempRoot
  $startInfo.Environment['CASHFREE_MOCK_PSQL_MODE'] = $Mode

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'Could not start the offline mocked preflight process.'
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.WriteLine('kdaixomygsuxadofoieb')
  $process.StandardInput.Close()
  $process.WaitForExit()
  [pscustomobject]@{
    ExitCode = $process.ExitCode
    Output = $stdoutTask.GetAwaiter().GetResult() + $stderrTask.GetAwaiter().GetResult()
  }
}

function Invoke-MockedPostVerifier {
  param([string]$Mode)

  $postPath = Join-Path $repoRoot 'scripts\verify-staging-cashfree-migration-post.ps1'
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in @(
      '-NoProfile',
      '-File', $postPath,
      '-ProjectRef', 'kdaixomygsuxadofoieb',
      '-ExpectedRazorpayOrderCount', '0',
      '-ExpectedRazorpayOrderFingerprint', 'd41d8cd98f00b204e9800998ecf8427e',
      '-PsqlPath', $mockPsqlPath,
      '-SchemaEvidenceOnly'
    )) {
    $startInfo.ArgumentList.Add($argument)
  }
  $startInfo.Environment['APPDATA'] = $appDataPath
  $startInfo.Environment['TEMP'] = $tempRoot
  $startInfo.Environment['CASHFREE_MOCK_PSQL_MODE'] = $Mode

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw 'Could not start the offline mocked post-verifier process.'
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.WriteLine('kdaixomygsuxadofoieb')
  $process.StandardInput.Close()
  $process.WaitForExit()
  [pscustomobject]@{
    ExitCode = $process.ExitCode
    Output = $stdoutTask.GetAwaiter().GetResult() + $stderrTask.GetAwaiter().GetResult()
  }
}

try {
  $entrypointEmpty = Invoke-MockedPreflight -Mode empty
  Assert-True ($entrypointEmpty.ExitCode -ne 0) 'The actual preflight entrypoint must fail on empty mocked psql output.'
  Assert-True ($entrypointEmpty.Output -match 'empty verification output') "The entrypoint must report a clear empty-output diagnostic. Output: $($entrypointEmpty.Output)"
  Assert-True ($entrypointEmpty.Output -notmatch 'Cannot bind argument to parameter .QueryOutput.') 'The original QueryOutput binding error must be gone.'
  Assert-True ($entrypointEmpty.Output -notmatch 'OVERALL: PASS') 'Empty output must never be treated as a successful preflight.'

  $entrypointAuthentication = Invoke-MockedPreflight -Mode authentication
  Assert-True ($entrypointAuthentication.ExitCode -ne 0) 'The actual preflight entrypoint must fail on authentication errors.'
  Assert-True ($entrypointAuthentication.Output -match 'database authentication failed') "Authentication failure must be clearly identified. Output: $($entrypointAuthentication.Output)"
  Assert-True ($entrypointAuthentication.Output -notmatch 'OVERALL: PASS|Cannot bind argument') 'Authentication failure must not pass or fall through to parameter binding.'

  $entrypointSuccess = Invoke-MockedPreflight -Mode success
  Assert-True ($entrypointSuccess.ExitCode -eq 0) "The actual preflight entrypoint should accept valid mocked output. Output: $($entrypointSuccess.Output)"
  Assert-True ($entrypointSuccess.Output -match 'PASS \| target_identity') "Successful output should be parsed into check rows. Output: $($entrypointSuccess.Output)"
  Assert-True ($entrypointSuccess.Output -match 'OVERALL: PASS') "All valid mocked checks should produce the expected preflight result. Output: $($entrypointSuccess.Output)"

  $evidenceAbsent = Invoke-MockedPreflight -Mode evidence-absent -SchemaEvidenceOnly
  Assert-True ($evidenceAbsent.ExitCode -eq 0) "Explicit evidence-only mode should accept a wholly absent ledger only when all live checks pass. Output: $($evidenceAbsent.Output)"
  Assert-True ($evidenceAbsent.Output -match 'SCHEMA EVIDENCE PASS.*UNVERIFIED') "Fallback output must distinguish schema evidence from migration history. Output: $($evidenceAbsent.Output)"
  Assert-True ($evidenceAbsent.Output -notmatch 'OVERALL: PASS') 'Evidence-only mode must never claim verified migration history.'

  $unexpectedLedger = Invoke-MockedPreflight -Mode evidence-unexpected-ledger -SchemaEvidenceOnly
  Assert-True ($unexpectedLedger.ExitCode -ne 0) 'Evidence-only mode must reject a readable but unexpected ledger.'
  Assert-True ($unexpectedLedger.Output -match 'only absent or empty history') 'Unexpected readable history must produce a fail-closed diagnostic.'

  $partialCashfree = Invoke-MockedPreflight -Mode evidence-partial-cashfree -SchemaEvidenceOnly
  Assert-True ($partialCashfree.ExitCode -ne 0) 'Evidence-only mode must reject partial Cashfree objects.'
  Assert-True ($partialCashfree.Output -match 'required live schema checks failed') 'Partial Cashfree state must be identified as a schema evidence failure.'

  $schemaMismatch = Invoke-MockedPreflight -Mode evidence-schema-mismatch -SchemaEvidenceOnly
  Assert-True ($schemaMismatch.ExitCode -ne 0) 'Evidence-only mode must reject a Migration 36 schema mismatch.'
  Assert-True ($schemaMismatch.Output -match 'COLUMN_DIFF\|admin_permanent_deletion_email_reservations\|created_at.*expected_default=now\(\).*actual_default=<none>') `
    'The Staging preflight must surface expected and actual metadata for the mismatching column.'

  $partialMigration36 = Invoke-MockedPreflight -Mode evidence-partial-migration36 -SchemaEvidenceOnly
  Assert-True ($partialMigration36.ExitCode -ne 0) 'Evidence-only mode must reject partial Migration 36 state.'
  Assert-True ($partialMigration36.Output -match 'migration36_table_definitions') `
    "Aggregated failure must name the failed Migration 36 subcheck. Output: $($partialMigration36.Output)"

  $postEvidence = Invoke-MockedPostVerifier -Mode post-evidence-success
  Assert-True ($postEvidence.ExitCode -eq 0) 'The actual post-verifier should pass in evidence-only mode with complete mocked schema checks.'
  Assert-True ($postEvidence.Output -match 'SCHEMA EVIDENCE PASS.*UNVERIFIED') "Post-verification must preserve the unverified-history warning. Output: $($postEvidence.Output)"
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}

Write-Output 'PASS: offline actual-entrypoint tests cover query failures, strict ledger mode, evidence-only eligibility, partial/mismatched schema, and post-verification.'
