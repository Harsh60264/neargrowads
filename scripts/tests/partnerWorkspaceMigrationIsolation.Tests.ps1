$ErrorActionPreference = 'Stop'

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw "FAIL: $Message"
  }
}

$bin = 'C:\Program Files\PostgreSQL\18\bin'
$tools = @{
  initdb = Join-Path $bin 'initdb.exe'
  pg_ctl = Join-Path $bin 'pg_ctl.exe'
  createdb = Join-Path $bin 'createdb.exe'
  psql = Join-Path $bin 'psql.exe'
}
foreach ($tool in $tools.GetEnumerator()) {
  Assert-True (Test-Path -LiteralPath $tool.Value -PathType Leaf) `
    "PostgreSQL test tool missing: $($tool.Key)"
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$migrationPath = Join-Path $repoRoot 'supabase\migrations\20261126120000_create_partner_workspace.sql'
$testRoot = Join-Path $env:TEMP ('partner-workspace-isolation-' + [guid]::NewGuid().ToString('N'))
$dataDirectory = Join-Path $testRoot 'cluster'
$serverLog = Join-Path $testRoot 'server.log'
$failingMigrationPath = Join-Path $testRoot 'migration-rollback.psql'
$savedEnvironment = @{}
$serverPort = 0
$keepCluster = $false

try {
  New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop | Out-Null
  foreach ($name in [Environment]::GetEnvironmentVariables('Process').Keys) {
    if ([string]$name -match '^PG[A-Z0-9_]*$') {
      $savedEnvironment[[string]$name] = [Environment]::GetEnvironmentVariable([string]$name, 'Process')
      [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process')
    }
  }
  [Environment]::SetEnvironmentVariable('PGSSLMODE', 'disable', 'Process')

  & $tools.initdb '--pgdata' $dataDirectory '--username' 'postgres' `
    '--encoding=UTF8' '--locale=C' '--data-checksums' `
    '--auth-local=trust' '--auth-host=trust' '--no-instructions' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Test cluster initialization failed.' }

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    $serverPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
  & $tools.pg_ctl '--pgdata' $dataDirectory '--log' $serverLog `
    '--options' "-h 127.0.0.1 -p $serverPort -c listen_addresses=127.0.0.1" `
    '--wait' '--timeout' '60' 'start'
  if ($LASTEXITCODE -ne 0) { throw 'Test cluster startup failed.' }

  & $tools.createdb '--no-password' '--host' '127.0.0.1' `
    '--port' ([string]$serverPort) '--username' 'postgres' 'migration_isolation'
  if ($LASTEXITCODE -ne 0) { throw 'Test database creation failed.' }

  $fixtureSql = @'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email text NOT NULL);
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001', 'fixture@example.invalid');
CREATE TABLE public.admin_users(id uuid PRIMARY KEY, is_primary_owner boolean, status text, role text);
INSERT INTO public.admin_users VALUES ('00000000-0000-0000-0000-000000000002', true, 'active', 'owner');
CREATE TABLE public.partner_profiles(id uuid PRIMARY KEY, status text);
INSERT INTO public.partner_profiles VALUES ('00000000-0000-0000-0000-000000000003', 'active');
CREATE TABLE public.partner_sessions(id uuid PRIMARY KEY, user_id uuid);
ALTER TABLE public.partner_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_sessions_existing_policy ON public.partner_sessions
  FOR SELECT TO authenticated USING (user_id IS NOT NULL);
CREATE TABLE public.customers(id integer PRIMARY KEY, marker text NOT NULL);
INSERT INTO public.customers VALUES (1, 'preserve-customer');
CREATE TABLE public.service_orders(id integer PRIMARY KEY, marker text NOT NULL);
INSERT INTO public.service_orders VALUES (1, 'preserve-paid-order');
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_orders_existing_policy ON public.service_orders
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.service_orders TO authenticated;
CREATE TABLE public.service_store_payment_settings(id integer PRIMARY KEY, marker text NOT NULL);
INSERT INTO public.service_store_payment_settings VALUES (1, 'preserve-payment-settings');
ALTER TABLE public.service_store_payment_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_settings_existing_policy ON public.service_store_payment_settings
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.service_store_payment_settings TO authenticated;
CREATE TABLE storage.buckets(
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE FUNCTION public.reject_bucket_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Existing bucket update is forbidden in this test';
END;
$$;
CREATE TRIGGER reject_bucket_update
BEFORE UPDATE ON storage.buckets
FOR EACH ROW EXECUTE FUNCTION public.reject_bucket_update();
INSERT INTO storage.buckets
VALUES ('partner-proofs', 'partner-proofs', false, 2097152, ARRAY['image/jpeg','image/png','image/webp']);
'@
  & $tools.psql '--no-psqlrc' '--no-password' '--set' 'ON_ERROR_STOP=1' `
    '--host' '127.0.0.1' '--port' ([string]$serverPort) '--username' 'postgres' `
    '--dbname' 'migration_isolation' '--command' $fixtureSql | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic Supabase prerequisite fixture failed.' }

  $migrationSql = Get-Content -LiteralPath $migrationPath -Raw
  [System.IO.File]::WriteAllText(
    $failingMigrationPath,
    $migrationSql + "`nSELECT 1 / 0;`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  & $tools.psql '--no-psqlrc' '--no-password' '--set' 'ON_ERROR_STOP=1' `
    '--single-transaction' '--host' '127.0.0.1' '--port' ([string]$serverPort) `
    '--username' 'postgres' '--dbname' 'migration_isolation' `
    '--file' $failingMigrationPath 2>&1 | Out-Null
  Assert-True ($LASTEXITCODE -ne 0) 'Injected SQL failure must fail the migration transaction.'

  $rollbackCheck = @'
SELECT CASE WHEN
  to_regclass('public.partner_campaigns') IS NULL
  AND to_regclass('public.partner_coin_ledger') IS NULL
  AND to_regprocedure('public.submit_partner_proof(uuid,uuid,uuid,text,text,double precision,double precision)') IS NULL
  AND (SELECT count(*) FROM storage.buckets WHERE id='partner-proofs') = 1
  THEN 'ROLLBACK|PASS' ELSE 'ROLLBACK|FAIL' END;
'@
  $rollbackResult = @(& $tools.psql '--no-psqlrc' '--no-password' '--set' 'ON_ERROR_STOP=1' `
      '--no-align' '--tuples-only' '--host' '127.0.0.1' '--port' ([string]$serverPort) `
      '--username' 'postgres' '--dbname' 'migration_isolation' '--command' $rollbackCheck)
  Assert-True ($LASTEXITCODE -eq 0 -and (@($rollbackResult) -contains 'ROLLBACK|PASS')) `
    'A failed transaction must leave no migration objects or alter the pre-existing bucket.'

  & $tools.psql '--no-psqlrc' '--no-password' '--set' 'ON_ERROR_STOP=1' `
    '--single-transaction' '--host' '127.0.0.1' '--port' ([string]$serverPort) `
    '--username' 'postgres' '--dbname' 'migration_isolation' '--file' $migrationPath | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'The pinned migration failed on the isolated fixture.' }

  $postCheck = @'
WITH expected_tables(name) AS (
  VALUES ('partner_campaigns'), ('partner_campaign_assignments'), ('partner_campaign_sites'),
    ('partner_campaign_requests'), ('partner_damage_reports'), ('partner_proofs'),
    ('partner_stock_movements'), ('partner_withdrawal_requests'), ('partner_coin_ledger')
), checks AS (
  SELECT
    (SELECT count(*) = 9 FROM expected_tables e
      JOIN pg_class c ON c.relname = e.name
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relrowsecurity) AS new_tables_rls,
    (SELECT count(*) = 9 FROM expected_tables e
      JOIN pg_class c ON c.relname = e.name
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE has_table_privilege('service_role', c.oid, 'SELECT')
        AND has_table_privilege('service_role', c.oid, 'INSERT')
        AND has_table_privilege('service_role', c.oid, 'UPDATE')
        AND has_table_privilege('service_role', c.oid, 'DELETE')
        AND NOT has_table_privilege('anon', c.oid, 'SELECT')
        AND NOT has_table_privilege('anon', c.oid, 'INSERT')
        AND NOT has_table_privilege('anon', c.oid, 'UPDATE')
        AND NOT has_table_privilege('anon', c.oid, 'DELETE')
        AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', c.oid, 'INSERT')
        AND NOT has_table_privilege('authenticated', c.oid, 'UPDATE')
        AND NOT has_table_privilege('authenticated', c.oid, 'DELETE')) AS table_grants,
    (SELECT count(*) = 9 FROM expected_tables e
      JOIN pg_class c ON c.relname = e.name
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_policy p ON p.polrelid = c.oid
      WHERE p.polcmd = '*' AND pg_get_expr(p.polqual, p.polrelid) = 'false'
        AND pg_get_expr(p.polwithcheck, p.polrelid) = 'false'
        AND p.polroles @> ARRAY[(SELECT oid FROM pg_roles WHERE rolname='anon'),
          (SELECT oid FROM pg_roles WHERE rolname='authenticated')]) AS deny_policies,
    (SELECT count(*) = 7 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname LIKE ANY (ARRAY[
        'create_partner_campaign_assignment','submit_partner_proof','review_partner_proof',
        'request_partner_withdrawal','review_partner_withdrawal',
        'review_partner_campaign_request','review_partner_damage_report'])
        AND p.prosecdef
        AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
        AND has_function_privilege('service_role', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
        AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS function_grants,
    (SELECT count(*) = 1 FROM storage.buckets
      WHERE id='partner-proofs' AND name='partner-proofs' AND public=false
        AND file_size_limit=2097152
        AND allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp']) AS bucket_unchanged,
    (SELECT email='fixture@example.invalid' FROM auth.users WHERE id='00000000-0000-0000-0000-000000000001') AS auth_preserved,
    (SELECT role='owner' AND status='active' FROM public.admin_users
      WHERE id='00000000-0000-0000-0000-000000000002') AS admin_preserved,
    (SELECT status='active' FROM public.partner_profiles
      WHERE id='00000000-0000-0000-0000-000000000003') AS partner_identity_preserved,
    (SELECT marker='preserve-customer' FROM public.customers WHERE id=1) AS customer_preserved,
    (SELECT marker='preserve-paid-order' FROM public.service_orders WHERE id=1) AS order_preserved,
    (SELECT marker='preserve-payment-settings' FROM public.service_store_payment_settings WHERE id=1) AS payment_preserved,
    EXISTS (SELECT 1 FROM pg_policy WHERE polname='partner_sessions_existing_policy')
      AND EXISTS (SELECT 1 FROM pg_policy WHERE polname='service_orders_existing_policy')
      AND EXISTS (SELECT 1 FROM pg_policy WHERE polname='payment_settings_existing_policy') AS existing_policies_preserved,
    has_table_privilege('authenticated', 'public.service_orders', 'SELECT')
      AND has_table_privilege('authenticated', 'public.service_store_payment_settings', 'SELECT') AS existing_grants_preserved
)
SELECT 'POST|' || CASE WHEN
  new_tables_rls AND table_grants AND deny_policies AND function_grants
  AND bucket_unchanged AND auth_preserved AND admin_preserved
  AND partner_identity_preserved AND customer_preserved AND order_preserved
  AND payment_preserved AND existing_policies_preserved AND existing_grants_preserved
  THEN 'PASS' ELSE 'FAIL' END
FROM checks;
'@
  $postResult = @(& $tools.psql '--no-psqlrc' '--no-password' '--set' 'ON_ERROR_STOP=1' `
      '--no-align' '--tuples-only' '--host' '127.0.0.1' '--port' ([string]$serverPort) `
      '--username' 'postgres' '--dbname' 'migration_isolation' '--command' $postCheck)
  Assert-True ($LASTEXITCODE -eq 0 -and (@($postResult) -contains 'POST|PASS')) `
    'The migration must preserve existing fixture data and policies while enforcing its new table/RPC ACLs.'

  Write-Output 'Partner Workspace transactional isolation integration test PASS.'
} finally {
  if (Test-Path -LiteralPath (Join-Path $dataDirectory 'postmaster.pid') -PathType Leaf) {
    & $tools.pg_ctl '--pgdata' $dataDirectory 'status' *> $null
    if ($LASTEXITCODE -eq 0) {
      & $tools.pg_ctl '--pgdata' $dataDirectory '--mode' 'fast' '--wait' 'stop'
      if ($LASTEXITCODE -ne 0) {
        $keepCluster = $true
        throw "Could not stop test cluster; retain it at $dataDirectory"
      }
    } elseif ($LASTEXITCODE -ne 3) {
      $keepCluster = $true
      throw "Could not determine whether test cluster stopped; retain it at $dataDirectory"
    }
  }
  foreach ($name in [Environment]::GetEnvironmentVariables('Process').Keys) {
    if ([string]$name -match '^PG[A-Z0-9_]*$') {
      [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process')
    }
  }
  foreach ($name in $savedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable([string]$name, [string]$savedEnvironment[$name], 'Process')
  }
  if (-not $keepCluster -and (Test-Path -LiteralPath $testRoot -PathType Container)) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}
