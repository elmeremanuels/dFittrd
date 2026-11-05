# Curtain

*Your private fitting room.* A mobile-first app that shows how garments really fit **your** body, fed by garment data from paired shops (Shopify, WooCommerce). Raw photos never leave your phone.

> Status: under active construction (takeover Nov 2026). See `docs/DECISIONS.md` for what is decided and `docs/ARCHITECTURE.md` for the layout.

## Repository

| Path | What |
|---|---|
| `apps/web` | Consumer PWA (React 19, Vite, Tailwind 4) |
| `apps/api` | The one backend (Fastify, Postgres, pg-boss) |
| `packages/schema` | Garment payload, fit signature and API types (zod) |
| `packages/fit-engine` | Fit score + size recommendation (pure TS) |
| `packages/taste-engine` | Swipe → Style DNA, deck ranking (pure TS) |
| `packages/tryon-providers` | Server-only AI try-on adapters + router |
| `packages/sdk` | Drop-in script for merchant product pages |
| `packages/shopify-app` | Shopify app + theme app extension |
| `packages/woocommerce-plugin` | WordPress/WooCommerce plugin (PHP) |
| `infra` | Docker Compose, Caddy, deploy scripts for the VPS |
| `docs` | Handoff, decisions, research |

## Develop

```bash
pnpm install
pnpm dev            # consumer app on http://localhost:3000
pnpm check          # build packages → typecheck → lint → tests → build apps → bundle secret scan
```
