[CmdletBinding()]
param(
  [string]$ProjectRef = 'axbjzmdokfoftzfgwiql',
  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe',
  [switch]$SchemaEvidenceOnly,
  [switch]$PostMigration
)

$ErrorActionPreference = 'Stop'
$expectedProjectRef = 'axbjzmdokfoftzfgwiql'
if ($ProjectRef -cne $expectedProjectRef) {
  throw "ProjectRef must exactly match the pinned Production project ref $expectedProjectRef."
}
if ($PostMigration -and -not $SchemaEvidenceOnly) {
  throw '-PostMigration requires -SchemaEvidenceOnly.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationDirectory = Join-Path $repoRoot 'supabase\migrations'
$migrationFiles = @(
  '20261123120000_partner_identity_isolation.sql',
  '20261126120000_create_partner_workspace.sql'
)
foreach ($migrationFile in $migrationFiles) {
  $migrationPath = Join-Path $migrationDirectory $migrationFile
  if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
    throw "Required partner migration file is missing: $migrationPath"
  }
}

. (Join-Path $PSScriptRoot 'productionAdminDeletionCheck.Common.ps1')
Confirm-ProductionAdminDeletionDatabase -ProjectRef $ProjectRef

$sql = @'
BEGIN TRANSACTION READ ONLY;

SELECT (
  current_database() = 'postgres'
  AND current_user = 'postgres'
  AND current_setting('transaction_read_only') = 'on'
  AND NOT pg_is_in_recovery()
  AND to_regclass('auth.users') IS NOT NULL
) AS target_ok \gset

SELECT 'TARGET|' ||
  CASE WHEN :'target_ok'::boolean THEN 'PASS' ELSE 'FAIL' END ||
  '|database=' || current_database() ||
  '|role=' || current_user ||
  '|read_only=' || current_setting('transaction_read_only') ||
  '|primary=' || (NOT pg_is_in_recovery())::text;

\if :target_ok
SELECT 'LEDGER|' ||
  (to_regnamespace('supabase_migrations') IS NOT NULL)::text || '|' ||
  (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)::text;

SELECT (to_regclass('supabase_migrations.schema_migrations') IS NOT NULL) AS migration_ledger_ready \gset
\if :migration_ledger_ready
SELECT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations
  WHERE version = '20261126120000'
) AS partner_workspace_migration_applied \gset
SELECT 'MIGRATION|20261126120000|' || (:'partner_workspace_migration_applied'::boolean)::text;
\else
SELECT 'MIGRATION|20261126120000|unknown';
\endif

SELECT 'ALTLEDGER|' || n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN (
    'pg_catalog', 'information_schema', 'auth', 'storage',
    'realtime', 'vault', 'extensions'
  )
  AND (
    c.relname ILIKE '%migrat%'
    OR c.relname ILIKE '%schema_history%'
    OR c.relname ILIKE '%version%'
  )
ORDER BY 1;

SELECT 'REL|' || n.nspname || '.' || c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND (
    (n.nspname = 'public' AND c.relname IN (
      'partner_profiles', 'partner_sessions',
      'partner_email_verification_sends', 'admin_users'
    ))
    OR (n.nspname = 'auth' AND c.relname = 'users')
  )
ORDER BY 1;

SELECT 'COL|' || n.nspname || '.' || c.relname || '.' || a.attname ||
  '|' || format_type(a.atttypid, a.atttypmod) ||
  '|' || a.attnotnull::text ||
  '|' || (d.adbin IS NOT NULL)::text ||
  '|' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef d
  ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE a.attnum > 0
  AND NOT a.attisdropped
  AND (
    (n.nspname = 'public' AND c.relname IN (
      'partner_profiles', 'partner_sessions',
      'partner_email_verification_sends', 'admin_users'
    ))
    OR (n.nspname = 'auth' AND c.relname = 'users')
  )
ORDER BY 1;

SELECT 'CON|' || n.nspname || '.' || c.relname ||
  '|' || con.conname ||
  '|' || con.contype::text ||
  '|' || con.convalidated::text ||
  '|' || pg_get_constraintdef(con.oid)
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (
    n.nspname = 'public' AND c.relname IN (
      'partner_profiles', 'partner_sessions',
      'partner_email_verification_sends', 'admin_users'
    )
  )
  OR (n.nspname = 'auth' AND c.relname = 'users')
ORDER BY 1;

SELECT 'FK|' || n.nspname || '.' || c.relname ||
  '|' || con.conname ||
  '|' || (
    SELECT string_agg(source_attribute.attname, ',' ORDER BY source_key.ordinality)
    FROM unnest(con.conkey) WITH ORDINALITY AS source_key(attnum, ordinality)
    JOIN pg_attribute source_attribute
      ON source_attribute.attrelid = con.conrelid
      AND source_attribute.attnum = source_key.attnum
  ) ||
  '|' || referenced_namespace.nspname || '.' || referenced_table.relname ||
  '|' || (
    SELECT string_agg(referenced_attribute.attname, ',' ORDER BY referenced_key.ordinality)
    FROM unnest(con.confkey) WITH ORDINALITY AS referenced_key(attnum, ordinality)
    JOIN pg_attribute referenced_attribute
      ON referenced_attribute.attrelid = con.confrelid
      AND referenced_attribute.attnum = referenced_key.attnum
  ) ||
  '|' || con.confdeltype::text ||
  '|' || con.convalidated::text
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_class referenced_table ON referenced_table.oid = con.confrelid
JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_table.relnamespace
WHERE con.contype = 'f'
  AND n.nspname = 'public'
  AND c.relname = 'partner_sessions'
ORDER BY 1;

SELECT 'IDX|' || n.nspname || '.' || t.relname ||
  '|' || i.relname ||
  '|' || ix.indisunique::text ||
  '|' || ix.indisvalid::text ||
  '|' || pg_get_indexdef(ix.indexrelid) ||
  '|' || COALESCE(pg_get_expr(ix.indpred, ix.indrelid), '')
FROM pg_index ix
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_class i ON i.oid = ix.indexrelid
WHERE (
    n.nspname = 'public' AND t.relname IN (
      'partner_profiles', 'partner_sessions',
      'partner_email_verification_sends', 'admin_users'
    )
  )
  OR (n.nspname = 'auth' AND t.relname = 'users')
ORDER BY 1;

SELECT 'RLS|' || n.nspname || '.' || c.relname ||
  '|' || c.relrowsecurity::text ||
  '|' || c.relforcerowsecurity::text
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE (
    n.nspname = 'public' AND c.relname IN (
      'partner_profiles', 'partner_sessions',
      'partner_email_verification_sends', 'admin_users'
    )
  )
  OR (n.nspname = 'auth' AND c.relname = 'users')
ORDER BY 1;

SELECT 'POL|' || n.nspname || '.' || c.relname ||
  '|' || p.polname ||
  '|' || p.polcmd::text ||
  '|' || COALESCE(pg_get_expr(p.polqual, p.polrelid), '') ||
  '|' || COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') ||
  '|' || array_to_string(ARRAY(
    SELECT CASE
      WHEN role_id = 0 THEN 'PUBLIC'
      ELSE COALESCE(pg_get_userbyid(role_id), '?')
    END
    FROM unnest(p.polroles) AS role_row(role_id)
  ), ',')
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'partner_profiles', 'partner_sessions',
    'partner_email_verification_sends'
  )
ORDER BY 1;

SELECT 'TRG|' || n.nspname || '.' || c.relname ||
  '|' || t.tgname ||
  '|' || t.tgenabled::text ||
  '|' || pg_get_triggerdef(t.oid)
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND (
    (n.nspname = 'public' AND c.relname IN (
      'partner_profiles', 'partner_sessions',
      'partner_email_verification_sends'
    ))
    OR (n.nspname = 'auth' AND c.relname = 'users')
  )
ORDER BY 1;

SELECT 'FUNC|' || p.proname ||
  '|' || p.prosecdef::text ||
  '|' || COALESCE(array_to_string(p.proconfig, ','), '') ||
  '|' || (
    p.prosrc ILIKE '%from public.admin_users%'
    AND p.prosrc ILIKE '%where id = new.id%'
  )::text ||
  '|' || (
    p.prosrc ILIKE '%lower(email) = lower(new.email)%'
  )::text ||
  '|' || (
    p.prosrc ILIKE '%new.auth_provider%'
    AND p.prosrc ILIKE '%new.auth_subject%'
  )::text ||
  '|' || (p.prosrc ILIKE '%provider subject is required%')::text ||
  '|' || (
    p.prosrc ILIKE '%auth_provider = ''supabase''%'
    AND p.prosrc ILIKE '%auth_subject = old.id::text%'
  )::text ||
  '|' || (
    p.prosrc ILIKE '%p_cooldown_seconds < 1%'
    AND p.prosrc ILIKE '%p_cooldown_seconds > 86400%'
    AND p.prosrc ILIKE '%make_interval%'
    AND p.prosrc ILIKE '%partner_email_verification_sends%'
  )::text
  || '|' || COALESCE(NULLIF(oidvectortypes(p.proargtypes), ''), 'none')
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'prevent_admin_partner_profile',
    'set_partner_profile_auth_identity',
    'delete_supabase_partner_profile_for_auth_user',
    'claim_partner_email_verification_send'
  )
ORDER BY 1;

SELECT 'TGRANT|' || n.nspname || '.' || c.relname ||
  '|' || CASE
    WHEN acl.grantee = 0 THEN 'PUBLIC'
    ELSE COALESCE(pg_get_userbyid(acl.grantee), '?')
  END ||
  '|' || acl.privilege_type
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(
  COALESCE(c.relacl, acldefault('r', c.relowner))
) acl
WHERE c.relkind IN ('r', 'p')
  AND n.nspname = 'public'
  AND c.relname IN (
    'partner_profiles', 'partner_sessions',
    'partner_email_verification_sends'
  )
ORDER BY 1;

SELECT 'FGRANT|' || p.proname ||
  '|' || COALESCE(NULLIF(oidvectortypes(p.proargtypes), ''), 'none') ||
  '|' || CASE
    WHEN acl.grantee = 0 THEN 'PUBLIC'
    ELSE COALESCE(pg_get_userbyid(acl.grantee), '?')
  END ||
  '|' || acl.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(
  COALESCE(p.proacl, acldefault('f', p.proowner))
) acl
WHERE n.nspname = 'public'
  AND p.proname IN (
    'prevent_admin_partner_profile',
    'set_partner_profile_auth_identity',
    'delete_supabase_partner_profile_for_auth_user',
    'claim_partner_email_verification_send'
  )
ORDER BY 1;

WITH workspace_table_names(table_name) AS (
  VALUES
    ('partner_campaigns'),
    ('partner_campaign_assignments'),
    ('partner_campaign_sites'),
    ('partner_campaign_requests'),
    ('partner_damage_reports'),
    ('partner_proofs'),
    ('partner_stock_movements'),
    ('partner_withdrawal_requests'),
    ('partner_coin_ledger')
)
SELECT 'WORKSPACE_COLLISION|' || expected.table_name || '|' || COALESCE(relation.relkind::text, 'missing')
FROM workspace_table_names expected
LEFT JOIN pg_class relation
  ON relation.relnamespace = 'public'::regnamespace
  AND relation.relname = expected.table_name
ORDER BY expected.table_name;

WITH required_tables(table_name) AS (
  VALUES
    ('partner_campaigns'),
    ('partner_campaign_assignments'),
    ('partner_campaign_sites'),
    ('partner_campaign_requests'),
    ('partner_damage_reports'),
    ('partner_proofs'),
    ('partner_stock_movements'),
    ('partner_withdrawal_requests'),
    ('partner_coin_ledger')
)
SELECT 'WORKSPACE_TABLE|' || required.table_name ||
  '|' || (relation.oid IS NOT NULL)::text ||
  '|' || COALESCE(relation.relrowsecurity, false)::text ||
  '|' || EXISTS (
    SELECT 1
    FROM pg_policy pol
    WHERE pol.polrelid = relation.oid
      AND pol.polname = required.table_name || '_no_direct_access'
      AND pol.polcmd = '*'
      AND COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') = 'false'
      AND COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') = 'false'
  )::text ||
  '|' || (
    relation.oid IS NOT NULL
    AND has_table_privilege('service_role', relation.oid, 'SELECT')
    AND has_table_privilege('service_role', relation.oid, 'INSERT')
    AND has_table_privilege('service_role', relation.oid, 'UPDATE')
    AND has_table_privilege('service_role', relation.oid, 'DELETE')
  )::text ||
  '|' || (
    relation.oid IS NOT NULL
    AND (
      has_table_privilege('anon', relation.oid, 'SELECT')
      OR has_table_privilege('anon', relation.oid, 'INSERT')
      OR has_table_privilege('anon', relation.oid, 'UPDATE')
      OR has_table_privilege('anon', relation.oid, 'DELETE')
      OR has_table_privilege('authenticated', relation.oid, 'SELECT')
      OR has_table_privilege('authenticated', relation.oid, 'INSERT')
      OR has_table_privilege('authenticated', relation.oid, 'UPDATE')
      OR has_table_privilege('authenticated', relation.oid, 'DELETE')
    )
  )::text
FROM required_tables required
LEFT JOIN pg_class relation
  ON relation.relnamespace = 'public'::regnamespace
  AND relation.relname = required.table_name
  AND relation.relkind IN ('r', 'p')
ORDER BY required.table_name;

WITH required_functions(function_name, argument_types, owner_only) AS (
  VALUES
    ('create_partner_campaign_assignment', 'uuid, text, text, text, date, date, integer, integer, integer, double precision, double precision, jsonb, uuid', true),
    ('submit_partner_proof', 'uuid, uuid, uuid, text, text, double precision, double precision', false),
    ('review_partner_proof', 'uuid, uuid, text, text', true),
    ('request_partner_withdrawal', 'uuid, integer', false),
    ('review_partner_withdrawal', 'uuid, uuid, text, text, text', true),
    ('review_partner_campaign_request', 'uuid, uuid, text, text, integer', true),
    ('review_partner_damage_report', 'uuid, uuid, text', true)
)
SELECT 'WORKSPACE_FUNCTION|' || required.function_name ||
  '|' || COALESCE(oidvectortypes(proc.proargtypes), required.argument_types) ||
  '|' || (proc.oid IS NOT NULL)::text ||
  '|' || COALESCE(proc.prosecdef, false)::text ||
  '|' || COALESCE(proc.proconfig @> ARRAY['search_path=pg_catalog, public'], false)::text ||
  '|' || (
    NOT required.owner_only OR (
      proc.prosrc ILIKE '%is_primary_owner = true%'
      AND proc.prosrc ILIKE '%status = ''active''%'
      AND proc.prosrc ILIKE '%role = ''owner''%'
    )
  )::text ||
  '|' || (
    proc.oid IS NOT NULL
    AND has_function_privilege('service_role', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('anon', proc.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', proc.oid, 'EXECUTE')
  )::text
FROM required_functions required
LEFT JOIN pg_proc proc
  ON proc.pronamespace = 'public'::regnamespace
  AND proc.proname = required.function_name
  AND oidvectortypes(proc.proargtypes) = required.argument_types
ORDER BY required.function_name;

WITH required_indexes(index_name) AS (
  VALUES
    ('partner_campaign_assignments_partner_active'),
    ('partner_campaign_sites_campaign'),
    ('partner_campaign_requests_partner'),
    ('partner_damage_reports_partner'),
    ('partner_proofs_partner_recent'),
    ('partner_proofs_review_queue'),
    ('partner_stock_movements_proof_unique'),
    ('partner_stock_movements_partner_recent'),
    ('partner_withdrawal_requests_partner'),
    ('partner_coin_ledger_proof_unique'),
    ('partner_coin_ledger_withdrawal_unique'),
    ('partner_coin_ledger_partner_recent')
)
SELECT 'WORKSPACE_INDEX_COLLISION|' || namespace.nspname || '.' || relation.relname
FROM required_indexes required
JOIN pg_class relation
  ON relation.relnamespace = 'public'::regnamespace
  AND relation.relname = required.index_name
JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
ORDER BY 1;

SELECT 'WORKSPACE_DEP|admin_owner_columns|' || (
  SELECT count(*) = 4
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'admin_users'
    AND (
      (column_name = 'id' AND data_type = 'uuid')
      OR (column_name = 'is_primary_owner' AND data_type = 'boolean')
      OR (column_name IN ('status', 'role') AND data_type = 'text')
    )
)::text;
SELECT 'WORKSPACE_DEP|storage_bucket_catalog|' || (
  to_regclass('storage.buckets') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'storage'
      AND relation.relname = 'buckets'
      AND relation.relkind IN ('r', 'p')
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'id' AND data_type = 'text'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'name' AND data_type = 'text'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'public' AND data_type = 'boolean'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'file_size_limit' AND data_type IN ('bigint', 'integer')
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'storage' AND table_name = 'buckets'
      AND column_name = 'allowed_mime_types' AND data_type = 'ARRAY'
  )
)::text;
SELECT 'WORKSPACE_DEP|required_database_roles|' || (
  SELECT count(*) = 3
  FROM pg_roles
  WHERE rolname IN ('anon', 'authenticated', 'service_role')
)::text;
SELECT 'WORKSPACE_DEP|uuid_generator|' ||
  (to_regprocedure('gen_random_uuid()') IS NOT NULL)::text;

SELECT 'WORKSPACE_BUCKET|' ||
  COALESCE(bucket.public::text, 'missing') ||
  '|' || COALESCE(bucket.file_size_limit::text, 'missing') ||
  '|' || COALESCE(array_to_string(bucket.allowed_mime_types, ','), 'missing') ||
  '|' || COALESCE(bucket.name, 'missing')
FROM (SELECT 1) AS singleton
LEFT JOIN storage.buckets bucket ON bucket.id = 'partner-proofs';

ROLLBACK;
\else
SELECT 'TARGET_REJECTED|No partner catalog query was run.';
ROLLBACK;
\quit
\endif
'@

$queryOutput = @(
  Invoke-ProductionAdminDeletionReadOnlyQuery `
    -ProjectRef $ProjectRef `
    -PsqlPath $PsqlPath `
    -Sql $sql
)

$relations = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
$columns = @{}
$constraints = @{}
$foreignKeys = @{}
$indexes = @{}
$rls = @{}
$policies = @{}
$triggers = @{}
$functions = @{}
$tableGrants = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
$functionGrants = [System.Collections.Generic.HashSet[string]]::new(
  [System.StringComparer]::OrdinalIgnoreCase
)
$ledgerInfo = $null
$migrationInfo = $null
$workspaceRows = [System.Collections.Generic.List[string]]::new()
$dependencyRows = [System.Collections.Generic.List[string]]::new()
$targetInfo = @($queryOutput | Where-Object { $_ -like 'TARGET|*' } | Select-Object -First 1)

if ($targetInfo.Count -ne 1 -or $targetInfo[0] -notlike 'TARGET|PASS|*') {
  throw 'Production target or READ ONLY transaction verification failed; schema results were rejected.'
}

foreach ($line in $queryOutput) {
  $parts = $line -split '\|', 11
  switch ($parts[0]) {
    'LEDGER' {
      $ledgerInfo = $parts
    }
    'MIGRATION' {
      $migrationInfo = $parts
    }
    'REL' {
      [void]$relations.Add($parts[1])
    }
    'COL' {
      $columns[$parts[1]] = [pscustomobject]@{
        Type = $parts[2]
        NotNull = $parts[3] -eq 'true'
        HasDefault = $parts[4] -eq 'true'
        Default = $parts[5]
      }
    }
    'CON' {
      $constraints["$($parts[1])|$($parts[2])"] = [pscustomobject]@{
        Type = $parts[3]
        Validated = $parts[4] -eq 'true'
        Definition = $parts[5]
      }
    }
    'FK' {
      $foreignKeys["$($parts[1])|$($parts[2])"] = [pscustomobject]@{
        SourceColumns = $parts[3]
        ReferencedTable = $parts[4]
        ReferencedColumns = $parts[5]
        DeleteAction = $parts[6]
        Validated = $parts[7] -eq 'true'
      }
    }
    'IDX' {
      $indexes["$($parts[1])|$($parts[2])"] = [pscustomobject]@{
        Unique = $parts[3] -eq 'true'
        Valid = $parts[4] -eq 'true'
        Definition = $parts[5]
        Predicate = $parts[6]
      }
    }
    'RLS' {
      $rls[$parts[1]] = [pscustomobject]@{
        Enabled = $parts[2] -eq 'true'
        Forced = $parts[3] -eq 'true'
      }
    }
    'POL' {
      $policies["$($parts[1])|$($parts[2])"] = [pscustomobject]@{
        Command = $parts[3]
        Using = $parts[4]
        WithCheck = $parts[5]
        Roles = $parts[6] -split ','
      }
    }
    'TRG' {
      $triggers["$($parts[1])|$($parts[2])"] = [pscustomobject]@{
        Enabled = $parts[3] -ne 'D'
        Definition = $parts[4]
      }
    }
    'FUNC' {
      $functions["$($parts[1])|$($parts[10])"] = [pscustomobject]@{
        ArgumentTypes = $parts[10]
        SecurityDefiner = $parts[2] -eq 'true'
        Config = $parts[3]
        HasAdminIdGuard = $parts[4] -eq 'true'
        HasAdminEmailGuard = $parts[5] -eq 'true'
        HasIdentityDefaults = $parts[6] -eq 'true'
        HasSubjectGuard = $parts[7] -eq 'true'
        HasSupabaseDeleteFilter = $parts[8] -eq 'true'
        HasCooldownLogic = $parts[9] -eq 'true'
      }
    }
    'TGRANT' {
      [void]$tableGrants.Add("$($parts[1])|$($parts[2])|$($parts[3])")
    }
    'FGRANT' {
      [void]$functionGrants.Add("$($parts[1])|$($parts[2])|$($parts[3])|$($parts[4])")
    }
    'WORKSPACE_COLLISION' { $workspaceRows.Add($line) }
    'WORKSPACE_TABLE' { $workspaceRows.Add($line) }
    'WORKSPACE_FUNCTION' { $workspaceRows.Add($line) }
    'WORKSPACE_INDEX_COLLISION' { $workspaceRows.Add($line) }
    'WORKSPACE_DEP' { $dependencyRows.Add($line) }
    'WORKSPACE_BUCKET' { $workspaceRows.Add($line) }
  }
}

$migrationHistoryState = 'UNKNOWN'
if ($null -ne $migrationInfo -and $migrationInfo.Count -eq 3 -and
  $migrationInfo[1] -eq '20261126120000') {
  $migrationHistoryState = switch ($migrationInfo[2]) {
    'true' { 'APPLIED' }
    'false' { 'PENDING' }
    default { 'UNKNOWN' }
  }
}

$baselineChecks = [System.Collections.Generic.List[object]]::new()
$workspaceChecks = [System.Collections.Generic.List[object]]::new()
$dependencyChecks = [System.Collections.Generic.List[object]]::new()

function Add-PreflightCheck {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [bool]$Passed
  )

  $List.Add([pscustomobject]@{ Name = $Name; Passed = $Passed })
}

function Add-ColumnPreflightCheck {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$Key,
    [Parameter(Mandatory = $true)]
    [string]$Type,
    [Parameter(Mandatory = $true)]
    [bool]$NotNull,
    [string]$DefaultPattern,
    [switch]$RequireDefault
  )

  $column = $columns[$Key]
  $passed = $null -ne $column `
    -and $column.Type -eq $Type `
    -and $column.NotNull -eq $NotNull
  if ($passed -and $RequireDefault) {
    $passed = $column.HasDefault
    if ($passed -and -not [string]::IsNullOrEmpty($DefaultPattern)) {
      $passed = $column.Default -match $DefaultPattern
    }
  }
  Add-PreflightCheck -List $List -Name "column $Key" -Passed $passed
}

function Add-ConstraintPreflightCheck {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$Table,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Type,
    [string]$DefinitionPattern
  )

  $constraint = $constraints["$Table|$Name"]
  $passed = $null -ne $constraint `
    -and $constraint.Type -eq $Type `
    -and $constraint.Validated
  if ($passed -and -not [string]::IsNullOrEmpty($DefinitionPattern)) {
    $passed = $constraint.Definition -match $DefinitionPattern
  }
  Add-PreflightCheck -List $List -Name "constraint $Table.$Name" -Passed $passed
}

function Add-ForeignKeyPreflightCheck {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$Table,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$SourceColumns,
    [Parameter(Mandatory = $true)]
    [string]$ReferencedTable,
    [Parameter(Mandatory = $true)]
    [string]$ReferencedColumns,
    [Parameter(Mandatory = $true)]
    [string]$DeleteAction
  )

  $foreignKey = $foreignKeys["$Table|$Name"]
  $passed = $null -ne $foreignKey `
    -and $foreignKey.SourceColumns -ceq $SourceColumns `
    -and $foreignKey.ReferencedTable -ceq $ReferencedTable `
    -and $foreignKey.ReferencedColumns -ceq $ReferencedColumns `
    -and $foreignKey.DeleteAction -ceq $DeleteAction `
    -and $foreignKey.Validated
  Add-PreflightCheck -List $List -Name "foreign key $Table.$Name" -Passed $passed
}

function Add-IndexPreflightCheck {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$Table,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [bool]$Unique,
    [Parameter(Mandatory = $true)]
    [string]$DefinitionPattern,
    [string]$PredicatePattern
  )

  $index = $indexes["$Table|$Name"]
  $passed = $null -ne $index `
    -and $index.Unique -eq $Unique `
    -and $index.Valid `
    -and $index.Definition -match $DefinitionPattern
  if ($passed -and -not [string]::IsNullOrEmpty($PredicatePattern)) {
    $passed = $index.Predicate -match $PredicatePattern
  }
  Add-PreflightCheck -List $List -Name "index $Table.$Name" -Passed $passed
}

function Add-PolicyPreflightCheck {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$Table,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $policy = $policies["$Table|$Name"]
  $passed = $null -ne $policy `
    -and $policy.Command -eq '*' `
    -and $policy.Using.Trim() -eq 'false' `
    -and $policy.WithCheck.Trim() -eq 'false' `
    -and @($policy.Roles | Where-Object { $_ -eq 'anon' }).Count -gt 0 `
    -and @($policy.Roles | Where-Object { $_ -eq 'authenticated' }).Count -gt 0
  Add-PreflightCheck -List $List -Name "policy $Table.$Name" -Passed $passed
}

function Add-TableGrantPreflightChecks {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$Table
  )

  foreach ($privilege in @(
    'SELECT', 'INSERT', 'UPDATE', 'DELETE',
    'TRUNCATE', 'REFERENCES', 'TRIGGER'
  )) {
    Add-PreflightCheck -List $List `
      -Name "grant $privilege on $Table to service_role" `
      -Passed $tableGrants.Contains("$Table|service_role|$privilege")
  }
  foreach ($role in @('PUBLIC', 'anon', 'authenticated')) {
    $hasDirectGrant = @($tableGrants | Where-Object {
      $_ -like "$Table|$role|*"
    }).Count -gt 0
    Add-PreflightCheck -List $List `
      -Name "no direct table grants on $Table to $role" `
      -Passed (-not $hasDirectGrant)
  }
}

function Add-FunctionAclPreflightChecks {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$FunctionName,
    [string]$ArgumentTypes = 'none',
    [switch]$ServiceRoleExecute
  )

  foreach ($role in @('PUBLIC', 'anon', 'authenticated')) {
    Add-PreflightCheck -List $List `
      -Name "no EXECUTE on $FunctionName to $role" `
      -Passed (-not $functionGrants.Contains("$FunctionName|$ArgumentTypes|$role|EXECUTE"))
  }
  if ($ServiceRoleExecute) {
    Add-PreflightCheck -List $List `
      -Name "EXECUTE on $FunctionName to service_role" `
      -Passed $functionGrants.Contains("$FunctionName|$ArgumentTypes|service_role|EXECUTE")
  }
}

function Add-FunctionPreflightCheck {
  param(
    [Parameter(Mandatory = $true)]
    [System.Collections.Generic.List[object]]$List,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [string]$ArgumentTypes = 'none',
    [Parameter(Mandatory = $true)]
    [scriptblock]$Predicate
  )

  $function = $functions["$Name|$ArgumentTypes"]
  $passed = $null -ne $function -and (& $Predicate $function)
  Add-PreflightCheck -List $List -Name "function public.$Name" -Passed $passed
}

$expectedWorkspaceTables = @(
  'partner_campaigns',
  'partner_campaign_assignments',
  'partner_campaign_sites',
  'partner_campaign_requests',
  'partner_damage_reports',
  'partner_proofs',
  'partner_stock_movements',
  'partner_withdrawal_requests',
  'partner_coin_ledger'
)
foreach ($tableName in $expectedWorkspaceTables) {
  $row = @($workspaceRows | Where-Object { $_ -like "WORKSPACE_TABLE|$tableName|*" })
  $parts = if ($row.Count -eq 1) { $row[0].Split([char]124) } else { @() }
  Add-PreflightCheck -List $workspaceChecks -Name "workspace table public.$tableName exists" `
    -Passed ($parts.Count -eq 7 -and $parts[2] -eq 'true')
  Add-PreflightCheck -List $workspaceChecks -Name "RLS enabled on public.$tableName" `
    -Passed ($parts.Count -eq 7 -and $parts[3] -eq 'true')
  Add-PreflightCheck -List $workspaceChecks -Name "direct client access blocked on public.$tableName" `
    -Passed ($parts.Count -eq 7 -and $parts[4] -eq 'true' -and $parts[6] -eq 'false')
  Add-PreflightCheck -List $workspaceChecks -Name "service_role grants present on public.$tableName" `
    -Passed ($parts.Count -eq 7 -and $parts[5] -eq 'true')
}

$expectedDependencies = @(
  'admin_owner_columns',
  'storage_bucket_catalog',
  'required_database_roles',
  'uuid_generator'
)
foreach ($dependencyName in $expectedDependencies) {
  $row = @($dependencyRows | Where-Object { $_ -like "WORKSPACE_DEP|$dependencyName|*" })
  $parts = if ($row.Count -eq 1) { $row[0].Split([char]124) } else { @() }
  Add-PreflightCheck -List $dependencyChecks `
    -Name "workspace dependency $dependencyName" `
    -Passed ($parts.Count -eq 3 -and $parts[2] -eq 'true')
}

$expectedWorkspaceFunctions = @(
  'create_partner_campaign_assignment',
  'submit_partner_proof',
  'review_partner_proof',
  'request_partner_withdrawal',
  'review_partner_withdrawal',
  'review_partner_campaign_request',
  'review_partner_damage_report'
)
foreach ($functionName in $expectedWorkspaceFunctions) {
  $row = @($workspaceRows | Where-Object { $_ -like "WORKSPACE_FUNCTION|$functionName|*" })
  $parts = if ($row.Count -eq 1) { $row[0].Split([char]124) } else { @() }
  Add-PreflightCheck -List $workspaceChecks -Name "workspace function public.$functionName exists" `
    -Passed ($parts.Count -eq 8 -and $parts[3] -eq 'true')
  Add-PreflightCheck -List $workspaceChecks -Name "workspace function public.$functionName security definer and fixed search_path" `
    -Passed ($parts.Count -eq 8 -and $parts[4] -eq 'true' -and $parts[5] -eq 'true')
  Add-PreflightCheck -List $workspaceChecks -Name "workspace function public.$functionName authorization and service-role ACL" `
    -Passed ($parts.Count -eq 8 -and $parts[6] -eq 'true' -and $parts[7] -eq 'true')
}

$bucketRows = @($workspaceRows | Where-Object { $_ -like 'WORKSPACE_BUCKET|*' })
$bucketParts = if ($bucketRows.Count -eq 1) { $bucketRows[0].Split([char]124) } else { @() }
Add-PreflightCheck -List $workspaceChecks -Name 'private partner-proofs storage bucket is configured' `
  -Passed ($bucketParts.Count -eq 5 -and $bucketParts[1] -eq 'false' -and
    $bucketParts[2] -eq '2097152' -and $bucketParts[3] -eq 'image/jpeg,image/png,image/webp' -and
    $bucketParts[4] -eq 'partner-proofs')

foreach ($relation in @('public.admin_users', 'auth.users')) {
  Add-PreflightCheck -List $baselineChecks `
    -Name "prerequisite relation $relation" `
    -Passed $relations.Contains($relation)
}
foreach ($column in @(
  @{ Key = 'public.admin_users.id'; Type = 'uuid'; NotNull = $true },
  @{ Key = 'auth.users.id'; Type = 'uuid'; NotNull = $true }
)) {
  Add-ColumnPreflightCheck -List $baselineChecks @column
}

foreach ($table in @('public.partner_profiles', 'public.partner_sessions')) {
  Add-PreflightCheck -List $baselineChecks -Name "table $table" `
    -Passed $relations.Contains($table)
  Add-TableGrantPreflightChecks -List $baselineChecks -Table $table
}

$baselineColumns = @(
  @{ Key = 'public.partner_profiles.id'; Type = 'uuid'; NotNull = $true },
  @{ Key = 'public.partner_profiles.email'; Type = 'text'; NotNull = $true },
  @{ Key = 'public.partner_profiles.full_name'; Type = 'text'; NotNull = $true },
  @{ Key = 'public.partner_profiles.mobile_number'; Type = 'text'; NotNull = $true },
  @{ Key = 'public.partner_profiles.status'; Type = 'text'; NotNull = $true; RequireDefault = $true; DefaultPattern = 'pending' },
  @{ Key = 'public.partner_profiles.created_at'; Type = 'timestamp with time zone'; NotNull = $true; RequireDefault = $true; DefaultPattern = 'now\(\)' },
  @{ Key = 'public.partner_profiles.updated_at'; Type = 'timestamp with time zone'; NotNull = $true; RequireDefault = $true; DefaultPattern = 'now\(\)' },
  @{ Key = 'public.partner_profiles.last_login_at'; Type = 'timestamp with time zone'; NotNull = $false },
  @{ Key = 'public.partner_sessions.id'; Type = 'uuid'; NotNull = $true },
  @{ Key = 'public.partner_sessions.user_id'; Type = 'uuid'; NotNull = $true },
  @{ Key = 'public.partner_sessions.created_at'; Type = 'timestamp with time zone'; NotNull = $true; RequireDefault = $true; DefaultPattern = 'now\(\)' },
  @{ Key = 'public.partner_sessions.expires_at'; Type = 'timestamp with time zone'; NotNull = $true; RequireDefault = $true; DefaultPattern = 'now\(\).*(interval|hour)' },
  @{ Key = 'public.partner_sessions.revoked_at'; Type = 'timestamp with time zone'; NotNull = $false },
  @{ Key = 'public.partner_sessions.user_agent'; Type = 'text'; NotNull = $true; RequireDefault = $true; DefaultPattern = '^'''
  }
)
foreach ($column in $baselineColumns) {
  Add-ColumnPreflightCheck -List $baselineChecks @column
}

foreach ($constraint in @(
  @{ Table = 'public.partner_profiles'; Name = 'partner_profiles_pkey'; Type = 'p'; DefinitionPattern = 'PRIMARY KEY\s*\(\s*id\s*\)' },
  @{ Table = 'public.partner_profiles'; Name = 'partner_profiles_id_fkey'; Type = 'f'; DefinitionPattern = 'REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON DELETE CASCADE' },
  @{ Table = 'public.partner_profiles'; Name = 'partner_profiles_status_check'; Type = 'c'; DefinitionPattern = 'pending.*active.*disabled' },
  @{ Table = 'public.partner_profiles'; Name = 'partner_profiles_email_lowercase'; Type = 'c'; DefinitionPattern = 'email\s*=\s*lower\s*\(\s*email\s*\)' },
  @{ Table = 'public.partner_sessions'; Name = 'partner_sessions_pkey'; Type = 'p'; DefinitionPattern = 'PRIMARY KEY\s*\(\s*id\s*\)' }
)) {
  Add-ConstraintPreflightCheck -List $baselineChecks @constraint
}
Add-ForeignKeyPreflightCheck -List $baselineChecks `
  -Table 'public.partner_sessions' `
  -Name 'partner_sessions_user_id_fkey' `
  -SourceColumns 'user_id' `
  -ReferencedTable 'public.partner_profiles' `
  -ReferencedColumns 'id' `
  -DeleteAction 'c'

foreach ($index in @(
  @{ Table = 'public.partner_profiles'; Name = 'partner_profiles_email_unique'; Unique = $true; DefinitionPattern = '\(\s*email\s*\)' },
  @{ Table = 'public.partner_sessions'; Name = 'partner_sessions_user_active'; Unique = $false; DefinitionPattern = '\(\s*user_id\s*,\s*expires_at DESC'; PredicatePattern = 'revoked_at IS NULL' }
)) {
  Add-IndexPreflightCheck -List $baselineChecks @index
}

foreach ($table in @('public.partner_profiles', 'public.partner_sessions')) {
  $tableRls = $rls[$table]
  Add-PreflightCheck -List $baselineChecks -Name "RLS enabled on $table" `
    -Passed ($null -ne $tableRls -and $tableRls.Enabled)
}
Add-PolicyPreflightCheck -List $baselineChecks `
  -Table 'public.partner_profiles' -Name 'partner_profiles_no_direct_access'
Add-PolicyPreflightCheck -List $baselineChecks `
  -Table 'public.partner_sessions' -Name 'partner_sessions_no_direct_access'

$baselineTrigger = $triggers['public.partner_profiles|prevent_admin_partner_profile']
Add-PreflightCheck -List $baselineChecks -Name 'trigger prevent_admin_partner_profile on partner_profiles' `
  -Passed ($null -ne $baselineTrigger -and $baselineTrigger.Enabled `
    -and $baselineTrigger.Definition -match 'BEFORE INSERT' `
    -and $baselineTrigger.Definition -match 'UPDATE OF id')
Add-FunctionPreflightCheck -List $baselineChecks -Name 'prevent_admin_partner_profile' -Predicate {
  param($function)
  $function.SecurityDefiner -and $function.Config -match 'search_path=public' -and $function.HasAdminIdGuard
}
Add-FunctionAclPreflightChecks -List $baselineChecks -FunctionName 'prevent_admin_partner_profile'

$baselineObjectChecks = @($baselineChecks)
$baselineFound = @($baselineObjectChecks | Where-Object { $_.Passed }).Count
$baselineStatus = if ($baselineFound -eq 0) {
  'ABSENT'
} elseif ($baselineFound -eq $baselineObjectChecks.Count) {
  'PRESENT'
} else {
  'PARTIAL'
}
$workspaceFound = @($workspaceChecks | Where-Object { $_.Passed }).Count
$workspaceStatus = if ($workspaceFound -eq 0) {
  'ABSENT'
} elseif ($workspaceFound -eq $workspaceChecks.Count) {
  'PRESENT'
} else {
  'PARTIAL'
}

Write-Output ''
Write-Output 'Production partner schema preflight (catalog metadata only)'
Write-Output ($targetInfo[0])
if ($null -ne $ledgerInfo) {
  Write-Output "Migration ledger metadata: schema_present=$($ledgerInfo[1]); table_present=$($ledgerInfo[2])."
}
$alternateLedgers = @($queryOutput | Where-Object { $_ -like 'ALTLEDGER|*' })
if ($alternateLedgers.Count -gt 0) {
  Write-Output 'Alternate migration-history candidates:'
  $alternateLedgers | ForEach-Object { Write-Output "  $($_ -replace '^ALTLEDGER\|', '')" }
} else {
  Write-Output 'Alternate migration-history candidates: none found by catalog name.'
}
Write-Output "20261123120000_partner_identity_isolation.sql schema: $baselineStatus ($baselineFound/$($baselineObjectChecks.Count) checks present)"
Write-Output "20261126120000_create_partner_workspace.sql schema: $workspaceStatus ($workspaceFound/$($workspaceChecks.Count) checks present)"
  if ($SchemaEvidenceOnly) {
    Write-Output 'Migration history for 20261126120000: UNVERIFIED (schema-evidence-only; ledger unchanged)'
  } else {
    Write-Output "Migration history for 20261126120000: $migrationHistoryState"
  }
  Write-Output "Workspace dependencies: $(@($dependencyChecks | Where-Object { $_.Passed }).Count)/$($dependencyChecks.Count) checks present"

$workspaceCoreObjects = @()
foreach ($line in $workspaceRows) {
  $parts = $line.Split([char]124)
  if ($parts[0] -eq 'WORKSPACE_COLLISION' -and $parts.Count -eq 3 -and $parts[2] -ne 'missing') {
    $workspaceCoreObjects += "public.$($parts[1]) ($($parts[2]))"
  } elseif ($parts[0] -eq 'WORKSPACE_FUNCTION' -and $parts.Count -eq 8 -and $parts[3] -eq 'true') {
    $workspaceCoreObjects += "public.$($parts[1])($($parts[2]))"
  } elseif ($parts[0] -eq 'WORKSPACE_INDEX_COLLISION' -and $parts.Count -eq 2) {
    $workspaceCoreObjects += $parts[1]
  }
}
$workspaceCoreObjects = @($workspaceCoreObjects | Sort-Object -Unique)
$bucketExists = $bucketParts.Count -eq 5 -and $bucketParts[1] -ne 'missing'
$bucketMatches = $bucketParts.Count -eq 5 -and $bucketParts[1] -eq 'false' -and
  $bucketParts[2] -eq '2097152' -and $bucketParts[3] -eq 'image/jpeg,image/png,image/webp' -and
  $bucketParts[4] -eq 'partner-proofs'
$bucketStateValid = $bucketParts.Count -eq 5 -and
  ($bucketParts[1] -eq 'missing' -or $bucketMatches)

if ($baselineStatus -ne 'PRESENT') {
  Write-Output 'Missing or mismatched prerequisite schema checks:'
  $baselineObjectChecks | Where-Object { -not $_.Passed } | ForEach-Object { Write-Output "  $($_.Name)" }
  throw 'Partner workspace prerequisites do not match the existing partner schema; no production write is safe.'
}

if (@($dependencyChecks | Where-Object { -not $_.Passed }).Count -gt 0) {
  Write-Output 'Missing or mismatched workspace dependency checks:'
  $dependencyChecks | Where-Object { -not $_.Passed } | ForEach-Object { Write-Output "  $($_.Name)" }
  throw 'Partner workspace dependencies do not match the reviewed migration; no production write is safe.'
}

if ($SchemaEvidenceOnly) {
  $ledgerAbsent = $null -ne $ledgerInfo -and $ledgerInfo.Count -eq 3 `
    -and $ledgerInfo[1] -eq 'false' -and $ledgerInfo[2] -eq 'false'
  $historyUnknown = $null -ne $migrationInfo -and $migrationInfo.Count -eq 3 `
    -and $migrationInfo[1] -eq '20261126120000' -and $migrationInfo[2] -eq 'unknown'
  if (-not $ledgerAbsent -or -not $historyUnknown) {
    throw 'Schema-evidence-only mode requires absent application migration history; no history was changed.'
  }
  if ($alternateLedgers.Count -gt 0) {
    throw 'Alternate migration-history candidates exist; reconcile them before using schema-evidence-only mode.'
  }

  if ($PostMigration) {
    if ($workspaceChecks.Count -ne 58 -or $workspaceStatus -ne 'PRESENT' -or -not $bucketMatches) {
      Write-Output 'Missing or mismatched post-migration workspace schema checks:'
      $workspaceChecks | Where-Object { -not $_.Passed } | ForEach-Object { Write-Output "  $($_.Name)" }
      throw 'Post-migration workspace schema is incomplete or conflicting; do not deploy the application.'
    }
    Write-Output 'SCHEMA EVIDENCE PASS - post-migration schema is complete; migration history remains UNVERIFIED.'
  } else {
    $workspaceAbsent = $workspaceChecks.Count -eq 58 -and
      $workspaceCoreObjects.Count -eq 0 -and $bucketStateValid -and
      ($workspaceFound -eq 0 -or ($workspaceFound -eq 1 -and $bucketMatches))
    if (-not $workspaceAbsent) {
      Write-Output 'Conflicting workspace objects found before the migration:'
      $workspaceCoreObjects | ForEach-Object { Write-Output "  $_" }
      throw 'Workspace schema is partial or already present; do not apply the migration until reconciled.'
    }
    if ($bucketExists -and -not $bucketMatches) {
      Write-Output "Conflicting partner-proofs bucket: public=$($bucketParts[1]); file_size_limit=$($bucketParts[2]); allowed_mime_types=$($bucketParts[3]); name=$($bucketParts[4])"
      throw 'The existing partner-proofs bucket does not match the migration; do not apply it until reconciled.'
    }
    Write-Output 'SCHEMA EVIDENCE PASS - identity prerequisites match and workspace objects are absent; migration history remains UNVERIFIED.'
  }
} elseif ($migrationHistoryState -eq 'APPLIED') {
  if ($workspaceStatus -ne 'PRESENT') {
    Write-Output 'Missing or mismatched workspace schema checks:'
    $workspaceChecks | Where-Object { -not $_.Passed } | ForEach-Object { Write-Output "  $($_.Name)" }
    throw 'The migration is recorded as applied, but the live workspace schema is incomplete or conflicting.'
  }
  Write-Output 'Preflight result: migration is recorded and the workspace schema matches.'
} elseif ($migrationHistoryState -eq 'PENDING') {
  if ($workspaceCoreObjects.Count -gt 0) {
    Write-Output 'Conflicting workspace objects found before the migration:'
    $workspaceCoreObjects | ForEach-Object { Write-Output "  $_" }
    throw 'The migration is pending in history, but some workspace objects already exist; do not apply it until reconciled.'
  }
  if ($bucketExists -and -not $bucketMatches) {
    Write-Output "Conflicting partner-proofs bucket: public=$($bucketParts[1]); file_size_limit=$($bucketParts[2]); allowed_mime_types=$($bucketParts[3]); name=$($bucketParts[4])"
    throw 'The existing partner-proofs bucket does not match the migration; do not apply it until reconciled.'
  }
  Write-Output 'Preflight result: prerequisites match and the workspace migration is pending; it is safe to apply the single workspace migration.'
} else {
  throw 'Migration execution history is unavailable or malformed; no production write is safe.'
}
Write-Output 'No partner, Auth, Admin, order, or payment rows were queried. No migration or production data change was performed.'
