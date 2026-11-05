# Architecture

Curtain is a two-sided product: a free consumer PWA (the fitting room) and paid merchant plugins (Shopify, WooCommerce) that feed it garment data. One backend serves both. Decisions and their rationale are in `docs/DECISIONS.md`.

```
curtain/
├─ apps/
│  ├─ web/                 consumer PWA (React 19, Vite, Tailwind 4, motion) — also hosts the merchant console under /merchant
│  └─ api/                 the one backend (Fastify 5, Drizzle + Postgres, pg-boss in-process, Shopify webhooks, billing)
├─ packages/
│  ├─ schema/              @curtain/schema — zod: GarmentPayload v1, FitSignature v1, SwipeEvent, API DTOs, completenessScore, platform mappings
│  ├─ fit-engine/          @curtain/fit-engine — pure TS: computeFit / recommendSize (handoff §4.1–4.2)
│  ├─ taste-engine/        @curtain/taste-engine — pure TS: applySwipe, penalty memory, rankDeck, Style DNA (handoff §5)
│  ├─ tryon-providers/     @curtain/tryon-providers — server-only AI adapters (FASHN, Vertex stub, Grok video stub, Mock) + TryOnRouter
│  ├─ sdk/                 @curtain/sdk — <6 KB vanilla IIFE for merchant pages: button scan, handshake, QR modal
│  ├─ shopify-app/         Shopify app: shopify.app.toml, theme app extension (bundles sdk.js), Fastify plugin (token exchange, webhooks, metafields, billing)
│  └─ woocommerce-plugin/  PHP 8.3 WordPress/WooCommerce plugin (meta box, push-on-save, SDK injection, Connect)
├─ infra/                  docker-compose.yml, Caddyfile, deploy/backup scripts
└─ docs/                   HANDOFF.md (product truth), DECISIONS.md, research/
```

## Boundaries

- `apps/web` and `packages/sdk` are browser-only. `apps/api` and `packages/tryon-providers` are Node-only (`"browser": false`). `schema`, `fit-engine`, `taste-engine` are isomorphic.
- Secrets are read in exactly one place: `apps/api/src/env.ts`. Nothing under `apps/web` may reference an AI/provider key; CI greps the bundle.
- Device access (camera, storage, share, deep links) in the web app goes through `apps/web/src/platform/*` so a Capacitor shell can swap implementations without touching features.

## Data flows

**Onboarding (all on-device).** Camera → Web Worker (Pose Landmarker gating → 0°/90° frames → multiclass segmentation → 12 cross-sections → ellipse girths + prior → fusion with manual entries) → `bodyProfile`, encrypted `baseFrame`, `faceTile`, `silhouette` in IndexedDB. Only the fit signature (80 floats) is `PUT /v1/me/signature`.

**Try-on from a shop.** Merchant page → `sdk.js` → `POST /v1/sdk/sessions` → 10-minute try token → deep link `https://app.<domain>/try/<token>` (mobile) or QR (desktop) → app `GET /v1/try/:token` → garment payload + shop branding → `computeFit` on-device → Path B render on-device → mirror. Pairing row created (pseudonymised per shop). The merchant page only learns "opened".

**Swipe deck.** Deck source = paired shops' catalogues (`GET /v1/shops/:id/products`). Every card: `computeFit` + `rankDeck`; swipes update the taste state locally and are batched to `POST /v1/swipes` (no body data). A try-on session becomes billable when a fit result is written.

**Hero render (opt-in).** App composites an avatar render (base frame with anonymised head) → `POST /v1/renders/hero` with per-render consent → pg-boss job → `TryOnRouter` → provider → result stored ≤ 24 h → app re-composites the real face tile locally → ledger entry with provider, model, retention.

**Merchant sync.** Shopify `products/update` webhook or WooCommerce push-on-save → normalise to `GarmentPayload` → `products` upsert (`content_hash` no-op) → `completenessScore` → status `active | incomplete` with `missing_fields`.

## Postgres (Drizzle)

`shops`, `shopify_sessions`, `products`, `product_images`, `devices`, `fit_signatures`, `pairings` (with per-shop pseudonym), `try_sessions`, `swipe_events`, `wardrobe_items`, `usage_events` + `usage_daily`, `render_jobs`, `ledger_entries`, `webhook_log` (with payload for replay), `order_outcomes` (schema only, attribution off by default), `pgboss.*`.

## On-device (IndexedDB via Dexie, never synced)

`bodyProfile`, `baseFrame` (AES-GCM), `faceTile`, `silhouette`, `renders` (LRU 50), `wardrobe`, `swipes`, `taste`, `outbox`, `ledger`, `settings`, `pendingIntent`.

## Deployment

`infra/docker-compose.yml`: `caddy` (TLS, static PWA, reverse proxy), `api` (one image, runs migrations on start, pg-boss in-process; `JOBS=1` turns a replica into a jobs-only worker), `postgres`. Web bundle rsynced into the Caddy volume. GitHub Actions: test + typecheck + build + bundle secret grep + api image to GHCR.
