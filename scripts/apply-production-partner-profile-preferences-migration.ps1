[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][string]$BaselinePath,
  [Parameter(Mandatory = $true)][string]$BaselineSha256,
  [string]$ConfirmedProjectRef,
  [string]$ConfirmedMigration,
  [string]$HistoryFallbackApproval,
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [switch]$UseApprovedSchemaOnlyFallback,
  [switch]$VerifyReadOnlyBaseline,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$migrationFile = '20261204120000_partner_profile_delivery_preferences.sql'
$migrationVersion = '20261204120000'
$migrationHash = '35CA7D02DCA45E5D5F5AA760E96979579EDF7230F8B53A018A72BD73C425426C'
$historyApprovalText = "APPROVE SCHEMA-ONLY HISTORY FALLBACK FOR $migrationVersion ON PRODUCTION $expectedProjectRef; LEAVE MIGRATION HISTORY UNCHANGED"
$applyConfirmationText = "APPLY MIGRATION $migrationVersion SHA256=$migrationHash TO PRODUCTION $expectedProjectRef"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFile"
$backupVerifier = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'

function Get-SafePsqlFailureSummary {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][object[]]$Diagnostics
  )

  $text = ($Diagnostics | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) {
      $_.Exception.Message
    } else {
      [string]$_
    }
  }) -join "`n"
  $errorMatch = [regex]::Match(
    $text,
    '(?im)\b(?:ERROR|FATAL):\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)'
  )
  $locationMatch = [regex]::Match(
    $text,
    '(?im)^psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL):'
  )
  if (-not $errorMatch.Success) {
    return "psql failed (exit code $ExitCode); no PostgreSQL ERROR/FATAL line was available. Raw diagnostics and credentials were omitted."
  }

  $sqlState = $errorMatch.Groups[1].Value.ToUpperInvariant()
  $message = $errorMatch.Groups[2].Value.Trim()
  $safeMessage = if (
    $message -match '^(?:PRESTATE_MISMATCH:[A-Z0-9_]+|SCHEMA_BASELINE_MISMATCH:[a-zA-Z0-9_.-]+|PRESERVATION_MISMATCH:[a-zA-Z0-9_.-]+)$' -or
    $message -match '^syntax error at or near "[^"\r\n]+"$' -or
    $message -match '^(?:relation|schema) "[a-zA-Z0-9_.-]+" (?:does not exist|not found)$' -or
    $message -match '^permission denied for (?:schema|relation) "[a-zA-Z0-9_.-]+"$'
  ) {
    $message
  } else {
    'PostgreSQL reported an unclassified error; details were withheld.'
  }
  $line = if ($locationMatch.Success) {
    "SQL input line $($locationMatch.Groups[1].Value)"
  } else {
    'SQL input line unavailable'
  }
  $state = if ([string]::IsNullOrWhiteSpace($sqlState)) { 'unavailable' } else { $sqlState }
  return "psql failed (exit code $ExitCode, SQLSTATE $state, $line): $safeMessage. Raw diagnostics, query text, row data, and credentials were omitted."
}

if ($ProjectRef -cne $expectedProjectRef) { throw 'Target does not match the pinned Production project.' }
if ($Apply -and $ConfirmedProjectRef -cne $expectedProjectRef) { throw 'Confirmed project ref does not match Production.' }
if ($Apply -and (-not $UseApprovedSchemaOnlyFallback -or $HistoryFallbackApproval -cne $historyApprovalText)) {
  throw "Production migration is blocked. Exact history-fallback approval required: $historyApprovalText"
}
if ($Apply -and $ConfirmedMigration -cne $applyConfirmationText) {
  throw "Production migration is blocked. Exact migration confirmation required: $applyConfirmationText"
}
if ($Apply -and $VerifyReadOnlyBaseline) { throw 'Choose either read-only verification or migration apply, not both.' }
foreach ($tool in @(@{ Path = $PsqlPath; Name = 'psql' }, @{ Path = $PgRestorePath; Name = 'pg_restore' })) {
  if (-not (Test-Path -LiteralPath $tool.Path -PathType Leaf)) { throw "Required PostgreSQL 18 tool is missing: $($tool.Path)" }
  $versionOutput = (& $tool.Path --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch ('^' + [regex]::Escape($tool.Name) + ' \(PostgreSQL\) 18(?:\.|\s|$)')) {
    throw "PostgreSQL 18 is required for $($tool.Path)."
  }
}
foreach ($requiredPath in @($migrationPath, $backupVerifier, $environmentHelper)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Required migration safety file is missing: $requiredPath" }
}
if ((Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -cne $migrationHash) {
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
$baseline = Get-Content -LiteralPath $baselineFullPath -Raw | ConvertFrom-Json -Depth 50 -DateKind String
if ($baseline.formatVersion -ne 1 -or $baseline.projectRef -cne $expectedProjectRef -or
  $baseline.migrationVersion -cne $migrationVersion -or $baseline.migrationFile -cne $migrationFile -or
  $baseline.migrationSha256 -cne $migrationHash -or $baseline.production.history.ledgerExists -ne $false -or
  @($baseline.production.history.candidateRelations).Count -ne 0) {
  throw 'Baseline does not attest this migration, project, and empty migration-history candidate set.'
}
$capturedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse([string]$baseline.capturedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$capturedAt) -or
  $capturedAt -gt [DateTimeOffset]::UtcNow -or $capturedAt -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'The read-only Production baseline must be no more than 24 hours old.'
}
$backupManifestPath = [System.IO.Path]::GetFullPath([string]$baseline.backupEvidencePath)
$backupManifest = Get-Content -LiteralPath $backupManifestPath -Raw | ConvertFrom-Json -Depth 30 -DateKind String
if ($backupManifest.projectRef -cne $expectedProjectRef -or $backupManifest.sourceHost -cne $databaseHost -or
  $backupManifest.sha256 -cne $baseline.backupSha256 -or $backupManifest.restoreDrill.status -cne 'PASS') {
  throw 'Baseline is not bound to a verified fresh Production archive and successful restore.'
}
$backupOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $backupVerifier `
  -EvidencePath $backupManifestPath -PgRestorePath $PgRestorePath 2>&1)
if ($LASTEXITCODE -ne 0 -or @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'Independent verification of the Production backup and restore failed.'
}

$expectedProfileSchema = ConvertTo-Json -InputObject $baseline.production.profileSchema -Depth 30 -Compress
$escapedProfileSchema = $expectedProfileSchema.Replace("'", "''")
$expectedPreservation = ConvertTo-Json -InputObject $baseline.production.preservation -Depth 30 -Compress
$escapedPreservation = $expectedPreservation.Replace("'", "''")

$schemaGuard = @"
DO `$partner_profile_schema_guard`$
DECLARE expected jsonb := '$escapedProfileSchema'::jsonb; actual jsonb; mismatch text;
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
  ) INTO actual;
  FOR mismatch IN
    SELECT key
    FROM jsonb_object_keys(expected) AS expected_keys(key)
    WHERE (actual -> key) IS DISTINCT FROM (expected -> key)
    ORDER BY key
  LOOP
    RAISE EXCEPTION 'SCHEMA_BASELINE_MISMATCH:%', mismatch;
  END LOOP;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'SCHEMA_BASELINE_MISMATCH:object-shape'; END IF;
END;
`$partner_profile_schema_guard`$;
"@

$dataSnapshotSql = @'
SELECT name, row_count, fingerprint FROM (
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
'@
$preservationGuard = @"
DO `$partner_profile_preservation_guard`$
DECLARE expected jsonb := '$escapedPreservation'::jsonb; actual jsonb; table_name text;
BEGIN
  EXECUTE `$partner_profile_snapshot_query`$
    SELECT jsonb_object_agg(name, jsonb_build_object('rows', row_count, 'md5', fingerprint) ORDER BY name)
    FROM ($dataSnapshotSql) snapshots
  `$partner_profile_snapshot_query`$ INTO actual;
  FOR table_name IN
    SELECT key
    FROM jsonb_object_keys(expected) AS expected_tables(key)
    WHERE (actual -> key) IS DISTINCT FROM (expected -> key)
    ORDER BY key
  LOOP
    RAISE EXCEPTION 'PRESERVATION_MISMATCH:%', table_name;
  END LOOP;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'PRESERVATION_MISMATCH:object-shape'; END IF;
END;
`$partner_profile_preservation_guard`$;
"@

$prestateGuard = @'
DO $partner_profile_prestate$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR pg_is_in_recovery()
     OR current_setting('transaction_read_only') <> 'off'
     OR current_setting('server_version_num') NOT LIKE '17%' THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:identity';
  END IF;
  IF to_regclass('public.partner_profiles') IS NULL
     OR to_regclass('public.partner_proofs') IS NULL
     OR to_regclass('public.partner_stock_movements') IS NULL
     OR to_regclass('public.partner_coin_ledger') IS NULL
     OR to_regclass('public.partner_withdrawal_requests') IS NULL
     OR to_regclass('public.partner_campaigns') IS NULL
     OR to_regclass('public.partner_campaign_assignments') IS NULL
     OR to_regclass('public.partner_campaign_sites') IS NULL
     OR to_regclass('public.partner_campaign_requests') IS NULL
     OR to_regclass('public.partner_damage_reports') IS NULL
     OR to_regclass('public.delivery_team_activity') IS NULL
     OR to_regclass('public.admin_users') IS NULL
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('auth.identities') IS NULL
     OR to_regclass('storage.buckets') IS NULL
     OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:required_relation';
  END IF;
  IF to_regprocedure('public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:proof_submission_function';
  END IF;
  IF to_regprocedure('public.assert_delivery_team_admin(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:admin_authorization_function';
  END IF;
  IF to_regprocedure('public.delivery_team_available_coins(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:available_coins_function';
  END IF;
  IF to_regprocedure('public.request_partner_withdrawal(uuid,integer)') IS NULL
     OR position('100000' IN pg_get_functiondef(to_regprocedure('public.request_partner_withdrawal(uuid,integer)'))) = 0 THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:withdrawal_threshold';
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
  IF to_regprocedure('public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.partner_profiles')
         AND attname IN ('state', 'preferred_delivery_areas') AND attnum > 0 AND NOT attisdropped
     )
     OR EXISTS (
       SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('public.partner_profiles')
         AND conname IN ('partner_profiles_state_india_check', 'partner_profiles_preferred_delivery_areas_check')
     ) THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:migration_objects_already_exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE) THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:private_proof_bucket';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.partner_profiles p
    LEFT JOIN (SELECT partner_profile_id, sum(quantity) q FROM public.partner_stock_movements GROUP BY partner_profile_id) s ON s.partner_profile_id = p.id
    LEFT JOIN (SELECT partner_profile_id, count(*) q FROM public.partner_proofs WHERE status = 'pending' GROUP BY partner_profile_id) r ON r.partner_profile_id = p.id
    WHERE COALESCE(s.q, 0) < COALESCE(r.q, 0)
  ) THEN
    RAISE EXCEPTION 'PRESTATE_MISMATCH:inventory_reservation_invariant';
  END IF;
END;
$partner_profile_prestate$;
'@

$poststateGuard = @'
DO $partner_profile_poststate$
DECLARE
  profile_function oid := to_regprocedure('public.get_delivery_team_partners_by_state(uuid,text,text,text,integer,integer)');
  proof_function oid := to_regprocedure('public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,text)');
BEGIN
  IF profile_function IS NULL OR proof_function IS NULL
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public.partner_profiles')
         AND attname IN ('state', 'preferred_delivery_areas') AND attnum > 0 AND NOT attisdropped) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.partner_profiles')
         AND attname = 'state' AND NOT attnotnull AND atttypid = 'text'::regtype)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.partner_profiles')
         AND attname = 'preferred_delivery_areas' AND attnotnull AND atttypid = 'text[]'::regtype
         AND pg_get_expr((SELECT adbin FROM pg_attrdef WHERE adrelid = attrelid AND adnum = attnum), attrelid) = '''{}''::text[]')
     OR EXISTS (SELECT 1 FROM public.partner_profiles
         WHERE state IS NOT NULL OR preferred_delivery_areas <> '{}'::text[])
     OR (SELECT count(*) FROM pg_constraint WHERE conrelid = to_regclass('public.partner_profiles')
         AND conname IN ('partner_profiles_state_india_check', 'partner_profiles_preferred_delivery_areas_check')
         AND convalidated) <> 2
     OR EXISTS (
       SELECT 1 FROM (VALUES (profile_function), (proof_function)) f(oid)
       JOIN pg_proc p ON p.oid = f.oid
       WHERE NOT p.prosecdef OR p.proowner::regrole::text <> 'postgres'
         OR NOT (COALESCE(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public'])
         OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
         OR has_function_privilege('anon', p.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
         OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                    WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')
     ) THEN RAISE EXCEPTION 'Partner profile migration post-state or function authorization check failed'; END IF;
END;
$partner_profile_poststate$;
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
$sqlPath = Join-Path $env:TEMP ('partner-profile-preferences-apply-' + [guid]::NewGuid().ToString('N') + '.sql')
$savedEnvironment = $null
try {
  if ($VerifyReadOnlyBaseline) {
    $readOnlyPrestate = $prestateGuard.Replace(
      "current_setting('transaction_read_only') <> 'off'", "current_setting('transaction_read_only') <> 'on'")
    $readOnlySql = @"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
$schemaGuard
$readOnlyPrestate
$preservationGuard
ROLLBACK;
"@
    [System.IO.File]::WriteAllText($sqlPath, $readOnlySql, [System.Text.UTF8Encoding]::new($false))
    $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
    $args = @('--no-psqlrc', '--no-password', '--host', $databaseHost, '--port', '5432',
      '--username', "postgres.$expectedProjectRef", '--dbname', 'postgres',
      '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose', '--set', 'SHOW_CONTEXT=always', '--file', $sqlPath)
    $diagnostics = @(& $PsqlPath @args 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      $failureSummary = Get-SafePsqlFailureSummary -ExitCode $exitCode -Diagnostics $diagnostics
      throw "Read-only Production dependency and preservation revalidation failed: $failureSummary No Production write was attempted."
    }
    Write-Output 'READ-ONLY PRE-MIGRATION BASELINE REVALIDATION PASS'
    Write-Output 'No Production write was attempted.'
    return
  }
  if (-not $Apply) {
    Write-Output "Prepared only: $migrationFile SHA-256=$migrationHash"
    Write-Output "History remains unavailable. Exact fallback authorization required: $historyApprovalText"
    Write-Output "Apply confirmation required: $applyConfirmationText"
    Write-Output 'No Production connection or SQL write was attempted.'
    return
  }
  [System.IO.File]::WriteAllText($sqlPath, $applySql, [System.Text.UTF8Encoding]::new($false))
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $args = @('--no-psqlrc', '--no-password', '--host', $databaseHost, '--port', '5432',
    '--username', "postgres.$expectedProjectRef", '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose', '--set', 'SHOW_CONTEXT=always', '--single-transaction', '--file', $sqlPath)
  $diagnostics = @(& $PsqlPath @args 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $failureSummary = Get-SafePsqlFailureSummary -ExitCode $exitCode -Diagnostics $diagnostics
    throw "Guarded Production transaction failed (not retried): $failureSummary Run the independent read-only verifier."
  }
  Write-Output 'GUARDED PRODUCTION MIGRATION TRANSACTION COMMITTED'
  Write-Output 'Independent post-migration verification is required; no migration-history entry was written.'
} catch {
  throw "Production migration state is not certified. Do not retry until read-only verification resolves the state. $($_.Exception.Message)"
} finally {
  if ($null -ne $savedEnvironment) { Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment }
  if (Test-Path -LiteralPath $sqlPath -PathType Leaf) { Remove-Item -LiteralPath $sqlPath -Force }
}
