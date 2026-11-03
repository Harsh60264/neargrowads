# NearGrow Ads — Production Deployment Guide

## 1. Prerequisites

- Node.js 20+ and npm
- Supabase project with the reviewed migrations applied
- Vercel project connected to this repository for a complete serverless deployment, or a Node.js host with a durable writable volume for the standalone Express deployment

## 2. Environment Variables

For local development, create `.env` using `.env.example`. For Vercel, add these names in Project Settings → Environment Variables. Do not put secret values in `VITE_*` variables. Do not load or copy a Production-targeted local `.env` for Staging work; keep that file unchanged and use the Vercel Preview environment scope for the Staging application:

```bash
SITE_URL=https://www.neargrowads.com
VITE_SITE_URL=https://www.neargrowads.com
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_OWNER_USER_ID=
ADMIN_OWNER_EMAIL=
ADMIN_STAGING_SUPABASE_PROJECT_REF=
ADMIN_STAGING_OWNER_USER_ID=
ADMIN_STAGING_OWNER_EMAIL=
ADMIN_STAGING_SUPABASE_ANON_KEY=
ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY=
ADMIN_STAGING_SESSION_SECRET=
ADMIN_SESSION_SECRET=
RESEND_API_KEY=
ADMIN_INVITATION_EMAIL_FROM="NearGrow Ads <no-reply@neargrowads.com>"
```

`SITE_URL` must be `https://www.neargrowads.com` in Production; Vercel Production builds and production server startup reject missing, malformed, localhost, legacy, or other origins. Preview deployments may use their own HTTPS origin, and local development may use `http://localhost:<port>`. The Supabase/admin variables above are required for admin access; `ADMIN_OWNER_EMAIL` must be the lowercase email of the verified Auth user whose UUID is `ADMIN_OWNER_USER_ID`. The service role key and session secret must be server-only. Add optional `N8N_LEAD_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `CONTACT_NOTIFICATION_EMAIL`, `ADMIN_NOTIFICATION_EMAIL`, and Razorpay Test variables only when those features are configured. `PORT`, `NODE_ENV`, `PERSISTENT_DATA_DIR`, and `TRUST_PROXY_HOPS` are for the standalone Express host; Vercel manages its function runtime and proxy configuration.

`VITE_SITE_URL` is an optional public build-time origin used by client-rendered canonical metadata. For Preview, set it to `https://staging.neargrowads.com` if explicitly configured; it does not replace the required server-side `SITE_URL` and does not gate API initialization. Do not put credentials in any `VITE_*` variable.

Production must set `ADMIN_OWNER_EMAIL` to the current Primary Owner Auth email and `ADMIN_OWNER_USER_ID` to that same verified identity. This replaces the previous hardcoded email check without changing the Auth account or its credentials. Preview staging is pinned in code to project ref `kdaixomygsuxadofoieb` and URL `https://kdaixomygsuxadofoieb.supabase.co`; Preview rejects another ref even if its URL matches. Set `ADMIN_STAGING_SUPABASE_PROJECT_REF` to that exact ref. Set `ADMIN_STAGING_OWNER_USER_ID` and `ADMIN_STAGING_OWNER_EMAIL` to the separately created disposable staging Auth identity, and make `ADMIN_OWNER_USER_ID` and `ADMIN_OWNER_EMAIL` match those staging-only pins. If the Production Owner's ID/email are available for comparison, set `ADMIN_PRODUCTION_OWNER_USER_ID` and `ADMIN_PRODUCTION_OWNER_EMAIL` in Preview; the application rejects a matching staging owner. These are identity values, not credentials. Set `ADMIN_STAGING_SUPABASE_ANON_KEY` and `ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY` to the staging project's keys, and set `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the matching staging keys. The service-role key and session secret are server-only. Where Supabase keys are project-bound JWTs, Preview also validates their role and embedded project ref and rejects keys bound to Production. Never use Production credentials or connect the Production deployment to staging. At startup, Preview validates all these bindings before creating routes or making Supabase requests. Vercel Function initialization does not create or repair an existing Primary Owner record; create the matching `public.admin_users` row manually in staging only after verifying the staging Auth identity and database state. Existing CMS rows must already be active `owner` records with `is_primary_owner=true`; application startup will not promote, repair, or alter existing roles, permissions, sessions, or passwords.

Vercel Preview isolation checklist:

1. In Project Settings → Environment Variables, edit the existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_OWNER_USER_ID`, `ADMIN_OWNER_EMAIL`, `ADMIN_SESSION_SECRET`, and `SITE_URL` values so the Preview scope contains only staging values. Keep Production values scoped to Production and unchanged. Do not copy the service-role key or session secret between scopes.
2. Set Preview `SUPABASE_URL=https://kdaixomygsuxadofoieb.supabase.co` and `ADMIN_STAGING_SUPABASE_PROJECT_REF=kdaixomygsuxadofoieb`. Supply the staging anon and service-role keys in both their normal `SUPABASE_*` settings and the corresponding `ADMIN_STAGING_SUPABASE_*` pin variables. These paired values must be identical and must come from the staging project.
3. Set Preview `ADMIN_STAGING_OWNER_USER_ID` and `ADMIN_STAGING_OWNER_EMAIL` to the staging-only Auth user; set `ADMIN_OWNER_USER_ID` and `ADMIN_OWNER_EMAIL` to exactly those same values. Use a staging-only owner identity, not the Production Primary Owner.
4. Generate a unique random Preview `ADMIN_SESSION_SECRET` (at least 32 characters), and set the Preview-only `ADMIN_STAGING_SESSION_SECRET` pin to exactly that same value. Preview `SITE_URL` must equal the HTTPS origin used for the Preview deployment, not `https://www.neargrowads.com`. Configure `RESEND_API_KEY` and sender identity separately if testing invitation delivery.
5. Save and redeploy Preview so its server and Vite build use the Preview-scoped settings. Verify configuration on the Preview deployment before creating any staging Auth or CMS account. Never place secret values in tickets, logs, source control, or `VITE_*` variables.

Opaque non-JWT Supabase keys do not expose a project ref that the application can independently verify. For those keys, the validation checks the explicit Preview-only key pins against the runtime keys; a human must ensure both are copied from the staging project in Vercel. Vercel’s environment scopes are not visible to application code. Keep staging Preview variables scoped to Preview and Production values scoped to Production.

`RESEND_API_KEY` and `ADMIN_INVITATION_EMAIL_FROM` are required for new administrator identities that receive a temporary password by email. Verify the sender domain/address with Resend first. The password is generated by the server by default, is never returned to the browser or written to the database/logs/audit records, expires after 24 hours for CMS access, and can create only one CMS setup session. Application login atomically consumes that one-time eligibility; every protected CMS request reloads account and session state and denies expired credentials. No scheduler or Supabase Auth password rotation is used for expiry enforcement. Supabase Auth may still accept the password and issue Auth tokens after the application expiry; those tokens are not NearGrow CMS sessions. The repository migrations revoke direct access to private CMS tables and privileged RPCs, but verify the deployed staging grants, RLS policies, function privileges, Storage policies, applied `20261025180000_harden_leads_access_and_consent.sql` migration and service-role secrecy before relying on that separation. Public website data and intentionally public media remain public. If email delivery fails, the new Auth identity is invalidated and removed where possible; there is no automatic resend of the same password. Existing Supabase Auth identities are not assigned a new password and continue through the existing verification/recovery-link flow.

## 3. Local Development

```bash
npm install
npm run dev
```

The application runs on `http://localhost:3000` with the Express API and Vite frontend active.

## 4. Production Build

```bash
npm run build
npm start
```

Set `SITE_URL=https://www.neargrowads.com` for Production and the matching Preview origin when testing a Preview deployment. The same value is used for build-time canonical and structured-data URLs and server-generated Supabase Auth redirects. Production rejects any other origin.

Set `TRUST_PROXY_HOPS` only to the exact number of trusted reverse proxies in front of Express. The default `0` ignores forwarded headers. Configure the edge proxy to replace, not append to, untrusted forwarding headers. The current in-process rate limiter does not share state across multiple instances; use a shared rate-limit store or a single instance before horizontally scaling.

Keep `.env` and all deployment secrets outside source archives. A shareable export may contain `.env.example` only; do not include `.env`, `node_modules`, `dist`, or `data/uploads`.

### Durable blog, team and upload storage

For a standalone Express host, blog posts/categories, team records, legacy site-content fallback, and blog/team/service-store uploads are filesystem-backed. Production requires `PERSISTENT_DATA_DIR`; mount a durable writable volume there and use a single writer instance.

Vercel Functions instead persist those five CMS JSON documents in `serverless_cms_documents` and media in the Supabase `cms-uploads` bucket. Apply `supabase/migrations/20261027150000_create_serverless_cms_documents.sql` before the first Vercel deployment that uses these stores. Review the current repository `data` documents and uploads, then run `npm run migrate:cms` locally with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set in a protected environment. The importer inserts only missing documents and uploads only missing assets; it does not overwrite or delete existing Supabase rows or objects. Back up the files and review the command output before proceeding. No migration has been run by this code change.

Vercel admin media uploads use short-lived Supabase signed upload URLs so file bytes go directly from the browser to Storage instead of exceeding Vercel Function request limits. The server verifies object size, MIME metadata, and file signature before returning a media URL. The browser never receives a Supabase service-role credential.

## 5. Supabase Database Setup

For an isolated staging project whose first three migrations were applied manually, use the reviewed Windows PowerShell runner in [staging-migration-runner.md](./staging-migration-runner.md). It uses direct PostgreSQL 18 `psql` with a project-ref-derived staging host and does not use the local Supabase CLI link. Review and dry-run the fixed migration 4–34 list before any manual execution.

1. Create a Supabase project at `https://database.new`.
2. Open the SQL Editor and execute `supabase/migrations/20261015000000_create_leads_table.sql`.
3. Apply all remaining SQL files in `supabase/migrations` in timestamp order. This includes `supabase/migrations/20261025210000_add_service_catalogue_categories.sql` before deploying managed Service Store categories. It creates the category table, links existing packages to case/whitespace-normalized categories without changing package status or content, and grants category-table access only to the existing server-side `service_role` flow. Review the migrated categories’ active/display settings in Service Store after deployment; the migration keeps migrated categories active and shown in the Catalogue by default.
4. Existing admin installations must apply `supabase/migrations/20261020000000_admin_account_management.sql` before using username aliases, password-reset metadata, or configurable Super Admin permissions.
5. Verify that Row Level Security (RLS) is active on the `public.leads` table and the admin tables. See the Supabase Auth and server-only environment setup in `README.md`.
6. Before deploying the invitation-recovery code, review and apply `supabase/migrations/20261028200000_secure_admin_invitation_recovery.sql` through the normal staging/production migration process. Confirm that the earlier admin identity and account-management migrations have created `admin_users`, `admin_sessions`, `admin_audit_logs`, `username`, and `must_change_password`; these are required by the recovery functions. The base admin migration enables RLS and grants table access to `service_role`; this migration limits both new/replaced RPCs to `service_role` and requests a PostgREST schema reload.

   This migration adds a nullable invitation-generation column, drops the older three-argument completion RPC, and creates a generation-bound replacement plus a locked Primary-Owner recovery RPC. Existing rows are not rewritten: pending rows with a NULL generation cannot complete from an old link and must be reissued by a reauthenticated Primary Owner. Disabled rows remain disabled until a fresh verified onboarding transaction; recovery retains the Auth identity, clears CMS permissions and username, and records the reissue event.

   Use a coordinated maintenance window for invitation completion and recovery. Apply the migration first, confirm the schema reload and RPC availability, then deploy the matching application immediately. Until deployment completes, the old application’s three-argument RPC call will fail closed because that signature has been removed; the new application must not serve recovery requests before the migration exists. Verify a fresh staged invitation end-to-end before enabling Owner recovery in production. Old setup links must be resent from Admin Accounts. The application does not apply this migration automatically.

7. For administrator invitation archival, apply `supabase/migrations/20261028230000_admin_account_archiving.sql` after the invitation-recovery migration and before deploying the matching application. This migration adds a soft-archive timestamp and Primary-Owner-only RPCs; it rotates invitation generations when cancelling or archiving and clears the archive timestamp only when a fresh recovery link is prepared. It retains Auth users and audit history. Pending invitations must be cancelled before they can be archived. Supabase does not expose a reliable per-invitation expiry timestamp in this flow, so unverified pending invitations are not marked expired or archived as expired.

   For an existing Production project, verify the migration version `20261028230000` is listed as applied in the Supabase Dashboard migration history before enabling these routes. Also confirm `public.admin_users.archived_at` and the `cancel_admin_invitation`, `prepare_admin_invitation_recovery`, and `archive_admin_account` RPCs exist with execution restricted to `service_role`. Use the Dashboard's schema/function inspectors or read-only catalog inspection; do not invoke the mutation RPCs as a verification step. If the version is absent, do not deploy the matching application until the migration is reviewed and applied through the normal production process.

Before deploying this repair, review and apply `supabase/migrations/20261025180000_harden_leads_access_and_consent.sql` to staging first. Confirm the current policies and grants, verify authorized leads access through the server API, and verify direct anonymous/authenticated access is denied. Apply it to production only through the normal reviewed migration process; the application never applies database migrations automatically.

Apply `supabase/migrations/20261021130000_create_site_content_cms.sql` to enable the Page Content Manager's private draft and published content records. The server accesses this table with the server-only Supabase service role; browser clients cannot read or write it directly. Existing file-based website content remains the initial fallback until a new draft is published.

Apply `supabase/migrations/20261021170000_create_site_media_storage_bucket.sql` to provision the public-read `site-media` bucket used by Page Content Manager uploads. Upload signing and verification require the server-side admin session and section permissions. The browser receives a short-lived URL scoped to one random object path, never a service-role credential. The bucket allows JPG, PNG, WebP, MP4, and WebM files up to 100 MB (images are limited to 15 MB by the server). Uploaded assets are immutable and replacements use new object names so existing published pages remain intact until the new draft is published.

The Page Content Manager's Images & Media and Animations & Effects settings are stored in the existing `site_content_cms` JSON draft/published columns. No additional database migration is needed for animation settings; publish them through the CMS after applying the site content migration.

The Primary Owner can create independent Co-Owner, Super Admin, and Custom Admin Auth identities in Settings. New identities receive a randomly generated, 24-hour temporary password by branded email by default; CMS actions are backend-blocked until that one-time setup session changes the password. Existing Auth identities are never assigned a new password and use the existing email-verification/recovery flow. Custom permissions remain enforced by the CMS backend. The service-role key must remain server-side; never expose it through a `VITE_` variable or send it to the browser.

### Service Store orders and Razorpay Test checkout

Apply `supabase/migrations/20261022150000_create_service_orders_and_payment_settings.sql` after the existing catalogue/enquiry migrations. Configure `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`, and `RAZORPAY_TEST_WEBHOOK_SECRET` only in the server/deployment secret manager. The key ID must be a Razorpay `rzp_test_` key. Configure the Razorpay Test webhook URL as `/api/payments/razorpay/test-webhook` and subscribe it to `payment.captured`.

The Primary Owner must reauthenticate, verify the Test API credentials, and explicitly enable Test mode in Service Store → Store Settings → Payment Receiving. The CMS does not accept Live credentials, direct UPI identifiers, or bank details. Razorpay settlement details remain provider-managed. Test payments do not transfer funds and cannot be fulfilled as real customer orders. Secure tracking tokens are returned at checkout and are not stored in plaintext.

## 6. Hosting and deployment

### Production permanent-delete release preparation

The verified Staging release commit is `db86fb85961c670497cffcac54ee7803547e6982`; it is based on the Staging-specific `6f83b04` history, not Production `main` commit `74fd6ccc6a8b6daa953035cf6c8f64d454e2cda0`. Do not promote the Staging commit wholesale: its changes include Staging migration-runner work. Prepare the Production release on `74fd6cc` with only the Admin permanent-delete UI/API, schema-compatible Admin history lookups, callback analytics privacy change, Production preflight/post-check scripts, relevant tests/docs, and `supabase/migrations/20261102100000_secure_archived_admin_permanent_deletion.sql`. Keep unrelated Admin or website changes out of the release. The local Supabase CLI configuration, recovery template, and `supabase/.branches/` state are not Production settings or deployment inputs. SQL regression tests are test-only; do not run them against a hosted project.

The following scripts are **read-only checks**, not migration runners. They require the exact Production project ref and use the Dashboard-verified Session Pooler at `aws-0-ap-northeast-2.pooler.supabase.com:5432`, database `postgres`, and user `postgres.axbjzmdokfoftzfgwiql`, with TLS certificate verification. They require PostgreSQL 18 `psql` and set the session read-only before querying. They prompt for the exact ref before connecting. They do not accept a host override, run DDL/DML, modify migration history, or change Admin accounts. They require the PostgreSQL root certificate described in `scripts/psqlEnvironment.ps1`. If the verified pooler endpoint is unreachable from the operator's network, stop and use an independently reviewed read-only route; do not weaken the endpoint/ref guard or substitute Staging credentials.

This Production-specific workflow supersedes generic guidance below to apply all unapplied repository migrations: do not bulk-apply missing versions. Reconcile migration history and live schema first, then consider only Migration 36 for this release.

```powershell
.\scripts\verify-production-admin-permanent-deletion-preflight.ps1 -ProjectRef axbjzmdokfoftzfgwiql
.\scripts\verify-production-admin-permanent-deletion-post-migration.ps1 -ProjectRef axbjzmdokfoftzfgwiql
```

The default preflight reports every local migration filename/version against `supabase_migrations.schema_migrations`. It distinguishes an absent schema/table, inaccessible table, readable-but-empty ledger, and readable ledger. With a readable ledger it requires all repository migrations before Migration 36 to be recorded with matching names. This includes `20261031010000_complete_admin_temporary_password_setup.sql`: the repository only documents its manual SQL-Editor application on Staging, which is not evidence of Production execution. It rejects missing/renamed history, unknown database versions, an already-recorded Migration 36, and partial Migration 36 objects. A missing or ambiguous history row is not evidence that a migration is unapplied.

If Production's Supabase CLI ledger is absent or unreadable, a schema-evidence-only check is available:

```powershell
.\scripts\verify-production-admin-permanent-deletion-preflight.ps1 -ProjectRef axbjzmdokfoftzfgwiql -SchemaEvidenceFallback
```

This mode still requires every live Migration 36 prerequisite to pass: Admin/CMS tables and required columns, the Auth identity cascade FK, 16 exact Admin FKs, core table RLS and service-role/client grants, UUID generation, deployed temporary-password setup safeguards and RPC grants, Production/Auth trigger permissions, and proof that no Migration 36 object is partially installed. The Auth, Realtime, and Storage service-owned migration tables are not treated as application migration-history candidates; any other candidate is reported and blocks fallback pending reconciliation. The verifier explicitly reports when application migration execution history is unavailable. It never writes migration history, infers applied versions, or treats a partial/unexpected schema as ready. `SCHEMA EVIDENCE PASS` establishes only that the current live database satisfies Migration 36's checked preconditions; it does **not** prove which historical migrations ran or that all migrations 1–35 were applied. A readable but incomplete or mismatched Supabase ledger is never bypassed by this fallback.

Evidence review found no GitHub Actions workflows/runs for this repository and no local Git tags or Production migration execution log. The repository runbook's manual SQL Editor application record for `20261031010000_complete_admin_temporary_password_setup.sql` is explicitly Staging-only. Production deployment records may exist in Vercel or the Supabase Dashboard, which were not available to this local review. Before approving Migration 36 under fallback, an authorized reviewer must reconcile the Production Vercel release/commit and any Supabase SQL Editor or external migration records with the live schema evidence. If that evidence conflicts with the schema, stop.

The preflight also checks the deployed Admin/CMS prerequisites, PostgreSQL role and `auth.users` trigger privilege, and the exact pre-migration topology of all 16 Admin foreign keys.

The application compatibility release must go first while the existing schema is still in place. Its Admin history reads resolve identities from `admin_users` before Migration 36 and from `admin_identity_history` afterwards; it also keeps permanent deletion unavailable until both the migration state RPC and identity-history table are present. A partial schema mismatch returns an error rather than exposing deletion. Its email-reservation check is a no-op only while both the reservation and identity-history tables are absent; if the identity-history table exists but reservations do not, invitation requests fail closed. Confirm the new application is live and ordinary Admin, audit, ownership, and invitation screens work before applying SQL.

After that compatibility release is serving traffic, an approved operator applies only the reviewed Migration 36 through the normal Production change process, then runs the post-migration verifier. It requires the migration ledger entry and checks all four enabled triggers, exact `SECURITY DEFINER` RPC signatures/search paths and service-role-only execute permissions, RLS/table privileges, identity-history backfill, and all 16 Admin foreign keys. Fifteen historical Admin references must target `admin_identity_history`; `admin_sessions.user_id` intentionally continues to target `admin_users`. Any failed check means stop and keep the compatibility release in place while investigating; do not restore the pre-Migration-36 application after the schema transition.

When the Production application migration ledger is confirmed absent or empty, the post-migration verifier also has a strict read-only schema-evidence mode:

```powershell
.\scripts\verify-production-admin-permanent-deletion-post-migration.ps1 -ProjectRef axbjzmdokfoftzfgwiql -SchemaEvidenceOnly
```

This mode checks the exact Migration 36 table columns, defaults and constraints/indexes; required routine signatures and implementation clauses; trigger definitions and enablement; function/table privileges and RLS; identity-history backfill; the three Migration 36 foreign keys; and all 16 historical Admin foreign keys. It accepts only an absent or empty application ledger, fails if the ledger is readable/inaccessible/malformed or an alternate migration-history candidate exists, and never records or infers a migration version. It reports `SCHEMA EVIDENCE PASS` separately from `MIGRATION HISTORY: NOT VERIFIED`; that result is **not proof that migrations 1–35 ran**. If the application ledger is readable, use the normal history-based verifier instead; its requirements are unchanged. Unnamed or ambiguous SQL Editor entries are not treated as migration execution evidence.

Release order is: (1) preflight PASS and application-history evidence reviewed; (2) backup/recovery gate confirmed; (3) deploy the compatibility application from the clean Production-main-based feature-only release and verify it against the pre-Migration-36 schema; (4) apply only Migration 36; (5) require post-migration verification PASS and recheck Admin/audit/ownership/invitation views; (6) only then enable use of permanent deletion through the approved process and perform non-destructive health/login checks. Keep the compatibility application serving throughout the schema transition. After Migration 36 starts, recover forward with a reviewed repair and keep deletion disabled on any mismatch; do not redeploy the old Production application or reverse/drop schema objects. If recovery requires restoring the database, use the authorized in-place recovery procedure and coordinate maintenance because later writes can be lost.

#### Backup and recovery gate

Before any Production change, in the existing Production project's Supabase Dashboard, confirm that the plan's automated backup/PITR coverage includes the intended change window and database/Auth schema, record the latest usable recovery point and retention expiry, and confirm the authorized operator's in-place restore procedure and recovery access. This preparation does not create a backup, database, or Supabase project and does not initiate a restore. If the backup window, Auth coverage, or recovery authority cannot be confirmed, do not proceed.

Migration 36 is not an application-level reversible change. The compatibility application is the minimum safe serving version on either side of the migration; the prior application release is not a safe post-migration rollback. Do not try to undo the database migration by dropping tables, constraints, or triggers. Database recovery would require the approved restore procedure in the existing Production project. A point-in-time database restore can discard all later database changes, including customer and Auth changes, so it requires incident/change approval, an explicit recovery timestamp, and coordinated maintenance. The supplied pre-migration archive was readable and its object list includes Auth and affected Admin data, but no full restore has been tested. Treat it as backup evidence, not proof of restoreability; confirm recovery authority/procedure and document the residual restore risk before approval. Re-verify the resulting migration history and schema before re-enabling the application.

Known hosted Auth limitation: deleting the Auth identity prevents refresh-token renewal but cannot guarantee immediate invalidation of already-issued access JWTs; those may remain valid until expiry. The workflow revokes NearGrow CMS sessions. Production must continue to deny direct access to private CMS data through Auth-token grants/RLS and accept the remaining JWT lifetime, or treat this as a release blocker if immediate global token invalidation is required.

### Admin invitation security and email templates

The invitation-session isolation, callback hardening, session-management authorization, and Admin Accounts accordion changes do not require a new database migration. Keep the existing `20261028200000_secure_admin_invitation_recovery.sql` and `20261028230000_admin_account_archiving.sql` schema in place; do not reapply or edit those migrations for this release.

Apply `supabase/migrations/20261029100000_admin_temporary_password_lifecycle.sql` to the staging Supabase project before testing temporary-password onboarding. It adds expiry/use timestamps and an atomic one-time CMS-login consumption RPC; it does not store passwords or require a scheduler. The follow-up `supabase/migrations/20261031010000_complete_admin_temporary_password_setup.sql` was manually applied and verified on Staging through the SQL Editor. Do not reapply it: the staging migration runner treats it as verification-only, checks the live schema objects and function/table permissions, and never queues it for execution. It makes the active-session RPC enforce expiry using the database clock and atomically completes first-password setup only for an active, unexpired account with a valid CMS session, revokes other CMS sessions and records an idempotent audit event. Apply `supabase/migrations/20261029230000_allow_delegated_coowner_invitation_cancellation.sql` after the existing account-archiving migration and before deploying this cancellation behavior. It replaces only the cancellation RPC so the Primary Owner can cancel a pending delegated Co-Owner while the `is_primary_owner` guard still rejects the actual Primary Owner record. Apply all previously unapplied migrations in filename order. No migration is run automatically by this repository.

Before production rollout, configure Preview `SITE_URL`, a staging Supabase project, and a Resend-verified sender. Verify invitations for new Co-Owner, Super Admin, and Custom Admin identities; verify manual-password strength validation; confirm the branded temporary-password email and separate Supabase email-verification message; verify the 24-hour expiry, atomic one-time CMS login claim under concurrent attempts, first-login password replacement, rejected expired first-password setup, and denial of CMS APIs for expired credentials and stale sessions. Also test existing-identity recovery, failed Resend delivery (the new account must be invalidated and retry must create a fresh credential), cancellation/archival, rejection of a cancelled/old-generation link, and completion while another administrator session is active in the same browser. The callback must require that browser session to be signed out before it will enable or complete setup. The completion API independently enforces this check. Verify direct Supabase Auth tokens cannot read or mutate privileged CMS data under the actual staging grants, RLS policies and function privileges; Auth password acceptance itself is not expired by this CMS-only policy.

The branded Supabase Auth templates and sender/provider configuration are separate manual settings. Install and preview the **Confirm signup** and **Reset password** templates from [the Supabase Admin Auth email-template guide](./supabase-admin-auth-email-templates.md) under **Authentication → Email Templates**. Keep the Supabase SMTP provider configured for verification and recovery links. Confirm the callback URL allow-list includes `https://www.neargrowads.com/admin/accept-invite` and `https://www.neargrowads.com/admin/password-reset`; do not copy credentials, temporary passwords, or tokens into Supabase templates.

Safe rollout order: (1) verify the isolated staging Supabase schema, migration history and access controls before touching it; confirm `20261025180000_harden_leads_access_and_consent.sql` is applied because its predecessor allowed authenticated users to read/update leads, and confirm the rejected `20261030230000_retry_temporary_admin_password_expiry.sql` version was never applied; if it was, stop and review the existing rotation state before proceeding; (2) apply the reviewed lifecycle migration only if it is not already present; the setup-completion migration `20261031010000_complete_admin_temporary_password_setup.sql` has already been manually applied on Staging and must not be rerun—verify its live objects and permissions with the staging verifier; (3) deploy the reviewed app to staging with staging-only secrets and test the existing Primary Owner login and password-recovery flow before creating any disposable Admin; (4) test temporary-password expiry, one-time consumption, protected CMS routes, first-password setup and direct Auth-token access; (5) proceed only if staging proves there is no privileged access outside the CMS. Apply all unapplied production migrations in filename order and deploy separately after staging approval. No production SQL, hosted setting, credential, commit, push, or deployment is changed automatically by this repository update. Manually verify:

- The callback URL is cleared after processing, response headers use `Referrer-Policy: no-referrer`, and a recipient is never signed into the existing browser administrator session.
- A new invite activates only the recipient's verified Auth identity and requires that recipient to set their own password; recovery keeps the existing Auth identity.
- Temporary-password onboarding emails are accepted by the configured provider, state a 24-hour expiry and mandatory replacement, and do not claim inbox delivery. Expired credentials cannot create/use a CMS session; replacing the password clears the temporary state and invalidates the old password.
- The Primary Owner can view and revoke administrator sessions after reauthentication; other roles do not see the session-management panel and cannot revoke another account's session through the API.
- Admin Account cards are collapsed initially, keyboard-operable, and preserve unsaved edits when switching accounts.

### Vercel (full-stack)

`vercel.json` builds the Vite frontend into `dist`, rewrites `/admin` and known client-side routes to `index.html`, and leaves `/api/*` to the Vercel Function at `api/[...path].ts`. That Function lazily creates the existing Express app without binding a persistent port or serving static files. Vercel serves `dist` assets; API requests are same-origin. `/uploads/...` is routed to the API's safe public Storage redirect.

1. Connect the GitHub repository to Vercel and use the repository root as the project root.
2. Keep the framework preset at Vite (or Other if automatic detection does not identify Vite); use `npm run build` and `dist`. Do not add a catch-all rewrite that sends `/api/*` to the SPA.
3. Configure the Preview `SITE_URL` to the Preview deployment's HTTPS origin and Production `SITE_URL` to exactly `https://www.neargrowads.com`. In Supabase Auth URL Configuration, set the Site URL to `https://www.neargrowads.com` and allow-list `https://www.neargrowads.com/admin/accept-invite` and `https://www.neargrowads.com/admin/password-reset`. Preview/local callback origins should be allow-listed only for the corresponding non-production Supabase project. Configure server-only Preview and Production `RESEND_API_KEY` and `ADMIN_INVITATION_EMAIL_FROM` values.
4. Apply all reviewed Supabase migrations in order, including `20261029100000_admin_temporary_password_lifecycle.sql` and the serverless CMS migration. Run the CMS importer only after reviewing and backing up its source files and destination.
5. After Preview verification with a staging Supabase project, install the reviewed Confirm signup and Reset password templates from [the Supabase email-template guide](./supabase-admin-auth-email-templates.md). Those CMS flows must use the allow-listed `{{ .RedirectTo }}` and one-time `{{ .TokenHash }}` callback because the email recipient may open the link in a different browser. Keep `{{ .ConfirmationURL }}` only for manually issued Supabase invitations. Then deploy the application through the approved Vercel process; this repository does not change hosted settings or deploy automatically.
6. Verify `/`, `/admin`, `/api/health`, a protected admin endpoint (401 without a session), browser assets, authenticated invite and password-reset flows with an explicitly authorized test account, and a refreshed nested route. Do not test by changing production owner or customer data.

### Standalone Express or Netlify

For a standalone Node.js host, run `npm start` behind a reverse proxy configured to replace untrusted forwarding headers, and provide a durable `PERSISTENT_DATA_DIR`. Its in-process rate limits and CMS mutation queue are not shared across replicas; use one instance or add a shared persistent coordination service before scaling horizontally. Netlify's current configuration publishes only the static frontend: its SPA fallback does not run Express or provide `/api/*`, so it is not a full-stack deployment target for this application.

Vercel Functions remove dependence on a permanent Express process and local disk. Serverless CMS JSON documents use database version checks; a concurrent stale save fails instead of silently overwriting the newer document. Process-local throttling/caches and serial mutation queues are still not shared across invocations. Treat rate limiting as a deployment requirement: configure Vercel Firewall limits for public and authentication endpoints before exposing the deployment. Test payments remain in Test mode; this integration does not enable live payments or change payment destinations.
