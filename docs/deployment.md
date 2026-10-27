# NearGrow Ads — Production Deployment Guide

## 1. Prerequisites

- Node.js 20+ and npm
- Supabase project with the reviewed migrations applied
- Vercel project connected to this repository for a complete serverless deployment, or a Node.js host with a durable writable volume for the standalone Express deployment

## 2. Environment Variables

For local development, create `.env` using `.env.example`. For Vercel, add these names in Project Settings → Environment Variables. Do not put secret values in `VITE_*` variables:

```bash
SITE_URL=https://your-production-domain.example
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_OWNER_USER_ID=
ADMIN_SESSION_SECRET=
```

`SITE_URL` must be the canonical HTTPS origin selected for the deployment. The five Supabase/admin variables above are required for admin access; the service role key and session secret must be server-only. Add optional `N8N_LEAD_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET`, `CONTACT_NOTIFICATION_EMAIL`, `ADMIN_NOTIFICATION_EMAIL`, and Razorpay Test variables only when those features are configured. `PORT`, `NODE_ENV`, `PERSISTENT_DATA_DIR`, and `TRUST_PROXY_HOPS` are for the standalone Express host; Vercel manages its function runtime and proxy configuration.

Vercel Function initialization does not create or repair the Primary Owner record. Confirm `ADMIN_OWNER_USER_ID` identifies the already verified Owner account and that its active `admin_users` row exists before deployment; setup must be reviewed and completed through the normal Supabase administration process.

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

Set `SITE_URL` to the one HTTPS origin selected for the deployment. The same value is used for build-time canonical and structured-data URLs and must be available to the running server. Do not substitute a domain until the production owner confirms whether `.in` or `.com` is canonical.

Set `TRUST_PROXY_HOPS` only to the exact number of trusted reverse proxies in front of Express. The default `0` ignores forwarded headers. Configure the edge proxy to replace, not append to, untrusted forwarding headers. The current in-process rate limiter does not share state across multiple instances; use a shared rate-limit store or a single instance before horizontally scaling.

Keep `.env` and all deployment secrets outside source archives. A shareable export may contain `.env.example` only; do not include `.env`, `node_modules`, `dist`, or `data/uploads`.

### Durable blog, team and upload storage

For a standalone Express host, blog posts/categories, team records, legacy site-content fallback, and blog/team/service-store uploads are filesystem-backed. Production requires `PERSISTENT_DATA_DIR`; mount a durable writable volume there and use a single writer instance.

Vercel Functions instead persist those five CMS JSON documents in `serverless_cms_documents` and media in the Supabase `cms-uploads` bucket. Apply `supabase/migrations/20261027150000_create_serverless_cms_documents.sql` before the first Vercel deployment that uses these stores. Review the current repository `data` documents and uploads, then run `npm run migrate:cms` locally with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set in a protected environment. The importer inserts only missing documents and uploads only missing assets; it does not overwrite or delete existing Supabase rows or objects. Back up the files and review the command output before proceeding. No migration has been run by this code change.

Vercel admin media uploads use short-lived Supabase signed upload URLs so file bytes go directly from the browser to Storage instead of exceeding Vercel Function request limits. The server verifies object size, MIME metadata, and file signature before returning a media URL. The browser never receives a Supabase service-role credential.

## 5. Supabase Database Setup

1. Create a Supabase project at `https://database.new`.
2. Open the SQL Editor and execute `supabase/migrations/20261015000000_create_leads_table.sql`.
3. Apply all remaining SQL files in `supabase/migrations` in timestamp order. This includes `supabase/migrations/20261025210000_add_service_catalogue_categories.sql` before deploying managed Service Store categories. It creates the category table, links existing packages to case/whitespace-normalized categories without changing package status or content, and grants category-table access only to the existing server-side `service_role` flow. Review the migrated categories’ active/display settings in Service Store after deployment; the migration keeps migrated categories active and shown in the Catalogue by default.
4. Existing admin installations must apply `supabase/migrations/20261020000000_admin_account_management.sql` before using username aliases, password-reset metadata, or configurable Super Admin permissions.
4. Verify that Row Level Security (RLS) is active on the `public.leads` table and the admin tables. See the Supabase Auth and server-only environment setup in `README.md`.

Before deploying this repair, review and apply `supabase/migrations/20261025180000_harden_leads_access_and_consent.sql` to staging first. Confirm the current policies and grants, verify authorized leads access through the server API, and verify direct anonymous/authenticated access is denied. Apply it to production only through the normal reviewed migration process; the application never applies database migrations automatically.

Apply `supabase/migrations/20261021130000_create_site_content_cms.sql` to enable the Page Content Manager's private draft and published content records. The server accesses this table with the server-only Supabase service role; browser clients cannot read or write it directly. Existing file-based website content remains the initial fallback until a new draft is published.

Apply `supabase/migrations/20261021170000_create_site_media_storage_bucket.sql` to provision the public-read `site-media` bucket used by Page Content Manager uploads. Upload signing and verification require the server-side admin session and section permissions. The browser receives a short-lived URL scoped to one random object path, never a service-role credential. The bucket allows JPG, PNG, WebP, MP4, and WebM files up to 100 MB (images are limited to 15 MB by the server). Uploaded assets are immutable and replacements use new object names so existing published pages remain intact until the new draft is published.

The Page Content Manager's Images & Media and Animations & Effects settings are stored in the existing `site_content_cms` JSON draft/published columns. No additional database migration is needed for animation settings; publish them through the CMS after applying the site content migration.

The Primary Owner can create independent delegated Supabase Auth identities in Settings, set one-time initial or reset passwords, and assign exact section/action permissions. New or unverified email identities stay pending until the recipient completes email verification. Owner-set temporary passwords are changed at first sign-in. The service-role key must remain server-side; never expose it through a `VITE_` variable or send it to the browser.

### Service Store orders and Razorpay Test checkout

Apply `supabase/migrations/20261022150000_create_service_orders_and_payment_settings.sql` after the existing catalogue/enquiry migrations. Configure `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`, and `RAZORPAY_TEST_WEBHOOK_SECRET` only in the server/deployment secret manager. The key ID must be a Razorpay `rzp_test_` key. Configure the Razorpay Test webhook URL as `/api/payments/razorpay/test-webhook` and subscribe it to `payment.captured`.

The Primary Owner must reauthenticate, verify the Test API credentials, and explicitly enable Test mode in Service Store → Store Settings → Payment Receiving. The CMS does not accept Live credentials, direct UPI identifiers, or bank details. Razorpay settlement details remain provider-managed. Test payments do not transfer funds and cannot be fulfilled as real customer orders. Secure tracking tokens are returned at checkout and are not stored in plaintext.

## 6. Hosting and deployment

### Vercel (full-stack)

`vercel.json` builds the Vite frontend into `dist`, rewrites `/admin` and known client-side routes to `index.html`, and leaves `/api/*` to the Vercel Function at `api/[...path].ts`. That Function lazily creates the existing Express app without binding a persistent port or serving static files. Vercel serves `dist` assets; API requests are same-origin. `/uploads/...` is routed to the API's safe public Storage redirect.

1. Connect the GitHub repository to Vercel and use the repository root as the project root.
2. Keep the framework preset at Vite (or Other if automatic detection does not identify Vite); use `npm run build` and `dist`. Do not add a catch-all rewrite that sends `/api/*` to the SPA.
3. Set the required environment variable names above for Preview and Production. For the initial verification, use a Preview deployment and a staging Supabase project. Set `SITE_URL` to that deployment's canonical HTTPS origin during the preview, and update it to the approved custom domain (for example, `https://neargrowads.com`) only after the domain decision.
4. Apply all reviewed Supabase migrations in order, including the serverless CMS migration, and run the CMS importer only after reviewing and backing up its source files and destination.
5. Redeploy after setting environment variables. Verify `/`, `/admin`, `/api/health`, a protected admin endpoint (401 without a session), browser assets, authenticated flows with an explicitly authorized test account, and a refreshed nested route. Do not test by changing production owner or customer data.

### Standalone Express or Netlify

For a standalone Node.js host, run `npm start` behind a reverse proxy configured to replace untrusted forwarding headers, and provide a durable `PERSISTENT_DATA_DIR`. Its in-process rate limits and CMS mutation queue are not shared across replicas; use one instance or add a shared persistent coordination service before scaling horizontally. Netlify's current configuration publishes only the static frontend: its SPA fallback does not run Express or provide `/api/*`, so it is not a full-stack deployment target for this application.

Vercel Functions remove dependence on a permanent Express process and local disk. Serverless CMS JSON documents use database version checks; a concurrent stale save fails instead of silently overwriting the newer document. Process-local throttling/caches and serial mutation queues are still not shared across invocations. Treat rate limiting as a deployment requirement: configure Vercel Firewall limits for public and authentication endpoints before exposing the deployment. Test payments remain in Test mode; this integration does not enable live payments or change payment destinations.
