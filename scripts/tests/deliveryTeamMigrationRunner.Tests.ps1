$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw "FAIL: $Message"
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20261127120000_admin_delivery_team_management.sql'
$applyPath = Join-Path $repoRoot 'scripts\apply-production-delivery-team-migration.ps1'
$verifyPath = Join-Path $repoRoot 'scripts\verify-production-delivery-team-post-migration.ps1'
$diagnosePath = Join-Path $repoRoot 'scripts\diagnose-production-delivery-team-state.ps1'
$expectedHash = 'F0A5EDD1A70DB9C13A5C6BCECEDCF70B6468B4A2CD90438B619DCFA181E775DF'

foreach ($path in @($applyPath, $verifyPath, $diagnosePath)) {
  $tokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
  Assert-True ($parseErrors.Length -eq 0) "PowerShell script must parse: $path"
}

$migration = Get-Content -LiteralPath $migrationPath -Raw
$apply = Get-Content -LiteralPath $applyPath -Raw
$verify = Get-Content -LiteralPath $verifyPath -Raw
$diagnose = Get-Content -LiteralPath $diagnosePath -Raw
$applyTokens = $null
$applyParseErrors = $null
$applyAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $applyPath, [ref]$applyTokens, [ref]$applyParseErrors
)
$resultParserAst = $applyAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-ValidatedPreflightResults'
}, $true)
Assert-True ($null -ne $resultParserAst) 'The runner must define a strict preflight output parser.'
. ([scriptblock]::Create($resultParserAst.Extent.Text))
$migrationDiagnosticAst = $applyAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-SafeMigrationPsqlFailureSummary'
}, $true)
Assert-True ($null -ne $migrationDiagnosticAst) 'The migration runner must define a sanitized PostgreSQL failure formatter.'
. ([scriptblock]::Create($migrationDiagnosticAst.Extent.Text))
$verifyTokens = $null
$verifyParseErrors = $null
$verifyAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $verifyPath, [ref]$verifyTokens, [ref]$verifyParseErrors
)
$schemaParserAst = $verifyAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-ValidatedSchemaResults'
}, $true)
Assert-True ($null -ne $schemaParserAst) 'The independent post-verifier must define a strict schema output parser.'
. ([scriptblock]::Create($schemaParserAst.Extent.Text))
$diagnosticParserAst = $verifyAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-SafePsqlFailureSummary'
}, $true)
Assert-True ($null -ne $diagnosticParserAst) 'The independent post-verifier must define a safe PostgreSQL diagnostic formatter.'
. ([scriptblock]::Create($diagnosticParserAst.Extent.Text))

$diagnoseTokens = $null
$diagnoseParseErrors = $null
$diagnoseAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $diagnosePath, [ref]$diagnoseTokens, [ref]$diagnoseParseErrors
)
$withdrawalComparisonAst = $diagnoseAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-WithdrawalFunctionComparison'
}, $true)
Assert-True ($null -ne $withdrawalComparisonAst) 'The catalog diagnostic must compare the withdrawal function to baseline and migration contracts.'
. ([scriptblock]::Create($withdrawalComparisonAst.Extent.Text))
$catalogParserAst = $diagnoseAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-ValidatedCatalogReport'
}, $true)
Assert-True ($null -ne $catalogParserAst) 'The catalog diagnostic must strictly parse one JSON payload after command tags.'
. ([scriptblock]::Create($catalogParserAst.Extent.Text))
$catalogErrorAst = $diagnoseAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-SafeCatalogPsqlFailureSummary'
}, $true)
Assert-True ($null -ne $catalogErrorAst) 'The catalog diagnostic must safely format PostgreSQL errors.'
. ([scriptblock]::Create($catalogErrorAst.Extent.Text))
$classificationAst = $diagnoseAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Get-DeliveryTeamMigrationClassification'
}, $true)
Assert-True ($null -ne $classificationAst) 'The diagnostic must isolate deterministic FULL/ABSENT/INCONSISTENT state classification.'
. ([scriptblock]::Create($classificationAst.Extent.Text))

$safeDiagnostic = Get-SafePsqlFailureSummary -ExitCode 3 -Diagnostics @(
  'psql:C:\temp\verification.sql:87: ERROR:  42P01: relation "public.delivery_team_settings" does not exist',
  'LOCATION:  parserOpenTable, parse_relation.c:1394'
)
Assert-True ($safeDiagnostic -match 'SQLSTATE 42P01' -and
  $safeDiagnostic -match 'SQL input line 87' -and
  $safeDiagnostic -match 'delivery_team_settings') `
  'A PostgreSQL failure must expose its SQLSTATE, psql input line, and actionable error message.'

$redactedDiagnostic = Get-SafePsqlFailureSummary -ExitCode 3 -Diagnostics @(
  'psql:C:\temp\verification.sql:9: ERROR:  28P01: authentication failed password=example-secret-token'
)
Assert-True ($redactedDiagnostic -match 'SQLSTATE 28P01' -and
  $redactedDiagnostic -notmatch 'example-secret-token' -and
  $redactedDiagnostic -match 'credentials were omitted') `
  'PostgreSQL diagnostics must redact credential-like values and never emit raw stderr.'

$unstructuredDiagnostic = Get-SafePsqlFailureSummary -ExitCode 3 -Diagnostics @(
  'Password for user postgres.axbjzmdokfoftzfgwiql:'
)
Assert-True ($unstructuredDiagnostic -match 'no PostgreSQL ERROR/FATAL line' -and
  $unstructuredDiagnostic -notmatch 'Password for user') `
  'Password prompts must not be surfaced when psql exits without a PostgreSQL error line.'

$migrationDiagnostic = Get-SafeMigrationPsqlFailureSummary -ExitCode 3 -Diagnostics @(
  'psql:C:\temp\migration.sql:144: ERROR:  23514: new row violates check constraint "partner_coin_ledger_admin_balance_check"',
  'DETAIL: token=private-example-value'
)
Assert-True ($migrationDiagnostic -match 'SQLSTATE 23514' -and
  $migrationDiagnostic -match 'SQL input line 144' -and
  $migrationDiagnostic -match 'partner_coin_ledger_admin_balance_check' -and
  $migrationDiagnostic -notmatch 'private-example-value') `
  'Migration psql failures must expose sanitized SQLSTATE and line diagnostics without raw stderr.'

$catalogJson = '{"projectRef":"axbjzmdokfoftzfgwiql","databaseName":"postgres","databaseUser":"postgres","checks":{"target":true,"delivery_team_tables":true,"audit_columns":true,"private_rls_and_grants":true,"private_policies":true,"settings_singleton":true,"private_proofs_bucket":true,"activity_indexes":true,"expected_coin_and_stock_constraints":true,"unique_idempotency_indexes":true,"privileged_rpcs":true,"migration_history_absent":true},"migrationSpecificObjectCount":0,"withdrawalFunction":null,"coinLedgerConstraints":[]}'
$catalogReport = Get-ValidatedCatalogReport -Output @(
  'BEGIN', 'SET', $catalogJson, 'COMMIT', 'ROLLBACK'
)
Assert-True ($catalogReport.projectRef -ceq 'axbjzmdokfoftzfgwiql' -and
  $catalogReport.checks.target -eq $true -and
  $catalogReport.migrationSpecificObjectCount -eq 0) `
  'BEGIN, SET, COMMIT, and ROLLBACK command tags must be removed before strict catalog JSON parsing.'

$malformedJsonRejected = $false
try {
  [void](Get-ValidatedCatalogReport -Output @('BEGIN', '{"projectRef":', 'ROLLBACK'))
} catch {
  $malformedJsonRejected = $_.Exception.Message -like '*malformed or non-object JSON*'
}
Assert-True $malformedJsonRejected 'Malformed catalog JSON must fail closed without accepting partial evidence.'

$nullConstraintArrayJson = $catalogJson.Replace('"coinLedgerConstraints":[]', '"coinLedgerConstraints":null')
$nullConstraintArrayRejected = $false
try {
  [void](Get-ValidatedCatalogReport -Output @($nullConstraintArrayJson))
} catch {
  $nullConstraintArrayRejected = $_.Exception.Message -like '*malformed or non-object JSON*'
}
Assert-True $nullConstraintArrayRejected 'A null constraint collection must not be accepted as an empty or scalar array.'

$catalogErrorOutputRejected = $false
try {
  [void](Get-ValidatedCatalogReport -Output @(
    'psql:C:\temp\diagnose.sql:42: ERROR:  42P01: relation "public.delivery_team_settings" does not exist'
  ))
} catch {
  $catalogErrorOutputRejected = $_.Exception.Message -notmatch 'delivery_team_settings|42P01'
}
Assert-True $catalogErrorOutputRejected 'A PostgreSQL error line must fail closed without being accepted or echoed as JSON.'

$catalogErrorSummary = Get-SafeCatalogPsqlFailureSummary -ExitCode 3 -Diagnostics @(
  'psql:C:\temp\diagnose.sql:42: ERROR:  42P01: relation "public.delivery_team_settings" does not exist',
  'DETAIL: token=private-example-value'
)
Assert-True ($catalogErrorSummary -match 'SQLSTATE 42P01' -and
  $catalogErrorSummary -match 'SQL input line 42' -and
  $catalogErrorSummary -notmatch 'private-example-value') `
  'Read-only diagnostic PostgreSQL errors must retain SQLSTATE/location while redacting sensitive values.'

$expectedCheckLines = @(
  'production target|PASS',
  'required WildCard tables and storage|PASS',
  'required Supabase roles and UUID generator|PASS',
  'private proof bucket|PASS',
  'migration history remains absent|PASS',
  'no prior Delivery Team migration objects|PASS',
  'existing coin ledger data satisfies new constraints|PASS',
  'coin and stock balances are not negative|PASS',
  'base withdrawal function exists|PASS'
)
$postgresOutput = @(
  'BEGIN',
  'SET',
  'SET',
  'DO',
  'CREATE TABLE',
  'INSERT 0 1',
  'ALTER TABLE',
  'CREATE FUNCTION',
  'CREATE POLICY',
  'GRANT',
  'REVOKE'
) + $expectedCheckLines + @('COMMIT', 'ROLLBACK')
$parsedChecks = @(Get-ValidatedPreflightResults -PsqlExitCode 0 -Output $postgresOutput)
$nonPassParsedChecks = @($parsedChecks | Where-Object { $_ -notmatch '^[^|]+\|PASS$' })
Assert-True ($parsedChecks.Length -eq 9 -and
  $nonPassParsedChecks.Length -eq 0) `
  'BEGIN, COMMIT, SET, and other PostgreSQL command tags must not be mistaken for verification rows.'

$nonzeroExitRejected = $false
try {
  [void](Get-ValidatedPreflightResults -PsqlExitCode 1 -Output $postgresOutput)
} catch {
  $nonzeroExitRejected = $_.Exception.Message -like '*exit code 1*'
}
Assert-True $nonzeroExitRejected 'A nonzero psql exit code must fail preflight even when output rows look successful.'

$failedCheckRejected = $false
try {
  $failedChecks = @($expectedCheckLines)
  $failedChecks[0] = 'production target|FAIL'
  [void](Get-ValidatedPreflightResults -PsqlExitCode 0 -Output $failedChecks)
} catch {
  $failedCheckRejected = $_.Exception.Message -like '*production target*'
}
Assert-True $failedCheckRejected 'A SQL verification failure must not be discarded with PostgreSQL command tags.'

$unexpectedOutputRejected = $false
try {
  [void](Get-ValidatedPreflightResults -PsqlExitCode 0 -Output (@($expectedCheckLines) + 'WARNING: unexpected output'))
} catch {
  $unexpectedOutputRejected = $_.Exception.Message -like '*unexpected psql output*'
}
Assert-True $unexpectedOutputRejected 'Unknown psql output must fail closed instead of being ignored.'

$missingCheckRejected = $false
try {
  [void](Get-ValidatedPreflightResults -PsqlExitCode 0 -Output $expectedCheckLines[1..8])
} catch {
  $missingCheckRejected = $_.Exception.Message -like '*omitted required checks*'
}
Assert-True $missingCheckRejected 'Every expected read-only preflight check must be present.'

$expectedSchemaLines = @(
  'production target|PASS',
  'base WildCard tables|PASS',
  'delivery team RLS and grants|PASS',
  'private table policies|PASS',
  'settings row and threshold|PASS',
  'admin ledger columns|PASS',
  'stock and damage audit columns|PASS',
  'ledger and stock constraints|PASS',
  'unique idempotency indexes|PASS',
  'privileged functions|PASS',
  'migration history remains unverified|PASS',
  'partner proofs bucket remains private|PASS'
)
$parsedSchema = @(Get-ValidatedSchemaResults -PsqlExitCode 0 -Output (@('BEGIN', 'SET', 'ROLLBACK') + $expectedSchemaLines))
Assert-True ($parsedSchema.Length -eq 12) `
  'The independent post-verifier must accept PostgreSQL transaction and SET command tags while requiring all schema checks.'

$postVerifierFailureRejected = $false
try {
  [void](Get-ValidatedSchemaResults -PsqlExitCode 3 -Output $expectedSchemaLines)
} catch {
  $postVerifierFailureRejected = $_.Exception.Message -like '*exit code 3*'
}
Assert-True $postVerifierFailureRejected 'The post-verifier must preserve nonzero psql exit failures.'

Assert-True ((Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -ceq $expectedHash) `
  'The Delivery Team migration hash must remain pinned.'
Assert-True ($apply.Contains($expectedHash) -and $apply.Contains('20261127120000_admin_delivery_team_management.sql')) `
  'The production runner must pin the exact additive migration and its digest.'
Assert-True ($apply.Contains('[switch]$Apply') -and
  $apply.Contains('[switch]$AcknowledgeUnrestoredBackup') -and
  $apply.Contains('available only with -Apply')) `
  'Production execution must be explicit and failed-restore acknowledgement must require apply mode.'
Assert-True ($apply.Contains('verify-production-partner-backup-evidence.ps1') -and
  $apply.Contains('-ArchiveOnly') -and
  $apply.Contains('I ACKNOWLEDGE RESTORE DRILL FAILED AND APPROVE MIGRATION-SPECIFIC RECOVERY FOR 20261127120000') -and
  ($apply.Contains('Storage object bytes and Supabase project configuration') -or
    $apply.Contains('Storage payload and Supabase project configuration exclusions'))) `
  'The runner must independently verify a recent archive and require migration-specific failed-restore acknowledgement.'
Assert-True ($apply.Contains('Identify the reachable authorized Supabase recovery/on-call route') -and
  $apply.Contains('BACKUP LIMITATIONS ACKNOWLEDGED FOR') -and
  $apply.Contains('Full restoreability is UNVERIFIED') -and
  $apply.Contains('APPLY MIGRATION 20261127120000 SHA256=') -and
  $apply.Contains('Type the exact Production project ref shown above to authorize the pinned target')) `
  'Execution must require a reachable recovery route, explicit risk acknowledgements, target confirmation, and exact migration approval.'
Assert-True ($apply.Contains("'--single-transaction'") -and
  $apply.Contains("'--set', 'ON_ERROR_STOP=1'") -and
  $apply.Contains("'--password'") -and
  $apply.Contains("'--set', 'VERBOSITY=verbose'") -and
  $apply.Contains("'--set', 'SHOW_CONTEXT=always'") -and
  $apply.Contains('Get-SafeMigrationPsqlFailureSummary')) `
  'Production SQL must be prompted, fail-fast, and applied in one transaction.'
Assert-True ($apply.Contains('APPLY MIGRATION 20261127120000 SHA256=') -and
  $apply.Contains('Do not retry') -and
  $apply.Contains('verify-production-delivery-team-post-migration.ps1')) `
  'The runner must require exact authorization and independently verify uncertain or completed commits.'
Assert-True ($apply.Contains("SET lock_timeout = '5s';") -and
  $apply.Contains("SET statement_timeout = '300s';") -and
  $apply.Contains('current_setting(''transaction_read_only'') <> ''off''') -and
  $apply.Contains('prestate_guard')) `
  'The write path must preserve bounded lock/statement waits and its atomic production-state guard.'
Assert-True ($apply.Contains('BEGIN TRANSACTION READ ONLY;') -and
  $apply.Contains('ROLLBACK;') -and
  $apply.Contains('migration history remains absent') -and
  $apply.Contains('$LASTEXITCODE') -and
  $apply.Contains('Get-ValidatedPreflightResults')) `
  'The preflight must be read-only and preserve migration history as unverified.'
Assert-True ($apply -notmatch '(?i)\bvercel\s+deploy\b') `
  'The migration runner must not deploy the application.'
Assert-True ($migration -notmatch '(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;') `
  'The migration file must not introduce nested transaction boundaries.'
Assert-True ($migration -notmatch '(?im)^\s*(?:INSERT\s+INTO|CREATE\s+SCHEMA)\s+supabase_migrations') `
  'The migration must not create or alter migration history.'
Assert-True ($verify.Contains('BEGIN TRANSACTION READ ONLY;') -and
  $verify.Contains('ROLLBACK;') -and
  $verify.Contains('DELIVERY TEAM SCHEMA EVIDENCE PASS - migration history remains UNVERIFIED.')) `
  'The independent post-verifier must be read-only and label migration history UNVERIFIED.'
Assert-True ($verify.Contains('has_function_privilege') -and
  $verify.Contains('delivery_team_activity_no_direct_access') -and
  $verify.Contains('partner_coin_ledger_idempotency_unique') -and
  $verify.Contains('partner-proofs') -and
  $verify.Contains('Get-ValidatedSchemaResults')) `
  'Post-verification must check function authorization, RLS, idempotency and the private proof bucket.'
Assert-True ($verify.Contains("'VERBOSITY=verbose'") -and
  $verify.Contains("'SHOW_CONTEXT=always'") -and
  $verify.Contains('Get-SafePsqlFailureSummary')) `
  'Post-verification must request SQLSTATE/context and report only sanitized PostgreSQL diagnostics.'
Assert-True ($diagnose.Contains('BEGIN TRANSACTION READ ONLY;') -and
  $diagnose.Contains('ROLLBACK;') -and
  $diagnose.Contains('pg_constraint') -and
  $diagnose.Contains('pg_proc') -and
  $diagnose.Contains('pg_policy') -and
  $diagnose.Contains('MIGRATION_STATE|$migrationState')) `
  'The independent diagnostic must classify migration state using read-only PostgreSQL catalogs.'
Assert-True ($diagnose -notmatch '(?im)^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\s+') `
  'The catalog diagnostic must not contain a Production data/schema write.'
Assert-True ($diagnose.Contains('delivery-team-pre-migration-baseline.json') -and
  $diagnose.Contains('withdrawalFunctionDefinition') -and
  $diagnose.Contains('coinLedgerConstraints') -and
  $diagnose.Contains('verify-production-delivery-team-post-migration.ps1') -and
  $diagnose.Contains("'--quiet'") -and
  $diagnose.Contains('Get-ValidatedCatalogReport')) `
  'The diagnostic must compare preserved withdrawal/constraint evidence and invoke independent verification only for a complete schema.'

$migrationBodyMatch = [regex]::Match(
  $migration,
  '(?is)create or replace function public\.request_partner_withdrawal\(.*?\bas\s+\$\$(.*?)\$\$;'
)
$normalizeFunctionBody = {
  param([string]$Value)
  return (($Value -replace "`r`n", ' ') -replace '\s+', ' ').Trim().ToLowerInvariant()
}
$migrationFunctionBody = if ($migrationBodyMatch.Success) {
  & $normalizeFunctionBody $migrationBodyMatch.Groups[1].Value
} else {
  ''
}
$migrationBalanceMatch = [regex]::Match(
  $migrationFunctionBody,
  'available_coins := public\.delivery_team_available_coins\(p_partner_profile_id\);'
)
$baselineBalanceCalculation = "select coalesce(sum(amount), 0) into available_coins from public.partner_coin_ledger where partner_profile_id = p_partner_profile_id and ((entry_type = 'earning' and status = 'approved') or (entry_type = 'withdrawal' and status in ('requested', 'settled')));"
Assert-True ($migrationBalanceMatch.Success -and
  $migrationFunctionBody -match 'p_amount < 100000' -and
  $migrationFunctionBody -match 'for update' -and
  $migrationFunctionBody -match 'partner_withdrawal_requests') `
  'The migration withdrawal function must retain row locking, the 100000 threshold, and withdrawal request creation.'
$baselineFunctionBody = $migrationFunctionBody.Replace(
  $migrationBalanceMatch.Value, $baselineBalanceCalculation
)
$testBaseline = [pscustomobject]@{
  projectRef = 'axbjzmdokfoftzfgwiql'
  databaseName = 'postgres'
  coinLedgerConstraintCount = 2
  withdrawalFunctionDefinition = 'CREATE OR REPLACE FUNCTION public.request_partner_withdrawal(uuid, integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''pg_catalog'', ''public'' AS $function$' +
    "`n$baselineFunctionBody`n" + '$function$;'
  withdrawalFunctionOwner = 'postgres'
  withdrawalFunctionAcl = '{postgres=X/postgres,service_role=X/postgres}'
  withdrawalFunctionConfig = @('search_path=pg_catalog, public')
  withdrawalFunctionSecurityDefiner = $true
  coinLedgerConstraints = @(
    [pscustomobject]@{
      name = 'partner_coin_ledger_check'
      definition = 'CHECK (entry_type = ''earning''::text AND amount > 0)'
      validated = $true
      deferrable = $false
      initiallyDeferred = $false
    },
    [pscustomobject]@{
      name = 'partner_coin_ledger_entry_type_check'
      definition = 'CHECK (entry_type = ANY (ARRAY[''earning''::text, ''withdrawal''::text]))'
      validated = $true
      deferrable = $false
      initiallyDeferred = $false
    }
  )
}
$baselineFunction = [pscustomobject]@{
  definition = $testBaseline.withdrawalFunctionDefinition
  owner = $testBaseline.withdrawalFunctionOwner
  acl = $testBaseline.withdrawalFunctionAcl
  config = $testBaseline.withdrawalFunctionConfig
  security_definer = $testBaseline.withdrawalFunctionSecurityDefiner
}
$baselineComparison = Get-WithdrawalFunctionComparison -Baseline $testBaseline -CurrentFunction $baselineFunction
Assert-True ($baselineComparison.MatchesBaseline -and -not $baselineComparison.MatchesExpectedMigration) `
  'An untouched baseline withdrawal function must classify as baseline, not migrated.'
$emptyClassification = Get-DeliveryTeamMigrationClassification -Report $catalogReport -Baseline $testBaseline
$emptyCurrentConstraints = @($emptyClassification.CurrentConstraints)
Assert-True ($emptyClassification.State -ceq 'INCONSISTENT' -and
  $emptyCurrentConstraints.Length -eq 0) `
  'Empty catalog arrays and a null function must classify INCONSISTENT without scalar property access.'

$migrationFunction = [pscustomobject]@{
  definition = $testBaseline.withdrawalFunctionDefinition.Replace(
    $baselineBalanceCalculation,
    'available_coins := public.delivery_team_available_coins(p_partner_profile_id);'
  )
  owner = $testBaseline.withdrawalFunctionOwner
  acl = $testBaseline.withdrawalFunctionAcl
  config = $testBaseline.withdrawalFunctionConfig
  security_definer = $testBaseline.withdrawalFunctionSecurityDefiner
}
$migrationComparison = Get-WithdrawalFunctionComparison -Baseline $testBaseline -CurrentFunction $migrationFunction
Assert-True ($migrationComparison.MatchesExpectedMigration -and -not $migrationComparison.MatchesBaseline) `
  'The intended withdrawal balance-helper substitution must be recognized while baseline invariants remain fixed.'

$mockCheckNames = @(
  'target', 'delivery_team_tables', 'audit_columns', 'private_rls_and_grants',
  'private_policies', 'settings_singleton', 'private_proofs_bucket', 'activity_indexes',
  'expected_coin_and_stock_constraints', 'unique_idempotency_indexes',
  'privileged_rpcs', 'migration_history_absent'
)
$allPassChecks = [ordered]@{}
foreach ($checkName in $mockCheckNames) {
  $allPassChecks[$checkName] = $true
}
function Convert-MockedPsqlReport {
  param(
    [System.Collections.IDictionary]$Checks,
    [long]$ObjectCount,
    [AllowNull()]
    [object]$WithdrawalFunction,
    [object[]]$Constraints
  )

  $payload = [ordered]@{
    projectRef = 'axbjzmdokfoftzfgwiql'
    databaseName = 'postgres'
    databaseUser = 'postgres'
    checks = $Checks
    migrationSpecificObjectCount = $ObjectCount
    withdrawalFunction = $WithdrawalFunction
    coinLedgerConstraints = @($Constraints)
  } | ConvertTo-Json -Depth 10 -Compress
  return Get-ValidatedCatalogReport -Output @('BEGIN', 'SET', $payload, 'COMMIT', 'ROLLBACK')
}

$fullMockFunction = [ordered]@{
  definition = $migrationFunction.definition
  acl = $migrationFunction.acl
  config = @($migrationFunction.config)
  security_definer = $migrationFunction.security_definer
  owner = $migrationFunction.owner
}
$fullMockReport = Convert-MockedPsqlReport -Checks $allPassChecks -ObjectCount 24 `
  -WithdrawalFunction $fullMockFunction -Constraints @(
    [ordered]@{ name = 'partner_coin_ledger_entry_integrity_check'; definition = 'CHECK (admin fields valid)'; validated = $true; deferrable = $false; initiallyDeferred = $false }
  )
$fullClassification = Get-DeliveryTeamMigrationClassification -Report $fullMockReport -Baseline $testBaseline
$fullCurrentConstraints = @($fullClassification.CurrentConstraints)
Assert-True ($fullClassification.State -ceq 'FULL' -and
  $fullCurrentConstraints.Length -eq 1) `
  'A complete mocked psql report with a single-item constraint array must classify FULL.'

$absentChecks = [ordered]@{}
foreach ($checkName in $mockCheckNames) {
  $absentChecks[$checkName] = $checkName -in @('target', 'migration_history_absent')
}
$absentMockFunction = [ordered]@{
  definition = $baselineFunction.definition
  acl = $baselineFunction.acl
  config = @($baselineFunction.config)
  security_definer = $baselineFunction.security_definer
  owner = $baselineFunction.owner
}
$absentMockReport = Convert-MockedPsqlReport -Checks $absentChecks -ObjectCount 0 `
  -WithdrawalFunction $absentMockFunction -Constraints @($testBaseline.coinLedgerConstraints)
$absentClassification = Get-DeliveryTeamMigrationClassification -Report $absentMockReport -Baseline $testBaseline
Assert-True ($absentClassification.State -ceq 'ABSENT' -and
  $absentClassification.BaselineConstraintsMatch) `
  'A mocked untouched baseline with empty migration inventory must classify ABSENT.'

$inconsistentChecks = [ordered]@{}
foreach ($checkName in $mockCheckNames) {
  $inconsistentChecks[$checkName] = $checkName -eq 'target'
}
$inconsistentMockReport = Convert-MockedPsqlReport -Checks $inconsistentChecks -ObjectCount 3 `
  -WithdrawalFunction $null -Constraints @(
    [ordered]@{ name = 'partner_coin_ledger_entry_type_check'; definition = 'CHECK (partial)'; validated = $false; deferrable = $false; initiallyDeferred = $false }
  )
$inconsistentClassification = Get-DeliveryTeamMigrationClassification -Report $inconsistentMockReport -Baseline $testBaseline
$inconsistentCurrentConstraints = @($inconsistentClassification.CurrentConstraints)
Assert-True ($inconsistentClassification.State -ceq 'INCONSISTENT' -and
  $inconsistentCurrentConstraints.Length -eq 1) `
  'A partial mocked psql output with one constraint must classify INCONSISTENT without scalar Count failures.'

$mockId = [guid]::NewGuid().ToString('N')
$mockPsqlPath = Join-Path $env:TEMP "delivery-team-mock-psql-$mockId.ps1"
$mockBaselinePath = Join-Path $env:TEMP "delivery-team-mock-baseline-$mockId.json"
$mockFullPath = Join-Path $env:TEMP "delivery-team-mock-full-$mockId.json"
$mockAbsentPath = Join-Path $env:TEMP "delivery-team-mock-absent-$mockId.json"
$mockInconsistentPath = Join-Path $env:TEMP "delivery-team-mock-inconsistent-$mockId.json"
$mockVerifierOutputPath = Join-Path $env:TEMP "delivery-team-mock-verifier-$mockId.txt"
$mockPsqlContents = @'
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$PsqlArguments)
if ($PsqlArguments -contains '--version') {
  Write-Output 'psql (PostgreSQL) 18.0'
  $global:LASTEXITCODE = 0
  return
}
$outputIndex = [Array]::IndexOf($PsqlArguments, '--output')
if ($outputIndex -lt 0 -or $outputIndex + 1 -ge $PsqlArguments.Length) {
  throw 'Mock psql requires an --output path.'
}
$sourcePath = if ($PsqlArguments -contains '--field-separator') {
  $env:MOCK_PSQL_VERIFIER_OUTPUT
} else {
  $env:MOCK_PSQL_DIAGNOSTIC_OUTPUT
}
Copy-Item -LiteralPath $sourcePath -Destination $PsqlArguments[$outputIndex + 1] -Force
$global:LASTEXITCODE = 0
'@
$savedMockDiagnostic = $env:MOCK_PSQL_DIAGNOSTIC_OUTPUT
$savedMockVerifier = $env:MOCK_PSQL_VERIFIER_OUTPUT
try {
  [System.IO.File]::WriteAllText($mockPsqlPath, $mockPsqlContents, [System.Text.Encoding]::ASCII)
  [System.IO.File]::WriteAllText(
    $mockBaselinePath,
    ($testBaseline | ConvertTo-Json -Depth 10) + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
  $verificationTagsAndChecks = @(
    'BEGIN',
    'production target|PASS',
    'base WildCard tables|PASS',
    'delivery team RLS and grants|PASS',
    'private table policies|PASS',
    'settings row and threshold|PASS',
    'admin ledger columns|PASS',
    'stock and damage audit columns|PASS',
    'ledger and stock constraints|PASS',
    'unique idempotency indexes|PASS',
    'privileged functions|PASS',
    'migration history remains unverified|PASS',
    'partner proofs bucket remains private|PASS',
    'COMMIT',
    'ROLLBACK'
  )
  [System.IO.File]::WriteAllLines(
    $mockVerifierOutputPath,
    $verificationTagsAndChecks,
    [System.Text.UTF8Encoding]::new($false)
  )
  $mockReports = @(
    [pscustomobject]@{ Name = 'FULL'; Report = $fullMockReport; Path = $mockFullPath },
    [pscustomobject]@{ Name = 'ABSENT'; Report = $absentMockReport; Path = $mockAbsentPath },
    [pscustomobject]@{ Name = 'INCONSISTENT'; Report = $inconsistentMockReport; Path = $mockInconsistentPath }
  )
  foreach ($mockReport in $mockReports) {
    $mockJson = ConvertTo-Json -InputObject $mockReport.Report -Depth 20 -Compress
    [System.IO.File]::WriteAllLines(
      $mockReport.Path,
      @('BEGIN', 'SET', $mockJson, 'COMMIT', 'ROLLBACK'),
      [System.Text.UTF8Encoding]::new($false)
    )
  }

  $powerShell = (Get-Command pwsh -ErrorAction Stop).Source
  $mockResults = [System.Collections.Generic.List[object]]::new()
  foreach ($mockReport in $mockReports) {
    $env:MOCK_PSQL_DIAGNOSTIC_OUTPUT = $mockReport.Path
    $env:MOCK_PSQL_VERIFIER_OUTPUT = $mockVerifierOutputPath
    $mockOutput = @(& $powerShell -NoProfile -File $diagnosePath `
      -ProjectRef 'axbjzmdokfoftzfgwiql' `
      -BaselinePath $mockBaselinePath `
      -PsqlPath $mockPsqlPath 2>&1)
    $mockExitCode = $LASTEXITCODE
    $mockResults.Add([pscustomobject]@{
      Name = $mockReport.Name
      ExitCode = $mockExitCode
      Output = @($mockOutput | ForEach-Object { [string]$_ })
    })
  }
  foreach ($mockResult in $mockResults.ToArray()) {
    if ($mockResult.ExitCode -ne 0 -or
      -not (@($mockResult.Output | Where-Object { $_ -eq "MIGRATION_STATE|$($mockResult.Name)" }).Length -eq 1)) {
      throw "Mocked end-to-end diagnostic path failed for $($mockResult.Name): $($mockResult.Output -join ' | ')"
    }
  }
  $fullMockExecution = @($mockResults.ToArray() | Where-Object { $_.Name -eq 'FULL' })[0]
  Assert-True (@($fullMockExecution.Output | Where-Object {
    $_ -like '*DELIVERY TEAM SCHEMA EVIDENCE PASS*'
  }).Length -eq 1) `
    'A mocked FULL catalog report must automatically complete the independent read-only verifier.'
} finally {
  $env:MOCK_PSQL_DIAGNOSTIC_OUTPUT = $savedMockDiagnostic
  $env:MOCK_PSQL_VERIFIER_OUTPUT = $savedMockVerifier
  foreach ($temporaryPath in @(
    $mockPsqlPath, $mockBaselinePath, $mockFullPath, $mockAbsentPath,
    $mockInconsistentPath, $mockVerifierOutputPath
  )) {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}

Write-Output 'Delivery Team migration runner safety tests PASS.'
