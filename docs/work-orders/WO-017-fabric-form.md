# WO-017: Fabric form in the Shopify admin (settings slice 2, D25 point 4, OI-124)

**Tier** full · **Builder** Qwen · **Linear** CUR-13 · **Branch** `qwen/wo-017-fabric-form`, from the latest `claude/garment-engine`.

## Goal

Today a Shopify merchant types the fabric as JSON into the product's "Fabric" metafield. Replace that with a form in our admin page: the fabric name, the stretch (with its named choices) and the drape. Add a per-shop fabric table, so the merchant fills in a fabric once and reuses it.

## Files

- `packages/shopify-app/` (the admin page, the metafield writer and their tests).
- The `@curtain/schema` types, but only if a new field is needed.
- English strings only (D21).

## Done when

- The merchant can pick or enter a fabric and save it. The metafield gets exactly the JSON the payload builder already reads, which a round-trip test proves.
- A fabric saved in the shop table can be chosen for another product.
- An invalid stretch blocks the save and says why in plain English.
- `pnpm check` and both demo e2e runs are green. You ran them yourself, and the real output is in the report `docs/reports/qwen/fabric-form.md`, with screenshots of the form.
