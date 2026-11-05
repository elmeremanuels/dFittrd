# Status — 2026-11-05

This is the integration snapshot after the parallel build and review passes. Read it with
`docs/DECISIONS.md` (why), `docs/ARCHITECTURE.md` (layout) and `docs/HANDOFF.md` (product truth).

## Verification run (repo root, Node 22, pnpm 10.28.0)

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

- `pnpm check` passes: build, typecheck, lint, the tests (api 97, web 215, sdk 90, schema 119,
  fit-engine 102, taste-engine 84, tryon-providers 65, shopify-app 89, demo-shop 8, woocommerce
  plugin 48) and the bundle secret scan.
- `pnpm demo:e2e` passes for both page styles (WooCommerce and Dawn). Each flow runs: overlay, About
  you, result, "Choose size L", the size selected on the page, and a returning shopper going straight
  to the result. Caveat for this run: an older demo api and storefront were already running and were
  reused, so the e2e exercised the new web app and SDK against the older api seed and billing code.
  The api and storefront changes are covered by their own tests.

### What remains

- Fit-shown rate limiting is per IP only. Per device, the defence is the one-bill-per-device,
  product and day rule, plus the daily anomaly cap. A rotating IP pool can still mint new devices
  (30/min per IP) and bill up to the cap; a lower cap per plan, or anomaly alerts to the merchant,
  are the next step.
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

**Medium**
- WooCommerce manual-key Connect has no proof of domain ownership. Add a challenge that the plugin
  answers on `/wp-json/curtain/v1/…`, or allow live keys only through the Stripe path.
  (`apps/api/src/routes/merchant.ts`, plugin)
- Deck billing can be inflated by bots: free devices swiping a real catalogue. Options are
  pairing-only deck billing, per-device daily caps, or billing only intent-token sessions.
  (`routes/app.ts`)
- An expired device token (more than 30 days) cannot rotate. The client then re-registers, which
  orphans the old device's server data out of reach of `DELETE /v1/me`. Fix with a grace window
  for an expired token whose signature is valid, or with a refresh credential.
- There is no `DELETE /v1/me/signature`. "Delete my scan" leaves the 80-float signature on the
  server until "Delete everything".
- `TasteState.seen` and the penalty memory are keyed by `itemId` without the shop, so the same id
  in two paired shops collides. The cohort and wardrobe routes, and the local wardrobe key, have
  the same ambiguity. Key everything by `shopId:itemId`.
- `SHOPIFY_API_VERSION` / `DEFAULT_API_VERSION` are set to `2025-10`, which is at or past the end
  of Shopify support in Nov 2026. Bump them together (api env, shopify-app types and appConfig,
  `infra/.env.example`) after you re-validate the queries in GraphiQL.
- Shopify billing always charges in EUR. Merchants billed in another currency get a userError.
  Query `shopBillingPreferences { currency }`, or use USD.
- `@curtain/sdk` is `UNLICENSED`, but it ships inside a WP.org plugin, which must be
  GPL-compatible. This is a founder/legal call, needed before WP.org submission. The source URL in
  `readme.txt` is a placeholder.
- Capture: `headTopRow` includes hair, which biases girths low by about 1–3 %. `FaceStep` shows
  "models not available" while the models are still loading.

**Low**
- `/v1/swipes` is now atomic but still all-or-nothing per batch. The client batches per shop, so a
  redacted shop drops only its own swipes.
- `SaveOutboxEntry.size` can be null, but `WardrobePutRequestSchema.size` cannot. Skip or queue the
  PUT until a size exists.
- Accessories (score null) never earn the 0.15 fit term in `rankDeck`.
- `fitSummary` looks rows up by size label, and duplicate labels are not rejected.
- `inferCategory` maps "Boot cut jeans" to shoes when nothing else labels the product.
- The `abandoned` analytics k floor counts sessions, not users.
- The SSRF guard does not pin DNS between its lookup and the connection (rebinding).
- The shop logo on `/try` loads from the merchant's host, which reveals the user's IP. It needs a
  proxy through our origin.
- The Woo signed backfill endpoint has no server-side signer (the api stores only a hash of
  `sk_`). Either implement a signer or drop the endpoint before WP.org.
- `readme.txt` "Tested up to" headers are stale, and `handle_connect` does not restrict
  `checkoutUrl` to `checkout.stripe.com`.
- The scan prior blend means about 58 % of the population prior goes into the girth means
  (documented design choice, revisit with pilot data).

**Product scope not built yet** (handoff §8):
- the hero-render UI flow (the API and consent exist)
- Path B as a true mesh warp of the flat-lay (v0 is a parametric SVG overlay)
- Wardrobe "Rooms" and shopping with friends
- the merchant console's abandoned-opens metric (no DTO field yet)
- order attribution (off by design, D7)
- ads toggle targeting
- merchant buying advice

## Recommended next steps, in order

1. **Get Shopify end to end on a dev store.** Bump the API version first. Then run install, the
   admin page, the theme block, a product sync and a try-on from the storefront on a phone. This is
   the first platform, per D10.
2. **Fix the privacy and deletion gaps before any pilot user.** Add `DELETE /v1/me/signature`, add
   expired-token rotation or a refresh credential, and namespace item ids by shop (taste engine,
   wardrobe, cohort).
3. **Close the billing-integrity items before charging anyone.** Woo domain-ownership proof,
   deck-billing policy (pairing-only or caps), the Shopify billing currency, and replacing the
   duplicated api Shopify client with the `@curtain/shopify-app` helpers.
4. **Run the WooCommerce smoke test** on current WordPress and WooCommerce. Bump the tested-up-to
   headers, make the licensing decision for the SDK, and decide on the backfill endpoint. Then
   submit to WP.org.
5. **Calibrate capture on a tape-measured pilot set** (hair offset, prior weight), and add the
   Playwright privacy e2e to CI.
6. **Run the hero-render bake-off** (D4) with real FASHN/Vertex keys on about 50 SKUs, then build
   the hero UI flow.
7. **VPS go-live**: compose, TLS, backups with a restore drill, and the CI image push.
