function Get-CanonicalSchemaFingerprint {
  param([Parameter(Mandatory = $true)][pscustomobject]$Report)

  $schema = [ordered]@{
    relations = @($Report.relations | Sort-Object -Property name | ForEach-Object {
      [ordered]@{ name = $_.name; exists = $_.exists; rls = $_.rls; forceRls = $_.forceRls }
    })
    columns = @($Report.columns | Sort-Object -Property table, name | ForEach-Object {
      [ordered]@{ table = $_.table; name = $_.name; type = $_.type; notNull = $_.notNull; default = $_.default }
    })
    constraints = @($Report.constraints | Sort-Object -Property table, name | ForEach-Object {
      $definition = [regex]::Replace([string]$_.definition, '(?i)\bREFERENCES\s+users\(', 'REFERENCES auth.users(')
      [ordered]@{
        table = $_.table; name = $_.name; type = $_.type; definition = $definition
        validated = $_.validated; deferrable = $_.deferrable
      }
    })
    indexes = @($Report.indexes | Sort-Object -Property table, name | ForEach-Object {
      [ordered]@{ table = $_.table; name = $_.name; unique = $_.unique; valid = $_.valid; definition = $_.definition }
    })
    triggers = @($Report.triggers | Sort-Object -Property table, name | ForEach-Object {
      [ordered]@{ table = $_.table; name = $_.name; enabled = $_.enabled; definition = $_.definition }
    })
    policies = @($Report.policies | Sort-Object -Property table, name | ForEach-Object {
      [ordered]@{
        table = $_.table; name = $_.name; command = $_.command
        roles = @($_.roles | Sort-Object -CaseSensitive)
        using = $_.using; check = $_.check
      }
    })
    functions = @($Report.functions | Where-Object { -not $_.isNew } | Sort-Object -Property signature | ForEach-Object {
      [ordered]@{
        signature = $_.signature; exists = $_.exists; securityDefiner = $_.securityDefiner
        config = @($_.config | Sort-Object -CaseSensitive); definitionMd5 = $_.definitionMd5
        serviceRoleExecute = $_.serviceRoleExecute; anonExecute = $_.anonExecute
        authenticatedExecute = $_.authenticatedExecute
      }
    })
    tableGrants = @($Report.tableGrants | Sort-Object -Property table, role, privilege | ForEach-Object {
      [ordered]@{ table = $_.table; role = $_.role; privilege = $_.privilege; granted = $_.granted }
    })
  }
  $canonicalJson = ConvertTo-Json -InputObject $schema -Depth 40 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($canonicalJson)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return [Convert]::ToHexString($sha256.ComputeHash($bytes))
  } finally {
    $sha256.Dispose()
  }
}
