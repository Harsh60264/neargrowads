[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}

$verifierPath = Join-Path $PSScriptRoot 'verify-production-partner-schema.ps1'
if (-not (Test-Path -LiteralPath $verifierPath -PathType Leaf)) {
  throw 'The independent read-only partner schema verifier is missing.'
}
$powerShell = (Get-Command pwsh -ErrorAction Stop).Source
& $powerShell -NoProfile -File $verifierPath `
  -ProjectRef $expectedProjectRef `
  -PsqlPath $PsqlPath `
  -SchemaEvidenceOnly `
  -PostMigration
if ($LASTEXITCODE -ne 0) {
  throw 'Independent read-only partner post-migration schema verification failed.'
}
