# Status — 2026-11-06

This is the integration snapshot after the parallel build and review passes. Read it with
`docs/DECISIONS.md` (why), `docs/ARCHITECTURE.md` (layout) and `docs/HANDOFF.md` (product truth).

## Release v1 (standalone plugin) — 6 Nov 2026

Goal: ship size advice **without** the 3D engine (D11, D17) to Shopify, first as a custom
(unlisted) app for the pilot shop bohohippychic.com.au (Australia, AUD, AU 8–16), then the public
App Store. Benchmark: SmartSize (size charts, chart templates, unit conversion, fit quiz, a button
next to the size selector). The 3D garment engine keeps being built on this branch in the
background (section below); nothing in the release depends on it.

### Verification run (6 Nov 2026, repo root, demo stopped, `.demo-db` removed first)

| Command | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` | pass, lockfile up to date |
| `pnpm check` | pass (build, typecheck, lint, tests, app builds, secret scan clean; SDK 7,802 B gzip of 8,192) |
| `pnpm demo:e2e` | pass, both flows (WooCommerce and Shopify Dawn), returning shopper included |

Tests: schema 351, shopify-app 139, api 159, web 300, sdk 90, fit-engine 111, taste-engine 95,
tryon-providers 70, anchors 53, mannequin 38, woocommerce-plugin 66 (PHP), demo-shop 8,
garment spike 219 + 47.

### Fixed in the release review pass (R1–R7)

| # | Finding | Fix | Test |
|---|---|---|---|
| R1 (high) | Every product of an AUD shop failed `GET /v1/try` with 422 `product_incomplete`: the Shopify mapper dropped non-EUR prices and `priceEur` is required. The pilot shop prices in AUD. | `priceToEur` (`packages/schema/src/mappings/common.ts`) converts with the EUR rate table and warns; both Shopify sync jobs pass `DEFAULT_EUR_RATES`; Woo takes the same option. Size advice no longer needs a price at all (R2). Listed as pilot blocker G1 in `docs/app-store/checklist.md`. | `packages/schema/src/sizeAdvice.test.ts` (AUD → `fromShopifyProduct` → `GarmentPayloadSchema`), `apps/api/src/pilot-size-advice.test.ts` (AUD → upsert → `/v1/sdk/sessions` → `/v1/try`) |
| R2 (high) | A chart assigned in the builder did not make a product try-able: fabric, pattern block and colour were also required, and only fabric had a UI. | New `sizeAdviceGarment` (`packages/schema/src/sizeAdvice.ts`): category + chart type + chart are required; price (0), colour (the shop's brand colour), pattern block (`unspecified` → fit-engine category defaults) and fabric (non-stretch woven, drape 0.5) default; present fields must still be valid. `GET /v1/try` uses it (`asTryGarment`, `apps/api/src/services/products.ts`). The app-mode try page hides a defaulted price, fabric and block. | same two files |
| R3 (medium) | Admin "Try-able / Needs data" and the checklist's "required" marks did not match what the try route accepts; flat-lay photos were demanded. | One predicate: the stored product status, `productChecklist().status` and the "required" marks all come from `sizeAdviceGarment` / `SIZE_ADVICE_FIELDS`. The flat-lay row only appears with `{ render: true }` (3D plan). Admin text now says what is really missing. `score`/`missingFields` stay the full completeness. | `packages/shopify-app/src/chartBuilder.test.ts`, `apps/api/src/pilot-size-advice.test.ts` |
| R4 (medium) | Production SSH key was a repository secret (readable by any branch's workflow, before approval); any branch could be deployed. | `.github/workflows/deploy.yml`: the guard reads no secret, allows only `release` and `main`, checks variables; the secret check runs first inside the `production` environment jobs. `docs/DEPLOY.md` §5: `VPS_*` are **environment** secrets, required reviewer and deployment branches `release`/`main` are mandatory. | YAML parse; the GitHub-side rules must be set by the founder |
| R5 (low) | The "Pick a template" step never completed for the default AU template, and a saved template was never restored. | `onboardingSteps` marks the step done once products have a chart; a successful assign saves the template; `loadOnboarding` restores the saved template before the AU default. | `chartBuilder.test.ts`, `adminCharts.test.ts`, `apps/api/src/shopify/charts.test.ts` (updated: it asserted the old behaviour) |
| R6 (low) | Switching "These numbers are" to garment silently turned a body template into a garment chart (one size too large). | The admin clears the body numbers on a body → garment switch and warns (switching back restores the template); `checkChart` warns when garment rows equal a body template (`bodyTemplateMatching`). | `adminCharts.test.ts`, `sizeAdvice.test.ts` |
| R7 (low) | Privacy policy said merchants see a per-shop pseudonym. | `docs/legal/privacy.md` (Security and the try-on session paragraph) and the app's pairing screen now say merchants see totals only; the pseudonym is internal (k-floor counting). | `apps/web/src/routes/legal.test.tsx` (renders the policy) |

### What is ready (code and tests, not yet on a live store)

- Shopper side: the "Try it on" theme app block (placed by the merchant, under the size picker on
  Dawn), the full-screen overlay with About you (metric or imperial), optional on-device scan, the
  size recommendation with per-point fit, the product's own size table with the size highlighted,
  "Choose size" selecting the variant on the page, remember me / forget me. No app install.
- Merchant side: embedded admin with five-step onboarding, AU/UK/EU/US women's body templates and
  garment templates, cm/in, bulk assign by collection, tag, type or picker, description import for
  one-size items, per-product checklist and preview link, usage and privacy ledger.
- A product is try-able as soon as a chart is assigned (R2), also in AUD (R1).
- Backend: managed install and token exchange, GDPR webhooks, product sync and backfill, billing
  through `appSubscriptionCreate`, one-click deploy with rollback, backups and a restore drill
  script (`docs/DEPLOY.md`).

### Still blocking in code

| For | Item | Where |
|---|---|---|
| pilot | **B1** billing still has free / starter EUR 29 + usage / pro; D17 says one flat USD 8.99 per month, no usage line. Until it is changed the pilot shop would be asked for the wrong price. Workaround for a pilot: leave the pilot shop on the free plan (50 sessions) or raise its cap by hand. | `apps/api/src/billing/plans.ts`, checklist B1 |
| pilot | The live-store items in `packages/shopify-app/README.md` "Must be verified against a live store" (GraphQL `2026-10` queries, theme block on Dawn and the pilot theme, sync, billing in AUD, GDPR deliveries). | README |
| public | **A3** expiring offline tokens (required for new public apps; non-expiring tokens are delisted from 1 Jan 2027). | checklist A3 |
| public | Lighthouse impact measured (D5), privacy e2e in CI, listing screenshots and screencast. | checklist D5, E5, E6, F |
| competitive | Versus SmartSize: no men / kids / lingerie / shoe templates, no screenshot import, no automatic button placement on every theme, admin in English only, no reviews or Built for Shopify badge yet. Where we are ahead: an actual size recommendation on every plan, from body or garment charts, without the shopper's measurements leaving the browser. | `packages/shopify-app/README.md` "Versus SmartSize" |

### What the founder must provide

1. **Shopify Partner account** and an app in it (name: "Curtain: Fit & Size Finder" or the cleared
   trademark), its client id and secret (go into `/etc/curtain/curtain.env` on the VPS, never into
   the repo), a development store for the dry run, and an emergency contact.
2. **VPS** (2 vCPU / 4 GB is enough) and the GitHub settings from `docs/DEPLOY.md` §5: the
   `production` environment with you as required reviewer, deployment branches `release` and `main`,
   and the four `VPS_*` **environment** secrets; repository variable `DOMAIN`.
3. **DNS**: `app.<domain>` and `api.<domain>` A/AAAA records to the VPS (`docs/DEPLOY.md` §2).
4. **Prices**: confirm D17 (USD 8.99 flat, trial length) so B1 can be built, and what the pilot shop
   pays (free pilot or the real plan).
5. **Legal review** of `docs/legal/privacy.md` and `docs/legal/terms.md`: legal entity, address,
   retention period for shopper records (C9), hosting region, subprocessors. Not legal advice.
6. Support e-mail and a help page for the listing; trademark clearance (D1) before the public listing.

### Install unlisted at the pilot shop, step by step

1. **Server**: run `scripts/deploy-bootstrap.sh` on the VPS, fill `/etc/curtain/curtain.env`
   (Shopify client id and secret, `PUBLIC_API_URL=https://api.<domain>`,
   `PUBLIC_APP_URL=https://app.<domain>`), set the GitHub environment as above.
2. **Deploy**: push to `release` (or Actions → deploy → branch `release` → `deploy`), approve the
   run, wait for `https://api.<domain>/healthz` to answer.
3. **App config**: in `packages/shopify-app`, `pnpm configure` for a `prod` config with the public
   URLs, then `shopify app deploy` (publishes the theme block, the webhooks and the GDPR topics).
4. **Dry run on a development store** with an AUD billing currency: install, open the admin, pick the
   AU template, assign it to a collection, add the block in the theme editor, open a product,
   "Try it on", get a size, choose it. Work through the live-store verification list.
5. **Custom distribution**: Partner Dashboard → the app → Distribution → *Custom distribution* →
   the pilot shop's `*.myshopify.com` domain → generate the install link (irreversible for that
   app; one custom app per shop).
6. **Merchant install**: the owner of bohohippychic.com.au opens the link while logged in, approves
   the scopes (`read_products`, `write_products`), and lands in the Curtain admin. The catalogue
   backfill starts on its own.
7. **Setup in the admin (about 10 minutes)**: keep the preselected AU template, untick sizes the shop
   does not sell (keep 8–16), assign it to the Dresses (and Tops) collections, click "Add the block"
   (theme editor deep link), place it under the size picker, save the theme.
8. **Test**: open a dress on the live shop, "Try it on", enter height and weight, get a size, choose
   it, check the size is selected on the page and the admin shows the session. Then mark "Test it
   on a product" done.
9. **Watch the first week**: usage and anomalies in the admin, `docker compose logs api` on the VPS,
   the nightly backup and one restore drill.
10. **Public listing later**: finish A3, B1, D5, the legal review and the listing assets, then switch
    a (new) app to public distribution and submit (`docs/app-store/checklist.md`).

## Garment engine — Phase 0 preparation (Nov 2026)

Branch `claude/garment-engine`, against `docs/ENGINE-HANDOFF.md`. This is the work that can be
done **without** a GPU service, video models or pilot photos: the carry-over findings, the shared
vocabulary and fabric library, the canonical mannequin, the model-free pipeline stages and a spike
viewer. **Phase 0 itself has not started.** None of its six acceptance items (size test, fabric
test, chart agreement on real products, view agreement, measured cost, write-up) is met yet.

### Round of 6 Nov 2026: carry-over leftovers, Modal pipeline, viewer speed

**Verification run (6 Nov 2026, repo root, demo stopped, `.demo-db` removed first)**

| Command | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` | pass, lockfile up to date |
| `pnpm check` | pass (secret scan clean, SDK 7,802 B gzip of 8,192) |
| `pnpm demo:e2e` | pass, both flows (WooCommerce and Shopify Dawn) |
| `pnpm --filter @curtain/garment-spike build:bundle` | pass: aalter-studio-2 14,720 triangles, 296 KB, IoU 0.9955, 3.9 s; monochrome-03 7,808 triangles, 165 KB, IoU 0.9912, 3.2 s |
| `pnpm --filter @curtain/garment-spike export:phase0 -- --product all --synthetic-photos` | pass: 160 turntable + 81 motion frames at 480×832 per product, 1,052 files, 17.6 / 14.7 MB, 13–14 s each |
| `pnpm --filter @curtain/garment-spike viewer:smoke` | pass, 14 screenshots, 67 s total |
| `python -m pytest -q tests` in `spikes/garment-engine/modal` (Python 3.11, Open3D 0.19.0) | 33 passed |

Tests: schema 319, fit-engine 111, anchors 53, mannequin 38, taste-engine 95, sdk 90,
tryon-providers 70, shopify-app 104, woocommerce-plugin 66 (PHP), api 146, web 261,
garment spike 91 + viewer 43. Web: 31 precache entries.
Not run here: the Playwright privacy e2e, the api Docker image build, real phones, any `modal run`
from this container.

**Carry-over findings closed this round** (numbers as in the list below): #16 head top without
hair (`headTopWithoutHair`, web `headTop.test.ts`), #20 neutral fit term for items without fit
points (taste-engine `carryover.test.ts`), #22 seen memory, wardrobe and outbox keyed by shop and
item with a Dexie migration (taste-engine, web `shopKeys.test.ts`), #23 `/v1/swipes` accepts the
valid events of a batch and reports the rejected ones (api `swipes.test.ts`), #24 an explicit
`unknown` wardrobe size instead of `"ONE"` (`WARDROBE_SIZE_UNKNOWN`). Also this round: the fabric
library wired into the Woo meta box and Shopify metafield mappings (schema `fabricWiring.test.ts`,
plugin `fabric-text.test.php`), `billing_anomalies` in the drizzle schema and snapshots, merchant
views moved to `routes/merchant.ts`, and the Caddy CSP `img-src` narrowed to our own origins.
#17 has only been made one named constant; the prior share itself is unchanged.

**Review findings fixed at the end of this round**

| Id | Fix | Test |
|---|---|---|
| cohort-unknown-bucket-server (low) | `fitCohort` no longer counts `unknown` rows as a size bucket; they still count towards `n` and the kept rate. The web client's filter stays as a fallback for older servers. | api `analytics.test.ts` |
| R-yoke-not-from-width (medium) | D15 in `DECISIONS.md`, `ENGINE-HANDOFF.md`, the viewer README and the code comments now say what the code does: `shoulder_width` drives only the size-to-size ratio of the shoulder ring. The synthetic yoke's absolute width is the mannequin torso's (about 21.6 cm half-width on the ring, about 26 cm just around it), and the `anchors.json` seams at ±width/2 are notional chart points, not on the mesh. Not fixed in geometry. | spike `grading.test.ts` pins the gap |
| R-readme-p99-inconsistent (low) | The viewer README gives the strain per product: dress p99 9–11.5 %, tee p99 11–24 % (XS–L). | viewer `engine.test.ts`: tee XS–L p99 < 25 %, max < 45 % |
| R-node-bench-removed (low) | New `spikes/garment-engine/viewer/scripts/bench-drape.ts` reproduces the node "after" numbers. The "before" numbers came from a deleted scratch script of the old engine and are labelled as a one-off. | — (script, not a test) |

**Modal pipeline.** The code is in `spikes/garment-engine/modal/` (stage 2 video with
Wan2.2-Fun-A14B-Control, stage 4 gsplat 2DGS reconstruction + TSDF mesh, `run_phase0.py`, cost
records). This cloud session cannot reach Modal (the network proxy blocks gRPC), so nothing was run
from here. Runs go through `.github/workflows/modal.yml` on GitHub runners, triggered by
`.github/modal/run.txt`, or from the founder's computer (`modal/README.md`). Recorded on GitHub
Actions so far (branch `claude/garment-engine`, 6 Nov 2026; checked with `gh run list`/`gh run view`):

- `smoke.py`: passed on an L4 (CUDA, 20 × 4096² matmul in 0.43 s, 15.6 s wall with cold start). Five earlier runs failed on secret formatting and GPU selection.
- `stage4_recon.py --source synthetic` on aalter-studio-2 (L40S): the first attempt failed; after the per-camera colour fix it passed. 10k iterations in 64.6 s train + 8.0 s fuse + 2.9 s mesh, 79 GPU s. Masked PSNR 31.3 train / 31.1 holdout, mask IoU 0.993 / 0.992, mesh 12,000 triangles (in budget, edge-manifold, not watertight), against the synthetic truth: Chamfer mean 1.45 cm, F-score 0.41 at 1 cm and 0.79 at 2 cm, max error 9.8 cm. Cost **estimate** $0.04–0.05 (list price × seconds; the Modal invoice is the measurement and was not read).
- Stage 2 (Wan2.2 video) has **not** produced a result yet: run 10 (`run_phase0.py`, stage 2 then stage 4) was queued in `run.txt` while this was written; its outcome is not recorded here. So no generated video, no seam drift, no stage 4 on generated frames, and no real GPU cost per product exist yet. The founder's computer remains the fallback if the Actions route stops working.

**Spike viewer, measured before and after** (4-core build container, headless Chromium with
SwiftShader, so rendering also runs on the CPU; numbers from `viewer:smoke`):

| | Before (5 Nov) | After (6 Nov, this run) |
|---|---|---|
| Dress, one size | 6.2–7.6 s | 1.2–1.4 s per size (3 workers), first drape after page load 2.61 s (worker start in the Vite dev server) |
| Dress, three sizes side by side | 20–24 s | 2.2–2.3 s wall (sizes in parallel) |
| Tee, three sizes | 13.6 s | 2.4 s wall, 0.93–0.96 s per size |
| Node CPU, one size (`viewer/scripts/bench-drape.ts`) | dress 3.0 s, tee 1.45 s (one-off, script gone) | dress 1.0–1.07 s, tee 0.32–0.47 s |
| Edge strain after the drape (node) | — | dress p99 9–11.5 %, tee p99 11–24 % (XS–L), max 18–39 % |
| Production build, largest chunk | 199 KB gzip | 208 KB gzip (`scene`, three.js not split; budget 400 KB) |

1 of 16 fresh drapes in the smoke run is over the 2 s budget (the first one). Phone: not measured.

**Remaining gaps after this round**

- Stage 2 on a GPU without a recorded result; stages 3 and 4 never run on generated video.
- The synthetic yoke is the mannequin's width, not the chart's; real seams need a reconstruction with seams or a tailored synthetic yoke.
- Tee strain is high on small sizes (p99 up to 24 %), and the body-104/90/112 smoke case shows 53.5 % neck strain (body wider at the shoulders than the garment, not checked). The v0 mannequin's arms overlap the torso.
- Drape on a mid-range phone, the hero-render flow, the blind tests with five people and pilot data: all still open (see "What Phase 0 still needs").
- Carry-over #14 (SDK licence, founder) and #17 (population prior share, needs tape-measured volunteers) stay open.

### Verification run (5 Nov 2026, repo root, fresh `.demo-db`)

| Command | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` | pass, lockfile up to date |
| `pnpm check` (build packages, typecheck, lint, test, build apps, bundle secret scan) | pass |
| `pnpm demo:e2e` | pass, both flows (WooCommerce and Shopify Dawn): overlay, About you, result, "Choose size L", returning shopper |
| `pnpm --filter @curtain/garment-spike build:bundle` | pass, 2 products (numbers below) |
| `pnpm --filter @curtain/garment-spike viewer:smoke` | pass, 11 screenshots in `spikes/garment-engine/out/screens/` |

Tests: schema 298, fit-engine 111, anchors 53, mannequin 38, taste-engine 84, sdk 90,
tryon-providers 70, shopify-app 104, woocommerce-plugin 53 (PHP), api 135, web 241, demo-shop 8,
garment spike 70 + viewer 28. SDK bundle 7,802 B gzip (budget 8,192). Web: 31 precache entries.
Not run here: the Playwright privacy e2e, the api Docker image build, real phones.

### Review findings fixed in this pass

| Id | Fix | Test |
|---|---|---|
| SEC-1 (high) | Woo `/woo/complete` now checks the domain proof on **every** path, not only manual-key. `/woo/connect` returns `verification.nonce` in Stripe mode too (the plugin already publishes whatever nonce it gets). A paid Stripe trial is no longer proof of a domain. | api `stripe.test.ts`: Stripe flow without the proof → 403 `domain_unverified`, no key issued |
| SEC-2 (medium) | The proof is fetched only from the root of the claimed host (`https://<host>/wp-json/curtain/v1/verify`, then `/?rest_route=`); the path of `siteUrl` is ignored. The HTML meta-tag fallback is gone (api and plugin), so a string reflected on a page cannot pass. Consequence: WordPress must answer at the host root. | api `media-proof.test.ts`: `/~attacker/` path refused, reflected meta tag refused; plugin `connect-proof.test.php` |
| AVAIL-1 (medium) | `DEVICE_CREATE_RATE_LIMIT_PER_HOUR` default 30 → 300 per IP (shoppers share carrier NAT / shop Wi-Fi; the embed without storage mints a device per open). A 429 from `/v1/devices` or `/v1/try` now shows a retryable "Busy right now" screen in the embed instead of "Something went wrong". Documented in `docs/STANDALONE.md` and `infra/.env.example`. | web `flow.test.ts` |
| PRIV-1 (medium) | "Delete my scan" drops the pending signature PUT first, then queues a durable `signature_delete` outbox row. The syncer sends signature rows one at a time in queue order, so an in-flight PUT lands before the DELETE; the DELETE retries past `MAX_ATTEMPTS` until a 2xx (only a permanent 4xx ends it). `signatureSyncedAt` is cleared only when the server confirms. | web `outbox.test.ts` (+2), `store.test.ts` (+1) |
| AUTH-1 (medium) | Device rotation and registration run under one Web Lock across tabs and re-read the stored credentials first. A `token_rotated` 401 (from rotate or from any request) reloads the stored token and retries with it instead of clearing it and registering. `updateSettings` no longer writes a stale tab's device token over a newer one. A new device is registered only on `invalid_token`, on first run, or when a rotated token was kept by no context at all (see open gaps). | web `client.test.ts` (+4), `store.test.ts` (+1) |
| R1 (medium) | New D15 breadth anchor `shoulder_width` (`ANCHOR_BREADTHS`, `BREADTH_RING`). The fit point `shoulder` (a width) maps to it in `@curtain/anchors` and in the fit engine's `FIT_POINT_ANCHORS`/`FitAnchorId`, so `anchorGaps` never keys a width under the `shoulder` ring (a girth). D15 amended in `docs/DECISIONS.md`. | anchors `vocabulary.test.ts`, fit-engine `anchors.test.ts` |
| R2 (medium) | The spike viewer no longer decides "does not close" from the display preset's stretch. A loop is `open` only when the fit engine bands that anchor `tight` (its stretch-adjusted limit, from the product's own fabric); `placeGarment` no longer takes a stretch. | viewer `fitting.test.ts` (both repros) |
| R3 (medium) | `resolveFabric` keeps a construction named in the composition as the construction, also when it has a base fibre ("100% cashmere" → wool + cashmere, like `parseFabricText`). The spike's `materialJson` passes a construction `primary` ("denim" with a cotton/elastane blend → denim, twill). | schema `fabrics.test.ts`, spike `garment.test.ts` |

### Carry-over findings (ENGINE-HANDOFF §Carry-over)

Closed (code and tests in this branch):

1. SSRF guard pins DNS: `lib/safeFetch.ts` resolves once, validates, and connects to that address; the media proxy, the hero render and the Woo proof use it. Stage 1 ingest does not exist yet and must go through it.
2. Duplicate size labels are rejected in schema `garment.ts` (`duplicateSizeLabels`); `fitSummary` never summarises an ambiguous row; grading throws on them.
3. "Boot cut jeans" is a bottom: bottoms phrases with "boot" come first in `mappings/common.ts`; "Chelsea boot" stays a shoe.
4. Shopify API version `2026-10`, one constant in `@curtain/shopify-app` (`DEFAULT_API_VERSION`), mirrored in api env and `infra/.env.example`. Not re-validated in GraphiQL on a real store.
5. The api's Shopify client is a thin wrapper over `@curtain/shopify-app`.
6. Shopify billing uses the shop's billing currency (`shopBillingPreferences`), stored per shop and reused for usage records.
7. Standalone billing: per-plan daily cap (`BILLED_DAILY_CAP_*`) next to the global anomaly cap, and billing anomalies recorded and shown to the merchant.
8. Deck swipes bill only for a paired device under the per-plan daily cap (`billFitSession`, shared with fit-shown).
9. `DELETE /v1/me/signature` exists, and "Delete my scan" now reaches it durably (PRIV-1).
10. Expired tokens rotate within `DEVICE_TOKEN_ROTATE_GRACE_DAYS` (180), and the cross-tab race no longer re-registers (AUTH-1). One residual case, below.
11. Shop logo and overlay product photo load through `GET /v1/sdk/media` on our origin (allowlisted per shop, sniffed type, size cap, cache).
12. Woo domain proof on every Connect path, from the host root (SEC-1, SEC-2).
13. The Woo signed backfill endpoint was removed from the plugin.
15. Plugin "Tested up to" headers updated; the Connect redirect is restricted to `https://checkout.stripe.com/`.
18. The console shows the size distribution of standalone sessions (`analytics/fit-sizes`, k-floored).
19. The abandoned-opens k floor counts distinct devices, not sessions.

Still open as of 5 Nov (16, 20, 22, 23 and 24 were closed on 6 Nov, see the round above):

14. SDK is `UNLICENSED` but ships in a GPL plugin: founder decision, before WordPress.org.
17. About 58 % population prior in the girth means: needs the tape-measured volunteers.
21. Superseded by the Phase 5 photo finish.

### What was built for the engine, and what each proves

| Part | Where | What it proves | What it does not |
|---|---|---|---|
| Anchor vocabulary (D12–D16 recorded, D15 amended) | `packages/anchors` | One set of ids for scan, fit engine, asset and renderer: 12 rings, 6 lengths, 1 breadth; mappings from fit points, scan levels and `lengthCm` keys, tested against `@curtain/schema`; ring geometry (Ramanujan II, exact inverse) and the grading morph (monotone cubic, never overshoots). Zero runtime dependencies. | Nothing about real garments. |
| Fit engine re-keyed by anchor | `packages/fit-engine` `anchorGaps` | The viewer can read per-anchor gaps with no maths of its own (rule 4); a test compares every gap with `fitGapsForRender` over 200+ cases. | — |
| Scan → anchors | `apps/web/src/features/capture/anchors.ts` | The scan's 12 levels map to the 12 rings. | The hair bias (#16) is still in the rings. |
| Fabric library v1 | `packages/schema` `fabrics.ts`, `mappings/fabricText.ts`, `docs/research/fabrics.md` | 12 fibres and the constructions of the handoff with sources; blend → parameters, construction overrides, elastane share, Dutch/English text parsing. | The numbers are trade ranges and estimates (listed per entry); not calibrated against real drape. |
| Canonical mannequin v0 | `packages/mannequin` | Deterministic procedural body in 3 shapes (XS/M/XXL), 14.8–15.2k triangles each, girth on the mesh equal to the table at every ring, length lines, turntable camera paths (72 frames at three heights), a 6 s motion clip with a 10-joint rig, a glTF writer. | Not anthropometric; limbs overlap the torso; Phase 1 replaces the shape table. |
| Spike stage 3 (separation) | `spikes/garment-engine/src/separation.ts` | Difference mask vs the bare mannequin works on our own synthetic renders: IoU 0.9955 / 0.9912 over 72 frames. | Untested on generated video; fails for a garment the colour of the mannequin (IoU < 0.5); no SAM 2 / motion signal yet. |
| Spike stage 5 (anchoring, calibration) | `src/anchoring.ts` | Plane slicing measures any mesh in mannequin space; least-squares global scale then per-ring correction removes a simulated reconstruction error (6.3–6.6 cm max before, 1.65 / 0.00 cm residual after the global scale, 0.00 cm after calibration). | Chart agreement is ~0 by construction on synthetic data; the real tolerance needs Phase 0 data. |
| Spike stage 6 (grading) and bundle | `src/grading.ts`, `src/bundle.ts` | Per-size targets from the chart, standard increments where it has no column (logged), and the bundle format (base.glb, anchors.json, grading.json, material.json, qa.json) with an input hash, deterministic. | No Draco, no KTX2, no textures or UVs; `shoulder_width` in grading.json drives only the size ratio of the yoke, not its absolute width. |
| Spike viewer | `spikes/garment-engine/viewer` | The device half end to end on synthetic data: avatar from typed measurements, per-anchor placement from fit-engine slack, PBD drape with collision, S/M/L side by side, fit map, linen/silk presets, and `blind.html` for the size and fabric tests with CSV export. | Not the product viewer (`packages/garment-viewer`, Phase 2); no WebGPU, no fallback, no textures; drape per size about 1.2–1.4 s in software rendering since 6 Nov, the first drape after page load over 2 s; not measured on a phone. |
| Research | `docs/research/garment-engine.md`, `fabrics.md`; banned-model lint extended (`tryon-providers` `bannedModels.ts`) | Shortlist with licences: Wan2.2-Fun Control (Apache-2.0) vs Kling 3.0 Pro (hosted); gsplat 2DGS vs NeuS-style SDF; Anny body model (Apache-2.0); Modal EU / Koyeb. Two plan risks found: no hosted video API with verified camera-trajectory control, and none with an EU region. | Cost per product is an **estimate** ($1.3–5.6 per attempt, $250 Phase 0 budget), not a measurement. |

### What Phase 0 still needs

- **Accounts:** a GPU service account (Modal EU and/or Koyeb) and API access to the candidate video models. Founder call on US/Asia processing of merchant product photos for a hosted video model (no EU region found).
- **Stages 2 and 4 on a GPU:** image → video (two models, ~3 seeds each) and reconstruction (two methods), plugged in where `generateGarment` + `distortGarment` sit in `buildBundle`. Stage 3 also needs the segmentation refinement and the motion signal.
- **Pilot data:** 5 real products from the pilot shop (dresses and tops) with merchant front and back photos, size chart and base size.
- **The tests:** five people who did not build it, on `blind.html`: size test (≥ 4 of 5 products), fabric test (linen vs silk), plus merchant view agreement.
- **Measurements:** GPU seconds, wall time and cost per product; drape settle and frame rate on a mid-range phone; the Phase 0 write-up with chosen models and tolerances.

### Measured numbers (synthetic data, this sandbox)

| What | Value |
|---|---|
| Spike bundle `aalter-studio-2` (shirt dress) | 14,720 triangles, 295 KB (base.glb 269 KB), built in 4.7 s |
| Spike bundle `monochrome-03` (tee) | 7,808 triangles (below the 8–15k guidance), 165 KB (base.glb 145 KB), built in 4.1 s |
| Chart agreement after calibration | 0.00 cm on both (by construction); residual after global scale 1.65 / 0.00 cm |
| Separation IoU, 72 frames | 0.9955 (lowest frame 0.988) / 0.9912 (lowest 0.982) |
| Mannequin v0 | 14.8–15.2k triangles per shape |
| Spike viewer production build | largest chunk 758 KB raw, 199 KB gzip (three.js included); handoff budget 400 KB gzip |
| Drape settle, 1.5 s of cloth | 5 Nov figures, superseded: see "Spike viewer, measured before and after" in the 6 Nov round. Phone budget ≤ 2 s per size: not measured |
| Asset budget ≤ 3 MB per product | 165–295 KB without textures |

## Verification run before the engine branch (repo root, Node 22, pnpm 10.28.0)

| Command | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` (and `--frozen-lockfile`) | pass, lockfile up to date |
| `pnpm build` (packages, then apps) | pass (web: 27 precache entries; zod's "annotation Rollup cannot interpret" warnings only) |
| `pnpm -r typecheck` | pass, 10/10 projects (woocommerce-plugin: 27/27 PHP files pass `php -l`) |
| `pnpm -r lint` | pass, including the banned-model check in tryon-providers |
| `pnpm -r test` | pass, **769 tests** (see the per-package table) |
| `node scripts/check-bundle-secrets.mjs` | pass: no secret-looking strings in client bundles |
| `pnpm --filter @curtain/woocommerce-plugin build` | pass: `dist/curtain-woocommerce.zip` (72,737 B, 31 entries, bundles `assets/sdk.v1.js` and both JSON Schemas) |

Not run here: the Playwright privacy e2e (`pnpm --filter @curtain/web e2e`, no Chromium in this
sandbox, and CI does not run it yet), and the api Docker image build (no Docker daemon in this
sandbox; CI's `api-image` job builds it).

| Package | Tests |
|---|---|
| `@curtain/schema` | 115 |
| `@curtain/fit-engine` | 102 (spec vectors T1–T16, 1,000-body purity fuzz) |
| `@curtain/taste-engine` | 84 (spec vectors 1–16, colour harmony) |
| `@curtain/sdk` | 54 |
| `@curtain/tryon-providers` | 65 |
| `@curtain/shopify-app` | 86 |
| `@curtain/woocommerce-plugin` | 41 (PHP runner with WP shims) |
| `@curtain/api` | 76 (PGlite + in-memory queue + mock provider) |
| `@curtain/web` | 146 (node + jsdom, fake-indexeddb) |

## Standalone mode (D11)

Founder decision D11: the merchant plugin works **without** the Curtain consumer app. The contract is
`docs/STANDALONE.md`; this section is its build status.

### What is implemented

- **SDK (`@curtain/sdk`)**: `data-mode="embed"` (default), `app` and `auto`. Clicking "Try it on" opens a
  full-screen overlay on the merchant page holding an iframe to `/embed/<token>`. There is no QR code
  and no deep link. The overlay has a focus trap (with a sentinel after the iframe, so Tab out of the
  iframe wraps to the close button), Escape, `aria-modal`, scroll lock, a loading state and reduced
  motion. The postMessage protocol checks the exact origin and source. Variant selection runs in this
  order: merchant hook, Shopify cart form, WooCommerce `variations_form`, then a toast. It is scoped
  to the product section of the button that was clicked, and it understands Dawn 15 dropdowns (numeric
  id values, "XS - Unavailable" labels). Bundle: 7.8 KB gzip (budget 8 KB).
- **Fitting room (`apps/web`, `/embed/:token`)**: product header, About you (height, weight, fit
  preference, optional age range and body type, "I know my measurements"; shoes always ask for the EU
  shoe size), an optional camera scan, and the result. The result shows the fit-engine size, the
  per-point fit, the avatar with the garment overlay, the confidence and the estimate disclaimer,
  plus size comparison and "Choose size X". The footer has "Remember me" (IndexedDB partitioned per
  shop; turning it off is remembered as a non-personal flag), "Forget me" (local wipe plus
  `DELETE /v1/me`) and "Get the Curtain app". Measurements and photos never leave the iframe (D3).
- **api**: `surface: 'embed'` sessions with `embedUrl`, `embed.allowedOrigins` on `GET /v1/try/:token`,
  and `POST /v1/try/:token/fit-shown` as the billing event (one per intent token, paused shop → 402).
- **Plugins**: the Shopify theme block and WooCommerce settings for "Experience" (`data-mode`) and
  "Size option name" (`data-size-option`), in en and nl.
- **Framing**: `/embed/*` is the only framable route (`frame-ancestors https:` in Caddy, and in Vite
  dev for the demo).

### Fixed in the standalone review pass

| Finding | Fix |
|---|---|
| SEC-1 fit-shown billable by script | fit-shown bills only when all of these hold: `surface === 'embed'`; the session's `pageOrigin` belongs to the shop (in `embedAllowedOrigins`); there is one billed fit per device, product and UTC day; and the shop is under the per-shop daily anomaly cap `EMBED_BILLED_SESSIONS_PER_DAY` (default 5000, logs a warning). If any check fails, the request is still recorded on the try session and returns `billed: false`. `GET /v1/try/:token` and fit-shown are rate-limited per IP (`TRY_RATE_LIMIT_PER_MIN`, default 60). |
| SEC-2 archived products billed | fit-shown reloads the product; a missing or archived product is not billed. |
| UX-1 / F2 / SEC-3 "Remember me" off not remembered | `pref:remember=false` is stored (no personal data) and read by `init()` before the device or profile. "Forget me" keeps the opt-out, and turning the switch back on removes it. |
| UX-2 "No size fits well" with a coral "Choose size L" | Primary action is now "Edit my measurements"; "Select size L anyway" is secondary. No fit-shown call (nothing was recommended). |
| A11Y-1 focus lost on step changes | Each step change scrolls to the top and focuses the new screen's heading (not on first load). |
| COPY-1 app copy in the scan | `CaptureStep variant="embed"`: no face photo or identity tile, no "syncs", "this device", "About 30 seconds". |
| COPY-2 developer jargon in the result | The embed builds its own notes for the shown size. There is no "tie broken by …", and hints appear only for measurements the form can collect ("Add your bust … under Edit my measurements"). |
| A11Y-2 brand colour as text | The shop name uses the brand colour only when it reaches 4.5:1; otherwise it uses ink-mute. The colour stays on the top border. |
| A11Y-3 Tab leaks to the merchant page | A focus sentinel after the iframe wraps to the close button. |
| SEC-5 `mock:` tokens in production | They resolve only in a dev build or with `VITE_DEMO=1`; otherwise the "expired" screen shows. |
| UX-3 placeholder product photo | The demo seed points photos at the demo storefront's own `/img/<id>.svg`. |
| F1 shoes / no fit point → "We recommend 38" | When no size can be scored, the result says "We can't recommend a size yet" and asks for the missing measurement, with no fit-shown call. Shoes require the EU shoe size. |
| F3 notes and confidence of the wrong size after a preference change | The shown confidence, notes and "fits" come from the advised size, and fit-shown sends that confidence. |
| F4 variant selection on the wrong form / Dawn 15 | Scoped to the button's product section; matches labels with a " - Unavailable" suffix and numeric id values. |
| F5 scan drops the typed inseam | About-you entries the scan's form does not cover are merged into the scan profile. |

Tests were added for each fix: api `embed.test.ts` (+5), web `storage`, `aboutYou`, `EmbedApp` and
`lib/contrast` tests, sdk `embed.test.ts` (+3), demo-shop server test (+1), and the demo seed test.

### How to run the demo

```bash
pnpm demo        # no Docker, no keys; Ctrl-C stops everything it started
pnpm demo:e2e    # Playwright: storefront → overlay → About you → result → size selected on the page
```

| URL | What |
|---|---|
| `http://localhost:5180/` | Demo storefront "Aalter Studio" (WooCommerce look; `?theme=dawn` for the Shopify shop) |
| `http://localhost:5180/product/aalter-studio-1` | WooCommerce-style product page with the "Try it on" button |
| `http://localhost:5180/products/aalter-studio-1` | Shopify Dawn-style product page |
| `http://localhost:3000/embed/<token>` | The fitting room (opened by the button in the overlay) |
| `http://localhost:8787` | Demo api (PGlite in `.demo-db`, seeded shops, mock try-on), serves `/sdk/v1.js` |

`pnpm demo` reuses a service that is already answering on its port. After pulling these changes,
stop any old demo first, or the api will still serve the old seed and billing rules.

### What is verified

- `pnpm check` passes: build, typecheck, lint, the tests (api 97, web 219, sdk 90, schema 119,
  fit-engine 102, taste-engine 84, tryon-providers 65, shopify-app 89, demo-shop 8, woocommerce
  plugin 48) and the bundle secret scan.
- `pnpm demo:e2e` passes for both page styles (WooCommerce and Dawn). Each flow runs: overlay, About
  you, result, "Choose size L", the size selected on the page, and a returning shopper going straight
  to the result. Rerun on 5 Nov 2026 against a freshly started demo (api, web and storefront all
  new): both flows pass.

### What remains

- Fit-shown rate limiting is per IP only. Per device, the defence is the one-bill-per-device,
  product and day rule, plus the per-plan and global daily caps and the merchant's anomaly view
  (carry-over #7). A rotating IP pool can still mint new devices (300 per IP per hour since AVAIL-1)
  and bill up to the cap.
- Real devices: the camera scan inside a cross-origin iframe (`allow="camera"`) on iOS Safari and
  Android Chrome, and IndexedDB partitioning (Safari ITP, Firefox) for "Remember me".
- Live Shopify (Dawn 15) and WooCommerce themes: variant selection beyond the demo markup and the
  scoped selection with real quick-add sections.
- The "See it on me" hero render UI inside the embed is wired to the existing API but not
  exercised end to end without provider keys.

## Fixed in this integration pass

1. **The Shopify app could not open in the admin** (high). `shopify.app.toml` points
   `application_url` at `/shopify/admin` and `redirect_urls` at `/shopify/auth/callback`, but the api
   served neither. `apps/api` now depends on `@curtain/shopify-app` and serves:
   - `GET /shopify/admin`: `renderAdminPage()` with `Content-Security-Policy:
     frame-ancestors https://<shop> https://admin.shopify.com;` (the shop comes only from a validated
     `?shop=`), helmet's `X-Frame-Options` removed, and `no-store`.
   - `GET /shopify/auth/callback`: 302 to `adminAppUrl(shop, SHOPIFY_APP_HANDLE)`, or 400 for a
     domain that is not `*.myshopify.com`.
   - New non-secret env `SHOPIFY_APP_HANDLE` (default `curtain`) in `apps/api/src/env.ts` and
     `infra/.env.example`. It must equal `handle` in the rendered toml.
2. **The theme block did nothing on a fresh install** (high). `POST /shopify/token-exchange` now
   writes the app-data metafields (`curtain.public_key`, `api_url`, `app_url` on the
   `AppInstallation`) through `setAppDataMetafields()`. It does this on every exchange, because the
   public prefix stays the same across key rotations. A failure is logged and does not stop the
   install. The test checks the exact metafields and that no `sk_` value goes out.
3. **`POST /v1/swipes` left half a batch behind on 422** (high). Every `shopId` is now checked before
   any write. The inserts, the usage events, the `try_sessions.billed_at` updates and the ledger
   entry share one transaction. A regression test covers a mixed known/unknown batch: nothing is
   written, and the retry of the known event is accepted.
4. **The api Docker image** now installs and builds `packages/shopify-app` (its `dist` plus
   `admin/index.html` ship with `pnpm deploy`). This is unverified locally (see above).
5. **Token-format literals in tests** (AGENTS.md rule: GitHub push protection). `sk_live_…`,
   `sk_test_…`, `pk_live_…`, `shpat_…`, `shpss_…`, `whsec_…` and `xai-…` string literals in 10 test
   files are now built by concatenation. The values and assertions are unchanged.

## What is implemented, per package

**`packages/schema`**: zod GarmentPayload v1 (handoff §3.1, extended), FitSignature v1 (80 floats,
no face/skin/hair values), swipe events, every route DTO, `completenessScore` with per-field reasons,
Shopify metafield and Woo meta mappings, mock garments, and JSON Schema export for PHP. Verified by
tests: round-trips, completeness weights, mappings, the JSON Schema matching zod.

**`packages/fit-engine`**: pure `computeFit` / `recommendSize` with sigma-aware confidence, fit
summary and render gaps. It has zero runtime dependencies, a build guard against runtime imports,
and frozen inputs in tests. Verified by tests: the spec vectors and the purity fuzz.

**`packages/taste-engine`**: `applySwipe`, penalty memory, `rankDeck`, Style DNA and colour harmony.
It is pure, and its state is plain JSON. Verified by tests: spec vectors 1–16.

**`packages/tryon-providers`**: a server-only `TryOnRouter` plus FASHN (implemented against the
documented API), Vertex VTO and Grok video (stubs that are wired but not live-tested), and Mock.
`PersonInput.kind` is the only `'avatarRender'` value, and banned models fail lint. Verified by
tests: undici-mocked HTTP, router fallback, cost policy, and the browser guard.

**`packages/sdk`**: a vanilla IIFE under 6 KB that handles the button scan, the
`POST /v1/sdk/sessions` handshake, the deep link on mobile, and an accessible QR modal on desktop.
It never breaks the merchant page. Verified by tests: jsdom, auto-init, a11y, failure paths, and the
secret scan.

**`packages/shopify-app`**: the `shopify.app.toml` template and `configure` script, the "Try in
Curtain" theme app extension (bundles `sdk.v1.js`), the embedded admin page, and helpers for the
Admin GraphQL client, token exchange, session token, metafield definitions, app-data metafields,
bulk backfill, billing, webhook HMAC and product sync. Verified by tests: mocked fetch and
fixtures. `apps/api` uses only the admin page, the deep links and the app-data metafields; its own
`shopify/client.ts` still duplicates the GraphQL, token exchange and billing code.

**`packages/woocommerce-plugin`**: a PHP 8.2+ plugin with a meta box for every §3.1 field, push on
save with PK-HMAC (Action Scheduler retries), the bundled SDK button and shortcode, Connect (Stripe
or manual key), a signed backfill REST route, local JSON-Schema validation plus the backend dry-run,
HPOS, `uninstall.php`, `readme.txt` and nl_NL. Verified by tests: HMAC vectors shared with the api,
payload builder, sanitizer, schema validator, secret store and sync.

**`apps/api`**: a Fastify 5 server with Drizzle/Postgres and in-process pg-boss. It covers devices
and token rotation, the signature PUT, ledger, export, `DELETE /v1/me`, shop catalogues, swipes
(billing unit D7), wardrobe, cohort, SDK sessions with QR, try tokens, the merchant API
(HMAC/Bearer/session token, upsert, validate, usage, ledger, analytics with a k floor, key
rotation, Woo connect), Shopify (admin page, callback, token exchange, webhooks including GDPR
topics, billing), Stripe Checkout, webhook and meter, hero render jobs, and the usage rollup.
Verified by tests: every route group on PGlite, plus a security-review suite (16 tests).

**`apps/web`**: a React 19 PWA covering onboarding, the on-device capture (MediaPipe in a worker,
cross-sections, a population prior, fusion, the face/skin estimate, and an encrypted base frame),
try-from-shop, the deck, wardrobe, profile and privacy ledger, pairing, the outbox sync, and the
merchant console at `/merchant`. Verified by tests: capture geometry, measurement and fusion,
storage crypto, the outbox, the store, the API client, the env guard, the token contrast checks and
the review components.

## Needs manual verification (cannot be done offline)

- **Live Shopify dev store** (follow `packages/shopify-app/README.md` §"Must be verified"):
  - install, then App Bridge `idToken()`, then `/shopify/token-exchange`
  - the admin page loads inside the admin iframe (the new route and CSP)
  - `/shopify/auth/callback` lands on the app home
  - metafield definitions are created on `$app:curtain`
  - `app.metafields.curtain.public_key` resolves in the theme block's Liquid
  - webhooks fire, including the GDPR topics
  - `appSubscriptionCreate` works with `test: true` and the confirmation URL
  - the usage records work
  - the theme-editor deep link works
  - the API version is valid (see the gaps below)
- **WooCommerce site** (follow `packages/woocommerce-plugin/README.md` §"Manual verification" 1–11):
  - activation guards
  - Connect in Stripe mode and in manual mode
  - push on save, plus retry and backoff
  - clock skew
  - the storefront button
  - the backfill endpoint
  - uninstall
  - translations (`.mo` compilation)
- **FASHN key**: the hero render end to end, checking the `return_base64` format, the processing
  region and DPA, and the error names. Vertex and xAI need the same (`packages/tryon-providers`
  README). Only `mock` has run here.
- **VPS**:
  - `docker build -f apps/api/Dockerfile .` (now includes shopify-app)
  - `infra/docker-compose.yml` up with Caddy TLS
  - migrations run on start
  - pg-boss jobs, and a `JOBS=1` replica
  - the nightly encrypted `pg_dump` and a restore drill
  - an rsync deploy of `apps/web/dist`
- **Stripe**: Checkout, the webhook endpoint, and the `curtain_fit_sessions` meter with the overage
  price.
- **Devices**:
  - the capture pipeline on real iOS Safari and Android Chrome (fetch the models first with
    `pnpm --filter @curtain/web models`)
  - universal links from the SDK
  - the Playwright privacy e2e in a browser-capable CI job
- **Accuracy**: calibrate the scan against a tape-measured pilot set (D5 target: 3–4 cm with the
  scan only, about 1.5–2 cm when fused).

## Known gaps (open findings, by severity)

Updated for the engine branch (5 Nov 2026). Closed since the November handoff: Woo domain proof
(#12, SEC-1, SEC-2), deck billing (#8), expired-token rotation (#10, AUTH-1), `DELETE
/v1/me/signature` (#9, PRIV-1), the Shopify API version (#4) and currency (#6), duplicate size
labels (#2), "Boot cut jeans" (#3), the abandoned-opens k floor (#19), DNS pinning (#1), the shop
logo proxy (#11), the Woo backfill endpoint (#13) and the readme headers and Connect redirect (#15).

**High**
- `@curtain/sdk` is `UNLICENSED`, but it ships inside a WP.org plugin, which must be
  GPL-compatible. This is a founder/legal call, needed before WP.org submission (#14).

**Medium**
- Capture: `headTopRow` includes hair, which biases girths low by about 1–3 %; the avatar and the
  anchors inherit it. `FaceStep` shows "models not available" while the models are still loading (#16).
- The scan prior blend puts about 58 % of the population prior into the girth means (#17);
  revisit with the tape-measured volunteers.
- `TasteState.seen`, the penalty memory and the local wardrobe key are keyed by `itemId` without
  the shop (#22; the server side is fixed).
- Items without fit points (accessories) never earn the 0.15 fit term in `rankDeck` (#20).
- Woo Connect needs WordPress to answer at the root of the host (SEC-2). A shop installed in a
  subdirectory (`example.com/shop/`) cannot connect; binding the shop to host plus path would be
  the fix if a pilot merchant needs it.
- Device minting: 300 per IP per hour, no per-shop or global mint budget (AVAIL-1). A global budget
  was left out on purpose because it would let a flood lock every shopper out; billing has its own
  per-device, per-plan and global caps.
- A device whose rotated token was lost by every context (the rotate response never stored, e.g.
  the tab closed mid-request) still registers a new device, which orphans the old device's server
  rows out of reach of `DELETE /v1/me` (AUTH-1 residual). A refresh credential would close it.
- Browsers without the Web Locks API fall back to the `token_rotated` reload path (AUTH-1); two
  tabs can then still both send a rotation, but the loser picks up the winner's token.

**Low**
- `/v1/swipes` is atomic but all-or-nothing per batch (#23). The client batches per shop, so a
  redacted shop drops only its own swipes.
- `SaveOutboxEntry.size` can be null, but `WardrobePutRequestSchema.size` cannot (#24).
- `grading.json` carries `shoulder_width`, but it only drives the size-to-size ratio of the yoke;
  the synthetic yoke's absolute width is the mannequin torso's, and the `anchors.json` seams are
  notional chart points (R1 follow-up, D15).
- Spike viewer: largest chunk 208 KB gzip (under the 400 KB budget, but three.js is not split);
  drape settle not measured on a phone; no textures, no WebGPU, no drawn-overlay fallback.

**Product scope not built yet** (handoff §8):
- the hero-render UI flow (the API and consent exist)
- Path B as a true mesh warp of the flat-lay (v0 is a parametric SVG overlay)
- Wardrobe "Rooms" and shopping with friends
- the merchant console's abandoned-opens metric (no DTO field yet)
- order attribution (off by design, D7)
- ads toggle targeting
- merchant buying advice

## Recommended next steps, in order

1. **Start Phase 0 proper.** Open the GPU service account and the video-model access, get the 5
   pilot products with front and back photos, run stages 2 and 4 into `buildBundle`, then the
   five-person size and fabric tests on `blind.html`. Stop if the size test fails.
2. **Get Shopify end to end on a dev store.** Re-validate the `2026-10` queries in GraphiQL, then
   install, admin page, theme block, product sync and a try-on from a phone (D10).
3. **Finish the app-side privacy items before any pilot user:** item ids by shop in the taste engine
   and the web store (#22), and decide on a refresh credential for the AUTH-1 residual.
4. **Run the WooCommerce smoke test** on current WordPress and WooCommerce, including Connect with
   the host-root domain proof, and make the SDK licence decision before WP.org.
5. **Calibrate capture on a tape-measured pilot set** (hair offset #16, prior weight #17), and add
   the Playwright privacy e2e to CI.
6. **VPS go-live**: compose, TLS, backups with a restore drill (now including the asset volume),
   and the CI image push.
