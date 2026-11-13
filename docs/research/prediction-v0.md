# Drape prediction engine: V0 (two views + a template)

Status: measured 7 Nov 2026 on CPU (4 cores), `stage4t-template-fit-0.3.0` with the new `depthPrior: 'template'` option, from commit 91ed5b2 plus this change, after review (findings F1–F5: depth-only templates, true-spec vs rule P0, run 14's depth, the lateral-scale bias). Design: `docs/PREDICTION-ENGINE.md` (D18), §4.5 (what a predicted asset is) and §7 (V0, gate G1). Raw outputs stay in `spikes/garment-engine/out/prediction-v0/r2/` (gitignored; the pre-review run is beside it in `out/prediction-v0/`).

## V0 result: two views + a template against the full stage 4t

**Question (§7 V0).** Can the two stills a shop gives (front and back; on the turntable frames 0 and N/2, where stage 2 pins the stage 1b stills) plus a predicted template reconstruct a garment almost as well as stage 4t on the 128 training frames of the 160-frame turntable? Gate G1 needs two-view Chamfer ≤ 2 cm.

**Answer.** G1's V0 threshold (≤ 2 cm) passes on every row: every garment type (dress, top, outerwear, skirt, trousers), every template tried, synthetic and run 14. The worst two-view Chamfer is 1.85 cm (synthetic babydoll from a template 15 % too deep). But **two views measure width, not depth**: what is left after a two-view fit is, almost entirely, the template's depth error. V0 shows that front and back stills plus a template with the right depth are enough; it does not show that two views can repair a wrong depth, and the depth-only rows show they cannot.

- From the true-spec template (V0 (a), synthetic) two-view Chamfer is 0.27–0.78 cm, against 0.29–0.85 cm for the full stage 4t on the same masks. On run 14 from the rule P0 it is 0.85 cm from that job's full fit.
- From a template wrong in width, depth and hem together (`PERTURBATIONS`: ±8 % in both, hem ±8 cm, sleeves) or from another product's proxy: at most 1.54 cm, against 1.38–5.64 cm for those templates on their own. The masks correct width, hem and cuffs; the remaining error is mostly the depth the template brought.
- **From a template wrong only in depth** (`DEPTH_PERTURBATIONS`: body and legs ×1.15 or ×0.85 in depth, width, hem and sleeves exact): 0.62–1.85 cm, about what the template alone scores (0.99–2.36 cm synthetic) and sometimes worse (shirt dress +15 %: 1.27 two-view against 1.23 alone). The full turntable fit from the same depth-only templates lands where it does from the true template (shirt dress 0.442/0.443 against 0.443, babydoll 0.334/0.334 against 0.335, palazzo 0.849/0.849 against 0.849): 128 views see depth, two do not. A 15 % depth error on a dress uses 64–93 % of the 2 cm G1 budget.

Run naively (the turntable fit unchanged on two views) the fit fails by a factor of 5 (9.3–12.9 cm): front and back views carry no depth.

What this does not show is below the summary table; read it before using these numbers for V1.

### How the two-view fit works (`stage4t --views 0,80`)

Front and back views see width, outline, hem and cuffs; their visual hull is a slab, open towards the cameras. Fitted as the turntable fit does, every ray towards a camera runs out to its 35 cm limit (the "hull depth" rows: 9–13 cm Chamfer, sleeves found 15–51 cm long). `fitTemplate(…, { depthPrior: 'template' })` (`src/templateFit.ts`, `templateDepthTargets`), which `runStage4t({ views })` turns on for ≤ 4 views:

1. **Depth from the template, width from the masks.** Per ring (a row of the body, sleeve or leg grid), the template's cross-section is split into a lateral offset (image plane, square to the part's axis) and a depth offset (along the cameras' principal axis). Per side, the lateral scale is the median of hull / template radius over the three rays closest to lateral (|lateral| ≥ 0.7, not capped), where a sideways ray leaves the silhouettes. The template's lateral offsets are scaled by it (clamped to 0.5–2, rings without a measurement interpolated from the rings above and below), and each ray's target is where it meets the scaled cross-section, bounded by its hull, at full weight. Beyond the template's hem or cuff its cross-section continues (the nearest row with a template radius), so a garment longer than predicted does not hug the legs front and back.
2. **Carving threshold 0** (a point outside either silhouette is outside the garment; with 128 views it stays 5 %).
3. **Votes where the cloth would be.** The hem, cuff and leg-hem scans and the presence vote test a point at the template's radius kept just inside the slab (0.98 × hull), not at the hull (on an oblique ray the slab's corner, beyond the cloth) nor next to the body (under a flared skirt the front of the hem, seen from a camera at chest height, hangs in front of that point and kept it "present": the hem ran 3.6 cm long all round before this rule).

**Lateral scale, fixed after review (F4).** The first version divided the median half-width of every sideways ray (hull × |lateral|) by the template ring's widest point. Under perspective the intersection of the front and back silhouettes narrows away from the plane of their contour, so oblique rays leave it early, and with the truth as template that ratio read 0.96–0.97 on the body and 0.93–0.95 on the sleeves: two-view girths came out about 3 % small. Per ray, among the rays closest to lateral, it now reads 0.99–1.01 on the body of every synthetic true-spec template (sleeves and legs 1.00–1.03); the unit test fits a skirt from its own proxy and requires 1.00 ± 1.5 % (the old estimator missed it by 3 %). This moved the numbers: two-view from the true-spec template went from 0.33–0.71 to 0.27–0.78 cm (skirt 0.333 → 0.267, palazzo 0.478 → 0.383, babydoll 0.714 → 0.775, cardigan 0.471 → 0.526), and the +8 % template rows got worse (shirt dress 0.863 → 0.952, babydoll 1.403 → 1.538): the old narrow bias partly hid the +8 % template's extra depth by squeezing its width.

The turntable path (`depthPrior: 'hull'`, the default) is unchanged: every existing stage 4t test passes and the full-fit numbers below equal the README's within 0.001 cm (shirt dress 0.443 cm, skirt 0.290, palazzo 0.849, cardigan 0.521 against 0.520, blouse 0.480 against 0.481).

### Setup

- **Jobs.** Synthetic, truth known: `export:phase0 -- --product all --synthetic-photos` (`aalter-studio-2` shirt dress, `monochrome-03` tee) and `export:phase0 -- --shop bohohippychic --product <handle> --synthetic-photos` for the five Bohohippychic products (azure babydoll dress, rosewater blouse, rosewater palazzo, crimson maxi skirt, woodstock knit cardigan): 160 frames at 480 × 832, masks rendered from `synthetic/garment_truth.glb` with exact cameras and the exact mannequin. Real: run 14's GPU job (`azure-palm-baby-doll-dress`, stage 2 frames and masks); it has no truth, so its reference is the full stage 4t fit computed in the same run.
- **Templates** (`scripts/prediction-v0.ts`):
  - *True-spec template (V0 (a))*, the base template on the synthetic jobs: for the lofted dresses and tops, `buildProxy` given the truth's own length as a vertical drop (as the exporter builds their control); for the skirt, trousers and cardigan, the very proxy the truth is cut from (`syntheticGarmentFromProxy`). Its hem is the truth's (template-alone hem error 0.00). It equals the exported `control/proxy.glb`.
  - *Rule P0 (V0 (b))*: `buildProxy` with proxy.ts's rules only (`FLARE_RULES`, `LEG_RULES`, `PROXY_DEFAULT_EASE`, `hemFor`, `sleeveFor`, pattern blocks; a printed shoulder-to-hem as a flat-lay length along the front), no truth. A separate row on the synthetic dresses and tops. On the skirt, trousers and cardigan it is the true-spec template (their truth is built from it), so it gets no row of its own. Run 14's base template is the rule P0 (today's, 3,586 welded vertices; the job was exported with proxy 0.1.0, 4,034).
  - *Wrong templates (V0 (c))*: `PERTURBATIONS` of the base (body ×1.08 in width and depth with the hem 8 cm higher, sleeves +10 % wide and 15 % shorter; body ×0.94 with the hem 8 cm lower, sleeves +10 % wide and 10 % longer; trouser legs scale about the leg axis and carry the hem change), `DEPTH_PERTURBATIONS` of the base (body and legs ×1.15 or ×0.85 in depth about the mannequin's centre at each height, nothing else changed), and another product's proxy per kind (`linde-dress-01` knee sheath with 20 cm sleeves; `noord-top-01` long-sleeved shirt; `ostend-01` overcoat; `rue-marais-bottom-01` midi a-line skirt; `raw-denim-01` straight jeans). All are `buildProxy` outputs on the same mannequin: they differ from the base in parameters, not in how a cross-section is built.
- **Routes.** *Template alone*: the template mesh itself (a closed volume: its neck, hem and cuff caps add to its Chamfer, and its "inside body" share is the proxy's, not a fit's). *Two-view*: `train = [0, 80]`, `depthPrior: 'template'`. *Two-view, hull depth*: the same two frames through the unchanged turntable fit, from the base. *Full stage 4t*: the 128 training frames, from the base.
- **Fairness.** Every route of a job reads the same `mannequin.glb`/SDF, cameras and masks and is scored against the same reference; the two-view fit reads only frames 0 and 80; the truth is used only to score.
- **Metrics**: Chamfer and F-score at 1 cm against the reference (`chamfer.ts`, 50k samples per surface; a mesh against itself reads 0.25 cm on run 14's, the floor of this metric); hem |err| = mean absolute hem-height error at the front (HPS drop) and back (centre back) for dresses and tops, at the centre front and side seam for a skirt, at the side seam and inner leg for trousers (`garmentLength.ts`); length error = HPS surface length (dresses, tops), waist to hem front (skirt), outseam along the side (trousers); cuff error = sleeve end along the arm (`measureGarment`), "—" where reference or mesh has no sleeve; inside body = share of vertices more than 3 mm inside the analytic mannequin (`clothInsideBody`); holdout silhouette IoU on the 32 frames with index mod 5 = 2 (none of them used by either fit). These are the turntable's own holdout frames, every 5th frame from frame 2 (11.25°, 33.75°, …, including near-side views), not exactly the 45°/90°/135° views §7 names.

### Summary per product (Chamfer, cm)

| Product | Type | Full stage 4t | Base template alone | Two-view from base | Rule P0 alone / two-view | Two-view, worst wrong template (width+depth, hem, other product) | That kind of template alone, worst | Two-view from depth ×1.15 / ×0.85 only | Depth-only template alone ×1.15 / ×0.85 | Two-view, hull depth | G1 V0 (≤ 2 cm) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `aalter-studio-2` (synthetic) | dress | 0.443 | 0.567 | 0.463 | 0.773 / 0.509 | 0.960 | 3.111 | 1.270 / 0.952 | 1.232 / 1.334 | 10.431 | pass |
| `azure-palm-baby-doll-dress` (synthetic) | dress | 0.335 | 1.424 | 0.775 | 1.615 / 0.928 | 1.538 | 2.571 | 1.850 / 0.621 | 2.359 / 1.495 | 12.854 | pass |
| `azure-palm-baby-doll-dress` (run 14, vs its full fit) | dress | (reference) | 2.504 | 0.848 | = base | 1.354 | 3.724 | 1.568 / 1.150 | 2.745 / 3.364 | 10.984 | pass |
| `monochrome-03` (synthetic) | top | 0.554 | 0.622 | 0.586 | 0.944 / 0.595 | 1.003 | 2.231 | 1.325 / 0.813 | 1.166 / 1.295 | 12.026 | pass |
| `rosewater-blouse` (synthetic) | top | 0.480 | 0.589 | 0.541 | 0.885 / 0.547 | 0.996 | 1.523 | 1.272 / 0.799 | 1.129 / 1.195 | 11.669 | pass |
| `woodstock-wanderer-knit-cardi` (synthetic) | outerwear | 0.521 | 0.548 | 0.526 | = base | 0.900 | 5.642 | 1.084 / 0.665 | 0.987 / 1.038 | 11.011 | pass |
| `crimson-wildflower-maxi-skirt` (synthetic) | skirt | 0.290 | 0.655 | 0.267 | = base | 0.978 | 2.057 | 1.424 / 1.246 | 1.652 / 1.772 | 12.144 | pass |
| `rosewater-palazzo-pants` (synthetic) | trousers | 0.849 | 0.590 | 0.383 | = base | 1.327 | 2.753 | 1.145 / 0.901 | 1.196 / 1.308 | 9.250 | pass |

Per garment type, the worst two-view Chamfer over every product and template: dress 1.85 cm (1.54 without the depth-only templates), top 1.33 (1.00), outerwear 1.08 (0.90), skirt 1.42 (0.98), trousers 1.33 (1.33). All pass G1's V0 threshold; every type's worst row but the trousers' is a depth-only template. The fit stays out of the mannequin in every two-view row (0.0 % inside), and the time per two-view fit is 3–8 s against 28–55 s for the full fit (four jobs ran side by side on 4 cores; the bake is not included in either).

The rule P0 on the synthetic dresses and tops is 8.9–9.7 cm off the truth's length on its own (it reads the printed length as a flat-lay length along the front, the synthetic truth drops it vertically); the masks fix the hem, and its two-view rows land within 0.01–0.15 cm of the true-spec template's (0.51–0.93 cm).

Run 14 cross-check: fitted from the job's own exported proxy (0.1.0) instead of today's P0, the two-view fit lies 0.807 cm from the stored stage 4t `garment.glb` (F-score 0.765 at 1 cm) and 0.810 cm from the full fit from today's P0; two-view from today's P0 is 0.847 cm from the stored mesh, and the full fit from today's P0 0.270 cm from it (a mesh against itself: 0.252 cm, the metric's floor). Using the same template family for the fit and for the reference adds no measurable bias here.

### What this does not show

- **Two views do not recover depth.** Every two-view fit keeps the template's depth; the masks set width, outline, hem and cuffs. The depth-only rows measure this directly: a template 15 % too deep stays 1.08–1.85 cm off after the two-view fit (template alone 0.99–2.75 cm), 15 % too shallow 0.62–1.25 cm, while the full turntable fit from the same templates is unchanged from the true template's (0.442/0.443, 0.334/0.334, 0.849/0.849 cm on the shirt dress, synthetic babydoll and palazzo). The ±8 % `PERTURBATIONS` change width and depth together, and the masks correct only the width: those rows measure width recovery plus the leftover depth error, not depth recovery. So V0's two-view Chamfer is, to first order, the template's depth error. A real P1 prediction with a 15 % depth error on a dress would use 64–93 % of G1's 2 cm budget before any other error.
- **The synthetic base template is V0 (a), the true spec.** Its hem and girths are the truth's (template-alone hem error 0.00 everywhere), and the skirt, trousers and cardigan truths *are* that template, opened. Two-view from it inherits the right depth by construction; on the palazzo it beats the full fit (0.383 vs 0.849 cm) because the turntable carves its legs from 128 imperfect views while the template already is the truth. The rule P0 rows (dresses, tops) differ from it in length only, which the masks correct. All templates, including "another product", come from `buildProxy` on the same mannequin, so none tests a cross-section shape the proxy family cannot build.
- **Run 14 does not measure depth either.** Stage 2 is conditioned on the posed control proxy (§5.3; proxy 0.1.0 for run 14), so the generated side views, and with them the full-fit reference, carry the proxy family's depth. Run 14 shows the two-view fit working on generated pixels for width, outline and hem, with a P0 that is visibly wrong (P0 alone 2.50 cm, hem 2.3 cm off; two-view 0.85 cm, holdout silhouette IoU 0.873 against the full fit's 0.884). Its reference is itself a reconstruction (holdout silhouette IoU 0.884).
- **No row uses real shop stills.** All synthetic masks are ideal rasters of the truth with exact cameras and the exact mannequin; run 14's stills are FASHN's reading of shop photos, pinned by stage 2 with its own cameras. Stage 1b output with segmentation noise, pose or camera mismatch is not tested; V1 shadow mode on GPU assets is needed for that.
- **Hem and length.** Two-view hem errors are 0.1–1.4 cm on the synthetic dresses, tops, skirt and cardigan and 0.7–2.0 cm on run 14 (whose reference hem is itself fitted); the palazzo's leg hems are 2.1–2.9 cm off (full fit 1.18 cm), the largest two-view hem error: the inner leg hem is hidden between the legs in both views. Lengths stay within ±1.1 cm except where the template's depth is wrong (depth ×1.15: +1.4 to +1.8 cm on the shirt dress and the tops, −1.5 cm on the skirt; the HPS surface length follows the depth), the cardigan (−1.4 to −2.2 cm on four of its six templates and +1.14 cm on the narrower one; the full fit reads −2.18 cm too: the open front's HPS profile, not the fit), run 14 (up to +1.7 cm) and the jeans template on the palazzo (+2.0 cm).
- **Thresholds.** The G1 V0 threshold (2 cm) is the design's first guess. V1's per-cell gates (median Chamfer ≤ 1.0 cm, hem P90 ≤ 2 cm, depth ± 1.5 cm) are tighter: single wrong-template rows exceed 1.0 cm on the dresses, the tee and the trousers, and every depth ×1.15 row exceeds it (1.08–1.85 cm). Open question 5 of the design (a third still at 90°, or a side-depth prior from exemplars) is therefore open, and V0 gives the reason: whatever depth the prediction carries, two views pass on to the asset. Whether P1's depth is good enough is V1's to measure.

### Reproduce

```sh
pnpm build:packages
pnpm --filter @curtain/garment-spike export:phase0 -- --product all --synthetic-photos
pnpm --filter @curtain/garment-spike export:phase0 -- --shop bohohippychic --product <handle> --synthetic-photos   # each of the five
pnpm --filter @curtain/garment-spike prediction:v0 -- out/phase0/aalter-studio-2 out/phase0-synthetic/<handle> … out/phase0/azure-palm-baby-doll-dress --out out/prediction-v0/r2/results.json
pnpm --filter @curtain/garment-spike stage4t -- out/phase0/<handle> --source synthetic --views 0,80   # one two-view asset, textured, into stage4t/synthetic-views-0-80/
```

Run 14's job dir is the GPU artifact of run 14 (`out/phase0/azure-palm-baby-doll-dress/`, stage 2 frames and masks). Each product takes 4–7 minutes (one full fit, seven or eight two-view and hull-depth fits, scorings). The run 14 cross-check and the full fits from the depth-only templates were measured with a short script calling the same `fitTemplate`/`chamfer` (logs `out/prediction-v0/r2/xc-*.log`).

### Per product

Template labels: *true-spec* = the base template on synthetic jobs (V0 (a)); *rule P0* = proxy.ts's rules with no truth (V0 (b)); "template alone" is the template mesh scored as is.

#### `aalter-studio-2` (dress, synthetic stills)

Reference: synthetic/garment_truth.glb. Base template: true-spec template (V0 a); same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | true-spec template (V0 a) | 0.443 | 0.956 | 0.36 | -0.53 | -0.28 | 0.0 % | 0.977 |
| template alone | true-spec template (V0 a) | 0.567 | 0.950 | 0.00 | +0.04 | +0.00 | 2.6 % | 0.994 |
| two-view | true-spec template (V0 a) | 0.463 | 0.937 | 0.36 | -0.25 | -0.28 | 0.0 % | 0.968 |
| two-view, hull depth | true-spec template (V0 a) | 10.431 | 0.057 | 3.64 | +0.14 | +15.72 | 0.0 % | 0.484 |
| template alone | rule P0 (printed length, no truth) | 0.773 | 0.918 | 8.98 | -8.92 | +0.00 | 2.7 % | 0.906 |
| two-view | rule P0 (printed length, no truth) | 0.509 | 0.937 | 0.36 | -0.25 | -0.28 | 0.0 % | 0.964 |
| template alone | true-spec wider +8 %, hem 8 cm up | 1.555 | 0.346 | 8.00 | -6.83 | -8.59 | 2.9 % | 0.853 |
| two-view | true-spec wider +8 %, hem 8 cm up | 0.952 | 0.585 | 0.41 | +0.81 | -0.28 | 0.0 % | 0.943 |
| template alone | true-spec narrower −6 %, hem 8 cm down | 1.548 | 0.402 | 8.00 | +7.29 | +5.73 | 8.8 % | 0.858 |
| two-view | true-spec narrower −6 %, hem 8 cm down | 0.682 | 0.877 | 0.14 | +0.05 | -0.28 | 0.0 % | 0.950 |
| template alone | true-spec depth +15 % only | 1.232 | 0.517 | 0.00 | +1.74 | +0.00 | 2.4 % | 0.950 |
| two-view | true-spec depth +15 % only | 1.270 | 0.460 | 0.86 | +1.39 | -0.28 | 0.0 % | 0.930 |
| template alone | true-spec depth −15 % only | 1.334 | 0.467 | 0.00 | -1.61 | +0.00 | 16.0 % | 0.946 |
| two-view | true-spec depth −15 % only | 0.952 | 0.646 | 0.14 | +0.21 | -0.28 | 0.0 % | 0.940 |
| template alone | other product linde-dress-01 | 3.111 | 0.492 | 20.96 | -20.89 | -37.28 | 3.8 % | 0.663 |
| two-view | other product linde-dress-01 | 0.960 | 0.681 | 0.64 | +0.64 | -0.28 | 0.0 % | 0.929 |

#### `azure-palm-baby-doll-dress` (dress, synthetic stills)

Reference: synthetic/garment_truth.glb. Base template: true-spec template (V0 a); same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | true-spec template (V0 a) | 0.335 | 0.981 | 0.36 | -0.49 | — | 0.0 % | 0.932 |
| template alone | true-spec template (V0 a) | 1.424 | 0.576 | 0.00 | +0.36 | — | 2.6 % | 0.876 |
| two-view | true-spec template (V0 a) | 0.775 | 0.749 | 0.86 | -0.63 | — | 0.0 % | 0.914 |
| two-view, hull depth | true-spec template (V0 a) | 12.854 | 0.059 | 2.64 | -1.09 | — | 0.0 % | 0.348 |
| template alone | rule P0 (printed length, no truth) | 1.615 | 0.588 | 9.67 | -9.24 | — | 2.9 % | 0.786 |
| two-view | rule P0 (printed length, no truth) | 0.928 | 0.708 | 0.86 | -0.52 | — | 0.0 % | 0.909 |
| template alone | true-spec wider +8 %, hem 8 cm up | 2.571 | 0.218 | 8.00 | -6.36 | — | 2.8 % | 0.752 |
| two-view | true-spec wider +8 %, hem 8 cm up | 1.538 | 0.494 | 1.36 | -0.09 | — | 0.0 % | 0.880 |
| template alone | true-spec narrower −6 %, hem 8 cm down | 1.722 | 0.475 | 8.00 | +7.51 | — | 6.4 % | 0.797 |
| two-view | true-spec narrower −6 %, hem 8 cm down | 0.533 | 0.923 | 0.51 | -0.48 | — | 0.0 % | 0.925 |
| template alone | true-spec depth +15 % only | 2.359 | 0.267 | 0.00 | +2.24 | — | 2.3 % | 0.830 |
| two-view | true-spec depth +15 % only | 1.850 | 0.322 | 1.36 | +0.74 | — | 0.0 % | 0.868 |
| template alone | true-spec depth −15 % only | 1.495 | 0.420 | 0.00 | -1.46 | — | 25.3 % | 0.877 |
| two-view | true-spec depth −15 % only | 0.621 | 0.879 | 0.36 | -0.55 | — | 0.0 % | 0.920 |
| template alone | other product linde-dress-01 | 1.931 | 0.351 | 0.04 | -0.17 | — | 3.8 % | 0.807 |
| two-view | other product linde-dress-01 | 0.782 | 0.739 | 0.14 | -0.15 | — | 0.0 % | 0.911 |

#### `azure-palm-baby-doll-dress` (dress, run 14 GPU frames)

Reference: full stage 4t fit (128 frames, from P0), computed here. Base template: P0; control/proxy.glb has 4034 welded vertices, today's P0 3586 (an older proxy version exported the job).

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | P0 | 0.252 | 1.000 | 0.00 | +0.00 | +0.00 | 0.0 % | 0.884 |
| template alone | P0 | 2.504 | 0.504 | 2.30 | -1.57 | — | 2.9 % | 0.778 |
| two-view | P0 | 0.848 | 0.748 | 1.64 | -0.17 | -0.43 | 0.0 % | 0.873 |
| two-view, hull depth | P0 | 10.984 | 0.067 | 1.01 | -2.75 | +37.57 | 0.0 % | 0.411 |
| template alone | P0 wider +8 %, hem 8 cm up | 2.750 | 0.369 | 10.30 | -8.23 | — | 3.1 % | 0.688 |
| two-view | P0 wider +8 %, hem 8 cm up | 1.354 | 0.467 | 1.80 | +1.02 | -0.43 | 0.0 % | 0.856 |
| template alone | P0 narrower −6 %, hem 8 cm down | 3.724 | 0.090 | 5.70 | +5.57 | — | 7.4 % | 0.684 |
| two-view | P0 narrower −6 %, hem 8 cm down | 0.994 | 0.629 | 1.32 | +0.38 | -1.03 | 0.0 % | 0.871 |
| template alone | P0 depth +15 % only | 2.745 | 0.307 | 2.30 | +0.33 | — | 2.6 % | 0.771 |
| two-view | P0 depth +15 % only | 1.568 | 0.366 | 1.98 | +1.71 | -0.43 | 0.0 % | 0.848 |
| template alone | P0 depth −15 % only | 3.364 | 0.066 | 2.30 | -3.41 | — | 27.9 % | 0.740 |
| two-view | P0 depth −15 % only | 1.150 | 0.521 | 1.19 | +0.17 | -0.43 | 0.0 % | 0.870 |
| template alone | other product linde-dress-01 | 3.436 | 0.196 | 7.41 | +7.50 | -15.43 | 3.8 % | 0.704 |
| two-view | other product linde-dress-01 | 1.352 | 0.558 | 0.73 | -0.07 | -0.43 | 0.0 % | 0.861 |

#### `monochrome-03` (top, synthetic stills)

Reference: synthetic/garment_truth.glb. Base template: true-spec template (V0 a); same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | true-spec template (V0 a) | 0.554 | 0.875 | 0.36 | -0.49 | +0.00 | 0.0 % | 0.938 |
| template alone | true-spec template (V0 a) | 0.622 | 0.893 | 0.00 | +0.14 | +0.00 | 5.2 % | 0.950 |
| two-view | true-spec template (V0 a) | 0.586 | 0.863 | 0.36 | -0.14 | +0.00 | 0.0 % | 0.928 |
| two-view, hull depth | true-spec template (V0 a) | 12.026 | 0.051 | 1.65 | -2.48 | +51.00 | 0.0 % | 0.303 |
| template alone | rule P0 (printed length, no truth) | 0.944 | 0.829 | 9.71 | -9.52 | +0.00 | 5.8 % | 0.809 |
| two-view | rule P0 (printed length, no truth) | 0.595 | 0.865 | 0.36 | -0.12 | +0.00 | 0.0 % | 0.928 |
| template alone | true-spec wider +8 %, hem 8 cm up | 1.460 | 0.445 | 8.00 | -6.67 | -3.30 | 5.8 % | 0.791 |
| two-view | true-spec wider +8 %, hem 8 cm up | 1.003 | 0.563 | 0.36 | +0.69 | +0.00 | 0.0 % | 0.912 |
| template alone | true-spec narrower −6 %, hem 8 cm down | 1.558 | 0.517 | 8.00 | +7.31 | +2.20 | 16.3 % | 0.797 |
| two-view | true-spec narrower −6 %, hem 8 cm down | 0.647 | 0.848 | 0.36 | -0.62 | +0.00 | 0.0 % | 0.921 |
| template alone | true-spec depth +15 % only | 1.166 | 0.545 | 0.00 | +2.04 | +0.00 | 4.9 % | 0.913 |
| two-view | true-spec depth +15 % only | 1.325 | 0.439 | 0.36 | +1.79 | +0.00 | 0.0 % | 0.894 |
| template alone | true-spec depth −15 % only | 1.295 | 0.454 | 0.00 | -1.70 | +0.00 | 23.2 % | 0.914 |
| two-view | true-spec depth −15 % only | 0.813 | 0.687 | 0.14 | -0.27 | +0.00 | 0.0 % | 0.916 |
| template alone | other product noord-top-01 | 2.231 | 0.661 | 2.99 | -3.52 | +35.28 | 3.7 % | 0.755 |
| two-view | other product noord-top-01 | 0.570 | 0.857 | 0.36 | -0.74 | +0.00 | 0.0 % | 0.928 |

#### `rosewater-blouse` (top, synthetic stills)

Reference: synthetic/garment_truth.glb. Base template: true-spec template (V0 a); same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | true-spec template (V0 a) | 0.480 | 0.914 | 0.36 | -0.52 | -0.20 | 0.0 % | 0.951 |
| template alone | true-spec template (V0 a) | 0.589 | 0.929 | 0.00 | +0.07 | +0.00 | 4.4 % | 0.965 |
| two-view | true-spec template (V0 a) | 0.541 | 0.883 | 0.36 | -0.20 | -0.20 | 0.0 % | 0.928 |
| two-view, hull depth | true-spec template (V0 a) | 11.669 | 0.049 | 3.27 | -0.24 | +38.80 | 0.0 % | 0.320 |
| template alone | rule P0 (printed length, no truth) | 0.885 | 0.869 | 9.76 | -9.70 | +0.00 | 5.0 % | 0.829 |
| two-view | rule P0 (printed length, no truth) | 0.547 | 0.883 | 0.36 | -0.17 | -0.20 | 0.0 % | 0.928 |
| template alone | true-spec wider +8 %, hem 8 cm up | 1.469 | 0.485 | 8.00 | -6.76 | -5.13 | 4.8 % | 0.797 |
| two-view | true-spec wider +8 %, hem 8 cm up | 0.996 | 0.592 | 0.36 | +0.78 | -0.20 | 0.0 % | 0.906 |
| template alone | true-spec narrower −6 %, hem 8 cm down | 1.523 | 0.553 | 8.00 | +7.24 | +3.42 | 7.6 % | 0.804 |
| two-view | true-spec narrower −6 %, hem 8 cm down | 0.665 | 0.908 | 0.36 | -0.46 | -0.20 | 0.0 % | 0.918 |
| template alone | true-spec depth +15 % only | 1.129 | 0.560 | 0.00 | +1.80 | +0.00 | 4.1 % | 0.929 |
| two-view | true-spec depth +15 % only | 1.272 | 0.464 | 0.36 | +1.56 | -0.20 | 0.0 % | 0.896 |
| template alone | true-spec depth −15 % only | 1.195 | 0.519 | 0.00 | -1.62 | +0.00 | 19.5 % | 0.933 |
| two-view | true-spec depth −15 % only | 0.799 | 0.648 | 0.17 | -0.17 | -0.20 | 0.0 % | 0.914 |
| template alone | other product noord-top-01 | 1.434 | 0.690 | 0.99 | -0.99 | +23.08 | 3.7 % | 0.844 |
| two-view | other product noord-top-01 | 0.594 | 0.897 | 0.36 | -0.31 | -0.20 | 0.0 % | 0.923 |

#### `woodstock-wanderer-knit-cardi` (outerwear, synthetic stills)

Reference: synthetic/garment_truth.glb. Base template: true-spec template (V0 a); same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | true-spec template (V0 a) | 0.521 | 0.901 | 0.10 | -2.18 | -0.28 | 0.0 % | 0.954 |
| template alone | true-spec template (V0 a) | 0.548 | 0.925 | 0.00 | +0.00 | +0.00 | 5.8 % | 0.972 |
| two-view | true-spec template (V0 a) | 0.526 | 0.881 | 0.43 | -2.15 | -0.28 | 0.0 % | 0.942 |
| two-view, hull depth | true-spec template (V0 a) | 11.011 | 0.043 | 13.05 | +10.36 | +15.72 | 0.0 % | 0.307 |
| template alone | true-spec wider +8 %, hem 8 cm up | 1.392 | 0.512 | 8.00 | -7.03 | -8.59 | 4.5 % | 0.779 |
| two-view | true-spec wider +8 %, hem 8 cm up | 0.900 | 0.641 | 0.60 | -1.96 | -0.28 | 0.0 % | 0.921 |
| template alone | true-spec narrower −6 %, hem 8 cm down | 1.517 | 0.678 | 8.00 | +7.54 | +5.73 | 15.0 % | 0.791 |
| two-view | true-spec narrower −6 %, hem 8 cm down | 0.638 | 0.910 | 0.10 | +1.14 | -0.28 | 0.0 % | 0.925 |
| template alone | true-spec depth +15 % only | 0.987 | 0.635 | 0.00 | +1.62 | +0.00 | 3.8 % | 0.941 |
| two-view | true-spec depth +15 % only | 1.084 | 0.571 | 0.60 | -1.37 | -0.28 | 0.0 % | 0.915 |
| template alone | true-spec depth −15 % only | 1.038 | 0.612 | 0.00 | -1.59 | +0.00 | 17.3 % | 0.943 |
| two-view | true-spec depth −15 % only | 0.665 | 0.824 | 0.10 | +0.60 | -0.28 | 0.0 % | 0.931 |
| template alone | other product ostend-01 | 5.642 | 0.726 | 46.89 | +47.36 | +0.00 | 2.9 % | 0.565 |
| two-view | other product ostend-01 | 0.530 | 0.877 | 0.35 | -1.69 | -0.28 | 0.0 % | 0.942 |

#### `crimson-wildflower-maxi-skirt` (skirt, synthetic stills)

Reference: synthetic/garment_truth.glb. Base template: true-spec template (V0 a); same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | true-spec template (V0 a) | 0.290 | 1.000 | 0.43 | -0.66 | — | 0.0 % | 0.976 |
| template alone | true-spec template (V0 a) | 0.655 | 0.930 | 0.00 | +0.00 | — | 0.0 % | 0.989 |
| two-view | true-spec template (V0 a) | 0.267 | 1.000 | 0.18 | -0.67 | — | 0.0 % | 0.979 |
| two-view, hull depth | true-spec template (V0 a) | 12.144 | 0.084 | 5.32 | +10.01 | — | 0.0 % | 0.498 |
| template alone | true-spec wider +8 %, hem 8 cm up | 2.057 | 0.048 | 8.00 | -7.90 | — | 0.0 % | 0.831 |
| two-view | true-spec wider +8 %, hem 8 cm up | 0.978 | 0.493 | 0.43 | -1.07 | — | 0.0 % | 0.944 |
| template alone | true-spec narrower −6 %, hem 8 cm down | 1.966 | 0.100 | 8.00 | +7.95 | — | 0.3 % | 0.850 |
| two-view | true-spec narrower −6 %, hem 8 cm down | 0.635 | 0.876 | 0.57 | -0.24 | — | 0.0 % | 0.958 |
| template alone | true-spec depth +15 % only | 1.652 | 0.349 | 0.00 | +0.12 | — | 0.0 % | 0.929 |
| two-view | true-spec depth +15 % only | 1.424 | 0.359 | 0.68 | -1.54 | — | 0.0 % | 0.927 |
| template alone | true-spec depth −15 % only | 1.772 | 0.306 | 0.00 | -0.10 | — | 9.7 % | 0.927 |
| two-view | true-spec depth −15 % only | 1.246 | 0.431 | 0.32 | +0.00 | — | 0.0 % | 0.933 |
| template alone | other product rue-marais-bottom-01 | 1.872 | 0.623 | 14.88 | -14.80 | — | 0.0 % | 0.771 |
| two-view | other product rue-marais-bottom-01 | 0.484 | 0.981 | 0.57 | -0.21 | — | 0.0 % | 0.966 |

#### `rosewater-palazzo-pants` (trousers, synthetic stills)

Reference: synthetic/garment_truth.glb. Base template: true-spec template (V0 a); same vertex count as control/proxy.glb.

| Route | Template | Chamfer (cm) | F-score @1 cm | Hem \|err\| (cm) | Length err (cm) | Cuff err (cm) | Inside body | Holdout silhouette IoU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full stage 4t | true-spec template (V0 a) | 0.849 | 0.703 | 1.18 | -0.66 | — | 0.0 % | 0.961 |
| template alone | true-spec template (V0 a) | 0.590 | 0.918 | 0.00 | +0.00 | — | 1.4 % | 0.984 |
| two-view | true-spec template (V0 a) | 0.383 | 0.981 | 2.19 | -0.56 | — | 0.0 % | 0.968 |
| two-view, hull depth | true-spec template (V0 a) | 9.250 | 0.037 | 2.65 | +2.77 | — | 0.0 % | 0.518 |
| template alone | true-spec wider +8 %, hem 8 cm up | 1.450 | 0.394 | 8.00 | -7.57 | — | 0.4 % | 0.848 |
| two-view | true-spec wider +8 %, hem 8 cm up | 0.821 | 0.733 | 2.59 | -0.57 | — | 0.0 % | 0.939 |
| template alone | true-spec narrower −6 %, hem 8 cm down | 1.377 | 0.669 | 8.00 | +7.83 | — | 2.5 % | 0.865 |
| two-view | true-spec narrower −6 %, hem 8 cm down | 0.504 | 0.974 | 2.40 | -0.06 | — | 0.0 % | 0.953 |
| template alone | true-spec depth +15 % only | 1.196 | 0.493 | 0.00 | +0.00 | — | 1.0 % | 0.931 |
| two-view | true-spec depth +15 % only | 1.145 | 0.440 | 2.49 | -0.57 | — | 0.0 % | 0.923 |
| template alone | true-spec depth −15 % only | 1.308 | 0.432 | 0.00 | +0.00 | — | 7.4 % | 0.930 |
| two-view | true-spec depth −15 % only | 0.901 | 0.566 | 2.11 | -0.12 | — | 0.0 % | 0.930 |
| template alone | other product raw-denim-01 | 2.753 | 0.253 | 4.00 | +3.29 | — | 2.0 % | 0.771 |
| two-view | other product raw-denim-01 | 1.327 | 0.449 | 2.91 | +1.98 | — | 0.0 % | 0.890 |
