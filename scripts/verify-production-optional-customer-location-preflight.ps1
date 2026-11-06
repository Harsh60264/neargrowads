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
  throw "Reviewed location migration SHA-256 mismatch. Expected $expectedMigrationHash; found $actualMigrationHash."
}

. (Join-Path $PSScriptRoot 'productionAdminDeletionCheck.Common.ps1')
Write-Output "Reviewed migration SHA-256: $actualMigrationHash"
Confirm-ProductionAdminDeletionDatabase -ProjectRef $ProjectRef

$sql = @'
SET default_transaction_read_only = on;
WITH expected_columns(table_name, column_name) AS (
  VALUES
    ('service_orders','customer_location_latitude'),
    ('service_orders','customer_location_longitude'),
    ('service_orders','customer_location_accuracy_meters'),
    ('service_orders','customer_location_locality'),
    ('service_orders','customer_location_captured_at'),
    ('service_orders','customer_location_consent'),
    ('service_enquiry_requests','customer_location_latitude'),
    ('service_enquiry_requests','customer_location_longitude'),
    ('service_enquiry_requests','customer_location_accuracy_meters'),
    ('service_enquiry_requests','customer_location_locality'),
    ('service_enquiry_requests','customer_location_captured_at'),
    ('service_enquiry_requests','customer_location_consent'),
    ('leads','customer_location_latitude'),
    ('leads','customer_location_longitude'),
    ('leads','customer_location_accuracy_meters'),
    ('leads','customer_location_locality'),
    ('leads','customer_location_captured_at'),
    ('leads','customer_location_consent')
)
SELECT 'CHECK|location_columns|' ||
  CASE WHEN count(c.column_name) = 18 THEN 'PASS' ELSE 'FAIL' END ||
  '|found=' || count(c.column_name) || ';expected=18'
FROM expected_columns e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public' AND c.table_name = e.table_name AND c.column_name = e.column_name;

WITH expected_constraints(table_name, constraint_name) AS (
  VALUES
    ('service_orders','service_orders_customer_location_coordinates_check'),
    ('service_enquiry_requests','service_enquiry_customer_location_coordinates_check'),
    ('leads','leads_customer_location_coordinates_check')
)
SELECT 'CHECK|location_constraints|' ||
  CASE WHEN count(c.conname) = 3 AND bool_and(c.convalidated) THEN 'PASS' ELSE 'FAIL' END ||
  '|found=' || count(c.conname) || ';expected=3'
FROM expected_constraints e
LEFT JOIN pg_constraint c
  ON c.conrelid = to_regclass('public.' || e.table_name) AND c.conname = e.constraint_name;

SELECT 'CHECK|location_security|' ||
  CASE WHEN count(*) = 3 AND bool_and(c.relrowsecurity)
    AND bool_and(has_table_privilege('service_role', c.oid, 'INSERT'))
    AND bool_and(has_table_privilege('service_role', c.oid, 'SELECT'))
    AND bool_and(has_table_privilege('service_role', c.oid, 'UPDATE'))
    AND bool_and(NOT has_table_privilege('anon', c.oid, 'INSERT'))
    AND bool_and(NOT has_table_privilege('authenticated', c.oid, 'INSERT'))
  THEN 'PASS' ELSE 'FAIL' END || '|RLS and grants'
FROM pg_class c
WHERE c.oid IN (
  to_regclass('public.service_orders'),
  to_regclass('public.service_enquiry_requests'),
  to_regclass('public.leads')
);

SELECT 'CHECK|migration_history|' ||
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'
  ) AND EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261106120000'
      AND name = 'add_optional_customer_location'
  ) THEN 'RECORDED' ELSE 'NOT_VERIFIED' END ||
  '|history is evidence only; this script never writes it';
'@

$results = Invoke-ProductionAdminDeletionReadOnlyQuery -ProjectRef $ProjectRef -PsqlPath $PsqlPath -Sql $sql
$results | ForEach-Object { Write-Output $_ }
if (@($results | Where-Object { $_ -match '^CHECK\|location_(columns|constraints|security)\|FAIL\|' }).Count -gt 0) {
  throw 'Production optional customer location schema preflight failed.'
}
