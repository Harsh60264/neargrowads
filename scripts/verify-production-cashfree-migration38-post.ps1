[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [Parameter(Mandatory = $true)]
  [ValidateRange(0, [long]::MaxValue)]
  [long]$ExpectedRazorpayOrderCount,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{32}$')]
  [string]$ExpectedRazorpayOrderFingerprint,
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
if ($ProjectRef -cne 'axbjzmdokfoftzfgwiql') {
  throw 'ProjectRef must exactly match the pinned Production project ref axbjzmdokfoftzfgwiql.'
}
$verifierPath = Join-Path $PSScriptRoot 'verify-production-cashfree-preflight.ps1'
if (-not (Test-Path -LiteralPath $verifierPath -PathType Leaf)) {
  throw 'The reviewed read-only Production schema verifier is missing.'
}
$powerShell = (Get-Command pwsh -ErrorAction Stop).Source
& $powerShell -NoProfile -File $verifierPath `
  -ProjectRef $ProjectRef `
  -PsqlPath $PsqlPath `
  -SchemaEvidenceOnly `
  -PostMigration38 `
  -ExpectedRazorpayOrderCount $ExpectedRazorpayOrderCount `
  -ExpectedRazorpayOrderFingerprint $ExpectedRazorpayOrderFingerprint
exit $LASTEXITCODE
