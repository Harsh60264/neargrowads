$script:CashfreeStagingProjectRef = 'kdaixomygsuxadofoieb'
$script:CashfreeProductionProjectRef = 'axbjzmdokfoftzfgwiql'
$script:CashfreeStagingPoolerHost = 'aws-0-eu-west-1.pooler.supabase.com'
$script:CashfreeStagingPoolerPort = 5432
$script:CashfreeStagingDatabase = 'postgres'
$script:CashfreeStagingDatabaseUser = "postgres.$script:CashfreeStagingProjectRef"
$script:CashfreeMigrationVersion = '20261103100000'
$script:CashfreeMigrationName = 'add_cashfree_service_payment_persistence'
$script:AdminPermanentDeletionMigrationVersion = '20261102100000'
$script:AdminPermanentDeletionMigrationName = 'secure_archived_admin_permanent_deletion'

function Invoke-CashfreeStagingReadOnlyQuery {
  param(
    [Parameter(Mandatory = $true)][string]$ProjectRef,
    [Parameter(Mandatory = $true)][string]$PsqlPath,
    [Parameter(Mandatory = $true)][string]$Sql
  )

  if ($ProjectRef -ceq $script:CashfreeProductionProjectRef) {
    throw 'The Production project reference is prohibited.'
  }
  if ($ProjectRef -cne $script:CashfreeStagingProjectRef -or $ProjectRef -notmatch '^[a-z0-9]{20}$') {
    throw 'ProjectRef must exactly match the pinned Staging project reference.'
  }
  $expectedDatabaseUser = "postgres.$script:CashfreeStagingProjectRef"
  if ($script:CashfreeStagingDatabaseUser -cne $expectedDatabaseUser) {
    throw 'The configured database username does not match the pinned Staging project.'
  }
  if (-not (Test-Path -LiteralPath $PsqlPath -PathType Leaf)) {
    throw "PostgreSQL 18 psql.exe was not found at: $PsqlPath"
  }
  $versionOutput = (& $PsqlPath --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '^psql \(PostgreSQL\) 18(?:\.|\s|$)') {
    throw "PostgreSQL 18 psql is required. Detected: $versionOutput"
  }

  Write-Host ''
  Write-Host 'READ-ONLY STAGING DATABASE TARGET'
  Write-Host "Project ref: $script:CashfreeStagingProjectRef"
  Write-Host "Host:        $script:CashfreeStagingPoolerHost"
  Write-Host "Port:        $script:CashfreeStagingPoolerPort (Session Pooler session mode)"
  Write-Host "Database:    $script:CashfreeStagingDatabase"
  Write-Host "Username:    $script:CashfreeStagingDatabaseUser"
  Write-Host 'TLS:         verify-full using the configured PostgreSQL root certificate'
  Write-Host 'The query runs in a read-only transaction and does not apply or record migrations.'
  $confirmation = Read-Host 'Type the exact Staging project ref shown above to continue'
  if ($confirmation -cne $script:CashfreeStagingProjectRef) {
    throw 'Staging project reference confirmation did not match; no database connection was opened.'
  }

  $environmentHelper = Join-Path $PSScriptRoot 'psqlEnvironment.ps1'
  if (-not (Test-Path -LiteralPath $environmentHelper -PathType Leaf)) {
    throw "PostgreSQL TLS environment helper was not found: $environmentHelper"
  }
  . $environmentHelper
  $temporarySqlPath = Join-Path $env:TEMP ("neargrow-cashfree-staging-" + [guid]::NewGuid().ToString('N') + '.psql')
  $temporaryOutputPath = Join-Path $env:TEMP ("neargrow-cashfree-staging-output-" + [guid]::NewGuid().ToString('N') + '.txt')
  $savedEnvironment = $null
  $psqlDiagnostics = [System.Collections.Generic.List[string]]::new()

  try {
    [System.IO.File]::WriteAllText(
      $temporarySqlPath,
      "BEGIN TRANSACTION READ ONLY;$([Environment]::NewLine)$Sql$([Environment]::NewLine)COMMIT;",
      [System.Text.UTF8Encoding]::new($false)
    )
    $savedEnvironment = Enter-StagingPsqlEnvironment
    $arguments = @(
      '--no-psqlrc',
      '--host', $script:CashfreeStagingPoolerHost,
      '--port', "$script:CashfreeStagingPoolerPort",
      '--username', $script:CashfreeStagingDatabaseUser,
      '--dbname', $script:CashfreeStagingDatabase,
      '--password',
      '--set', 'ON_ERROR_STOP=1',
      '--no-align',
      '--tuples-only',
      '--field-separator', '|',
      '--output', $temporaryOutputPath,
      '--file', $temporarySqlPath
    )

    $psqlOutputAndDiagnostics = @(& $PsqlPath @arguments 2>&1)
    foreach ($message in $psqlOutputAndDiagnostics) {
      $diagnostic = [string]$message
      if ($diagnostic -match '^\s*Password(?: for user .*)?:\s*$') {
        Write-Host -NoNewline $diagnostic
      } else {
        $psqlDiagnostics.Add($diagnostic)
      }
    }
    $psqlExitCode = $LASTEXITCODE
    if ($psqlExitCode -ne 0) {
      return @(Resolve-CashfreeStagingQueryOutput `
        -ExitCode $psqlExitCode `
        -QueryOutput @() `
        -Diagnostics @($psqlDiagnostics))
    }

    if (-not (Test-Path -LiteralPath $temporaryOutputPath -PathType Leaf)) {
      throw 'The Staging psql process exited successfully but did not create its verification output file. Aborting without accepting any checks.'
    }
    if ((Get-Item -LiteralPath $temporaryOutputPath).Length -eq 0) {
      throw 'The Staging psql process exited successfully but returned an empty verification output file. Aborting without accepting any checks.'
    }

    try {
      $queryOutput = @(Get-Content -LiteralPath $temporaryOutputPath -ErrorAction Stop)
    } catch {
      throw 'The Staging verification output file could not be read. Aborting without accepting any checks.'
    }
    return @(Resolve-CashfreeStagingQueryOutput `
      -ExitCode $psqlExitCode `
      -QueryOutput $queryOutput `
      -Diagnostics @($psqlDiagnostics))
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
}

function Resolve-CashfreeStagingQueryOutput {
  param(
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][AllowNull()][AllowEmptyCollection()][AllowEmptyString()][string[]]$QueryOutput,
    [Parameter(Mandatory = $false)][AllowNull()][AllowEmptyCollection()][string[]]$Diagnostics = @()
  )

  $diagnosticText = ($Diagnostics -join "`n")
  if ($diagnosticText -match '(?im)^\s*(?:FATAL|ERROR):') {
    if ($diagnosticText -match '(?i)(password|SASL|authentication) .*failed|no password supplied') {
      throw "Staging database authentication failed for the pinned target (psql exit code $ExitCode). Verify the Staging database password and project-specific user; no credential was logged or changed."
    }
    throw "The read-only Staging process reported a database error (psql exit code $ExitCode). No verification result was accepted."
  }

  if ($ExitCode -ne 0) {
    if ($diagnosticText -match '(?i)(password|SASL|authentication) .*failed|no password supplied') {
      throw "Staging database authentication failed for the pinned target (psql exit code $ExitCode). Verify the Staging database password and project-specific user; no credential was logged or changed."
    }
    if ($diagnosticText -match '(?i)(certificate|SSL|TLS|hostname verification)') {
      throw "Staging database TLS verification failed (psql exit code $ExitCode). Verify the trusted Staging root certificate and pinned pooler hostname; TLS verification was not weakened."
    }
    if ($diagnosticText -match '(?i)(could not connect|connection refused|connection timed out|could not translate host)') {
      throw "Could not connect to the pinned Staging database (psql exit code $ExitCode). Verify Staging availability and the fixed pooler endpoint."
    }
    if ($diagnosticText -match '(?i)(ERROR:|FATAL:|syntax error|permission denied|does not exist)') {
      throw "The read-only Staging verification query failed (psql exit code $ExitCode). No verification result was accepted."
    }
    throw "The read-only Staging psql process failed (exit code $ExitCode). No verification result was accepted."
  }

  $nonEmptyOutput = @($QueryOutput | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($nonEmptyOutput.Count -eq 0) {
    throw 'The Staging psql process exited successfully but returned empty verification output. Aborting without accepting any checks.'
  }
  return $nonEmptyOutput
}

function Assert-CashfreeStagingCheckRows {
  param(
    [Parameter(Mandatory = $true)][AllowNull()][AllowEmptyCollection()][AllowEmptyString()][string[]]$QueryOutput,
    [Parameter(Mandatory = $true)][string[]]$ExpectedNames
  )

  if ($null -eq $QueryOutput -or $QueryOutput.Count -eq 0) {
    Write-Host 'FAIL | empty verification output | no database checks were received'
    return $false
  }

  $checks = @()
  foreach ($line in $QueryOutput | Where-Object { $_ -like 'CHECK|*' }) {
    $parts = $line.Split([char]124, 4)
    if ($parts.Count -ne 4 -or $parts[2] -notin @('PASS', 'FAIL')) {
      Write-Host "FAIL | malformed check row | $line"
      return $false
    }
    $checks += $parts[1]
    Write-Host "$($parts[2]) | $($parts[1]) | $($parts[3])"
  }
  foreach ($name in $ExpectedNames) {
    if ($checks -notcontains $name) {
      Write-Host "FAIL | missing check | $name"
    }
  }
  foreach ($name in $checks | Sort-Object -Unique) {
    if ($ExpectedNames -notcontains $name) {
      Write-Host "FAIL | unexpected check | $name"
    }
  }
  return $checks.Count -eq $ExpectedNames.Count -and
    (Compare-Object @($checks | Sort-Object) @($ExpectedNames | Sort-Object)).Count -eq 0 -and
    -not ($QueryOutput | Where-Object { $_ -match '^CHECK\|[^|]+\|FAIL\|' })
}

function Get-CashfreeMigration36SchemaEvidenceCheckSql {
  return (Get-CashfreeMigration36SchemaDiagnosticsSql)
  $baseSql = @'
WITH expected_functions(signature) AS (
  VALUES
    ('public.sync_admin_identity_history()'),
    ('public.lock_admin_email_reservation(text)'),
    ('public.guard_admin_email_reservation()'),
    ('public.guard_auth_email_reservation()'),
    ('public.guard_admin_permanent_deletion_in_progress()'),
    ('public.get_admin_permanent_deletion_state(uuid)'),
    ('public.begin_admin_permanent_deletion(uuid,uuid,text,text)'),
    ('public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)'),
    ('public.complete_admin_permanent_deletion(uuid,uuid)')
), function_checks AS (
  SELECT e.signature, p.oid IS NOT NULL
    AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND CASE p.proname
      WHEN 'sync_admin_identity_history' THEN
        p.prosrc ILIKE '%deleted_at%' AND p.prosrc ILIKE '%tg_op%'
      WHEN 'lock_admin_email_reservation' THEN
        p.prosrc ILIKE '%pg_advisory_xact_lock%'
      WHEN 'guard_admin_email_reservation' THEN
        p.prosrc ILIKE '%lock_admin_email_reservation%' AND p.prosrc ILIKE '%23505%'
      WHEN 'guard_auth_email_reservation' THEN
        p.prosrc ILIKE '%admin_permanent_deletion_email_reservations%' AND p.prosrc ILIKE '%23505%'
      WHEN 'guard_admin_permanent_deletion_in_progress' THEN
        p.prosrc ILIKE '%auth_delete_pending%' AND p.prosrc ILIKE '%55000%'
      WHEN 'get_admin_permanent_deletion_state' THEN
        p.prosrc ILIKE '%admin_permanent_deletion_jobs%'
      WHEN 'begin_admin_permanent_deletion' THEN
        p.prosrc ILIKE '%lock_admin_email_reservation%'
          AND p.prosrc ILIKE '%auth_delete_pending%'
      WHEN 'record_admin_permanent_deletion_failure' THEN
        p.prosrc ILIKE '%last_error_stage%' AND p.prosrc ILIKE '%last_error_code%'
      WHEN 'complete_admin_permanent_deletion' THEN
        p.prosrc ILIKE '%auth.users%' AND p.prosrc ILIKE '%completed_at%'
      ELSE false
    END
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE acl.grantee NOT IN (p.proowner, 'service_role'::regrole)
        AND acl.privilege_type = 'EXECUTE'
    ) AS valid
  FROM expected_functions e
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
), expected_triggers(table_name, trigger_name, function_signature, trigger_type) AS (
  VALUES
    ('public.admin_users'::regclass, 'admin_users_sync_identity_history',
      'public.sync_admin_identity_history()'::regprocedure, 29),
    ('public.admin_users'::regclass, 'admin_users_guard_reserved_email',
      'public.guard_admin_email_reservation()'::regprocedure, 23),
    ('auth.users'::regclass, 'auth_users_guard_reserved_email',
      'public.guard_auth_email_reservation()'::regprocedure, 23),
    ('public.admin_users'::regclass, 'admin_users_guard_pending_permanent_deletion',
      'public.guard_admin_permanent_deletion_in_progress()'::regprocedure, 19)
), expected_columns(table_name, column_name, data_type) AS (
  VALUES
    ('admin_identity_history', 'id', 'uuid'),
    ('admin_identity_history', 'email', 'text'),
    ('admin_identity_history', 'role', 'text'),
    ('admin_identity_history', 'is_primary_owner', 'boolean'),
    ('admin_identity_history', 'created_at', 'timestamp with time zone'),
    ('admin_identity_history', 'deleted_at', 'timestamp with time zone'),
    ('admin_permanent_deletion_jobs', 'target_id', 'uuid'),
    ('admin_permanent_deletion_jobs', 'actor_id', 'uuid'),
    ('admin_permanent_deletion_jobs', 'target_email', 'text'),
    ('admin_permanent_deletion_jobs', 'status', 'text'),
    ('admin_permanent_deletion_jobs', 'attempt_count', 'integer'),
    ('admin_permanent_deletion_jobs', 'started_at', 'timestamp with time zone'),
    ('admin_permanent_deletion_jobs', 'last_attempted_at', 'timestamp with time zone'),
    ('admin_permanent_deletion_jobs', 'completed_at', 'timestamp with time zone'),
    ('admin_permanent_deletion_jobs', 'last_error_stage', 'text'),
    ('admin_permanent_deletion_jobs', 'last_error_code', 'text'),
    ('admin_permanent_deletion_email_reservations', 'email', 'text'),
    ('admin_permanent_deletion_email_reservations', 'target_id', 'uuid'),
    ('admin_permanent_deletion_email_reservations', 'created_at', 'timestamp with time zone')
), expected_constraints(constraint_name) AS (
  VALUES
    ('admin_identity_history_pkey'),
    ('admin_permanent_deletion_jobs_pkey'),
    ('admin_permanent_deletion_jobs_target_id_fkey'),
    ('admin_permanent_deletion_jobs_actor_id_fkey'),
    ('admin_permanent_deletion_jobs_status_check'),
    ('admin_permanent_deletion_jobs_attempt_count_check'),
    ('admin_permanent_deletion_email_lowercase'),
    ('admin_permanent_deletion_completion_state'),
    ('admin_permanent_deletion_email_reservations_pkey'),
    ('admin_permanent_deletion_email_reservations_target_id_key'),
    ('admin_permanent_deletion_email_reservations_target_id_fkey'),
    ('admin_permanent_deletion_reservation_email_lowercase')
), expected_admin_fks(source_table, source_column, target_table, target_column) AS (
  VALUES
    ('public.admin_users','invited_by','public.admin_identity_history','id'),
    ('public.admin_sessions','user_id','public.admin_users','id'),
    ('public.admin_audit_logs','actor_id','public.admin_identity_history','id'),
    ('public.admin_audit_logs','target_id','public.admin_identity_history','id'),
    ('public.admin_ownership_transfers','from_user_id','public.admin_identity_history','id'),
    ('public.admin_ownership_transfers','to_user_id','public.admin_identity_history','id'),
    ('public.site_content_cms','updated_by','public.admin_identity_history','id'),
    ('public.site_content_cms','published_by','public.admin_identity_history','id'),
    ('public.service_store_payment_settings','razorpay_test_verified_by','public.admin_identity_history','id'),
    ('public.service_store_payment_settings','updated_by','public.admin_identity_history','id'),
    ('public.service_store_payment_audit','actor_id','public.admin_identity_history','id'),
    ('public.site_content_revisions','actor_id','public.admin_identity_history','id'),
    ('public.security_events','actor_id','public.admin_identity_history','id'),
    ('public.security_alerts','acknowledged_by','public.admin_identity_history','id'),
    ('public.security_alerts','resolved_by','public.admin_identity_history','id'),
    ('public.security_detection_rules','updated_by','public.admin_identity_history','id')
), actual_admin_fks AS (
  SELECT source_namespace.nspname || '.' || source_table.relname AS source_table,
    source_column.attname AS source_column,
    target_namespace.nspname || '.' || target_table.relname AS target_table,
    target_column.attname AS target_column
  FROM pg_constraint fk
  JOIN pg_class source_table ON source_table.oid = fk.conrelid
  JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
  JOIN pg_attribute source_column ON source_column.attrelid = fk.conrelid
    AND source_column.attnum = fk.conkey[1] AND NOT source_column.attisdropped
  JOIN pg_class target_table ON target_table.oid = fk.confrelid
  JOIN pg_namespace target_namespace ON target_namespace.oid = target_table.relnamespace
  JOIN pg_attribute target_column ON target_column.attrelid = fk.confrelid
    AND target_column.attnum = fk.confkey[1] AND NOT target_column.attisdropped
  WHERE fk.contype = 'f' AND fk.convalidated
    AND cardinality(fk.conkey) = 1 AND cardinality(fk.confkey) = 1
    AND EXISTS (SELECT 1 FROM expected_admin_fks expected
      WHERE expected.source_table = source_namespace.nspname || '.' || source_table.relname
        AND expected.source_column = source_column.attname)
)
SELECT 'CHECK|migration36_schema_evidence|' ||
  CASE WHEN
    (SELECT count(*) = 3 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname IN ('admin_identity_history','admin_permanent_deletion_jobs',
          'admin_permanent_deletion_email_reservations'))
    AND (SELECT count(*) = 19 FROM information_schema.columns c
      JOIN expected_columns e ON e.table_name = c.table_name AND e.column_name = c.column_name
        AND e.data_type = c.data_type
      WHERE c.table_schema = 'public')
    AND (SELECT count(*) = 19 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('admin_identity_history',
        'admin_permanent_deletion_jobs','admin_permanent_deletion_email_reservations'))
    AND (SELECT count(*) = 3 AND bool_and(relrowsecurity) FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('admin_identity_history',
        'admin_permanent_deletion_jobs','admin_permanent_deletion_email_reservations'))
    AND has_table_privilege('service_role','public.admin_identity_history',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND has_table_privilege('service_role','public.admin_permanent_deletion_jobs','SELECT,INSERT,UPDATE,DELETE')
    AND has_table_privilege('service_role','public.admin_permanent_deletion_email_reservations','SELECT,INSERT,UPDATE,DELETE')
    AND to_regprocedure('gen_random_uuid()') IS NOT NULL
    AND to_regclass('public.admin_users') IS NOT NULL
    AND to_regclass('auth.users') IS NOT NULL
    AND has_schema_privilege(current_user, 'auth', 'USAGE')
    AND has_table_privilege(current_user, 'auth.users', 'TRIGGER')
    AND EXISTS (SELECT 1 FROM pg_constraint fk
      WHERE fk.contype = 'f' AND fk.convalidated
        AND fk.conrelid = 'public.admin_users'::regclass
        AND fk.confrelid = 'auth.users'::regclass
        AND fk.conkey = ARRAY[(SELECT attnum FROM pg_attribute
          WHERE attrelid = 'public.admin_users'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]
        AND fk.confkey = ARRAY[(SELECT attnum FROM pg_attribute
          WHERE attrelid = 'auth.users'::regclass AND attname = 'id' AND NOT attisdropped)]::smallint[]
        AND fk.confdeltype = 'c')
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE n.nspname = 'public'
        AND c.relname IN ('admin_identity_history','admin_permanent_deletion_jobs',
          'admin_permanent_deletion_email_reservations')
        AND acl.grantee IN (0,
          (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
          (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'))
    )
    AND (SELECT count(*) = 12 AND bool_and(convalidated)
      FROM pg_constraint WHERE conrelid IN ('public.admin_identity_history'::regclass,
        'public.admin_permanent_deletion_jobs'::regclass,
        'public.admin_permanent_deletion_email_reservations'::regclass))
    AND NOT EXISTS (SELECT 1 FROM expected_constraints e
      WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c
        WHERE c.conname = e.constraint_name AND c.convalidated
          AND c.conrelid IN ('public.admin_identity_history'::regclass,
            'public.admin_permanent_deletion_jobs'::regclass,
            'public.admin_permanent_deletion_email_reservations'::regclass)))
    AND NOT EXISTS (SELECT 1 FROM pg_constraint c
      WHERE c.conrelid IN ('public.admin_identity_history'::regclass,
        'public.admin_permanent_deletion_jobs'::regclass,
        'public.admin_permanent_deletion_email_reservations'::regclass)
        AND c.conname NOT IN (SELECT constraint_name FROM expected_constraints))
    AND (SELECT count(*) = 16 FROM expected_admin_fks)
    AND (SELECT count(*) = 16 FROM actual_admin_fks)
    AND NOT EXISTS (
      SELECT source_table, source_column, target_table, target_column FROM expected_admin_fks
      EXCEPT
      SELECT source_table, source_column, target_table, target_column FROM actual_admin_fks
    )
    AND NOT EXISTS (
      SELECT source_table, source_column, target_table, target_column FROM actual_admin_fks
      EXCEPT
      SELECT source_table, source_column, target_table, target_column FROM expected_admin_fks
    )
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_permanent_deletion_jobs'::regclass
        AND conname = 'admin_permanent_deletion_jobs_status_check'
        AND pg_get_constraintdef(oid) ILIKE '%auth_delete_pending%'
        AND pg_get_constraintdef(oid) ILIKE '%completed%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_permanent_deletion_jobs'::regclass
        AND conname = 'admin_permanent_deletion_jobs_attempt_count_check'
        AND pg_get_constraintdef(oid) ILIKE '%attempt_count > 0%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_permanent_deletion_jobs'::regclass
        AND conname = 'admin_permanent_deletion_email_lowercase'
        AND pg_get_constraintdef(oid) ILIKE '%target_email = lower(target_email)%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_permanent_deletion_jobs'::regclass
        AND conname = 'admin_permanent_deletion_completion_state'
        AND pg_get_constraintdef(oid) ILIKE '%completed_at IS NOT NULL%'
        AND pg_get_constraintdef(oid) ILIKE '%completed_at IS NULL%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_permanent_deletion_email_reservations'::regclass
        AND conname = 'admin_permanent_deletion_reservation_email_lowercase'
        AND pg_get_constraintdef(oid) ILIKE '%email = lower(email)%')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_permanent_deletion_jobs'::regclass
        AND conname = 'admin_permanent_deletion_jobs_target_id_fkey'
        AND contype = 'f' AND convalidated
        AND confrelid = 'public.admin_identity_history'::regclass AND confdeltype = 'r')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_permanent_deletion_jobs'::regclass
        AND conname = 'admin_permanent_deletion_jobs_actor_id_fkey'
        AND contype = 'f' AND convalidated
        AND confrelid = 'public.admin_identity_history'::regclass AND confdeltype = 'r')
    AND EXISTS (SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.admin_permanent_deletion_email_reservations'::regclass
        AND conname = 'admin_permanent_deletion_email_reservations_target_id_fkey'
        AND contype = 'f' AND convalidated
        AND confrelid = 'public.admin_permanent_deletion_jobs'::regclass AND confdeltype = 'r')
    AND (SELECT count(*) = 9 AND bool_and(valid) FROM function_checks)
    AND (SELECT count(*) = 9 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f'
        AND p.proname IN ('sync_admin_identity_history','lock_admin_email_reservation',
          'guard_admin_email_reservation','guard_auth_email_reservation',
          'guard_admin_permanent_deletion_in_progress','get_admin_permanent_deletion_state',
          'begin_admin_permanent_deletion','record_admin_permanent_deletion_failure',
          'complete_admin_permanent_deletion'))
    AND (SELECT count(*) = 4 FROM expected_triggers e JOIN pg_trigger t
      ON t.tgrelid = e.table_name AND t.tgname = e.trigger_name
        AND t.tgfoid = e.function_signature AND t.tgtype = e.trigger_type
        AND t.tgenabled = 'O' AND NOT t.tgisinternal AND t.tgqual IS NULL AND t.tgnargs = 0
        AND CASE WHEN e.trigger_name IN (
          'admin_users_guard_reserved_email','auth_users_guard_reserved_email'
        ) THEN cardinality(t.tgattr::smallint[]) = 1
          AND t.tgattr::smallint[] @> ARRAY[(
            SELECT a.attnum FROM pg_attribute a
            WHERE a.attrelid = e.table_name AND a.attname = 'email' AND NOT a.attisdropped
          )]::smallint[]
        ELSE cardinality(t.tgattr::smallint[]) = 0 END)
    AND has_function_privilege('service_role',
      'public.get_admin_permanent_deletion_state(uuid)','EXECUTE')
    AND has_function_privilege('service_role',
      'public.begin_admin_permanent_deletion(uuid,uuid,text,text)','EXECUTE')
    AND has_function_privilege('service_role',
      'public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)','EXECUTE')
    AND has_function_privilege('service_role',
      'public.complete_admin_permanent_deletion(uuid,uuid)','EXECUTE')
    AND NOT EXISTS (SELECT 1 FROM public.admin_users a
      LEFT JOIN public.admin_identity_history h ON h.id = a.id
      WHERE h.id IS NULL OR h.email IS DISTINCT FROM a.email
        OR h.role IS DISTINCT FROM a.role
        OR h.is_primary_owner IS DISTINCT FROM a.is_primary_owner
        OR h.created_at IS DISTINCT FROM a.created_at
        OR h.deleted_at IS NOT NULL)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|exact Migration 36 tables, columns, validated keys, function signatures/security, triggers, grants and identity-history linkage match';
'@
  return Get-CashfreeMigration36SchemaDiagnosticsSql
}

function Get-CashfreeMigration36SchemaDiagnosticNames {
  return @(
    'migration36_table_definitions',
    'migration36_table_security',
    'migration36_triggers',
    'migration36_function_sync_admin_identity_history',
    'migration36_function_lock_admin_email_reservation',
    'migration36_function_guard_admin_email_reservation',
    'migration36_function_guard_auth_email_reservation',
    'migration36_function_guard_admin_permanent_deletion_in_progress',
    'migration36_function_get_admin_permanent_deletion_state',
    'migration36_function_begin_admin_permanent_deletion',
    'migration36_function_record_admin_permanent_deletion_failure',
    'migration36_function_complete_admin_permanent_deletion',
    'migration36_function_overloads',
    'migration36_constraints_and_indexes',
    'migration36_internal_foreign_keys',
    'migration36_identity_history_backfill',
    'migration36_admin_foreign_keys'
  )
}

function Add-CashfreeMigration36SchemaAggregate {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$QueryOutput)

  $expectedNames = @(Get-CashfreeMigration36SchemaDiagnosticNames)
  $checks = @($QueryOutput | Where-Object {
    $_ -like 'CHECK|migration36_*|*' -and
      $_ -notlike 'CHECK|migration36_live_prerequisites|*'
  })
  $seenNames = @()
  $failedNames = @()
  foreach ($line in $checks) {
    $parts = $line.Split([char]124, 4)
    if ($parts.Count -ne 4 -or $parts[2] -notin @('PASS','FAIL')) {
      $failedNames += 'malformed Migration 36 subcheck output'
      continue
    }
    $seenNames += $parts[1]
    if ($parts[2] -ne 'PASS') {
      $failedNames += $parts[1]
    }
  }
  foreach ($name in $expectedNames) {
    if ($seenNames -notcontains $name) {
      $failedNames += "missing $name"
    }
  }
  foreach ($name in $seenNames | Sort-Object -Unique) {
    if ($expectedNames -notcontains $name) {
      $failedNames += "unexpected $name"
    }
  }
  if ($seenNames.Count -ne $expectedNames.Count -or
    (Compare-Object @($seenNames | Sort-Object) @($expectedNames | Sort-Object)).Count -ne 0) {
    $failedNames += 'duplicate or missing Migration 36 subchecks'
  }
  if ($failedNames.Count -eq 0) {
    $QueryOutput + 'CHECK|migration36_schema_evidence|PASS|All exact Migration 36 subchecks passed'
  } else {
    $reasons = (@($failedNames | Sort-Object -Unique) -join ', ')
    $QueryOutput + "CHECK|migration36_schema_evidence|FAIL|Failed subchecks: $reasons"
  }
}

function Get-CashfreeMigration36SchemaDiagnosticsSql {
  return @'
WITH expected_columns(table_name, column_name, type_name, is_not_null, default_expression) AS (
  VALUES
    ('admin_identity_history', 'id', 'uuid', true, ''),
    ('admin_identity_history', 'email', 'text', true, ''),
    ('admin_identity_history', 'role', 'text', true, ''),
    ('admin_identity_history', 'is_primary_owner', 'boolean', true, 'false'),
    ('admin_identity_history', 'created_at', 'timestamp with time zone', true, ''),
    ('admin_identity_history', 'deleted_at', 'timestamp with time zone', false, ''),
    ('admin_permanent_deletion_jobs', 'target_id', 'uuid', true, ''),
    ('admin_permanent_deletion_jobs', 'actor_id', 'uuid', true, ''),
    ('admin_permanent_deletion_jobs', 'target_email', 'text', true, ''),
    ('admin_permanent_deletion_jobs', 'status', 'text', true, ''),
    ('admin_permanent_deletion_jobs', 'attempt_count', 'integer', true, '1'),
    ('admin_permanent_deletion_jobs', 'started_at', 'timestamp with time zone', true, 'now()'),
    ('admin_permanent_deletion_jobs', 'last_attempted_at', 'timestamp with time zone', true, 'now()'),
    ('admin_permanent_deletion_jobs', 'completed_at', 'timestamp with time zone', false, ''),
    ('admin_permanent_deletion_jobs', 'last_error_stage', 'text', false, ''),
    ('admin_permanent_deletion_jobs', 'last_error_code', 'text', false, ''),
    ('admin_permanent_deletion_email_reservations', 'email', 'text', true, ''),
    ('admin_permanent_deletion_email_reservations', 'target_id', 'uuid', true, ''),
    ('admin_permanent_deletion_email_reservations', 'created_at', 'timestamp with time zone', true, 'now()')
), actual_columns AS (
  SELECT relation.relname AS table_name, attribute.attname AS column_name,
    format_type(attribute.atttypid, attribute.atttypmod) AS type_name,
    attribute.attnotnull AS is_not_null,
    COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expression
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname = 'public'
    AND relation.relname IN ('admin_identity_history','admin_permanent_deletion_jobs',
      'admin_permanent_deletion_email_reservations')
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
)
SELECT 'CHECK|migration36_table_definitions|' ||
  CASE WHEN (SELECT count(*) FROM actual_columns) = (SELECT count(*) FROM expected_columns)
    AND NOT EXISTS (
      SELECT 1 FROM expected_columns e LEFT JOIN actual_columns a
        ON a.table_name = e.table_name AND a.column_name = e.column_name
      WHERE a.column_name IS NULL OR a.type_name IS DISTINCT FROM e.type_name
        OR a.is_not_null IS DISTINCT FROM e.is_not_null
        OR a.default_expression IS DISTINCT FROM e.default_expression)
    AND NOT EXISTS (
      SELECT 1 FROM actual_columns a LEFT JOIN expected_columns e
        ON e.table_name = a.table_name AND e.column_name = a.column_name
      WHERE e.column_name IS NULL)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Expected exactly 19 columns with Migration 36 types, nullability and defaults';

WITH expected_columns(table_name, column_name, type_name, is_not_null, default_expression) AS (
  VALUES
    ('admin_identity_history', 'id', 'uuid', true, ''),
    ('admin_identity_history', 'email', 'text', true, ''),
    ('admin_identity_history', 'role', 'text', true, ''),
    ('admin_identity_history', 'is_primary_owner', 'boolean', true, 'false'),
    ('admin_identity_history', 'created_at', 'timestamp with time zone', true, ''),
    ('admin_identity_history', 'deleted_at', 'timestamp with time zone', false, ''),
    ('admin_permanent_deletion_jobs', 'target_id', 'uuid', true, ''),
    ('admin_permanent_deletion_jobs', 'actor_id', 'uuid', true, ''),
    ('admin_permanent_deletion_jobs', 'target_email', 'text', true, ''),
    ('admin_permanent_deletion_jobs', 'status', 'text', true, ''),
    ('admin_permanent_deletion_jobs', 'attempt_count', 'integer', true, '1'),
    ('admin_permanent_deletion_jobs', 'started_at', 'timestamp with time zone', true, 'now()'),
    ('admin_permanent_deletion_jobs', 'last_attempted_at', 'timestamp with time zone', true, 'now()'),
    ('admin_permanent_deletion_jobs', 'completed_at', 'timestamp with time zone', false, ''),
    ('admin_permanent_deletion_jobs', 'last_error_stage', 'text', false, ''),
    ('admin_permanent_deletion_jobs', 'last_error_code', 'text', false, ''),
    ('admin_permanent_deletion_email_reservations', 'email', 'text', true, ''),
    ('admin_permanent_deletion_email_reservations', 'target_id', 'uuid', true, ''),
    ('admin_permanent_deletion_email_reservations', 'created_at', 'timestamp with time zone', true, 'now()')
), actual_columns AS (
  SELECT relation.relname AS table_name, attribute.attname AS column_name,
    format_type(attribute.atttypid, attribute.atttypmod) AS type_name,
    attribute.attnotnull AS is_not_null,
    COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '') AS default_expression
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  JOIN pg_attribute attribute ON attribute.attrelid = relation.oid
  LEFT JOIN pg_attrdef default_value
    ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname = 'public'
    AND relation.relname IN ('admin_identity_history','admin_permanent_deletion_jobs',
      'admin_permanent_deletion_email_reservations')
    AND attribute.attnum > 0 AND NOT attribute.attisdropped
), differences AS (
  SELECT e.table_name, e.column_name, e.type_name AS expected_type,
    a.type_name AS actual_type, e.is_not_null AS expected_not_null,
    a.is_not_null AS actual_not_null, e.default_expression AS expected_default,
    a.default_expression AS actual_default,
    CASE WHEN a.column_name IS NULL THEN 'MISSING' ELSE 'MISMATCH' END AS difference
  FROM expected_columns e
  LEFT JOIN actual_columns a
    ON a.table_name = e.table_name AND a.column_name = e.column_name
  WHERE a.column_name IS NULL OR a.type_name IS DISTINCT FROM e.type_name
    OR a.is_not_null IS DISTINCT FROM e.is_not_null
    OR a.default_expression IS DISTINCT FROM e.default_expression
  UNION ALL
  SELECT a.table_name, a.column_name, '<unexpected>' AS expected_type,
    a.type_name AS actual_type, NULL::boolean AS expected_not_null,
    a.is_not_null AS actual_not_null, '<unexpected>' AS expected_default,
    a.default_expression AS actual_default, 'UNEXPECTED' AS difference
  FROM actual_columns a
  LEFT JOIN expected_columns e
    ON e.table_name = a.table_name AND e.column_name = a.column_name
  WHERE e.column_name IS NULL
)
SELECT 'COLUMN_DIFF|' || table_name || '|' || column_name ||
  '|difference=' || difference ||
  '|expected_type=' || COALESCE(expected_type, '<missing>') ||
  '|actual_type=' || COALESCE(actual_type, '<missing>') ||
  '|expected_not_null=' || COALESCE(expected_not_null::text, '<missing>') ||
  '|actual_not_null=' || COALESCE(actual_not_null::text, '<missing>') ||
  '|expected_default=' || COALESCE(NULLIF(expected_default, ''), '<none>') ||
  '|actual_default=' || CASE WHEN actual_type IS NULL THEN '<missing>'
    ELSE COALESCE(NULLIF(actual_default, ''), '<none>') END
FROM differences
ORDER BY table_name, column_name;

WITH expected_tables(table_name) AS (
  VALUES ('admin_identity_history'),('admin_permanent_deletion_jobs'),
    ('admin_permanent_deletion_email_reservations')
), table_checks AS (
  SELECT e.table_name, c.oid, COALESCE(
    c.relrowsecurity
    AND (SELECT bool_and(has_table_privilege('service_role', c.oid, p))
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      WHERE has_table_privilege('anon', c.oid, p) OR has_table_privilege('authenticated', c.oid, p))
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
      WHERE acl.grantee = 0 OR acl.grantee NOT IN (c.relowner, 'service_role'::regrole)),
    false) AS passed
  FROM expected_tables e
  LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || e.table_name)
)
SELECT 'CHECK|migration36_table_security|' ||
  CASE WHEN (SELECT count(*) = 3 AND bool_and(passed) FROM table_checks)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|RLS/service_role privileges and absence of PUBLIC/client/other-role table grants must match Migration 36';

WITH expected_triggers(schema_name, table_name, trigger_name, function_signature, trigger_type) AS (
  VALUES
    ('public','admin_users','admin_users_sync_identity_history','public.sync_admin_identity_history()',29),
    ('public','admin_users','admin_users_guard_reserved_email','public.guard_admin_email_reservation()',23),
    ('auth','users','auth_users_guard_reserved_email','public.guard_auth_email_reservation()',23),
    ('public','admin_users','admin_users_guard_pending_permanent_deletion',
      'public.guard_admin_permanent_deletion_in_progress()',19)
), trigger_checks AS (
  SELECT e.trigger_name, EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = e.schema_name AND r.relname = e.table_name
      AND t.tgname = e.trigger_name AND NOT t.tgisinternal
      AND t.tgfoid = to_regprocedure(e.function_signature)
      AND t.tgtype = e.trigger_type AND t.tgenabled = 'O'
      AND t.tgqual IS NULL AND t.tgnargs = 0
  ) AS passed
  FROM expected_triggers e
)
SELECT 'CHECK|migration36_triggers|' ||
  CASE WHEN (SELECT count(*) = 4 AND bool_and(passed) FROM trigger_checks)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|All four enabled Migration 36 triggers must match exact table, handler and event type';

WITH expected_functions(label, signature, service_role_execute, required_fragments) AS (
  VALUES
    ('sync_admin_identity_history','public.sync_admin_identity_history()',null::boolean,
      ARRAY['if tg_op = ''delete'' then','set email = old.email',
        'deleted_at = coalesce(deleted_at, clock_timestamp())','on conflict (id) do update',
        'deleted_at = null']::text[]),
    ('lock_admin_email_reservation','public.lock_admin_email_reservation(text)',null::boolean,
      ARRAY['pg_advisory_xact_lock','hashtextextended(lower(p_email), 0)']::text[]),
    ('guard_admin_email_reservation','public.guard_admin_email_reservation()',null::boolean,
      ARRAY['reservation.email = lower(new.email)','errcode = ''23505''',
        'admin_permanent_deletion_email_reservations_pkey']::text[]),
    ('guard_auth_email_reservation','public.guard_auth_email_reservation()',null::boolean,
      ARRAY['reservation.email = lower(new.email)','for key share','errcode = ''23505''']::text[]),
    ('guard_admin_permanent_deletion_in_progress','public.guard_admin_permanent_deletion_in_progress()',null::boolean,
      ARRAY['job.status = ''auth_delete_pending''','new.email is distinct from old.email',
        'new.status <> ''disabled''','raise exception']::text[]),
    ('get_admin_permanent_deletion_state','public.get_admin_permanent_deletion_state(uuid)',true,
      ARRAY['role = ''owner''','is_primary_owner','candidate.role <> ''owner''',
        'public.admin_ownership_transfers','pendingdeletions']::text[]),
    ('begin_admin_permanent_deletion','public.begin_admin_permanent_deletion(uuid,uuid,text,text)',true,
      ARRAY['p_confirmation is distinct from ''delete''','role = ''owner''',
        'public.lock_admin_email_reservation','public.admin_permanent_deletion_email_reservations',
        'public.admin_sessions','admin.permanent_deletion.started']::text[]),
    ('record_admin_permanent_deletion_failure','public.record_admin_permanent_deletion_failure(uuid,uuid,text,text)',true,
      ARRAY['role = ''owner''','invalid permanent-deletion stage',
        'left(coalesce(p_error_code, ''unknown''), 80)']::text[]),
    ('complete_admin_permanent_deletion','public.complete_admin_permanent_deletion(uuid,uuid)',true,
      ARRAY['from auth.users','delete from public.admin_users',
        'delete from public.admin_permanent_deletion_email_reservations',
        'admin.permanently_deleted','status = ''completed''']::text[])
), function_checks AS (
  SELECT e.label, COALESCE(
    p.prosecdef
    AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
    AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE')
    AND NOT EXISTS (
      SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE acl.grantee NOT IN (p.proowner, 'service_role'::regrole)
        AND acl.privilege_type = 'EXECUTE')
    AND (e.service_role_execute IS NULL OR
      has_function_privilege('service_role', p.oid, 'EXECUTE') = e.service_role_execute)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(e.required_fragments) fragment
      WHERE position(fragment IN regexp_replace(lower(p.prosrc), '\s+', ' ', 'g')) = 0),
    false) AS passed
  FROM expected_functions e
  LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
)
SELECT 'CHECK|migration36_function_' || label || '|' ||
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END ||
  '|Required exact signature, SECURITY DEFINER, fixed search_path, grants and implementation clauses'
FROM function_checks ORDER BY label;

SELECT 'CHECK|migration36_function_overloads|' ||
  CASE WHEN count(*) = 9 THEN 'PASS' ELSE 'FAIL' END ||
  '|Expected exactly nine Migration 36 routines and no unexpected overloads'
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind = 'f'
  AND p.proname IN ('sync_admin_identity_history','lock_admin_email_reservation',
    'guard_admin_email_reservation','guard_auth_email_reservation',
    'guard_admin_permanent_deletion_in_progress','get_admin_permanent_deletion_state',
    'begin_admin_permanent_deletion','record_admin_permanent_deletion_failure',
    'complete_admin_permanent_deletion');

WITH expected_constraints(table_name, constraint_name, constraint_type, required_fragments, referenced_table) AS (
  VALUES
    ('admin_identity_history','admin_identity_history_pkey','p',ARRAY['primary key','id']::text[],null::text),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_pkey','p',ARRAY['primary key','target_id']::text[],null::text),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_target_id_fkey','f',ARRAY['foreign key','target_id','references','admin_identity_history','id']::text[],'admin_identity_history'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_actor_id_fkey','f',ARRAY['foreign key','actor_id','references','admin_identity_history','id']::text[],'admin_identity_history'),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_status_check','c',ARRAY['status','auth_delete_pending','completed']::text[],null::text),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_jobs_attempt_count_check','c',ARRAY['attempt_count','> 0']::text[],null::text),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_email_lowercase','c',ARRAY['target_email','=','lower']::text[],null::text),
    ('admin_permanent_deletion_jobs','admin_permanent_deletion_completion_state','c',ARRAY['status','completed','completed_at','auth_delete_pending','or']::text[],null::text),
    ('admin_permanent_deletion_email_reservations','admin_permanent_deletion_email_reservations_pkey','p',ARRAY['primary key','email']::text[],null::text),
    ('admin_permanent_deletion_email_reservations','admin_permanent_deletion_email_reservations_target_id_key','u',ARRAY['unique','target_id']::text[],null::text),
    ('admin_permanent_deletion_email_reservations','admin_permanent_deletion_email_reservations_target_id_fkey','f',ARRAY['foreign key','target_id','references','admin_permanent_deletion_jobs','id']::text[],'admin_permanent_deletion_jobs'),
    ('admin_permanent_deletion_email_reservations','admin_permanent_deletion_reservation_email_lowercase','c',ARRAY['email','=','lower']::text[],null::text)
), actual_constraints AS (
  SELECT r.relname AS table_name,c.conname AS constraint_name,c.contype AS constraint_type,
    c.convalidated AS is_validated,lower(pg_get_constraintdef(c.oid)) AS definition,
    c.confrelid AS referenced_table,c.confdeltype AS delete_action
  FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='public' AND r.relname IN ('admin_identity_history',
    'admin_permanent_deletion_jobs','admin_permanent_deletion_email_reservations')
), expected_indexes(index_name,table_name) AS (
  VALUES
    ('admin_identity_history_pkey','admin_identity_history'),
    ('admin_permanent_deletion_jobs_pkey','admin_permanent_deletion_jobs'),
    ('admin_permanent_deletion_email_reservations_pkey','admin_permanent_deletion_email_reservations'),
    ('admin_permanent_deletion_email_reservations_target_id_key','admin_permanent_deletion_email_reservations')
), actual_indexes AS (
  SELECT ix.relname AS index_name,t.relname AS table_name,
    i.indisunique AND i.indisvalid AND i.indisready AS is_expected
  FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid
  JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname IN ('admin_identity_history',
    'admin_permanent_deletion_jobs','admin_permanent_deletion_email_reservations')
)
SELECT 'CHECK|migration36_constraints_and_indexes|' ||
  CASE WHEN (SELECT count(*) FROM actual_constraints)=12
    AND (SELECT count(*) FROM actual_indexes)=4
    AND NOT EXISTS (SELECT 1 FROM expected_constraints e
      LEFT JOIN actual_constraints a ON a.table_name=e.table_name AND a.constraint_name=e.constraint_name
      WHERE a.constraint_name IS NULL OR a.constraint_type IS DISTINCT FROM e.constraint_type
        OR NOT a.is_validated
        OR NOT COALESCE((SELECT bool_and(position(fragment in a.definition)>0)
          FROM unnest(e.required_fragments) fragment),true)
        OR (e.constraint_type='f' AND
          (a.referenced_table<>to_regclass('public.'||e.referenced_table) OR a.delete_action<>'r')))
    AND NOT EXISTS (SELECT 1 FROM actual_constraints a
      LEFT JOIN expected_constraints e ON e.table_name=a.table_name AND e.constraint_name=a.constraint_name
      WHERE e.constraint_name IS NULL)
    AND NOT EXISTS (SELECT 1 FROM expected_indexes e
      LEFT JOIN actual_indexes a ON a.index_name=e.index_name AND a.table_name=e.table_name
      WHERE a.index_name IS NULL OR NOT a.is_expected)
    AND NOT EXISTS (SELECT 1 FROM actual_indexes a
      LEFT JOIN expected_indexes e ON e.index_name=a.index_name AND e.table_name=a.table_name
      WHERE e.index_name IS NULL)
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Expected exactly 12 validated constraints and four valid unique indexes with exact Migration 36 definitions';

SELECT 'CHECK|migration36_internal_foreign_keys|' ||
  CASE WHEN count(*) = 3 AND bool_and(f.convalidated AND f.confdeltype = 'r')
    AND count(*) FILTER (WHERE s.relname = 'admin_permanent_deletion_jobs'
      AND f.conname = 'admin_permanent_deletion_jobs_target_id_fkey'
      AND t.relname = 'admin_identity_history') = 1
    AND count(*) FILTER (WHERE s.relname = 'admin_permanent_deletion_jobs'
      AND f.conname = 'admin_permanent_deletion_jobs_actor_id_fkey'
      AND t.relname = 'admin_identity_history') = 1
    AND count(*) FILTER (WHERE s.relname = 'admin_permanent_deletion_email_reservations'
      AND f.conname = 'admin_permanent_deletion_email_reservations_target_id_fkey'
      AND t.relname = 'admin_permanent_deletion_jobs') = 1
  THEN 'PASS' ELSE 'FAIL' END ||
  '|Three validated internal foreign keys must retain their exact targets and RESTRICT behavior'
FROM pg_constraint f
JOIN pg_class s ON s.oid = f.conrelid
JOIN pg_class t ON t.oid = f.confrelid
JOIN pg_namespace n ON n.oid = s.relnamespace
WHERE f.contype = 'f' AND n.nspname = 'public'
  AND s.relname IN ('admin_permanent_deletion_jobs','admin_permanent_deletion_email_reservations');

SELECT to_regclass('public.admin_users') IS NOT NULL
  AND to_regclass('public.admin_identity_history') IS NOT NULL AS migration36_backfill_tables_present \gset
\if :migration36_backfill_tables_present
SELECT 'CHECK|migration36_identity_history_backfill|' ||
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM public.admin_users a
    LEFT JOIN public.admin_identity_history h ON h.id = a.id
    WHERE h.id IS NULL OR h.email IS DISTINCT FROM a.email
      OR h.role IS DISTINCT FROM a.role
      OR h.is_primary_owner IS DISTINCT FROM a.is_primary_owner
      OR h.created_at IS DISTINCT FROM a.created_at OR h.deleted_at IS NOT NULL
  ) THEN 'PASS' ELSE 'FAIL' END ||
  '|Every current Admin identity must have matching retained history data';
\else
SELECT 'CHECK|migration36_identity_history_backfill|FAIL|Admin or identity-history table is missing';
\endif

WITH expected(source_table, source_column, target_table, target_column) AS (
  VALUES
    ('public.admin_users','invited_by','public.admin_identity_history','id'),
    ('public.admin_sessions','user_id','public.admin_users','id'),
    ('public.admin_audit_logs','actor_id','public.admin_identity_history','id'),
    ('public.admin_audit_logs','target_id','public.admin_identity_history','id'),
    ('public.admin_ownership_transfers','from_user_id','public.admin_identity_history','id'),
    ('public.admin_ownership_transfers','to_user_id','public.admin_identity_history','id'),
    ('public.site_content_cms','updated_by','public.admin_identity_history','id'),
    ('public.site_content_cms','published_by','public.admin_identity_history','id'),
    ('public.service_store_payment_settings','razorpay_test_verified_by','public.admin_identity_history','id'),
    ('public.service_store_payment_settings','updated_by','public.admin_identity_history','id'),
    ('public.service_store_payment_audit','actor_id','public.admin_identity_history','id'),
    ('public.site_content_revisions','actor_id','public.admin_identity_history','id'),
    ('public.security_events','actor_id','public.admin_identity_history','id'),
    ('public.security_alerts','acknowledged_by','public.admin_identity_history','id'),
    ('public.security_alerts','resolved_by','public.admin_identity_history','id'),
    ('public.security_detection_rules','updated_by','public.admin_identity_history','id')
), actual_all AS (
  SELECT f.oid, f.conname,
    sn.nspname||'.'||s.relname AS source_table,source_columns.column_names AS source_column,
    tn.nspname||'.'||t.relname AS target_table,target_columns.column_names AS target_column,
    f.convalidated AS validated, f.confdeltype AS delete_action
  FROM pg_constraint f
  JOIN pg_class s ON s.oid=f.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
  JOIN pg_class t ON t.oid=f.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace
  CROSS JOIN LATERAL (
    SELECT string_agg(a.attname, ',' ORDER BY key_column.ordinality) AS column_names
    FROM unnest(f.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=key_column.attnum
      AND NOT a.attisdropped
  ) source_columns
  CROSS JOIN LATERAL (
    SELECT string_agg(a.attname, ',' ORDER BY key_column.ordinality) AS column_names
    FROM unnest(f.confkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid=f.confrelid AND a.attnum=key_column.attnum
      AND NOT a.attisdropped
  ) target_columns
  WHERE f.contype='f' AND sn.nspname='public'
    AND s.relname IN ('admin_users','admin_sessions','admin_audit_logs','admin_ownership_transfers',
      'site_content_cms','service_store_payment_settings','service_store_payment_audit',
      'site_content_revisions','security_events','security_alerts','security_detection_rules')
    AND f.confrelid IN (to_regclass('public.admin_users'),to_regclass('public.admin_identity_history'))
), actual_historical AS (
  SELECT * FROM actual_all
  WHERE NOT (
    source_table='public.service_store_payment_settings'
    AND source_column='cashfree_test_verified_by'
  )
), cashfree_fk AS (
  SELECT * FROM actual_all
  WHERE source_table='public.service_store_payment_settings'
    AND source_column='cashfree_test_verified_by'
)
SELECT 'CHECK|migration36_admin_foreign_keys|' ||
  CASE WHEN (SELECT count(*)=16 FROM actual_historical)
    AND NOT EXISTS (SELECT * FROM expected EXCEPT
      SELECT source_table,source_column,target_table,target_column FROM actual_historical)
    AND NOT EXISTS (
      SELECT source_table,source_column,target_table,target_column FROM actual_historical
      EXCEPT SELECT * FROM expected
    )
    AND (SELECT bool_and(validated) FROM actual_historical)
    AND (SELECT count(*)=1 FROM cashfree_fk
      WHERE conname='service_store_payment_settings_cashfree_test_verified_by_fkey'
        AND target_table='public.admin_identity_history'
        AND target_column='id'
        AND validated
        AND delete_action='n')
  THEN 'PASS' ELSE 'FAIL' END ||
  '|All 16 Migration 36 Admin foreign keys must match exact targets and be validated; the separate Migration 37 Cashfree attribution FK must target identity history with validated SET NULL behavior';
'@
}

function Test-CashfreeSchemaEvidenceOnly {
  param(
    [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$QueryOutput,
    [Parameter(Mandatory = $true)][ValidateSet('Preflight','PostMigration')][string]$Phase,
    [Parameter(Mandatory = $true)][string[]]$ExpectedCheckNames
  )

  $historyMarkers = @($QueryOutput | Where-Object { $_ -like 'MIGRATION_HISTORY|*' })
  if ($historyMarkers.Count -ne 1) {
    Write-Host 'FAIL | schema_evidence | expected exactly one migration-history state marker.'
    return $false
  }
  $parts = $historyMarkers[0].Split([char]124, 3)
  if ($parts.Count -ne 3 -or $parts[0] -ne 'MIGRATION_HISTORY') {
    Write-Host 'FAIL | schema_evidence | migration-history state marker is malformed.'
    return $false
  }
  if (@('ABSENT_SCHEMA','ABSENT_TABLE','EMPTY') -notcontains $parts[1]) {
    Write-Host "FAIL | schema_evidence | fallback accepts only absent or empty history; observed=$($parts[1])."
    return $false
  }
  $ledgerChecks = @($QueryOutput | Where-Object { $_ -like 'CHECK|migration_ledger|*' })
  if ($ledgerChecks.Count -ne 1 -or $ledgerChecks[0] -notmatch '^CHECK\|migration_ledger\|FAIL\|') {
    Write-Host 'FAIL | schema_evidence | absent/empty history must have exactly one corresponding failed ledger check.'
    return $false
  }
  if (@($QueryOutput | Where-Object { $_ -like 'MIGRATION|*' -or $_ -like 'LEDGER_CANDIDATE|*' }).Count -gt 0) {
    Write-Host 'FAIL | schema_evidence | migration rows or alternate history candidates were present.'
    return $false
  }

  $checkRows = @($QueryOutput | Where-Object { $_ -like 'CHECK|*' -and $_ -notlike 'CHECK|migration_ledger|*' })
  if (-not (Assert-CashfreeStagingCheckRows -QueryOutput $checkRows -ExpectedNames $ExpectedCheckNames)) {
    Write-Host 'FAIL | schema_evidence | required live schema checks failed or were missing.'
    return $false
  }

  Write-Host "SCHEMA EVIDENCE PASS | $Phase | Migration history remains UNVERIFIED; no versions were inferred or written."
  return $true
}
