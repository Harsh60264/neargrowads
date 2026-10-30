# NearGrow Ads — Production Deployment Guide

## 1. Prerequisites

- Node.js 20+ and npm
- Supabase project with the reviewed migrations applied
- Vercel project connected to this repository for a complete serverless deployment, or a Node.js host with a durable writable volume for the standalone Express deployment

## 2. Environment Variables

For local development, create `.env` using `.env.example`. For Vercel, add these names in Project Settings → Environment Variables. Do not put secret values in `VITE_*` variables:

```bash
SITE_URL=https://www.neargrowads.com
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
ADMIN_TEMP_PASSWORD_EXPIRY_CRON_SECRET=
```

`SITE_URL` must be `https://www.neargrowads.com` in Production; Vercel Production builds and production server startup reject missing, malformed, localhost, legacy, or other origins. Preview deployments may use their own HTTPS origin, and local development may use `http://localhost:<port>`. The Supabase/admin variables above are required for admin access; `ADMIN_OWNER_EMAIL` must be the lowercase email of the verified Auth user whose UUID is `ADMIN_OWNER_USER_ID`. The service role key and session secret must be server-only. Add optional `N8N_LEAD_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `CONTACT_NOTIFICATION_EMAIL`, `ADMIN_NOTIFICATION_EMAIL`, and Razorpay Test variables only when those features are configured. `PORT`, `NODE_ENV`, `PERSISTENT_DATA_DIR`, and `TRUST_PROXY_HOPS` are for the standalone Express host; Vercel manages its function runtime and proxy configuration.

Production must set `ADMIN_OWNER_EMAIL` to the current Primary Owner Auth email and `ADMIN_OWNER_USER_ID` to that same verified identity. This replaces the previous hardcoded email check without changing the Auth account or its credentials. Preview staging is pinned in code to project ref `kdaixomygsuxadofoieb` and URL `https://kdaixomygsuxadofoieb.supabase.co`; Preview rejects another ref even if its URL matches. Set `ADMIN_STAGING_SUPABASE_PROJECT_REF` to that exact ref. Set `ADMIN_STAGING_OWNER_USER_ID` and `ADMIN_STAGING_OWNER_EMAIL` to the separately created disposable staging Auth identity, and make `ADMIN_OWNER_USER_ID` and `ADMIN_OWNER_EMAIL` match those staging-only pins. If the Production Owner's ID/email are available for comparison, set `ADMIN_PRODUCTION_OWNER_USER_ID` and `ADMIN_PRODUCTION_OWNER_EMAIL` in Preview; the application rejects a matching staging owner. These are identity values, not credentials. Set `ADMIN_STAGING_SUPABASE_ANON_KEY` and `ADMIN_STAGING_SUPABASE_SERVICE_ROLE_KEY` to the staging project's keys, and set `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` to the matching staging keys. The service-role key and session secret are server-only. Where Supabase keys are project-bound JWTs, Preview also validates their role and embedded project ref and rejects keys bound to Production. Never use Production credentials or connect the Production deployment to staging. At startup, Preview validates all these bindings before creating routes or making Supabase requests. Vercel Function initialization does not create or repair an existing Primary Owner record; create the matching `public.admin_users` row manually in staging only after verifying the staging Auth identity and database state. Existing CMS rows must already be active `owner` records with `is_primary_owner=true`; application startup will not promote, repair, or alter existing roles, permissions, sessions, or passwords.

Vercel Preview isolation checklist:

1. In Project Settings → Environment Variables, edit the existing `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_OWNER_USER_ID`, `ADMIN_OWNER_EMAIL`, `ADMIN_SESSION_SECRET`, and `SITE_URL` values so the Preview scope contains only staging values. Keep Production values scoped to Production and unchanged. Do not copy the service-role key or session secret between scopes.
2. Set Preview `SUPABASE_URL=https://kdaixomygsuxadofoieb.supabase.co` and `ADMIN_STAGING_SUPABASE_PROJECT_REF=kdaixomygsuxadofoieb`. Supply the staging anon and service-role keys in both their normal `SUPABASE_*` settings and the corresponding `ADMIN_STAGING_SUPABASE_*` pin variables. These paired values must be identical and must come from the staging project.
3. Set Preview `ADMIN_STAGING_OWNER_USER_ID` and `ADMIN_STAGING_OWNER_EMAIL` to the staging-only Auth user; set `ADMIN_OWNER_USER_ID` and `ADMIN_OWNER_EMAIL` to exactly those same values. Use a staging-only owner identity, not the Production Primary Owner.
4. Generate a unique random Preview `ADMIN_SESSION_SECRET` (at least 32 characters), and set the Preview-only `ADMIN_STAGING_SESSION_SECRET` pin to exactly that same value. Preview `SITE_URL` must equal the HTTPS origin used for the Preview deployment, not `https://www.neargrowads.com`. Configure `RESEND_API_KEY`, sender identity, and expiry scheduler secret separately if testing invitation delivery.
5. Save and redeploy Preview so its server and Vite build use the Preview-scoped settings. Verify configuration on the Preview deployment before creating any staging Auth or CMS account. Never place secret values in tickets, logs, source control, or `VITE_*` variables.

Opaque non-JWT Supabase keys do not expose a project ref that the application can independently verify. For those keys, the validation checks the explicit Preview-only key pins against the runtime keys; a human must ensure both are copied from the staging project in Vercel. Vercel’s environment scopes are not visible to application code. Keep staging Preview variables scoped to Preview and Production values scoped to Production.

`RESEND_API_KEY` and `ADMIN_INVITATION_EMAIL_FROM` are required for new administrator identities that receive a temporary password by email. Verify the sender domain/address with Resend first. `ADMIN_TEMP_PASSWORD_EXPIRY_CRON_SECRET` must be a random server-only secret of at least 32 characters and must also be configured on a trusted scheduler. Keep all three values server-side and configure separate values for Preview and Production. The password is generated by the server by default, is never returned to the browser or written to the database/logs/audit records, expires after 24 hours, and is allowed to claim only one setup session. Supabase Auth accepts an administrator-created password but does not itself enforce CMS first-login replacement or an application-specific expiry; the CMS backend enforces the password-change gate and atomic one-time claim, while the scheduler invalidates expired Supabase Auth passwords. The CMS login path also invalidates an expired credential before issuing a CMS session. If email delivery fails, the new Auth identity is invalidated and removed where possible; there is no automatic resend of the same password. Existing Supabase Auth identities are not assigned a new password and continue through the existing verification/recovery-link flow.

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

### Admin invitation security and email templates

The invitation-session isolation, callback hardening, session-management authorization, and Admin Accounts accordion changes do not require a new database migration. Keep the existing `20261028200000_secure_admin_invitation_recovery.sql` and `20261028230000_admin_account_archiving.sql` schema in place; do not reapply or edit those migrations for this release.

Apply the incremental `supabase/migrations/20261029100000_admin_temporary_password_lifecycle.sql` migration to the staging Supabase project before testing temporary-password onboarding. It adds only expiration/use timestamps and an atomic one-time setup-session claim; it does not store passwords. Apply `supabase/migrations/20261029230000_allow_delegated_coowner_invitation_cancellation.sql` after the existing account-archiving migration and before deploying this cancellation behavior. It replaces only the cancellation RPC so the Primary Owner can cancel a pending delegated Co-Owner while the `is_primary_owner` guard still rejects the actual Primary Owner record. Apply all previously unapplied migrations in filename order. No migration is run automatically by this repository.

Before production rollout, configure Preview `SITE_URL`, a staging Supabase project, a Resend-verified sender, and a trusted scheduler that calls `GET /api/cron/admin-temporary-password-expiry` with `Authorization: Bearer <ADMIN_TEMP_PASSWORD_EXPIRY_CRON_SECRET>` at least every five minutes. Verify the scheduler returns 200 with zero failures and the endpoint rejects missing/invalid secrets. Apply the migration to staging and verify invitations for new Co-Owner, Super Admin, and Custom Admin identities; verify manual-password strength validation; confirm the branded temporary-password email and separate Supabase email-verification message; verify the 24-hour expiry, atomic one-time login claim under concurrent attempts, first-login password replacement, rejected CMS API access before replacement, and that the old password no longer authenticates after replacement. Also test existing-identity recovery, failed Resend delivery (the new account must be invalidated and retry must create a fresh credential), cancellation/archival, rejection of a cancelled/old-generation link, and completion while another administrator session is active in the same browser. The callback must require that browser session to be signed out before it will enable or complete setup. The completion API independently enforces this check.

The branded Supabase Auth templates and sender/provider configuration are separate manual settings. Install and preview the **Confirm signup** and **Reset password** templates from [the Supabase Admin Auth email-template guide](./supabase-admin-auth-email-templates.md) under **Authentication → Email Templates**. Keep the Supabase SMTP provider configured for verification and recovery links. Confirm the callback URL allow-list includes `https://www.neargrowads.com/admin/accept-invite` and `https://www.neargrowads.com/admin/password-reset`; do not copy credentials, temporary passwords, or tokens into Supabase templates.

Safe rollout order: (1) complete staging with a separate Supabase project, staging-only server secrets, the lifecycle and delegated-Co-Owner-cancellation migrations in filename order, branded email templates, and an active trusted scheduler; (2) configure production server-only Vercel secrets, including `SITE_URL=https://www.neargrowads.com`, `RESEND_API_KEY`, `ADMIN_INVITATION_EMAIL_FROM`, and a unique `ADMIN_TEMP_PASSWORD_EXPIRY_CRON_SECRET`; (3) verify prerequisites and apply all unapplied Supabase migrations to the production project in filename order, including `20261029100000_admin_temporary_password_lifecycle.sql` and `20261029230000_allow_delegated_coowner_invitation_cancellation.sql`; then install and preview the Supabase Auth templates and allow-list the canonical callback paths; (4) deploy the reviewed application through the normal Vercel process; (5) configure and verify the production scheduler against the deployed endpoint at least every five minutes, before creating any temporary-password accounts; (6) verify one new account per supported role, Primary Owner cancellation protection, delegated Co-Owner cancellation, cancellation-versus-acceptance races, and the recovery cases before broader use. No production SQL, hosted setting, credential, commit, push, or deployment is changed automatically by this repository update. Manually verify:

- The callback URL is cleared after processing, response headers use `Referrer-Policy: no-referrer`, and a recipient is never signed into the existing browser administrator session.
- A new invite activates only the recipient's verified Auth identity and requires that recipient to set their own password; recovery keeps the existing Auth identity.
- Temporary-password onboarding emails are accepted by the configured provider, state a 24-hour expiry and mandatory replacement, and do not claim inbox delivery. Expired credentials cannot create/use a CMS session; replacing the password clears the temporary state and invalidates the old password.
- The Primary Owner can view and revoke administrator sessions after reauthentication; other roles do not see the session-management panel and cannot revoke another account's session through the API.
- Admin Account cards are collapsed initially, keyboard-operable, and preserve unsaved edits when switching accounts.

### Vercel (full-stack)

`vercel.json` builds the Vite frontend into `dist`, rewrites `/admin` and known client-side routes to `index.html`, and leaves `/api/*` to the Vercel Function at `api/[...path].ts`. That Function lazily creates the existing Express app without binding a persistent port or serving static files. Vercel serves `dist` assets; API requests are same-origin. `/uploads/...` is routed to the API's safe public Storage redirect.

1. Connect the GitHub repository to Vercel and use the repository root as the project root.
2. Keep the framework preset at Vite (or Other if automatic detection does not identify Vite); use `npm run build` and `dist`. Do not add a catch-all rewrite that sends `/api/*` to the SPA.
3. Configure the Preview `SITE_URL` to the Preview deployment's HTTPS origin and Production `SITE_URL` to exactly `https://www.neargrowads.com`. In Supabase Auth URL Configuration, set the Site URL to `https://www.neargrowads.com` and allow-list `https://www.neargrowads.com/admin/accept-invite` and `https://www.neargrowads.com/admin/password-reset`. Preview/local callback origins should be allow-listed only for the corresponding non-production Supabase project. Configure server-only Preview and Production `RESEND_API_KEY`, `ADMIN_INVITATION_EMAIL_FROM`, and `ADMIN_TEMP_PASSWORD_EXPIRY_CRON_SECRET` values; schedule the expiry endpoint on a trusted runner.
4. Apply all reviewed Supabase migrations in order, including `20261029100000_admin_temporary_password_lifecycle.sql` and the serverless CMS migration. Run the CMS importer only after reviewing and backing up its source files and destination.
5. After Preview verification with a staging Supabase project, install the reviewed Confirm signup and Reset password templates from [the Supabase email-template guide](./supabase-admin-auth-email-templates.md), preserving each `{{ .ConfirmationURL }}` link. The Invite user template is only needed for any manually issued Supabase invitations. Then deploy the application through the approved Vercel process; this repository does not change hosted settings or deploy automatically.
6. Verify `/`, `/admin`, `/api/health`, a protected admin endpoint (401 without a session), browser assets, authenticated invite and password-reset flows with an explicitly authorized test account, and a refreshed nested route. Do not test by changing production owner or customer data.

### Standalone Express or Netlify

For a standalone Node.js host, run `npm start` behind a reverse proxy configured to replace untrusted forwarding headers, and provide a durable `PERSISTENT_DATA_DIR`. Its in-process rate limits and CMS mutation queue are not shared across replicas; use one instance or add a shared persistent coordination service before scaling horizontally. Netlify's current configuration publishes only the static frontend: its SPA fallback does not run Express or provide `/api/*`, so it is not a full-stack deployment target for this application.

Vercel Functions remove dependence on a permanent Express process and local disk. Serverless CMS JSON documents use database version checks; a concurrent stale save fails instead of silently overwriting the newer document. Process-local throttling/caches and serial mutation queues are still not shared across invocations. Treat rate limiting as a deployment requirement: configure Vercel Firewall limits for public and authentication endpoints before exposing the deployment. Test payments remain in Test mode; this integration does not enable live payments or change payment destinations.
