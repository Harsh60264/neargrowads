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
$migrationFileName = '20261103214800_add_cashfree_production_mode.sql'
$expectedMigrationHash = 'F6BFC825FC5E271EEBD3CE9EA86637932190B8AE48A6493C3BB39DEE38C71603'

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

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationPath = Join-Path $repoRoot "supabase\migrations\$migrationFileName"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
  throw "The pinned Migration 38 file is missing: $migrationFileName"
}
$actualMigrationHash = (Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256).Hash
if ($actualMigrationHash -cne $expectedMigrationHash) {
  throw "Migration 38 hash mismatch. Expected $expectedMigrationHash; found $actualMigrationHash. Nothing was connected or applied."
}
$migrationSql = Get-Content -LiteralPath $migrationPath -Raw
if ($migrationSql -notmatch '(?im)^\s*BEGIN;\s*$' -or
  $migrationSql -notmatch '(?im)^\s*COMMIT;\s*$' -or
  $migrationSql -match '(?im)^\s*(?:INSERT\s+INTO\s+supabase_migrations|CREATE\s+SCHEMA\s+supabase_migrations)') {
  throw 'Migration 38 must retain its reviewed BEGIN/COMMIT and must not fabricate migration history.'
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper

function Invoke-ProductionPsql {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [switch]$ReadOnly
  )

  $tempSql = Join-Path $env:TEMP ("neargrow-production-cashfree38-" + [guid]::NewGuid().ToString('N') + '.psql')
  $tempOutput = Join-Path $env:TEMP ("neargrow-production-cashfree38-output-" + [guid]::NewGuid().ToString('N') + '.txt')
  $savedEnvironment = $null
  try {
    $scriptText = if ($ReadOnly) {
      "BEGIN TRANSACTION READ ONLY;$([Environment]::NewLine)$Sql$([Environment]::NewLine)COMMIT;"
    } else {
      $Sql
    }
    [System.IO.File]::WriteAllText($tempSql, $scriptText, [System.Text.UTF8Encoding]::new($false))
    $savedEnvironment = Enter-StagingPsqlEnvironment
    $arguments = @(
      '--no-psqlrc','--host',$databaseHost,'--port',$databasePort,
      '--username',$databaseUser,'--dbname',$databaseName,'--password',
      '--set','ON_ERROR_STOP=1','--set','VERBOSITY=verbose',
      '--no-align','--tuples-only','--field-separator','|',
      '--output',$tempOutput,'--file',$tempSql
    )
    $diagnostics = @(& $PsqlPath @arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      $diagnosticText = ($diagnostics | ForEach-Object {
        if ($_ -is [System.Management.Automation.ErrorRecord]) {
          $_.Exception.Message
        } else {
          [string]$_
        }
      }) -join "`n"
      if ($diagnosticText -match '(?i)(certificate|SSL|TLS|hostname verification)') {
        throw "Pinned Production TLS verify-full failed (psql exit code $exitCode)."
      }
      if ($diagnosticText -match '(?i)(password|SASL|authentication).*failed|no password supplied') {
        throw "Pinned Production authentication failed (psql exit code $exitCode); no credentials were logged."
      }
      $postgresErrorMatch = [regex]::Match(
        $diagnosticText,
        '(?im)\bERROR:\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)'
      )
      if ($postgresErrorMatch.Success) {
        $sqlState = $postgresErrorMatch.Groups[1].Value.ToUpperInvariant()
        $safeMessage = $postgresErrorMatch.Groups[2].Value.Trim() `
          -replace '(?i)\b(?:postgres(?:ql)?|https?)://\S+', '[redacted]' `
          -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+', '$1=[redacted]' `
          -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]' `
          -replace '"[^"]*"|''[^'']*''', '[redacted]' `
          -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[redacted-email]' `
          -replace '(?i)(?<!\d)(?:\+?\d[\s().-]*){10,15}(?!\d)', '[redacted-phone]' `
          -replace '\b[A-Za-z0-9_-]{32,}\b', '[redacted-token]' `
          -replace '\s+', ' '
        if ($safeMessage.Length -gt 180) {
          $safeMessage = $safeMessage.Substring(0, 180) + '...'
        }
        if ([string]::IsNullOrWhiteSpace($safeMessage)) {
          $safeMessage = 'PostgreSQL reported an error; message redacted.'
        }
        $stateText = if ([string]::IsNullOrWhiteSpace($sqlState)) { 'unavailable' } else { $sqlState }
        throw "Pinned Production psql operation failed (exit code $exitCode, SQLSTATE $stateText): $safeMessage. DETAIL, HINT, CONTEXT and SQL text were omitted."
      }
      throw "Pinned Production psql operation failed (exit code $exitCode); no concise PostgreSQL ERROR line was available. Raw diagnostics were omitted."
    }
    if (-not (Test-Path -LiteralPath $tempOutput -PathType Leaf)) {
      throw 'Pinned Production psql returned no output file.'
    }
    return @(Get-Content -LiteralPath $tempOutput -ErrorAction Stop)
  } finally {
    if ($null -ne $savedEnvironment) {
      Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
    }
    foreach ($path in @($tempSql,$tempOutput)) {
      if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
      }
    }
  }
}

Write-Output 'ONE-TIME PRODUCTION MIGRATION 38 WORKFLOW'
Write-Output "Project ref: $expectedProjectRef"
Write-Output "Host:        $databaseHost"
Write-Output "Port:        $databasePort"
Write-Output "Database:    $databaseName"
Write-Output "User:        $databaseUser"
Write-Output 'TLS:         verify-full using the configured PostgreSQL root certificate'
Write-Output "Migration:   $migrationFileName"
Write-Output "SHA-256:     $expectedMigrationHash"
Write-Output 'Migration history remains UNVERIFIED; this workflow never writes ledger rows.'
Write-Output 'Recovery limitation: the archive has not been restored and no PITR recovery is verified; any restore could lose later Production writes.'

$confirmation = Read-Host 'Type the exact Production project ref shown above to continue'
if ($confirmation -cne $expectedProjectRef) {
  throw 'Production project reference confirmation did not match; no database connection was opened.'
}
$pauseConfirmation = Read-Host 'Confirm that checkout, order creation and conflicting payment writes are paused; type PAUSE CONFIRMED'
if ($pauseConfirmation -cne 'PAUSE CONFIRMED') {
  throw 'Maintenance write-pause confirmation did not match; no database connection was opened.'
}
$incidentRoute = Read-Host 'Identify the reachable authorized Supabase owner/on-call and incident escalation route (do not enter credentials)'
if ([string]::IsNullOrWhiteSpace($incidentRoute)) {
  throw 'A concrete authorized incident/escalation route is required; no database connection was opened.'
}
$recoveryConfirmation = Read-Host 'Confirm an authorized incident/escalation path is available and restoreability remains unproven; type RECOVERY RISK ACKNOWLEDGED'
if ($recoveryConfirmation -cne 'RECOVERY RISK ACKNOWLEDGED') {
  throw 'Recovery-risk acknowledgement did not match; no database connection was opened.'
}

$migration38AnyObject = @"
EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
  AND table_name='service_store_payment_settings'
  AND column_name IN ('cashfree_production_enabled','cashfree_production_verified_at',
    'cashfree_production_verified_by'))
OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
  AND table_name='cashfree_checkout_intents' AND column_name='checkout_mode')
OR to_regprocedure('public.cashfree_production_gateway_readiness()') IS NOT NULL
OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace=to_regnamespace('public')
  AND proname IN ('claim_cashfree_checkout_intent_for_mode',
    'complete_cashfree_checkout_intent_for_mode','process_cashfree_webhook_event_for_mode',
    'set_cashfree_production_gateway'))
OR EXISTS (SELECT 1 FROM pg_constraint
  WHERE conname='cashfree_checkout_intents_checkout_mode_check')
OR EXISTS (SELECT 1 FROM pg_constraint
  WHERE conrelid=to_regclass('public.service_orders')
    AND conname='service_orders_provider_mode_check'
    AND pg_get_constraintdef(oid) LIKE '%cashfree%'
    AND pg_get_constraintdef(oid) LIKE '%live%')
"@

$readOnlySnapshot = @"
DO `$prestate_guard`$
DECLARE
  sandbox_enabled boolean;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR pg_is_in_recovery()
     OR to_regclass('auth.users') IS NULL
     OR to_regclass('public.service_orders') IS NULL
     OR to_regnamespace('supabase_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Production identity or expected absent-history state failed';
  END IF;
  IF NOT public.cashfree_gateway_readiness() THEN
    RAISE EXCEPTION 'Migration 37 readiness failed; refusing Migration 38';
  END IF;
  IF ($migration38AnyObject) THEN
    RAISE EXCEPTION 'Migration 38 object is present; refusing application';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.service_store_payment_settings
    WHERE cashfree_test_enabled IS DISTINCT FROM false)
    INTO sandbox_enabled;
  IF sandbox_enabled THEN
    RAISE EXCEPTION 'Cashfree Sandbox is enabled; refusing Migration 38';
  END IF;
END;
`$prestate_guard`$;
SELECT 'PRESTATE|PASS|' || count(*)::text || '|' ||
  md5(coalesce((
    SELECT string_agg(row_fingerprint, '' ORDER BY order_id)
    FROM (
      SELECT id::text AS order_id,
        md5(jsonb_build_array(
          id, order_reference, tracking_token_hash, customer_name, customer_email, customer_phone,
          customer_business_name, customer_onboarding_notes, line_items::text, total_amount_paise,
          currency, provider, provider_mode, provider_order_id, provider_payment_id, payment_status,
          fulfillment_status, provider_snapshot::text,
          extract(epoch FROM paid_at), extract(epoch FROM created_at), extract(epoch FROM updated_at)
        )::text) AS row_fingerprint
      FROM public.service_orders WHERE provider='razorpay'
    ) historical_orders
  ), '')) || '|' || pg_total_relation_size('public.service_orders')::text
FROM public.service_orders WHERE provider='razorpay';
"@

$prestateOutput = @(Invoke-ProductionPsql -Sql $readOnlySnapshot -ReadOnly)
$baselineRows = @($prestateOutput | Where-Object { $_ -like 'PRESTATE|PASS|*' })
if ($baselineRows.Count -ne 1) {
  throw 'Production pre-state did not return exactly one safe baseline row; no migration was applied.'
}
$baselineParts = $baselineRows[0].Split([char]124)
if ($baselineParts.Count -ne 5 -or $baselineParts[2] -notmatch '^\d+$' -or
  $baselineParts[3] -notmatch '^[0-9a-f]{32}$' -or $baselineParts[4] -notmatch '^\d+$') {
  throw 'Production pre-state baseline was malformed; no migration was applied.'
}
$baselineCount = [long]::Parse($baselineParts[2], [Globalization.CultureInfo]::InvariantCulture)
$baselineFingerprint = $baselineParts[3]
$serviceOrdersBytes = [long]::Parse($baselineParts[4], [Globalization.CultureInfo]::InvariantCulture)
Write-Output "Pre-state: Migration 37 ready; Migration 38 absent; Cashfree disabled; Razorpay rows=$baselineCount; service_orders_bytes=$serviceOrdersBytes."
Write-Output "Razorpay baseline fingerprint (non-PII aggregate): $baselineFingerprint"

$statementTimeoutInput = Read-Host 'Enter finite reviewed statement_timeout seconds selected for this measured table size (30-1800)'
$statementTimeoutSeconds = 0
if (-not [int]::TryParse($statementTimeoutInput, [ref]$statementTimeoutSeconds) -or
  $statementTimeoutSeconds -lt 30 -or $statementTimeoutSeconds -gt 1800) {
  throw 'A finite statement_timeout from 30 through 1800 seconds is required; no migration was applied.'
}
$timeoutConfirmation = "I APPROVE STATEMENT TIMEOUT $statementTimeoutSeconds SECONDS FOR $serviceOrdersBytes BYTES"
$timeoutTyped = Read-Host "Type exactly: $timeoutConfirmation"
if ($timeoutTyped -cne $timeoutConfirmation) {
  throw 'Statement-timeout confirmation did not match; no migration was applied.'
}
$applyConfirmation = Read-Host "Type exactly APPLY MIGRATION 38 SHA256=$expectedMigrationHash TO PRODUCTION $expectedProjectRef"
if ($applyConfirmation -cne "APPLY MIGRATION 38 SHA256=$expectedMigrationHash TO PRODUCTION $expectedProjectRef") {
  throw 'Migration confirmation did not match; no migration was applied.'
}

$expectedCountSql = $baselineCount.ToString([Globalization.CultureInfo]::InvariantCulture)
$writeGuardSql = @"
DO `$write_guard`$
DECLARE
  current_count bigint;
  current_fingerprint text;
  sandbox_enabled boolean;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR pg_is_in_recovery()
     OR to_regclass('auth.users') IS NULL
     OR to_regnamespace('supabase_migrations') IS NOT NULL
     OR NOT public.cashfree_gateway_readiness()
     OR ($migration38AnyObject) THEN
    RAISE EXCEPTION 'Production target, Migration 37 readiness, history, or Migration 38 absent-state check failed';
  END IF;
  SELECT count(*),
    md5(coalesce(string_agg(row_fingerprint, '' ORDER BY order_id), ''))
  INTO current_count, current_fingerprint
  FROM (
    SELECT id::text AS order_id,
      md5(jsonb_build_array(
        id, order_reference, tracking_token_hash, customer_name, customer_email, customer_phone,
        customer_business_name, customer_onboarding_notes, line_items::text, total_amount_paise,
        currency, provider, provider_mode, provider_order_id, provider_payment_id, payment_status,
        fulfillment_status, provider_snapshot::text,
        extract(epoch FROM paid_at), extract(epoch FROM created_at), extract(epoch FROM updated_at)
      )::text) AS row_fingerprint
    FROM public.service_orders WHERE provider='razorpay'
  ) historical_orders;
  IF current_count <> $expectedCountSql
     OR current_fingerprint <> '$baselineFingerprint' THEN
    RAISE EXCEPTION 'Razorpay baseline changed after the read-only pre-state check';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.service_store_payment_settings
    WHERE cashfree_test_enabled IS DISTINCT FROM false)
    INTO sandbox_enabled;
  IF sandbox_enabled THEN
    RAISE EXCEPTION 'Cashfree Sandbox is enabled; refusing Migration 38';
  END IF;
END;
`$write_guard`$;
"@

$writeSql = @"
SET lock_timeout = '5s';
SET statement_timeout = '${statementTimeoutSeconds}s';
$writeGuardSql
$migrationSql
"@
try {
  [void](Invoke-ProductionPsql -Sql $writeSql)
} catch {
  throw "Migration 38 did not return a confirmed successful completion (no retry was attempted). Keep writes paused; the commit outcome may need independent investigation. $($_.Exception.Message)"
}

Write-Output 'Migration 38 psql completed successfully. Starting the separate read-only Production post-verifier.'
$postVerifierPath = Join-Path $PSScriptRoot 'verify-production-cashfree-migration38-post.ps1'
if (-not (Test-Path -LiteralPath $postVerifierPath -PathType Leaf)) {
  throw 'Migration 38 completed, but the independent post-verifier is missing. Keep writes paused; do not retry.'
}
$powerShell = (Get-Command pwsh -ErrorAction Stop).Source
& $powerShell -NoProfile -File $postVerifierPath `
  -ProjectRef $expectedProjectRef `
  -ExpectedRazorpayOrderCount $baselineCount `
  -ExpectedRazorpayOrderFingerprint $baselineFingerprint `
  -PsqlPath $PsqlPath
if ($LASTEXITCODE -ne 0) {
  throw "Migration 38 was applied, but independent post-verification failed (exit code $LASTEXITCODE). Keep writes paused; do not retry."
}
Write-Output 'MIGRATION 38 POST-VERIFICATION PASS — Migrations 37 and 38 complete, Cashfree disabled, Razorpay baseline unchanged, and history UNVERIFIED.'
