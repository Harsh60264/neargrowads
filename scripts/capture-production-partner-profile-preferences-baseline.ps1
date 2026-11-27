[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][string]$BackupEvidencePath,
  [string]$OutputPath,
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
  throw 'The migration SHA-256 does not match the reviewed pin.'
}
$evidencePath = [System.IO.Path]::GetFullPath($BackupEvidencePath)
$backupVerifier = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf) -or
  -not (Test-Path -LiteralPath $backupVerifier -PathType Leaf)) {
  throw 'Fresh backup evidence and its independent verifier are required.'
}
$backupOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $backupVerifier `
  -EvidencePath $evidencePath -PgRestorePath $PgRestorePath 2>&1)
if ($LASTEXITCODE -ne 0 -or @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'Independent backup archive and restore verification failed.'
}
$backup = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json -Depth 30 -DateKind String
$backupTime = [DateTimeOffset]::MinValue
if ($backup.projectRef -cne $expectedProjectRef -or $backup.sourceHost -cne $databaseHost -or
  $backup.restoreDrill.status -cne 'PASS' -or
  -not [DateTimeOffset]::TryParse([string]$backup.backupCreatedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$backupTime) -or
  $backupTime -gt [DateTimeOffset]::UtcNow -or $backupTime -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'Backup evidence is not a fresh verified archive and restore for this Production project.'
}

$backupDirectory = [System.IO.Path]::GetDirectoryName($evidencePath)
if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $backupDirectory 'partner-profile-preferences-baseline.json' }
$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$backupPrefix = $backupDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $outputFullPath.StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase) -or
  $outputFullPath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or
  (Test-Path -LiteralPath $outputFullPath)) {
  throw 'Baseline must be a new file inside the protected backup directory and outside the repository.'
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
  'relations', jsonb_build_object(
    'partnerProfiles', to_regclass('public.partner_profiles') IS NOT NULL,
    'partnerProofs', to_regclass('public.partner_proofs') IS NOT NULL,
    'stockMovements', to_regclass('public.partner_stock_movements') IS NOT NULL,
    'coinLedger', to_regclass('public.partner_coin_ledger') IS NOT NULL,
    'campaigns', to_regclass('public.partner_campaigns') IS NOT NULL,
    'assignments', to_regclass('public.partner_campaign_assignments') IS NOT NULL,
    'campaignSites', to_regclass('public.partner_campaign_sites') IS NOT NULL,
    'campaignRequests', to_regclass('public.partner_campaign_requests') IS NOT NULL,
    'damageReports', to_regclass('public.partner_damage_reports') IS NOT NULL,
    'withdrawals', to_regclass('public.partner_withdrawal_requests') IS NOT NULL,
    'authUsers', to_regclass('auth.users') IS NOT NULL,
    'authIdentities', to_regclass('auth.identities') IS NOT NULL,
    'storageBuckets', to_regclass('storage.buckets') IS NOT NULL,
    'storageObjects', to_regclass('storage.objects') IS NOT NULL,
    'deliveryTeamActivity', to_regclass('public.delivery_team_activity') IS NOT NULL,
    'adminUsers', to_regclass('public.admin_users') IS NOT NULL
  ),
  'requiredFunctions', jsonb_build_object(
    'submitIndependentProof', to_regprocedure('public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)') IS NOT NULL,
    'assertDeliveryTeamAdmin', to_regprocedure('public.assert_delivery_team_admin(uuid,text)') IS NOT NULL,
    'availableCoins', to_regprocedure('public.delivery_team_available_coins(uuid)') IS NOT NULL,
    'stockMovementGuard', to_regprocedure('public.enforce_partner_stock_movement()') IS NOT NULL,
    'withdrawalRequest', to_regprocedure('public.request_partner_withdrawal(uuid,integer)') IS NOT NULL
  ),
  'requiredColumns', (
    SELECT jsonb_object_agg(required.name, EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = to_regclass(required.table_name)
        AND a.attname = required.column_name AND a.attnum > 0 AND NOT a.attisdropped
    ) ORDER BY required.name)
    FROM (VALUES
      ('partner_profiles.id', 'public.partner_profiles', 'id'),
      ('partner_profiles.status', 'public.partner_profiles', 'status'),
      ('partner_profiles.full_name', 'public.partner_profiles', 'full_name'),
      ('partner_profiles.email', 'public.partner_profiles', 'email'),
      ('partner_profiles.mobile_number', 'public.partner_profiles', 'mobile_number'),
      ('partner_profiles.created_at', 'public.partner_profiles', 'created_at'),
      ('partner_profiles.last_login_at', 'public.partner_profiles', 'last_login_at'),
      ('partner_campaign_assignments.id', 'public.partner_campaign_assignments', 'id'),
      ('partner_campaign_assignments.partner_profile_id', 'public.partner_campaign_assignments', 'partner_profile_id'),
      ('partner_campaign_assignments.campaign_id', 'public.partner_campaign_assignments', 'campaign_id'),
      ('partner_campaign_assignments.active', 'public.partner_campaign_assignments', 'active'),
      ('partner_campaign_assignments.created_at', 'public.partner_campaign_assignments', 'created_at'),
      ('partner_campaigns.id', 'public.partner_campaigns', 'id'),
      ('partner_campaigns.name', 'public.partner_campaigns', 'name'),
      ('partner_campaigns.area', 'public.partner_campaigns', 'area'),
      ('partner_campaigns.status', 'public.partner_campaigns', 'status'),
      ('partner_campaign_requests.partner_profile_id', 'public.partner_campaign_requests', 'partner_profile_id'),
      ('partner_campaign_requests.status', 'public.partner_campaign_requests', 'status'),
      ('partner_damage_reports.partner_profile_id', 'public.partner_damage_reports', 'partner_profile_id'),
      ('partner_damage_reports.status', 'public.partner_damage_reports', 'status'),
      ('partner_withdrawal_requests.partner_profile_id', 'public.partner_withdrawal_requests', 'partner_profile_id'),
      ('partner_withdrawal_requests.status', 'public.partner_withdrawal_requests', 'status'),
      ('partner_stock_movements.partner_profile_id', 'public.partner_stock_movements', 'partner_profile_id'),
      ('partner_stock_movements.quantity', 'public.partner_stock_movements', 'quantity'),
      ('partner_stock_movements.created_at', 'public.partner_stock_movements', 'created_at'),
      ('partner_coin_ledger.partner_profile_id', 'public.partner_coin_ledger', 'partner_profile_id'),
      ('partner_coin_ledger.created_at', 'public.partner_coin_ledger', 'created_at'),
      ('partner_proofs.partner_profile_id', 'public.partner_proofs', 'partner_profile_id'),
      ('partner_proofs.submitted_at', 'public.partner_proofs', 'submitted_at')
    ) required(name, table_name, column_name)
  ),
  'migrationObjectsAbsent', jsonb_build_object(
    'stateColumn', NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.partner_profiles') AND attname = 'state' AND attnum > 0 AND NOT attisdropped),
    'preferredAreasColumn', NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.partner_profiles') AND attname = 'preferred_delivery_areas' AND attnum > 0 AND NOT attisdropped),
    'stateConstraint', NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.partner_profiles') AND conname = 'partner_profiles_state_india_check'),
    'areasConstraint', NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.partner_profiles') AND conname = 'partner_profiles_preferred_delivery_areas_check'),
    'stateFilteredAdminFunction', to_regprocedure('public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)') IS NULL
  ),
  'profileSchema', jsonb_build_object(
    'rowSecurity', (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.partner_profiles')),
    'forceRowSecurity', (SELECT relforcerowsecurity FROM pg_class WHERE oid = to_regclass('public.partner_profiles')),
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
    'proofFunctionMd5', md5(pg_get_functiondef(to_regprocedure(
      'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'
    ))),
    'assertAdminFunctionMd5', md5(pg_get_functiondef(to_regprocedure('public.assert_delivery_team_admin(uuid,text)'))),
    'availableCoinsFunctionMd5', md5(pg_get_functiondef(to_regprocedure('public.delivery_team_available_coins(uuid)'))),
    'withdrawalThreshold100000', position('100000' IN pg_get_functiondef(
      to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
    )) > 0,
    'privateProofBucket', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE),
    'reservationInvariant', NOT EXISTS (
      SELECT 1 FROM public.partner_profiles p
      LEFT JOIN (SELECT partner_profile_id, sum(quantity) q FROM public.partner_stock_movements GROUP BY partner_profile_id) s ON s.partner_profile_id = p.id
      LEFT JOIN (SELECT partner_profile_id, count(*) q FROM public.partner_proofs WHERE status = 'pending' GROUP BY partner_profile_id) r ON r.partner_profile_id = p.id
      WHERE COALESCE(s.q, 0) < COALESCE(r.q, 0)
    )
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
$tempPath = Join-Path $env:TEMP ('partner-profile-baseline-' + [guid]::NewGuid().ToString('N') + '.json')
$savedEnvironment = $null
try {
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $args = @('--no-psqlrc', '--no-password', '--host', $databaseHost, '--port', '5432',
    '--username', "postgres.$expectedProjectRef", '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--quiet', '--no-align', '--tuples-only', '--output', $tempPath, '--command', $sql)
  $diagnostics = @(& $PsqlPath @args 2>&1)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempPath -PathType Leaf)) {
    throw 'Read-only Production baseline query failed; raw diagnostics were omitted.'
  }
  $snapshot = Get-Content -LiteralPath $tempPath -Raw | ConvertFrom-Json -Depth 50
} finally {
  if ($null -ne $savedEnvironment) { Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment }
  if (Test-Path -LiteralPath $tempPath -PathType Leaf) { Remove-Item -LiteralPath $tempPath -Force }
}

if ($snapshot.identity.database -cne 'postgres' -or $snapshot.identity.user -cne 'postgres' -or
  $snapshot.identity.readOnly -cne 'on' -or $snapshot.identity.primary -ne $true -or
  [string]$snapshot.identity.serverVersionNumber -notmatch '^17') {
  throw 'The baseline was not captured from the pinned PostgreSQL 17 Production primary in READ ONLY mode.'
}
foreach ($property in $snapshot.relations.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "Production dependency is missing: $($property.Name)" }
}
foreach ($property in $snapshot.requiredFunctions.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "Production function dependency is missing: $($property.Name)" }
}
foreach ($property in $snapshot.requiredColumns.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "Production column dependency is missing: $($property.Name)" }
}
foreach ($property in $snapshot.migrationObjectsAbsent.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "A new-migration object already exists: $($property.Name)" }
}
if ($snapshot.history.ledgerExists -ne $false -or @($snapshot.history.candidateRelations).Count -ne 0) {
  throw 'Production migration history is unavailable or has unresolved candidate tables; explicit fallback approval is required.'
}
if ($snapshot.profileSchema.rowSecurity -ne $true -or $snapshot.profileSchema.privateProofBucket -ne $true -or
  $snapshot.profileSchema.withdrawalThreshold100000 -ne $true -or $snapshot.profileSchema.reservationInvariant -ne $true) {
  throw 'A Production RLS, proof-storage, withdrawal, or inventory-reservation prerequisite failed.'
}

$baseline = [ordered]@{
  formatVersion = 1
  projectRef = $expectedProjectRef
  migrationFile = $migrationFile
  migrationVersion = $migrationVersion
  migrationSha256 = $migrationHash
  backupEvidencePath = $evidencePath
  backupSha256 = [string]$backup.sha256
  capturedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
  production = $snapshot
}
[System.IO.File]::WriteAllText($outputFullPath,
  (ConvertTo-Json -InputObject $baseline -Depth 50) + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false))
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
$aclResult = @(& $icacls $outputFullPath '/inheritance:r' '/grant:r' "*${currentSid}:F" '*S-1-5-18:F' '*S-1-5-32-544:F' 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'Baseline captured, but its ACL could not be restricted.' }
$acl = Get-Acl -LiteralPath $outputFullPath
if (-not $acl.AreAccessRulesProtected -or $acl.Access.Count -ne 3) { throw 'Baseline ACL failed its protected-access check.' }
Write-Output "PRODUCTION BASELINE CAPTURE PASS: $outputFullPath"
Write-Output "Migration SHA-256: $migrationHash"
Write-Output "Baseline SHA-256: $((Get-FileHash -LiteralPath $outputFullPath -Algorithm SHA256).Hash)"
Write-Output "History: ledger unavailable; candidates: $(@($snapshot.history.candidateRelations).Count). No ledger entry was written."
Write-Output 'Backup exclusions: Storage object payload files, cluster-global roles/memberships/tablespaces, Supabase project settings/secrets, and external service configuration.'
