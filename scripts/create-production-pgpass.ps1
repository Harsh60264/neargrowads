[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$expectedPort = '5432'
$expectedDatabase = 'postgres'
$expectedUser = 'postgres.axbjzmdokfoftzfgwiql'
$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$directory = Join-Path $env:APPDATA 'NearGrowAds\pgpass'
$path = Join-Path $directory 'production.pgpass'
$rootCertificate = Join-Path $env:APPDATA 'postgresql\root.crt'
$psqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$allowedSids = @(
  $currentSid,
  [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
  [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
)
$securePassword = $null
$passwordBuffer = [IntPtr]::Zero
$passwordCharacters = $null
$escapedPasswordCharacters = $null
$entryCharacters = $null
$encodedEntry = $null
$createdFile = $false

function Set-RestrictedAcl {
  param(
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][bool]$IsDirectory
  )

  $acl = if ($IsDirectory) {
    [System.Security.AccessControl.DirectorySecurity]::new()
  } else {
    [System.Security.AccessControl.FileSecurity]::new()
  }
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($currentSid)
  $inheritance = if ($IsDirectory) {
    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  foreach ($sid in $allowedSids) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $TargetPath -AclObject $acl
}

function Assert-RestrictedAcl {
  param([Parameter(Mandatory = $true)][string]$TargetPath)

  $item = Get-Item -LiteralPath $TargetPath -Force -ErrorAction Stop
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The password file path cannot be a reparse point.'
  }
  $acl = Get-Acl -LiteralPath $TargetPath
  if (-not $acl.AreAccessRulesProtected) {
    throw 'The password file ACL must be protected from inherited access.'
  }
  foreach ($rule in $acl.Access) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $allowedSids -notcontains $rule.IdentityReference.Translate(
          [System.Security.Principal.SecurityIdentifier]
        ).Value) {
      throw 'The password file ACL contains an unapproved Windows identity.'
    }
  }
}

if ([string]::IsNullOrWhiteSpace($env:APPDATA) -or
    -not (Test-Path -LiteralPath $rootCertificate -PathType Leaf) -or
    -not (Test-Path -LiteralPath $psqlPath -PathType Leaf)) {
  throw 'The required local PostgreSQL 18 tools or Supabase TLS root certificate are missing.'
}
if (Test-Path -LiteralPath $directory) {
  $existingDirectory = Get-Item -LiteralPath $directory -Force
  if (($existingDirectory.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 -or
      @(Get-ChildItem -LiteralPath $directory -Force).Count -gt 0) {
    throw 'The dedicated password directory already exists and is not empty; it was not modified.'
  }
} else {
  New-Item -ItemType Directory -Path $directory -ErrorAction Stop | Out-Null
}
Set-RestrictedAcl -TargetPath $directory -IsDirectory $true
Assert-RestrictedAcl -TargetPath $directory
if (Test-Path -LiteralPath $path) {
  throw 'The pinned Production password file already exists; it was not overwritten.'
}

$securePassword = Read-Host `
  'Enter the existing Supabase Production database password (masked; it will not be echoed)' `
  -AsSecureString
if ($securePassword.Length -eq 0) {
  throw 'An empty database password was not saved.'
}

try {
  $passwordBuffer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $passwordCharacters = [char[]]::new($securePassword.Length)
  [System.Runtime.InteropServices.Marshal]::Copy(
    $passwordBuffer, $passwordCharacters, 0, $passwordCharacters.Length
  )
  if ($passwordCharacters -contains [char]13 -or
      $passwordCharacters -contains [char]10 -or
      $passwordCharacters -contains [char]0) {
    throw 'The supplied password cannot be represented in a pgpass entry.'
  }
  $escapedPasswordCharacters = [char[]]::new($passwordCharacters.Length * 2)
  $escapedLength = 0
  foreach ($character in $passwordCharacters) {
    if ($character -eq [char]92 -or $character -eq [char]58) {
      $escapedPasswordCharacters[$escapedLength] = [char]92
      $escapedLength++
    }
    $escapedPasswordCharacters[$escapedLength] = $character
    $escapedLength++
  }
  $entryPrefix = "$expectedHost`:$expectedPort`:$expectedDatabase`:$expectedUser`:"
  $lineEnding = [Environment]::NewLine
  $entryCharacters = [char[]]::new($entryPrefix.Length + $escapedLength + $lineEnding.Length)
  $entryPrefix.CopyTo(0, $entryCharacters, 0, $entryPrefix.Length)
  [Array]::Copy($escapedPasswordCharacters, 0, $entryCharacters, $entryPrefix.Length, $escapedLength)
  $lineEnding.CopyTo(0, $entryCharacters, $entryPrefix.Length + $escapedLength, $lineEnding.Length)

  $fileStream = [System.IO.File]::Open(
    $path,
    [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::None
  )
  $fileStream.Dispose()
  $createdFile = $true
  Set-RestrictedAcl -TargetPath $path -IsDirectory $false
  Assert-RestrictedAcl -TargetPath $path
  $encodedEntry = [System.Text.UTF8Encoding]::new($false).GetBytes($entryCharacters)
  [System.IO.File]::WriteAllBytes($path, $encodedEntry)
  Assert-RestrictedAcl -TargetPath $path

  [Environment]::SetEnvironmentVariable('PGPASSFILE', $path, 'Process')
  [Environment]::SetEnvironmentVariable('PGSSLMODE', 'verify-full', 'Process')
  [Environment]::SetEnvironmentVariable('PGSSLROOTCERT', $rootCertificate, 'Process')
  $probe = @(
    & $psqlPath '--no-psqlrc' '--no-password' '--no-align' '--tuples-only' `
      '--host' $expectedHost '--port' $expectedPort '--username' $expectedUser `
      '--dbname' $expectedDatabase '--command' @'
BEGIN READ ONLY;
SELECT current_database() = 'postgres'
  AND current_user = 'postgres'
  AND current_setting('transaction_read_only') = 'on'
  AND NOT pg_is_in_recovery();
ROLLBACK;
'@ 2>$null
  )
  if ($LASTEXITCODE -ne 0 -or $probe -notcontains 't') {
    throw 'The pinned read-only PostgreSQL connection failed; password details were not emitted.'
  }
  Write-Output 'Protected pgpass file ACL: PASS'
  Write-Output "Pinned Production TLS/read-only connection: PASS ($expectedProjectRef)"
  Write-Output 'The database password was not printed, logged, or included in process arguments.'
} catch {
  if ($createdFile -and (Test-Path -LiteralPath $path -PathType Leaf)) {
    Remove-Item -LiteralPath $path -Force
  }
  throw
} finally {
  if ($passwordCharacters) {
    [Array]::Clear($passwordCharacters, 0, $passwordCharacters.Length)
  }
  if ($escapedPasswordCharacters) {
    [Array]::Clear($escapedPasswordCharacters, 0, $escapedPasswordCharacters.Length)
  }
  if ($entryCharacters) {
    [Array]::Clear($entryCharacters, 0, $entryCharacters.Length)
  }
  if ($encodedEntry) {
    [Array]::Clear($encodedEntry, 0, $encodedEntry.Length)
  }
  $entryPrefix = $null
  $lineEnding = $null
  if ($passwordBuffer -ne [IntPtr]::Zero) {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBuffer)
  }
  if ($null -ne $securePassword) {
    $securePassword.Dispose()
  }
  [Environment]::SetEnvironmentVariable('PGPASSWORD', $null, 'Process')
}
