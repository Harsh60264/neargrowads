# NearGrow Ads — Production Deployment Guide

## 1. Prerequisites

- Node.js 20+
- npm or bun
- Node.js host with an Express process and a durable writable volume (for example, Cloud Run with a persistent volume, Render with a persistent disk, or a VPS)

## 2. Environment Variables

Create `.env` using `.env.example`:

```bash
PORT=3000
NODE_ENV=production
SITE_URL=https://your-production-domain.example
TRUST_PROXY_HOPS=0
PERSISTENT_DATA_DIR=/var/lib/neargrow-ads
WHATSAPP_NUMBER=
CONTACT_NOTIFICATION_EMAIL=
```

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

The current blog posts/categories, team records, legacy site-content fallback, and blog/team/service-store uploads are filesystem-backed. Production now requires `PERSISTENT_DATA_DIR` and uses it instead of the source tree's `data` folder. Mount a durable writable volume at that path and keep a single application writer instance; do not assume local disk is shared across replicas. The Supabase-backed Page Content Manager media bucket does not migrate these separate file stores.

For an existing deployment, stop CMS writes, back up the current `data` directory, copy `blog-posts.json`, `blog-categories.json`, `team.json`, `site-content.json` (if present), and the complete `uploads` directory to the root of the mounted volume, configure `PERSISTENT_DATA_DIR`, then start one instance and verify public and admin media URLs. Keep the backup until restart/redeploy and restore checks pass. This is an operator-run migration; the application does not overwrite or move production data automatically.

## 5. Supabase Database Setup

1. Create a Supabase project at `https://database.new`.
2. Open the SQL Editor and execute `supabase/migrations/20261015000000_create_leads_table.sql`.
3. Apply all remaining SQL files in `supabase/migrations` in timestamp order. This includes `supabase/migrations/20261025210000_add_service_catalogue_categories.sql` before deploying managed Service Store categories. It creates the category table, links existing packages to case/whitespace-normalized categories without changing package status or content, and grants category-table access only to the existing server-side `service_role` flow. Review the migrated categories’ active/display settings in Service Store after deployment; the migration keeps migrated categories active and shown in the Catalogue by default.
4. Existing admin installations must apply `supabase/migrations/20261020000000_admin_account_management.sql` before using username aliases, password-reset metadata, or configurable Super Admin permissions.
4. Verify that Row Level Security (RLS) is active on the `public.leads` table and the admin tables. See the Supabase Auth and server-only environment setup in `README.md`.

Before deploying this repair, review and apply `supabase/migrations/20261025180000_harden_leads_access_and_consent.sql` to staging first. Confirm the current policies and grants, verify authorized leads access through the server API, and verify direct anonymous/authenticated access is denied. Apply it to production only through the normal reviewed migration process; the application never applies database migrations automatically.

Apply `supabase/migrations/20261021130000_create_site_content_cms.sql` to enable the Page Content Manager's private draft and published content records. The server accesses this table with the server-only Supabase service role; browser clients cannot read or write it directly. Existing file-based website content remains the initial fallback until a new draft is published.

Apply `supabase/migrations/20261021170000_create_site_media_storage_bucket.sql` to provision the public-read `site-media` bucket used by Page Content Manager uploads. Media uploads are authorized by the Express admin permission checks and written with the server-only Supabase service role; browser clients cannot upload or replace storage objects directly. The bucket allows JPG, PNG, WebP, MP4, and WebM files up to 100 MB (images are limited to 15 MB by the server). Uploaded assets are immutable and replacements use new object names so existing published pages remain intact until the new draft is published.

The Page Content Manager's Images & Media and Animations & Effects settings are stored in the existing `site_content_cms` JSON draft/published columns. No additional database migration is needed for animation settings; publish them through the CMS after applying the site content migration.

The Primary Owner can create independent delegated Supabase Auth identities in Settings, set one-time initial or reset passwords, and assign exact section/action permissions. New or unverified email identities stay pending until the recipient completes email verification. Owner-set temporary passwords are changed at first sign-in. The service-role key must remain server-side; never expose it through a `VITE_` variable or send it to the browser.

### Service Store orders and Razorpay Test checkout

Apply `supabase/migrations/20261022150000_create_service_orders_and_payment_settings.sql` after the existing catalogue/enquiry migrations. Configure `RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`, and `RAZORPAY_TEST_WEBHOOK_SECRET` only in the server/deployment secret manager. The key ID must be a Razorpay `rzp_test_` key. Configure the Razorpay Test webhook URL as `/api/payments/razorpay/test-webhook` and subscribe it to `payment.captured`.

The Primary Owner must reauthenticate, verify the Test API credentials, and explicitly enable Test mode in Service Store → Store Settings → Payment Receiving. The CMS does not accept Live credentials, direct UPI identifiers, or bank details. Razorpay settlement details remain provider-managed. Test payments do not transfer funds and cannot be fulfilled as real customer orders. Secure tracking tokens are returned at checkout and are not stored in plaintext.

## 6. Hosting and deployment

Run the Express application with `npm start` on a Node.js host, behind a reverse proxy configured to replace untrusted forwarding headers. This application needs both the Express API and the durable writable `PERSISTENT_DATA_DIR` described above. A static-only Vercel deployment with `dist` as its output cannot provide the API or persistent filesystem required by this configuration; do not use that deployment mode.

For each release, set `SITE_URL`, server-only Supabase credentials, the exact trusted proxy hop count, and the persistent volume in the host's secret/environment settings. Build with the confirmed canonical HTTPS origin, apply reviewed Supabase migrations separately, and deploy only after the staging checks pass. Keep payment settings in their existing Test mode; this repair does not enable real payments.
