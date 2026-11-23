# Handoff: WO-016 — Women's garments on the realistic body (iteration 2)

- **Branch:** `google/wo-016-iter2` (branched from `origin/qwen/wo-016-women-bundles-realistic` at `89a34e9`)
- **Work order:** [WO-016-women-bundles-realistic.md](../work-orders/WO-016-women-bundles-realistic.md) · **Linear:** `CUR-9` · **Open issue:** `OI-143`
- **Previous iteration:** [WO-016-iter1-qwen.md](./WO-016-iter1-qwen.md)
- **Builder:** Google (Gemini 4 Neon)
- **Date:** 2026-11-23

---

## 1. What changed (and what bugs were fixed from iteration 1)

Iteration 1 wired `realisticOutlinesOf` into `mount.ts`, but left `conformToField` active and had six geometric/plumbing bugs that caused the polar collider to misplace legs, double-scale morphed bodies, clip arms, and miss convex bust/shoulder domes:

1. **Zeroed polar centroids (`packages/garment-viewer/src/realisticBody.ts`):** `polarOf` subtracted `(s.cu, s.cv)` and passed `(0, 0)` into `sectionPolar`, erasing every torso, leg, and arm centroid (putting both legs on `x = 0` and losing torso `cz` at bust and seat). Fixed by slicing about each section's area centroid `(s.au, s.av)` and preserving `(cu, cv)` in the returned `PolarSection`.
2. **Broken leg slicing (`realisticBody.ts`):** `legStack` called `sectionAt` with `[side * 0, y, 0]` (`side * 0 === 0`), causing both legs to slice the same loop near `x = 0`. Fixed using `horizontalSections` filtered strictly by `side * s.au > 1 && side * s.au < 28`.
3. **Torso grabbing a single leg below the crotch (`realisticBody.ts`):** `torsoStack` started at `y = 0`. Fixed to start at `crotchY - 1.5` filtered by `|s.au| < 5` (so `torso(y)` is `null` below the crotch).
4. **Double-scaling on non-typed morphed bodies (`packages/garment-viewer/src/body.ts`, `mount.ts`):** `mount.ts` fitted the realistic body to `plan0.avatar.rings` (already morphed), and `bodyField` then multiplied `o.torso(y)` and `o.leg(y)` by `avatar.morph.girthScaleAt` / `neckScaleAt` a second time. Added `outlinesPreScaled = false` to `bodyField` and `buildTypedAvatar`, passed as `true` from `planAvatar` when `realisticOutlines` are supplied.
5. **Arm frame length, basis, and torso-merged slices (`realisticBody.ts`, `mount.ts`):** `mount.ts` previously computed right-arm `lengthCm` from the right shoulder to the *left* wrist (~75 cm) and stopped at the wrist (`55.8 cm`) instead of the collider's full arm span `s1 = upperArmCm + forearmCm + 0.85 * handCm` (`71.2 cm`), while `realisticBody.ts` sliced arms with `planeBasis` instead of `drawn.arms[side].u / .v` and included torso-merged slices (`> 60 cm`) above the armpit. Fixed by passing exact `u`, `v`, `s0`, and full `s1` length, skipping torso-merged sections (`loopCm > 60`), and pre-filtering arm triangles per side.
6. **Vertex-envelope pass & y-bucketed slicing (`realisticBody.ts`):** Added a 2 cm vertical triangle bucket index and a single minimum-L2-norm vertex-envelope pass (`enclosePolarPoint`) over torso, leg, and arm vertices so convex peaks between slices (breast apex, shoulder slope, seat curve, wrist) never protrude past the piecewise-linear polar table (`maxSkinOutsideTorsoPolar = 0.0000 cm` across all bodies).
7. **Removed `conformToField` under device drape (`mount.ts`):** Changed `mountGarmentView` so `useConform` is `false` by default whenever `realisticOutlines` are active (`const useConform = opts.realisticBodyConform === true || (opts.realisticBodyConform !== false && !realisticOutlines)`). Also passed `prefittedMesh` directly into `startRealisticBody` to eliminate the duplicate `fitRealisticBody` run on mount. The drawn body now renders unconformed (`data-body="realistic"`) with exact typed girths (`0.0 cm` error at chest, underbust, waist, and hip).

---

## 2. Quantitative results (without `conformToField`)

### A. Skin poke-through on `synthetic-tape-babydoll-dress` (5 test bodies)

Measured by casting inward rays along every fitted realistic-body vertex normal against the settled draped cloth mesh (no `conformToField`):

| Body (height / bust / waist / hip) | Fit-engine size (unchanged) | Before: ellipse collider, no conform | After: realistic polar collider, no conform | Regions (After) |
| --- | --- | --- | --- | --- |
| `slim` (164 / 80 / 62 / 88) | AU 8 (`drawn`) | max **0.92 cm** (63 v) | max **0.26 cm** (3 v, pinned strap edge) | bust/back/waist/hip/leg = **0.00 cm** |
| `mid` (168 / 92 / 74 / 100) | AU 12 (`drawn`) | max **1.25 cm** (51 v) | max **0.00 cm** (0 v) | all regions **0.00 cm** |
| `full` (170 / 116 / 98 / 122) | blocked (Rule 4 `not-drawn`) | max **3.92 cm** (252 v if forced AU 16) | max **0.45 cm** (24 v if forced AU 16; not drawn in embed) | back/waist/hip/leg = **0.00 cm** |
| `tall` (182 / 92 / 74 / 100) | AU 12 (`drawn`) | max **1.11 cm** (154 v) | max **0.06 cm** (3 v) | back/waist/hip/leg = **0.00 cm** |
| `petite` (152 / 84 / 66 / 92) | AU 8 (`drawn`) | max **0.83 cm** (53 v) | max **0.08 cm** (7 v) | back/waist/hip/leg = **0.00 cm** |

- `maxSkinOutsideTorsoPolar`: **0.0000 cm** across `slim`, `mid`, `tall`, `petite`.
- Fit-engine `recommendedSize` and `notDrawn` match procedural baseline identically on every body (`recMatch = true`).

### B. Long-sleeved shirt dress (`aalter-studio-2`, 4 drawn test bodies)

- Torso/waist/hip/seat/thigh poke-through on `mid` (L) and `tall` (L): **0.00–0.08 cm** (down from **3.22–3.46 cm** on ellipse). Forearms and wrists drape cleanly with `s1` arm coverage.
- Known legacy-bundle limit on `aalter-studio-2` `slim` (XS) and `petite` (S): `engine.ts` (`!support && !builtOnOwnBody`) marks vertices graded inside the canonical M upper chest as `noCollide = 1`, leaving a small skin patch at the front shoulder/armhole junction on XS/S (visible in `sleeved-dress-four-bodies.png`). This is a pre-existing `engine.ts` exemption for legacy unsewn v0 synthetic bundles, not a polar collider defect.

### C. Frame times & bundle budget

- Software SwiftShader in headless Chrome (390×844 @ 2×): `synthetic-tape-babydoll-dress` `mid` drag loop `meanMs = 217.8 ms`, `p95Ms = 233.3 ms` (14 frames); worker drape `solveMs = 3481–4065 ms` (procedural baseline `2353–3355 ms`).
- Viewer chunk budget: `garment-viewer-DENaBsCa.js` **190.3 KB gzip** of 400 KB limit; `realisticBody` lazy chunk **8.32 KB gzip**; `realisticBodyLoad` lazy chunk **7.49 KB gzip**.

---

## 3. Visual evidence

- [babydoll-dress-five-bodies.png](../../screens/google/wo-016-iter2/babydoll-dress-five-bodies.png) — 5 test bodies (`slim`, `mid`, `full`, `tall`, `petite`), procedural Before (front) vs realistic polar After (front, ¾, back), ESTIMATE-tagged, `data-body="realistic"`.
- [sleeved-dress-four-bodies.png](../../screens/google/wo-016-iter2/sleeved-dress-four-bodies.png) — `aalter-studio-2` long-sleeved shirt dress across `slim`, `mid`, `tall`, `petite` (front, ¾, back), `data-body="realistic"`.
- [renders.json](../../screens/google/wo-016-iter2/renders.json) — full render metadata, `solveMs`, drawn girths, and frame timings.

---

## 4. Verification & gate outputs

### Commands run & status

- `pnpm --filter './packages/*' --filter '!@curtain/woocommerce-plugin' build` — **PASS** (9/9 packages)
- `pnpm -r --filter '!@curtain/woocommerce-plugin' typecheck` — **PASS** (14/14 projects)
- `pnpm -r --filter '!@curtain/woocommerce-plugin' lint` — **PASS** (14/14 projects, including `check-banned-models.mjs`: 41 names checked)
- `pnpm -r --filter './apps/*' build` — **PASS** (includes `check-viewer-chunk`: `190.3 KB gzip of 400 KB`)
- `node scripts/check-bundle-secrets.mjs` — **PASS** (`✓ no secret-looking strings in client bundles`)
- `node scripts/check-language-packs.mjs` — **PASS** (`language packs: en on all 5 surfaces`)
- `pnpm --filter @curtain/garment-viewer exec vitest run src/realisticOutlines.test.ts` — **PASS** (10/10 tests, including end-to-end babydoll dress device drape + ellipse negative control)
- `pnpm --filter @curtain/garment-viewer exec vitest run src/collidePolar.test.ts src/realisticBody.test.ts` — **PASS** (25/25 tests)

Last lines of workspace build & check run:
```text
dist/assets/vendor-D9ciQ08p.js                              346.85 kB │ gzip: 114.70 kB
dist/assets/garment-viewer-DENaBsCa.js                      703.95 kB │ gzip: 194.85 kB
✓ built in 11.28s
PWA v1.3.0
mode      generateSW
precache  42 entries (1850.94 KiB)
check-viewer-chunk: garment-viewer-DENaBsCa.js 190.3 KB gzip of 400 KB (+ drapeBakeRead-CJtzeHmA.js 8.3 KB, bakes only); three.js in no other chunk; not precached
✓ no secret-looking strings in client bundles
language packs: en on all 5 surfaces
```

---

## 5. Not verified / honest gaps

1. **`@curtain/woocommerce-plugin` (`php -l`)**: `php` is not installed on this macOS host, so PHP syntax linting in `packages/woocommerce-plugin` was skipped (`!@curtain/woocommerce-plugin`). All 14/14 TS/JS workspace projects passed build, typecheck, and lint.
2. **Photo/Blender evaluation bundles (`eval/azure-palm-baby-doll-dress`, `eval/crimson-wildflower-maxi-skirt`, `pom2-bundle/crimson-wildflower-maxi-skirt`)**: These gitignored bundles are not present on this Mac (no Blender runtime). Verification used the repo's reproducible women's device-drape bundles built locally (`synthetic-tape-babydoll-dress` and `aalter-studio-2`). When Claude merges or runs on the machine with the photo/Blender bundles, re-running `realistic-body-renders.mjs` on those bundles is recommended as a final visual spot check.
3. **Full `pnpm demo:e2e`**: Not run because the preinstalled Playwright browser binary is absent on this host (visual renders used system Chrome `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` with SwiftShader).
4. **Arms/shoulders base**: This branch is based on `origin/qwen/wo-016-women-bundles-realistic` (`89a34e9`, pre-CUR-33 arms iteration 3). Once `CUR-33` (`google/wo-019-arms-iteration-3`) is merged into `claude/realistic-body`, the realistic polar outlines automatically slice whatever fitted realistic mesh `fitRealisticBody` produces — including the updated hanging arms and sloped shoulders.

— Google (Gemini 4 Neon)
