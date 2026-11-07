# Drape prediction engine: V0 (two views + P0)

Status: measured 7 Nov 2026 on CPU (4 cores), `stage4t-template-fit-0.3.0` with the new `depthPrior: 'template'` option, from commit 91ed5b2 plus this change. Design: `docs/PREDICTION-ENGINE.md` (D18), §4.5 (what a predicted asset is) and §7 (V0, gate G1). Raw outputs stay in `spikes/garment-engine/out/prediction-v0/` (gitignored).

## V0 result: two views + P0 against the full stage 4t

**Question (§7 V0).** Can the two stills a shop gives (front and back; on the turntable frames 0 and N/2, where stage 2 pins the stage 1b stills) plus the P0 prediction reconstruct a garment almost as well as stage 4t on the 128 training frames of the 160-frame turntable? Gate G1 needs two-view Chamfer ≤ 2 cm.

**Answer.** Yes on every garment type tried, with the template's depth. Two-view Chamfer from the P0 template is 0.33–0.84 cm (full stage 4t on the same masks: 0.29–0.85 cm), and from a wrong template (±8 % width and depth, hem ±8 cm, sleeves; another product's proxy) at most 1.47 cm, against 1.38–5.64 cm for the wrong template on its own. **G1's V0 threshold (≤ 2 cm) passes for dress, top, outerwear, skirt and trousers, on every template, synthetic and run 14.** Run naively (the turntable fit unchanged on two views) it fails by a factor of 5 (9.3–12.9 cm): front and back views carry no depth.

Two caveats limit what this proves; they are below the summary table ("What this does not show").

### How the two-view fit works (`stage4t --views 0,80`)

Front and back views see width, outline, hem and cuffs; their visual hull is a slab, open towards the cameras. Fitted as the turntable fit does, every ray towards a camera runs out to its 35 cm limit (the "hull depth" rows: 10–13 cm Chamfer, sleeves found 15–51 cm long). `fitTemplate(…, { depthPrior: 'template' })` (`src/templateFit.ts`, `templateDepthTargets`), which `runStage4t({ views })` turns on for ≤ 4 views:

1. **Depth from the template, width from the masks.** Per ring (a row of the body, sleeve or leg grid), the template's cross-section is split into a lateral offset (image plane, square to the part's axis) and a depth offset (along the cameras' principal axis). The half-width the masks show on each side is the hull of the sideways rays (|lateral| ≥ 0.7, not capped); the template's lateral offsets are scaled to it per side (scale clamped to 0.5–2, rings without a measurement interpolated from the rings above and below), and each ray's target is where it meets the scaled cross-section, bounded by its hull, at full weight. Beyond the template's hem or cuff its cross-section continues (the nearest row with a template radius), so a garment longer than predicted does not hug the legs front and back.
2. **Carving threshold 0** (a point outside either silhouette is outside the garment; with 128 views it stays 5 %).
3. **Votes where the cloth would be.** The hem, cuff and leg-hem scans and the presence vote test a point at the template's radius kept just inside the slab (0.98 × hull), not at the hull (on an oblique ray the slab's corner, beyond the cloth) nor next to the body (under a flared skirt the front of the hem, seen from a camera at chest height, hangs in front of that point and kept it "present": the hem ran 3.6 cm long all round before this rule).

The turntable path (`depthPrior: 'hull'`, the default) is unchanged: every existing stage 4t test passes and the full-fit numbers below equal the README's within 0.001 cm (shirt dress 0.443 cm, skirt 0.290, palazzo 0.849, cardigan 0.521 against 0.520, blouse 0.480 against 0.481).

### Setup

- **Jobs.** Synthetic, truth known: `export:phase0 -- --product all --synthetic-photos` (`aalter-studio-2` shirt dress, `monochrome-03` tee) and `export:phase0 -- --shop bohohippychic --product <handle> --synthetic-photos` for the five Bohohippychic products (azure babydoll dress, rosewater blouse, rosewater palazzo, crimson maxi skirt, woodstock knit cardigan): 160 frames at 480 × 832, masks rendered from `synthetic/garment_truth.glb`. Real: run 14's GPU job (`azure-palm-baby-doll-dress`, stage 2 frames and masks); it has no truth, so its reference is the full stage 4t fit computed in the same run.
- **P0** is today's rule template: `buildProxy` with proxy.ts's rules (`FLARE_RULES`, `LEG_RULES`, `PROXY_DEFAULT_EASE`, `hemFor`, `sleeveFor`, pattern blocks), rebuilt with its parts so it can be perturbed. On the synthetic jobs it equals the exported `control/proxy.glb`. Run 14 was exported with proxy 0.1.0 (4,034 welded vertices); today's P0 (3,586) is used for every run 14 row.
- **Wrong templates** (§7 V0 (c)): `PERTURBATIONS` (body ×1.08 in width and depth with the hem 8 cm higher, sleeves +10 % wide and 15 % shorter; body ×0.94 with the hem 8 cm lower, sleeves +10 % wide and 10 % longer; trouser legs now scale about the leg axis and carry the hem change), and another product's proxy per kind (`linde-dress-01` knee sheath with 20 cm sleeves; `noord-top-01` long-sleeved shirt; `ostend-01` overcoat; `rue-marais-bottom-01` midi a-line skirt; `raw-denim-01` straight jeans).
- **Routes.** *P0 alone*: the template mesh itself (a closed volume: its neck, hem and cuff caps add to its Chamfer, and its "inside body" share is the proxy's, not a fit's). *Two-view*: `train = [0, 80]`, `depthPrior: 'template'`. *Two-view, hull depth*: the same two frames through the unchanged turntable fit. *Full stage 4t*: the 128 training frames, from P0.
- **Metrics** (`scripts/prediction-v0.ts`): Chamfer and F-score at 1 cm against the reference (`chamfer.ts`, 50k samples per surface; a mesh against itself reads 0.25 cm on run 14's, the floor of this metric); hem |err| = mean absolute hem-height error at the front (HPS drop) and back (centre back) for dresses and tops, at the centre front and side seam for a skirt, at the side seam and inner leg for trousers (`garmentLength.ts`); length error = HPS surface length (dresses, tops), waist to hem front (skirt), outseam along the side (trousers); cuff error = sleeve end along the arm (`measureGarment`), "—" where reference or mesh has no sleeve; inside body = share of vertices more than 3 mm inside the analytic mannequin (`clothInsideBody`); holdout silhouette IoU on the 32 frames with index mod 5 = 2 (none of them used by either fit).

### Summary per product (Chamfer, cm)

| Product | Type | Full stage 4t | P0 alone | Two-view from P0 | Two-view, worst wrong template | Wrong template alone, worst | Two-view, hull depth | G1 V0 (≤ 2 cm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `aalter-studio-2` (synthetic) | dress | 0.443 | 0.567 | 0.470 | 1.011 | 3.111 | 10.431 | pass |
| `azure-palm-baby-doll-dress` (synthetic) | dress | 0.335 | 1.424 | 0.714 | 1.403 | 2.571 | 12.854 | pass |
| `azure-palm-baby-doll-dress` (run 14, vs its full fit) | dress | (reference) | 2.504 | 0.839 | 1.379 | 3.724 | 10.984 | pass |
| `monochrome-03` (synthetic) | top | 0.554 | 0.622 | 0.559 | 0.921 | 2.231 | 12.026 | pass |
| `rosewater-blouse` (synthetic) | top | 0.480 | 0.589 | 0.522 | 0.907 | 1.523 | 11.669 | pass |
| `woodstock-wanderer-knit-cardi` (synthetic) | outerwear | 0.521 | 0.548 | 0.471 | 0.792 | 5.642 | 11.011 | pass |
| `crimson-wildflower-maxi-skirt` (synthetic) | skirt | 0.290 | 0.655 | 0.333 | 0.869 | 2.057 | 12.144 | pass |
| `rosewater-palazzo-pants` (synthetic) | trousers | 0.849 | 0.590 | 0.478 | 1.472 | 2.753 | 9.250 | pass |

Per garment type, the worst two-view Chamfer over every product and template: dress 1.40 cm, top 0.92 cm, outerwear 0.79 cm, skirt 0.87 cm, trousers 1.47 cm. All pass G1's V0 threshold. The fit stays out of the mannequin in every two-view row (0.0 % inside), and the time per two-view fit is 4–9 s against 37–51 s for the full fit (the full fit's 128 views dominate; the bake is not included in either).

Run 14 cross-check: fitted from the job's own exported proxy (0.1.0) instead of today's P0, the two-view fit lies 0.805 cm from the stored stage 4t `garment.glb` (F-score 0.759 at 1 cm, 0.914 at 2 cm); the full fit from that proxy reproduces the stored mesh (0.252 cm, the metric's floor).

### What this does not show

- **Depth on synthetic data is the template's own.** The synthetic truths of the skirt, trousers and cardigan *are* their P0 proxies, opened (`syntheticGarmentFromProxy`), and the dresses' and tops' truths are lofted from the same spec as P0. Two-view from P0 therefore inherits the right depth by construction; on the palazzo it even beats the full fit (0.478 vs 0.849 cm) because the turntable carves its legs from 128 imperfect views while the template already is the truth. Only the wrong-template rows measure what two views recover, and there depth error is exactly the template's: the +8 % template keeps its 8 % extra depth (in the half-resolution unit test the shirt dress's skirt ends 1.3–1.9 cm too deep at the front and at the back), which is most of the remaining 0.7–1.5 cm. The real question for the predicted route is how far a P1 prediction's depth is from the garment's, which only shadow mode (V1) on GPU assets can answer.
- **Run 14's reference is itself a reconstruction** from generated frames (holdout silhouette IoU 0.884), and the two pinned stills are FASHN's reading of shop photos, which stage 2 follows. Run 14 does show the two-view fit working on real generated pixels with a P0 that is visibly wrong (P0 alone 2.50 cm, hem 2.3 cm off): 0.84 cm, holdout silhouette IoU 0.874 against the full fit's 0.884.
- **Hem and length.** Two-view hem errors are 0.1–1.4 cm on the synthetic dresses, tops, skirt and cardigan and 0.7–1.8 cm on run 14 (whose reference hem is itself fitted); the palazzo's leg hems are 2.2–2.9 cm off (full fit 1.18 cm), the largest two-view hem error: the inner leg hem is hidden between the legs in both views. Lengths stay within ±1.1 cm except the cardigan (−1.8 to −2.2 cm on three of its four templates, and −2.18 cm for the full fit too: the open front's HPS profile, not the fit) and the jeans template on the palazzo (+1.8 cm).
- **Thresholds.** The G1 V0 threshold (2 cm) is the design's first guess. V1's per-cell gates (median Chamfer ≤ 1.0 cm, hem P90 ≤ 2 cm, depth ± 1.5 cm) are tighter: the wrong-template rows would miss a 1.0 cm median on the dresses and trousers. Open question 5 of the design (a third still at 90°, or a side-depth prior from exemplars) is therefore not settled by V0: two views are enough for G1, and whether P1's depth is good enough is V1's to measure.

### Reproduce

```sh
pnpm build:packages
pnpm --filter @curtain/garment-spike export:phase0 -- --product all --synthetic-photos
pnpm --filter @curtain/garment-spike export:phase0 -- --shop bohohippychic --product <handle> --synthetic-photos   # each of the five
pnpm --filter @curtain/garment-spike prediction:v0 -- out/phase0/aalter-studio-2 out/phase0-synthetic/<handle> … out/phase0/azure-palm-baby-doll-dress
pnpm --filter @curtain/garment-spike stage4t -- out/phase0/<handle> --source synthetic --views 0,80   # one two-view asset, textured, into stage4t/synthetic-views-0-80/
```

Run 14's job dir is the GPU artifact of run 14 (`out/phase0/azure-palm-baby-doll-dress/`, stage 2 frames and masks). Each product takes 3–5 minutes (one full fit, nine two-view and hull-depth fits, eleven scorings).

### Per product

#### `aalter-studio-2` (dress, synthetic stills)

Reference: synthetic/garment_truth.glb. P0: same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.443 | 0.956 | 0.36 | -0.53 | -0.28 | 0.0 % | 0.977 |
| P0 alone | P0 | 0.567 | 0.950 | 0.00 | +0.04 | +0.00 | 2.6 % | 0.994 |
| two-view | P0 | 0.470 | 0.946 | 0.36 | -0.38 | -0.28 | 0.0 % | 0.965 |
| two-view, hull depth | P0 | 10.431 | 0.057 | 3.64 | +0.14 | +15.72 | 0.0 % | 0.484 |
| P0 alone | P0 wider +8 %, hem 8 cm up | 1.555 | 0.346 | 8.00 | -6.83 | -8.59 | 2.9 % | 0.853 |
| two-view | P0 wider +8 %, hem 8 cm up | 0.863 | 0.646 | 0.41 | +0.33 | -0.28 | 0.0 % | 0.946 |
| P0 alone | P0 narrower −6 %, hem 8 cm down | 1.548 | 0.402 | 8.00 | +7.29 | +5.73 | 8.8 % | 0.858 |
| two-view | P0 narrower −6 %, hem 8 cm down | 0.740 | 0.846 | 0.14 | -0.06 | -0.28 | 0.0 % | 0.946 |
| P0 alone | other product linde-dress-01 | 3.111 | 0.492 | 20.96 | -20.89 | -37.28 | 3.8 % | 0.663 |
| two-view | other product linde-dress-01 | 1.011 | 0.651 | 0.64 | +0.54 | -0.28 | 0.0 % | 0.927 |

#### `azure-palm-baby-doll-dress` (dress, synthetic stills)

Reference: synthetic/garment_truth.glb. P0: same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.335 | 0.981 | 0.36 | -0.49 | — | 0.0 % | 0.932 |
| P0 alone | P0 | 1.424 | 0.576 | 0.00 | +0.36 | — | 2.6 % | 0.876 |
| two-view | P0 | 0.714 | 0.779 | 0.86 | -0.68 | — | 0.0 % | 0.916 |
| two-view, hull depth | P0 | 12.854 | 0.059 | 2.64 | -1.09 | — | 0.0 % | 0.348 |
| P0 alone | P0 wider +8 %, hem 8 cm up | 2.571 | 0.218 | 8.00 | -6.36 | — | 2.8 % | 0.752 |
| two-view | P0 wider +8 %, hem 8 cm up | 1.403 | 0.559 | 1.36 | -0.22 | — | 0.0 % | 0.886 |
| P0 alone | P0 narrower −6 %, hem 8 cm down | 1.722 | 0.475 | 8.00 | +7.51 | — | 6.4 % | 0.797 |
| two-view | P0 narrower −6 %, hem 8 cm down | 0.575 | 0.934 | 0.51 | -0.51 | — | 0.0 % | 0.921 |
| P0 alone | other product linde-dress-01 | 1.931 | 0.351 | 0.04 | -0.17 | — | 3.8 % | 0.807 |
| two-view | other product linde-dress-01 | 0.902 | 0.675 | 0.14 | -0.16 | — | 0.0 % | 0.904 |

#### `azure-palm-baby-doll-dress` (dress, run 14 GPU frames)

Reference: full stage 4t fit (128 frames, from P0), computed here. P0: control/proxy.glb has 4034 welded vertices, today's P0 3586 (an older proxy version exported the job).

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.252 | 1.000 | 0.00 | +0.00 | +0.00 | 0.0 % | 0.884 |
| P0 alone | P0 | 2.504 | 0.504 | 2.30 | -1.57 | — | 2.9 % | 0.778 |
| two-view | P0 | 0.839 | 0.748 | 1.64 | -0.19 | -0.43 | 0.0 % | 0.874 |
| two-view, hull depth | P0 | 10.984 | 0.067 | 1.01 | -2.75 | +37.57 | 0.0 % | 0.411 |
| P0 alone | P0 wider +8 %, hem 8 cm up | 2.750 | 0.369 | 10.30 | -8.23 | — | 3.1 % | 0.688 |
| two-view | P0 wider +8 %, hem 8 cm up | 1.309 | 0.483 | 1.80 | +0.94 | -0.43 | 0.0 % | 0.857 |
| P0 alone | P0 narrower −6 %, hem 8 cm down | 3.724 | 0.090 | 5.70 | +5.57 | — | 7.4 % | 0.684 |
| two-view | P0 narrower −6 %, hem 8 cm down | 1.022 | 0.616 | 1.32 | +0.22 | -1.03 | 0.0 % | 0.871 |
| P0 alone | other product linde-dress-01 | 3.436 | 0.196 | 7.41 | +7.50 | -15.43 | 3.8 % | 0.704 |
| two-view | other product linde-dress-01 | 1.379 | 0.549 | 0.73 | -0.10 | -0.43 | 0.0 % | 0.861 |

#### `monochrome-03` (top, synthetic stills)

Reference: synthetic/garment_truth.glb. P0: same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.554 | 0.875 | 0.36 | -0.49 | +0.00 | 0.0 % | 0.938 |
| P0 alone | P0 | 0.622 | 0.893 | 0.00 | +0.14 | +0.00 | 5.2 % | 0.950 |
| two-view | P0 | 0.559 | 0.878 | 0.36 | -0.18 | +0.00 | 0.0 % | 0.927 |
| two-view, hull depth | P0 | 12.026 | 0.051 | 1.65 | -2.48 | +51.00 | 0.0 % | 0.303 |
| P0 alone | P0 wider +8 %, hem 8 cm up | 1.460 | 0.445 | 8.00 | -6.67 | -3.30 | 5.8 % | 0.791 |
| two-view | P0 wider +8 %, hem 8 cm up | 0.921 | 0.603 | 0.36 | +0.67 | +0.00 | 0.0 % | 0.915 |
| P0 alone | P0 narrower −6 %, hem 8 cm down | 1.558 | 0.517 | 8.00 | +7.31 | +2.20 | 16.3 % | 0.797 |
| two-view | P0 narrower −6 %, hem 8 cm down | 0.652 | 0.858 | 0.36 | -0.62 | +0.00 | 0.0 % | 0.917 |
| P0 alone | other product noord-top-01 | 2.231 | 0.661 | 2.99 | -3.52 | +35.28 | 3.7 % | 0.755 |
| two-view | other product noord-top-01 | 0.571 | 0.871 | 0.36 | -0.77 | +0.00 | 0.0 % | 0.924 |

#### `rosewater-blouse` (top, synthetic stills)

Reference: synthetic/garment_truth.glb. P0: same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.480 | 0.914 | 0.36 | -0.52 | -0.20 | 0.0 % | 0.951 |
| P0 alone | P0 | 0.589 | 0.929 | 0.00 | +0.07 | +0.00 | 4.4 % | 0.965 |
| two-view | P0 | 0.522 | 0.892 | 0.36 | -0.21 | -0.20 | 0.0 % | 0.928 |
| two-view, hull depth | P0 | 11.669 | 0.049 | 3.27 | -0.24 | +38.80 | 0.0 % | 0.320 |
| P0 alone | P0 wider +8 %, hem 8 cm up | 1.469 | 0.485 | 8.00 | -6.76 | -5.13 | 4.8 % | 0.797 |
| two-view | P0 wider +8 %, hem 8 cm up | 0.907 | 0.630 | 0.36 | +0.64 | -0.20 | 0.0 % | 0.912 |
| P0 alone | P0 narrower −6 %, hem 8 cm down | 1.523 | 0.553 | 8.00 | +7.24 | +3.42 | 7.6 % | 0.804 |
| two-view | P0 narrower −6 %, hem 8 cm down | 0.678 | 0.919 | 0.36 | -0.47 | -0.20 | 0.0 % | 0.918 |
| P0 alone | other product noord-top-01 | 1.434 | 0.690 | 0.99 | -0.99 | +23.08 | 3.7 % | 0.844 |
| two-view | other product noord-top-01 | 0.621 | 0.903 | 0.36 | -0.34 | -0.20 | 0.0 % | 0.919 |

#### `woodstock-wanderer-knit-cardi` (outerwear, synthetic stills)

Reference: synthetic/garment_truth.glb. P0: same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.521 | 0.901 | 0.10 | -2.18 | -0.28 | 0.0 % | 0.954 |
| P0 alone | P0 | 0.548 | 0.925 | 0.00 | +0.00 | +0.00 | 5.8 % | 0.972 |
| two-view | P0 | 0.471 | 0.899 | 0.43 | -2.15 | -0.28 | 0.0 % | 0.945 |
| two-view, hull depth | P0 | 11.011 | 0.043 | 13.05 | +10.36 | +15.72 | 0.0 % | 0.307 |
| P0 alone | P0 wider +8 %, hem 8 cm up | 1.392 | 0.512 | 8.00 | -7.03 | -8.59 | 4.5 % | 0.779 |
| two-view | P0 wider +8 %, hem 8 cm up | 0.792 | 0.690 | 0.60 | -1.93 | -0.28 | 0.0 % | 0.926 |
| P0 alone | P0 narrower −6 %, hem 8 cm down | 1.517 | 0.678 | 8.00 | +7.54 | +5.73 | 15.0 % | 0.791 |
| two-view | P0 narrower −6 %, hem 8 cm down | 0.591 | 0.938 | 0.10 | +1.04 | -0.28 | 0.0 % | 0.928 |
| P0 alone | other product ostend-01 | 5.642 | 0.726 | 46.89 | +47.36 | +0.00 | 2.9 % | 0.565 |
| two-view | other product ostend-01 | 0.477 | 0.895 | 0.35 | -1.78 | -0.28 | 0.0 % | 0.945 |

#### `crimson-wildflower-maxi-skirt` (skirt, synthetic stills)

Reference: synthetic/garment_truth.glb. P0: same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.290 | 1.000 | 0.43 | -0.66 | — | 0.0 % | 0.976 |
| P0 alone | P0 | 0.655 | 0.930 | 0.00 | +0.00 | — | 0.0 % | 0.989 |
| two-view | P0 | 0.333 | 1.000 | 0.18 | -0.67 | — | 0.0 % | 0.972 |
| two-view, hull depth | P0 | 12.144 | 0.084 | 5.32 | +10.01 | — | 0.0 % | 0.498 |
| P0 alone | P0 wider +8 %, hem 8 cm up | 2.057 | 0.048 | 8.00 | -7.90 | — | 0.0 % | 0.831 |
| two-view | P0 wider +8 %, hem 8 cm up | 0.869 | 0.571 | 0.43 | -1.07 | — | 0.0 % | 0.949 |
| P0 alone | P0 narrower −6 %, hem 8 cm down | 1.966 | 0.100 | 8.00 | +7.95 | — | 0.3 % | 0.850 |
| two-view | P0 narrower −6 %, hem 8 cm down | 0.800 | 0.789 | 0.57 | -0.24 | — | 0.0 % | 0.949 |
| P0 alone | other product rue-marais-bottom-01 | 1.872 | 0.623 | 14.88 | -14.80 | — | 0.0 % | 0.771 |
| two-view | other product rue-marais-bottom-01 | 0.634 | 0.962 | 0.57 | -0.21 | — | 0.0 % | 0.956 |

#### `rosewater-palazzo-pants` (trousers, synthetic stills)

Reference: synthetic/garment_truth.glb. P0: same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.849 | 0.703 | 1.18 | -0.66 | — | 0.0 % | 0.961 |
| P0 alone | P0 | 0.590 | 0.918 | 0.00 | +0.00 | — | 1.4 % | 0.984 |
| two-view | P0 | 0.478 | 0.978 | 2.19 | -0.73 | — | 0.0 % | 0.954 |
| two-view, hull depth | P0 | 9.250 | 0.037 | 2.65 | +2.77 | — | 0.0 % | 0.518 |
| P0 alone | P0 wider +8 %, hem 8 cm up | 1.450 | 0.394 | 8.00 | -7.57 | — | 0.4 % | 0.848 |
| two-view | P0 wider +8 %, hem 8 cm up | 0.750 | 0.824 | 2.59 | -0.68 | — | 0.0 % | 0.942 |
| P0 alone | P0 narrower −6 %, hem 8 cm down | 1.377 | 0.669 | 8.00 | +7.83 | — | 2.5 % | 0.865 |
| two-view | P0 narrower −6 %, hem 8 cm down | 0.672 | 0.912 | 2.40 | -0.23 | — | 0.0 % | 0.936 |
| P0 alone | other product raw-denim-01 | 2.753 | 0.253 | 4.00 | +3.29 | — | 2.0 % | 0.771 |
| two-view | other product raw-denim-01 | 1.472 | 0.386 | 2.91 | +1.80 | — | 0.0 % | 0.877 |

