# Website Functional QA Report

**Date:** 2026-10-25  
**Workspace:** `d:\neargrowads\neargrow-ads-new-mascot`  
**Overall status:** Partial audit completed. Public route smoke tests and read-only data checks passed, and one metadata defect was fixed and retested. Authenticated CMS workflows and external integrations remain unverified.

## Environment and baseline

- The project is an Express/Vite/React application. The existing scripts are `npm run dev`, `npm start`, `npm run lint`, `npm test`, and `npm run build`.
- An existing NearGrow Ads instance was already responding on port 3000. A second `npm run dev` attempt could not bind because that port was occupied. The existing instance was used; its process was not stopped or replaced.
- Desktop baseline screenshots were captured for the public homepage and CMS sign-in page before the metadata change. The repair changes document metadata only, not page layout or styling.
- Git status could not be inspected: the workspace does not contain Git repository metadata.
- No CMS records were changed, published, deleted, or exported. No enquiries, emails, payments, or other external actions were submitted.

## Routes discovered

**Public routes**

- `/`
- `/services` and `/services/:slug`
- `/catalogue` and `/catalogue/:slug`
- `/about`, `/work`, `/blog`, and `/blog/:slug`
- `/contact`, `/get-started`, `/privacy-policy`, `/terms-and-conditions`, and `/thank-you`

**CMS routes**

- `/admin` and `/admin/login`
- `/admin/accept-invite` and `/admin/password-reset`
- `/admin/blog`, `/admin/blog/new`, and `/admin/blog/:slug`
- `/admin/team`, `/admin/leads`, `/admin/categories`, `/admin/content`, `/admin/mascot`, `/admin/case-studies`, `/admin/services`, `/admin/settings`, and `/admin/service-store`

## Functional checklist and outcomes

| Status | Area | Outcome |
|---|---|---|
| PASS | Public page routing | Direct navigation and rendered content were checked for the homepage, services index and a service detail, Catalogue and a package detail, About, Work, Blog and an article, Contact, Get Started, Privacy Policy, Terms, and Thank You. Expected headings and route-specific titles were present after load. |
| PASS | Public Catalogue read flow | Read-only `/api/catalogue` and `/api/catalogue/categories` requests returned data. The Catalogue rendered its published package and visible category; selecting the exact category filter displayed the package. The package detail view rendered through its current URL. |
| PASS | Public content APIs | Read-only requests to `/api/health`, `/api/blogs`, `/api/team`, and `/api/site-content` returned successful responses. These checks confirm response availability, not every image or CMS record’s persistence chain. |
| PASS | Responsive smoke check | At a 390px viewport, the tested homepage and Catalogue had no horizontal document overflow. Mobile navigation opened and closed, and navigation to Catalogue worked. The theme control switched light → dark → light. |
| PASS | Public asset smoke check | No broken images were detected on the sampled, fully loaded public routes. This is not a complete asset inventory. |
| FIXED AND RETESTED | Route metadata | Admin, Get Started, Privacy Policy, Terms, and Thank You pages previously displayed their correct page content while their document title said “Page Not Found.” After the fix, the tested admin routes use “Admin | NearGrow Ads” and the public routes use their correct titles. |
| BLOCKED | Authenticated CMS workflows | `/api/admin/session` reported `authenticated: false`. Admin routes displayed the sign-in screen. No credentials were supplied, so role-based views and admin create/edit/upload/publish/archive/save/export flows could not be tested. |
| NOT TESTED | Public form submission | Contact, consultation, and Get Started submissions were not sent. Validation and persistence were not verified end to end. |
| NOT TESTED | NEO/chatbot | Conversation, lead handoff, chatbot settings, and external AI integration were not exercised. |
| NOT TESTED | Catalogue transactions | Cart, saved-package persistence, enquiry submission, order tracking, and payment completion were not exercised. The Catalogue indicated online payment was unavailable; no payment was attempted. |
| NOT TESTED | Other public interactive features | Search/sort/pagination, all dropdowns and accordions, detailed form error cases, browser back/forward journeys, and exhaustive desktop/tablet/touch behavior were not covered. |

### CMS functional areas inventoried but blocked by authentication

Leads and export permissions; team and mentor management; blog and blog images; blog categories; page content; mascot and NEO settings; case studies; Services Management; Service Store packages, categories, orders and payment settings; general settings; invitations and password recovery. The UI and API were not mutated without authorized access.

## Confirmed defect and repair

**Reproduction:** Open `/admin/leads`, `/admin/service-store`, or `/admin/blog/new`, then open `/get-started`, `/privacy-policy`, `/terms-and-conditions`, or `/thank-you`. Their page content rendered, but the client-side metadata effect replaced their document titles with “Page Not Found | NearGrow Ads.”

**Root cause:** The route metadata effect in [`src/App.tsx`](./src/App.tsx) supplied fallback metadata for the main public SEO pages and a few dynamic routes only. It did not define metadata for admin routes or the static onboarding/legal/confirmation routes, so those valid routes fell through to the not-found title.

**Repair:** Added explicit client-side metadata for admin paths and the four valid static routes. The affected routes were revisited in the running browser; their content remained available and the titles were correct after hydration.

## Verification actually performed

- Browser smoke tests on the existing local instance at `http://localhost:3000`.
- Read-only API requests for health, Catalogue, Catalogue categories, blogs, team, site content, and admin session.
- Mobile viewport test at 390px, including navigation open/close, navigation to Catalogue, theme-state changes, and document-width check.
- `npm run lint` — **PASS** (`tsc --noEmit`).
- `npm test` — **PASS**, 77 tests passed, 0 failed.
- `npm run build` — **PASS**.

The build emitted a non-blocking warning that some JavaScript chunks exceed 500 kB after minification. This audit made no bundle-splitting changes.

## Browser and integration observations

- The sampled public APIs responded successfully. No application API failure was observed during these read-only checks.
- Google Analytics collection requests were aborted during page navigation (`net::ERR_ABORTED`). They were third-party analytics requests, not evidence of a failed application API.
- The running instance reported the admin session as configured but unauthenticated. Authorized access is required to test protected flows.
- The managed Catalogue category endpoint returned data in this instance. No migration was run as part of this audit.

## Remaining blockers and limitations

- **BLOCKED:** Authenticated CMS journeys and server-side role/permission checks, including actual file upload/storage, saves, exports, publication, and persistence after reload.
- **BLOCKED:** Verification against a fresh authorized session or a separately provisioned staging database.
- **NOT TESTED:** Actual customer-facing form delivery, notifications, chatbot/AI integration, payment provider, and order/enquiry mutation paths.
- **NOT TESTED:** Full visual comparison across desktop, tablet, mobile, and both themes. The metadata-only repair does not intentionally change visual output.
- Git diff/status could not be used because this workspace is not a Git repository.
- No deployment step is required for the client-side metadata fix beyond deploying the updated application bundle. This does not certify the deployment’s database schema, credentials, or external integrations.

## Blog Management SEO Health follow-up

**Status:** Feature implemented; protected API smoke-tested; authenticated CMS journeys remain blocked by the unauthenticated local session.

- Added a published-first SEO Health view with draft inclusion, summary filters, issue filtering, article search, issue details, editor links, rescan controls, selected scans, batched scan-all, progress, and retry for failed batches.
- Added deterministic, weighted saved-content checks for effective title/description, duplicates, body content, headings/placeholders, author details, internal links, image sources/alt text, canonical/indexing/sitemap rules, and social-sharing metadata. The UI identifies the score as an internal checklist score, explains the weight policy, and never represents it as a Google ranking or verified indexing result.
- Scan results are stored separately in `blog-seo-health.json` under the configured persistent data root and include article ID, content revision, analyzer version, and scan time. Results are shown as stale after the saved article changes.
- The scanner verifies first-party uploaded image file references but does not fetch external links, remote image URLs, or public pages. Remote/embedded sources and image-dimension checks remain `Not checked`; affected scans are provisional. Google indexing remains unknown.
- Saving an article triggers a scan after the save succeeds. A scan failure does not turn a persisted article save into a reported save failure.
- The unauthenticated local API probes returned **401** for both `GET /api/admin/blogs/seo-health` and `POST /api/admin/blogs/seo-health/scan`, confirming the routes reject anonymous requests. No authenticated article scan, result persistence/reload, edit-to-rescan journey, or visual browser inspection could be performed.
- Follow-up validation: `npm run lint` — **PASS**; `npm run build` — **PASS** (existing non-blocking large-chunk warning); `npm test` — **PASS**, 87 tests passed, 0 failed.
