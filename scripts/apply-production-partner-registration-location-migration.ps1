[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][string]$BackupEvidencePath,
  [Parameter(Mandatory = $true)][string]$BaselinePath,
  [Parameter(Mandatory = $true)][string]$BaselineSha256,
  [string]$ConfirmedProjectRef,
  [string]$ConfirmedMigration,
  [string]$HistoryFallbackApproval,
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [switch]$UseApprovedHistoryFallback,
  [switch]$VerifyReadOnlyBaseline,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$expectedDatabaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$migrationFile = '20261205120000_partner_registration_location_details.sql'
$migrationVersion = '20261205120000'
$migrationHash = 'C111CF62CE8439514C87EF214CBDD0F3757D5DBF48A649E0BA5B2110E33CE8F6'
$historyApprovalText = "APPROVE SCHEMA-ONLY HISTORY FALLBACK FOR $migrationVersion ON PRODUCTION $expectedProjectRef; LEAVE MIGRATION HISTORY UNCHANGED"
$applyConfirmationText = "APPLY MIGRATION $migrationVersion SHA256=$migrationHash TO PRODUCTION $expectedProjectRef"
$backupVerifier = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
$baselineScript = Join-Path $PSScriptRoot 'capture-production-partner-registration-location-baseline.ps1'
$postVerifier = Join-Path $PSScriptRoot 'verify-production-partner-registration-location-post-migration.ps1'
$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'

function Get-CanonicalJson {
  param([AllowNull()][object]$Value)
  return ConvertTo-Json -InputObject $Value -Depth 60 -Compress
}

function Get-SnapshotMismatch {
  param([Parameter(Mandatory = $true)][object]$Expected, [Parameter(Mandatory = $true)][object]$Actual)

  foreach ($property in $Expected.PSObject.Properties) {
    if ($property.Name -eq 'capturedAtUtc') { continue }
    $actualProperty = $Actual.PSObject.Properties[$property.Name]
    if ($null -eq $actualProperty) { return "production.$($property.Name)" }
    if ((Get-CanonicalJson $property.Value) -cne (Get-CanonicalJson $actualProperty.Value)) {
      if ($property.Name -in @('relations', 'requiredFunctions', 'requiredColumns', 'migrationObjectsAbsent', 'preservation')) {
        foreach ($child in $property.Value.PSObject.Properties) {
          $actualChild = $actualProperty.Value.PSObject.Properties[$child.Name]
          if ($null -eq $actualChild -or (Get-CanonicalJson $child.Value) -cne (Get-CanonicalJson $actualChild.Value)) {
            return "production.$($property.Name).$($child.Name)"
          }
        }
      }
      if ($property.Name -eq 'profileSchema') {
        foreach ($child in $property.Value.PSObject.Properties) {
          $actualChild = $actualProperty.Value.PSObject.Properties[$child.Name]
          if ($null -eq $actualChild -or (Get-CanonicalJson $child.Value) -cne (Get-CanonicalJson $actualChild.Value)) {
            return "production.profileSchema.$($child.Name)"
          }
        }
      }
      return "production.$($property.Name)"
    }
  }
  foreach ($property in $Actual.PSObject.Properties) {
    if ($property.Name -ne 'capturedAtUtc' -and $null -eq $Expected.PSObject.Properties[$property.Name]) {
      return "production.unexpected.$($property.Name)"
    }
  }
  return $null
}

function Get-SafePsqlFailureSummary {
  param([Parameter(Mandatory = $true)][int]$ExitCode, [Parameter(Mandatory = $true)][object[]]$Diagnostics)

  $text = ($Diagnostics | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ }
  }) -join "`n"
  $errorMatch = [regex]::Match($text, '(?im)\b(?:ERROR|FATAL):\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)')
  $locationMatch = [regex]::Match($text, '(?im)^psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL):')
  if (-not $errorMatch.Success) {
    return "psql failed (exit code $ExitCode); no PostgreSQL ERROR/FATAL line was available. Raw diagnostics and credentials were omitted."
  }
  $sqlState = $errorMatch.Groups[1].Value.ToUpperInvariant()
  $message = $errorMatch.Groups[2].Value.Trim()
  $safeMessage = if (
    $message -match '^(?:PRESTATE_MISMATCH:[A-Z0-9_]+|SCHEMA_BASELINE_MISMATCH:[a-zA-Z0-9_.-]+|PRESERVATION_MISMATCH:[a-zA-Z0-9_.-]+|POSTSTATE_MISMATCH:[A-Z0-9_]+)$' -or
    $message -match '^syntax error at or near "[^"\r\n]+"$' -or
    $message -match '^(?:relation|schema) "[a-zA-Z0-9_.-]+" (?:does not exist|not found)$'
  ) { $message } else { 'PostgreSQL reported an unclassified error; details were withheld.' }
  $line = if ($locationMatch.Success) { "SQL input line $($locationMatch.Groups[1].Value)" } else { 'SQL input line unavailable' }
  $state = if ([string]::IsNullOrWhiteSpace($sqlState)) { 'unavailable' } else { $sqlState }
  return "psql failed (exit code $ExitCode, SQLSTATE $state, $line): $safeMessage. Raw query text, row data, and credentials were omitted."
}

if ($ProjectRef -cne $expectedProjectRef) { throw 'Target does not match the pinned Production project.' }
if ($Apply -and $ConfirmedProjectRef -cne $expectedProjectRef) { throw 'Confirmed project ref does not match Production.' }
if ($Apply -and (-not $UseApprovedHistoryFallback -or $HistoryFallbackApproval -cne $historyApprovalText)) {
  throw "Production migration is blocked. Exact history-fallback authorization is required: $historyApprovalText"
}
if ($Apply -and $ConfirmedMigration -cne $applyConfirmationText) {
  throw "Production migration is blocked. Exact migration authorization is required: $applyConfirmationText"
}
if ($Apply -and $VerifyReadOnlyBaseline) { throw 'Choose either read-only verification or migration apply, not both.' }

foreach ($tool in @(@{ Path = $PsqlPath; Name = 'psql' }, @{ Path = $PgRestorePath; Name = 'pg_restore' })) {
  if (-not (Test-Path -LiteralPath $tool.Path -PathType Leaf)) { throw "Required PostgreSQL 18 tool is missing: $($tool.Path)" }
  $versionOutput = (& $tool.Path --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch ('^' + [regex]::Escape($tool.Name) + ' \(PostgreSQL\) 18(?:\.|\s|$)')) {
    throw "PostgreSQL 18 is required for $($tool.Path)."
  }
}
foreach ($path in @($backupVerifier, $baselineScript, $postVerifier, $environmentHelper)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required migration safety file is missing: $path" }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFile"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf) -or
  (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -cne $migrationHash) {
  throw 'Migration SHA-256 mismatch; no Production connection was opened.'
}
$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
$transactionProbe = [regex]::Replace($migrationSql, '(?s)\$\$.*?\$\$', ' ')
if ($transactionProbe -match '(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;' -or
  $transactionProbe -match '(?im)^\s*(?:INSERT|UPDATE|DELETE)\s+.*supabase_migrations' -or
  $transactionProbe -match '(?i)\b(?:DROP\s+TABLE|TRUNCATE|CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|ALTER\s+SYSTEM)\b') {
  throw 'Pinned migration contains a prohibited transaction, history, or irreversible operation.'
}

$baselineFullPath = [System.IO.Path]::GetFullPath($BaselinePath)
if (-not (Test-Path -LiteralPath $baselineFullPath -PathType Leaf) -or
  (Get-FileHash -LiteralPath $baselineFullPath -Algorithm SHA256).Hash -cne $BaselineSha256.ToUpperInvariant()) {
  throw 'Protected baseline is missing or its SHA-256 does not match.'
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
  $baseline.migrationVersion -cne $migrationVersion -or $baseline.migrationFile -cne $migrationFile -or
  $baseline.migrationSha256 -cne $migrationHash -or $baseline.production.history.ledgerExists -ne $false -or
  @($baseline.production.history.candidateRelations).Count -ne 0) {
  throw 'Baseline does not attest this exact migration, Production project, and empty migration-history candidate set.'
}
$baselineTime = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$baseline.capturedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$baselineTime) -or
  $baselineTime -gt [DateTimeOffset]::UtcNow -or $baselineTime -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'The read-only Production baseline must be no more than 24 hours old.'
}
foreach ($property in $baseline.production.migrationObjectsAbsent.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "A new-migration object existed in the baseline: $($property.Name)" }
}
foreach ($property in $baseline.production.relations.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "A required Production relation was absent: $($property.Name)" }
}
foreach ($property in $baseline.production.requiredFunctions.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "A required Production function was absent: $($property.Name)" }
}
foreach ($property in $baseline.production.requiredColumns.PSObject.Properties) {
  if ($property.Value -ne $true) { throw "A required Production column was absent: $($property.Name)" }
}
if ($baseline.production.profileSchema.rowSecurity -ne $true -or
  $baseline.production.profileSchema.privateProofBucket -ne $true -or
  $baseline.production.profileSchema.withdrawalThreshold100000 -ne $true -or
  $baseline.production.profileSchema.reservationInvariant -ne $true) {
  throw 'Baseline does not preserve the required RLS, proof-storage, withdrawal, and inventory invariants.'
}

$backupManifestPath = [System.IO.Path]::GetFullPath($BackupEvidencePath)
$backupOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $backupVerifier `
  -EvidencePath $backupManifestPath -PgRestorePath $PgRestorePath 2>&1)
if ($LASTEXITCODE -ne 0 -or @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'Independent verification of the Production archive and isolated restore failed.'
}
$backup = Get-Content -LiteralPath $backupManifestPath -Raw | ConvertFrom-Json -Depth 30 -DateKind String
$backupCreatedAt = [DateTimeOffset]::MinValue
if ($backup.projectRef -cne $expectedProjectRef -or $backup.sourceHost -cne $expectedDatabaseHost -or
  $backup.sha256 -cne $baseline.backupSha256 -or $backup.restoreDrill.status -cne 'PASS' -or
  -not [DateTimeOffset]::TryParse([string]$backup.backupCreatedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$backupCreatedAt) -or
  $backupCreatedAt -gt [DateTimeOffset]::UtcNow -or $backupCreatedAt -lt [DateTimeOffset]::UtcNow.AddHours(-24) -or
  [System.IO.Path]::GetFullPath([string]$baseline.backupEvidencePath) -cne $backupManifestPath) {
  throw 'Baseline is not bound to a fresh, independently verified Production backup.'
}

$backupDirectory = [System.IO.Path]::GetDirectoryName($backupManifestPath)
$temporaryBaseline = Join-Path $backupDirectory ('partner-registration-location-revalidation-' + [guid]::NewGuid().ToString('N') + '.json')
function Test-CurrentBaseline {
  try {
    $captureOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $baselineScript `
      -ProjectRef $expectedProjectRef -BackupEvidencePath $backupManifestPath -OutputPath $temporaryBaseline `
      -PasswordFilePath $PasswordFilePath -PsqlPath $PsqlPath -PgRestorePath $PgRestorePath 2>&1)
    $captureExitCode = $LASTEXITCODE
    $captureText = (@($captureOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine)
    $capturePassed = $captureText -match '(?m)^PRODUCTION LOCATION BASELINE CAPTURE PASS:'
    if ($captureExitCode -ne 0 -or -not $capturePassed) {
      $safeDiagnostic = @($captureOutput | ForEach-Object { [string]$_ } |
        Where-Object {
          $_ -match '^(?:Read-only Production baseline query failed; raw diagnostics were withheld\.|' +
            'Baseline did not come from the pinned PostgreSQL 17 Production primary in READ ONLY mode\.|' +
            'Production (?:relation|function|column) dependency is missing: [A-Za-z0-9_.]+|' +
            'A new-migration object already exists: [A-Za-z0-9_]+|' +
            'Production migration history is unavailable or has unresolved candidate tables; the approved fallback cannot be used until this is reconciled\.|' +
            'A Production RLS, proof-storage, withdrawal, or inventory-reservation prerequisite failed\.|' +
            'Baseline captured, but its ACL could not be restricted\.|Baseline ACL failed its protected-access check\.)$'
        } | Select-Object -Last 1)
      if ($safeDiagnostic.Count -eq 0) { $safeDiagnostic = 'No classified safe diagnostic was emitted.' }
      throw "Fresh read-only Production baseline capture failed (child exit code $captureExitCode; success marker $capturePassed): $safeDiagnostic No migration was attempted."
    }
    $fresh = Get-Content -LiteralPath $temporaryBaseline -Raw | ConvertFrom-Json -Depth 60 -DateKind String
    $mismatch = Get-SnapshotMismatch -Expected $baseline.production -Actual $fresh.production
    if ($null -ne $mismatch) { throw "READ_ONLY_REVALIDATION_MISMATCH:$mismatch" }
    Write-Output 'READ-ONLY PRODUCTION DEPENDENCY AND PRESERVATION REVALIDATION PASS'
  } finally {
    if (Test-Path -LiteralPath $temporaryBaseline -PathType Leaf) { Remove-Item -LiteralPath $temporaryBaseline -Force }
  }
}

if ($VerifyReadOnlyBaseline) {
  Test-CurrentBaseline
  Write-Output 'No Production write was attempted.'
  return
}
if (-not $Apply) {
  Write-Output "Prepared only: $migrationFile SHA-256=$migrationHash"
  Write-Output "Exact fallback authorization required: $historyApprovalText"
  Write-Output "Exact apply authorization required: $applyConfirmationText"
  Write-Output 'No Production connection or SQL write was attempted.'
  return
}
Test-CurrentBaseline

$expectedProfileSchema = (Get-CanonicalJson $baseline.production.profileSchema).Replace("'", "''")
$expectedPreservation = (Get-CanonicalJson $baseline.production.preservation).Replace("'", "''")
$schemaGuard = @"
DO `$location_schema_guard`$
DECLARE expected jsonb := '$expectedProfileSchema'::jsonb; actual jsonb; mismatch text;
BEGIN
  SELECT jsonb_build_object(
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
    'partnerListFunctionMd5', md5(pg_get_functiondef(to_regprocedure(
      'public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)'
    ))),
    'proofFunctionMd5', md5(pg_get_functiondef(to_regprocedure(
      'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'
    ))),
    'assertAdminFunctionMd5', md5(pg_get_functiondef(to_regprocedure('public.assert_delivery_team_admin(uuid,text)'))),
    'availableCoinsFunctionMd5', md5(pg_get_functiondef(to_regprocedure('public.delivery_team_available_coins(uuid)'))),
    'withdrawalFunctionMd5', md5(pg_get_functiondef(to_regprocedure('public.request_partner_withdrawal(uuid,integer)'))),
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
  ) INTO actual;
  FOR mismatch IN
    SELECT key FROM jsonb_object_keys(expected) expected_keys(key)
    WHERE (actual -> key) IS DISTINCT FROM (expected -> key) ORDER BY key
  LOOP
    RAISE EXCEPTION 'SCHEMA_BASELINE_MISMATCH:%', mismatch;
  END LOOP;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'SCHEMA_BASELINE_MISMATCH:object-shape'; END IF;
END;
`$location_schema_guard`$;
"@

$dataSnapshotSql = @'
SELECT name, row_count, fingerprint FROM (
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
'@
$escapedPreservation = $expectedPreservation
$preservationGuard = @"
DO `$location_preservation_guard`$
DECLARE expected jsonb := '$escapedPreservation'::jsonb; actual jsonb; table_name text;
BEGIN
  EXECUTE `$location_snapshot_query`$
    SELECT jsonb_object_agg(name, jsonb_build_object('rows', row_count, 'md5', fingerprint) ORDER BY name)
    FROM ($dataSnapshotSql) snapshots
  `$location_snapshot_query`$ INTO actual;
  FOR table_name IN
    SELECT key FROM jsonb_object_keys(expected) expected_tables(key)
    WHERE (actual -> key) IS DISTINCT FROM (expected -> key) ORDER BY key
  LOOP
    RAISE EXCEPTION 'PRESERVATION_MISMATCH:%', table_name;
  END LOOP;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'PRESERVATION_MISMATCH:object-shape'; END IF;
END;
`$location_preservation_guard`$;
"@

$prestateGuard = @'
DO $location_prestate$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR pg_is_in_recovery()
     OR current_setting('server_version_num') NOT LIKE '17%'
     OR current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:identity';
  END IF;
  IF to_regclass('public.partner_profiles') IS NULL OR to_regclass('auth.users') IS NULL
     OR to_regclass('auth.identities') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR to_regclass('storage.objects') IS NULL OR to_regclass('public.partner_proofs') IS NULL
     OR to_regclass('public.partner_stock_movements') IS NULL OR to_regclass('public.partner_coin_ledger') IS NULL
     OR to_regclass('public.partner_withdrawal_requests') IS NULL
     OR to_regclass('public.partner_campaigns') IS NULL
     OR to_regclass('public.partner_campaign_assignments') IS NULL
     OR to_regclass('public.partner_campaign_sites') IS NULL
     OR to_regclass('public.partner_campaign_requests') IS NULL
     OR to_regclass('public.partner_damage_reports') IS NULL
     OR to_regclass('public.delivery_team_activity') IS NULL OR to_regclass('public.admin_users') IS NULL THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:required_relation';
  END IF;
  IF to_regprocedure('public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)') IS NULL
     OR to_regprocedure('public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)') IS NULL
     OR to_regprocedure('public.assert_delivery_team_admin(uuid,text)') IS NULL
     OR to_regprocedure('public.delivery_team_available_coins(uuid)') IS NULL
     OR to_regprocedure('public.request_partner_withdrawal(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:required_function';
  END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN
         ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', 'vault', 'extensions')
         AND (c.relname ILIKE '%migrat%' OR c.relname ILIKE '%schema_history%' OR c.relname ILIKE '%version%')
     ) THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:migration_history';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.partner_profiles')
         AND attname IN (
           'registration_location_address', 'registration_location_latitude',
           'registration_location_longitude', 'registration_location_accuracy_meters',
           'registration_location_captured_at', 'registration_location_address_source',
           'registration_location_components', 'current_location_address',
           'current_location_latitude', 'current_location_longitude',
           'current_location_accuracy_meters', 'current_location_captured_at',
           'current_location_address_source', 'current_location_components'
         ) AND attnum > 0 AND NOT attisdropped
     )
     OR EXISTS (
       SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.partner_profiles')
         AND conname IN ('partner_profiles_registration_location_check', 'partner_profiles_current_location_check')
     ) THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:migration_objects_already_exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE) THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:private_proof_bucket';
  END IF;
  IF position('100000' IN pg_get_functiondef(
       to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
     )) = 0 THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:withdrawal_threshold';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.partner_profiles p
    LEFT JOIN (SELECT partner_profile_id, sum(quantity) q FROM public.partner_stock_movements GROUP BY partner_profile_id) s
      ON s.partner_profile_id = p.id
    LEFT JOIN (SELECT partner_profile_id, count(*) q FROM public.partner_proofs WHERE status = 'pending' GROUP BY partner_profile_id) r
      ON r.partner_profile_id = p.id
    WHERE COALESCE(s.q, 0) < COALESCE(r.q, 0)
  ) THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:inventory_reservation_invariant';
  END IF;
END;
$location_prestate$;
'@

$poststateGuard = @'
DO $location_poststate$
DECLARE
  partner_list oid := to_regprocedure('public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)');
  expected_columns integer;
  actual_columns integer;
  invalid_columns integer;
  invalid_constraints integer;
BEGIN
  IF partner_list IS NULL THEN RAISE EXCEPTION 'POSTSTATE_MISMATCH:partner_list_function'; END IF;
  SELECT count(*) INTO expected_columns FROM (VALUES
    ('registration_location_address', 'text'),
    ('registration_location_latitude', 'double precision'),
    ('registration_location_longitude', 'double precision'),
    ('registration_location_accuracy_meters', 'double precision'),
    ('registration_location_captured_at', 'timestamp with time zone'),
    ('registration_location_address_source', 'text'),
    ('registration_location_components', 'jsonb'),
    ('current_location_address', 'text'),
    ('current_location_latitude', 'double precision'),
    ('current_location_longitude', 'double precision'),
    ('current_location_accuracy_meters', 'double precision'),
    ('current_location_captured_at', 'timestamp with time zone'),
    ('current_location_address_source', 'text'),
    ('current_location_components', 'jsonb')
  ) expected(name, formatted_type);
  SELECT count(*) INTO actual_columns FROM pg_attribute
  WHERE attrelid = to_regclass('public.partner_profiles')
    AND attname IN (
      'registration_location_address', 'registration_location_latitude', 'registration_location_longitude',
      'registration_location_accuracy_meters', 'registration_location_captured_at',
      'registration_location_address_source', 'registration_location_components', 'current_location_address',
      'current_location_latitude', 'current_location_longitude', 'current_location_accuracy_meters',
      'current_location_captured_at', 'current_location_address_source', 'current_location_components'
    ) AND attnum > 0 AND NOT attisdropped;
  SELECT count(*) INTO invalid_columns
  FROM (VALUES
    ('registration_location_address', 'text'),
    ('registration_location_latitude', 'double precision'),
    ('registration_location_longitude', 'double precision'),
    ('registration_location_accuracy_meters', 'double precision'),
    ('registration_location_captured_at', 'timestamp with time zone'),
    ('registration_location_address_source', 'text'),
    ('registration_location_components', 'jsonb'),
    ('current_location_address', 'text'),
    ('current_location_latitude', 'double precision'),
    ('current_location_longitude', 'double precision'),
    ('current_location_accuracy_meters', 'double precision'),
    ('current_location_captured_at', 'timestamp with time zone'),
    ('current_location_address_source', 'text'),
    ('current_location_components', 'jsonb')
  ) expected(name, formatted_type)
  LEFT JOIN pg_attribute a ON a.attrelid = to_regclass('public.partner_profiles')
    AND a.attname = expected.name AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE a.attname IS NULL OR format_type(a.atttypid, a.atttypmod) <> expected.formatted_type
    OR a.attnotnull OR d.oid IS NOT NULL;
  IF expected_columns <> 14 OR actual_columns <> expected_columns OR invalid_columns <> 0 THEN
    RAISE EXCEPTION 'POSTSTATE_MISMATCH:location_columns';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.partner_profiles p
    WHERE p.registration_location_address IS NOT NULL OR p.registration_location_latitude IS NOT NULL
       OR p.registration_location_longitude IS NOT NULL OR p.registration_location_accuracy_meters IS NOT NULL
       OR p.registration_location_captured_at IS NOT NULL OR p.registration_location_address_source IS NOT NULL
       OR p.registration_location_components IS NOT NULL OR p.current_location_address IS NOT NULL
       OR p.current_location_latitude IS NOT NULL OR p.current_location_longitude IS NOT NULL
       OR p.current_location_accuracy_meters IS NOT NULL OR p.current_location_captured_at IS NOT NULL
       OR p.current_location_address_source IS NOT NULL OR p.current_location_components IS NOT NULL
  ) THEN RAISE EXCEPTION 'POSTSTATE_MISMATCH:existing_location_values'; END IF;
  SELECT count(*) INTO invalid_constraints FROM pg_constraint c
  WHERE c.conrelid = to_regclass('public.partner_profiles')
    AND c.conname IN ('partner_profiles_registration_location_check', 'partner_profiles_current_location_check')
    AND c.convalidated
    AND pg_get_constraintdef(c.oid, true) ILIKE '%gps_reverse_geocoded%'
    AND pg_get_constraintdef(c.oid, true) ILIKE '%manual_no_gps%'
    AND pg_get_constraintdef(c.oid, true) ILIKE '%50000%';
  IF invalid_constraints <> 2 THEN RAISE EXCEPTION 'POSTSTATE_MISMATCH:location_constraints'; END IF;
  IF NOT (
    (SELECT prosecdef AND proowner::regrole::text = 'postgres'
       AND COALESCE(proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']
       AND has_function_privilege('service_role', oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', oid, 'EXECUTE')
       AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(proacl, acldefault('f', proowner))) acl
                       WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
     FROM pg_proc WHERE oid = partner_list)
  ) THEN RAISE EXCEPTION 'POSTSTATE_MISMATCH:partner_list_function_security'; END IF;
  IF pg_get_functiondef(partner_list) NOT ILIKE '%select p.*, u.email as authenticated_email%'
     OR pg_get_functiondef(partner_list) NOT ILIKE '%to_jsonb(r)%'
     OR pg_get_functiondef(partner_list) NOT ILIKE '%authenticated_email%'
     OR pg_get_functiondef(partner_list) NOT ILIKE '%assert_delivery_team_admin%' THEN
    RAISE EXCEPTION 'POSTSTATE_MISMATCH:partner_list_function_definition';
  END IF;
  IF to_regprocedure('public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)') IS NULL
     OR position('100000' IN pg_get_functiondef(
       to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
     )) = 0 OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE) THEN
    RAISE EXCEPTION 'POSTSTATE_MISMATCH:existing_safeguard';
  END IF;
END;
$location_poststate$;
'@

$applySql = @"
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';
LOCK TABLE auth.users, auth.identities, storage.buckets, storage.objects,
  public.admin_users, public.delivery_team_activity, public.partner_profiles,
  public.partner_campaigns, public.partner_campaign_assignments, public.partner_campaign_sites,
  public.partner_campaign_requests, public.partner_damage_reports, public.partner_proofs,
  public.partner_stock_movements, public.partner_coin_ledger, public.partner_withdrawal_requests
IN SHARE ROW EXCLUSIVE MODE;
$schemaGuard
$prestateGuard
$preservationGuard
$migrationSql
$poststateGuard
$preservationGuard
"@

. $environmentHelper
$sqlPath = Join-Path $env:TEMP ('partner-registration-location-apply-' + [guid]::NewGuid().ToString('N') + '.sql')
$savedEnvironment = $null
try {
  [System.IO.File]::WriteAllText($sqlPath, $applySql, [System.Text.UTF8Encoding]::new($false))
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $psqlArgs = @('--no-psqlrc', '--no-password', '--host', $expectedDatabaseHost, '--port', '5432',
    '--username', "postgres.$expectedProjectRef", '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose', '--set', 'SHOW_CONTEXT=always',
    '--single-transaction', '--file', $sqlPath)
  $diagnostics = @(& $PsqlPath @psqlArgs 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $failureSummary = Get-SafePsqlFailureSummary -ExitCode $exitCode -Diagnostics $diagnostics
    throw "Guarded Production transaction failed and was not retried: $failureSummary Run the independent read-only verifier."
  }
  Write-Output 'GUARDED PRODUCTION LOCATION MIGRATION TRANSACTION COMMITTED'
} catch {
  throw "Production migration state is not certified. Do not retry until read-only verification resolves the state. $($_.Exception.Message)"
} finally {
  if ($null -ne $savedEnvironment) { Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment }
  if (Test-Path -LiteralPath $sqlPath -PathType Leaf) { Remove-Item -LiteralPath $sqlPath -Force }
}

$postOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $postVerifier `
  -ProjectRef $expectedProjectRef -BackupEvidencePath $backupManifestPath `
  -BaselinePath $baselineFullPath -ExpectedBaselineSha256 $BaselineSha256 `
  -PasswordFilePath $PasswordFilePath -PsqlPath $PsqlPath -PgRestorePath $PgRestorePath 2>&1)
if ($LASTEXITCODE -ne 0 -or @($postOutput | ForEach-Object { [string]$_ }) -notcontains 'PARTNER REGISTRATION LOCATION POST-MIGRATION VERIFICATION PASS') {
  throw "Migration committed, but independent read-only verification failed. Do not deploy or retry. $($postOutput -join ' ')"
}
Write-Output 'Independent read-only Production post-migration verification: PASS'
