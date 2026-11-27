function Assert-ApprovedHistoryFallbackEvidence {
  param(
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [Parameter(Mandatory = $true)][string]$BaselinePath,
    [Parameter(Mandatory = $true)][pscustomobject]$Baseline,
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [Parameter(Mandatory = $true)][pscustomobject]$BackupEvidence,
    [Parameter(Mandatory = $true)][string]$ProjectRef,
    [Parameter(Mandatory = $true)][string]$MigrationVersion,
    [Parameter(Mandatory = $true)][string]$MigrationFile,
    [Parameter(Mandatory = $true)][string]$MigrationHash,
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$ReconstructionImage,
    [Parameter(Mandatory = $true)][string[]]$ReconstructionMigrations
  )

  if ([string]::IsNullOrWhiteSpace($EvidencePath) -or
    -not (Test-Path -LiteralPath $EvidencePath -PathType Leaf)) {
    throw 'The approved migration-history fallback comparison evidence is missing.'
  }
  $fullEvidencePath = [System.IO.Path]::GetFullPath($EvidencePath)
  $repoPrefix = $RepositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if ($fullEvidencePath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'History fallback evidence must be stored outside the Git repository.'
  }
  $evidenceItem = Get-Item -LiteralPath $fullEvidencePath -Force
  if (($evidenceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'History fallback evidence cannot be a reparse point.'
  }
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
  foreach ($securedPath in @([System.IO.Path]::GetDirectoryName($fullEvidencePath), $fullEvidencePath)) {
    $acl = Get-Acl -LiteralPath $securedPath
    if (-not $acl.AreAccessRulesProtected) {
      throw 'History fallback evidence path ACL inheritance must be disabled.'
    }
    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $allowedSids -notcontains $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) {
        throw 'History fallback evidence is accessible to an unapproved Windows identity.'
      }
    }
  }

  $evidence = Get-Content -LiteralPath $fullEvidencePath -Raw | ConvertFrom-Json -Depth 20 -DateKind String
  $baselineFullPath = [System.IO.Path]::GetFullPath($BaselinePath)
  $backupFullPath = [System.IO.Path]::GetFullPath($BackupPath)
  if (-not (Test-Path -LiteralPath $baselineFullPath -PathType Leaf)) {
    throw 'The current protected Production baseline is missing.'
  }
  $comparisonBaselinePath = [System.IO.Path]::GetFullPath([string]$evidence.baselinePath)
  if (-not (Test-Path -LiteralPath $comparisonBaselinePath -PathType Leaf) -or
    $comparisonBaselinePath.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The baseline used for fallback comparison is missing or stored inside the repository.'
  }
  $comparisonBaselineItem = Get-Item -LiteralPath $comparisonBaselinePath -Force
  if (($comparisonBaselineItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The baseline used for fallback comparison cannot be a reparse point.'
  }
  $comparisonBaselineAcl = Get-Acl -LiteralPath $comparisonBaselinePath
  if (-not $comparisonBaselineAcl.AreAccessRulesProtected) {
    throw 'The baseline used for fallback comparison must have protected ACLs.'
  }
  foreach ($rule in $comparisonBaselineAcl.Access) {
    if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
      $allowedSids -notcontains $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value) {
      throw 'The baseline used for fallback comparison is accessible to an unapproved Windows identity.'
    }
  }
  $comparisonBaseline = Get-Content -LiteralPath $comparisonBaselinePath -Raw | ConvertFrom-Json -Depth 40 -DateKind String
  $comparisonBaselineHash = (Get-FileHash -LiteralPath $comparisonBaselinePath -Algorithm SHA256).Hash
  $comparisonSchemaHash = Get-CanonicalSchemaFingerprint -Report $comparisonBaseline
  $schemaHash = Get-CanonicalSchemaFingerprint -Report $Baseline
  $capturedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse(
      [string]$evidence.capturedAtUtc,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal,
      [ref]$capturedAt
    ) -or $capturedAt -gt [DateTimeOffset]::UtcNow -or
    $capturedAt -lt [DateTimeOffset]::UtcNow.AddHours(-4)) {
    throw 'History fallback evidence must be no more than four hours old.'
  }
  if ($Baseline.history.state -cne 'UNAVAILABLE' -or
    @($Baseline.history.candidates).Count -ne 0 -or
    @($Baseline.history.versions).Count -ne 0 -or
    $comparisonBaseline.history.state -cne 'UNAVAILABLE' -or
    @($comparisonBaseline.history.candidates).Count -ne 0 -or
    $comparisonBaseline.projectRef -cne $ProjectRef -or
    $comparisonBaseline.migrationVersion -cne $MigrationVersion -or
    $comparisonBaseline.migrationSha256 -cne $MigrationHash -or
    $evidence.formatVersion -ne 1 -or
    $evidence.projectRef -cne $ProjectRef -or
    $evidence.migrationVersion -cne $MigrationVersion -or
    $evidence.migrationFile -cne $MigrationFile -or
    $evidence.migrationSha256 -cne $MigrationHash -or
    $evidence.baselineSha256 -cne $comparisonBaselineHash -or
    [System.IO.Path]::GetFullPath([string]$evidence.backupEvidencePath) -cne $backupFullPath -or
    $evidence.backupSha256 -cne [string]$BackupEvidence.sha256 -or
    $evidence.history.state -cne 'UNAVAILABLE' -or
    [int]$evidence.history.candidateCount -ne 0 -or
    $evidence.schemaComparison.result -cne 'PASS' -or
    $evidence.schemaComparison.productionFingerprint -cne $comparisonSchemaHash -or
    $evidence.schemaComparison.productionFingerprint -cne $schemaHash -or
    $evidence.schemaComparison.reconstructionFingerprint -cne $schemaHash -or
    $evidence.reconstruction.image -cne $ReconstructionImage -or
    $evidence.reconstruction.networkMode -cne 'none' -or
    $evidence.reconstruction.repositoryMountedReadOnly -ne $true -or
    $evidence.reconstruction.productionArchiveMounted -ne $false -or
    $evidence.reconstruction.productionDataUsed -ne $false -or
    [int]$evidence.reconstruction.partnerRows -ne 0 -or
    [int]$evidence.reconstruction.campaignRows -ne 0 -or
    [int]$evidence.reconstruction.assignmentRows -ne 0 -or
    [int]$evidence.reconstruction.requestRows -ne 0 -or
    [int]$evidence.reconstruction.proofRows -ne 0 -or
    [int]$evidence.reconstruction.damageReportRows -ne 0 -or
    [int]$evidence.reconstruction.coinLedgerRows -ne 0 -or
    [int]$evidence.reconstruction.stockMovementRows -ne 0 -or
    [int]$evidence.reconstruction.withdrawalRows -ne 0) {
    throw 'History fallback evidence does not match the pinned Production baseline, backup, migration, or isolated reconstruction.'
  }

  $expectedCounts = @{
    relations = @($Baseline.relations).Count
    columns = @($Baseline.columns).Count
    constraints = @($Baseline.constraints).Count
    indexes = @($Baseline.indexes).Count
    triggers = @($Baseline.triggers).Count
    policies = @($Baseline.policies).Count
    existingFunctions = @($Baseline.functions | Where-Object { -not $_.isNew }).Count
    tableGrants = @($Baseline.tableGrants).Count
  }
  foreach ($name in $expectedCounts.Keys) {
    if ([int]$evidence.schemaComparison.counts.$name -ne [int]$expectedCounts[$name]) {
      throw "History fallback schema comparison count does not match the protected baseline: $name."
    }
  }
  foreach ($version in $ReconstructionMigrations) {
    $migrationPath = Join-Path $RepositoryRoot "supabase\migrations\$version`_*.sql"
    $matches = @(Get-ChildItem -Path $migrationPath -File)
    if ($matches.Count -ne 1) {
      throw "Expected one checked-in prerequisite migration for history fallback replay: $version."
    }
    $actualHash = (Get-FileHash -LiteralPath $matches[0].FullName -Algorithm SHA256).Hash
    $recorded = @($evidence.reconstruction.migrations | Where-Object { $_.version -ceq $version })
    if ($recorded.Count -ne 1 -or $recorded[0].sha256 -cne $actualHash) {
      throw "History fallback evidence does not pin checked-in prerequisite migration $version."
    }
  }
}
