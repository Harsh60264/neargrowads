$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "FAIL: $Message" }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$diagnosticPath = Join-Path $repoRoot 'scripts\diagnose-production-cashfree-migration38.ps1'
$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
  $diagnosticPath, [ref]$tokens, [ref]$parseErrors
)
Assert-True ($parseErrors.Count -eq 0) "Diagnostic script must parse: $($parseErrors -join '; ')"

$diagnosticText = Get-Content -LiteralPath $diagnosticPath -Raw
foreach ($required in @(
  'axbjzmdokfoftzfgwiql',
  'aws-0-ap-northeast-2.pooler.supabase.com',
  'BEGIN TRANSACTION READ ONLY;',
  "'--password'",
  "'--set','ON_ERROR_STOP=1'",
  'Enter-StagingPsqlEnvironment',
  'cashfree_production_enabled',
  'service_orders_provider_mode_check',
  'cashfree_checkout_intents_checkout_mode_check',
  'cashfree_production_verified_by',
  'claim_cashfree_checkout_intent_for_mode',
  'complete_cashfree_checkout_intent_for_mode',
  'process_cashfree_webhook_event_for_mode',
  'set_cashfree_production_gateway',
  'cashfree_production_gateway_readiness',
  'SECURITY DEFINER',
  'search_path=pg_catalog, public'
)) {
  Assert-True ($diagnosticText.Contains($required)) "Diagnostic must cover $required."
}
Assert-True ($diagnosticText -notmatch '(?im)^\s*(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+|ALTER\s+|DROP\s+|TRUNCATE\s+)') `
  'Diagnostic SQL must not include database writes.'
$normalizedDiagnosticSql = $diagnosticText -replace '\s+', ' '
Assert-True ($normalizedDiagnosticSql.Contains(
  "definition NOT LIKE '%provider_mode = ANY (ARRAY[''test''::text, ''live''::text])%'"
)) 'The provider-mode diagnostic must validate the exact PostgreSQL-deparsed test/live allowed array.'

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cashfree-m38-diagnostic-test-" + [guid]::NewGuid().ToString('N'))
$appDataPath = Join-Path $tempRoot 'appdata'
$postgresDirectory = Join-Path $appDataPath 'postgresql'
$mockPsqlPath = Join-Path $tempRoot 'mock-psql.ps1'
New-Item -ItemType Directory -Path $postgresDirectory -Force | Out-Null
[System.IO.File]::WriteAllText(
  (Join-Path $postgresDirectory 'root.crt'),
  'offline placeholder; mocked psql never connects',
  [System.Text.UTF8Encoding]::new($false)
)

$mockPsql = @'
if ($args[0] -eq '--version') {
  Write-Output 'psql (PostgreSQL) 18.0'
  $global:LASTEXITCODE = 0
  return
}
if ($env:PGSSLMODE -cne 'verify-full' -or
  -not (Test-Path -LiteralPath $env:PGSSLROOTCERT -PathType Leaf)) {
  [Console]::Error.WriteLine('ERROR: TLS verify-full environment not configured')
  $global:LASTEXITCODE = 9
  return
}
if ([Array]::IndexOf($args, '--password') -lt 0 -or
  [Array]::IndexOf($args, '--no-psqlrc') -lt 0 -or
  [Array]::IndexOf($args, 'ON_ERROR_STOP=1') -lt 0) {
  [Console]::Error.WriteLine('ERROR: required psql safeguards missing')
  $global:LASTEXITCODE = 10
  return
}
$fileIndex = [Array]::IndexOf($args, '--file')
$outputIndex = [Array]::IndexOf($args, '--output')
if ($fileIndex -lt 0 -or $outputIndex -lt 0) {
  [Console]::Error.WriteLine('ERROR: expected psql file and output arguments')
  $global:LASTEXITCODE = 11
  return
}
$sql = [System.IO.File]::ReadAllText($args[$fileIndex + 1])
if ($sql -notmatch 'BEGIN TRANSACTION READ ONLY;' -or $sql -notmatch 'COMMIT;' -or
  $sql -notmatch 'pg_constraint' -or $sql -notmatch 'pg_proc' -or
  $sql -notmatch 'information_schema\.columns') {
  [Console]::Error.WriteLine('ERROR: catalog-only read-only SQL missing')
  $global:LASTEXITCODE = 12
  return
}
$rows = @(
  'RESULT|target|production_identity|PASS|pinned database, role, primary and Auth schema',
  'RESULT|column|service_store_payment_settings.cashfree_production_enabled|PASS|expected column',
  'RESULT|column|service_store_payment_settings.cashfree_production_verified_at|PASS|expected column',
  'RESULT|column|service_store_payment_settings.cashfree_production_verified_by|PASS|expected column',
  'RESULT|column|cashfree_checkout_intents.checkout_mode|PASS|expected column',
  'RESULT|column_set|service_store_payment_settings.cashfree_production_*|PASS|exact set',
  'RESULT|column_set|cashfree_checkout_intents.checkout_mode|PASS|exact set',
  'RESULT|constraint|service_orders_provider_mode_check|PASS|validated',
  'RESULT|constraint|cashfree_checkout_intents_checkout_mode_check|PASS|validated',
  'RESULT|foreign_key|cashfree_production_verified_by|PASS|validated',
  'RESULT|function|claim_cashfree_checkout_intent_for_mode|PASS|secure',
  'RESULT|function|complete_cashfree_checkout_intent_for_mode|PASS|secure',
  'RESULT|function|process_cashfree_webhook_event_for_mode|PASS|secure',
  'RESULT|function|set_cashfree_production_gateway|PASS|secure',
  'RESULT|function|cashfree_production_gateway_readiness|PASS|secure'
)
if ($env:CASHFREE_M38_DIAGNOSTIC_MODE -eq 'mismatch') {
  $rows[1] = 'RESULT|column|service_store_payment_settings.cashfree_production_enabled|MISSING|expected column absent'
  $rows[7] = 'RESULT|constraint|service_orders_provider_mode_check|MISMATCH|not validated'
}
$rows = @('BEGIN','') + $rows + @('COMMIT','')
if ($env:CASHFREE_M38_DIAGNOSTIC_MODE -eq 'unexpected-status') {
  $rows += 'UPDATE 0'
}
[System.IO.File]::WriteAllLines($args[$outputIndex + 1], $rows)
$global:LASTEXITCODE = 0
'@
[System.IO.File]::WriteAllText($mockPsqlPath, $mockPsql, [System.Text.UTF8Encoding]::new($false))

function Invoke-MockedDiagnostic {
  param([string]$Mode = 'complete', [string]$Confirmation = 'axbjzmdokfoftzfgwiql')

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in @(
    '-NoProfile','-File',$diagnosticPath,
    '-ProjectRef','axbjzmdokfoftzfgwiql',
    '-PsqlPath',$mockPsqlPath
  )) {
    $startInfo.ArgumentList.Add($argument)
  }
  $startInfo.Environment['APPDATA'] = $appDataPath
  $startInfo.Environment['TEMP'] = $tempRoot
  $startInfo.Environment['CASHFREE_M38_DIAGNOSTIC_MODE'] = $Mode
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start mocked diagnostic.' }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  $process.StandardInput.WriteLine($Confirmation)
  $process.StandardInput.Close()
  $process.WaitForExit()
  [pscustomobject]@{
    ExitCode = $process.ExitCode
    Output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
  }
}

try {
  $success = Invoke-MockedDiagnostic
  Assert-True ($success.ExitCode -eq 0) "Complete catalog fixture should pass. $($success.Output)"
  Assert-True ($success.Output -match 'DIAGNOSTIC: ALL EXPECTED MIGRATION 38 METADATA CHECKS PASS') `
    'Complete schema must report a deterministic all-pass summary.'
  Assert-True ($success.Output -notmatch 'malformed or unexpected result row') `
    'Known psql BEGIN/COMMIT status lines and blank lines must not be treated as malformed metadata.'

  $mismatch = Invoke-MockedDiagnostic -Mode mismatch
  Assert-True ($mismatch.ExitCode -ne 0) 'Missing or mismatched metadata must fail the diagnostic.'
  Assert-True ($mismatch.Output -match 'MISSING \| column \| service_store_payment_settings\.cashfree_production_enabled') `
    'Missing columns must be clearly identified.'
  Assert-True ($mismatch.Output -match 'MISMATCH \| constraint \| service_orders_provider_mode_check') `
    'Mismatched constraints must be clearly identified.'
  Assert-True ($mismatch.Output -match 'DIAGNOSTIC: MISMATCH FOUND') `
    'A failed diagnostic must report a deterministic failure summary.'

  $unexpectedStatus = Invoke-MockedDiagnostic -Mode unexpected-status
  Assert-True ($unexpectedStatus.ExitCode -ne 0 -and
    $unexpectedStatus.Output -match 'malformed or unexpected result row') `
    'Unknown command/status output must remain a fail-closed output error.'

  $wrongConfirmation = Invoke-MockedDiagnostic -Confirmation 'wrong-project'
  Assert-True ($wrongConfirmation.ExitCode -ne 0 -and
    $wrongConfirmation.Output -match 'confirmation did not match') `
    'A mismatched typed Production ref must abort the diagnostic.'

  Write-Output 'PASS: offline Production Migration 38 metadata diagnostic tests cover pinned target, TLS/read-only/prompt safeguards, complete catalog output, missing/mismatched schema, and confirmation failure.'
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
