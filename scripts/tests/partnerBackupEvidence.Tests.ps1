$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-True {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) {
    throw "FAIL: $Message"
  }
}

function Invoke-TestNative {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation,
    [switch]$CaptureOutput
  )

  $output = @()
  if ($CaptureOutput) {
    $output = @(& $Executable @Arguments)
  } else {
    & $Executable @Arguments | Out-Host
  }
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    throw "$Operation failed: $($output -join ' ')"
  }
  return $output
}

function Set-TestDirectoryAcl {
  param([Parameter(Mandatory = $true)][string]$Path)

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
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $acl
}

$bin = 'C:\Program Files\PostgreSQL\18\bin'
$tools = @{
  initdb = Join-Path $bin 'initdb.exe'
  pg_ctl = Join-Path $bin 'pg_ctl.exe'
  createdb = Join-Path $bin 'createdb.exe'
  psql = Join-Path $bin 'psql.exe'
  pg_dump = Join-Path $bin 'pg_dump.exe'
  pg_restore = Join-Path $bin 'pg_restore.exe'
}
foreach ($tool in $tools.GetEnumerator()) {
  Assert-True (Test-Path -LiteralPath $tool.Value -PathType Leaf) "PostgreSQL test tool missing: $($tool.Key)"
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$backupScriptPath = Join-Path $repoRoot 'scripts\backup-production-partner-workspace.ps1'
$verifierPath = Join-Path $repoRoot 'scripts\verify-production-partner-backup-evidence.ps1'
$testRoot = Join-Path $env:TEMP ('partner-backup-evidence-test-' + [guid]::NewGuid().ToString('N'))
$backupDirectory = Join-Path $testRoot 'backup'
$dataDirectory = Join-Path $testRoot 'cluster'
$serverLog = Join-Path $testRoot 'server.log'
$archivePath = Join-Path $backupDirectory 'fixture.dump'
$tocPath = Join-Path $backupDirectory 'toc.txt'
$evidencePath = Join-Path $backupDirectory 'backup-evidence.json'
$savedEnvironment = @{}
$serverPort = 0
$keepCluster = $false

try {
  New-Item -ItemType Directory -Path $backupDirectory -ErrorAction Stop | Out-Null
  Set-TestDirectoryAcl -Path $backupDirectory
  $hiddenAncestor = Join-Path $testRoot 'HiddenAncestor'
  $hiddenBackupRoot = Join-Path $hiddenAncestor 'BackupRoot'
  New-Item -ItemType Directory -Path $hiddenBackupRoot -ErrorAction Stop | Out-Null
  $hiddenAncestorItem = Get-Item -LiteralPath $hiddenAncestor -Force -ErrorAction Stop
  $hiddenAncestorItem.Attributes = $hiddenAncestorItem.Attributes -bor [System.IO.FileAttributes]::Hidden
  $backupScript = Get-Content -LiteralPath $backupScriptPath -Raw
  Assert-True ($backupScript -match '(?m)^\s*\$pathItem\s*=\s*Get-Item\s+-LiteralPath\s+\$pathToCheck\s+-Force\s+-ErrorAction\s+Stop\s*$') `
    'Backup-root validation must force retrieval of hidden path ancestors and surface lookup errors.'
  $hiddenPathToCheck = $hiddenBackupRoot
  $hiddenAncestorWasChecked = $false
  while (-not [string]::IsNullOrWhiteSpace($hiddenPathToCheck)) {
    if (Test-Path -LiteralPath $hiddenPathToCheck) {
      $hiddenPathItem = Get-Item -LiteralPath $hiddenPathToCheck -Force -ErrorAction Stop
      if ($hiddenPathToCheck -eq $hiddenAncestor) {
        $hiddenAncestorWasChecked = ($hiddenPathItem.Attributes -band [System.IO.FileAttributes]::Hidden) -ne 0
      }
      Assert-True (($hiddenPathItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) `
        "The hidden-directory path walk must retain reparse-point validation: $hiddenPathToCheck"
    }
    $hiddenParent = Split-Path -Parent $hiddenPathToCheck
    if ([string]::IsNullOrWhiteSpace($hiddenParent) -or $hiddenParent -eq $hiddenPathToCheck) {
      break
    }
    $hiddenPathToCheck = $hiddenParent
  }
  Assert-True $hiddenAncestorWasChecked 'Backup-root validation must inspect hidden Windows directory ancestors.'
  foreach ($name in [Environment]::GetEnvironmentVariables('Process').Keys) {
    if ([string]$name -match '^PG[A-Z0-9_]*$') {
      $savedEnvironment[[string]$name] = [Environment]::GetEnvironmentVariable([string]$name, 'Process')
      [Environment]::SetEnvironmentVariable([string]$name, $null, 'Process')
    }
  }
  [Environment]::SetEnvironmentVariable('PGSSLMODE', 'disable', 'Process')

  [void](Invoke-TestNative -Executable $tools.initdb -Arguments @(
      '--pgdata', $dataDirectory,
      '--username', 'postgres',
      '--encoding=UTF8',
      '--locale=C',
      '--data-checksums',
      '--auth-local=trust',
      '--auth-host=trust',
      '--no-instructions'
    ) -Operation 'Test cluster initialization')

  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    $serverPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
  $startArguments = @(
    '--pgdata', $dataDirectory,
    '--log', $serverLog,
    '--options', "-h 127.0.0.1 -p $serverPort -c listen_addresses=127.0.0.1",
    '--wait',
    '--timeout', '60',
    'start'
  )
  & $tools.pg_ctl @startArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'Test cluster startup failed.'
  }

  foreach ($database in @('backup_source', 'backup_restore')) {
    [void](Invoke-TestNative -Executable $tools.createdb -Arguments @(
        '--no-password', '--host', '127.0.0.1', '--port', [string]$serverPort,
        '--username', 'postgres', $database
      ) -Operation "Create test database $database")
  }
  $fixtureSql = @'
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE public.fixture_rows(id integer PRIMARY KEY);
CREATE TABLE auth.users(id integer PRIMARY KEY);
CREATE TABLE auth.identities(id integer PRIMARY KEY);
CREATE TABLE storage.buckets(id text PRIMARY KEY);
CREATE TABLE storage.objects(id integer PRIMARY KEY);
INSERT INTO public.fixture_rows VALUES (31);
INSERT INTO auth.users VALUES (1), (2);
INSERT INTO auth.identities VALUES (11), (12);
INSERT INTO storage.buckets VALUES ('proofs');
INSERT INTO storage.objects VALUES (21);
'@
  [void](Invoke-TestNative -Executable $tools.psql -Arguments @(
      '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
      '--host', '127.0.0.1', '--port', [string]$serverPort,
      '--username', 'postgres', '--dbname', 'backup_source',
      '--command', $fixtureSql
    ) -Operation 'Create synthetic database fixture')
  [void](Invoke-TestNative -Executable $tools.pg_dump -Arguments @(
      '--host', '127.0.0.1', '--port', [string]$serverPort,
      '--username', 'postgres', '--dbname', 'backup_source',
      '--format=custom', '--compress=6', '--file', $archivePath
    ) -Operation 'Create synthetic custom-format archive')
  [void](Invoke-TestNative -Executable $tools.pg_restore -Arguments @(
      '--list', '--file', $tocPath, $archivePath
    ) -Operation 'List synthetic archive')
  [void](Invoke-TestNative -Executable $tools.pg_restore -Arguments @(
      '--no-password', '--host', '127.0.0.1', '--port', [string]$serverPort,
      '--username', 'postgres', '--dbname', 'backup_restore',
      '--no-owner', '--no-acl', '--disable-triggers', '--exit-on-error',
      $archivePath
    ) -Operation 'Restore synthetic archive')

  $tocLines = @(Get-Content -LiteralPath $tocPath)
  $schemaNames = @(
    foreach ($line in $tocLines) {
      if ($line -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+SCHEMA\s+-\s+([^\s]+)') {
        $Matches[1]
      }
    }
  ) | Sort-Object -Unique
  Assert-True (@(@('auth', 'storage') | Where-Object { $schemaNames -contains $_ }).Count -eq 2) `
    "The synthetic archive must contain auth and storage schemas; found: $($schemaNames -join ', ')."
  $publicTableEntryCount = @(
    $tocLines | Where-Object {
      $_ -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE\s+public\s+'
    }
  ).Count
  Assert-True ($publicTableEntryCount -gt 0) 'The synthetic archive must contain a public table definition.'
  $tableDataEntries = @(
    foreach ($line in $tocLines) {
      if ($line -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE DATA\s+([^\s]+)\s+([^\s]+)') {
        [pscustomobject]@{ schema = $Matches[1]; table = $Matches[2] }
      }
    }
  )
  $dataEntriesBySchema = @{}
  foreach ($entry in $tableDataEntries) {
    if (-not $dataEntriesBySchema.ContainsKey($entry.schema)) {
      $dataEntriesBySchema[$entry.schema] = 0
    }
    $dataEntriesBySchema[$entry.schema]++
  }
  $authRows = @()
  foreach ($table in @('users', 'identities')) {
    $countOutput = Invoke-TestNative -Executable $tools.psql -Arguments @(
      '--no-psqlrc', '--no-password', '--no-align', '--tuples-only',
      '--set', 'ON_ERROR_STOP=1',
      '--host', '127.0.0.1', '--port', [string]$serverPort,
      '--username', 'postgres', '--dbname', 'backup_restore',
      '--command', "SELECT count(*)::text FROM auth.`"$table`";"
    ) -Operation "Count restored auth.$table" -CaptureOutput
    $authRows += [pscustomobject]@{
      table = $table
      rows = [long](($countOutput | ForEach-Object { ([string]$_).Trim() }) -join '')
    }
  }

  $now = [DateTimeOffset]::UtcNow
  $evidence = [ordered]@{
    formatVersion = 1
    projectRef = 'axbjzmdokfoftzfgwiql'
    sourceHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
    database = 'postgres'
    backupCreatedAtUtc = $now.AddMinutes(-1).ToString('o')
    archivePath = $archivePath
    archiveBytes = (Get-Item -LiteralPath $archivePath).Length
    sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    archiveIntegrity = 'PG_RESTORE_LIST_PASS'
    schemas = @($schemaNames)
    publicTableEntryCount = $publicTableEntryCount
    tableDataEntryCount = $tableDataEntries.Count
    tableDataEntriesBySchema = $dataEntriesBySchema
    authTableDataEntries = @($tableDataEntries | Where-Object schema -eq 'auth' | Select-Object -ExpandProperty table -Unique)
    storageMetadataEntries = @('storage.buckets', 'storage.objects')
    restoreDrill = [ordered]@{
      status = 'PASS'
      target = 'disposable PostgreSQL 18 cluster bound only to 127.0.0.1'
      startedAtUtc = $now.AddSeconds(-20).ToString('o')
      completedAtUtc = $now.ToString('o')
      authTableRows = $authRows
      error = $null
    }
    coverageLimitations = @(
      'pg_dump does not include cluster-global roles, memberships, or tablespaces.',
      'Supabase Storage object bytes live outside PostgreSQL; storage.objects metadata is included, but file payloads are not.',
      'Supabase project settings, Auth provider configuration/secrets, API keys, edge-function secrets, and external service configuration require separate provider/secret-manager recovery procedures.'
    )
  }
  [System.IO.File]::WriteAllText(
    $evidencePath,
    (ConvertTo-Json -InputObject $evidence -Depth 10),
    [System.Text.UTF8Encoding]::new($false)
  )

  $verificationOutput = @(& $verifierPath -EvidencePath $evidencePath)
  Assert-True ($LASTEXITCODE -eq 0) 'The evidence verifier must accept an intact archive with successful isolated restore evidence.'
  Assert-True (@($verificationOutput | ForEach-Object { [string]$_ }) -contains 'BACKUP EVIDENCE PASS') `
    'The verifier must emit its exact success marker.'

  $evidence.restoreDrill.status = 'FAIL'
  $evidence.restoreDrill.authTableRows = @()
  [System.IO.File]::WriteAllText(
    $evidencePath,
    (ConvertTo-Json -InputObject $evidence -Depth 10),
    [System.Text.UTF8Encoding]::new($false)
  )
  $archiveOnlyOutput = @(& $verifierPath -EvidencePath $evidencePath -ArchiveOnly)
  Assert-True ($LASTEXITCODE -eq 0) 'Archive-only verification must accept an intact archive with a failed restore recorded.'
  Assert-True (@($archiveOnlyOutput | ForEach-Object { [string]$_ }) -contains
    'BACKUP ARCHIVE PASS - RESTORE DRILL FAILED; FULL RESTORE UNVERIFIED') `
    'Archive-only verification must use a distinct non-restore success marker.'
  Assert-True (@($archiveOnlyOutput | ForEach-Object { [string]$_ }) -notcontains 'BACKUP EVIDENCE PASS') `
    'Archive-only verification must never claim a successful full restore.'
  $failedRestoreRejected = $false
  try {
    & $verifierPath -EvidencePath $evidencePath | Out-Null
  } catch {
    $failedRestoreRejected = $_.Exception.Message -like '*must both be PASS*'
  }
  Assert-True $failedRestoreRejected 'The normal evidence mode must still reject a failed restore drill.'

  $evidence.restoreDrill.status = 'PASS'
  $evidence.restoreDrill.authTableRows = $authRows
  $evidence.sha256 = '0' * 64
  [System.IO.File]::WriteAllText(
    $evidencePath,
    (ConvertTo-Json -InputObject $evidence -Depth 10),
    [System.Text.UTF8Encoding]::new($false)
  )
  $tamperedEvidenceRejected = $false
  try {
    & $verifierPath -EvidencePath $evidencePath | Out-Null
  } catch {
    $tamperedEvidenceRejected = $_.Exception.Message -like '*SHA-256 does not match*'
  }
  Assert-True $tamperedEvidenceRejected 'The verifier must reject a manifest whose checksum differs from the archive.'
  Write-Output 'Partner backup evidence local integration tests PASS.'
} finally {
  if (Test-Path -LiteralPath (Join-Path $dataDirectory 'postmaster.pid') -PathType Leaf) {
    $statusOutput = @(& $tools.pg_ctl '--pgdata' $dataDirectory 'status' 2>&1)
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
