[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [Parameter(Mandatory = $true)]
  [string]$BaselinePath,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedBaselineSha256,
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$migrationFileName = '20261203120000_partner_independent_delivery.sql'
$migrationVersion = '20261203120000'
$expectedMigrationHash = '27CA5D24E904E042A6732A78B5E2920A60ED6BF4466BAED009112DC02CADA59E'
$expectedNewConstraints = @(
  'partner_proofs_business_name_check',
  'partner_proofs_business_category_check',
  'partner_proofs_delivery_address_check',
  'partner_proofs_address_detail_check',
  'partner_proofs_location_accuracy_check',
  'partner_proofs_location_source_check',
  'partner_proofs_gps_evidence_check'
)
$expectedNewProofColumns = @(
  'business_name', 'business_category', 'delivery_address', 'address_detail',
  'location_accuracy_meters', 'location_captured_at', 'location_address_source'
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
  $toolVersion = (& $tool.Path --version 2>&1 | Out-String).Trim()
  $versionPattern = '^' + [regex]::Escape($tool.Name) + ' \(PostgreSQL\) 18(?:\.|\s|$)'
  if ($LASTEXITCODE -ne 0 -or $toolVersion -notmatch $versionPattern) {
    throw "PostgreSQL 18 is required for $($tool.Path). Detected: $toolVersion"
  }
}

$baselineFullPath = [System.IO.Path]::GetFullPath($BaselinePath)
if (-not (Test-Path -LiteralPath $baselineFullPath -PathType Leaf) -or
  (Get-FileHash -LiteralPath $baselineFullPath -Algorithm SHA256).Hash -cne $ExpectedBaselineSha256) {
  throw 'The protected pre-migration baseline is missing or its SHA-256 does not match.'
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
  $baseline.migrationSha256 -cne $expectedMigrationHash -or
  $baseline.production.history.ledgerExists -ne $false -or
  @($baseline.production.history.candidateRelations).Count -ne 0 -or
  @($baseline.production.history.versions).Count -ne 0) {
  throw 'The baseline does not attest this migration or has unresolved/changed migration-history evidence.'
}
$capturedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
    [string]$baseline.capturedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$capturedAt
  ) -or $capturedAt -gt [DateTimeOffset]::UtcNow -or
  $capturedAt -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'The Production baseline must have been captured within the last 24 hours.'
}

$backupManifestPath = [System.IO.Path]::GetFullPath([string]$baseline.backupEvidencePath)
$backupManifest = Get-Content -LiteralPath $backupManifestPath -Raw | ConvertFrom-Json -Depth 20 -DateKind String
if ($backupManifest.projectRef -cne $expectedProjectRef -or
  $backupManifest.sha256 -cne $baseline.backupSha256 -or
  $backupManifest.restoreDrill.status -cne 'PASS') {
  throw 'The baseline is not bound to the verified fresh Production backup.'
}
$backupVerifierPath = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'
$backupOutput = @(& (Get-Command pwsh -ErrorAction Stop).Source -NoProfile -File $backupVerifierPath `
  -EvidencePath $backupManifestPath -PgRestorePath $PgRestorePath 2>&1)
if ($LASTEXITCODE -ne 0 -or
  @($backupOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') {
  throw 'Independent verification of the fresh Production backup and isolated restore failed.'
}

$sql = @'
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';
SELECT jsonb_build_object(
  'identity', jsonb_build_object(
    'database', current_database(),
    'user', current_user,
    'readOnly', current_setting('transaction_read_only'),
    'primary', NOT pg_is_in_recovery(),
    'serverVersionNumber', current_setting('server_version_num')
  ),
  'history', jsonb_build_object(
    'ledgerExists', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,
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
  'objects', jsonb_build_object(
    'rateLimitTable', to_regclass('public.partner_reverse_geocode_rate_limit') IS NOT NULL,
    'rateLimitRls', (
      SELECT relrowsecurity FROM pg_class
      WHERE oid = to_regclass('public.partner_reverse_geocode_rate_limit')
    ),
    'rateLimitRows', (
      SELECT count(*) FROM public.partner_reverse_geocode_rate_limit
      WHERE singleton = true
    ),
    'rateLimitTotalRows', (SELECT count(*) FROM public.partner_reverse_geocode_rate_limit),
    'newFunctions', jsonb_build_object(
      'submitProof', to_regprocedure(
        'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'
      ) IS NOT NULL,
      'geocodeSlot', to_regprocedure('public.reserve_partner_reverse_geocode_slot()') IS NOT NULL
    ),
    'newProofColumns', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', attribute.attname,
        'type', format_type(attribute.atttypid, attribute.atttypmod),
        'notNull', attribute.attnotnull,
        'default', COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '')
      ) ORDER BY attribute.attname), '[]'::jsonb)
      FROM pg_attribute attribute
      LEFT JOIN pg_attrdef default_value
        ON default_value.adrelid = attribute.attrelid AND default_value.adnum = attribute.attnum
      WHERE attribute.attrelid = to_regclass('public.partner_proofs')
        AND attribute.attname IN (
          'business_name', 'business_category', 'delivery_address', 'address_detail',
          'location_accuracy_meters', 'location_captured_at', 'location_address_source'
        )
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
    ),
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
    'nullableLegacyAssignments', (
      SELECT count(*) = 4
      FROM pg_attribute attribute
      WHERE ((attribute.attrelid = to_regclass('public.partner_proofs')
          AND attribute.attname IN ('assignment_id', 'campaign_id', 'site_id'))
        OR (attribute.attrelid = to_regclass('public.partner_damage_reports')
          AND attribute.attname = 'assignment_id'))
        AND attribute.attnum > 0 AND NOT attribute.attisdropped
        AND NOT attribute.attnotnull
    ),
    'constraints', (
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
    'functionSecurity', (
      SELECT jsonb_object_agg(required.name, (
        proc.oid IS NOT NULL
        AND proc.prosecdef
        AND proc.proowner::regrole::text = 'postgres'
        AND COALESCE(proc.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=pg_catalog, public']
        AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(proc.proacl, acldefault('f', proc.proowner))) acl
          WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        )
      ) ORDER BY required.name)
      FROM (VALUES
        ('submitProof', 'public.submit_independent_partner_proof(uuid,text,text,text,text,text,text,double precision,double precision,double precision,timestamp with time zone,text)'),
        ('geocodeSlot', 'public.reserve_partner_reverse_geocode_slot()')
      ) AS required(name, signature)
      LEFT JOIN pg_proc proc ON proc.oid = to_regprocedure(required.signature)
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
    'proofRls', (
      SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.partner_proofs')
    ),
    'damageReportRls', (
      SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.partner_damage_reports')
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
    ),
    'privateProofBucket', EXISTS (
      SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE
    ),
    'movementGuardNullableSafe', position('is not distinct from' IN lower(pg_get_functiondef(
      to_regprocedure('public.enforce_partner_stock_movement()')
    ))) > 0,
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
    ) AS snapshots
  )
)::text;
ROLLBACK;
'@

. (Join-Path $PSScriptRoot 'psqlEnvironment.ps1')
$temporaryOutputPath = Join-Path $env:TEMP ('partner-independent-post-' + [guid]::NewGuid().ToString('N') + '.json')
$savedEnvironment = $null
try {
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $arguments = @(
    '--no-psqlrc', '--no-password',
    '--host', $databaseHost, '--port', '5432',
    '--username', "postgres.$expectedProjectRef", '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1', '--quiet', '--no-align', '--tuples-only',
    '--output', $temporaryOutputPath, '--command', $sql
  )
  $diagnostics = @(& $PsqlPath @arguments 2>&1)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
    throw 'Independent read-only Production post-migration query failed; raw diagnostics were omitted.'
  }
  try {
    $report = Get-Content -LiteralPath $temporaryOutputPath -Raw | ConvertFrom-Json -Depth 50
  } catch {
    throw 'Independent Production post-migration query returned malformed JSON.'
  }
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  if (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf) {
    Remove-Item -LiteralPath $temporaryOutputPath -Force
  }
}

if ($report.identity.database -cne 'postgres' -or
  $report.identity.user -cne 'postgres' -or
  $report.identity.readOnly -cne 'on' -or
  $report.identity.primary -ne $true -or
  [string]$report.identity.serverVersionNumber -notmatch '^17') {
  throw 'Independent verifier did not connect to the pinned Production primary in READ ONLY mode.'
}
if ($report.history.ledgerExists -ne $false -or
  @($report.history.candidateRelations).Count -ne 0) {
  throw 'Production migration-history state changed; do not create or alter ledger entries.'
}
if ($report.objects.rateLimitTable -ne $true -or
  $report.objects.rateLimitRls -ne $true -or
  [long]$report.objects.rateLimitRows -ne 1 -or
  [long]$report.objects.rateLimitTotalRows -ne 1 -or
  $report.objects.newFunctions.submitProof -ne $true -or
  $report.objects.newFunctions.geocodeSlot -ne $true -or
  $report.objects.nullableLegacyAssignments -ne $true -or
  $report.objects.movementGuardNullableSafe -ne $true -or
  $report.objects.privateProofBucket -ne $true -or
  $report.objects.withdrawalThreshold100000 -ne $true -or
  $report.objects.reservationInvariant -ne $true -or
  $report.objects.proofRls -ne $true -or
  $report.objects.damageReportRls -ne $true) {
  throw 'Independent Production post-migration invariant or security check failed.'
}
foreach ($functionName in @('submitProof', 'geocodeSlot')) {
  if ($report.objects.functionSecurity.$functionName -ne $true) {
    throw "Independent function authorization/security check failed: $functionName"
  }
}
$actualColumns = @($report.objects.newProofColumns | ForEach-Object { [string]$_.name } | Sort-Object -CaseSensitive)
$expectedColumns = @($expectedNewProofColumns | Sort-Object -CaseSensitive)
if (@(Compare-Object $actualColumns $expectedColumns -CaseSensitive).Count -ne 0) {
  throw 'Independent verifier found a missing or unexpected independent-delivery proof column.'
}
$columnExpectations = @{
  business_name = @{ Type = 'text'; NotNull = $true; Default = "''::text" }
  business_category = @{ Type = 'text'; NotNull = $true; Default = "''::text" }
  delivery_address = @{ Type = 'text'; NotNull = $true; Default = "''::text" }
  address_detail = @{ Type = 'text'; NotNull = $true; Default = "''::text" }
  location_accuracy_meters = @{ Type = 'double precision'; NotNull = $false; Default = '' }
  location_captured_at = @{ Type = 'timestamp with time zone'; NotNull = $false; Default = '' }
  location_address_source = @{ Type = 'text'; NotNull = $true; Default = "'campaign_legacy'::text" }
}
foreach ($column in $report.objects.newProofColumns) {
  $expectation = $columnExpectations[[string]$column.name]
  if ([string]$column.type -cne $expectation.Type -or
    [bool]$column.notNull -ne $expectation.NotNull -or
    [string]$column.default -cne $expectation.Default) {
    throw "Independent verifier found an invalid definition for proof column $($column.name)."
  }
}
$newConstraints = @($report.objects.constraints | Where-Object {
  $expectedNewConstraints -contains $_.name
})
$constraints = @($newConstraints | ForEach-Object { [string]$_.name } | Sort-Object -CaseSensitive)
$expectedConstraints = @($expectedNewConstraints | Sort-Object -CaseSensitive)
if (@(Compare-Object $constraints $expectedConstraints -CaseSensitive).Count -ne 0) {
  throw 'Independent verifier found a missing or unexpected delivery-proof constraint.'
}
foreach ($constraint in $newConstraints) {
  if ($constraint.validated -ne $true -or [string]$constraint.definition -notmatch 'CHECK') {
    throw "Independent verifier found an unvalidated or malformed proof constraint: $($constraint.name)"
  }
}
$legacyGpsConstraint = @($newConstraints | Where-Object {
  $_.name -ceq 'partner_proofs_gps_evidence_check'
})
if ($legacyGpsConstraint.Count -ne 1 -or
  $legacyGpsConstraint[0].definition -notmatch 'campaign_legacy' -or
  $legacyGpsConstraint[0].definition -notmatch 'location_accuracy_meters IS NULL' -or
  $legacyGpsConstraint[0].definition -notmatch 'location_captured_at IS NULL') {
  throw 'Existing campaign proofs with legacy coordinates were not explicitly preserved by the GPS evidence constraint.'
}

$baselineProofColumns = @($baseline.production.schema.proofColumns | ForEach-Object {
  $notNull = [bool]$_.notNull
  if ($_.name -in @('assignment_id', 'campaign_id', 'site_id')) { $notNull = $false }
  [ordered]@{ name = $_.name; type = $_.type; notNull = $notNull; default = $_.default }
} | Sort-Object -Property name)
$currentProofColumns = @($report.objects.proofColumns | Where-Object {
  $expectedNewProofColumns -notcontains $_.name
} | ForEach-Object {
  [ordered]@{ name = $_.name; type = $_.type; notNull = [bool]$_.notNull; default = $_.default }
} | Sort-Object -Property name)
if ((ConvertTo-Json -InputObject $baselineProofColumns -Depth 20 -Compress) -cne
  (ConvertTo-Json -InputObject $currentProofColumns -Depth 20 -Compress)) {
  throw 'Existing partner proof column definitions changed beyond nullable legacy assignments.'
}
$baselineDamageColumns = @($baseline.production.schema.damageReportColumns | ForEach-Object {
  $notNull = [bool]$_.notNull
  if ($_.name -ceq 'assignment_id') { $notNull = $false }
  [ordered]@{ name = $_.name; type = $_.type; notNull = $notNull; default = $_.default }
} | Sort-Object -Property name)
$currentDamageColumns = @($report.objects.damageReportColumns | ForEach-Object {
  [ordered]@{ name = $_.name; type = $_.type; notNull = [bool]$_.notNull; default = $_.default }
} | Sort-Object -Property name)
if ((ConvertTo-Json -InputObject $baselineDamageColumns -Depth 20 -Compress) -cne
  (ConvertTo-Json -InputObject $currentDamageColumns -Depth 20 -Compress)) {
  throw 'Existing damage-report column definitions changed beyond nullable assignments.'
}

$baselineConstraints = @($baseline.production.schema.proofConstraints | Where-Object {
  $expectedNewConstraints -notcontains $_.name
} | Sort-Object -Property name)
$currentUnchangedConstraints = @($report.objects.constraints | Where-Object {
  $expectedNewConstraints -notcontains $_.name
} | Sort-Object -Property name)
if ((ConvertTo-Json -InputObject $baselineConstraints -Depth 20 -Compress) -cne
  (ConvertTo-Json -InputObject $currentUnchangedConstraints -Depth 20 -Compress)) {
  throw 'Existing partner-proof constraints changed during migration.'
}
if ((ConvertTo-Json -InputObject @($baseline.production.schema.damageReportConstraints) -Depth 20 -Compress) -cne
  (ConvertTo-Json -InputObject @($report.objects.damageReportConstraints) -Depth 20 -Compress)) {
  throw 'Existing damage-report constraints changed during migration.'
}

$baselinePolicies = ConvertTo-Json -InputObject @($baseline.production.schema.policies) -Depth 20 -Compress
$currentPolicies = ConvertTo-Json -InputObject @($report.objects.policies) -Depth 20 -Compress
if ($baselinePolicies -cne $currentPolicies) {
  throw 'Partner proof or damage-report RLS policies changed during migration.'
}
$baselineRowSecurity = @{
  proof = [bool]$baseline.production.schema.rowSecurity.'public.partner_proofs'.enabled
  damage = [bool]$baseline.production.schema.rowSecurity.'public.partner_damage_reports'.enabled
}
$currentRowSecurity = @{
  proof = [bool]$report.objects.proofRls
  damage = [bool]$report.objects.damageReportRls
}
if ((ConvertTo-Json -InputObject $baselineRowSecurity -Compress) -cne
  (ConvertTo-Json -InputObject $currentRowSecurity -Compress)) {
  throw 'Partner proof or damage-report RLS state changed during migration.'
}
foreach ($functionName in @('legacyProofSubmission', 'proofReview', 'withdrawal')) {
  if ([string]$report.objects.relevantFunctionMd5.$functionName -cne
    [string]$baseline.production.schema.relevantFunctionMd5.$functionName) {
    throw "Existing production function changed unexpectedly: $functionName"
  }
}
if ((ConvertTo-Json -InputObject $report.objects.stockMovementTrigger -Depth 20 -Compress) -cne
  (ConvertTo-Json -InputObject $baseline.production.schema.stockMovementTrigger -Depth 20 -Compress)) {
  throw 'The existing stock-movement trigger definition changed unexpectedly.'
}
foreach ($tableName in $baseline.production.preservation.PSObject.Properties.Name) {
  $expectedSnapshot = $baseline.production.preservation.PSObject.Properties[$tableName].Value
  $actualSnapshotProperty = $report.preservation.PSObject.Properties[$tableName]
  if ($null -eq $actualSnapshotProperty -or
    [long]$actualSnapshotProperty.Value.rows -ne [long]$expectedSnapshot.rows -or
    [string]$actualSnapshotProperty.Value.md5 -cne [string]$expectedSnapshot.md5) {
    throw "Independent Production data-preservation fingerprint mismatch: $tableName"
  }
}
if (@($report.preservation.PSObject.Properties).Count -ne
  @($baseline.production.preservation.PSObject.Properties).Count) {
  throw 'Independent Production data-preservation snapshot table set changed.'
}

Write-Output 'PARTNER INDEPENDENT-DELIVERY POST-MIGRATION VERIFICATION PASS'
Write-Output "Project: $expectedProjectRef / postgres"
Write-Output "Migration: $migrationVersion ($expectedMigrationHash)"
Write-Output 'Schema objects, RLS/function grants, 1,000-coin and 100,000-withdrawal safeguards, history state, and preserved account/proof/stock/campaign fingerprints: PASS'
Write-Output 'Migration history remains unavailable and unchanged; no ledger entries were invented or written.'
