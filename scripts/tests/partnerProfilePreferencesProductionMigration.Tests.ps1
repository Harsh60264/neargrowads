$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw "FAIL: $Message"
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runnerPath = Join-Path $repoRoot 'scripts\apply-production-partner-profile-preferences-migration.ps1'
$tokens = $null
$parseErrors = $null
$runnerAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $runnerPath, [ref]$tokens, [ref]$parseErrors
)
Assert-True ($parseErrors.Count -eq 0) 'The guarded migration runner must parse as PowerShell.'

$runnerText = Get-Content -LiteralPath $runnerPath -Raw
$snapshotMatch = [regex]::Match($runnerText, '(?s)\$dataSnapshotSql\s*=\s*@''\r?\n(.*?)\r?\n''@')
Assert-True $snapshotMatch.Success 'The preservation snapshot SQL must remain extractable.'
$snapshotSql = $snapshotMatch.Groups[1].Value
Assert-True ($snapshotSql -notmatch ';\s*$') `
  'Snapshot SQL embedded as a subquery must not end with a statement terminator.'
Assert-True ($runnerText.Contains('FROM ($dataSnapshotSql) snapshots')) `
  'The preservation guard must execute the snapshot as a read-only subquery.'
Assert-True ($runnerText.Contains('PRESERVATION_MISMATCH:%') -and
  $runnerText.Contains('SCHEMA_BASELINE_MISMATCH:%') -and
  $runnerText.Contains('PRESTATE_MISMATCH:')) `
  'Production preflight failures must identify the failing guard without exposing row values.'
Assert-True ($runnerText.Contains("'--set', 'SHOW_CONTEXT=always'") -and
  $runnerText.Contains("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;")) `
  'Read-only verification must retain explicit read-only transaction and SQL error context.'

$diagnosticAst = $runnerAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-SafePsqlFailureSummary'
}, $true)
Assert-True ($null -ne $diagnosticAst) 'The runner must define a sanitized PostgreSQL diagnostic formatter.'
. ([scriptblock]::Create($diagnosticAst.Extent.Text))

$guardDiagnostic = Get-SafePsqlFailureSummary -ExitCode 3 -Diagnostics @(
  'psql:C:\temp\verification.sql:87: ERROR:  P0001: PRESERVATION_MISMATCH:partner_proofs',
  'DETAIL: token=private-example-value'
)
Assert-True ($guardDiagnostic -match 'SQLSTATE P0001' -and
  $guardDiagnostic -match 'SQL input line 87' -and
  $guardDiagnostic -match 'PRESERVATION_MISMATCH:partner_proofs' -and
  $guardDiagnostic -notmatch 'private-example-value') `
  'Guard diagnostics must identify the failed data set and line while withholding details.'

$syntaxDiagnostic = Get-SafePsqlFailureSummary -ExitCode 3 -Diagnostics @(
  'psql:C:\temp\verification.sql:91: ERROR:  42601: syntax error at or near ";"'
)
Assert-True ($syntaxDiagnostic -match 'SQLSTATE 42601' -and
  $syntaxDiagnostic -match 'SQL input line 91' -and
  $syntaxDiagnostic -match 'syntax error at or near ";"') `
  'SQL syntax errors must report a sanitized actionable message.'

$unknownDiagnostic = Get-SafePsqlFailureSummary -ExitCode 3 -Diagnostics @(
  'psql:C:\temp\verification.sql:92: ERROR:  XX000: private-example-value'
)
Assert-True ($unknownDiagnostic -match 'unclassified error' -and
  $unknownDiagnostic -notmatch 'private-example-value') `
  'Unclassified PostgreSQL errors must not expose raw database text.'

$promptDiagnostic = Get-SafePsqlFailureSummary -ExitCode 2 -Diagnostics @(
  'Password for user postgres.axbjzmdokfoftzfgwiql:'
)
Assert-True ($promptDiagnostic -match 'no PostgreSQL ERROR/FATAL line' -and
  $promptDiagnostic -notmatch 'Password for user') `
  'Authentication prompts must not be surfaced in diagnostics.'

Write-Output 'Partner profile preferences migration guard tests passed.'
