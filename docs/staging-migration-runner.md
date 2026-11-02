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

The local `.env` is not read by these PowerShell scripts and must not be copied, sourced, or used as a Staging configuration; it may contain Production-targeted application settings. Keep it unchanged. For application Preview work, use Vercel's Preview-scoped variables and manually verify that every Supabase URL/key and Admin identity pin belongs to `kdaixomygsuxadofoieb`. The local scripts are independently pinned to the Staging database endpoint and do not consume application environment variables.

If `supabase_migrations.schema_migrations` exists, the runner skips recorded migrations. The three prerequisite migrations applied manually may not appear in Supabase migration history; the runner checks their schema objects directly. Migration `20261031010000_complete_admin_temporary_password_setup.sql` is migration 35 and is verification-only: it is never executed by this script. Before a permanent-delete-only run, the runner verifies migration 35's actual objects and permissions, checks migration 36's required Admin columns and identity foreign keys in the live catalogs, checks ownership rights for existing tables/functions that migration 36 alters, and checks `TRIGGER` privilege on `auth.users`. Table ownership of `auth.users` is not required for `CREATE TRIGGER`. If migration history is available, migrations 4–34 must be accounted for by history or the private local runner log. If history is unavailable, the runner does not infer migration status from the log; it requires the migration-36 dependency-object checks to pass. This does not certify unrelated application migrations. If other migrations were applied manually and left untracked, reconcile that state before using the general 4–34 runner. The local log is the runner’s durable skip record when migrations are not present in Supabase’s migration history, so keep it backed up in a private local location.

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
Set-Location 'D:\neargrowads\neargrow-ads-new-mascot-recovery-preview'
```

List the fixed migrations without opening a connection or executing SQL:

```powershell
& '.\scripts\apply-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql `
  -DryRun
```

Expected output lists runner-managed migrations 4–34 and explicitly identifies migration 35 as verification-only. Review the project ref and filenames before proceeding. The rejected `20261030230000_retry_temporary_admin_password_expiry.sql` migration is not in the repository inventory or executable list. The separate `-PermanentDeleteOnly -DryRun` mode lists only migration 36.

## Read-only connection and prerequisite check

After you verify the staging project ref in the Supabase Dashboard, this mode opens a Session Pooler connection, prompts for the staging database password, and executes only read-only prerequisite/history checks. It exits before generating or applying any migration driver:

```powershell
& '.\scripts\apply-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql `
  -PreflightOnly
```

Type the exact staging project ref when asked. Confirm that the output says both prerequisite checks and manually applied migration object/permission checks passed. Do not continue if a check fails or the displayed target differs from the verified staging project.

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

## Apply migration 36 only

This feature must not re-run migrations 1–35. Before any Staging write:

1. Confirm a current Staging backup exists and that the authorized recovery path is usable. The runner does not create, validate, or restore backups.
2. Verify the dashboard project ref is `kdaixomygsuxadofoieb` and the supplied recovery backup is usable. The Migration 36-only path requires exactly one local success entry for each runner-managed migration 4–34, no known failed/extra success entries, passing migration-35 checks, and passing Migration 36 dependency/state checks. When Supabase migration history is unavailable, this evidence does not certify complete migration history or the absence of manual schema drift.
3. Use the runner's read-only feature preflight. It checks that the current role can create the `public` trigger function, has `TRIGGER` on `auth.users`, and owns or inherits owner privileges for the public tables/functions that migration 36 changes. It also requires Migration 36's target tables/functions/triggers to be absent and all 16 expected Admin foreign keys to match the pre-migration state exactly, rejecting unexpected or duplicate foreign keys. On an FK-state failure, `MIGRATION36_FK|...|FAIL|...` diagnostics identify the expected table/column or unexpected constraint. Ownership of `auth.users` is not required. For `public.leads`, it accepts either the three original policies or their absence only when anon/authenticated have no table- or column-level data privileges. Partial sets and client grants still fail. If a check fails, stop and have a Staging database owner resolve the specific permission issue; do not broaden Auth privileges.
4. Review the migration and its forward-recovery notes. Migration 36 runs in one transaction. If execution fails, stop and inspect before any retry; the runner records failures and will not automatically retry them.

Dry-run and read-only preflight:

```powershell
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

& '.\scripts\apply-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql `
  -PermanentDeleteOnly `
  -DryRun

& '.\scripts\apply-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql `
  -PermanentDeleteOnly `
  -PreflightOnly
```

Only after all gates pass, execute migration 36 alone:

```powershell
& '.\scripts\apply-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql `
  -PermanentDeleteOnly
```

The mode queues exactly `20261102100000_secure_archived_admin_permanent_deletion.sql`; it does not queue migrations 1–35. The evidence gate verifies runner log entries and the actual required pre-migration objects but does not assert that the entire database migration history is known or that no manual schema drift exists. Migration 35 remains verification-only. Do not use the normal 4–34 mode as a substitute for this command. Before applying, review the emitted evidence and type `I CONFIRM THE REPORTED MIGRATION 36 EVIDENCE IS REVIEWED; APPLY MIGRATION 36 ONLY`; the runner then still requires the separate `APPLY STAGING kdaixomygsuxadofoieb` write confirmation.

This migration preserves historical attribution in `admin_identity_history`, retargets the existing Admin/audit/ownership foreign keys, and adds a reservation trigger on `auth.users`. It does not remove existing Admins. There is no safe schema-only rollback after permanent deletions have occurred: do not drop the trigger/tables or retarget foreign keys as an ad hoc rollback. For an execution failure, use the transaction's rollback and then a reviewed forward repair. For a post-deletion data incident, use the approved Staging backup/restore procedure and reconcile Auth/database state before resuming.

PostgreSQL's [`CREATE TRIGGER` requirements](https://www.postgresql.org/docs/current/sql-createtrigger.html#SQL-CREATETRIGGER-NOTES) are `TRIGGER` privilege on the target table and `EXECUTE` privilege on the trigger function; ownership of `auth.users` is not required. This migration creates the function itself, so its executing role owns it and retains its owner privileges after the migration revokes execution from `PUBLIC`, `anon`, and `authenticated`. The migration also performs `ALTER TABLE` operations on existing `public` tables and `CREATE OR REPLACE`/`DROP FUNCTION` operations; the separate migration-DDL ownership preflight protects those owner-only operations.

## Read-only post-migration verification

After migrations complete, run the separate verifier. It is pinned to the same staging ref and Session Pooler endpoint, rejects Production, confirms the exact staging ref before connecting, isolates inherited PostgreSQL environment variables, and prompts for the staging database password without storing it. Its SQL contains read-only catalog/table/bucket/policy queries only; it does not call RPCs or modify schema/data.

```powershell
Set-Location 'D:\neargrowads\neargrow-ads-new-mascot-recovery-preview'
$psql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'

& '.\scripts\verify-staging-supabase-migrations.ps1' `
  -ProjectRef 'kdaixomygsuxadofoieb' `
  -PsqlPath $psql
```

Type the staging project ref when prompted and enter the staging database password in the `psql` prompt. The report checks that the local runner log contains migrations 4–34 and 36 exactly once, expected CMS/admin/security/leads/activity and permanent-deletion relations exist, RPC execution is restricted to `service_role`, the Auth email-reservation trigger is enabled and uses a `SECURITY DEFINER` function, identity-history foreign keys are in place, the three Storage buckets have expected visibility and size settings, Storage object RLS has no anonymous/authenticated/PUBLIC write policy, and leads are accessible through the server role rather than direct client grants. Exit code `0` means all checks passed; nonzero means one or more checks failed or the read-only verification could not complete. This verifier does not test the trigger by inserting into `auth.users` or exercise a real account.
