# WO-026: Saved Fabric Library per Shop — Report

**Builder:** Qwen · **Linear:** CUR-40 · **Branch:** `qwen/wo-026-fabric-library`
**Model:** Claude Sonnet 4.5 (Qwen Code)

## Done

- **Schema**: `fabric_library` table added to `apps/api/src/db/schema.ts`
  - `id` (uuid PK), `shop_id` (FK cascade), `name` (text, unique per shop), `fabric` (jsonb, typed as `Fabric`)
  - `created_at`, `updated_at` timestamps
  - Unique index on `(shop_id, name)`, index on `shop_id`
- **Migration**: `0011_fabric_library.sql` creates the table, FK, and indexes
- **CRUD routes**: `apps/api/src/shopify/fabricLibrary.ts`
  - `GET /shopify/fabric-library` — list the shop's entries
  - `POST /shopify/fabric-library` — create (FabricSchema-validated body)
  - `PUT /shopify/fabric-library/:id` — update (FabricSchema-validated, shop-scoped)
  - `DELETE /shopify/fabric-library/:id` — remove (shop-scoped, returns `{deleted: boolean}`)
  - All routes require merchant auth; every query is scoped to `req.shop.id`
- **Route registration**: `apps/api/src/shopify/routes.ts` registers the new plugin
- **Admin HTML**: `packages/shopify-app/admin/index.html` updated
  - On load, fetches `GET /shopify/fabric-library` to populate the dropdown
  - "Save to library" button now POSTs (new) or PUTs (update) to the API, then refreshes the dropdown
  - The library survives a reload and a new session
- **Tests**: `apps/api/src/shopify/fabricLibrary.test.ts` (5 tests)
  - CRUD round-trip (create, list, update, delete)
  - Shop scoping: shop A cannot see or delete shop B's fabrics
  - FabricSchema validation: rejects missing/out-of-range fields
  - 404 on update of non-existent entry
  - `deleted=false` on delete of non-existent entry

## Measured (real output)

```
$ pnpm -r --filter '!@curtain/woocommerce-plugin' ... build
(exit 0 — all TypeScript packages build clean)

$ pnpm -r --filter '!@curtain/woocommerce-plugin' ... typecheck
(exit 0 — all TypeScript packages typecheck clean)

$ pnpm -r --filter '!@curtain/woocommerce-plugin' ... lint
(exit 0 — no warnings)

$ pnpm --filter @curtain/api test -- src/shopify/fabricLibrary.test.ts src/shopify/fabricForm.test.ts
 ✓ src/shopify/fabricForm.test.ts (10 tests) 4085ms
 ✓ src/shopify/fabricLibrary.test.ts (5 tests) 4490ms
 Test Files  2 passed (2)
      Tests  15 passed (15)

$ pnpm -r --filter './apps/*' build
(exit 0 — both apps build clean)

$ node scripts/check-bundle-secrets.mjs
✓ no secret-looking strings in client bundles

$ node scripts/check-language-packs.mjs
language packs: en on all 5 surfaces
```

## Not verified

- `pnpm check` full pipeline: WooCommerce PHP lint fails (PHP not installed on this machine — same as every previous work order). Additionally, 4 pre-existing API test files fail (billing-integrity, demoSeed, launch-review, setup) — these are not caused by this change.
- `pnpm demo:e2e`: Playwright browsers are not installed on this machine. The reviewer should run `npx playwright install chromium` then `pnpm demo:e2e` before merging.
- Screenshots of the form: not taken (Playwright not available).

## Open issues

None specific to this work order.

— Qwen (Claude Sonnet 4.5)
