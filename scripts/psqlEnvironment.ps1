function Assert-ProductionPsqlPasswordFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw 'The Windows user profile is not available for password-file validation.'
  }
  $expectedPath = [System.IO.Path]::GetFullPath(
    (Join-Path $env:APPDATA 'NearGrowAds\pgpass\production.pgpass')
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $fullPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Only the approved dedicated Production pgpass path is accepted.'
  }

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
  foreach ($securedPath in @(
      [System.IO.Path]::GetDirectoryName($fullPath),
      $fullPath
    )) {
    if (-not (Test-Path -LiteralPath $securedPath -PathType Leaf -ErrorAction SilentlyContinue) -and
        -not (Test-Path -LiteralPath $securedPath -PathType Container -ErrorAction SilentlyContinue)) {
      throw 'The approved Production pgpass file or directory is missing.'
    }
    $item = Get-Item -LiteralPath $securedPath -Force -ErrorAction Stop
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'The approved Production pgpass path cannot contain a reparse point.'
    }
    $acl = Get-Acl -LiteralPath $securedPath
    if (-not $acl.AreAccessRulesProtected) {
      throw 'The approved Production pgpass path must have inheritance disabled.'
    }
    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
          $allowedSids -notcontains $rule.IdentityReference.Translate(
            [System.Security.Principal.SecurityIdentifier]
          ).Value) {
        throw 'The approved Production pgpass path grants access to an unapproved Windows identity.'
      }
    }
  }

  $entry = [System.IO.File]::ReadAllText($fullPath).TrimEnd("`r", "`n")
  $expectedEntry = '^aws-0-ap-northeast-2\.pooler\.supabase\.com:5432:postgres:postgres\.axbjzmdokfoftzfgwiql:(?:[^:\\\r\n]|\\[\\:])+$'
  if ($entry -notmatch $expectedEntry) {
    throw 'The approved Production pgpass file does not contain exactly the pinned connection entry.'
  }
}

function Enter-StagingPsqlEnvironment {
  param(
    [string]$PasswordFilePath = ''
  )

  $savedEnvironment = @{}
  $rootCertificate = Join-Path $env:APPDATA 'postgresql\root.crt'
  if (-not (Test-Path -LiteralPath $rootCertificate -PathType Leaf)) {
    throw "A trusted PostgreSQL root certificate is required at $rootCertificate."
  }
  if (-not [string]::IsNullOrWhiteSpace($PasswordFilePath)) {
    Assert-ProductionPsqlPasswordFile -Path $PasswordFilePath
  }

  $processEnvironment = [Environment]::GetEnvironmentVariables('Process')

  foreach ($name in @($processEnvironment.Keys)) {
    if ([string]$name -match '^PG[A-Z0-9_]*$') {
      $savedEnvironment[[string]$name] = $processEnvironment[$name]
      Remove-Item -LiteralPath "Env:\$name" -Force -ErrorAction Stop
    }
  }

  [Environment]::SetEnvironmentVariable('PGSSLMODE', 'verify-full', 'Process')
  [Environment]::SetEnvironmentVariable('PGSSLROOTCERT', $rootCertificate, 'Process')
  if (-not [string]::IsNullOrWhiteSpace($PasswordFilePath)) {
    [Environment]::SetEnvironmentVariable('PGPASSFILE', [System.IO.Path]::GetFullPath($PasswordFilePath), 'Process')
  }
  return $savedEnvironment
}

function Exit-StagingPsqlEnvironment {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$SavedEnvironment
  )

  $processEnvironment = [Environment]::GetEnvironmentVariables('Process')
  foreach ($name in @($processEnvironment.Keys)) {
    if ([string]$name -match '^PG[A-Z0-9_]*$') {
      Remove-Item -LiteralPath "Env:\$name" -Force -ErrorAction Stop
    }
  }

  foreach ($name in $SavedEnvironment.Keys) {
    [Environment]::SetEnvironmentVariable([string]$name, [string]$SavedEnvironment[$name], 'Process')
  }
}
