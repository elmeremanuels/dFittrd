# Status — 19 Nov 2026

The real state of the integration branch `claude/garment-engine` (PR #1 to `main`), plus this branch
(`claude/launch-readiness`). Read it with `docs/DECISIONS.md` (why), `docs/ARCHITECTURE.md` (layout),
`docs/HANDOFF.md` (product truth) and `docs/LAUNCH-RUNBOOK.md` (the go-live steps). The dated branch entries of
1–9 Nov are kept verbatim in `docs/STATUS-HISTORY.md`; where they disagree with this page, this page is current.

## In one paragraph

Nothing is deployed and nothing has run against a real Shopify store, a real VPS or GitHub's runners. Release v1
(size advice in a "Try it on" overlay, no 3D needed) is built and tested for Shopify and WooCommerce, the server stack
was rehearsed end to end on a simulated Ubuntu 24.04 VPS (9 Nov), and the WooCommerce plugin passes on a real WordPress
with PHP 8.1, 8.2 and 8.3. What stands between today and the pilot shop seeing the button is founder work: the
decisions below, the VPS purchase, DNS, GitHub settings, the Shopify app in the Dev Dashboard, the merge of PR #1 and
the approval of the first deploy. `docs/LAUNCH-RUNBOOK.md` lists every step and who does it.

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
| `@curtain/fit-engine` | Pure, zero runtime dependencies, on-device only (rule 4). Pull-on check and waist reading from a measured band (merchant tape). Another session is adding men's fit points (M2) now |
| `@curtain/schema` | Wire types; garment payload; optional garment tape per size with provenance; size-chart templates (AU women's; men's templates held back for legal review); audience inference |
| SDK (`@curtain/sdk`) | Button → overlay iframe on `/embed/<token>`, exact-origin postMessage, variant selection for Dawn and WooCommerce, size peek (fixed 112 px, no shopper data). 8,057 B gzip of an 8,192 B budget |
| Embed (`apps/web` `/embed`) | About you, optional scan, result with avatar and size rings, "Choose size", Remember me / Forget me, avatar prompt with neutral face and skin-tone picker (colour stays in memory), optional 3D estimate (viewer chunk 165.9 KB gzip of 400 KB). Face photo off in builds (`VITE_AVATAR_FACE_PHOTO`), hero render hidden (the api does not send `heroRenders`) |
| api (`apps/api`) | Fastify 5, Postgres 16, pg-boss. Devices, try tokens, fit-shown billing event, peek, merchant API (HMAC/Bearer/session token), analytics with a k floor, Shopify (token exchange, webhooks incl. GDPR, metafields, chart builder, garment tape), Stripe Connect path for Woo, asset import and approval, men's gate, hero render jobs (avatar image only) |
| Shopify app | Embedded admin page, chart builder and tape entry, "Try it on" theme block, `shopify-deploy` workflow. Offline contract harness against a fake Shopify, requests validated against the real 2026-10 Admin schema (9 Nov) |
| WooCommerce plugin | Meta box with chart templates and tape, PK-HMAC push via Action Scheduler, bundled SDK button under the variation form, Connect with domain proof, uninstall. PHP 8.1+, WordPress 6.6+, WooCommerce 9.0+ |
| Garment engine (3D) | Spike + `@curtain/garment-viewer`: bundles on female and male mannequins (male bundles only on the male body), drape control, per-size measured waistbands, POM v2 server-drape bake blended on the device, look v2. Bundles are imported by hand and need merchant approval (D13, D16). No GPU runs in this session |
| Server stack (`infra/`) | Caddy 2.9 (TLS, CSP, `/embed` the only framable route, `/assets` immutable), api, Postgres; one-click deploy with automatic rollback; nightly encrypted backups with a restore drill |
| Site (`apps/site`) | Static marketing site; the release build refuses while its launch gates are open (company identity, mailbox, legal review of the waitlist notice, partner sign-offs), so `curtain.fit` answers 404 until then |

## What was verified, and when

| Check | Last run | Result |
|---|---|---|
| `npm_config_workspace_concurrency=1 pnpm check` (build, typecheck, lint, tests, app builds, secret scan, language packs) | 19 Nov, this branch | pass (counts in `docs/reports/claude/launch-readiness.md`) |
| `pnpm demo:e2e` (WooCommerce demo shop, Shopify Dawn demo with peek and returning shopper, pull-on skirt) | 19 Nov, this branch | 3 flows pass; the founder's 3D bundles are git-ignored, so those sub-steps were skipped |
| api image build, compose (postgres + api) with a production-shaped env, migrations, health, `caddy validate` | 19 Nov, this branch | pass |
| WooCommerce on real WordPress 7.1.4 / WooCommerce 11.2.2 | 9 Nov: PHP 8.1, 8.2, 8.3 (39 checks each); 19 Nov: PHP 8.1 | 19 Nov: 40 checks pass, Plugin Check 0 errors (after the fix below) |
| Server stack on a simulated fresh VPS: bootstrap, first deploy, upgrade, automatic and manual rollback, backup, restore, reboot, power cut | 9 Nov (`docs/GOLIVE-REHEARSAL.md`) | pass |
| Shopify GraphQL documents against the real 2026-10 Admin schema | 9 Nov | 0 errors; `Product.featuredImage` / `Product.images` deprecated |
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

**Open from this review**

- Merchant analytics take any date range, so two overlapping ranges can be subtracted to see a group below the k
  floor (e.g. the recommended sizes of one day's shoppers). Fix needs a product decision: floor fixed, disjoint
  periods (weeks or months) and sum them. Medium; matters once a shop has enough traffic for the floor to bite.
- `docs/LICENSES.md` does not list Anny (Apache-2.0 code, CC0 assets), used by the server-drape spike only.
- No face route yet: when D19's opt-in face upload is built it needs its own abuse limits and the nothing-stored test
  (`docs/legal/` test spec).

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
5. After the pilot starts: the first-week watch (runbook 15), then the analytics period fix and the App Store app.
