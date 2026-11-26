[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$BackupRoot = (Join-Path $env:LOCALAPPDATA 'NearGrowAds\ProductionBackups'),
  [string]$PgDumpPath = 'C:\Program Files\PostgreSQL\18\bin\pg_dump.exe',
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [string]$PgCtlPath = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe',
  [string]$InitDbPath = 'C:\Program Files\PostgreSQL\18\bin\initdb.exe',
  [string]$CreateDbPath = 'C:\Program Files\PostgreSQL\18\bin\createdb.exe',
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"
$toolPaths = @($PgDumpPath, $PgRestorePath, $PgCtlPath, $InitDbPath, $CreateDbPath, $PsqlPath)

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
  throw 'A local, non-repository backup root is required.'
}
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoRootPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$backupRootFull = [System.IO.Path]::GetFullPath($BackupRoot)
if ($backupRootFull.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
  $backupRootFull.StartsWith($repoRootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
  $backupRootFull.StartsWith('\\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'BackupRoot must be a local path outside the Git repository.'
}
$pathToCheck = $backupRootFull
while (-not [string]::IsNullOrWhiteSpace($pathToCheck)) {
  if (Test-Path -LiteralPath $pathToCheck) {
    $pathItem = Get-Item -LiteralPath $pathToCheck -Force -ErrorAction Stop
    if (($pathItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "BackupRoot cannot contain a reparse-point path: $pathToCheck"
    }
  }
  $parentPath = Split-Path -Parent $pathToCheck
  if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $pathToCheck) {
    break
  }
  $pathToCheck = $parentPath
}
$BackupRoot = $backupRootFull
foreach ($toolPath in $toolPaths) {
  if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) {
    throw "Required PostgreSQL 18 tool was not found: $toolPath"
  }
  $toolVersion = (& $toolPath --version 2>&1 | Out-String).Trim()
  $toolName = [System.IO.Path]::GetFileNameWithoutExtension($toolPath)
  $versionPattern = '^' + [regex]::Escape($toolName) + ' \(PostgreSQL\) 18(?:\.|\s|$)'
  if ($LASTEXITCODE -ne 0 -or $toolVersion -notmatch $versionPattern) {
    throw "PostgreSQL 18 is required for $toolPath. Detected: $toolVersion"
  }
}

$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper

function Invoke-CheckedNativeCommand {
  param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation,
    [switch]$CaptureOutput
  )

  $diagnostics = @()
  if ($CaptureOutput) {
    $diagnostics = @(& $Executable @Arguments)
  } else {
    & $Executable @Arguments | Out-Host
  }
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $diagnosticText = ($diagnostics | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) {
        $_.Exception.Message
      } else {
        [string]$_
      }
    }) -join ' '
    $safeDiagnostic = $diagnosticText `
      -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+', '$1=[redacted]' `
      -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]' `
      -replace '"[^"]*"|''[^'']*''', '[redacted]' `
      -replace '\s+', ' '
    if ($safeDiagnostic.Length -gt 300) {
      $safeDiagnostic = $safeDiagnostic.Substring(0, 300) + '...'
    }
    if ([string]::IsNullOrWhiteSpace($safeDiagnostic)) {
      $safeDiagnostic = 'See the local terminal diagnostic.'
    }
    throw "$Operation failed (exit code $exitCode): $safeDiagnostic"
  }
  return $diagnostics
}

function Set-PrivateDirectoryAcl {
  param([Parameter(Mandatory = $true)][string]$Path)

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $acl = [System.Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($currentSid)
  foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
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

function Write-BackupEvidence {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Evidence
  )

  $json = ConvertTo-Json -InputObject $Evidence -Depth 12
  [System.IO.File]::WriteAllText(
    $Path,
    $json + [Environment]::NewLine,
    [System.Text.UTF8Encoding]::new($false)
  )
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

function Invoke-LocalPsql {
  param(
    [Parameter(Mandatory = $true)][int]$Port,
    [Parameter(Mandatory = $true)][string]$Sql
  )

  return @(Invoke-CheckedNativeCommand -Executable $PsqlPath -Arguments @(
      '--no-psqlrc', '--no-password', '--set', 'ON_ERROR_STOP=1',
      '--no-align', '--tuples-only',
      '--host', '127.0.0.1', '--port', [string]$Port,
      '--username', 'postgres', '--dbname', 'partner_restore_drill',
      '--command', $Sql
    ) -Operation 'Local restore verification query' -CaptureOutput)
}

function Get-AuthTableRowCounts {
  param([Parameter(Mandatory = $true)][int]$Port)

  $tableOutput = Invoke-LocalPsql -Port $Port -Sql @"
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'auth' AND table_type = 'BASE TABLE'
ORDER BY table_name;
"@
  $tableNames = @($tableOutput | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -match '^[A-Za-z0-9_]+$' })
  if ($tableNames -notcontains 'users' -or $tableNames -notcontains 'identities') {
    throw 'The isolated restore is missing auth.users or auth.identities.'
  }

  $rows = @()
  foreach ($tableName in $tableNames) {
    $quotedName = $tableName.Replace('"', '""')
    $countOutput = Invoke-LocalPsql -Port $Port -Sql "SELECT count(*)::text FROM auth.`"$quotedName`";"
    $countText = (@($countOutput | ForEach-Object { ([string]$_).Trim() }) -join '').Trim()
    $rowCount = 0L
    if (-not [long]::TryParse($countText, [ref]$rowCount) -or $rowCount -lt 0) {
      throw "Could not verify the restored row count for auth.$tableName."
    }
    $rows += [pscustomobject]@{
      table = $tableName
      rows = $rowCount
    }
  }
  return $rows
}

$timestamp = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
$backupDirectory = Join-Path $BackupRoot "partner-workspace-$timestamp"
$archivePath = Join-Path $backupDirectory "production-$expectedProjectRef-$timestamp.dump"
$tocPath = Join-Path $backupDirectory 'archive-toc.txt'
$evidencePath = Join-Path $backupDirectory 'backup-evidence.json'
$clusterPath = Join-Path $backupDirectory 'restore-drill'
$clusterLogPath = Join-Path $backupDirectory 'restore-drill-server.log'
$evidence = $null
$localEnvironment = $null
$remoteEnvironment = $null

New-Item -ItemType Directory -Path $backupDirectory -ErrorAction Stop | Out-Null
Set-PrivateDirectoryAcl -Path $backupDirectory

try {
  $remoteEnvironment = Enter-StagingPsqlEnvironment
  try {
    Write-Output "Creating a full custom-format database archive for pinned Production project $expectedProjectRef."
    Write-Output "The archive will be stored outside the repository at: $archivePath"
    Write-Output 'pg_dump will prompt privately for the database password; the password is not stored.'
    $dumpArguments = @(
      '--host', $databaseHost,
      '--port', $databasePort,
      '--username', $databaseUser,
      '--dbname', $databaseName,
      '--format=custom',
      '--compress=6',
      '--file', $archivePath,
      '--password'
    )
    & $PgDumpPath @dumpArguments
    $dumpExitCode = $LASTEXITCODE
    if ($dumpExitCode -ne 0) {
      throw "Production pg_dump failed with exit code $dumpExitCode. The partial archive will not be accepted as evidence."
    }
  } finally {
    Exit-StagingPsqlEnvironment -SavedEnvironment $remoteEnvironment
  }

  if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
    throw 'Production pg_dump returned success but created no archive.'
  }
  $archiveItem = Get-Item -LiteralPath $archivePath
  if ($archiveItem.Length -le 0) {
    throw 'Production pg_dump created an empty archive.'
  }
  $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  [void](Invoke-CheckedNativeCommand -Executable $PgRestorePath -Arguments @(
      '--list', '--file', $tocPath, $archivePath
    ) -Operation 'Archive table-of-contents integrity check')
  if (-not (Test-Path -LiteralPath $tocPath -PathType Leaf)) {
    throw 'pg_restore --list returned success but produced no archive table of contents.'
  }

  $tocLines = @(Get-Content -LiteralPath $tocPath)
  $schemaNames = @(
    foreach ($line in $tocLines) {
      if ($line -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+SCHEMA\s+-\s+([^\s]+)') {
        $Matches[1]
      }
    }
  ) | Sort-Object -Unique
  $tableDataEntries = @(
    foreach ($line in $tocLines) {
      if ($line -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE DATA\s+([^\s]+)\s+([^\s]+)') {
        [pscustomobject]@{ schema = $Matches[1]; table = $Matches[2] }
      }
    }
  )
  $publicTableEntries = @(
    $tocLines | Where-Object {
      $_ -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE\s+public\s+'
    }
  )
  $authDataTables = @($tableDataEntries | Where-Object schema -eq 'auth' | Select-Object -ExpandProperty table | Sort-Object -Unique)
  $requiredData = @(
    'auth.users',
    'auth.identities',
    'storage.buckets',
    'storage.objects'
  )
  foreach ($requiredEntry in $requiredData) {
    $entryParts = $requiredEntry.Split('.', 2)
    if (-not (@($tableDataEntries | Where-Object { $_.schema -eq $entryParts[0] -and $_.table -eq $entryParts[1] }).Count -eq 1)) {
      throw "The archive is missing required schema/data coverage entry $requiredEntry."
    }
  }
  if ($schemaNames -notcontains 'auth' -or $schemaNames -notcontains 'storage' -or $publicTableEntries.Count -eq 0) {
    throw 'The archive does not include required Auth/Storage schemas and public table definitions.'
  }
  if ($authDataTables.Count -eq 0) {
    throw 'The archive contains no Auth table-data entries.'
  }

  $dataEntriesBySchema = @{}
  foreach ($entry in $tableDataEntries) {
    if (-not $dataEntriesBySchema.ContainsKey($entry.schema)) {
      $dataEntriesBySchema[$entry.schema] = 0
    }
    $dataEntriesBySchema[$entry.schema]++
  }

  $evidence = [ordered]@{
    formatVersion = 1
    projectRef = $expectedProjectRef
    database = $databaseName
    sourceHost = $databaseHost
    backupCreatedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    archivePath = $archivePath
    archiveBytes = $archiveItem.Length
    sha256 = $archiveHash
    pgDumpVersion = (& $PgDumpPath --version 2>&1 | Out-String).Trim()
    pgRestoreVersion = (& $PgRestorePath --version 2>&1 | Out-String).Trim()
    archiveIntegrity = 'PG_RESTORE_LIST_PASS'
    schemas = @($schemaNames)
    publicTableEntryCount = $publicTableEntries.Count
    tableDataEntryCount = $tableDataEntries.Count
    tableDataEntriesBySchema = $dataEntriesBySchema
    authTableDataEntries = @($authDataTables)
    storageMetadataEntries = @('storage.buckets', 'storage.objects')
    restoreDrill = [ordered]@{
      status = 'PENDING'
      target = 'disposable PostgreSQL 18 cluster bound only to 127.0.0.1'
      startedAtUtc = $null
      completedAtUtc = $null
      authTableRows = @()
      error = $null
    }
    coverageLimitations = @(
      'pg_dump does not include cluster-global roles, memberships, or tablespaces.',
      'Supabase Storage object bytes live outside PostgreSQL; storage.objects metadata is included, but file payloads are not.',
      'Supabase project settings, Auth provider configuration/secrets, API keys, edge-function secrets, and external service configuration require separate provider/secret-manager recovery procedures.'
    )
  }

  $localEnvironment = Enter-StagingPsqlEnvironment
  [Environment]::SetEnvironmentVariable('PGSSLMODE', 'disable', 'Process')
  [Environment]::SetEnvironmentVariable('PGSSLROOTCERT', $null, 'Process')
  $port = Get-FreeLoopbackPort
  [void](Invoke-CheckedNativeCommand -Executable $InitDbPath -Arguments @(
      '--pgdata', $clusterPath,
      '--username', 'postgres',
      '--encoding=UTF8',
      '--locale=C',
      '--data-checksums',
      '--auth-local=trust',
      '--auth-host=trust',
      '--no-instructions'
    ) -Operation 'Isolated PostgreSQL cluster initialization')
  $startArguments = @(
    '--pgdata', $clusterPath,
    '--log', $clusterLogPath,
    '--options', "-h 127.0.0.1 -p $port -c listen_addresses=127.0.0.1",
    '--wait',
    '--timeout', '60',
    'start'
  )
  & $PgCtlPath @startArguments
  $startExitCode = $LASTEXITCODE
  if ($startExitCode -ne 0) {
    throw "Isolated PostgreSQL cluster startup failed (exit code $startExitCode)."
  }

  [void](Invoke-CheckedNativeCommand -Executable $CreateDbPath -Arguments @(
      '--no-password', '--host', '127.0.0.1', '--port', [string]$port,
      '--username', 'postgres', 'partner_restore_drill'
    ) -Operation 'Isolated restore database creation')
  [void](Invoke-LocalPsql -Port $port -Sql @'
DO $roles$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'authenticator',
    'supabase_auth_admin', 'supabase_storage_admin', 'supabase_admin',
    'supabase_realtime_admin', 'supabase_functions_admin',
    'dashboard_user', 'supabase_read_only_user'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', role_name);
    END IF;
  END LOOP;
END;
$roles$;
'@)
  $evidence.restoreDrill.startedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
  [void](Invoke-CheckedNativeCommand -Executable $PgRestorePath -Arguments @(
      '--no-password',
      '--host', '127.0.0.1',
      '--port', [string]$port,
      '--username', 'postgres',
      '--dbname', 'partner_restore_drill',
      '--no-owner',
      '--no-acl',
      '--disable-triggers',
      '--exit-on-error',
      $archivePath
    ) -Operation 'Full isolated database restore')
  $evidence.restoreDrill.authTableRows = @(Get-AuthTableRowCounts -Port $port)
  $evidence.restoreDrill.status = 'PASS'
  $evidence.restoreDrill.completedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
  Write-BackupEvidence -Path $evidencePath -Evidence $evidence

  Write-Output 'BACKUP EVIDENCE PASS'
  Write-Output "Production target: $expectedProjectRef / $databaseName"
  Write-Output "Timestamp (UTC): $($evidence.backupCreatedAtUtc)"
  Write-Output "Archive: $archivePath"
  Write-Output "Archive size: $($evidence.archiveBytes) bytes"
  Write-Output "SHA-256: $archiveHash"
  Write-Output "Schemas listed: $($schemaNames -join ', ')"
  Write-Output "Table-data entries: $($tableDataEntries.Count); Auth data tables: $($authDataTables.Count)"
  foreach ($row in $evidence.restoreDrill.authTableRows) {
    Write-Output "Restored Auth table rows: auth.$($row.table)=$($row.rows)"
  }
  Write-Output 'Full pg_restore to disposable localhost PostgreSQL 18 cluster: PASS'
  Write-Output "Evidence manifest: $evidencePath"
  Write-Output 'Storage object bytes, cluster-global roles, Supabase project settings/secrets, and external service configuration are not covered by this database archive.'
} catch {
  if ($null -ne $evidence) {
    $evidence.restoreDrill.status = 'FAIL'
    $evidence.restoreDrill.completedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    $evidence.restoreDrill.error = 'Restore/verification failed; see the local terminal diagnostic.'
    Write-BackupEvidence -Path $evidencePath -Evidence $evidence
  } elseif (Test-Path -LiteralPath $archivePath -PathType Leaf) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  throw
} finally {
  try {
    $removeCluster = $true
    $postmasterPath = Join-Path $clusterPath 'postmaster.pid'
    if (Test-Path -LiteralPath $postmasterPath -PathType Leaf) {
      $statusOutput = @(& $PgCtlPath '--pgdata' $clusterPath 'status' 2>&1)
      $statusExitCode = $LASTEXITCODE
      if ($statusExitCode -eq 0) {
        $stopArguments = @(
          '--pgdata', $clusterPath, '--mode', 'fast', '--wait', 'stop'
        )
        & $PgCtlPath @stopArguments
        $stopExitCode = $LASTEXITCODE
        if ($stopExitCode -ne 0) {
          $removeCluster = $false
          throw "Could not stop the isolated restore server (exit code $stopExitCode). Its data directory was retained at $clusterPath."
        }
      } elseif ($statusExitCode -ne 3) {
        $removeCluster = $false
        throw "Could not determine whether the isolated restore server stopped. Its data directory was retained at $clusterPath."
      }
    }
  } finally {
    if ($null -ne $localEnvironment) {
      Exit-StagingPsqlEnvironment -SavedEnvironment $localEnvironment
    } elseif ($null -ne $remoteEnvironment) {
      Exit-StagingPsqlEnvironment -SavedEnvironment $remoteEnvironment
    }
    if ($removeCluster -and (Test-Path -LiteralPath $clusterPath -PathType Container)) {
      Remove-Item -LiteralPath $clusterPath -Recurse -Force
    }
    if (Test-Path -LiteralPath $tocPath -PathType Leaf) {
      Remove-Item -LiteralPath $tocPath -Force
    }
    if (-not (Test-Path -LiteralPath $clusterPath -PathType Container) -and
      (Test-Path -LiteralPath $clusterLogPath -PathType Leaf)) {
      Remove-Item -LiteralPath $clusterLogPath -Force
    }
  }
}
