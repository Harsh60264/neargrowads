$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw "FAIL: $Message"
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20261126120000_create_partner_workspace.sql'
$preflightPath = Join-Path $repoRoot 'scripts\verify-production-partner-schema.ps1'
$applyPath = Join-Path $repoRoot 'scripts\apply-production-partner-workspace-migration.ps1'
$postPath = Join-Path $repoRoot 'scripts\verify-production-partner-workspace-post-migration.ps1'
$backupPath = Join-Path $repoRoot 'scripts\backup-production-partner-workspace.ps1'
$backupEvidencePath = Join-Path $repoRoot 'scripts\verify-production-partner-backup-evidence.ps1'
$backupIntegrationTestPath = Join-Path $repoRoot 'scripts\tests\partnerBackupEvidence.Tests.ps1'
$expectedHash = '93C004F7B3D4BF772FEBF12804B5C508956AF0CB3C7CABEBB78D9E1239FEE756'

foreach ($path in @($preflightPath, $applyPath, $postPath, $backupPath, $backupEvidencePath, $backupIntegrationTestPath)) {
  $tokens = $null
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    $path, [ref]$tokens, [ref]$parseErrors
  )
  Assert-True ($parseErrors.Count -eq 0) `
    "PowerShell script must parse: $path $($parseErrors -join '; ')"
}

$migration = Get-Content -LiteralPath $migrationPath -Raw
$preflight = Get-Content -LiteralPath $preflightPath -Raw
$apply = Get-Content -LiteralPath $applyPath -Raw
$post = Get-Content -LiteralPath $postPath -Raw
$backup = Get-Content -LiteralPath $backupPath -Raw
$backupEvidence = Get-Content -LiteralPath $backupEvidencePath -Raw
$actualHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
Assert-True ($actualHash -ceq $expectedHash) 'The approved workspace migration hash must remain pinned.'
Assert-True ($apply.Contains($expectedHash)) 'The one-time runner must pin the exact migration hash.'
Assert-True ($migration -notmatch '(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;') `
  'The migration must not introduce nested transaction boundaries.'
Assert-True ($migration -notmatch '(?im)^\s*(?:INSERT\s+INTO\s+supabase_migrations|CREATE\s+SCHEMA\s+supabase_migrations)') `
  'The migration must not create or alter application migration history.'
Assert-True ($migration -notmatch '(?im)^\s*(?:UPDATE\s+(?:public\.)?(?:admin_users|partner_profiles|partner_sessions|service_orders|service_store_payment_settings)|DELETE\s+FROM\s+(?:auth\.users|public\.(?:admin_users|partner_profiles|partner_sessions|service_orders|service_store_payment_settings)))\b') `
  'The migration must not rewrite existing identity, Admin, or payment rows.'
$allowedDmlTargets = @(
  'public.partner_campaigns',
  'public.partner_campaign_assignments',
  'public.partner_campaign_sites',
  'public.partner_campaign_requests',
  'public.partner_damage_reports',
  'public.partner_proofs',
  'public.partner_stock_movements',
  'public.partner_withdrawal_requests',
  'public.partner_coin_ledger',
  'storage.buckets'
)
$dmlTargets = @(
  [regex]::Matches(
    $migration,
    '(?im)^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)'
  ) | ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() } | Sort-Object -Unique
)
Assert-True (@($dmlTargets | Where-Object { $allowedDmlTargets -notcontains $_ }).Count -eq 0) `
  'Migration DML must be limited to newly introduced partner tables and the guarded private bucket.'
Assert-True ($migration -match '(?im)^\s*on conflict \(id\) do nothing;\s*$' -and
  $migration -notmatch '(?is)on conflict\s*\(id\)\s*do update') `
  'A pre-existing compliant Storage bucket must be left unchanged by the migration.'

$preflightSqlMatch = [regex]::Match($preflight, '(?s)\$sql\s*=\s*@''\r?\n(.*?)\r?\n''@')
Assert-True ($preflightSqlMatch.Success) 'The read-only schema query must be extractable.'
$preflightSql = $preflightSqlMatch.Groups[1].Value
Assert-True ($preflightSql.Contains('BEGIN TRANSACTION READ ONLY;') -and
  $preflightSql.Contains('ROLLBACK;')) 'The schema query must remain read-only and roll back its transaction.'
Assert-True ($preflightSql -notmatch '(?im)^\s*(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE)\b') `
  'The schema preflight must not contain database writes.'
Assert-True ($preflight.Contains('[switch]$SchemaEvidenceOnly') -and
  $preflight.Contains('[switch]$PostMigration')) `
  'The verifier must expose explicit pre/post schema-evidence modes.'
Assert-True ($preflight.Contains('UNVERIFIED (schema-evidence-only; ledger unchanged)') -and
  $preflight.Contains('Alternate migration-history candidates exist')) `
  'Schema-only verification must label history UNVERIFIED and reject alternate ledgers.'
Assert-True ($preflight.Contains('WORKSPACE_DEP|storage_bucket_catalog') -and
  $preflight.Contains('WORKSPACE_DEP|required_database_roles') -and
  $preflight.Contains('WORKSPACE_INDEX_COLLISION')) `
  'The read-only preflight must check storage, roles, and index-name dependencies.'

Assert-True ($apply.Contains('PREFLIGHT ONLY - no Production SQL write was attempted.')) `
  'The default runner mode must stop before Production execution.'
Assert-True ($apply -match '(?s)Invoke-PartnerWorkspaceSchemaVerifier\s*\r?\nAssert-VerifiedBackupEvidence -ArchiveOnly:\$AcknowledgeUnrestoredBackup\s*\r?\nif \(-not \$Apply\)') `
  'The preflight-only mode must report schema results and independently verify backup/recovery evidence before stopping.'
Assert-True ($apply.Contains('BACKUP EVIDENCE REVIEWED SHA256=') -and
  $apply.Contains('BACKUP LIMITATIONS ACKNOWLEDGED FOR') -and
  $apply.Contains('FORWARD RECOVERY READY FOR')) `
  'Production execution must require reviewed backup evidence, coverage-limitations acknowledgment, and recovery-readiness attestation.'
Assert-True ($apply.Contains('[switch]$AcknowledgeUnrestoredBackup') -and
  $apply.Contains('Assert-VerifiedBackupEvidence -ArchiveOnly:$AcknowledgeUnrestoredBackup') -and
  $apply.Contains('I ACKNOWLEDGE RESTORE DRILL FAILED AND APPROVE MIGRATION-SPECIFIC RECOVERY FOR 20261126120000')) `
  'Unrestored-archive execution must be an explicit, migration-specific opt-in with a separate risk acknowledgement.'
Assert-True ($apply.Contains('available only with -Apply') -and
  $apply.Contains('BACKUP ARCHIVE PASS - RESTORE DRILL FAILED; FULL RESTORE UNVERIFIED')) `
  'Archive-only evidence must be unavailable to the default or preflight path and must never claim a restore pass.'
Assert-True ($backupEvidence.Contains('AddHours(-24)') -and
  $backupEvidence.Contains('archiveIntegrity') -and
  $backupEvidence.Contains('restoreDrill.status') -and
  $backupEvidence.Contains('Full archive payload decoding failed')) `
  'Backup evidence must verify recency, hash, archive contents, full decoding, and distinguish restore results.'
Assert-True ($backup.Contains("'--format=custom'") -and
  $backup.Contains("'--password'") -and
  $backup.Contains('Set-PrivateDirectoryAcl') -and
  $backup.Contains('Full isolated database restore') -and
  $backup.Contains("'--disable-triggers'") -and
  $backup.Contains('-h 127.0.0.1')) `
  'Backup capture must use pg_dump, private local storage, and a full loopback-only restore drill.'
Assert-True ($backup.Contains('auth.users') -and $backup.Contains('auth.identities') -and
  $backup.Contains('storage.objects') -and
  $backup.Contains('Storage object bytes live outside PostgreSQL')) `
  'Backup coverage must include Auth and Storage metadata while explicitly documenting external file payloads.'
$wrongBackupTargetRejected = $false
try {
  & $backupPath -ProjectRef 'not-the-production-project' | Out-Null
} catch {
  $wrongBackupTargetRejected = $_.Exception.Message -like '*must exactly match the pinned Production project ref*'
}
Assert-True $wrongBackupTargetRejected `
  'The backup runner must reject a non-Production project before invoking PostgreSQL tools.'
$missingEvidenceRejected = $false
try {
  & $applyPath -ProjectRef 'axbjzmdokfoftzfgwiql' `
    -BackupEvidencePath (Join-Path $env:TEMP ("missing-backup-evidence-" + [guid]::NewGuid().ToString('N') + '.json')) |
    Out-Null
} catch {
  $missingEvidenceRejected = $_.Exception.Message -like '*before connecting to Production*'
}
Assert-True $missingEvidenceRejected `
  'The migration preflight must reject missing backup evidence before opening a Production connection.'
$archiveOnlyPreflightRejected = $false
try {
  & $applyPath -ProjectRef 'axbjzmdokfoftzfgwiql' -AcknowledgeUnrestoredBackup | Out-Null
} catch {
  $archiveOnlyPreflightRejected = $_.Exception.Message -like '*available only with -Apply*'
}
Assert-True $archiveOnlyPreflightRejected `
  'The unrestored-archive exception must not be used by a preflight-only run.'
Assert-True ($apply.Contains("'--single-transaction'") -and
  $apply.Contains("'--set', 'ON_ERROR_STOP=1'")) `
  'Production execution must use one transaction and stop on the first SQL error.'
Assert-True ($apply.Contains('APPLY MIGRATION 20261126120000 SHA256=') -and
  $apply.Contains('Do not retry')) `
  'Production execution must require exact approval and prohibit blind retries.'
Assert-True ($apply.Contains('to_regnamespace(''supabase_migrations'') IS NOT NULL') -and
  $apply.Contains('An alternate migration-history candidate appeared')) `
  'The same-transaction write guard must preserve the no-ledger state.'
Assert-True ($apply -notmatch '(?im)^\s*(?:INSERT\s+INTO\s+supabase_migrations|CREATE\s+SCHEMA\s+supabase_migrations)') `
  'The migration runner must not create or alter migration history.'
Assert-True ($apply -notmatch '(?i)\bvercel\s+deploy\b') `
  'The migration workflow must never deploy the application.'
Assert-True ($post.Contains('-SchemaEvidenceOnly') -and $post.Contains('-PostMigration')) `
  'The post-verifier must independently check schema while keeping history unverified.'
$postTokens = $null
$postParseErrors = $null
$postAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $postPath, [ref]$postTokens, [ref]$postParseErrors
)
$postParameterNames = @(
  $postAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath }
)
Assert-True (($postParameterNames -contains 'ProjectRef') -and
  ($postParameterNames -contains 'PsqlPath') -and
  ($postParameterNames -notcontains 'SchemaEvidenceOnly') -and
  ($postParameterNames -notcontains 'PostMigration')) `
  'The post-verifier wrapper must expose only its declared ProjectRef and PsqlPath parameters.'
$applyTokens = $null
$applyParseErrors = $null
$applyAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $applyPath, [ref]$applyTokens, [ref]$applyParseErrors
)
$schemaVerifierFunction = $applyAst.Find({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Invoke-PartnerWorkspaceSchemaVerifier'
}, $true)
Assert-True ($null -ne $schemaVerifierFunction) `
  'The production runner must define its independent schema-verifier invocation.'
$schemaVerifierFunctionText = $schemaVerifierFunction.Extent.Text
$verifierArgumentsDeclaration = [regex]::Match(
  $schemaVerifierFunctionText,
  '(?s)\$verifierArguments\s*=\s*@\((.*?)\)'
)
Assert-True ($verifierArgumentsDeclaration.Success -and
  $verifierArgumentsDeclaration.Groups[1].Value -notmatch '-SchemaEvidenceOnly' -and
  $schemaVerifierFunctionText.Contains("if (-not `$PostMigration) {") -and
  $schemaVerifierFunctionText.Contains("`$verifierArguments += '-SchemaEvidenceOnly'") -and
  -not $schemaVerifierFunctionText.Contains("`$verifierArguments += '-PostMigration'")) `
  'Only direct schema-verifier calls may receive -SchemaEvidenceOnly; the post-verifier wrapper owns its read-only mode flags.'

Write-Output 'Partner Workspace Production migration safety tests PASS.'
