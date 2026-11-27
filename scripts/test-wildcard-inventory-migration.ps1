[CmdletBinding()]
param(
  [string]$PgBinPath = 'C:\Program Files\PostgreSQL\18\bin'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tempRoot = [System.IO.Path]::GetFullPath((Join-Path $env:TEMP 'NearGrowAds'))
$runId = [guid]::NewGuid().ToString('N')
$runRoot = Join-Path $tempRoot "wildcard-inventory-test-$runId"
$dataPath = Join-Path $runRoot 'data'
$logPath = Join-Path $runRoot 'postgres.log'
$database = "wildcard_inventory_test_$($runId.Substring(0, 12))"
$port = 0
$serverStarted = $false
$keepRunRoot = $false
$psqlPath = Join-Path $PgBinPath 'psql.exe'
$initDbPath = Join-Path $PgBinPath 'initdb.exe'
$pgCtlPath = Join-Path $PgBinPath 'pg_ctl.exe'
$createdbPath = Join-Path $PgBinPath 'createdb.exe'
$pgTools = @($psqlPath, $initDbPath, $pgCtlPath, $createdbPath)

if ($runRoot.StartsWith(
    $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  )) {
  throw 'The disposable PostgreSQL cluster must be outside the Git repository.'
}
foreach ($tool in $pgTools) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) {
    throw "Required PostgreSQL 18 tool not found: $tool"
  }
  $toolName = [System.IO.Path]::GetFileNameWithoutExtension($tool)
  $toolVersion = (& $tool --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $toolVersion -notmatch (
      '^' + [regex]::Escape($toolName) + ' \(PostgreSQL\) 18(?:\.|\s|$)'
    )) {
    throw "PostgreSQL 18 is required. Detected: $toolVersion"
  }
}

function Get-FreeLoopbackPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Invoke-PsqlFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  & $psqlPath '--no-psqlrc' '--no-password' '--set=ON_ERROR_STOP=1' `
    "--host=127.0.0.1" "--port=$port" '--username=postgres' "--dbname=$database" "--file=$Path"
  if ($LASTEXITCODE -ne 0) {
    throw "Disposable database SQL failed: $([System.IO.Path]::GetFileName($Path))"
  }
}

function Start-PsqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $stdout = Join-Path $runRoot "$Label.stdout.txt"
  $stderr = Join-Path $runRoot "$Label.stderr.txt"
  $arguments = @(
    '--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=1',
    '--host=127.0.0.1', "--port=$port", '--username=postgres',
    "--dbname=$database", "--file=$Path"
  )
  return Start-Process -FilePath $psqlPath -ArgumentList $arguments -NoNewWindow `
    -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}

function Wait-PsqlProcess {
  param([Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process)

  if (-not $Process.WaitForExit(30000)) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    throw "Concurrent database test timed out; stopped only psql process $($Process.Id)."
  }
  $Process.Refresh()
  return $Process.ExitCode
}

try {
  New-Item -ItemType Directory -Path $runRoot -ErrorAction Stop | Out-Null
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($currentSid)
  foreach ($sid in @(
      $currentSid,
      [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
      [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    )) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [System.Security.AccessControl.InheritanceFlags]::ObjectInherit,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $runRoot -AclObject $acl

  Write-Output "Initializing disposable PostgreSQL 18 cluster: $database"
  & $initDbPath '--pgdata' $dataPath '--username=postgres' '--encoding=UTF8' `
    '--locale=C' '--data-checksums' '--auth-local=trust' '--auth-host=trust' '--no-instructions'
  if ($LASTEXITCODE -ne 0) { throw 'initdb failed for the disposable cluster.' }

  $port = Get-FreeLoopbackPort
  & $pgCtlPath '--pgdata' $dataPath '--log' $logPath `
    '--options' "-h 127.0.0.1 -p $port -c listen_addresses=127.0.0.1" `
    '--wait' '--timeout=60' 'start'
  if ($LASTEXITCODE -ne 0) { throw 'pg_ctl could not start the loopback-only disposable cluster.' }
  $serverStarted = $true

  & $createdbPath '--no-password' '--host=127.0.0.1' "--port=$port" `
    '--username=postgres' $database
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the disposable WildCard test database.' }

  $setupSqlPath = Join-Path $runRoot 'test-prerequisites.sql'
  [System.IO.File]::WriteAllText($setupSqlPath, @'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE
);
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL,
  UNIQUE (bucket_id, name)
);
CREATE TABLE public.admin_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  status text NOT NULL,
  is_primary_owner boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);
'@, [System.Text.UTF8Encoding]::new($false))
  Invoke-PsqlFile -Path $setupSqlPath

  $migrationFiles = @(
    '20261123120000_partner_identity_isolation.sql',
    '20261126120000_create_partner_workspace.sql',
    '20261127120000_admin_delivery_team_management.sql',
    '20261202120000_wildcard_inventory_restock.sql',
    '20261203120000_partner_independent_delivery.sql',
    '20261204120000_partner_profile_delivery_preferences.sql',
    '20261205120000_partner_registration_location_details.sql'
  )
  foreach ($migrationFile in $migrationFiles) {
    $migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFile"
    if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
      throw "Required migration file not found: $migrationFile"
    }
    if ($migrationFile -ceq '20261203120000_partner_independent_delivery.sql') {
      $legacyProofSeedPath = Join-Path $runRoot 'legacy-proof-before-independent-migration.sql'
      [System.IO.File]::WriteAllText($legacyProofSeedPath, @'
DO $seed$
DECLARE
  v_owner_id constant uuid := 'a2000000-0000-4000-8000-000000000001';
  v_partner_id constant uuid := 'a2000000-0000-4000-8000-000000000012';
  v_campaign_id uuid;
  v_assignment_id uuid;
  v_site_id uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (v_owner_id, 'legacy-gps-owner@example.test'),
    (v_partner_id, 'legacy-gps-partner@example.test');
  INSERT INTO public.admin_users (id, email, role, status, is_primary_owner, permissions)
  VALUES (v_owner_id, 'legacy-gps-owner@example.test', 'owner', 'active', true, '{}'::jsonb);
  INSERT INTO public.partner_profiles (id, email, full_name, mobile_number, status)
  VALUES (v_partner_id, 'legacy-gps-partner@example.test', 'Legacy GPS Fixture', '+10000000012', 'active');
  INSERT INTO public.partner_campaigns (
    name, description, area, start_date, end_date, daily_target, coins_per_proof
  ) VALUES (
    'Legacy GPS compatibility fixture', '', 'Fixture area',
    current_date, current_date + 7, 100, 37
  ) RETURNING id INTO v_campaign_id;
  INSERT INTO public.partner_campaign_assignments (
    campaign_id, partner_profile_id, daily_target
  ) VALUES (v_campaign_id, v_partner_id, 100)
  RETURNING id INTO v_assignment_id;
  INSERT INTO public.partner_campaign_sites (campaign_id, name, address)
  VALUES (v_campaign_id, 'Legacy GPS fixture shop', 'Legacy fixture address')
  RETURNING id INTO v_site_id;

  PERFORM public.admin_manage_partner_stock(
    v_owner_id, v_partner_id, v_assignment_id, 'issued', 1, 'Legacy proof fixture stock',
    'a2000000-0000-4000-8000-000000000101'
  );
  PERFORM public.submit_partner_proof(
    v_partner_id, v_assignment_id, v_site_id,
    v_partner_id::text || '/legacy-coordinate-proof.webp',
    'Legacy campaign proof with coordinates', 28.6139, 77.2090
  );
END;
$seed$;
'@, [System.Text.UTF8Encoding]::new($false))
      Invoke-PsqlFile -Path $legacyProofSeedPath
      Write-Output 'Seeded a campaign proof with historical GPS coordinates and no accuracy/timestamp before independent-delivery migration.'
    }
    Write-Output "Applying to disposable database: $migrationFile"
    & $psqlPath '--no-psqlrc' '--no-password' '--set=ON_ERROR_STOP=1' '--single-transaction' `
      "--host=127.0.0.1" "--port=$port" '--username=postgres' "--dbname=$database" "--file=$migrationPath"
    if ($LASTEXITCODE -ne 0) {
      throw "Migration failed on the disposable database: $migrationFile"
    }
  }

  $applyRunnerPath = Join-Path $repoRoot 'scripts\apply-production-partner-registration-location-migration.ps1'
  $applyRunnerContent = Get-Content -LiteralPath $applyRunnerPath -Raw
  $poststateGuardMarker = '$poststateGuard = @'''
  $poststateGuardStart = $applyRunnerContent.IndexOf($poststateGuardMarker, [StringComparison]::Ordinal)
  $poststateGuardBodyStart = if ($poststateGuardStart -ge 0) {
    $applyRunnerContent.IndexOf("`n", $poststateGuardStart, [StringComparison]::Ordinal) + 1
  } else { -1 }
  $poststateGuardEnd = if ($poststateGuardBodyStart -gt 0) {
    $applyRunnerContent.IndexOf("`n'@", $poststateGuardBodyStart, [StringComparison]::Ordinal)
  } else { -1 }
  if ($poststateGuardEnd -lt $poststateGuardBodyStart) {
    throw 'Could not extract the Production post-state guard for isolated validation.'
  }
  $poststateGuardSql = $applyRunnerContent.Substring(
    $poststateGuardBodyStart,
    $poststateGuardEnd - $poststateGuardBodyStart
  ).TrimEnd("`r")
  $poststateGuardPath = Join-Path $runRoot 'partner-registration-location-poststate-guard.sql'
  [System.IO.File]::WriteAllText(
    $poststateGuardPath,
    $poststateGuardSql,
    [System.Text.UTF8Encoding]::new($false)
  )
  Invoke-PsqlFile -Path $poststateGuardPath

  $testPath = Join-Path $repoRoot 'supabase\tests\wildcard_inventory_restock.test.sql'
  Invoke-PsqlFile -Path $testPath

  $independentProofSeedPath = Join-Path $runRoot 'independent-proof-concurrency-seed.sql'
  [System.IO.File]::WriteAllText($independentProofSeedPath, @'
SELECT public.admin_manage_partner_stock(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000012',
  NULL, 'issued', 1, 'Concurrent independent proof seed',
  'a1000000-0000-4000-8000-000000000301'
);
'@, [System.Text.UTF8Encoding]::new($false))
  Invoke-PsqlFile -Path $independentProofSeedPath
  $independentProofSql = @'
BEGIN;
SELECT public.submit_independent_partner_proof(
  'a1000000-0000-4000-8000-000000000012',
  'a1000000-0000-4000-8000-000000000012/independent-concurrent-first.webp',
  'Concurrent Independent Shop', 'Retail', 'Test Street, Noida', '', '',
  NULL, NULL, NULL, NULL, 'manual_no_gps'
);
SELECT pg_sleep(2);
COMMIT;
'@
  $independentProofWaitSql = $independentProofSql.Replace(
    'independent-concurrent-first.webp', 'independent-concurrent-second.webp'
  ).Replace("SELECT pg_sleep(2);`r`n", '').Replace("SELECT pg_sleep(2);`n", '')
  $independentProofPath = Join-Path $runRoot 'independent-proof-first.sql'
  $independentProofWaitPath = Join-Path $runRoot 'independent-proof-second.sql'
  [System.IO.File]::WriteAllText($independentProofPath, $independentProofSql, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($independentProofWaitPath, $independentProofWaitSql, [System.Text.UTF8Encoding]::new($false))
  $firstIndependentProof = Start-PsqlFile -Path $independentProofPath -Label 'independent-proof-first'
  Start-Sleep -Milliseconds 250
  $secondIndependentProof = Start-PsqlFile -Path $independentProofWaitPath -Label 'independent-proof-second'
  [void](Wait-PsqlProcess -Process $firstIndependentProof)
  [void](Wait-PsqlProcess -Process $secondIndependentProof)
  $firstIndependentProofError = Get-Content -LiteralPath (Join-Path $runRoot 'independent-proof-first.stderr.txt') -Raw
  $secondIndependentProofError = Get-Content -LiteralPath (Join-Path $runRoot 'independent-proof-second.stderr.txt') -Raw
  if ($firstIndependentProofError -match 'ERROR:' -or
      $secondIndependentProofError -notmatch 'No unreserved WildCard stock is available') {
    Write-Output "Independent proof second-request diagnostics: $secondIndependentProofError"
    throw 'Concurrent campaign-free proof submissions did not serialize to one reserved card.'
  }
  $independentProofConcurrencyCheckPath = Join-Path $runRoot 'independent-proof-concurrency-check.sql'
  [System.IO.File]::WriteAllText($independentProofConcurrencyCheckPath, @'
DO $check$
BEGIN
  IF (SELECT count(*) FROM public.partner_proofs
      WHERE partner_profile_id = 'a1000000-0000-4000-8000-000000000012'
        AND photo_path LIKE '%/independent-concurrent-%') <> 1 OR
     (public.get_partner_inventory_summary('a1000000-0000-4000-8000-000000000012')->>'available')::integer <> 0 OR
     (public.get_partner_inventory_summary('a1000000-0000-4000-8000-000000000012')->>'reserved')::integer <> 1 THEN
    RAISE EXCEPTION 'Concurrent independent proof submissions overspent physical stock';
  END IF;
END;
$check$;
'@, [System.Text.UTF8Encoding]::new($false))
  Invoke-PsqlFile -Path $independentProofConcurrencyCheckPath

  $concurrentRestockPath = Join-Path $runRoot 'concurrent-restock.sql'
  $concurrentRestockWaitPath = Join-Path $runRoot 'concurrent-restock-wait.sql'
  $restockSql = @'
BEGIN;
SELECT public.request_partner_restock(
  'a1000000-0000-4000-8000-000000000012', 15, 'Concurrent request fixture'
);
SELECT pg_sleep(2);
COMMIT;
'@
  [System.IO.File]::WriteAllText($concurrentRestockPath, $restockSql, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($concurrentRestockWaitPath, $restockSql.Replace(
      "SELECT pg_sleep(2);`r`n", ''
    ).Replace("SELECT pg_sleep(2);`n", ''), [System.Text.UTF8Encoding]::new($false))
  $firstRestock = Start-PsqlFile -Path $concurrentRestockPath -Label 'concurrent-restock-first'
  Start-Sleep -Milliseconds 250
  $secondRestock = Start-PsqlFile -Path $concurrentRestockWaitPath -Label 'concurrent-restock-second'
  [void](Wait-PsqlProcess -Process $firstRestock)
  [void](Wait-PsqlProcess -Process $secondRestock)
  $firstRestockError = Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-restock-first.stderr.txt') -Raw
  $secondRestockError = Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-restock-second.stderr.txt') -Raw
  if ($firstRestockError -match 'ERROR:' -or $secondRestockError -notmatch 'A restock request is already pending') {
    throw 'Concurrent duplicate restock requests did not serialize to exactly one pending request.'
  }

  $sameKeySql = @'
BEGIN;
SELECT public.admin_manage_partner_stock(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000013',
  NULL, 'restocked', 5, 'Concurrent idempotent restock',
  'a1000000-0000-4000-8000-000000000201'
);
SELECT pg_sleep(2);
COMMIT;
'@
  $sameKeyWaitSql = $sameKeySql.Replace("SELECT pg_sleep(2);`r`n", '').Replace("SELECT pg_sleep(2);`n", '')
  $sameKeyPath = Join-Path $runRoot 'concurrent-same-key-first.sql'
  $sameKeyWaitPath = Join-Path $runRoot 'concurrent-same-key-second.sql'
  [System.IO.File]::WriteAllText($sameKeyPath, $sameKeySql, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($sameKeyWaitPath, $sameKeyWaitSql, [System.Text.UTF8Encoding]::new($false))
  $firstSameKey = Start-PsqlFile -Path $sameKeyPath -Label 'concurrent-same-key-first'
  Start-Sleep -Milliseconds 250
  $secondSameKey = Start-PsqlFile -Path $sameKeyWaitPath -Label 'concurrent-same-key-second'
  [void](Wait-PsqlProcess -Process $firstSameKey)
  [void](Wait-PsqlProcess -Process $secondSameKey)
  $sameKeyErrors = @(
    (Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-same-key-first.stderr.txt') -Raw),
    (Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-same-key-second.stderr.txt') -Raw)
  ) -join "`n"
  if ($sameKeyErrors -match 'ERROR:') {
    throw 'Concurrent retries with the same stock idempotency key did not both succeed.'
  }

  $decreaseSql = @'
BEGIN;
SELECT public.admin_manage_partner_stock(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000013',
  NULL, 'adjusted', -10, 'Concurrent decrease fixture',
  'a1000000-0000-4000-8000-000000000202'
);
SELECT pg_sleep(2);
COMMIT;
'@
  $decreaseWaitSql = $decreaseSql.Replace("SELECT pg_sleep(2);`r`n", '').Replace("SELECT pg_sleep(2);`n", '').Replace('a1000000-0000-4000-8000-000000000202', 'a1000000-0000-4000-8000-000000000203')
  $decreasePath = Join-Path $runRoot 'concurrent-decrease-first.sql'
  $decreaseWaitPath = Join-Path $runRoot 'concurrent-decrease-second.sql'
  [System.IO.File]::WriteAllText($decreasePath, $decreaseSql, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($decreaseWaitPath, $decreaseWaitSql, [System.Text.UTF8Encoding]::new($false))
  $firstDecrease = Start-PsqlFile -Path $decreasePath -Label 'concurrent-decrease-first'
  Start-Sleep -Milliseconds 250
  $secondDecrease = Start-PsqlFile -Path $decreaseWaitPath -Label 'concurrent-decrease-second'
  [void](Wait-PsqlProcess -Process $firstDecrease)
  [void](Wait-PsqlProcess -Process $secondDecrease)
  $firstDecreaseError = Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-decrease-first.stderr.txt') -Raw
  $secondDecreaseError = Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-decrease-second.stderr.txt') -Raw
  $decreaseErrors = @(
    $firstDecreaseError, $secondDecreaseError
  ) -join "`n"
  $decreaseFailureCount = @(@($firstDecreaseError, $secondDecreaseError) | Where-Object { $_ -match 'ERROR:' }).Count
  if ($decreaseFailureCount -ne 1 -or
      $decreaseErrors -notmatch 'unreserved partner stock negative') {
    Write-Output "Concurrent decrease outputs: $((Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-decrease-first.stdout.txt') -Raw), (Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-decrease-second.stdout.txt') -Raw) -join "`n")"
    Write-Output "Concurrent decrease diagnostics: $decreaseErrors"
    throw 'Concurrent stock decreases did not serialize while preventing a negative balance.'
  }

  $proofApprovalSql = @'
BEGIN;
SELECT public.review_partner_proof(
  (SELECT id FROM public.partner_proofs
   WHERE partner_profile_id = 'a1000000-0000-4000-8000-000000000013'
     AND photo_path = 'a1000000-0000-4000-8000-000000000013/concurrent-proof.webp'),
  'a1000000-0000-4000-8000-000000000001',
  'approved',
  'Concurrent proof approval'
);
SELECT pg_sleep(2);
COMMIT;
'@
  $proofDecreaseSql = @'
SELECT public.admin_manage_partner_stock(
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000013',
  NULL, 'adjusted', -6, 'Decrease races with proof approval',
  'a1000000-0000-4000-8000-000000000204'
);
'@
  $proofApprovalPath = Join-Path $runRoot 'concurrent-proof-approval.sql'
  $proofDecreasePath = Join-Path $runRoot 'concurrent-proof-decrease.sql'
  [System.IO.File]::WriteAllText($proofApprovalPath, $proofApprovalSql, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($proofDecreasePath, $proofDecreaseSql, [System.Text.UTF8Encoding]::new($false))
  $proofApproval = Start-PsqlFile -Path $proofApprovalPath -Label 'concurrent-proof-approval'
  Start-Sleep -Milliseconds 250
  $proofDecrease = Start-PsqlFile -Path $proofDecreasePath -Label 'concurrent-proof-decrease'
  [void](Wait-PsqlProcess -Process $proofApproval)
  [void](Wait-PsqlProcess -Process $proofDecrease)
  $proofApprovalError = Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-proof-approval.stderr.txt') -Raw
  $proofDecreaseError = Get-Content -LiteralPath (Join-Path $runRoot 'concurrent-proof-decrease.stderr.txt') -Raw
  if ($proofApprovalError -match 'ERROR:' -or
      $proofDecreaseError -notmatch 'unreserved partner stock negative') {
    throw 'Concurrent proof approval and stock decrease did not preserve the reservation and balance.'
  }

  $concurrencyCheckPath = Join-Path $runRoot 'concurrency-check.sql'
  [System.IO.File]::WriteAllText($concurrencyCheckPath, @'
DO $check$
BEGIN
  IF (SELECT count(*) FROM public.partner_campaign_requests
      WHERE partner_profile_id = 'a1000000-0000-4000-8000-000000000012'
        AND request_type = 'additional_stock' AND status = 'pending') <> 1 THEN
    RAISE EXCEPTION 'Concurrent restock request count was not one';
  END IF;
  IF (SELECT count(*) FROM public.partner_stock_movements
      WHERE idempotency_key = 'a1000000-0000-4000-8000-000000000201') <> 1 OR
     (public.get_partner_inventory_summary('a1000000-0000-4000-8000-000000000013')->>'available')::integer <> 5 THEN
    RAISE EXCEPTION 'Concurrent idempotent issue was duplicated or lost';
  END IF;
  IF (public.get_partner_inventory_summary('a1000000-0000-4000-8000-000000000013')->>'reserved')::integer <> 0 OR
     (public.get_partner_inventory_summary('a1000000-0000-4000-8000-000000000013')->>'delivered')::integer <> 1 OR
     (SELECT amount FROM public.partner_coin_ledger
      WHERE proof_id = (
        SELECT id FROM public.partner_proofs
        WHERE partner_profile_id = 'a1000000-0000-4000-8000-000000000013'
          AND photo_path = 'a1000000-0000-4000-8000-000000000013/concurrent-proof.webp'
      ) AND entry_type = 'earning' AND status = 'approved') <> 1000 OR
     (public.get_partner_inventory_summary('a1000000-0000-4000-8000-000000000013')->>'available')::integer < 0 THEN
    RAISE EXCEPTION 'Concurrent proof approval failed to atomically consume its reservation and reward';
  END IF;
END;
$check$;
'@, [System.Text.UTF8Encoding]::new($false))
  Invoke-PsqlFile -Path $concurrencyCheckPath

  Write-Output 'Disposable migration validation: PASS'
  Write-Output 'Transactional workflows: 100-card cap, stock adjustments, restock approval/rejection/handover, campaign-free proof reservation/reward/rejection/idempotency, campaign-free damage review, negative-stock guard, authorization, withdrawal threshold, and global geocoder request spacing.'
  Write-Output 'Concurrency workflows: duplicate restock serialization, same-key stock idempotency, competing stock decreases, and campaign-free proof reservation.'
} catch {
  if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    Write-Output 'Disposable PostgreSQL diagnostic tail:'
    Get-Content -LiteralPath $logPath -Tail 30 | Out-Host
  }
  throw
} finally {
  if ($serverStarted) {
    & $pgCtlPath '--pgdata' $dataPath '--mode=fast' '--wait' '--timeout=30' 'stop'
    if ($LASTEXITCODE -ne 0) {
      $keepRunRoot = $true
      Write-Warning "Could not stop the disposable test cluster; its exact data directory is retained: $dataPath"
    }
  }
  if (-not $keepRunRoot -and (Test-Path -LiteralPath $runRoot -PathType Container)) {
    Remove-Item -LiteralPath $runRoot -Recurse -Force
  }
}
