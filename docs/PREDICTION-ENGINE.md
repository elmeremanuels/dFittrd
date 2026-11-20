# Drape prediction engine (`@curtain/drape-prior`)

Status: design, Nov 2026 (decision D18). Nothing in this document is built yet. The numbers for Bohohippychic come from read-only analyses that ran the spike's `buildShopPayload` (`spikes/garment-engine/src/shop.ts`) and `resolveFabric` over the 667 raw products, joined with `data/bohohippychic/families.json`. They are estimates of the opportunity until shadow mode (§7) measures them.

## 1. Purpose

The founder's idea: once the engine knows how a garment behaves, it can predict how a related garment drapes. "A silk dress behaves roughly like a silk skirt." We pull as much data from the merchant as we can; prediction fills the gaps.

Made precise, the idea splits in two:

- **Material behaviour belongs to the fabric, not the cut.** Bending stiffness, stretch and shear stiffness, mass, damping, friction (cling), sheen and opacity of viscose are the same in a dress, a skirt and a blouse. Material therefore transfers **across categories** on the fabric key.
- **Shape behaviour belongs to the cut, modulated by the fabric.** Hem flare, how far the hem stands off the body, front-to-back depth, sleeve volume and how the length hangs depend on the pattern; the fabric changes how much of the cut's fullness shows. Shape therefore transfers only **within a cut class, or within a body region two cuts share** (the hip-to-hem region of a maxi dress and of a maxi skirt).

The visible garment is `sim(pattern, material)` on our own mannequin. The engine predicts the two inputs and lets the solver produce the shape; it never averages finished fold geometry.

It has three jobs:

1. **Fill drape and look parameters** for every asset (material and off-anchor shape), replacing the fabric library's estimated values with calibrated ones over time.
2. **Decide per product** whether the expensive GPU run (stage 2 video on Wan, $1.47–1.49 of the ~$1.57–1.63 per product) can be skipped.
3. **Act as a QA prior and fallback** for GPU output (run 14 came out at 83.3 cm long against a printed 91 cm; a predicted asset is the fallback when a GPU run fails QA).

## 2. What it never does: sizing

Sizing never depends on prediction. This is a hard boundary, enforced by tests.

- Fit and size stay in `@curtain/fit-engine`, on the device, from the size chart (AGENTS.md rule 4). The predictor has no sizing output.
- **The predictor never writes into `GarmentPayload`.** `computeFit` reads `garment.fabric.stretchPct` (`packages/fit-engine/src/computeFit.ts:155`; ease target × `max(0, 1 − stretch/EASE_STRETCH_DIVISOR)`, divisor 40) as well as `ease` and the `BLOCKS` rules. A predicted stretch, ease or block would silently change the size advice. Predictions live only in the asset bundle (`prediction.json`, `material.json` with provenance). They may be offered to the merchant as a **prefill**; once the merchant confirms a value it is merchant data, not a prediction (the same rule as the fabric library, `docs/research/fabrics.md`).
- **D15 pin.** At every critical anchor ring, a predicted asset's girth equals what the fit engine uses (chart + product ease, else `CATEGORY_EASE`/`BLOCKS`), exactly as `proxy.ts` `ringGirths` does today. Prediction fills only what lies between and beyond the anchors: flare below the hip, hem, depth, sleeve volume, material. The picture and the size advice cannot contradict each other.
- Grading between sizes stays in `grading.ts` from chart deltas.
- Tests (CI):
  1. `computeFit` output is byte-identical with and without a predicted bundle present.
  2. For every predicted asset, each critical anchor girth equals the fit-engine target within 0.1 cm.
  3. `packages/drape-prior` imports nothing from capture, body or fit modules (lint).

## 3. Inputs

All inputs are public product data, merchant-entered product fields and our own assets (D3, D16). No shopper data is ever an input.

### 3.1 Order of trust

Merchant-confirmed value > merchant video calibration > physical swatch measurement > calibrated table (from our GPU assets) > fabric library > rule. A prediction never overrides merchant data. Every output value carries its provenance: `merchant | video | swatch | calibrated | library | rule | exemplar | regressor`.

### 3.2 Product data (pulled automatically)

| Group | Fields | Source |
| --- | --- | --- |
| Cut | category, subcategory, `patternBlock`, proxy kind, title/tag tokens (maxi/midi/mini, tiered, wrap, slip, empire/babydoll, puff/bell/flutter/batwing sleeve, cropped, wide-leg, palazzo, bias, lined) | `inferCategory`, `patternBlockFor` (`BLOCK_RULES`), `proxyKind` |
| Fabric | primary, blend, construction, `weightGsm`, `stretchPct`, `drape`, `sheen`, `opacity`, provenance per field | `fabricStatement` + `resolveFabric` (`packages/schema`, library v1.0.0) |
| Chart | `sizeChartType`, `sizeChart`, `ease`, `lengthCm`, `baseSize`, `sampleMeasurements` | `buildShopPayload`, AU chart |
| Photos | front/back roles; stage 1b stills on our mannequin with garment masks ($0.02–0.07) | D13, stage 1b |
| Family | family id, reference, `ownAsset` | `families.json` |
| Platform | Shopify `$app:curtain` metafields, Standard Product Taxonomy category metafields (fabric, sleeve length type, skirt/dress length type, neckline; exact keys to verify), Woo `pa_*` attributes and `_curtain_*` meta | D1, D6 |

What Bohohippychic gives on its **434 buildable full runs**: a fabric statement on 302 (70 %), **none on 132 (30 %)**; a % composition on 113 (26 %); a size chart on about two thirds (none on 141, mostly Jackets & Knits and Tops); a printed length on 6 %; a pattern block from keywords on about half. **Silk: 0 products.** The founder's silk example maps to viscose/rayon here (142 full runs, across dresses, tops, pants, skirts and jackets), which is the dominant fabric.

### 3.3 Merchant data capture (the "3D ready" track)

The rows go in the optional 3D-ready track of the chart builder (`packages/shopify-app/src/chartBuilder.ts` `RENDER_ITEMS`, shown only with `{ render: true }`; Woo meta box equivalent). They are never required for size advice: `SIZE_ADVICE_FIELDS` stays `category, sizeChartType, sizeChart`. All rows are prefilled from the description import, so the merchant confirms rather than types. Ranked by value per merchant-minute:

1. **Fabric confirmation**: fibre % plus a construction picker (woven, jersey, crepe, chiffon, satin, lace, sweater knit, crochet, denim, linen). Unlocks the fabric gate for the 132 unstated products.
2. **Silhouette picker** with pictograms (slip/column, A-line, tiered, wrap, empire/babydoll, shirt, oversized/boxy, wide-leg, straight, tapered). Also improves size advice (`BLOCKS` skips and ease), so it ships in Phase 2 regardless.
3. **Base size** and **front/back photo role tags** (required for any asset, D13).
4. **Length** (shoulder-to-hem or waist-to-hem) and a **sleeve picker** (none, cap, short, elbow, long; puff, bell, flutter).
5. **`sampleMeasurements` at the base size**, plus a new **hem width (flat)**. Hem width is the single number that pins `hemFlare`.
6. **Stretch class** (none, slight, stretchy). Already feeds sizing once confirmed.
7. **Lined yes/no, cut on the bias yes/no, opacity class.** Optional; they switch the physics model (§4.4).
8. **A 10–20 s video** of the garment in motion. Optional. Calibrates the material for that fabric key, and the result transfers to every product in that fabric.

**Data before prediction.** When the main driver of a product's uncertainty is a missing fact (fabric unknown, no length, no hem width), the merchant panel asks for that fact first ("add the fabric to save a full 3D build") before the engine predicts or builds.

## 4. Outputs and model

### 4.1 Outputs (`prediction.json`, one per product, part of `input_hash`)

- **Material vector** (extends `deriveFabricSimulation` and `material.json`), each with σ and provenance, in physical units:
  `massKgM2` (from gsm), `stretchStiffness` warp/weft (N/m), `shearStiffness` (N/m), `bendStiffness` (KES-F B), `damping`, `friction` (cloth on body, μ), `thicknessMm`, plus look values `sheen`, `opacity`, `texture` preset. `stretchPct` here is **simulation only** (§2).
- **Pattern parameters** (a superset of `ProxySpec` in `proxy.ts`), each with σ: undraped cut fullness/flare (hem girth over hip girth; `thighOfHip`, `hemOfThigh` for trousers), off-anchor ease (underbust, below-hip, thigh, knee, upper arm, wrist), waistline height, length (HPS surface length or length class), tier count and flare step, gather ratio at seams, sleeve length and volume profile (upper-arm and cuff girth over arm girth), neckline depth/width, elastic waist.
- **Derived shape descriptors** (produced by simulating pattern × material on mannequin M, used for gating and QA): `hemFlare` as draped, `hangRatio` (settled drop over flat-lay length; run 14: 84.4 / 92.6 = 0.91), `depthRatio` per ring, `sleeveVolume`, hem fold count.
- **Route**: `full` (1b → 2 → 4t) | `predicted` (1b + two-view 4t on the predicted template + bake; no stage 2) | `retexture` (stage 4b on a family reference, as today) | `none` (size advice only).
- **Confidence** in [0, 1] with reasons, plus `predictorVersion`, `drapeTableVersion` and the hash of the exemplar set.

### 4.2 Material model: a calibrated hierarchical table

- **Prior (v0)** is the existing fabric library (`FABRIC_LIBRARY`, `FABRIC_LIBRARY_VERSION 1.0.0`) with its resolution rules (blend, construction override, elastane +4 %/%, product values win, B scaled by (gsm/typical)² within ×0.25..×4). Added to v0: `shearStiffness` (0.1 × stretch stiffness for wovens, 0.5 for knits), `friction` (0.3 woven, 0.45 knit, 0.25 satin), and the missing **`sweater-knit` and `crochet` constructions** (135 and 73 of the 434 full runs mention them; the cardigan's stretch currently comes from fibres alone).
- **Hierarchy**: global → fibre → construction → fibre × construction cell → product, in log space θ = (log B, log k_stretch, log k_shear, log damping, μ). Each level is an empirical-Bayes offset that shrinks to its parent:
  `θ_cell = (n·θ̄_obs/σ²_obs + θ_parent/σ²_prior) / (n/σ²_obs + 1/σ²_prior)`.
  A cell with no observations falls back to its parent. "Viscose skirt" reads the same `viscose × plain-weave` cell the viscose dresses calibrated. This *is* "silk dress ≈ silk skirt".
- **Scale anchor: ~10 physical swatches** (KES-F/FAST bending, Cusick drape coefficient, stretch) covering ~90 % of this catalogue: viscose plain, viscose crepe, cotton voile/poplin, cotton gauze, acrylic knit, wool knit, lace, linen, denim, lyocell. Without them the table learns "what Wan and FASHN think viscose does"; with them, generated assets correct around a measured value.
- **Solver mapping.** The table stores physical values; a pure `solverMap` adapts them to the shipping device solver (today the PBD `clothParams` in `viewer/src/cloth.ts`; in Phase 3 XPBD with compliance α = 1/k so results do not depend on iteration count). **Calibration runs through the same solver the device ships**, and the mapping is versioned. Parameters fitted with one solver do not carry over to another.

### 4.3 Shape model: rules, then exemplars, then (maybe) a regressor

Three tiers, each switched on by data, never by date:

- **P0, rules.** One function `predict(product, table, exemplars = [])` consolidates what is scattered today: `FLARE_RULES` (1.0 sheath/slip, 1.1 default, 1.25 a-line/maxi, 1.35 tiered/babydoll/empire), `LEG_RULES` (palazzo `thighOfHip 0.6`, `hemOfThigh 1.1`), `PROXY_DEFAULT_EASE`, `hemFor`, `sleeveFor`, extended `BLOCK_RULES` (tiered, wrap, slip, smock, puff/bell/flutter/batwing sleeve, cropped). Fabric enters only through the material vector and the simulation; there are **no hand-set fabric multipliers on shape** (depth × 0.9 for fluid and the like). **P0 never skips a GPU run.** It improves the stage 2 control proxy and the stage 4t template and makes every default explicit and testable.
- **P1, exemplars per cell.** Every merchant-approved full-run asset yields an exemplar: measured pattern parameters (from the stage 4t mesh via `measureGarment`, `tape.ts`, `garmentLength.ts`, ring slices, hem loop, hem fold spectrum), the derived descriptors, its material, its holdout IoU and pipeline versions. 5–10 KB of numbers, no image bytes.
  - **Cell key:** `proxy kind | patternBlock | length band | fabric class`, with exact fibre × construction as a finer key when populated.
  - **Region compatibility** decides which exemplars may contribute to which region:

    | Region | Can borrow from |
    | --- | --- |
    | Skirt (hip → hem, normalised hip ring to hem) | dress ↔ skirt (the founder's case) |
    | Bodice, yoke | dress ↔ top ↔ outerwear (outerwear offset by its larger default ease) |
    | Sleeves | dress ↔ top ↔ outerwear |
    | Legs | trousers only; wide-leg, harem and jeans are separate cut classes |
    | Any | Jumpsuits & Sets: no prediction until the category exists (`PENDING_ASSET_TYPES`) |

  - **What is blended:** the **pattern parameters** (undraped fullness, flare, length offset, sleeve volume), as a distance-weighted **median** of the k nearest compatible exemplars, with the P0 rule as a prior of weight 1 (a cell with one exemplar barely moves). Folds are never blended: they are phase-random and averaging them smears them flat. The predicted geometry always comes from simulating the blended pattern with the predicted material.
  - **Distance:** cell match plus Euclidean distance on (log B, `drape`, log gsm, `stretchPct`, chart ease, normalised length, sleeve class). Fabric fields with provenance `default` get the maximum distance: an unknown fabric is uncertainty, not information.
- **P2, a small regressor** (ridge or gradient-boosted trees, at most a few hundred parameters, exported as JSON and evaluated in pure TypeScript). It predicts the residual on top of P1, trained only on our own approved assets. Switched on only with ≥ 300 approved assets across ≥ 3 shops, ≥ 20 per proxy kind, a ≥ 15 % median-Chamfer gain over P1 on leave-one-shop-out, and no worse σ calibration. No third-party model is involved at any tier (rule 6).

### 4.4 Where the simple model breaks (explicit)

- **Identifiability.** At rest, a fuller cut in a fluid fabric can look like a narrower cut in a stiff one. The store keeps the pattern as undraped cut geometry, and two signals separate cut from fabric: the **hem fold count** (Cusick node count rises as B falls) and the **material posterior from other cuts in the same fabric**. A product's pattern fit takes the material as a prior with its σ and fits pattern + log B jointly (3–5 dimensions).
- **Bias cut.** A woven on the bias has an order-of-magnitude lower effective shear and stretch stiffness, so a bias slip and a straight-grain skirt in the same fabric do not drape alike. v1 has no grain-angle parameter: `bias` (title token or merchant flag) is a **hard feature → GPU**. A grain angle on the pattern is a P2 candidate.
- **Lining and double layers.** A lined garment roughly adds both layers' bending and mass and changes friction, which breaks fabric transfer. `lined` → treat as a two-layer composite only once swatch data exists; until then lined/true double layer → GPU.
- **Gathers.** Gathers enter as a gather ratio (fullness) at the seam; the extra local bending stiffness of a gathered seam is not modelled in v1. Measured as a separate residual in shadow mode.
- **Elastane.** Its effect on cling (negative ease, closeness to the body) is separated from stretch stiffness: friction and a cling term are calibrated separately per elastane band (0, 1–3 %, > 3 %).
- **Load path.** A dress hangs from the shoulders, a skirt from the waistband. Handled by simulating each pattern on its own anchors, not by transferring finished geometry.
- **Hard features outside the v1 pattern vocabulary (always GPU):** ruffles and frills, fringe and tassels as geometry, asymmetric/handkerchief/high-low hems, wrap overlaps, cut-outs, cowls, peplums, bias cut, true double layers, patchwork volume, jumpsuits. (Knit and crochet are a fabric-table gap, closed in Phase 1, not a geometry gap.)

### 4.5 What a predicted asset is

Stage 4t moves each template vertex along a fixed ray towards the visual hull of the training masks; where a ray has no evidence, the template holds it (`templateFit.ts`, `FitViews.train`). With only the two stage 1b stills (frames 0 and N/2), the front and back silhouettes carve width, hem line and sleeve outline from pixels; depth and the side profile come from the predicted template. **A predicted asset = real width and outline from two views + predicted depth, flare-in-depth and material.** The print bake projects the two stills; the sides are filled as stage 4b does. It produces the same bundle files as a built asset (`base.glb`, `anchors.json`, `grading.json`, `material.json`, `qa.json`), so the device needs no new code. A predicted asset **always** has the stage 1b observation; there is no "ship with no look at the product" tier.

## 5. Calibration from every GPU asset

Runs after stage 4t, in the worker, on CPU (GPU provider's CPU tier, not the VPS; D16).

1. **Measure the pattern** from the stage 4t mesh and write the exemplar (§4.3).
2. **Static drape fit.** From the undraped pattern on mannequin M, run the shipping solver to rest, rasterise silhouettes at the turntable cameras, and minimise (1 − IoU vs the stage 2 garment masks) + λ·(hem fold spectrum distance) + μ·(anchor girth residual) over (log B, fullness, flare, length offset) with Nelder–Mead/CMA-ES, ~40–80 evaluations (~1–2 CPU-min at the measured 1.2–1.4 s per drape; to be confirmed).
3. **Dynamics (damping, B in motion) only from merchant video or swatches, never from the generated stage 2 motion.** The stage 2 clip is conditioned on the posed control proxy (`modal/stage2_video.py`), so Wan follows a rigidly skinned envelope; fitting dynamics to it would learn the proxy's stiffness, not the fabric's. Generated motion may enter later at weight ≤ 0.25, only after a stage 2 variant with loosened motion control passes a check against merchant video.
4. **Record** `{productId, familyId, cell, fabric + provenance, θ fitted ± σ, pattern observed, residuals, source: generated-static | merchant-video | swatch, stage versions}`.
5. **Rebuild the table** deterministically from all records → new `DRAPE_TABLE_VERSION`. Every asset pins the version it was built with; a rebuild is an explicit job with a diff report. A family's stage 4b variants inherit the reference's record and are not counted again (one cut, one observation).

## 6. Confidence and GPU fallback

Route `predicted` requires **all** of:

1. **Category and cell enabled.** The cell (or, for borrowed regions, its region pair) has passed V1 and V2 (§7). Not on the high-risk list: Jumpsuits & Sets, structured outerwear, any hard feature (§4.4), cells with a drift history.
2. **Coverage.** ≥ 3 approved compatible exemplars per critical region within distance radius r. (Two neighbours make the spread term meaningless.) The first two assets of every cell are always GPU.
3. **Agreement.** Neighbour spread under tolerance: `hemFlare` sd ≤ 0.08, `depthRatio` sd ≤ 0.05, `hangRatio` sd ≤ 0.02, `sleeveVolume` sd ≤ 0.1 (first guesses, reset from V1 data).
4. **Inputs.** Fabric provenance is not `default` (unstated fabric → GPU until the merchant confirms); front and back photos and `baseSize` present; stage 1b QA passed (if stage 1b fails there is no predicted route); no `fabricDiffers`/`chartDiffers` within the family.
5. **Two-view residual.** After the two-view stage 4t on the predicted template: silhouette IoU ≥ 0.90 on both pinned views (run 14's GPU-built stage 4t reached 0.909 / 0.937), and median radial correction ≤ 2 cm. Large carving means the stills contradict the prediction.
6. **Calibrated confidence ≥ τ.** A logistic score over (distance, spread, data completeness, residual, material σ), calibrated isotonically on the shadow and V2 sets. Target: ≥ 90 % of `predicted` products pass the full stage 7 QA table and merchant approval.

Any failure routes to `full`. Further safeguards:

- **Merchant approval (D13) for every predicted asset.** The console shows "Shape partly predicted from N similar garments (estimate)" with a one-click "Build full 3D" ($). A rejection forces `full`, and the result becomes an exemplar.
- **5 % random audit.** One in twenty predicted products also gets a full run. Cost: 5 % × $1.63 ≈ $0.08 per predicted product. A published prediction that a later GPU run contradicts beyond the V1 thresholds is replaced (as a new asset version, never overwritten) and counted as a miss.
- **Labels.** Every render is an estimate (rule 3); `qa.json` carries `source: predicted | gpu`, `drapeTableVersion` and per-parameter provenance.
- **Family fan-out.** Stage 4b colourways re-texture on their family reference whether that reference was `full` or `predicted`.

## 7. Validation protocol

All splits are **by family, never by product** (stage 4b members share the cut and would leak); later also leave-one-shop-out. Every threshold below is a first guess to be reset from the first runs; nothing skips a GPU run before gate G1.

**V0, now, $0, CPU only: can two views + a prior work at all?** Run stage 4t on synthetic `aalter-studio-2` and on run 14 with `train = [0, N/2]` instead of the full turntable, using (a) the true-spec template, (b) the P0 rule template, (c) the `stage4t:perturbed` templates (±8 % width, hem ±8 cm, another product's proxy). Report Chamfer to the truth and holdout silhouette IoU on the unused frames (45°, 90°, 135°…). Reference: with all frames every template lands at 0.437 cm. **If two-view + a wrong template exceeds ~2 cm Chamfer, the predicted route needs a better depth prior before P1 is built.**

**Baseline to beat.** Proxy-only (P0 template, library material). If P1 does not reduce mean Chamfer against it by ≥ 30 %, drop shape transfer and keep only material and scalar prediction.

**V1, shadow mode, Phase 1, no extra GPU cost.** Before every GPU run the predictor stores its prediction and builds the predicted asset with that product's whole family held out. After stage 4t it is scored against the GPU asset:

| Metric (predicted vs own full asset) | Gate, per cell |
| --- | --- |
| Chamfer | median ≤ 1.0 cm, P90 ≤ 2.0 cm |
| Chamfer per region (shoulders, bodice, skirt, sleeves) | ≤ 1.5 cm |
| Silhouette IoU on the held-out turntable frames (frame mod 5 = 2, incl. 90°/270°) | ≥ 0.85 on ≥ 90 % of frames |
| Hem height | \|err\| ≤ 2 cm at P90 |
| HPS surface length | ± 3 cm |
| Hem girth | ± 8 % |
| Depth at hip and hem | ± 1.5 cm |
| Upper-arm girth (sleeved) | ± 2 cm |
| Critical anchor girths | = fit-engine target ± 0.1 cm (by construction; unit test) |
| Dress → skirt pairs, skirt-region Chamfer | ≤ 2.0 cm |
| σ calibration | 80 % of errors ≤ 1.28 σ |

**Material validation.** Leave-one-family-out over calibrated assets: predict θ from the table without that family, simulate, compare. Static turntable IoU gap ≤ 0.02 vs own-calibrated θ; hem fold count ± 1; predicted log B within 1 σ of the fitted value in ≥ 68 % of cases; swatch-anchored cells: predicted B within ± 30 % of the swatch; merchant-video cells: log error ≤ 0.15 decade on B and drape. Until swatches or videos exist, material validation only measures agreement with generated stills, and reports must say so.

**V2, true holdout.** 20 products from cells the router would predict get both routes (~$33). This set calibrates τ. With 20 items a 90 % pass rate has a Wilson 95 % interval of about 70–97 %, which is why the 5 % audit continues.

**V3, perceptual** (`viewer/blind.html`, after `panel-hold.txt` lifts). Predicted vs full asset of the same product, 40 pairs, 5 people: pass if identification ≤ 60 %. Same in fabric mode (predicted vs calibrated material on one mesh). The size test must not get worse on predicted assets.

**Promotion.** `predicted` is switched on **per cell**, after that cell passes V1 and V2. Thin categories may pass through a borrowed region (Skirts via dress → skirt pairs) but still need ≥ 3 own approved exemplars. Per category, a summary gate: ≥ 90 % of confident predictions pass every V1 gate.

## 8. What it is worth on Bohohippychic

Scope: 667 products; 525 in buildable types; with rule 4b, **434 full runs** (Tops 123, Dresses 119, Jackets & Knits 96, Pants 78, Skirts 12, Clothing 6) and **91 stage 4b re-texture only**. (The "595" in earlier planning is the exact-description-rule full-run count over all 667 products, including non-buildable types; with rule 4b that is 567 full runs from 565 families. Only the 434 can be built today.)

At $1.63 per full run and ~$0.07 per predicted product (stage 1b + CPU):

| Scenario | GPU runs | Cost |
| --- | --- | --- |
| Today's plan, everything on GPU | 434 | ≈ $707 |
| Conservative (≥ 2 seeds per fine cell, stated fabric, hard features → GPU) | ≈ 350–375 | ≈ $575–610 (−14 to −19 %) |
| Planning figure: P1 on coarse cells, fabric as scraped, 30 % fallback | ≈ 275 | ≈ $460 (−35 %) |
| Planning figure, merchant fills the missing fabric, 30 % fallback | ≈ 205 | ≈ $355 (−50 %) |

The range is wide because cell size depends on how fine the cut key is (title tokens are coarse: "dress / – / fluid" holds 69 units of mixed cuts). Shadow mode turns these into measured numbers. Against D17's USD 8.99/month, full-GPU onboarding of this shop equals ~79 months of subscription; with prediction and merchant data, ~40. The 3D tier needs its own price either way; prediction makes it a priceable one-off or add-on.

The money is not the only value. Every asset gets calibrated rather than estimated material; prediction is a QA prior and a fallback; viscose calibrated on dresses transfers to ~70 non-dress viscose runs; Phase 3 can dress the long tail; and running the predictor offline on a prospective shop's catalogue gives a coverage and cost estimate before onboarding (input to the 3D pricing D17 leaves open).

**GPU queue order.** The first runs seed cells, largest uncovered first, picking the member with the best photos (real flat-lay or ghost mannequin where available), plus explicit cross-category pairs (fluid maxi skirt / fluid maxi dress; viscose blouse / viscose dress). A simple greedy coverage-per-dollar rule is enough; the five Phase 0 validation products count as the first exemplars of their cells. Same total spend, far more learned.

## 9. Where it lives

- **Spike first** (builder rule): `spikes/garment-engine/src/predict/` — `features.ts`, `rules.ts` (P0, absorbing `FLARE_RULES`, `LEG_RULES`, `PROXY_DEFAULT_EASE`, `hemFor`/`sleeveFor` defaults, `BLOCK_RULES` mapping), `material.ts` (table + posterior), `exemplar.ts` (extraction), `retrieve.ts` (cells, regions, median blend, σ), `route.ts`, `calibrate.ts` (§5). `proxySpec` accepts a `Prediction` as override so the control proxy and the template share the numbers. Scripts: `predict:bohohippychic` (writes `data/bohohippychic/predictions.json`), `predict:loo`, `predict:shadow` (report into `docs/research/phase0-bohohippychic.md`), `stage4t -- --views 0,36` (V0 and the predicted route). Exemplars as committed JSON, no image bytes, like `families.json`.
- **Promote after G1 to `packages/drape-prior` (`@curtain/drape-prior`)**: pure TypeScript, zero runtime dependencies, test vectors, `check-no-runtime-imports` guard (D8, AGENTS.md rule 5); type-only imports from `@curtain/schema` and `@curtain/anchors`. Modules: `cells`, `material`, `pattern`, `posterior`, `retrieve`, `route`, `solverMap`, `table` (`DRAPE_TABLE`, `DRAPE_TABLE_VERSION`). The table and exemplar store are passed in as data.
- **`packages/cloth`**: `viewer/src/cloth.ts` + `collide.ts` promoted (already DOM-free and node-tested), so one solver serves the device and the calibrator.
- **Server**: `apps/api` pg-boss job `asset.predict` before `asset.dispatch` (milliseconds, no model, fine on the VPS per D16); calibration as worker stage 7 on the GPU provider's CPU tier. Postgres (D2): `garment_exemplars`, `drape_calibrations`; `garment_assets` gains `route`, `prediction` jsonb, `predictor_version`, `confidence`. Schema: `GarmentAsset.provenance: 'built' | 'family-variant' | 'predicted'`, a `PredictionRecord` type.
- **Device**: nothing new to run. The browser reads `material.json` through `solverMap`. The package is pure, so it could run on the device, but it does not need to.

## 10. Privacy

- Inputs are public product data, merchant-entered product fields and derived assets (D3, D16). No shopper measurement, photo, session, fit result, return or device id enters the table, calibration, exemplars or decision; there is no feedback loop from on-device fits.
- Fit and size come only from `@curtain/fit-engine`, on the device (§2).
- Cross-shop sharing, if ever enabled, covers only numeric aggregates (fabric-class material parameters, cut-class pattern statistics), never meshes, photos or textures (D13). Default per shop; sharing needs a terms clause and a founder decision, and a shop can opt out.
- No non-commercial or third-party models: rules, empirical Bayes, kNN, a derivative-free optimiser and, later, our own small regressor.

## 11. Phasing

The founder's plan: Phase 1 engine → Phase 2 plugin with size advice only → Phase 3 dress the shopper's avatar on the device → Phase 4 optional consumer app. (ENGINE-HANDOFF numbers its phases differently; mapped: P0/logging belong to handoff Phase 1, gate G1 precedes the handoff Phase 3 bulk rollout.)

**Phase 1 — engine (now), off the critical path of the five categories being prepared.**
- Week 1: **V0** on CPU. **P0** rules for the five proxy kinds (dress, skirt, trousers, top, outerwear), driving the control proxy and the stage 4t template. Add `sweater-knit` and `crochet` to the fabric library. Commission the ~10 swatch measurements.
- From the first GPU run: **exemplar and calibration-record logging** after every stage 4t (2–3 days; runs paid for now are otherwise lost as data), **shadow predictions** before every run, **GPU queue ordered by cell coverage**.
- Late Phase 1: static inverse fit, `packages/cloth`, the two-view predicted route. **Gate G1:** V0 two-view Chamfer ≤ 2 cm; ≥ 30 approved assets covering ≥ 15 cells with ≥ 3 each; V1 thresholds pass in a cell; then V2. Only then does the router skip stage 2, per passing cell, for bulk onboarding of the rest of the catalogue.
- Unblocks: calibrated `material.json` for every asset, affordable bulk onboarding, a cost number for 3D pricing.

**Phase 2 — plugin release, size advice only.** No engine dependency, and no prediction reaches shoppers. Ship the 3D-ready rows (§3.3) in the chart builder; the silhouette picker, fabric confirmation and stretch class improve size advice too. Every shop installing now arrives 3D-ready. Run the predictor offline on new shops' catalogues for coverage and cost estimates (D17 input). Engine work continues: promote to `packages/drape-prior` after G1.

**Phase 3 — dress the shopper's avatar.** The device reads material through `solverMap` into the shipped solver (moving to XPBD). Dynamic calibration from merchant video. Predicted assets go live for gated cells, covering the catalogue rather than a few pilot products. Gate G2 for the P2 regressor.

**Phase 4 — optional consumer app.** Nothing new to build. A cross-shop table (if approved) lets a new shop start mostly predicted; new categories (Jumpsuits & Sets) start in P0/P1 with a handful of GPU exemplars. Products from shops outside the network are never predicted or rendered (D13).

## 12. Effort and cost

| Item | Estimate |
| --- | --- |
| P0 + logging + shadow report + V0 | ~1–1.5 weeks |
| P1 (exemplars, router, V1/V2 tooling) | ~2 weeks |
| Static inverse fit + `packages/cloth` + two-view route | ~2–3 weeks |
| Phase 3 solver mapping + video dynamics | ~1–2 weeks |
| P2 regressor | ~2 weeks, later, only after G2 |
| Swatch lab (~10 swatches, KES-F/FAST/Cusick) | one-off external cost, to be quoted |
| Running cost | prediction: ms of CPU; predicted product ≈ $0.05–0.10; calibration per GPU asset: a few cents of CPU (< 3 % of a run); audit ≈ $0.08 per predicted product |

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| Generated assets are not ground truth (stills are FASHN's reading of on-model photos; motion follows the proxy) | Static parameters only from generated data; dynamics from merchant video; swatch anchor; weight by source |
| Cut and fabric not separable at rest | Fold count, cross-cut material prior, joint fit with σ |
| Coarse cells from title tokens | Agreement and two-view gates, silhouette picker, audit, family-held-out shadow mode |
| Depth error invisible from the front | V1 on held-out side frames; default camera stays frontal-ish until those pass |
| Exemplars inherit GPU faults (run 14's bare shoulders, drooping sleeves) | Only QA-passed, merchant-approved exemplars, weighted by holdout IoU; re-extract on pipeline version change |
| Unstated fabric (30 %) | Never predict on `default` fabric; ask the merchant first |
| Prediction leaking into sizing | Never written to the payload; three CI tests (§2) |
| Solver mismatch | Calibrate with the shipping solver; version `solverMap` |
| Table drift changes published assets | Assets pin `drapeTableVersion`; rebuilds are explicit with a diff |
| Thin data (Skirts 12 full runs, silk 0) | Dress → skirt region borrowing validated on explicit pairs; silk waits for a shop that sells it or a swatch |
| Distribution shift between shops (Bohohippychic is boho, fluid, AU) | Per-shop σ calibration; a few local exemplars per category before predicting in a new shop; leave-one-shop-out |
| Merchant trust | "Predicted" label, approval, one-click full build |

## 14. Open questions

1. **Swatch lab**: which lab, cost, and whether the founder funds it in Phase 1 (without it the material table stays relative to generated data).
2. **Cross-shop sharing** of numeric aggregates: terms clause and founder decision.
3. **3D pricing** (D17 open): one-off onboarding fee vs add-on; the predictor's per-shop estimate is the input.
4. **Platform taxonomy keys**: which Shopify Standard Product Taxonomy metafields and Woo attributes are filled in practice, and their exact names.
5. **V0 outcome**: if two views + a wrong template exceed ~2 cm, which better depth prior (a third still at 90°, at ~$0.02, or a side-depth model from exemplars)?
6. **Bias, lining and gathers**: when to add a grain angle and a two-layer composite instead of routing those to the GPU.
7. **Loosened stage 2 motion control**: worth building so generated motion can contribute to dynamics, or rely on merchant video alone?
8. **Thresholds**: every gate above is a first guess, to be reset from the first ~60 shadow runs.

## 15. P0 status (7 Nov 2026)

Built in the spike (`spikes/garment-engine/src/predict/`, README "Drape prediction P0"); not yet promoted (that waits for G1).

- **§4.3 P0 done.** `predict(product, table, exemplars = [])` is pure and returns prediction.json (§4.1): material vector with σ and provenance per field (`merchant`, `library`, `description`, `rule` for derivations with σ the larger of rule and input, `default` for global fallbacks with the widest σ; the key's provenance is the fibre's, so a title construction word alone leaves the fabric unknown), pattern parameters (hem flare, trouser legs, default ease per ring, length and sleeve rules, front-opening words), σ and confidence per region, cell key, route always `gpu`. `FLARE_RULES`, `LEG_RULES`, `PROXY_DEFAULT_EASE`, the `hemFor`/`sleeveFor` defaults and `proxyKind` live there now; title tokens extend `BLOCK_RULES` (tiered, slip, smock, maxi/midi/mini, cropped, puff/flutter/batwing/bell sleeve, hard features) without touching the payload. No fabric term on shape (tested). A product whose pattern block or subcategory matched a 0.3.0 rule keeps its 0.3.0 numbers; one that fell through to a 0.3.0 default changes when its title holds a token (e.g. without block and subcategory "Tiered Maxi Dress": flare 1.1 → 1.35, knee → ankle + 3 cm; "Puff Sleeve Dress": upper-arm ease 6 → 12 cm). Such values are listed in a prediction note and written into the proxy notes (hashed). The control proxy and the stage 4t template consume the prediction; `proxySpec` refuses one made for another payload (`payloadId`). With the rules moved and nothing else changed, the five run 15 products and both spike fixtures exported byte-identical (input_hash, job id, proxy glb, proxy pngs, synthetic truth glb, manifest); with prediction.json added, prediction.json and the manifest's `prediction` key differ, so the final manifests are not byte-identical.
- **Material table v0**: the fabric library prior to the bit (`DRAPE_TABLE_V0`, no observations), plus `sweater-knit`, `crochet`, shear, friction and thickness; the hierarchical shrinkage is implemented and tested but has no data.
- **§2 tests in CI** (`predictBoundary.test.ts`, eslint rule on `src/predict/**`). Test 2 found a real D15 gap: the proxy and the evaluation chart used the category ease where the fit engine uses the pattern block's (`BLOCKS`). Fixed (`evalChart` uses `easeTargetFor`): blouse chest 103 → 105 cm, A-line skirt waist 79.5 → 80.5, oversized cardigan chest 102 → 104; their run 15 job ids change (blouse `129498b959df` → `bf9480eb27c6`, skirt `9a2b6e7f37ce` → `99ab3ce9327b`, cardigan `56e306f6033b` → `7c2cdf2348ec`), the dress's and the trousers' do not, and so do their synthetic dry runs (blouse `c88bfa5a95a6` → `72582431161f`, skirt `a3938c82fe8c` → `aa24daf88a28`, cardigan `a0a454ab0042` → `bffec96ee041`). Among the mock products (review measurement, 195 product × size cases) linde-top-01's flat-lay hem moves 90.45 → 90.97 cm at M with the same girths, rue-marais-top-01's hip +1/+2 cm, linde-bottom-01's thigh 60.6 → 59 cm. Test 2 reads its targets from `computeFit`'s own `chartCm`, and the exporter is inside the boundary too: `manifest.hash_inputs.product` is the deep-frozen input payload for the five shop products and both fixtures.
- **§5 step 1 / §11 logging**: the exporter writes prediction.json into every job (recorded in the manifest, not hashed on its own: what of it shapes the control is hashed through the proxy; this deviates from §4.1's "part of input_hash" to keep run 15's job ids, and must be revisited when a prediction field drives anything beyond the proxy). After stage 4t, `exemplar.json` (about 4.6 KB of numbers; its material and cell are flagged as the prediction's prior, never an observation) and `shadow.json` (per parameter, and the Chamfer of the P0 shape against the stage 4t mesh; rows that cannot test the prediction are flagged and left out of the V1 values). A synthetic job's length override is recorded in prediction.json (provenance `synthetic`), so prediction.json rebuilds the job's control proxy.
- **First shadow numbers**: run 14 (the only real asset) P0 shape vs stage 4t 2.03 cm Chamfer; hem flare 1.35 predicted, 1.33 measured; flat-lay length 91 → 92.5 cm; hem height −1.8 cm; 3 of 5 errors within 1.28 σ; misses: the empire underbust (6 cm default ease against 20 cm) and the sleeves (none predicted, 35 cm fitted). The synthetic dry runs measure stage 4t or the synthetic garment's own construction, not prediction quality: the skirt, trousers and cardigan are circular (truth = template = prediction) and flagged so; the lofted dress and tops, once scored against the control they really had, show the hem within 0.4 cm and Chamfers of 0.46–1.24 cm (the earlier −8.6 to −9.4 cm hem errors were the unrecorded synthetic length override).
- **Not done**: static inverse fit (§5 step 2), calibration records, table rebuild, P1 retrieval, the two-view route, V0. Nothing skips a GPU run.
