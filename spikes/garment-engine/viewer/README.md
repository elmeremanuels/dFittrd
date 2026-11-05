# Spike viewer (Phase 0)

A throwaway 3D viewer for the spike bundles in `../out/<productId>/`. It runs the device half of `docs/ENGINE-HANDOFF.md` §On-device fitting on synthetic data: avatar, grading, anchor-by-anchor placement from fit-engine gaps, a short cloth drape, size switching, a fit map and two fabric presets. The page `blind.html` runs the Phase 0 size and fabric tests. Nothing here ships: the product viewer is `packages/garment-viewer` (Phase 2).

```sh
pnpm build:packages                                   # anchors, schema, fit-engine, mannequin dist/
pnpm --filter @curtain/garment-spike build:bundle     # writes out/<id>/
pnpm --filter @curtain/garment-spike viewer           # http://127.0.0.1:5178/  (blind test: /blind.html)
pnpm --filter @curtain/garment-spike viewer:smoke     # headless Chromium, screenshots in out/screens/
```

Of all this, only `typecheck` and the pure-logic unit tests (`viewer/src/*.test.ts`, run by the package's `test` script) are part of `pnpm check`. The dev server and the smoke script are not.

## What it does

| Step (handoff §Fitting) | Where | How |
| --- | --- | --- |
| Avatar | `src/body.ts` | Canonical mannequin M, or bust/waist/hip typed in the page. The mannequin rings are scaled to the typed values with `@curtain/anchors` `gradingMorph`; neck and shoulders follow the bust, legs follow the hip, and stature and arms stay as they are. The values stay in the tab: they are never put in the URL or storage and never sent. |
| 1. Morph to size | `src/engine.ts` | `applyGrading` from the spike (`../src/grading.ts`) with grading.json. The chains come from `assignChains`. |
| 2. Gaps | `src/fitting.ts` | `computeFit` → `anchorGaps(result, size)` from `@curtain/fit-engine`, used unchanged (rule 4; a test checks they are identical). |
| 3. Placement | `placeGarment` | Each fit anchor's loop (chest, waist, hip) sits at body + `slackCm`. A negative slack pulls the loop onto the body (`stretched`). When the fit engine bands that anchor `tight` (its stretch-adjusted limit, from the product's own fabric) the loop is marked `open` ("does not close"). The viewer never decides this itself, and the display fabric preset (linen, silk) does not change it (review finding R2). Rings without a gap keep their graded girth. The `shoulder_width` gap is a breadth, so it only colours the map, at the shoulder ring's height. |
| 4. Drape | `src/cloth.ts` | PBD with 1.5 s of cloth at 60 Hz, 2 substeps and 6 iterations. It uses edge and cross-edge (bend) constraints, long-range attachments to the pinned yoke, gravity, and collision against the avatar's analytic ellipses. Results are cached per product, size, body and fabric, so switching back is instant. |
| 5. Fit map | `heatField`, `heatColor` | The fit-engine `gapCm` per anchor is placed at its ring height and blended with the grading's monotone profile. Red is tension, blue is room, near-white is the intended ease, and the colour fades out past the outermost anchor. |
| Fabric presets | `viewerMaterial` | The product's material.json, or 100 % linen or 100 % silk resolved with `@curtain/schema` `resolveFabric`, with the colour kept. Drape, bend stiffness and damping drive the solver; sheen and opacity drive the PBR material. |

## Blind test (`blind.html`)

- **Pairs:** S–M and M–L per product, or linen versus silk at the base size. Both are shown side by side on the canonical mannequin with the same turning camera and no labels.
- **Order:** set by a random seed, which is recorded with every answer.
- **Storage and export:** answers go to `localStorage` (`curtain.spike.blind.v1`) and can be exported as CSV (`participant, mode, seed, trial, productId, left, right, answer, chosen, correct, responseMs, at`).
- **Summary:** shows per person the pairs and the products that person got right, which is how the "4 of 5 products" gate is read.

## Known limits (spike)

- **Cloth is plain PBD, not XPBD.** The worst stretched edges (about 20–30 %) sit at the armpit, and the 99th percentile is about 10 %.
- **The "cling" pull is a heuristic.** It pulls fluid fabrics towards the body (it grows with drape) and stands in for calibrated drape (stage 7).
- **Some particles skip collision.** These are particles that already sit inside the canonical mannequin in the base mesh, plus, for smaller sizes, those above the chest. The v0 mannequin's arms overlap its torso, and colliding there tears the cloth.
- **Drape time.** It takes about 1.2 s of CPU per size in node. Side by side runs three sizes, so it takes about 3–4 s to settle. In the headless smoke run (SwiftShader, where rendering also runs on the CPU), one size takes about 8–9 s and three sizes about 24 s. The ≤ 2 s budget is per size on a phone and is not met or measured here.
- **Shoulders on a larger body.** The yoke is pinned where the grading puts it. On a body larger than mannequin M, the mannequin's shoulders show through the yoke (see `out/screens/*-body-104-90-112-fitmap.png`). The `shoulder_width` anchor now exists (R1), but the viewer does not yet place the yoke from it; see the shoulder note in the spike README.
- **Size differences are small.** Between neighbouring sizes the difference is subtle (4 cm of girth is about 6 mm of radius). The fit map makes it obvious, but the blind test renders without the map, as the Phase 0 size test requires.
- **Not built yet:** no textures (the bundle has no UVs), no WebGPU, no drawn-overlay fallback and no chunk budget. Those belong to `packages/garment-viewer`.
