[CmdletBinding()]
param(
  [string]$ProjectRef = 'axbjzmdokfoftzfgwiql',
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$expectedMigrationHash = '7E1B957F3908DB58499E6296CEE43D6BCD71E68DC8EDA864DC5291B82EBC5BEE'
$migrationPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'supabase\migrations\20261106120000_add_optional_customer_location.sql'

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
  throw "Reviewed location migration is missing: $migrationPath"
}
$migrationText = (Get-Content -LiteralPath $migrationPath -Raw).Replace("`r`n", "`n")
$actualMigrationHash = ([Security.Cryptography.SHA256]::Create()).ComputeHash(
  [Text.Encoding]::UTF8.GetBytes($migrationText)
) | ForEach-Object { $_.ToString('x2') } | Join-String
$actualMigrationHash = $actualMigrationHash.ToUpperInvariant()
if ($actualMigrationHash -cne $expectedMigrationHash) {
  throw "Reviewed migration SHA-256 mismatch. Expected $expectedMigrationHash; found $actualMigrationHash."
}

. (Join-Path $PSScriptRoot 'productionAdminDeletionCheck.Common.ps1')
Write-Output "Reviewed migration SHA-256: $actualMigrationHash"
Confirm-ProductionAdminDeletionDatabase -ProjectRef $ProjectRef

$sql = @'
SET default_transaction_read_only = on;

SELECT 'CHECK|location_dependencies|' ||
  CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END ||
  '|required_tables=' || count(*) || ';expected=3'
FROM pg_class
WHERE oid IN (
  to_regclass('public.service_orders'),
  to_regclass('public.service_enquiry_requests'),
  to_regclass('public.leads')
);

WITH expected_columns(table_name, column_name, expected_type, expected_precision, expected_scale, expected_nullable, expected_default) AS (
  VALUES
    ('service_orders','customer_location_latitude','numeric',9,6,'YES',NULL),
    ('service_orders','customer_location_longitude','numeric',9,6,'YES',NULL),
    ('service_orders','customer_location_accuracy_meters','numeric',10,2,'YES',NULL),
    ('service_orders','customer_location_locality','text',NULL,NULL,'YES',NULL),
    ('service_orders','customer_location_captured_at','timestamp with time zone',NULL,NULL,'YES',NULL),
    ('service_orders','customer_location_consent','boolean',NULL,NULL,'NO','false'),
    ('service_enquiry_requests','customer_location_latitude','numeric',9,6,'YES',NULL),
    ('service_enquiry_requests','customer_location_longitude','numeric',9,6,'YES',NULL),
    ('service_enquiry_requests','customer_location_accuracy_meters','numeric',10,2,'YES',NULL),
    ('service_enquiry_requests','customer_location_locality','text',NULL,NULL,'YES',NULL),
    ('service_enquiry_requests','customer_location_captured_at','timestamp with time zone',NULL,NULL,'YES',NULL),
    ('service_enquiry_requests','customer_location_consent','boolean',NULL,NULL,'NO','false'),
    ('leads','customer_location_latitude','numeric',9,6,'YES',NULL),
    ('leads','customer_location_longitude','numeric',9,6,'YES',NULL),
    ('leads','customer_location_accuracy_meters','numeric',10,2,'YES',NULL),
    ('leads','customer_location_locality','text',NULL,NULL,'YES',NULL),
    ('leads','customer_location_captured_at','timestamp with time zone',NULL,NULL,'YES',NULL),
    ('leads','customer_location_consent','boolean',NULL,NULL,'NO','false')
),
column_state AS (
  SELECT e.*,
    CASE WHEN c.column_name IS NULL THEN 'MISSING'
      WHEN c.data_type IS DISTINCT FROM e.expected_type
        OR c.numeric_precision IS DISTINCT FROM e.expected_precision
        OR c.numeric_scale IS DISTINCT FROM e.expected_scale
        OR c.is_nullable IS DISTINCT FROM e.expected_nullable
        OR (e.expected_default IS NULL AND c.column_default IS NOT NULL)
        OR (e.expected_default IS NOT NULL AND lower(coalesce(c.column_default,'')) NOT LIKE 'false%')
      THEN 'MISMATCH' ELSE 'OK' END AS state
  FROM expected_columns e
  LEFT JOIN information_schema.columns c
    ON c.table_schema = 'public' AND c.table_name = e.table_name AND c.column_name = e.column_name
),
expected_constraints(table_name, constraint_name) AS (
  VALUES
    ('service_orders','service_orders_customer_location_coordinates_check'),
    ('service_enquiry_requests','service_enquiry_customer_location_coordinates_check'),
    ('leads','leads_customer_location_coordinates_check')
),
constraint_state AS (
  SELECT e.*,
    CASE WHEN c.conname IS NULL THEN 'MISSING'
      WHEN c.contype <> 'c' OR c.convalidated IS DISTINCT FROM TRUE
        OR pg_get_constraintdef(c.oid) IS NULL
        OR NOT (
          pg_get_constraintdef(c.oid) ILIKE '%customer_location_consent = false%'
          AND pg_get_constraintdef(c.oid) ILIKE '%customer_location_consent = true%'
          AND pg_get_constraintdef(c.oid) ~* 'customer_location_latitude >=[^0-9-]*-90'
          AND pg_get_constraintdef(c.oid) ~* 'customer_location_latitude <=[^0-9]*90'
          AND pg_get_constraintdef(c.oid) ~* 'customer_location_longitude >=[^0-9-]*-180'
          AND pg_get_constraintdef(c.oid) ~* 'customer_location_longitude <=[^0-9]*180'
          AND pg_get_constraintdef(c.oid) ~* 'customer_location_accuracy_meters >[^0-9]*0'
          AND pg_get_constraintdef(c.oid) ILIKE '%customer_location_captured_at IS NOT NULL%'
        )
      THEN 'MISMATCH' ELSE 'OK' END AS state
  FROM expected_constraints e
  LEFT JOIN pg_constraint c
    ON c.conrelid = to_regclass('public.' || e.table_name) AND c.conname = e.constraint_name
),
counts AS (
  SELECT
    count(*) FILTER (WHERE state = 'OK') AS columns_ok,
    count(*) FILTER (WHERE state <> 'OK') AS columns_bad,
    (SELECT count(*) FILTER (WHERE state = 'OK') FROM constraint_state) AS constraints_ok,
    (SELECT count(*) FILTER (WHERE state <> 'OK') FROM constraint_state) AS constraints_bad
  FROM column_state
),
location_state AS (
  SELECT CASE
    WHEN (SELECT count(*) FROM pg_class WHERE oid IN (
      to_regclass('public.service_orders'),
      to_regclass('public.service_enquiry_requests'),
      to_regclass('public.leads')
    )) <> 3 THEN 'PARTIAL'
    WHEN columns_ok = 0 AND columns_bad = 18 AND constraints_ok = 0 AND constraints_bad = 3 THEN 'ABSENT'
    WHEN columns_ok = 18 AND columns_bad = 0 AND constraints_ok = 3 AND constraints_bad = 0 THEN 'COMPLETE'
    ELSE 'PARTIAL'
  END AS state, columns_ok, constraints_ok
  FROM counts
)
SELECT 'CHECK|location_state|' || state ||
  '|columns_ok=' || columns_ok || ';columns_expected=18;constraints_ok=' ||
  constraints_ok || ';constraints_expected=3'
FROM location_state;

SELECT 'CHECK|location_security|' ||
  CASE WHEN count(*) = 3 AND bool_and(c.relrowsecurity)
    AND bool_and(has_table_privilege('service_role', c.oid, 'INSERT'))
    AND bool_and(has_table_privilege('service_role', c.oid, 'SELECT'))
    AND bool_and(has_table_privilege('service_role', c.oid, 'UPDATE'))
    AND has_table_privilege('anon', 'public.service_orders', 'SELECT') = false
    AND has_table_privilege('authenticated', 'public.service_orders', 'SELECT') = false
    AND has_table_privilege('anon', 'public.service_enquiry_requests', 'SELECT') = false
    AND has_table_privilege('authenticated', 'public.service_enquiry_requests', 'SELECT') = false
    AND has_table_privilege('anon', 'public.leads', 'SELECT') = false
    AND has_table_privilege('anon', 'public.leads', 'UPDATE') = false
    AND has_table_privilege('anon', 'public.leads', 'INSERT') = true
    AND has_table_privilege('authenticated', 'public.leads', 'SELECT') = true
    AND has_table_privilege('authenticated', 'public.leads', 'UPDATE') = true
    AND has_table_privilege('authenticated', 'public.leads', 'INSERT') = true
  THEN 'PASS' ELSE 'FAIL' END || '|RLS and existing service_role/client grants'
FROM pg_class c
WHERE c.oid IN (
  to_regclass('public.service_orders'),
  to_regclass('public.service_enquiry_requests'),
  to_regclass('public.leads')
);

SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
  AS migration_ledger_exists \gset
\if :migration_ledger_exists
  SELECT has_schema_privilege(current_user, 'supabase_migrations', 'USAGE')
    AND has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT')
    AS migration_ledger_readable \gset
  \if :migration_ledger_readable
    SELECT 'CHECK|migration_history|' ||
      CASE WHEN EXISTS (
        SELECT 1 FROM supabase_migrations.schema_migrations
        WHERE version = '20261106120000'
          AND name = 'add_optional_customer_location'
      ) THEN 'RECORDED' ELSE 'NOT_RECORDED' END ||
      '|history is evidence only; this script never writes it';
  \else
    SELECT 'CHECK|migration_history|UNAVAILABLE|ledger relation is not readable; no history inferred';
  \endif
\else
  SELECT 'CHECK|migration_history|UNAVAILABLE|ledger relation is absent; no history inferred';
\endif
'@

$results = Invoke-ProductionAdminDeletionReadOnlyQuery -ProjectRef $ProjectRef -PsqlPath $PsqlPath -Sql $sql
$results | ForEach-Object { Write-Output $_ }
$locationState = @($results | Where-Object { $_ -like 'CHECK|location_state|*' } | Select-Object -First 1)
$securityState = @($results | Where-Object { $_ -like 'CHECK|location_security|*' } | Select-Object -First 1)
$dependencyState = @($results | Where-Object { $_ -like 'CHECK|location_dependencies|*' } | Select-Object -First 1)
$historyState = @($results | Where-Object { $_ -like 'CHECK|migration_history|*' } | Select-Object -First 1)
if ($locationState.Count -ne 1 -or $securityState.Count -ne 1 -or $dependencyState.Count -ne 1 -or $historyState.Count -ne 1) {
  throw 'Production optional customer location preflight returned incomplete diagnostics.'
}
$locationStatus = ($locationState[0] -split '\|', 4)[2]
$securityStatus = ($securityState[0] -split '\|', 4)[2]
$dependencyStatus = ($dependencyState[0] -split '\|', 4)[2]
$historyStatus = ($historyState[0] -split '\|', 4)[2]
$verdict = if ($locationStatus -eq 'ABSENT' -and $securityStatus -eq 'PASS' -and
  $dependencyStatus -eq 'PASS' -and $historyStatus -ne 'RECORDED') { 'PRE_MIGRATION_GO' } else { 'NO_GO' }
Write-Output "VERDICT|$verdict|location=$locationStatus;security=$securityStatus;dependencies=$dependencyStatus;history=$historyStatus"
if ($verdict -eq 'NO_GO') {
  throw 'Production optional customer location preflight is NO_GO.'
}
