# WO-011: Starting view per garment type (D30)

**Tier** full · **Builder** Qwen · **Linear** CUR-24 · **Branch** `qwen/wo-011-view-per-garment`, cut from `claude/garment-engine`.

## Goal

The 3D viewer opens at a default camera angle chosen by the garment type: three-quarter for dresses and tops, and front for the other types unless a type needs another view. The shopper can still rotate freely.

## Files

- `packages/garment-viewer/src/scene.ts`, the camera only.
- A new `packages/garment-viewer/src/initialView.ts` with its test.
- `MountOptions`, for an optional `initialView` override that the merchant settings can fill later.

Do not touch the realistic body, skin or hair files.

## Done when

- A pure function `initialViewFor(garmentType)` returns an azimuth and elevation, with tests for each garment type the schema has.
- The mount uses it unless `MountOptions.initialView` is given.
- The demo e2e still passes. Add one screenshot assertion that a dress opens at three-quarter.
- `pnpm check`, `pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e` are green.
- The report is `docs/reports/qwen/view-per-garment.md`.
