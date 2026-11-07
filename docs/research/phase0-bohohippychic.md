# Phase 0 on bohohippychic.com.au (generated)

Generated 2026-11-07 by `pnpm --filter @curtain/garment-spike report:bohohippychic` (`spikes/garment-engine/scripts/report-bohohippychic.ts`). Do not edit by hand: re-run it after every GPU run. Renders and bundles live under `spikes/garment-engine/out/`, which is gitignored: the links to them below resolve only in a checkout where the GPU outputs are in `out/phase0/` and this script has run with `-- --renders`; elsewhere they are attached separately.

Boho Hippy Chic gave the founder consent to use its public product data and photos for this internal validation, before anything is installed on its site. Selection, AU chart and photo classification: `spikes/garment-engine/data/bohohippychic/` and `docs/research/au-size-chart.md`. Everything below that comes from a model is an estimate (AGENTS.md rule 3).

## Summary

| Product | Category | Back photo | Stage 1b | Stage 2 | Stage 4 | Chart agreement | View IoU front / back | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `azure-palm-baby-doll-dress` | dress | real | failed | done | done | pass (before 0.50 cm, after 0.00 cm) | 0.91 / 0.94 | $1.57–$1.63 |
| `rosewater-blouse` | top | real (planned) | not run | not run | not run | not measured | — | — |
| `rosewater-palazzo-pants` | bottom | real (planned) | not run | not run | not run | not measured | — | — |
| `crimson-wildflower-maxi-skirt` | bottom | real (planned) | not run | not run | not run | not measured | — | — |
| `woodstock-wanderer-knit-cardi` | outerwear | real (planned) | not run | not run | not run | not measured | — | — |

## Phase 0 acceptance

| Item | State | Evidence |
| --- | --- | --- |
| Size test | needs people | Five people who did not build it must pick the smaller size, without labels, in at least 4 of 5 products on the blind page (size mode). Bundles for the test: 1 of 5 products; renders made for 1. Not run with people yet. **Do not run the panel on these assets yet:** only 1 of 5 products has a bundle, and in the stage 4t renders of azure-palm-baby-doll-dress (closed cloth, baked print, sizes visibly different) the shoulder tops are bare and the sleeves droop after the drape, so a panel would still partly judge the asset faults; see the template fit section and the verdict below. (`spikes/garment-engine/data/bohohippychic/panel-hold.txt`) |
| Fabric test | needs people | Same five people, fabric mode of the same page (linen versus silk of the same garment). Not run with people yet. **Do not run the panel on these assets yet:** only 1 of 5 products has a bundle, and in the stage 4t renders of azure-palm-baby-doll-dress (closed cloth, baked print, sizes visibly different) the shoulder tops are bare and the sleeves droop after the drape, so a panel would still partly judge the asset faults; see the template fit section and the verdict below. (`spikes/garment-engine/data/bohohippychic/panel-hold.txt`) |
| Chart agreement | not yet measurable | 1 of 1 evaluated products within ±2 cm at their critical anchors after calibration (4 without a stage 4 mesh); 4 of 5 needed. After per-ring calibration this is close to 0 by construction, so also read the error before calibration: azure-palm-baby-doll-dress at chest: max \|error\| 0.50 cm before calibration, 0.00 cm after the global scale, 0 by construction with one critical anchor, 0.00 cm after calibration. |
| View agreement | needs people | The merchant must confirm that the front and back renders are recognisably their garment. IoU against the pinned stills (visible with the mannequin in front / garment silhouette alone): azure-palm-baby-doll-dress front 0.91 / 0.91, back 0.94 / 0.93. Every pinned still on this set comes from stage 1b (generated from photos on a model), so a high IoU says stages 2–4 kept what stage 1b drew, not that stage 1b drew the shop's garment. |
| Cost | measured, partly | Measured for 1 of 5 products (GPU seconds and wall time measured; dollars are list-price estimates until the Modal invoice is read): azure-palm-baby-doll-dress 1493 s GPU, 2311 s wall, $1.57–$1.63. |
| Write-up | not met | This document covers the per-product results. Chosen models and licences are in docs/research/garment-engine.md; failures and the tolerances to use from Phase 1 can only be set once the GPU runs above exist. |

Blind test page with these products pre-selected: `http://127.0.0.1:5178/blind.html?products=eval/azure-palm-baby-doll-dress` (viewer dev server, `pnpm --filter @curtain/garment-spike viewer`). It needs the bundles in `out/eval/`, so run the report with GPU outputs first. Not for the panel yet (see the size test row). Screenshot: [blind page](../../spikes/garment-engine/out/eval/blind-size-pair-1.png).

## Runs 10–14 timeline

Five GPU runs on Modal (GitHub Actions), two products: the spike's synthetic shirt dress `aalter-studio-2` (runs 10, 11) and the shop's `azure-palm-baby-doll-dress` (runs 12–14). Costs are the runs' own `cost_summary.json` records: GPU seconds measured, dollars list price × GPU seconds (estimates, GPU only; no Modal invoice read yet). Details per run are in `spikes/garment-engine/modal/README.md` ("after run N" sections).

| Run | Product, job | What it tested | What we saw | What changed after it | GPU s | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | `aalter-studio-2`, synthetic stills, export 0.1.0 (bare-mannequin control) | First end-to-end stage 2 (Wan2.2-Fun-A14B-Control, 40 steps) + stage 4 (gsplat 2DGS + TSDF) on Modal | The dress turned into trousers between the pinned frames (frames 20, 60, 100), and the product name appeared as text in frame 20. Stage 4 mask IoU 0.90 on the generated frames against 0.99 on the synthetic frames | Export 0.2.0: a closed garment proxy in the control video, neutral prompts without title or brand, consistency metric v1 | 1661 | $1.70–1.76 |
| 11 (11a) | `aalter-studio-2`, export 0.2.0 (proxy control) | The proxy control | The dress stayed a dress in every turntable frame, no text. But consistency v1 flagged 233 of 243 frames (a cream dress on a light-grey studio: v1 lost its light parts), stage 4 trained on a poor foreground target (mask IoU 0.83 / 0.84), and every motion frame had artefacts | Garment segmentation of the generated frames, consistency v2 and v3, stage 4 trains on garment masks, export 0.3.0 (bare masks, no still pinned in the motion clip) | 1775 | $1.79–1.82 |
| 12 | `azure-palm-baby-doll-dress`, export 0.2.0, FASHN maskless on the bare mannequin, `--accept-failed-dress` | First shop product: dressing stills from photos on a model (stage 1b) | FASHN transferred the print and the puffed sleeves, but drew a romper (two legs of fabric, open front), and the back still was a second front. Stage 2 copied that faithfully. Stage 4 mask IoU 0.97 was against foreground masks (garment + mannequin), not comparable with run 14 | Export 0.4.0: the stills are generated on the proxy-dressed mannequin, FASHN masked with our label map, a Qwen engine, QA v2 (leg gap, skirt cover, true back) | 1531 | $1.62–1.73 |
| 13 | same product, export 0.4.0, stage 1b only, FASHN and Qwen | Both dressing engines on the proxy-dressed target | FASHN: the right garment on both views (knee-length babydoll, the shop's pastel print on cream, puffed sleeves, tiered skirt), shorter and narrower than the proxy. Qwen: a solid blue dress, because the prompt took "blue" from the product name "Azure". QA 0.3.0 failed every still; its score ranked Qwen's blue front best | Export 0.5.0 takes the colour from the photo's pixels, QA 0.4.0–0.5.0 adds print fidelity, a leg gap counted only above the garment's own hem and a silhouette tolerance band, and picks the engine (on run 13's stills: FASHN on both views) | 189 | $0.21–0.58 |
| 14 | same product, job `azure-palm-baby-doll-dress-6d2f2611a144` (export 0.4.0), FASHN only, `--accept-failed-dress` | The whole chain on a shop product: stage 1b → stage 2 with the proxy control → stage 4 on garment masks | Stills: FASHN's babydoll again; QA 0.3.0 failed them on the old silhouette IoU (0.835 / 0.828 < 0.85) and 6 leg-gap rows on the front (QA 0.4.0 replaced that IoU by a tolerance band and counts leg-gap rows only above the hem; run 14's stills were not re-scored with it). Stage 2: the turntable keeps the print, the puffed sleeves, the waist tie and the tiered skirt in every view; consistency 0.3.0 flagged 31 of 243 frames (turntable_a 35–37 and 43–45, turntable_b 34–47, all side views, and 70–72; motion 73–80), 0 artefact frames. The prompt still said "a blue … dress" (export 0.4.0 predates the colour fix); the pinned stills carried the print anyway. Stage 4: mask IoU 0.925 train / 0.917 holdout, 11,999 triangles. The evaluation below | This write-up: the evaluation tooling fixed on the first real mesh (next section) | 1493 | $1.57–1.63 |
| **Total** | | | | | **6648** | **$6.89–7.52** |

### What broke in the evaluation tooling on the first real mesh, and the fix

The first run of `report:bohohippychic` on run 14's mesh reported chart agreement FAIL (before calibration 19.6 cm, global scale 0.834, no chest girth) and view IoU 0.33 / 0.29. All three were the tooling, not the dress:

1. **Girth was the slice polyline.** The stage 4 surface ripples by ±1–2 cm (TSDF at 0.4 cm voxels), so the polyline is far longer than the cloth: 129.6 cm at the hip for a loop that sits about 1 cm off a 100 cm body. The global scale then shrank the whole dress by 17 % into the mannequin, which is why the view IoU collapsed. Now `src/tape.ts`: a tape measure round the outside of the slice (median radius per 5°, ripples under about 25° smoothed, convex hull), on the ring's own body part only, holes up to 4 cm bridged, a wider opening refused. Hip 129.6 → 106.5 cm, waist 100.5 → 82.5 cm; on the smooth synthetic dress the tape equals the polyline to under 0.6 cm (tests).
2. **No chest girth.** At chest height the sleeves are fused to the bodice (A-pose arms close to the torso) and the only loop, open, ran round torso and both arms. The tape assigns each slice point to the nearest part of the mannequin's own slice and passes under the arm: chest 99.0 cm.
3. **Waist and hip were critical for an empire babydoll.** The evaluation used the fit engine's category points (bust, waist, hip) but not its pattern-block rule: `BLOCKS.empire` skips waist and hip ("empire line hangs from the bust"), as `computeFit` does. Their chart values (body + the category's default ease) are guesses for a dress that hangs from the bust, and they drove the global scale. Now critical anchors are the category points minus the block's skipped points (unless the product names them), and skipped rings are reported but neither critical nor calibrated. This changes the other shop products too: the shirt blouse and the oversized cardigan keep only the chest, the a-line skirt only the waist.

Added for this asset: the silhouette IoU without the mannequin as occluder (next to the visible IoU), the mesh against the generated turntable at 0°, 90° and 180° with side-by-side pictures (frame, mesh in its stage 4 vertex colours, overlay), the share of cloth inside the mannequin, grading against the shop's printed garment table, three-quarter and side renders in the viewer (`view=`), and the stage 2 garment masks counted as stage 3.

### What the run 14 asset looks like (every render looked at)

- **Turntable frames (stage 2):** good. A babydoll dress with the shop's print, puffed sleeves, waist tie and tiered skirt at 0°, 90° and 180°; narrower in the side views, as the orchestrator saw.
- **The mesh in its own vertex colours** (`view/turntable_*.png`): the palette is right and the print is recognisable as a blurred pastel tropical print; the silhouette matches the frames (IoU 0.93 front, 0.85 side, 0.95 back). But grey mannequin shows through large patches of the bodice front and back, the shoulders are open, and the tiered hem ends in ragged flaps. The patches are mostly cloth lying at or inside the mannequin surface, not missing cloth: 21.9 % of the reconstructed vertices are more than 3 mm inside the mannequin (2.3 % on the synthetic dress), and against the turntable the visible IoU (mannequin in front) is 0.65–0.82 while the silhouette IoU is 0.83–0.95.
- **In the viewer** (sizes 8, 12, 16 on the M mannequin, front, three-quarter and side; XS and XXL shapes): worse than the raw mesh. The bundle carries no vertex colours, so the dress is one mean beige (#B9AFA3) with no print; the mannequin shows through the chest, waist and hip in every size; the hem and sleeve edges are shreds after the drape; the shoulders are open. The size difference is hard to see without the fit map: size 16 is a little broader at the shoulders and the skirt, size 8 shows more grey through the bodice, but the patches dominate the picture. With the fit map it is clear (on M: 8 red at the chest, 12 light blue, 16 blue; on XXL red in every size, where the fit engine says nothing fits). On the XXL shape the dress is still drawn closed and barely strained in every size, although the fit engine says size 8 does not close at the chest; only the fit map and the text say so.
- **The synthetic dry run** (`aalter-studio-2`) renders cleanly in all views, so the viewer, the bundle and the drape are not what makes the shop asset look bad.

## Template fit (stage 4t, 7 Nov 2026): the proxy deformed to the masks instead of the 2DGS mesh

Stage 4t (`src/templateFit.ts`, `src/bake.ts`, `src/stage4t.ts`, `scripts/stage4t.ts`; CPU, no GPU, no learned model) replaces run 14's 2DGS mesh as the evaluated asset. The control proxy (`control/proxy.glb`) is remeshed into a body tube and one tube per sleeve; every vertex moves only along a fixed ray, inside [mannequin + 4 mm, the next body part] (signed distance to `mannequin.glb`), to the visual hull of 128 of the 160 stage 2 garment masks (every frame with index mod 5 = 2 held out), smoothed by a Laplacian on the radial offsets, then 6 silhouette rounds. The hem and the cuffs are found per column on the masks. Before carving, each mask is cleaned in garment units (pixels per cm from the camera's focal length and its distance to the body axis: 3.57 px/cm on run 14): interior holes up to 12 cm² are filled as noise, so the smallest opening the fit can carve is about 3.5 × 3.5 cm; a 10 × 5 cm keyhole (about 640 px at 480 × 832) stays open (a test renders one at 480 × 832 and at half that). Run 14's fit is the same with this clean-up as with the earlier 600 px threshold (11,227 triangles, the same rays and IoU). The bodice may not run into a fitted sleeve: between the A-pose arm and the torso no view can carve (the front views see the sleeve there, the side views the arm), and without that rule the bodice spread to the arms (chest 121.5 cm by the tape; 101.5 cm with it, 221 body rays ended at a sleeve, holdout IoU unchanged). The print is then baked by projection from the same 128 frames into a 2048² atlas (best-facing views blended, 3 px kept off the mask edge, outliers more than 90 (sum of |ΔRGB|) from the blend dropped: 2.9 % of the samples), JPEG quality 88, embedded in a textured `garment.glb`. Run time on this 4-core build machine: 87 s for run 14 (fit 32 s, bake 40 s; the synthetic dress 91 s).

**Synthetic shirt dress with ground truth** (`aalter-studio-2`, export with `--synthetic-photos`, 160 frames at 480 × 832): Chamfer distance to `garment_truth.glb` **0.44 cm** (2DGS on the same garment: 1.45 cm), F-score 0.96 at 1 cm and 0.98 at 2 cm; 0 of 6,148 vertices inside the mannequin (closest 3.6 mm from `mannequin.glb`, exact distance); holdout IoU visible 0.983 (min 0.978), silhouette 0.979 (min 0.962); 12,024 triangles; hem found at 26.96 cm (truth 26.6), cuff 57.0 cm along the arm (truth 57.3). Its baked texture scores worse than one mean colour on the held-out frames (MAE 34.3 against 29.4): the synthetic frames are lit by a head light that moves with the camera, so no single texture can match every view; on the generated frames (studio light fixed) the texture wins.

**Caveat on that number, and the check that answers it.** This product's template (`control/proxy.glb`) is built from the same garment spec as `garment_truth.glb`, so the unfitted template already lies 0.57 cm (Chamfer, 50,000 samples per surface) from the truth: 0.44 cm after the fit says little on its own. `scripts/stage4t-perturbed.ts` (`stage4t:perturbed`, `stage4t/synthetic/perturbed.json`) therefore fits the same 128 training masks from templates that are not the garment, and reports the Chamfer before (the template itself) and after the fit, overall and per region (shoulders above the chest ring, bodice from the waist to the chest, skirt below the waist, sleeves more than 2 cm outside the torso):

| Template | Chamfer before → after | Before: shoulders / bodice / skirt / sleeves | After: shoulders / bodice / skirt / sleeves |
| --- | --- | --- | --- |
| exported proxy (same spec as the truth) | 0.567 → 0.437 cm | 0.60 / 0.40 / 0.63 / 0.29 | 0.81 / 0.42 / 0.33 / 0.58 |
| 8 % wider, hem 8 cm higher, sleeves 10 % wider and 15 % shorter | 1.555 → 0.437 cm | 1.14 / 0.85 / 1.97 / 0.54 | 0.81 / 0.42 / 0.33 / 0.58 |
| 6 % narrower, hem 8 cm lower, sleeves 10 % wider and 10 % longer | 1.548 → 0.437 cm | 1.08 / 1.07 / 1.87 / 0.68 | 0.81 / 0.42 / 0.33 / 0.58 |
| another product's proxy: `linde-dress-01` (knee-length sheath, 20 cm sleeves) | 3.111 → 0.437 cm | 0.81 / 0.91 / 4.24 / 1.96 | 0.81 / 0.42 / 0.33 / 0.58 |

From all four the fit lands on the same surface (Chamfer 0.437 cm, F-score 0.958 at 1 cm, holdout silhouette IoU 0.979; per region within 0.002 cm): on this dress every ray has mask evidence, so the template decides nothing and the result does not depend on starting near the truth. The table also shows where silhouettes fall short: the shoulders (0.81 cm) and the sleeves (0.58 cm) end up further from the truth than the correct template was (0.60, 0.29 cm): the visual hull cannot see the hollow under the arm or the slope of the shoulder, and the fit replaces a right template there with the hull. The bodice and the skirt are recovered from any start. This is still a synthetic garment rendered with our own cameras and exact masks; on run 14 the masks come from a generated video and the template (proxy vs generated babydoll) differs from the garment in ways this table does not cover (a tiered skirt, puffed sleeves).

**Run 14, before (2DGS, stage 4) and after (template fit, stage 4t)**, both through the same evaluation (`report:bohohippychic`):

| Metric | 2DGS (stage 4) | Template fit (stage 4t) |
| --- | --- | --- |
| Vertices inside the mannequin | 21.9 % more than 3 mm inside the analytic mannequin; 26.2 % (1,601 of 6,106) inside `mannequin.glb` by the grid SDF's sign (the method decides the figure) | 0 of 5,780 by both. Closest vertex 3.70 mm from `mannequin.glb` (exact point-to-triangle distance), 72 vertices between 3.70 and 4.0 mm, none below 3.7 mm: the fit holds 4 mm on the grid SDF, which reads up to 0.3 mm optimistic here |
| Turntable IoU visible / silhouette at 0° | 0.653 / 0.931 | 0.904 / 0.904 |
| at 90° | 0.761 / 0.834 | 0.920 / 0.860 |
| at 180° | 0.669 / 0.931 | 0.935 / 0.931 |
| All 160 frames, visible IoU mean (min) | train 0.696, holdout 0.697 (0.639) | train 0.906 (0.874), holdout 0.906 (0.883) |
| All 160 frames, silhouette IoU mean (min) | train 0.898, holdout 0.900 (0.781); 2DGS's own mask IoU 0.925 train / 0.917 holdout | train 0.885 (0.791), holdout 0.887 (0.812) |
| Pinned stills, visible IoU front / back | 0.713 / 0.751 | 0.909 / 0.937 |
| Shop photos, normalised IoU front / back (indicative) | 0.60 / 0.56 | 0.75 / 0.67 |
| Chest by the tape (chart 102 cm at AU 12) | 99.0 cm: −2.98 before calibration, global scale 1.030, −0.71 after | 101.5 cm: −0.50 before calibration, global scale 1.005, 0.00 after |
| Waist / hip, not fitted by the empire block (before calibration) | +1.03 / −3.51 cm | +6.41 / +4.54 cm |
| Graded chest − printed, AU 8 / 10 / 12 / 14 / 16 | −2.71 / −1.71 / −0.71 / +0.29 / −0.71 cm | −2.00 / −1.00 / 0.00 / +1.00 / 0.00 cm |
| Shoulder to hem: vertical drop / flat-lay (printed 91 cm) | 83.3 / 86.6 cm | 84.4 / 92.6 cm |
| Mesh | 11,999 triangles, 2 components, 869 boundary edges, ragged hem | 11,227 triangles, 3 components (body + 2 sleeves, not stitched), 337 boundary edges in 8 loops, 0 non-manifold edges, not watertight (open by design at neckline, hem, cuffs, armholes) |
| Colour | one mean colour #B9AFA3 in the bundle | baked texture: holdout MAE 21.0 against 24.3 for one mean colour (8 × 8 blocks: 13.3 against 18.3) |
| Size | 255 KB bundle | `garment.glb` 716 KB (JPEG 399 KB), bundle 756 KB (budget 3 MB) |

Both IoU rows of all 160 frames come from the same projection (`scripts/stage4t-compare.ts`, `stage4t/stage2/compare.json`). **The outline matches the masks slightly worse than 2DGS did** (holdout silhouette 0.900 → 0.887, at 0° 0.931 → 0.904), while what a viewer sees matches far better (holdout visible 0.697 → 0.906), because the mannequin no longer shows through the cloth. The worst holdout frame improved (silhouette min 0.781 → 0.812). The silhouette IoU without the mannequin is lower than the visible one at the side views (0.86 at 90°, 0.81 at the worst frame): the masks are of the *visible* garment, and from the side the arm hides the bodice that the garment-only render shows. The waist and hip are larger than the 2DGS mesh's: the 2DGS surface lay partly inside the mannequin there, and the template's skirt follows the masks' flare; neither is calibrated for an empire dress.

**The length (83.3 vs 91 cm).** The shop prints "Length" per size (90, 90, 91, 92, 93 cm for AU 8–16) and does not say how it is measured; a garment table's length is normally a flat-lay measure from the high point shoulder (HPS) to the hem, i.e. along the garment, not a vertical drop on a body. The definitions on the meshes (`src/garmentLength.ts`): the vertical drop is 83.3 cm (2DGS) and 84.4 cm (stage 4t), the flat-lay length along the front 86.6 and 92.6 cm, the back length 83.2 and 81.6 cm. Only the flat-lay reading comes near 91 cm; the two meshes have the same hem height (the masks', 53–57 cm above the floor) and differ in flat-lay length by 6 cm because the path from the HPS depends on the neckline and the bust surface (the stage 4t neckline starts 5.5 cm below the HPS and is bridged straight). So most of the −7.7 cm was the definition, and the evaluation now compares the printed length with the flat-lay length (`printedLength: 'flat-lay'` for shop products, the vertical drop for the spike's synthetic garment, which is built that way). The other half of the finding is the control: proxy 0.1.0 dropped 91 cm vertically, so run 14's control video put the hem at the knee (47.6 cm, flat-lay 100.6 cm), about 8 cm lower than the dress the stills and the video drew. Proxy 0.2.0 ends the hem where the proxy's own front is 91 cm long (57.3 cm above the floor, drop 81.3 cm), which matches the generated hem within 2–4 cm; the prompt word becomes "above-knee" (it was "knee-length"). Runs after 14 use proxy 0.2.0; run 14 was not re-run.

**What the stage 4t asset looks like (every render looked at, compared side by side with the 2DGS renders in `out/eval/azure-palm-baby-doll-dress-2dgs/renders/`).**

- **Against the frames** (`view/turntable_*.png`, `stage4t/stage2/preview/`): the same dress, closed everywhere, with the print recognisable (the palms, the pink buildings, the blue and peach patches in the same places), softer than the frames. The hem is one clean wavy line; a thin broken line of darker and lighter texels runs along it (the shaded underside of the hem in the frames). The overlay is grey almost everywhere: red (frame only) along the V neckline and at the outer shoulder tops, and at the hem corners where the tier swings out; blue (mesh only) a band at the centre-front hem.
- **In the viewer, plain, M mannequin, AU 8 / 12 / 16, front, three-quarter and side:** no mannequin through the cloth in any size or view (the 2DGS asset showed it through the chest, waist and hip in every picture and ended in shreds at the hem). The print is visible but washed out by the viewer's light. The size difference is visible without labels: 16 is broader across the bodice and the skirt, 8 narrower. Three faults remain: (1) the **shoulder tops are bare**: a grey wedge between the neckline and each sleeve in every size and view, larger after the drape than in the fitted mesh (horizontal body rays cannot form the near-horizontal shoulder, the body tube is trimmed at the armhole, and the sleeve tube is not stitched to it); (2) the **sleeves droop** after the drape into wide elbow-length sleeves: the puff is lost; (3) from the side the dress hangs straight, the empire seam and the tie are only in the texture.
- **Fit map:** on M, 8 red at the chest, 12 light blue, 16 blue, as before, now on clean cloth. **XS shape:** every size has room (blue), 8 the least. **XXL shape:** red across the chest in every size, matching "nothing fits well; closest is 16"; the plain render still draws every size closed and barely strained, so without the fit map the XXL renders do not show that 8 cannot close.
- **The synthetic dry run** (`aalter-studio-2`) renders as before.

## Verdict per Phase 0 acceptance item (after run 14)

| Item | Verdict | Evidence |
| --- | --- | --- |
| Size test | **Needs the five-person panel; not run.** Not yet: 1 of 5 products has a bundle | With stage 4t the cloth is closed, carries the print and the sizes differ visibly without labels; the bare shoulder tops and the drooping sleeves are the remaining faults a panel would see. Bundles exist for 1 of 5 products |
| Fabric test | **Needs the five-person panel; not run** | No linen/silk renders were made of this asset; nobody has judged it |
| Chart agreement | **Measured here on 1 of 5 products: passes at its one critical anchor.** Not yet measurable as a gate (4 of 5 needed) | Chest (the only printed girth, 102 cm at AU 12), stage 4t: reconstructed 101.5 cm, −0.50 cm before calibration (within ±2), global scale 1.005, 0.00 after calibration (2DGS: 99.0 cm, −2.98 before, 1.030, −0.71 after). Waist and hip are not fitted by the empire block (+6.41 and +4.54 cm before calibration against body + default ease, reported only). Length: flat-lay shoulder to hem 92.6 cm against the printed 91 cm (+1.6; vertical drop 84.4 cm), see the template fit section. Graded chest against the printed table: −2.00, −1.00, 0.00, +1.00, 0.00 cm for AU 8–16 (the shop grades 4 cm per size from 8 to 14, the AU chart 5 cm) |
| View agreement | **Measured here; merchant confirmation still needed** | Stage 4t against the pinned stills (stage 1b): visible IoU (mannequin in front) 0.909 front / 0.937 back, above the initial 0.85 (2DGS 0.713 / 0.751); silhouette 0.909 / 0.935. Against the generated turntable, visible / silhouette: 0.904 / 0.904, 0.920 / 0.860, 0.935 / 0.931 at 0° / 90° / 180°; over all 160 frames holdout visible 0.906. Against the shop photos (indicative only): 0.75 / 0.67. The pinned stills are generated from photos on a model, so this measures stages 2–4t, not the shop's garment. In the viewer the print is there and the cloth is closed; the bare shoulder tops are what a merchant would object to |
| Cost | **Measured (GPU seconds and wall time); dollars still list-price estimates** | Run 14: 1,493 GPU s, 2,311 s wall, $1.57–1.63 (stage 1b $0.02–0.07, stage 2 $1.47–1.49, stage 4 $0.07–0.08). Runs 10–14 together: 6,648 GPU s, $6.89–7.52. The Modal invoice has not been read |
| Write-up | **Not met** | One video model (Wan2.2-Fun-A14B-Control) and one reconstruction method (2DGS + TSDF) have run; the scope asks for two of each. Tolerances for Phase 1 cannot be set from one product |

What the asset needs before the panel sees it, after stage 4t: cover the shoulder tops (a shoulder patch with rays normal to the shoulder, or the sleeve cap stitched to the armhole), keep the sleeve shape through the drape (pin more of the sleeve cap, or give the sleeves the body's bend stiffness), and bundles for the other four products (GPU runs). Done by stage 4t: the cloth stays outside the mannequin (0 vertices inside and none closer than 3.7 mm; was 21.9 % more than 3 mm inside by the analytic test, 26.2 % inside by the SDF sign), the print is in the bundle (baked texture, was one mean colour), the hem is a clean line (was ragged flaps). The length miss was mostly the definition (flat-lay, not a vertical drop); run 14's control hem was 8 cm too low because proxy 0.1.0 dropped the printed length vertically (fixed in proxy 0.2.0).

*The section above is written by hand in `spikes/garment-engine/data/bohohippychic/phase0-written.md` and copied in by the report script; everything else is generated.*

## What this set can and cannot show

- Every shop photo is worn by a model in a styled set, at 800 × 1200 px. The engine's photo contract (D13) is not met by any product, so these runs test the `--on-model` path: stage 1b generates the pinned stills on our mannequin from those photos. View agreement against the pinned stills therefore measures stages 2–4, not whether stage 1b reproduced the garment.
- The base size AU 12 (S-M for the cardigan) is our default; the shop does not say which size was photographed. Chart agreement is against the AU body chart plus ease at that size.
- Calibration scales each critical ring to its chart value, so after calibration the chart agreement is near 0 by construction. The informative numbers are the error before calibration and after the global scale.
- An open-front garment (the cardigan) has no girth at the chest, waist or hip unless the reconstruction closes it (the tape bridges holes up to 4 cm, not a front opening); the evaluation reports that as a failure at those anchors rather than guessing a girth.
- Critical anchors follow the fit engine: the category's points minus those the product's pattern block skips (an empire babydoll hangs from the bust, so its waist and hip are reported but not calibrated).
- The XS and XXL renders use the viewer's avatar: the M mannequin morphed to the XS or XXL ring girths at chest, waist and hip (stature and arms stay M).
- Trousers and skirts hang from their waistband in the viewer; that is checked only on a skirt cut from the synthetic dress (a unit test and one headless render), never on a reconstructed bottom.
- **Not covered: Jumpsuits & Sets.** The request was one product from each clothing category; this one has none. No validation product: jumpsuits, overalls and pant suits span the torso and the legs, and the engine has no combined dress + bottom anchor subset for them yet (anchoring, calibration and grading would have to be added first). It was left out for this technical reason, not on scope grounds; the founder decides whether to accept the gap or to add one product from this category.

## Products

### 1. Azure Palm Baby Doll Dress (`azure-palm-baby-doll-dress`)

Dresses → category `dress` (babydoll). Completeness 0.697, incomplete.

**Why this product:** Only dress that meets all four criteria with 4 images: AU 8–16, front/back/3-4 views, "lightweight rayon", and a printed garment table (bust and length per size, ~7 cm over the AU body bust, so garment measurements). Runners-up: `rosabelle-babydoll-dress`, `coastal-gypsy-block-print-midi-dress`, `seraphina-embroidered-mirror-work-maxi-dress`, `capri-midi-dress`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | front | yes | busy | yes | 800×1200 | front (used) |
| 2 | front | yes | busy | yes | 800×1200 |  |
| 3 | front | yes | busy | yes | 800×1200 |  |
| 4 | back | yes | busy | yes | 800×1200 | back (used) |

Job exported: source kind on_model; front `dress/source_front.jpg` (photo 1); back `dress/source_back.jpg` (photo 4); invented back: **no**.

**Chart:** body chart, sizes 8, 10, 12, 14, 16; base size 12 (our default, not stated by the shop): body bust 95, waist 77.5, hip 104 cm. Product ease from the printed garment table: bust +7 cm; other points take the fit engine's category default ease. Printed lengths: shoulder_to_hem 91 cm.

**Fabric resolved** (fabric library 1.0.0): 100% viscose; 165 g/m², stretch 1.5 %, drape 0.85, bend 0.04, sheen 0.3, opacity 0.8. Display colour: placeholder (no colour in the product data; display only).

Data warnings from the selection:

- fabric composition not stated (only "viscose" named): blend left out; weight/stretch/drape use the single-fibre library default
- the AU body chart has no shoulder width; the shoulder fit point is skipped
- price is 79 AUD; priceEur is left out (no exchange rate is assumed)

**Pipeline status**

| Stage | State | Detail |
| --- | --- | --- |
| 1 ingest and validate | failed | photo contract not met: front photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; back photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; base size 12 is our default, not confirmed by the shop |
| job export | done | job azure-palm-baby-doll-dress-6d2f2611a144, input hash 6d2f2611a144 |
| 1b dress the mannequin | failed | engine fashn; QA failed on front, back; QA overridden (--accept-failed) |
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 3.2 / 2.6 (8-bit mean abs) |
| 3 separation | done | 160 garment masks of the generated frames (`stage2/garment_mask/`, garment-segment-0.1.0; 0 frames ambiguous with the mannequin); stage 4 trains on them |
| 4 reconstruction | done | 11999 triangles, mask IoU train 0.9252 / holdout 0.9172 |
| 4t template fit + bake (CPU) | done | 11227 triangles, IoU visible / silhouette train 0.9059 / 0.8853, holdout 0.906 / 0.8865, 0 vertices inside the mannequin |
| 5 anchoring and calibration | done | stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames); global scale 1.005 |
| 6 grading | done | 8, 10, 12, 14, 16 |
| 7 QA (chart, view, mesh) | done | chart pass, view front 0.909, back 0.937, 11227 triangles |
| 8 bundle | done | 756 KB in `spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/` |

**Metrics**

Mesh: stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames) (`stage4t/stage2/garment.glb`, sha256 ed407ee3d2ee).

**Chart agreement** at base size 12 (tolerance ±2 cm at the critical anchors: chest). Global scale 1.0049, from chest. The `empire` pattern block does not fit waist and hip (empire line hangs from the bust; the fit engine skips them too), so they are reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chest | yes | 102.00 | +7.00 | 101.50 | 104.80 | -0.50 | 0.00 | 0.00 | pass |
| waist | no | 81.50 | +4.00 (category default) | 87.88 | 88.29 | +6.38 | +6.81 | +6.82 | not fitted |
| hip | no | 110.00 | +6.00 (category default) | 114.54 | 114.72 | +4.54 | +5.10 | +5.10 | not fitted |

Before calibration max |error| 0.50 cm (within ±2); after the global scale alone 0.00 cm (within); after per-ring calibration pass. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): underbust 95.37, thigh 141.90, upper_arm 57.54 cm.

No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): neck, shoulder, knee, wrist.

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| shoulder_to_hem | 92.57 | flat-lay | 84.42 | 91.00 | +1.57 | flat-lay: along the garment front from the high point shoulder (src/garmentLength.ts); vertical drop 84.42 cm |
| waist_to_hem | 50.20 | — | — | — | — |  |
| sleeve_length | 35.50 | — | — | — | — |  |

Every shoulder-to-hem definition on the calibrated mesh (`src/garmentLength.ts`): high point shoulder, vertical drop to the front hem 84.42 cm; high point shoulder, along the garment front to the hem (flat-lay length) 92.57 cm; back neck at the centre back, along the garment back to the hem 81.61 cm; shoulder point (end of the shoulder), vertical drop to the front hem 81.41 cm.

**Grading against the shop's printed garment table** (graded targets in grading.json minus what the shop printed per size; the base size is calibrated to the chart, the other sizes follow the chart's steps; the shop's "Length" is read as shoulder to hem, flat-lay: grading.json's vertical drop + 8.15 cm, the base mesh's flat-lay minus drop):

| Size | chest graded | chest printed | diff | shoulder_to_hem graded | shoulder_to_hem printed | diff |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | 92.00 | 94.00 | -2.00 | 90.57 | 90.00 | +0.57 |
| 10 | 97.00 | 98.00 | -1.00 | 91.57 | 90.00 | +1.57 |
| 12 | 102.00 | 102.00 | 0.00 | 92.57 | 91.00 | +1.57 |
| 14 | 107.00 | 106.00 | +1.00 | 93.57 | 92.00 | +1.57 |
| 16 | 112.00 | 112.00 | 0.00 | 94.57 | 93.00 | +1.57 |

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | stage1b `stage1b/garment_mask_front.png` | 0.909 | 0.909 | pass | no |
| back | stage1b `stage1b/garment_mask_back.png` | 0.937 | 0.934 | pass | no |

Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):

| View | Normalised IoU | Mirrored | Aspect render / photo |
| --- | --- | --- | --- |
| front | 0.751 | no | 1.06 / 1.15 |
| back | 0.673 | yes | 1.04 / 1.7 |

Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):

| Angle | Frame | Calibrated: visible | Calibrated: silhouette | Reconstructed: visible | Reconstructed: silhouette | Picture |
| --- | --- | --- | --- | --- | --- | --- |
| 0° | 0 | 0.904 | 0.905 | 0.904 | 0.904 | [turntable_0.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_0.png) |
| 90° | 40 | 0.917 | 0.857 | 0.920 | 0.860 | [turntable_90.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_90.png) |
| 180° | 80 | 0.935 | 0.932 | 0.935 | 0.931 | [turntable_180.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_180.png) |

Each picture: the stage 2 frame, the calibrated mesh with its baked texture (stage 4t) on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).

Overlays: [front](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 0.0 % as reconstructed (0 vertices), 0.0 % after calibration.

**Mesh health** (mesh as evaluated): 11227 triangles (budget 8000–15000: within), 5780 vertices, 3 components, 337 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

**Stage 4t** (template fit and bake, `stage4t/stage2/metrics.json`): the control proxy remeshed into cylindrical grids (body + two sleeves), carved and expanded along fixed rays to 128 training masks, 6 silhouette rounds, 557 Jacobi sweeps in 8 solves (every solve reached the 0.001 cm tolerance). Silhouette IoU per view, mean (min): train visible 0.9059 (0.8742), silhouette 0.8853 (0.7912); holdout (32 views never used) visible 0.906 (0.8827), silhouette 0.8865 (0.8123). Inside the mannequin (signed distance to mannequin.glb < 0): 0 of 5780 vertices; below the 0.4 cm clearance by that grid SDF: 0; by the exact distance to the mannequin's triangles the closest vertex is 0.37 cm away, 72 vertices lie below the 0.4 cm clearance and 0 below 0.3 cm. Mesh: 11227 triangles, 3 components, 8 boundary loops, 0 non-manifold edges, watertight no (open by design: one body tube and one tube per sleeve (separate components overlapping at the armhole, not stitched); openings at the neckline, hem, cuffs and armholes are the boundary loops). Texture: 2048² atlas from 128 training views, 95.9 % of the chart texels seen (the rest filled by diffusion), JPEG 399 KB; on the held-out frames the texture's mean absolute error is 20.97 (one mean colour: 24.27), on 8 × 8 pixel blocks 13.34 (mean colour 18.25), 0–255.

**Stage 4 (2DGS) against stage 4t (template fit)** on the same video, both through this evaluation (the 2DGS column is what the report showed for run 14 before stage 4t):

| Metric | stage 4 reconstruction of the stage 2 video (`stage4/stage2/garment.glb`) | stage 4t template fit of the stage 2 video (`stage4t/stage2/garment.glb`) |
| --- | --- | --- |
| chest girth as reconstructed (tape), cm | 99.02 | 101.50 |
| chart: max \|error\| before calibration, cm | 2.98 | 0.50 |
| chart: after the global scale, cm | 0.00 | 0.00 |
| chart: after calibration, cm | 0.71 | 0.00 |
| global scale | 1.030 | 1.005 |
| turntable 0°: IoU visible / silhouette | 0.653 / 0.931 | 0.904 / 0.904 |
| turntable 90°: IoU visible / silhouette | 0.761 / 0.834 | 0.920 / 0.860 |
| turntable 180°: IoU visible / silhouette | 0.669 / 0.931 | 0.935 / 0.931 |
| cloth inside the mannequin (> 0.3 cm), as reconstructed | 21.9 % | 0.0 % |
| cloth inside the mannequin, after calibration | 18.3 % | 0.0 % |
| triangles / components / boundary edges | 11999 / 2 / 869 | 11227 / 3 / 337 |
| shoulder to hem, vertical drop, cm | 83.29 | 84.42 |
| shoulder to hem, flat-lay (along the front), cm | 86.63 | 92.65 |
| colour in the bundle | one mean colour #B9AFA3 | baked texture |
| bundle size | 255 KB | 756 KB |

Evaluation time on the build machine: read 265 ms, measure 92 ms, calibrate 24 ms, grade 1 ms, view renders 1221 ms.

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage1b_dress | H100 | any | 22 s | 60 s | $0.02 | $0.07 |
| stage2_video | H100 | any | 1343 s | 1357 s | $1.47 | $1.49 |
| stage4_recon[stage2] | L40S | any | 127 s | 143 s | $0.07 | $0.08 |

Total: 1493 s GPU, 2311 s wall, $1.57–$1.63 (estimate).

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | 8, 12, 16 | 2.42 s, 2.38 s, 2.33 s | [M-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-plain.png) |
| M mannequin | front | yes | 8, 12, 16 | 2.42 s, 2.38 s, 2.33 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | 8, 12, 16 | 6.10 s, 6.06 s, 6.03 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | 8, 12, 16 | 6.10 s, 6.06 s, 6.03 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | 8, 12, 16 | 5.38 s, 5.34 s, 5.31 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-side-plain.png) |
| M mannequin | side | yes | 8, 12, 16 | 5.38 s, 5.34 s, 5.31 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-side-fitmap.png) |
| XS shape | front | no | 8, 12, 16 | 5.82 s, 5.79 s, 5.76 s | [XS-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XS-plain.png) |
| XS shape | front | yes | 8, 12, 16 | 5.82 s, 5.79 s, 5.76 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XS-fitmap.png) |
| XXL shape | front | no | 8, 12, 16 | 5.98 s, 5.95 s, 5.93 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XXL-plain.png) |
| XXL shape | front | yes | 8, 12, 16 | 5.98 s, 5.95 s, 5.93 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XXL-fitmap.png) |

### 2. Rosewater Blouse (`rosewater-blouse`)

Tops → category `top` (blouse). Completeness 0.576, incomplete.

**Why this product:** AU 8–16, 5 images (4 of the blouse) with a clean straight back view, "100% lightweight rayon". It prints no measurements; the one top that does (meadowlight-blouse) shows the blouse in 2 photos only. Runners-up: `meadowlight-blouse`, `amelie-button-back-blouse`, `marella-coast-blouse`, `sandy-cove-poncho-top`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | front | yes | busy | yes | 800×1200 | front (planned) |
| 2 | side | yes | busy | yes | 800×1200 |  |
| 3 | front | yes | busy | yes | 800×1200 |  |
| 4 | back | yes | busy | yes | 800×1200 | back (planned) |
| 5 | front | yes | busy | no | 800×1200 |  |

Job not exported yet. Planned: front = photo 1, back = photo 4 (a real back photo, so the back would not be invented). Both are on a model (`--on-model`).

**Chart:** body chart, sizes 8, 10, 12, 14, 16; base size 12 (our default, not stated by the shop): body bust 95, waist 77.5, hip 104 cm. No garment measurements printed: all points take the fit engine's category default ease.

**Fabric resolved** (fabric library 1.0.0): 100% viscose; 165 g/m², stretch 1.5 %, drape 0.85, bend 0.04, sheen 0.3, opacity 0.8. Display colour: placeholder (no colour in the product data; display only).

Data warnings from the selection:

- the AU body chart has no shoulder width; the shoulder fit point is skipped
- price is 69 AUD; priceEur is left out (no exchange rate is assumed)

**Pipeline status**

| Stage | State | Detail |
| --- | --- | --- |
| 1 ingest and validate | failed | photo contract not met: front photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600, garment partly hidden); add one on a hanger, flat-lay or ghost mannequin; back photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; base size 12 is our default, not confirmed by the shop |
| job export | blocked | no job dir: `src/product.ts` does not know the shop products yet, so `export:phase0 -- --on-model` cannot export them |
| 1b dress the mannequin | not run | no stage1b/record.json |
| 2 image to video | not run | no stage2/record.json |
| 3 separation | not built | no stage 3 on generated frames yet; stage 4 falls back to its foreground mask mode |
| 4 reconstruction | not run | no stage4/stage2/ |
| 5 anchoring and calibration | not run | no job dir |
| 6 grading | not run | no job dir |
| 7 QA (chart, view, mesh) | not run | no job dir |
| 8 bundle | not run | no job dir |

**Metrics**

Chart agreement, view agreement and mesh health: not measured (no job dir).

No cost records (no GPU stage has run for this product).

**Renders**

Not rendered yet (`report:bohohippychic -- --renders` after the bundles exist).

### 3. Rosewater Palazzo Pants (`rosewater-palazzo-pants`)

Pants → category `bottom` (palazzo). Completeness 0.676, incomplete.

**Why this product:** AU 8–16, 5 images with a back view, "100% lightweight rayon", and a printed garment table (waist, hips, length per AU size). Runners-up: `byron-barrel-denim-jeans`, `drift-tide-denim-jeans`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | front | yes | busy | no | 800×1200 |  |
| 2 | front | yes | busy | yes | 800×1200 | front (planned) |
| 3 | front | yes | busy | yes | 800×1200 |  |
| 4 | back | yes | busy | yes | 800×1200 | back (planned) |
| 5 | front | yes | busy | yes | 800×1200 |  |

Job not exported yet. Planned: front = photo 2, back = photo 4 (a real back photo, so the back would not be invented). Both are on a model (`--on-model`).

**Chart:** body chart, sizes 8, 10, 12, 14, 16; base size 12 (our default, not stated by the shop): body bust 95, waist 77.5, hip 104 cm. Product ease from the printed garment table: hip +14 cm; other points take the fit engine's category default ease. Printed lengths: outseam 99 cm.

**Fabric resolved** (fabric library 1.0.0): 100% viscose; 165 g/m², stretch 1.5 %, drape 0.85, bend 0.04, sheen 0.3, opacity 0.8. Display colour: placeholder (no colour in the product data; display only).

Data warnings from the selection:

- printed table has steps no grading produces: waist 8→10: 94 → 110 cm
- printed waist 112 cm at AU 12 not used as ease: the waist is elastic and the text does not say relaxed or stretched
- price is 69 AUD; priceEur is left out (no exchange rate is assumed)

**Pipeline status**

| Stage | State | Detail |
| --- | --- | --- |
| 1 ingest and validate | failed | photo contract not met: front photo does not meet the contract (worn by a model, busy background, garment partly hidden, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; back photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; base size 12 is our default, not confirmed by the shop |
| job export | blocked | no job dir: `src/product.ts` does not know the shop products yet, so `export:phase0 -- --on-model` cannot export them |
| 1b dress the mannequin | not run | no stage1b/record.json |
| 2 image to video | not run | no stage2/record.json |
| 3 separation | not built | no stage 3 on generated frames yet; stage 4 falls back to its foreground mask mode |
| 4 reconstruction | not run | no stage4/stage2/ |
| 5 anchoring and calibration | not run | no job dir |
| 6 grading | not run | no job dir |
| 7 QA (chart, view, mesh) | not run | no job dir |
| 8 bundle | not run | no job dir |

**Metrics**

Chart agreement, view agreement and mesh health: not measured (no job dir).

No cost records (no GPU stage has run for this product).

**Renders**

Not rendered yet (`report:bohohippychic -- --renders` after the bundles exist).

### 4. Crimson Wildflower Maxi Skirt (`crimson-wildflower-maxi-skirt`)

Skirts → category `bottom` (maxi-skirt). Completeness 0.559, incomplete.

**Why this product:** AU 8–16, 3 images (side with slit, front, back), "lightweight, breathable rayon", elastic drawstring waist visible in every photo. No skirt prints measurements. Runners-up: `santorini-bloom-maxi-skirt`, `pink-paradise-maxi-skirt`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | side | yes | busy | yes | 800×1200 |  |
| 2 | front | yes | busy | yes | 800×1200 | front (planned) |
| 3 | back | yes | busy | yes | 800×1200 | back (planned) |

Job not exported yet. Planned: front = photo 2, back = photo 3 (a real back photo, so the back would not be invented). Both are on a model (`--on-model`).

**Chart:** body chart, sizes 8, 10, 12, 14, 16; base size 12 (our default, not stated by the shop): body bust 95, waist 77.5, hip 104 cm. No garment measurements printed: all points take the fit engine's category default ease.

**Fabric resolved** (fabric library 1.0.0): 100% viscose; 165 g/m², stretch 1.5 %, drape 0.85, bend 0.04, sheen 0.3, opacity 0.8. Display colour: placeholder (no colour in the product data; display only).

Data warnings from the selection:

- fabric composition not stated (only "viscose" named): blend left out; weight/stretch/drape use the single-fibre library default
- price is 69 AUD; priceEur is left out (no exchange rate is assumed)

**Pipeline status**

| Stage | State | Detail |
| --- | --- | --- |
| 1 ingest and validate | failed | photo contract not met: front photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; back photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; base size 12 is our default, not confirmed by the shop |
| job export | blocked | no job dir: `src/product.ts` does not know the shop products yet, so `export:phase0 -- --on-model` cannot export them |
| 1b dress the mannequin | not run | no stage1b/record.json |
| 2 image to video | not run | no stage2/record.json |
| 3 separation | not built | no stage 3 on generated frames yet; stage 4 falls back to its foreground mask mode |
| 4 reconstruction | not run | no stage4/stage2/ |
| 5 anchoring and calibration | not run | no job dir |
| 6 grading | not run | no job dir |
| 7 QA (chart, view, mesh) | not run | no job dir |
| 8 bundle | not run | no job dir |

**Metrics**

Chart agreement, view agreement and mesh health: not measured (no job dir).

No cost records (no GPU stage has run for this product).

**Renders**

Not rendered yet (`report:bohohippychic -- --renders` after the bundles exist).

### 5. Woodstock Wanderer Knit Cardi (`woodstock-wanderer-knit-cardi`)

Jackets & Knits → category `outerwear` (cardigan). Completeness 0.576, incomplete.

**Why this product:** No jacket or knit is sold in AU 8–16. Several knits tie on the text criteria (S-M/M-L mapped to AU 8–12 and 14–16 in the text, 3 images, wool/acrylic). This cardigan has front, 3/4 back and a straight back, a stated composition (35% wool 65% acrylic), and an open button front, the closest to a jacket in the collection. Runners-up: `ocean-mist-knit`, `cocoa-coast-longline-knit-coat`, `sunset-stripe-knit-jacket`, `sandbar-cardigan`, `nomad-cotton-jacket-chocolate`, `saltwater-coast-knit`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | front | yes | busy | yes | 800×1200 | front (planned) |
| 2 | side | yes | busy | yes | 800×1200 |  |
| 3 | back | yes | busy | yes | 800×1200 | back (planned) |

Job not exported yet. Planned: front = photo 1, back = photo 3 (a real back photo, so the back would not be invented). Both are on a model (`--on-model`).

**Chart:** body chart, sizes S-M, M-L; base size S-M (our default, not stated by the shop): body bust 90, waist 72.5, hip 99 cm. No garment measurements printed: all points take the fit engine's category default ease.

**Fabric resolved** (fabric library 1.0.0): 65% acrylic, 35% wool; 284 g/m², stretch 2.5 %, drape 0.5, bend 0.1177, sheen 0.083, opacity 0.957. Display colour: placeholder (no colour in the product data; display only).

Data warnings from the selection:

- the product is a knit but the fabric library has no generic sweater-knit construction; stretch and drape come from the fibres alone and understate a knit
- the AU body chart has no shoulder width; the shoulder fit point is skipped
- price is 49 AUD; priceEur is left out (no exchange rate is assumed)

**Pipeline status**

| Stage | State | Detail |
| --- | --- | --- |
| 1 ingest and validate | failed | photo contract not met: front photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; back photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; base size S-M is our default, not confirmed by the shop |
| job export | blocked | no job dir: `src/product.ts` does not know the shop products yet, so `export:phase0 -- --on-model` cannot export them |
| 1b dress the mannequin | not run | no stage1b/record.json |
| 2 image to video | not run | no stage2/record.json |
| 3 separation | not built | no stage 3 on generated frames yet; stage 4 falls back to its foreground mask mode |
| 4 reconstruction | not run | no stage4/stage2/ |
| 5 anchoring and calibration | not run | no job dir |
| 6 grading | not run | no job dir |
| 7 QA (chart, view, mesh) | not run | no job dir |
| 8 bundle | not run | no job dir |

**Metrics**

Chart agreement, view agreement and mesh health: not measured (no job dir).

No cost records (no GPU stage has run for this product).

**Renders**

Not rendered yet (`report:bohohippychic -- --renders` after the bundles exist).

## Tooling dry run on the synthetic spike product

Not a shop product. `aalter-studio-2` is the spike's synthetic shirt dress; it shows that this tooling runs end to end without GPU outputs. Its numbers say nothing about the engine on real photos.

Mesh: the spike's synthetic ground-truth garment with its simulated reconstruction error (tests this tooling only, not a product result) (`synthetic/garment_truth.glb`, sha256 0fdd2c452d7e). Simulated reconstruction error applied first: global scale 1.035, per-ring bias chest +1.8 cm, waist -1.2 cm, hip +0.8 cm, noise 0.15 cm.

**Chart agreement** at base size M (tolerance ±2 cm at the critical anchors: chest). Global scale 0.9598, from chest, waist. The `a-line` pattern block does not fit hip (A-line hem flares freely; the fit engine skips it too), so it is reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chest | yes | 100.00 | +10.00 | 105.40 | 106.31 | +5.40 | +1.16 | -0.01 | pass |
| waist | no | 84.00 | +12.00 | 86.03 | 86.43 | +2.03 | -1.42 | 0.00 | — |
| hip | no | 104.00 | +6.00 (category default) | 108.46 | 109.20 | +4.46 | +0.10 | +0.10 | not fitted |

Before calibration max |error| 5.40 cm (outside ±2); after the global scale alone 1.16 cm (within); after per-ring calibration pass. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): shoulder 109.85, underbust 90.46, thigh 114.24, knee 125.57, upper_arm 35.22, wrist 20.41 cm.

No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): neck.

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| shoulder_to_hem | 112.00 | drop | — | 112.00 | 0.00 | high point shoulder to the front hem, vertical drop (the spike's synthetic garment is built this way) |
| shoulder_to_waist | — | — | — | 40.00 | — | the garment covers the mannequin's whole line here; the spike has no seam to measure it on the garment |
| sleeve_length | 57.28 | — | — | 58.00 | -0.72 |  |
| waist_to_hem | 77.56 | — | — | — | — |  |

Every shoulder-to-hem definition on the calibrated mesh (`src/garmentLength.ts`): high point shoulder, vertical drop to the front hem 112.00 cm; high point shoulder, along the garment front to the hem (flat-lay length) 120.86 cm; back neck at the centre back, along the garment back to the hem 110.52 cm; shoulder point (end of the shoulder), vertical drop to the front hem 107.80 cm.

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | synthetic `synthetic/garment_mask/0000.png` | 0.994 | 0.994 | pass | no |
| back | synthetic `synthetic/garment_mask/0080.png` | 0.993 | 0.993 | pass | no |

- no stage 2 garment masks (stage2/garment_mask/): no turntable comparison

Overlays: [front](../../spikes/garment-engine/out/eval/aalter-studio-2/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/aalter-studio-2/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 2.3 % as reconstructed (173 vertices), 2.5 % after calibration.

**Mesh health** (mesh as evaluated): 14720 triangles (budget 8000–15000: within), 7488 vertices, 3 components, 256 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

Evaluation time on the build machine: read 19 ms, measure 31 ms, calibrate 22 ms, grade 1 ms, view renders 197 ms.

Bundle: 311 KB in `spikes/garment-engine/out/eval/aalter-studio-2/`.

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | S, M, L | 6.00 s, 5.97 s, 5.94 s | [M-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-plain.png) |
| M mannequin | front | yes | S, M, L | 6.00 s, 5.97 s, 5.94 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | S, M, L | 6.09 s, 6.07 s, 6.04 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | S, M, L | 6.09 s, 6.07 s, 6.04 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | S, M, L | 5.85 s, 5.83 s, 5.79 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-side-plain.png) |
| M mannequin | side | yes | S, M, L | 5.85 s, 5.83 s, 5.79 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-side-fitmap.png) |
| XS shape | front | no | S, M, L | 5.74 s, 5.71 s, 5.69 s | [XS-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XS-plain.png) |
| XS shape | front | yes | S, M, L | 5.74 s, 5.71 s, 5.69 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XS-fitmap.png) |
| XXL shape | front | no | S, M, L | 6.22 s, 6.18 s, 6.16 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XXL-plain.png) |
| XXL shape | front | yes | S, M, L | 6.22 s, 6.18 s, 6.16 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XXL-fitmap.png) |

## How to update this document

1. Per product, the GPU run on GitHub Actions leaves `spikes/garment-engine/out/phase0/<handle>/` (stage1b/, stage2/, stage4/stage2/garment.glb, cost_summary.json). Download the artifact into that folder.
2. `pnpm build:packages && pnpm --filter @curtain/garment-spike report:bohohippychic -- --renders` evaluates every product that has a stage 4 mesh, writes the bundles to `out/eval/<handle>/`, renders sizes 8, 12 and 16 on the M mannequin (front, three-quarter and side) and the XS and XXL shapes with and without the fit map, compares the mesh with the stage 2 turntable at 0°, 90° and 180°, and rewrites this file. The hand-written part comes from `spikes/garment-engine/data/bohohippychic/phase0-written.md`.
3. Run the blind tests with five people on the blind page above, export the CSV, and record the result in `docs/STATUS.md` with the run ids.
