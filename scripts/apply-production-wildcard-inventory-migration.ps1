[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$BackupEvidencePath,
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [string]$HistoryFallbackEvidencePath,
  [string]$ConfirmedProjectRef,
  [string]$ConfirmedMigration,
  [switch]$UseApprovedHistoryFallback,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"
$migrationFileName = '20261202120000_wildcard_inventory_restock.sql'
$migrationVersion = '20261202120000'
$expectedMigrationHash = '85577695C220B129A6DAD02CE2812668360B5A5580B7275DA0780A50FB8E01A2'
$requiredPriorVersions = @('20261123120000', '20261126120000', '20261127120000')
$historyFallbackReconstructionMigrations = @(
  '20261019000000', '20261020000000', '20261025110000',
  '20261028130000', '20261028160000', '20261028200000', '20261028230000',
  '20261029100000', '20261029230000', '20261031010000', '20261102100000',
  '20261123120000', '20261126120000', '20261127120000'
)
$expectedRecoveryImage = 'docker.io/supabase/postgres@sha256:df59ef0172dec80053ea186542ba12c8719bb5ca38abbecffd6b7cd6b4075994'

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if ($databaseUser -cne "postgres.$ProjectRef") {
  throw 'The Production database identity does not match the pinned project.'
}
foreach ($tool in @(@{ Path = $PsqlPath; Name = 'psql' }, @{ Path = $PgRestorePath; Name = 'pg_restore' })) {
  if (-not (Test-Path -LiteralPath $tool.Path -PathType Leaf)) {
    throw "Required PostgreSQL 18 tool was not found: $($tool.Path)"
  }
  $toolVersion = (& $tool.Path --version 2>&1 | Out-String).Trim()
  $versionPattern = '^' + [regex]::Escape($tool.Name) + ' \(PostgreSQL\) 18(?:\.|\s|$)'
  if ($LASTEXITCODE -ne 0 -or $toolVersion -notmatch $versionPattern) {
    throw "PostgreSQL 18 is required for $($tool.Path). Detected: $toolVersion"
  }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFileName"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
  throw "The pinned WildCard migration is missing: $migrationFileName"
}
if ((Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -cne $expectedMigrationHash) {
  throw "WildCard migration hash mismatch. Expected $expectedMigrationHash. Nothing was connected or applied."
}
$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
$transactionProbe = [regex]::Replace($migrationSql, '(?s)\$\$.*?\$\$', ' ')
if ($transactionProbe -match '(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;' -or
  $migrationSql -match '(?im)^\s*(?:INSERT|UPDATE|DELETE)\s+.*supabase_migrations') {
  throw 'The pinned migration must not manage transaction boundaries or modify migration history.'
}
if ($migrationSql -match '(?i)\b(?:DROP\s+TABLE|TRUNCATE|CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|ALTER\s+SYSTEM)\b') {
  throw 'The pinned migration contains an operation that is not allowed by the transactional recovery gate.'
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
$fingerprintHelperPath = Join-Path $PSScriptRoot 'wildcardInventorySchemaFingerprint.ps1'
$historyFallbackHelperPath = Join-Path $PSScriptRoot 'wildcardInventoryHistoryFallback.ps1'
$preflightPath = Join-Path $PSScriptRoot 'verify-production-wildcard-inventory-preflight.ps1'
$backupVerifierPath = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
$postVerifierPath = Join-Path $PSScriptRoot 'verify-production-wildcard-inventory-post-migration.ps1'
foreach ($requiredPath in @(
    $environmentHelper, $fingerprintHelperPath, $historyFallbackHelperPath,
    $preflightPath, $backupVerifierPath
  )) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required Production verification file is missing: $requiredPath"
  }
}
. $environmentHelper
. $fingerprintHelperPath
. $historyFallbackHelperPath

function Get-VerifiedBackupEvidencePath {
  if (-not [string]::IsNullOrWhiteSpace($BackupEvidencePath)) {
    return [System.IO.Path]::GetFullPath($BackupEvidencePath)
  }
  $backupRoot = Join-Path $env:LOCALAPPDATA 'NearGrowAds\ProductionBackups'
  if (-not (Test-Path -LiteralPath $backupRoot -PathType Container)) {
    throw 'The ProductionBackups directory was not found. Create and restore a fresh backup first.'
  }
  $manifest = Get-ChildItem -LiteralPath $backupRoot -Directory -Filter 'partner-workspace-*' |
    Sort-Object -Property LastWriteTimeUtc -Descending |
    ForEach-Object { Join-Path $_.FullName 'backup-evidence.json' } |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($manifest)) {
    throw 'No Production backup evidence manifest was found.'
  }
  return $manifest
}

function Invoke-VerifiedBackupCheck {
  $evidencePath = Get-VerifiedBackupEvidencePath
  $powerShell = (Get-Command pwsh -ErrorAction Stop).Source
  $output = @(& $powerShell -NoProfile -File $backupVerifierPath `
    -EvidencePath $evidencePath -PgRestorePath $PgRestorePath 2>&1)
  $exitCode = $LASTEXITCODE
  $outputLines = @($output | ForEach-Object { [string]$_ })
  if ($exitCode -ne 0 -or $outputLines -notcontains 'BACKUP EVIDENCE PASS') {
    throw 'Independent verification of the fresh Production backup and successful restore failed.'
  }
  foreach ($line in $outputLines) {
    Write-Host $line
  }
  return [pscustomobject]@{
    EvidencePath = $evidencePath
    Evidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json -DateKind String
  }
}

function Get-SafePsqlFailureSummary {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][string[]]$Diagnostics
  )

  $diagnosticText = ($Diagnostics | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ }
  }) -join "`n"
  $errorMatch = [regex]::Match($diagnosticText, '(?im)\b(?:ERROR|FATAL):\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)')
  $locationMatch = [regex]::Match($diagnosticText, '(?im)^psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL):')
  if (-not $errorMatch.Success) {
    return "Pinned Production psql operation failed (exit code $ExitCode); raw diagnostics and credentials were omitted."
  }
  $sqlState = $errorMatch.Groups[1].Value.ToUpperInvariant()
  $safeMessage = $errorMatch.Groups[2].Value.Trim() `
    -replace '(?i)\b(?:postgres(?:ql)?|https?)://\S+', '[redacted]' `
    -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+', '$1=[redacted]' `
    -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]' `
    -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[redacted-email]' `
    -replace '(?i)(?<!\d)(?:\+?\d[\s().-]*){10,15}(?!\d)', '[redacted-phone]' `
    -replace '\s+', ' '
  if ($safeMessage.Length -gt 240) { $safeMessage = $safeMessage.Substring(0, 240) + '...' }
  $stateText = if ([string]::IsNullOrWhiteSpace($sqlState)) { 'unavailable' } else { $sqlState }
  $lineText = if ($locationMatch.Success) { "SQL input line $($locationMatch.Groups[1].Value)" } else { 'SQL input line unavailable' }
  return "Pinned Production psql operation failed (exit code $ExitCode, SQLSTATE $stateText, $lineText): $safeMessage. Raw diagnostics and credentials were omitted."
}

function Invoke-PinnedProductionPsql {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [switch]$SingleTransaction
  )

  $temporarySqlPath = Join-Path $env:TEMP ("neargrow-wildcard-production-" + [guid]::NewGuid().ToString('N') + '.sql')
  $temporaryOutputPath = Join-Path $env:TEMP ("neargrow-wildcard-production-" + [guid]::NewGuid().ToString('N') + '.txt')
  $savedEnvironment = $null
  try {
    [System.IO.File]::WriteAllText($temporarySqlPath, $Sql, [System.Text.UTF8Encoding]::new($false))
    $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
    $arguments = @(
      '--no-psqlrc', '--no-password',
      '--host', $databaseHost, '--port', $databasePort,
      '--username', $databaseUser, '--dbname', $databaseName,
      '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose',
      '--set', 'SHOW_CONTEXT=always', '--no-align', '--tuples-only',
      '--field-separator', '|', '--output', $temporaryOutputPath
    )
    if ($SingleTransaction) { $arguments += '--single-transaction' }
    $arguments += @('--file', $temporarySqlPath)
    $diagnostics = @(& $PsqlPath @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      throw (Get-SafePsqlFailureSummary -ExitCode $exitCode -Diagnostics $diagnostics)
    }
    if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
      throw 'Pinned Production psql returned no output file.'
    }
    return @(Get-Content -LiteralPath $temporaryOutputPath)
  } finally {
    if ($null -ne $savedEnvironment) {
      Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
    }
    foreach ($path in @($temporarySqlPath, $temporaryOutputPath)) {
      if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
    }
  }
}

function Get-ValidatedJsonReport {
  param([Parameter(Mandatory = $true)][string[]]$Output)

  $jsonLines = @($Output | ForEach-Object { ([string]$_).Trim() } | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and $_ -notmatch '^(BEGIN|COMMIT|ROLLBACK|SET)$'
  })
  if ($jsonLines.Count -ne 1) {
    throw "Production schema snapshot returned $($jsonLines.Count) non-command output rows; expected one JSON document."
  }
  try {
    $report = $jsonLines[0] | ConvertFrom-Json -Depth 40 -ErrorAction Stop
  } catch {
    throw 'Production schema snapshot returned malformed JSON.'
  }
  if ($null -eq $report -or $report -is [array] -or $report -is [string]) {
    throw 'Production schema snapshot must be one JSON object.'
  }
  return $report
}

function Assert-ProductionSchemaBaseline {
  param([Parameter(Mandatory = $true)][pscustomobject]$Report)

  if ($Report.identity.database -cne 'postgres' -or
    $Report.identity.user -cne 'postgres' -or
    $Report.identity.readOnly -cne 'on' -or
    $Report.identity.inRecovery -ne $false -or
    [string]$Report.identity.serverVersion -notmatch '^17') {
    throw 'Pinned Production database identity, TLS target, or READ ONLY transaction check failed.'
  }
  $expectedTables = @(
    'admin_users', 'delivery_team_activity', 'delivery_team_settings',
    'partner_profiles', 'partner_campaigns', 'partner_campaign_assignments',
    'partner_campaign_sites', 'partner_campaign_requests', 'partner_damage_reports',
    'partner_proofs', 'partner_stock_movements', 'partner_coin_ledger',
    'partner_withdrawal_requests'
  )
  $presentTables = @($Report.relations | Where-Object { $_.exists -eq $true } | ForEach-Object { [string]$_.name })
  foreach ($table in $expectedTables) {
    if ($presentTables -notcontains $table) { throw "Required Production dependency is missing: public.$table" }
  }
  if (@($Report.newMigrationObjects.columns).Count -gt 0 -or
    @($Report.newMigrationObjects.constraints).Count -gt 0 -or
    @($Report.newMigrationObjects.indexes).Count -gt 0 -or
    @($Report.newMigrationObjects.triggers).Count -gt 0 -or
    @($Report.newMigrationObjects.functions).Count -gt 0) {
    $objectSummary = @(
      "columns=$(@($Report.newMigrationObjects.columns) -join ',')",
      "constraints=$(@($Report.newMigrationObjects.constraints) -join ',')",
      "indexes=$(@($Report.newMigrationObjects.indexes) -join ',')",
      "triggers=$(@($Report.newMigrationObjects.triggers) -join ',')",
      "functions=$(@($Report.newMigrationObjects.functions) -join ',')"
    ) -join '; '
    throw "Some WildCard migration objects already exist. Stop; do not apply or repair a partial migration. $objectSummary"
  }
  foreach ($check in $Report.dependencyChecks.PSObject.Properties) {
    if ($check.Value -ne $true) { throw "Production migration dependency failed: $($check.Name)" }
  }
  $requiredFunctions = @($Report.functions | Where-Object { $_.isNew -eq $false })
  if ($requiredFunctions.Count -eq 0) { throw 'Required Delivery Team and partner functions were not returned.' }
  foreach ($function in $requiredFunctions) {
    if ($function.exists -ne $true -or
      $function.securityDefiner -ne $true -or
      $function.owner -cne 'postgres' -or
      @($function.config | Where-Object { $_ -ceq 'search_path=pg_catalog, public' }).Count -ne 1 -or
      $function.serviceRoleExecute -ne $true -or
      $function.anonExecute -ne $false -or
      $function.authenticatedExecute -ne $false) {
      throw "Production function dependency or privilege check failed: $($function.signature)"
    }
  }
  if (@($Report.dataSnapshots).Count -lt 15) {
    throw 'The protected baseline omitted one or more account, partner, coin, stock, campaign, proof, or audit tables.'
  }
  $criticalTables = @('partner_stock_movements', 'partner_campaign_requests', 'partner_coin_ledger', 'delivery_team_settings')
  foreach ($tableName in $criticalTables) {
    $relation = @($Report.relations | Where-Object { $_.name -ceq $tableName })
    if ($relation.Count -ne 1 -or $relation[0].rls -ne $true) {
      throw "Row-level security is not enabled on required Production table public.$tableName."
    }
  }
  $idempotencyIndex = @($Report.indexes | Where-Object {
    $_.name -ceq 'partner_stock_movements_idempotency_unique' -and $_.unique -eq $true -and $_.valid -eq $true
  })
  if ($idempotencyIndex.Count -ne 1) {
    throw 'The existing stock-movement idempotency index is missing or invalid.'
  }
  foreach ($tableName in @('partner_stock_movements', 'partner_campaign_requests', 'partner_coin_ledger')) {
    foreach ($roleName in @('anon', 'authenticated')) {
      foreach ($privilege in @('INSERT', 'UPDATE', 'DELETE')) {
        $partnerGrant = @($Report.tableGrants | Where-Object {
          $_.table -ceq $tableName -and $_.role -ceq $roleName -and $_.privilege -ceq $privilege
        })
        if ($partnerGrant.Count -ne 1 -or $partnerGrant[0].granted -ne $false) {
          throw "Direct $roleName $privilege access must remain unavailable on public.$tableName."
        }
      }
    }
  }
  foreach ($tableName in @('partner_stock_movements', 'partner_campaign_requests', 'partner_coin_ledger')) {
    foreach ($privilege in @('INSERT', 'UPDATE', 'DELETE')) {
      $serviceGrant = @($Report.tableGrants | Where-Object {
        $_.table -ceq $tableName -and $_.role -ceq 'service_role' -and $_.privilege -ceq $privilege
      })
      if ($serviceGrant.Count -ne 1 -or $serviceGrant[0].granted -ne $true) {
        throw "Required backend $privilege access is missing on public.$tableName."
      }
    }
  }
}

$backup = Invoke-VerifiedBackupCheck
$backupEvidence = $backup.Evidence
$createdAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
    [string]$backupEvidence.backupCreatedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$createdAt
  ) -or $createdAt -lt [DateTimeOffset]::UtcNow.AddHours(-24) -or
  $backupEvidence.projectRef -cne $expectedProjectRef -or
  $backupEvidence.restoreDrill.status -cne 'PASS') {
  throw 'Production backup must be less than 24 hours old and have independently verified successful restore evidence.'
}

$preflightOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $preflightPath `
  -ProjectRef $expectedProjectRef -PasswordFilePath $PasswordFilePath -PsqlPath $PsqlPath 2>&1)
$preflightExitCode = $LASTEXITCODE
if ($preflightExitCode -ne 0 -or
  @($preflightOutput | ForEach-Object { [string]$_ }) -notcontains 'New inventory migration objects: ABSENT') {
  throw 'The independent read-only WildCard production preflight failed. No migration was attempted.'
}
foreach ($line in $preflightOutput) { Write-Output ([string]$line) }

$dataSnapshotSql = @'
SELECT 'auth.users'::text AS table_name, count(*)::bigint AS row_count,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), '')) AS digest
FROM auth.users t
UNION ALL
SELECT 'auth.identities', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM auth.identities t
UNION ALL
SELECT 'public.admin_users', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.admin_users t
UNION ALL
SELECT 'public.delivery_team_activity', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.delivery_team_activity t
UNION ALL
SELECT 'public.partner_profiles', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_profiles t
UNION ALL
SELECT 'public.delivery_team_settings', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.delivery_team_settings t
UNION ALL
SELECT 'public.partner_campaigns', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_campaigns t
UNION ALL
SELECT 'public.partner_campaign_assignments', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_campaign_assignments t
UNION ALL
SELECT 'public.partner_campaign_sites', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_campaign_sites t
UNION ALL
SELECT 'public.partner_campaign_requests', count(*)::bigint,
  md5(coalesce(string_agg((to_jsonb(t) - 'stock_quantity')::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_campaign_requests t
UNION ALL
SELECT 'public.partner_damage_reports', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_damage_reports t
UNION ALL
SELECT 'public.partner_proofs', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_proofs t
UNION ALL
SELECT 'public.partner_stock_movements', count(*)::bigint,
  md5(coalesce(string_agg((to_jsonb(t) - 'campaign_request_id' - 'damage_report_id')::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_stock_movements t
UNION ALL
SELECT 'public.partner_coin_ledger', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_coin_ledger t
UNION ALL
SELECT 'public.partner_withdrawal_requests', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_withdrawal_requests t
'@

$schemaSnapshotSql = @"
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
WITH target_tables(name) AS (
  VALUES
    ('admin_users'), ('delivery_team_activity'), ('delivery_team_settings'),
    ('partner_profiles'), ('partner_campaigns'), ('partner_campaign_assignments'),
    ('partner_campaign_sites'), ('partner_campaign_requests'), ('partner_damage_reports'),
    ('partner_proofs'), ('partner_stock_movements'), ('partner_coin_ledger'),
    ('partner_withdrawal_requests')
),
required_functions(signature, is_new) AS (
  VALUES
    ('public.assert_delivery_team_admin(uuid,text)', false),
    ('public.delivery_team_available_coins(uuid)', false),
    ('public.get_partner_coin_summary(uuid)', false),
    ('public.get_delivery_team_overview(uuid)', false),
    ('public.get_delivery_team_partners(uuid,text,text,integer,integer)', false),
    ('public.get_delivery_team_partner_detail(uuid,uuid)', false),
    ('public.admin_review_partner_proof(uuid,uuid,text,text)', false),
    ('public.admin_review_partner_campaign_request(uuid,uuid,text,text,integer)', false),
    ('public.admin_review_partner_damage_report(uuid,uuid,text,text)', false),
    ('public.request_partner_withdrawal(uuid,integer)', false),
    ('public.submit_partner_proof(uuid,uuid,uuid,text,text,double precision,double precision)', false),
    ('public.admin_manage_partner_stock(uuid,uuid,uuid,text,integer,text,uuid)', false),
    ('public.review_partner_proof(uuid,uuid,text,text)', false),
    ('public.review_partner_campaign_request(uuid,uuid,text,text,integer)', false),
    ('public.review_partner_damage_report(uuid,uuid,text)', false),
    ('public.get_partner_inventory_summary(uuid)', true),
    ('public.enforce_partner_stock_movement()', true),
    ('public.request_partner_restock(uuid,integer,text)', true),
    ('public.admin_handover_partner_restock(uuid,uuid,text)', true),
    ('public.apply_partner_proof_review(uuid,uuid,text,text)', true),
    ('public.apply_partner_damage_report_review(uuid,uuid,text,text)', true)
),
data_snapshots AS (
  $dataSnapshotSql
)
SELECT jsonb_build_object(
  'identity', jsonb_build_object(
    'database', current_database(),
    'user', current_user,
    'readOnly', current_setting('transaction_read_only'),
    'inRecovery', pg_is_in_recovery(),
    'serverVersion', current_setting('server_version_num')
  ),
  'relations', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'name', t.name,
      'exists', c.oid IS NOT NULL,
      'rls', coalesce(c.relrowsecurity, false),
      'forceRls', coalesce(c.relforcerowsecurity, false),
      'bytes', CASE WHEN c.oid IS NULL THEN 0 ELSE pg_total_relation_size(c.oid) END
    ) ORDER BY t.name)
    FROM target_tables t
    LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.name)
  ), '[]'::jsonb),
  'columns', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', a.attname,
      'type', format_type(a.atttypid, a.atttypmod),
      'notNull', a.attnotnull,
      'default', coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    ) ORDER BY c.relname, a.attnum)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE n.nspname = 'public' AND c.relname IN (SELECT name FROM target_tables)
      AND a.attnum > 0 AND NOT a.attisdropped
  ), '[]'::jsonb),
  'constraints', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', k.conname, 'type', k.contype::text,
      'definition', pg_get_constraintdef(k.oid, true),
      'validated', k.convalidated, 'deferrable', k.condeferrable
    ) ORDER BY c.relname, k.conname)
    FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (SELECT name FROM target_tables)
  ), '[]'::jsonb),
  'indexes', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'table', t.relname, 'name', i.relname,
      'unique', x.indisunique, 'valid', x.indisvalid,
      'definition', pg_get_indexdef(i.oid)
    ) ORDER BY t.relname, i.relname)
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname IN (SELECT name FROM target_tables)
  ), '[]'::jsonb),
  'triggers', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', g.tgname,
      'enabled', g.tgenabled::text, 'definition', pg_get_triggerdef(g.oid, true)
    ) ORDER BY c.relname, g.tgname)
    FROM pg_trigger g
    JOIN pg_class c ON c.oid = g.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (SELECT name FROM target_tables)
      AND NOT g.tgisinternal
  ), '[]'::jsonb),
  'policies', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'table', c.relname, 'name', p.polname, 'command', p.polcmd::text,
      'roles', coalesce((
        SELECT jsonb_agg(role_name ORDER BY role_name)
        FROM (
          SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(role_oid) END AS role_name
          FROM unnest(p.polroles) AS policy_role(role_oid)
        ) policy_roles
      ), '[]'::jsonb),
      'using', coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
      'check', coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
    ) ORDER BY c.relname, p.polname)
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN (SELECT name FROM target_tables)
  ), '[]'::jsonb),
  'functions', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'signature', r.signature, 'isNew', r.is_new, 'exists', p.oid IS NOT NULL,
      'securityDefiner', coalesce(p.prosecdef, false),
      'owner', CASE WHEN p.oid IS NULL THEN '' ELSE p.proowner::regrole::text END,
      'config', coalesce(to_jsonb(p.proconfig), '[]'::jsonb),
      'acl', coalesce(p.proacl::text, ''),
      'definitionMd5', CASE WHEN p.oid IS NULL THEN '' ELSE md5(pg_get_functiondef(p.oid)) END,
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', p.oid, 'EXECUTE'), false),
      'anonExecute', coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
    ) ORDER BY r.signature)
    FROM required_functions r
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(r.signature)
  ), '[]'::jsonb),
  'tableGrants', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'table', t.name, 'role', r.role_name, 'privilege', p.privilege,
      'granted', has_table_privilege(r.role_name, 'public.' || t.name, p.privilege)
    ) ORDER BY t.name, r.role_name, p.privilege)
    FROM target_tables t
    CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(role_name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(privilege)
    WHERE to_regclass('public.' || t.name) IS NOT NULL
  ), '[]'::jsonb),
  'history', jsonb_build_object(
    'state', CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END,
    'versionColumn', EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'supabase_migrations'
        AND table_name = 'schema_migrations' AND column_name = 'version'
    ),
    'candidates', coalesce((
      SELECT jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', c.relname) ORDER BY n.nspname, c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'vault', 'extensions')
        AND (c.relname ILIKE '%migrat%' OR c.relname ILIKE '%schema_history%' OR c.relname ILIKE '%version%')
    ), '[]'::jsonb)
  ),
  'newMigrationObjects', jsonb_build_object(
    'columns', coalesce((
      SELECT jsonb_agg(table_name || '.' || column_name ORDER BY table_name, column_name)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'partner_campaign_requests' AND column_name = 'stock_quantity')
          OR (table_name = 'partner_stock_movements' AND column_name IN ('campaign_request_id', 'damage_report_id')))
    ), '[]'::jsonb),
    'constraints', coalesce((
      SELECT jsonb_agg(conname ORDER BY conname)
      FROM pg_constraint
      WHERE conname IN (
        'partner_campaign_requests_stock_quantity_check',
        'partner_stock_movements_campaign_request_id_fkey',
        'partner_stock_movements_damage_report_id_fkey'
      )
    ), '[]'::jsonb),
    'indexes', coalesce((
      SELECT jsonb_agg(relname ORDER BY relname)
      FROM pg_class
      WHERE relname IN ('partner_stock_movements_campaign_request_unique', 'partner_stock_movements_damage_report_unique')
        AND relkind = 'i'
    ), '[]'::jsonb),
    'triggers', coalesce((
      SELECT jsonb_agg(tgname ORDER BY tgname)
      FROM pg_trigger
      WHERE tgname = 'partner_stock_movements_inventory_guard' AND NOT tgisinternal
    ), '[]'::jsonb),
    'functions', coalesce((
      SELECT jsonb_agg(signature ORDER BY signature)
      FROM required_functions
      WHERE is_new AND to_regprocedure(signature) IS NOT NULL
    ), '[]'::jsonb)
  ),
  'dependencyChecks', jsonb_build_object(
    'withdrawalThreshold', to_regprocedure('public.request_partner_withdrawal(uuid,integer)') IS NOT NULL
      AND pg_get_functiondef(to_regprocedure('public.request_partner_withdrawal(uuid,integer)')) LIKE '%100000%',
    'proofReservationInvariant', NOT EXISTS (
      SELECT 1
      FROM public.partner_profiles p
      LEFT JOIN (
        SELECT partner_profile_id, sum(quantity) AS on_hand
        FROM public.partner_stock_movements GROUP BY partner_profile_id
      ) s ON s.partner_profile_id = p.id
      LEFT JOIN (
        SELECT partner_profile_id, count(*) AS reserved
        FROM public.partner_proofs WHERE status = 'pending' GROUP BY partner_profile_id
      ) r ON r.partner_profile_id = p.id
      WHERE coalesce(s.on_hand, 0) < coalesce(r.reserved, 0)
    ),
    'requestStatusesCompatible', NOT EXISTS (
      SELECT 1 FROM public.partner_campaign_requests
      WHERE status NOT IN ('pending', 'approved', 'fulfilled', 'rejected')
    ),
    'stockMovementTypesCompatible', NOT EXISTS (
      SELECT 1 FROM public.partner_stock_movements
      WHERE movement_type NOT IN ('issued', 'restocked', 'distributed', 'adjusted', 'returned', 'damaged')
    ),
    'coinLedgerIntegrity', NOT EXISTS (
      SELECT 1 FROM public.partner_coin_ledger
      WHERE NOT (
        (entry_type = 'earning' AND amount > 0 AND proof_id IS NOT NULL AND withdrawal_request_id IS NULL)
        OR (entry_type = 'withdrawal' AND amount < 0 AND proof_id IS NULL AND withdrawal_request_id IS NOT NULL)
        OR (entry_type = 'adjustment' AND amount <> 0 AND proof_id IS NULL AND withdrawal_request_id IS NULL
          AND administrator_id IS NOT NULL AND admin_previous_balance IS NOT NULL
          AND admin_resulting_balance IS NOT NULL)
      )
      OR (entry_type = 'adjustment' AND
        (admin_previous_balance < 0 OR admin_resulting_balance < 0
          OR admin_resulting_balance <> admin_previous_balance + amount))
      OR (admin_reset AND (entry_type <> 'adjustment' OR amount >= 0))
    ),
    'coinLedgerConstraints', (
      SELECT count(*) = 4
      FROM pg_constraint
      WHERE conrelid = 'public.partner_coin_ledger'::regclass
        AND conname IN (
          'partner_coin_ledger_entry_type_check',
          'partner_coin_ledger_entry_integrity_check',
          'partner_coin_ledger_admin_balance_check',
          'partner_coin_ledger_admin_reset_check'
        )
        AND convalidated
    ),
    'partnerInventoryRls', (
      SELECT count(*) = 8 AND bool_and(relrowsecurity)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (
          'partner_profiles', 'partner_campaigns', 'partner_campaign_assignments',
          'partner_campaign_sites', 'partner_campaign_requests', 'partner_damage_reports',
          'partner_proofs', 'partner_stock_movements'
        )
    ),
    'partnerStockDirectWritesBlocked', (
      NOT has_table_privilege('anon', 'public.partner_stock_movements', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.partner_stock_movements', 'INSERT')
      AND NOT has_table_privilege('anon', 'public.partner_stock_movements', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.partner_stock_movements', 'UPDATE')
      AND NOT has_table_privilege('anon', 'public.partner_stock_movements', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.partner_stock_movements', 'DELETE')
      AND has_table_privilege('service_role', 'public.partner_stock_movements', 'INSERT')
      AND has_table_privilege('service_role', 'public.partner_stock_movements', 'UPDATE')
      AND has_table_privilege('service_role', 'public.partner_stock_movements', 'DELETE')
    ),
    'deliveryTeamSettings', (
      SELECT count(*) = 1 AND min(low_stock_threshold) BETWEEN 1 AND 100000
      FROM public.delivery_team_settings WHERE id = true
    ),
    'privateProofBucket', EXISTS (
      SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE
    )
  ),
  'dataSnapshots', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'table', d.table_name, 'rows', d.row_count, 'md5', d.digest
    ) ORDER BY d.table_name)
    FROM data_snapshots d
  ), '[]'::jsonb)
)::text;
ROLLBACK;
"@

$baselineExecution = Invoke-PinnedProductionPsql -Sql $schemaSnapshotSql
$baselineReport = Get-ValidatedJsonReport -Output $baselineExecution
Assert-ProductionSchemaBaseline -Report $baselineReport

$migrationVersions = @()
if ($baselineReport.history.state -ceq 'AVAILABLE') {
  if ($baselineReport.history.versionColumn -ne $true) {
    throw 'The Production migration ledger is present but has no recognizable version column; stop for manual reconciliation.'
  }
  $versionSql = @'
BEGIN TRANSACTION READ ONLY;
SELECT 'VERSION|' || version::text
FROM supabase_migrations.schema_migrations
ORDER BY version::text;
ROLLBACK;
'@
  $versionOutput = Invoke-PinnedProductionPsql -Sql $versionSql
  $migrationVersions = @($versionOutput | ForEach-Object { ([string]$_).Trim() } |
    Where-Object { $_ -like 'VERSION|*' } | ForEach-Object { $_.Substring(8) })
  if (@($migrationVersions | Where-Object { $_ -notmatch '^\d{14}$' }).Count -gt 0) {
    throw 'Production migration history contains an unrecognized version format; manual reconciliation is required.'
  }
  if ($migrationVersions -contains $migrationVersion) {
    throw 'The pinned WildCard migration is already recorded in Production history. Do not rerun it.'
  }
  $missingPrerequisites = @($requiredPriorVersions | Where-Object { $migrationVersions -notcontains $_ })
  if ($missingPrerequisites.Count -gt 0) {
    throw "Production migration history is incomplete for required prerequisites: $($missingPrerequisites -join ', ')."
  }
  $unexpectedHistoryCandidates = @($baselineReport.history.candidates | Where-Object {
    $_.schema -cne 'supabase_migrations' -or $_.name -cne 'schema_migrations'
  })
  if ($unexpectedHistoryCandidates.Count -gt 0) {
    throw 'Additional Production migration-history candidates require manual reconciliation before any write.'
  }
  $baselineReport.history | Add-Member -NotePropertyName versions -NotePropertyValue $migrationVersions -Force
} else {
  $baselineReport.history | Add-Member -NotePropertyName versions -NotePropertyValue @() -Force
  if (@($baselineReport.history.candidates).Count -gt 0) {
    Write-Output 'Historical migration candidates require manual reconciliation:'
    foreach ($candidate in $baselineReport.history.candidates) {
      Write-Output "REVIEW $($candidate.schema).$($candidate.name)"
    }
  }
  Write-Output 'MIGRATION HISTORY UNAVAILABLE: no authoritative Supabase ledger or local Production execution log was found.'
}

$baselineReport | Add-Member -NotePropertyName formatVersion -NotePropertyValue 1 -Force
$baselineReport | Add-Member -NotePropertyName projectRef -NotePropertyValue $expectedProjectRef -Force
$baselineReport | Add-Member -NotePropertyName migrationVersion -NotePropertyValue $migrationVersion -Force
$baselineReport | Add-Member -NotePropertyName migrationFile -NotePropertyValue $migrationFileName -Force
$baselineReport | Add-Member -NotePropertyName migrationSha256 -NotePropertyValue $expectedMigrationHash -Force
$baselineReport | Add-Member -NotePropertyName capturedAtUtc -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString('o')) -Force
$baselineReport | Add-Member -NotePropertyName backupEvidencePath -NotePropertyValue $backup.EvidencePath -Force
$baselineReport | Add-Member -NotePropertyName backupSha256 -NotePropertyValue ([string]$backupEvidence.sha256) -Force

$backupDirectory = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($backup.EvidencePath))
$baselinePath = Join-Path $backupDirectory "wildcard-inventory-baseline-$([DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')).json"
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if ($baselinePath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The Production schema baseline must be stored outside the Git repository.'
}
$parentAcl = Get-Acl -LiteralPath $backupDirectory
if (-not $parentAcl.AreAccessRulesProtected) {
  throw 'The backup directory ACL is not protected; refusing to write the Production schema baseline.'
}
[System.IO.File]::WriteAllText(
  $baselinePath,
  (ConvertTo-Json -InputObject $baselineReport -Depth 40) + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false)
)
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$currentSidObject = [System.Security.Principal.SecurityIdentifier]::new($currentSid)
$fileAcl = [System.Security.AccessControl.FileSecurity]::new()
$fileAcl.SetAccessRuleProtection($true, $false)
$fileAcl.SetOwner($currentSidObject)
$systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$administratorsSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
foreach ($sid in @($currentSidObject, $systemSid, $administratorsSid)) {
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $sid,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  [void]$fileAcl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $baselinePath -AclObject $fileAcl
$allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
$baselineAcl = Get-Acl -LiteralPath $baselinePath
if (-not $baselineAcl.AreAccessRulesProtected) {
  Remove-Item -LiteralPath $baselinePath -Force
  throw 'The Production schema baseline file ACL is not protected from inherited access.'
}
foreach ($rule in $baselineAcl.Access) {
  if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
    $allowedSids -notcontains $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) {
    Remove-Item -LiteralPath $baselinePath -Force
    throw 'The Production schema baseline ACL grants access to an unapproved Windows identity.'
  }
}

Write-Output "Production schema baseline captured outside the repository: $baselinePath"
Write-Output "Pinned migration SHA-256: $expectedMigrationHash"
Write-Output "History state: $($baselineReport.history.state)"
Write-Output "Data-preservation fingerprints captured: $(@($baselineReport.dataSnapshots).Count) tables."
Write-Output 'Backup exclusions: Storage object payload files, cluster-global roles/tablespaces, Supabase project settings/secrets, and external service configuration.'

if ($UseApprovedHistoryFallback -and -not $Apply) {
  throw 'The approved history fallback switch is valid only for the explicit pinned Production apply path.'
}
if (-not [string]::IsNullOrWhiteSpace($HistoryFallbackEvidencePath) -and -not $UseApprovedHistoryFallback) {
  throw 'History fallback evidence cannot be supplied unless the explicit fallback switch is enabled.'
}
if (-not $Apply) {
  Write-Output 'PREFLIGHT ONLY - no Production schema or data write was attempted.'
  if ($baselineReport.history.state -ceq 'UNAVAILABLE') {
    Write-Output 'APPLY BLOCKED - authoritative migration history is unavailable. No history rows were created or changed.'
  }
  return
}

$historyFallbackActive = $false
if ($baselineReport.history.state -ceq 'AVAILABLE') {
  if ($UseApprovedHistoryFallback) {
    throw 'The approved history fallback is only valid when the authoritative Production history is unavailable.'
  }
} else {
  if (-not $UseApprovedHistoryFallback) {
    throw 'Production apply is blocked because authoritative migration history is unavailable. Use the approved, narrowly scoped schema-reconstruction fallback only with its exact protected evidence; no migration was applied.'
  }
  if (@($baselineReport.history.candidates).Count -ne 0) {
    throw 'Production migration-history candidates remain unresolved; the fallback cannot be used.'
  }
  Assert-ApprovedHistoryFallbackEvidence `
    -EvidencePath $HistoryFallbackEvidencePath `
    -BaselinePath $baselinePath `
    -Baseline $baselineReport `
    -BackupPath $backup.EvidencePath `
    -BackupEvidence $backupEvidence `
    -ProjectRef $expectedProjectRef `
    -MigrationVersion $migrationVersion `
    -MigrationFile $migrationFileName `
    -MigrationHash $expectedMigrationHash `
    -RepositoryRoot $repoRoot `
    -ReconstructionImage $expectedRecoveryImage `
    -ReconstructionMigrations $historyFallbackReconstructionMigrations
  $historyFallbackActive = $true
  Write-Output 'APPROVED HISTORY FALLBACK: exact schema/security reconstruction evidence verified; migration history remains unavailable and will not be written.'
}
if (-not (Test-Path -LiteralPath $postVerifierPath -PathType Leaf)) {
  throw 'Independent post-migration verifier is missing; no Production migration was attempted.'
}

$hasProjectConfirmation = -not [string]::IsNullOrWhiteSpace($ConfirmedProjectRef)
$hasMigrationConfirmation = -not [string]::IsNullOrWhiteSpace($ConfirmedMigration)
if ($hasProjectConfirmation -xor $hasMigrationConfirmation) {
  throw 'Both explicit Production confirmation values must be supplied together.'
}
$confirmation = if ($hasProjectConfirmation) {
  $ConfirmedProjectRef
} else {
  Read-Host 'Type the exact Production project ref shown above to authorize the pinned target'
}
if ($confirmation -cne $expectedProjectRef) {
  throw 'Production project reference confirmation did not match; no migration was applied.'
}
$applyConfirmation = "APPLY MIGRATION $migrationVersion SHA256=$expectedMigrationHash TO PRODUCTION $expectedProjectRef"
$migrationConfirmation = if ($hasMigrationConfirmation) {
  $ConfirmedMigration
} else {
  Read-Host "Type exactly: $applyConfirmation"
}
if ($migrationConfirmation -cne $applyConfirmation) {
  throw 'Migration confirmation did not match; no migration was applied.'
}

$expectedDataJson = ConvertTo-Json -InputObject @($baselineReport.dataSnapshots) -Depth 10 -Compress
$dataCheckSql = @"
DO `$data_preservation_guard`$
DECLARE
  expected jsonb := '$($expectedDataJson.Replace("'", "''"))'::jsonb;
  actual jsonb;
BEGIN
  EXECUTE `$snapshot_query`$
    SELECT jsonb_agg(jsonb_build_object(
      'table', s.table_name, 'rows', s.row_count, 'md5', s.digest
    ) ORDER BY s.table_name)
    FROM (
      $dataSnapshotSql
    ) s
  `$snapshot_query`$ INTO actual;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Partner, coin, stock, campaign, proof, or audit data changed after baseline capture';
  END IF;
END;
`$data_preservation_guard`$;
"@

$expectedVersionArraySql = 'ARRAY[' + (@($migrationVersions | ForEach-Object { "'" + $_ + "'" }) -join ', ') + ']::text[]'
if ($historyFallbackActive) {
  $migrationHistoryGuardSql = @'
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     OR current_history_versions IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p', 'v', 'm')
         AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'vault', 'extensions')
         AND (c.relname ILIKE '%migrat%' OR c.relname ILIKE '%schema_history%' OR c.relname ILIKE '%version%')
     ) THEN
    RAISE EXCEPTION 'Production migration history state changed after the approved schema-reconstruction fallback';
  END IF;
'@
} else {
  $migrationHistoryGuardSql = @"
  IF current_history_versions IS DISTINCT FROM $expectedVersionArraySql
     OR to_regclass('supabase_migrations.schema_migrations') IS NULL
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version::text = '20261123120000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version::text = '20261126120000')
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version::text = '20261127120000')
     OR EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version::text = '20261202120000') THEN
    RAISE EXCEPTION 'Production migration history changed after the protected baseline';
  END IF;
"@
}
$writeGuardSql = @'
DO $wildcard_prestate_guard$
DECLARE
  current_history_versions text[];
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT array_agg(version::text ORDER BY version::text) FROM supabase_migrations.schema_migrations'
      INTO current_history_versions;
  END IF;
  __MIGRATION_HISTORY_GUARD__
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR pg_is_in_recovery()
     OR current_setting('transaction_read_only') <> 'off'
     OR to_regclass('public.partner_profiles') IS NULL
     OR to_regclass('public.partner_campaign_requests') IS NULL
     OR to_regclass('public.partner_stock_movements') IS NULL
     OR to_regclass('public.partner_proofs') IS NULL
     OR to_regclass('public.partner_coin_ledger') IS NULL
     OR EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'partner_campaign_requests' AND column_name = 'stock_quantity')
           OR (table_name = 'partner_stock_movements' AND column_name IN ('campaign_request_id', 'damage_report_id')))
     )
     OR to_regprocedure('public.get_partner_inventory_summary(uuid)') IS NOT NULL
     OR to_regprocedure('public.request_partner_restock(uuid,integer,text)') IS NOT NULL
     OR to_regprocedure('public.enforce_partner_stock_movement()') IS NOT NULL
     OR to_regprocedure('public.admin_handover_partner_restock(uuid,uuid,text)') IS NOT NULL
     OR to_regprocedure('public.apply_partner_proof_review(uuid,uuid,text,text)') IS NOT NULL
     OR to_regprocedure('public.apply_partner_damage_report_review(uuid,uuid,text,text)') IS NOT NULL
     OR to_regclass('public.partner_stock_movements_campaign_request_unique') IS NOT NULL
     OR to_regclass('public.partner_stock_movements_damage_report_unique') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgname = 'partner_stock_movements_inventory_guard' AND NOT tgisinternal
     )
     OR to_regprocedure('public.admin_manage_partner_stock(uuid,uuid,uuid,text,integer,text,uuid)') IS NULL
     OR to_regprocedure('public.review_partner_proof(uuid,uuid,text,text)') IS NULL
     OR to_regprocedure('public.review_partner_campaign_request(uuid,uuid,text,text,integer)') IS NULL
     OR to_regprocedure('public.review_partner_damage_report(uuid,uuid,text)') IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname IN (
         'partner_campaign_requests_stock_quantity_check',
         'partner_stock_movements_campaign_request_id_fkey',
         'partner_stock_movements_damage_report_id_fkey'
       )
     )
     OR EXISTS (
       SELECT 1 FROM public.partner_profiles p
       LEFT JOIN (
         SELECT partner_profile_id, sum(quantity) AS on_hand
         FROM public.partner_stock_movements GROUP BY partner_profile_id
       ) s ON s.partner_profile_id = p.id
       LEFT JOIN (
         SELECT partner_profile_id, count(*) AS reserved
         FROM public.partner_proofs WHERE status = 'pending' GROUP BY partner_profile_id
       ) r ON r.partner_profile_id = p.id
       WHERE coalesce(s.on_hand, 0) < coalesce(r.reserved, 0)
     ) THEN
    RAISE EXCEPTION 'Production target, prerequisite history, migration absence, or reservation state changed; stop without applying';
  END IF;
END;
$wildcard_prestate_guard$;
'@
$writeGuardSql = $writeGuardSql.Replace('__MIGRATION_HISTORY_GUARD__', $migrationHistoryGuardSql)

$writeSql = @"
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';
LOCK TABLE
  public.admin_users,
  public.delivery_team_activity,
  public.delivery_team_settings,
  public.partner_profiles,
  public.partner_campaigns,
  public.partner_campaign_assignments,
  public.partner_campaign_sites,
  public.partner_campaign_requests,
  public.partner_damage_reports,
  public.partner_proofs,
  public.partner_stock_movements,
  public.partner_coin_ledger,
  public.partner_withdrawal_requests
IN SHARE ROW EXCLUSIVE MODE;
$writeGuardSql
$dataCheckSql
$migrationSql
$dataCheckSql
"@
try {
  [void](Invoke-PinnedProductionPsql -Sql $writeSql -SingleTransaction)
} catch {
  throw "The Production migration did not return a confirmed successful COMMIT. Single-transaction mode rolls back SQL errors; if the connection failed during COMMIT, the outcome may be uncertain. Do not retry; run the independent read-only verifier. $($_.Exception.Message)"
}

$powerShell = (Get-Command pwsh -ErrorAction Stop).Source
$postVerifierArguments = @(
  '-NoProfile', '-File', $postVerifierPath,
  '-ProjectRef', $expectedProjectRef,
  '-BaselinePath', $baselinePath,
  '-PasswordFilePath', $PasswordFilePath,
  '-PsqlPath', $PsqlPath
)
if ($historyFallbackActive) {
  $postVerifierArguments += @('-HistoryFallbackEvidencePath', $HistoryFallbackEvidencePath)
}
$postOutput = @(& $powerShell @postVerifierArguments 2>&1)
$postExitCode = $LASTEXITCODE
foreach ($line in $postOutput) { Write-Output ([string]$line) }
if ($postExitCode -ne 0 -or
  @($postOutput | ForEach-Object { [string]$_ }) -notcontains 'WILDCARD INVENTORY POST-MIGRATION VERIFICATION PASS') {
  throw 'Migration committed, but independent post-migration verification failed. Do not deploy or retry.'
}
Write-Output 'Post-migration verification passed. No Vercel deployment was started by this runner.'
if ($historyFallbackActive) {
  Write-Output 'UNRESOLVED HISTORY LIMITATION: no authoritative migration ledger or execution log exists; schema reconstruction was the approved fallback, and no ledger entries were invented or modified.'
}
