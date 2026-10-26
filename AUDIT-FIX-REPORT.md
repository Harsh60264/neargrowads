# NearGrow Ads Audit Fix Report

**Audit reviewed:** `NearGrowAds-Website-Audit-2026-10-25.md`  
**Scope:** the 15 release findings in the supplied audit, verified against the current workspace before changes.  
**Environment boundary:** this workspace has no Git repository, so branch creation and Git status inspection were unavailable. No production database, payment account, or credential was used. The existing `.env` was not opened, changed, or copied.

“Fixed” below means the code/documentation repair is present; it does not imply that a production deployment or external integration was verified.

## Audit findings

1. **Blocked — credential-bearing shareable exports.** The audit found a populated `.env` in its supplied ZIP. `.gitignore` now excludes `.env`, `.env.*`, and ZIP files while allowing `.env.example`; the example contains placeholders only, and the deployment guide warns against exporting `.env`. However, this workspace has no Git repository or identified archive/export workflow, so an actual clean export could not be produced and inspected. The existing `.env` remains untouched. If the old ZIP left trusted control, rotate affected credentials through the deployment secret manager; rotation was deliberately not performed.

2. **Fixed — leads table RLS and grants.** Broad direct `anon`/`authenticated`/`PUBLIC` table access is removed by the targeted `supabase/migrations/20261025180000_harden_leads_access_and_consent.sql` migration. RLS remains enabled and server-side access uses the service role. The migration was not applied; deployed policies, grants, and authorized/restricted users remain **NOT VERIFIED**.

3. **Fixed — body-parser advisory.** The compatible 1.x resolution is `body-parser@1.20.9`; `npm audit --omit=dev` reports zero vulnerabilities. No forced major upgrade was made.

4. **Fixed — Get Started false success.** The wizard no longer stores an unsubmitted browser backup or reports receipt on an unsuccessful response. It keeps entered values and the same submission UUID for retry, requires explicit consent, and only accepts success when the response confirms the matching lead ID. Contact submission follows the same confirmation rule. Changed: `src/components/contact/GetStartedPage.tsx`, `src/components/forms/ConsultationForm.tsx`, `server.ts`, and `server/leadApi.test.ts`.

5. **Fixed — production leads without durable storage.** Production lead writes fail with HTTP 503 if Supabase storage is unavailable or unconfigured; memory storage is limited to development/test. A local production-mode API test confirmed the 503 failure response rather than a success-shaped fallback. Changed: `server.ts`.

6. **Fixed — payment availability route shadowing.** The specific `/api/catalogue/payment-availability` route is registered before the dynamic slug route. The local production API check reached the availability handler and returned its expected JSON shape (`available: false`) with 503 when its database configuration was intentionally absent. Razorpay Test mode was preserved; no real payment mode was enabled. Changed: `server.ts`, `server/leadApi.test.ts`.

7. **Fixed — CMS service/case-study source of truth.** Built-in service detail routes now use published CMS records and their supported editable fields; missing/unpublished records no longer fall back to the old built-in detail. Home and detail views no longer publish bundled case-study/testimonial examples as fallback evidence, and related service cards follow published services. Changed: `src/App.tsx`, `src/components/services/ServiceDetailPage.tsx`, `src/components/services/ServicesIndexPage.tsx`, `src/components/home/HomePage.tsx`, `src/data/servicesData.ts`. Live edit/rename/archive/unpublish behavior and role-specific publishing remain **NOT VERIFIED** without a staging database. Existing long-form layout sections remain where the CMS schema does not expose editable equivalents.

8. **Fixed — blog/team/uploads deployment durability.** These file-backed records and uploads now resolve under `PERSISTENT_DATA_DIR`; production refuses to start without it. The deployment guide documents a backup and operator-run copy of existing JSON files and uploads to the mounted volume. Blog/team writes use revision checks to reject stale edits. This is a single-writer persistent-volume solution, not distributed storage/locking; restart, redeploy, and multi-instance behavior have not been tested on the deployment host. Changed: `server.ts`, `src/components/admin/AdminBlogManager.tsx`, `src/components/admin/AdminTeamManager.tsx`, `docs/deployment.md`.

9. **Fixed — spoofable forwarded-IP throttling.** Rate limiting uses Express `req.ip` with `TRUST_PROXY_HOPS=0` by default; operators must configure the exact trusted proxy chain and make the edge replace untrusted forwarding headers. A local API test varied `X-Forwarded-For` and confirmed it did not evade the limit (10 accepted requests, then 429). The actual hosting proxy chain is unknown, and the limiter remains process-local; horizontal scaling needs shared state or a single instance. Changed: `server.ts`, `.env.example`, `docs/deployment.md`, `server/leadApi.test.ts`.

10. **Fixed — consent mismatch.** Contact and Get Started start unchecked and require the user's explicit acknowledgement. The server rejects missing/false consent and persists the actual value; the migration removes the database's consent default. API tests confirmed false consent receives 400. Staging persistence and the deployed schema are **NOT VERIFIED**. Changed: `src/components/contact/GetStartedPage.tsx`, `src/components/forms/ConsultationForm.tsx`, `server.ts`, `supabase/migrations/20261025180000_harden_leads_access_and_consent.sql`.

11. **Fixed in code; production origin blocked on owner configuration — SEO and status codes.** `SITE_URL` is the single configured origin for build/runtime metadata; server-rendered page metadata, canonical URLs without tracking parameters, a real logo asset, published-content sitemap generation, robots directives, and production 404s are implemented. A local production API check confirmed an unknown route returns 404. The canonical `.in`/`.com` domain was intentionally not guessed; set the owner-confirmed HTTPS origin before release. Social-preview behavior on external crawlers and production sitemap contents are **NOT VERIFIED**. Changed: `server.ts`, `src/App.tsx`, `index.html`, `vite.config.ts`, `src/vite-env.d.ts`, `docs/deployment.md`.

12. **Fixed — internal query, fragment, and campaign loss.** Internal navigation preserves search and hash values, and first-touch campaign attribution is stored for later form submission. The campaign helper has a regression test; browser-level anchor focus/scroll and campaign behavior are **NOT VERIFIED**. Changed: `src/App.tsx`, `src/data/leadTracking.ts`, `src/data/leadTracking.test.ts`, `src/components/forms/ConsultationForm.tsx`, `src/components/contact/GetStartedPage.tsx`.

13. **Fixed in current theme rules — identified contrast cases.** Home CTA foregrounds now follow the existing per-theme green surfaces; light-theme orange labels use the darker brand orange; the Blog article count is more legible; and the featured Blog CTA uses dark text against green. WCAG contrast ratios calculated from the configured token pairs: light CTA 12.15:1 (hover 14.37:1); dark CTA 5.24:1 (hover 7.18:1); light orange on white 5.62:1 and on the pale-orange surface 5.06:1. The Blog count uses 70%-white over its dark surface. These targeted fixes do not change the case-study cover overlay. A full visual/accessibility scan of every page, image overlay, focus, and hover state was not completed. Changed: `src/index.css`, `src/components/home/HomePage.tsx`, `src/components/blog/BlogIndexPage.tsx`.

14. **Blocked — remaining initial-download and video cost.** Admin is lazy-loaded and the production build now emits it as a separate 509 KB chunk (about 96 KB gzip). The current initial JavaScript remains 1,348 KB (about 357 KB gzip), CSS 368 KB (about 49 KB gzip), and the bundled hero video 11.52 MB; Vite still warns about an oversized chunk. Hero audio/file optimization and physical-device NEO profiling were not completed. Preserve the current approved video quality, theme switching, and NEO behavior until an available media tool/device is used to measure a safe improvement. Changed: `src/App.tsx`; no video or NEO appearance changes were made.

15. **Fixed in code; staging checks blocked — draft permission, notifications, and lead-list limit.** Draft creation is separated from publish authorization; notification HTTP failures are recorded distinctly from a saved lead, the webhook receives the stable idempotency key, and admins have a retry action. Admin lead queries now support pagination and filters. A local 500-response webhook test confirmed the lead remains saved while `notificationStatus` is `failed`; retry delivery, owner/restricted-role permissions, actual admin visibility, and live notification delivery remain **NOT VERIFIED**. Changed: `server.ts`, `src/components/admin/AdminPage.tsx`, `src/components/admin/AdminBlogManager.tsx`, `src/components/admin/AdminTeamManager.tsx`, `server/leadApi.test.ts`.

## Verification performed

- `npm test` — **62 passed, 0 failed**, including local API checks for explicit consent, duplicate retries, conflicting submission IDs, webhook HTTP failure handling, proxy-header rate-limit resistance, production missing-database failure, the payment-availability handler, and production 404s.
- `npm run lint` — **passed** (`tsc --noEmit`).
- `npm run build` — **passed**. Vite still reports a chunk over 500 KB. The build used the reserved test origin `https://example.invalid`, not a guessed production domain.
- `npm audit --omit=dev` — **0 vulnerabilities**.
- `npm ls body-parser --all` — resolves `body-parser@1.20.9`.
- Theme-specific image/video selection helper tests and existing NEO/chatbot helper tests passed within the test suite; these do not verify CMS persistence or browser/device performance.
- A local browser page initially loaded, but subsequent browser navigation stalled. No end-to-end UI, mobile-device, or complete theme workflow is claimed as verified.

All API lead tests used synthetic data and isolated local processes. Development/test memory storage, a local HTTP webhook stub, and absent database configuration are not proof of live Supabase persistence, admin visibility, or real notification delivery.

## Deployment and staging steps

1. Confirm the production canonical domain with the owner. Set the same HTTPS origin as `SITE_URL` for the build and running server.
2. Deploy the Express app to a Node.js host with a durable writable volume. Set `PERSISTENT_DATA_DIR`, keep one writer, back up the existing `data` directory, and follow the documented operator-run copy for `blog-posts.json`, `blog-categories.json`, `team.json`, `site-content.json` if present, and `uploads/`. Do not rely on static-only hosting or ephemeral local storage.
3. On a staging database, inspect current policies and grants, back up as appropriate, and apply the reviewed migrations in timestamp order, including `20261025180000_harden_leads_access_and_consent.sql`. Verify RLS remains enabled, direct unprivileged table access is denied, and the authorized server leads API works. Do not apply migrations automatically from the application.
4. Configure Supabase and notification secrets only in the deployment secret manager. Set `TRUST_PROXY_HOPS` to the actual trusted proxy count and ensure the edge overwrites untrusted forwarding headers. Use shared rate-limit state before adding instances.
5. In staging, submit Contact, Get Started, and Chatbot enquiries; retry the same submission; verify the same saved ID appears in the authorized admin list; exercise notification retry, CMS edit/publish/unpublish, restricted roles, separate theme media, and payment availability.
6. Keep Razorpay in its current Test mode. Do not enable or test real payments as part of this repair.
7. If the old credential-bearing ZIP was distributed outside trusted control, rotate affected credentials through a controlled deployment and retire reused legacy passwords. Do not put secrets in this report, source exports, or `.env.example`.

## Outstanding risks / NOT VERIFIED

- Actual shareable-archive filtering; credential rotation; deployed Supabase policies/grants and migration application.
- Live durable lead writes, Contact/Get Started/Chatbot UI submissions, admin listing visibility, notification delivery/retry, and CMS persistence/permissions.
- Owner-confirmed production origin, proxy chain, persistent-volume migration/restart, backups, and deployment-specific CDN behavior.
- Full light/dark visual and accessibility review, mobile/tablet/desktop browser workflows, chatbot reopening in the current UI, and physical-device NEO profiling.
- Hero video audio removal/file-size optimization and remaining large initial JavaScript chunk.
- Razorpay Test webhook/payment integration. Real payments remain disabled.

Optional audit suggestions—such as adding Hindi/Hinglish chatbot support, new conversion analytics, and new content-completeness checks—were kept separate and were not implemented.
