# Spike viewer (Phase 0)

A throwaway 3D viewer for the spike bundles in `../out/<productId>/`. It runs the device half of `docs/ENGINE-HANDOFF.md` §On-device fitting on synthetic data: avatar, grading, anchor-by-anchor placement from fit-engine gaps, a short cloth drape in Web Workers, size switching, a fit map, per-anchor numbers on the model, overlaid size outlines and two fabric presets. The page `blind.html` runs the Phase 0 size and fabric tests. Nothing here ships: the product viewer is `packages/garment-viewer` (Phase 2).

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
| 1. Morph to size | `src/engine.ts` | `applyGrading` from the spike (`../src/grading.ts`) with grading.json. The chains come from `assignChains`. grading.json carries the D15 breadth `shoulder_width` (R1); without a shoulder girth column the `shoulder` ring grades by the width ratio, so the yoke widens and narrows between sizes by that ratio. Its absolute width is the base mesh's (the synthetic garment follows the mannequin torso: about 43 cm across on the shoulder ring, about 52 cm just around it at the arm junction), not the chart width; the seams in anchors.json are notional chart points. |
| 2. Gaps | `src/fitting.ts` | `computeFit` → `anchorGaps(result, size)` from `@curtain/fit-engine`, used unchanged (rule 4; a test checks they are identical). |
| 3. Placement | `placeGarment` | Each fit anchor's loop (chest, waist, hip) sits at body + `slackCm`. A negative slack pulls the loop onto the body (`stretched`). When the fit engine bands that anchor `tight` (its stretch-adjusted limit, from the product's own fabric) the loop is marked `open` ("does not close"). The viewer never decides this itself, and the display fabric preset (linen, silk) does not change it (review finding R2). Rings without a gap keep their graded girth. The `shoulder_width` gap is a breadth, so it only colours the map, at the shoulder ring's height. |
| 4. Drape | `src/cloth.ts`, `src/drape.worker.ts` | PBD at 60 Hz, 2 substeps and 6 iterations, up to 1.5 s of cloth; it stops earlier once no particle moves more than 0.02 cm per substep for 6 frames (after at least 0.5 s). Edge and cross-edge (bend) constraints, long-range attachments to the pinned yoke, gravity, and collision against the avatar's analytic ellipses. Before the drape the yoke is settled onto the avatar (`settlePins`: edges and collision only), because an edge between two pins never relaxes; that fixed the neckline tears of small sizes. Each size drapes in its own Web Worker (`drapePool.ts`, up to 3), off the render thread; without module workers it falls back to the main thread. Results are cached per product, size, body and fabric, and once the shown sizes settle the neighbouring sizes drape in the background, so a size switch is usually instant. |
| 5. Fit map | `heatField`, `heatColor` | The fit-engine `gapCm` per anchor is placed at its ring height and blended with the grading's monotone profile. Red is tension, blue is room, near-white is the intended ease, and the colour fades out past the outermost anchor. |
| Numbers on the model | `anchorLabels`, `frontAt` | Side by side, each size carries small labels at shoulders, chest, waist and hip: the garment's graded value in cm (≈ when grading.json logged it as an estimate) and the fit engine's gap after the dot. The geometry is not exaggerated; the labels say what it shows. |
| Outline comparison | `frontOutline`, `Outlines` | "Compare outlines" overlays the front silhouettes of the selected size and its neighbours (smallest dashed) on the selected size's figure, which turns see-through. |
| Fabric presets | `viewerMaterial` | The product's material.json, or 100 % linen or 100 % silk resolved with `@curtain/schema` `resolveFabric`, with the colour kept. Drape, bend stiffness and damping drive the solver; sheen and opacity drive the PBR material. |

## Blind test (`blind.html`)

- **Pairs:** S–M and M–L per product, or linen versus silk at the base size. Both are shown side by side on the canonical mannequin with the same turning camera and no labels.
- **Order:** set by a random seed, which is recorded with every answer.
- **Storage and export:** answers go to `localStorage` (`curtain.spike.blind.v1`) and can be exported as CSV (`participant, mode, seed, trial, productId, left, right, answer, chosen, correct, responseMs, at`).
- **Summary:** shows per person the pairs and the products that person got right, which is how the "4 of 5 products" gate is read.

## Known limits (spike)

- **Cloth is plain PBD, not XPBD.** The worst stretched edges sit at the armpit. Per product on the v0 mannequin after the drape (`viewer/scripts/bench-drape.ts`, 6 Nov 2026): the dress p99 is 9–11.5 % (max 18–24 %) for XS–L, the tee p99 is 11–24 % (max 20–39 %), worst on the small sizes. `engine.test.ts` asserts dress p99 < 12 % (S, M, L) and tee p99 < 25 %, max < 45 % (XS–L).
- **The "cling" pull is a heuristic.** It pulls fluid fabrics towards the body (it grows with drape) and stands in for calibrated drape (stage 7).
- **Some particles skip collision.** These are particles that already sit inside the canonical mannequin in the base mesh, plus, for smaller sizes, those above the chest. The v0 mannequin's arms overlap its torso, and colliding there tears the cloth.
- **Drape time.** Measured on the 4-core build container, 6 Nov 2026. Node, one size, CPU: dress 3.0 s → 1.0 s (no `Math.hypot` or trigonometry in the hot loops; same result), tee 1.45 s → 0.3–0.5 s. The "after" figures come from `viewer/scripts/bench-drape.ts` (re-run 6 Nov 2026: dress 1.0–1.07 s, tee 0.32–0.47 s); the "before" figures were a one-off measurement of the previous engine, whose scratch script is not kept in the repo, so they cannot be reproduced from it (the early exit stops it at 0.9–1.2 s of cloth; the dress skirt is still swinging at 1.5 s and runs to the cap). Headless smoke run (Chromium, SwiftShader, so rendering runs on the CPU too): before, 6.2–7.6 s per dress size alone and 20–24 s for three sizes side by side (13.6 s for the tee). After, 1.2–1.8 s per dress size and 0.7 s per tee size, three sizes in parallel in the same time. The ≤ 2 s budget per size is met here except for the first drape after page load: 2.8 s wall at 1.15 s CPU, while the worker starts in the Vite dev server. The phone budget is not measured.
- **Yoke width.** The yoke is pinned across its whole band, where grading put it (the `shoulder_width` ratio between sizes; the base width is the mannequin torso's, see step 1). Pinning only out to the seams or the body's shoulder points was tried and measured worse on the v0 mannequin: the freed cloth sits in the arm junction and sags (tee p99 edge strain 26–35 % instead of 11–24 %). It needs a mannequin whose arms do not overlap the torso.
- **Shoulders on a larger body.** On a body wider at the shoulders than the garment (104/90/112 in S–L of the dress), the yoke's particles that skip collision stay inside and the neckline's stretch concentrates next to them: 33–53 % on the worst edge (median about 1 %), down from 124–287 % before the yoke was settled. The smoke run prints it for that step instead of failing on it.
- **Size differences are small.** Between neighbouring sizes the difference is subtle (4 cm of girth is about 6 mm of radius). The fit map makes it obvious, but the blind test renders without the map, as the Phase 0 size test requires.
- **Not built yet:** no textures (the bundle has no UVs), no WebGPU, no drawn-overlay fallback and no chunk budget. Those belong to `packages/garment-viewer`.
