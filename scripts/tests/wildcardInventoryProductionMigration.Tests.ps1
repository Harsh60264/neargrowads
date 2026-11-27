$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw "FAIL: $Message" }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runnerPath = Join-Path $repoRoot 'scripts\apply-production-wildcard-inventory-migration.ps1'
$verifierPath = Join-Path $repoRoot 'scripts\verify-production-wildcard-inventory-post-migration.ps1'
$fingerprintPath = Join-Path $repoRoot 'scripts\wildcardInventorySchemaFingerprint.ps1'
$fallbackHelperPath = Join-Path $repoRoot 'scripts\wildcardInventoryHistoryFallback.ps1'
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20261202120000_wildcard_inventory_restock.sql'
$runnerText = Get-Content -LiteralPath $runnerPath -Raw
$verifierText = Get-Content -LiteralPath $verifierPath -Raw
$migrationHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
$expectedHash = '85577695C220B129A6DAD02CE2812668360B5A5580B7275DA0780A50FB8E01A2'
Assert-True ($migrationHash -ceq $expectedHash -and $runnerText.Contains($expectedHash) -and $verifierText.Contains($expectedHash)) `
  'The runner and independent verifier must pin the exact WildCard migration SHA-256.'
$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
$topLevelMigrationSql = [regex]::Replace($migrationSql, '(?s)\$\$.*?\$\$', ' ')
Assert-True ($topLevelMigrationSql -notmatch '(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;') `
  'PL/pgSQL BEGIN blocks must not be mistaken for top-level transaction management.'

foreach ($path in @($runnerPath, $verifierPath, $fingerprintPath, $fallbackHelperPath)) {
  $tokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)
  Assert-True ($parseErrors.Count -eq 0) "PowerShell script must parse: $path"
}

$runnerTokens = $null
$runnerParseErrors = $null
$runnerAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $runnerPath, [ref]$runnerTokens, [ref]$runnerParseErrors
)
foreach ($functionName in @('Get-ValidatedJsonReport', 'Assert-ProductionSchemaBaseline')) {
  $functionAst = $runnerAst.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  Assert-True ($null -ne $functionAst) "The guarded runner must define $functionName."
  . ([scriptblock]::Create($functionAst.Extent.Text))
}

$validReport = Get-ValidatedJsonReport -Output @('BEGIN', 'SET', '{"identity":{"database":"postgres"}}', 'ROLLBACK')
Assert-True ($validReport.identity.database -ceq 'postgres') `
  'Read-only transaction command tags must be ignored while accepting one JSON object.'

$multipleRowsRejected = $false
try {
  [void](Get-ValidatedJsonReport -Output @('{"ok":true}', '{"alsoOk":true}'))
} catch {
  $multipleRowsRejected = $_.Exception.Message -like '*expected one JSON document*'
}
Assert-True $multipleRowsRejected 'Multiple psql payload rows must fail closed.'

$malformedJsonRejected = $false
try {
  [void](Get-ValidatedJsonReport -Output @('{"identity":'))
} catch {
  $malformedJsonRejected = $_.Exception.Message -like '*malformed JSON*'
}
Assert-True $malformedJsonRejected 'Malformed psql JSON must fail closed.'

$tableNames = @(
  'admin_users', 'delivery_team_activity', 'delivery_team_settings',
  'partner_profiles', 'partner_campaigns', 'partner_campaign_assignments',
  'partner_campaign_sites', 'partner_campaign_requests', 'partner_damage_reports',
  'partner_proofs', 'partner_stock_movements', 'partner_coin_ledger',
  'partner_withdrawal_requests'
)
$fakeFunctions = @(
  'assert_delivery_team_admin', 'delivery_team_available_coins', 'get_partner_coin_summary',
  'get_delivery_team_overview', 'get_delivery_team_partners', 'get_delivery_team_partner_detail',
  'admin_review_partner_proof', 'admin_review_partner_campaign_request',
  'admin_review_partner_damage_report', 'request_partner_withdrawal', 'submit_partner_proof'
) | ForEach-Object {
  [pscustomobject]@{
    signature = "public.$_()"
    isNew = $false
    exists = $true
    securityDefiner = $true
    owner = 'postgres'
    config = @('search_path=pg_catalog, public')
    serviceRoleExecute = $true
    anonExecute = $false
    authenticatedExecute = $false
  }
}
$fakeReport = [pscustomobject]@{
  identity = [pscustomobject]@{
    database = 'postgres'
    user = 'postgres'
    readOnly = 'on'
    inRecovery = $false
    serverVersion = '170012'
  }
  relations = @($tableNames | ForEach-Object {
    [pscustomobject]@{
      name = $_
      exists = $true
      rls = $_ -in @('partner_stock_movements', 'partner_campaign_requests', 'partner_coin_ledger', 'delivery_team_settings')
      forceRls = $false
      bytes = 0
    }
  })
  functions = @($fakeFunctions)
  indexes = @(
    [pscustomobject]@{
      name = 'partner_stock_movements_idempotency_unique'
      unique = $true
      valid = $true
    }
  )
  tableGrants = @(
    foreach ($table in @('partner_stock_movements', 'partner_campaign_requests', 'partner_coin_ledger')) {
      foreach ($role in @('anon', 'authenticated', 'service_role')) {
        foreach ($privilege in @('INSERT', 'UPDATE', 'DELETE')) {
          [pscustomobject]@{
            table = $table
            role = $role
            privilege = $privilege
            granted = $role -ceq 'service_role'
          }
        }
      }
    }
  )
  newMigrationObjects = [pscustomobject]@{
    columns = @()
    constraints = @()
    indexes = @()
    triggers = @()
    functions = @()
  }
  dependencyChecks = [pscustomobject]@{
    withdrawalThreshold = $true
    proofReservationInvariant = $true
    requestStatusesCompatible = $true
    stockMovementTypesCompatible = $true
    coinLedgerIntegrity = $true
    coinLedgerConstraints = $true
    partnerInventoryRls = $true
    partnerStockDirectWritesBlocked = $true
    deliveryTeamSettings = $true
    privateProofBucket = $true
  }
  dataSnapshots = @(1..15 | ForEach-Object {
    [pscustomobject]@{ table = "table$_"; rows = 0; md5 = 'e4d909c290d0fb1ca068ffaddf22cbd0' }
  })
}
Assert-ProductionSchemaBaseline -Report $fakeReport

$unsafeReport = $fakeReport | ConvertTo-Json -Depth 20 | ConvertFrom-Json -Depth 20
$unsafeReport.dependencyChecks.proofReservationInvariant = $false
$unsafeBaselineRejected = $false
try {
  Assert-ProductionSchemaBaseline -Report $unsafeReport
} catch {
  $unsafeBaselineRejected = $_.Exception.Message -like '*proofReservationInvariant*'
}
Assert-True $unsafeBaselineRejected 'A failed reservation invariant must stop the production migration.'

Assert-True ($runnerText.Contains('[switch]$UseApprovedHistoryFallback') -and
  $runnerText.Contains('[string]$ConfirmedProjectRef') -and
  $runnerText.Contains('[string]$ConfirmedMigration') -and
  $runnerText.Contains('Production apply is blocked because authoritative migration history is unavailable') -and
  $runnerText.Contains('APPROVED HISTORY FALLBACK')) `
  'Unavailable history must block by default and require evidence plus both exact, pinned Production confirmations.'
Assert-True ($runnerText.Contains('to_regclass(''supabase_migrations.schema_migrations'') IS NOT NULL') -and
  $verifierText.Contains('no migration ledger was added or changed')) `
  'Fallback apply must keep migration history absent and must not invent ledger entries.'
Assert-True ($runnerText -match '(?s)LOCK TABLE.*?IN SHARE ROW EXCLUSIVE MODE') `
  'The write transaction must acquire bounded locks over the affected Production tables.'
Assert-True ($runnerText.Contains("SET LOCAL lock_timeout = '5s'") -and
  $runnerText.Contains("SET LOCAL statement_timeout = '300s'") -and
  $runnerText.Contains('-SingleTransaction')) `
  'The migration must use bounded lock/statement timeouts and one automatic-rollback transaction.'
Assert-True ($runnerText -notmatch '(?im)^\s*(?:INSERT|UPDATE|DELETE)\s+.*supabase_migrations') `
  'The migration runner must not write or fabricate migration ledger entries.'
Assert-True ($verifierText.Contains('HistoryFallbackEvidencePath') -and
  $verifierText.Contains('Approved fallback post-check') -and
  $verifierText.Contains('UNRESOLVED HISTORY LIMITATION')) `
  'The independent verifier must preserve the missing-history limitation and require the fallback attestation.'

. $fingerprintPath
$fingerprintInput = [pscustomobject]@{
  relations = @([pscustomobject]@{ name = 'partner_profiles'; exists = $true; rls = $true; forceRls = $false; bytes = 1024 })
  columns = @([pscustomobject]@{ table = 'partner_profiles'; name = 'id'; type = 'uuid'; notNull = $true; default = '' })
  constraints = @([pscustomobject]@{
    table = 'partner_profiles'; name = 'partner_profiles_id_fkey'; type = 'f'
    definition = 'FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE'
    validated = $true; deferrable = $false
  })
  indexes = @()
  triggers = @()
  policies = @([pscustomobject]@{ table = 'partner_profiles'; name = 'read'; command = 'r'; roles = @('authenticated', 'anon'); using = 'true'; check = '' })
  functions = @([pscustomobject]@{
    signature = 'public.example()'; isNew = $false; exists = $true; securityDefiner = $true
    config = @('search_path=pg_catalog, public'); definitionMd5 = 'abc'
    serviceRoleExecute = $true; anonExecute = $false; authenticatedExecute = $false
  })
  tableGrants = @()
}
$equivalentFingerprintInput = $fingerprintInput | ConvertTo-Json -Depth 20 | ConvertFrom-Json -Depth 20
$equivalentFingerprintInput.relations[0].bytes = 9999
$equivalentFingerprintInput.constraints[0].definition = 'FOREIGN KEY (id) REFERENCES users(id) ON DELETE CASCADE'
$equivalentFingerprintInput.policies[0].roles = @('anon', 'authenticated')
Assert-True ((Get-CanonicalSchemaFingerprint $fingerprintInput) -ceq
  (Get-CanonicalSchemaFingerprint $equivalentFingerprintInput)) `
  'Schema fingerprint must ignore storage size and normalize equivalent auth.users qualification and policy role ordering.'
$equivalentFingerprintInput.constraints[0].validated = $false
Assert-True ((Get-CanonicalSchemaFingerprint $fingerprintInput) -cne
  (Get-CanonicalSchemaFingerprint $equivalentFingerprintInput)) `
  'Schema fingerprint must detect a changed constraint validation state.'

$verifierTokens = $null
$verifierParseErrors = $null
$verifierAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $verifierPath, [ref]$verifierTokens, [ref]$verifierParseErrors
)
foreach ($functionName in @('Get-CanonicalJson', 'Test-StockQuantityConstraintDefinition', 'Assert-EqualJson')) {
  $functionAst = $verifierAst.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -eq $functionName
  }, $true)
  Assert-True ($null -ne $functionAst) "The independent verifier must define $functionName."
  . ([scriptblock]::Create($functionAst.Extent.Text))
}
Assert-EqualJson -Name 'test arrays' -Expected @('a', 'b') -Actual @('a', 'b')
$differentArraysRejected = $false
try {
  Assert-True (Test-StockQuantityConstraintDefinition -Definition 'CHECK (((stock_quantity >= 1) AND (stock_quantity <= 100)))') `
    'The verifier must accept PostgreSQL deparsed range checks equivalent to the reviewed quantity bound.'
  Assert-True (Test-StockQuantityConstraintDefinition -Definition 'CHECK (stock_quantity BETWEEN 1 AND 100)') `
    'The verifier must accept an equivalent BETWEEN quantity check.'
  Assert-True (-not (Test-StockQuantityConstraintDefinition -Definition 'CHECK (stock_quantity <= 100)')) `
    'The verifier must reject a quantity check that omits its lower bound.'
  Assert-EqualJson -Name 'test arrays' -Expected @('a', 'b') -Actual @('a', 'c')
} catch {
  $differentArraysRejected = $_.Exception.Message -like '*differs from the protected baseline*'
}
Assert-True $differentArraysRejected 'Independent comparison must reject changed baseline data.'

Write-Output 'WildCard Production migration guard tests: PASS'
