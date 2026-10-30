function Enter-StagingPsqlEnvironment {
  $savedEnvironment = @{}
  $rootCertificate = Join-Path $env:APPDATA 'postgresql\root.crt'
  if (-not (Test-Path -LiteralPath $rootCertificate -PathType Leaf)) {
    throw "A trusted PostgreSQL root certificate is required at $rootCertificate."
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
