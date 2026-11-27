[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][string]$BackupEvidencePath,
  [Parameter(Mandatory = $true)][string]$BaselinePath,
  [Parameter(Mandatory = $true)][string]$ExpectedBaselineSha256,
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$expectedDatabaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$migrationFile = '20261205120000_partner_registration_location_details.sql'
$migrationVersion = '20261205120000'
$migrationHash = 'C111CF62CE8439514C87EF214CBDD0F3757D5DBF48A649E0BA5B2110E33CE8F6'
$locationColumns = @(
  'registration_location_address', 'registration_location_latitude', 'registration_location_longitude',
  'registration_location_accuracy_meters', 'registration_location_captured_at',
  'registration_location_address_source', 'registration_location_components',
  'current_location_address', 'current_location_latitude', 'current_location_longitude',
  'current_location_accuracy_meters', 'current_location_captured_at',
  'current_location_address_source', 'current_location_components'
)
$locationConstraints = @('partner_profiles_registration_location_check', 'partner_profiles_current_location_check')

function Get-CanonicalJson {
  param([AllowNull()][object]$Value)
  return ConvertTo-Json -InputObject $Value -Depth 60 -Compress
}

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
  throw 'Migration SHA-256 does not match the reviewed pin.'
}

$backupManifestPath = [System.IO.Path]::GetFullPath($BackupEvidencePath)
$backupVerifier = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
$backupOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $backupVerifier `
  -EvidencePath $backupManifestPath -PgRestorePath $PgRestorePath 2>&1)
if ($LASTEXITCODE -ne 0 -or @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'Fresh Production backup and isolated restore evidence failed independent verification.'
}
$backup = Get-Content -LiteralPath $backupManifestPath -Raw | ConvertFrom-Json -Depth 30 -DateKind String
$backupCreatedAt = [DateTimeOffset]::MinValue
if ($backup.projectRef -cne $expectedProjectRef -or $backup.sourceHost -cne $expectedDatabaseHost -or
  $backup.database -cne 'postgres' -or $backup.restoreDrill.status -cne 'PASS' -or
  -not [DateTimeOffset]::TryParse([string]$backup.backupCreatedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$backupCreatedAt) -or
  $backupCreatedAt -gt [DateTimeOffset]::UtcNow -or $backupCreatedAt -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'Backup evidence is stale or does not attest the verified Production restore.'
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
$baseline = Get-Content -LiteralPath $baselineFullPath -Raw | ConvertFrom-Json -Depth 60 -DateKind String
if ($baseline.formatVersion -ne 1 -or $baseline.projectRef -cne $expectedProjectRef -or
  $baseline.migrationFile -cne $migrationFile -or $baseline.migrationVersion -cne $migrationVersion -or
  $baseline.migrationSha256 -cne $migrationHash -or $baseline.backupSha256 -cne $backup.sha256 -or
  [System.IO.Path]::GetFullPath([string]$baseline.backupEvidencePath) -cne $backupManifestPath) {
  throw 'Baseline is not bound to this exact migration, Production project, and verified backup.'
}
$baselineTime = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$baseline.capturedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$baselineTime) -or
  $baselineTime -gt [DateTimeOffset]::UtcNow -or $baselineTime -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'The pre-migration baseline must be no more than 24 hours old.'
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
  'relations', (
    SELECT jsonb_object_agg(name, to_regclass(name) IS NOT NULL ORDER BY name)
    FROM (VALUES
      ('auth.users'), ('auth.identities'), ('storage.buckets'), ('storage.objects'),
      ('public.partner_profiles'), ('public.partner_campaigns'), ('public.partner_campaign_assignments'),
      ('public.partner_campaign_sites'), ('public.partner_campaign_requests'), ('public.partner_damage_reports'),
      ('public.partner_proofs'), ('public.partner_stock_movements'), ('public.partner_coin_ledger'),
      ('public.partner_withdrawal_requests'), ('public.delivery_team_activity'), ('public.admin_users')
    ) required(name)
  ),
  'requiredFunctions', (
    SELECT jsonb_object_agg(signature, to_regprocedure(signature) IS NOT NULL ORDER BY signature)
    FROM (VALUES
      ('public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)'),
      ('public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'),
      ('public.assert_delivery_team_admin(uuid,text)'),
      ('public.delivery_team_available_coins(uuid)'),
      ('public.enforce_partner_stock_movement()'),
      ('public.request_partner_withdrawal(uuid,integer)')
    ) required(signature)
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
          SELECT r.rolname FROM unnest(p.polroles) role_ids(role_oid)
          JOIN pg_roles r ON r.oid = role_ids.role_oid ORDER BY r.rolname
        ), 'using', COALESCE(pg_get_expr(p.polqual, p.polrelid), ''),
        'withCheck', COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
      ) ORDER BY p.polname), '[]'::jsonb)
      FROM pg_policy p WHERE p.polrelid = to_regclass('public.partner_profiles')
    ),
    'profileListDefinition', CASE WHEN to_regprocedure(
      'public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)'
    ) IS NULL THEN NULL ELSE pg_get_functiondef(to_regprocedure(
      'public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)'
    )) END,
    'profileListSecurity', (
      SELECT jsonb_build_object(
        'securityDefiner', p.prosecdef,
        'owner', p.proowner::regrole::text,
        'searchPathPinned', COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public'],
        'serviceRoleExecute', has_function_privilege('service_role', p.oid, 'EXECUTE'),
        'anonExecute', has_function_privilege('anon', p.oid, 'EXECUTE'),
        'authenticatedExecute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        'publicExecute', EXISTS (
          SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'
        )
      ) FROM pg_proc p WHERE p.oid = to_regprocedure(
        'public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)'
      )
    ),
    'proofFunctionMd5', CASE WHEN to_regprocedure(
      'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'
    ) IS NULL THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure(
      'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'
    ))) END,
    'assertAdminFunctionMd5', CASE WHEN to_regprocedure('public.assert_delivery_team_admin(uuid,text)') IS NULL
      THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure('public.assert_delivery_team_admin(uuid,text)'))) END,
    'availableCoinsFunctionMd5', CASE WHEN to_regprocedure('public.delivery_team_available_coins(uuid)') IS NULL
      THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure('public.delivery_team_available_coins(uuid)'))) END,
    'withdrawalFunctionMd5', CASE WHEN to_regprocedure('public.request_partner_withdrawal(uuid,integer)') IS NULL
      THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure('public.request_partner_withdrawal(uuid,integer)'))) END,
    'newColumnsNull', NOT EXISTS (
      SELECT 1 FROM public.partner_profiles p
      WHERE p.registration_location_address IS NOT NULL OR p.registration_location_latitude IS NOT NULL
         OR p.registration_location_longitude IS NOT NULL OR p.registration_location_accuracy_meters IS NOT NULL
         OR p.registration_location_captured_at IS NOT NULL OR p.registration_location_address_source IS NOT NULL
         OR p.registration_location_components IS NOT NULL OR p.current_location_address IS NOT NULL
         OR p.current_location_latitude IS NOT NULL OR p.current_location_longitude IS NOT NULL
         OR p.current_location_accuracy_meters IS NOT NULL OR p.current_location_captured_at IS NOT NULL
         OR p.current_location_address_source IS NOT NULL OR p.current_location_components IS NOT NULL
    ),
    'privateProofBucket', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE),
    'withdrawalThreshold100000', position('100000' IN pg_get_functiondef(
      to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
    )) > 0,
    'reservationInvariant', NOT EXISTS (
      SELECT 1 FROM public.partner_profiles p
      LEFT JOIN (SELECT partner_profile_id, sum(quantity) q FROM public.partner_stock_movements GROUP BY partner_profile_id) s
        ON s.partner_profile_id = p.id
      LEFT JOIN (SELECT partner_profile_id, count(*) q FROM public.partner_proofs WHERE status = 'pending' GROUP BY partner_profile_id) r
        ON r.partner_profile_id = p.id
      WHERE COALESCE(s.q, 0) < COALESCE(r.q, 0)
    )
  ),
  'history', jsonb_build_object(
    'ledgerExists', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'candidateRelations', (
      SELECT COALESCE(jsonb_agg(format('%I.%I', n.nspname, c.relname) ORDER BY n.nspname, c.relname), '[]'::jsonb)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'vault', 'extensions')
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
      UNION ALL SELECT 'partner_profiles', count(*)::bigint, md5(COALESCE(string_agg((to_jsonb(r) - ARRAY[
        'registration_location_address', 'registration_location_latitude', 'registration_location_longitude',
        'registration_location_accuracy_meters', 'registration_location_captured_at', 'registration_location_address_source',
        'registration_location_components', 'current_location_address', 'current_location_latitude',
        'current_location_longitude', 'current_location_accuracy_meters', 'current_location_captured_at',
        'current_location_address_source', 'current_location_components'
      ])::text, E'\n' ORDER BY (to_jsonb(r) - ARRAY[
        'registration_location_address', 'registration_location_latitude', 'registration_location_longitude',
        'registration_location_accuracy_meters', 'registration_location_captured_at', 'registration_location_address_source',
        'registration_location_components', 'current_location_address', 'current_location_latitude',
        'current_location_longitude', 'current_location_accuracy_meters', 'current_location_captured_at',
        'current_location_address_source', 'current_location_components'
      ])::text), '')) FROM public.partner_profiles r
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
$tempPath = Join-Path $env:TEMP ('partner-registration-location-post-' + [guid]::NewGuid().ToString('N') + '.json')
$savedEnvironment = $null
try {
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $psqlArgs = @('--no-psqlrc', '--no-password', '--host', $expectedDatabaseHost, '--port', '5432',
    '--username', "postgres.$expectedProjectRef", '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--quiet', '--no-align', '--tuples-only',
    '--output', $tempPath, '--command', $sql)
  $diagnostics = @(& $PsqlPath @psqlArgs 2>&1)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $tempPath -PathType Leaf)) {
    throw 'Independent read-only Production post-migration query failed; raw diagnostics were withheld.'
  }
  $report = Get-Content -LiteralPath $tempPath -Raw | ConvertFrom-Json -Depth 60
} finally {
  if ($null -ne $savedEnvironment) { Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment }
  if (Test-Path -LiteralPath $tempPath -PathType Leaf) { Remove-Item -LiteralPath $tempPath -Force }
}

if ($report.identity.database -cne 'postgres' -or $report.identity.user -cne 'postgres' -or
  $report.identity.readOnly -cne 'on' -or $report.identity.primary -ne $true -or
  [string]$report.identity.serverVersionNumber -notmatch '^17') {
  throw 'Independent verifier did not connect to the pinned PostgreSQL 17 Production primary in READ ONLY mode.'
}
foreach ($property in $report.relations.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "Production relation is missing after migration: $($property.Name)" }
}
foreach ($property in $report.requiredFunctions.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "Production function is missing after migration: $($property.Name)" }
}
if ($report.history.ledgerExists -ne $false -or
  (Get-CanonicalJson $report.history.candidateRelations) -cne (Get-CanonicalJson $baseline.production.history.candidateRelations)) {
  throw 'Production migration-history state changed; do not create or alter ledger entries.'
}
if ($report.profileSchema.rowSecurity -ne $true -or
  [bool]$report.profileSchema.forceRowSecurity -ne [bool]$baseline.production.profileSchema.forceRowSecurity -or
  (Get-CanonicalJson $report.profileSchema.policies) -cne (Get-CanonicalJson $baseline.production.profileSchema.policies)) {
  throw 'Partner-profile RLS state or policies changed.'
}
if ($report.profileSchema.newColumnsNull -ne $true -or
  $report.profileSchema.privateProofBucket -ne $true -or
  $report.profileSchema.withdrawalThreshold100000 -ne $true -or
  $report.profileSchema.reservationInvariant -ne $true) {
  throw 'Existing partner locations, private proof storage, withdrawal threshold, or inventory reservation invariant failed.'
}

$columnMap = @{}
foreach ($column in $report.profileSchema.columns) { $columnMap[[string]$column.name] = $column }
$expectedTypes = @{
  registration_location_address = 'text'
  registration_location_latitude = 'double precision'
  registration_location_longitude = 'double precision'
  registration_location_accuracy_meters = 'double precision'
  registration_location_captured_at = 'timestamp with time zone'
  registration_location_address_source = 'text'
  registration_location_components = 'jsonb'
  current_location_address = 'text'
  current_location_latitude = 'double precision'
  current_location_longitude = 'double precision'
  current_location_accuracy_meters = 'double precision'
  current_location_captured_at = 'timestamp with time zone'
  current_location_address_source = 'text'
  current_location_components = 'jsonb'
}
foreach ($columnName in $locationColumns) {
  $column = $columnMap[$columnName]
  if ($null -eq $column -or $column.type -cne $expectedTypes[$columnName] -or
    $column.notNull -ne $false -or $column.default -cne '') {
    throw "Location column has unexpected type, nullability, or default: $columnName"
  }
}
$baselineColumns = @($baseline.production.profileSchema.columns | Where-Object { $locationColumns -notcontains $_.name } |
  Sort-Object -Property name | ConvertTo-Json -Depth 20 -Compress)
$actualOldColumns = @($report.profileSchema.columns | Where-Object { $locationColumns -notcontains $_.name } |
  Sort-Object -Property name | ConvertTo-Json -Depth 20 -Compress)
if ($baselineColumns -cne $actualOldColumns) { throw 'Existing partner-profile columns changed.' }

$actualLocationConstraints = @($report.profileSchema.constraints | Where-Object { $locationConstraints -contains $_.name })
if (@($actualLocationConstraints | ForEach-Object { [string]$_.name } | Sort-Object -CaseSensitive) -join '|' -cne
  (@($locationConstraints | Sort-Object -CaseSensitive) -join '|') -or
  @($actualLocationConstraints | Where-Object {
    $_.validated -ne $true -or $_.definition -notmatch '(?i)\bCHECK\b' -or
    $_.definition -notmatch 'gps_reverse_geocoded' -or $_.definition -notmatch 'manual_no_gps' -or
    $_.definition -notmatch '50000'
  }).Count -ne 0) {
  throw 'Expected validated GPS/address checks are missing or malformed.'
}
$baselineConstraints = @($baseline.production.profileSchema.constraints | Where-Object { $locationConstraints -notcontains $_.name } |
  Sort-Object -Property name | ConvertTo-Json -Depth 20 -Compress)
$actualOldConstraints = @($report.profileSchema.constraints | Where-Object { $locationConstraints -notcontains $_.name } |
  Sort-Object -Property name | ConvertTo-Json -Depth 20 -Compress)
if ($baselineConstraints -cne $actualOldConstraints) { throw 'Existing partner-profile constraints changed.' }

$functionSecurity = $report.profileSchema.profileListSecurity
if ($null -eq $functionSecurity -or $functionSecurity.securityDefiner -ne $true -or
  $functionSecurity.owner -cne 'postgres' -or $functionSecurity.searchPathPinned -ne $true -or
  $functionSecurity.serviceRoleExecute -ne $true -or $functionSecurity.anonExecute -ne $false -or
  $functionSecurity.authenticatedExecute -ne $false -or $functionSecurity.publicExecute -ne $false) {
  throw 'Admin partner-list function has unexpected owner, search path, or execution grants.'
}
if ($report.profileSchema.profileListDefinition -notmatch 'select p\.\*,\s*u\.email as authenticated_email' -or
  $report.profileSchema.profileListDefinition -notmatch 'to_jsonb\(r\)' -or
  $report.profileSchema.profileListDefinition -notmatch 'authenticated_email' -or
  $report.profileSchema.profileListDefinition -notmatch 'assert_delivery_team_admin') {
  throw 'Admin partner-list function does not expose the expected location fields behind Admin authorization.'
}
foreach ($functionName in @('proofFunctionMd5', 'assertAdminFunctionMd5', 'availableCoinsFunctionMd5', 'withdrawalFunctionMd5')) {
  if ([string]$report.profileSchema.$functionName -cne [string]$baseline.production.profileSchema.$functionName) {
    throw "Existing proof, authorization, coin, or withdrawal function changed: $functionName"
  }
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

Write-Output 'PARTNER REGISTRATION LOCATION POST-MIGRATION VERIFICATION PASS'
Write-Output "Project: $expectedProjectRef / postgres; migration: $migrationVersion ($migrationHash)"
Write-Output 'Location schema, Admin function grants, RLS policies, historical records, partner accounts, proofs, inventory, coins, and withdrawal safeguards: PASS'
Write-Output 'Migration history remains unavailable and unchanged; no ledger entries were invented or written.'
