[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$EvidencePath,
  [string]$PgRestorePath = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe',
  [switch]$ArchiveOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$expectedSourceHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$expectedDatabase = 'postgres'
$expectedArchiveIntegrity = 'PG_RESTORE_LIST_PASS'
$expectedRestoreTarget = 'disposable PostgreSQL 18 cluster bound only to 127.0.0.1'
$expectedSupabaseRestoreTarget = 'disposable Supabase PostgreSQL 17 container with disabled networking and a read-only archive mount'
$expectedSupabaseImage = 'docker.io/supabase/postgres@sha256:df59ef0172dec80053ea186542ba12c8719bb5ca38abbecffd6b7cd6b4075994'
$requiredDataEntries = @(
  'auth.users',
  'auth.identities',
  'storage.buckets',
  'storage.objects'
)
$requiredCoverageLimitations = @(
  'pg_dump does not include cluster-global roles, memberships, or tablespaces.',
  'Supabase Storage object bytes live outside PostgreSQL; storage.objects metadata is included, but file payloads are not.',
  'Supabase project settings, Auth provider configuration/secrets, API keys, edge-function secrets, and external service configuration require separate provider/secret-manager recovery procedures.'
)

if (-not (Test-Path -LiteralPath $EvidencePath -PathType Leaf)) {
  throw "Backup evidence manifest was not found: $EvidencePath"
}
if (-not (Test-Path -LiteralPath $PgRestorePath -PathType Leaf)) {
  throw "PostgreSQL 18 pg_restore.exe was not found at: $PgRestorePath"
}
$restoreVersion = (& $PgRestorePath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $restoreVersion -notmatch '^pg_restore \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw "PostgreSQL 18 pg_restore is required. Detected: $restoreVersion"
}

$evidence = Get-Content -LiteralPath $EvidencePath -Raw | ConvertFrom-Json -DateKind String
if ($evidence.formatVersion -ne 1 -or
  $evidence.projectRef -cne $expectedProjectRef -or
  $evidence.sourceHost -cne $expectedSourceHost -or
  $evidence.database -cne $expectedDatabase) {
  throw 'Backup evidence does not identify the pinned Production project and database.'
}
if ($evidence.archiveIntegrity -cne $expectedArchiveIntegrity -or
  $evidence.restoreDrill.target -notin @($expectedRestoreTarget, $expectedSupabaseRestoreTarget)) {
  throw 'Backup evidence does not contain the expected archive-integrity and isolated-target records.'
}
if ($ArchiveOnly) {
  if ($evidence.restoreDrill.status -cne 'FAIL') {
    throw 'Archive-only verification is permitted only when the isolated restore is explicitly recorded as FAIL.'
  }
} elseif ($evidence.restoreDrill.status -cne 'PASS') {
  throw 'Backup archive integrity and isolated restore-drill evidence must both be PASS.'
}

$backupCreatedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
    [string]$evidence.backupCreatedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$backupCreatedAt
  ) -or $backupCreatedAt -gt [DateTimeOffset]::UtcNow -or
  $backupCreatedAt -lt [DateTimeOffset]::UtcNow.AddHours(-24)) {
  throw 'Backup evidence must be timestamped in UTC and no more than 24 hours old.'
}
$restoreCompletedAt = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse(
    [string]$evidence.restoreDrill.completedAtUtc,
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$restoreCompletedAt
  ) -or $restoreCompletedAt -lt $backupCreatedAt -or $restoreCompletedAt -gt [DateTimeOffset]::UtcNow) {
  throw 'The isolated restore drill must have completed after this backup and before evidence verification.'
}

$archivePath = [System.IO.Path]::GetFullPath([string]$evidence.archivePath)
$archiveItem = Get-Item -LiteralPath $archivePath -ErrorAction Stop
if ($archiveItem.PSIsContainer -or
  ($archiveItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
  $archiveItem.Extension -cne '.dump' -or
  $archiveItem.Length -le 0) {
  throw 'The evidence archive must be a non-empty PostgreSQL custom-format .dump file.'
}
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repoRootPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if ($archivePath.StartsWith($repoRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Production database archives must be stored outside the Git repository.'
}
if ([long]$evidence.archiveBytes -ne $archiveItem.Length) {
  throw 'Backup evidence file size does not match the archive.'
}
$actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($actualHash -cne [string]$evidence.sha256) {
  throw 'Backup evidence SHA-256 does not match the archive.'
}
if ($evidence.restoreDrill.target -ceq $expectedSupabaseRestoreTarget) {
  $supabaseRecoveryProperty = $evidence.restoreDrill.PSObject.Properties['supabaseRecovery']
  $supabaseRecovery = if ($null -ne $supabaseRecoveryProperty) {
    $supabaseRecoveryProperty.Value
  } else {
    $null
  }
  $requiredRestoredTables = @(
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
  $restoredTableRows = if ($null -ne $supabaseRecovery) {
    @($supabaseRecovery.tableRowCounts)
  } else {
    @()
  }
  $restoredTableNames = @($restoredTableRows | ForEach-Object { [string]$_.table })
  $restoredRowsValid = $true
  foreach ($tableName in $requiredRestoredTables) {
    $tableRows = @($restoredTableRows | Where-Object { [string]$_.table -ceq $tableName })
    $rowCount = 0L
    if ($tableRows.Count -ne 1 -or
      -not [long]::TryParse([string]$tableRows[0].rows, [ref]$rowCount) -or
      $rowCount -lt 0) {
      $restoredRowsValid = $false
      break
    }
  }
  $imageDigest = if ($null -ne $supabaseRecovery) {
    ([string]$supabaseRecovery.image).Split('@')[-1]
  } else {
    ''
  }
  if ($null -eq $supabaseRecovery -or
    $supabaseRecovery.image -cne $expectedSupabaseImage -or
    $imageDigest -cne 'sha256:df59ef0172dec80053ea186542ba12c8719bb5ca38abbecffd6b7cd6b4075994' -or
    $supabaseRecovery.networkMode -cne 'none' -or
    $supabaseRecovery.archiveMountedReadOnly -ne $true -or
    $supabaseRecovery.archiveSha256 -cne $actualHash -or
    [int]$supabaseRecovery.serverVersionNumber -ne 170012 -or
    $supabaseRecovery.supabaseVaultExtensionVersion -cne '0.3.2' -or
    [int]$supabaseRecovery.pgRestoreExitCode -ne 0 -or
    [string]$supabaseRecovery.restoredDatabase -notmatch '^partner_restore_verified_[a-f0-9]{32}$' -or
    -not $restoredRowsValid -or
    @((Compare-Object $requiredRestoredTables $restoredTableNames)).Count -gt 0) {
    throw 'The Supabase-compatible restore evidence is incomplete or does not match the pinned isolated restore target.'
  }
}

$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
 $archiveDirectory = [System.IO.Path]::GetDirectoryName($archivePath)
$directoryItem = Get-Item -LiteralPath $archiveDirectory -ErrorAction Stop
if (($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  throw 'Backup archive directory must not be a reparse point.'
}
foreach ($securedPath in @($archiveDirectory, $archivePath)) {
  $acl = Get-Acl -LiteralPath $securedPath
  if ([System.IO.Path]::GetFullPath($securedPath) -eq $archiveDirectory -and
    -not $acl.AreAccessRulesProtected) {
    throw "Backup path ACL is not protected from inherited access: $securedPath"
  }
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
      $allowedSids -notcontains $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) {
      throw "Backup path is accessible to an unapproved Windows identity: $securedPath"
    }
  }
}

$schemas = @($evidence.schemas | ForEach-Object { [string]$_ })
if (@(@('auth', 'storage') | Where-Object { $schemas -notcontains $_ }).Count -gt 0) {
  throw 'Backup evidence is missing the required auth or storage schema.'
}
if ([int]$evidence.publicTableEntryCount -le 0) {
  throw 'Backup evidence is missing public table definitions.'
}
$authDataEntries = @($evidence.authTableDataEntries | ForEach-Object { [string]$_ })
$authRows = @($evidence.restoreDrill.authTableRows)
foreach ($requiredEntry in $requiredDataEntries) {
  $parts = $requiredEntry.Split('.', 2)
  $dataEntries = if ($parts[0] -eq 'auth') { $authDataEntries } else { @($evidence.storageMetadataEntries | ForEach-Object { [string]$_ }) }
  if ($dataEntries -notcontains $parts[1] -and $dataEntries -notcontains $requiredEntry) {
    throw "Backup evidence is missing a required database schema/data entry: $requiredEntry"
  }
}
if (-not $ArchiveOnly) {
  foreach ($requiredAuthTable in @('users', 'identities')) {
    if ($authRows.table -notcontains $requiredAuthTable) {
      throw "The isolated restore evidence is missing restored auth.$requiredAuthTable row counts."
    }
  }
}
foreach ($limitation in $requiredCoverageLimitations) {
  if (@($evidence.coverageLimitations | ForEach-Object { [string]$_ }) -notcontains $limitation) {
    throw 'Backup evidence must explicitly list Storage payload, cluster-global, and Supabase project-configuration exclusions.'
  }
}

$temporaryTocPath = Join-Path ([System.IO.Path]::GetDirectoryName($archivePath)) ("verify-toc-" + [guid]::NewGuid().ToString('N') + '.txt')
try {
  $diagnostics = @(& $PgRestorePath '--list' '--file' $temporaryTocPath $archivePath 2>&1)
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryTocPath -PathType Leaf)) {
    throw 'Independent pg_restore --list validation of the backup archive failed.'
  }
  $decodeDiagnostics = @(& $PgRestorePath '--file' 'NUL' $archivePath 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw 'Full archive payload decoding failed; no backup evidence was accepted.'
  }
  $tocLines = @(Get-Content -LiteralPath $temporaryTocPath)
  $tocSchemas = @(
    foreach ($line in $tocLines) {
      if ($line -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+SCHEMA\s+-\s+([^\s]+)') {
        $Matches[1]
      }
    }
  ) | Sort-Object -Unique
  $tocAuthData = @(
    foreach ($line in $tocLines) {
      if ($line -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE DATA\s+auth\s+([^\s]+)') {
        $Matches[1]
      }
    }
  ) | Sort-Object -Unique
  $tocStorageData = @(
    foreach ($line in $tocLines) {
      if ($line -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE DATA\s+storage\s+([^\s]+)') {
        $Matches[1]
      }
    }
  ) | Sort-Object -Unique
  $tocPublicTableCount = @(
    $tocLines | Where-Object {
      $_ -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE\s+public\s+'
    }
  ).Count
  $tocDataCount = @($tocLines | Where-Object { $_ -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE DATA\s+' }).Count
  $tocDataEntriesBySchema = @{}
  foreach ($line in $tocLines) {
    if ($line -match '^\s*(?:;\s*\d+;\s*\d+|;\s*\d+\s+\d+|\d+;\s*\d+\s+\d+)\s+TABLE DATA\s+([^\s]+)\s+') {
      $schemaName = $Matches[1]
      if (-not $tocDataEntriesBySchema.ContainsKey($schemaName)) {
        $tocDataEntriesBySchema[$schemaName] = 0
      }
      $tocDataEntriesBySchema[$schemaName]++
    }
  }
  $manifestAuthData = @($authDataEntries | Sort-Object -Unique)
  $manifestDataCount = [int]$evidence.tableDataEntryCount
  $manifestSchemas = @($schemas | Sort-Object -Unique)
  $manifestTocSchemas = @($tocSchemas | Sort-Object -Unique)
  $schemaCountsMatch = $true
  foreach ($schemaName in $tocDataEntriesBySchema.Keys) {
    $countProperty = $evidence.tableDataEntriesBySchema.PSObject.Properties[$schemaName]
    if ($null -eq $countProperty -or [int]$countProperty.Value -ne [int]$tocDataEntriesBySchema[$schemaName]) {
      $schemaCountsMatch = $false
      break
    }
  }
  if (@(@('auth', 'storage') | Where-Object { $tocSchemas -notcontains $_ }).Count -gt 0 -or
    @(@('users', 'identities') | Where-Object { $tocAuthData -notcontains $_ }).Count -gt 0 -or
    @(@('buckets', 'objects') | Where-Object { $tocStorageData -notcontains $_ }).Count -gt 0 -or
    $tocPublicTableCount -le 0 -or
    $tocPublicTableCount -ne [int]$evidence.publicTableEntryCount -or
    @((Compare-Object $tocAuthData $manifestAuthData)).Count -gt 0 -or
    @((Compare-Object $manifestSchemas $manifestTocSchemas)).Count -gt 0 -or
    -not $schemaCountsMatch -or
    $tocDataCount -ne $manifestDataCount -or
    $tocDataCount -le 0) {
    throw 'The archive table of contents does not independently confirm the recorded schema and Auth/Storage data coverage.'
  }
} finally {
  if (Test-Path -LiteralPath $temporaryTocPath -PathType Leaf) {
    Remove-Item -LiteralPath $temporaryTocPath -Force
  }
}

if ($ArchiveOnly) {
  Write-Output 'BACKUP ARCHIVE PASS - RESTORE DRILL FAILED; FULL RESTORE UNVERIFIED'
} else {
  Write-Output 'BACKUP EVIDENCE PASS'
}
Write-Output "Project: $expectedProjectRef / $expectedDatabase"
Write-Output "Backup (UTC): $($backupCreatedAt.ToUniversalTime().ToString('o'))"
Write-Output "Archive bytes: $($archiveItem.Length)"
Write-Output "SHA-256: $actualHash"
Write-Output 'Schema/data evidence: public, Auth, and Storage metadata present; auth.users and auth.identities included.'
if ($ArchiveOnly) {
  Write-Output "Isolated full restore drill: FAIL ($($restoreCompletedAt.ToUniversalTime().ToString('o')))"
  Write-Output 'This archive-only result does not establish database restoreability or full Supabase recovery.'
  $diagnosticProperty = $evidence.restoreDrill.PSObject.Properties['diagnostic']
  if ($null -ne $diagnosticProperty -and
    -not [string]::IsNullOrWhiteSpace([string]$diagnosticProperty.Value)) {
    $failureStageProperty = $evidence.restoreDrill.PSObject.Properties['failureStage']
    $failureStage = if ($null -ne $failureStageProperty) {
      [string]$failureStageProperty.Value
    } else {
      'Not recorded'
    }
    Write-Output "Restore failure stage: $failureStage"
    Write-Output "Restore failure diagnostic: $($diagnosticProperty.Value)"
  }
} else {
  if ($evidence.restoreDrill.target -ceq $expectedSupabaseRestoreTarget) {
    Write-Output "Isolated full restore drill: PASS in the pinned Supabase PostgreSQL 17 container ($($restoreCompletedAt.ToUniversalTime().ToString('o')))"
  } else {
    Write-Output "Isolated full restore drill: PASS ($($restoreCompletedAt.ToUniversalTime().ToString('o')))"
  }
}
Write-Output 'Not covered: Storage object payload files, cluster-global roles/tablespaces, Supabase project settings/secrets, and external service configuration.'
