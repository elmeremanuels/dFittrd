# Phase 0 on bohohippychic.com.au (generated)

Generated 2026-11-08 by `pnpm --filter @curtain/garment-spike report:bohohippychic` (`spikes/garment-engine/scripts/report-bohohippychic.ts`). Do not edit by hand: re-run it after every GPU run. Renders and bundles live under `spikes/garment-engine/out/`, which is gitignored: the links to them below resolve only in a checkout where the GPU outputs are in `out/phase0/` and this script has run with `-- --renders`; elsewhere they are attached separately.

Boho Hippy Chic gave the founder consent to use its public product data and photos for this internal validation, before anything is installed on its site. Selection, AU chart and photo classification: `spikes/garment-engine/data/bohohippychic/` and `docs/research/au-size-chart.md`. Everything below that comes from a model is an estimate (AGENTS.md rule 3).

## Summary

| Product | Category | Back photo | Stage 1b | Stage 2 | Stage 4 | Chart agreement | View IoU front / back | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `azure-palm-baby-doll-dress` | dress | real | done | done | done | pass (before 0.50 cm, after 0.00 cm) | 0.90 / 0.93 | $1.54–$1.57 (no stage 1b) |
| `rosewater-blouse` (run 15 rejected on review) | top | real | failed | done | done | FAIL (before 10.85 cm, after 6.65 cm) | 0.50 / 0.69 | $1.64–$1.70 |
| `rosewater-palazzo-pants` (run 17 faulty, evaluation only on review) | bottom | real | done | done | done | pass (before 3.18 cm, after 0.00 cm) | 0.92 / 0.92 | $1.56–$1.58 (no stage 1b) |
| `crimson-wildflower-maxi-skirt` (run 17 faulty, evaluation only on review) | bottom | real | done | done | done | FAIL (before 7.57 cm, after — cm) | 0.96 / 0.92 | $1.61–$1.63 (no stage 1b) |
| `woodstock-wanderer-knit-cardi` (run 15 rejected on review) | outerwear | real | failed | done | done | FAIL (before — cm, after — cm) | 0.49 / 0.29 | $1.65–$1.70 |

## Phase 0 acceptance

| Item | State | Evidence |
| --- | --- | --- |
| Size test | needs people | Five people who did not build it must pick the smaller size, without labels, in at least 4 of 5 products on the blind page (size mode). Bundles for the test: 1 of 5 products (4 more evaluated but kept off the panel: rosewater-blouse rejected, rosewater-palazzo-pants faulty, crimson-wildflower-maxi-skirt faulty, woodstock-wanderer-knit-cardi rejected); renders made for 3. Not run with people yet. **Do not run the panel on these assets yet:** Only 1 of 5 products has a panel bundle after runs 15, 16b, 17b and 17d, accepted pending founder review: the azure babydoll (run 17b, a judgement call against run 16b); the crimson maxi skirt (run 17d) and the palazzo (run 17d) are evaluated and rendered but marked faulty (the skirt pending a founder decision on its low band; the plugin's import gate refuses its bundle), and the blouse and the cardigan were rejected on review (their stills fail at stage 1b). The dress (run 17b: no grey cap above the sleeves, nothing hanging below the hem of its stills, run 16b's see-through lower skirt and strings gone) still shows the torso at the back of the shoulder in AU 8 from the side, has a plain cream unprinted flap at one side of the hem in turntable_b frames about 82-155 and a flat, hard-edged pale rectangle beside the hem in turntable_a frames 13-31 (fully detached at frame 30, gone in one frame at 31), both fitted as a wider hem (157.7 cm against run 15's 149.5); consistency 0.4.0, re-scored on CPU, flags them as off-reference in turntable_a j19-30 and turntable_b j18-78 (frames 98-158), so its hem girth is unconfirmed. The skirt (run 17d, faulty) is closed at the hips now (no opening wider than 4 cm; run 15 was open 10.2 and 7.8 cm there, the grey hip showing), but its band sits 4 cm below our waist ring, so it has no chart girth at its one critical anchor (chart agreement fails and the plugin's import gate refuses the bundle, so it is not in the demo shop), its hem is drawn over the feet (2.2 cm above the floor, pinched to 86 cm round the ankles, foot lobes in the viewer), stage 2 drew short-lived pale side panels and a flat tongue on the floor at the hem in turntable_b frames 81-94 and a hem flare in turntable_a 1-14 (hem girth unconfirmed), its baked print is smeared, and its sizes barely differ. The palazzo's frames are right (two legs in every turntable frame) and its chart passes, but in the viewer its unstitched leg tubes drop away from the seat and our grey thighs show between them at every size, with grey shin slivers through slits low in the legs; see the run 15, 16b, 17b and 17d sections and the verdict below. (`spikes/garment-engine/data/bohohippychic/panel-hold.txt`) |
| Fabric test | needs people | Same five people, fabric mode of the same page (linen versus silk of the same garment). Not run with people yet. **Do not run the panel on these assets yet:** Only 1 of 5 products has a panel bundle after runs 15, 16b, 17b and 17d, accepted pending founder review: the azure babydoll (run 17b, a judgement call against run 16b); the crimson maxi skirt (run 17d) and the palazzo (run 17d) are evaluated and rendered but marked faulty (the skirt pending a founder decision on its low band; the plugin's import gate refuses its bundle), and the blouse and the cardigan were rejected on review (their stills fail at stage 1b). The dress (run 17b: no grey cap above the sleeves, nothing hanging below the hem of its stills, run 16b's see-through lower skirt and strings gone) still shows the torso at the back of the shoulder in AU 8 from the side, has a plain cream unprinted flap at one side of the hem in turntable_b frames about 82-155 and a flat, hard-edged pale rectangle beside the hem in turntable_a frames 13-31 (fully detached at frame 30, gone in one frame at 31), both fitted as a wider hem (157.7 cm against run 15's 149.5); consistency 0.4.0, re-scored on CPU, flags them as off-reference in turntable_a j19-30 and turntable_b j18-78 (frames 98-158), so its hem girth is unconfirmed. The skirt (run 17d, faulty) is closed at the hips now (no opening wider than 4 cm; run 15 was open 10.2 and 7.8 cm there, the grey hip showing), but its band sits 4 cm below our waist ring, so it has no chart girth at its one critical anchor (chart agreement fails and the plugin's import gate refuses the bundle, so it is not in the demo shop), its hem is drawn over the feet (2.2 cm above the floor, pinched to 86 cm round the ankles, foot lobes in the viewer), stage 2 drew short-lived pale side panels and a flat tongue on the floor at the hem in turntable_b frames 81-94 and a hem flare in turntable_a 1-14 (hem girth unconfirmed), its baked print is smeared, and its sizes barely differ. The palazzo's frames are right (two legs in every turntable frame) and its chart passes, but in the viewer its unstitched leg tubes drop away from the seat and our grey thighs show between them at every size, with grey shin slivers through slits low in the legs; see the run 15, 16b, 17b and 17d sections and the verdict below. (`spikes/garment-engine/data/bohohippychic/panel-hold.txt`) |
| Chart agreement | not met | 2 of 5 evaluated products within ±2 cm at their critical anchors after calibration (0 without a stage 4 mesh); 4 of 5 needed. After per-ring calibration this is close to 0 by construction, so also read the error before calibration: azure-palm-baby-doll-dress at chest: max \|error\| 0.50 cm before calibration, 0.00 cm after the global scale, 0 by construction with one critical anchor, 0.00 cm after calibration; rosewater-blouse at chest: max \|error\| 10.85 cm before calibration, 0.00 cm after the global scale, 0 by construction with one critical anchor, 6.65 cm after calibration; rosewater-palazzo-pants at waist, hip: max \|error\| 3.18 cm before calibration, 1.30 cm after the global scale, 0.00 cm after calibration; crimson-wildflower-maxi-skirt at waist: no girth at waist (its cloth does not reach the ring; on its own waistband 88.07 cm against the chart's 80.50); woodstock-wanderer-knit-cardi at chest: no girth at chest. |
| View agreement | needs people | The merchant must confirm that the front and back renders are recognisably their garment. IoU against the pinned stills (visible with the mannequin in front / garment silhouette alone): azure-palm-baby-doll-dress front 0.90 / 0.90, back 0.93 / 0.92; rosewater-blouse front 0.50 / 0.46, back 0.69 / 0.80; rosewater-palazzo-pants front 0.92 / 0.92, back 0.92 / 0.92; crimson-wildflower-maxi-skirt front 0.96 / 0.96, back 0.92 / 0.92; woodstock-wanderer-knit-cardi front 0.49 / 0.56, back 0.29 / 0.51. Every pinned still on this set comes from stage 1b (generated from photos on a model), so a high IoU says stages 2–4 kept what stage 1b drew, not that stage 1b drew the shop's garment. |
| Cost | met | Measured for 5 of 5 products (GPU seconds and wall time measured; dollars are list-price estimates until the Modal invoice is read): azure-palm-baby-doll-dress 1464 s GPU, 1873 s wall, $1.54–$1.57 (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included); rosewater-blouse 1544 s GPU, 2246 s wall, $1.64–$1.70; rosewater-palazzo-pants 1469 s GPU, 2115 s wall, $1.56–$1.58 (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included); crimson-wildflower-maxi-skirt 1568 s GPU, 2336 s wall, $1.61–$1.63 (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included); woodstock-wanderer-knit-cardi 1564 s GPU, 2331 s wall, $1.65–$1.70. |
| Write-up | not met | This document covers the per-product results. Chosen models and licences are in docs/research/garment-engine.md; failures and the tolerances to use from Phase 1 can only be set once the GPU runs above exist. |

Blind test page with these products pre-selected: `http://127.0.0.1:5178/blind.html?products=eval/azure-palm-baby-doll-dress` (viewer dev server, `pnpm --filter @curtain/garment-spike viewer`). It needs the bundles in `out/eval/`, so run the report with GPU outputs first. Not for the panel yet (see the size test row). Screenshot: [blind page](../../spikes/garment-engine/out/eval/blind-size-pair-1.png).

## Runs 10–17d timeline

Six GPU runs on Modal (GitHub Actions): the spike's synthetic shirt dress `aalter-studio-2` (runs 10, 11), the shop's `azure-palm-baby-doll-dress` (runs 12–14), and all five shop products (run 15). Costs are the runs' own `cost_summary.json` records: GPU seconds measured, dollars list price × GPU seconds (estimates, GPU only; no Modal invoice read yet). Details per run are in `spikes/garment-engine/modal/README.md` ("after run N" sections).

| Run | Product, job | What it tested | What we saw | What changed after it | GPU s | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | `aalter-studio-2`, synthetic stills, export 0.1.0 (bare-mannequin control) | First end-to-end stage 2 (Wan2.2-Fun-A14B-Control, 40 steps) + stage 4 (gsplat 2DGS + TSDF) on Modal | The dress turned into trousers between the pinned frames (frames 20, 60, 100), and the product name appeared as text in frame 20. Stage 4 mask IoU 0.90 on the generated frames against 0.99 on the synthetic frames | Export 0.2.0: a closed garment proxy in the control video, neutral prompts without title or brand, consistency metric v1 | 1661 | $1.70–1.76 |
| 11 (11a) | `aalter-studio-2`, export 0.2.0 (proxy control) | The proxy control | The dress stayed a dress in every turntable frame, no text. But consistency v1 flagged 233 of 243 frames (a cream dress on a light-grey studio: v1 lost its light parts), stage 4 trained on a poor foreground target (mask IoU 0.83 / 0.84), and every motion frame had artefacts | Garment segmentation of the generated frames, consistency v2 and v3, stage 4 trains on garment masks, export 0.3.0 (bare masks, no still pinned in the motion clip) | 1775 | $1.79–1.82 |
| 12 | `azure-palm-baby-doll-dress`, export 0.2.0, FASHN maskless on the bare mannequin, `--accept-failed-dress` | First shop product: dressing stills from photos on a model (stage 1b) | FASHN transferred the print and the puffed sleeves, but drew a romper (two legs of fabric, open front), and the back still was a second front. Stage 2 copied that faithfully. Stage 4 mask IoU 0.97 was against foreground masks (garment + mannequin), not comparable with run 14 | Export 0.4.0: the stills are generated on the proxy-dressed mannequin, FASHN masked with our label map, a Qwen engine, QA v2 (leg gap, skirt cover, true back) | 1531 | $1.62–1.73 |
| 13 | same product, export 0.4.0, stage 1b only, FASHN and Qwen | Both dressing engines on the proxy-dressed target | FASHN: the right garment on both views (knee-length babydoll, the shop's pastel print on cream, puffed sleeves, tiered skirt), shorter and narrower than the proxy. Qwen: a solid blue dress, because the prompt took "blue" from the product name "Azure". QA 0.3.0 failed every still; its score ranked Qwen's blue front best | Export 0.5.0 takes the colour from the photo's pixels, QA 0.4.0–0.5.0 adds print fidelity, a leg gap counted only above the garment's own hem and a silhouette tolerance band, and picks the engine (on run 13's stills: FASHN on both views) | 189 | $0.21–0.58 |
| 14 | same product, job `azure-palm-baby-doll-dress-6d2f2611a144` (export 0.4.0), FASHN only, `--accept-failed-dress` | The whole chain on a shop product: stage 1b → stage 2 with the proxy control → stage 4 on garment masks | Stills: FASHN's babydoll again; QA 0.3.0 failed them on the old silhouette IoU (0.835 / 0.828 < 0.85) and 6 leg-gap rows on the front (QA 0.4.0 replaced that IoU by a tolerance band and counts leg-gap rows only above the hem; run 14's stills were not re-scored with it). Stage 2: the turntable keeps the print, the puffed sleeves, the waist tie and the tiered skirt in every view; consistency 0.3.0 flagged 31 of 243 frames (turntable_a 35–37 and 43–45, turntable_b 34–47, all side views, and 70–72; motion 73–80), 0 artefact frames. The prompt still said "a blue … dress" (export 0.4.0 predates the colour fix); the pinned stills carried the print anyway. Stage 4: mask IoU 0.925 train / 0.917 holdout, 11,999 triangles. The evaluation below | This write-up: the evaluation tooling fixed on the first real mesh (next section) | 1493 | $1.57–1.63 |
| 15 | all five shop products, export 0.6.0 (proxy 0.3.0, prompts 0.3.0, stage 1b QA 0.6.1), GitHub Actions run 42402554810, code at 91ed5b2, `--accept-failed-dress` | Every category: dress, blouse, trousers, skirt, cardigan | Azure babydoll (`de3bc1eeb3e0`): stage 1b passed, stills and frames right (puff sleeves, print, babydoll, hem higher than run 14). Maxi skirt (`9a2b6e7f37ce`): stage 1b failed the front on the provisional silhouette score (0.864, overridden); waistband and print right, but at the hips the stills are narrower than the mannequin and the frames open into a slit at the side (the founder: "see the hips"). Blouse (`129498b959df`): FASHN stills torn (print patches with the mannequin through them, the back a pale blotchy shirt), stage 2 frames with black panels on the back and side. Cardigan (`56e306f6033b`): front a shrunken bolero, back a white sleeveless top with holes, frames with black and grey halves and a changing garment. Palazzo (`b85affd79b61`): FASHN drew a closed skirt in both views (legs merged in 259 of 259 rows); the type gate (QA 0.6.1) stopped it before stage 2. Blouse and cardigan reached stage 2 because `--accept-failed-dress` overrides the silhouette and fidelity failures (3,108 GPU s, $3.29–3.40 spent on two rejected products) | This section: stage 4t, the drape log and the evaluation on the two good products; the hem scan past openings, the waistband girth and the viewer's waistband pins for the skirt; blouse, palazzo and cardigan marked rejected in `review.json`. After the run, drape-prior P0 (D15 ease fix) changed the blouse, skirt and cardigan proxies by 1–2 cm, so their current exports are not run 15's controls | 6295 | $6.66–6.93 |
| 16a, 16b | azure only for 16b (same job `de3bc1eeb3e0`, export 0.6.0); 16a was stage 1b alone for all five (QA 0.9.0), 16b recomposed azure's 16a FASHN stills on CPU with stage 1b QA 0.10.1 (`--recompose-dress`, pixel hashes `d4cbc556…` / `695c5145…` = the reviewed stills) and ran stage 2 + stage 4 | Whether stills without the grey shoulder caps (present in runs 14, 15 and 16a) give frames and an asset without them | Stills: the caps are covered by the garment's own pixels, but the recompose grew the garment mask along the whole outline, not only at the caps (front +1,557 px, back +1,312 px against run 15's stills; only 706 / 539 of them in the cap rows 200–280, about 225 per view at the hem rows 520–560), and so keeps a thin cream tail hanging below the back hem at the mannequin's left (the cut tie string already in the raw FASHN back, which run 15's composite clipped; flagged in no review of the stills). Stage 2: no grey cap above the sleeves in any turntable frame (grey shoulder pixels per frame 357 → 78 on average, the rest at the neck edge), no black panels, no flicker; but the tail grows into a plain cream, unprinted flap swinging out at that side of the hem in turntable_b frames about 84–159 (about 75 of 160 frames, half the turn; up to 36 px, about 10 cm, at 104–108), and in turntable_a frames about 32–56 the lower skirt on the mannequin's right turns into a translucent panel with the grey leg showing through and ragged tips below the hem. Consistency 0.3.0 flagged 31 of 243 frames (run 15: 41). The motion clip (not used by stage 4t) again shows a sleeveless strappy dress, as in run 15 | Kept as the azure panel bundle until run 17b (section "Run 16b" below); the hem flap is a stage 1b still defect (the 0.10.1 recompose) that stage 2 amplified, and the translucent hem panel a stage 2 defect, both open | 1503 (stages 2 + 4 only; stage 1b: 34.6 s in run 16a) | $1.59–1.62 (+ about $0.04 for 16a's azure stage 1b) |
| 17a, 17b | 17a: stage 1b only, draw plans (QA 0.11.0) for skirt, blouse, cardigan; 17b: azure stage 2 + 4 again (same job `de3bc1eeb3e0`) on run 16a's FASHN stills recomposed with QA 0.12.0 (the back's 49 px cut tie string left out, pixel hashes `d4cbc556…` / `c3e193ed…`), plus 8 more FASHN skirt backs (seeds 46–53, front fashn@44 and 17a's back fashn@43 kept) | Whether the string below azure's back hem seeded 16b's hem flap, strings and see-through panel; whether a skirt back has the front's waistband and tier seam | Azure: the see-through lower skirt with the grey leg through (turntable_a 32–56) and the strings (40–80) are gone; the cream flap in turntable_b 84–155 is unchanged (within 1–4 px of 16b's width per frame), and a new flat, hard-edged pale rectangle stands beside the hem in turntable_a 13–31 (up to ~10 cm, fully detached at 30, gone in one frame at 31); hem girth 157.7 cm (16b 155.9, 15 149.5), holdout IoU level with 16b. Skirt: 5 of 9 backs pair with the front (auto-pick 49), but none has the pale pink smocked waistband and a clean hem: 49 has the exact tier seam but a red band and a hem 14–66 px wider than the front's, 50 the band and a dark strip below the hem | Run 17b is the azure panel bundle as a judgement call against 16b (two different visible defects; section "Run 17b" below), accepted pending founder review, its flap and panel open; no skirt back pinned, a further stage-1b-only draw proposed | 17a 930 (stage 1b, three products); 17b 1,464 (azure stages 2 + 4) + 66 (skirt stage 1b) | 17a $1.02–1.34; 17b $1.54–1.57 + $0.07–0.18 |
| 17c, 17d | 17c: skirt stage 1b only, 16 more FASHN backs beside the reviewed front fashn@44 (QA 0.12.0); 17d: stage 2 + 4 for the skirt (job `99ab3ce9327b`, front fashn@44 + back fashn@63 from 17c, recomposed, hashes `8909a1c0…` / `14b4b1e6…`) and the palazzo (job `b85affd79b61`, run 16a's Qwen front + back, approved by the founder with the invented pocket flap and the darker print, hashes `d519f925…` / `a9a3ce42…`) | Whether stills that are as wide as the mannequin at the hip give a skirt closed at the hips; whether the Qwen palazzo stills give two separate legs in video and asset | Skirt: the hips are closed in every frame and in the asset (no opening > 4 cm; run 15: 10.2 and 7.8 cm), pale band front and back; the hem is drawn over the feet (hem 2.2 cm above the floor, pinched to 86 cm round the ankles), short-lived flaps in turntable_b 81–94 and a hem flare in turntable_a 1–14, the band sits 4 cm below our waist ring (no chart girth: chart agreement fails, the plugin's import gate refuses the bundle). Palazzo: two legs in every turntable frame (touching to a seam line in a 75–76, b 155–156), chart pass (+3.18 cm before calibration, 1.30 after the global scale), but in the viewer the unstitched leg tubes drop away from the seat and our grey thighs show between them, grey shin slivers show through slits low in the legs, and the baked print is a patchwork | Skirt faulty pending a founder decision on the low band (import gate refuses it; 1 of 5 panel bundles, azure); palazzo faulty; consistency 0.4.0 re-scored on CPU for the jobs Modal scored 0.3.0 (azure 17b's flaps now flagged in the report: a j19–30, b j18–78) | 3037 (17d) | $3.17–3.21 (17d) |
| **Total, runs 10–15** | | | | | **12943** | **$13.55–14.45** |

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

## Run 16b (8 Nov 2026): azure from stills without grey shoulder caps

Run 16b re-ran stage 2 (Wan2.2-Fun-A14B-Control, same seeds 43/44/45, same control proxy, same job `azure-palm-baby-doll-dress-de3bc1eeb3e0`) and stage 4 (2DGS) for the azure babydoll only, pinned to run 16a's FASHN stills recomposed on CPU with stage 1b QA 0.10.1: the grey mannequin shoulder caps that runs 14, 15 and 16a had above the puff sleeves are covered with the garment's own pixels (`conform_edges`; the stills' pixel hashes match the reviewed ones). The raw FASHN outputs are the same images as run 15's (raw back differs by a mean of 0.22 in 8 bit, a re-encode), but the recomposed stills differ from run 15's at the hem as well as at the caps: the 0.10.1 composite adds 1,557 (front) and 1,312 (back) garment pixels and drops 14 / 7; only 706 / 539 of the added pixels lie in the cap rows (200–280), about 225 per view at the hem rows (520–560, x 121–356), and on the back still they keep a thin cream tail hanging below the hem at the mannequin's left (the garment now reaches row 539 against 528; the cut tie string that `modal/README.md` lists as cosmetic). It is in `raw/back_fashn.png`, `recomposed/back_fashn.png` and `stage1b/back.png`, not in run 15's `back.png`, and none of the reviews of these stills flagged it. So run 15 against run 16b is not a test of the caps alone. The job is now `out/phase0/azure-palm-baby-doll-dress`; run 15's is kept as `-run15`, run 14's as `-run14`. Stage 4t 0.3.0 (97 s CPU), the drape log and `report:bohohippychic -- --renders` ran on it exactly as on run 15; the report evaluates runs 14 and 15 next to it with the same tooling.

### What the frames show (all 160 turntable frames and the motion clip looked at, next to run 15's)

- **Shoulders: fixed.** Run 15's frames show the grey cap above both sleeves from the front (0–20, 140–159) and the back (60–100); run 16b's show print there in every view (`compare/run15-vs-current-frames-shoulders.png`). Measured roughly (bare-mannequin control mask minus the garment mask, rows 215–262, neck columns left out): 357 grey pixels per frame on average in run 15, 78 in run 16b (front frame 0: 259 → 11; back frame 80: 333 → 72). In stage 4t the cap texels sampled from a frame rise from 47.5 % to 79.8 % (the rest is diffusion fill): in run 15 more than half the cap print was synthesized over pixels that were grey in the frames.
- **Shoulders, residual:** no grey cap above the sleeves in any turntable frame; the 78 px per frame that remain sit at the neck edge (the V-neck opening and the upper back near the neck in the side views, e.g. frame 128), not on the caps.
- **New: a cream flap at the side hem, seeded by the stage 1b back still.** Turntable_b starts from the back still with its cream tail below the hem (frame 80 shows it at the same place), and from frame 84 Wan grows it into a plain cream, unprinted panel swinging out from the hem at the mannequin's left, through frame 159: about 75 of 160 frames, half the turn. Against run 15's garment masks 20–40 rows above the hem the skirt is wider by +15 px at frame 84, +25 to +29 at 88–100, +31 at 104 (36 px at the most, about 10 cm, at 104–108), +18 to +27 at 112–136, +15 at 144–148, +12 at 152 and +7 at 156, against 0 to ±5 in frames 0–80; the mask area is +1,700 to +3,400 px from frame 84 on. The stage 2 segmentation keeps it as garment (`compare/run15-vs-current-frames-hem-105-145.png`, `compare/run15-vs-current-masks-hem.png`). Run 15 has a smaller one of the same colour in frames 20–30 and 125–145. It is not the print, so it reads as a lining or a stray panel. Its origin is stage 1b (the 0.10.1 recompose keeping the tail), which stage 2 amplifies; the fix belongs there: limit `conform_edges` to the rows where our body runs past the garment (the caps), or trim fragments hanging below the hem in the QA, and re-review the stills at the hem as well as at the shoulders. Stage 4t fits it: the hem girth is 155.9 cm against run 15's 149.5 (+6.4), the hem flare 1.374 against 1.325, the hem line (median per 10°) 0.9 cm lower, and the mesh at 90° and 180° bulges past the frame at the back of the hem (blue in `compare/run15-vs-current-turntable-90.png`); in the viewer at M it shows only as a slightly longer back hem. Not filled or trimmed.
- **New, missed in the first pass: a translucent, ragged hem panel.** In turntable_a frames about 32–56 (front to back through the mannequin's right side) the lower skirt on the mannequin's right turns greyish and see-through: the grey leg shows through the printed cloth (32–42), and ragged tips hang below the hem at 40, 46 and 50 (crops in `compare/run15-vs-current-hem-32-56.png`). Run 15 has nothing like it at 32–40 and only a smaller version at 46–50. The mask outline does not change there (hem width within ±1 px of run 15's), so only looking finds it. The stage 4t per-view IoU puts most of run 16b's loss here: frames 40–80 0.923 / 0.906 (visible / silhouette) against run 15's 0.939 / 0.920, while frames 80–120, where the flap is, are level (0.924 / 0.904 against 0.925 / 0.903); 0–40 are slightly better (0.910 / 0.894 against 0.905 / 0.884) and 120–160 slightly worse (0.895 / 0.877 against 0.900 / 0.882). The stage 2 frame in `compare/run15-vs-current-turntable-90.png` (frame 40) shows the panel too.
- **No black panels, no flicker:** the darkest frame has 129 pixels below luminance 25 (run 15: 159), consecutive frames differ by 2.94 on average (max 4.02 at 136; run 15: 3.02, max 4.05), the two seams 3.21 / 2.47 (run 15: 3.28 / 2.56). Consistency 0.3.0 flags 31 of 243 frames (run 15: 41): the same side views 114–127 and 35–37 on garment IoU (0.77–0.82), frames 17–18 on skirt cover, frame 8 on 4 leg-gap rows of 61 (looked at: a closed skirt whose hem steps up at the button placket between the legs, not two legs), motion 53 and 71–80 outside the envelope. Frame 22 has skirt cover 0.094 on 4 skirt-zone rows (side view, below the 20-row minimum, not flagged).
- **The motion clip** (81 frames, not used by stage 4t or the bundle) again draws a sleeveless strappy sundress, not this garment, and fades out at the end, as in run 15 (`compare/run15-vs-current-motion.png`); consistency v1 now flags 68 of its 81 frames (run 15: 4).

### Measured, run 16b against run 15 and run 14 (stage 4t, same tooling)

| | Run 16b | Run 15 | Run 14 |
| --- | --- | --- | --- |
| Stage 1b | QA 0.10.1 pass (recomposed 16a stills, caps covered) | QA 0.6.1 pass (grey caps, not flagged then) | QA 0.3.0 FAIL, overridden |
| Chest by the tape before calibration | 101.26 cm (−0.74 against 102), global scale 1.007 | 101.27 (−0.73) | 101.15 (−0.85) |
| Waist / hip (not fitted by the block) | 85.59 / 113.48 | 85.25 / 112.88 | |
| Graded chest against the printed table, AU 8–16 | −2 / −1 / 0 / +1 / 0 | same | |
| Flat-lay shoulder to hem (printed 91) | 89.79 (−1.21); graded −2.22 / −1.22 ×4 | 89.98 (−1.02) | 92.54 |
| Vertical drop | 81.25 | 81.64 | 84.42 |
| Hem line above the floor (median per 10°) / centre front | 56.46 / 57.35 | 57.35 / 56.96 | 55.46 / 54.18 |
| Hem girth / flare | 155.9 cm / 1.374 | 149.5 / 1.325 | |
| Pinned stills IoU visible | front 0.901, back 0.924 | 0.889, 0.938 | 0.904, 0.933 |
| Turntable 0° / 90° / 180°, visible (silhouette) | 0.898 (0.898), 0.906 (0.843), 0.922 (0.919) | 0.885 (0.883), 0.929 (0.860), 0.932 (0.930) | |
| Holdout (32 frames) visible / silhouette | 0.9127 / 0.8956 | 0.9176 / 0.8986 | 0.9009 / 0.8841 |
| Train visible / silhouette | 0.9128 / 0.8951 | 0.9173 / 0.8972 | 0.9008 / 0.8828 |
| Shop photo (indicative) | 0.747 / 0.663 | 0.740 / 0.666 | |
| Clearance | 0 of 5,676 inside; closest 3.33 mm by the exact distance, **2 vertices below the 4 mm clearance** (2 rays the push-out left unresolved), 0 below 3 mm | 0 of 5,661; closest 4.0 mm | 0 of 5,778; 4.0 mm |
| Texture: chart texels sampled / shoulder caps sampled | 95.4 % / 79.8 % | 93.6 % / 47.5 % | |
| Texture holdout MAE (one mean colour) | 20.65 (23.34) | 21.86 (24.82) | 21.0 (24.3) |
| Mesh, bundle | 11,013 triangles, 3 components; 755 KB | 10,983; 750 KB | 11,216; 765 KB |
| 2DGS on the same video | 21.5 % of the cloth more than 3 mm inside, chest 98.37 (−3.63), turntable visible 0.63 / 0.76 / 0.65 | 24.7 %, 97.68, 0.64 / 0.76 / 0.63 | |
| GPU (estimate) | 1,503 s, $1.59–1.62 for stages 2 + 4 only (the job's `cost_summary.json` counts 2 stages); stage 1b ran in run 16a (34.6 s, about $0.04) and was recomposed on CPU here, so the product's chain is about 1,537 s, about $1.63–1.66 | 1,576 s, $1.66–1.71 (3 stages, stage 1b 25.6 s included) | 1,493 s, $1.57–1.63 |

Drape prediction P0 in shadow (same cell, same prediction; run 16b's job has its own prediction.json, run 15's was predicted afterwards): hem flare 1.35 against 1.374 (0.20 σ), hem height −0.81 cm (0.41 σ; run 15 +0.08), flat-lay −1.21 (0.61 σ; −1.02), underbust ease +10.8 cm (1.35 σ; +9.0, 1.13 σ), sleeve +32.5 (4.06 σ, unchanged), hem girth +7.0 % (+2.6 %); within 1.28 σ 3 of 5 informative rows (run 15: 4 of 5, the underbust row crosses 1.28 σ). P0 shape against the mesh: Chamfer **1.871 cm** (run 15 1.672), F 0.60 at 1 cm (0.70); shoulders 1.11 (1.13), bodice 0.81 (0.75), skirt **1.06 (0.70)**. The skirt's worse Chamfer and the hem rows are the side flap above. Not a saving either: run 16b's 1,503 GPU s leave out stage 1b, run 15's 1,576 include it; the stage 2 and 4 seconds are about the same (1,503 against 1,550).

### What the run 16b asset looks like (every render looked at; `out/eval/azure-palm-baby-doll-dress/compare/run15-vs-current-*.png`, run 15 on top, same cameras)

- **Viewer, M, AU 8 / 12 / 16, front, three-quarter, side; XS, XXL; fit map:** the same dress as run 15's: closed cloth, print, puff sleeves with gathered cuffs, sizes visibly different, fit map AU 8 red at the chest, 12 light blue, 16 blue. The shoulder tops are closed in both (stage 4t's shoulder-cap rays closed run 15's too), but run 16b's cap print comes from the frames rather than from fill. **Still there in both:** the grey patch at the back of the shoulder next to the neck in AU 8 from the side (about the same size), the straight side view, and on XXL AU 8 (−30.7 cm at the chest) draped loose without strain. Run 16b's back hem hangs slightly lower from the three-quarter view.
- **Turntable overlays** (`run15-vs-current-turntable-0/90/180.png`): at 0° the run 15 frame shows grey caps above both sleeves, run 16b's none; both meshes have a dark smudge in the baked texture on the back of the left sleeve head at 180° (in both runs); at 90° run 16b's mesh hem flares out at the back past the frame (the flap seen in other frames).
- **Stills** (`run15-vs-current-stills.png`): the same FASHN drawing; run 16b's front and back have print where run 15's showed grey caps.

**Decision:** run 16b replaces run 15 as the azure panel bundle. It removes the defect a person saw (grey caps in the stills and frames), which run 15's asset only hid by synthesizing the cap print; it measures the same at the chest (−0.74 against −0.73 cm) and on the printed table, and its texture is closer on the held-out frames. Mixed: the pinned stills (front 0.901 against 0.889, back 0.924 against 0.938). Worse: the holdout IoU by 0.005 / 0.003 (most of it in frames 40–80, the translucent hem panel), turntable IoU at 90° (0.906 / 0.843 against 0.929 / 0.860) and 180° (0.922 against 0.932), the hem (the cream side flap: hem girth +6.4 cm, hem line −0.9 cm, flat-lay −0.19 cm, P0 skirt Chamfer 0.70 → 1.06 cm), and clearance (2 vertices at 3.3 mm instead of ≥ 4 mm). Two visible defects are new and open: the cream flap, which the stage 1b back still already seeds (a tail below the hem kept by the 0.10.1 recompose), and the translucent hem panel with the grey leg showing through in turntable_a 32–56 (stage 2). They are flagged here, in `review.json` and in `panel-hold.txt`, not repaired or filled. Both stills need a re-review at the hem before the founder signs off. Run 15 stays in `-run15` for comparison.

## Run 17b (8 Nov 2026): azure again without the cut string; the skirt's extra backs

Run 17b re-ran stage 2 (same seeds 43/44/45, same control proxy, prompt and job `azure-palm-baby-doll-dress-de3bc1eeb3e0`) and stage 4 for the azure babydoll, pinned to run 16a's FASHN stills recomposed on CPU with stage 1b QA 0.12.0. The front still is pixel-identical to run 16b's (`d4cbc556…`); the back still differs from 16b's only by the 49 px cut tie string below the hem at the mannequin's left (rows 527–539, columns 157–162), which 0.12.0 leaves out (pixel hash `c3e193ed…`; the recompose printed the trim as a warning). The run tested whether that string seeded run 16b's cream hem flap (turntable_b 84–159) and the strings in turntable_a 40–80, and whether the see-through lower-skirt panel in turntable_a 32–56 goes with it. The job is now `out/phase0/azure-palm-baby-doll-dress`; run 16b's is kept as `-run16b`, run 15's as `-run15`, run 14's as `-run14`. Stage 4t 0.3.0 (93 s CPU), the drape log and `report:bohohippychic -- --renders` ran on it exactly as on run 16b; the report now lists run 16b as an earlier run too (`-run16b` is matched by the earlier-runs scan). Side by side pictures, run 15 / 16b / 17b in rows, same frames and crops: `out/eval/azure-palm-baby-doll-dress/compare/run15-16b-17b-*.png`; 16b against 17b, same cameras: `compare/run16b-vs-current-*.png`; run 16b's own compare pictures are backed up outside the repo.

### What the frames show (all 160 turntable frames looked at next to runs 15 and 16b)

- **Turntable_a 32–56: the see-through panel is gone.** At 32–42 run 16b's lower skirt on that side was greyish and translucent with the grey leg showing through, with ragged tips below the hem at 40, 46 and 50; run 17b's cloth there is opaque and printed, with a clean hem, cleaner than run 15's too (which had smaller tips at 46–50) (`run15-16b-17b-frames-a-32-56.png`). So the panel was conditioned by the back still (turntable_a ends on it), most likely the string; stage 2 alone did not have to draw it.
- **Turntable_a 60–80: the string is gone.** Run 16b's dangling string at the hem (72–80, and the still at frame 80) is not in run 17b (`run15-16b-17b-frames-a-60-80.png`, `run15-16b-17b-stills-hem.png`).
- **Turntable_b 84–155: the cream flap is still there, the same size.** It was not seeded by the string alone. Against run 15's garment masks (20–40 rows above the hem) run 17b's skirt is wider by +10 px at frame 82, +20 to +25 at 85–104, +30 at 106–108, +21 to +26 at 110–136 and +7 to +16 at 140–155, within 1–4 px of run 16b's widths at every frame (+10 to +29); the mask area is +1,100 to +2,700 px. By eye it is a little less opaque than run 16b's (at 116–128 run 16b showed a solid cream lining edge, run 17b a pale flared panel whose print fades out), but it is the same plain, unprinted flap swinging out at that side of the hem (`run15-16b-17b-frames-b-84-152.png`, `run15-16b-17b-hem-b-96-128-zoom.png`, `run15-16b-17b-masks-hem.png`). What is left in the back still that run 15's did not have: 1,265 garment px added along the outline (222 of them in the hem rows 500–535, 129 in rows 525–530 across the hem, the hem 1–4 rows lower, and its corner at the same side, columns 151–160). Whether that hem corner seeds the flap is not shown; the next test would be a back still with run 15's hem (no new GPU run proposed for it yet).
- **New: a flat, hard-edged pale rectangle beside the hem in turntable_a 13–31.** About 19 frames (front to side) show a flat, square-edged, unprinted pale pink-cream rectangle standing out beside the hem at the image's left, partly detached from the skirt at 16–20; a fainter one shows at the right edge at about 20–28 (mask +9 to +15 px against 16b there). At frame 30 it floats **fully detached** from the skirt: in the garment mask, row 520 runs 129–151, then background, then 170–313 (a gap of 18 px; 30 px at row 527, 1–2 px at row 500), and the masks still count it as garment. At frame 31 it is **gone in one frame**: the left mask edge jumps from 129 to 170–173 (41–51 px depending on the row). It reads like a floating billboard, about as objectionable as run 16b's see-through panel (`run15-16b-17b-frames-a-08-32.png`, `run15-16b-17b-hem-a-16-28-zoom.png`, full-size 2x crop of frames 26–31: `run15-16b-17b-hem-a-26-31.png`). The masks keep it as garment: +8 px wider than run 15 at frame 13, +14 to +25 at 16–25, +30 to +39 at 26–30 (about 10 cm at 28), against −11 to +2 px in run 16b. Run 15 had only a faint streak there at frame 28. Same seed and same front still as run 16b, so it comes from stage 2 conditioned on the changed back still at the clip's end; the front still has a cream, unprinted corner at that side of its hem (FASHN's, in runs 15, 16b and 17b alike, frame 0), which is the likeliest thing it grew from. Consistency 0.3.0 flags frame 18 on skirt cover (0.866) and not the panel.
- **Shoulders: as run 16b.** No grey cap above the sleeves in any frame; grey shoulder pixels per frame (bare-mannequin mask minus garment mask, rows 215–262, neck columns left out; this measurement, not the 16b one) 342 in run 15, 66 in run 16b, 67 in run 17b, the rest at the neck edge (`run15-16b-17b-frames-shoulders.png`).
- **No black panels, no global flicker** (a local 41–51 px jump at the panel's edge from frame 30 to 31, see above, which the mean frame difference cannot see): darkest frame 142 px below luminance 25 (16b: 129), consecutive frames differ by 2.91 on average (max 3.96 at 136; 16b 2.93, 4.02), seams 3.13 / 2.42 (3.21 / 2.47). Consistency flags 30 of 243 frames (16b: 31): turntable_a 18 and 34–37, turntable_b 114–127 (the same side views on garment IoU), motion 53 and 71–80. The motion clip (not used) is the same strappy sundress as before.

### Measured, run 17b against runs 16b and 15 (stage 4t, same tooling)

| | Run 17b | Run 16b | Run 15 |
| --- | --- | --- | --- |
| Stage 1b | QA 0.12.0 pass (16a stills recomposed, string left out) | QA 0.10.1 pass | QA 0.6.1 pass |
| Chest by the tape before calibration | 101.50 cm (−0.50 against 102), global scale 1.005 | 101.26 (−0.74), 1.007 | 101.27 (−0.73) |
| Waist / hip / underbust (not fitted by the block) | 85.59 / 113.14 / 95.46 | 85.59 / 113.48 / 94.83 | 85.25 / 112.88 / 93.00 |
| Flat-lay shoulder to hem (printed 91) | 90.00 (−1.00) | 89.79 (−1.21) | 89.98 (−1.02) |
| Vertical drop | 81.64 | 81.25 | 81.64 |
| Hem line above the floor (median per 10°) / centre front | 56.56 / 56.96 | 56.46 / 57.35 | 57.35 / 56.96 |
| **Hem girth / flare** | **157.7 cm / 1.394** | 155.9 / 1.374 | 149.5 / 1.325 |
| Pinned stills IoU visible | front 0.900, back 0.925 | 0.901, 0.924 | 0.889, 0.938 |
| Turntable 0° / 90° / 180°, visible (silhouette) | 0.896 (0.898), 0.915 (0.857), 0.923 (0.920) | 0.898 (0.898), 0.906 (0.843), 0.922 (0.919) | 0.885 (0.883), 0.929 (0.860), 0.932 (0.930) |
| Holdout (32 frames) visible / silhouette | 0.9119 / 0.8951 | 0.9127 / 0.8956 | 0.9176 / 0.8986 |
| Train visible / silhouette | 0.9111 / 0.8938 | 0.9128 / 0.8951 | 0.9173 / 0.8972 |
| Per-view IoU, all frames, 0–40 / 40–80 / 80–120 / 120–160 (visible) | 0.900 / 0.923 / 0.922 / 0.901 | 0.910 / 0.923 / 0.924 / 0.895 | 0.905 / 0.939 / 0.925 / 0.900 |
| Shop photo (indicative) | 0.744 / 0.666 | 0.747 / 0.664 | 0.740 / 0.666 |
| Clearance | 0 of 5,671 inside; closest 3.17 mm, **2 vertices below 4 mm** (2 rays unresolved), 0 below 3 mm | 0 of 5,676; 3.33 mm, 2 below 4 mm | 0 of 5,661; 4.0 mm |
| Texture: chart texels sampled / shoulder caps sampled | 95.4 % / 82.7 % | 95.4 % / 79.8 % | 93.6 % / 47.5 % |
| Texture holdout MAE (one mean colour) | 20.79 (23.29) | 20.65 (23.34) | 21.86 (24.82) |
| Mesh, bundle | 11,002 triangles, 3 components; 751 KB | 11,013; 755 KB | 10,983; 750 KB |
| GPU (estimate) | 1,464 s, $1.54–1.57 for stages 2 + 4 (stage 1b: run 16a's, recomposed on CPU) | 1,503 s, $1.59–1.62 | 1,576 s, $1.66–1.71 (3 stages) |

Drape prediction P0 in shadow (same cell, same prediction): hem flare 1.35 against 1.394 (0.37 σ), hem height −0.71 cm (0.36 σ), length −1.0 cm, underbust ease +11.5 cm (1.43 σ), sleeve +32.5 (4.06 σ), hem girth +8.2 % (16b +7.0 %, 15 +2.6 %); within 1.28 σ 3 of 5 informative rows (as 16b). P0 shape against the mesh: Chamfer **1.916 cm** (16b 1.871, 15 1.672), F 0.59 at 1 cm (0.60, 0.70); shoulders 1.12 (1.11), bodice 0.83 (0.81), skirt **1.13 (1.06; 15 0.70)**. The hem rows and the skirt Chamfer carry both side flaps now.

### What the run 17b asset looks like (every render looked at; `compare/run16b-vs-current-viewer-*.png`, `compare/run16b-vs-current-turntable-*.png`, run 16b on top)

- **Viewer, M, AU 8 / 12 / 16, front, three-quarter, side; XS, XXL; fit map:** the same dress as run 16b's, closed cloth, print, puff sleeves, sizes visibly different; fit map AU 8 red at the chest. From the three-quarter view both back hems flare out a little at the side; run 17b's no more than run 16b's. **Still there:** the grey patch at the back of the shoulder next to the neck in AU 8 from the side, the straight side view, XXL AU 8 draped loose.
- **Turntable overlays:** at 90° both meshes bulge past the frame at the back of the hem (blue), run 17b's slightly less (0.915 against 0.906 visible); at 0° and 180° the same as 16b.

**Decision: run 17b replaces run 16b as the azure panel bundle, accepted pending founder review. 17b over 16b is a judgement call between two different visible defects (16b: the grey leg through a see-through lower skirt in about 25 frames plus strings; 17b: a flat panel floating beside the hem in about 19 frames, detached at 30 and gone in one frame at 31); neither is panel-clean; the founder chooses.** For it: two of run 16b's three visible frame defects are gone (but a new one of comparable weight has come) (the see-through lower skirt with the grey leg through and the ragged tips in turntable_a 32–56; the string in 40–80), so no frame shows our grey leg through the cloth any more; its stills are the reviewed 0.12.0 stills with nothing hanging below the hem; the chest (−0.50 against −0.74 cm), the flat-lay length (−1.00 against −1.21 cm) and the 90° turntable view are closer. Against it: the cream flap in turntable_b is unchanged, a new flat pale rectangle stands out beside the hem in turntable_a 13–31 (fully detached at 30, gone in one frame at 31), and so the hem girth is 157.7 cm (16b 155.9, run 15 149.5), the P0 skirt Chamfer 1.13 cm, and frames 0–40 lose 0.01 IoU; the holdout IoU is level with 16b (−0.0008) and both stay 0.005 below run 15; 2 vertices are still 3.2 mm from the mannequin; the texture MAE is 0.14 worse. Run 15 keeps the closest hem but has the grey shoulder caps (synthesized over by its asset). None of the three is panel-clean. The string hypothesis is half confirmed: the string seeded the turntable_a strings and, most likely, the see-through panel; it did not seed the turntable_b flap. Run 16b stays in `-run16b` for comparison.

### Skirt: stage 1b, 8 more FASHN backs (run 17b, QA 0.12.0, 66 GPU s, $0.07–0.18)

The draw plan kept the reviewed front `fashn@44` (`8909a1c0…`) and run 17a's back `fashn@43` and drew backs 46–53; run 17a moved into `stage1b/history/`. QA and the pair checks: backs 43, 46, 47, 49 and 50 pass and pair with the front (auto-pick 49); 48, 51 and 52 fail torso cover (0.840, 0.863, 0.901 < 0.92), 53 fails print fidelity and view colour (Delta E 11.8 / 9.7). Every back looked at at 1x and 2.5–4x next to the front and both shop photos, the waistband and the smocked tier seam measured (pale pink pixels per row inside the garment mask; the tier band's centre row on the central columns):

| Back | Waistband (pale share of the top 18 rows; front 0.47–0.53) | Tier seam row (share of the length from the waistband; front 593, 0.636) | By eye |
| --- | --- | --- | --- |
| fashn@49 (auto-pick) | 0.06–0.08: a gathered red band with pale flecks, no pale pink smocking, no drawstring | **590 (0.630)** | clean: hem level with the front's (row 726), no tail, hole or grey belly; print and smocked tier band right. **But the hem is much wider than the front's:** mask width 165 / 168 / 183 / 186 px at rows 665 / 685 / 705 / 715 against the front's 151 / 142 / 141 / 120 (+14 to +66 px, flaring out on both sides; area 56,173 px against 51,449, the widest of the eligible backs). Azure run 17b shows that extra hem in a still can grow into side flaps and hem girth in stage 2 |
| fashn@50 | **0.10–0.13: a pale pink gathered band, the closest to the front's** | 585 (0.626) | **a dark strip hangs below the hem between the feet (rows 706–726, 16–18 px wide, inside the garment mask: not thin, so 0.12.0 neither trims nor fails it)**, a black tick at the waistband (row ~350); hem a little shorter (708) |
| fashn@46 | 0.07–0.09: a thin pale edge | 573 (0.586, about 5 cm high) | the grey leg shows through a slit above the hem left of centre (rows ~695–710) |
| fashn@43 (17a) | 0.05: red, no band | 567 (0.569, about 7 cm high) | grey bits at the hem |
| fashn@47 | 0.06: red, no band | no smocked tier band drawn | print fidelity 0.77 |
| 17a's back fashn@44 (near miss, history only) | 0.05: as 49 | 594 (0.637) | torso cover 0.9156 < 0.92; not in run 17b's `stage1b/`, so it cannot be pinned; a draw plan could still keep it from `history/` (find_kept searches every history folder), but it fails torso cover |

**No back meets both by-eye criteria.** None has the pale pink smocked waistband of the front and both shop photos; the one closest to it (50) has a dark strip hanging below the hem that stage 2 would grow, and the one with an exact tier seam and nothing wrong otherwise (49) has a red band. Twelve FASHN backs so far (17a, 17b): 2 with a pale band (46, 50), 3 with the seam at about 0.63 (17a's 44, 49, 50), none with both and clean. Not pinned, no stage 2 spent. The front fashn@44's own hem is uneven and partly sheer at the lower left, with a small grey spot near row 720, its mask narrowing to 141 px at 685–705 and 120 px at 715 (the shop front photo also has an uneven, partly sheer hem, so this is probably faithful); backs drawn with a level hem will disagree with it at the hem in side views. No change to the pick.

For run 17c's review, a third by-eye criterion: the back's hem width within about 15 px of the front's over rows 665–705 (front 151 / 142 / 141 px). **Stopping rule:** if none of 17c's 16 backs passes all three, the next step is not more seeds but a founder decision on 49 (red band and wider hem) or a change to the waistband conditioning (exporter / prompt).

Checked for the next step, on copies of the artifact (with the 17a export, input hash `99ab3ce9…`): `--recompose-dress --dress-pin front=fashn@44,back=fashn@49` resolves in run 17b's `stage1b/` as the Volume holds it and reproduces the reviewed stills, pixel hashes `8909a1c04e63c3f26a54818a` / `ec73328ec8bbf1a758affe73` with numpy 2.2.6 / Pillow 11.3.0 (the Modal image) and with numpy 2.5.3 alike (back 50: `79d386bc720c6e962f73de21`); a pin of a 17a-only candidate (`back=fashn@44`) is refused (only run 17b's candidates are in the current `stage1b/`); a keep of it would still resolve from `history/`. A further draw plan `front=keep:fashn@44;back=keep:fashn@49,…` archives 17b into `history/` and finds both keeps there (replayed: same two hashes).

## The hem flaps of runs 16b and 17b: cause, and a flag for them (8 Nov 2026, CPU only, no GPU)

Three investigations on CPU (the stills, the stage 2 conditioning, the masks and stage 4t), then the decisive claims checked again. Nothing was painted over; the masks and the fitted asset are unchanged.

**Ranked causes.**

1. **Mechanism (high confidence): Wan draws cloth where our depth control says background, at the image-left of the hem.** Every stage 2 input other than the stills is identical in runs 15, 16b and 17b: the `control/` tree hashes to the same sha1 (`1ebafa0b…`, run 14 `df35cc6f…`), and the records share input hash `de3bc1ee…`, seeds 43/44/45, pin roles, prompt `neutral-prompt-0.3.0`, 40 steps, guidance 6.0, shift 5.0. The stills overhang the control proxy at the hem in every run (row 520: garment 123–354 px, proxy 141–338), and FASHN drew a cream, unprinted corner at the image-left of the front still's hem that hangs outside and about 15 rows below the proxy, in runs 15, 16b and 17b alike. The front still is every clip's reference image and turntable_b's end pin. The flap has that corner's colour (flap RGB about 200/195/190, corner 184/177/169), stays at the image-left while the body turns (fixed in screen space, not carried with the garment) and lies where the control is background. Run 15 has a smaller flap of the same colour at the same place (b 116–156). No seam or interpolation effect: seams 3.1 / 2.4, the flap peaks mid-clip.
2. **Why it grew from run 15 to 16b/17b (medium-low confidence, not testable without a GPU): Wan's non-local response to the 0.10.1+ stills.** The still changes at the hem are a 1 px outline ring, about symmetric left/right (front rows 520–548 +120 px left, +104 right), and conform_edges never reaches the hem (span rows 221/222–460). The largest changes are elsewhere: the shoulder caps (rows 200–280, +702 / +536 mask px) and a band of front-hip texture rewritten by the hip conform (rows 380–416). Removing 49 px of string from the back (16b → 17b) moved turntable_a (the new rectangle at 13–31) but left the turntable_b flap within 1–4 px, so stage 2 reacts strongly to small still changes. No hem-local feature of the 0.10.1+ stills that a fix could target was found. This **weakens** the earlier guess (Run 17b above) that the back still's hem corner seeds the flap.
3. **Measurement: the masks keep the drawn flap, and stage 4t fits it as hem girth.** The masks are what the code gives (re-segmented: 0 px differ in 16b and 17b, 5 px in run 15). The flap pixels are drawn cloth, not background bleed: median 42–59 levels from the background in turntable_b, only 5.5 % pass by the weak threshold alone. The turntable_a rectangle is fainter (24 % weak). Stage 4t on copies with the off-hull flap pixels cut from the masks (6 px outside the stills' hull, hips down, off the mannequin): 17b **157.7 → 152.9 cm**, 16b 155.9 → 151.7, run 15 149.5 → 149.4 (checked from the scratch runs' `exemplar.json`). So the flaps account for about 5 of the 8 cm against run 15; the remaining 2–3 cm follows the 0.10.1+ stills' slightly wider hem. Dropping whole frames does not help (157.7 → 155.7–156.6): fewer views loosen the hull. One real bleed: background filled between the legs at frame 140 (runs 15 and 17b, about 400 px), small.
4. **Detection gap: consistency 0.3.0 missed most flap frames.** Its garment IoU flagged only turntable_b 114–127 (side views), and in turntable_a only frame 18 (skirt cover).

**Fixed on CPU: consistency 0.4.0 flags garment off the stills' hull below the hips** (`phase0_garment.off_reference`, `off_reference_spans`; `stage2_video` logs the spans; the generated report shows them in the stage 2 row and marks the stage 4t row "hem girth UNCONFIRMED" when there are any). Per turntable frame of a dress or skirt: garment pixels more than 6 px outside the pinned stills' hull, off our bare mannequin, below 45 % of the mannequin's height, split image-left / image-right; flagged above 400 px (480x832, provisional, one product). The check carves its own hull with an 8 px envelope instead of 4: with 4 px the stills' hem overhang is carved off the hull at the cameras next to the pins, and every run (run 15 too) read 900+ px off the reference at frames 1–8 and 150–159. `score_job` on the clips, CPU:

| Run | Off-reference spans (flagged) | Max px | Frames flagged in all (0.3.0 → 0.4.0, turntables) |
| --- | --- | --- | --- |
| 15 | turntable_b j59–60 (frames 139–140: its own small flap and the between-legs fill) | 764; elsewhere at most 346 (a j1, image-right, next to the pin) | 26 → 28 |
| 16b | **turntable_b j20–78 (frames 100–158), image-left** | 1,490 | 20 → 65 |
| 17b | **turntable_a j19–30, image-left; turntable_b j18–78 (frames 98–158), image-left** | 2,249 (a j29), 1,237 (b) | 19 → 78 |
| 14 (other stills, control and prompt) | a j1–21, a j60–71, b j8–23, b j54–79, image-left | 1,304 | |

The margin on run 15 is about 54 px (346 against 400), and the threshold is set on the runs it judges: provisional until a second product. The early and late edges of the flaps (17b a 13–18, b 82–97) stay under 400 px and are not flagged.

**Not done, proposed** (none needs the founder's money until C):

- **A. Hem girth as a band (CPU, about 95 s per product).** Stage 4t a second time on masks with the off-reference pixels left out, both numbers in the metrics and the report (17b: 157.7 fitted, 152.9 without the flagged pixels). The asset stays as fitted; the cut is a sensitivity number, never the asset (cutting the masks to the hull would hide geometry Wan drew).
- **B. The between-legs fill (CPU, small).** Do not fill a hole whose pixels are background coloured. One frame per run; little girth effect.
- **C. Find the trigger (GPU, about $2–3, H100 at $3.95/h).** turntable_b only, seed 44, about 440 GPU s ≈ $0.48 per arm: the 17b stills with run 15's pixels and mask at rows ≥ 480 (hem); with run 15's front hip band (rows 367–420); with run 15's caps (rows 200–280); a noise control (an imperceptible 49 px change on the image-right side). Plus one arm with `--no-pin-frames` and one with seed 46 (about $0.5 each) to separate reference/pin copying and seed variance. All arms kept on record.
- **D. Reduce the cause, if C points at the overhang (CPU exporter change + one stage 2 run, about 1,350 GPU s ≈ $1.5).** Fit the control proxy's hem width and flare to the stage 1b garment masks, so the stills' wider skirt is inside the control; or have stage 1b QA flag a front still whose hem corner hangs more than N px outside the proxy and redraw FASHN ($0.04–0.18 per draw). Flag or redraw, never paint. Choosing among seeds by the new metric is allowed only with every draw kept and reported.

## Run 17d (8 Nov 2026): the maxi skirt and the palazzo end to end

Run 17d ran stage 2 + stage 4 for two products from stills already on the Volume, recomposed on CPU with stage 1b QA 0.12.0 (no new draw): the **maxi skirt** (job `crimson-wildflower-maxi-skirt-99ab3ce9327b`, front fashn@44 `8909a1c0…`, back fashn@63 `14b4b1e6…` from run 17c's 16 backs: the pale smocked band, thinner than the front's, tier seam at row 587 against 593, hem 138 / 137 / 132 px against 151 / 142 / 141 at rows 665 / 685 / 705, nothing below the hem) and the **palazzo** (job `rosewater-palazzo-pants-b85affd79b61`, run 16a's Qwen front `d519f925…` and back `a9a3ce42…`, approved by the founder with Qwen's invented pocket flap and the darker print; 0.12.0 leaves both unchanged). Same seeds, model and prompts as before. The jobs are now `out/phase0/<handle>`; run 15's are kept as `<handle>-run15`. Stage 4t 0.3.0 (84 s and 93 s CPU), `predict:log`, the consistency re-score and `report:bohohippychic -- --renders` ran on both exactly as on azure. GPU 1,568 s ($1.61–1.63) for the skirt and 1,469 s ($1.56–1.58) for the palazzo, stage 1b not included (drawn in runs 17c and 16a).

**Consistency 0.4.0 in the report.** The CPU re-score (`modal/phase0_garment.py <job> --score`) writes `stage2/consistency_v2.json`, which the report never read. `src/evalJob.ts` `withRescoredConsistency` now puts a re-score in place of the record's check (the GPU one kept as `consistency_gpu`) when its version is at least the record's and it is not older than `stage2/record.json`; otherwise the GPU check stays and the stage table says the re-score was not used, and why. On the two 17d jobs this changes nothing: the Modal run already wrote 0.4.0 into `stage2/record.json`, the re-score equals it frame for frame (skirt 41 / 243 flagged, palazzo 66 / 243, identical spans), so it is not substituted and the stage table says "CPU re-score identical". **Where it matters is the jobs scored 0.3.0 on Modal**, which had no off-reference check in the report: azure 17b (the accepted bundle), 16b, 15, 14, the skirt's run 15, the blouse and the cardigan were re-scored on CPU with 0.4.0 (about 4 min each). Azure 17b now reads 89 / 243 flagged (0.3.0: 30), with off-reference spans **turntable_a j19–30 (12 frames, up to 2,249 px, image-left: the pale rectangle; by eye from frame 13, its first frames under the 400 px threshold) and turntable_b j18–78 (frames 98–158, 61 frames, up to 1,237 px, image-left: the cream flap; by eye from about frame 82)**, so the report now marks its hem girth UNCONFIRMED; azure 16b: turntable_b j20–78 (59 frames, 1,490 px); azure 15: turntable_b j59–60 (2 frames, 764 px, its own small flap); azure 14: four spans, 75 frames; the skirt's run 15: four spans at the image-right (a 1–12 up to 2,908 px, a 75–79, b 1–8, b 76–79). The blouse and cardigan (rejected) are unchanged at 231 and 234 / 243. The stage table now also lists the frames flagged for other reasons, by reason and clip (`consistencyNote`), so no flagged frame goes unexplained.

### What the frames show (all 160 turntable frames of each, contact sheets at 0.4x, the hips, hems and crotch at 1–2x)

Skirt:

- **The hips are closed.** No grey hip beside the skirt and no slit at the side in any frame. Grey mannequin pixels running out from the skirt's edge in the top 130 skirt rows, front and back views (frames 0–15, 65–95, 145–159): at most 3 px per frame against run 15's up to 1,356 px (more than 50 px in 46 of 62 frames there, 666 in its front still, 496 in its back still). The side views (24–40, 104–120) show closed cloth at the hip.
- **Waistband and print:** the pale pink smocked band front and back, print and smocked tier band right; the back's band is thinner than the front's (the still's).
- **The hem is drawn over the feet.** From about turntable_b 85 to 159, and in turntable_a 40–49, both feet below the hem are red: cloth (or red boots) drawn round them, where our mannequin's feet are grey. Frames 0–39 and 50–79 mostly show the hem just above the feet.
- **Short-lived flaps (consistency 0.4.0 off-reference).** turntable_b 81–84: translucent pale side panels standing out on both sides of the hem (off-reference 1,274–1,504 px at 81–83, both sides); 83–94: a flat red tongue on the floor at the image-left of the hem (off-reference left 206 → 8 px at 86–93, mostly below the 400 px threshold, so the flag covers only 81–86). turntable_a 1–14: the hem flares out at the image-right, printed cloth (up to 1,928 px at frame 4; the stills' hull is narrower there), also a 71–79 (489 px) and b 159 (524 px). Of the 41 flagged frames, 30 are off-reference (a 1–14, a 71–79, b 1–6, b 79) and 11 more, turntable_a 15–25, are flagged only for skirt cover 0.865–0.899 < 0.9 below the crotch (a 7–14 carry both). Looked at by eye: a 15–25 are a normal three-quarter rotation whose lower skirt is a little narrower than the stills' hull (the hem drawn in round the feet, above), no flap, slit or grey; not a new defect. So the asset's hem girth is UNCONFIRMED.
- **No black frames, no flicker:** darkest frame 174 px below luminance 25 (frame 96, run 15: 147), consecutive frames differ by 3.76 on average (max 5.11 at 107; run 15 3.63, 4.68).

Palazzo:

- **Two legs in every turntable frame** (touching down to a seam line over up to 65 % of the leg rows in a 75–76 and b 155–156, below), no grey other than our feet below the hem, no flap, no black frame (darkest 118 px below 25, mean frame difference 3.33, max 4.47).
- **The legs touch near the pinned views:** in turntable_a 72–79 and turntable_b 150–159 the very wide legs hang against each other down to a seam line (the garment mask closes the gap); consistency flags 4 frames for merged legs (a 75 84/251 rows, 76 116/255, b 155 104/258, 156 166/261). In the pinned stills (0, 80) the gap is open. The motion clip (not used) merges the legs in 62 of 81 frames.

### Measured (stage 4t, `report:bohohippychic`)

| | Skirt run 17d | Skirt run 15 | Palazzo run 17d |
| --- | --- | --- | --- |
| Stage 1b | QA 0.12.0 pass (17c fashn@44 + fashn@63) | QA 0.6.1 FAIL front (overridden) | QA 0.12.0 pass (16a Qwen + Qwen) |
| Pinned stills vs the mannequin at the hip row (87.4 cm), front / back width | 40.9 / 40.9 cm against 37.6 (0 cm of mannequin outside) | 34.75 / 35.59 (grey hip outside) | 45.4 / 45.7 (0 outside) |
| Openings wider than 4 cm (`src/bottomOpenings.ts`) | **none** between 3.3 and 99.2 cm above the floor | at both hips, 10.2 and 7.8 cm across | none (two leg tubes and a seat tube) |
| Waist (chart + ease) | **no girth**: the band's top edge is 100.2 cm above the floor, 4.0 cm below our waist ring (104.2); on the band 88.07 cm against 80.5 (+7.57), uncalibrated (global scale 1.000) → chart agreement FAIL | no girth (band 2.6–10.8 cm low, open 5.8 cm; bridged 94.23) | 82.68 against 79.5: +3.18 before calibration, +1.30 after the global scale (0.977), pass |
| Hip (chart + ease) | 110.35 against 109 (+1.35; not a fit point of the a-line block) | no girth (bridged 107.65, −1.35) | 119.83 against 118 (+1.83), pass |
| Hem | 2.16 cm above the floor (P0's maxi 11.4: −9.2 cm); hem girth 86.0 cm, flare 0.78 of the hip (P0 1.25, 3.9 σ): pinched round the feet; UNCONFIRMED (30 turntable frames off the stills' hull) | 4.16 cm; hem girth 110.3 | 5.26 cm above the floor (P0 5.16) |
| Lengths | waist to hem along the front 99.08, outseam 102.34 (no length printed) | — | outseam 102.51 against the printed 99 (+3.51); inseam 73.59 from the crotch at 76.44 cm (none printed) |
| Pinned stills IoU visible | front 0.964, back 0.916 | 0.894, 0.891 | 0.923, 0.920 |
| Holdout (32 frames) visible / silhouette | 0.9474 / 0.9469 | 0.9146 / 0.8834 | 0.9695 / 0.9639 |
| Turntable 0° / 90° / 180° visible | 0.963 / 0.948 / 0.919 | | 0.922 / 0.936 / 0.919 |
| Shop photo (indicative) | 0.851 / 0.823 | | 0.686 / 0.651 |
| Clearance | 0 of 6,558 inside, closest 4.0 mm | | 1 of 4,880 by the grid SDF; by the exact distance 4.01 mm, 0 below 4 mm |
| Texture holdout MAE (one mean colour) | 29.21 (34.36) | | **29.06 (27.56): worse than one colour** |
| Mesh, bundle | 12,940 triangles, 1 component; 842 KB | 12,261; 776 KB | 9,480 triangles, 3 components (seat + two legs, not stitched); 715 KB |
| Drape prediction P0 (shadow) | Chamfer 1.263 cm, F 0.73 at 1 cm; 0 of 2 informative rows within 1.28 σ | | Chamfer 0.789 cm, F 0.76; hem height +0.28 cm, length −0.28 cm, hem girth +5.0 %; 1.00 within 1.28 σ |
| GPU (estimate) | 1,568 s, $1.61–1.63 | 1,581 s, $1.68–1.74 | 1,469 s, $1.56–1.58 |

### What the assets look like (every render looked at: M at AU 8 / 12 / 16 front, three-quarter, side, XS, XXL, plain and fit map; `out/eval/<handle>/renders/`, the turntable overlays in `view/`)

- **Skirt:** closed at the hips in every size, view and body (run 15's grey hip gaps are gone, `compare/run15-vs-current-viewer-M-front.png`); print present but smeared into vertical streaks, with pale unprinted patches at the hem (front of AU 8, three-quarter of AU 16); the hem reaches the floor and narrows round the feet, two foot-shaped lobes at the hem in the fit map, our grey toes just below it; AU 8 / 12 / 16 differ only a little (about 10–25 px wider at the band from 8 to 16 on M; graded from the hip, no waist ring); the fit map is nearly blank (AU 8 red at the band on M).
- **Palazzo:** the static mesh (turntable overlays) is closed with two legs, but its baked print is a patchwork: a blurred, stretched rectangle between the crotch and the knees with hard seams at both ends. **In the viewer, at every size and on M, XS and XXL, from the front, three-quarter and side, the leg tubes drop away from the seat in the drape and a band of our grey thighs shows between the seat and the legs**, the legs crumpled below. The seat tube and the two leg tubes are separate components, not stitched; the drape lets them part. **Also: narrow grey slivers of our shins show through vertical slits low in the leg tubes** in the three-quarter and side views at AU 8, 12 and 16 alike (and through the lower legs in the XXL front), and 1 vertex lies inside the mannequin by the grid SDF (share 0.0002). Not repaired.

**Decision. Skirt run 17d: faulty, pending a founder decision** (`review.json`; first written up as accepted pending founder review, changed after review). The founder's objection to run 15 (the hips) is gone, and no slit or hole shows in its frames or renders. But a bundle the plugin's own import gate refuses cannot be a panel bundle (no shop could show it), the grey toes show just below the hem, and AU 8 / 12 / 16 barely differ, which matters for a panel that picks the smaller size. The report now also enforces the gate: `forPanel` (`src/evalReport.ts`) keeps any evaluated product whose chart agreement fails off the panel and the blind page, whatever its review. Flagged, not repaired: no chart girth at the waist (the band 4 cm below our waist ring; chart agreement fails, so **the plugin's import gate refuses the bundle (`qa_failed`) and it is not in the demo shop**); the hem drawn over the feet (2.2 cm above the floor, pinched to 86 cm); the short-lived flaps (b 81–94) and the hem flare (a 1–14); the smeared print; sizes that differ only a little. The founder decides whether the skirt is worn 4 cm low (then the waist anchor moves to the band and the gate can pass) or new stills are needed. **Palazzo run 17d: faulty** (rendered, off the blind page): the frames are right and the chart passes, but the asset shows our grey thighs between the seat and the legs in every render, grey shin slivers through slits low in the legs in the three-quarter and side views, and its print is a patchwork. Next for the palazzo, on CPU: stitch (or pin) the leg tubes to the seat in the bundle and viewer, re-bake, re-render, and check the lower-leg slits as well as the thigh band; no GPU needed. Next for the skirt: the founder's review; a band at the waist needs stills whose band reaches our waist ring (not measured on the stills here), or a founder decision that the skirt is worn 4 cm low.

## Verdict per Phase 0 acceptance item (after runs 15, 16b, 17b and 17d)

| Item | Verdict | Evidence |
| --- | --- | --- |
| Size test | **Needs the five-person panel; not run.** 1 of 5 products has a panel bundle (4 needed), pending founder review: the azure babydoll (run 17b since 8 Nov, a judgement call against run 16b; run 16b before it). The maxi skirt (run 17d) and the palazzo have bundles but are marked faulty in `review.json` (evaluated and rendered, off the blind page and not counted; the skirt's bundle is also refused by the plugin's import gate, chart FAIL) | Azure (run 17b, stage 4t): closed cloth, print, sizes visibly different; no grey shoulder caps in its stills or frames (run 15's frames had them; its asset synthesized the cap print); its stills have nothing hanging below the hem (QA 0.12.0), and run 16b's see-through lower skirt (turntable_a 32–56) and strings (40–80) are gone. Open: a plain cream flap at one side of the hem in about 75 frames (turntable_b 82–155 by eye; consistency 0.4.0, re-scored on CPU, flags j18–78, frames 98–158; not seeded by the string, which run 17b removed; same size as in 16b) and a new flat, hard-edged pale rectangle beside the hem in turntable_a 13–31 (flagged j19–30, up to 2,249 px; up to ~10 cm; fully detached at 30, gone in one frame at 31), both fitted as a wider hem (hem girth 157.7 cm against run 15's 149.5); 2 vertices 3.2 mm from the mannequin (clearance 4 mm); still the grey back-shoulder patch in AU 8 and the straight side view. Skirt (run 17d, stage 4t): closed at the hips in every frame and render (no opening wider than 4 cm; run 15 was open 10.2 and 7.8 cm at the hips, its stills 2.8 / 2.0 cm narrower than the mannequin), pale band and print; open: the band 4 cm below our waist ring (no chart girth), the hem drawn over the feet (2.2 cm above the floor, pinched to 86 cm, foot lobes in the viewer), short-lived flaps in turntable_b 81–94 and a hem flare in turntable_a 1–14 (hem girth unconfirmed), a smeared print, sizes that differ only a little; faulty, pending the founder. Palazzo (run 17d): right in every frame (two legs), but in the viewer the unstitched leg tubes drop away from the seat and our grey thighs show, and grey shin slivers show through slits low in the legs; faulty. Blouse and cardigan rejected on review |
| Fabric test | **Needs the five-person panel; not run** | No linen/silk judgement of either asset |
| Chart agreement | **Not met on what exists: the chart passes for azure and the palazzo (the palazzo's asset is faulty), the skirt fails; not yet measurable as a gate (4 of 5 needed)** | Azure (run 17b): chest 101.50 cm against 102, −0.50 before calibration (run 16b −0.74, run 15 −0.73), graded chest −2 / −1 / 0 / +1 / 0 against the printed table, flat-lay length 90.00 against 91 (run 16b 89.79, run 15 89.98; 90.12 as first reported). Skirt (run 17d): still no girth at its one critical anchor (the waist): the band's top edge is level, 4.0 cm below our waist ring; on the band 88.07 cm against the chart's 80.5 (+7.57, uncalibrated), so the plugin's import gate refuses the bundle (`qa_failed`) (run 15: 2.6–10.8 cm low and open, bridged 94.23). Hip (not a fit point of the a-line block): now closed, 110.35 cm against 109 (+1.35; run 15 open, bridged 107.65). No skirt length is printed. Palazzo (run 17d): waist 82.68 against 79.5 (+3.18 before calibration, +1.30 after the global scale), hip 119.83 against 118 (+1.83), pass; outseam 102.51 against the printed 99 (+3.51). Blouse (2DGS, rejected): −10.85 cm; cardigan: no chest girth |
| View agreement | **Measured; merchant confirmation still needed** | Against the pinned stills, visible: azure run 17b 0.900 / 0.925 (run 16b 0.901 / 0.924, run 15 0.889 / 0.938), skirt run 17d 0.964 / 0.916 (run 15 0.894 / 0.891), palazzo 0.923 / 0.920 (all above 0.85); holdout visible azure 0.912 (run 16b 0.913, run 15 0.918), skirt 0.947 (run 15 0.915), palazzo 0.970. The stills are generated, so this measures stages 2–4t |
| Cost | **Measured (GPU seconds); dollars list-price estimates** | Run 15: 6,295 GPU s, $6.66–6.93 for five products (good products $1.66–1.74 each; $3.29–3.40 went to the two rejected products that `--accept-failed-dress` let through). Run 16b (azure, stages 2 and 4 only on stills recomposed on CPU): 1,503 GPU s, $1.59–1.62; with run 16a's azure stage 1b (34.6 s, about $0.04) the product is about 1,537 s, $1.63–1.66, against run 15's 1,576 s, $1.66–1.71 (the generated report's cost row now says that stage 1b is not included). Run 17b (azure, stages 2 and 4 on recomposed stills): 1,464 GPU s, $1.54–1.57; the skirt's 8 extra backs 66 s, $0.07–0.18. Run 17a (stage 1b only, three products): 930 s, $1.02–1.34. Run 17d (stages 2 and 4 on recomposed stills): skirt 1,568 s, $1.61–1.63; palazzo 1,469 s, $1.56–1.58. Runs 10–15: 12,943 GPU s, $13.55–14.45 (runs 16a–17d not counted here). Stage 4t adds about 90 s of CPU per product. Modal invoice not read |
| Write-up | **Not met** | One video model and one reconstruction route (2DGS and the CPU template fit on the same video). Three of five run 15 products failed at stage 1b (FASHN), which no later stage repairs |

What the assets need before the panel: three more products with a panel bundle (the blouse and the cardigan still fail at stage 1b; `--accept-failed-dress` should not have spent stage 2 on them in run 15); for the palazzo, leg tubes that stay on the seat in the drape, no slits low in the legs and a print without the patchwork (CPU: stitch or pin the leg tubes, re-bake); for the skirt (run 17d, closed at the hips now, faulty), the founder's decision on the low band (no chart girth, so the plugin will not import it), the hem drawn over the feet and the flaps; for the dress, the run 14 faults listed above and the two side flaps of run 17b (turntable_b 82–155, unchanged since 16b and not seeded by the cut string; turntable_a 13–31, new). What still differs in the stills from run 15's, whose frames had only small flaps, is mostly away from the hem (shoulder caps, the front-hip conform band; at the hem a 1 px ring, about symmetric); the flaps grow from the front still's cream image-left hem corner outside the control, which all three runs share, and their size moved with Wan's non-local response to the still changes (see [The hem flaps of runs 16b and 17b](#the-hem-flaps-of-runs-16b-and-17b-cause-and-a-flag-for-them-8-nov-2026-cpu-only-no-gpu); consistency 0.4.0 now flags them; the ablation that would name the trigger is about $2–3 of GPU). Run 16b's translucent hem panel in turntable_a 32–56 went with the string.

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

**Review of run 17 (stills and frames looked at):** accepted. run 17b (stage 2 + 4 on run 16a's FASHN stills recomposed with stage 1b QA 0.12.0: the back still's 49 px cut tie string below the hem left out; same seeds as 16b): no grey cap above the sleeves in the stills or any turntable frame; nothing hangs below the hem of either still; run 16b's see-through lower skirt with the grey leg through and ragged tips (turntable_a 32-56) and its strings (40-80) are gone; print, puff sleeves, babydoll as in runs 15 and 16b. Open, flagged, not repaired: (1) the plain cream unprinted flap swinging out at one side of the hem in turntable_b frames about 82-155 is unchanged from 16b (not seeded by the string); (2) new: a flat, hard-edged, unprinted pale rectangle at the image's left beside the hem in turntable_a frames 13-31 (fainter also at the right at about 20-28; up to ~10 cm at 28), partly detached at 16-20, fully detached from the skirt at frame 30 (gap up to 18 px at row 520, 30 px at row 527) and gone in one frame at 31 (a local 41-51 px jump; no global flicker); both are fitted as a wider hem (hem girth 157.7 cm against run 15's 149.5); (3) 2 vertices 3.2 mm from the mannequin (clearance 4 mm); (4) the grey back-shoulder patch in AU 8 from the side and the straight side view; (5) the motion clip draws a sleeveless strappy dress (not used). Accepted pending founder review: 17b over 16b is a judgement call between two different visible defects (16b: the grey leg through a see-through lower skirt in turntable_a 32-56 plus strings; 17b: the floating flat panel in 13-31); neither is panel-clean; founder to choose. For 17b: chest -0.50 cm, flat-lay -1.00 cm, holdout IoU level; against: hem girth +1.8 cm, skirt Chamfer 1.13 against 1.06. Stage 2 consistency re-scored on CPU with 0.4.0 (the GPU run wrote 0.3.0, no off-reference check): 89 of 243 frames flagged; off the stills' hull below the hips at the image-left in turntable_a j19-30 (12 frames, up to 2,249 px: the pale rectangle; its first frames 13-18 are under the 400 px threshold) and turntable_b j18-78 (frames 98-158, 61 frames, up to 1,237 px: the cream flap; by eye it starts earlier, about frame 82), so the report now marks its hem girth UNCONFIRMED; other flags: garment IoU vs the stills low in turntable_a 4 and turntable_b 14 frames, skirt cover in turntable_a 1 frame, the motion clip (not used) 11. Looked at by the evaluating agent, not yet by the founder.

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
| 1b dress the mannequin | done | engine fashn; QA pass |
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 3.1 / 2.4 (8-bit mean abs); consistency garment-consistency-0.4.0 (re-scored on CPU, `stage2/consistency_v2.json`; the GPU run wrote garment-consistency-0.3.0): 89/243 frames flagged; garment off the stills' hull below the hips (flap or panel the stills do not have) in turntable_a j19–30 (max 2249 px, image-left), turntable_b j18–78 (max 1237 px, image-left); other flags: skirt cover below the reference: turntable_a j18 (1); garment IoU vs the pinned stills low: turntable_a j34–37 (4); turntable_b j34–47 (14); garment outside the posed proxy: motion j53, j71–80 (11) |
| 3 separation | done | 160 garment masks of the generated frames (`stage2/garment_mask/`, garment-segment-0.1.0; 0 frames ambiguous with the mannequin); stage 4 trains on them |
| 4 reconstruction | done | 11999 triangles, mask IoU train 0.9311 / holdout 0.9239 |
| 4t template fit + bake (CPU) | done | 11002 triangles, IoU visible / silhouette train 0.9111 / 0.8938, holdout 0.9119 / 0.8951, 0 vertices inside the mannequin; hem girth UNCONFIRMED: fitted from masks of 73 turntable frames with garment off the stills' hull below the hips (stage 2 off-reference spans) |
| 5 anchoring and calibration | done | stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames); global scale 1.005 |
| 6 grading | done | 8, 10, 12, 14, 16 |
| 7 QA (chart, view, mesh) | done | chart pass, view front 0.900, back 0.925, 11002 triangles |
| 8 bundle | done | 751 KB in `spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/` |

**Metrics**

Mesh: stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames) (`stage4t/stage2/garment.glb`, sha256 8ba8daa83252).

**Chart agreement** at base size 12 (tolerance ±2 cm at the critical anchors: chest). Global scale 1.0049, from chest. The `empire` pattern block does not fit waist and hip (empire line hangs from the bust; the fit engine skips them too), so they are reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chest | yes | 102.00 | +7.00 | 101.50 | 105.34 | -0.50 | 0.00 | 0.00 | pass |
| waist | no | 81.50 | +4.00 (category default) | 85.59 | 85.72 | +4.09 | +4.51 | +4.51 | not fitted |
| hip | no | 110.00 | +6.00 (category default) | 113.14 | 113.35 | +3.14 | +3.70 | +3.70 | not fitted |

Before calibration max |error| 0.50 cm (within ±2); after the global scale alone 0.00 cm (within); after per-ring calibration pass. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): underbust 95.46, thigh 141.80, upper_arm 54.31 cm.

No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): neck, shoulder, knee, wrist.

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| shoulder_to_hem | 90.21 | flat-lay | 81.64 | 91.00 | -0.79 | flat-lay: along the garment front from the high point shoulder (src/garmentLength.ts); vertical drop 81.64 cm |
| waist_to_hem | 48.80 | — | — | — | — |  |
| sleeve_length | 32.50 | — | — | — | — |  |

Every shoulder-to-hem definition on the calibrated mesh (`src/garmentLength.ts`): high point shoulder, vertical drop to the front hem 81.64 cm; high point shoulder, along the garment front to the hem (flat-lay length) 90.21 cm; back neck at the centre back, along the garment back to the hem 83.59 cm; shoulder point (end of the shoulder), vertical drop to the front hem 76.94 cm.

**Grading against the shop's printed garment table** (graded targets in grading.json minus what the shop printed per size; the base size is calibrated to the chart, the other sizes follow the chart's steps; the shop's "Length" is read as shoulder to hem, flat-lay: grading.json's vertical drop + 8.57 cm, the base mesh's flat-lay minus drop):

| Size | chest graded | chest printed | diff | shoulder_to_hem graded | shoulder_to_hem printed | diff |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | 92.00 | 94.00 | -2.00 | 88.21 | 90.00 | -1.79 |
| 10 | 97.00 | 98.00 | -1.00 | 89.21 | 90.00 | -0.79 |
| 12 | 102.00 | 102.00 | 0.00 | 90.21 | 91.00 | -0.79 |
| 14 | 107.00 | 106.00 | +1.00 | 91.21 | 92.00 | -0.79 |
| 16 | 112.00 | 112.00 | 0.00 | 92.21 | 93.00 | -0.79 |

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | stage1b `stage1b/garment_mask_front.png` | 0.900 | 0.901 | pass | no |
| back | stage1b `stage1b/garment_mask_back.png` | 0.925 | 0.922 | pass | no |

Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):

| View | Normalised IoU | Mirrored | Aspect render / photo |
| --- | --- | --- | --- |
| front | 0.744 | yes | 1.08 / 1.15 |
| back | 0.666 | no | 1.08 / 1.7 |

Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):

| Angle | Frame | Calibrated: visible | Calibrated: silhouette | Reconstructed: visible | Reconstructed: silhouette | Picture |
| --- | --- | --- | --- | --- | --- | --- |
| 0° | 0 | 0.896 | 0.898 | 0.896 | 0.898 | [turntable_0.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_0.png) |
| 90° | 40 | 0.915 | 0.857 | 0.919 | 0.860 | [turntable_90.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_90.png) |
| 180° | 80 | 0.923 | 0.920 | 0.922 | 0.919 | [turntable_180.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/turntable_180.png) |

Each picture: the stage 2 frame, the calibrated mesh with its baked texture (stage 4t) on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).

Overlays: [front](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 0.0 % as reconstructed (0 vertices), 0.0 % after calibration.

**Mesh health** (mesh as evaluated): 11002 triangles (budget 8000–15000: within), 5671 vertices, 3 components, 348 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

**Stage 4t** (template fit and bake, `stage4t/stage2/metrics.json`): the control proxy remeshed into cylindrical grids (body + two sleeves), carved and expanded along fixed rays to 128 training masks, 6 silhouette rounds, 444 Jacobi sweeps in 8 solves (every solve reached the 0.001 cm tolerance). Silhouette IoU per view, mean (min): train visible 0.9111 (0.8485), silhouette 0.8938 (0.8165); holdout (32 views never used) visible 0.9119 (0.8747), silhouette 0.8951 (0.8264). Inside the mannequin (signed distance to mannequin.glb < 0): 0 of 5671 vertices; below the 0.4 cm clearance by that grid SDF: 2; by the exact distance to the mannequin's triangles the closest vertex is 0.317 cm away, 2 vertices lie below the 0.4 cm clearance and 0 below 0.3 cm. Mesh: 11002 triangles, 3 components, 10 boundary loops, 0 non-manifold edges, watertight no (open by design: one body tube and one tube per sleeve whose shoulder cap closes over the arm cap and overlaps the bodice (separate components, not stitched); openings at the neckline, hem, cuffs and underarms are the boundary loops). Texture: 2048² atlas from 128 training views, 95.4 % of the chart texels seen (the rest filled by diffusion), of the shoulder caps' 128775 texels (within 6 cm of either cap top) 82.7 % (the holdout check below does not cover the cap), JPEG 400 KB; on the held-out frames the texture's mean absolute error is 20.79 (one mean colour: 23.29), on 8 × 8 pixel blocks 13.67 (mean colour 17.45), 0–255.

**Stage 4 (2DGS) against stage 4t (template fit)** on the same video, both through this evaluation:

| Metric | stage 4 reconstruction of the stage 2 video (`stage4/stage2/garment.glb`) | stage 4t template fit of the stage 2 video (`stage4t/stage2/garment.glb`) |
| --- | --- | --- |
| chest girth as reconstructed (tape), cm | 99.07 | 101.50 |
| chart: max \|error\| before calibration, cm | 2.93 | 0.50 |
| chart: after the global scale, cm | 0.00 | 0.00 |
| chart: after calibration, cm | 0.70 | 0.00 |
| global scale | 1.030 | 1.005 |
| turntable 0°: IoU visible / silhouette | 0.613 / 0.920 | 0.896 / 0.898 |
| turntable 90°: IoU visible / silhouette | 0.756 / 0.835 | 0.919 / 0.860 |
| turntable 180°: IoU visible / silhouette | 0.669 / 0.942 | 0.922 / 0.919 |
| cloth inside the mannequin (> 0.3 cm), as reconstructed | 22.3 % | 0.0 % |
| cloth inside the mannequin, after calibration | 18.8 % | 0.0 % |
| triangles / components / boundary edges | 11999 / 3 / 849 | 11002 / 3 / 348 |
| shoulder to hem, vertical drop, cm | 82.59 | 81.64 |
| shoulder to hem, flat-lay (along the front), cm | 86.07 | 90.00 |
| colour in the bundle | one mean colour #BEB2A5 | baked texture |
| bundle size | 254 KB | 751 KB |

Evaluation time on the build machine: read 248 ms, measure 104 ms, calibrate 32 ms, grade 1 ms, view renders 1062 ms.

**Drape prediction P0 in shadow mode** (`stage4t/stage2/shadow.json`, predictor drape-prior-p0-0.2.0, cell `dress|empire|above-knee|fluid`; the prediction drives nothing yet: it is compared with what stage 4t measured on this job's mesh):

| Parameter | Predicted | On the P0 proxy | Measured (stage 4t) | Error | σ | |error| / σ | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hemFlare | 1.350 | 1.326 | 1.394 | 0.044 | 0.12 | 0.37 | predicted before leg clearance; measured on the hem ring 2 cm above the lowest body cloth |
| defaultEase.underbust | 6.000 | 6.129 | 17.463 | 11.463 | 8.00 | 1.43 | cm of girth over mannequin M |
| hemY | 57.271 | 57.271 | 56.560 | -0.711 | 2.00 | 0.36 | hem height above the floor; rule: shoulder_to_hem 91 cm (flat-lay: along the front from the HPS) |
| length.hps_surface | 91.000 | 90.970 | 90.000 | -1.000 | 2.00 | 0.50 | flat-lay: along the front from the HPS |
| sleeve.lengthCm | 0.000 | — | 32.500 | 32.500 | 8.00 | 4.06 | no sleeve length given: no sleeve shell (the bare arm stays in the control) |
| sleeve.upperArmRatio | — | — | 1.940 | — | 0.29 | — |  |
| depthRatio.hem | — | 0.680 | 0.656 | — | — | — | derived descriptor (P0 predicts no depth): proxy vs stage 4t |

P0 shape (the proxy built from the prediction, opened) against the stage 4t mesh: Chamfer 1.916 cm, F-score 0.588 at 1 cm, 0.763 at 2 cm; per region shoulders 1.12, bodice 0.83, skirt 1.13 cm. V1 gate values: hem height error -0.71 cm, length error -1.00 cm, hem girth error 8.2 %, share of informative errors within 1.28 σ 0.60.

**Earlier runs of this product** (their own job dirs, evaluated now with the same tooling, so their numbers can differ slightly from what was reported at the time):

| Metric | run 14 (`spikes/garment-engine/out/phase0/azure-palm-baby-doll-dress-run14`) | run 15 (`spikes/garment-engine/out/phase0/azure-palm-baby-doll-dress-run15`) | run 16b (`spikes/garment-engine/out/phase0/azure-palm-baby-doll-dress-run16b`) | this job (`spikes/garment-engine/out/phase0/azure-palm-baby-doll-dress`) |
| --- | --- | --- | --- | --- |
| job (exporter) | `azure-palm-baby-doll-dress-6d2f2611a144` (phase0-export-0.4.0) | `azure-palm-baby-doll-dress-de3bc1eeb3e0` (phase0-export-0.6.0) | `azure-palm-baby-doll-dress-de3bc1eeb3e0` (phase0-export-0.6.0) | `azure-palm-baby-doll-dress-de3bc1eeb3e0` (phase0-export-0.6.0) |
| control proxy | control-proxy-0.1.0, hem 47.60 cm above the floor | control-proxy-0.3.0, hem 57.27 cm above the floor | control-proxy-0.3.0, hem 57.27 cm above the floor | control-proxy-0.3.0, hem 57.27 cm above the floor |
| stage 1b QA | FAIL (front, back), QA stage1b-qa-0.3.0 | pass, QA stage1b-qa-0.6.1 | pass, QA stage1b-qa-0.10.1 | pass, QA stage1b-qa-0.12.0 |
| evaluated mesh | stage 4t template fit of the stage 2 video | stage 4t template fit of the stage 2 video | stage 4t template fit of the stage 2 video | stage 4t template fit of the stage 2 video |
| critical girth by the tape, as reconstructed, cm | chest 101.15 (-0.85 before calibration) | chest 101.27 (-0.73 before calibration) | chest 101.26 (-0.74 before calibration) | chest 101.50 (-0.50 before calibration) |
| front hem above the floor (centre front, as reconstructed), cm | 54.18 | 56.96 | 57.35 | 56.96 |
| hem line above the floor (median of the lowest cloth per 10° sector, exemplar.json), cm | 55.46 | 57.35 | 56.46 | 56.56 |
| shoulder to hem, vertical drop, cm | 84.42 | 81.64 | 81.25 | 81.64 |
| shoulder to hem, flat-lay along the front, cm | 92.54 | 89.98 | 89.79 | 90.00 |
| pinned stills, IoU visible | front 0.904, back 0.933 | front 0.889, back 0.938 | front 0.901, back 0.924 | front 0.900, back 0.925 |
| stage 4t holdout IoU visible / silhouette | 0.9009 / 0.8841 | 0.9176 / 0.8986 | 0.9127 / 0.8956 | 0.9119 / 0.8951 |
| triangles | 11216 | 10983 | 11013 | 11002 |
| GPU cost (estimate) | 1493 s GPU, $1.57–$1.63 | 1576 s GPU, $1.66–$1.71 | 1503 s GPU, $1.59–$1.62 (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included) | 1464 s GPU, $1.54–$1.57 (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included) |

run 14 against this job: [run14-vs-current-turntable-0.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run14-vs-current-turntable-0.png) (stage 2 frame | mesh | overlay at 0°, the earlier run on top); [run14-vs-current-turntable-90.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run14-vs-current-turntable-90.png) (the same at 90°); [run14-vs-current-viewer-M-front.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run14-vs-current-viewer-M-front.png) (viewer, AU 8 / 12 / 16 on the M mannequin, front, the earlier run on top); [run14-vs-current-viewer-M-side.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run14-vs-current-viewer-M-side.png) (the same from the side).

run 14 renders: [M-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/M-plain.png), [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/M-three-quarter-plain.png), [M-side-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/M-side-plain.png), [XS-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/XS-plain.png), [XXL-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run14/renders/XXL-plain.png).

run 15 against this job: [run15-vs-current-turntable-0.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run15-vs-current-turntable-0.png) (stage 2 frame | mesh | overlay at 0°, the earlier run on top); [run15-vs-current-turntable-90.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run15-vs-current-turntable-90.png) (the same at 90°); [run15-vs-current-viewer-M-front.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run15-vs-current-viewer-M-front.png) (viewer, AU 8 / 12 / 16 on the M mannequin, front, the earlier run on top); [run15-vs-current-viewer-M-side.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run15-vs-current-viewer-M-side.png) (the same from the side).

run 15 renders: [M-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run15/renders/M-plain.png), [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run15/renders/M-three-quarter-plain.png), [M-side-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run15/renders/M-side-plain.png), [XS-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run15/renders/XS-plain.png), [XXL-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run15/renders/XXL-plain.png).

run 16b against this job: [run16b-vs-current-turntable-0.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run16b-vs-current-turntable-0.png) (stage 2 frame | mesh | overlay at 0°, the earlier run on top); [run16b-vs-current-turntable-90.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run16b-vs-current-turntable-90.png) (the same at 90°); [run16b-vs-current-viewer-M-front.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run16b-vs-current-viewer-M-front.png) (viewer, AU 8 / 12 / 16 on the M mannequin, front, the earlier run on top); [run16b-vs-current-viewer-M-side.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/compare/run16b-vs-current-viewer-M-side.png) (the same from the side).

run 16b renders: [M-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run16b/renders/M-plain.png), [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run16b/renders/M-three-quarter-plain.png), [M-side-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run16b/renders/M-side-plain.png), [XS-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run16b/renders/XS-plain.png), [XXL-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress-run16b/renders/XXL-plain.png).

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage2_video | H100 | any | 1353 s | 1372 s | $1.48 | $1.51 |
| stage4_recon[stage2] | L40S | any | 111 s | 118 s | $0.06 | $0.06 |

Total: 1464 s GPU, 1873 s wall, $1.54–$1.57 (estimate) (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included).

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | 8, 12, 16 | 3.12 s, 3.05 s, 3.03 s | [M-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-plain.png) |
| M mannequin | front | yes | 8, 12, 16 | 3.12 s, 3.05 s, 3.03 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | 8, 12, 16 | 5.45 s, 5.42 s, 5.40 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | 8, 12, 16 | 5.45 s, 5.42 s, 5.40 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | 8, 12, 16 | 5.91 s, 5.88 s, 5.85 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-side-plain.png) |
| M mannequin | side | yes | 8, 12, 16 | 5.91 s, 5.88 s, 5.85 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/M-side-fitmap.png) |
| XS shape | front | no | 8, 12, 16 | 5.12 s, 5.10 s, 5.07 s | [XS-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XS-plain.png) |
| XS shape | front | yes | 8, 12, 16 | 5.12 s, 5.10 s, 5.07 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XS-fitmap.png) |
| XXL shape | front | no | 8, 12, 16 | 5.92 s, 5.89 s, 5.85 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XXL-plain.png) |
| XXL shape | front | yes | 8, 12, 16 | 5.92 s, 5.89 s, 5.85 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/renders/XXL-fitmap.png) |

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
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 2.9 / 2.1 (8-bit mean abs); consistency garment-consistency-0.4.0 (re-scored on CPU, `stage2/consistency_v2.json`; the GPU run wrote garment-consistency-0.3.0): 231/243 frames flagged; other flags: garment IoU vs the pinned stills low: turntable_a j0–52, j61–79 (72); turntable_b j1–80 (80); garment outside the posed proxy: motion j0–46, j49–80 (79) |
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

Evaluation time on the build machine: read 13 ms, measure 34 ms, calibrate 20 ms, grade 0 ms, view renders 1167 ms.

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

**Review of run 17 (stills and frames looked at):** **faulty, for evaluation only**. run 17d (stage 2 + 4 on run 16a's Qwen front and back, approved by the founder with the invented pocket flap and the darker print, unchanged by QA 0.12.0): the stage 2 frames are good: two legs in every turntable frame (touching down to a seam line over up to 65% of the leg rows in a 75-76 and b 155-156), no grey, no flap, no black frame (consistency 0.4.0: 4 of 160 turntable frames flagged for merged legs, a 75-76 and b 155-156, where the wide legs touch down to a seam line next to the pinned views; the motion clip, not used, merges them in 62 of 81 frames). Stage 4t fits two leg tubes and a seat tube (separate components), chart PASS: waist 82.68 cm against 79.5 with ease (+3.18 before calibration, +1.30 after the global scale), hip 119.83 against 118 (+1.83); outseam 102.51 cm against the printed 99 (+3.51), inseam 73.59 from the crotch at 76.44 cm, hem 5.3 cm above the floor; holdout IoU 0.970 / 0.964. FAULTY, not for the panel: (1) in the viewer, at every size and on every body (M, XS, XXL), the leg tubes drop away from the seat in the drape and a band of our grey thighs shows between the seat and the legs from the front, three-quarter and side, with the legs crumpled below (the static mesh is closed, so this is the unstitched leg tubes in the drape, but it is what the asset shows); (2) narrow grey slivers of our shins show through vertical slits low in the leg tubes in the three-quarter and side views (and the XXL front) at AU 8, 12 and 16 alike; (3) 1 vertex inside the mannequin (share 0.0002); (4) the baked print is a patchwork: a blurred, stretched rectangle between the crotch and the knees with hard seams at both ends (texture holdout MAE 29.1, worse than one mean colour, 27.6). Not repaired; next: stitch the leg tubes to the seat (or pin their tops) in the bundle/viewer and re-bake, on CPU, and check the lower-leg slits as well as the thigh band. Evaluated and rendered below so the fault can be seen, but not a panel bundle and not on the blind page.

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
| 1b dress the mannequin | done | engine both; QA pass |
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 3.8 / 3.5 (8-bit mean abs); consistency garment-consistency-0.4.0 (CPU re-score `stage2/consistency_v2.json` identical): 66/243 frames flagged; other flags: legs merged (trousers drawn as a skirt): turntable_a j75–76 (2); turntable_b j75–76 (2); motion j0–38, j58–80 (62) |
| 3 separation | done | 160 garment masks of the generated frames (`stage2/garment_mask/`, garment-segment-0.1.0; 0 frames ambiguous with the mannequin); stage 4 trains on them |
| 4 reconstruction | done | 11999 triangles, mask IoU train 0.9788 / holdout 0.9733 |
| 4t template fit + bake (CPU) | done | 9480 triangles, IoU visible / silhouette train 0.9695 / 0.9628, holdout 0.9695 / 0.9639, 1 vertices inside the mannequin |
| 5 anchoring and calibration | done | stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames); global scale 0.977 |
| 6 grading | done | 8, 10, 12, 14, 16 |
| 7 QA (chart, view, mesh) | done | chart pass, view front 0.923, back 0.920, 9480 triangles |
| 8 bundle | done | 715 KB in `spikes/garment-engine/out/eval/rosewater-palazzo-pants/` |

**Metrics**

Mesh: stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames) (`stage4t/stage2/garment.glb`, sha256 df50061a7c2b).

**Chart agreement** at base size 12 (tolerance ±2 cm at the critical anchors: waist, hip). Global scale 0.9772, from waist, hip. The `wide-leg` pattern block does not fit thigh (straight leg does not grip the thigh; the fit engine skips it too), so it is reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| waist | yes | 79.50 | +2.00 (category default) | 82.68 | 82.72 | +3.18 | +1.30 | 0.00 | pass |
| hip | yes | 118.00 | +14.00 | 119.83 | 120.04 | +1.83 | -0.90 | 0.00 | pass |

Before calibration max |error| 3.18 cm (outside ±2); after the global scale alone 1.30 cm (within); after per-ring calibration pass. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): thigh 79.93, knee 78.38, calf 80.44, ankle 81.40 cm.

**Openings** (`src/bottomOpenings.ts`): none wider than 4 cm between 63.19 and 103.36 cm above the floor.

| Height (cm) | Cloth round | Gaps > 4 cm (chord at azimuth; +90° = the mannequin's left) | Bridged girth (cm) | Mannequin (cm) | Bridged − mannequin | Bridged − chart hip (118.00) | Closest cloth to the body (cm) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 105.00 | 35 % | 26.83 at 167.5°, 21.18 at 5° | 88.68 | 74.02 | +14.66 |  | 1.32 |
| 87.00 (hip) | 100 % | — | 120.04 | 99.92 | +20.12 | +2.04 | 2.32 |

**The pinned stills against the mannequin's width** (stage 1b garment mask and our mannequin's own silhouette in the same camera, on the row of each height at the axis, cm at the axis's depth). A closed skirt worn on the mannequin cannot be narrower than it; where it is, the generator drew the skirt narrower than the body and the later stages can only show the body there. In the front still the image's left is the mannequin's right; in the back still it is the mannequin's left:

| View | Height (cm) | Mannequin width | Garment width | Mannequin outside the garment, image left / right |
| --- | --- | --- | --- | --- |
| front | 95.00 | 33.03 | 34.15 | 0.00 / 0.00 |
| front | 90.00 | 36.98 | 44.26 | 0.00 / 0.00 |
| front | 87.36 | 37.55 | 45.40 | 0.00 / 0.00 |
| front | 84.00 | 39.25 | 46.54 | 0.00 / 0.00 |
| front | 80.00 | 39.27 | 47.40 | 0.00 / 0.00 |
| back | 95.00 | 33.03 | 40.87 | 0.00 / 0.00 |
| back | 90.00 | 36.98 | 44.26 | 0.00 / 0.00 |
| back | 87.36 | 37.55 | 45.68 | 0.00 / 0.00 |
| back | 84.00 | 39.25 | 46.54 | 0.00 / 0.00 |
| back | 80.00 | 39.27 | 47.40 | 0.00 / 0.00 |

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| outseam | 102.51 | — | — | 99.00 | +3.51 | flat-lay, along the garment: top edge down the side seam to the hem (src/garmentLength.ts bottomLengths) |
| waist_to_hem | — | — | — | — | — | trousers: no centre-front length (the front ends at the crotch); see outseam and inseam |
| inseam | 73.59 | — | — | — | — | flat-lay, along the garment: crotch down the inner leg to the hem (src/garmentLength.ts bottomLengths) |

Every bottom length definition on the calibrated mesh (`src/garmentLength.ts` `bottomLengths`): top edge at the side, along the side seam to the hem (outseam, flat-lay) 102.51 cm (top 105.76, hem 5.26 cm above the floor); top edge at the side, vertical drop to the hem 100.50 cm (top 105.76, hem 5.26 cm above the floor); crotch along the inner leg to the hem (inseam, flat-lay) 73.59 cm (top 76.44, hem 2.92 cm above the floor); crotch point, vertical drop to the hem of the inner leg 73.52 cm (top 76.44, hem 2.92 cm above the floor).

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | stage1b `stage1b/garment_mask_front.png` | 0.923 | 0.923 | pass | no |
| back | stage1b `stage1b/garment_mask_back.png` | 0.920 | 0.922 | pass | no |

Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):

| View | Normalised IoU | Mirrored | Aspect render / photo |
| --- | --- | --- | --- |
| front | 0.686 | yes | 2.03 / 1.54 |
| back | 0.651 | yes | 2.03 / 1.45 |

Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):

| Angle | Frame | Calibrated: visible | Calibrated: silhouette | Reconstructed: visible | Reconstructed: silhouette | Picture |
| --- | --- | --- | --- | --- | --- | --- |
| 0° | 0 | 0.922 | 0.922 | 0.940 | 0.940 | [turntable_0.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/view/turntable_0.png) |
| 90° | 40 | 0.936 | 0.894 | 0.921 | 0.881 | [turntable_90.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/view/turntable_90.png) |
| 180° | 80 | 0.919 | 0.920 | 0.940 | 0.941 | [turntable_180.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/view/turntable_180.png) |

Each picture: the stage 2 frame, the calibrated mesh with its baked texture (stage 4t) on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).

Overlays: [front](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 0.0 % as reconstructed (1 vertices), 0.0 % after calibration.

**Mesh health** (mesh as evaluated): 9480 triangles (budget 8000–15000: within), 4880 vertices, 3 components, 280 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

**Stage 4t** (template fit and bake, `stage4t/stage2/metrics.json`): the control proxy remeshed into cylindrical grids (body + no sleeves), carved and expanded along fixed rays to 128 training masks, 6 silhouette rounds, 205 Jacobi sweeps in 7 solves (every solve reached the 0.001 cm tolerance). Silhouette IoU per view, mean (min): train visible 0.9695 (0.9215), silhouette 0.9628 (0.8812); holdout (32 views never used) visible 0.9695 (0.9313), silhouette 0.9639 (0.8933). Inside the mannequin (signed distance to mannequin.glb < 0): 1 of 4880 vertices; below the 0.4 cm clearance by that grid SDF: 1; by the exact distance to the mannequin's triangles the closest vertex is 0.401 cm away, 0 vertices lie below the 0.4 cm clearance and 0 below 0.3 cm. Mesh: 9480 triangles, 3 components, 6 boundary loops, 0 non-manifold edges, watertight no (open by design: a seat tube and one tube per leg (separate components, not stitched); the waist, the crotch join and the leg hems are the boundary loops). Texture: 2048² atlas from 128 training views, 98.9 % of the chart texels seen (the rest filled by diffusion), JPEG 405 KB; on the held-out frames the texture's mean absolute error is 29.06 (one mean colour: 27.56), on 8 × 8 pixel blocks 23.14 (mean colour 21.3), 0–255.

**Stage 4 (2DGS) against stage 4t (template fit)** on the same video, both through this evaluation:

| Metric | stage 4 reconstruction of the stage 2 video (`stage4/stage2/garment.glb`) | stage 4t template fit of the stage 2 video (`stage4t/stage2/garment.glb`) |
| --- | --- | --- |
| waist girth as reconstructed (tape), cm | 70.99 | 82.68 |
| chart: max \|error\| before calibration, cm | 12.62 | 3.18 |
| chart: after the global scale, cm | 0.01 | 1.30 |
| chart: after calibration, cm | 0.49 | 0.00 |
| global scale | 1.120 | 0.977 |
| turntable 0°: IoU visible / silhouette | 0.792 / 0.963 | 0.940 / 0.940 |
| turntable 90°: IoU visible / silhouette | 0.840 / 0.869 | 0.921 / 0.881 |
| turntable 180°: IoU visible / silhouette | 0.753 / 0.961 | 0.940 / 0.941 |
| cloth inside the mannequin (> 0.3 cm), as reconstructed | 17.2 % | 0.0 % |
| cloth inside the mannequin, after calibration | 10.5 % | 0.0 % |
| triangles / components / boundary edges | 11999 / 2 / 393 | 9480 / 3 / 280 |
| waist to hem at the centre front, flat-lay, cm | — | — |
| outseam (top edge down the left side), cm | 103.61 | 102.51 |
| colour in the bundle | one mean colour #B39685 | baked texture |
| bundle size | 250 KB | 715 KB |

Evaluation time on the build machine: read 331 ms, measure 24 ms, calibrate 18 ms, grade 0 ms, view renders 939 ms.

**Drape prediction P0 in shadow mode** (`stage4t/stage2/shadow.json`, predictor drape-prior-p0-0.2.0, cell `trousers|wide-leg|full|fluid`; the prediction drives nothing yet: it is compared with what stage 4t measured on this job's mesh):

| Parameter | Predicted | On the P0 proxy | Measured (stage 4t) | Error | σ | |error| / σ | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| legs.hemOfThigh | 1.100 | 1.095 | 1.018 | -0.082 | 0.10 | 0.82 |  |
| legs.thighOfHip | 0.600 | 0.601 | 0.667 | 0.067 | 0.10 | 0.67 | a floor, not a target: the thigh is the larger of the chart/default girth and this share of the hip |
| hemY | 5.160 | 5.160 | 5.440 | 0.280 | 2.00 | 0.14 | hem height above the floor; rule: outseam 99 cm from the waist |
| length.waist_drop | 99.000 | 99.000 | 98.720 | -0.280 | 2.00 | 0.14 | vertical drop from the rule origin to the lowest body (trousers: left leg) cloth |
| depthRatio.hem | — | 0.950 | 1.017 | — | — | — | derived descriptor (P0 predicts no depth): proxy vs stage 4t |

P0 shape (the proxy built from the prediction, opened) against the stage 4t mesh: Chamfer 0.789 cm, F-score 0.763 at 1 cm, 0.912 at 2 cm; per region bodice 0.78, skirt 0.79 cm. V1 gate values: hem height error 0.28 cm, length error -0.28 cm, hem girth error 5.0 %, share of informative errors within 1.28 σ 1.00.

**Earlier runs of this product** (their own job dirs, evaluated now with the same tooling, so their numbers can differ slightly from what was reported at the time):

| Metric | run 15 (`spikes/garment-engine/out/phase0/rosewater-palazzo-pants-run15`) | this job (`spikes/garment-engine/out/phase0/rosewater-palazzo-pants`) |
| --- | --- | --- |
| job (exporter) | `rosewater-palazzo-pants-b85affd79b61` (phase0-export-0.6.0) | `rosewater-palazzo-pants-b85affd79b61` (phase0-export-0.6.0) |
| control proxy | control-proxy-0.3.0, hem 5.16 cm above the floor | control-proxy-0.3.0, hem 5.16 cm above the floor |
| stage 1b QA | FAIL (front, back), QA stage1b-qa-0.6.1 | pass, QA stage1b-qa-0.12.0 |
| evaluated mesh | — | stage 4t template fit of the stage 2 video |
| critical girth by the tape, as reconstructed, cm | — | waist 82.68 (+3.18 before calibration) |
| front hem above the floor (centre front, as reconstructed), cm | — | 5.44 |
| hem line above the floor (median of the lowest cloth per 10° sector, exemplar.json), cm | — | 5.44 |
| shoulder to hem, vertical drop, cm | — | 133.16 |
| shoulder to hem, flat-lay along the front, cm | — | 135.53 |
| pinned stills, IoU visible | — | front 0.923, back 0.920 |
| stage 4t holdout IoU visible / silhouette | — | 0.9695 / 0.9639 |
| triangles | — | 9480 |
| GPU cost (estimate) | 31 s GPU, $0.03–$0.07 | 1469 s GPU, $1.56–$1.58 (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included) |

- run 15: no stage 4 mesh (stage4/stage2/garment.glb) in the job dir

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage2_video | H100 | any | 1382 s | 1398 s | $1.52 | $1.53 |
| stage4_recon[stage2] | L40S | any | 87 s | 93 s | $0.05 | $0.05 |

Total: 1469 s GPU, 2115 s wall, $1.56–$1.58 (estimate) (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included).

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | 8, 12, 16 | 5.35 s, 5.33 s, 5.31 s | [M-plain.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/M-plain.png) |
| M mannequin | front | yes | 8, 12, 16 | 5.35 s, 5.33 s, 5.31 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | 8, 12, 16 | 5.17 s, 5.15 s, 5.13 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | 8, 12, 16 | 5.17 s, 5.15 s, 5.13 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | 8, 12, 16 | 5.63 s, 5.60 s, 5.57 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/M-side-plain.png) |
| M mannequin | side | yes | 8, 12, 16 | 5.63 s, 5.60 s, 5.57 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/M-side-fitmap.png) |
| XS shape | front | no | 8, 12, 16 | 6.49 s, 6.46 s, 6.43 s | [XS-plain.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/XS-plain.png) |
| XS shape | front | yes | 8, 12, 16 | 6.49 s, 6.46 s, 6.43 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/XS-fitmap.png) |
| XXL shape | front | no | 8, 12, 16 | 5.80 s, 5.77 s, 5.75 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/XXL-plain.png) |
| XXL shape | front | yes | 8, 12, 16 | 5.80 s, 5.77 s, 5.75 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/rosewater-palazzo-pants/renders/XXL-fitmap.png) |

### 4. Crimson Wildflower Maxi Skirt (`crimson-wildflower-maxi-skirt`)

**Review of run 17 (stills and frames looked at):** **faulty, for evaluation only**. run 17d (stage 2 + 4 on the reviewed stills front fashn@44 + back fashn@63 from run 17c, recomposed with QA 0.12.0): THE HIPS ARE CLOSED (run 15's fault): no grey hip beside the skirt in any front or back frame (at most 3 px against run 15's up to 1,356 px, >50 px in 46 of 62 such frames), no side slit in any side view, and the asset has no opening wider than 4 cm anywhere between 3 and 99 cm above the floor (run 15: open at both hips, 10.2 and 7.8 cm across); pale pink smocked waistband front and back, print and tier band right; hip 110.35 cm by the tape against the chart's 109 with ease (+1.35); holdout IoU 0.947 / 0.947 (run 15 0.915 / 0.883). Open, flagged, not repaired: (1) no girth at the chart's only critical anchor: the band's top edge is 100.2 cm above the floor, 4.0 cm below our waist ring (104.2), so chart agreement FAILS (band girth 88.07 cm against 80.5 with ease, +7.57, uncalibrated, global scale 1.000) and the plugin's import gate refuses the bundle (qa_failed): it is NOT in the demo shop; (2) the hem is drawn over the feet: red 'boots' round both feet below the hem in most of turntable_b (85-159) and in turntable_a 40-49, so the asset's hem sits 2.2 cm above the floor (P0's maxi 11.4) and pinches in round the ankles (hem girth 86.0 cm, flare 0.78 against the hip; P0 1.25, 3.9 sigma), two foot-shaped lobes at the hem in the viewer, the grey toes just below it; (3) stage 2 flaps: translucent pale side panels on both sides of the hem in turntable_b 81-84 and a flat red tongue on the floor at the image-left in 83-94 (consistency 0.4.0 off-reference turntable_b j1-6, up to 1,504 px; the tongue mostly under the threshold), and the hem flaring out at the image-right in turntable_a 1-14 (up to 1,928 px), j71-79 (489) and b j79 (524); so the hem girth is UNCONFIRMED; (4) the baked print is smeared into vertical streaks in the viewer, with pale unprinted patches at the hem (texture holdout MAE 29.2 against one colour 34.4); (5) AU 8 / 12 / 16 differ only a little in the viewer (graded from the hip only). FAULTY, not a panel bundle, pending a founder decision: the founder's objection (the hips) is gone and no slit or hole shows, but the bundle fails the plugin's own import gate (no girth at its only critical anchor), so no shop could show it, and the grey toes show just below the hem drawn over the feet; AU 8 / 12 / 16 barely differ, which a size-picking panel needs. The founder decides whether the skirt is worn low (then the chart's waist anchor must move to the band) or new stills are needed whose band reaches the waist. Consistency 0.4.0's 41 flagged frames: 30 off-reference (above) and 11 more (turntable_a j15-25) only for skirt cover 0.865-0.899 < 0.9 below the crotch; j7-14 carry both; looked at by eye, frames 15-25 are a normal three-quarter rotation whose lower skirt is a little narrower than the stills' hull (the hem drawn in round the feet, item 2), no flap, slit or grey; not a new defect. Looked at by the evaluating agent (every render, all 160 turntable frames), not yet by the founder. Evaluated and rendered below so the fault can be seen, but not a panel bundle and not on the blind page.

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
| job export | done | job crimson-wildflower-maxi-skirt-99ab3ce9327b, input hash 99ab3ce9327b |
| 1b dress the mannequin | done | engine fashn; QA pass |
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 3.6 / 3.1 (8-bit mean abs); consistency garment-consistency-0.4.0 (CPU re-score `stage2/consistency_v2.json` identical): 41/243 frames flagged; garment off the stills' hull below the hips (flap or panel the stills do not have) in turntable_a j1–14 (max 1928 px, image-right), turntable_a j71–79 (max 489 px, image-right), turntable_b j1–6 (max 1504 px, image-right), turntable_b j79–79 (max 524 px, image-right); other flags: skirt cover below the reference: turntable_a j7–25 (19) |
| 3 separation | done | 160 garment masks of the generated frames (`stage2/garment_mask/`, garment-segment-0.1.0; 0 frames ambiguous with the mannequin); stage 4 trains on them |
| 4 reconstruction | done | 11999 triangles, mask IoU train 0.9703 / holdout 0.9662 |
| 4t template fit + bake (CPU) | done | 12940 triangles, IoU visible / silhouette train 0.9487 / 0.9457, holdout 0.9474 / 0.9469, 0 vertices inside the mannequin; hem girth UNCONFIRMED: fitted from masks of 30 turntable frames with garment off the stills' hull below the hips (stage 2 off-reference spans) |
| 5 anchoring and calibration | done | stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames); global scale 1.000 |
| 6 grading | done | 8, 10, 12, 14, 16 |
| 7 QA (chart, view, mesh) | done | chart FAIL, view front 0.964, back 0.916, 12940 triangles |
| 8 bundle | done | 842 KB in `spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/` |

**Metrics**

Mesh: stage 4t template fit of the stage 2 video (CPU: the control proxy fitted to the garment masks, texture baked from the frames) (`stage4t/stage2/garment.glb`, sha256 422b4f36f51f).

**Chart agreement** at base size 12 (tolerance ±2 cm at the critical anchors: waist). Global scale 1.0000, from no ring. The `a-line` pattern block does not fit hip (A-line hem flares freely; the fit engine skips it too), so it is reported but neither critical nor calibrated. Girths are a tape measure round the outside of the slice (`src/tape.ts`): the ring's own body part only (a sleeve fused to the bodice is passed under, like a tape under the arm), ripples shorter than about 25° smoothed, holes up to 4 cm bridged, a wider opening refused; the closed slice polyline, where there is one, is shown for comparison.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed, tape (cm) | Slice polyline (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| waist | yes | 80.50 | +3.00 (category default) | 88.07 | open or none | +7.57 | — | — | FAIL (the cloth does not reach the waist ring (104.16 cm): its top edge runs from 100.16 cm at the back to 100.16 cm at the front (plane tilted 0.34°); measured on the waistband, 1.5 cm under that edge (src/waistband.ts), as reconstructed; not calibrated. A band that sits lower than the waist ring lies on the body between the waist and the hip, so its girth says where the skirt is worn as much as how big it is) |
| hip | no | 109.00 | +5.00 (category default) | 110.35 | 110.50 | +1.35 | +1.35 | +1.35 | not fitted |

Before calibration max |error| 7.57 cm (outside ±2); after the global scale alone — cm (outside); after per-ring calibration FAIL. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): thigh 115.31, knee 115.18, calf 120.72, ankle 108.28 cm.

No girth (no cloth round the ring: it does not reach it, an opening wider than 4 cm, or cloth on less than 60 % of the way round): waist.

**Openings** (`src/bottomOpenings.ts`): none wider than 4 cm between 3.26 and 99.16 cm above the floor.

| Height (cm) | Cloth round | Gaps > 4 cm (chord at azimuth; +90° = the mannequin's left) | Bridged girth (cm) | Mannequin (cm) | Bridged − mannequin | Bridged − chart hip (109.00) | Closest cloth to the body (cm) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 101.00 | 56 % | 18.85 at -7.5°, 17.06 at -177.5° | 88.29 | 76.39 | +11.90 |  | 1.07 |
| 87.00 (hip) | 100 % | — | 110.62 | 99.92 | +10.70 | +1.62 | 1.01 |

**The pinned stills against the mannequin's width** (stage 1b garment mask and our mannequin's own silhouette in the same camera, on the row of each height at the axis, cm at the axis's depth). A closed skirt worn on the mannequin cannot be narrower than it; where it is, the generator drew the skirt narrower than the body and the later stages can only show the body there. In the front still the image's left is the mannequin's right; in the back still it is the mannequin's left:

| View | Height (cm) | Mannequin width | Garment width | Mannequin outside the garment, image left / right |
| --- | --- | --- | --- | --- |
| front | 95.00 | 33.03 | 36.11 | 0.00 / 0.00 |
| front | 90.00 | 36.98 | 40.06 | 0.00 / 0.00 |
| front | 87.36 | 37.55 | 40.91 | 0.00 / 0.00 |
| front | 84.00 | 39.25 | 42.33 | 0.00 / 0.00 |
| front | 80.00 | 39.27 | 42.07 | 0.00 / 0.00 |
| back | 95.00 | 33.03 | 35.83 | 0.00 / 0.00 |
| back | 90.00 | 36.98 | 40.34 | 0.00 / 0.00 |
| back | 87.36 | 37.55 | 40.91 | 0.00 / 0.00 |
| back | 84.00 | 39.25 | 42.33 | 0.00 / 0.00 |
| back | 80.00 | 39.27 | 42.07 | 0.00 / 0.00 |

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Definition | Vertical drop (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- | --- | --- |
| outseam | 102.34 | — | — | — | — | flat-lay, along the garment: top edge down the side seam to the hem (src/garmentLength.ts bottomLengths) |
| waist_to_hem | 99.08 | — | — | — | — | flat-lay, along the garment: top edge at the centre front to the hem (src/garmentLength.ts bottomLengths) |

Every bottom length definition on the calibrated mesh (`src/garmentLength.ts` `bottomLengths`): top edge at the centre front, along the garment front to the hem (skirt length, flat-lay) 99.08 cm (top 100.16, hem 2.16 cm above the floor); top edge at the side, along the side seam to the hem (outseam, flat-lay) 102.34 cm (top 101.56, hem 2.06 cm above the floor); top edge at the side, vertical drop to the hem 99.50 cm (top 101.56, hem 2.06 cm above the floor).

**View agreement** (the calibrated garment rendered at turntable frame 0 and N/2 against the pinned stills' garment masks; "visible" draws the mannequin as an occluder, as a viewer does, "silhouette" is the garment alone):

| View | Reference | IoU visible | IoU silhouette | Pass (visible ≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- | --- |
| front | stage1b `stage1b/garment_mask_front.png` | 0.964 | 0.965 | pass | no |
| back | stage1b `stage1b/garment_mask_back.png` | 0.916 | 0.917 | pass | no |

Against the shop photo (indicative only: different body, pose and camera; both silhouettes cropped and scaled to the same height):

| View | Normalised IoU | Mirrored | Aspect render / photo |
| --- | --- | --- | --- |
| front | 0.851 | yes | 2.35 / 2.26 |
| back | 0.823 | no | 2.31 / 1.78 |

Against the generated turntable (stage 2 frames, their garment masks from the stage 2 segmentation, the masks stage 4 trained on):

| Angle | Frame | Calibrated: visible | Calibrated: silhouette | Reconstructed: visible | Reconstructed: silhouette | Picture |
| --- | --- | --- | --- | --- | --- | --- |
| 0° | 0 | 0.963 | 0.964 | 0.963 | 0.964 | [turntable_0.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/turntable_0.png) |
| 90° | 40 | 0.948 | 0.925 | 0.948 | 0.925 | [turntable_90.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/turntable_90.png) |
| 180° | 80 | 0.919 | 0.919 | 0.919 | 0.919 | [turntable_180.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/turntable_180.png) |

Each picture: the stage 2 frame, the calibrated mesh with its baked texture (stage 4t) on our mannequin at the same camera, and the overlay (grey both, red frame mask only, blue mesh only).

Overlays: [front](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/view/back_overlay.png) (grey both, red reference only, blue render only).

**Cloth inside the mannequin** (vertices more than 0.3 cm inside its torso, leg or arm section; hidden by the body in every render, the grey patches in the pictures): 0.0 % as reconstructed (0 vertices), 0.0 % after calibration.

**Mesh health** (mesh as evaluated): 12940 triangles (budget 8000–15000: within), 6558 vertices, 1 components, 176 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

**Stage 4t** (template fit and bake, `stage4t/stage2/metrics.json`): the control proxy remeshed into cylindrical grids (body + no sleeves), carved and expanded along fixed rays to 128 training masks, 6 silhouette rounds, 228 Jacobi sweeps in 7 solves (every solve reached the 0.001 cm tolerance). Silhouette IoU per view, mean (min): train visible 0.9487 (0.9131), silhouette 0.9457 (0.9121); holdout (32 views never used) visible 0.9474 (0.9116), silhouette 0.9469 (0.9139). Inside the mannequin (signed distance to mannequin.glb < 0): 0 of 6558 vertices; below the 0.4 cm clearance by that grid SDF: 0; by the exact distance to the mannequin's triangles the closest vertex is 0.4 cm away, 0 vertices lie below the 0.4 cm clearance and 0 below 0.3 cm. Mesh: 12940 triangles, 1 components, 2 boundary loops, 0 non-manifold edges, watertight no (open by design: one tube round both legs; the top edge (waistband) and the hem are the boundary loops, any other loop is an opening the masks carved). Texture: 2048² atlas from 128 training views, 99.8 % of the chart texels seen (the rest filled by diffusion), JPEG 445 KB; on the held-out frames the texture's mean absolute error is 29.21 (one mean colour: 34.36), on 8 × 8 pixel blocks 16.77 (mean colour 22.68), 0–255.

**Stage 4 (2DGS) against stage 4t (template fit)** on the same video, both through this evaluation:

| Metric | stage 4 reconstruction of the stage 2 video (`stage4/stage2/garment.glb`) | stage 4t template fit of the stage 2 video (`stage4t/stage2/garment.glb`) |
| --- | --- | --- |
| waist girth as reconstructed (tape), cm | 81.71 | 88.07 |
| chart: max \|error\| before calibration, cm | 1.21 | 7.57 |
| chart: after the global scale, cm | — | — |
| chart: after calibration, cm | — | — |
| global scale | 1.000 | 1.000 |
| turntable 0°: IoU visible / silhouette | 0.793 / 0.945 | 0.963 / 0.964 |
| turntable 90°: IoU visible / silhouette | 0.840 / 0.883 | 0.948 / 0.925 |
| turntable 180°: IoU visible / silhouette | 0.823 / 0.934 | 0.919 / 0.919 |
| cloth inside the mannequin (> 0.3 cm), as reconstructed | 10.7 % | 0.0 % |
| cloth inside the mannequin, after calibration | 10.7 % | 0.0 % |
| triangles / components / boundary edges | 11999 / 1 / 553 | 12940 / 1 / 176 |
| waist to hem at the centre front, flat-lay, cm | 104.80 | 99.08 |
| outseam (top edge down the left side), cm | 99.25 | 102.34 |
| colour in the bundle | one mean colour #A44D4A | baked texture |
| bundle size | 240 KB | 842 KB |

**Warnings**

- no garment loop at critical ring waist: chart agreement fails there

Evaluation time on the build machine: read 260 ms, measure 18 ms, calibrate 13 ms, grade 0 ms, view renders 1030 ms.

**Drape prediction P0 in shadow mode** (`stage4t/stage2/shadow.json`, predictor drape-prior-p0-0.2.0, cell `skirt|a-line|maxi|fluid`; the prediction drives nothing yet: it is compared with what stage 4t measured on this job's mesh):

| Parameter | Predicted | On the P0 proxy | Measured (stage 4t) | Error | σ | |error| / σ | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hemFlare | 1.250 | 1.243 | 0.779 | -0.471 | 0.12 | 3.92 | predicted before leg clearance; measured on the hem ring 2 cm above the lowest body cloth |
| hemY | 11.400 | 11.400 | 2.160 | -9.240 | 6.00 | 1.54 | hem height above the floor; rule: subcategory/pattern "maxi": just above the ankle |
| length.waist_drop | 92.760 | 92.760 | 102.000 | 9.240 | 6.00 | 1.54 | vertical drop from the rule origin to the lowest body (trousers: left leg) cloth |
| depthRatio.hem | — | 0.680 | 0.669 | — | — | — | derived descriptor (P0 predicts no depth): proxy vs stage 4t |

P0 shape (the proxy built from the prediction, opened) against the stage 4t mesh: Chamfer 1.263 cm, F-score 0.731 at 1 cm, 0.795 at 2 cm; per region skirt 1.24 cm. V1 gate values: hem height error -9.24 cm, length error 9.24 cm, hem girth error -36.4 %, share of informative errors within 1.28 σ 0.00.

**Earlier runs of this product** (their own job dirs, evaluated now with the same tooling, so their numbers can differ slightly from what was reported at the time):

| Metric | run 15 (`spikes/garment-engine/out/phase0/crimson-wildflower-maxi-skirt-run15`) | this job (`spikes/garment-engine/out/phase0/crimson-wildflower-maxi-skirt`) |
| --- | --- | --- |
| job (exporter) | `crimson-wildflower-maxi-skirt-9a2b6e7f37ce` (phase0-export-0.6.0) | `crimson-wildflower-maxi-skirt-99ab3ce9327b` (phase0-export-0.6.0) |
| control proxy | control-proxy-0.3.0, hem 11.40 cm above the floor | control-proxy-0.3.0, hem 11.40 cm above the floor |
| stage 1b QA | FAIL (front), QA stage1b-qa-0.6.1 | pass, QA stage1b-qa-0.12.0 |
| evaluated mesh | stage 4t template fit of the stage 2 video | stage 4t template fit of the stage 2 video |
| critical girth by the tape, as reconstructed, cm | waist — (— before calibration) | waist 88.07 (+7.57 before calibration) |
| front hem above the floor (centre front, as reconstructed), cm | 3.31 | 2.16 |
| hem line above the floor (median of the lowest cloth per 10° sector, exemplar.json), cm | 4.16 | 2.16 |
| shoulder to hem, vertical drop, cm | 135.29 | 136.44 |
| shoulder to hem, flat-lay along the front, cm | 139.26 | 140.42 |
| pinned stills, IoU visible | front 0.894, back 0.891 | front 0.964, back 0.916 |
| stage 4t holdout IoU visible / silhouette | 0.9146 / 0.8834 | 0.9474 / 0.9469 |
| triangles | 12261 | 12940 |
| GPU cost (estimate) | 1581 s GPU, $1.68–$1.74 | 1568 s GPU, $1.61–$1.63 (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included) |

run 15 against this job: [run15-vs-current-turntable-0.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/compare/run15-vs-current-turntable-0.png) (stage 2 frame | mesh | overlay at 0°, the earlier run on top); [run15-vs-current-turntable-90.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/compare/run15-vs-current-turntable-90.png) (the same at 90°); [run15-vs-current-viewer-M-front.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/compare/run15-vs-current-viewer-M-front.png) (viewer, AU 8 / 12 / 16 on the M mannequin, front, the earlier run on top); [run15-vs-current-viewer-M-side.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/compare/run15-vs-current-viewer-M-side.png) (the same from the side).

run 15 renders: [M-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt-run15/renders/M-plain.png), [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt-run15/renders/M-three-quarter-plain.png), [M-side-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt-run15/renders/M-side-plain.png), [XS-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt-run15/renders/XS-plain.png), [XXL-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt-run15/renders/XXL-plain.png).

All dollar figures are **estimates** (list price × GPU seconds, as `phase0_lib.cost_record` writes them); the Modal invoice is the measurement. GPU seconds and wall time are measured.

| Stage | GPU | Region | GPU s | Wall s | Estimate low | Estimate high |
| --- | --- | --- | --- | --- | --- | --- |
| stage2_video | H100 | any | 1375 s | 1388 s | $1.51 | $1.52 |
| stage4_recon[stage2] | L40S | any | 194 s | 204 s | $0.10 | $0.11 |

Total: 1568 s GPU, 2336 s wall, $1.61–$1.63 (estimate) (stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included).

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | 8, 12, 16 | 5.90 s, 5.88 s, 5.85 s | [M-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-plain.png) |
| M mannequin | front | yes | 8, 12, 16 | 5.90 s, 5.88 s, 5.85 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | 8, 12, 16 | 5.87 s, 5.84 s, 5.83 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | 8, 12, 16 | 5.87 s, 5.84 s, 5.83 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | 8, 12, 16 | 5.03 s, 5.00 s, 4.99 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-side-plain.png) |
| M mannequin | side | yes | 8, 12, 16 | 5.03 s, 5.00 s, 4.99 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/M-side-fitmap.png) |
| XS shape | front | no | 8, 12, 16 | 5.86 s, 5.83 s, 5.81 s | [XS-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/XS-plain.png) |
| XS shape | front | yes | 8, 12, 16 | 5.86 s, 5.83 s, 5.81 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/XS-fitmap.png) |
| XXL shape | front | no | 8, 12, 16 | 6.76 s, 6.73 s, 6.70 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/XXL-plain.png) |
| XXL shape | front | yes | 8, 12, 16 | 6.76 s, 6.73 s, 6.70 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/crimson-wildflower-maxi-skirt/renders/XXL-fitmap.png) |

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
| 2 image to video | done | alibaba-pai/Wan2.2-Fun-A14B-Control, 40 steps, 160 turntable frames; seam drift 2.3 / 1.7 (8-bit mean abs); consistency garment-consistency-0.4.0 (re-scored on CPU, `stage2/consistency_v2.json`; the GPU run wrote garment-consistency-0.3.0): 234/243 frames flagged; other flags: garment IoU vs the pinned stills low: turntable_a j1–79 (79); turntable_b j1–79 (79); posed proxy not covered: motion j0–45, j51–80 (76) |
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

Evaluation time on the build machine: read 10 ms, measure 29 ms, calibrate 18 ms, grade 0 ms, view renders 931 ms.

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

Evaluation time on the build machine: read 12 ms, measure 28 ms, calibrate 21 ms, grade 0 ms, view renders 205 ms.

Bundle: 311 KB in `spikes/garment-engine/out/eval/aalter-studio-2/`.

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | View | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- | --- |
| M mannequin | front | no | S, M, L | 5.49 s, 5.46 s, 5.43 s | [M-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-plain.png) |
| M mannequin | front | yes | S, M, L | 5.49 s, 5.46 s, 5.43 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-fitmap.png) |
| M mannequin | three-quarter | no | S, M, L | 5.49 s, 5.44 s, 5.41 s | [M-three-quarter-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-three-quarter-plain.png) |
| M mannequin | three-quarter | yes | S, M, L | 5.49 s, 5.44 s, 5.41 s | [M-three-quarter-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-three-quarter-fitmap.png) |
| M mannequin | side | no | S, M, L | 5.82 s, 5.78 s, 5.75 s | [M-side-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-side-plain.png) |
| M mannequin | side | yes | S, M, L | 5.82 s, 5.78 s, 5.75 s | [M-side-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-side-fitmap.png) |
| XS shape | front | no | S, M, L | 5.52 s, 5.49 s, 5.46 s | [XS-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XS-plain.png) |
| XS shape | front | yes | S, M, L | 5.52 s, 5.49 s, 5.46 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XS-fitmap.png) |
| XXL shape | front | no | S, M, L | 5.89 s, 5.85 s, 5.82 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XXL-plain.png) |
| XXL shape | front | yes | S, M, L | 5.89 s, 5.85 s, 5.82 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XXL-fitmap.png) |

## How to update this document

1. Per product, the GPU run on GitHub Actions leaves `spikes/garment-engine/out/phase0/<handle>/` (stage1b/, stage2/, stage4/stage2/garment.glb, cost_summary.json). Download the artifact into that folder.
2. `pnpm build:packages && pnpm --filter @curtain/garment-spike report:bohohippychic -- --renders` evaluates every product that has a stage 4 mesh, writes the bundles to `out/eval/<handle>/`, renders sizes 8, 12 and 16 on the M mannequin (front, three-quarter and side) and the XS and XXL shapes with and without the fit map, compares the mesh with the stage 2 turntable at 0°, 90° and 180°, and rewrites this file. The hand-written part comes from `spikes/garment-engine/data/bohohippychic/phase0-written.md`.
3. Run the blind tests with five people on the blind page above, export the CSV, and record the result in `docs/STATUS.md` with the run ids.
