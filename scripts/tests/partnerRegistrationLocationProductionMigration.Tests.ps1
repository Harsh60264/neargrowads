$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "FAIL: $Message" }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20261205120000_partner_registration_location_details.sql'
$runnerPath = Join-Path $repoRoot 'scripts\apply-production-partner-registration-location-migration.ps1'
$baselinePath = Join-Path $repoRoot 'scripts\capture-production-partner-registration-location-baseline.ps1'
$postVerifierPath = Join-Path $repoRoot 'scripts\verify-production-partner-registration-location-post-migration.ps1'
$expectedHash = 'C111CF62CE8439514C87EF214CBDD0F3757D5DBF48A649E0BA5B2110E33CE8F6'

Assert-True ((Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -ceq $expectedHash) `
  'The location migration must retain the exact approved SHA-256.'

foreach ($path in @($runnerPath, $baselinePath, $postVerifierPath)) {
  $tokens = $null
  $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  Assert-True ($errors.Count -eq 0) "Safety script must parse: $([System.IO.Path]::GetFileName($path))"
}

$runnerText = Get-Content -LiteralPath $runnerPath -Raw
$baselineText = Get-Content -LiteralPath $baselinePath -Raw
$postText = Get-Content -LiteralPath $postVerifierPath -Raw
Assert-True ($runnerText.Contains($expectedHash) -and
  $runnerText.Contains('APPROVE SCHEMA-ONLY HISTORY FALLBACK FOR $migrationVersion ON PRODUCTION $expectedProjectRef') -and
  $runnerText.Contains('APPLY MIGRATION $migrationVersion SHA256=$migrationHash TO PRODUCTION $expectedProjectRef') -and
  $runnerText.Contains("'--single-transaction'") -and
  $runnerText.Contains("SET LOCAL lock_timeout = '5s'") -and
  $runnerText.Contains("SET LOCAL statement_timeout = '300s'") -and
  $runnerText.Contains('IN SHARE ROW EXCLUSIVE MODE')) `
  'Apply must be hash-pinned, separately authorized, transactional, bounded by timeouts, and lock protected.'
Assert-True ($runnerText.Contains('Do not retry') -and
  $runnerText.Contains('READ_ONLY_REVALIDATION_MISMATCH') -and
  $runnerText.Contains('PRESERVATION_MISMATCH:%') -and
  $runnerText.Contains('SCHEMA_BASELINE_MISMATCH:%') -and
  $runnerText.Contains('POSTSTATE_MISMATCH:[A-Z0-9_]+')) `
  'Apply must fail closed with identifiable preflight and preservation diagnostics.'
Assert-True ($runnerText.Contains('$captureText -match') -and
  $runnerText.Contains('child exit code $captureExitCode; success marker $capturePassed') -and
  -not $runnerText.Contains('@($captureOutput | ForEach-Object { [string]$_ }) -notmatch')) `
  'Baseline child output detection must use a scalar marker check and report safe failure diagnostics.'
Assert-True ($baselineText.Contains('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;') -and
  $baselineText.Contains('ROLLBACK;') -and
  $baselineText.Contains('migrationObjectsAbsent') -and
  $baselineText.Contains("'state'") -and $baselineText.Contains("'preferred_delivery_areas'") -and
  $baselineText.Contains('candidateRelations')) `
  'Baseline must capture dependencies, absent location objects, and unresolved history using read-only SQL.'
Assert-True ($postText.Contains('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;') -and
  $postText.Contains('ROLLBACK;') -and
  $postText.Contains('profileListSecurity') -and
  $postText.Contains('partner_profiles_registration_location_check') -and
  $postText.Contains('partner_profiles_current_location_check') -and
  $postText.Contains('select p\.\*,\s*u\.email as authenticated_email') -and
  $postText.Contains('to_jsonb\(r\)') -and
  $postText.Contains('PRESERVATION_MISMATCH') -eq $false -and
  $postText.Contains('Production data-preservation fingerprint mismatch')) `
  'Independent verifier must be read-only and validate function security plus data preservation.'

Write-Output 'Partner registration location Production migration guard tests passed.'
