<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/d32772df-cbc6-4e11-9246-851a8d4da13f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm start`

If port 3000 is already in use, the app automatically tries the next available port. Set `PORT` to use a specific port.

## Admin portal

The CMS authenticates each administrator with an individual, verified Supabase Auth email/password identity. Do not configure or reuse a shared CMS password.

### Initial Supabase setup

1. Configure Supabase Auth email confirmation and a verified SMTP sender. Add the site origin and these redirect URLs to the Supabase Auth redirect allow-list:
   - `https://your-site.example/admin/accept-invite`
   - `https://your-site.example/admin/password-reset`
   - For local development, the matching `http://localhost:<port>/...` URLs.
2. Apply the SQL files in `supabase/migrations` in timestamp order. The admin tables have row-level security enabled and are accessed only by the server's service-role key.
3. Create or invite the verified Supabase Auth user for `harsh6026435@gmail.com`. Set `ADMIN_OWNER_USER_ID` to that Auth user's UUID. The server verifies both the UUID and confirmed email before bootstrapping the initial primary Owner; it never grants Owner from a submitted email address.
4. Configure these **server-only** variables in the hosting environment (or local `.env`, which must not be committed):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_OWNER_USER_ID`
   - `ADMIN_SESSION_SECRET` — at least 32 random characters.
   - `SITE_URL` — canonical site origin used for Supabase email redirects.
5. Start the Express server and sign in at `/admin` with the verified Owner's own Supabase Auth credentials. Use Settings to invite other administrators. Invitations are pending until their recipient verifies the email link and sets an individual password.

The `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_SESSION_SECRET` must never be exposed to the browser. Admin session cookies are HTTP-only, SameSite strict, secure in production, persisted in Supabase, and checked against the account status on every protected API request. Password changes and administrator access changes require re-authentication. Google-only accounts must use Google for password changes; the CMS does not change Google passwords.

Custom Admin and Super Admin section/action permissions are enforced by both the admin interface and the Express API; Super Admin permissions are configurable per account and default to full operational access. Super Admins cannot administer Owner access or ownership. The Owner can assign unique username aliases, but every administrator still requires their own verified email-backed Supabase Auth identity and password. Invitation and password-reset links are issued by Supabase; passwords and service-role credentials are never stored in public tables or sent through the CMS. Ownership transfer is initiated by the current primary Owner and completed only after a second active Owner explicitly accepts it. Administrative and ownership actions are recorded in the security audit log.

### Existing deployments

The previous environment-based shared-password login and `data/super-admins.json` allow-list are no longer used for authentication. Do not copy shared credentials into Supabase. The Primary Owner can create independent delegated Supabase Auth identities in Settings, assign a username alias and exact permissions, and set a one-time password. New or unverified email identities remain pending until the recipient verifies their email; active delegated users must change Owner-set temporary passwords at first sign-in. Apply `supabase/migrations/20261020000000_admin_account_management.sql` before using username aliases or the expanded permission controls. Username-only Auth users are intentionally unsupported: aliases resolve server-side to a verified email identity and Supabase remains the password provider. Existing leads storage continues to use the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server variables; without Supabase configured, leads remain in server memory.

Security Monitoring requires `supabase/migrations/20261027130000_create_security_monitoring.sql`, which depends on the administrator identity tables from `20261019000000_admin_identity_and_access.sql`. For an existing deployment, first verify the configured Supabase project and migration history. If the monitoring migration is absent and its prerequisite is already applied, review and apply only that migration; do not apply unrelated pending migrations as a troubleshooting shortcut. If migration history shows it is applied but PostgREST returns `PGRST205`, verify the API is pointed at that same project and refresh the PostgREST schema cache before changing grants or RLS.

The Security Monitoring live website activity panel also requires `supabase/migrations/20261027140000_create_website_activity.sql`. This is an independent, additive migration for anonymous public-page activity; it does not alter security events, admin sessions, or lead data. For an existing deployment, verify the configured Supabase project first and apply only this migration through the reviewed deployment process. The backend uses the server-only service-role key; do not grant table or function access to `anon` or `authenticated`.
# neargrowads
# neargrowads
