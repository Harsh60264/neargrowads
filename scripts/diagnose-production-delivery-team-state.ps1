[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef,
  [string]$BaselinePath = 'C:\Users\DELL\AppData\Local\NearGrowAds\ProductionBackups\partner-workspace-20261126T150626586Z\delivery-team-pre-migration-baseline.json',
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
$databaseHost = 'aws-0-ap-northeast-2.pooler.supabase.com'
$databasePort = '5432'
$databaseName = 'postgres'
$databaseUser = "postgres.$expectedProjectRef"

if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
  throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
}
if (-not (Test-Path -LiteralPath $BaselinePath -PathType Leaf)) {
  throw "The preserved read-only Production baseline was not found: $BaselinePath"
}
$versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
  throw 'PostgreSQL 18 psql is required.'
}

$baseline = Get-Content -LiteralPath $BaselinePath -Raw | ConvertFrom-Json
if ($baseline.projectRef -cne $expectedProjectRef -or
  $baseline.databaseName -cne 'postgres' -or
  [int]$baseline.coinLedgerConstraintCount -ne 2) {
  throw 'The preserved baseline does not match the pinned Production project and expected constraints.'
}

function Get-WithdrawalFunctionComparison {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Baseline,
    [AllowNull()]
    [object]$CurrentFunction
  )

  $normalizeSql = {
    param([string]$Value)
    if ($null -eq $Value) { return '' }
    return (($Value -replace "`r`n", ' ') -replace '\s+', ' ').Trim().ToLowerInvariant()
  }
  $baselineDefinition = & $normalizeSql ([string]$Baseline.withdrawalFunctionDefinition)
  $currentDefinition = if ($null -ne $CurrentFunction) {
    & $normalizeSql ([string]$CurrentFunction.definition)
  } else {
    ''
  }
  $baselineBalance = [regex]::Match(
    $baselineDefinition,
    "select coalesce\(sum\(amount\), 0\) into available_coins from public\.partner_coin_ledger where partner_profile_id = p_partner_profile_id and \(\(entry_type = 'earning' and status = 'approved'\) or \(entry_type = 'withdrawal' and status in \('requested', 'settled'\)\)\);"
  )
  $currentBalance = [regex]::Match(
    $currentDefinition,
    'available_coins := public\.delivery_team_available_coins\(p_partner_profile_id\);'
  )
  $expectedBody = $baselineBalance.Success -and $currentBalance.Success
  if ($expectedBody) {
    $baselineDefinition = $baselineDefinition.Replace(
      $baselineBalance.Value, 'available_coins := <ledger_balance>;'
    )
    $currentDefinition = $currentDefinition.Replace(
      $currentBalance.Value, 'available_coins := <ledger_balance>;'
    )
  }

  [object[]]$currentConfiguration = if ($null -ne $CurrentFunction) {
    @($CurrentFunction.config)
  } else {
    @()
  }
  [object[]]$baselineConfiguration = @($Baseline.withdrawalFunctionConfig)
  $configurationDifferences = @(
    if ($null -ne $CurrentFunction) {
      Compare-Object $currentConfiguration $baselineConfiguration
    } else {
      'Current withdrawal function is absent.'
    }
  )
  $metadataMatches = $null -ne $CurrentFunction -and
    [string]$CurrentFunction.owner -ceq [string]$Baseline.withdrawalFunctionOwner -and
    [string]$CurrentFunction.acl -ceq [string]$Baseline.withdrawalFunctionAcl -and
    [bool]$CurrentFunction.security_definer -eq [bool]$Baseline.withdrawalFunctionSecurityDefiner -and
    $configurationDifferences.Length -eq 0

  return [pscustomobject]@{
    MatchesBaseline = $metadataMatches -and
      $currentDefinition -ceq (& $normalizeSql ([string]$Baseline.withdrawalFunctionDefinition)) -and
      -not $currentBalance.Success
    MatchesExpectedMigration = $metadataMatches -and $expectedBody -and
      $currentDefinition -ceq $baselineDefinition
  }
}

function Get-ValidatedCatalogReport {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Output
  )

  $commandTagPattern = '^(?:BEGIN|COMMIT|ROLLBACK|SET(?:\s+\d+)?|DO)$'
  $payloadLineBuilder = [System.Collections.Generic.List[string]]::new()
  foreach ($line in $Output) {
    $trimmedLine = ([string]$line).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmedLine) -or $trimmedLine -match $commandTagPattern) {
      continue
    }
    $payloadLineBuilder.Add($trimmedLine)
  }
  [string[]]$payloadLines = @($payloadLineBuilder.ToArray())
  if ($payloadLines.Length -ne 1) {
    throw "Read-only catalog diagnostic expected one JSON payload after PostgreSQL command tags; received $($payloadLines.Length) non-tag output lines."
  }

  $jsonPayload = $payloadLines[0]
  $jsonDocument = $null
  $expectedCheckNames = @(
    'target', 'delivery_team_tables', 'audit_columns', 'private_rls_and_grants',
    'private_policies', 'settings_singleton', 'private_proofs_bucket', 'activity_indexes',
    'expected_coin_and_stock_constraints', 'unique_idempotency_indexes',
    'privileged_rpcs', 'migration_history_absent'
  )
  try {
    $jsonDocument = [System.Text.Json.JsonDocument]::Parse($jsonPayload)
    if ($jsonDocument.RootElement.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
      throw 'The JSON root must be an object.'
    }

    $jsonProperties = [System.Collections.Generic.Dictionary[string, System.Text.Json.JsonElement]]::new(
      [StringComparer]::Ordinal
    )
    $rootPropertyNames = [System.Collections.Generic.List[string]]::new()
    foreach ($property in $jsonDocument.RootElement.EnumerateObject()) {
      if ($jsonProperties.ContainsKey($property.Name)) {
        throw "JSON contains duplicate field $($property.Name)."
      }
      $jsonProperties[$property.Name] = $property.Value
      $rootPropertyNames.Add($property.Name)
    }
    $requiredProperties = @(
      'projectRef', 'databaseName', 'databaseUser', 'checks',
      'migrationSpecificObjectCount', 'withdrawalFunction', 'coinLedgerConstraints'
    )
    $rootPropertyDifferences = @(Compare-Object $requiredProperties @($rootPropertyNames.ToArray()))
    if ($rootPropertyDifferences.Length -gt 0) {
      throw 'JSON root did not contain exactly the expected fields.'
    }
    foreach ($propertyName in $requiredProperties) {
      if (-not $jsonProperties.ContainsKey($propertyName)) {
        throw "JSON omitted required field $propertyName."
      }
    }

    foreach ($propertyName in @('projectRef', 'databaseName', 'databaseUser')) {
      if ($jsonProperties[$propertyName].ValueKind -ne [System.Text.Json.JsonValueKind]::String) {
        throw "JSON field $propertyName must be a string."
      }
    }
    if ($jsonProperties['checks'].ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
      throw 'JSON checks field must be an object.'
    }
    if ($jsonProperties['coinLedgerConstraints'].ValueKind -ne [System.Text.Json.JsonValueKind]::Array) {
      throw 'JSON coinLedgerConstraints field must be an array.'
    }
    if ($jsonProperties['withdrawalFunction'].ValueKind -notin @(
      [System.Text.Json.JsonValueKind]::Null,
      [System.Text.Json.JsonValueKind]::Object
    )) {
      throw 'JSON withdrawalFunction field must be null or an object.'
    }
    if ($jsonProperties['migrationSpecificObjectCount'].ValueKind -ne [System.Text.Json.JsonValueKind]::Number) {
      throw 'JSON migrationSpecificObjectCount field must be an integer.'
    }
    $objectCount = 0L
    if (-not $jsonProperties['migrationSpecificObjectCount'].TryGetInt64([ref]$objectCount) -or $objectCount -lt 0) {
      throw 'JSON migrationSpecificObjectCount field must be a nonnegative integer.'
    }

    $actualCheckNames = [System.Collections.Generic.List[string]]::new()
    foreach ($checkProperty in $jsonProperties['checks'].EnumerateObject()) {
      if ($checkProperty.Value.ValueKind -notin @(
        [System.Text.Json.JsonValueKind]::True,
        [System.Text.Json.JsonValueKind]::False
      )) {
        throw "JSON check $($checkProperty.Name) must be a Boolean."
      }
      $actualCheckNames.Add($checkProperty.Name)
    }
    $checkNameDifference = @(Compare-Object $expectedCheckNames @($actualCheckNames))
    if ($checkNameDifference.Length -gt 0) {
      throw 'JSON checks field did not contain exactly the expected schema checks.'
    }
    foreach ($constraint in $jsonProperties['coinLedgerConstraints'].EnumerateArray()) {
      if ($constraint.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) {
        throw 'JSON coinLedgerConstraints entries must be objects.'
      }
      $constraintFields = [System.Collections.Generic.Dictionary[string, System.Text.Json.JsonElement]]::new(
        [StringComparer]::Ordinal
      )
      foreach ($property in $constraint.EnumerateObject()) {
        if ($constraintFields.ContainsKey($property.Name)) {
          throw "JSON constraint contains duplicate field $($property.Name)."
        }
        $constraintFields[$property.Name] = $property.Value
      }
      foreach ($fieldName in @('name', 'definition', 'validated', 'deferrable', 'initiallyDeferred')) {
        if (-not $constraintFields.ContainsKey($fieldName)) {
          throw "JSON constraint omitted required field $fieldName."
        }
      }
      if ($constraintFields['name'].ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $constraintFields['definition'].ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $constraintFields['validated'].ValueKind -notin @(
          [System.Text.Json.JsonValueKind]::True, [System.Text.Json.JsonValueKind]::False
        ) -or
        $constraintFields['deferrable'].ValueKind -notin @(
          [System.Text.Json.JsonValueKind]::True, [System.Text.Json.JsonValueKind]::False
        ) -or
        $constraintFields['initiallyDeferred'].ValueKind -notin @(
          [System.Text.Json.JsonValueKind]::True, [System.Text.Json.JsonValueKind]::False
        )) {
        throw 'JSON coinLedgerConstraints entry has invalid field types.'
      }
    }

    $withdrawalElement = $jsonProperties['withdrawalFunction']
    if ($withdrawalElement.ValueKind -eq [System.Text.Json.JsonValueKind]::Object) {
      $withdrawalFields = [System.Collections.Generic.Dictionary[string, System.Text.Json.JsonElement]]::new(
        [StringComparer]::Ordinal
      )
      foreach ($property in $withdrawalElement.EnumerateObject()) {
        if ($withdrawalFields.ContainsKey($property.Name)) {
          throw "JSON withdrawalFunction contains duplicate field $($property.Name)."
        }
        $withdrawalFields[$property.Name] = $property.Value
      }
      foreach ($fieldName in @('definition', 'acl', 'config', 'security_definer', 'owner')) {
        if (-not $withdrawalFields.ContainsKey($fieldName)) {
          throw "JSON withdrawalFunction omitted required field $fieldName."
        }
      }
      if ($withdrawalFields['definition'].ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $withdrawalFields['owner'].ValueKind -ne [System.Text.Json.JsonValueKind]::String -or
        $withdrawalFields['security_definer'].ValueKind -notin @(
          [System.Text.Json.JsonValueKind]::True, [System.Text.Json.JsonValueKind]::False
        ) -or
        $withdrawalFields['acl'].ValueKind -notin @(
          [System.Text.Json.JsonValueKind]::String, [System.Text.Json.JsonValueKind]::Null
        ) -or
        $withdrawalFields['config'].ValueKind -notin @(
          [System.Text.Json.JsonValueKind]::Array, [System.Text.Json.JsonValueKind]::Null
        )) {
        throw 'JSON withdrawalFunction has invalid field types.'
      }
    }
  } catch {
    throw 'Read-only catalog diagnostic returned malformed or non-object JSON; no output was accepted.'
  } finally {
    if ($null -ne $jsonDocument) {
      $jsonDocument.Dispose()
    }
  }

  try {
    $report = ConvertFrom-Json -InputObject $jsonPayload -ErrorAction Stop
  } catch {
    throw 'Read-only catalog diagnostic JSON could not be decoded; no output was accepted.'
  }
  if ($report.projectRef -cne 'axbjzmdokfoftzfgwiql' -or
    $report.databaseName -cne 'postgres' -or
    $report.databaseUser -cne 'postgres') {
    throw 'Read-only catalog diagnostic JSON failed strict target or shape validation.'
  }
  return $report
}

function Get-SafeCatalogPsqlFailureSummary {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ExitCode,
    [Parameter(Mandatory = $true)]
    [string[]]$Diagnostics
  )

  $diagnosticText = ($Diagnostics | ForEach-Object {
    if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ }
  }) -join "`n"
  $errorMatch = [regex]::Match(
    $diagnosticText,
    '(?im)\b(?:ERROR|FATAL):\s*(?:([0-9A-Z]{5}):\s*)?([^\r\n]*)'
  )
  $lineMatch = [regex]::Match(
    $diagnosticText,
    '(?im)^psql:[^\r\n]*?:(\d+):\s*(?:ERROR|FATAL):'
  )
  if (-not $errorMatch.Success) {
    return "Read-only catalog diagnostic failed (psql exit code $ExitCode); no PostgreSQL error line was available. Raw diagnostics and credentials were omitted."
  }

  $state = if ($errorMatch.Groups[1].Success) { $errorMatch.Groups[1].Value.ToUpperInvariant() } else { 'unavailable' }
  $message = $errorMatch.Groups[2].Value.Trim() `
    -replace '(?i)\b(?:postgres(?:ql)?|https?)://\S+', '[redacted]' `
    -replace '(?i)\b(password|secret|token|api[_-]?key|authorization|cookie)\s*[:=]\s*\S+', '$1=[redacted]' `
    -replace '(?i)\bBearer\s+\S+', 'Bearer [redacted]' `
    -replace '\b(?:eyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{10,}){1,2}|(?:sk|pk|sbp|ghp|gho|glpat|xox[baprs])_[A-Za-z0-9_-]{20,})\b', '[redacted-token]' `
    -replace '\s+', ' '
  if ($message.Length -gt 240) { $message = $message.Substring(0, 240) + '...' }
  $line = if ($lineMatch.Success) { $lineMatch.Groups[1].Value } else { 'unavailable' }
  return "Read-only catalog diagnostic failed (psql exit code $ExitCode, SQLSTATE $state, SQL input line $line): $message. Raw diagnostics and credentials were omitted."
}

function Get-DeliveryTeamMigrationClassification {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Report,
    [Parameter(Mandatory = $true)]
    [object]$Baseline
  )

  $withdrawalComparison = Get-WithdrawalFunctionComparison `
    -Baseline $Baseline -CurrentFunction $Report.withdrawalFunction
  $withdrawalMatchesBaseline = [bool]$withdrawalComparison.MatchesBaseline
  $withdrawalMatchesExpected = [bool]$withdrawalComparison.MatchesExpectedMigration

  $baselineConstraints = @($Baseline.coinLedgerConstraints | Sort-Object name)
  $currentConstraints = @($Report.coinLedgerConstraints | Sort-Object name)
  $baselineConstraintNames = @($baselineConstraints | ForEach-Object { [string]$_.name })
  $currentBaselineConstraints = @($currentConstraints | Where-Object {
    $baselineConstraintNames -contains [string]$_.name
  })
  $expectedBaselineDefinitions = @($baselineConstraints | ForEach-Object {
    "$($_.name)|$($_.definition)|$($_.validated)|$($_.deferrable)|$($_.initiallyDeferred)"
  })
  $actualBaselineDefinitions = @($currentBaselineConstraints | ForEach-Object {
    "$($_.name)|$($_.definition)|$($_.validated)|$($_.deferrable)|$($_.initiallyDeferred)"
  })
  $constraintDifferences = @(Compare-Object $expectedBaselineDefinitions $actualBaselineDefinitions)
  $baselineConstraintsMatch = $baselineConstraints.Length -eq 2 -and
    $currentBaselineConstraints.Length -eq 2 -and
    $constraintDifferences.Length -eq 0

  $checks = $Report.checks
  $checkProperties = @($checks.PSObject.Properties)
  $failedChecks = @($checkProperties | Where-Object { -not [bool]$_.Value })
  $allExpectedChecksPass = $failedChecks.Length -eq 0
  $migrationObjectCount = [long]$Report.migrationSpecificObjectCount

  if ($allExpectedChecksPass -and $withdrawalMatchesExpected) {
    $state = 'FULL'
    $coinConstraintComparison = 'Expected migration constraint shape is present; baseline constraints were intentionally replaced/extended by the pinned migration.'
  } elseif ([bool]$checks.target -and $migrationObjectCount -eq 0 -and
    $withdrawalMatchesBaseline -and $baselineConstraintsMatch) {
    $state = 'ABSENT'
    $coinConstraintComparison = 'Both coin-ledger constraints exactly match the preserved pre-migration baseline.'
  } else {
    $state = 'INCONSISTENT'
    $coinConstraintComparison = 'Current coin-ledger constraint definitions differ from both the preserved baseline and/or expected migration shape.'
  }

  return [pscustomobject]@{
    State = $state
    MigrationObjectCount = $migrationObjectCount
    WithdrawalMatchesBaseline = $withdrawalMatchesBaseline
    WithdrawalMatchesExpected = $withdrawalMatchesExpected
    BaselineConstraintsMatch = $baselineConstraintsMatch
    CoinConstraintComparison = $coinConstraintComparison
    Checks = $checks
    CurrentConstraints = @($currentConstraints)
  }
}

$sql = @'
BEGIN TRANSACTION READ ONLY;
SELECT to_regclass('public.delivery_team_settings') IS NOT NULL AS has_settings \gset
\if :has_settings
SELECT count(*) = 2 AND bool_and(
  (attname = 'id' AND atttypid = 'boolean'::regtype)
  OR (attname = 'low_stock_threshold' AND atttypid = 'integer'::regtype)
) AS has_settings_columns
FROM pg_attribute
WHERE attrelid = to_regclass('public.delivery_team_settings')
  AND attname IN ('id', 'low_stock_threshold')
  AND attnum > 0 AND NOT attisdropped \gset
\if :has_settings_columns
SELECT count(*) = 1 AND bool_and(id AND low_stock_threshold BETWEEN 1 AND 100000)
  AS settings_row_valid
FROM public.delivery_team_settings \gset
\else
\set settings_row_valid false
\endif
\else
\set settings_row_valid false
\endif
SELECT to_regclass('storage.buckets') IS NOT NULL AS has_storage_buckets \gset
\if :has_storage_buckets
SELECT count(*) = 2 AND bool_and(
  (attname = 'id' AND atttypid = 'text'::regtype)
  OR (attname = 'public' AND atttypid = 'boolean'::regtype)
) AS has_bucket_columns
FROM pg_attribute
WHERE attrelid = to_regclass('storage.buckets')
  AND attname IN ('id', 'public')
  AND attnum > 0 AND NOT attisdropped \gset
\if :has_bucket_columns
SELECT count(*) = 1 AND bool_and(public IS FALSE) AS proofs_bucket_private
FROM storage.buckets WHERE id = 'partner-proofs' \gset
\else
\set proofs_bucket_private false
\endif
\else
\set proofs_bucket_private false
\endif
WITH required_columns(table_name, column_name) AS (
  VALUES
    ('partner_coin_ledger', 'administrator_id'),
    ('partner_coin_ledger', 'admin_previous_balance'),
    ('partner_coin_ledger', 'admin_resulting_balance'),
    ('partner_coin_ledger', 'admin_reset'),
    ('partner_coin_ledger', 'idempotency_key'),
    ('partner_stock_movements', 'administrator_id'),
    ('partner_stock_movements', 'previous_balance'),
    ('partner_stock_movements', 'resulting_balance'),
    ('partner_stock_movements', 'idempotency_key'),
    ('partner_damage_reports', 'review_note')
),
required_functions(signature) AS (
  VALUES
    ('public.assert_delivery_team_admin(uuid,text)'),
    ('public.delivery_team_available_coins(uuid)'),
    ('public.get_partner_coin_summary(uuid)'),
    ('public.get_delivery_team_overview(uuid)'),
    ('public.get_delivery_team_partners(uuid,text,text,integer,integer)'),
    ('public.get_delivery_team_partner_detail(uuid,uuid)'),
    ('public.get_delivery_team_campaigns(uuid)'),
    ('public.admin_adjust_partner_coins(uuid,uuid,integer,text,uuid,boolean)'),
    ('public.admin_manage_partner_stock(uuid,uuid,uuid,text,integer,text,uuid)'),
    ('public.admin_create_partner_campaign_assignment(uuid,uuid,text,text,text,date,date,integer,integer,integer,jsonb)'),
    ('public.admin_update_partner_campaign_status(uuid,uuid,text)'),
    ('public.admin_set_delivery_team_low_stock_threshold(uuid,integer)'),
    ('public.admin_review_partner_proof(uuid,uuid,text,text)'),
    ('public.admin_review_partner_campaign_request(uuid,uuid,text,text,integer)'),
    ('public.admin_review_partner_damage_report(uuid,uuid,text,text)'),
    ('public.admin_review_partner_withdrawal(uuid,uuid,text,text,text,boolean)'),
    ('public.request_partner_withdrawal(uuid,integer)')
),
actual_functions AS (
  SELECT r.signature, p.oid, p.prosecdef, p.proconfig, p.proacl, p.proowner
  FROM required_functions r
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(r.signature)
),
checks(name, passed) AS (
  VALUES
    ('target', current_database() = 'postgres' AND current_user = 'postgres' AND NOT pg_is_in_recovery()),
    ('delivery_team_tables',
      (SELECT count(*) = 2 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('delivery_team_settings', 'delivery_team_activity')
         AND c.relkind = 'r')),
    ('audit_columns',
      (SELECT count(*) = 10
       FROM required_columns r
       JOIN pg_class c ON c.relname = r.table_name
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = r.column_name
         AND a.attnum > 0 AND NOT a.attisdropped)
       AND EXISTS (
         SELECT 1 FROM pg_attribute a
         WHERE a.attrelid = to_regclass('public.partner_coin_ledger')
           AND a.attname = 'admin_reset' AND a.attnotnull
           AND a.attnum > 0 AND NOT a.attisdropped
       )),
    ('private_rls_and_grants',
      (SELECT count(*) = 2 AND bool_and(c.relrowsecurity
          AND NOT EXISTS (
            SELECT 1 FROM (VALUES
              ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
              ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
            ) required_privileges(privilege_name)
            WHERE has_table_privilege('anon', c.oid, privilege_name)
              OR has_table_privilege('authenticated', c.oid, privilege_name)
          )
          AND NOT EXISTS (
            SELECT 1 FROM (VALUES
              ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
              ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
            ) required_privileges(privilege_name)
            WHERE NOT has_table_privilege('service_role', c.oid, privilege_name)
          )
          AND NOT EXISTS (
            SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
            WHERE acl.grantee = 0 AND acl.privilege_type IN (
              'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
            )
          ))
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('delivery_team_settings', 'delivery_team_activity'))),
    ('private_policies',
      (SELECT count(*) = 2 AND bool_and(
          pg_get_expr(p.polqual, p.polrelid) = 'false'
          AND pg_get_expr(p.polwithcheck, p.polrelid) = 'false')
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND ((c.relname = 'delivery_team_settings' AND p.polname = 'delivery_team_settings_no_direct_access')
           OR (c.relname = 'delivery_team_activity' AND p.polname = 'delivery_team_activity_no_direct_access')))),
    ('settings_singleton', :'settings_row_valid'::boolean),
    ('private_proofs_bucket', :'proofs_bucket_private'::boolean),
    ('activity_indexes',
      (SELECT count(*) = 2 AND bool_and(i.indisvalid)
       FROM pg_index i
       JOIN pg_class x ON x.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = x.relnamespace
       WHERE n.nspname = 'public'
         AND x.relname IN ('delivery_team_activity_recent', 'delivery_team_activity_partner_recent'))),
    ('expected_coin_and_stock_constraints',
      ((SELECT count(*) = 3 AND bool_and(convalidated)
       FROM pg_constraint
       WHERE conrelid = to_regclass('public.partner_coin_ledger')
         AND conname IN ('partner_coin_ledger_entry_integrity_check',
         'partner_coin_ledger_admin_balance_check', 'partner_coin_ledger_admin_reset_check'))
       AND (SELECT count(*) = 1 AND bool_and(convalidated)
        FROM pg_constraint
        WHERE conrelid = to_regclass('public.partner_stock_movements')
          AND conname = 'partner_stock_movements_admin_balance_check')
       AND EXISTS (SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('public.partner_coin_ledger')
           AND conname = 'partner_coin_ledger_entry_type_check'
           AND pg_get_constraintdef(oid) LIKE '%adjustment%')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint
         WHERE conrelid = to_regclass('public.partner_coin_ledger')
           AND conname = 'partner_coin_ledger_check'))),
    ('unique_idempotency_indexes',
      (SELECT count(*) = 2 AND bool_and(i.indisunique AND i.indisvalid AND i.indpred IS NOT NULL)
       FROM pg_index i
       JOIN pg_class x ON x.oid = i.indexrelid
       JOIN pg_namespace n ON n.oid = x.relnamespace
       WHERE n.nspname = 'public'
         AND x.relname IN ('partner_coin_ledger_idempotency_unique', 'partner_stock_movements_idempotency_unique'))),
    ('privileged_rpcs',
      (SELECT count(*) = 17 AND bool_and(
          f.oid IS NOT NULL AND f.prosecdef
          AND f.proconfig @> ARRAY['search_path=pg_catalog, public']
          AND has_function_privilege('service_role', f.oid, 'EXECUTE')
          AND NOT has_function_privilege('anon', f.oid, 'EXECUTE')
          AND NOT has_function_privilege('authenticated', f.oid, 'EXECUTE')
          AND NOT EXISTS (
            SELECT 1 FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) acl
            WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
          ))
       FROM actual_functions f)),
    ('migration_history_absent', to_regnamespace('supabase_migrations') IS NULL)
),
object_count AS (
  SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname IN ('delivery_team_settings', 'delivery_team_activity')
       AND c.relkind = 'r')
    + (SELECT count(*) FROM required_columns r
       JOIN pg_class c ON c.relname = r.table_name
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = r.column_name
         AND a.attnum > 0 AND NOT a.attisdropped)
    + (SELECT count(*) FROM pg_constraint
       WHERE conrelid IN (
         to_regclass('public.partner_coin_ledger'),
         to_regclass('public.partner_stock_movements')
       )
         AND conname IN ('partner_coin_ledger_entry_integrity_check',
         'partner_coin_ledger_admin_balance_check', 'partner_coin_ledger_admin_reset_check',
         'partner_stock_movements_admin_balance_check'))
    + (SELECT count(*) FROM pg_class x JOIN pg_namespace n ON n.oid = x.relnamespace
       WHERE n.nspname = 'public'
         AND x.relname IN ('partner_coin_ledger_idempotency_unique', 'partner_stock_movements_idempotency_unique')
         AND x.relkind = 'i')
    + (SELECT count(*) FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND p.polname IN (
         'delivery_team_settings_no_direct_access', 'delivery_team_activity_no_direct_access'))
    + (SELECT count(*) FROM pg_class x JOIN pg_namespace n ON n.oid = x.relnamespace
       WHERE n.nspname = 'public'
         AND x.relname IN ('delivery_team_activity_recent', 'delivery_team_activity_partner_recent')
         AND x.relkind = 'i')
    + (SELECT count(*) FROM actual_functions
       WHERE oid IS NOT NULL
         AND signature NOT IN (
           'public.delivery_team_available_coins(uuid)',
           'public.get_partner_coin_summary(uuid)',
           'public.request_partner_withdrawal(uuid,integer)'
         )) AS count
),
withdrawal AS (
  SELECT p.oid, pg_get_functiondef(p.oid) AS definition,
    p.proacl::text AS acl, p.proconfig AS config, p.prosecdef AS security_definer,
    r.rolname AS owner
  FROM pg_proc p
  LEFT JOIN pg_roles r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure('public.request_partner_withdrawal(uuid,integer)')
),
ledger_constraints AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name', conname,
    'definition', pg_get_constraintdef(oid, true),
    'validated', convalidated,
    'deferrable', condeferrable,
    'initiallyDeferred', condeferred
  ) ORDER BY conname), '[]'::jsonb) AS definitions
  FROM pg_constraint
  WHERE conrelid = to_regclass('public.partner_coin_ledger')
)
SELECT jsonb_build_object(
  'projectRef', 'axbjzmdokfoftzfgwiql',
  'databaseName', current_database(),
  'databaseUser', current_user,
  'checks', (SELECT jsonb_object_agg(name, passed ORDER BY name) FROM checks),
  'migrationSpecificObjectCount', (SELECT count FROM object_count),
  'withdrawalFunction', (SELECT to_jsonb(withdrawal) - 'oid' FROM withdrawal),
  'coinLedgerConstraints', (SELECT definitions FROM ledger_constraints)
)::text;
ROLLBACK;
'@

$temporarySqlPath = Join-Path $env:TEMP ("neargrow-delivery-team-diagnose-" + [guid]::NewGuid().ToString('N') + '.sql')
$temporaryOutputPath = Join-Path $env:TEMP ("neargrow-delivery-team-diagnose-" + [guid]::NewGuid().ToString('N') + '.json')
$environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
  throw 'The PostgreSQL TLS environment helper is missing.'
}
. $environmentHelper
$savedEnvironment = $null
try {
  [System.IO.File]::WriteAllText($temporarySqlPath, $sql, [System.Text.UTF8Encoding]::new($false))
  $savedEnvironment = Enter-StagingPsqlEnvironment
  $arguments = @(
    '--no-psqlrc', '--host', $databaseHost, '--port', $databasePort,
    '--username', $databaseUser, '--dbname', $databaseName, '--password',
    '--set', 'ON_ERROR_STOP=1', '--set', 'VERBOSITY=verbose',
    '--quiet', '--no-align', '--tuples-only',
    '--output', $temporaryOutputPath, '--file', $temporarySqlPath
  )
  $diagnostics = @(& $PsqlPath @arguments 2>&1)
  $exitCode = $LASTEXITCODE
  $postgresErrorLines = @($diagnostics | Where-Object {
    ([string]$_) -match '(?im)\b(?:ERROR|FATAL):'
  })
  $hasPostgresError = $postgresErrorLines.Length -gt 0
  if ($exitCode -ne 0 -or $hasPostgresError -or
    -not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
    throw (Get-SafeCatalogPsqlFailureSummary -ExitCode $exitCode -Diagnostics $diagnostics)
  }

  $psqlOutput = @(Get-Content -LiteralPath $temporaryOutputPath -ErrorAction Stop)
  $report = Get-ValidatedCatalogReport -Output $psqlOutput
  $classification = Get-DeliveryTeamMigrationClassification -Report $report -Baseline $baseline
  $migrationState = [string]$classification.State
  $migrationObjectCount = [long]$classification.MigrationObjectCount
  $currentConstraints = @($classification.CurrentConstraints)
  $checks = $classification.Checks

  Write-Output "MIGRATION_STATE|$migrationState"
  Write-Output "Migration-specific catalog object count: $migrationObjectCount"
  Write-Output "Withdrawal function matches preserved baseline: $($classification.WithdrawalMatchesBaseline)"
  Write-Output "Withdrawal function matches expected migration-only balance change: $($classification.WithdrawalMatchesExpected)"
  Write-Output "Baseline coin-ledger constraints unchanged: $($classification.BaselineConstraintsMatch)"
  Write-Output "Coin-ledger comparison: $($classification.CoinConstraintComparison)"
  foreach ($property in ($checks.PSObject.Properties | Sort-Object Name)) {
    $status = if ([bool]$property.Value) { 'PASS' } else { 'FAIL' }
    Write-Output "$($property.Name)|$status"
  }
  Write-Output 'Current coin-ledger constraints:'
  foreach ($constraint in $currentConstraints) {
    Write-Output "  $($constraint.name): $($constraint.definition) (validated=$($constraint.validated))"
  }
  Write-Output 'This diagnostic used catalog metadata in a READ ONLY transaction; it did not inspect partner records or write Production data.'

  if ($migrationState -eq 'FULL') {
    $verifierPath = Join-Path $PSScriptRoot 'verify-production-delivery-team-post-migration.ps1'
    if (-not (Test-Path -LiteralPath $verifierPath -PathType Leaf)) {
      throw 'The catalog diagnostic found the complete migration shape, but the independent post-verifier is missing.'
    }
    Write-Output 'Catalog state is complete. Running the corrected independent read-only post-verifier; enter the masked database password when prompted.'
    $powerShell = (Get-Command pwsh -ErrorAction Stop).Source
    & $powerShell -NoProfile -File $verifierPath -ProjectRef $expectedProjectRef -PsqlPath $PsqlPath
    if ($LASTEXITCODE -ne 0) {
      throw "The independent read-only post-verifier failed with exit code $LASTEXITCODE; no migration retry or deployment was attempted."
    }
  }
} finally {
  if ($null -ne $savedEnvironment) {
    Exit-StagingPsqlEnvironment -SavedEnvironment $savedEnvironment
  }
  foreach ($temporaryPath in @($temporarySqlPath, $temporaryOutputPath)) {
    if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
  }
}
