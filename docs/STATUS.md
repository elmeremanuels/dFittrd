# Status — 19 Nov 2026

The real state of the integration branch `claude/garment-engine` (PR #1 to `main`) after the 19 parallel branches of
19 Nov were merged into it, plus this branch (`claude/loose-ends`). Every open issue of every report is in one list,
`docs/OPEN-ISSUES.md`, marked by who it waits on. Read it with `docs/DECISIONS.md` (why), `docs/ARCHITECTURE.md` (layout),
`docs/HANDOFF.md` (product truth) and `docs/LAUNCH-RUNBOOK.md` (the go-live steps). The dated branch entries of
1–9 Nov are kept verbatim in `docs/STATUS-HISTORY.md`; where they disagree with this page, this page is current.

## In one paragraph

Nothing is deployed and nothing has run against a real Shopify store, a real VPS or GitHub's runners. Release v1
(size advice in a "Try it on" overlay, no 3D needed) is built and tested for Shopify and WooCommerce, the server stack
was rehearsed end to end on a simulated Ubuntu 24.04 VPS (9 Nov), and the WooCommerce plugin passes on a real WordPress
with PHP 8.1, 8.2 and 8.3. What stands between today and the pilot shop seeing the button is founder work: the
decisions below, the VPS purchase, DNS, GitHub settings, the Shopify app in the Dev Dashboard, the merge of PR #1 and
the approval of the first deploy. `docs/LAUNCH-RUNBOOK.md` lists every step and who does it.

Since the launch review of 19 Nov, a second layer was built on top of release v1 and merged, all of it **off by default**
(section "Behind a flag"): men's sizing and the men's 3D gate, the male mannequin and 2D figure, head v3, skin shading
v2, the face photo on the device, the AI realism layer, the bake check with its merchant review, the privacy wall
(CSP), monthly frozen analytics (D23) and the "Get set up" list for merchants. None of it changes what the pilot shop's
shoppers see.

## The pilot

| | |
|---|---|
| Shop | Bohohippychic (Shopify, Australia, AUD, AU sizes 8–16); permission for name, logo and photos per D16 (founder keeps the written confirmation) |
| Price | USD 8.99 per month, one plan (D17). As a custom-distribution app it cannot bill through Shopify: invoice outside Shopify or waive for the pilot |
| What the shopper gets | "Try it on" under the size picker → height and weight (or measurements) → a size from `@curtain/fit-engine`, computed on the device, labelled an estimate → "Choose size" selects the variant. Optional on-device camera scan. The 3D estimate is off per shop (`settings.garment3d`) until the merchant approves bundles and D17 prices 3D |
| Interface language | English only (D21); the Dutch drafts are source material in `docs/i18n/` and `packages/woocommerce-plugin/translation-packs/`, not in any build |

## Founder decisions open

| # | Decision | Advice |
|---|---|---|
| 1 | Shopify custom vs public app (irreversible per app) | Custom for the pilot; the App Store app is a second app later (`docs/LAUNCH-SHOPIFY.md` A1, A2, F) |
| 2 | VPS region and purchase | Sydney, 2 vCPU / 2 GB / 40 GB, Ubuntu 24.04, IPv4 |
| 3 | Merge PR #1 into `main` | After the open parallel branches are merged into it and its CI is green |
| 4 | Approve the first deploy | Via the `production` environment's required reviewer |
| 5 | WooCommerce minimum PHP 8.1 | Accept (8.0 is end of life; 8.1–8.3 pass on real WordPress). Not on the Shopify pilot path |
| 6 | `MEN_3D_GATE=1` in production (D20 point 3; the default is still 0) | Set it; costs the women's-wear pilot nothing |
| 7 | Legal review of the privacy policy, terms and consent copy (D19, D20 point 4: Naomi) | Before real shoppers. The in-app privacy page is the draft ("Not in force") |
| 8 | Trial length (`BILLING_TRIAL_DAYS`, default 7) and the SDK licence for WP.org (#14) | Only needed for public billing and the WP.org listing |

## What is built (by surface)

| Surface | State |
|---|---|
| `@curtain/fit-engine` | Pure, zero runtime dependencies, on-device only (rule 4). Pull-on check and waist reading from a measured band (merchant tape). Men's fit (M2a/M2b, merged): neck, sleeve, body length, rise, W/L sizes, men's eases, all gated on `audience: 'men'`; every women's and unisex chart reads byte for byte as before. Every men's number is assumed until three real charts per block are read |
| `@curtain/schema` | Wire types; garment payload; optional garment tape per size with provenance; size-chart templates (AU women's; two blank men's garment templates, tee and chino W/L; the men's body templates held back for legal review); men's chart columns (`chartColumns.ts`), read by both merchant builders; audience inference |
| SDK (`@curtain/sdk`) | Button → overlay iframe on `/embed/<token>`, exact-origin postMessage, variant selection for Dawn and WooCommerce, size peek (fixed 112 px, no shopper data). A paused shop shows no button (D25 point 5): the plugins print the button hidden and the SDK shows it after `GET /v1/sdk/shop` says the plan is not paused. 8,187 B gzip of an 8,192 B budget (OI-114) |
| Embed (`apps/web` `/embed`) | About you, optional scan, result with avatar and size rings, "Choose size", Remember me / Forget me, avatar prompt with neutral face and skin-tone picker (colour stays in memory), optional 3D estimate (viewer chunk 165.9 KB gzip of 400 KB). Face photo off in builds (`VITE_AVATAR_FACE_PHOTO`), hero render hidden (the api does not send `heroRenders`). Men's garments: About you asks chest, waist, seat, inside leg, neck, sleeve; the result names the men's points and W/L. A W/L result whose leg could not be checked names the waist in the heading, the fit panel, the 3D label and the size peek (this branch). A size whose band does not go over the shopper's hips is not drawn in 3D and the note says why. Interface text: every string of `apps/web` is in a catalogue (this branch, see "Interface language"). Settings slice 1 (20 Nov): no age-range question, one line under the size when the shop gave no fabric stretch, "Fit by Curtain" hidden when the shop switched it off (the estimate labels stay) |
| api (`apps/api`) | Fastify 5, Postgres 16, pg-boss. Devices, try tokens, fit-shown billing event, peek, merchant API (HMAC/Bearer/session token), analytics with a k floor in closed, frozen calendar months with complementary suppression (D23), Shopify (token exchange, webhooks incl. GDPR, metafields, chart builder, garment tape), Stripe Connect path for Woo, asset import with the automatic bake check (9 checks; a failing bake is refused with a plain reason, pull-on recomputed from the tape) and merchant approval, men's gate (`MEN_3D_GATE`), hero render jobs (avatar image only), the AI realism route (`AI_REALISM`, fake provider only so far), `GET/PUT /v1/merchant/setup` (the five-step checklist). The request log carries route patterns only (L1). Settings slice 1: a fabric with a missing or not-valid part is stored without that part and reported (`notices`); the shop setting `incompleteProductData` lets such a product through (standard) or holds it back (stored, 200, served on no shopper route); `GET`/`PUT /v1/merchant/settings`; a bad product no longer stops a Shopify backfill page Settings slice 1b (20 Nov): `GET/PUT /shopify/settings` for the Shopify admin; a one-time sign-in link into the console (`POST /v1/merchant/console-link`, 10 minutes, one use, 5 per shop in 10 minutes; `POST /v1/merchant/console-session` gives a 12-hour `cs_…` session; hashes at rest, migration 0010). A new shop key and an uninstall end the shop's sessions and unused links. |
| Shopify app | Embedded admin page with the "Get set up" checklist, chart builder (men's columns and W/L included) and tape entry, "Try it on" theme block, `shopify-deploy` workflow. Offline contract harness against a fake Shopify, requests validated against the real 2026-10 Admin schema (9 Nov). The description import saves fibre names only (the stretch estimate is an unticked suggestion) and a fabric write keeps the parts the product already has Settings slice 1b (20 Nov): a Settings section in the admin page (incomplete fabric details, "Fit by Curtain", "Open the full console"), the fabric notices in the product list, and for a held-back product where in Shopify the stretch goes (the "Fabric" metafield; typed by hand, OI-124). |
| WooCommerce plugin | "Get set up" box, meta box with chart templates (men's columns and W/L included) and tape, PK-HMAC push via Action Scheduler, bundled SDK button under the variation form, Connect with domain proof, uninstall. PHP 8.1+, WordPress 6.6+, WooCommerce 9.0+. Stretch and drape are not required; the product screen shows what Curtain left out or assumed, in its own words Settings slice 1b (20 Nov): "Open the Curtain console" on the settings page signs the admin into the console through a one-time link; the plugin redirects only to `/merchant/link` on the console host, https port. |
| Garment engine (3D) | Spike + `@curtain/garment-viewer`: bundles on female and male mannequins (male bundles only on the male body), drape control, per-size measured waistbands, POM v2 server-drape bake blended on the device, look v2. The real POM v2 skirt bake passes the import's bake check (9 of 9) after the pull-on plan: a size is draped only on bodies its band goes over. Male mannequin (v1 default, v2 behind a flag), a synthetic men's tee built from flat measurements (v2: chest ease kept, sizes too small not drawn, UVs and a generated print); nothing measured on a real tee. Head `neutral-v3` is the default head (D22). Bundles are imported by hand and need merchant approval (D13, D16). No GPU runs in this session. Other sessions are adding garment builders now |
| Merchant console (`apps/web` `/merchant`) | Checklist, products, monthly analytics with the reason a row is hidden, 3D review per version (what the check found, where each size's tape comes from, approve or reject), leaving Curtain; Settings page (incomplete fabric details, "Fit by Curtain", colour, logo address) and, in the product list, what a save left out and which products are held back Settings slice 1b (20 Nov): `/merchant/link` signs in from a one-time link (the session lives in that tab, 12 hours at most); on a phone the product list is one block per product. |
| Server stack (`infra/`) | Caddy 2.9 (TLS, CSP with `connect-src 'self' <api>` on every response of the app origin, worker scripts included, `/embed` the only framable route, `/assets` immutable), api, Postgres; one-click deploy with automatic rollback; nightly encrypted backups with a restore drill |
| Site (`apps/site`) | Static marketing site; the release build refuses while its launch gates are open (company identity, mailbox, legal review of the waitlist notice, partner sign-offs), so `curtain.fit` answers 404 until then |

## Behind a flag (all off by default)

| Flag | Where | What it turns on | Waits on |
|---|---|---|---|
| `settings.garment3d` (per shop) | api, merchant | The 3D estimate in the embed for approved bundles | The merchant approving bundles; D17 pricing of 3D (founder) |
| `MEN_3D_GATE` (`_SHOES_ACCESSORIES`) | api env | A men's product opens only with an approved bundle on the male mannequin, never a 2D figure alone (D20.3) | Founder decision 6 |
| `VITE_MALE_SHAPE=v2` with `MALE_SHAPE=v2` | web build, api env (set both) | Male body v2 in 3D and the male 2D figure v2 together; the api then takes and hands out only men's bundles built on v2 | Founder look review. The synthetic men's tee is built on v2 (`build:bundle --male-shape=v2`, `docs/reports/claude/men-tee-on-v2.md`); every other men's bundle must be built on v2 too, or it shows "coming soon" while the switch is on |
| `VITE_VIEWER_HEAD` | web build | `neutral` gives the old head back; default is `neutral-v3` (D22) | Nothing: decided |
| `VITE_VIEWER_LIGHTING` (`neutral`, `neutral-v2`) | web build | Other lighting rigs; default stays `classic` | Founder approval of a lighting change (D22.1) |
| `VITE_AVATAR_SKIN=skin-v2` | web build | Skin shading v2 on the 3D body and the 2D figure (D22.3) | Founder look review; untested on the bake mount and in a production build |
| `VITE_AVATAR_FACE_PHOTO` (`1`, `live`) | web build | `1`: a disabled "coming soon" row; `live`: skin tone from a face photo and the shopper's face on the 2D figure, on the device | Counsel (D19, D20.4); real phones |
| `VITE_AVATAR_FACE_ON_HEAD=1` | web build | Spike: the face on the 3D head. Verdict: not good enough to ship | A narrower spike first (engineering) |
| `VITE_AVATAR_REMEMBER_LOOK=1` | web build | Saves the picked skin colour on the device under "Remember me" | Counsel (consent copy C30) |
| `AI_REALISM` (+ `AI_REALISM_PROVIDER`, `FAL_API_KEY`) | api env | The AI realism panel under the 3D view (D22.2), with consent first and checks that refuse a changed garment | Founder: a provider key and a paid test; engineering: a per-shop monthly cap before it goes on; counsel: the consent copy |
| `heroRenders` (api does not send it) | api | "See it on me" hero render | Not planned for the pilot |
| Site release build | `apps/site` | The marketing site | Company identity, mailbox, legal review of the waitlist notice, partner sign-offs (founder, counsel) |

## Interface language (D21)

English only. After this branch every interface string of `apps/web` lives in a catalogue: the embed's screens
(`embed/strings/en.ts`), the components it shares with the app, the camera scan and the consumer app (`strings/en.ts`),
and the merchant console (`merchant/strings.ts`). Three guard tests fail when a string is written in a component again.
Still inline English, by design or not yet done: the fit engine's own sentences (printed only by the consumer app),
`apps/site`, api error messages and the Shopify admin page (`docs/i18n/README.md`).

## What was verified, and when

| Check | Last run | Result |
|---|---|---|
| `npm_config_workspace_concurrency=1 pnpm check` (build, typecheck, lint, tests, app builds, secret scan, language packs) | 19 Nov, this branch (`claude/loose-ends`) | pass (exit 0; `apps/web` 72 test files, 599 tests; `docs/reports/claude/loose-ends.md`) |
| `pnpm demo:e2e` (WooCommerce demo shop, Shopify Dawn demo with peek and returning shopper, pull-on skirt) | 19 Nov, `claude/launch-readiness` and `claude/pom-gate` (also with `DEMO_SKIRT=pom`); not re-run on this branch | 3 flows pass; the founder's 3D bundles are git-ignored, so those sub-steps were skipped |
| The same two gates on `claude/settings-slice1b` (settings in the Shopify admin, the sign-in link, its review fixes) | 20 Nov, `claude/settings-slice1b` | `pnpm check` exit 0 on the third run (first run: a vitest worker time-out in `spikes/garment-engine` with all tests passing; that suite alone passed); `pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e` 3 flows each (`docs/reports/claude/settings-slice1b.md`) |
| api image build, compose (postgres + api) with a production-shaped env, migrations, health, `caddy validate` | 19 Nov, `claude/launch-readiness`; `docker build` not re-run after the bake check was bundled into the api | pass then |
| WooCommerce on real WordPress 7.1.4 / WooCommerce 11.2.2 | 9 Nov: PHP 8.1, 8.2, 8.3; 19 Nov (`claude/platform-checks`): PHP 8.1.34 and 8.5.12 | 19 Nov: 64 of 64 checks pass on both, Plugin Check 0 errors (after the fix below) |
| The capture step with the real models, no request off the app origin, no CSP violation (`e2e/privacyModels.spec.ts`) | 19 Nov, `claude/privacy-wall` | pass locally; skipped in CI (the models are not fetched there) |
| The real POM v2 skirt bake under the import's bake check | 19 Nov, `claude/pom-gate` | 9 of 9 |
| Server stack on a simulated fresh VPS: bootstrap, first deploy, upgrade, automatic and manual rollback, backup, restore, reboot, power cut | 9 Nov (`docs/GOLIVE-REHEARSAL.md`) | pass |
| Shopify GraphQL documents against the real 2026-10 Admin schema | 9 Nov, again 19 Nov (`claude/platform-checks`) | 0 errors; `Product.featuredImage` / `Product.images` deprecated |
| Real Shopify store, Let's Encrypt, GHCR, the GitHub workflows, real phones | never | open: runbook steps 8–14 and `docs/LAUNCH-SHOPIFY.md` part D |

## Security and privacy review of 19 Nov 2026

Against AGENTS.md hard rules 1–6, over every api route, outbound request, log line and the embed↔page messages
(`docs/reports/claude/launch-readiness.md` has the method and the full list). Fixed on this branch, with tests in
`apps/api/src/launch-review.test.ts`:

- **L1 (medium):** the api request log wrote the full URL, so try-token JWTs, signed hero-render URLs (valid up to
  24 h) and Shopify `id_token`s sat in the 7-day docker log. Lines now carry the route pattern and query parameter
  names only (`apps/api/src/lib/logUrl.ts`).
- **L2 (low):** `K_ANON` accepted 1 in production. The api and `infra/scripts/write-env.sh` now refuse a floor below 5.
- **L3 (low):** the bundle secret scan never read the WooCommerce plugin's PHP. It now does (`scripts/check-bundle-secrets.mjs`).
- **W1 (low, found by the real-WordPress run):** WordPress Plugin Check reported four ERROR-level `ExceptionNotEscaped`
  findings in `class-garment-tape.php` (new since 9 Nov; an ERROR blocks a WP.org review). Escaped.

Confirmed clean: no route accepts a body photo or video, the only image route is the hero render with
`kind: 'avatarRender'` and a neutral-figure guard on the device; no face upload route exists yet (D19 allows one,
none is built); capture code only in `features/capture` behind a worker; no third-party request from the web app
(CSP and code); merchants get only k-floored aggregates, never a device id, measurement, signature or photo; secrets
only in `apps/api/src/env.ts`; banned models and body models refused by the provider registry.

## Known gaps

The full list, deduplicated and marked needs-founder / needs-counsel / needs-real-device / engineering, is
`docs/OPEN-ISSUES.md`. The ones that matter most before the pilot:

- **Waits on the founder:** decisions 1–8 above; a provider key and a paid test before `AI_REALISM` can go on; the look
  reviews (male shape v2, skin v2, lighting); one real tee and three real men's charts per block to measure.
- **Waits on counsel:** the privacy policy, terms and consent copy (D19, D20.4), which also holds the face photo, the
  remembered skin colour and the men's body-chart templates.
- **Waits on a real device or account:** a real Shopify store, Let's Encrypt, GHCR, the GitHub workflows, real phones
  (camera scan, 3D performance, the face photo), a GPU for the drape start-shape fix and the Modal adapter.
- **Engineering, not small:** the drape start shape (every drape starts with a stretched hip line where the rest shape
  cuts into the body; the pull-on plan hides it on today's grid), the 3D view stricter than the advice at hips 114–115
  for AU 16, the per-shop monthly cap for AI realism, the D19 face route (not built), Shopify `featuredMedia`.
- Fixed since the last version of this page: the analytics date-range finding (D23, monthly frozen periods) and the
  missing Anny row in `docs/LICENSES.md`.

**Carried from earlier passes (not re-verified today; see `docs/STATUS-HISTORY.md` "Known gaps")**

- `@curtain/sdk` is `UNLICENSED` but ships inside a WP.org plugin (#14, founder/legal).
- Capture: hair biases girths low by about 1–3 % (#16); the scan prior weight (#17) needs tape-measured volunteers.
- Woo Connect needs WordPress at the host root (SEC-2); device-mint and token-loss residuals (AVAIL-1, AUTH-1).
- Shopify: deprecated `Product.featuredImage` / `Product.images`; one api serves one Shopify app (pilot and App Store
  apps side by side need multi-app support); Polaris web components for Built for Shopify.
- About 3 s of api 502s per deploy (single replica); Docker Hub anonymous pull limits (log the server in).

## Next steps, in order

1. Founder decisions 1–4 and 6, then `docs/LAUNCH-RUNBOOK.md` steps 1–9 (VPS, DNS, bootstrap, secrets, GitHub, merge,
   first deploy, smoke checks).
2. Shopify app and dev-store script (runbook 10–12, `docs/LAUNCH-SHOPIFY.md` part D), every row passing.
3. Custom distribution, install link, setup call with Bohohippychic (runbook 13–14).
4. Legal review (decision 7) before the pilot is announced to real shoppers.
5. After the pilot starts: the first-week watch (runbook 15), then the App Store app.
6. In parallel, none of it on the pilot path: the engineering rows of `docs/OPEN-ISSUES.md`, the look reviews, and the
   first real men's garment.
