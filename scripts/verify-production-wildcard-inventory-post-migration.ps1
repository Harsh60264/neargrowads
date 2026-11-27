[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [Parameter(Mandatory = $true)]
  [string]$BaselinePath,
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [string]$HistoryFallbackEvidencePath
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
  throw 'ProjectRef does not match the pinned Production project.'
}
if (-not (Test-Path -LiteralPath $BaselinePath -PathType Leaf)) {
  throw 'The protected pre-migration schema baseline was not found.'
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}
if (-not (Test-Path -LiteralPath $PgRestorePath -PathType Leaf)) {
  throw "PostgreSQL 18 pg_restore.exe was not found at: $PgRestorePath"
}
$psqlVersion = (& $PsqlPath --version 2>&1 | Out-String).Trim()
$psqlExitCode = $LASTEXITCODE
$restoreVersion = (& $PgRestorePath --version 2>&1 | Out-String).Trim()
$restoreExitCode = $LASTEXITCODE
if ($psqlExitCode -ne 0 -or $psqlVersion -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 psql is required. Detected: $psqlVersion"
}
if ($restoreExitCode -ne 0 -or $restoreVersion -notmatch '^pg_restore \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 pg_restore is required. Detected: $restoreVersion"
}

$baseline = Get-Content -LiteralPath $BaselinePath -Raw | ConvertFrom-Json -Depth 40 -DateKind String
if ($baseline.formatVersion -ne 1 -or
  $baseline.projectRef -cne $expectedProjectRef -or
  $baseline.migrationVersion -cne $migrationVersion -or
  $baseline.migrationFile -cne $migrationFileName -or
  $baseline.migrationSha256 -cne $expectedMigrationHash) {
  throw 'The baseline does not attest this exact pinned Production migration.'
}
if ($baseline.history.state -ceq 'AVAILABLE') {
  if ([string]::IsNullOrWhiteSpace($HistoryFallbackEvidencePath) -eq $false -or
    @($baseline.history.versions).Count -eq 0) {
    throw 'The available-history baseline cannot use the history fallback.'
  }
  if (@($baseline.history.versions | Where-Object { $_ -ceq $migrationVersion }).Count -gt 0) {
    throw 'The baseline already records this migration; the verifier will not certify a rerun.'
  }
  foreach ($version in $requiredPriorVersions) {
    if (@($baseline.history.versions | Where-Object { $_ -ceq $version }).Count -ne 1) {
      throw "Baseline is missing authoritative prerequisite migration version $version."
    }
  }
  $historyFallbackActive = $false
} elseif ($baseline.history.state -ceq 'UNAVAILABLE') {
  if ([string]::IsNullOrWhiteSpace($HistoryFallbackEvidencePath) -or
    @($baseline.history.candidates).Count -ne 0 -or
    @($baseline.history.versions).Count -ne 0) {
    throw 'Unavailable migration history requires the exact approved fallback evidence and zero unresolved candidates.'
  }
  $historyFallbackActive = $true
} else {
  throw 'The protected baseline has an unrecognized migration-history state.'
}
$capturedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
    [string]$baseline.capturedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$capturedAt
  ) -or $capturedAt -gt [DateTimeOffset]::UtcNow -or
  $capturedAt -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'The independent verifier requires the schema/data baseline from the last 24 hours.'
}
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
$baselineAcl = Get-Acl -LiteralPath $BaselinePath
if (-not $baselineAcl.AreAccessRulesProtected) {
  throw 'The schema baseline ACL is not protected from inherited access.'
}
foreach ($rule in $baselineAcl.Access) {
  if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
    $allowedSids -notcontains $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) {
    throw 'The schema baseline ACL grants access to an unapproved Windows identity.'
  }
}
$backupManifest = Get-Content -LiteralPath ([string]$baseline.backupEvidencePath) -Raw | ConvertFrom-Json -DateKind String
if ($backupManifest.projectRef -cne $expectedProjectRef -or
  $backupManifest.sha256 -cne $baseline.backupSha256) {
  throw 'The post-migration verifier backup evidence does not match the baseline manifest identity and archive hash.'
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
$fingerprintHelperPath = Join-Path $PSScriptRoot 'wildcardInventorySchemaFingerprint.ps1'
$historyFallbackHelperPath = Join-Path $PSScriptRoot 'wildcardInventoryHistoryFallback.ps1'
$backupVerifierPath = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
foreach ($requiredPath in @($environmentHelper, $fingerprintHelperPath, $historyFallbackHelperPath, $backupVerifierPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required verification file is missing: $requiredPath"
  }
}
. $environmentHelper
. $fingerprintHelperPath
. $historyFallbackHelperPath

$backupOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $backupVerifierPath `
  -EvidencePath ([string]$baseline.backupEvidencePath) -PgRestorePath $PgRestorePath 2>&1)
$backupExitCode = $LASTEXITCODE
if ($backupExitCode -ne 0 -or
  @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'Independent verification of the recovery archive and isolated restore evidence failed.'
}
if ($historyFallbackActive) {
  $repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  Assert-ApprovedHistoryFallbackEvidence `
    -EvidencePath $HistoryFallbackEvidencePath `
    -BaselinePath $BaselinePath `
    -Baseline $baseline `
    -BackupPath ([string]$baseline.backupEvidencePath) `
    -BackupEvidence $backupManifest `
    -ProjectRef $expectedProjectRef `
    -MigrationVersion $migrationVersion `
    -MigrationFile $migrationFileName `
    -MigrationHash $expectedMigrationHash `
    -RepositoryRoot $repoRoot `
    -ReconstructionImage $expectedRecoveryImage `
    -ReconstructionMigrations $historyFallbackReconstructionMigrations
}
Write-Host 'Fresh Production backup and isolated restore evidence: PASS'

function Get-SafePsqlFailureSummary {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][object[]]$Diagnostics
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
  param([Parameter(Mandatory = $true)][string]$Sql)

  $temporarySqlPath = Join-Path $env:TEMP ("neargrow-wildcard-post-verify-" + [guid]::NewGuid().ToString('N') + '.sql')
  $temporaryOutputPath = Join-Path $env:TEMP ("neargrow-wildcard-post-verify-" + [guid]::NewGuid().ToString('N') + '.txt')
  $savedEnvironment = $null
  try {
    [System.IO.File]::WriteAllText($temporarySqlPath, $Sql, [System.Text.UTF8Encoding]::new($false))
    $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
    $arguments = @(
      '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
      '--set', 'VERBOSITY=verbose', '--set', 'SHOW_CONTEXT=always',
      '--no-align', '--tuples-only', '--field-separator', '|',
      '--host', $databaseHost, '--port', $databasePort,
      '--username', $databaseUser, '--dbname', $databaseName,
      '--output', $temporaryOutputPath, '--file', $temporarySqlPath
    )
    $diagnostics = @(& $PsqlPath @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      throw (Get-SafePsqlFailureSummary -ExitCode $exitCode -Diagnostics $diagnostics)
    }
    if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
      throw 'Pinned Production psql returned no verifier output file.'
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

function Get-ValidatedSchemaResults {
  param([Parameter(Mandatory = $true)][string[]]$Output)

  $jsonLines = @($Output | ForEach-Object { ([string]$_).Trim() } | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and $_ -notmatch '^(BEGIN|COMMIT|ROLLBACK|SET)$'
  })
  if ($jsonLines.Count -ne 1) {
    throw "Independent Production verifier returned $($jsonLines.Count) non-command rows; expected one JSON document."
  }
  try {
    $report = $jsonLines[0] | ConvertFrom-Json -Depth 40 -ErrorAction Stop
  } catch {
    throw 'Independent Production verifier returned malformed JSON.'
  }
  if ($null -eq $report -or $report -is [array] -or $report -is [string]) {
    throw 'Independent Production verifier must return one JSON object.'
  }
  return $report
}

function Get-CanonicalJson {
  param([Parameter(Mandatory = $true)][AllowNull()][object]$Value)
  return ConvertTo-Json -InputObject $Value -Depth 40 -Compress
}

function Test-StockQuantityConstraintDefinition {
  param([Parameter(Mandatory = $true)][string]$Definition)
  return $Definition -match '(?is)(?:between\s+1\s+and\s+100|stock_quantity\s*>=\s*1.*?stock_quantity\s*<=\s*100)'
}

function Assert-EqualJson {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][object]$Expected,
    [Parameter(Mandatory = $true)][object]$Actual
  )
  if ((Get-CanonicalJson -Value $Expected) -cne (Get-CanonicalJson -Value $Actual)) {
    throw "Independent post-migration preservation check failed: $Name differs from the protected baseline."
  }
}

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
SELECT 'public.delivery_team_settings', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.delivery_team_settings t
UNION ALL
SELECT 'public.partner_profiles', count(*)::bigint,
  md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' ORDER BY t.id::text), ''))
FROM public.partner_profiles t
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

$schemaSql = @"
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
    'database', current_database(), 'user', current_user,
    'readOnly', current_setting('transaction_read_only'),
    'inRecovery', pg_is_in_recovery(),
    'serverVersion', current_setting('server_version_num')
  ),
  'relations', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'name', t.name, 'exists', c.oid IS NOT NULL,
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
    'candidates', coalesce((
      SELECT jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', c.relname) ORDER BY n.nspname, c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
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
      FROM required_functions WHERE is_new AND to_regprocedure(signature) IS NOT NULL
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
    'privateProofBucket', EXISTS (
      SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE
    ),
    'minimumWithdrawalThreshold', to_regprocedure('public.request_partner_withdrawal(uuid,integer)') IS NOT NULL
      AND pg_get_functiondef(to_regprocedure('public.request_partner_withdrawal(uuid,integer)')) LIKE '%100000%'
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

$report = Get-ValidatedSchemaResults -Output (Invoke-PinnedProductionPsql -Sql $schemaSql)
if ($report.identity.database -cne 'postgres' -or
  $report.identity.user -cne 'postgres' -or
  $report.identity.readOnly -cne 'on' -or
  $report.identity.inRecovery -ne $false -or
  [string]$report.identity.serverVersion -notmatch '^17') {
  throw 'Independent verifier did not connect to the pinned writable Production primary in a READ ONLY transaction.'
}
if ($historyFallbackActive) {
  if ($report.history.state -cne 'UNAVAILABLE' -or @($report.history.candidates).Count -ne 0) {
    throw 'The approved fallback requires Production migration history to remain unavailable with no new candidates.'
  }
  Write-Host 'Approved fallback post-check: history remains unavailable; no migration ledger was added or changed.'
} else {
  if ($report.history.state -cne 'AVAILABLE') {
    throw 'Production migration history disappeared after migration; verification is incomplete.'
  }
  $versionSql = @'
BEGIN TRANSACTION READ ONLY;
SELECT 'VERSION|' || version::text
FROM supabase_migrations.schema_migrations
ORDER BY version::text;
ROLLBACK;
'@
  $versionOutput = Invoke-PinnedProductionPsql -Sql $versionSql
  $currentVersions = @($versionOutput | ForEach-Object { ([string]$_).Trim() } |
    Where-Object { $_ -like 'VERSION|*' } | ForEach-Object { $_.Substring(8) })
  if (@(Compare-Object @($baseline.history.versions) $currentVersions).Count -gt 0) {
    throw 'Production migration history changed. This runner must not insert or edit migration ledger entries.'
  }
}

$expectedNewColumns = @(
  'partner_campaign_requests.stock_quantity',
  'partner_stock_movements.campaign_request_id',
  'partner_stock_movements.damage_report_id'
)
$expectedNewConstraints = @(
  'partner_campaign_requests_stock_quantity_check',
  'partner_stock_movements_campaign_request_id_fkey',
  'partner_stock_movements_damage_report_id_fkey'
)
$expectedNewIndexes = @(
  'partner_stock_movements_campaign_request_unique',
  'partner_stock_movements_damage_report_unique'
)
$expectedNewFunctions = @(
  'public.get_partner_inventory_summary(uuid)',
  'public.enforce_partner_stock_movement()',
  'public.request_partner_restock(uuid,integer,text)',
  'public.admin_handover_partner_restock(uuid,uuid,text)',
  'public.apply_partner_proof_review(uuid,uuid,text,text)',
  'public.apply_partner_damage_report_review(uuid,uuid,text,text)'
)
foreach ($collection in @(
    @{ Name = 'columns'; Expected = $expectedNewColumns; Actual = @($report.newMigrationObjects.columns) },
    @{ Name = 'constraints'; Expected = $expectedNewConstraints; Actual = @($report.newMigrationObjects.constraints) },
    @{ Name = 'indexes'; Expected = $expectedNewIndexes; Actual = @($report.newMigrationObjects.indexes) },
    @{ Name = 'triggers'; Expected = @('partner_stock_movements_inventory_guard'); Actual = @($report.newMigrationObjects.triggers) },
    @{ Name = 'functions'; Expected = $expectedNewFunctions; Actual = @($report.newMigrationObjects.functions) }
  )) {
  $expectedSorted = @($collection.Expected | Sort-Object -CaseSensitive)
  $actualSorted = @($collection.Actual | ForEach-Object { [string]$_ } | Sort-Object -CaseSensitive)
  if ((Get-CanonicalJson -Value $expectedSorted) -cne (Get-CanonicalJson -Value $actualSorted)) {
    throw "Independent post-migration verifier found an incomplete or unexpected object set: $($collection.Name)."
  }
}

$baselineRelations = @($baseline.relations | Sort-Object -Property name | ForEach-Object {
  "$($_.name)|$($_.exists)|$($_.rls)|$($_.forceRls)"
})
$currentRelations = @($report.relations | Sort-Object -Property name | ForEach-Object {
  "$($_.name)|$($_.exists)|$($_.rls)|$($_.forceRls)"
})
Assert-EqualJson -Name 'relation RLS state' -Expected $baselineRelations -Actual $currentRelations
Assert-EqualJson -Name 'RLS policies' -Expected @($baseline.policies) -Actual @($report.policies)
Assert-EqualJson -Name 'table grants' -Expected @($baseline.tableGrants) -Actual @($report.tableGrants)

$baselineColumns = @($baseline.columns | Where-Object {
  $key = "$($_.table).$($_.name)"
  $expectedNewColumns -notcontains $key
} | ForEach-Object {
  $notNull = [bool]$_.notNull
  if ($_.table -in @('partner_campaign_requests', 'partner_stock_movements') -and $_.name -ceq 'assignment_id') {
    $notNull = $false
  }
  "$($_.table)|$($_.name)|$($_.type)|$notNull|$($_.default)"
} | Sort-Object -CaseSensitive)
$currentColumns = @($report.columns | Where-Object {
  $key = "$($_.table).$($_.name)"
  $expectedNewColumns -notcontains $key
} | ForEach-Object {
  "$($_.table)|$($_.name)|$($_.type)|$([bool]$_.notNull)|$($_.default)"
} | Sort-Object -CaseSensitive)
Assert-EqualJson -Name 'existing column definitions' -Expected $baselineColumns -Actual $currentColumns
foreach ($columnName in $expectedNewColumns) {
  $parts = $columnName.Split('.', 2)
  $newColumn = @($report.columns | Where-Object { $_.table -ceq $parts[0] -and $_.name -ceq $parts[1] })
  if ($newColumn.Count -ne 1 -or $newColumn[0].notNull -ne $false) {
    throw "New nullable inventory column is missing or invalid: $columnName"
  }
}

$changedConstraintNames = @(
  'partner_campaign_requests_status_check',
  'partner_campaign_requests_stock_quantity_check',
  'partner_stock_movements_movement_type_check',
  'partner_stock_movements_campaign_request_id_fkey',
  'partner_stock_movements_damage_report_id_fkey'
)
$baselineConstraints = @($baseline.constraints | Where-Object { $changedConstraintNames -notcontains $_.name } |
  Sort-Object -Property table, name)
$currentConstraints = @($report.constraints | Where-Object { $changedConstraintNames -notcontains $_.name } |
  Sort-Object -Property table, name)
Assert-EqualJson -Name 'unmodified constraints' -Expected $baselineConstraints -Actual $currentConstraints
$statusConstraint = @($report.constraints | Where-Object { $_.name -ceq 'partner_campaign_requests_status_check' })
$stockQuantityConstraint = @($report.constraints | Where-Object { $_.name -ceq 'partner_campaign_requests_stock_quantity_check' })
$movementConstraint = @($report.constraints | Where-Object { $_.name -ceq 'partner_stock_movements_movement_type_check' })
$requestForeignKey = @($report.constraints | Where-Object { $_.name -ceq 'partner_stock_movements_campaign_request_id_fkey' })
$damageForeignKey = @($report.constraints | Where-Object { $_.name -ceq 'partner_stock_movements_damage_report_id_fkey' })
if ($statusConstraint.Count -ne 1 -or
  $statusConstraint[0].definition -notmatch 'pending.*approved.*fulfilled.*rejected' -or
  $stockQuantityConstraint.Count -ne 1 -or
  -not (Test-StockQuantityConstraintDefinition -Definition ([string]$stockQuantityConstraint[0].definition)) -or
  $movementConstraint.Count -ne 1 -or
  $movementConstraint[0].definition -notmatch 'issued.*restocked.*distributed.*adjusted.*returned.*damaged' -or
  $requestForeignKey.Count -ne 1 -or $requestForeignKey[0].validated -ne $true -or
  $requestForeignKey[0].definition -notmatch 'partner_campaign_requests\(id\).*ON DELETE RESTRICT' -or
  $damageForeignKey.Count -ne 1 -or $damageForeignKey[0].validated -ne $true -or
  $damageForeignKey[0].definition -notmatch 'partner_damage_reports\(id\).*ON DELETE RESTRICT') {
  throw 'The new request, movement, or foreign-key constraints do not match the reviewed migration.'
}

$newIndexNames = @($expectedNewIndexes)
$baselineIndexes = @($baseline.indexes | Where-Object { $newIndexNames -notcontains $_.name } |
  Sort-Object -Property table, name)
$currentIndexes = @($report.indexes | Where-Object { $newIndexNames -notcontains $_.name } |
  Sort-Object -Property table, name)
Assert-EqualJson -Name 'unmodified indexes' -Expected $baselineIndexes -Actual $currentIndexes
foreach ($indexName in $expectedNewIndexes) {
  $index = @($report.indexes | Where-Object { $_.name -ceq $indexName })
  $predicate = switch ($indexName) {
    'partner_stock_movements_campaign_request_unique' { 'campaign_request_id' }
    'partner_stock_movements_damage_report_unique' { 'damage_report_id' }
  }
  if ($index.Count -ne 1 -or $index[0].unique -ne $true -or $index[0].valid -ne $true -or
    $index[0].definition -notmatch "(?i)where.*$predicate IS NOT NULL") {
    throw "Expected unique inventory idempotency index is missing or invalid: $indexName"
  }
}

$baselineTriggers = @($baseline.triggers | Where-Object { $_.name -cne 'partner_stock_movements_inventory_guard' } |
  Sort-Object -Property table, name)
$currentTriggers = @($report.triggers | Where-Object { $_.name -cne 'partner_stock_movements_inventory_guard' } |
  Sort-Object -Property table, name)
Assert-EqualJson -Name 'unmodified triggers' -Expected $baselineTriggers -Actual $currentTriggers
$inventoryTrigger = @($report.triggers | Where-Object { $_.name -ceq 'partner_stock_movements_inventory_guard' })
if ($inventoryTrigger.Count -ne 1 -or $inventoryTrigger[0].table -cne 'partner_stock_movements' -or
  $inventoryTrigger[0].enabled -cne 'O' -or
  $inventoryTrigger[0].definition -notmatch '(?i)before insert.*enforce_partner_stock_movement') {
  throw 'The guarded stock movement trigger is missing, disabled, or bound to an unexpected routine.'
}

$requiredServiceRoleFunctions = @(
  'public.get_partner_inventory_summary(uuid)',
  'public.request_partner_restock(uuid,integer,text)',
  'public.admin_manage_partner_stock(uuid,uuid,uuid,text,integer,text,uuid)',
  'public.admin_handover_partner_restock(uuid,uuid,text)',
  'public.admin_review_partner_proof(uuid,uuid,text,text)',
  'public.review_partner_proof(uuid,uuid,text,text)',
  'public.review_partner_campaign_request(uuid,uuid,text,text,integer)',
  'public.submit_partner_proof(uuid,uuid,uuid,text,text,double precision,double precision)',
  'public.admin_review_partner_campaign_request(uuid,uuid,text,text,integer)',
  'public.admin_review_partner_damage_report(uuid,uuid,text,text)',
  'public.review_partner_damage_report(uuid,uuid,text)',
  'public.get_delivery_team_partners(uuid,text,text,integer,integer)',
  'public.get_delivery_team_partner_detail(uuid,uuid)'
)
foreach ($function in $report.functions) {
  if ($function.exists -ne $true -or $function.securityDefiner -ne $true -or $function.owner -cne 'postgres' -or
    @($function.config | Where-Object { $_ -ceq 'search_path=pg_catalog, public' }).Count -ne 1 -or
    $function.anonExecute -ne $false -or $function.authenticatedExecute -ne $false) {
    throw "Privileged function security or grant check failed: $($function.signature)"
  }
  if ($requiredServiceRoleFunctions -contains $function.signature -and $function.serviceRoleExecute -ne $true) {
    throw "Required service_role execution grant is missing: $($function.signature)"
  }
}

if ($report.dependencyChecks.withdrawalThreshold -ne $true -or
  $report.dependencyChecks.minimumWithdrawalThreshold -ne $true -or
  $report.dependencyChecks.proofReservationInvariant -ne $true -or
  $report.dependencyChecks.privateProofBucket -ne $true) {
  throw 'An existing withdrawal, proof-reservation, or private-storage invariant failed.'
}
Assert-EqualJson -Name 'partner, coin, stock, campaign, proof, and audit records' `
  -Expected @($baseline.dataSnapshots) -Actual @($report.dataSnapshots)

Write-Output 'WILDCARD INVENTORY POST-MIGRATION VERIFICATION PASS'
Write-Output "Project: $expectedProjectRef / $databaseName"
Write-Output "Migration: $migrationVersion (SHA-256 $expectedMigrationHash)"
Write-Output 'Schema, constraints, indexes, trigger, function grants, RLS policies, and preserved data fingerprints: PASS'
if ($historyFallbackActive) {
  Write-Output 'UNRESOLVED HISTORY LIMITATION: schema reconstruction was the approved fallback; authoritative historical migration execution remains unproven.'
} else {
  Write-Output 'Authoritative Production migration history preservation: PASS'
}
