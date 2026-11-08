# Refinement backlog

This is the refinement memory: every known defect and improvement that is **parked** while we launch.

**Rule (founder, 8 Nov 2026).** Launch as soon as possible. First land a customer or an investor, then
develop further. Nothing on this list blocks the launch. Pick items up after the launch, in the order
of the "Priority" column, or earlier when a customer or investor asks for one.

Estimates are wall-clock time for one agent session working on its own, plus GPU list price. They
are not invoices. Generative steps (the video model) improve with retries but are not guaranteed.

## 1. 3D garments (garment engine)

The garments that ship for the demo and the pilot are **azure** (run 17b) and the **maxi skirt**
(run 17d, low-rise). Both are accepted pending founder review, and every 3D view is labelled an
estimate.

| # | Product | Open point | Cause (as far as known) | Proposed fix | Time | GPU | Priority | Status |
|---|---|---|---|---|---|---|---|---|
| R1 | Azure babydoll | Cream hem flap in turntable_b frames 82–155, and a flat panel beside the hem in turntable_a 13–31. Hem girth is unconfirmed (157.7 cm; 152.9 cm without the flap; run 15: 149.5 cm) | Wan2.2 draws cloth outside the depth control at the image-left hem. The trigger of the growth from run 15 is not proven (`phase0-written.md`, "Run 17b"; hem-flap investigation) | Run stage 2 again with 2–3 other seeds per clip (parallel stage 2) and pick the clip with the lowest off-reference score (consistency 0.4.0). Keep the rejected draws on record | 2–3 h | $2–3 | 2 | **8 Nov, CPU done (stage 4t 0.5.0):** the off-reference pixels are left out of the fit and the bake (recorded in `metrics.json` `offReference`): hem girth 157.7 → 151.8 cm, holdout unchanged. GPU part (new seeds) still open |
| R2 | Maxi skirt | Hem drawn over the feet (grey toes show) and a smeared print | The stage 1b stills (FASHN fashn@44/63) | New stills with the band at the waist and the hem above the feet (draw plan, stage 1b only), then end to end | 3–4 h | ~$1.5 | 3 | open |
| R3 | Maxi skirt | AU 8/12/16 barely differ in the viewer | Grading or drape of a skirt with one critical point (the low-rise waist) | CPU: investigate the grading for single-anchor bottoms | 2–3 h | – | 2 | **8 Nov, investigated, open:** grading is right; the drape folds 20 cm of hip spread into 5.4 cm (cling heuristic, gravity) and every size hangs from the same band. A non-elastic band now slides down (viewer); the skirt's band is elastic, and its relaxed girth is not measured, so nothing is faked for it. Needs that girth or the calibrated drape |
| R4 | Maxi skirt | Low-rise reading misses the chart by 2.49 cm before calibration; the pass after calibration is automatic | The band sits 4.76 cm below the waist ring (founder decision A, 8 Nov 2026) | Solved by R2 (band at the waist) | – | – | with R2 | open |
| R5 | Palazzo | Light flat triangle at the crotch: the garment crotch is 6.5 cm lower than the body's. Horizontal seam line on the upper thigh. Leg tubes cross below the join | Stage 4t 0.4.0 join (fitted vertices only, flat crotch floor) | CPU: shape the crotch to the body's crotch and stop the legs crossing | 3–5 h | – | 3 | **8 Nov, CPU done (template fit 0.5.0):** legs no longer cross (20 → 0); garment crotch measured from the frames (73.7 / 72.9 cm, 2.8 / 3.5 below the body's), the seat laid into the crease below it; one piece, 0 inside. Open: texture seam at the join, the viewer's V fold |
| R6 | Palazzo | Patchy print from the side; texture scores worse than one flat colour (29.72 vs 27.97) | The generated frames disagree on the print between views | One more stage 2 seed, or a view-consistent bake | 1–2 h | ~$1 | 4 | **8 Nov, CPU done (two-band bake):** palazzo holdout MAE 29.72 → 26.98 (flat colour 27.97), azure 20.79 → 19.29, skirt 29.21 → 27.20; softer than one frame, PSNR on the palazzo still below flat colour, gain picked with the holdout in view |
| R7 | Blouse | Back cut straight at the hem; no usable pair | Our blouse proxy (54.2 cm) is shorter than the real shirt-tail. FASHN backs draw a front neckline | Exporter: a longer proxy for tops with a shirt-tail (new job ids), then stage 1b + end to end | 4–6 h | $2–3 | 3 | open |
| R8 | Cardigan | Grey shoulders on the front; back sleeves swapped, drawn too big | Fitted outerwear proxy against an oversized drop-shoulder knit. Back prompt 0.2.0 did not fix the sleeve sides | Exporter: a wide outerwear proxy with a dropped shoulder (new job ids), then stage 1b + end to end | 5–8 h | $2–3 | 3 | open |
| R9 | All | Proxy leaves the mannequin's shoulder caps uncovered (blouse and cardigan Qwen fronts) | Exporter proxy geometry | Covered by R7/R8 | – | – | with R7/R8 | open |
| R10 | All | Thresholds rest on one shop and five products (stage 1b QA, consistency 0.4.0 off-reference, conform cap) | Little data | Re-tune on a second shop | 2–4 h | – | 4 | open |

All of R1–R8 can run in parallel: about **10–16 h** wall-clock and **$10–15** GPU in total.

## 2. Pipeline

| # | Open point | Proposed fix | Time | Priority |
|---|---|---|---|---|
| P1 | Parallel stage 2 (motion clip off) has not run on a GPU yet | Comes with the first GPU run of R1/R2. Check the wall clock (~8 min) and the cost (~$1.05) against the estimate | – | with R1 |
| P2 | Re-running only a failed stage 2 clip is not supported | Reuse a finished clip from the Volume | 2 h | 4 |
| P3 | Every product still needs by-eye review (for example 4 runs to find a good skirt back) | Automate the checks we now find by hand (waistband present, seam height, hem width, view agreement on print features) | 1–2 weeks | 1 after launch |
| P4 | Second shop | Validate the pipeline outside Bohohippychic | 1–2 days + GPU | 2 after launch |

## 3. Plugin and merchant side

| # | Open point | Proposed fix | Time | Priority |
|---|---|---|---|---|
| M1 | No approval screen for 3D assets in the Shopify and Woo admin. `settings.garment3d` is set by hand. QA flags (`low_rise_waist`) and `qaNotes` are visible only in the API | Admin row with preview, approve/reject and the notes | 4–6 h | 1 after launch (before 3D at a real shop) |
| M2 | The import gate trusts qa.json | Recompute key QA fields at import | 2 h | 3 |
| M3 | The Caddy `/assets` block has not been validated against a real Caddy | `infra/scripts/caddy-validate.sh` on the VPS before the first deploy | 15 min | at deploy |
| M4 | 3D pricing (D17) | Founder decision | – | founder |
| M5 | The demo price shows EUR 0 for the azure product | Cosmetic, demo only | 15 min | 4 |

## 4. Decisions and permissions

| # | Point | Status |
|---|---|---|
| B1 | Bohohippychic permission for its name, logo, product photos and the 3D bundles derived from them (D13) | **Granted.** The founder holds the permission (stated 8 Nov 2026). Keep the written confirmation on file outside the repo. The website and demos may use these assets |
| B2 | Founder review of the azure and skirt bundles | Open (renders sent 8 Nov 2026) |
| B3 | Trial length, what happens after the trial, app name and trademark (checklist E1), legal review | Open, founder |

## Launch path (now)

1. The website `apps/site` is being built (branch `claude/site`). Fill in the Bohohippychic assets (B1).
2. Cowork sets up the VPS and DNS (`docs/COWORK-HANDOFF.md`).
3. The work goes to `main`, the first deploy runs, and curtain.fit, app and api are live.
4. Shopify: development store first, then the pilot install at Bohohippychic (custom distribution).
5. Investor and customer material: demo shop with 3D (azure and skirt), the website, and a short demo video or deck.
