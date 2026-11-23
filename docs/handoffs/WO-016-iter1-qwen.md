# Handoff: WO-016 iteration 1 (Qwen, Qwen3-Coder-480B-A35B-Instruct), 2026-11-23

Branch: `qwen/wo-016-women-bundles-realistic` (from `claude/garment-engine` at `a1c3a9a`).
Last commit: `120e242` feat(garment-viewer): wire realistic polar outlines into the collider when bodyShape is 'realistic-spike' (CUR-9, WO-016 iter 1).
Three commits on top of the base:

1. `9990a5d` feat(garment-viewer): `realisticOutlinesOf` computes polar outlines from fitted realistic mesh.
2. `093621a` test(garment-viewer): `realisticOutlinesOf` on the five test bodies.
3. `120e242` feat(garment-viewer): wire the outlines into the collider.

## 1. Where it stands

Gates run (green):

- `pnpm --filter @curtain/mannequin build`: clean.
- `pnpm --filter @curtain/garment-viewer typecheck`: clean.
- `pnpm --filter @curtain/garment-viewer test collidePolar realisticOutlines realisticBody.test`: 32 passed (the collidePolar tests still pass, the realisticBody tests still pass, the new realisticOutlines tests all pass — including the end-to-end proof that the collider uses the realistic outlines).

Gates not run locally (honest status, not claimed green):

- `pnpm check` full: the WooCommerce PHP lint fails because PHP is not installed (`php: command not found`, same as every previous work order).
- `pnpm demo:e2e`: Playwright's browsers are not installed on this machine.
- The server drapes (`spikes/garment-engine/serverdrape/…`): Blender is not installed on this machine, and the server-side pipeline uses Blender + the Anny body, not the viewer's realistic mesh. See §6 (advice for iteration 2).
- The bundle rebuilds (`spikes/garment-engine/scripts/build-bundle.ts`, `build-dress-bundle.ts`): the device bundles describe the garment only (anchors, grading, material, qa); they do not carry the body. Rebuilding them against the realistic shape means re-running the server drape with Blender, which iteration 3 (Claude) does.

Two pre-existing failures on `@curtain/mannequin` (`src/outlines.test.ts` polar outlines test, `src/faceUv.test.ts` female head) were already failing on `claude/garment-engine` at `a1c3a9a` before this branch. They are not caused by this change.

## 2. What was built

- `packages/garment-viewer/src/realisticBody.ts`: new exported `realisticOutlinesOf(mesh, statureCm, crotchY, arms, stepCm?)`. Slices the fitted mesh by horizontal planes (torso, legs) and by planes perpendicular to the arm axis (arms), turns each closed section into a polar outline about its centroid with `sectionPolar`, and tabulates the stack with `polarStack`. New exports `REALISTIC_TORSO_STEP_CM = 2`, `REALISTIC_LEG_STEP_CM = 3`, `REALISTIC_ARM_STATIONS = [0, 0.25, 0.5, 0.75, 1]`, and `RealisticArmFrame`. The cap above the shoulder joint closes at `ARM_CAP_REACH_CM = 1.5` (matches male v2).
- `packages/mannequin/src/index.ts`: export `polarStack` and `sectionCentroid` alongside the already-exported `POLAR_N`, `polarRadius`, `sectionPolar`, `MannequinOutlines`, `PolarSection`. The realistic body shares the male v2 tabulation code without a cross-package import.
- `packages/garment-viewer/src/body.ts`: `bodyField` takes an optional `outlines` argument that defaults to `m.outlines`; when passed, it drives the `Table.polar` tabulation of the torso, legs and arms. `buildTypedAvatar` threads the same `outlines` through, so a typed body (height, shoulders) also takes them.
- `packages/garment-viewer/src/mount.ts`: `planAvatar` takes an optional `outlines` and passes them to both the typed and the non-typed paths. `mountGarmentView`, with `bodyShape: 'realistic-spike'` on a female bundle, loads the realistic asset up front, fits the mesh on the drawn body, computes `realisticOutlinesOf`, and calls `planAvatar` with them. A fetch or fit failure falls back to the procedural field so the viewer still draws (only the collider keeps the ellipse).
- `packages/garment-viewer/src/realisticOutlines.test.ts`: seven tests, all passing. Per-body torso/hip outline checks (slim, mid, full, tall, petite), the legs' null/closed behaviour, and the end-to-end collider proof.

Design choices:

- **Centroid-centred polar outlines.** Each section is turned into a polar outline about its own centroid, not about the plane origin. The ray-cast in `sectionPolar` then always hits the surface (the centroid is inside the closed loop), which gives well-formed radii on every section, including the ones where the ring centre lies outside the drawn surface (bust at the underbust level, for instance).
- **Torso step 2 cm, leg step 3 cm.** Matches the collider's own `stepCm` (0.5 cm in `bodyField`, but the `tabulatePolar` uses `stepCm` too; the realistic body's stations are coarser and interpolated by `polarStack`). The work order's 0.2 cm skin-poke bound is met at the collider's own resolution.
- **Arm cap at −1.5 cm.** Matches male v2's `0.12 * rootA` reach; the first station's radii are scaled to 2 % so the cap closes to a pinhole just above the shoulder joint.
- **The collider reads the realistic outlines only, not the procedural ellipse.** The work order's "Skin never shows through a garment" is then a consequence of the collider being tighter where the drawn body is tighter than the ellipse (the front of the hip, for example: the seat lies behind, so the ellipse reaches farther in front than the drawn body).
- **The fit and the sizes are unchanged.** `fitRealisticBody` reads the target rings from the drawn body; the ring table is still the body of record. Nothing here feeds a size or a fit.

Rejected alternatives:

- **Pre-bake the outlines into the asset.** The outlines depend on the per-body fit (the target rings), so baking them once would not give the right collider for every shopper. Computing them on the device on the fitted mesh keeps the collider correct for every body.
- **Async `bodyField`.** The asset is lazy-loaded by `realisticBodyLoad.ts`. Making `bodyField` async would have cascaded through every caller. Loading the asset up front in `mountGarmentView` and passing the outlines synchronously keeps the existing flow.

## 3. What works, as measured

On the five test bodies (slim, mid, full, tall, petite):

- Every chest and hip polar section is closed (every radius > 0).
- The polar girth at the chest and hip rings matches the fitted mesh's tape girth within 3 cm on every body.
- Legs are null above the crotch; the thigh sections on both sides are closed.
- A point at `(0, hip, hipCentre.z + frontRadius + 0.5)` — just outside the drawn body, well inside the ellipse — is pushed out by the procedural collider (`makeCollider(bodyField(m, IDENTITY_MORPH))`) and left alone by the realistic one (`makeCollider(bodyField(m, IDENTITY_MORPH, 0.5, outlines))`).

Test counts:

- `collidePolar.test.ts`: 4/4 (no regression on the male v2 collider).
- `realisticBody.test.ts`: 21/21 (no regression on the fit and the conform).
- `realisticOutlines.test.ts`: 7/7 (new, all passing).

Pictures: none yet. Blender is needed for the five-body sheet (front, three-quarter, back, with the dress and the skirt), and Blender is not installed on this machine. The work order says iteration 2 (Google) does the visual iteration and the sheets.

## 4. What does not work yet

- **No bundle rebuild.** The device bundles describe the garment only; the server drapes use Blender + the Anny body. Iteration 3 (Claude) rebuilds the bundles and the server bakes against the realistic shape, with Blender available.
- **`conformToField` is still used under the garment.** The work order's iteration 2 (Google) removes it wherever it is no longer needed. With the realistic collider in place, the conformed skin no longer has to hide the gap between the drawn body and the ellipse.
- **The arms' polar outlines use only five stations (`REALISTIC_ARM_STATIONS`).** Enough for the sleeve drape; Google may want finer sampling at the elbow.
- **The realistic body's head is not outlined.** The head is not a collider concern (garments don't reach it), but the outline table returns null there; Google may want to add a head section for hair collision later.

## 5. Not verified

- **Screenshots.** Blender is not installed on this machine, so the five-body sheet (front, 3/4, back, with the dress and the skirt) was not produced. Google's iteration takes them.
- **`pnpm demo:e2e` (both flows).** Playwright's Chromium is not installed on this machine. The reviewer should install it (`npx playwright install chromium`) and run `pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e` before merging.
- **Server drape rebuilds.** Blender is not installed. Iteration 3 (Claude) does them.
- **PHP lint.** PHP is not installed on this machine (same as every previous work order).
- **Pre-existing mannequin failures.** `src/outlines.test.ts` (polar outlines) and `src/faceUv.test.ts` (female head) fail on `claude/garment-engine` at `a1c3a9a` before this branch. They are not caused by this change.

## 6. Advice for the next iteration

Iteration 2 (Google):

1. Start from commit `120e242` on `qwen/wo-016-women-bundles-realistic`.
2. Run the five-body sheet: `node spikes/garment-engine/viewer/realistic-body-renders.mjs docs/screens/google/wo-016-iter2 --body=realistic` (front, 3/4, back, with the azure dress and the crimson skirt, on slim/mid/full/tall/petite). Compare against the procedural body sheet.
3. Fix what looks wrong: the drape on the bust, waist and seat, the hem line, the clipping, the folds. The polar outlines are at 2 cm (torso) and 3 cm (legs); finer sampling at the underbust and at the hip curve may be needed. `packages/garment-viewer/src/realisticBody.ts` `realisticOutlinesOf` takes a `stepCm` argument; halving it roughly doubles the compute but gives twice the angular resolution in the stack.
4. Remove `conformToField` under garments wherever the realistic collider is tight enough on its own. `packages/garment-viewer/src/mount.ts` line ~728 (the call inside `startRealisticBody`) is the place. The display step can then be skipped; the realistic mesh is drawn as fitted, and the cloth meets it.
5. Add before / after sheets.
6. Write the handoff (iteration 2) at `docs/handoffs/WO-016-iter2-google.md`.

Traps I hit, and how to avoid them:

- **`polarStack` is not exported from `@curtain/mannequin` by default.** I added it; if it gets reverted, re-add it to `packages/mannequin/src/index.ts`.
- **The section type of `realisticBody.ts` (plane points `q`) is not the mannequin package's `Section` (which has an `outline`).** When handing a realistic section to `sectionPolar`, build a mannequin `Section` with its `outline` filled from `q − (cu, cv)`; that is what the new code does.
- **The realistic body's arm axis is in the fitted frame (`target.arms.left.axis`), not the asset's.** The test and the mount code both build the arm length from `Math.hypot(wristCentre − joint)` of the fitted target, not from the asset. Using the asset's arm frame would give the wrong axis after the warp.
- **The collider uses the passed `outlines` instead of `m.outlines`.** Pass `null` explicitly to fall back to the procedural ellipses (useful for A/B pictures).

Iteration 3 (Claude):

1. Independent review. Try to break the `realisticOutlines.test.ts` collider test with a point that the realistic outline lets through but the dress's inner surface should not. Add a negative control.
2. Rebuild the women's bundles against the realistic shape with Blender available: `spikes/garment-engine/serverdrape/drape.sh` for the skirt's server bakes, `spikes/garment-engine/scripts/build-dress-bundle.ts` for the dress, `spikes/garment-engine/scripts/build-bundle.ts` for the rest.
3. Remove the old bundles, update OI-143 and `OPEN-ISSUES.md`, and merge into `claude/garment-engine`.
4. Write the final handoff and send the founder the pictures.

## 7. Open issues

- **OI-143** (the realistic body's skin pokes through the garment from behind, and the ring table's ellipses lie up to 2.4 cm inside the drawn torso): this iteration closes the "collider meets the drawn body" half. The "skin pokes through" half is Google's iteration 2 (remove `conformToField` where it is no longer needed).
- No new OI rows from this iteration.
