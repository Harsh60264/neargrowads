[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$EvidencePath,
  [string]$ContainerName = 'ng-wildcard-recovery-20261127',
  [string]$WslDistribution = 'Ubuntu',
  [string]$WslExePath = 'C:\Windows\System32\wsl.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$expectedSourceHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$expectedImage = 'docker.io/supabase/postgres@sha256:df59ef0172dec80053ea186542ba12c8719bb5ca38abbecffd6b7cd6b4075994'
$expectedDigest = 'sha256:df59ef0172dec80053ea186542ba12c8719bb5ca38abbecffd6b7cd6b4075994'
$expectedTarget = 'disposable Supabase PostgreSQL 17 container with disabled networking and a read-only archive mount'
$verifierPath = Join-Path $PSScriptRoot 'verify-production-partner-backup-evidence.ps1'

if (-not (Test-Path -LiteralPath $EvidencePath -PathType Leaf)) {
  throw "Backup evidence manifest was not found: $EvidencePath"
}
if (-not (Test-Path -LiteralPath $WslExePath -PathType Leaf)) {
  throw "Windows Subsystem for Linux executable was not found: $WslExePath"
}
if (-not (Test-Path -LiteralPath $verifierPath -PathType Leaf)) {
  throw 'The independent backup evidence verifier is missing.'
}

$evidence = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json -DateKind String
if ($evidence.formatVersion -ne 1 -or
  $evidence.projectRef -cne $expectedProjectRef -or
  $evidence.sourceHost -cne $expectedSourceHost -or
  $evidence.database -cne 'postgres' -or
  $evidence.archiveIntegrity -cne 'PG_RESTORE_LIST_PASS' -or
  $evidence.restoreDrill.status -cne 'FAIL' -or
  $evidence.restoreDrill.target -cne 'disposable PostgreSQL 18 cluster bound only to 127.0.0.1' -or
  [string]$evidence.restoreDrill.diagnostic -notmatch 'supabase_vault') {
  throw 'The evidence does not contain the expected prior PostgreSQL 18 extension-compatibility failure; it cannot be upgraded by this procedure.'
}

$archivePath = [System.IO.Path]::GetFullPath([string]$evidence.archivePath)
$archive = Get-Item -LiteralPath $archivePath -ErrorAction Stop
if ($archive.PSIsContainer -or $archive.Extension -cne '.dump' -or $archive.Length -le 0 -or
  [long]$evidence.archiveBytes -ne $archive.Length) {
  throw 'The backup archive is missing, empty, or inconsistent with its evidence manifest.'
}
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($archiveHash -cne [string]$evidence.sha256) {
  throw 'The backup archive SHA-256 does not match its evidence manifest.'
}
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoRootPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if ($archivePath.StartsWith($repoRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The backup archive must remain outside the Git repository.'
}
if ($archivePath -notmatch '^[A-Za-z]:\\') {
  throw 'The archive must be on a local Windows drive that can be mounted read-only into WSL.'
}

function Invoke-WslChecked {
  param(
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$Operation
  )

  $output = @(& $WslExePath -d $WslDistribution -e @Arguments 2>&1 | ForEach-Object { [string]$_ })
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    $diagnostic = ($output -join ' ').Trim()
    if ($diagnostic.Length -gt 1200) {
      $diagnostic = $diagnostic.Substring(0, 1200) + '...'
    }
    throw "$Operation failed (exit code $exitCode): $diagnostic"
  }
  return ($output -join "`n").Trim()
}

$drive = $archivePath.Substring(0, 1).ToLowerInvariant()
$archiveRelativePath = $archivePath.Substring(3).Replace('\', '/')
$archiveWslPath = "/mnt/$drive/$archiveRelativePath"
$podmanFormat = '{{.Name}}|{{.ImageName}}|{{.HostConfig.NetworkMode}}|{{.State.Running}}|{{range .Mounts}}{{.Destination}}|{{.Source}}|{{.RW}};{{end}}'
$containerInfo = Invoke-WslChecked -Arguments @(
  'podman', 'inspect', '--format', $podmanFormat, $ContainerName
) -Operation 'Inspect the isolated recovery container'
$containerFields = $containerInfo.Split('|', 5)
if ($containerFields.Count -ne 5 -or
  $containerFields[0].TrimStart('/') -cne $ContainerName -or
  $containerFields[1] -cne $expectedImage -or
  $containerFields[2] -cne 'none' -or
  $containerFields[3] -cne 'true') {
  throw 'The restore target must be the running container for the pinned Supabase image with networking disabled.'
}
$mounts = @($containerFields[4].Split(';') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$archiveMounts = @($mounts | Where-Object {
  $parts = $_.Split('|', 3)
  $parts.Count -eq 3 -and $parts[0] -ceq '/tmp/production.dump'
})
$socketMounts = @($mounts | Where-Object {
  $parts = $_.Split('|', 3)
  $parts.Count -eq 3 -and $parts[0] -ceq '/var/run/postgresql'
})
if ($archiveMounts.Count -ne 1 -or
  $archiveMounts[0].Split('|', 3)[1] -cne $archiveWslPath -or
  $archiveMounts[0].Split('|', 3)[2] -cne 'false' -or
  $socketMounts.Count -ne 1 -or
  $socketMounts[0].Split('|', 3)[2] -cne 'true') {
  throw 'The recovery container must mount this exact archive read-only and use the expected local Unix-socket directory.'
}

$imageDigest = Invoke-WslChecked -Arguments @(
  'podman', 'image', 'inspect', '--format', '{{.Digest}}', $expectedImage
) -Operation 'Verify the pinned recovery image digest'
if ($imageDigest -cne $expectedDigest) {
  throw 'The locally installed Supabase recovery image digest does not match the pinned image.'
}
$restoreVersion = Invoke-WslChecked -Arguments @(
  'pg_restore', '--version'
) -Operation 'Check the PostgreSQL restore client version'
if ($restoreVersion -notmatch '^pg_restore \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 pg_restore is required for archive-format verification. Detected: $restoreVersion"
}
$socketPath = $socketMounts[0].Split('|', 3)[1]
Invoke-WslChecked -Arguments @(
  'pg_isready', '--host', $socketPath, '--port', '5432', '--username', 'supabase_admin'
) -Operation 'Check the isolated Supabase database socket' | Out-Null

$databaseName = 'partner_restore_verified_' + [guid]::NewGuid().ToString('N')
$startedAt = [DateTimeOffset]::UtcNow
Invoke-WslChecked -Arguments @(
  'createdb', '--no-password', '--host', $socketPath, '--port', '5432',
  '--username', 'supabase_admin', $databaseName
) -Operation 'Create the uniquely named disposable restore database' | Out-Null

$restoreOutput = @()
try {
  $restoreOutput = @(& $WslExePath -d $WslDistribution -e pg_restore `
    '--no-password' '--no-owner' '--no-acl' '--exit-on-error' `
    '--host' $socketPath '--port' '5432' '--username' 'supabase_admin' `
    '--dbname' $databaseName $archiveWslPath 2>&1 | ForEach-Object { [string]$_ })
  $restoreExitCode = $LASTEXITCODE
  if ($restoreExitCode -ne 0) {
    $diagnostic = ($restoreOutput -join ' ').Trim()
    if ($diagnostic.Length -gt 1200) {
      $diagnostic = $diagnostic.Substring(0, 1200) + '...'
    }
    throw "Pinned Supabase PostgreSQL restore failed (exit code $restoreExitCode): $diagnostic"
  }

  $countQuery = @'
SELECT current_setting('server_version_num') ||
  '|' || (SELECT extversion FROM pg_extension WHERE extname = 'supabase_vault') ||
  '|' || (SELECT count(*)::text FROM auth.users) ||
  '|' || (SELECT count(*)::text FROM auth.identities) ||
  '|' || (SELECT count(*)::text FROM storage.buckets) ||
  '|' || (SELECT count(*)::text FROM storage.objects) ||
  '|' || (SELECT count(*)::text FROM public.partner_profiles) ||
  '|' || (SELECT count(*)::text FROM public.partner_campaigns) ||
  '|' || (SELECT count(*)::text FROM public.partner_campaign_assignments) ||
  '|' || (SELECT count(*)::text FROM public.partner_campaign_requests) ||
  '|' || (SELECT count(*)::text FROM public.partner_damage_reports) ||
  '|' || (SELECT count(*)::text FROM public.partner_proofs) ||
  '|' || (SELECT count(*)::text FROM public.partner_stock_movements) ||
  '|' || (SELECT count(*)::text FROM public.partner_coin_ledger) ||
  '|' || (SELECT count(*)::text FROM public.partner_withdrawal_requests);
'@
  $queryResult = Invoke-WslChecked -Arguments @(
    'psql', '--no-psqlrc', '--no-password', '--no-align', '--tuples-only',
    '--field-separator', '|', '--set', 'ON_ERROR_STOP=1',
    '--host', $socketPath, '--port', '5432', '--username', 'supabase_admin',
    '--dbname', $databaseName, '--command', $countQuery
  ) -Operation 'Verify restored Supabase extensions and required tables'
  $fields = $queryResult.Split('|')
  if ($fields.Count -ne 15 -or $fields[0] -cne '170012' -or $fields[1] -cne '0.3.2') {
    throw "Restored database compatibility checks failed. Detected server version $($fields[0]) and vault version $($fields[1])."
  }

  $tableNames = @(
    'auth.users',
    'auth.identities',
    'storage.buckets',
    'storage.objects',
    'public.partner_profiles',
    'public.partner_campaigns',
    'public.partner_campaign_assignments',
    'public.partner_campaign_requests',
    'public.partner_damage_reports',
    'public.partner_proofs',
    'public.partner_stock_movements',
    'public.partner_coin_ledger',
    'public.partner_withdrawal_requests'
  )
  $tableRowCounts = @()
  for ($index = 0; $index -lt $tableNames.Count; $index++) {
    $rowCount = 0L
    if (-not [long]::TryParse($fields[$index + 2], [ref]$rowCount) -or $rowCount -lt 0) {
      throw "Restored row count was invalid for $($tableNames[$index])."
    }
    $tableRowCounts += [ordered]@{
      table = $tableNames[$index]
      rows = $rowCount
    }
  }
  $authTableRows = @(
    [ordered]@{ table = 'users'; rows = [long]$fields[2] },
    [ordered]@{ table = 'identities'; rows = [long]$fields[3] }
  )

  $completedAt = [DateTimeOffset]::UtcNow
  $previousEvidenceJson = [System.IO.File]::ReadAllText($EvidencePath)
  $previousRestoreDrill = $evidence.restoreDrill
  $evidence.restoreDrill.target = $expectedTarget
  $evidence.restoreDrill.status = 'PASS'
  $evidence.restoreDrill.startedAtUtc = $startedAt.ToString('o')
  $evidence.restoreDrill.completedAtUtc = $completedAt.ToString('o')
  $evidence.restoreDrill.authTableRows = $authTableRows
  $evidence.restoreDrill.failureStage = $null
  $evidence.restoreDrill.error = $null
  $evidence.restoreDrill.diagnostic = $null
  $evidence.restoreDrill | Add-Member -NotePropertyName genericPostgreSQL18RestoreAttempt -NotePropertyValue ([ordered]@{
    status = 'FAIL'
    failureStage = [string]$previousRestoreDrill.failureStage
    diagnostic = [string]$previousRestoreDrill.diagnostic
  }) -Force
  $evidence.restoreDrill | Add-Member -NotePropertyName supabaseRecovery -NotePropertyValue ([ordered]@{
    image = $expectedImage
    networkMode = 'none'
    archiveMountedReadOnly = $true
    archiveSha256 = $archiveHash
    serverVersionNumber = [int]$fields[0]
    supabaseVaultExtensionVersion = $fields[1]
    pgRestoreExitCode = $restoreExitCode
    restoredDatabase = $databaseName
    tableRowCounts = $tableRowCounts
  }) -Force

  try {
    [System.IO.File]::WriteAllText(
      $EvidencePath,
      (ConvertTo-Json -InputObject $evidence -Depth 15),
      [System.Text.UTF8Encoding]::new($false)
    )
    $verificationOutput = @(& $verifierPath -EvidencePath $EvidencePath)
    if ($LASTEXITCODE -ne 0) {
      throw "The independent full-evidence verifier rejected the Supabase restore record: $($verificationOutput -join ' ')"
    }
  } catch {
    [System.IO.File]::WriteAllText(
      $EvidencePath,
      $previousEvidenceJson,
      [System.Text.UTF8Encoding]::new($false)
    )
    throw
  }
} catch {
  throw
}

Write-Output 'Pinned Supabase PostgreSQL restore and independent backup evidence verification: PASS'
Write-Output "Image digest: $imageDigest"
Write-Output "Network mode: none; archive mount: read-only"
Write-Output "Database: $databaseName (disposable; retained only inside the isolated recovery container)"
Write-Output "PostgreSQL server_version_num: $($fields[0]); supabase_vault: $($fields[1])"
foreach ($tableRow in $tableRowCounts) {
  Write-Output "Restored table rows: $($tableRow.table)=$($tableRow.rows)"
}
Write-Output 'Production database was not modified.'
