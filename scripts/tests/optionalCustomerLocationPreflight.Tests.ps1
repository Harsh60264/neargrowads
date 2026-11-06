$ErrorActionPreference = 'Stop'

$bin = 'C:\Program Files\PostgreSQL\18\bin'
$initdb = Join-Path $bin 'initdb.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$psql = Join-Path $bin 'psql.exe'
foreach ($tool in @($initdb, $pgCtl, $psql)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
    throw "PostgreSQL 18 test utility is missing: $tool"
  }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$preflightPath = Join-Path $repoRoot 'scripts\verify-production-optional-customer-location-preflight.ps1'
$preflightText = Get-Content -LiteralPath $preflightPath -Raw
$start = $preflightText.IndexOf('$sql = @''')
$end = $preflightText.IndexOf("'@", $start + 1)
if ($start -lt 0 -or $end -lt 0) { throw 'Preflight SQL block was not found.' }
$sql = $preflightText.Substring($start + ('$sql = @''').Length, $end - $start - ('$sql = @''').Length).Trim()

$clusterPath = Join-Path $env:TEMP ("neargrow-location-preflight-pg-" + [guid]::NewGuid().ToString('N'))
$port = Get-Random -Minimum 55432 -Maximum 55532
$sqlPath = Join-Path $env:TEMP ("neargrow-location-preflight-" + [guid]::NewGuid().ToString('N') + '.sql')
$basePath = Join-Path $env:TEMP ("neargrow-location-preflight-base-" + [guid]::NewGuid().ToString('N') + '.sql')
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20261106120000_add_optional_customer_location.sql'
$baseSql = @'
CREATE ROLE service_role;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.service_orders (id integer);
CREATE TABLE public.service_enquiry_requests (id integer);
CREATE TABLE public.leads (id integer);
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_enquiry_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_orders, public.service_enquiry_requests FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_orders, public.service_enquiry_requests TO service_role;
REVOKE ALL ON TABLE public.leads FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.leads TO service_role;
GRANT INSERT ON TABLE public.leads TO anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.leads TO authenticated;
'@

function Invoke-LocalSql {
  param([Parameter(Mandatory = $true)][string]$Content)
  [IO.File]::WriteAllText($sqlPath, $Content, [Text.UTF8Encoding]::new($false))
  $output = @(& $psql --no-psqlrc --host=127.0.0.1 --port=$port --username=postgres --dbname=postgres --no-password --set=ON_ERROR_STOP=1 --tuples-only --no-align --file=$sqlPath)
  if ($LASTEXITCODE -ne 0) { throw 'Local preflight SQL failed.' }
  return $output
}

function Assert-State {
  param(
    [string]$Label,
    [string]$Fixture,
    [string]$ExpectedState,
    [string]$ExpectedHistory
  )
  if ($Fixture) { Invoke-LocalSql -Content $Fixture | Out-Null }
  $output = Invoke-LocalSql -Content $sql
  $state = @($output | Where-Object { $_ -like 'CHECK|location_state|*' })
  $history = @($output | Where-Object { $_ -like 'CHECK|migration_history|*' })
  if ($state.Count -ne 1 -or $state[0] -notmatch "\|$ExpectedState\|") {
    throw "$Label state failed: $($state -join '; ')"
  }
  if ($history.Count -ne 1 -or $history[0] -notmatch "\|$ExpectedHistory\|") {
    throw "$Label history failed: $($history -join '; ')"
  }
  Write-Output "$Label PASS: $state; $history"
}

try {
  & $initdb --pgdata=$clusterPath --username=postgres --auth=trust --no-locale --encoding=UTF8 *> $null
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed.' }
  & $pgCtl --pgdata=$clusterPath --options="-p $port" --wait --silent start
  if ($LASTEXITCODE -ne 0) { throw 'pg_ctl start failed.' }
  [IO.File]::WriteAllText($basePath, $baseSql, [Text.UTF8Encoding]::new($false))
  & $psql --no-psqlrc --host=127.0.0.1 --port=$port --username=postgres --dbname=postgres --no-password --set=ON_ERROR_STOP=1 --file=$basePath
  if ($LASTEXITCODE -ne 0) { throw 'Base fixture setup failed.' }

  Assert-State -Label 'ABSENT' -ExpectedState 'ABSENT' -ExpectedHistory 'UNAVAILABLE'
  Assert-State -Label 'PARTIAL' -Fixture 'ALTER TABLE public.leads ADD COLUMN customer_location_consent boolean NOT NULL DEFAULT false;' -ExpectedState 'PARTIAL' -ExpectedHistory 'UNAVAILABLE'
  $migration = Get-Content -LiteralPath $migrationPath -Raw
  Assert-State -Label 'COMPLETE' -Fixture $migration -ExpectedState 'COMPLETE' -ExpectedHistory 'UNAVAILABLE'
  Assert-State -Label 'MISSING_LEDGER' -ExpectedState 'COMPLETE' -ExpectedHistory 'UNAVAILABLE'
  Write-Output 'Optional customer location Production preflight diagnostic tests PASS.'
}
finally {
  if (Test-Path -LiteralPath $clusterPath) {
    & $pgCtl --pgdata=$clusterPath --mode=immediate --silent stop *> $null
    Remove-Item -LiteralPath $clusterPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  foreach ($path in @($sqlPath, $basePath)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
    }
  }
}
