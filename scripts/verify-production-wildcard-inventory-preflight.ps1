[CmdletBinding()]
param(
  [string]$ProjectRef = 'axbjzmdokfoftzfgwiql',
  [string]$PasswordFilePath = (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass'),
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"
$version = '20261202120000'

if ($ProjectRef -cne $expectedProjectRef) {
  throw 'ProjectRef does not match the pinned Production project.'
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}
$psqlVersion = (& $PsqlPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $psqlVersion -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 psql is required. Detected: $psqlVersion"
}

. (Join-Path $PSScriptRoot 'psqlEnvironment.ps1')

$sqlPath = Join-Path $env:TEMP ("neargrow-wildcard-preflight-" + [guid]::NewGuid().ToString('N') + '.psql')
$outputPath = Join-Path $env:TEMP ("neargrow-wildcard-preflight-output-" + [guid]::NewGuid().ToString('N') + '.txt')
$savedEnvironment = $null
$sql = @'
BEGIN TRANSACTION READ ONLY;

SELECT 'TARGET|' ||
  CASE WHEN current_database() = 'postgres'
    AND current_user = 'postgres'
    AND current_setting('transaction_read_only') = 'on'
    AND NOT pg_is_in_recovery()
    AND to_regclass('auth.users') IS NOT NULL
  THEN 'PASS' ELSE 'FAIL' END ||
  '|' || current_setting('server_version_num');

WITH required_tables(table_name) AS (
  VALUES
    ('partner_profiles'),
    ('partner_campaigns'),
    ('partner_campaign_assignments'),
    ('partner_campaign_sites'),
    ('partner_campaign_requests'),
    ('partner_damage_reports'),
    ('partner_proofs'),
    ('partner_stock_movements'),
    ('partner_withdrawal_requests'),
    ('partner_coin_ledger'),
    ('delivery_team_activity'),
    ('admin_users')
)
SELECT 'TABLE|' || required.table_name || '|' ||
  CASE WHEN relation.oid IS NOT NULL THEN 'true' ELSE 'false' END || '|' ||
  COALESCE(relation.relrowsecurity::text, 'false') || '|' ||
  COALESCE(relation.relforcerowsecurity::text, 'false')
FROM required_tables required
LEFT JOIN pg_class relation
  ON relation.oid = to_regclass('public.' || required.table_name)
ORDER BY required.table_name;

WITH required_columns(table_name, column_name) AS (
  VALUES
    ('partner_profiles', 'id'), ('partner_profiles', 'status'), ('partner_profiles', 'full_name'),
    ('partner_campaigns', 'id'), ('partner_campaigns', 'name'), ('partner_campaigns', 'status'),
    ('partner_campaigns', 'start_date'), ('partner_campaigns', 'end_date'),
    ('partner_campaign_assignments', 'id'), ('partner_campaign_assignments', 'partner_profile_id'),
    ('partner_campaign_assignments', 'campaign_id'), ('partner_campaign_assignments', 'active'),
    ('partner_campaign_assignments', 'daily_target'),
    ('partner_campaign_sites', 'id'), ('partner_campaign_sites', 'campaign_id'),
    ('partner_campaign_requests', 'id'), ('partner_campaign_requests', 'assignment_id'),
    ('partner_campaign_requests', 'partner_profile_id'), ('partner_campaign_requests', 'request_type'),
    ('partner_campaign_requests', 'details'), ('partner_campaign_requests', 'status'),
    ('partner_campaign_requests', 'review_note'), ('partner_campaign_requests', 'reviewed_at'),
    ('partner_campaign_requests', 'reviewed_by'),
    ('partner_damage_reports', 'id'), ('partner_damage_reports', 'assignment_id'),
    ('partner_damage_reports', 'partner_profile_id'), ('partner_damage_reports', 'issue_type'),
    ('partner_damage_reports', 'status'), ('partner_damage_reports', 'card_id'),
    ('partner_damage_reports', 'review_note'), ('partner_damage_reports', 'reviewed_at'),
    ('partner_damage_reports', 'reviewed_by'),
    ('partner_proofs', 'id'), ('partner_proofs', 'assignment_id'), ('partner_proofs', 'campaign_id'),
    ('partner_proofs', 'site_id'), ('partner_proofs', 'partner_profile_id'),
    ('partner_proofs', 'photo_path'), ('partner_proofs', 'note'), ('partner_proofs', 'latitude'),
    ('partner_proofs', 'longitude'), ('partner_proofs', 'coins'), ('partner_proofs', 'status'),
    ('partner_proofs', 'submitted_at'),
    ('partner_stock_movements', 'id'), ('partner_stock_movements', 'assignment_id'),
    ('partner_stock_movements', 'partner_profile_id'), ('partner_stock_movements', 'movement_type'),
    ('partner_stock_movements', 'quantity'), ('partner_stock_movements', 'proof_id'),
    ('partner_stock_movements', 'notes'), ('partner_stock_movements', 'created_by'),
    ('partner_stock_movements', 'administrator_id'), ('partner_stock_movements', 'previous_balance'),
    ('partner_stock_movements', 'resulting_balance'), ('partner_stock_movements', 'idempotency_key'),
    ('partner_coin_ledger', 'partner_profile_id'), ('partner_coin_ledger', 'campaign_id'),
    ('partner_coin_ledger', 'proof_id'), ('partner_coin_ledger', 'entry_type'),
    ('partner_coin_ledger', 'amount'), ('partner_coin_ledger', 'status'),
    ('partner_coin_ledger', 'reference'), ('partner_coin_ledger', 'notes'),
    ('partner_withdrawal_requests', 'partner_profile_id'),
    ('delivery_team_activity', 'activity_type'), ('delivery_team_activity', 'actor_id'),
    ('delivery_team_activity', 'partner_profile_id'), ('delivery_team_activity', 'partner_name'),
    ('delivery_team_activity', 'campaign_id'), ('delivery_team_activity', 'details'),
    ('delivery_team_activity', 'status'),
    ('admin_users', 'id'), ('admin_users', 'is_primary_owner'), ('admin_users', 'status'),
    ('admin_users', 'role')
)
SELECT 'COLUMN|' || required.table_name || '|' || required.column_name || '|' ||
  CASE WHEN column_info.column_name IS NOT NULL THEN 'true' ELSE 'false' END || '|' ||
  COALESCE(column_info.data_type, 'missing')
FROM required_columns required
LEFT JOIN information_schema.columns column_info
  ON column_info.table_schema = 'public'
  AND column_info.table_name = required.table_name
  AND column_info.column_name = required.column_name
ORDER BY required.table_name, required.column_name;

SELECT 'FUNCTION|' || name || '|' ||
  CASE WHEN to_regprocedure(signature) IS NOT NULL THEN 'true' ELSE 'false' END
FROM (VALUES
  ('assert_delivery_team_admin', 'public.assert_delivery_team_admin(uuid,text)'),
  ('request_partner_withdrawal', 'public.request_partner_withdrawal(uuid,integer)'),
  ('submit_partner_proof', 'public.submit_partner_proof(uuid,uuid,uuid,text,text,double precision,double precision)'),
  ('admin_review_partner_proof', 'public.admin_review_partner_proof(uuid,uuid,text,text)'),
  ('admin_review_partner_campaign_request', 'public.admin_review_partner_campaign_request(uuid,uuid,text,text,integer)')
) AS expected(name, signature)
ORDER BY name;

SELECT 'WITHDRAWAL_THRESHOLD|' ||
  CASE WHEN pg_get_functiondef(
    to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
  ) LIKE '%100000%'
  THEN 'PRESENT' ELSE 'MISSING' END;

SELECT 'RESERVATION_INVARIANT|' ||
  CASE WHEN EXISTS (
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
  ) THEN 'FAIL' ELSE 'PASS' END;

SELECT 'MIGRATION_HISTORY|' ||
  CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL
    THEN 'UNAVAILABLE' ELSE 'AVAILABLE' END;

SELECT to_regprocedure('public.get_partner_inventory_summary(uuid)') IS NOT NULL AS inventory_function_exists \gset
\if :inventory_function_exists
SELECT 'MIGRATION_OBJECTS|' ||
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_campaign_requests'
      AND column_name = 'stock_quantity'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_stock_movements'
      AND column_name = 'campaign_request_id'
  ) THEN 'PRESENT' ELSE 'PARTIAL' END;
\else
SELECT 'MIGRATION_OBJECTS|' ||
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('partner_campaign_requests', 'partner_stock_movements')
      AND column_name IN ('stock_quantity', 'campaign_request_id', 'damage_report_id')
  ) THEN 'PARTIAL' ELSE 'ABSENT' END;
\endif

ROLLBACK;
'@

try {
  [System.IO.File]::WriteAllText($sqlPath, $sql, [System.Text.UTF8Encoding]::new($false))
  $savedEnvironment = Enter-StagingPsqlEnvironment -PasswordFilePath $PasswordFilePath
  $arguments = @(
    '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
    '--no-align', '--tuples-only', '--field-separator', '|',
    '--host', $databaseHost, '--port', $databasePort,
    '--username', $databaseUser, '--dbname', $databaseName,
    '--output', $outputPath, '--file', $sqlPath
  )
  & $PsqlPath @arguments
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
    throw 'Read-only Production inventory preflight failed. No migration was run.'
  }

  $rows = @(Get-Content -LiteralPath $outputPath)
  $target = @($rows | Where-Object { $_ -like 'TARGET|*' })
  if ($target.Count -ne 1 -or $target[0] -notlike 'TARGET|PASS|*') {
    throw 'Production target or READ ONLY transaction verification failed.'
  }

  $missingTables = @(
    $rows | Where-Object { $_ -like 'TABLE|*|false|*' }
  )
  $missingColumns = @(
    $rows | Where-Object { $_ -like 'COLUMN|*|false|*' }
  )
  $missingFunctions = @(
    $rows | Where-Object { $_ -like 'FUNCTION|*|false' }
  )
  $invariant = @($rows | Where-Object { $_ -like 'RESERVATION_INVARIANT|*' })
  $threshold = @($rows | Where-Object { $_ -like 'WITHDRAWAL_THRESHOLD|*' })
  $migrationObjects = @($rows | Where-Object { $_ -like 'MIGRATION_OBJECTS|*' })
  if ($missingTables.Count -gt 0 -or $missingColumns.Count -gt 0 -or
      $missingFunctions.Count -gt 0 -or $invariant.Count -ne 1 -or
      $invariant[0] -cne 'RESERVATION_INVARIANT|PASS' -or
      $threshold.Count -ne 1 -or $threshold[0] -cne 'WITHDRAWAL_THRESHOLD|PRESENT' -or
      $migrationObjects.Count -ne 1 -or $migrationObjects[0] -cne 'MIGRATION_OBJECTS|ABSENT') {
    Write-Output 'Production schema preflight: FAIL'
    foreach ($row in @($missingTables + $missingColumns + $missingFunctions + $invariant + $threshold + $migrationObjects)) {
      Write-Output $row
    }
    throw 'Production schema/dependency preconditions failed; no migration was run.'
  }

  Write-Output 'Production schema preflight: PASS (read-only transaction)'
  Write-Output "Pinned project: $expectedProjectRef / $databaseName"
  Write-Output "PostgreSQL server version: $($target[0].Split('|')[2])"
  Write-Output "Required relations: $(@($rows | Where-Object { $_ -like 'TABLE|*|true|*' }).Count) present"
  Write-Output "Required columns: $(@($rows | Where-Object { $_ -like 'COLUMN|*|true|*' }).Count) present"
  Write-Output "Required functions: $(@($rows | Where-Object { $_ -like 'FUNCTION|*|true' }).Count) present"
  Write-Output 'Pending-proof stock reservation invariant: PASS'
  Write-Output 'Existing 100,000 NGA Coin withdrawal threshold: PRESENT'
  Write-Output 'New inventory migration objects: ABSENT'
  $history = @($rows | Where-Object { $_ -like 'MIGRATION_HISTORY|*' })
  if ($history.Count -eq 1) {
    Write-Output $history[0]
  }
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  foreach ($path in @($sqlPath, $outputPath)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}
