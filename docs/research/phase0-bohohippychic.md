# Phase 0 on bohohippychic.com.au (generated)

Generated 2026-11-07 by `pnpm --filter @curtain/garment-spike report:bohohippychic` (`spikes/garment-engine/scripts/report-bohohippychic.ts`). Do not edit by hand: re-run it after every GPU run. Renders and bundles live under `spikes/garment-engine/out/`, which is gitignored: the links to them below resolve only in a checkout where the GPU outputs are in `out/phase0/` and this script has run with `-- --renders`; elsewhere they are attached separately.

Boho Hippy Chic gave the founder consent to use its public product data and photos for this internal validation, before anything is installed on its site. Selection, AU chart and photo classification: `spikes/garment-engine/data/bohohippychic/` and `docs/research/au-size-chart.md`. Everything below that comes from a model is an estimate (AGENTS.md rule 3).

## Summary

| Product | Category | Back photo | Stage 1b | Stage 2 | Stage 4 | Chart agreement | View IoU front / back | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `azure-palm-baby-doll-dress` | dress | real | done | done | done | pass (before 0.73 cm, after 0.00 cm) | 0.89 / 0.94 | $1.66–$1.71 |
| `rosewater-blouse` (run 15 rejected on review) | top | real | failed | done | done | FAIL (before 10.85 cm, after 6.65 cm) | 0.50 / 0.69 | $1.64–$1.70 |
| `rosewater-palazzo-pants` (run 15 rejected on review) | bottom | real | failed | not run | not run | not measured | — | $0.03–$0.07 |
| `crimson-wildflower-maxi-skirt` (run 15 faulty, evaluation only on review) | bottom | real | failed | done | done | FAIL (before — cm, after — cm) | 0.89 / 0.89 | $1.68–$1.74 |
| `woodstock-wanderer-knit-cardi` (run 15 rejected on review) | outerwear | real | failed | done | done | FAIL (before — cm, after — cm) | 0.49 / 0.29 | $1.65–$1.70 |

## Phase 0 acceptance

| Item | State | Evidence |
| --- | --- | --- |
| Size test | needs people | Five people who did not build it must pick the smaller size, without labels, in at least 4 of 5 products on the blind page (size mode). Bundles for the test: 1 of 5 products (3 more evaluated but kept off the panel on review: rosewater-blouse rejected, crimson-wildflower-maxi-skirt faulty, woodstock-wanderer-knit-cardi rejected); renders made for 2. Not run with people yet. **Do not run the panel on these assets yet:** Only 1 of 5 products has a panel bundle after run 15 (the azure babydoll; the crimson maxi skirt is kept for evaluation only, marked faulty on review; the blouse and the cardigan were rejected on review, the palazzo stopped before stage 2), the dress still shows the torso at the back of the shoulder in AU 8 from the side, and the skirt is narrower than the mannequin at the hip in its stage 1b stills, so the asset is open at both hips (the grey hip shows from the front and a wedge to mid-thigh from the three-quarter view) and has no measurable waist or hip girth; see the run 15 section and the verdict below. (`spikes/garment-engine/data/bohohippychic/panel-hold.txt`) |
| Fabric test | needs people | Same five people, fabric mode of the same page (linen versus silk of the same garment). Not run with people yet. **Do not run the panel on these assets yet:** Only 1 of 5 products has a panel bundle after run 15 (the azure babydoll; the crimson maxi skirt is kept for evaluation only, marked faulty on review; the blouse and the cardigan were rejected on review, the palazzo stopped before stage 2), the dress still shows the torso at the back of the shoulder in AU 8 from the side, and the skirt is narrower than the mannequin at the hip in its stage 1b stills, so the asset is open at both hips (the grey hip shows from the front and a wedge to mid-thigh from the three-quarter view) and has no measurable waist or hip girth; see the run 15 section and the verdict below. (`spikes/garment-engine/data/bohohippychic/panel-hold.txt`) |
| Chart agreement | not yet measurable | 1 of 4 evaluated products within ±2 cm at their critical anchors after calibration (1 without a stage 4 mesh); 4 of 5 needed. After per-ring calibration this is close to 0 by construction, so also read the error before calibration: azure-palm-baby-doll-dress at chest: max \|error\| 0.73 cm before calibration, 0.00 cm after the global scale, 0 by construction with one critical anchor, 0.00 cm after calibration; rosewater-blouse at chest: max \|error\| 10.85 cm before calibration, 0.00 cm after the global scale, 0 by construction with one critical anchor, 6.65 cm after calibration; crimson-wildflower-maxi-skirt at waist: no girth at waist (its cloth does not reach the ring; on its own waistband no closed tape, an opening of 5.81 cm; bridged 94.23 cm against the chart's 80.50); woodstock-wanderer-knit-cardi at chest: no girth at chest. |
| View agreement | needs people | The merchant must confirm that the front and back renders are recognisably their garment. IoU against the pinned stills (visible with the mannequin in front / garment silhouette alone): azure-palm-baby-doll-dress front 0.89 / 0.89, back 0.94 / 0.94; rosewater-blouse front 0.50 / 0.46, back 0.69 / 0.80; crimson-wildflower-maxi-skirt front 0.89 / 0.85, back 0.89 / 0.89; woodstock-wanderer-knit-cardi front 0.49 / 0.56, back 0.29 / 0.51. Every pinned still on this set comes from stage 1b (generated from photos on a model), so a high IoU says stages 2–4 kept what stage 1b drew, not that stage 1b drew the shop's garment. |
| Cost | met | Measured for 5 of 5 products (GPU seconds and wall time measured; dollars are list-price estimates until the Modal invoice is read): azure-palm-baby-doll-dress 1576 s GPU, 2271 s wall, $1.66–$1.71; rosewater-blouse 1544 s GPU, 2246 s wall, $1.64–$1.70; rosewater-palazzo-pants 31 s GPU, 100 s wall, $0.03–$0.07; crimson-wildflower-maxi-skirt 1581 s GPU, 2232 s wall, $1.68–$1.74; woodstock-wanderer-knit-cardi 1564 s GPU, 2331 s wall, $1.65–$1.70. |
| Write-up | not met | This document covers the per-product results. Chosen models and licences are in docs/research/garment-engine.md; failures and the tolerances to use from Phase 1 can only be set once the GPU runs above exist. |

Blind test page with these products pre-selected: `http://127.0.0.1:5178/blind.html?products=eval/azure-palm-baby-doll-dress` (viewer dev server, `pnpm --filter @curtain/garment-spike viewer`). It needs the bundles in `out/eval/`, so run the report with GPU outputs first. Not for the panel yet (see the size test row). Screenshot: [blind page](../../spikes/garment-engine/out/eval/blind-size-pair-1.png).

## Runs 10–15 timeline

Six GPU runs on Modal (GitHub Actions): the spike's synthetic shirt dress `aalter-studio-2` (runs 10, 11), the shop's `azure-palm-baby-doll-dress` (runs 12–14), and all five shop products (run 15). Costs are the runs' own `cost_summary.json` records: GPU seconds measured, dollars list price × GPU seconds (estimates, GPU only; no Modal invoice read yet). Details per run are in `spikes/garment-engine/modal/README.md` ("after run N" sections).

| Run | Product, job | What it tested | What we saw | What changed after it | GPU s | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | `aalter-studio-2`, synthetic stills, export 0.1.0 (bare-mannequin control) | First end-to-end stage 2 (Wan2.2-Fun-A14B-Control, 40 steps) + stage 4 (gsplat 2DGS + TSDF) on Modal | The dress turned into trousers between the pinned frames (frames 20, 60, 100), and the product name appeared as text in frame 20. Stage 4 mask IoU 0.90 on the generated frames against 0.99 on the synthetic frames | Export 0.2.0: a closed garment proxy in the control video, neutral prompts without title or brand, consistency metric v1 | 1661 | $1.70–1.76 |
| 11 (11a) | `aalter-studio-2`, export 0.2.0 (proxy control) | The proxy control | The dress stayed a dress in every turntable frame, no text. But consistency v1 flagged 233 of 243 frames (a cream dress on a light-grey studio: v1 lost its light parts), stage 4 trained on a poor foreground target (mask IoU 0.83 / 0.84), and every motion frame had artefacts | Garment segmentation of the generated frames, consistency v2 and v3, stage 4 trains on garment masks, export 0.3.0 (bare masks, no still pinned in the motion clip) | 1775 | $1.79–1.82 |
| 12 | `azure-palm-baby-doll-dress`, export 0.2.0, FASHN maskless on the bare mannequin, `--accept-failed-dress` | First shop product: dressing stills from photos on a model (stage 1b) | FASHN transferred the print and the puffed sleeves, but drew a romper (two legs of fabric, open front), and the back still was a second front. Stage 2 copied that faithfully. Stage 4 mask IoU 0.97 was against foreground masks (garment + mannequin), not comparable with run 14 | Export 0.4.0: the stills are generated on the proxy-dressed mannequin, FASHN masked with our label map, a Qwen engine, QA v2 (leg gap, skirt cover, true back) | 1531 | $1.62–1.73 |
| 13 | same product, export 0.4.0, stage 1b only, FASHN and Qwen | Both dressing engines on the proxy-dressed target | FASHN: the right garment on both views (knee-length babydoll, the shop's pastel print on cream, puffed sleeves, tiered skirt), shorter and narrower than the proxy. Qwen: a solid blue dress, because the prompt took "blue" from the product name "Azure". QA 0.3.0 failed every still; its score ranked Qwen's blue front best | Export 0.5.0 takes the colour from the photo's pixels, QA 0.4.0–0.5.0 adds print fidelity, a leg gap counted only above the garment's own hem and a silhouette tolerance band, and picks the engine (on run 13's stills: FASHN on both views) | 189 | $0.21–0.58 |
| 14 | same product, job `azure-palm-baby-doll-dress-6d2f2611a144` (export 0.4.0), FASHN only, `--accept-failed-dress` | The whole chain on a shop product: stage 1b → stage 2 with the proxy control → stage 4 on garment masks | Stills: FASHN's babydoll again; QA 0.3.0 failed them on the old silhouette IoU (0.835 / 0.828 < 0.85) and 6 leg-gap rows on the front (QA 0.4.0 replaced that IoU by a tolerance band and counts leg-gap rows only above the hem; run 14's stills were not re-scored with it). Stage 2: the turntable keeps the print, the puffed sleeves, the waist tie and the tiered skirt in every view; consistency 0.3.0 flagged 31 of 243 frames (turntable_a 35–37 and 43–45, turntable_b 34–47, all side views, and 70–72; motion 73–80), 0 artefact frames. The prompt still said "a blue … dress" (export 0.4.0 predates the colour fix); the pinned stills carried the print anyway. Stage 4: mask IoU 0.925 train / 0.917 holdout, 11,999 triangles. The evaluation below | This write-up: the evaluation tooling fixed on the first real mesh (next section) | 1493 | $1.57–1.63 |
| 15 | all five shop products, export 0.6.0 (proxy 0.3.0, prompts 0.3.0, stage 1b QA 0.6.1), GitHub Actions run 42402554810, code at 91ed5b2, `--accept-failed-dress` | Every category: dress, blouse, trousers, skirt, cardigan | Azure babydoll (`de3bc1eeb3e0`): stage 1b passed, stills and frames right (puff sleeves, print, babydoll, hem higher than run 14). Maxi skirt (`9a2b6e7f37ce`): stage 1b failed the front on the provisional silhouette score (0.864, overridden); waistband and print right, but at the hips the stills are narrower than the mannequin and the frames open into a slit at the side (the founder: "see the hips"). Blouse (`129498b959df`): FASHN stills torn (print patches with the mannequin through them, the back a pale blotchy shirt), stage 2 frames with black panels on the back and side. Cardigan (`56e306f6033b`): front a shrunken bolero, back a white sleeveless top with holes, frames with black and grey halves and a changing garment. Palazzo (`b85affd79b61`): FASHN drew a closed skirt in both views (legs merged in 259 of 259 rows); the type gate (QA 0.6.1) stopped it before stage 2. Blouse and cardigan reached stage 2 because `--accept-failed-dress` overrides the silhouette and fidelity failures (3,108 GPU s, $3.29–3.40 spent on two rejected products) | This section: stage 4t, the drape log and the evaluation on the two good products; the hem scan past openings, the waistband girth and the viewer's waistband pins for the skirt; blouse, palazzo and cardigan marked rejected in `review.json`. After the run, drape-prior P0 (D15 ease fix) changed the blouse, skirt and cardigan proxies by 1–2 cm, so their current exports are not run 15's controls | 6295 | $6.66–6.93 |
| **Total** | | | | | **12943** | **$13.55–14.45** |

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

## Template fit (stage 4t 0.3.0, 7 Nov 2026): the proxy deformed to the masks instead of the 2DGS mesh

Stage 4t (`src/templateFit.ts`, `src/bake.ts`, `src/stage4t.ts`, `scripts/stage4t.ts`; CPU, no GPU, no learned model) replaces run 14's 2DGS mesh as the evaluated asset. The control proxy (`control/proxy.glb`) is remeshed into a body tube and one tube per sleeve, each sleeve tube starting with a shoulder cap (see "Shoulder tops and sleeves" below); every vertex moves only along a fixed ray, inside [mannequin + 4 mm, the next body part] (signed distance to `mannequin.glb`), to the visual hull of 128 of the 160 stage 2 garment masks (every frame with index mod 5 = 2 held out), smoothed by a Laplacian on the radial offsets, then 6 silhouette rounds. The hem and the cuffs are found per column on the masks. Before carving, each mask is cleaned in garment units (pixels per cm from the camera's focal length and its distance to the body axis: 3.57 px/cm on run 14): interior holes up to 12 cm² are filled as noise, so the smallest opening the fit can carve is about 3.5 × 3.5 cm; a 10 × 5 cm keyhole (about 640 px at 480 × 832) stays open (a test renders one at 480 × 832 and at half that). Run 14's fit was the same with this clean-up as with the earlier 600 px threshold (11,227 triangles in 0.2.0, the same rays and IoU). The bodice may not run into a fitted sleeve: between the A-pose arm and the torso no view can carve (the front views see the sleeve there, the side views the arm), and without that rule the bodice spread to the arms (chest 121.5 cm by the tape; 101.5 cm with it in 0.2.0, 101.1 cm in 0.3.0, 200 body rays ended at a sleeve). After the solve every vertex whose exact distance to `mannequin.glb`'s triangles is below 4 mm moves out along its ray (the grid SDF reads a few tenths of a millimetre optimistic, most in the crease between arm cap and torso where the shoulder caps land: 63 vertices on run 14, 66 on the synthetic dress); the closest vertex is now 4.0 mm away on both (0.2.0: 3.7 and 3.6 mm). A vertex that ended inside the mannequin would be moved out by its depth plus the 4 mm (none did on either garment; a unit test places one 3 cm inside). The print is then baked by projection from the same 128 frames into a 2048² atlas (best-facing views blended, 3 px kept off the mask edge, outliers more than 90 (sum of |ΔRGB|) from the blend dropped: 2.9 % of the samples), JPEG quality 88, embedded in a textured `garment.glb`. Run time on this 4-core build machine at 0.3.0 (7 Nov): 86 s for run 14 (fit 33 s, bake 38 s; the synthetic dress 88 s). With the current code (the run 15 re-run, `metrics.json` `timingsMs`): run 14 99.2 s (fit 40.5 s, bake 40.0 s), azure run 15 97.0 s, the skirt 86.5 s.

**Synthetic shirt dress with ground truth** (`aalter-studio-2`, export with `--synthetic-photos`, 160 frames at 480 × 832): Chamfer distance to `garment_truth.glb` **0.443 cm** (0.2.0 without shoulder caps: 0.437; 2DGS on the same garment: 1.45 cm), F-score 0.956 at 1 cm and 0.984 at 2 cm; 0 of 6,120 vertices inside the mannequin (closest 4.0 mm from `mannequin.glb`, exact distance); holdout IoU visible 0.981 (min 0.977), silhouette 0.977 (min 0.961); 11,880 triangles; hem found at 26.96 cm (truth 26.6), cuff 57.0 cm along the arm (truth 57.3). Its baked texture scores worse than one mean colour on the held-out frames (MAE 34.3 against 29.4): the synthetic frames are lit by a head light that moves with the camera, so no single texture can match every view; on the generated frames (studio light fixed) the texture wins.

**Caveat on that number, and the check that answers it.** This product's template (`control/proxy.glb`) is built from the same garment spec as `garment_truth.glb`, so the unfitted template already lies 0.57 cm (Chamfer, 50,000 samples per surface) from the truth: 0.443 cm after the fit says little on its own. `scripts/stage4t-perturbed.ts` (`stage4t:perturbed`, `stage4t/synthetic/perturbed.json`) therefore fits the same 128 training masks from templates that are not the garment, and reports the Chamfer before (the template itself) and after the fit, overall and per region (shoulders above the chest ring, bodice from the waist to the chest, skirt below the waist, sleeves more than 2 cm outside the torso):

| Template | Chamfer before → after | Before: shoulders / bodice / skirt / sleeves | After: shoulders / bodice / skirt / sleeves |
| --- | --- | --- | --- |
| exported proxy (same spec as the truth) | 0.567 → 0.443 cm | 0.60 / 0.40 / 0.63 / 0.29 | 0.82 / 0.44 / 0.34 / 0.57 |
| 8 % wider, hem 8 cm higher, sleeves 10 % wider and 15 % shorter | 1.555 → 0.442 cm | 1.14 / 0.85 / 1.97 / 0.54 | 0.82 / 0.44 / 0.34 / 0.58 |
| 6 % narrower, hem 8 cm lower, sleeves 10 % wider and 10 % longer | 1.548 → 0.443 cm | 1.08 / 1.07 / 1.87 / 0.68 | 0.82 / 0.44 / 0.34 / 0.57 |
| another product's proxy: `linde-dress-01` (knee-length sheath, 20 cm sleeves) | 3.111 → 0.443 cm | 0.81 / 0.91 / 4.24 / 1.96 | 0.82 / 0.44 / 0.34 / 0.57 |

From all four the fit lands on the same surface (Chamfer 0.442–0.443 cm, F-score 0.956 at 1 cm, holdout silhouette IoU 0.977; per region within 0.003 cm; 0.2.0: 0.437 cm, shoulders 0.807, bodice 0.421, skirt 0.333, sleeves 0.577): on this dress every ray has mask evidence, so the template decides nothing and the result does not depend on starting near the truth. The table also shows where silhouettes fall short: the shoulders (0.82 cm) and the sleeves (0.58 cm) end up further from the truth than the correct template was (0.60, 0.29 cm): the visual hull cannot see the hollow under the arm or the slope of the shoulder, and the fit replaces a right template there with the hull. The bodice and the skirt are recovered from any start. This is still a synthetic garment rendered with our own cameras and exact masks; on run 14 the masks come from a generated video and the template (proxy vs generated babydoll) differs from the garment in ways this table does not cover (a tiered skirt, puffed sleeves).

**Run 14, before (2DGS, stage 4) and after (template fit, stage 4t 0.3.0)**, both through the same evaluation (`report:bohohippychic`); 0.2.0 (no shoulder caps, commit af11afa) in brackets where it differs:

| Metric | 2DGS (stage 4) | Template fit (stage 4t) |
| --- | --- | --- |
| Vertices inside the mannequin | 21.9 % more than 3 mm inside the analytic mannequin; 26.2 % (1,601 of 6,106) inside `mannequin.glb` by the grid SDF's sign (the method decides the figure) | 0 of 5,778 by both. Closest vertex 4.0 mm from `mannequin.glb` (exact point-to-triangle distance), none below 4 mm (0.2.0: closest 3.70 mm, 72 vertices between 3.70 and 4.0 mm: the grid SDF reads up to 0.3 mm optimistic; 0.3.0 checks the exact distance after the solve) |
| Turntable IoU visible / silhouette at 0° | 0.653 / 0.931 | 0.902 / 0.902 (0.904 / 0.904) |
| at 90° | 0.761 / 0.834 | 0.920 / 0.861 (0.920 / 0.860) |
| at 180° | 0.669 / 0.931 | 0.930 / 0.927 (0.935 / 0.931) |
| All 160 frames, visible IoU mean (min) | train 0.696, holdout 0.697 (0.639) | train 0.901 (0.863), holdout 0.901 (0.872) (0.906 / 0.906) |
| All 160 frames, silhouette IoU mean (min) | train 0.898, holdout 0.900 (0.781); 2DGS's own mask IoU 0.925 train / 0.917 holdout | train 0.883 (0.788), holdout 0.884 (0.811) (0.885 / 0.887) |
| Pinned stills, visible IoU front / back | 0.713 / 0.751 | 0.904 / 0.933 (0.909 / 0.937) |
| Shop photos, normalised IoU front / back (indicative) | 0.60 / 0.56 | 0.74 / 0.67 (0.75 / 0.67) |
| Chest by the tape (chart 102 cm at AU 12) | 99.0 cm: −2.98 before calibration, global scale 1.030, −0.71 after | 101.1 cm: −0.86 before calibration, global scale 1.009, 0.00 after (101.5 cm, −0.50, 1.005) |
| Waist / hip, not fitted by the empire block (before calibration) | +1.03 / −3.51 cm | +7.00 / +4.38 cm (+6.38 / +4.54) |
| Graded chest − printed, AU 8 / 10 / 12 / 14 / 16 | −2.71 / −1.71 / −0.71 / +0.29 / −0.71 cm | −2.00 / −1.00 / 0.00 / +1.00 / 0.00 cm |
| Shoulder to hem: vertical drop / flat-lay (printed 91 cm) | 83.3 / 86.6 cm | 84.4 / 92.7 cm (84.4 / 92.6) |
| Mesh | 11,999 triangles, 2 components, 869 boundary edges, ragged hem | 11,216 triangles, 3 components (body + 2 sleeves, each sleeve with its shoulder cap overlapping the bodice; not stitched), 348 boundary edges in 10 loops, 0 non-manifold edges, not watertight (open by design at neckline, hem, cuffs, underarms, and a pin-sized opening at each cap's pole under the bodice) (0.2.0: 11,227 triangles, 337 edges in 8 loops) |
| Colour | one mean colour #B9AFA3 in the bundle | baked texture: holdout MAE 21.0 against 24.3 for one mean colour (8 × 8 blocks: 13.3 against 18.3), unchanged; 93.3 % of the atlas's chart texels sampled from frames (95.9 %), the rest filled from neighbours; of the shoulder caps' texels (within 6 cm of either cap top) 48.8 %: the rest of the cap's print is synthesized fill, and the holdout check, which compares inside the garment masks, does not see the cap at all |
| Size | 255 KB bundle | `garment.glb` 724 KB (JPEG 408 KB), bundle 765 KB (budget 3 MB) (716 / 756 KB) |

Both IoU rows of all 160 frames come from the same projection (`scripts/stage4t-compare.ts`, `stage4t/stage2/compare.json`, for 0.2.0; `stage4t/stage2/metrics.json` for 0.3.0). **The outline matches the masks slightly worse than 2DGS did** (holdout silhouette 0.900 → 0.884, at 0° 0.931 → 0.902), while what a viewer sees matches far better (holdout visible 0.697 → 0.901), because the mannequin no longer shows through the cloth. The worst holdout frame improved (silhouette min 0.781 → 0.811). The silhouette IoU without the mannequin is lower than the visible one at the side views (0.86 at 90°, 0.81 at the worst frame): the masks are of the *visible* garment, and from the side the arm hides the bodice that the garment-only render shows. The waist and hip are larger than the 2DGS mesh's: the 2DGS surface lay partly inside the mannequin there, and the template's skirt follows the masks' flare; neither is calibrated for an empire dress.

**Shoulder tops and sleeves (stage 4t 0.3.0 and the viewer, 7 Nov).** Two faults of 0.2.0, each traced to its cause before fixing it.

*Bare shoulder tops.* Three causes stacked. (1) The evidence: the shop product gives no sleeve length, so its control proxy has no sleeve shell and ends at the shoulder line, and the v0 mannequin's arm cap stands out above it; the generated video follows the control and leaves a grey cap at the outer shoulder top, in the pinned stills and in every turntable frame, although the shop's dress has set-in puff sleeves (the shop photo and the stage 1b still both show them). The masks call that cap "not garment" and carved it. (2) The rays: body rays are horizontal and sleeve rays square to the arm, so over the cap both run parallel to the cloth; body rays there pass through the arm cap and are blocked (the armhole), sleeve rays start at the shoulder joint, and nothing covered the cap's top and its side towards the neck. (3) The two tubes were not joined there.

Fix in geometry (`templateFit.ts`, `SHOULDER_CAP`): each sleeve tube starts with 6 cap rows whose rays fan out from the shoulder joint, tilted from square-to-the-arm (the sleeve's first row) up to 88° towards the shoulder, close to the shoulder's normal, continuous with the sleeve grid and overlapping the bodice at the top. Fix in the evidence (`CONTROL_CAP`), limited to the known artefact: stage 4t reads the control render each frame was generated from (`control/mask`, `control/proxy_mask`), and on the sleeve head (the cap rows and the sleeve down to the upper-arm ring) leaves out a frame's non-garment pixels only where that frame's control shows the bare mannequin on our arm's cap (the arm from its pole down to the armpit, 7.25 cm along it), grown by the clearance plus 0.3 cm (3 px on run 14) and never over the control's proxy. The 0.3 cm is measured: on run 14's 128 training frames the generated cap's outline matches ours within a pixel (background inside our bare cap on 3.6 % of its 1 px rim, 0.1 % at 2 px). In that zone a mannequin pixel does not carve the hull and neither it nor background counts in the presence vote; the vote on a head ray whose hull is empty is taken at the clearance, where the zone is drawn, and a head point left without 4 informative views by the control is kept at the clearance (35 rays on run 14, 2 of them cap rows). Outside the zone, on frames without a control (the synthetic renders, `controlCap.views` 0) and wherever the control shows the proxy, mannequin and background carve the head like any other ray. So a cold-shoulder or off-shoulder dress with sleeves is found where its control covers the cap (a proxy with sleeves), and is not where the control leaves the cap bare: those frames hold no evidence of it. Tests (`templateFit.test.ts`, masks from the synthetic dress with its cloth over the left cap cut away, which are the same masks a cold-shoulder dress gives): with a sleeveless control (`buildProxy` without the sleeve length) the fit covers the cap (0 % of it bare seen from above and from up-and-out); without a control 99 % stays bare, with a control from the sleeved proxy 93 % (that proxy still leaves a sliver of the cap bare in the control: 7 head rays decided by it). The 0.3.0 draft before this review kept every sleeve head regardless of the frames (`present = blocked || empty && !head`), and so also covered the synthetic dress's cap where its own masks show the mannequin (the synthetic garment lies inside the v0 cap at its top: 45 % of the cap disc shows the mannequin in its renders); that version is gone. On the synthetic dress (no control) the shoulder region's Chamfer is 0.82 cm (0.2.0: 0.81; fit → truth 0.63 → 0.63 cm, truth → fit 0.99 → 1.01 cm), overall 0.443 cm (0.437); the cap rows change little there, and the per-region error remains the hull's limit. On run 14 the result is the same mesh as that draft (11,216 triangles, the same holdout IoU), now for the control's reason.

Texture on the cap: the bake samples only inside the garment masks, so the cap never takes the mannequin's grey, but the frames show the bare cap there. Of the 126 render vertices within 6 cm of the two cap tops (the highest point of each arm's section at the joint), 36 (29 %) are seen as garment by at least 3 unoccluded training views and by at least as many as see them bare, 86 (68 %) are seen bare by most views (28, 22 %, only bare) and 2 by none; by texel, 48.8 % of the caps' atlas texels are sampled from a frame (`metrics.json` `bake.capTexture`) and the rest is filled from the neighbouring print. The holdout photometric check compares inside the garment masks and cannot judge the cap: **the cap's print is mostly synthesized fill**, and at 270° it reads as a pale wedge. Side effects on run 14: the cap rows take part of the triangle budget (65 body rows instead of 66) and fewer body rays end at a sleeve (200 instead of 221), so the chest by the tape is 101.1 cm (101.5; −0.86 cm before calibration, within ±2); the holdout IoU drops 0.005 (visible 0.906 → 0.901, silhouette 0.887 → 0.884) because the cloth now covers the cap where the frames show the mannequin.

*Sleeves drooping in the viewer.* Measured with the viewer's own drape in node (M mannequin, product fabric, `relax()` to the 1.5 s cap), on free (unpinned) sleeve particles only, left / right sleeve. With 0.2.0's mesh and the old pins (only the particles above the yoke height, the top of the sleeve head) in AU 12: the free particles' centroid dropped 1.44 / 1.32 cm, the 2 cm cuff band fell 1.7 / 2.2 cm and the right cuff opened from 4.9 to 6.9 cm radius. Not the material: a viscose bend stiffness of 0.3 or 1.0 instead of 0.04, twice the solver iterations or a stiffer stretch changed the sleeve's movement by at most 0.2 cm. The new geometry alone (0.3.0 mesh, old pins: its cap rows lie above the yoke and are pinned, 28.5 / 31.3 % of each sleeve) changed little: centroid drop 1.44 / 1.15 cm, cuff drop 1.6 / 2.0 cm, right cuff 5.5 → 6.9 cm. The pins do the rest (`viewer/src/engine.ts`): every sleeve piece is pinned all round its head down to the armpit (the armhole seam line; 30.0 / 32.9 % of each sleeve), and a gathered cuff (within 2 cm of the arm and narrower than 0.8 of the sleeve's widest section, decided on the base-size mesh so every size holds the same particles) is held on a 0.5 cm leash round its placed position (`CUFF_LEASH_CM`), as an elastic grips the forearm; a wide cuff stays free (unit tests on a synthetic tube and on the leash). A hard pin on the cuff was measured first and dropped: it held the cuff exactly but raised the sleeves' own p99 edge strain in AU 12 from 7.4 / 9.1 % to 16.7 / 10.5 %, the stretch landing just above the fixed ring; free, the cuff fell as above; on a 0.5 cm leash the sleeves' p99 is 7.6 / 7.2 %.

| AU on M, 0.3.0 mesh | Free centroid drop L / R | Free particles' mean move L / R | Cuff band drop L / R, right cuff radius | Gap to the arm, free particles (start → end) L / R | Edge strain p99 / max (all pieces) |
| --- | --- | --- | --- | --- | --- |
| 8, old pins | 1.74 / 1.45 cm | 2.50 / 1.94 cm | 1.57 / 2.29 cm, 5.2 → 6.4 cm | 2.47 → 2.61 / 2.17 → 2.14 cm | 10.7 / 28.2 % |
| 8, new pins + leash | 1.27 / 0.74 cm | 2.09 / 1.33 cm | 0.35 / 0.42 cm, 5.2 → 5.3 cm | 2.40 → 2.42 / 2.13 → 2.05 cm | 11.7 / **42.0 %** |
| 12, old pins | 1.44 / 1.15 cm | 2.64 / 1.93 cm | 1.57 / 2.04 cm, 5.5 → 6.9 cm | 2.85 → 2.86 / 2.52 → 2.42 cm | 8.0 / 26.0 % |
| 12, new pins + leash | 1.14 / 0.88 cm | 2.11 / 1.53 cm | 0.27 / 0.42 cm, 5.5 → 5.6 cm | 2.79 → 2.88 / 2.51 → 2.37 cm | 7.8 / 26.0 % |
| 16, old pins | 2.75 / 2.45 cm | 3.31 / 2.86 cm | 3.22 / 3.33 cm, 5.8 → 7.9 cm | 3.23 → 3.40 / 2.89 → 2.92 cm | 8.3 / 24.9 % |
| 16, new pins + leash | 2.40 / 2.13 cm | 2.79 / 2.44 cm | 0.33 / 0.34 cm, 5.8 → 5.8 cm | 3.20 → 3.39 / 2.88 → 2.88 cm | 8.4 / 28.3 % |

The free part of the puff keeps its standoff from the arm (2.4–3.4 cm, as placed) in every size, and its centroid drops 0.7–2.4 cm: the top of the puff settles towards the arm; nothing in this solver holds gathered volume. The AU 12 maximum (26.0 %) is at the bodice hem, the same edge as with the old pins; the AU 16 maximum (28.3 %) on a free sleeve edge near the elbow. **AU 8's maximum of 42.0 % sits on edges between two pinned particles at the top of the left cap** (31 and 30 % on the next ones, both caps): grading scales the shoulder cloth about the body axis and pulled the size-8 cap into the arm cap, which the collider never tests (body particles meet the torso only, sleeve particles the arm below the armpit only); the viewer lifts particles of a sleeve piece that carries a shoulder cap out of the upper half of the arm cap before and while the pins settle (`armCapLifter`; only cloth that the base garment has outside the cap; the synthetic garments' set-in sleeves start at the joint and are left alone, their small-size neckline test stays green), and the size-8 cap ring stretched over the unmorphed arm cap stays stretched because it is pinned. Without the lifter AU 8's maximum is 28.7 % but the grey cap shows through the shoulder; we keep the lift and report the strain.

**The length (83.3 vs 91 cm).** The shop prints "Length" per size (90, 90, 91, 92, 93 cm for AU 8–16) and does not say how it is measured; a garment table's length is normally a flat-lay measure from the high point shoulder (HPS) to the hem, i.e. along the garment, not a vertical drop on a body. The definitions on the meshes (`src/garmentLength.ts`): the vertical drop is 83.3 cm (2DGS) and 84.4 cm (stage 4t), the flat-lay length along the front 86.6 and 92.6 cm, the back length 83.2 and 81.6 cm. Only the flat-lay reading comes near 91 cm; the two meshes have the same hem height (the masks', 53–57 cm above the floor) and differ in flat-lay length by 6 cm because the path from the HPS depends on the neckline and the bust surface (the stage 4t neckline starts 5.5 cm below the HPS and is bridged straight). So most of the −7.7 cm was the definition, and the evaluation now compares the printed length with the flat-lay length (`printedLength: 'flat-lay'` for shop products, the vertical drop for the spike's synthetic garment, which is built that way). The other half of the finding is the control: proxy 0.1.0 dropped 91 cm vertically, so run 14's control video put the hem at the knee (47.6 cm, flat-lay 100.6 cm), about 8 cm lower than the dress the stills and the video drew. Proxy 0.2.0 ends the hem where the proxy's own front is 91 cm long (57.3 cm above the floor, drop 81.3 cm), which matches the generated hem within 2–4 cm; the prompt word becomes "above-knee" (it was "knee-length"). Runs after 14 use proxy 0.2.0; run 14 was not re-run.

**What the stage 4t asset looks like (every render looked at, compared side by side with the 2DGS renders in `out/eval/azure-palm-baby-doll-dress-2dgs/renders/` and with 0.2.0 in `out/eval/azure-palm-baby-doll-dress/compare/*-before-after.png`).**

- **Against the frames** (`view/turntable_*.png`, `stage4t/stage2/preview/`): the same dress, closed everywhere, with the print recognisable (the palms, the pink buildings, the blue and peach patches in the same places), softer than the frames. The hem is one clean wavy line; a thin broken line of darker and lighter texels runs along it (the shaded underside of the hem in the frames). The overlay is grey almost everywhere: red (frame only) along the V neckline and at the hem corners where the tier swings out; blue (mesh only) a band at the centre-front hem and now the outer shoulder tops, where the frames show the mannequin's cap and the mesh has cloth (0.3.0). At 45° and 90° (`compare/turntable-45-90-before-after.png`) the shoulders are closed and carry the print continued from the sleeve and bodice.
- **In the viewer, plain, M mannequin, AU 8 / 12 / 16, front, three-quarter and side:** no mannequin through the cloth in any size or view (the 2DGS asset showed it through the chest, waist and hip in every picture and ended in shreds at the hem). The print is visible but washed out by the viewer's light. The size difference is visible without labels: 16 is broader across the bodice and the skirt, 8 narrower. With 0.3.0 the **shoulder tops are closed** in AU 12 and 16 in every view and in AU 8 from the front and three-quarter (0.2.0: a grey wedge between the neckline and each sleeve in every size and view); from the side AU 8 still shows a smaller grey patch at the back of the shoulder next to the neck, the torso through a bodice graded inside it (the small-size collision exemption, see the viewer README). The **sleeves keep their shape**: a puff ending in the gathered cuff at the elbow in every size (0.2.0: wide elbow-length sleeves, the cuff fallen and open); the cuff now hangs on its 0.5 cm leash and looks the same as with the hard pin of the draft; the top of the puff sits closer to the arm than in the frames. The shoulders look the same as in the 0.3.0 draft (same mesh; grey pixels in the shoulder band within 0.1 % of it): `compare/*-before-after.png` stacks af11afa, the draft and now. Also visible: in AU 8 and AU 16 from the three-quarter view a small grey wedge at the back of the far shoulder next to the neck, and ragged texels along the cuff rims. Still wrong: from the side the dress hangs straight, the empire seam and the tie are only in the texture; the V neckline is wider in AU 8.
- **Fit map:** on M, 8 red at the chest, 12 light blue, 16 blue, as before, now on clean cloth. **XS shape:** every size has room (blue), 8 the least. **XXL shape:** red across the chest in every size, matching "nothing fits well; closest is 16"; the plain render still draws every size closed and barely strained, so without the fit map the XXL renders do not show that 8 cannot close (AU 8 shows a grey band across the upper chest, as in 0.2.0).
- **The synthetic dry run** (`aalter-studio-2`) renders as before.

## Run 15 (7 Nov 2026): two good products of five, evaluated with stage 4t

Run 15 put all five shop products through the chain at commit 91ed5b2. A person looked at every product's stills and frames (contact sheets: shop photo, stage 1b front and back, five stage 2 frames); `data/bohohippychic/review.json` records what they saw, and the report evaluates a rejected product (its numbers show the failure) without rendering it or putting it on the blind page; a faulty one is evaluated and rendered, so the fault can be seen, but kept off the blind page and out of the panel bundles. **Accepted:** the azure babydoll. **Faulty, for evaluation only:** the crimson maxi skirt (narrow at the hips, below). **Rejected:** the blouse (torn stills, black panels in the frames), the cardigan (a bolero in front, a sleeveless top at the back, black and grey halves in the frames), the palazzo (FASHN drew one closed skirt; stopped before stage 2). Their 2DGS meshes, evaluated anyway: blouse view IoU 0.50 / 0.69 against its own stills and chest −10.85 cm before calibration (global scale 1.115); cardigan 0.49 / 0.29 and no chest girth.

Stage 4t 0.3.0 (CPU, 82–92 s each) and the drape log (`stage4t/stage2/exemplar.json`, `shadow.json`) ran on both good products; run 15's jobs predate prediction.json, so P0 is predicted now (drape-prior-p0-0.2.0) and the skirt's P0 shape has today's waist (80.5 cm) where its run 15 control had 79.5 cm (the D15 ease fix; the log says so).

### What broke on the skirt, and the fixes (each traced to its cause)

1. **A slit cut up one side of the fitted skirt** (hem at 23–31 cm over 70–90° round the axis, 4 cm elsewhere). The generated frames show the mannequin's hip through a V-shaped opening at one side, from the waistband down to about mid-thigh (frames 22–38; stage 1b's front still already leaves a grey sliver at both hips, where FASHN's skirt is narrower than the mannequin: 34.75 / 35.59 cm against 37.55 cm at the hip, measured below). The hem scan (`templateFit.ts` `runEnd`) ended a column at the first gap longer than 2 cm: the column at 94° ended under the waistband (93.7 cm), five columns found no cloth within 25 cm of the waist, and the hem was interpolated between 8.7 cm and 93.7 cm across them. Now a gap of up to 40 cm followed by at least 5 cm of cloth is an opening, not the hem (`OPENING`; the opening itself is still carved by the per-vertex vote). Lowest cloth per 10° now 2.7–8.7 cm all round; holdout IoU visible 0.9045 → 0.9146, silhouette 0.8805 → 0.8834; the azure dress refitted to the identical mesh (10,983 triangles, same IoU). Test: `templateFitRunEnd.test.ts`.
2. **No waist girth.** The generated skirt is worn lower than our waist ring (104.16 cm) and tilted: its top edge is at 101.6 cm at the back and 93.4 cm at the front (a drawstring band that dips at the front), so the waist ring cuts no cloth. `src/waistband.ts` finds the band where it is (a plane through the highest cloth per 10°, sectors of an opening dropped, tilt 20.5°) and tapes 1.5 cm under it: the tape refuses there (the side opening is 5.81 cm at that height, above the 4 cm it bridges); with it bridged the band is 94.23 cm, +13.73 cm against the chart's 80.5 cm. Reported in the waist row, never calibrated on. A band below the waist lies on the body between the waist and the hip, so this says where FASHN put the skirt as much as how big it is: **the skirt's chart agreement is not measurable from this asset**, and it fails as "no girth at waist". The hip is not fitted by the a-line block, and has no girth anyway (on the 88 cm hip slice the openings are 9.78 cm at the left and 6.66 cm at the right; `src/bottomOpenings.ts`, below).
3. **The skirt slid down the legs in the viewer** (AU 8/12/16, every view: a V of bare legs at the front up to the hip). The viewer pinned a bottom's particles above a level line 4 cm under the highest point of the cloth, i.e. only the back of this band. Now `waistbandPins` pins the 4 cm under the band's own plane (`topEdgePlane`, shared with the evaluation); on a level band both pick the same particles. Test: `shopBundle.test.ts` (a synthetic skirt cut 0.4 cm per cm lower towards the front: the level line pins no front particle, the band pins them, the front top stays within 1 cm).
4. Smaller, in the drape log and the report: the hem girth slice started at the 75th percentile of the sector minima + 2 cm, and on this hem (two 40° arcs 4–5 cm higher) the cloth did not close there; it now moves up 1 cm at a time to the highest sector minimum + 2 cm (hem girth 110.27 cm; test in `drapeLog.test.ts`). The report showed shoulder-to-hem definitions for a skirt (135 cm), no waist-to-hem when nothing is printed, "chest" rows for a skirt and "0.00 cm before calibration" in the viewer when there was no girth at all; all four now follow the category.

### The skirt's hips ("see the hips"): measured, not repaired

The founder saw it first: at the hips the skirt is narrower than the mannequin. Measured at each stage (`src/bottomOpenings.ts`, in the report's skirt section; the frame numbers below are a one-off scan of the 160 stage 2 masks against our mannequin's bare render, not in the tooling):

- **Stage 1b stills (the cause).** On the hip row (87.36 cm) our mannequin is 37.55 cm wide in both views; FASHN's skirt is 34.75 cm wide in the front still and 35.59 cm in the back still, so our grey hip shows 1.68 / 1.12 cm outside the skirt on the two sides in front and 1.68 / 0.28 cm at the back; the same 1–2 cm from 95 cm down to 80 cm. A closed skirt worn on this mannequin cannot be narrower than it. FASHN drew the skirt on a slimmer body than ours (a parallel change on branch `claude/run16-prep`, not in this tree, traces it to FASHN's agnostic image for bottoms and answers it in stage 1b QA); the proxy (109 cm hip, the AU 12 chart + 5 cm ease) was wide enough.
- **Stage 2 frames.** The video turns the too-narrow skirt into a slit at both sides. At the mannequin's left (+x), seen in frames 12–60: open from the band down to 63.4–64.9 cm above the floor, up to 10.6 cm across (frame 40, 90°), i.e. 12 cm below the crotch (76.4 cm) and 16 cm above the knee. At the right (−x), frames 96–152: 2.8–8.4 cm across, down to 62.6–85 cm depending on the frame. Below that the two edges overlap and run as a dark crease to the hem (frames 20, 25, 130 looked at): from a distance it reads as a slit from hip to hem, but the masks and the pixels show cloth over the leg below about 64 cm. A pale strip at the right edge in frames 120–150 is pink cloth, not the leg.
- **Stage 4t mesh.** It keeps the cloth outside the body (0 of 6,250 vertices inside, 7 pushed out by the exact clearance, the cloth 0.37–1.09 cm off the body at its closest on each slice between 70 and 92 cm), so it reproduces the narrow stills as openings, carved where the masks show the mannequin: at the left from the band (92 cm, the top of the range the tool counts) down to 70 cm, up to 10.21 cm across at 82 cm; at the right from 92 down to 86 cm, up to 7.83 cm (that maximum is at 92 cm, the top of the counted range, so part of it may be the dip in the band rather than the slit; at the hip slice it is 6.66 cm). Nothing was filled from the template. The right opening is shorter than the frames' (86 against 63–85 cm): there it is narrower than the 4 cm the openings scan counts, and it is seen in fewer frames, so the per-vertex vote keeps more cloth.
- **Against the AU chart.** With the openings bridged (the tape across the gap at the neighbours' radius), the hip slice (88 cm) is 107.65 cm: −1.35 cm against the chart's AU 12 hip + ease (104 + 5 = 109 cm), +7.80 against our M mannequin's own 99.85 cm. So the 3D skirt is not too small at the hip and nowhere inside the mannequin: it is open. The hip still has **no girth** in the chart table (cloth on 89 % of the way round, the openings 9.78 and 6.66 cm), and the a-line block does not make the hip a fit point, so it is not a FAIL row; the waist, the skirt's one critical anchor, fails (below).
- **In the viewer:** the grey hip shows at both sides above the hip from the front in all three sizes, and from the three-quarter view a grey wedge runs from the band to about mid-thigh at the mannequin's left. That is the asset as measured. On the other canonical bodies it is worse: on XXL (116/98/122) the skirt's top sits at the hip in all three sizes, the grey hip shows above it and bulges out at both sides, AU 8, 12 and 16 look the same, and the fit map stays uncoloured although the body visibly sticks out; on XS (80/62/88) AU 12 and 16 look the same. Under "Fit at this size" the viewer prints the fit engine's chart gaps (e.g. "8: 6.4 cm tighter at the waist"); since this review those lines say "from the size chart only" where the 3D garment has no measured girth (`qa.chartAgreement.missing`), so they are not read as measured on the skirt shown. On the azure dress the XXL render shows AU 8 at −30.7 cm at the chest draped loose with no visible strain: the drape does not show a size that does not close (open issue).

### Measured (stage 4t, both through `report:bohohippychic`)

| | Azure babydoll, run 15 | Azure babydoll, run 14 (same tooling) | Crimson maxi skirt, run 15 |
| --- | --- | --- | --- |
| Stage 1b QA | pass (0.6.1) | FAIL front and back (0.3.0, overridden) | FAIL front (silhouette 0.864, provisional), back pass |
| Critical girth, before calibration | chest 101.27 cm against 102 (−0.73), global scale 1.0072 | chest 101.15 (−0.85) | waist: no girth (see above; waistband bridged 94.23 against 80.5) |
| Not fitted by the block (before calibration) | waist +3.75, hip +2.88 cm | | hip: no girth (open 9.78 cm at the left and 6.66 cm at the right on the 88 cm slice; bridged 107.65 cm, −1.35 against the chart's 109, +7.80 against the mannequin) |
| Length | flat-lay shoulder to hem 90.12 cm against the printed 91 (−0.88); vertical drop 81.64 | flat-lay 92.54 (run 14 table: 92.7) | waist to hem at the centre front 91.63 cm flat-lay; **the shop prints no skirt length** (`products.json`: no `lengthCm`, "No skirt prints measurements"), so nothing to check; outseam 65.27 cm, measured on the side with the opening (its top edge at 70.6 cm) |
| Hem above the floor | line (median per 10°) 57.35 cm, centre front 56.96 | 55.46, 54.18: **run 15's hem is 1.9 cm higher (2.8 at the centre front)** | line 4.16 cm, centre front 3.06: to the feet, as the shop photo's floor-length skirt |
| Graded against the printed table | chest −2.00 / −1.00 / 0.00 / +1.00 / 0.00 for AU 8–16; length −1.88 / −0.88 / −0.88 / −0.88 / −0.88 | | no printed table |
| Pinned stills, IoU visible / silhouette | front 0.889 / 0.886, back 0.938 / 0.935 | 0.904 / 0.933 (visible) | front 0.894 / 0.849, back 0.891 / 0.891 |
| Turntable 0° / 90° / 180°, visible / silhouette | 0.885 / 0.883, 0.929 / 0.860, 0.932 / 0.930 | | 0.892 / 0.854, 0.950 / 0.887, 0.904 / 0.904 |
| Holdout (32 frames never used), visible / silhouette | 0.9176 / 0.8986 | 0.9009 / 0.8841 | 0.9146 / 0.8834 |
| Shop photos (indicative) | 0.740 / 0.666 | | 0.838 / 0.823 |
| Clearance | 0 of 5,661 vertices inside, closest 4.0 mm | 0 of 5,778 | 0 of 6,250, closest 4.01 mm (by construction: stage 4t pushes cloth out of the body; the stills are 2.8 cm (front) and 1.96 cm (back) narrower than the mannequin at the hip, which the mesh turns into side openings) |
| 2DGS on the same video | 24.7 % of the cloth more than 3 mm inside the mannequin, chest 97.68 (−4.32), turntable visible 0.64 / 0.76 / 0.63 | | 17.5 % inside, turntable visible 0.84 / 0.86 / 0.82 |
| Texture (holdout MAE, 0–255) | 21.86 against 24.82 for one mean colour; 93.6 % of the chart texels sampled; shoulder caps 47.5 % | 21.0 / 24.3 | 27.91 against 32.55; 98.3 % sampled |
| Mesh, bundle | 10,983 triangles, 3 components; bundle 750 KB | 11,216; 765 KB | 12,261 triangles, 1 component; bundle 776 KB |
| GPU (estimate) | 1,576 s, $1.66–1.71 | 1,493 s, $1.57–1.63 | 1,581 s, $1.68–1.74 |

### Drape prediction P0 against the measured mesh (shadow mode, the first real comparisons)

| | Predicted | Measured | Error (σ) |
| --- | --- | --- | --- |
| Azure run 15: hem flare (hem / hip girth) | 1.35 | 1.325 | −0.025 (0.21 σ) |
| hem height above the floor | 57.27 cm | 57.35 | +0.08 cm (0.04 σ) |
| flat-lay shoulder to hem | 91 | 89.98 | −1.02 (0.51 σ) |
| underbust ease | 6 cm (default) | 15.0 | +9.0 (1.13 σ) |
| sleeve length | 0 (no sleeve named, none printed) | 32.5 cm | +32.5 (4.06 σ) |
| hem girth | | | +2.6 % |
| P0 shape against the mesh | | | Chamfer 1.672 cm (F 0.70 at 1 cm); shoulders 1.13, bodice 0.75, skirt 0.70 |
| Skirt run 15: hem height | 11.4 cm ("maxi: just above the ankle") | 4.16 | −7.24 cm (1.21 σ) |
| waist drop to the hem | 92.76 | 100.0 | +7.24 (1.21 σ) |
| hem flare | 1.25 | not measurable (no hip girth: the side opening) | |
| hem girth | | 110.27 cm | −18.5 % |
| P0 shape against the mesh | | | Chamfer 1.399 cm (F 0.67 at 1 cm) |

Run 14 re-logged with the same code: flare 1.35 → 1.33, hem −1.81 cm, flat-lay +1.54, underbust +14.0, sleeve +35.4 (4.43 σ), Chamfer 2.03 cm. What holds on real garments: the babydoll's length rule, flare and hem height (both runs within 2 cm and 0.12 of flare); within 1.28 σ: 4 of 5 informative rows on azure run 15, 3 of 5 on run 14, 2 of 2 on the skirt. What P0 misses, on both dresses: the sleeves (the description names none and no sleeve length is printed, but the photo shows puff sleeves) and the empire block's underbust ease. On the skirt: the hem (FASHN drew it floor-length as in the shop photo; P0's maxi rule stops above the ankle) and the flare (the generated maxi is 18.5 % narrower at the hem than an A-line at 1.25). Two products are not a calibration; σ is untested.

### What the run 15 assets look like (every render looked at)

- **Azure, viewer, M, AU 8 / 12 / 16, front, three-quarter, side:** the same dress as run 14's stage 4t asset: closed cloth, the print, puff sleeves ending in a gathered cuff, sizes visibly different. Still there: a grey patch at the back of the shoulder next to the neck in AU 8 from the side; the side view hangs straight. Fit map: AU 8 red at the chest, 12 light blue, 16 blue.
- **Azure, run 14 against run 15** (`compare/run14-vs-current-*.png`, run 14 on top, same cameras): by eye the two hems are at the same height at 0° (the lowest garment pixel of the frame masks: 547 against 546 px) and run 15's is visibly higher only at 90° (554 against 537 px, about 5 cm at 3.6 px/cm); in the viewer from the side the difference is not visible at that scale. The 1.9 cm in the table is the median over all directions. The bodice and sleeves look alike.
- **Skirt, viewer (after the waistband pins):** a floor-length printed skirt hanging from its band in all three sizes; 16 visibly wider than 8 at the top. The texture reads as red with white florals but is streaked by the drape's vertical folds. From the front the grey hip shows at both sides of the band in every size; from the three-quarter view a grey wedge runs from the band to about mid-thigh at the mannequin's left, from the side the hip shows under the arm (re-rendered after this evaluation, same picture). The fit map is almost uncoloured: the fit engine's waist band sits at our waist ring, where the cloth barely is (AU 8 a faint red line at the top edge, 16 a faint blue). Before the fix the front of every size had slid down to the knees.
- **The 2DGS meshes** of both products show the mannequin through the cloth (17.5–24.7 % inside), as run 14's did.

## Verdict per Phase 0 acceptance item (after run 15)

| Item | Verdict | Evidence |
| --- | --- | --- |
| Size test | **Needs the five-person panel; not run.** 1 of 5 products has a panel bundle (4 needed): the azure babydoll. The skirt has a bundle but is marked faulty in `review.json` (evaluated and rendered, off the blind page and not counted) | Azure (run 15, stage 4t): closed cloth, print, sizes visibly different; still the grey back-shoulder patch in AU 8 and the straight side view. Skirt (run 15, stage 4t): hangs from its band in all sizes after the waistband-pin fix, sizes visibly different at the top on the M mannequin (not between 12 and 16 on XS, not at all on XXL, where the top sits at the hip), but the hips show: the stills are 2.8 cm (front) and 2.0 cm (back) narrower than the mannequin at the hip and the asset is open at both sides there (10.2 and 7.8 cm across at most, the left one down to 70 cm); the fit map is nearly blank. Not fit for the panel. Blouse and cardigan rejected on review, palazzo stopped before stage 2 |
| Fabric test | **Needs the five-person panel; not run** | No linen/silk judgement of either asset |
| Chart agreement | **Not met on what exists: 1 of 2 good products passes; not yet measurable as a gate (4 of 5 needed)** | Azure: chest 101.27 cm against 102, −0.73 before calibration, graded chest −2 / −1 / 0 / +1 / 0 against the printed table, flat-lay length 90.12 against 91. Skirt: no girth at its one critical anchor (the waist): the generated band sits 2.6–10.8 cm below our waist ring and is open 5.8 cm at one side; bridged it is 94.23 cm against the chart's 80.5. Hip (not a fit point of the a-line block): no girth either, open at both sides; bridged 107.65 cm against the chart's 109 (−1.35). No skirt length is printed. Blouse (2DGS, rejected): −10.85 cm; cardigan: no chest girth |
| View agreement | **Measured; merchant confirmation still needed** | Against the pinned stills, visible: azure 0.889 / 0.938, skirt 0.894 / 0.891 (both above 0.85); holdout visible 0.918 and 0.915. The stills are generated, so this measures stages 2–4t |
| Cost | **Measured (GPU seconds); dollars list-price estimates** | Run 15: 6,295 GPU s, $6.66–6.93 for five products (good products $1.66–1.74 each; $3.29–3.40 went to the two rejected products that `--accept-failed-dress` let through). Runs 10–15: 12,943 GPU s, $13.55–14.45. Stage 4t adds about 90 s of CPU per product. Modal invoice not read |
| Write-up | **Not met** | One video model and one reconstruction route (2DGS and the CPU template fit on the same video). Three of five run 15 products failed at stage 1b (FASHN), which no later stage repairs |

What the assets need before the panel: three more products whose stills are right (stage 1b is now the bottleneck: FASHN tore the blouse, shrank the cardigan into a bolero and closed the palazzo legs; `--accept-failed-dress` should not have spent stage 2 on the first two); for the skirt, stills that are at least as wide as the mannequin at the hip and whose band sits at the waist (the narrow hips, the side openings and the low front are all in stage 1b's stills already; no later stage should paper over them); for the dress, the run 14 faults listed above.

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

**Review of run 15 (stills and frames looked at):** accepted. stage 1b passed; stills and frames right: puff sleeves, print, babydoll, hem higher than run 14.

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
| job export | done | job azure-palm-baby-doll-dress-de3bc1eeb3e0, input hash de3bc1eeb3e0 |
| 1b dress the mannequin | done | engine fashn; QA pass; QA overridden (--accept-failed) |
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 3.3 / 2.6 (8-bit mean abs) |
| 3 separation | done | 160 garment masks of the generated frames (`stage2/garment_mask/`, garment-segment-0.1.0; 0 frames ambiguous with the mannequin); stage 4 trains on them |
| 4 reconstruction | done | 11999 triangles, mask IoU train 0.9301 / holdout 0.9223 |
| 4t template fit + bake (CPU) | done | 10983 triangles, IoU visible / silhouette train 0.9173 / 0.8972, holdout 0.9176 / 0.8986, 0 vertices inside the mannequin |
| 5 anchoring and calibration | done | stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames); global scale 1.007 |
| 6 grading | done | 8, 10, 12, 14, 16 |
| 7 QA (chart, view, mesh) | done | chart pass, view front 0.889, back 0.938, 10983 triangles |
| 8 bundle | done | 750 KB in `spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/` |

**Metrics**

Mesh: stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames) (`stage4t/stage2/garment.glb`, sha256 c82423f4ce1c).

**Chart agreement** at base size 12 (tolerance ±2 cm at the critical anchors: chest). Global scale 1.0072, from chest. The `empire` pattern block does not fit waist and hip (empire line hangs from the bust; the fit engine skips them too), so they are reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chest | yes | 102.00 | +7.00 | 101.27 | 105.70 | -0.73 | 0.00 | 0.00 | pass |
| waist | no | 81.50 | +4.00 (category default) | 85.25 | 85.40 | +3.75 | +4.36 | +4.36 | not fitted |
| hip | no | 110.00 | +6.00 (category default) | 112.88 | 113.10 | +2.88 | +3.69 | +3.69 | not fitted |

Before calibration max |error| 0.73 cm (within ±2); after the global scale alone 0.00 cm (within); after per-ring calibration pass. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): underbust 93.00, thigh 136.91, upper_arm 53.97 cm.

No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): neck, shoulder, knee, wrist.

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| shoulder_to_hem | 90.12 | flat-lay | 81.64 | 91.00 | -0.88 | flat-lay: along the garment front from the high point shoulder (src/garmentLength.ts); vertical drop 81.64 cm |
| waist_to_hem | 48.40 | — | — | — | — |  |
| sleeve_length | 32.50 | — | — | — | — |  |

Every shoulder-to-hem definition on the calibrated mesh (`src/garmentLength.ts`): high point shoulder, vertical drop to the front hem 81.64 cm; high point shoulder, along the garment front to the hem (flat-lay length) 90.12 cm; back neck at the centre back, along the garment back to the hem 79.48 cm; shoulder point (end of the shoulder), vertical drop to the front hem 76.94 cm.

**Grading against the shop's printed garment table** (graded targets in grading.json minus what the shop printed per size; the base size is calibrated to the chart, the other sizes follow the chart's steps; the shop's "Length" is read as shoulder to hem, flat-lay: grading.json's vertical drop + 8.48 cm, the base mesh's flat-lay minus drop):

| Size | chest graded | chest printed | diff | shoulder_to_hem graded | shoulder_to_hem printed | diff |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | 92.00 | 94.00 | -2.00 | 88.12 | 90.00 | -1.88 |
| 10 | 97.00 | 98.00 | -1.00 | 89.12 | 90.00 | -0.88 |
| 12 | 102.00 | 102.00 | 0.00 | 90.12 | 91.00 | -0.88 |
| 14 | 107.00 | 106.00 | +1.00 | 91.12 | 92.00 | -0.88 |
| 16 | 112.00 | 112.00 | 0.00 | 92.12 | 93.00 | -0.88 |

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | stage1b `stage1b/garment_mask_front.png` | 0.889 | 0.886 | pass | no |
| back | stage1b `stage1b/garment_mask_back.png` | 0.938 | 0.935 | pass | no |

Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):

| View | Normalised IoU | Mirrored | Aspect render / photo |
| --- | --- | --- | --- |
| front | 0.740 | yes | 1.1 / 1.15 |
| back | 0.666 | yes | 1.09 / 1.7 |

Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):

| Angle | Frame | Calibrated: visible | Calibrated: silhouette | Reconstructed: visible | Reconstructed: silhouette | Picture |
| --- | --- | --- | --- | --- | --- | --- |
| 0° | 0 | 0.885 | 0.883 | 0.884 | 0.882 | [turntable_0.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_0.png) |
| 90° | 40 | 0.929 | 0.860 | 0.936 | 0.866 | [turntable_90.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_90.png) |
| 180° | 80 | 0.932 | 0.930 | 0.929 | 0.927 | [turntable_180.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_180.png) |

Each picture: the stage 2 frame, the calibrated mesh with its baked texture (stage 4t) on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).

Overlays: [front](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 0.0 % as reconstructed (0 vertices), 0.0 % after calibration.

**Mesh health** (mesh as evaluated): 10983 triangles (budget 8000–15000: within), 5661 vertices, 3 components, 347 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

**Stage 4t** (template fit and bake, `stage4t/stage2/metrics.json`): the control proxy remeshed into cylindrical grids (body + two sleeves), carved and expanded along fixed rays to 128 training masks, 6 silhouette rounds, 439 Jacobi sweeps in 8 solves (every solve reached the 0.001 cm tolerance). Silhouette IoU per view, mean (min): train visible 0.9173 (0.8754), silhouette 0.8972 (0.8182); holdout (32 views never used) visible 0.9176 (0.889), silhouette 0.8986 (0.8255). Inside the mannequin (signed distance to mannequin.glb < 0): 0 of 5661 vertices; below the 0.4 cm clearance by that grid SDF: 0; by the exact distance to the mannequin's triangles the closest vertex is 0.4 cm away, 0 vertices lie below the 0.4 cm clearance and 0 below 0.3 cm. Mesh: 10983 triangles, 3 components, 10 boundary loops, 0 non-manifold edges, watertight no (open by design: one body tube and one tube per sleeve whose shoulder cap closes over the arm cap and overlaps the bodice (separate components, not stitched); openings at the neckline, hem, cuffs and underarms are the boundary loops). Texture: 2048² atlas from 128 training views, 93.6 % of the chart texels seen (the rest filled by diffusion), of the shoulder caps' 131146 texels (within 6 cm of either cap top) 47.5 % (the holdout check below does not cover the cap), JPEG 399 KB; on the held-out frames the texture's mean absolute error is 21.86 (one mean colour: 24.82), on 8 × 8 pixel blocks 14.38 (mean colour 18.75), 0–255.

**Stage 4 (2DGS) against stage 4t (template fit)** on the same video, both through this evaluation:

| Metric | stage 4 reconstruction of the stage 2 video (`stage4/stage2/garment.glb`) | stage 4t template fit of the stage 2 video (`stage4t/stage2/garment.glb`) |
| --- | --- | --- |
| chest girth as reconstructed (tape), cm | 97.68 | 101.27 |
| chart: max \|error\| before calibration, cm | 4.32 | 0.73 |
| chart: after the global scale, cm | 0.00 | 0.00 |
| chart: after calibration, cm | 0.87 | 0.00 |
| global scale | 1.044 | 1.007 |
| turntable 0°: IoU visible / silhouette | 0.637 / 0.916 | 0.884 / 0.882 |
| turntable 90°: IoU visible / silhouette | 0.760 / 0.822 | 0.936 / 0.866 |
| turntable 180°: IoU visible / silhouette | 0.630 / 0.934 | 0.929 / 0.927 |
| cloth inside the mannequin (> 0.3 cm), as reconstructed | 24.7 % | 0.0 % |
| cloth inside the mannequin, after calibration | 19.1 % | 0.0 % |
| triangles / components / boundary edges | 11999 / 3 / 1025 | 10983 / 3 / 347 |
| shoulder to hem, vertical drop, cm | 82.42 | 81.64 |
| shoulder to hem, flat-lay (along the front), cm | 84.67 | 89.98 |
| colour in the bundle | one mean colour #BBB0A3 | baked texture |
| bundle size | 258 KB | 750 KB |

Evaluation time on the build machine: read 253 ms, measure 108 ms, calibrate 35 ms, grade 1 ms, view renders 1380 ms.

**Drape prediction P0 in shadow mode** (`stage4t/stage2/shadow.json`, predictor drape-prior-p0-0.2.0, cell `dress|empire|above-knee|fluid`; the prediction drives nothing yet: it is compared with what stage 4t measured on this job's mesh):

| Parameter | Predicted | On the P0 proxy | Measured (stage 4t) | Error | σ | |error| / σ | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hemFlare | 1.350 | 1.326 | 1.325 | -0.025 | 0.12 | 0.21 | predicted before leg clearance; measured on the hem ring 2 cm above the lowest body cloth |
| defaultEase.underbust | 6.000 | 6.129 | 15.002 | 9.002 | 8.00 | 1.13 | cm of girth over mannequin M |
| hemY | 57.271 | 57.271 | 57.350 | 0.079 | 2.00 | 0.04 | hem height above the floor; rule: shoulder_to_hem 91 cm (flat-lay: along the front from the HPS) |
| length.hps_surface | 91.000 | 90.970 | 89.980 | -1.020 | 2.00 | 0.51 | flat-lay: along the front from the HPS |
| sleeve.lengthCm | 0.000 | — | 32.500 | 32.500 | 8.00 | 4.06 | no sleeve length given: no sleeve shell (the bare arm stays in the control) |
| sleeve.upperArmRatio | — | — | 1.927 | — | 0.29 | — |  |
| depthRatio.hem | — | 0.680 | 0.651 | — | — | — | derived descriptor (P0 predicts no depth): proxy vs stage 4t |

P0 shape (the proxy built from the prediction, opened) against the stage 4t mesh: Chamfer 1.672 cm, F-score 0.699 at 1 cm, 0.847 at 2 cm; per region shoulders 1.13, bodice 0.75, skirt 0.70 cm. V1 gate values: hem height error 0.08 cm, length error -1.02 cm, hem girth error 2.6 %, share of informative errors within 1.28 σ 0.80.

- the job has no prediction.json (exported by @curtain/garment-spike phase0-export-0.6.0, before drape-prior P0): predicted now with drape-prior-p0-0.2.0; its control proxy was control-proxy-0.3.0, the P0 shape is today's proxy

**Earlier runs of this product** (their own job dirs, evaluated now with the same tooling, so their numbers can differ slightly from what was reported at the time):

| Metric | run 14 (`spikes/garment-engine/out/phase0/azure-palm-baby-doll-dress-run14`) | this job (`spikes/garment-engine/out/phase0/azure-palm-baby-doll-dress`) |
| --- | --- | --- |
| job (exporter) | `azure-palm-baby-doll-dress-6d2f2611a144` (phase0-export-0.4.0) | `azure-palm-baby-doll-dress-de3bc1eeb3e0` (phase0-export-0.6.0) |
| control proxy | control-proxy-0.1.0, hem 47.60 cm above the floor | control-proxy-0.3.0, hem 57.27 cm above the floor |
| stage 1b QA | FAIL (front, back), QA stage1b-qa-0.3.0 | pass, QA stage1b-qa-0.6.1 |
| evaluated mesh | stage 4t template fit of the stage 2 video | stage 4t template fit of the stage 2 video |
| critical girth by the tape, as reconstructed, cm | chest 101.15 (-0.85 before calibration) | chest 101.27 (-0.73 before calibration) |
| front hem above the floor (centre front, as reconstructed), cm | 54.18 | 56.96 |
| hem line above the floor (median of the lowest cloth per 10° sector, exemplar.json), cm | 55.46 | 57.35 |
| shoulder to hem, vertical drop, cm | 84.42 | 81.64 |
| shoulder to hem, flat-lay along the front, cm | 92.54 | 89.98 |
| pinned stills, IoU visible | front 0.904, back 0.933 | front 0.889, back 0.938 |
| stage 4t holdout IoU visible / silhouette | 0.9009 / 0.8841 | 0.9176 / 0.8986 |
| triangles | 11216 | 10983 |
| GPU cost (estimate) | 1493 s GPU, $1.57–$1.63 | 1576 s GPU, $1.66–$1.71 |

run 14 against this job: [run14-vs-current-turntable-0.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run14-vs-current-turntable-0.png) (stage 2 frame | mesh | overlay at 0°, the earlier run on top); [run14-vs-current-turntable-90.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run14-vs-current-turntable-90.png) (the same at 90°); [run14-vs-current-viewer-M-front.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run14-vs-current-viewer-M-front.png) (viewer, AU 8 / 12 / 16 on the M mannequin, front, the earlier run on top); [run14-vs-current-viewer-M-side.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run14-vs-current-viewer-M-side.png) (the same from the side).

run 14 renders: [M-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/M-plain.png), [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/M-three-quarter-plain.png), [M-side-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/M-side-plain.png), [XS-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/XS-plain.png), [XXL-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/XXL-plain.png).

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage1b_dress | H100 | any | 26 s | 48 s | $0.03 | $0.05 |
| stage2_video | H100 | any | 1430 s | 1450 s | $1.57 | $1.59 |
| stage4_recon[stage2] | L40S | any | 120 s | 127 s | $0.07 | $0.07 |

Total: 1576 s GPU, 2271 s wall, $1.66–$1.71 (estimate).

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | 8, 12, 16 | 1.73 s, 1.67 s, 1.80 s | [M-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-plain.png) |
| M mannequin | front | yes | 8, 12, 16 | 1.73 s, 1.67 s, 1.80 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | 8, 12, 16 | 4.76 s, 4.71 s, 4.66 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | 8, 12, 16 | 4.76 s, 4.71 s, 4.66 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | 8, 12, 16 | 5.69 s, 5.66 s, 5.63 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-side-plain.png) |
| M mannequin | side | yes | 8, 12, 16 | 5.69 s, 5.66 s, 5.63 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-side-fitmap.png) |
| XS shape | front | no | 8, 12, 16 | 5.94 s, 5.91 s, 5.89 s | [XS-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XS-plain.png) |
| XS shape | front | yes | 8, 12, 16 | 5.94 s, 5.91 s, 5.89 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XS-fitmap.png) |
| XXL shape | front | no | 8, 12, 16 | 5.83 s, 5.80 s, 5.77 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XXL-plain.png) |
| XXL shape | front | yes | 8, 12, 16 | 5.83 s, 5.80 s, 5.77 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XXL-fitmap.png) |

### 2. Rosewater Blouse (`rosewater-blouse`)

**Review of run 15 (stills and frames looked at):** **rejected**. FASHN stills torn (patches of print with the mannequin showing through, the back a pale blotchy shirt); stage 2 frames contain black panels on the back and side. Stage 2 ran anyway because --accept-failed-dress overrides the silhouette and fidelity failures. Evaluated below so the numbers show it, but not rendered and not on the blind page.

Tops → category `top` (blouse). Completeness 0.576, incomplete.

**Why this product:** AU 8–16, 5 images (4 of the blouse) with a clean straight back view, "100% lightweight rayon". It prints no measurements; the one top that does (meadowlight-blouse) shows the blouse in 2 photos only. Runners-up: `meadowlight-blouse`, `amelie-button-back-blouse`, `marella-coast-blouse`, `sandy-cove-poncho-top`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | front | yes | busy | yes | 800×1200 | front (used) |
| 2 | side | yes | busy | yes | 800×1200 |  |
| 3 | front | yes | busy | yes | 800×1200 |  |
| 4 | back | yes | busy | yes | 800×1200 | back (used) |
| 5 | front | yes | busy | no | 800×1200 |  |

Job exported: source kind on_model; front `dress/source_front.jpg` (photo 1); back `dress/source_back.jpg` (photo 4); invented back: **no**.

**Chart:** body chart, sizes 8, 10, 12, 14, 16; base size 12 (our default, not stated by the shop): body bust 95, waist 77.5, hip 104 cm. No garment measurements printed: all points take the fit engine's category default ease.

**Fabric resolved** (fabric library 1.0.0): 100% viscose; 165 g/m², stretch 1.5 %, drape 0.85, bend 0.04, sheen 0.3, opacity 0.8. Display colour: placeholder (no colour in the product data; display only).

Data warnings from the selection:

- the AU body chart has no shoulder width; the shoulder fit point is skipped
- price is 69 AUD; priceEur is left out (no exchange rate is assumed)

**Pipeline status**

| Stage | State | Detail |
| --- | --- | --- |
| 1 ingest and validate | failed | photo contract not met: front photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600, garment partly hidden); add one on a hanger, flat-lay or ghost mannequin; back photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; base size 12 is our default, not confirmed by the shop |
| job export | done | job rosewater-blouse-129498b959df, input hash 129498b959df |
| 1b dress the mannequin | failed | engine fashn; QA failed on front, back; QA overridden (--accept-failed) |
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 2.9 / 2.1 (8-bit mean abs) |
| 3 separation | done | 160 garment masks of the generated frames (`stage2/garment_mask/`, garment-segment-0.1.0; 53 frames ambiguous with the mannequin); stage 4 trains on them |
| 4 reconstruction | done | 11999 triangles, mask IoU train 0.8004 / holdout 0.7745 |
| 5 anchoring and calibration | done | stage 4 reconstruction of the stage 2 video (GPU output); global scale 1.115 |
| 6 grading | done | 8, 10, 12, 14, 16 |
| 7 QA (chart, view, mesh) | done | chart FAIL, view front 0.503, back 0.688, 11999 triangles |
| 8 bundle | done | 250 KB in `spikes/garment-engine/out/eval/rosewater-blouse/` |

**Metrics**

Mesh: stage 4 reconstruction of the stage 2 video (GPU output) (`stage4/stage2/garment.glb`, sha256 4020ad2cf919).

**Chart agreement** at base size 12 (tolerance ±2 cm at the critical anchors: chest). Global scale 1.1152, from chest. The `shirt` pattern block does not fit waist and hip (shirt cut hangs loose; the fit engine skips them too), so they are reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chest | yes | 105.00 | +10.00 (category default) | 94.15 (cloth on 99 % of the way round) | open or none | -10.85 | 0.00 | -6.65 | FAIL |
| waist | no | 85.50 | +8.00 (category default) | — | — | — | — | — | not fitted (the garment does not go round this ring (open front, garment does not reach it, or a hole wider than the tape bridges)) |
| hip | no | 110.00 | +6.00 (category default) | — | — | — | — | — | not fitted (the garment does not go round this ring (open front, garment does not reach it, or a hole wider than the tape bridges)) |

Before calibration max |error| 10.85 cm (outside ±2); after the global scale alone 0.00 cm (within); after per-ring calibration FAIL. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): upper_arm 31.76 cm.

No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): neck, shoulder, underbust, waist, hip, wrist.

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| shoulder_to_hem | 63.07 | flat-lay | 53.00 | — | — | flat-lay: along the garment front from the high point shoulder (src/garmentLength.ts); vertical drop 53 cm |
| waist_to_hem | 19.88 | — | — | — | — |  |
| sleeve_length | 28.70 | — | — | — | — |  |

Every shoulder-to-hem definition on the calibrated mesh (`src/garmentLength.ts`): high point shoulder, vertical drop to the front hem 53.00 cm; high point shoulder, along the garment front to the hem (flat-lay length) 63.07 cm; back neck at the centre back, along the garment back to the hem 55.31 cm; shoulder point (end of the shoulder), vertical drop to the front hem 50.03 cm.

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | stage1b `stage1b/garment_mask_front.png` | 0.503 | 0.457 | FAIL | no |
| back | stage1b `stage1b/garment_mask_back.png` | 0.688 | 0.800 | FAIL | no |

Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):

| View | Normalised IoU | Mirrored | Aspect render / photo |
| --- | --- | --- | --- |
| front | 0.409 | no | 0.81 / 1.4 |
| back | 0.579 | yes | 0.75 / 1.66 |

Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):

| Angle | Frame | Calibrated: visible | Calibrated: silhouette | Reconstructed: visible | Reconstructed: silhouette | Picture |
| --- | --- | --- | --- | --- | --- | --- |
| 0° | 0 | 0.469 | 0.866 | 0.343 | 0.901 | [turntable_0.png](../../spikes/garment-engine/out/eval/rosewater-blouse/view/turntable_0.png) |
| 90° | 40 | 0.731 | 0.649 | 0.570 | 0.633 | [turntable_90.png](../../spikes/garment-engine/out/eval/rosewater-blouse/view/turntable_90.png) |
| 180° | 80 | 0.731 | 0.859 | 0.576 | 0.884 | [turntable_180.png](../../spikes/garment-engine/out/eval/rosewater-blouse/view/turntable_180.png) |

Each picture: the stage 2 frame, the calibrated mesh in its stage 4 vertex colours on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).

Overlays: [front](../../spikes/garment-engine/out/eval/rosewater-blouse/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/rosewater-blouse/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 59.9 % as reconstructed (3836 vertices), 45.2 % after calibration.

**Mesh health** (mesh as evaluated): 11999 triangles (budget 8000–15000: within), 6405 vertices, 2 components, 1321 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

**Warnings**

- global scale 1.115: the reconstruction is -11.5 % off in size (check units and cameras before trusting the shape)

Evaluation time on the build machine: read 16 ms, measure 99 ms, calibrate 34 ms, grade 0 ms, view renders 1072 ms.

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage1b_dress | H100 | any | 28 s | 55 s | $0.03 | $0.06 |
| stage2_video | H100 | any | 1422 s | 1442 s | $1.56 | $1.58 |
| stage4_recon[stage2] | L40S | any | 94 s | 101 s | $0.05 | $0.05 |

Total: 1544 s GPU, 2246 s wall, $1.64–$1.70 (estimate).

**Renders**

Not rendered: run 15 was rejected on review.

### 3. Rosewater Palazzo Pants (`rosewater-palazzo-pants`)

**Review of run 15 (stills and frames looked at):** **rejected**. FASHN drew a closed skirt in both views (legs merged in 259 of 259 rows); the type gate stopped it before stage 2. The shop photo's legs are so wide they read as a skirt. not rendered and not on the blind page.

Pants → category `bottom` (palazzo). Completeness 0.676, incomplete.

**Why this product:** AU 8–16, 5 images with a back view, "100% lightweight rayon", and a printed garment table (waist, hips, length per AU size). Runners-up: `byron-barrel-denim-jeans`, `drift-tide-denim-jeans`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | front | yes | busy | no | 800×1200 |  |
| 2 | front | yes | busy | yes | 800×1200 | front (used) |
| 3 | front | yes | busy | yes | 800×1200 |  |
| 4 | back | yes | busy | yes | 800×1200 | back (used) |
| 5 | front | yes | busy | yes | 800×1200 |  |

Job exported: source kind on_model; front `dress/source_front.jpg` (photo 2); back `dress/source_back.jpg` (photo 4); invented back: **no**.

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
| job export | done | job rosewater-palazzo-pants-b85affd79b61, input hash b85affd79b61 |
| 1b dress the mannequin | failed | engine fashn; QA failed on front, back; QA overridden (--accept-failed) |
| 2 image to video | not run | no stage2/record.json |
| 3 separation | not built | no stage 3 on generated frames yet; stage 4 falls back to its foreground mask mode |
| 4 reconstruction | not run | no stage4/stage2/ |
| 5 anchoring and calibration | not run | no stage 4 mesh (stage4/stage2/garment.glb) in the job dir |
| 6 grading | not run | no stage 4 mesh (stage4/stage2/garment.glb) in the job dir |
| 7 QA (chart, view, mesh) | not run | no stage 4 mesh (stage4/stage2/garment.glb) in the job dir |
| 8 bundle | not run | no stage 4 mesh (stage4/stage2/garment.glb) in the job dir |

**Metrics**

Chart agreement, view agreement and mesh health: not measured (no stage 4 mesh (stage4/stage2/garment.glb) in the job dir).

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage1b_dress | H100 | any | 31 s | 64 s | $0.03 | $0.07 |

Total: 31 s GPU, 100 s wall, $0.03–$0.07 (estimate).

**Renders**

Not rendered: run 15 was rejected on review.

### 4. Crimson Wildflower Maxi Skirt (`crimson-wildflower-maxi-skirt`)

**Review of run 15 (stills and frames looked at):** **faulty, for evaluation only**. kept for evaluation, not for the panel: waistband and print right, but NOT at the hips (the founder: "see the hips"): in both stage 1b stills the grey mannequin hip shows outside the skirt at the sides, and in the stage 2 frames the skirt opens into a wedge-shaped slit at the side with the grey leg showing. Stage 1b QA failed the front only (silhouette 0.864) and was overridden. Evaluated and rendered below so the fault can be seen, but not a panel bundle and not on the blind page.

Skirts → category `bottom` (maxi-skirt). Completeness 0.559, incomplete.

**Why this product:** AU 8–16, 3 images (side with slit, front, back), "lightweight, breathable rayon", elastic drawstring waist visible in every photo. No skirt prints measurements. Runners-up: `santorini-bloom-maxi-skirt`, `pink-paradise-maxi-skirt`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | side | yes | busy | yes | 800×1200 |  |
| 2 | front | yes | busy | yes | 800×1200 | front (used) |
| 3 | back | yes | busy | yes | 800×1200 | back (used) |

Job exported: source kind on_model; front `dress/source_front.jpg` (photo 2); back `dress/source_back.jpg` (photo 3); invented back: **no**.

**Chart:** body chart, sizes 8, 10, 12, 14, 16; base size 12 (our default, not stated by the shop): body bust 95, waist 77.5, hip 104 cm. No garment measurements printed: all points take the fit engine's category default ease.

**Fabric resolved** (fabric library 1.0.0): 100% viscose; 165 g/m², stretch 1.5 %, drape 0.85, bend 0.04, sheen 0.3, opacity 0.8. Display colour: placeholder (no colour in the product data; display only).

Data warnings from the selection:

- fabric composition not stated (only "viscose" named): blend left out; weight/stretch/drape use the single-fibre library default
- price is 69 AUD; priceEur is left out (no exchange rate is assumed)

**Pipeline status**

| Stage | State | Detail |
| --- | --- | --- |
| 1 ingest and validate | failed | photo contract not met: front photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; back photo does not meet the contract (worn by a model, busy background, long edge 1200 px < 1600); add one on a hanger, flat-lay or ghost mannequin; base size 12 is our default, not confirmed by the shop |
| job export | done | job crimson-wildflower-maxi-skirt-9a2b6e7f37ce, input hash 9a2b6e7f37ce |
| 1b dress the mannequin | failed | engine fashn; QA failed on front; QA overridden (--accept-failed) |
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 3.5 / 3.4 (8-bit mean abs) |
| 3 separation | done | 160 garment masks of the generated frames (`stage2/garment_mask/`, garment-segment-0.1.0; 0 frames ambiguous with the mannequin); stage 4 trains on them |
| 4 reconstruction | done | 11999 triangles, mask IoU train 0.9269 / holdout 0.9201 |
| 4t template fit + bake (CPU) | done | 12261 triangles, IoU visible / silhouette train 0.915 / 0.8824, holdout 0.9146 / 0.8834, 0 vertices inside the mannequin |
| 5 anchoring and calibration | done | stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames); global scale 1.000 |
| 6 grading | done | 8, 10, 12, 14, 16 |
| 7 QA (chart, view, mesh) | done | chart FAIL, view front 0.894, back 0.891, 12261 triangles |
| 8 bundle | done | 776 KB in `spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/` |

**Metrics**

Mesh: stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames) (`stage4t/stage2/garment.glb`, sha256 9cc3c1279d6a).

**Chart agreement** at base size 12 (tolerance ±2 cm at the critical anchors: waist). Global scale 1.0000, from no ring. The `a-line` pattern block does not fit hip (A-line hem flares freely; the fit engine skips it too), so it is reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| waist | yes | 80.50 | +3.00 (category default) | — (cloth on 88 % of the way round) | — | — | — | — | FAIL (the cloth does not reach the waist ring (104.16 cm): its top edge runs from 101.56 cm at the back to 93.41 cm at the front (plane tilted 20.54°); measured on the waistband, 1.5 cm under that edge (src/waistband.ts), as reconstructed; not calibrated. A band that sits lower than the waist ring lies on the body between the waist and the hip, so its girth says where the skirt is worn as much as how big it is; the tape refuses there: an opening of 5.81 cm (20°), with it bridged 94.23 cm (+13.73 cm against the chart)) |
| hip | no | 109.00 | +5.00 (category default) | — | — | — | — | — | not fitted (no tape girth: the cloth goes 89 % of the way round at 88 cm, open 9.78 cm at 82.5° (the mannequin's left), 6.66 cm at -82.5° (the mannequin's right); with the openings bridged 107.65 cm (-1.35 cm against the chart), the mannequin there 99.85 cm, the cloth at least 0.62 cm off it (src/bottomOpenings.ts, as reconstructed)) |

Before calibration max |error| — cm (outside ±2); after the global scale alone — cm (outside); after per-ring calibration FAIL. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): knee 116.07, calf 120.37 cm.

No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): waist, hip, thigh, ankle.

**Openings** (`src/bottomOpenings.ts`, as reconstructed: horizontal slices every 2 cm, a gap counts when the straight line across it is longer than 4 cm, between 8.86 and 92.41 cm above the floor, i.e. below the lowest point of the top edge and above the hem): the mannequin's left (+x) from 92.00 down to 70.00 cm above the floor, widest 10.21 cm at 82.00 cm; the mannequin's right (−x) from 92.00 down to 86.00 cm above the floor, widest 7.83 cm at 92.00 cm. The hip ring is at 87.36 cm, the crotch at 76.44 cm. Stage 4t keeps the cloth outside the mannequin, so where the masks show the mannequin it carves an opening (the per-vertex vote over the frames); nothing here is filled from the template.

| Height (cm) | Cloth round | Gaps > 4 cm (chord at azimuth; +90° = the mannequin's left) | Bridged girth (cm) | Mannequin (cm) | Bridged − mannequin | Bridged − chart hip (109.00) | Closest cloth to the body (cm) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 94.00 | 75 % | 13.50 at -20°, 7.49 at 80°, 7.46 at -80° | 98.79 | 90.96 | +7.83 |  | 0.55 |
| 92.00 | 88 % | 9.35 at 82.5°, 7.83 at -80° | 102.37 | 95.04 | +7.33 |  | 0.65 |
| 90.00 | 89 % | 9.61 at 82.5°, 6.54 at -82.5° | 105.52 | 98.21 | +7.31 |  | 0.62 |
| 88.00 (hip) | 89 % | 9.78 at 82.5°, 6.66 at -82.5° | 107.65 | 99.85 | +7.80 | -1.35 | 0.62 |
| 86.00 | 90 % | 9.93 at 82.5°, 5.16 at -85° | 109.16 | 99.48 | +9.68 |  | 1.09 |
| 84.00 | 93 % | 10.10 at 82.5° | 110.33 | 99.59 | +10.74 |  | 0.37 |
| 82.00 | 93 % | 10.21 at 82.5° | 111.04 | 98.69 | +12.35 |  | 0.47 |
| 80.00 | 94 % | 8.62 at 80° | 111.60 | 97.91 | +13.69 |  | 0.63 |
| 78.00 | 94 % | 8.58 at 80° | 111.55 | 96.51 | +15.04 |  | 0.67 |
| 76.00 | 94 % | 8.50 at 80° | 111.64 | 97.53 | +14.11 |  | 0.65 |
| 74.00 | 96 % | 6.81 at 82.5° | 111.78 | 96.64 | +15.14 |  | 0.46 |
| 72.00 | 96 % | 6.81 at 82.5° | 111.88 | 95.60 | +16.28 |  | 0.39 |
| 70.00 | 97 % | 5.10 at 80° | 111.97 | 94.10 | +17.87 |  | 0.41 |

**The pinned stills against the mannequin's width** (stage 1b garment mask and our mannequin's own silhouette in the same camera, on the row of each height at the axis, cm at the axis's depth). A closed skirt worn on the mannequin cannot be narrower than it; where it is, the generator drew the skirt narrower than the body and the later stages can only show the body there. In the front still the image's left is the mannequin's right; in the back still it is the mannequin's left:

| View | Height (cm) | Mannequin width | Garment width | Mannequin outside the garment, image left / right |
| --- | --- | --- | --- | --- |
| front | 95.00 | 33.03 | 30.23 | 1.96 / 0.84 |
| front | 90.00 | 36.98 | 33.62 | 1.96 / 1.40 |
| front | 87.36 | 37.55 | 34.75 | 1.68 / 1.12 |
| front | 84.00 | 39.25 | 35.60 | 2.24 / 1.40 |
| front | 80.00 | 39.27 | 36.46 | 1.96 / 0.84 |
| back | 95.00 | 33.03 | 31.91 | 0.56 / 0.56 |
| back | 90.00 | 36.98 | 34.46 | 1.68 / 0.84 |
| back | 87.36 | 37.55 | 35.59 | 1.68 / 0.28 |
| back | 84.00 | 39.25 | 36.45 | 2.24 / 0.56 |
| back | 80.00 | 39.27 | 37.03 | 1.96 / 0.28 |

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| outseam | 65.27 | — | — | — | — | flat-lay, along the garment: top edge down the side seam to the hem (src/garmentLength.ts bottomLengths) |
| waist_to_hem | 91.63 | — | — | — | — | flat-lay, along the garment: top edge at the centre front to the hem (src/garmentLength.ts bottomLengths) |

Every bottom length definition on the calibrated mesh (`src/garmentLength.ts` `bottomLengths`): top edge at the centre front, along the garment front to the hem (skirt length, flat-lay) 91.63 cm (top 93.41, hem 3.06 cm above the floor); top edge at the side, along the side seam to the hem (outseam, flat-lay) 65.27 cm (top 70.60, hem 7.60 cm above the floor); top edge at the side, vertical drop to the hem 63.00 cm (top 70.60, hem 7.60 cm above the floor).

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | stage1b `stage1b/garment_mask_front.png` | 0.894 | 0.849 | pass | no |
| back | stage1b `stage1b/garment_mask_back.png` | 0.891 | 0.891 | pass | no |

Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):

| View | Normalised IoU | Mirrored | Aspect render / photo |
| --- | --- | --- | --- |
| front | 0.838 | no | 2.21 / 2.26 |
| back | 0.823 | yes | 2.17 / 1.78 |

Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):

| Angle | Frame | Calibrated: visible | Calibrated: silhouette | Reconstructed: visible | Reconstructed: silhouette | Picture |
| --- | --- | --- | --- | --- | --- | --- |
| 0° | 0 | 0.892 | 0.854 | 0.892 | 0.854 | [turntable_0.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/turntable_0.png) |
| 90° | 40 | 0.950 | 0.887 | 0.950 | 0.887 | [turntable_90.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/turntable_90.png) |
| 180° | 80 | 0.904 | 0.904 | 0.904 | 0.904 | [turntable_180.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/turntable_180.png) |

Each picture: the stage 2 frame, the calibrated mesh with its baked texture (stage 4t) on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).

Overlays: [front](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 0.0 % as reconstructed (0 vertices), 0.0 % after calibration.

**Mesh health** (mesh as evaluated): 12261 triangles (budget 8000–15000: within), 6250 vertices, 1 components, 239 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

**Stage 4t** (template fit and bake, `stage4t/stage2/metrics.json`): the control proxy remeshed into cylindrical grids (body + no sleeves), carved and expanded along fixed rays to 128 training masks, 6 silhouette rounds, 492 Jacobi sweeps in 7 solves (every solve reached the 0.001 cm tolerance). Silhouette IoU per view, mean (min): train visible 0.915 (0.8586), silhouette 0.8824 (0.8182); holdout (32 views never used) visible 0.9146 (0.8694), silhouette 0.8834 (0.8266). Inside the mannequin (signed distance to mannequin.glb < 0): 0 of 6250 vertices; below the 0.4 cm clearance by that grid SDF: 0; by the exact distance to the mannequin's triangles the closest vertex is 0.401 cm away, 0 vertices lie below the 0.4 cm clearance and 0 below 0.3 cm. Mesh: 12261 triangles, 1 components, 2 boundary loops, 0 non-manifold edges, watertight no (open by design: one tube round both legs; the top edge (waistband) and the hem are the boundary loops, any other loop is an opening the masks carved). Texture: 2048² atlas from 128 training views, 98.3 % of the chart texels seen (the rest filled by diffusion), JPEG 406 KB; on the held-out frames the texture's mean absolute error is 27.91 (one mean colour: 32.55), on 8 × 8 pixel blocks 15.62 (mean colour 21.6), 0–255.

**Stage 4 (2DGS) against stage 4t (template fit)** on the same video, both through this evaluation:

| Metric | stage 4 reconstruction of the stage 2 video (`stage4/stage2/garment.glb`) | stage 4t template fit of the stage 2 video (`stage4t/stage2/garment.glb`) |
| --- | --- | --- |
| waist girth as reconstructed (tape), cm | — | — |
| chart: max \|error\| before calibration, cm | — | — |
| chart: after the global scale, cm | — | — |
| chart: after calibration, cm | — | — |
| global scale | 1.000 | 1.000 |
| turntable 0°: IoU visible / silhouette | 0.844 / 0.881 | 0.892 / 0.854 |
| turntable 90°: IoU visible / silhouette | 0.855 / 0.849 | 0.950 / 0.887 |
| turntable 180°: IoU visible / silhouette | 0.819 / 0.935 | 0.904 / 0.904 |
| cloth inside the mannequin (> 0.3 cm), as reconstructed | 17.5 % | 0.0 % |
| cloth inside the mannequin, after calibration | 17.5 % | 0.0 % |
| triangles / components / boundary edges | 11999 / 2 / 1141 | 12261 / 1 / 239 |
| waist to hem at the centre front, flat-lay, cm | 94.69 | 91.63 |
| outseam (top edge down the left side), cm | 93.15 | 65.27 |
| colour in the bundle | one mean colour #9D4C49 | baked texture |
| bundle size | 242 KB | 776 KB |

**Warnings**

- no garment loop at critical ring waist: chart agreement fails there

Evaluation time on the build machine: read 254 ms, measure 27 ms, calibrate 21 ms, grade 0 ms, view renders 1156 ms.

**Drape prediction P0 in shadow mode** (`stage4t/stage2/shadow.json`, predictor drape-prior-p0-0.2.0, cell `skirt|a-line|maxi|fluid`; the prediction drives nothing yet: it is compared with what stage 4t measured on this job's mesh):

| Parameter | Predicted | On the P0 proxy | Measured (stage 4t) | Error | σ | |error| / σ | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hemFlare | 1.250 | 1.243 | — | — | 0.12 | — | predicted before leg clearance; measured on the hem ring 2 cm above the lowest body cloth |
| hemY | 11.400 | 11.400 | 4.160 | -7.240 | 6.00 | 1.21 | hem height above the floor; rule: subcategory/pattern "maxi": just above the ankle |
| length.waist_drop | 92.760 | 92.760 | 100.000 | 7.240 | 6.00 | 1.21 | vertical drop from the rule origin to the lowest body (trousers: left leg) cloth |
| depthRatio.hem | — | 0.680 | 0.672 | — | — | — | derived descriptor (P0 predicts no depth): proxy vs stage 4t |

P0 shape (the proxy built from the prediction, opened) against the stage 4t mesh: Chamfer 1.399 cm, F-score 0.673 at 1 cm, 0.746 at 2 cm; per region skirt 1.36 cm. V1 gate values: hem height error -7.24 cm, length error 7.24 cm, hem girth error -18.5 %, share of informative errors within 1.28 σ 1.00.

- the job has no prediction.json (exported by @curtain/garment-spike phase0-export-0.6.0, before drape-prior P0): predicted now with drape-prior-p0-0.2.0; its control proxy was control-proxy-0.3.0, the P0 shape is today's proxy

- the P0 shape differs from the job's control proxy (control-proxy-0.3.0): waist 79.5 vs 80.5 cm

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage1b_dress | H100 | any | 27 s | 54 s | $0.03 | $0.06 |
| stage2_video | H100 | any | 1448 s | 1476 s | $1.59 | $1.62 |
| stage4_recon[stage2] | L40S | any | 106 s | 116 s | $0.06 | $0.06 |

Total: 1581 s GPU, 2232 s wall, $1.68–$1.74 (estimate).

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | 8, 12, 16 | 6.20 s, 6.17 s, 6.15 s | [M-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-plain.png) |
| M mannequin | front | yes | 8, 12, 16 | 6.20 s, 6.17 s, 6.15 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | 8, 12, 16 | 5.83 s, 5.80 s, 5.77 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | 8, 12, 16 | 5.83 s, 5.80 s, 5.77 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | 8, 12, 16 | 5.81 s, 5.78 s, 5.75 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-side-plain.png) |
| M mannequin | side | yes | 8, 12, 16 | 5.81 s, 5.78 s, 5.75 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-side-fitmap.png) |
| XS shape | front | no | 8, 12, 16 | 5.89 s, 5.86 s, 5.84 s | [XS-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/XS-plain.png) |
| XS shape | front | yes | 8, 12, 16 | 5.89 s, 5.86 s, 5.84 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/XS-fitmap.png) |
| XXL shape | front | no | 8, 12, 16 | 5.98 s, 5.95 s, 5.93 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/XXL-plain.png) |
| XXL shape | front | yes | 8, 12, 16 | 5.98 s, 5.95 s, 5.93 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/XXL-fitmap.png) |

### 5. Woodstock Wanderer Knit Cardi (`woodstock-wanderer-knit-cardi`)

**Review of run 15 (stills and frames looked at):** **rejected**. front still a shrunken bolero (sleeves and a scrap of front), back a white sleeveless top with holes; stage 2 frames show black and grey halves and a garment that changes. Evaluated below so the numbers show it, but not rendered and not on the blind page.

Jackets & Knits → category `outerwear` (cardigan). Completeness 0.576, incomplete.

**Why this product:** No jacket or knit is sold in AU 8–16. Several knits tie on the text criteria (S-M/M-L mapped to AU 8–12 and 14–16 in the text, 3 images, wool/acrylic). This cardigan has front, 3/4 back and a straight back, a stated composition (35% wool 65% acrylic), and an open button front, the closest to a jacket in the collection. Runners-up: `ocean-mist-knit`, `cocoa-coast-longline-knit-coat`, `sunset-stripe-knit-jacket`, `sandbar-cardigan`, `nomad-cotton-jacket-chocolate`, `saltwater-coast-knit`.

**Inputs**

| # | Role | On model | Background | Fully visible | Size (px) | Use |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | front | yes | busy | yes | 800×1200 | front (used) |
| 2 | side | yes | busy | yes | 800×1200 |  |
| 3 | back | yes | busy | yes | 800×1200 | back (used) |

Job exported: source kind on_model; front `dress/source_front.jpg` (photo 1); back `dress/source_back.jpg` (photo 3); invented back: **no**.

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
| job export | done | job woodstock-wanderer-knit-cardi-56e306f6033b, input hash 56e306f6033b |
| 1b dress the mannequin | failed | engine fashn; QA failed on front, back; QA overridden (--accept-failed) |
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 2.3 / 1.7 (8-bit mean abs) |
| 3 separation | done | 160 garment masks of the generated frames (`stage2/garment_mask/`, garment-segment-0.1.0; 3 frames ambiguous with the mannequin); stage 4 trains on them |
| 4 reconstruction | done | 11999 triangles, mask IoU train 0.7901 / holdout 0.7899 |
| 5 anchoring and calibration | done | stage 4 reconstruction of the stage 2 video (GPU output); global scale 1.000 |
| 6 grading | done | S-M, M-L |
| 7 QA (chart, view, mesh) | done | chart FAIL, view front 0.495, back 0.287, 11999 triangles |
| 8 bundle | done | 245 KB in `spikes/garment-engine/out/eval/woodstock-wanderer-knit-cardi/` |

**Metrics**

Mesh: stage 4 reconstruction of the stage 2 video (GPU output) (`stage4/stage2/garment.glb`, sha256 c5e61d044fdb).

**Chart agreement** at base size S-M (tolerance ±2 cm at the critical anchors: chest). Global scale 1.0000, from no ring. The `oversized` pattern block does not fit waist and hip (oversized cut hangs loose; the fit engine skips them too), so they are reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chest | yes | 104.00 | +14.00 (category default) | — | — | — | — | — | FAIL (the garment does not go round this ring (open front, garment does not reach it, or a hole wider than the tape bridges)) |
| waist | no | 84.50 | +12.00 (category default) | — | — | — | — | — | not fitted (the garment does not go round this ring (open front, garment does not reach it, or a hole wider than the tape bridges)) |
| hip | no | 109.00 | +10.00 (category default) | — | — | — | — | — | not fitted (the garment does not go round this ring (open front, garment does not reach it, or a hole wider than the tape bridges)) |

Before calibration max |error| — cm (outside ±2); after the global scale alone — cm (outside); after per-ring calibration FAIL. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): upper_arm 37.29, wrist 20.08 cm.

No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): neck, shoulder, chest, underbust, waist, hip.

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| shoulder_to_hem | 57.29 | flat-lay | 52.48 | — | — | flat-lay: along the garment front from the high point shoulder (src/garmentLength.ts); vertical drop 52.48 cm |
| waist_to_hem | 17.95 | — | — | — | — |  |
| sleeve_length | 58.23 | — | — | — | — |  |

Every shoulder-to-hem definition on the calibrated mesh (`src/garmentLength.ts`): high point shoulder, vertical drop to the front hem 52.48 cm; high point shoulder, along the garment front to the hem (flat-lay length) 57.29 cm; back neck at the centre back, along the garment back to the hem 52.72 cm; shoulder point (end of the shoulder), vertical drop to the front hem 49.83 cm.

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | stage1b `stage1b/garment_mask_front.png` | 0.495 | 0.557 | FAIL | no |
| back | stage1b `stage1b/garment_mask_back.png` | 0.287 | 0.507 | FAIL | no |

Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):

| View | Normalised IoU | Mirrored | Aspect render / photo |
| --- | --- | --- | --- |
| front | 0.535 | yes | 0.52 / 1.21 |
| back | 0.387 | yes | 0.52 / 1.27 |

Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):

| Angle | Frame | Calibrated: visible | Calibrated: silhouette | Reconstructed: visible | Reconstructed: silhouette | Picture |
| --- | --- | --- | --- | --- | --- | --- |
| 0° | 0 | 0.494 | 0.557 | 0.494 | 0.557 | [turntable_0.png](../../spikes/garment-engine/out/eval/woodstock-wanderer-knit-cardi/view/turntable_0.png) |
| 90° | 40 | 0.789 | 0.872 | 0.789 | 0.872 | [turntable_90.png](../../spikes/garment-engine/out/eval/woodstock-wanderer-knit-cardi/view/turntable_90.png) |
| 180° | 80 | 0.302 | 0.526 | 0.302 | 0.526 | [turntable_180.png](../../spikes/garment-engine/out/eval/woodstock-wanderer-knit-cardi/view/turntable_180.png) |

Each picture: the stage 2 frame, the calibrated mesh in its stage 4 vertex colours on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).

Overlays: [front](../../spikes/garment-engine/out/eval/woodstock-wanderer-knit-cardi/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/woodstock-wanderer-knit-cardi/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 43.9 % as reconstructed (2744 vertices), 43.9 % after calibration.

**Mesh health** (mesh as evaluated): 11999 triangles (budget 8000–15000: within), 6258 vertices, 3 components, 1475 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

**Warnings**

- no garment loop at critical ring chest: chart agreement fails there

Evaluation time on the build machine: read 12 ms, measure 41 ms, calibrate 27 ms, grade 0 ms, view renders 921 ms.

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage1b_dress | H100 | any | 26 s | 56 s | $0.03 | $0.06 |
| stage2_video | H100 | any | 1416 s | 1434 s | $1.55 | $1.57 |
| stage4_recon[stage2] | L40S | any | 122 s | 129 s | $0.07 | $0.07 |

Total: 1564 s GPU, 2331 s wall, $1.65–$1.70 (estimate).

**Renders**

Not rendered: run 15 was rejected on review.

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

Evaluation time on the build machine: read 13 ms, measure 29 ms, calibrate 24 ms, grade 0 ms, view renders 150 ms.

Bundle: 311 KB in `spikes/garment-engine/out/eval/aalter-studio-2/`.

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | S, M, L | 5.94 s, 5.90 s, 5.87 s | [M-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-plain.png) |
| M mannequin | front | yes | S, M, L | 5.94 s, 5.90 s, 5.87 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | S, M, L | 5.91 s, 5.87 s, 5.85 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | S, M, L | 5.91 s, 5.87 s, 5.85 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | S, M, L | 4.81 s, 4.78 s, 4.74 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-side-plain.png) |
| M mannequin | side | yes | S, M, L | 4.81 s, 4.78 s, 4.74 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-side-fitmap.png) |
| XS shape | front | no | S, M, L | 5.59 s, 5.56 s, 5.53 s | [XS-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XS-plain.png) |
| XS shape | front | yes | S, M, L | 5.59 s, 5.56 s, 5.53 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XS-fitmap.png) |
| XXL shape | front | no | S, M, L | 6.01 s, 5.98 s, 5.95 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XXL-plain.png) |
| XXL shape | front | yes | S, M, L | 6.01 s, 5.98 s, 5.95 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XXL-fitmap.png) |

## How to update this document

1. Per product, the GPU run on GitHub Actions leaves `spikes/garment-engine/out/phase0/<handle>/` (stage1b/, stage2/, stage4/stage2/garment.glb, cost_summary.json). Download the artifact into that folder.
2. `pnpm build:packages && pnpm --filter @curtain/garment-spike report:bohohippychic -- --renders` evaluates every product that has a stage 4 mesh, writes the bundles to `out/eval/<handle>/`, renders sizes 8, 12 and 16 on the M mannequin (front, three-quarter and side) and the XS and XXL shapes with and without the fit map, compares the mesh with the stage 2 turntable at 0°, 90° and 180°, and rewrites this file. The hand-written part comes from `spikes/garment-engine/data/bohohippychic/phase0-written.md`.
3. Run the blind tests with five people on the blind page above, export the CSV, and record the result in `docs/STATUS.md` with the run ids.
