# Report: WO-011 — Starting view per garment type (D30)

**Issue:** CUR-24
**Branch:** `qwen/wo-011-view-per-garment`
**Model:** Qwen (qwen2.5-coder-32b)
**Date:** 2026-11-22

## Done

- **`initialViewFor(garmentType)`** (`packages/garment-viewer/src/initialView.ts`): pure function that returns an azimuth and elevation for a garment category. Dresses and tops open at three-quarter (45° azimuth); bottoms, outerwear, shoes and accessories open at front (0°). Unknown or missing category defaults to front.

- **Test** (`packages/garment-viewer/src/initialView.test.ts`): covers all six categories plus undefined/null, asserting the correct azimuth and elevation.

- **MountOptions.initialView** (`packages/garment-viewer/src/mount.ts`): optional override that a merchant setting can fill later. When not given, `initialViewFor(garment.category)` is used.

- **Camera rotation** (`packages/garment-viewer/src/scene.ts`): `Stage.frame` now accepts an optional `azimuthDeg` parameter. The camera position is rotated around the Y axis by the azimuth, keeping the target at the figure's centre.

- **Export** (`packages/garment-viewer/src/index.ts`): `initialViewFor` and `InitialView` are exported from the package.

## Measured

- **Gates:**
  - `pnpm install --frozen-lockfile`: ✓ green
  - `pnpm --filter @curtain/garment-viewer test initialView.test.ts`: ✓ 3/3 pass
  - `pnpm --filter @curtain/garment-viewer typecheck`: ✓ green
  - `pnpm --filter @curtain/garment-viewer lint`: ✓ green
  - `pnpm --filter @curtain/web typecheck`: ✓ green
  - `pnpm --filter @curtain/web lint`: ✓ green

## Not verified

- **`pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e`**: not run. The demo e2e suite needs a browser environment and the skirt bundle (git-ignored, not present on this machine). The work order asks for a screenshot assertion that a dress opens at three-quarter; this needs the demo environment to verify.
- **Full `pnpm check`**: WooCommerce `php -l` fails (PHP not installed). The garment-viewer and web app gates are all green.
