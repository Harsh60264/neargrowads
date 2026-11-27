[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [Parameter(Mandatory = $true)]
  [string]$BaselinePath,
  [Parameter(Mandatory = $true)]
  [string]$BaselineSha256,
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
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databaseUser = "postgres.$expectedProjectRef"
$databaseName = 'postgres'
$migrationFileName = '20261203120000_partner_independent_delivery.sql'
$migrationVersion = '20261203120000'
$expectedMigrationHash = '27CA5D24E904E042A6732A78B5E2920A60ED6BF4466BAED009112DC02CADA59E'
$historyApprovalText = "APPROVE SCHEMA-ONLY HISTORY FALLBACK FOR $migrationVersion ON PRODUCTION $expectedProjectRef; LEAVE MIGRATION HISTORY UNCHANGED"
$applyConfirmationText = "APPLY MIGRATION $migrationVersion SHA256=$expectedMigrationHash TO PRODUCTION $expectedProjectRef"
$requiredPriorVersion = '20261202120000'
$backupVerifierPath = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
$postVerifierPath = Join-Path $PSScriptRoot 'verify-production-partner-independent-delivery-post-migration.ps1'
$environmentHelperPath = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'

if ($ProjectRef -cne $expectedProjectRef) {
  throw 'The target does not match the pinned Production project ref.'
}
if ($Apply -and $ConfirmedProjectRef -cne $expectedProjectRef) {
  throw 'The explicit Production confirmation must match the pinned project ref.'
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
foreach ($requiredPath in @($backupVerifierPath, $postVerifierPath, $environmentHelperPath)) {
  if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
    throw "Required migration safety file is missing: $requiredPath"
  }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFileName"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf) -or
  (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -cne $expectedMigrationHash) {
  throw 'The exact reviewed independent-delivery migration SHA-256 does not match; no Production connection was opened.'
}
$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
$transactionProbe = [regex]::Replace($migrationSql, '(?s)\$\$.*?\$\$', ' ')
if ($transactionProbe -match '(?im)^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;' -or
  $migrationSql -match '(?im)^\s*(?:INSERT|UPDATE|DELETE)\s+.*supabase_migrations' -or
  $migrationSql -match '(?i)\b(?:DROP\s+TABLE|TRUNCATE|CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY|ALTER\s+SYSTEM)\b') {
  throw 'The pinned migration contains a prohibited transaction, history, or irreversible operation.'
}

$baselineFullPath = [System.IO.Path]::GetFullPath($BaselinePath)
if (-not (Test-Path -LiteralPath $baselineFullPath -PathType Leaf) -or
  (Get-FileHash -LiteralPath $baselineFullPath -Algorithm SHA256).Hash -cne $BaselineSha256.ToUpperInvariant()) {
  throw 'The protected Production baseline is missing or its SHA-256 does not match.'
}
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
$baselineAcl = Get-Acl -LiteralPath $baselineFullPath
if (-not $baselineAcl.AreAccessRulesProtected) {
  throw 'The Production baseline ACL is not protected from inherited access.'
}
foreach ($rule in $baselineAcl.Access) {
  if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
    $allowedSids -notcontains $rule.IdentityReference.Translate(
      [System.Security.Principal.SecurityIdentifier]
    ).Value) {
    throw 'The Production baseline is accessible to an unapproved Windows identity.'
  }
}
$baseline = Get-Content -LiteralPath $baselineFullPath -Raw | ConvertFrom-Json -Depth 50 -DateKind String
if ($baseline.formatVersion -ne 1 -or
  $baseline.projectRef -cne $expectedProjectRef -or
  $baseline.migrationVersion -cne $migrationVersion -or
  $baseline.migrationFile -cne $migrationFileName -or
  $baseline.migrationSha256 -cne $expectedMigrationHash) {
  throw 'The protected baseline does not attest this exact pinned migration and Production project.'
}
$baselineAge = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
    [string]$baseline.capturedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$baselineAge
  ) -or $baselineAge -gt [DateTimeOffset]::UtcNow -or
  $baselineAge -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'The Production schema/data baseline must be no more than 24 hours old.'
}

if ($baseline.production.history.ledgerExists -eq $true) {
  throw 'This migration-specific runner only permits the explicitly approved schema-only fallback for the currently unavailable Production ledger.'
}
if (@($baseline.production.history.candidateRelations).Count -ne 0 -or
  @($baseline.production.history.versions).Count -ne 0) {
  throw 'Migration-history candidate relations remain unresolved; the history fallback is prohibited.'
}
foreach ($property in $baseline.production.migrationObjectsAbsent.PSObject.Properties) {
  if ($property.Value -ne $true) {
    throw "The baseline indicates a pre-existing new-migration object: $($property.Name)"
  }
}
if ($baseline.production.privateProofBucket -ne $true -or
  $baseline.production.stockIdempotencyIndex -ne $true -or
  $baseline.production.reservationInvariant -ne $true -or
  $baseline.production.schema.withdrawalThreshold100000 -ne $true) {
  throw 'A required Production proof, stock, or withdrawal precondition did not pass.'
}

$backupManifestPath = [System.IO.Path]::GetFullPath([string]$baseline.backupEvidencePath)
$backupManifest = Get-Content -LiteralPath $backupManifestPath -Raw | ConvertFrom-Json -Depth 20 -DateKind String
if ($backupManifest.projectRef -cne $expectedProjectRef -or
  $backupManifest.sha256 -cne $baseline.backupSha256 -or
  $backupManifest.restoreDrill.status -cne 'PASS') {
  throw 'The baseline is not bound to the verified fresh Production archive and successful isolated restore.'
}
$backupOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $backupVerifierPath `
  -EvidencePath $backupManifestPath -PgRestorePath $PgRestorePath 2>&1)
if ($LASTEXITCODE -ne 0 -or
  @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'Independent verification of the fresh Production backup and restore evidence failed.'
}

Write-Output "Pinned Production project: $expectedProjectRef"
Write-Output "Migration: $migrationFileName SHA-256=$expectedMigrationHash"
Write-Output "Protected baseline SHA-256: $BaselineSha256"
Write-Output "Backup SHA-256: $($backupManifest.sha256)"
Write-Output 'History fallback: schema-only route is available only after explicit approval; this runner never writes migration history.'
Write-Output 'Backup exclusions: Storage object payload files, cluster-global roles/memberships/tablespaces, Supabase project settings/secrets, and external service configuration.'

if (-not $Apply -and -not $VerifyReadOnlyBaseline) {
  Write-Output 'PREPARED ONLY - no Production SQL write was attempted.'
  Write-Output "PRODUCTION APPLY BLOCKED - authorize the exact schema-only history fallback and pinned migration before using -Apply."
  return
}
if ($Apply -and $VerifyReadOnlyBaseline) {
  throw 'Read-only baseline verification and Production apply cannot be requested in the same invocation.'
}
if ($Apply -and (-not $UseApprovedHistoryFallback -or $HistoryFallbackApproval -cne $historyApprovalText)) {
  throw "Production apply is blocked. The narrow history fallback requires the exact approval text: $historyApprovalText"
}
if ($Apply -and $ConfirmedMigration -cne $applyConfirmationText) {
  throw "Production apply confirmation did not match the pinned migration. Required text: $applyConfirmationText"
}

$expectedPreservation = ConvertTo-Json -InputObject $baseline.production.preservation -Depth 20 -Compress
$escapedPreservation = $expectedPreservation.Replace("'", "''")
$dataSnapshotSql = @'
SELECT 'auth.users' AS table_name, count(*)::bigint AS row_count,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), '')) AS fingerprint
FROM auth.users AS row_data
UNION ALL
SELECT 'auth.identities', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM auth.identities AS row_data
UNION ALL
SELECT 'storage.buckets', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM storage.buckets AS row_data
UNION ALL
SELECT 'storage.objects', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM storage.objects AS row_data
UNION ALL
SELECT 'partner_profiles', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_profiles AS row_data
UNION ALL
SELECT 'partner_campaigns', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_campaigns AS row_data
UNION ALL
SELECT 'partner_campaign_assignments', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_campaign_assignments AS row_data
UNION ALL
SELECT 'partner_campaign_sites', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_campaign_sites AS row_data
UNION ALL
SELECT 'partner_campaign_requests', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_campaign_requests AS row_data
UNION ALL
SELECT 'partner_damage_reports', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_damage_reports AS row_data
UNION ALL
SELECT 'partner_proofs', count(*)::bigint,
  md5(COALESCE(string_agg(
    (to_jsonb(row_data) - 'business_name' - 'business_category' - 'delivery_address'
      - 'address_detail' - 'location_accuracy_meters' - 'location_captured_at'
      - 'location_address_source')::text,
    E'\n' ORDER BY (to_jsonb(row_data) - 'business_name' - 'business_category'
      - 'delivery_address' - 'address_detail' - 'location_accuracy_meters'
      - 'location_captured_at' - 'location_address_source')::text
  ), ''))
FROM public.partner_proofs AS row_data
UNION ALL
SELECT 'partner_stock_movements', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_stock_movements AS row_data
UNION ALL
SELECT 'partner_coin_ledger', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_coin_ledger AS row_data
UNION ALL
SELECT 'partner_withdrawal_requests', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.partner_withdrawal_requests AS row_data
UNION ALL
SELECT 'delivery_team_activity', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.delivery_team_activity AS row_data
UNION ALL
SELECT 'admin_users', count(*)::bigint,
  md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), ''))
FROM public.admin_users AS row_data
'@

$preservationGuard = @"
DO `$partner_preservation_guard`$
DECLARE
  expected jsonb := '$escapedPreservation'::jsonb;
  actual jsonb;
BEGIN
  EXECUTE `$snapshot_query`$
    SELECT jsonb_object_agg(table_name, jsonb_build_object(
      'rows', row_count, 'md5', fingerprint
    ) ORDER BY table_name)
    FROM ($dataSnapshotSql) snapshots
  `$snapshot_query`$ INTO actual;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Partner, Auth, proof, stock, coin, campaign, or storage metadata changed after the protected baseline';
  END IF;
END;
`$partner_preservation_guard`$;
"@

$baselineSchema = [ordered]@{
  proofColumns = @($baseline.production.schema.proofColumns)
  damageReportColumns = @($baseline.production.schema.damageReportColumns)
  proofConstraints = @($baseline.production.schema.proofConstraints)
  damageReportConstraints = @($baseline.production.schema.damageReportConstraints)
  rowSecurity = $baseline.production.schema.rowSecurity
  policies = @($baseline.production.schema.policies)
  relevantFunctionMd5 = $baseline.production.schema.relevantFunctionMd5
  stockMovementTrigger = $baseline.production.schema.stockMovementTrigger
}
$escapedSchema = (ConvertTo-Json -InputObject $baselineSchema -Depth 40 -Compress).Replace("'", "''")
$schemaBaselineGuard = @"
DO `$partner_schema_baseline_guard`$
DECLARE
  expected jsonb := '$escapedSchema'::jsonb;
  actual jsonb;
BEGIN
  SELECT jsonb_build_object(
    'proofColumns', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', attribute.attname,
        'type', format_type(attribute.atttypid, attribute.atttypmod),
        'notNull', attribute.attnotnull,
        'default', COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '')
      ) ORDER BY attribute.attnum), '[]'::jsonb)
      FROM pg_attribute attribute
      LEFT JOIN pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
      WHERE attribute.attrelid = to_regclass('public.partner_proofs')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ),
    'damageReportColumns', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', attribute.attname,
        'type', format_type(attribute.atttypid, attribute.atttypmod),
        'notNull', attribute.attnotnull,
        'default', COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '')
      ) ORDER BY attribute.attnum), '[]'::jsonb)
      FROM pg_attribute attribute
      LEFT JOIN pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
      WHERE attribute.attrelid = to_regclass('public.partner_damage_reports')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ),
    'proofConstraints', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', constraint_row.conname,
        'type', constraint_row.contype::text,
        'definition', pg_get_constraintdef(constraint_row.oid, true),
        'validated', constraint_row.convalidated
      ) ORDER BY constraint_row.conname), '[]'::jsonb)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = to_regclass('public.partner_proofs')
    ),
    'damageReportConstraints', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', constraint_row.conname,
        'type', constraint_row.contype::text,
        'definition', pg_get_constraintdef(constraint_row.oid, true),
        'validated', constraint_row.convalidated
      ) ORDER BY constraint_row.conname), '[]'::jsonb)
      FROM pg_constraint constraint_row
      WHERE constraint_row.conrelid = to_regclass('public.partner_damage_reports')
    ),
    'rowSecurity', (
      SELECT jsonb_object_agg(required.table_name, jsonb_build_object(
        'enabled', relation.relrowsecurity,
        'forced', relation.relforcerowsecurity
      ) ORDER BY required.table_name)
      FROM (VALUES
        ('public.partner_proofs'),
        ('public.partner_damage_reports')
      ) AS required(table_name)
      JOIN pg_class relation ON relation.oid = to_regclass(required.table_name)
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'table', relation.relname,
        'name', policy.polname,
        'command', policy.polcmd::text,
        'roles', policy.polroles,
        'using', COALESCE(pg_get_expr(policy.polqual, policy.polrelid), ''),
        'withCheck', COALESCE(pg_get_expr(policy.polwithcheck, policy.polrelid), '')
      ) ORDER BY relation.relname, policy.polname), '[]'::jsonb)
      FROM pg_policy policy
      JOIN pg_class relation ON relation.oid = policy.polrelid
      WHERE policy.polrelid IN (
        to_regclass('public.partner_proofs'),
        to_regclass('public.partner_damage_reports')
      )
    ),
    'relevantFunctionMd5', jsonb_build_object(
      'movementGuard', md5(pg_get_functiondef(
        to_regprocedure('public.enforce_partner_stock_movement()')
      )),
      'legacyProofSubmission', md5(pg_get_functiondef(
        to_regprocedure('public.submit_partner_proof(uuid,uuid,uuid,text,text,double precision,double precision)')
      )),
      'proofReview', md5(pg_get_functiondef(
        to_regprocedure('public.admin_review_partner_proof(uuid,uuid,text,text)')
      )),
      'withdrawal', md5(pg_get_functiondef(
        to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
      ))
    ),
    'stockMovementTrigger', (
      SELECT jsonb_build_object(
        'name', trigger_row.tgname,
        'enabled', trigger_row.tgenabled::text,
        'definition', pg_get_triggerdef(trigger_row.oid, true)
      )
      FROM pg_trigger trigger_row
      WHERE trigger_row.tgrelid = to_regclass('public.partner_stock_movements')
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgfoid = to_regprocedure('public.enforce_partner_stock_movement()')
      ORDER BY trigger_row.tgname
      LIMIT 1
    )
  ) INTO actual;
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Production dependency schema changed after the protected baseline';
  END IF;
END;
`$partner_schema_baseline_guard`$;
"@

$prestateGuard = @'
DO $independent_delivery_prestate$
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR pg_is_in_recovery()
     OR current_setting('transaction_read_only') <> 'off'
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('storage.buckets') IS NULL
     OR to_regclass('public.partner_profiles') IS NULL
     OR to_regclass('public.partner_proofs') IS NULL
     OR to_regclass('public.partner_damage_reports') IS NULL
     OR to_regclass('public.partner_stock_movements') IS NULL
     OR to_regclass('public.partner_coin_ledger') IS NULL
     OR to_regclass('public.partner_reverse_geocode_rate_limit') IS NOT NULL
     OR to_regprocedure('public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,text)') IS NOT NULL
     OR to_regprocedure('public.reserve_partner_reverse_geocode_slot()') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'partner_proofs'
         AND column_name IN (
           'business_name', 'business_category', 'delivery_address', 'address_detail',
           'location_accuracy_meters', 'location_captured_at', 'location_address_source'
         )
     )
     OR EXISTS (
       SELECT 1
       FROM public.partner_profiles partner
       LEFT JOIN (
         SELECT partner_profile_id, sum(quantity) AS on_hand
         FROM public.partner_stock_movements GROUP BY partner_profile_id
       ) stock ON stock.partner_profile_id = partner.id
       LEFT JOIN (
         SELECT partner_profile_id, count(*) AS reserved
         FROM public.partner_proofs WHERE status = 'pending' GROUP BY partner_profile_id
       ) pending ON pending.partner_profile_id = partner.id
       WHERE coalesce(stock.on_hand, 0) < coalesce(pending.reserved, 0)
     )
     OR to_regprocedure('public.request_partner_withdrawal(uuid,integer)') IS NULL
     OR position('100000' IN pg_get_functiondef(
       to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
     )) = 0
     OR NOT EXISTS (
       SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_index index_row
       JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
       WHERE index_relation.relname = 'partner_stock_movements_idempotency_unique'
         AND index_row.indisunique AND index_row.indisvalid
     )
     OR (SELECT count(*) FROM pg_attribute
         WHERE ((attrelid = to_regclass('public.partner_proofs')
             AND attname IN ('assignment_id', 'campaign_id', 'site_id'))
           OR (attrelid = to_regclass('public.partner_damage_reports') AND attname = 'assignment_id'))
           AND attnum > 0 AND NOT attisdropped AND attnotnull
     ) <> 4
     OR to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     OR EXISTS (
       SELECT 1 FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE relation.relkind IN ('r', 'p')
         AND namespace.nspname NOT IN (
           'pg_catalog', 'information_schema', 'auth', 'storage',
           'realtime', 'vault', 'extensions'
         )
         AND (
           relation.relname ILIKE '%migrat%'
           OR relation.relname ILIKE '%schema_history%'
           OR relation.relname ILIKE '%version%'
         )
     ) THEN
    RAISE EXCEPTION 'Production target, migration-history state, dependency, object-absence, or reservation invariant changed';
  END IF;
END;
$independent_delivery_prestate$;
'@

$poststateGuard = @'
DO $independent_delivery_poststate$
DECLARE
  proof_function oid := to_regprocedure(
    'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamptz,text)'
  );
  geocode_function oid := to_regprocedure('public.reserve_partner_reverse_geocode_slot()');
BEGIN
  IF to_regclass('public.partner_reverse_geocode_rate_limit') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_class
       WHERE oid = to_regclass('public.partner_reverse_geocode_rate_limit')
         AND relrowsecurity
     )
     OR (SELECT count(*) FROM public.partner_reverse_geocode_rate_limit) <> 1
     OR (SELECT count(*) FROM public.partner_reverse_geocode_rate_limit WHERE singleton) <> 1
     OR proof_function IS NULL
     OR geocode_function IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_attribute
       WHERE attrelid = to_regclass('public.partner_proofs')
         AND attname IN (
           'business_name', 'business_category', 'delivery_address', 'address_detail',
           'location_accuracy_meters', 'location_captured_at', 'location_address_source'
         )
       GROUP BY attrelid
       HAVING count(*) = 7
     )
     OR (SELECT count(*) FROM pg_constraint
         WHERE conrelid = to_regclass('public.partner_proofs')
           AND conname IN (
             'partner_proofs_business_name_check',
             'partner_proofs_business_category_check',
             'partner_proofs_delivery_address_check',
             'partner_proofs_address_detail_check',
             'partner_proofs_location_accuracy_check',
             'partner_proofs_location_source_check',
             'partner_proofs_gps_evidence_check'
           )
           AND convalidated) <> 7
     OR NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conrelid = to_regclass('public.partner_proofs')
         AND conname = 'partner_proofs_gps_evidence_check'
         AND convalidated
         AND position('campaign_legacy' IN lower(pg_get_constraintdef(oid, true))) > 0
         AND position('location_accuracy_meters is null' IN lower(pg_get_constraintdef(oid, true))) > 0
     )
     OR (SELECT count(*) FROM pg_attribute
         WHERE ((attrelid = to_regclass('public.partner_proofs')
             AND attname IN ('assignment_id', 'campaign_id', 'site_id'))
           OR (attrelid = to_regclass('public.partner_damage_reports') AND attname = 'assignment_id'))
           AND attnum > 0 AND NOT attisdropped AND NOT attnotnull
     ) <> 4
     OR position('is not distinct from' IN lower(pg_get_functiondef(
       to_regprocedure('public.enforce_partner_stock_movement()')
     ))) = 0
     OR position('100000' IN pg_get_functiondef(
       to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
     )) = 0
     OR EXISTS (
       SELECT 1 FROM aclexplode(COALESCE(
         (SELECT relacl FROM pg_class WHERE oid = to_regclass('public.partner_reverse_geocode_rate_limit')),
         acldefault('r', (SELECT relowner FROM pg_class WHERE oid = to_regclass('public.partner_reverse_geocode_rate_limit')))
       )) acl
       WHERE acl.grantee IN (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid, 'service_role'::regrole::oid)
         AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
     )
     OR EXISTS (
       SELECT 1
       FROM (VALUES (proof_function), (geocode_function)) required(function_oid)
       JOIN pg_proc proc ON proc.oid = required.function_oid
       WHERE NOT proc.prosecdef
         OR proc.proowner::regrole::text <> 'postgres'
         OR NOT (COALESCE(proc.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public'])
         OR NOT has_function_privilege('service_role', proc.oid, 'EXECUTE')
         OR has_function_privilege('anon', proc.oid, 'EXECUTE')
         OR has_function_privilege('authenticated', proc.oid, 'EXECUTE')
         OR EXISTS (
           SELECT 1 FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
         )
     ) THEN
    RAISE EXCEPTION 'Independent-delivery post-state object, RLS, privilege, or invariant check failed';
  END IF;
END;
$independent_delivery_poststate$;
'@

$writeSql = @"
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '300s';
LOCK TABLE
  public.admin_users,
  public.delivery_team_activity,
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
$schemaBaselineGuard
$prestateGuard
$preservationGuard
$migrationSql
$poststateGuard
$preservationGuard
"@

. $environmentHelperPath
$temporarySqlPath = Join-Path $env:TEMP ('partner-independent-apply-' + [guid]::NewGuid().ToString('N') + '.sql')
$savedEnvironment = $null
if ($VerifyReadOnlyBaseline) {
  $readOnlyPrestateGuard = $prestateGuard.Replace(
    "current_setting('transaction_read_only') <> 'off'",
    "current_setting('transaction_read_only') <> 'on'"
  )
  $readOnlySql = @"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
$schemaBaselineGuard
$readOnlyPrestateGuard
$preservationGuard
ROLLBACK;
"@
  try {
    [System.IO.File]::WriteAllText($temporarySqlPath, $readOnlySql, [System.Text.UTF8Encoding]::new($false))
    $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
    $readOnlyArguments = @(
      '--no-psqlrc', '--no-password',
      '--host', $databaseHost, '--port', '5432',
      '--username', $databaseUser, '--dbname', $databaseName,
      '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose',
      '--set', 'SHOW_CONTEXT=always', '--file', $temporarySqlPath
    )
    $readOnlyDiagnostics = @(& $PsqlPath @readOnlyArguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
      throw 'Read-only schema, dependency, history, and preservation revalidation failed; no Production write was attempted.'
    }
    Write-Output 'READ-ONLY PRE-MIGRATION BASELINE REVALIDATION PASS'
    Write-Output 'Current Production schema, history absence, dependencies, RLS/function baseline, reservations, and preservation fingerprints match the protected baseline.'
  } finally {
    if ($null -ne $savedEnvironment) {
      Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
    }
    if (Test-Path -LiteralPath $temporarySqlPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporarySqlPath -Force
    }
  }
  return
}

$savedEnvironment = $null
try {
  [System.IO.File]::WriteAllText($temporarySqlPath, $writeSql, [System.Text.UTF8Encoding]::new($false))
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $arguments = @(
    '--no-psqlrc', '--no-password',
    '--host', $databaseHost, '--port', '5432',
    '--username', $databaseUser, '--dbname', $databaseName,
    '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose',
    '--set', 'SHOW_CONTEXT=always', '--single-transaction',
    '--file', $temporarySqlPath
  )
  $diagnostics = @(& $PsqlPath @arguments 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "Guarded Production migration failed (psql exit code $exitCode); single-transaction mode rolls back SQL errors. Raw diagnostics were omitted. Do not retry until read-only verification determines the state."
  }
} catch {
  throw "Production migration outcome is not certified. Do not retry; run the independent read-only verifier and investigate before any further action. $($_.Exception.Message)"
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  if (Test-Path -LiteralPath $temporarySqlPath -PathType Leaf) {
    Remove-Item -LiteralPath $temporarySqlPath -Force
  }
}

$postOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $postVerifierPath `
  -ProjectRef $expectedProjectRef -BaselinePath $baselineFullPath `
  -ExpectedBaselineSha256 $BaselineSha256 -PasswordFilePath $PasswordFilePath `
  -PsqlPath $PsqlPath -PgRestorePath $PgRestorePath 2>&1)
$postExitCode = $LASTEXITCODE
foreach ($line in $postOutput) { Write-Output ([string]$line) }
if ($postExitCode -ne 0 -or
  @($postOutput | ForEach-Object { [string]$_ }) -notcontains 'PARTNER INDEPENDENT-DELIVERY POST-MIGRATION VERIFICATION PASS') {
  throw 'Production transaction completed, but independent post-migration verification did not pass. Do not deploy or retry.'
}
Write-Output 'Guarded migration and independent post-migration verification passed. This runner does not deploy or modify migration history.'
