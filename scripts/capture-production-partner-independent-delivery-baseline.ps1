[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [Parameter(Mandatory = $true)]
  [string]$BackupEvidencePath,
  [string]$OutputPath,
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$expectedDatabaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$migrationFileName = '20261203120000_partner_independent_delivery.sql'
$migrationVersion = '20261203120000'
$expectedMigrationHash = '27CA5D24E904E042A6732A78B5E2920A60ED6BF4466BAED009112DC02CADA59E'
$requiredPriorVersions = @('20261202120000')
$requiredRelations = @(
  'auth.users',
  'auth.identities',
  'storage.buckets',
  'storage.objects',
  'public.partner_profiles',
  'public.partner_campaigns',
  'public.partner_campaign_assignments',
  'public.partner_campaign_sites',
  'public.partner_campaign_requests',
  'public.partner_damage_reports',
  'public.partner_proofs',
  'public.partner_stock_movements',
  'public.partner_coin_ledger',
  'public.partner_withdrawal_requests',
  'public.delivery_team_activity',
  'public.admin_users'
)
$requiredFunctions = @(
  'public.enforce_partner_stock_movement()',
  'public.submit_partner_proof(uuid,uuid,uuid,text,text,double precision,double precision)',
  'public.admin_review_partner_proof(uuid,uuid,text,text)',
  'public.request_partner_withdrawal(uuid,integer)'
)

if ($ProjectRef -cne $expectedProjectRef) {
  throw 'ProjectRef does not match the pinned Production project.'
}
foreach ($tool in @(
    @{ Path = $PsqlPath; Name = 'psql' },
    @{ Path = $PgRestorePath; Name = 'pg_restore' }
  )) {
  if (-not (Test-Path -LiteralPath $tool.Path -PathType Leaf)) {
    throw "Required PostgreSQL 18 tool was not found: $($tool.Path)"
  }
  $versionOutput = (& $tool.Path --version 2>&1 | Out-String).Trim()
  $versionPattern = '^' + [regex]::Escape($tool.Name) + ' \(PostgreSQL\) 18(?:\.|\s|$)'
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch $versionPattern) {
    throw "PostgreSQL 18 is required for $($tool.Path). Detected: $versionOutput"
  }
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFileName"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf) -or
  (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash -cne $expectedMigrationHash) {
  throw 'The independent-delivery migration does not match its pinned SHA-256.'
}

$backupManifestPath = [System.IO.Path]::GetFullPath($BackupEvidencePath)
if (-not (Test-Path -LiteralPath $backupManifestPath -PathType Leaf)) {
  throw 'The fresh Production backup evidence manifest is missing.'
}
$backupVerifierPath = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
$powerShellPath = (Get-Command pwsh -ErrorAction Stop).Source
$backupOutput = @(& $powerShellPath -NoProfile -File $backupVerifierPath `
  -EvidencePath $backupManifestPath -PgRestorePath $PgRestorePath 2>&1)
$backupExitCode = $LASTEXITCODE
if ($backupExitCode -ne 0 -or
  @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'The fresh Production backup and isolated restore evidence did not pass independent verification.'
}
$backupEvidence = Get-Content -LiteralPath $backupManifestPath -Raw | ConvertFrom-Json -Depth 20 -DateKind String
$backupCreatedAt = [DateTimeOffset]::MinValue
if ($backupEvidence.projectRef -cne $expectedProjectRef -or
  $backupEvidence.sourceHost -cne $expectedDatabaseHost -or
  $backupEvidence.restoreDrill.status -cne 'PASS' -or
  -not [DateTimeOffset]::TryParse(
    [string]$backupEvidence.backupCreatedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$backupCreatedAt
  ) -or $backupCreatedAt -gt [DateTimeOffset]::UtcNow -or
  $backupCreatedAt -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'The backup evidence is not a fresh, independently verified archive for this Production project.'
}

$backupDirectory = [System.IO.Path]::GetDirectoryName($backupManifestPath)
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $backupDirectory 'partner-independent-delivery-pre-migration-baseline.json'
}
$outputPathFull = [System.IO.Path]::GetFullPath($OutputPath)
if (-not $outputPathFull.StartsWith(
    $backupDirectory.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  ) -or
  $outputPathFull.StartsWith(
    [System.IO.Path]::GetFullPath($repoRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
      [System.IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  )) {
  throw 'The baseline must be a new local file inside this backup directory and outside the repository.'
}
if (Test-Path -LiteralPath $outputPathFull) {
  throw 'The baseline file already exists and will not be overwritten.'
}

$sql = @'
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT jsonb_build_object(
  'capturedAtUtc', clock_timestamp(),
  'identity', jsonb_build_object(
    'database', current_database(),
    'user', current_user,
    'readOnly', current_setting('transaction_read_only'),
    'primary', NOT pg_is_in_recovery(),
    'serverVersionNumber', current_setting('server_version_num')
  ),
  'privateProofBucket', EXISTS (
    SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE
  ),
  'stockIdempotencyIndex', EXISTS (
    SELECT 1 FROM pg_index index_row
    JOIN pg_class index_relation ON index_relation.oid = index_row.indexrelid
    WHERE index_relation.relname = 'partner_stock_movements_idempotency_unique'
      AND index_row.indisunique AND index_row.indisvalid
  ),
  'relations', (
    SELECT jsonb_object_agg(required.name, to_regclass(required.name) IS NOT NULL ORDER BY required.name)
    FROM (VALUES
      ('auth.users'),
      ('auth.identities'),
      ('storage.buckets'),
      ('storage.objects'),
      ('public.partner_profiles'),
      ('public.partner_campaigns'),
      ('public.partner_campaign_assignments'),
      ('public.partner_campaign_sites'),
      ('public.partner_campaign_requests'),
      ('public.partner_damage_reports'),
      ('public.partner_proofs'),
      ('public.partner_stock_movements'),
      ('public.partner_coin_ledger'),
      ('public.partner_withdrawal_requests'),
      ('public.delivery_team_activity'),
      ('public.admin_users')
    ) AS required(name)
  ),
  'requiredFunctions', (
    SELECT jsonb_object_agg(required.signature,
      to_regprocedure(required.signature) IS NOT NULL ORDER BY required.signature)
    FROM (VALUES
      ('public.enforce_partner_stock_movement()'),
      ('public.submit_partner_proof(uuid,uuid,uuid,text,text,double precision,double precision)'),
      ('public.admin_review_partner_proof(uuid,uuid,text,text)'),
      ('public.request_partner_withdrawal(uuid,integer)')
    ) AS required(signature)
  ),
  'requiredColumns', (
    SELECT jsonb_object_agg(required.name, EXISTS (
      SELECT 1
      FROM pg_attribute attribute
      WHERE attribute.attrelid = to_regclass(required.table_name)
        AND attribute.attname = required.column_name
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    ) ORDER BY required.name)
    FROM (VALUES
      ('public.partner_proofs.assignment_id', 'public.partner_proofs', 'assignment_id'),
      ('public.partner_proofs.campaign_id', 'public.partner_proofs', 'campaign_id'),
      ('public.partner_proofs.site_id', 'public.partner_proofs', 'site_id'),
      ('public.partner_proofs.partner_profile_id', 'public.partner_proofs', 'partner_profile_id'),
      ('public.partner_proofs.photo_path', 'public.partner_proofs', 'photo_path'),
      ('public.partner_proofs.latitude', 'public.partner_proofs', 'latitude'),
      ('public.partner_proofs.longitude', 'public.partner_proofs', 'longitude'),
      ('public.partner_proofs.coins', 'public.partner_proofs', 'coins'),
      ('public.partner_proofs.status', 'public.partner_proofs', 'status'),
      ('public.partner_damage_reports.assignment_id', 'public.partner_damage_reports', 'assignment_id'),
      ('public.partner_stock_movements.proof_id', 'public.partner_stock_movements', 'proof_id'),
      ('public.partner_coin_ledger.proof_id', 'public.partner_coin_ledger', 'proof_id')
    ) AS required(name, table_name, column_name)
  ),
  'migrationObjectsAbsent', jsonb_build_object(
    'rateLimitTable', to_regclass('public.partner_reverse_geocode_rate_limit') IS NULL,
    'submitIndependentProofFunction', to_regprocedure(
      'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'
    ) IS NULL,
    'reserveGeocodeSlotFunction',
      to_regprocedure('public.reserve_partner_reverse_geocode_slot()') IS NULL,
    'proofColumns', (
      SELECT bool_and(NOT EXISTS (
        SELECT 1
        FROM pg_attribute attribute
        WHERE attribute.attrelid = to_regclass('public.partner_proofs')
          AND attribute.attname = required.column_name
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ))
      FROM (VALUES
        ('business_name'), ('business_category'), ('delivery_address'), ('address_detail'),
        ('location_accuracy_meters'), ('location_captured_at'), ('location_address_source')
      ) AS required(column_name)
    ),
    'newProofConstraints', (
      SELECT bool_and(NOT EXISTS (
        SELECT 1 FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = to_regclass('public.partner_proofs')
          AND constraint_row.conname = required.constraint_name
      ))
      FROM (VALUES
        ('partner_proofs_business_name_check'),
        ('partner_proofs_business_category_check'),
        ('partner_proofs_delivery_address_check'),
        ('partner_proofs_address_detail_check'),
        ('partner_proofs_location_accuracy_check'),
        ('partner_proofs_location_source_check'),
        ('partner_proofs_gps_evidence_check')
      ) AS required(constraint_name)
    )
  ),
  'history', jsonb_build_object(
    'ledgerExists', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
    'ledgerColumns', (
      SELECT COALESCE(jsonb_agg(attribute.attname ORDER BY attribute.attnum), '[]'::jsonb)
      FROM pg_attribute attribute
      WHERE attribute.attrelid = to_regclass('supabase_migrations.schema_migrations')
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ),
    'candidateRelations', (
      SELECT COALESCE(jsonb_agg(format('%I.%I', namespace.nspname, relation.relname)
        ORDER BY namespace.nspname, relation.relname), '[]'::jsonb)
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE relation.relkind IN ('r', 'p')
        AND namespace.nspname NOT IN (
          'pg_catalog', 'information_schema', 'auth', 'storage',
          'realtime', 'vault', 'extensions'
        )
        AND NOT (
          namespace.nspname = 'supabase_migrations'
          AND relation.relname = 'schema_migrations'
        )
        AND (
          relation.relname ILIKE '%migrat%'
          OR relation.relname ILIKE '%schema_history%'
          OR relation.relname ILIKE '%version%'
        )
    )
  ),
  'schema', jsonb_build_object(
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
    'withdrawalThreshold100000', position('100000' IN pg_get_functiondef(
      to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
    )) > 0
  ),
  'preservation', (
    SELECT jsonb_object_agg(table_name, jsonb_build_object(
      'rows', row_count,
      'md5', fingerprint
    ) ORDER BY table_name)
    FROM (
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
      SELECT 'partner_profiles' AS table_name, count(*)::bigint AS row_count,
        md5(COALESCE(string_agg(to_jsonb(row_data)::text, E'\n' ORDER BY to_jsonb(row_data)::text), '')) AS fingerprint
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
    ) AS snapshots
  ),
  'reservationInvariant', NOT EXISTS (
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
    WHERE COALESCE(stock.on_hand, 0) < COALESCE(pending.reserved, 0)
  )
)::text;
ROLLBACK;
'@

$environmentHelperPath = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
. $environmentHelperPath
$temporaryOutputPath = Join-Path $env:TEMP ('partner-independent-baseline-' + [guid]::NewGuid().ToString('N') + '.json')
$savedEnvironment = $null
try {
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $psqlArguments = @(
    '--no-psqlrc', '--no-password',
    '--host', $expectedDatabaseHost, '--port', '5432',
    '--username', "postgres.$expectedProjectRef", '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--quiet', '--no-align', '--tuples-only',
    '--output', $temporaryOutputPath, '--command', $sql
  )
  $diagnostics = @(& $PsqlPath @psqlArguments 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
    throw "Read-only Production baseline query failed (psql exit code $exitCode); diagnostics omitted."
  }
  try {
    $snapshot = Get-Content -LiteralPath $temporaryOutputPath -Raw | ConvertFrom-Json -Depth 50
  } catch {
    throw 'The read-only Production baseline did not return valid JSON.'
  }
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  if (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf) {
    Remove-Item -LiteralPath $temporaryOutputPath -Force
  }
}

if ($snapshot.identity.database -cne 'postgres' -or
  $snapshot.identity.user -cne 'postgres' -or
  $snapshot.identity.readOnly -cne 'on' -or
  $snapshot.identity.primary -ne $true -or
  [string]$snapshot.identity.serverVersionNumber -notmatch '^17') {
  throw 'The baseline query did not execute against the pinned primary Production database in READ ONLY mode.'
}
if ($snapshot.privateProofBucket -ne $true -or $snapshot.stockIdempotencyIndex -ne $true) {
  throw 'The private proof bucket or stock-movement idempotency index prerequisite is missing.'
}
foreach ($relation in $requiredRelations) {
  $relationProperty = $snapshot.relations.PSObject.Properties[$relation]
  if ($null -eq $relationProperty -or $relationProperty.Value -ne $true) {
    throw "A required Production dependency is missing: $relation"
  }
}
foreach ($signature in $requiredFunctions) {
  $functionProperty = $snapshot.requiredFunctions.PSObject.Properties[$signature]
  if ($null -eq $functionProperty -or $functionProperty.Value -ne $true) {
    throw "A required Production function is missing: $signature"
  }
}
foreach ($columnName in $snapshot.requiredColumns.PSObject.Properties.Name) {
  if ($snapshot.requiredColumns.PSObject.Properties[$columnName].Value -ne $true) {
    throw "A required Production column is missing: $columnName"
  }
}
foreach ($property in $snapshot.migrationObjectsAbsent.PSObject.Properties) {
  if ($property.Value -ne $true) {
    throw "A new-migration object already exists in Production: $($property.Name)"
  }
}
if ($snapshot.schema.stockMovementTrigger -eq $null -or
  $snapshot.schema.withdrawalThreshold100000 -ne $true -or
  $snapshot.reservationInvariant -ne $true) {
  throw 'Production stock, proof, or withdrawal invariants did not pass the baseline.'
}
if (@($snapshot.history.candidateRelations).Count -gt 0) {
  throw "Production migration-history candidates need reconciliation: $(@($snapshot.history.candidateRelations) -join ', ')"
}
if ($snapshot.history.ledgerExists -eq $true -and
  @($snapshot.history.ledgerColumns) -notcontains 'version') {
  throw 'The Production migration ledger exists without a recognizable version column.'
}

$historyVersions = @()
if ($snapshot.history.ledgerExists -eq $true) {
  if (@($snapshot.history.ledgerColumns) -notcontains 'version') {
    throw 'The Production migration ledger exists but does not expose a version column; manual reconciliation is required.'
  }
  $historySql = @'
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT COALESCE(jsonb_agg(version::text ORDER BY version::text), '[]'::jsonb)::text
FROM supabase_migrations.schema_migrations;
ROLLBACK;
'@
  $historyPath = Join-Path $env:TEMP ('partner-history-' + [guid]::NewGuid().ToString('N') + '.json')
  $savedHistoryEnvironment = $null
  try {
    $savedHistoryEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
    $historyDiagnostics = @(& $PsqlPath '--no-psqlrc' '--no-password' `
      '--host' $expectedDatabaseHost '--port' '5432' `
      '--username' "postgres.$expectedProjectRef" '--dbname' 'postgres' `
      '--set' 'ON_ERROR_STOP=1' '--quiet' '--no-align' '--tuples-only' `
      '--output' $historyPath '--command' $historySql 2>&1)
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $historyPath -PathType Leaf)) {
      throw 'Could not read the Production migration ledger in a read-only transaction.'
    }
    $historyVersions = @(Get-Content -LiteralPath $historyPath -Raw | ConvertFrom-Json -Depth 20)
  } finally {
    if ($null -ne $savedHistoryEnvironment) {
      Exit-StagingPsqlEnvironment -SavedEnvironment $savedHistoryEnvironment
    }
    if (Test-Path -LiteralPath $historyPath -PathType Leaf) {
      Remove-Item -LiteralPath $historyPath -Force
    }
  }
  if (@($historyVersions | Where-Object { [string]$_ -ceq $migrationVersion }).Count -gt 0) {
    throw 'The independent-delivery migration version already exists in the Production ledger.'
  }
  foreach ($version in $requiredPriorVersions) {
    if (@($historyVersions | Where-Object { [string]$_ -ceq $version }).Count -ne 1) {
      throw "Production migration history is missing required predecessor $version."
    }
  }
}
$snapshot.history | Add-Member -NotePropertyName versions -NotePropertyValue @($historyVersions) -Force

$baseline = [ordered]@{
  formatVersion = 1
  projectRef = $expectedProjectRef
  migrationFile = $migrationFileName
  migrationVersion = $migrationVersion
  migrationSha256 = $expectedMigrationHash
  backupEvidencePath = $backupManifestPath
  backupSha256 = [string]$backupEvidence.sha256
  capturedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
  production = $snapshot
}
[System.IO.File]::WriteAllText(
  $outputPathFull,
  (ConvertTo-Json -InputObject $baseline -Depth 50) + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false)
)

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
$icaclsPath = Join-Path $env:SystemRoot 'System32\icacls.exe'
$aclOutput = @(& $icaclsPath $outputPathFull '/inheritance:r' '/grant:r' `
  "*${currentSid}:F" '*S-1-5-18:F' '*S-1-5-32-544:F' 2>&1)
if ($LASTEXITCODE -ne 0) {
  throw 'The Production baseline was captured but its ACL could not be restricted to the approved Windows identities.'
}
$baselineAcl = Get-Acl -LiteralPath $outputPathFull
if (-not $baselineAcl.AreAccessRulesProtected -or $baselineAcl.Access.Count -ne 3) {
  throw 'The Production baseline ACL did not pass the protected-identity check.'
}
foreach ($rule in $baselineAcl.Access) {
  $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
    $allowedSids -notcontains $sid -or
    $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) {
    throw 'The Production baseline ACL contains an unapproved or insufficient access rule.'
  }
}

Write-Output 'READ-ONLY PARTNER INDEPENDENT-DELIVERY BASELINE PASS'
Write-Output "Project: $expectedProjectRef"
Write-Output "Migration: $migrationFileName SHA-256=$expectedMigrationHash"
Write-Output "Migration history: $(if ($snapshot.history.ledgerExists) { 'AVAILABLE' } else { 'UNAVAILABLE' })"
Write-Output "Backup SHA-256: $($backupEvidence.sha256)"
Write-Output "Baseline: $outputPathFull"
Write-Output "Baseline SHA-256: $((Get-FileHash -LiteralPath $outputPathFull -Algorithm SHA256).Hash)"
Write-Output 'Partner, proof, stock, coin, campaign, and withdrawal records were fingerprinted; no Production SQL write was attempted.'
