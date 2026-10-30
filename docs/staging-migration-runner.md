# Applying CMS migrations to isolated Supabase staging

This runbook uses PostgreSQL 18 `psql` through the verified Supabase **Session Pooler in session mode**. It does not use the local Supabase CLI link, `supabase db push`, or `supabase db reset`.

The runner is intentionally pinned to staging project ref `kdaixomygsuxadofoieb` and only accepts this verified endpoint:

```text
Host:     aws-0-eu-west-1.pooler.supabase.com
Port:     5432 (Session Pooler session mode)
Database: postgres
Username: postgres.kdaixomygsuxadofoieb
TLS:      required
```

The host and username are hardcoded/derived by the script; callers cannot supply arbitrary endpoints or usernames. The runner explicitly rejects Production project ref `axbjzmdokfoftzfgwiql`, requires typing the exact staging ref before it opens a database connection, checks the first-three-migration prerequisites, and separately confirms before applying migrations. Do not edit the project ref, pooler endpoint, username construction, or hardcoded migration list without a separate review.

The runner writes only migration name, status, and time to a per-user local log whose filename is keyed to the staging project ref:

```text
%LOCALAPPDATA%\NearGrowAds\staging-migration-logs\<project-ref>.log
```

It does not store passwords or connection strings. `psql` prompts securely for the staging database password for the read-only preflight and again for the migration run. Before invoking `psql`, the runner requires a trusted PostgreSQL root certificate at `%APPDATA%\postgresql\root.crt`, snapshots and removes every inherited process-level `PG*` variable—including `PGSERVICE`, `PGSERVICEFILE`, `PGPASSFILE`, `PGPASSWORD`, `PGHOST`, and `PGOPTIONS`—then sets `PGSSLMODE=verify-full` and `PGSSLROOTCERT` to that certificate. This verifies both the certificate chain and pooler hostname, while preventing inherited libpq settings from changing the target or credential source. The original process environment is restored afterward. The SQL driver and captured query output files are temporary and deleted when the run ends. Successful migrations recorded in Supabase migration history or this local log are skipped. A previously failed migration causes the runner to stop before retrying; inspect the database manually before attempting recovery. Preserve this local log until the staging project is retired. If the log is lost, reconcile migration history and schema before confirming anything; do not assume migrations are unapplied.

If `supabase_migrations.schema_migrations` exists, the runner skips recorded migrations. Whether or not history exists, it requires explicit confirmation that no migrations 4–34 were applied outside the Supabase history and this runner's local log. The three prerequisite migrations applied manually may not appear in Supabase migration history; the runner checks their schema objects directly. If other migrations were applied manually and left untracked, do not confirm until that history/state has been reconciled. The local log is the runner’s durable skip record when migrations are not present in Supabase’s migration history, so keep it backed up in a private local location.

## Preconditions

1. Verify the Supabase Dashboard project name and project ref identify the new staging project. Never use Production credentials or any production Auth users, sessions, leads, or customer data.
2. Ensure the first three migrations were applied in staging:
   - `20261015000000_create_leads_table.sql`
   - `20261019000000_admin_identity_and_access.sql`
   - `20261020000000_admin_account_management.sql`
3. Ensure the staging project’s **Session Pooler** is available in session mode using the endpoint and user listed above. Retrieve the **staging database password** from the staging project's database settings. Do not paste it into a command, script, environment file, or log. Do not use the Production database password.
4. Install PostgreSQL 18 for Windows from [the official PostgreSQL Windows download page](https://www.postgresql.org/download/windows/). In the installer, include Command Line Tools. The default executable is:

   ```text
   C:\Program Files\PostgreSQL\18\bin\psql.exe
   ```

5. Obtain the trusted root certificate for the Supabase Session Pooler from the verified staging project's database SSL settings. Save it as `%APPDATA%\postgresql\root.crt` in PEM format. Do not use a certificate or database credential from Production.
6. In PowerShell, confirm the executable version:

   ```powershell
   $psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
   & $psql --version
   ```

   It must report PostgreSQL 18. If installed elsewhere, pass the actual `psql.exe` path using `-PsqlPath`.

The script uses the fixed Session Pooler host, TCP port `5432`, database `postgres`, and the project-scoped role `postgres.kdaixomygsuxadofoieb`, with TLS required. It does not use transaction-pooler port `6543`. Do not replace these values with a direct database host, a transaction pooler, or another project’s credentials.

## Dry run

Open PowerShell and change to the repository directory:

```powershell
Set-Location 'D:\neargrowads\neargrow-ads-new-mascot'
```

List the fixed migrations without opening a connection or executing SQL:

```powershell
& '.\scripts\apply-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql `
  -DryRun
```

Expected output lists migrations 4–34. Review the project ref and filenames before proceeding.

## Read-only connection and prerequisite check

After you verify the staging project ref in the Supabase Dashboard, this mode opens a Session Pooler connection, prompts for the staging database password, and executes only read-only prerequisite/history checks. It exits before generating or applying any migration driver:

```powershell
& '.\scripts\apply-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql `
  -PreflightOnly
```

Type the exact staging project ref when asked. Confirm that the output says prerequisite checks passed. Do not continue if a check fails or the displayed target differs from the verified staging project.

## Apply migrations 4–34

Run only after manually reviewing this script and the dry-run listing:

```powershell
& '.\scripts\apply-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql
```

The runner displays the fixed staging Session Pooler endpoint and project-scoped username, then asks you to type `kdaixomygsuxadofoieb`. It prompts for the staging database password for a read-only preflight and requires the exact text `I CONFIRM NO UNTRACKED MIGRATIONS 4-34 ARE APPLIED` after you inspect whether migrations were applied outside tracked history. Finally, it lists the pending files and requires the exact text `APPLY STAGING kdaixomygsuxadofoieb` before executing any migration.

Migrations are sent to `psql` in the fixed filename order, with `ON_ERROR_STOP` enabled. The first SQL error stops execution. Successfully completed earlier migrations are logged and skipped on a later run. A failed migration is never automatically retried because some SQL files contain multiple statements and may require inspection to determine whether any work was committed before the failure. Do not delete or edit the log to bypass this safeguard; reconcile the database state and migration history first.

The runner will not connect to Production, create administrator accounts, copy data, or invoke the Supabase CLI. It does not deploy the application.

## Read-only post-migration verification

After migrations complete, run the separate verifier. It is pinned to the same staging ref and Session Pooler endpoint, rejects Production, confirms the exact staging ref before connecting, isolates inherited PostgreSQL environment variables, and prompts for the staging database password without storing it. Its SQL contains read-only catalog/table/bucket/policy queries only; it does not call RPCs or modify schema/data.

```powershell
Set-Location 'D:\neargrowads\neargrow-ads-new-mascot'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

& '.\scripts\verify-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql
```

Type the staging project ref when prompted and enter the staging database password in the `psql` prompt. The report checks that the local runner log contains each of migrations 4–34 exactly once, expected CMS/admin/security/leads/activity relations and migration columns exist, invitation and temporary-password RPCs are `SECURITY DEFINER` and executable only by `service_role`, the three Storage buckets have expected visibility and size settings, Storage object RLS has no anonymous/authenticated/PUBLIC write policy, and leads are accessible through the server role rather than direct client grants. Exit code `0` means all checks passed; nonzero means one or more checks failed or the read-only verification could not complete.
