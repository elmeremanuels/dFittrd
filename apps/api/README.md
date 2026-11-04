# @paskamer/api

The one backend (decision D2): **app API + merchant API + SDK host + Shopify app backend + Stripe
billing + pg-boss jobs**, in a single Fastify 5 process on one Postgres. Routes are typed from the
zod DTOs in `@paskamer/schema`; OpenAPI is served at `GET /v1/openapi.json`.

```
src/
  env.ts            zod-validated env — the ONLY place secrets are read (AGENTS.md rule 2)
  app.ts            build({ env, db, queue, fetch?, tryon? }) → Fastify instance (tests use this)
  server.ts         process entry: postgres-js + pg-boss; JOBS=1 → jobs-only replica, JOBS=0 → no workers
  migrate.ts        applies ./drizzle migrations (the container runs it before the server)
  db/schema.ts      every table from docs/ARCHITECTURE.md (Drizzle)   db/client.ts  postgres-js | PGlite
  auth/             device JWT (jose), merchant PK-HMAC / Bearer sk_ / Shopify session token, try tokens
  routes/           app.ts try.ts sdk.ts merchant.ts renders.ts ops.ts
  shopify/          Admin GraphQL client (2025-10), token exchange, webhooks, billing mutations
  billing/          plans, Stripe client (fetch, manual signature check), webhook route
  jobs/             queue abstraction (pg-boss | memory), render-hero, sync-shopify-product, backfill,
                    prune-renders + purge-shop (hourly), usage-rollup (nightly)
  services/         products (completeness + content_hash), usage, ledger, shops/keys, analytics (k floor), renders
  tryon/            TryOnRouter from env (TRYON_ORDER, keys) over @paskamer/tryon-providers
```

## Run

```bash
# dev (needs a Postgres; defaults to postgres://paskamer:paskamer@localhost:5432/paskamer)
pnpm --filter @paskamer/api dev                 # tsx watch, pino-pretty, generated dev secrets (warned)
pnpm --filter @paskamer/api db:generate         # drizzle-kit → ./drizzle after changing src/db/schema.ts

# checks (no Docker needed: tests run on PGlite + an in-memory queue + the mock try-on provider)
pnpm --filter @paskamer/api typecheck && pnpm --filter @paskamer/api test && pnpm --filter @paskamer/api build

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
| App | `POST /v1/devices`, `POST /v1/devices/rotate`, `PUT /v1/me/signature`, `GET /v1/me/ledger`, `GET /v1/me/export`, `DELETE /v1/me`, `GET /v1/shops/:shopId/products`, `GET /v1/products/:id` (uuid, or external id + `?shopId`), `POST /v1/swipes`, `PUT/GET /v1/wardrobe[/:productId]`, `GET /v1/fit/cohort/:productId[?shopId]` | Bearer device JWT (30 d, `token_version` rotation) |
| Try-on | `GET /v1/try/:token` → `{ shop, garment, trySession.intentToken, pairing }` | device JWT |
| SDK | `POST /v1/sdk/sessions` (CORS `*`, per-shop rate limit, 402 + tryUrl when paused), `GET /sdk/v1.js` | public |
| Renders | `POST /v1/renders/hero` → 202, `GET /v1/renders/:jobId`, `GET /v1/renders/:jobId/image\|video?exp&sig` | device JWT / signed URL |
| Merchant | `PUT /v1/merchant/products/:externalId`, `POST …/products/validate`, `DELETE …/products/:externalId`, `GET …/products`, `GET …/usage`, `GET …/ledger`, `GET …/analytics/swipes`, `GET …/analytics/abandoned`, `POST …/keys/rotate`, `PUT /v1/merchant/shops/self`, `POST /v1/merchant/woo/connect`, `POST /v1/merchant/woo/complete` | PK-HMAC, Bearer `sk_…`, or Shopify session token |
| Shopify | `POST /shopify/token-exchange`, `POST /shopify/webhooks`, `POST /shopify/billing/subscribe` | session token / webhook HMAC |
| Billing | `POST /v1/billing/stripe/webhook` | Stripe signature |
| Ops | `GET /healthz`, `GET /readyz` (db + jobs), `GET /v1/openapi.json` | public |

Errors are always `{ error: { code, message, details? } }` (`ApiErrorSchema`); zod failures are `400 validation`.

### Merchant HMAC (WooCommerce plugin)

```
Authorization: PK-HMAC key=pk_live_<prefix>, ts=<unix seconds>, sig=<hex>
sig = HMAC-SHA256( sk_live_<secret>,  METHOD + "\n" + request-target + "\n" + ts + "\n" + sha256hex(body) )
```
`request-target` is the path including the query string as sent. The window is ±5 minutes. A rotated
key keeps working for 24 h; the public prefix never changes (the SDK snippet on the merchant page
stays valid). The secret is stored twice: scrypt-hashed (Bearer checks) and AES-256-GCM encrypted
with `ENCRYPTION_KEY` (HMAC verification needs the plaintext).

### Billing unit (D7)

A try-on session is billable once a swipe with a fit result (`fitScore`/`sizeAtSwipe` non-null)
arrives: deep-link sessions by `intentToken` (`usage_events.idempotency_key = intent:<token>`,
`try_sessions.billed_at`), deck swipes once per device × product × UTC day. `usage_daily` is bumped
in the same write; the nightly `usage-rollup` pushes sessions above the plan's quota to Shopify
`appUsageRecordCreate` or a Stripe meter event (`paskamer_fit_sessions`), idempotent per shop-day.

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

## Jobs

| Job | Trigger | What |
|---|---|---|
| `render-hero` | `POST /v1/renders/hero` | TryOnRouter (env `TRYON_ORDER`, default `mock`) → PNG (+ mp4) on `RENDERS_DIR`, ledger + usage |
| `sync-shopify-product` | `products/create\|update` webhook | GraphQL product + `$app:paskamer` metafields → `fromShopifyProduct` → upsert |
| `backfill-shopify` | token exchange | pages the catalogue 50 at a time |
| `prune-renders` | cron `7 * * * *` | expires renders past `RENDER_RETENTION_HOURS`, purges shops past `purge_after` |
| `purge-shop` | `shop/redact` (+48 h) | deletes the shop row (cascade) and files |
| `usage-rollup` | cron `13 2 * * *` | Shopify usage records / Stripe meter events |

## Tests

`vitest` boots the full app on PGlite per file (`src/test/helpers.ts`): devices→signature→export→
delete cascade, try token + pseudonym + pagination, SDK sessions + per-shop rate limit, merchant
HMAC/Bearer/session-token auth + upsert/completeness/validate/rotate, swipes billing idempotency,
hero render rejections + full job + expiry, Shopify webhook HMAC + GDPR + token exchange + sync,
Stripe Connect round-trip, k-anonymity floor, usage rollup, env/crypto/token units.

## Manual verification still needed

* Live Shopify dev store: token exchange with a real App Bridge session token, metafield definition
  creation (`$app:paskamer`), webhook deliveries as declared in `shopify.app.toml`, `appSubscriptionCreate`
  confirmation flow, API version `2025-10`.
* Live Stripe: Checkout + webhook endpoint, a `paskamer_fit_sessions` meter with the overage price.
* Hero render against FASHN/Vertex/xAI with real keys (only `mock` was exercised here).
