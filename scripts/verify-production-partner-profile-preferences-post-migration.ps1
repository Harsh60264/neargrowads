[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][string]$BaselinePath,
  [Parameter(Mandatory = $true)][string]$ExpectedBaselineSha256,
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$migrationFile = '20261204120000_partner_profile_delivery_preferences.sql'
$migrationVersion = '20261204120000'
$migrationHash = '35CA7D02DCA45E5D5F5AA760E96979579EDF7230F8B53A018A72BD73C425426C'
$newConstraints = @('partner_profiles_state_india_check', 'partner_profiles_preferred_delivery_areas_check')
$newColumns = @('state', 'preferred_delivery_areas')

if ($ProjectRef -cne $expectedProjectRef) { throw 'ProjectRef does not match the pinned Production project.' }
foreach ($tool in @(@{ Path = $PsqlPath; Name = 'psql' }, @{ Path = $PgRestorePath; Name = 'pg_restore' })) {
  if (-not (Test-Path -LiteralPath $tool.Path -PathType Leaf)) { throw "Required PostgreSQL 18 tool is missing: $($tool.Path)" }
  $versionOutput = (& $tool.Path --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch ('^' + [regex]::Escape($tool.Name) + ' \(PostgreSQL\) 18(?:\.|\s|$)')) {
    throw "PostgreSQL 18 is required for $($tool.Path)."
  }
}
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFile"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf) -or
  (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -cne $migrationHash) {
  throw 'The verified migration no longer matches its pinned SHA-256.'
}
$baselineFullPath = [System.IO.Path]::GetFullPath($BaselinePath)
if (-not (Test-Path -LiteralPath $baselineFullPath -PathType Leaf) -or
  (Get-FileHash -LiteralPath $baselineFullPath -Algorithm SHA256).Hash -cne $ExpectedBaselineSha256.ToUpperInvariant()) {
  throw 'Protected pre-migration baseline is missing or its SHA-256 does not match.'
}
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
$baselineAcl = Get-Acl -LiteralPath $baselineFullPath
if (-not $baselineAcl.AreAccessRulesProtected) { throw 'Production baseline ACL is not protected.' }
foreach ($rule in $baselineAcl.Access) {
  if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
    $allowedSids -notcontains $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) {
    throw 'Production baseline is accessible to an unapproved Windows identity.'
  }
}
$baseline = Get-Content -LiteralPath $baselineFullPath -Raw | ConvertFrom-Json -Depth 50 -DateKind String
if ($baseline.formatVersion -ne 1 -or $baseline.projectRef -cne $expectedProjectRef -or
  $baseline.migrationFile -cne $migrationFile -or $baseline.migrationVersion -cne $migrationVersion -or
  $baseline.migrationSha256 -cne $migrationHash) {
  throw 'Baseline does not attest this exact pinned migration and Production project.'
}
$backupManifestPath = [System.IO.Path]::GetFullPath([string]$baseline.backupEvidencePath)
$backupManifest = Get-Content -LiteralPath $backupManifestPath -Raw | ConvertFrom-Json -Depth 30 -DateKind String
if ($backupManifest.projectRef -cne $expectedProjectRef -or
  $backupManifest.sourceHost -cne $databaseHost -or
  $backupManifest.sha256 -cne $baseline.backupSha256 -or
  $backupManifest.restoreDrill.status -cne 'PASS') {
  throw 'Baseline is not bound to a verified Production backup and successful restore.'
}
$backupVerifier = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
$backupOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $backupVerifier `
  -EvidencePath $backupManifestPath -PgRestorePath $PgRestorePath 2>&1)
if ($LASTEXITCODE -ne 0 -or @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'Independent verification of the Production backup and restore failed.'
}

$sql = @'
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT jsonb_build_object(
  'identity', jsonb_build_object(
    'database', current_database(), 'user', current_user,
    'readOnly', current_setting('transaction_read_only'),
    'primary', NOT pg_is_in_recovery(), 'serverVersionNumber', current_setting('server_version_num')
  ),
  'history', jsonb_build_object(
    'ledgerExists', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'candidateRelations', (
      SELECT COALESCE(jsonb_agg(format('%I.%I', n.nspname, c.relname) ORDER BY n.nspname, c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'vault', 'extensions')
        AND (c.relname ILIKE '%migrat%' OR c.relname ILIKE '%schema_history%' OR c.relname ILIKE '%version%')
    )
  ),
  'objects', jsonb_build_object(
    'columns', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
        'default', COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
      ) ORDER BY a.attnum), '[]'::jsonb)
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = to_regclass('public.partner_profiles') AND a.attnum > 0 AND NOT a.attisdropped
    ),
    'constraints', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', c.conname, 'definition', pg_get_constraintdef(c.oid, true), 'validated', c.convalidated
      ) ORDER BY c.conname), '[]'::jsonb)
      FROM pg_constraint c WHERE c.conrelid = to_regclass('public.partner_profiles')
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', p.polname, 'command', p.polcmd::text, 'roles', ARRAY(
          SELECT r.rolname FROM unnest(p.polroles) AS role_ids(role_oid)
          JOIN pg_roles r ON r.oid = role_ids.role_oid ORDER BY r.rolname
        ), 'using', COALESCE(pg_get_expr(p.polqual, p.polrelid), ''),
        'withCheck', COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
      ) ORDER BY p.polname), '[]'::jsonb)
      FROM pg_policy p WHERE p.polrelid = to_regclass('public.partner_profiles')
    ),
    'rowSecurity', (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.partner_profiles')),
    'forceRowSecurity', (SELECT relforcerowsecurity FROM pg_class WHERE oid = to_regclass('public.partner_profiles')),
    'newFunctions', jsonb_build_object(
      'profileList', to_regprocedure('public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)') IS NOT NULL,
      'proofSubmit', to_regprocedure('public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)') IS NOT NULL
    ),
    'functionSecurity', (
      SELECT jsonb_object_agg(name, (
        proc.oid IS NOT NULL AND proc.prosecdef AND proc.proowner::regrole::text = 'postgres'
        AND COALESCE(proc.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']
        AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
      ) ORDER BY name)
      FROM (VALUES
        ('profileList', 'public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)'),
        ('proofSubmit', 'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)')
      ) required(name, signature)
      LEFT JOIN pg_proc proc ON proc.oid = to_regprocedure(required.signature)
    ),
    'profileListDefinition', pg_get_functiondef(to_regprocedure(
      'public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)'
    )),
    'proofSubmitDefinition', pg_get_functiondef(to_regprocedure(
      'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'
    )),
    'assertAdminFunctionMd5', md5(pg_get_functiondef(to_regprocedure('public.assert_delivery_team_admin(uuid,text)'))),
    'availableCoinsFunctionMd5', md5(pg_get_functiondef(to_regprocedure('public.delivery_team_available_coins(uuid)'))),
    'withdrawalThreshold100000', position('100000' IN pg_get_functiondef(
      to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
    )) > 0,
    'reservationInvariant', NOT EXISTS (
      SELECT 1 FROM public.partner_profiles p
      LEFT JOIN (SELECT partner_profile_id, sum(quantity) q FROM public.partner_stock_movements GROUP BY partner_profile_id) s ON s.partner_profile_id = p.id
      LEFT JOIN (SELECT partner_profile_id, count(*) q FROM public.partner_proofs WHERE status = 'pending' GROUP BY partner_profile_id) r ON r.partner_profile_id = p.id
      WHERE COALESCE(s.q, 0) < COALESCE(r.q, 0)
    )
  ),
  'preservation', (
    SELECT jsonb_object_agg(name, jsonb_build_object('rows', row_count, 'md5', fingerprint) ORDER BY name)
    FROM (
      SELECT 'auth.users' name, count(*)::bigint row_count, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) fingerprint FROM auth.users r
      UNION ALL SELECT 'auth.identities', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM auth.identities r
      UNION ALL SELECT 'storage.buckets', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM storage.buckets r
      UNION ALL SELECT 'storage.objects', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM storage.objects r
      UNION ALL SELECT 'partner_profiles', count(*)::bigint, md5(COALESCE(string_agg((to_jsonb(r) - 'state' - 'preferred_delivery_areas')::text, E'\n' ORDER BY (to_jsonb(r) - 'state' - 'preferred_delivery_areas')::text), '')) FROM public.partner_profiles r
      UNION ALL SELECT 'partner_campaigns', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_campaigns r
      UNION ALL SELECT 'partner_campaign_assignments', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_campaign_assignments r
      UNION ALL SELECT 'partner_campaign_sites', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_campaign_sites r
      UNION ALL SELECT 'partner_campaign_requests', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_campaign_requests r
      UNION ALL SELECT 'partner_damage_reports', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_damage_reports r
      UNION ALL SELECT 'partner_proofs', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_proofs r
      UNION ALL SELECT 'partner_stock_movements', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_stock_movements r
      UNION ALL SELECT 'partner_coin_ledger', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_coin_ledger r
      UNION ALL SELECT 'partner_withdrawal_requests', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.partner_withdrawal_requests r
      UNION ALL SELECT 'delivery_team_activity', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.delivery_team_activity r
      UNION ALL SELECT 'admin_users', count(*)::bigint, md5(COALESCE(string_agg(to_jsonb(r)::text, E'\n' ORDER BY to_jsonb(r)::text), '')) FROM public.admin_users r
    ) snapshots
  )
)::text;
ROLLBACK;
'@

. (Join-Path $PSScriptRoot 'psqlEnvironment.ps1')
$tempPath = Join-Path $env:TEMP ('partner-profile-preferences-post-' + [guid]::NewGuid().ToString('N') + '.json')
$savedEnvironment = $null
try {
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $args = @('--no-psqlrc', '--no-password', '--host', $databaseHost, '--port', '5432',
    '--username', "postgres.$expectedProjectRef", '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--quiet', '--no-align', '--tuples-only', '--output', $tempPath, '--command', $sql)
  $diagnostics = @(& $PsqlPath @args 2>&1)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempPath -PathType Leaf)) {
    throw 'Independent read-only Production post-migration query failed.'
  }
  $report = Get-Content -LiteralPath $tempPath -Raw | ConvertFrom-Json -Depth 50
} finally {
  if ($null -ne $savedEnvironment) { Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment }
  if (Test-Path -LiteralPath $tempPath -PathType Leaf) { Remove-Item -LiteralPath $tempPath -Force }
}

if ($report.identity.database -cne 'postgres' -or $report.identity.user -cne 'postgres' -or
  $report.identity.readOnly -cne 'on' -or $report.identity.primary -ne $true -or
  [string]$report.identity.serverVersionNumber -notmatch '^17') {
  throw 'Independent verifier did not connect to the pinned PostgreSQL 17 Production primary in READ ONLY mode.'
}
if ($report.history.ledgerExists -ne $false -or @($report.history.candidateRelations).Count -ne 0) {
  throw 'Production migration-history state changed; do not create or alter ledger entries.'
}
if ($report.objects.rowSecurity -ne $true -or $report.objects.newFunctions.profileList -ne $true -or
  $report.objects.newFunctions.proofSubmit -ne $true -or
  $report.objects.withdrawalThreshold100000 -ne $true -or $report.objects.reservationInvariant -ne $true) {
  throw 'Independent Production post-migration invariant or authorization check failed.'
}
foreach ($functionName in @('profileList', 'proofSubmit')) {
  if ($report.objects.functionSecurity.$functionName -ne $true) { throw "Function security check failed: $functionName" }
}
$columnMap = @{}
foreach ($column in $report.objects.columns) { $columnMap[[string]$column.name] = $column }
if (@($columnMap.Keys | Where-Object { $_ -in $newColumns }).Count -ne 2 -or
  $columnMap.state.type -cne 'text' -or $columnMap.state.notNull -ne $false -or
  $columnMap.preferred_delivery_areas.type -cne 'text[]' -or $columnMap.preferred_delivery_areas.notNull -ne $true -or
  $columnMap.preferred_delivery_areas.default -cne '''{}''::text[]') {
  throw 'State/profile-preference columns have unexpected types, defaults, or nullability.'
}
$actualConstraints = @($report.objects.constraints | Where-Object { $newConstraints -contains $_.name })
if (@($actualConstraints | ForEach-Object { [string]$_.name } | Sort-Object -CaseSensitive) -join '|' -cne
  (@($newConstraints | Sort-Object -CaseSensitive) -join '|') -or
  @($actualConstraints | Where-Object { $_.validated -ne $true -or $_.definition -notmatch 'CHECK' }).Count -ne 0) {
  throw 'Expected validated Indian-state and preferred-area constraints are missing or malformed.'
}
$baselineColumns = @($baseline.production.profileSchema.columns | Where-Object { $newColumns -notcontains $_.name } |
  Sort-Object -Property name | ConvertTo-Json -Depth 20 -Compress)
$actualColumns = @($report.objects.columns | Where-Object { $newColumns -notcontains $_.name } |
  Sort-Object -Property name | ConvertTo-Json -Depth 20 -Compress)
if ($baselineColumns -cne $actualColumns) { throw 'Existing partner-profile column definitions changed.' }
$baselineConstraints = @($baseline.production.profileSchema.constraints | Where-Object { $newConstraints -notcontains $_.name } |
  Sort-Object -Property name | ConvertTo-Json -Depth 20 -Compress)
$actualOldConstraints = @($report.objects.constraints | Where-Object { $newConstraints -notcontains $_.name } |
  Sort-Object -Property name | ConvertTo-Json -Depth 20 -Compress)
if ($baselineConstraints -cne $actualOldConstraints) { throw 'Existing partner-profile constraints changed.' }
if ((ConvertTo-Json -InputObject @($baseline.production.profileSchema.policies) -Depth 30 -Compress) -cne
  (ConvertTo-Json -InputObject @($report.objects.policies) -Depth 30 -Compress) -or
  [bool]$baseline.production.profileSchema.forceRowSecurity -ne [bool]$report.objects.forceRowSecurity) {
  throw 'Partner-profile RLS policies or force-RLS state changed.'
}
foreach ($functionName in @('assertAdminFunctionMd5', 'availableCoinsFunctionMd5')) {
  if ([string]$report.objects.$functionName -cne [string]$baseline.production.profileSchema.$functionName) {
    throw "Existing database authorization/balance function changed: $functionName"
  }
}
if ($report.objects.profileListDefinition -notmatch 'assert_delivery_team_admin' -or
  $report.objects.proofSubmitDefinition -notmatch 'p_business_name is not null' -or
  $report.objects.proofSubmitDefinition -notmatch 'p_business_category is not null') {
  throw 'Admin authorization or optional legacy proof metadata behavior is not present.'
}
foreach ($tableName in $baseline.production.preservation.PSObject.Properties.Name) {
  $expected = $baseline.production.preservation.PSObject.Properties[$tableName].Value
  $actualProperty = $report.preservation.PSObject.Properties[$tableName]
  if ($null -eq $actualProperty -or [long]$actualProperty.Value.rows -ne [long]$expected.rows -or
    [string]$actualProperty.Value.md5 -cne [string]$expected.md5) {
    throw "Production data-preservation fingerprint mismatch: $tableName"
  }
}
if (@($report.preservation.PSObject.Properties).Count -ne @($baseline.production.preservation.PSObject.Properties).Count) {
  throw 'Production preservation snapshot table set changed.'
}

Write-Output 'PARTNER PROFILE PREFERENCES POST-MIGRATION VERIFICATION PASS'
Write-Output "Project: $expectedProjectRef / postgres; migration: $migrationVersion ($migrationHash)"
Write-Output 'Profile schema, RLS/function grants, historical proof API compatibility, and account/campaign/proof/stock/coin fingerprints: PASS'
Write-Output 'Migration history remains unavailable and unchanged; no ledger entries were invented or written.'
