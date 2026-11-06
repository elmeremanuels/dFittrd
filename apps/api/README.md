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
| Try-on | `GET /v1/try/:token` → `{ shop, garment, trySession.intentToken, pairing, embed.allowedOrigins }`, `POST /v1/try/:token/fit-shown` → `{ billed }` | device JWT |
| SDK | `POST /v1/sdk/sessions` (CORS `*`, per-shop rate limit, `embedUrl` always, `qrSvg` except for `surface: 'embed'`, 402 + the same body when paused), `GET /sdk/v1.js`, `GET /v1/sdk/media?shop=<id>&u=<url>` (the shop's logo or a product photo through `safeFetch`: allowlisted per shop, raster only, `MEDIA_PROXY_*` size cap, cache and rate limit) | public |
| Renders | `POST /v1/renders/hero` → 202, `GET /v1/renders/:jobId`, `GET /v1/renders/:jobId/image\|video?exp&sig` | device JWT / signed URL |
| Merchant | `PUT /v1/merchant/products/:externalId`, `POST …/products/validate`, `DELETE …/products/:externalId`, `GET …/products`, `GET …/usage`, `GET …/ledger`, `GET …/usage/anomalies`, `GET …/analytics/swipes`, `GET …/analytics/abandoned`, `GET …/analytics/fit-sizes`, `POST …/keys/rotate`, `PUT /v1/merchant/shops/self`, `POST /v1/merchant/woo/connect`, `POST /v1/merchant/woo/complete` | PK-HMAC, Bearer `sk_…`, or Shopify session token |
| Shopify | `GET /shopify/admin` (embedded admin page from `@curtain/shopify-app`, `frame-ancestors` CSP), `GET /shopify/auth/callback` (302 to the embedded app home), `POST /shopify/token-exchange` (also writes the theme block's app-data metafields: public key, API/app URL), `POST /shopify/webhooks`, `POST /shopify/billing/subscribe` | none (page/redirect) / session token / webhook HMAC |
| Billing | `POST /v1/billing/stripe/webhook` | Stripe signature |
| Ops | `GET /healthz`, `GET /readyz` (db + jobs), `GET /v1/openapi.json` | public |

Errors are always `{ error: { code, message, details? } }` (`ApiErrorSchema`); zod failures are `400 validation`.

Every merchant route lives in `routes/merchant.ts` and answers with the `@curtain/schema` DTOs
(`BillingAnomaliesResponseSchema`, `AnalyticsFitSizesResponseSchema`,
`AnalyticsAbandonedResponseSchema`, …); `ShopSelf*` and `Woo*` request/response schemas are still
local to that file. The merchant views, all with `?from&to` (UTC dates):

* `GET /v1/merchant/usage/anomalies`: today's billed sessions, the plan's daily cap
  (`dailyCap`), the trailing average and spike threshold, and the recorded `billing_anomalies`
  rows (`cap_reached` with the refused sessions, `spike`), newest first. Shop-level counters only.
* `GET /v1/merchant/analytics/fit-sizes`: sizes recommended in standalone sessions, a size reported
  only when at least `K_ANON` distinct shoppers got it; totals cover the reported sizes only.
* `GET /v1/merchant/analytics/abandoned`: try-link opens that never got a fit, per product, with
  the same floor on distinct shoppers.

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
  held); `shop/redact` purges the shop via a job 48 h later; `app/uninstalled` drops the token and
  pauses the shop.

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
| `backfill-shopify` | token exchange | pages the catalogue 50 at a time |
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
