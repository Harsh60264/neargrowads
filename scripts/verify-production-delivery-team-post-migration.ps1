[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}
$versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 psql is required. Detected: $versionOutput"
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper

function Get-ValidatedSchemaResults {
  param(
    [Parameter(Mandatory = $true)]
    [int]$PsqlExitCode,
    [Parameter(Mandatory = $true)]
    [string[]]$Output
  )

  if ($PsqlExitCode -ne 0) {
    throw "Read-only Delivery Team schema verification psql failed with exit code $PsqlExitCode."
  }

  $expectedChecks = @(
    'production target',
    'base WildCard tables',
    'delivery team RLS and grants',
    'private table policies',
    'settings row and threshold',
    'admin ledger columns',
    'stock and damage audit columns',
    'ledger and stock constraints',
    'unique idempotency indexes',
    'privileged functions',
    'migration history remains unverified',
    'partner proofs bucket remains private'
  )
  $commandTagPattern = '^(?:BEGIN|COMMIT|ROLLBACK|SET|DO|CREATE (?:TABLE|INDEX|FUNCTION|POLICY|TRIGGER|VIEW|SEQUENCE|SCHEMA)|ALTER (?:TABLE|FUNCTION|SCHEMA)|INSERT \d+ \d+|UPDATE \d+|DELETE \d+|GRANT|REVOKE)$'
  $results = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)

  foreach ($line in $Output) {
    $trimmedLine = ([string]$line).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmedLine)) {
      continue
    }
    if ($trimmedLine -match $commandTagPattern) {
      continue
    }

    $resultMatch = [regex]::Match($trimmedLine, '^([^|]+)\|(PASS|FAIL)$')
    if (-not $resultMatch.Success) {
      throw "Read-only Delivery Team schema verification returned unexpected psql output: $trimmedLine"
    }
    $checkName = $resultMatch.Groups[1].Value
    if ($expectedChecks -notcontains $checkName) {
      throw "Read-only Delivery Team schema verification returned an unexpected check: $checkName"
    }
    if ($results.ContainsKey($checkName)) {
      throw "Read-only Delivery Team schema verification returned a duplicate check: $checkName"
    }
    if ($resultMatch.Groups[2].Value -cne 'PASS') {
      throw "Read-only Delivery Team schema verification failed: $checkName"
    }
    $results.Add($checkName, $trimmedLine)
  }

  $missingChecks = @($expectedChecks | Where-Object { -not $results.ContainsKey($_) })
  if ($missingChecks.Length -gt 0) {
    throw "Read-only Delivery Team schema verification omitted required checks: $($missingChecks -join ', ')"
  }
  if ($results.Count -ne $expectedChecks.Length) {
    throw "Read-only Delivery Team schema verification returned $($results.Count) unique checks; expected $($expectedChecks.Length)."
  }

  return @($expectedChecks | ForEach-Object { $results[$_] })
}

function Get-SafePsqlFailureSummary {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ExitCode,
    [Parameter(Mandatory = $true)]
    [string[]]$Diagnostics
  )

  $diagnosticText = ($Diagnostics | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) {
      $_.Exception.Message
    } else {
      [string]$_
    }
  }) -join "`n"
  $errorMatch = [regex]::Match(
    $diagnosticText,
    '(?im)\b(?:ERROR|FATAL):\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)'
  )
  $locationMatch = [regex]::Match(
    $diagnosticText,
    '(?im)^psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL):'
  )

  if (-not $errorMatch.Success) {
    return "Read-only Delivery Team schema verification failed (psql exit code $ExitCode); no PostgreSQL ERROR/FATAL line was available. Raw diagnostics and credentials were omitted."
  }

  $sqlState = $errorMatch.Groups[1].Value.ToUpperInvariant()
  $safeMessage = $errorMatch.Groups[2].Value.Trim() `
    -replace '(?i)\b(?:postgres(?:ql)?|https?)://\S+', '[redacted]' `
    -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+', '$1=[redacted]' `
    -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]' `
    -replace '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[redacted-email]' `
    -replace '(?i)(?<!\d)(?:\+?\d[\s().-]*){10,15}(?!\d)', '[redacted-phone]' `
    -replace '\b(?:eyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{10,}){1,2}|(?:sk|pk|sbp|ghp|gho|glpat|xox[baprs])_[A-Za-z0-9_-]{20,})\b', '[redacted-token]' `
    -replace '\s+', ' '
  if ($safeMessage.Length -gt 240) {
    $safeMessage = $safeMessage.Substring(0, 240) + '...'
  }
  if ([string]::IsNullOrWhiteSpace($safeMessage)) {
    $safeMessage = 'PostgreSQL reported an error; message redacted.'
  }

  $stateText = if ([string]::IsNullOrWhiteSpace($sqlState)) { 'unavailable' } else { $sqlState }
  $locationText = if ($locationMatch.Success) {
    "SQL input line $($locationMatch.Groups[1].Value)"
  } else {
    'SQL input line unavailable'
  }
  return "Read-only Delivery Team schema verification failed (psql exit code $ExitCode, SQLSTATE $stateText, $locationText): $safeMessage. Raw diagnostics, query text, and credentials were omitted."
}

$sql = @'
BEGIN TRANSACTION READ ONLY;
WITH required_functions(signature) AS (
  VALUES
    ('public.assert_delivery_team_admin(uuid,text)'),
    ('public.delivery_team_available_coins(uuid)'),
    ('public.get_partner_coin_summary(uuid)'),
    ('public.get_delivery_team_overview(uuid)'),
    ('public.get_delivery_team_partners(uuid,text,text,integer,integer)'),
    ('public.get_delivery_team_partner_detail(uuid,uuid)'),
    ('public.get_delivery_team_campaigns(uuid)'),
    ('public.admin_adjust_partner_coins(uuid,uuid,integer,text,uuid,boolean)'),
    ('public.admin_manage_partner_stock(uuid,uuid,uuid,text,integer,text,uuid)'),
    ('public.admin_create_partner_campaign_assignment(uuid,uuid,text,text,text,date,date,integer,integer,integer,jsonb)'),
    ('public.admin_update_partner_campaign_status(uuid,uuid,text)'),
    ('public.admin_set_delivery_team_low_stock_threshold(uuid,integer)'),
    ('public.admin_review_partner_proof(uuid,uuid,text,text)'),
    ('public.admin_review_partner_campaign_request(uuid,uuid,text,text,integer)'),
    ('public.admin_review_partner_damage_report(uuid,uuid,text,text)'),
    ('public.admin_review_partner_withdrawal(uuid,uuid,text,text,text,boolean)'),
    ('public.request_partner_withdrawal(uuid,integer)')
),
function_checks AS (
  SELECT count(*) = 17 AND bool_and(
    p.oid IS NOT NULL
    AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) AS passed
  FROM required_functions r
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(r.signature)
),
checks(name, passed) AS (
  VALUES
    ('production target', current_database() = 'postgres' AND current_user = 'postgres' AND NOT pg_is_in_recovery() AND (SELECT count(*) = 3 FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role'))),
    ('base WildCard tables', to_regclass('public.partner_profiles') IS NOT NULL AND to_regclass('public.partner_campaigns') IS NOT NULL AND to_regclass('public.partner_campaign_assignments') IS NOT NULL AND to_regclass('public.partner_campaign_sites') IS NOT NULL AND to_regclass('public.partner_campaign_requests') IS NOT NULL AND to_regclass('public.partner_damage_reports') IS NOT NULL AND to_regclass('public.partner_proofs') IS NOT NULL AND to_regclass('public.partner_stock_movements') IS NOT NULL AND to_regclass('public.partner_coin_ledger') IS NOT NULL AND to_regclass('public.partner_withdrawal_requests') IS NOT NULL),
    ('delivery team RLS and grants', (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.delivery_team_settings'::regclass) AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.delivery_team_activity'::regclass) AND NOT has_table_privilege('anon', 'public.delivery_team_settings', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.delivery_team_settings', 'SELECT') AND NOT has_table_privilege('anon', 'public.delivery_team_activity', 'SELECT') AND NOT has_table_privilege('authenticated', 'public.delivery_team_activity', 'SELECT') AND has_table_privilege('service_role', 'public.delivery_team_settings', 'SELECT') AND has_table_privilege('service_role', 'public.delivery_team_activity', 'SELECT')),
    ('private table policies', (SELECT count(*) = 2 AND bool_and(pg_get_expr(p.polqual, p.polrelid) = 'false' AND pg_get_expr(p.polwithcheck, p.polrelid) = 'false') FROM pg_policy p WHERE (p.polrelid = 'public.delivery_team_settings'::regclass AND p.polname = 'delivery_team_settings_no_direct_access') OR (p.polrelid = 'public.delivery_team_activity'::regclass AND p.polname = 'delivery_team_activity_no_direct_access'))),
    ('settings row and threshold', (SELECT count(*) = 1 AND min(low_stock_threshold) BETWEEN 1 AND 100000 FROM public.delivery_team_settings WHERE id = true)),
    ('admin ledger columns', (SELECT count(*) = 5 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_coin_ledger' AND column_name IN ('administrator_id', 'admin_previous_balance', 'admin_resulting_balance', 'admin_reset', 'idempotency_key')) AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_coin_ledger' AND column_name = 'admin_reset' AND is_nullable = 'NO')),
    ('stock and damage audit columns', (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_stock_movements' AND column_name IN ('administrator_id', 'previous_balance', 'resulting_balance', 'idempotency_key')) AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'partner_damage_reports' AND column_name = 'review_note')),
    ('ledger and stock constraints', (SELECT count(*) = 4 AND bool_and(convalidated) FROM pg_constraint WHERE conname IN ('partner_coin_ledger_entry_integrity_check', 'partner_coin_ledger_admin_balance_check', 'partner_coin_ledger_admin_reset_check', 'partner_stock_movements_admin_balance_check'))),
    ('unique idempotency indexes', (SELECT count(*) = 2 AND bool_and(i.indisunique) FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid JOIN pg_namespace n ON n.oid = x.relnamespace WHERE n.nspname = 'public' AND x.relname IN ('partner_coin_ledger_idempotency_unique', 'partner_stock_movements_idempotency_unique'))),
    ('privileged functions', (SELECT passed FROM function_checks)),
    ('migration history remains unverified', to_regnamespace('supabase_migrations') IS NULL),
    ('partner proofs bucket remains private', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'partner-proofs' AND public IS FALSE))
)
SELECT name || '|' || CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END
FROM checks
ORDER BY name;
ROLLBACK;
'@

$temporarySqlPath = Join-Path $env:TEMP ("neargrow-delivery-team-verify-" + [guid]::NewGuid().ToString('N') + '.sql')
$temporaryOutputPath = Join-Path $env:TEMP ("neargrow-delivery-team-verify-" + [guid]::NewGuid().ToString('N') + '.txt')
$savedEnvironment = $null
try {
  [System.IO.File]::WriteAllText($temporarySqlPath, $sql, [System.Text.UTF8Encoding]::new($false))
  $savedEnvironment = Enter-StagingPsqlEnvironment
  $arguments = @(
    '--no-psqlrc',
    '--host', $databaseHost,
    '--port', $databasePort,
    '--username', $databaseUser,
    '--dbname', $databaseName,
    '--password',
    '--set', 'ON_ERROR_STOP=1',
    '--set', 'VERBOSITY=verbose',
    '--set', 'SHOW_CONTEXT=always',
    '--no-align',
    '--tuples-only',
    '--field-separator', '|',
    '--output', $temporaryOutputPath,
    '--file', $temporarySqlPath
  )
  $diagnostics = @(& $PsqlPath @arguments 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
    throw (Get-SafePsqlFailureSummary -ExitCode $exitCode -Diagnostics $diagnostics)
  }
  $results = Get-ValidatedSchemaResults -PsqlExitCode $exitCode `
    -Output @(Get-Content -LiteralPath $temporaryOutputPath)
  Write-Output "Production target: $expectedProjectRef / $databaseName"
  foreach ($result in $results) {
    Write-Output "PASS $($result -replace '\|', ': ')"
  }
  Write-Output 'DELIVERY TEAM SCHEMA EVIDENCE PASS - migration history remains UNVERIFIED.'
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  foreach ($temporaryPath in @($temporarySqlPath, $temporaryOutputPath)) {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}
