# Garment engine spike (Phase 0, model-free parts)

Spike code for Phase 0 of `docs/ENGINE-HANDOFF.md` (builder rule 1: spike code lives here, and only what passes the gate is promoted). It covers the parts of the pipeline that need no GPU and no video model:

- **Stage 3**, separation, tested on our own synthetic renders.
- **Stage 5**, anchoring and calibration.
- **Stage 6**, grading.
- **Stage 8**, the bundle files.

It runs on synthetic garments built on the canonical mannequin (`@curtain/mannequin`). Stages 2 and 4 (image → video, reconstruction) are the GPU part; the interfaces they must meet are listed at the end.

```sh
pnpm --filter @curtain/garment-spike build:bundle   # writes out/<productId>/ (gitignored)
pnpm --filter @curtain/garment-spike test
pnpm --filter @curtain/garment-spike typecheck
pnpm --filter @curtain/garment-spike lint
```

The dependencies are `@curtain/anchors`, `@curtain/mannequin` and `@curtain/schema`, used from their `dist/`. Run `pnpm build:packages` first. The package has no `build` script of its own because nothing in it ships.

## Result of `build:bundle` (Nov 5, 2026, synthetic data)

| Product (schema fixture) | Chart | Before calibration, max abs error | After global scale, max abs (QA metric) | After calibration, chart agreement | Separation IoU (72 frames, 192 px) | Triangles | Bundle |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `aalter-studio-2` shirt dress, long sleeves | body chart + ease | 6.31 cm | 1.65 cm | 0.00 cm, pass | 0.9955 (lowest frame 0.988) | 14,720 | 295 KB |
| `monochrome-03` boxy tee, short sleeves | garment chart (bust only) | 6.64 cm | 0.00 cm (one ring) | 0.00 cm, pass | 0.9912 (lowest frame 0.982) | 7,808 | 165 KB |

The "before" error is the simulated reconstruction error: 3.5 % too large, chest +1.8 cm, waist −1.2 cm, hip +0.8 cm, plus 1.5 mm of surface noise. After per-ring calibration, chart agreement is about 0 by construction. The number that carries information is the **residual after the global scale**: it shows how much per-ring correction a reconstruction needed. Its tolerance must be set from real Phase 0 data.

## What is real and what is synthetic

| Part | Status | Where |
| --- | --- | --- |
| Canonical mannequin: 3 shapes, anchor rings, length lines, camera paths, motion clip, rig | **Real** (v0, procedural) | `packages/mannequin` |
| Plane slicing of a mesh at every anchor ring → loop, girth, offset from the body; skirt loops that enclose both legs are flagged | **Real**: works on any mesh in mannequin space | `src/anchoring.ts` `measureGarment`, `measureRing` |
| Length points (hem on the front drop line, sleeve end along the arm axis) | **Real** | `measureGarment` |
| Calibration: least-squares global scale, then per-ring corrections applied with the `@curtain/anchors` morph; merchant sample measurements win over the chart | **Real** | `calibrate`, `applyCalibration` |
| Body/arm chain per vertex from geometry and normals (no part labels needed) | **Real**, but a heuristic | `assignChains` in `src/garment.ts` |
| Grading: per size, target = base + chart delta; standard increments where the chart has no column (logged as estimates); device-side morph | **Real** | `src/grading.ts` |
| Garment mask = dressed frame vs bare frame difference, 3×3 majority vote, IoU vs ground truth | **Real algorithm**, tested on synthetic frames only | `src/separation.ts` `differenceMask`, `separate` |
| material.json from the `@curtain/schema` fabric library (`resolveFabric`) | **Real** | `src/product.ts` `materialJson` |
| Bundle writer (base.glb, anchors.json, grading.json, material.json, qa.json), input hash, determinism | **Real format**, no Draco, no KTX2 textures | `src/bundle.ts` |
| Garment meshes | **Synthetic**: lofted around the mannequin from the size chart at base size M (product ease or the category default), A-line flare, sleeves along the arms | `generateGarment` |
| Reconstruction error | **Synthetic**: `distortGarment` (global scale, per-ring bias, noise) | `src/garment.ts` |
| "Video" frames | **Synthetic**: our software rasterizer, flat Lambert with a head light, chroma-green background, Gaussian pixel noise (σ = 2) on both frames | `src/raster.ts` |
| Products | Schema fixtures `aalter-studio-2` and `monochrome-03`, not pilot products | `src/product.ts` |

## Limits found in the spike

- **The shoulder width is not the shoulder ring.** The chart column `shoulder` is a width (shoulder to shoulder). The D15 ring `shoulder` is a girth. Since review finding R1 the vocabulary says so: the fit point `shoulder` maps to the breadth anchor `shoulder_width` (`@curtain/anchors`), and the fit engine's `anchorGaps` keys the shoulder gap that way, never under the ring. The spike still does not calibrate the shoulder ring against the chart (no chart has a shoulder girth); it grades the ring by the standard increment. grading.json does not carry `shoulder_width` yet (the spike reads only the girth columns of the chart).
- **A garment the colour of the mannequin cannot be separated by difference alone.** A test shows IoU < 0.5 for a mid-grey tee. Stage 3 needs the segmentation model and the motion signal, or a mannequin colour chosen per product.
- **The difference method assumes the generated video keeps the mannequin's look** (mid-grey, same light) wherever no cloth covers it. A real video model will not hold this exactly. Expect the threshold and the cleanup to need tuning, and use the bare-mannequin mask only as a prior.
- **Near the armhole, a roomy torso and a sleeve can occupy the same place.** `assignChains` decides by the outward normal, and the sleeve cap above the armpit grades with the body. This needs outward-oriented triangles from stage 4.
- **The synthetic garments are open, manifold surfaces.** The handoff's mesh-health check ("watertight where expected") must allow the neckline, hem and sleeve openings.
- The tee has 7.8k triangles, below the 8–15k guidance; the budget check only enforces the upper bound.

## Evaluation on the first real asset (run 14)

`report:bohohippychic` evaluates every stage 4 mesh in `out/phase0/<handle>/` (`src/eval*.ts`) and writes `docs/research/phase0-bohohippychic.md`. Run 14's Azure Palm babydoll was the first real mesh it saw, and three things broke; the fixes changed the stage 5 measurement for evaluated meshes:

- **Girth is a tape measure** (`src/tape.ts`, `measureRing(…, { girth: 'tape', body })`), not the slice polyline. A reconstructed surface ripples by ±1–2 cm and the polyline followed it (hip 129.6 cm on a 100 cm body; 106.5 cm with the tape). The tape takes the median radius per 5° round the ring centre, smooths ripples under about 25°, takes the convex hull, keeps only the ring's own body part (each slice point goes to the nearest loop of the mannequin's slice, so a sleeve fused to the bodice is passed under like a tape under the arm), bridges holes up to 4 cm and refuses a wider opening (an open front). On the smooth synthetic garments it equals the polyline to under 0.6 cm. `build:bundle` and the synthetic pipeline keep the polyline (`girth: 'loop'`, the default).
- **Critical anchors follow the pattern block**, as `computeFit` does: the category's fit points minus `BLOCKS[block].skip` unless the product names them. Skipped rings (`EvalChart.notFitted`) are reported but neither critical nor calibrated. The empire babydoll keeps only the chest; the shirt blouse and the oversized cardigan the chest, the a-line skirt the waist.
- **View agreement** gives the silhouette IoU without the mannequin as occluder next to the visible one, compares the mesh with the stage 2 turntable at 0°, 90° and 180° (`view/turntable_<deg>.png`: frame, mesh in its stage 4 vertex colours, overlay), and `insideBody` reports the share of vertices more than 3 mm inside the analytic mannequin (21.9 % on run 14's 2DGS mesh, 2.3 % on the synthetic dress; by the sign of the grid SDF of `mannequin.glb` run 14 gives 26.2 %). The report also grades against the shop's printed garment table and copies in the hand-written `data/bohohippychic/phase0-written.md` (run history and verdict); while `data/bohohippychic/panel-hold.txt` exists, its sentence is added to the size and fabric rows of the generated acceptance table, saying not to run the five-person panel yet, so the generated table and the written verdict agree.

Result on run 14 (details and every render in the report): chest 99.0 cm against the printed 102 (−2.98 cm before calibration, global scale 1.030), length 83.3 cm against the printed 91; silhouette IoU 0.93 / 0.95 against the pinned stills, visible IoU 0.71 / 0.75. In the viewer the mannequin shows through the bodice and the print is lost (the bundle carries one mean colour), so the size panel should not see this asset yet.

## Stage 4t: template fit and texture bake (CPU)

```sh
pnpm --filter @curtain/garment-spike stage4t -- out/phase0/<handle> [--source stage2|synthetic] [--no-previews]
pnpm --filter @curtain/garment-spike stage4t:compare -- out/phase0/<handle>       # 2DGS vs stage 4t: clearance (3 methods), IoU train/holdout
pnpm --filter @curtain/garment-spike stage4t:perturbed -- out/phase0/aalter-studio-2  # fit from templates that are not the garment
pnpm --filter @curtain/garment-spike stage4t -- out/phase0/<handle> --views 0,80   # predicted route: front + back only, depth from the template
pnpm --filter @curtain/garment-spike prediction:v0 -- <job dir> …                  # V0 of docs/PREDICTION-ENGINE.md: P0 alone, two-view, full
```

`--views` fits and bakes from the given frames only (the pinned front and back stills are frames 0 and N/2) with `depthPrior: 'template'`: front and back views carve width, outline, hem and cuffs, and every ring keeps the template's cross-section scaled to the width the masks show. Result (V0, `docs/research/prediction-v0.md`): two-view Chamfer 0.33–0.84 cm from P0 and at most 1.47 cm from a wrong template on all five garment types and run 14; the turntable fit run unchanged on two views lands at 9–13 cm.

The alternative to stage 4's 2DGS + TSDF, and the asset the evaluation picks when it exists (`evalJob.chooseMesh`). `src/templateFit.ts`: the control proxy remeshed into a body tube and, when the masks show sleeves, one tube per arm that starts with a shoulder cap (`SHOULDER_CAP`: rays fanned from the shoulder joint up to 88° towards the shoulder, close to its normal, so the cloth over the arm cap is formed instead of slid along; `CONTROL_CAP`: on the sleeve head, a frame's non-garment pixels are left out only where that frame's control render (`control/mask`, `control/proxy_mask`) shows the bare v0 arm cap, grown by the clearance + 0.3 cm, because a sleeveless control proxy leaves that cap bare in the generated video; elsewhere and on frames without a control, mannequin and background carve the head as everywhere); every vertex moves only along a fixed ray, within [mannequin + 4 mm (signed distance to `mannequin.glb`, `src/bodySdf.ts`), the next body part], to the visual hull of the training masks (frame index mod 5 = 2 held out), regularised by a Laplacian on the radial offsets, then silhouette rounds; hem and cuffs per column from the masks; body rays end at a fitted sleeve (the arm–torso gap cannot be carved); after the solve every vertex closer than 4 mm to `mannequin.glb` by the exact point-to-triangle distance, or inside it, moves out along its ray (`pushToClearance`). `src/bake.ts`: the frames projected into a UV atlas (best-facing views, kept off the mask edge, outliers dropped, the rest filled by pull-push diffusion); `src/jpeg.ts` baseline JPEG; `src/glbTextured.ts` the textured `garment.glb`. Writes `stage4t/<source>/{garment.glb, texture.jpg, atlas.png, metrics.json, preview/}`. The bundle's `base.glb` carries the texture; the viewer welds the UV seams for the drape, pins each sleeve piece all round its head down to the armpit (`pinLoosePieces`), holds a gathered cuff on a 0.5 cm leash (`gatheredCuff`, `CUFF_LEASH_CM`), and lifts a capped sleeve's cloth that grading pushed into the arm cap back out (`armCapLifter`).

Mask clean-up works in garment units (`views.ts`, `pixelsPerCm` from the camera): holes up to 12 cm² are filled as noise, so openings from about 3.5 × 3.5 cm up are carved (a 10 × 5 cm keyhole stays open at 480 × 832 and at half that).

Result (stage 4t 0.3.0, 7 Nov 2026): synthetic shirt dress Chamfer 0.443 cm to the truth (0.437 without shoulder caps; 2DGS 1.45 cm), F-score 0.956 at 1 cm, 0 vertices inside the mannequin, closest 4.0 mm. Its exported template is built from the same spec as the truth (0.57 cm from it before the fit), so `stage4t:perturbed` also fits from a template 8 % wider with the hem 8 cm higher, one 6 % narrower with the hem 8 cm lower, and another product's proxy (1.55, 1.55 and 3.11 cm from the truth): all four land at 0.442–0.443 cm, per region shoulders 0.82, bodice 0.44, skirt 0.34, sleeves 0.57 cm (0.2.0: 0.81, 0.42, 0.33, 0.58); the shoulders and sleeves end further from the truth than the correct template was (0.60, 0.29 cm), the visual hull's limit. The synthetic frames have no control, so its cap rows are carved by the masks like any ray. Run 14: 0 of 5,778 vertices inside the mannequin (2DGS: 21.9 % more than 3 mm inside by the analytic test, 26.2 % inside by the SDF sign), closest vertex 4.0 mm from `mannequin.glb` by the exact distance; holdout visible IoU 0.901 (0.2.0: 0.906; 2DGS 0.697), holdout silhouette IoU 0.884 (0.887; 2DGS 0.900: the outline fits slightly worse, the visible garment much better), chest 101.1 cm against the chart's 102 before calibration, 11,216 triangles, `garment.glb` 724 KB. The shoulder tops are closed (0.2.0 left them bare: the rays ran parallel to the cloth over the arm cap, and the sleeveless control made the frames show the mannequin's cap there; 35 sleeve-head rays are kept because the control decided those pixels). The cap's print is mostly synthesized fill: 48.8 % of its texels (within 6 cm of the cap tops) are sampled from a frame, and the holdout photometric check does not cover the cap. In the viewer's drape (AU 12, M) the free sleeve particles' centroid drops 1.14 / 0.88 cm (old pins 1.44 / 1.15) and the cuff band 0.27 / 0.42 cm (1.57 / 2.04); p99 edge strain 11.7 / 7.8 / 8.4 % and max 42.0 / 26.0 / 28.3 % in AU 8 / 12 / 16 (AU 8's maximum on pinned edges at the lifted cap). Remaining: a grey patch at the back shoulder in AU 8 from the side, the side view hangs straight, the top of the puff settles towards the arm. Details: `docs/research/phase0-bohohippychic.md`, "Template fit".

Garment length: `src/garmentLength.ts` measures shoulder to hem four ways (vertical drop from the HPS, flat-lay along the front from the HPS, back length, shoulder-point drop). A shop's printed length is read as flat-lay; the spike's synthetic garment is built as a vertical drop (`printedLength` in `evaluateGarment`). Proxy 0.2.0 ends its hem where its own front is the printed length long.

## Other categories: blouse, trousers, skirt, cardigan (7 Nov 2026, before the next GPU run)

One product per Bohohippychic category (`rosewater-blouse`, `rosewater-palazzo-pants`, `crimson-wildflower-maxi-skirt`, `woodstock-wanderer-knit-cardi`, next to the azure dress) checked through every non-GPU step; what was missing is now built and tested:

- **Garment features** (`src/features.ts`, `features` beside the payload in `products.json`, hashed into the job): sleeve style, front closure and neckline from the description's own words ("airy half sleeves", "deep V neckline with button front"). The payload has no field for them.
- **Proxy 0.3.0** (`src/proxy.ts`): a sleeve style gives sleeve shells where no sleeve length is printed (the blouse had bare arms in its control, and stage 1b's fixed sleeve band would have cut its sleeves); an outerwear front opening (open front, V, deep V) is pushed into the mannequin so the control and the stage 1b target show the mannequin between the fronts (the shell stays closed for stage 4t's signed distance). Products without these features get byte-identical geometry to 0.2.0 (checked for the dress and the skirt). Trousers (seat + two legs with a gap) and the skirt (waist to hem, no bodice) were already in 0.2.0, but 0.2.0's trouser seat kept the hip ellipse down to the crotch and stood 2-4 cm proud of the legs at the front and back, a ledge that reads as a skort or an overskirt; 0.3.0 eases it from the hip onto the convex hull of the two leg tops (no wider and no deeper than the legs; test).
- **Prompts** (`neutral-prompt-0.3.0`): "a half-sleeved blouse", "with a deep V neckline open to the underbust, buttoned below it"; skirt and trousers are "worn at the waist on a bare torso" and ban dress, bodice and top; trousers also ban "one closed skirt between the legs", a skort, an overskirt and a peplum; an open front bans a closed pullover, a jumper closed at the front and a high round neckline (not "sweater": a knit cardigan is a cardigan sweater). The Modal prompt guard (`phase0_lib.prompt_problems`) requires these terms, and "dress" in a top's or an outerwear garment's negative.
- **Stage 1b QA 0.6.0** (`modal/phase0_dress.py`): trousers fail when the garment closes the axis between the proxy's legs in more than 25 % of the leg rows; a skirt or trousers fails with more than 5 % of the garment above the waistband; an outerwear front opening is kept out of FASHN's edit region and fails when more than half of it is covered. FASHN labels a trouser garment `pants`. Thresholds provisional (no generated still of these kinds seen yet); the proxy-dressed renders of all five products pass every check. **QA 0.6.1:** these three are also listed as `type_failures` (and `type_failed_views` in the stage 1b summary). They mean a different garment was drawn, so `--accept-failed-dress` does not override them: `run_phase0` stops before stage 2 (about 90 % of a product's GPU cost), also when stage 1b ran on its own before (its `record.json`). `--accept-failed-dress` still overrides the provisional silhouette and fidelity checks.
- **Export 0.6.0**: the synthetic garment (stage 4 truth) exists for every kind; skirt, trousers and outerwear use the proxy's own surfaces with the caps and the front opening removed (`syntheticGarmentFromProxy`). `export:phase0 -- --shop <shop> --product <handle> --synthetic-photos` is a dry run without raw photos and stage 1b (written to `out/phase0-synthetic/`).
- **Runner**: `.github/workflows/modal.yml` copies `spikes/garment-engine/out` into the artifact in its own `if: always()` step, so a failed command or a job that hits `timeout-minutes` (330) still uploads the outputs of the products that finished.
- **Stage 4t 0.3.0** (`src/templateFit.ts`): trousers are fitted as a seat plus one tube per leg (`legs`, from the manifest's proxy kind). One tube round both legs, as a skirt is fitted, has no inner leg at all: the trousers became a skirt (test). `stage4t -- --template-size <size>` fits from the proxy of another size.
- **Lengths per type** (`src/garmentLength.ts` `bottomLengths`, used by `evaluateGarment`): trousers outseam (top edge down the side seam) and inseam (crotch down the inner leg), skirt waist to hem (centre front), each flat-lay or as a drop; tops keep the HPS definitions. **Outerwear chest:** when the product has a front opening (the manifest's `control.proxy.front_opening`, from its description), the tape bridges one gap centred on the front up to the opening's own width at that ring + 4 cm (`FRONT_OPENING_SLACK_CM`), as a flat-lay chest lays the fronts closed. The bridged arc does not count as cloth in the tape's coverage. Outerwear without an opening, any wider gap, and every other garment still get no girth across a gap wider than 4 cm.

Measured on this 4-core machine. Real jobs (shop photos from `raw/`, stage 1b inputs): 1,543 files, 25–27 s each. Stage 4t on each product's synthetic frames (160 views, 128 train, 32 holdout, fitted from `control/proxy.glb`):

| Product | Triangles | Chamfer to the truth | Holdout IoU visible / silhouette | Inside the mannequin | Length on the fit (truth) | Chest/waist before calibration | Time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| blouse (top, half sleeves) | 10,460 | 0.481 cm | 0.977 / 0.952 | 0 of 5,394 | HPS flat-lay 72.55 (73.03) | chest 102.16 / chart 103 | 91 s |
| palazzo (trousers, 2 legs) | 9,600 | 0.849 cm | 0.973 / 0.961 | 0 of 4,940 | outseam 102.53 (103.11), inseam 73.79 (71.50) | waist 81.12 / 79.5, hip 118.08 / 118 | 90 s |
| maxi skirt | 12,496 | 0.290 cm | 0.987 / 0.976 | 0 of 6,336 | waist to hem 94.45 (95.12) | waist 81.00 / 79.5 | 82 s |
| cardigan (deep V, sleeves) | 10,023 | 0.520 cm | 0.972 / 0.955 | 0 of 5,181 | HPS flat-lay 60.44 (62.70) | chest 102.88 / 102 (V bridged: 4.6 cm, tape coverage 0.94) | 89 s |

Fitted instead from the proxy at another size (blouse 16, palazzo 8, skirt 16, cardigan M-L), every product lands on the same surface (identical Chamfer and IoU; the cardigan 10,025 triangles instead of 10,023). The truths are the products' own proxies (opened), so these numbers prove the pipeline handles each garment type, not that a generated video will be fitted this well. The palazzo hip (118.08 against 118) was 120.96 with 0.2.0's seat; the tapered seat no longer bulges below the hip.

Not covered here: the viewer (`viewer/`) has only been checked on dresses, tops and a skirt cut from the dress; trousers with two leg tubes and an open cardigan have never been draped in it. The stage 2 consistency metric checks merged legs (trousers) and a gap between the legs (dress, skirt), not a closed front (outerwear).

## Cut families: build once per cut, swap the print

Shops sell one cut in many colours and prints. The full pipeline (stage 1b → 2 → 4) runs once per **cut family**, for its reference member; every other member only gets **stage 4b**, a new texture projected from its own front and back stills onto the reference mesh.

```sh
pnpm --filter @curtain/garment-spike shop:bohohippychic -- --fetch-catalogue  # catalogue pages into raw/ (once; writes no JSON)
pnpm --filter @curtain/garment-spike families:bohohippychic -- --fetch        # + main photos; writes data/bohohippychic/families.json
modal run spikes/garment-engine/modal/stage4b_retexture.py --ref-job-dir <reference job> --source stage2 \
  --variant-job-dir <variant job with stage 1b stills> --variant-id <handle> --family-id <id>
```

- **Grouping** (`src/families.ts`): same product type, same size values, same title stem and same description after removing colour words, print words, variant codes (PWP1) and shop boilerplate ("Singlet is not included", colour disclaimers, "Colour:" lines); measurements stay in. Rule 4b also joins descriptions with identical measurement numbers (at least two) and a word-set Jaccard of at least 0.9, against every group already in the family (no chaining): one-phrase copy edits such as "Best seller in store" no longer split a cut. Members joined this way carry `descriptionJaccard` and a note; the family has `textMatch: "similar"`. A silhouette check on the main photo (`src/familiesSilhouette.ts`, mask IoU after scale normalisation, threshold 0.6) splits false merges. The reference is the member with the best photos (no model first, then resolution, then image count). A member whose fabric or size chart differs from the reference is flagged `ownAsset` and gets its own full run.
- **Buildable types only.** `ASSET_TYPES` holds the types the engine can build today (Dresses, Tops, Pants, Skirts, Jackets & Knits, Clothing). Jumpsuits & Sets is in `PENDING_ASSET_TYPES`: no engine category or proxy for a garment that spans torso and legs, so its families are `assetEligible: false` with a `pendingCategory` reason and counted in `counts.pendingCategory`, never in the savings.
- **Result on bohohippychic** (2026-11-06, `families.json`, regenerated offline from the catalogue in `raw/`): 667 products → 565 families (39 with more than one member). In buildable garment types 525 products need **434 full runs, and 91 need only stage 4b** (64 with the exact description rule alone; 29 members joined by rule 4b). Two members joined by rule 4b have a different fabric reading (Earthweave Purple, Chocolate Drift Lace Blouse) and keep their own full run. Jumpsuits & Sets: 12 products → 4 families, 8 would need only stage 4b once the category exists. The largest family is the Earthweave Knit Top (31 colours). 34 more groups in garment types share a title stem but not similar copy; the rules never merge those, a merchant confirmation could save up to 43 more runs.
- **Silhouette check: implemented, splits nothing here.** All 94 main photos it looked at are on a model in a styled set; the border-colour mask refuses every one ("not a plain backdrop"), so no member is split and no member is checked. It works on plain-backdrop photos (tests) and accepts a garment mask from a segmentation model (`raw/<handle>/main-mask.png`).
- **Stage 4b** (`modal/stage4b_retexture.py`, pure Python, CPU, no video model): projects the variant's front/back stills through the known turntable cameras (frame 0 and N/2), with a z-buffer, the garment mask and a grazing-angle cut; the sides neither still sees are filled by mirroring the nearest seen print across the visibility boundary in a cylinder grid around the turntable axis (no generative fill). It writes `stage4b/<source>/variants/<id>/{texture.png, material.json, preview.glb, record.json}` and the bundle's `variants.json` into the reference job. Stage 4 writes no UVs yet, so stage 4b gives every triangle its own atlas cell (`garment_uv.glb`, shared by the family). On a 12k-triangle cylinder at 480×832 with a 1024 texture the core takes about 4 s locally; it has not run on Modal.

## What Phase 0 still needs from a GPU service and video models

The candidates, licences and costs are in `docs/research/garment-engine.md`. The stages below plug into the spike by replacing `generateGarment` + `distortGarment` in `buildBundle` (`src/bundle.ts`). Everything after that point stays as it is.

### Stage 2: image to video (GPU or hosted video model)

**Input** (one job per product and clip):

| Field | Type | Source |
| --- | --- | --- |
| `mannequin` | `{ version, shape: 'M', glbSha256 }` | `packages/mannequin` `out/M/` |
| `cameraPath` | `CameraFrame[]` (`position`, `lookAt`, `up`, `fovYDeg` per frame; `turntable_mid` with 72 frames, or all three heights) | `turntablePaths(mannequin)` |
| `motion` | `MotionClip` (keyframed joint angles) plus `clipFrameTimes` | `MOTION_CLIP` |
| `control` | Per-frame depth (cm, float) and silhouette of the bare mannequin along the same path, for control-video models (Wan2.2-Fun Control) | `render([...]).depth`, `.ids` in `src/raster.ts` |
| `pinned` | `{ frame: 0, image: dressedFront }`, `{ frame: N/2, image: dressedBack }`, plus merchant video frames at their estimated azimuths | Stage 1 cut-outs, try-on onto the mannequin render |
| `references` | Detail photos | Merchant |
| `model`, `version`, `seed` | Pinned (builder rule 5) | Provider registry |

**Output:**

| Field | Type | Contract |
| --- | --- | --- |
| `frames` | RGB images, one per camera frame, same resolution for all | Frame `i` is seen from `cameraPath[i]`. For hosted models without camera control, also return `poses: CameraFrame[]` re-estimated per frame and their reprojection error |
| `motionFrames` | RGB images, one per `clipFrameTimes` entry, from `motionCamera(mannequin)` | Same mannequin, same light |
| `meta` | `{ model, version, seed, gpuSeconds, costCents }` | Goes into the asset record and `qa.json` |

We render the bare-mannequin frames ourselves along the same path (`render` with only the mannequin). They cost nothing and need no model.

### Stage 3: separation (completion)

The spike implements the difference part. Two more pieces are still missing:

- A segmentation refinement: SAM 2 (Apache-2.0) or BiRefNet (MIT), prompted with the difference mask.
- The motion signal: cloth that lags the posed mannequin during the clip.

Interface: input `frames`, the bare frames and the masks from `differenceMask`. Output, per frame: `{ mask: Uint8Array (w×h), confidence: Float32Array (w×h) }`. Acceptance on synthetic frames today: IoU > 0.95. On generated frames, the threshold comes from Phase 0 data.

### Stage 4: reconstruction (GPU: gsplat 2DGS + TSDF, or a NeuS-style SDF)

**Input:** the stage 2 frames with their `CameraFrame`s (or K and [R|t] derived from them via `cameraMatrices`), the stage 3 masks and confidences, the bare-mannequin depth per frame (the inside of the garment is the mannequin surface plus ease), the mannequin .glb, the merchant's front and back photos for texture projection, and a triangle budget of 8–15k.

**Output:** a `Mesh` as defined in `@curtain/mannequin`:

- `positions` as `Float64Array` in cm, in mannequin space (+Y up, +Z front, +X the mannequin's left), the M shape in A-pose.
- `indices` as `Uint32Array`, with outward-oriented triangles.
- `vertexPart` may be all zeros; `assignChains` derives the chains.

The mesh must be manifold and may be open at the neckline, hem and cuffs. Textures come with it (front and back projected from the merchant photos; real pixels win). After that, call `measureGarment` → `calibrate` → `applyCalibration` → `gradeGarment` → bundle, unchanged.

### Stage 7 (not in the spike)

Drape simulation and the "3 s settle" check, colour and view agreement against the merchant photos, Draco compression and KTX2 textures.
