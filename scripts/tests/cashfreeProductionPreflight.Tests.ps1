$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "FAIL: $Message" }
}

function Get-ReportedPreflightCheckCount {
  param([string]$Output)
  $expectedNames = @(
    'target_identity','migration36_prerequisites','migration36_identity_backfill',
    'migration36_table_definitions','migration36_functions_and_grants',
    'migration36_admin_setup_rpcs','migration36_table_security','admin_fk_compatibility',
    'migration36_constraints','migration36_state','migration37_schema_state',
    'migration36_triggers','migration36_internal_foreign_keys','migration37_table_security',
    'migration37_readiness','migration38_schema_state','migration38_readiness',
    'cashfree_disabled','razorpay_order_compatibility','migration_ledger',
    'migration37_post_state','migration38_post_state','razorpay_baseline_preserved'
  )
  $reported = @()
  foreach ($line in ($Output -split "`r?`n")) {
    if ($line -match '^(?:PASS|FAIL|UNVERIFIED) \| ([^|]+) \|' -and
      $expectedNames -contains $Matches[1]) {
      $reported += $Matches[1]
    }
  }
  return $reported.Count
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$preflightPath = Join-Path $repoRoot 'scripts\verify-production-cashfree-preflight.ps1'
$applyPath = Join-Path $repoRoot 'scripts\apply-production-cashfree-migration37.ps1'
$postPath = Join-Path $repoRoot 'scripts\verify-production-cashfree-migration37-post.ps1'
$apply38Path = Join-Path $repoRoot 'scripts\apply-production-cashfree-migration38.ps1'
$post38Path = Join-Path $repoRoot 'scripts\verify-production-cashfree-migration38-post.ps1'
$scriptText = Get-Content -LiteralPath $preflightPath -Raw
$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
  $preflightPath, [ref]$tokens, [ref]$parseErrors
)
Assert-True ($parseErrors.Count -eq 0) "Production preflight must parse without PowerShell errors: $($parseErrors -join '; ')"
foreach ($operatorScript in @($applyPath,$postPath,$apply38Path,$post38Path)) {
  $operatorTokens = $null
  $operatorErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    $operatorScript, [ref]$operatorTokens, [ref]$operatorErrors
  )
  Assert-True ($operatorErrors.Count -eq 0) `
    "Production operator script must parse: $operatorScript $($operatorErrors -join '; ')"
}

$applyText = Get-Content -LiteralPath $applyPath -Raw
$writeGuardMatch = [regex]::Match($applyText, '(?s)\$writeGuardSql\s*=\s*@"\r?\n(.*?)\r?\n"@')
Assert-True ($writeGuardMatch.Success) 'The Production write-guard SQL must be extractable for offline checks.'
$writeGuardText = $writeGuardMatch.Groups[1].Value
Assert-True ($writeGuardText.Contains('OR ($m37AnyObject) OR ($m38AnyObject)')) `
  'The write guard must reject unexpected Migration 37 or 38 schema objects.'
Assert-True ($writeGuardText.Contains("IF current_database() <> 'postgres' OR current_user <> 'postgres' OR pg_is_in_recovery()")) `
  'The write guard must retain its pinned database/role/primary checks.'
Assert-True ($writeGuardText.Contains("RAISE EXCEPTION 'Production target or absent Migration/history state changed; refusing application'")) `
  'The write guard must stop on unexpected schema/history state.'
Assert-True ($writeGuardText.Contains("to_regnamespace('supabase_migrations') IS NOT NULL")) `
  'The write guard must reject an unexpected migration-history schema instead of fabricating history.'
Assert-True ($writeGuardText.Contains('SELECT count(*),')) `
  'The Razorpay count must be computed from the already-filtered subquery without an out-of-scope provider reference.'
Assert-True ($writeGuardText.Contains("FROM public.service_orders WHERE provider='razorpay'")) `
  'The Razorpay fingerprint subquery must retain the pre-migration provider filter.'
Assert-True ($writeGuardText -notmatch 'count\(\*\)\s+FILTER\s*\(\s*WHERE\s+provider') `
  'The outer baseline query must not reference provider outside the derived table scope.'
Assert-True ($writeGuardText.Contains('current_count <> $expectedCountSql') -and
  $writeGuardText.Contains('current_fingerprint <> ''$baselineFingerprint''')) `
  'The write guard must reject Razorpay count or fingerprint drift.'
Assert-True ($writeGuardText -notmatch '(?i)\b(payment_session_id|cashfree_order_id|checkout_mode|cashfree_production_enabled)\b') `
  'The write guard must not directly reference columns introduced by Migration 37 or 38.'
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20261103100000_add_cashfree_service_payment_persistence.sql'
$actualMigrationHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
Assert-True ($applyText.Contains($actualMigrationHash)) 'The single-use runner must pin the exact local Migration 37 hash.'
Assert-True ($applyText.Contains("SET lock_timeout = '5s';")) 'Migration 37 must use a five-second lock timeout in its psql session.'
Assert-True ($applyText.Contains('SET statement_timeout = ''${statementTimeoutSeconds}s'';')) `
  'Migration 37 must use the operator-selected finite statement timeout in the same psql session.'
Assert-True ($applyText.Contains('BEGIN TRANSACTION READ ONLY;')) 'The runner must take a read-only pre-state snapshot.'
Assert-True ($applyText.Contains("'--set','ON_ERROR_STOP=1'")) 'The runner must stop on the first SQL error.'
Assert-True ($applyText -notmatch '(?i)--single-transaction') 'The runner must preserve Migration 37''s own BEGIN/COMMIT.'
Assert-True ($applyText.Contains('verify-production-cashfree-migration37-post.ps1')) `
  'The runner must invoke a separate read-only post-verifier.'
Assert-True ($applyText.Contains('Migration 37 did not return a confirmed successful completion (no retry was attempted)')) `
  'The runner must not retry an uncertain migration outcome.'
Assert-True ($applyText.Contains('RECOVERY RISK ACKNOWLEDGED')) `
  'The runner must require an explicit recovery-risk acknowledgement.'
$postText = Get-Content -LiteralPath $postPath -Raw
Assert-True ($postText.Contains('-SchemaEvidenceOnly')) 'The independent post-verifier must preserve HISTORY UNVERIFIED.'
Assert-True ($postText.Contains('-PostMigration37')) 'The independent post-verifier must require Migration 37 post-state checks.'

$apply38Text = Get-Content -LiteralPath $apply38Path -Raw
$migration38Path = Join-Path $repoRoot 'supabase\migrations\20261103214800_add_cashfree_production_mode.sql'
$actualMigration38Hash = (Get-FileHash -LiteralPath $migration38Path -Algorithm SHA256).Hash
Assert-True ($actualMigration38Hash -ceq 'F6BFC825FC5E271EEBD3CE9EA86637932190B8AE48A6493C3BB39DEE38C71603') `
  'Migration 38 fixture hash must match the reviewed file.'
Assert-True ($apply38Text.Contains($actualMigration38Hash)) `
  'The single-use Migration 38 runner must pin the exact local Migration 38 hash.'
$writeGuard38Match = [regex]::Match($apply38Text, '(?s)\$writeGuardSql\s*=\s*@"\r?\n(.*?)\r?\n"@')
Assert-True ($writeGuard38Match.Success) 'The Production Migration 38 write-guard SQL must be extractable.'
$writeGuard38Text = $writeGuard38Match.Groups[1].Value
Assert-True ($writeGuard38Text.Contains('NOT public.cashfree_gateway_readiness()')) `
  'The write guard must require Migration 37 readiness before applying Migration 38.'
Assert-True ($writeGuard38Text.Contains('OR ($migration38AnyObject)')) `
  'The write guard must reject any detected Migration 38 partial or complete object.'
Assert-True ($writeGuard38Text.Contains('current_count <> $expectedCountSql') -and
  $writeGuard38Text.Contains('current_fingerprint <> ''$baselineFingerprint''')) `
  'The write guard must reject Razorpay count and content-fingerprint drift.'
Assert-True ($writeGuard38Text.Contains('FROM public.service_orders WHERE provider=''razorpay''')) `
  'The baseline fingerprint must select Razorpay rows inside its derived table.'
Assert-True ($writeGuard38Text -notmatch '(?i)\b(cashfree_production_enabled|cashfree_production_verified_at|cashfree_production_verified_by|checkout_mode)\b') `
  'The Migration 38 write guard must not directly reference columns introduced by Migration 38.'
$migration38ObjectMatch = [regex]::Match(
  $apply38Text, '(?s)\$migration38AnyObject\s*=\s*@"\r?\n(.*?)\r?\n"@'
)
Assert-True ($migration38ObjectMatch.Success) 'The Migration 38 partial-schema detector must be defined.'
Assert-True ($migration38ObjectMatch.Groups[1].Value.Contains('information_schema.columns')) `
  'Migration 38 absent-state detection must inspect added columns through schema metadata.'
Assert-True ($migration38ObjectMatch.Groups[1].Value.Contains("pg_get_constraintdef(oid) LIKE '%live%'")) `
  'Migration 38 absent-state detection must catch the new live provider-mode constraint even if no new columns exist.'
Assert-True ($scriptText.Contains("pg_get_constraintdef(oid) LIKE '%live%'")) `
  'Read-only post-verification must detect a partially applied provider-mode constraint as Migration 38 state.'
Assert-True ($apply38Text.Contains("SET lock_timeout = '5s';")) `
  'Migration 38 must use a five-second lock timeout.'
Assert-True ($apply38Text.Contains('SET statement_timeout = ''${statementTimeoutSeconds}s'';')) `
  'Migration 38 must use the operator-selected finite statement timeout.'
Assert-True ($apply38Text.Contains("'--set','ON_ERROR_STOP=1'")) `
  'Migration 38 psql must fail on the first SQL error.'
Assert-True ($apply38Text -notmatch '(?i)--single-transaction') `
  'Migration 38 must preserve its own BEGIN/COMMIT.'
Assert-True ($apply38Text.Contains('no retry was attempted')) `
  'Migration 38 must not retry an uncertain outcome.'
Assert-True ($apply38Text.Contains('verify-production-cashfree-migration38-post.ps1')) `
  'Migration 38 must invoke a separate independent post-verifier.'
$post38Text = Get-Content -LiteralPath $post38Path -Raw
Assert-True ($post38Text.Contains('-PostMigration38')) `
  'The Migration 38 post-verifier must require complete Migration 38 checks.'

Assert-True ($scriptText.Contains('BEGIN TRANSACTION READ ONLY;')) 'The SQL session must start in a read-only transaction.'
Assert-True ($scriptText.Contains("'--password'")) 'The psql connection must request a secure password prompt.'
Assert-True ($scriptText.Contains("'--set', 'ON_ERROR_STOP=1'")) 'The psql invocation must stop on SQL errors.'
Assert-True ($scriptText.Contains("'--set', 'VERBOSITY=verbose'")) 'PostgreSQL errors must include SQLSTATE for sanitized diagnostics.'
Assert-True ($scriptText.Contains('[switch]$SchemaEvidenceOnly')) 'Schema evidence must be explicitly opted in.'
Assert-True ($scriptText.Contains('[switch]$PostMigration37')) 'Migration 37 post-verification must be explicit.'
Assert-True ($scriptText.Contains('migration37_post_state')) 'Post-verification must require complete Migration 37 and absent Migration 38.'
Assert-True ($scriptText.Contains('razorpay_baseline_preserved')) 'Post-verification must compare the Razorpay count and content fingerprint.'
Assert-True ($scriptText.Contains('I APPROVE SCHEMA EVIDENCE ONLY - HISTORY UNVERIFIED')) `
  'Schema evidence mode must require explicit typed approval.'
Assert-True ($scriptText.Contains('Enter-StagingPsqlEnvironment')) 'The preflight must use the existing verify-full TLS environment helper.'
Assert-True ($scriptText.Contains('aws-0-ap-northeast-2.pooler.supabase.com')) 'The preflight must pin the known Production pooler host.'
Assert-True ($scriptText.Contains('$databaseUser = "postgres.$expectedProjectRef"')) 'The preflight must pin the Production database user.'
Assert-True ($scriptText -notmatch '(?im)^\s*(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+|ALTER\s+|DROP\s+|TRUNCATE\s+)') `
  'The preflight SQL must not contain database-writing statements.'
foreach ($required in @(
  'migration36_table_definitions','migration36_functions_and_grants','migration36_table_security',
  'migration36_admin_setup_rpcs','migration36_identity_backfill',
  'migration36_triggers','migration36_internal_foreign_keys',
  'admin_fk_compatibility',
  'migration37_schema_state','migration38_schema_state','migration37_readiness',
  'migration37_table_security','migration38_readiness','migration_ledger',
  'cashfree_disabled','razorpay_order_compatibility'
)) {
  Assert-True ($scriptText.Contains($required)) "The Production preflight must check $required."
}
Assert-True ($scriptText.Contains('cashfree_production_verified_by')) 'Migration 38 production attribution must be checked.'
Assert-True ($scriptText.Contains('service_store_payment_audit')) 'Admin audit legacy/new FK compatibility must be accounted for.'
$migration38Detection = [regex]::Match(
  $scriptText, '(?s)SELECT\s+\(\s*(.*?)\)\s+AS migration38_any_object'
)
Assert-True ($migration38Detection.Success) 'Migration 38 partial-object detection must be present.'
foreach ($productionColumn in @(
  'cashfree_production_enabled','cashfree_production_verified_at','cashfree_production_verified_by'
)) {
  Assert-True ($migration38Detection.Groups[1].Value.Contains($productionColumn)) `
    "A partial Migration 38 schema containing $productionColumn must not be reported absent."
}
$sqlBlock = [regex]::Match($scriptText, '(?s)\$sql\s*=\s*@''\r?\n(.*?)\r?\n''@')
Assert-True ($sqlBlock.Success) 'The embedded preflight SQL must be available for substitution checks.'
$sqlWithoutPsqlConditionals = ($sqlBlock.Groups[1].Value -split "`r?`n" |
  Where-Object { $_ -notmatch '^\s*\\(?:if|elif)\b' }) -join "`n"
Assert-True ($sqlWithoutPsqlConditionals -notmatch '(?<!:):[A-Za-z_][A-Za-z0-9_]*') `
  'SQL boolean variables must use psql quoted-variable substitution; bare t/f must never become SQL identifiers.'
foreach ($condition in @(
  ":'migration37_any_object' = 'f'",
  ":'migration37_complete' = 't'",
  ":'migration38_any_object' = 'f'",
  ":'migration38_complete' = 't'"
)) {
  Assert-True ($sqlBlock.Groups[1].Value.Contains($condition)) `
    "The schema-state SQL must compare quoted psql boolean output using $condition."
}
$normalizedPreflightSql = $sqlBlock.Groups[1].Value -replace '\s+', ' '
Assert-True ($normalizedPreflightSql.Contains(
  "pg_get_constraintdef(oid) LIKE '%provider_mode = ANY (ARRAY[''test''::text, ''live''::text])%'"
)) 'Migration 38 completeness must recognize PostgreSQL''s canonical IN-list deparse and require exactly test/live array values.'
Assert-True (-not $normalizedPreflightSql.Contains("pg_get_constraintdef(oid) LIKE '%provider_mode = ''live''%'")) `
  'Migration 38 completeness must not require a literal equality that its IN constraint does not deparse to.'
$migration36Functions = [regex]::Match(
  $sqlBlock.Groups[1].Value,
  '(?s)WITH expected_functions\(signature, service_role_required\) AS \(.*?\nWITH required_setup_functions'
)
Assert-True ($migration36Functions.Success) 'Migration 36 function grant checks must retain their exact function set.'
foreach ($helper in @(
  'sync_admin_identity_history','lock_admin_email_reservation','guard_admin_email_reservation',
  'guard_auth_email_reservation','guard_admin_permanent_deletion_in_progress'
)) {
  Assert-True ($migration36Functions.Value -match "\('public\.$helper\([^)]*\)', false\)") `
    "Migration 36 helper $helper must not require service_role EXECUTE."
}
foreach ($rpc in @(
  'get_admin_permanent_deletion_state','begin_admin_permanent_deletion',
  'record_admin_permanent_deletion_failure','complete_admin_permanent_deletion'
)) {
  Assert-True ($migration36Functions.Value -match "\('public\.$rpc\([^)]*\)', true\)") `
    "Migration 36 RPC $rpc must require service_role EXECUTE."
}
Assert-True ($migration36Functions.Value.Contains("NOT has_function_privilege('service_role', procedure.oid, 'EXECUTE')")) `
  'Migration 36 helpers must fail if service_role execution is unexpectedly granted.'
Assert-True ($migration36Functions.Value.Contains('acl.grantee <> procedure.proowner')) `
  'Unexpected direct EXECUTE grants must fail the Migration 36 function check.'
Assert-True ($migration36Functions.Value.Contains('unexpected.proname IN')) `
  'Unexpected overloads for Migration 36 function names must fail the check.'

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cashfree-production-preflight-" + [guid]::NewGuid().ToString('N'))
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
if ($env:PRODUCTION_CASHFREE_MOCK_MODE -eq 'authentication') {
  Write-Error 'FATAL: password authentication failed for user postgres.axbjzmdokfoftzfgwiql' -ErrorAction Continue
  $global:LASTEXITCODE = 2
  return
}
if ($env:PRODUCTION_CASHFREE_MOCK_MODE -eq 'tls') {
  Write-Error 'FATAL: SSL certificate verification failed for hostname' -ErrorAction Continue
  $global:LASTEXITCODE = 2
  return
}
if ($env:PRODUCTION_CASHFREE_MOCK_MODE -eq 'sql-error') {
  Write-Error 'psql:preflight.psql:794: ERROR:  42703: column "cashfree_secret_value" does not exist' -ErrorAction Continue
  Write-Error 'DETAIL: api_token=sample-sensitive-token' -ErrorAction Continue
  Write-Error 'CONTEXT: customer@example.invalid' -ErrorAction Continue
  $global:LASTEXITCODE = 3
  return
}
$fileIndex = [Array]::IndexOf($args, '--file')
$outputIndex = [Array]::IndexOf($args, '--output')
if ($fileIndex -lt 0 -or $outputIndex -lt 0) {
  [Console]::Error.WriteLine('ERROR: expected psql file and output arguments')
  $global:LASTEXITCODE = 3
  return
}
$sql = [System.IO.File]::ReadAllText($args[$fileIndex + 1])
if ($env:PRODUCTION_CASHFREE_MOCK_MODE -eq 'post37' -and
  ($sql -notmatch 'CHECK\|migration37_post_state' -or
    $sql -match 'CHECK\|migration38_post_state')) {
  [Console]::Error.WriteLine('ERROR: Migration 37-only check set is inconsistent')
  $global:LASTEXITCODE = 7
  return
}
if ($env:PRODUCTION_CASHFREE_MOCK_MODE -eq 'post38' -and
  ($sql -notmatch 'CHECK\|migration38_post_state' -or
    $sql -match 'CHECK\|migration37_post_state')) {
  [Console]::Error.WriteLine('ERROR: Migration 38 check set contains a Migration 37 absence assertion')
  $global:LASTEXITCODE = 8
  return
}
if ($env:PRODUCTION_CASHFREE_APPLY_TEST -eq '1' -and
  $sql -match "SELECT 'PRESTATE\|PASS\|'") {
  [System.IO.File]::WriteAllText(
    $args[$outputIndex + 1],
    'PRESTATE|PASS|0|d41d8cd98f00b204e9800998ecf8427e|123456'
  )
  $global:LASTEXITCODE = 0
  return
}
if ($env:PRODUCTION_CASHFREE_APPLY_TEST -eq '1' -and
  $sql -match "SET lock_timeout = '5s';") {
  $markerPath = Join-Path $env:TEMP 'mock-migration37-write-count'
  $writeCount = 0
  if (Test-Path -LiteralPath $markerPath) {
    $writeCount = [int][System.IO.File]::ReadAllText($markerPath)
  }
  [System.IO.File]::WriteAllText($markerPath, "$($writeCount + 1)")
  Write-Error "psql:migration.psql:42: ERROR:  23514: new row violates check constraint `"service_orders_provider_check`" for value 'customer@example.invalid'" -ErrorAction Continue
  Write-Error 'DETAIL: api_token=sample-sensitive-token customer@example.invalid +1 (415) 555-0134' -ErrorAction Continue
  Write-Error 'CONTEXT: SQL statement contains customer@example.invalid and secret=do-not-show' -ErrorAction Continue
  $global:LASTEXITCODE = 3
  return
}
if ($sql -notmatch 'BEGIN TRANSACTION READ ONLY;' -or $sql -notmatch 'COMMIT;') {
  [Console]::Error.WriteLine('ERROR: read-only transaction wrapper missing')
  $global:LASTEXITCODE = 4
  return
}
if ($env:PRODUCTION_CASHFREE_MOCK_MODE -eq 'empty') {
  [System.IO.File]::WriteAllText($args[$outputIndex + 1], '')
  $global:LASTEXITCODE = 0
  return
}
$rows = @(
  'CHECK|target_identity|PASS|offline fixture',
  'CHECK|migration36_prerequisites|PASS|offline fixture',
  'CHECK|migration36_identity_backfill|PASS|offline fixture',
  'CHECK|migration36_table_definitions|PASS|offline fixture',
  'CHECK|migration36_functions_and_grants|PASS|offline fixture',
  'CHECK|migration36_admin_setup_rpcs|PASS|offline fixture',
  'CHECK|migration36_table_security|PASS|offline fixture',
  'CHECK|admin_fk_compatibility|PASS|legacy=false;history=true',
  'CHECK|migration36_constraints|PASS|offline fixture',
  'CHECK|migration36_state|PASS|Migration 36 is complete',
  'CHECK|migration36_triggers|PASS|offline fixture',
  'CHECK|migration36_internal_foreign_keys|PASS|offline fixture',
  'CHECK|migration37_schema_state|PASS|state=ABSENT',
  'CHECK|migration37_table_security|PASS|absent',
  'CHECK|migration37_readiness|PASS|absent',
  'CHECK|migration38_schema_state|PASS|state=ABSENT',
  'CHECK|migration38_readiness|PASS|absent',
  'CHECK|cashfree_disabled|PASS|absent',
  'CHECK|razorpay_order_compatibility|PASS|Razorpay orders=0;incompatible currency/mode rows=0'
)
switch ($env:PRODUCTION_CASHFREE_MOCK_MODE) {
  'post37' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration37_schema_state|*') { 'CHECK|migration37_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration37_table_security|*') { 'CHECK|migration37_table_security|PASS|protected tables' }
      elseif ($_ -like 'CHECK|migration37_readiness|*') { 'CHECK|migration37_readiness|PASS|ready' }
      else { $_ }
    }
    $rows += 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    $rows += 'CHECK|migration37_post_state|PASS|Migration 37 complete; Migration 38 absent'
    $rows += 'CHECK|razorpay_baseline_preserved|PASS|baseline matches'
    break
  }
  'partial37' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration37_schema_state|*') { 'CHECK|migration37_schema_state|FAIL|state=PARTIAL_OR_DRIFTED' }
      elseif ($_ -like 'CHECK|migration37_readiness|*') { 'CHECK|migration37_readiness|FAIL|partial' }
      else { $_ }
    }
    break
  }
  'partial38' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration38_schema_state|*') { 'CHECK|migration38_schema_state|FAIL|state=PARTIAL_OR_DRIFTED' }
      elseif ($_ -like 'CHECK|migration38_readiness|*') { 'CHECK|migration38_readiness|FAIL|partial' }
      else { $_ }
    }
    break
  }
  'functions-helper-granted' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration36_functions_and_grants|*') {
        'CHECK|migration36_functions_and_grants|FAIL|unexpected service_role helper grant'
      } else { $_ }
    }
    break
  }
  'functions-rpc-missing-grant' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration36_functions_and_grants|*') {
        'CHECK|migration36_functions_and_grants|FAIL|permanent-deletion RPC grant missing'
      } else { $_ }
    }
    break
  }
  'functions-unexpected-overload' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration36_functions_and_grants|*') {
        'CHECK|migration36_functions_and_grants|FAIL|unexpected function signature'
      } else { $_ }
    }
    break
  }
  'razorpay-incompatible' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|razorpay_order_compatibility|*') { 'CHECK|razorpay_order_compatibility|FAIL|incompatible currency/mode rows=1' }
      else { $_ }
    }
    break
  }
  'ledger-absent' {
    $rows += 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    break
  }
  'post37' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration37_schema_state|*') { 'CHECK|migration37_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration37_table_security|*') { 'CHECK|migration37_table_security|PASS|protected tables' }
      elseif ($_ -like 'CHECK|migration37_readiness|*') { 'CHECK|migration37_readiness|PASS|ready' }
      else { $_ }
    }
    $rows += 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    $rows += 'CHECK|migration37_post_state|PASS|Migration 37 complete; Migration 38 absent'
    $rows += 'CHECK|razorpay_baseline_preserved|PASS|baseline matches'
    break
  }
  'post37-baseline-mismatch' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration37_schema_state|*') { 'CHECK|migration37_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration37_table_security|*') { 'CHECK|migration37_table_security|PASS|protected tables' }
      elseif ($_ -like 'CHECK|migration37_readiness|*') { 'CHECK|migration37_readiness|PASS|ready' }
      else { $_ }
    }
    $rows += 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    $rows += 'CHECK|migration37_post_state|PASS|Migration 37 complete; Migration 38 absent'
    $rows += 'CHECK|razorpay_baseline_preserved|FAIL|baseline mismatch'
    break
  }
  'post38' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration37_schema_state|*') { 'CHECK|migration37_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration37_table_security|*') { 'CHECK|migration37_table_security|PASS|protected tables' }
      elseif ($_ -like 'CHECK|migration37_readiness|*') { 'CHECK|migration37_readiness|PASS|ready' }
      elseif ($_ -like 'CHECK|migration38_schema_state|*') { 'CHECK|migration38_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration38_readiness|*') { 'CHECK|migration38_readiness|PASS|ready' }
      elseif ($_ -like 'CHECK|cashfree_disabled|*') { 'CHECK|cashfree_disabled|PASS|Sandbox and Production disabled' }
      else { $_ }
    }
    $rows += 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    $rows += 'CHECK|migration38_post_state|PASS|Migrations 37 and 38 complete'
    $rows += 'CHECK|razorpay_baseline_preserved|PASS|baseline matches'
    break
  }
  'post38-baseline-mismatch' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration37_schema_state|*') { 'CHECK|migration37_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration37_table_security|*') { 'CHECK|migration37_table_security|PASS|protected tables' }
      elseif ($_ -like 'CHECK|migration37_readiness|*') { 'CHECK|migration37_readiness|PASS|ready' }
      elseif ($_ -like 'CHECK|migration38_schema_state|*') { 'CHECK|migration38_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration38_readiness|*') { 'CHECK|migration38_readiness|PASS|ready' }
      elseif ($_ -like 'CHECK|cashfree_disabled|*') { 'CHECK|cashfree_disabled|PASS|Sandbox and Production disabled' }
      else { $_ }
    }
    $rows += 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    $rows += 'CHECK|migration38_post_state|PASS|Migrations 37 and 38 complete'
    $rows += 'CHECK|razorpay_baseline_preserved|FAIL|baseline mismatch'
    break
  }
  'post38-partial' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration37_schema_state|*') { 'CHECK|migration37_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration37_table_security|*') { 'CHECK|migration37_table_security|PASS|protected tables' }
      elseif ($_ -like 'CHECK|migration37_readiness|*') { 'CHECK|migration37_readiness|PASS|ready' }
      elseif ($_ -like 'CHECK|migration38_schema_state|*') { 'CHECK|migration38_schema_state|FAIL|state=PARTIAL_OR_DRIFTED' }
      elseif ($_ -like 'CHECK|migration38_readiness|*') { 'CHECK|migration38_readiness|FAIL|readiness RPC returned false' }
      else { $_ }
    }
    $rows += 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    $rows += 'CHECK|migration38_post_state|FAIL|Migrations 37 and 38 must both be complete'
    $rows += 'CHECK|razorpay_baseline_preserved|PASS|baseline matches'
    break
  }
  'ledger-absent-table' {
    $rows += 'CHECK|migration_ledger|FAIL|table absent'
    $rows += 'MIGRATION_HISTORY|ABSENT_TABLE|offline fixture'
    break
  }
  'ledger-empty' {
    $rows += 'CHECK|migration_ledger|FAIL|empty'
    $rows += 'MIGRATION_HISTORY|EMPTY|offline fixture'
    break
  }
  'ledger-unreadable' {
    $rows += 'CHECK|migration_ledger|FAIL|unreadable'
    $rows += 'MIGRATION_HISTORY|UNREADABLE|offline fixture'
    break
  }
  'evidence-alternate-ledger' {
    $rows += 'CHECK|migration_ledger|FAIL|migration history schema is absent; history remains unverified'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    $rows += 'LEDGER_CANDIDATE|public.other_migration_log'
    break
  }
  'evidence-inconsistent' {
    $rows += 'CHECK|migration_ledger|PASS|unexpectedly marked readable'
    $rows += 'MIGRATION_HISTORY|ABSENT_SCHEMA|offline fixture'
    break
  }
  'ledger-readable' {
    $rows += 'CHECK|migration_ledger|PASS|exact versions and names'
    $rows += 'MIGRATION_HISTORY|READABLE|exact versions and names checked'
    $rows += 'MIGRATION_VERSION|20261102100000|secure_archived_admin_permanent_deletion'
    break
  }
  'ledger-mismatch' {
    $rows += 'CHECK|migration_ledger|FAIL|schema state and ledger disagree'
    $rows += 'MIGRATION_HISTORY|READABLE|exact versions and names checked'
    $rows += 'MIGRATION_VERSION|20261102100000|unexpected_name'
    break
  }
  'cashfree-complete' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|migration37_schema_state|*') { 'CHECK|migration37_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration37_table_security|*') { 'CHECK|migration37_table_security|PASS|protected tables' }
      elseif ($_ -like 'CHECK|migration37_readiness|*') { 'CHECK|migration37_readiness|PASS|ready' }
      elseif ($_ -like 'CHECK|migration38_schema_state|*') { 'CHECK|migration38_schema_state|PASS|state=COMPLETE' }
      elseif ($_ -like 'CHECK|migration38_readiness|*') { 'CHECK|migration38_readiness|PASS|ready' }
      else { $_ }
    }
    $rows += 'CHECK|migration_ledger|PASS|exact versions and names'
    $rows += 'MIGRATION_HISTORY|READABLE|exact versions and names checked'
    $rows += 'MIGRATION_VERSION|20261102100000|secure_archived_admin_permanent_deletion'
    $rows += 'MIGRATION_VERSION|20261103100000|add_cashfree_service_payment_persistence'
    $rows += 'MIGRATION_VERSION|20261103214800|add_cashfree_production_mode'
    break
  }
  'cashfree-enabled' {
    $rows = $rows | ForEach-Object {
      if ($_ -like 'CHECK|cashfree_disabled|*') { 'CHECK|cashfree_disabled|FAIL|enabled' }
      else { $_ }
    }
    $rows += 'CHECK|migration_ledger|PASS|exact versions and names'
    $rows += 'MIGRATION_HISTORY|READABLE|exact versions and names checked'
    $rows += 'MIGRATION_VERSION|20261102100000|secure_archived_admin_permanent_deletion'
    break
  }
  default {
    $rows += 'CHECK|migration_ledger|PASS|exact versions and names'
    $rows += 'MIGRATION_HISTORY|READABLE|exact versions and names checked'
    $rows += 'MIGRATION_VERSION|20261102100000|secure_archived_admin_permanent_deletion'
  }
}
[System.IO.File]::WriteAllLines($args[$outputIndex + 1], $rows)
$global:LASTEXITCODE = 0
'@
[System.IO.File]::WriteAllText($mockPsqlPath, $mockPsql, [System.Text.UTF8Encoding]::new($false))

function Invoke-MockedProductionPreflight {
  param(
    [string]$Mode,
    [string]$Confirmation = 'axbjzmdokfoftzfgwiql',
    [string]$Ref = 'axbjzmdokfoftzfgwiql',
    [switch]$SchemaEvidenceOnly,
    [switch]$PostMigration37,
    [switch]$PostMigration38,
    [long]$ExpectedRazorpayOrderCount = -1,
    [string]$ExpectedRazorpayOrderFingerprint,
    [string]$EvidenceConfirmation = 'I APPROVE SCHEMA EVIDENCE ONLY - HISTORY UNVERIFIED'
  )
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $arguments = @('-NoProfile','-File',$preflightPath,'-ProjectRef',$Ref,'-PsqlPath',$mockPsqlPath)
  if ($SchemaEvidenceOnly) { $arguments += '-SchemaEvidenceOnly' }
  if ($PostMigration38) {
    $arguments += @('-PostMigration38','-ExpectedRazorpayOrderCount',"$ExpectedRazorpayOrderCount",
      '-ExpectedRazorpayOrderFingerprint',$ExpectedRazorpayOrderFingerprint)
  }
  if ($PostMigration37) {
    $arguments += @('-PostMigration37','-ExpectedRazorpayOrderCount',"$ExpectedRazorpayOrderCount",
      '-ExpectedRazorpayOrderFingerprint',$ExpectedRazorpayOrderFingerprint)
  }
  foreach ($argument in $arguments) {
    $startInfo.ArgumentList.Add($argument)
  }
  $startInfo.Environment['APPDATA'] = $appDataPath
  $startInfo.Environment['TEMP'] = $tempRoot
  $startInfo.Environment['PRODUCTION_CASHFREE_MOCK_MODE'] = $Mode
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start mocked Production preflight.' }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if ($Ref -ceq 'axbjzmdokfoftzfgwiql') {
    $process.StandardInput.WriteLine($Confirmation)
    if ($SchemaEvidenceOnly) { $process.StandardInput.WriteLine($EvidenceConfirmation) }
  }
  $process.StandardInput.Close()
  $process.WaitForExit()
  [pscustomobject]@{
    ExitCode = $process.ExitCode
    Output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
  }
}

function Invoke-MockedMigration37Failure {
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  foreach ($argument in @(
    '-NoProfile','-File',$applyPath,
    '-ProjectRef','axbjzmdokfoftzfgwiql',
    '-PsqlPath',$mockPsqlPath
  )) {
    $startInfo.ArgumentList.Add($argument)
  }
  $startInfo.Environment['APPDATA'] = $appDataPath
  $startInfo.Environment['TEMP'] = $tempRoot
  $startInfo.Environment['PRODUCTION_CASHFREE_APPLY_TEST'] = '1'
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw 'Could not start mocked Migration 37 failure workflow.' }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  foreach ($answer in @(
    'axbjzmdokfoftzfgwiql',
    'PAUSE CONFIRMED',
    'production db on-call channel',
    'RECOVERY RISK ACKNOWLEDGED',
    '120',
    'I APPROVE STATEMENT TIMEOUT 120 SECONDS FOR 123456 BYTES',
    'APPLY MIGRATION 37 SHA256=1EFA7368814803A271F4D0D71C767F63CC8437BF332F0D9ED9B55FFDC4B13D1A TO PRODUCTION axbjzmdokfoftzfgwiql'
  )) {
    $process.StandardInput.WriteLine($answer)
  }
  $process.StandardInput.Close()
  $process.WaitForExit()
  [pscustomobject]@{
    ExitCode = $process.ExitCode
    Output = $stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()
  }
}

try {
  $wrongTarget = Invoke-MockedProductionPreflight -Mode success -Ref 'kdaixomygsuxadofoieb'
  Assert-True ($wrongTarget.ExitCode -ne 0) 'A non-Production project reference must fail before psql.'
  Assert-True ($wrongTarget.Output -match 'pinned Production project ref') 'Wrong-target failure must identify the pinned Production ref.'

  $wrongConfirmation = Invoke-MockedProductionPreflight -Mode success -Confirmation 'not-the-production-ref'
  Assert-True ($wrongConfirmation.ExitCode -ne 0) 'Wrong typed confirmation must abort before database connection.'
  Assert-True ($wrongConfirmation.Output -match 'confirmation did not match') 'Wrong confirmation must fail clearly.'

  $wrongEvidenceConfirmation = Invoke-MockedProductionPreflight -Mode ledger-absent `
    -SchemaEvidenceOnly -EvidenceConfirmation 'not-approved'
  Assert-True ($wrongEvidenceConfirmation.ExitCode -ne 0) `
    'Schema evidence mode must reject an unapproved typed confirmation before connecting.'
  Assert-True ($wrongEvidenceConfirmation.Output -match 'Schema-evidence-only confirmation did not match') `
    'The evidence-mode confirmation failure must be explicit.'

  $empty = Invoke-MockedProductionPreflight -Mode empty
  Assert-True ($empty.ExitCode -ne 0 -and $empty.Output -match 'empty verification output') 'Empty output must fail closed.'
  Assert-True ($empty.Output -notmatch 'OVERALL: PASS|QueryOutput') 'Empty output must not become a successful or binding-shaped fallback.'

  $authentication = Invoke-MockedProductionPreflight -Mode authentication
  Assert-True ($authentication.ExitCode -ne 0 -and $authentication.Output -match 'authentication failed') 'Authentication failure must be explicit.'
  Assert-True ($authentication.Output -notmatch 'password authentication failed for user') `
    "Raw authentication diagnostics must be sanitized. Output: $($authentication.Output)"

  $tls = Invoke-MockedProductionPreflight -Mode tls
  Assert-True ($tls.ExitCode -ne 0 -and $tls.Output -match 'TLS verification failed') 'TLS failure must be explicit and fail closed.'
  Assert-True ($tls.Output -notmatch 'SSL certificate verification failed') 'Raw TLS diagnostics must be sanitized.'

  $sqlError = Invoke-MockedProductionPreflight -Mode sql-error
  Assert-True ($sqlError.ExitCode -ne 0 -and $sqlError.Output -match 'SQLSTATE 42703') `
    "SQL failures must expose the PostgreSQL SQLSTATE. $($sqlError.Output)"
  Assert-True ($sqlError.Output -match 'column \[redacted\] does not exist') `
    'SQL failures must expose a concise, sanitized PostgreSQL error message.'
  Assert-True ($sqlError.Output -notmatch 'cashfree_secret_value|sample-sensitive-token|customer@example\.invalid|DETAIL:|CONTEXT:') `
    "SQL diagnostics must not expose quoted values, credentials, customer data or error context. Output: $($sqlError.Output)"

  $writeCountPath = Join-Path $tempRoot 'mock-migration37-write-count'
  if (Test-Path -LiteralPath $writeCountPath) {
    Remove-Item -LiteralPath $writeCountPath -Force
  }
  $migrationFailure = Invoke-MockedMigration37Failure
  Assert-True ($migrationFailure.ExitCode -ne 0) 'A mocked PostgreSQL Migration 37 error must fail the operator workflow.'
  Assert-True ($migrationFailure.Output -match 'SQLSTATE 23514') `
    "The Migration 37 error path must show PostgreSQL SQLSTATE. $($migrationFailure.Output)"
  Assert-True ($migrationFailure.Output -match 'new row violates check constraint') `
    'The Migration 37 error path must preserve a concise, useful PostgreSQL error message.'
  Assert-True ($migrationFailure.Output -notmatch 'sample-sensitive-token|customer@example\.invalid|555-0134|do-not-show|DETAIL:|CONTEXT:') `
    "Migration diagnostics must redact credentials and PII and omit detail/context. $($migrationFailure.Output)"
  Assert-True (([System.IO.File]::ReadAllText($writeCountPath)) -eq '1') `
    'The Migration 37 failure path must not automatically retry.'

  $success = Invoke-MockedProductionPreflight -Mode success
  Assert-True ($success.ExitCode -eq 0 -and $success.Output -match 'OVERALL: PASS') "Valid complete output should pass. $($success.Output)"
  Assert-True ($success.Output -match 'migration36_state.*Migration 36 is complete') 'Migration 36 result must be parsed.'
  Assert-True ($success.Output -match 'migration37_schema_state.*ABSENT') 'Migration 37 absence must be reported separately.'
  Assert-True ($success.Output -match 'migration38_schema_state.*ABSENT') 'Migration 38 absence must be reported separately.'
  Assert-True ($success.Output -match 'migration37_schema_state.*state=ABSENT') `
    'False migration-object detection must classify the schema as absent.'

  $schemaEvidence = Invoke-MockedProductionPreflight -Mode ledger-absent -SchemaEvidenceOnly
  Assert-True ($schemaEvidence.ExitCode -eq 0) `
    "Explicit evidence-only mode should accept only an absent history schema when all schema checks pass. $($schemaEvidence.Output)"
  Assert-True ($schemaEvidence.Output -match 'UNVERIFIED \| migration_ledger') `
    'Evidence-only output must visibly mark migration history unverified.'
  Assert-True ($schemaEvidence.Output -match 'OVERALL: SCHEMA EVIDENCE PASS.*MIGRATION HISTORY UNVERIFIED') `
    'Evidence-only output must not claim migration history PASS.'
  Assert-True ($schemaEvidence.Output -notmatch 'OVERALL: PASS') `
    'Evidence-only output must never appear as an unqualified overall PASS.'

  $post37 = Invoke-MockedProductionPreflight -Mode post37 -SchemaEvidenceOnly -PostMigration37 `
    -ExpectedRazorpayOrderCount 0 -ExpectedRazorpayOrderFingerprint 'd41d8cd98f00b204e9800998ecf8427e'
  Assert-True ($post37.ExitCode -eq 0) `
    "Independent post-verification fixtures should accept complete Migration 37 and absent Migration 38. $($post37.Output)"
  Assert-True ($post37.Output -match 'PASS \| migration37_post_state') 'Post-verification must report Migration 37/38 ordering.'
  Assert-True ($post37.Output -match 'PASS \| razorpay_baseline_preserved') 'Post-verification must report the unchanged Razorpay baseline.'
  Assert-True ($post37.Output -match 'MIGRATION HISTORY UNVERIFIED') 'Post-verification must preserve the history warning.'
  Assert-True ($post37.Output -notmatch 'migration38_post_state') `
    'Migration 37-only mode must not include Migration 38-complete checks.'
  Assert-True ((Get-ReportedPreflightCheckCount -Output $post37.Output) -eq 22) `
    'Migration 37 post-verification must return exactly its 22 expected checks.'

  $post37Mismatch = Invoke-MockedProductionPreflight -Mode post37-baseline-mismatch `
    -SchemaEvidenceOnly -PostMigration37 -ExpectedRazorpayOrderCount 0 `
    -ExpectedRazorpayOrderFingerprint 'd41d8cd98f00b204e9800998ecf8427e'
  Assert-True ($post37Mismatch.ExitCode -ne 0 -and
    $post37Mismatch.Output -match 'FAIL \| razorpay_baseline_preserved') `
    'Post-verification must fail if Razorpay baseline comparison fails.'

  $post38 = Invoke-MockedProductionPreflight -Mode post38 -SchemaEvidenceOnly -PostMigration38 `
    -ExpectedRazorpayOrderCount 0 -ExpectedRazorpayOrderFingerprint 'd41d8cd98f00b204e9800998ecf8427e'
  Assert-True ($post38.ExitCode -eq 0) `
    "Migration 38 post-verification should accept both complete schema states. $($post38.Output)"
  Assert-True ($post38.Output -match 'PASS \| migration38_post_state') `
    'Migration 38 post-verification must require both migrations complete.'
  Assert-True ($post38.Output -match 'PASS \| migration38_readiness') `
    'Migration 38 post-verification must report readiness.'
  Assert-True ($post38.Output -match 'PASS \| cashfree_disabled') `
    'Migration 38 post-verification must keep both Cashfree switches disabled.'
  Assert-True ($post38.Output -match 'PASS \| razorpay_baseline_preserved') `
    'Migration 38 post-verification must preserve the Razorpay baseline.'
  Assert-True ($post38.Output -match 'MIGRATION HISTORY UNVERIFIED') `
    'Migration 38 post-verification must report history as UNVERIFIED.'
  Assert-True ($post38.Output -notmatch 'migration37_post_state') `
    'Migration 38-complete mode must not assert that Migration 38 remains absent.'
  Assert-True ((Get-ReportedPreflightCheckCount -Output $post38.Output) -eq 22) `
    'Migration 38 post-verification must return exactly its 22 expected checks.'

  $post38Partial = Invoke-MockedProductionPreflight -Mode post38-partial `
    -SchemaEvidenceOnly -PostMigration38 -ExpectedRazorpayOrderCount 0 `
    -ExpectedRazorpayOrderFingerprint 'd41d8cd98f00b204e9800998ecf8427e'
  Assert-True ($post38Partial.ExitCode -ne 0) `
    'Migration 38 post-verification must reject partial Migration 38 schema.'
  Assert-True ($post38Partial.Output -match 'FAIL \| migration38_schema_state.*PARTIAL_OR_DRIFTED') `
    'Partial Migration 38 must remain explicitly classified as drift.'
  Assert-True ($post38Partial.Output -match 'FAIL \| migration38_readiness') `
    'Partial Migration 38 must not be rescued by the post-state mode.'
  Assert-True ($post38Partial.Output -match 'FAIL \| migration38_post_state') `
    'Migration 38 post-state must fail unless both migrations are complete.'
  Assert-True ((Get-ReportedPreflightCheckCount -Output $post38Partial.Output) -eq 22) `
    'Partial Migration 38 post-verification must still have the exact expected check set.'

  $post38Mismatch = Invoke-MockedProductionPreflight -Mode post38-baseline-mismatch `
    -SchemaEvidenceOnly -PostMigration38 -ExpectedRazorpayOrderCount 0 `
    -ExpectedRazorpayOrderFingerprint 'd41d8cd98f00b204e9800998ecf8427e'
  Assert-True ($post38Mismatch.ExitCode -ne 0 -and
    $post38Mismatch.Output -match 'FAIL \| razorpay_baseline_preserved') `
    'Migration 38 post-verification must fail when Razorpay baseline changes.'

  $cashfreeComplete = Invoke-MockedProductionPreflight -Mode cashfree-complete
  Assert-True ($cashfreeComplete.ExitCode -eq 0) "Consistent, fully applied migration evidence should parse as complete. $($cashfreeComplete.Output)"
  Assert-True ($cashfreeComplete.Output -match 'migration37_schema_state.*COMPLETE' -and
    $cashfreeComplete.Output -match 'migration38_schema_state.*COMPLETE') `
    'Completed Migration 37 and 38 states must be reported independently.'
  Assert-True ($cashfreeComplete.Output -match 'migration37_schema_state.*state=COMPLETE' -and
    $cashfreeComplete.Output -match 'migration38_schema_state.*state=COMPLETE') `
    'True completeness booleans must classify both migrations as complete.'
  Assert-True ($cashfreeComplete.Output -match 'MIGRATION_VERSION\|20261103214800\|add_cashfree_production_mode') `
    'The ledger summary must show the exact Migration 38 name without writing history.'

  foreach ($case in @(
    @{ Mode='partial37'; Expected='migration37_schema_state' },
    @{ Mode='partial38'; Expected='migration38_schema_state' },
    @{ Mode='functions-helper-granted'; Expected='migration36_functions_and_grants' },
    @{ Mode='functions-rpc-missing-grant'; Expected='migration36_functions_and_grants' },
    @{ Mode='functions-unexpected-overload'; Expected='migration36_functions_and_grants' },
    @{ Mode='razorpay-incompatible'; Expected='razorpay_order_compatibility' },
    @{ Mode='ledger-absent'; Expected='migration_ledger' },
    @{ Mode='ledger-absent-table'; Expected='migration_ledger' },
    @{ Mode='ledger-empty'; Expected='migration_ledger' },
    @{ Mode='ledger-unreadable'; Expected='migration_ledger' },
    @{ Mode='evidence-alternate-ledger'; Expected='migration_ledger' },
    @{ Mode='evidence-inconsistent'; Expected='migration_ledger' },
    @{ Mode='ledger-mismatch'; Expected='migration_ledger' },
    @{ Mode='cashfree-enabled'; Expected='cashfree_disabled' }
  )) {
    $invokeParameters = @{ Mode = $case.Mode }
    if ($case.Mode -ne 'ledger-absent') { $invokeParameters.SchemaEvidenceOnly = $true }
    $result = Invoke-MockedProductionPreflight @invokeParameters
    Assert-True ($result.ExitCode -ne 0) "$($case.Mode) must fail closed."
    Assert-True ($result.Output -match "FAIL \| $($case.Expected)") "$($case.Mode) must name its failed check. $($result.Output)"
    Assert-True ($result.Output -match 'OVERALL: FAIL') "$($case.Mode) must produce deterministic failure."
    if ($case.Mode -eq 'partial37') {
      Assert-True ($result.Output -match 'migration37_schema_state.*state=PARTIAL_OR_DRIFTED') `
        'An existing but incomplete Migration 37 schema must remain classified as partial.'
    }
    if ($case.Mode -eq 'partial38') {
      Assert-True ($result.Output -match 'migration38_schema_state.*state=PARTIAL_OR_DRIFTED') `
        'An existing but incomplete Migration 38 schema must remain classified as partial.'
    }
  }

  Write-Output 'PASS: offline Production preflight entrypoint tests cover target/confirmation guards, TLS/read-only SQL contract, empty/auth failures, migration partial states, ledger absence, Cashfree activation and Razorpay compatibility.'
} finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
