[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if ($databaseUser -cne "postgres.$ProjectRef") {
  throw 'The Production database identity does not match the pinned project.'
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}
$versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw 'PostgreSQL 18 psql is required.'
}

Write-Output 'READ-ONLY PRODUCTION MIGRATION 38 METADATA DIAGNOSTIC'
Write-Output "Project ref: $expectedProjectRef"
Write-Output "Host:        $databaseHost"
Write-Output "Port:        $databasePort"
Write-Output "Database:    $databaseName"
Write-Output "User:        $databaseUser"
Write-Output 'TLS:         verify-full using the configured PostgreSQL root certificate'
Write-Output 'The diagnostic reads catalog metadata only; it does not inspect customer rows or write data.'
$confirmation = Read-Host 'Type the exact Production project ref shown above to continue'
if ($confirmation -cne $expectedProjectRef) {
  throw 'Production project reference confirmation did not match; no database connection was opened.'
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper

$sql = @'
SELECT 'RESULT|target|production_identity|' ||
  CASE WHEN current_database()='postgres' AND current_user='postgres'
    AND NOT pg_is_in_recovery() AND to_regclass('auth.users') IS NOT NULL
  THEN 'PASS' ELSE 'MISMATCH' END ||
  '|pinned database, role, primary and Auth schema';

WITH expected(table_name,column_name,data_type,is_nullable,default_kind) AS (
  VALUES
    ('service_store_payment_settings','cashfree_production_enabled','boolean','NO','false'),
    ('service_store_payment_settings','cashfree_production_verified_at','timestamp with time zone','YES','none'),
    ('service_store_payment_settings','cashfree_production_verified_by','uuid','YES','none'),
    ('cashfree_checkout_intents','checkout_mode','text','NO','sandbox')
), compared AS (
  SELECT e.*, c.column_name AS actual_column, c.data_type AS actual_type,
    c.is_nullable AS actual_nullable, c.column_default AS actual_default,
    CASE
      WHEN e.default_kind='false' THEN c.column_default='false'
      WHEN e.default_kind='sandbox' THEN c.column_default LIKE '''sandbox''%'
      ELSE c.column_default IS NULL
    END AS default_matches,
    CASE
      WHEN c.column_name IS NULL THEN 'MISSING'
      WHEN c.data_type IS DISTINCT FROM e.data_type
        OR c.is_nullable IS DISTINCT FROM e.is_nullable
        OR NOT CASE
          WHEN e.default_kind='false' THEN c.column_default='false'
          WHEN e.default_kind='sandbox' THEN c.column_default LIKE '''sandbox''%'
          ELSE c.column_default IS NULL
        END
      THEN 'MISMATCH'
      ELSE 'PASS'
    END AS status
  FROM expected e
  LEFT JOIN information_schema.columns c
    ON c.table_schema='public' AND c.table_name=e.table_name
   AND c.column_name=e.column_name
)
SELECT 'RESULT|column|'||table_name||'.'||column_name||'|'||status||
  '|expected type='||data_type||', nullable='||is_nullable||', default='||default_kind||
  '; actual type='||coalesce(actual_type,'missing')||
  ', nullable='||coalesce(actual_nullable,'missing')||
  ', default='||CASE WHEN actual_column IS NULL THEN 'missing'
    WHEN default_matches THEN 'matches' ELSE 'differs' END
FROM compared
UNION ALL
SELECT 'RESULT|column_set|service_store_payment_settings.cashfree_production_*|'||
  CASE WHEN count(*) FILTER (WHERE column_name IN (
      'cashfree_production_enabled','cashfree_production_verified_at',
      'cashfree_production_verified_by'))=0 THEN 'MISSING'
    WHEN count(*) FILTER (WHERE column_name IN (
      'cashfree_production_enabled','cashfree_production_verified_at',
      'cashfree_production_verified_by'))=3
      AND count(*) FILTER (WHERE column_name LIKE 'cashfree_production_%')=3 THEN 'PASS'
    ELSE 'MISMATCH' END||
  '|exactly the three Migration 38 production-setting columns'
FROM information_schema.columns
WHERE table_schema='public' AND table_name='service_store_payment_settings'
UNION ALL
SELECT 'RESULT|column_set|cashfree_checkout_intents.checkout_mode|'||
  CASE WHEN count(*)=0 THEN 'MISSING' WHEN count(*)=1 THEN 'PASS' ELSE 'MISMATCH' END||
  '|exactly one checkout_mode column'
FROM information_schema.columns
WHERE table_schema='public' AND table_name='cashfree_checkout_intents'
  AND column_name='checkout_mode'
ORDER BY 1;

WITH expected(table_name,constraint_name,constraint_kind) AS (
  VALUES
    ('service_orders','service_orders_provider_mode_check','provider_mode'),
    ('cashfree_checkout_intents','cashfree_checkout_intents_checkout_mode_check','checkout_mode')
), compared AS (
  SELECT e.*, c.oid, c.contype, c.convalidated,
    coalesce(pg_get_constraintdef(c.oid),'') AS definition
  FROM expected e
  LEFT JOIN pg_constraint c
    ON c.conrelid=to_regclass('public.'||e.table_name)
   AND c.conname=e.constraint_name
)
SELECT 'RESULT|constraint|'||constraint_name||'|'||
  CASE WHEN oid IS NULL THEN 'MISSING'
    WHEN contype<>'c' OR NOT convalidated THEN 'MISMATCH'
    WHEN constraint_kind='provider_mode' AND (
      definition NOT LIKE '%provider_mode%'
      OR definition NOT LIKE '%razorpay%'
      OR definition NOT LIKE '%cashfree%'
      OR definition NOT LIKE '%test%'
      OR definition NOT LIKE '%provider_mode = ''test''%'
      OR definition NOT LIKE '%provider_mode = ANY (ARRAY[''test''::text, ''live''::text])%')
      THEN 'MISMATCH'
    WHEN constraint_kind='checkout_mode' AND (
      definition NOT LIKE '%checkout_mode%'
      OR definition NOT LIKE '%sandbox%'
      OR definition NOT LIKE '%production%') THEN 'MISMATCH'
    ELSE 'PASS' END||
  '|validated '||constraint_kind||' constraint; '||
  CASE WHEN oid IS NULL THEN 'expected constraint is absent'
    WHEN contype<>'c' THEN 'expected CHECK constraint type'
    WHEN NOT convalidated THEN 'constraint is not validated'
    WHEN constraint_kind='provider_mode' THEN
      'Razorpay test-only and Cashfree test/live branches'
    ELSE 'Sandbox and Production intent modes' END
FROM compared
ORDER BY constraint_name;

WITH matching_fk AS (
  SELECT f.oid, f.convalidated, f.confdeltype,
    source_column.attname AS source_column,
    target_namespace.nspname AS target_schema,
    target.relname AS target_table,
    target_column.attname AS target_column,
    array_length(f.conkey,1) AS source_key_count,
    array_length(f.confkey,1) AS target_key_count
  FROM pg_constraint f
  JOIN pg_class source ON source.oid=f.conrelid
  JOIN pg_namespace source_namespace ON source_namespace.oid=source.relnamespace
  JOIN pg_class target ON target.oid=f.confrelid
  JOIN pg_namespace target_namespace ON target_namespace.oid=target.relnamespace
  LEFT JOIN pg_attribute source_column
    ON source_column.attrelid=f.conrelid AND source_column.attnum=f.conkey[1]
  LEFT JOIN pg_attribute target_column
    ON target_column.attrelid=f.confrelid AND target_column.attnum=f.confkey[1]
  WHERE f.contype='f'
    AND source_namespace.nspname='public'
    AND source.relname='service_store_payment_settings'
    AND source_column.attname='cashfree_production_verified_by'
), fk_summary AS (
  SELECT count(*) AS total,
    bool_and(convalidated AND confdeltype='n'
      AND source_column='cashfree_production_verified_by'
      AND target_schema='public' AND target_table='admin_identity_history'
      AND target_column='id' AND source_key_count=1 AND target_key_count=1) AS exact_fk
  FROM matching_fk
)
SELECT 'RESULT|foreign_key|cashfree_production_verified_by|'||
  CASE WHEN total=0 THEN 'MISSING' WHEN total=1 AND exact_fk THEN 'PASS' ELSE 'MISMATCH' END||
  '|validated single-column FK to public.admin_identity_history(id) ON DELETE SET NULL'
FROM fk_summary;

WITH expected(signature,function_name) AS (
  VALUES
    ('public.claim_cashfree_checkout_intent_for_mode(text,text,text,text,text,text,text,text,text,text,jsonb,bigint,text,boolean,text)','claim_cashfree_checkout_intent_for_mode'),
    ('public.complete_cashfree_checkout_intent_for_mode(uuid,uuid,text,text,bigint,text,text)','complete_cashfree_checkout_intent_for_mode'),
    ('public.process_cashfree_webhook_event_for_mode(text,text,text,text,text,text,bigint,text,boolean,text)','process_cashfree_webhook_event_for_mode'),
    ('public.set_cashfree_production_gateway(uuid,boolean)','set_cashfree_production_gateway'),
    ('public.cashfree_production_gateway_readiness()','cashfree_production_gateway_readiness')
), role_ids AS (
  SELECT
    (SELECT oid FROM pg_roles WHERE rolname='service_role') AS service_role_oid,
    (SELECT oid FROM pg_roles WHERE rolname='anon') AS anon_oid,
    (SELECT oid FROM pg_roles WHERE rolname='authenticated') AS authenticated_oid
), routines AS (
  SELECT e.signature,e.function_name,p.oid,p.proowner,p.prosecdef,p.proconfig,p.proacl,
    roles.service_role_oid,roles.anon_oid,roles.authenticated_oid
  FROM expected e
  CROSS JOIN role_ids roles
  LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
), function_status AS (
  SELECT r.*,
    CASE
      WHEN oid IS NULL THEN 'MISSING'
      WHEN service_role_oid IS NULL OR anon_oid IS NULL OR authenticated_oid IS NULL
        THEN 'MISMATCH'
      WHEN NOT prosecdef
        OR NOT coalesce(proconfig @> ARRAY['search_path=pg_catalog, public'],false)
        OR NOT has_function_privilege(service_role_oid,oid,'EXECUTE')
        OR has_function_privilege(anon_oid,oid,'EXECUTE')
        OR has_function_privilege(authenticated_oid,oid,'EXECUTE')
        OR EXISTS (
          SELECT 1
          FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) acl
          WHERE acl.privilege_type='EXECUTE'
            AND (acl.grantee=0
              OR acl.grantee IN (anon_oid,authenticated_oid)
              OR acl.grantee NOT IN (proowner,service_role_oid))
        )
      THEN 'MISMATCH'
      ELSE 'PASS'
    END AS status
  FROM routines r
)
SELECT 'RESULT|function|'||function_name||'|'||status||
  '|exact signature; SECURITY DEFINER; fixed search_path; service_role EXECUTE only'
FROM function_status
ORDER BY function_name;
'@

$expectedRows = @(
  'target|production_identity',
  'column|service_store_payment_settings.cashfree_production_enabled',
  'column|service_store_payment_settings.cashfree_production_verified_at',
  'column|service_store_payment_settings.cashfree_production_verified_by',
  'column|cashfree_checkout_intents.checkout_mode',
  'column_set|service_store_payment_settings.cashfree_production_*',
  'column_set|cashfree_checkout_intents.checkout_mode',
  'constraint|service_orders_provider_mode_check',
  'constraint|cashfree_checkout_intents_checkout_mode_check',
  'foreign_key|cashfree_production_verified_by',
  'function|claim_cashfree_checkout_intent_for_mode',
  'function|complete_cashfree_checkout_intent_for_mode',
  'function|process_cashfree_webhook_event_for_mode',
  'function|set_cashfree_production_gateway',
  'function|cashfree_production_gateway_readiness'
)
$temporarySqlPath = Join-Path $env:TEMP ("neargrow-production-cashfree38-diagnostic-" + [guid]::NewGuid().ToString('N') + '.psql')
$temporaryOutputPath = Join-Path $env:TEMP ("neargrow-production-cashfree38-diagnostic-output-" + [guid]::NewGuid().ToString('N') + '.txt')
$savedEnvironment = $null
$diagnostics = [System.Collections.Generic.List[string]]::new()
try {
  [System.IO.File]::WriteAllText(
    $temporarySqlPath,
    "BEGIN TRANSACTION READ ONLY;$([Environment]::NewLine)$sql$([Environment]::NewLine)COMMIT;",
    [System.Text.UTF8Encoding]::new($false)
  )
  $savedEnvironment = Enter-StagingPsqlEnvironment
  $arguments = @(
    '--no-psqlrc','--host',$databaseHost,'--port',$databasePort,
    '--username',$databaseUser,'--dbname',$databaseName,'--password',
    '--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose',
    '--no-align','--tuples-only','--field-separator','|',
    '--output',$temporaryOutputPath,'--file',$temporarySqlPath
  )
  $processOutput = @(& $PsqlPath @arguments 2>&1)
  foreach ($message in $processOutput) {
    $line = [string]$message
    if ($line -match '^\s*Password(?: for user .*)?:\s*$') {
      Write-Host -NoNewline $line
    } elseif (-not [string]::IsNullOrWhiteSpace($line)) {
      $diagnostics.Add($line)
    }
  }
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $diagnosticText = $diagnostics -join "`n"
    if ($diagnosticText -match '(?i)(password|SASL|authentication).*failed|no password supplied') {
      throw "Production database authentication failed for the pinned target (psql exit code $exitCode); no credentials were logged."
    }
    if ($diagnosticText -match '(?i)(certificate|SSL|TLS|hostname verification)') {
      throw "Production database TLS verification failed (psql exit code $exitCode); TLS verification was not weakened."
    }
    $errorMatch = [regex]::Match($diagnosticText,'(?im)\bERROR:\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)')
    if ($errorMatch.Success) {
      $state = if ([string]::IsNullOrWhiteSpace($errorMatch.Groups[1].Value)) {
        'unavailable'
      } else {
        $errorMatch.Groups[1].Value.ToUpperInvariant()
      }
      $message = $errorMatch.Groups[2].Value.Trim() `
        -replace '"[^"]*"|''[^'']*''','[redacted]' `
        -replace '(?i)\b(?:postgres(?:ql)?|https?)://\S+','[redacted]' `
        -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+','$1=[redacted]' `
        -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b','[redacted]' `
        -replace '\s+',' '
      if ($message.Length -gt 160) { $message = $message.Substring(0,160) + '...' }
      throw "Read-only Migration 38 diagnostic failed (SQLSTATE $state): $message. DETAIL, HINT, CONTEXT and SQL text were omitted."
    }
    throw "Read-only Migration 38 diagnostic failed (psql exit code $exitCode); raw diagnostics were omitted."
  }
  if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf) -or
    (Get-Item -LiteralPath $temporaryOutputPath).Length -eq 0) {
    throw 'The Production diagnostic returned empty output; no result was accepted.'
  }
  $rows = @(Get-Content -LiteralPath $temporaryOutputPath -ErrorAction Stop)
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  foreach ($path in @($temporarySqlPath,$temporaryOutputPath)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      Remove-Item -LiteralPath $path -Force
    }
  }
}

$seen = @{}
$hasMismatch = $false
foreach ($row in $rows) {
  $normalizedRow = ([string]$row).Trim()
  if ([string]::IsNullOrWhiteSpace($normalizedRow) -or
    $normalizedRow -in @('BEGIN','COMMIT')) {
    continue
  }
  $parts = $normalizedRow.Split([char]124,5)
  if ($parts.Count -ne 5 -or $parts[0] -cne 'RESULT' -or
    $parts[3] -notin @('PASS','MISSING','MISMATCH')) {
    Write-Output 'MISMATCH | diagnostic_output | malformed or unexpected result row'
    $hasMismatch = $true
    continue
  }
  $key = "$($parts[1])|$($parts[2])"
  if ($expectedRows -notcontains $key -or $seen.ContainsKey($key)) {
    Write-Output 'MISMATCH | diagnostic_output | unexpected or duplicate metadata result'
    $hasMismatch = $true
    continue
  }
  $seen[$key] = $true
  Write-Output "$($parts[3]) | $($parts[1]) | $($parts[2]) | $($parts[4])"
  if ($parts[3] -ne 'PASS') { $hasMismatch = $true }
}
foreach ($key in $expectedRows) {
  if (-not $seen.ContainsKey($key)) {
    Write-Output "MISSING | diagnostic_output | $key | expected metadata result was not returned"
    $hasMismatch = $true
  }
}
if ($hasMismatch) {
  Write-Output 'DIAGNOSTIC: MISMATCH FOUND — keep Production writes paused; do not retry migrations.'
  exit 1
}
Write-Output 'DIAGNOSTIC: ALL EXPECTED MIGRATION 38 METADATA CHECKS PASS. This does not authorize writes or enable checkout.'
