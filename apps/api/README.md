# @curtain/api

The one backend (decision D2): **app API + merchant API + SDK host + Shopify app backend + Stripe
billing + pg-boss jobs**, in a single Fastify 5 process on one Postgres. Routes are typed from the
zod DTOs in `@curtain/schema`; OpenAPI is served at `GET /v1/openapi.json`.

```
src/
  env.ts            zod-validated env — the ONLY place secrets are read (AGENTS.md rule 2)
  app.ts            build({ env, db, queue, fetch?, tryon? }) → Fastify instance (tests use this)
  server.ts         process entry: postgres-js + pg-boss; JOBS=1 → jobs-only replica, JOBS=0 → no workers
  migrate.ts        applies ./drizzle migrations (the container runs it before the server)
  db/schema.ts      every table from docs/ARCHITECTURE.md (Drizzle), billing_anomalies included   db/client.ts  postgres-js | PGlite
  auth/             device JWT (jose), merchant PK-HMAC / Bearer sk_ / Shopify session token, try tokens
  routes/           app.ts try.ts sdk.ts merchant.ts renders.ts ops.ts
  shopify/          Admin GraphQL client (API version 2026-10), token exchange, webhooks, billing mutations
  billing/          plans, Stripe client (fetch, manual signature check), webhook route
  jobs/             queue abstraction (pg-boss | memory), render-hero, sync-shopify-product, backfill,
                    prune-renders + purge-shop (hourly), usage-rollup (nightly)
  services/         products (completeness + content_hash), usage, ledger, shops/keys, analytics (k floor), renders
  tryon/            TryOnRouter from env (TRYON_ORDER, keys) over @curtain/tryon-providers
```

## Run

```bash
# dev (needs a Postgres; defaults to postgres://curtain:curtain@localhost:5432/curtain)
pnpm --filter @curtain/api dev                 # tsx watch, pino-pretty, generated dev secrets (warned)
pnpm --filter @curtain/api db:generate         # drizzle-kit → ./drizzle after changing src/db/schema.ts ("No schema changes" when in sync)

# local demo (no Docker, no keys): PGlite in <repo>/.demo-db, seeded demo shops, mock provider → see "Local demo"
pnpm --filter @curtain/api demo

# checks (no Docker needed: tests run on PGlite + an in-memory queue + the mock try-on provider)
pnpm --filter @curtain/api typecheck && pnpm --filter @curtain/api test && pnpm --filter @curtain/api build

# production (VPS, D9)
cp infra/.env.example infra/.env && $EDITOR infra/.env     # DOMAIN, POSTGRES_PASSWORD, JWT_SECRET, SHOP_KEY_PEPPER, ENCRYPTION_KEY, …
cd infra && docker compose up -d                            # caddy + api (migrates, then listens) + postgres
infra/scripts/deploy.sh --web-dist ../apps/web/dist         # pull images, restart, rsync the PWA into the caddy volume
infra/scripts/backup.sh                                     # nightly: pg_dump | age | rclone (host crontab)
```

`docker build -f apps/api/Dockerfile .` from the repo root produces the image (node:22-alpine,
multi-stage, `pnpm deploy`, runs `migrate.js` then `server.js`). `.github/workflows/ci.yml` runs
typecheck · test · build · bundle-secret-scan and builds/pushes the image to GHCR on `main`.

## Routes

| Area | Routes | Auth |
|---|---|---|
| App | `POST /v1/devices`, `POST /v1/devices/rotate`, `PUT /v1/me/signature`, `DELETE /v1/me/signature` ("Delete my scan"), `GET /v1/me/ledger`, `GET /v1/me/export`, `DELETE /v1/me`, `GET /v1/shops/:shopId/products`, `GET /v1/products/:id` (uuid, or external id + `?shopId`), `POST /v1/swipes`, `PUT/GET /v1/wardrobe[/:productId]`, `GET /v1/fit/cohort/:productId[?shopId]` | Bearer device JWT (30 d, `token_version` rotation) |
| Try-on | `GET /v1/try/:token` → `{ shop, garment, trySession.intentToken, pairing, embed.allowedOrigins }`, `POST /v1/try/:token/fit-shown` → `{ billed }`, `GET /v1/peek?shop&product&page` → `{ shop, garment, embed.allowedOrigins }` (the size peek: read-only, no try session, only for a device already paired with the shop and a try-able product, own per-IP limit) | device JWT |
| SDK | `POST /v1/sdk/sessions` (CORS `*`, per-shop rate limit, `embedUrl` always, `qrSvg` except for `surface: 'embed'`, 402 + the same body when paused), `GET /v1/sdk/shop?shop=<public key prefix>` (`{ paused }`, cached 60 s: the SDK asks it before it shows a button, D25 point 5), `GET /sdk/v1.js`, `GET /v1/sdk/media?shop=<id>&u=<url>` (the shop's logo or a product photo through `safeFetch`: allowlisted per shop, raster only, `MEDIA_PROXY_*` size cap, cache and rate limit) | public |
| Renders | `POST /v1/renders/hero` → 202, `GET /v1/renders/:jobId`, `GET /v1/renders/:jobId/image\|video?exp&sig` | device JWT / signed URL |
| Merchant | `PUT /v1/merchant/products/:externalId`, `POST …/products/validate`, `DELETE …/products/:externalId`, `GET …/products`, `GET …/usage`, `GET …/ledger`, `GET …/usage/anomalies`, `GET …/analytics/periods`, `GET …/analytics/swipes`, `GET …/analytics/abandoned`, `GET …/analytics/fit-sizes` (all `?period=YYYY-MM`), `POST …/keys/rotate`, `GET/PUT /v1/merchant/settings`, `PUT /v1/merchant/shops/self`, `POST /v1/merchant/woo/connect`, `POST /v1/merchant/woo/complete`, `POST /v1/merchant/billing/stripe/checkout` (WooCommerce: Checkout for the Curtain plan, also the switch from a retired plan) | PK-HMAC, Bearer `sk_…`, or Shopify session token |
| Shopify | `GET /shopify/admin` (embedded admin page from `@curtain/shopify-app`, `frame-ancestors` CSP), `GET /shopify/auth/callback` (302 to the embedded app home), `POST /shopify/token-exchange` (also writes the theme block's app-data metafields: public key, API/app URL), `POST /shopify/webhooks`, `POST /shopify/billing/subscribe` (the plan follows Shopify's active subscriptions on every token exchange; uninstall drops the shop to `free`) | none (page/redirect) / session token / webhook HMAC |
| Billing | `POST /v1/billing/stripe/webhook` | Stripe signature |
| Ops | `GET /healthz`, `GET /readyz` (db + jobs), `GET /v1/openapi.json` | public |

Errors are always `{ error: { code, message, details? } }` (`ApiErrorSchema`); zod failures are `400 validation`.

Every merchant route lives in `routes/merchant.ts` and answers with the `@curtain/schema` DTOs
(`BillingAnomaliesResponseSchema`, `AnalyticsFitSizesResponseSchema`,
`AnalyticsAbandonedResponseSchema`, …); `ShopSelf*` and `Woo*` request/response schemas are still
local to that file. The merchant views:

* `GET /v1/merchant/usage/anomalies?from&to` (UTC dates): today's billed sessions, the plan's daily cap
  (`dailyCap`), the trailing average and spike threshold, and the recorded `billing_anomalies`
  rows (`cap_reached` with the refused sessions, `spike`), newest first. Shop-level counters only.
* `GET /v1/merchant/analytics/periods`: the closed calendar months analytics can be asked for.
* `GET /v1/merchant/analytics/fit-sizes?period=YYYY-MM`: sizes recommended in standalone sessions, a size
  reported only when at least `K_ANON` distinct shoppers got it; totals cover the reported sizes only.
* `GET /v1/merchant/analytics/abandoned?period=YYYY-MM`: try-link opens that never got a fit, per product,
  with the same floor on distinct shoppers.

**Differencing (launch-readiness finding 1).** Analytics (`swipes`, `fit-sizes`, `abandoned`) and the
shopper cohort never take an arbitrary range. They cover one calendar month in UTC, served only from
24 h after the month ends, and the first answer for a month is frozen in `analytics_snapshots` (an
erasure or a late upload afterwards changes nothing anyone can see). Inside each answer a row or size
bucket is shown only with `K_ANON` distinct shoppers, and the hidden rows of a table together hold at
least `K_ANON` shoppers (complementary suppression), so a total minus the shown rows is never a small
group. Colour, fabric and size tables are sums of the shown cells. The cohort is the sum of one frozen,
floored cell per shop and closed month. `services/kfloor.ts` explains the rules;
`kfloor.property.test.ts` attacks them with every linear combination of allowed answers. If `K_ANON`
is raised, months frozen under the lower floor are served with every row hidden.

Shopify Admin API version: `2026-10`, one constant (`DEFAULT_API_VERSION` in
`@curtain/shopify-app`), overridable with `SHOPIFY_API_VERSION` (mirrored in `infra/.env.example`).

### Merchant HMAC (WooCommerce plugin)

```
Authorization: PK-HMAC key=pk_live_<prefix>, ts=<unix seconds>, sig=<hex>
sig = HMAC-SHA256( sk_live_<secret>,  METHOD + "\n" + request-target + "\n" + ts + "\n" + sha256hex(body) )
```
`request-target` is the path including the query string as sent. The window is ±5 minutes. A rotated
key keeps working for 24 h; the public prefix never changes (the SDK snippet on the merchant page
stays valid). The secret is stored three ways: scrypt-hashed (Bearer verification), AES-256-GCM
encrypted with `ENCRYPTION_KEY` (HMAC verification needs the plaintext) and as an indexed
`HMAC(SHOP_KEY_PEPPER, key)` lookup (migration `0001_shop_key_lookup`; rows issued before it are
backfilled at server start) so a `Bearer sk_…` request costs one row fetch + one scrypt.

**Replay:** the signing string has no nonce, so a signature on a non-idempotent request (`POST`,
`DELETE`) is accepted once per process (10-minute memory); the second use answers
`401 replayed_signature`. Idempotent `PUT`/`GET` may repeat a signature (WooCommerce `save_post`
fires twice per save). Clients must sign every attempt freshly (`ts = now`).

### Billing unit (D7)

A try-on session is billable once a swipe with a fit result (`fitScore`/`sizeAtSwipe` non-null)
arrives: deep-link sessions by `intentToken` (`usage_events.idempotency_key = intent:<token>`,
`try_sessions.billed_at`), deck swipes once per device × product × UTC day. `usage_daily` is bumped
in the same write. A `POST /v1/swipes` batch is all-or-nothing: every `shopId` is checked first
(422 `unknown_shop` before any write) and inserts, usage events and the ledger entry share one
transaction. The nightly `usage-rollup` pushes sessions above the plan's quota to Shopify
`appUsageRecordCreate` or a Stripe meter event (`curtain_fit_sessions`), idempotent per shop-day.

Billing integrity (`services/usage.ts` `billFitSession`, shared by fit-shown and the swipe path):
only a device paired with the shop bills; the intent token bills once; a per-plan daily cap
(`max(BILLED_DAILY_CAP_MIN, ceil(includedSessions / 30 × BILLED_DAILY_CAP_FACTOR))`, never above
`EMBED_BILLED_SESSIONS_PER_DAY`) refuses further billing that UTC day and records a `cap_reached`
anomaly; a day above `BILLING_ANOMALY_FACTOR` × the trailing `BILLING_ANOMALY_TRAILING_DAYS`
average (and at least `BILLING_ANOMALY_MIN_SESSIONS`) records a `spike`. Both land in
`billing_anomalies` (migration `0003_billing_anomalies`, table defined in `db/schema.ts`) and in
`GET /v1/merchant/usage/anomalies`.

### Standalone embed (D11, `docs/STANDALONE.md` §2)

The shop works without the consumer app: the SDK opens `embedUrl` (`${PUBLIC_APP_URL}/embed/<token>`)
in an overlay on the merchant page.

* `POST /v1/sdk/sessions` with `surface: 'embed'` skips the QR. The session stores only the page
  **origin** (`try_sessions.page_origin`, migration `0002_standalone_embed`), never the path or query.
* `GET /v1/try/:token` resolves the product with `sizeAdviceGarment` (`@curtain/schema`): category,
  chart type and chart are required; a missing price, colour (the shop's brand colour), pattern
  block (`unspecified`) or fabric (non-stretch woven) gets a default. Without the three it answers
  422 `product_incomplete`. The stored product status (`active` / `incomplete`) uses the same
  predicate; `score` and `missingFields` stay the full completeness.
* `GET /v1/try/:token` adds `embed.allowedOrigins`, the only `postMessage` targets the iframe may use
  (`services/embed.ts`): Shopify `https://<shop>.myshopify.com` + the primary domain (read with
  `shop { primaryDomain { host } }` at token exchange, stored in `settings.primaryDomain`);
  WooCommerce the site URL origin; extra exact https origins a merchant sets with
  `PUT /v1/merchant/shops/self { embedOrigins }` (headless storefronts); plus the session's page
  origin when it is https and on one of those hosts (or their `www.` twin). The pairing source is `embed`.
* `POST /v1/try/:token/fit-shown { intentToken, recommendedSize, confidence }` is the billing event.
  The body is strict: extra keys such as measurements are a 400. Only the device that resolved the
  link may call it (403 `other_device`, 409 `not_resolved`, 403 `intent_mismatch`); the try token is
  accepted up to 2 h past its 10-minute TTL. One billable `fit_session` per intent token
  (`intent:<token>`, the same key as the app's swipe path, so the two never double-bill); a replay
  answers `200 { billed: false }`. A paused shop gets `402 shop_paused` and nothing is billed. The
  first call writes one `fit` ledger line for the shopper (field names only) and keeps the size label
  and confidence on `try_sessions` for aggregate merchant analytics.

### Men's gate (D20 point 3, `docs/research/men-3d-plan.md` slice M0)

No men's product goes live with a 2D figure only. One helper decides it, `shopperReadiness` in
`services/readiness.ts`, and every route that serves product or fit data calls it. It is behind
`MEN_3D_GATE` (read in `env.ts` only, **default off**: with it off no response changes).

With `MEN_3D_GATE=1`, a product whose payload says `audience: 'men'` is **coming soon** unless the
shop has the 3D estimate on (`settings.garment3d`) and the product has an approved bundle that still
covers the live chart and was built on the male mannequin (`assetMannequinFamily`: `qa.json`
`mannequin.family: 'male'`; absent = female).

Body family of a bundle (slice M1). A bundle built on the male mannequin names it in both
`anchors.json` and `qa.json` (`mannequin: { version, shape, family: 'male' }`); a female bundle
names none, so every bundle built before M1 is unchanged and reads as female. The two files must
agree, or the import refuses the bundle (`format`). The api keeps only `qa.json`, so that is where
the gate reads it (the place M0 assumed, now confirmed). The family must match the product:
`garmentBodyFamily` of `@curtain/schema` (`audience: 'men'` → male, anything else → female) is
checked on import (`asset:import` and the demo seed refuse with `family_mismatch`, before the size
check), on `GET /v1/try` (`activeAssetRef` hands out no ref when the live bundle no longer matches,
e.g. the audience was changed after the import), and in the viewer (`garmentBundleFor` and the
mount's body check). The only male bundle today is the SYNTHETIC men's test tee
(`SYNTHETIC_MENS_TEE`, not a product; `pnpm --filter @curtain/garment-spike build:bundle`),
used by `src/men-m1.test.ts` and `scripts/demo-men.mjs` to prove the path end to end.

Male body shape of a bundle. A men's bundle built on the male shape v2 also names
`mannequin.maleShape: 'v2'` in both files (absent = v1, every male bundle before). `MALE_SHAPE`
(env, `v2` only for exactly `v2`, else `v1`) is the shape this deployment draws, the server's side of
the web build's `VITE_MALE_SHAPE`; set the two together. The check sits where the family check sits:
the import refuses a men's bundle built on the other shape (`shape_mismatch`, with the build command
as a hint), `GET /v1/try` hands out no ref for one (the switch was flipped after the import), and
the viewer refuses it (`incompatible`). `src/male-shape.test.ts`.

Two consequences of the family check, both on purpose (D20 point 3), both with the gate **off** too:
- A men's product no longer imports a female-built bundle, and a female asset stored for it before
  M1 is no longer handed out by `GET /v1/try` (no 3D button). Before M1 the bundle was imported and
  the viewer then refused it. With a male bundle, a men's product gets the optional 3D view on the
  male body (`src/men-m1.test.ts`).
- The family follows `audience` alone, not its source. The gate treats a `men` read from a title or
  a collection (or of unknown source) as `audience_unconfirmed` and does not hide the product, but
  the embed still draws it on the male body (since M0), so it takes a male bundle only. The refusal
  says so (`family_mismatch (... a guess (from the title) ... correct the audience ...)`): if the
  guess is wrong, correct the audience and the female bundle imports.

| Route | A men's product that is coming soon |
|---|---|
| `POST /v1/sdk/sessions` | the usual body plus `productState: 'coming_soon'`; the session is still minted |
| `GET /v1/try/:token` | 422 `men_coming_soon`: no garment, no pairing, the session stays unresolved |
| `POST /v1/try/:token/fit-shown` | `200 { billed: false }` |
| `POST /v1/swipes` | the swipe is stored without its size, fit score and reasons; never billed |
| `GET /v1/peek` | 404 |
| `GET /v1/shops/:shopId/products` | left out of the list |
| `GET /v1/products/:id` | 422 `men_coming_soon` |
| `POST /v1/renders/hero` | 422 `men_coming_soon`, nothing queued |
| `GET /v1/renders/:jobId`, `GET /v1/renders/:jobId/:kind` | 404 (a render queued before the product was gated) |
| `GET /v1/fit/cohort/:productId` | the rows of the shop(s) where it is coming soon are left out: with `shopId` the empty cohort (`n: 0`, no size histogram); without it only other shops' products that share the external id are counted |
| `GET /v1/merchant/products` | `menGate: 'coming_soon'` on the product (the merchant's badge) |

* A men's product that passes gets `requires3d: true` on `GET /v1/try/:token`, and only for an
  overlay session (`surface: 'embed'`) whose client asks with `?caps=requires3d`
  (`TRY_CAP_REQUIRES_3D`): that is how the embed says it enforces "3D or nothing". A client that
  does not say so (an embed bundle cached from before the rule, a third party) gets the 422, so it
  can never draw the 2D figure for such a product. The peek, the app's deck and product page, the hero render,
  the cohort and app-mode try sessions draw the 2D figure only, so there it stays coming soon.
* Not gated, so unchanged: `women`, `unisex`, no audience; a `men` that was read from a title or a
  collection only (`isWeakAudienceSource`), or whose source is unknown (null); the merchant list
  says `menGate: 'audience_unconfirmed'` for both; men's shoes and accessories unless
  `MEN_3D_GATE_SHOES_ACCESSORIES=1` (open founder question). `GET /v1/wardrobe` and
  `GET /v1/me/export` are not gated either: they return what the device itself stored earlier
  (the shopper's own data), not new advice.
* **Only a known strong source gates.** The audience source is stored in `products.audience_source`
  (migration `0006_men_gate_audience_source`). The Shopify sync fills it. The merchant API takes it
  as `PUT /v1/merchant/products/:externalId?audienceSource=<source>` (the WooCommerce plugin sends
  it from this version on; it infers the audience itself). A write that does not say the source
  keeps the stored one while the payload's audience value is the same, and clears it when the
  audience changes. A null source (a row from before the migration, an older plugin, a direct API
  caller) is never gated: a women's "Men in Black Tee" keeps its size advice.
* **Before turning the flag on:** a men's product is gated only once its row has a strong source,
  so until then it is still shown with the 2D figure. Run the Shopify backfill job
  (`JOB.backfillShopify`) for every Shopify shop, and for WooCommerce shops ship the plugin version
  that sends the source and run "Sync all". `GET /v1/merchant/products` shows what is left as
  `audience_unconfirmed`. No job does this automatically when the flag changes.
* Cost with the flag on: `GET /v1/merchant/products` reads the readiness of each gated men's row of
  the page in sequence (one asset query and one `qa.json` read per row, only in shops with the 3D
  estimate on); `POST /v1/swipes` reads each distinct product of the batch once more.
* Not checked yet: the supported men's garment types (plan section 2) and the men's chart columns
  (slice M2a). Tests: `src/men-gate.test.ts`.

### Privacy (D3), enforced by construction

* No route accepts a photo except `POST /v1/renders/hero`; `PersonInput.kind` is the literal
  `'avatarRender'`, consent `{ tier: 'heroOptIn', ack: true }` is required, the image is re-encoded
  by sharp (EXIF/ICC/XMP dropped), ≤ 1024×1536, and deleted once the job finishes.
* Merchants see per-shop pseudonyms (`HMAC(pepper, device + shop)`), aggregates with the
  `K_ANON` floor (default 5), and a ledger of provider/model/retention — never a device id,
  measurement or image. Cohorts come from wardrobe states only.
* `DELETE /v1/me` cascades through every table and removes render files; `GET /v1/me/export`
  returns everything held (Art. 20).
* Logs: pino, `authorization`/`cookie`/HMAC headers redacted, **no client IP** unless `LOG_IPS=1`;
  compose rotates `docker logs` at 7 × 20 MB, so nothing about a request outlives a week.
* Shopify `customers/data_request` and `customers/redact` are acknowledged no-ops (no customer PII
  held); `shop/redact` purges the shop via a job 48 h later; `app/uninstalled` drops the token,
  pauses the shop and sets it to `free` with no subscription (Shopify cancels it on uninstall).

## Local demo

`pnpm --filter @curtain/api demo` (`src/demo.ts`, run with tsx; not part of the production build)
starts the api on **http://localhost:8787** with no Docker and no keys:

* PGlite persisted to `<repo>/.demo-db/pgdata` (the directory writes its own `.gitignore`; delete it
  to start over), migrated on every start;
* seeded idempotently (`src/demoSeed.ts`): **Aalter Studio** (WooCommerce, site URL
  `http://localhost:5180`) with 12 active products and **Aalter Studio (Shopify)** with 9, all from
  `MOCK_GARMENTS` (dresses, tops, bottoms, one blazer). The `pk_test_…` public keys are minted at
  runtime on the first run and stay the same afterwards;
* embed allowed origins and CORS for `http://localhost:5180` (demo storefront) and
  `http://localhost:3000` (`PUBLIC_APP_URL`, the web app serving `/embed/*`);
* the mock try-on provider and the in-memory job queue (hero renders complete in about a second);
* `/sdk/v1.js` from `@curtain/sdk` (run `pnpm --filter @curtain/sdk build` first).

It prints the public keys and product ids and writes them to `<repo>/.demo-db/demo.json`
(`{ apiUrl, appUrl, sdkUrl, storefrontOrigin, publicKey, productExternalIds, shops: [{ key, name,
platform, publicKey, allowedOrigins, products: [{ externalId, name, brand, category, priceEur,
sizes, photo, status }] }] }`), which the demo storefront reads. Overrides: `PORT`,
`PUBLIC_APP_URL`, `PUBLIC_API_URL`, `CORS_ORIGINS`, `DEMO_DB_DIR`, `DEMO_STOREFRONT_ORIGIN`. It
refuses to start when the port is taken, so two processes never open the same PGlite directory.

## Jobs

| Job | Trigger | What |
|---|---|---|
| `render-hero` | `POST /v1/renders/hero` | TryOnRouter (env `TRYON_ORDER`, default `mock`) → PNG (+ mp4) on `RENDERS_DIR`, ledger + usage |
| `sync-shopify-product` | `products/create\|update` webhook | GraphQL product + `$app:curtain` metafields → `fromShopifyProduct` → upsert |
| `backfill-shopify` | token exchange | pages the catalogue 50 at a time; a product that cannot be stored is logged with the reason (or queued on its own when the cause is not the product) and the page goes on |
| `prune-renders` | cron `7 * * * *` | expires renders past `RENDER_RETENTION_HOURS`, purges shops past `purge_after` |
| `purge-shop` | `shop/redact` (+48 h) | deletes the shop row (cascade) and files |
| `usage-rollup` | cron `13 2 * * *` | Shopify usage records / Stripe meter events |

## Tests

`vitest` boots the full app on PGlite per file (`src/test/helpers.ts`): devices→signature→export→
delete cascade, try token + pseudonym + pagination, SDK sessions + per-shop rate limit, merchant
HMAC/Bearer/session-token auth + upsert/completeness/validate/rotate, swipes billing idempotency,
hero render rejections + full job + expiry, standalone embed sessions / allowed origins / fit-shown
billing (replay, paused, measurements rejected, grace window) in `src/embed.test.ts`, the demo seed, Shopify webhook HMAC + GDPR + token exchange + sync,
Stripe Connect round-trip, k-anonymity floor, usage rollup, env/crypto/token units, and the
security-review regressions (`src/security-review.test.ts`: HMAC replay, key lookup, billing
integrity, per-shop rate limit, GDPR payload hygiene, webhook replay, Woo takeover, SSRF guard),
the men's gate on and off on every route (`src/men-gate.test.ts`),
billing caps and anomalies (`src/billing-integrity.test.ts`), the merchant route layout, the shared
DTOs and the drizzle snapshot of `billing_anomalies` (`src/merchant-routes.test.ts`), and the web
CSP in `infra/Caddyfile` (`src/caddy-csp.test.ts`).
The DNS lookup used by the SSRF guard is stubbed (`testLookup`), so the suite never touches the network.

## Security review (Nov 2026)

Findings from the skeptical review of `apps/api`, `infra` and `.github`; every fix is pinned by
`src/security-review.test.ts`.

| Sev | Finding | Fix |
|---|---|---|
| high | `customers/data_request` / `customers/redact` payloads (customer e-mail, phone, order ids) were stored verbatim in `webhook_log` although the architecture promises no customer PII | `loggablePayload()` keeps only `shop_id`/`shop_domain`/`data_request.id` for `customers/*` topics |
| high | Deck swipes created billable `fit_session` usage for item ids the shop does not sell, and the idempotency day came from the client `at` → unbounded fabricated usage per device | only existing, non-archived products bill; `deckBillingDay()` clamps the client day to ±36 h of server time |
| high | `Bearer sk_…` auth ran scrypt (N=16384) over **every** shop per request → unauthenticated CPU DoS | indexed `api_key_lookup` / `previous_key_lookup` columns, O(1) lookup then one scrypt (`findShopBySecret`); startup backfill |
| medium | Hero render job fetched the merchant-supplied `flatLayPhoto` URL unguarded (SSRF to `169.254.169.254`, `postgres:5432`, `localhost:3000`, redirects) | `lib/safeFetch.ts`: http(s) only, no userinfo, blocked hostnames, every A/AAAA record public, ≤ 3 manual redirects re-checked, 10 MB cap, `image/*` only; DNS lookup injectable |
| medium | SDK session rate limit was per IP, not per shop: `@fastify/rate-limit` runs at `onRequest` where `req.body` is undefined | plugin registered with `hook: 'preValidation'`; key generator validates the prefix shape |
| medium | `POST /v1/merchant/woo/connect` could claim a domain already installed through Shopify (same `shops` row: products, usage, ledger) and accepted any `returnUrl` for Stripe Checkout | `409 platform_mismatch` for non-Woo rows; `returnUrl` must be on the site's host |
| medium | PK-HMAC signatures replayable for ±5 min (`POST /keys/rotate` returns the new secret to the replayer) | per-process replay cache for non-idempotent methods |
| medium | Shopify webhook without `X-Shopify-Webhook-Id` skipped the dedupe index → a captured signed delivery (`app/uninstalled`, `shop/redact`, old `app_subscriptions/update`) could be replayed | header required (`400 missing_webhook_id`) |
| low | Stripe-Signature parser kept only the last `v1` (rotation sends two) | any matching `v1` accepted |
| low | Swipe analytics `sizeHistogram` buckets were not floored per bucket (cohort already was) | a size bucket needs ≥ K distinct users |
| low | `apps/api/.dockerignore` is never read (build context is the repo root): host `node_modules`/`dist`/`data` shipped and COPYed over the image | `apps/api/Dockerfile.dockerignore` (BuildKit reads it next to the Dockerfile) |
| low | compose: `caddy` waited for a *healthy* api, taking the static PWA down with any api failure; `API_IMAGE` default did not match the CI image name | `service_started`; `API_IMAGE` required, documented as `ghcr.io/<owner>/curtain-api` |

Closed since (engine branch, Nov 2026; see `docs/STATUS.md`): the WooCommerce domain proof on
every Connect path, fetched from the host root (SEC-1, SEC-2); deck billing only for paired
devices under the per-plan daily cap; the `abandoned` floor counts distinct devices; DNS pinned
in `safeFetch`. Device minting stays per IP (`DEVICE_CREATE_RATE_LIMIT_PER_HOUR`, AVAIL-1).

## Manual verification still needed

* Live Shopify dev store: token exchange with a real App Bridge session token, metafield definition
  creation (`$app:curtain`), webhook deliveries as declared in `shopify.app.toml`, `appSubscriptionCreate`
  confirmation flow, API version `2026-10` (the queries are not re-validated in GraphiQL yet).
* Live Stripe: Checkout + webhook endpoint, a `curtain_fit_sessions` meter with the overage price.
* Hero render against FASHN/Vertex/xAI with real keys (only `mock` was exercised here).

## Incomplete product data (D24 point 4, D25 points 1 and 2)

A product whose fabric details are missing or not valid is never refused for that reason.

* `PUT /v1/merchant/products/:externalId` takes the fabric as it comes. A part that is present but
  not valid (stretch 150) is left out and reported in `notices.leftOut`; the rest of the fabric is
  kept. `notices.defaulted` lists what size advice then assumes (`fabric.stretchPct` = 0 %). Every
  other field is validated as before (a bad chart is still a 400).
* The shop setting `incompleteProductData` (`GET/PUT /v1/merchant/settings`, column
  `shops.incomplete_product_data`, migration 0008) has two values. `let-through` (the default)
  stores and sizes the product. `hold-back` stores it with status `incomplete` and
  `heldBack: { reason: 'incomplete_product_data', fields }` (column `products.held_back`), answers
  200, and shoppers do not get it (`asTryGarment` returns null) until the merchant completes it.
* Incomplete means: the stretch is not known on a product that is not an accessory, or a fabric
  value had to be left out. A missing drape alone is not incomplete (`incompleteData.ts` in
  `@curtain/schema`).
* The values a save left out are kept beside the product (`products.left_out`, migration 0009:
  field and reason, never the value). `GET /v1/merchant/products` returns them per product as
  `notices.leftOut`, with `notices.defaulted` (what size advice assumes for the fabric now) and
  `heldBack`, so the console's product list can show them after the save answer is gone.
* Changing the setting re-applies it to the shop's stored products: it judges a missing stretch
  and the stored left-out values.
* `GET /v1/try/:token` adds `stretchAssumed: true` when the shop gave no stretch (not for an
  accessory); the popup then says that stretch was not taken into account.
* `PUT /v1/merchant/settings` accepts only the keys named in `MerchantSettingsUpdateRequestSchema`
  (`incompleteProductData`, `showFitByCurtain`, `brandColor`, `logoUrl`; `null` removes a colour or
  logo); any other key is a 400. The shop name is returned but not writable: it comes from the
  platform. `showFitByCurtain: false` (D25 point 7) reaches the popup as `shop.hideWordmark`; the
  estimate label is not part of it.
