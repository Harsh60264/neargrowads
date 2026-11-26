[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [Parameter(Mandatory = $true)]
  [string]$BackupDirectory,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$expectedConstraints = @(
  'partner_coin_ledger_check',
  'partner_coin_ledger_entry_type_check'
)

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

$backupDirectoryPath = [System.IO.Path]::GetFullPath($BackupDirectory)
if (-not (Test-Path -LiteralPath $backupDirectoryPath -PathType Container)) {
  throw 'The baseline evidence directory must be a real, existing directory.'
}
$backupDirectoryAttributes = [System.IO.File]::GetAttributes($backupDirectoryPath)
if (($backupDirectoryAttributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw 'The baseline evidence directory must be a real, existing directory.'
}
$evidencePath = Join-Path $backupDirectoryPath 'backup-evidence.json'
if (-not (Test-Path -LiteralPath $evidencePath -PathType Leaf)) {
  throw 'The reviewed Production backup evidence manifest is missing from the baseline directory.'
}
$backupEvidence = Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
if ($backupEvidence.projectRef -cne $expectedProjectRef -or
  $backupEvidence.restoreDrill.status -cne 'FAIL' -or
  $backupEvidence.archiveIntegrity -cne 'PG_RESTORE_LIST_PASS') {
  throw 'The baseline directory does not contain the reviewed archive evidence with its failed restore status.'
}

$baselinePath = Join-Path $backupDirectoryPath 'delivery-team-pre-migration-baseline.json'
$temporaryOutputPath = Join-Path $backupDirectoryPath ("delivery-team-baseline-query-" + [guid]::NewGuid().ToString('N') + '.json')
if (Test-Path -LiteralPath $baselinePath) {
  throw "Baseline evidence already exists and will not be overwritten: $baselinePath"
}

$sql = @'
BEGIN TRANSACTION READ ONLY;
SELECT json_build_object(
  'capturedAtUtc', clock_timestamp(),
  'projectRef', 'axbjzmdokfoftzfgwiql',
  'databaseName', current_database(),
  'databaseUser', current_user,
  'withdrawalFunctionDefinition',
    pg_get_functiondef(to_regprocedure('public.request_partner_withdrawal(uuid,integer)')),
  'withdrawalFunctionOwner', (
    SELECT r.rolname
    FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE p.oid = to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
  ),
  'withdrawalFunctionAcl', (
    SELECT p.proacl::text
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
  ),
  'withdrawalFunctionConfig', (
    SELECT p.proconfig
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
  ),
  'withdrawalFunctionSecurityDefiner', (
    SELECT p.prosecdef
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
  ),
  'coinLedgerConstraints', (
    SELECT json_agg(jsonb_build_object(
      'name', conname,
      'definition', pg_get_constraintdef(oid, true),
      'validated', convalidated,
      'deferrable', condeferrable,
      'initiallyDeferred', condeferred
    ) ORDER BY conname)
    FROM pg_constraint
    WHERE conrelid = 'public.partner_coin_ledger'::regclass
      AND conname IN ('partner_coin_ledger_check', 'partner_coin_ledger_entry_type_check')
  ),
  'coinLedgerConstraintCount', (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'public.partner_coin_ledger'::regclass
      AND conname IN ('partner_coin_ledger_check', 'partner_coin_ledger_entry_type_check')
  )
)::text;
ROLLBACK;
'@

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper
$savedEnvironment = $null
try {
  $savedEnvironment = Enter-StagingPsqlEnvironment
  $arguments = @(
    '--no-psqlrc',
    '--host', 'aws-0-ap-northeast-2.pooler.supabase.com',
    '--port', '5432',
    '--username', "postgres.$expectedProjectRef",
    '--dbname', 'postgres',
    '--password',
    '--set', 'ON_ERROR_STOP=1',
    '--quiet',
    '--no-align',
    '--tuples-only',
    '--output', $temporaryOutputPath,
    '--command', $sql
  )
  $diagnostics = @(& $PsqlPath @arguments 2>&1)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -or -not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
    throw "Read-only Production baseline query failed with psql exit code $exitCode."
  }

  $snapshot = Get-Content -LiteralPath $temporaryOutputPath -Raw | ConvertFrom-Json
  $constraintNames = @($snapshot.coinLedgerConstraints | ForEach-Object { [string]$_.name } | Sort-Object -Unique)
  if ($snapshot.projectRef -cne $expectedProjectRef -or
    $snapshot.databaseName -cne 'postgres' -or
    $snapshot.databaseUser -cne 'postgres' -or
    [int]$snapshot.coinLedgerConstraintCount -ne 2 -or
    @((Compare-Object $expectedConstraints $constraintNames)).Count -gt 0 -or
    @($snapshot.coinLedgerConstraints | Where-Object {
      [string]::IsNullOrWhiteSpace([string]$_.definition) -or -not [bool]$_.validated
    }).Count -gt 0 -or
    [string]::IsNullOrWhiteSpace([string]$snapshot.withdrawalFunctionDefinition) -or
    [string]$snapshot.withdrawalFunctionDefinition -notmatch '(?i)p_amount\s*<\s*100000' -or
    $snapshot.withdrawalFunctionSecurityDefiner -ne $true) {
    throw 'Production baseline definition validation failed; do not authorize the migration.'
  }

  [System.IO.File]::WriteAllText(
    $baselinePath,
    ($snapshot | ConvertTo-Json -Depth 8) + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
  $baselineItem = Get-Item -LiteralPath $baselinePath -ErrorAction Stop
  if (($baselineItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The baseline evidence file must not be a reparse point.'
  }
  foreach ($rule in (Get-Acl -LiteralPath $baselinePath).Access) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
      $allowedSids -notcontains $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) {
      throw "Baseline evidence is accessible to an unapproved Windows identity: $baselinePath"
    }
  }

  Write-Output 'READ-ONLY PRODUCTION BASELINE CAPTURE PASS'
  Write-Output "Baseline: $baselinePath"
  Write-Output "SHA-256: $((Get-FileHash -LiteralPath $baselinePath -Algorithm SHA256).Hash)"
  Write-Output "Constraint definitions preserved: $($constraintNames -join ', ')"
  Write-Output "Withdrawal function owner: $($snapshot.withdrawalFunctionOwner)"
  Write-Output "Withdrawal function ACL: $($snapshot.withdrawalFunctionAcl)"
  Write-Output 'No Production SQL write was attempted.'
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  if (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf) {
    Remove-Item -LiteralPath $temporaryOutputPath -Force
  }
}
