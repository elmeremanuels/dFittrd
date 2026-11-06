# Phase 0 on bohohippychic.com.au (generated)

Generated 2026-11-06 by `pnpm --filter @curtain/garment-spike report:bohohippychic` (`spikes/garment-engine/scripts/report-bohohippychic.ts`). Do not edit by hand: re-run it after every GPU run. Renders and bundles live under `spikes/garment-engine/out/`, which is gitignored; this file links to them and they are attached separately.

Boho Hippy Chic gave the founder consent to use its public product data and photos for this internal validation, before anything is installed on its site. Selection, AU chart and photo classification: `spikes/garment-engine/data/bohohippychic/` and `docs/research/au-size-chart.md`. Everything below that comes from a model is an estimate (AGENTS.md rule 3).

## Summary

| Product | Category | Back photo | Stage 1b | Stage 2 | Stage 4 | Chart agreement | View IoU front / back | Cost (estimate) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `azure-palm-baby-doll-dress` | dress | real (planned) | not run | not run | not run | not measured | — | — |
| `rosewater-blouse` | top | real (planned) | not run | not run | not run | not measured | — | — |
| `rosewater-palazzo-pants` | bottom | real (planned) | not run | not run | not run | not measured | — | — |
| `crimson-wildflower-maxi-skirt` | bottom | real (planned) | not run | not run | not run | not measured | — | — |
| `woodstock-wanderer-knit-cardi` | outerwear | real (planned) | not run | not run | not run | not measured | — | — |

## Phase 0 acceptance

| Item | State | Evidence |
| --- | --- | --- |
| Size test | needs people | Five people who did not build it must pick the smaller size, without labels, in at least 4 of 5 products on `http://127.0.0.1:5178/blind.html?products=eval/azure-palm-baby-doll-dress,eval/rosewater-blouse,eval/rosewater-palazzo-pants,eval/crimson-wildflower-maxi-skirt,eval/woodstock-wanderer-knit-cardi` (size mode). Bundles for the test: 0 of 5 products; renders made for 0. Not run with people yet. |
| Fabric test | needs people | Same five people, fabric mode of the same page (linen versus silk of the same garment). Not run with people yet. |
| Chart agreement | not yet measurable | No product has a stage 4 mesh yet; 4 of 5 must be within ±2 cm. |
| View agreement | needs people | The merchant must confirm that the front and back renders are recognisably their garment. Silhouette IoU against the pinned stills: not measured yet. Every pinned still on this set comes from stage 1b (generated from photos on a model), so a high IoU says stages 2–4 kept what stage 1b drew, not that stage 1b drew the shop's garment. |
| Cost | not yet measurable | No GPU run on these products yet, so no GPU seconds, wall time or cost. |
| Write-up | not met | This document covers the per-product results. Chosen models and licences are in docs/research/garment-engine.md; failures and the tolerances to use from Phase 1 can only be set once the GPU runs above exist. |

Blind test page with these products pre-selected: `http://127.0.0.1:5178/blind.html?products=eval/azure-palm-baby-doll-dress,eval/rosewater-blouse,eval/rosewater-palazzo-pants,eval/crimson-wildflower-maxi-skirt,eval/woodstock-wanderer-knit-cardi` (viewer dev server, `pnpm --filter @curtain/garment-spike viewer`). It needs the bundles in `out/eval/`, so run the report with GPU outputs first.

## What this set can and cannot show

- Every shop photo is worn by a model in a styled set, at 800 × 1200 px. The engine's photo contract (D13) is not met by any product, so these runs test the `--on-model` path: stage 1b generates the pinned stills on our mannequin from those photos. View agreement against the pinned stills therefore measures stages 2–4, not whether stage 1b reproduced the garment.
- The base size AU 12 (S-M for the cardigan) is our default; the shop does not say which size was photographed. Chart agreement is against the AU body chart plus ease at that size.
- Calibration scales each critical ring to its chart value, so after calibration the chart agreement is near 0 by construction. The informative numbers are the error before calibration and after the global scale.
- An open-front garment (the cardigan) has no closed loop at the chest, waist or hip unless the reconstruction closes it; the evaluation reports that as a failure at those anchors rather than guessing a girth.
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
| 1 | front | yes | busy | yes | 800×1200 | front (planned) |
| 2 | front | yes | busy | yes | 800×1200 |  |
| 3 | front | yes | busy | yes | 800×1200 |  |
| 4 | back | yes | busy | yes | 800×1200 | back (planned) |

Job not exported yet. Planned: front = photo 1, back = photo 4 (a real back photo, so the back would not be invented). Both are on a model (`--on-model`).

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

**Chart agreement** at base size M (tolerance ±2 cm at the critical anchors: chest). Global scale 0.9528.

| Anchor | Critical | Chart (cm) | Ease | Reconstructed (cm) | Before | After global scale | After calibration | Pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| chest | yes | 100.00 | +10.00 | 106.31 | +6.31 | +1.29 | 0.00 | pass |
| waist | no | 84.00 | +12.00 | 86.43 | +2.43 | -1.65 | 0.00 | — |
| hip | no | 104.00 | +6.00 (category default) | 109.20 | +5.20 | +0.05 | 0.00 | — |

Before calibration max |error| 6.31 cm (outside ±2); after the global scale alone 1.29 cm (within); after per-ring calibration pass. The last one is close to 0 by construction; the first two say how well the reconstruction held the garment's size.

Other rings measured (no chart value, scaled by the global scale only): shoulder 110.59, underbust 90.97, thigh 115.34, knee 126.24, upper_arm 35.89, wrist 20.88 cm.

**Lengths** (calibrated mesh against the printed lengths in the payload; reported, not calibrated):

| Length | Mesh (cm) | Printed (cm) | Difference | Note |
| --- | --- | --- | --- | --- |
| shoulder_to_hem | 112.00 | 112.00 | 0.00 | high point shoulder to the front hem, on the mannequin |
| shoulder_to_waist | — | 40.00 | — | the garment covers the mannequin's whole line here; the spike has no seam to measure it on the garment |
| sleeve_length | 57.28 | 58.00 | -0.72 |  |
| waist_to_hem | 77.56 | — | — |  |

**View agreement** (silhouette IoU of the calibrated garment rendered at turntable frame 0 and N/2):

| View | Reference | IoU | Pass (≥ 0.85, initial) | Invented back |
| --- | --- | --- | --- | --- |
| front | synthetic `synthetic/garment_mask/0000.png` | 0.990 | pass | no |
| back | synthetic `synthetic/garment_mask/0080.png` | 0.989 | pass | no |

Overlays: [front](../../spikes/garment-engine/out/eval/aalter-studio-2/view/front_overlay.png), [back](../../spikes/garment-engine/out/eval/aalter-studio-2/view/back_overlay.png) (grey both, red reference only, blue render only).

**Mesh health** (mesh as evaluated): 14720 triangles (budget 8000–15000: within), 7488 vertices, 3 components, 256 boundary edges, 0 non-manifold edges, 0 flipped edges, 0 degenerate triangles. Not checked: self-intersection; watertight where expected (openings at neckline, hem and cuffs are allowed but not located).

Evaluation time on the build machine: read 29 ms, measure 16 ms, calibrate 12 ms, grade 1 ms, view renders 186 ms.

Bundle: 307 KB in `spikes/garment-engine/out/eval/aalter-studio-2/`.

**Renders**

Stored under `out/` (gitignored); attach them separately.

| Body | Fit map | Sizes | Drape per size | File |
| --- | --- | --- | --- | --- |
| M mannequin | no | S, M, L | 4.63 s, 4.59 s, 4.55 s | [M-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-plain.png) |
| M mannequin | yes | S, M, L | 4.63 s, 4.59 s, 4.55 s | [M-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/M-fitmap.png) |
| XS shape | no | S, M, L | 5.81 s, 5.79 s, 5.77 s | [XS-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XS-plain.png) |
| XS shape | yes | S, M, L | 5.81 s, 5.79 s, 5.77 s | [XS-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XS-fitmap.png) |
| XXL shape | no | S, M, L | 5.74 s, 5.71 s, 5.69 s | [XXL-plain.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XXL-plain.png) |
| XXL shape | yes | S, M, L | 5.74 s, 5.71 s, 5.69 s | [XXL-fitmap.png](../../spikes/garment-engine/out/eval/aalter-studio-2/renders/XXL-fitmap.png) |

## How to update this document

1. Per product, the GPU run on GitHub Actions leaves `spikes/garment-engine/out/phase0/<handle>/` (stage1b/, stage2/, stage4/stage2/garment.glb, cost_summary.json). Download the artifact into that folder.
2. `pnpm build:packages && pnpm --filter @curtain/garment-spike report:bohohippychic -- --renders` evaluates every product that has a stage 4 mesh, writes the bundles to `out/eval/<handle>/`, renders sizes 8, 12 and 16 on the M mannequin and the XS and XXL shapes with and without the fit map, and rewrites this file.
3. Run the blind tests with five people on the blind page above, export the CSV, and record the result in `docs/STATUS.md` with the run ids.
