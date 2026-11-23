# WO-026: Saved fabric library per shop (settings slice 3, follow-up of CUR-13)

**Tier** full · **Builder** Qwen · **Linear** CUR-40 · **Branch** `qwen/wo-026-fabric-library`, from the latest `claude/garment-engine`.

## Goal

The fabric form of CUR-13 keeps the shop's fabric library in memory, for one session only. Store it per shop on the server, so a merchant fills in a fabric once and reuses it on any product, on any day.

## Files

- `apps/api`: a shop-scoped table or JSON column for fabrics (name, stretch, drape, optional weight, opacity, sheen and blend), with a migration and routes to list, add, update and delete fabrics. The routes are merchant-authenticated, and **one shop can never read another shop's fabrics**; a test proves it.
- `packages/shopify-app/admin/index.html`: the library dropdown reads and writes the stored list.
- English strings only (D21). **No shopper data** is involved (D3).

## Done when

- The library survives a reload and a new session.
- There are tests for scoping (shop A cannot see shop B), for validation against `FabricSchema`, and for deletion.
- `pnpm check` and both demo e2e runs are green. You ran them yourself, the real output is in `docs/reports/qwen/fabric-library.md`, and there are screenshots of the form.
