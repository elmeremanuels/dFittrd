# Step 3, route R5 mock: size rings user test

**Date:** 10 Nov 2026; **updated 14 Nov 2026** with the shop's tape measurements of the pilot skirt (AU 8, 10 and 14; `spikes/garment-engine/data/bohohippychic/tape/crimson-wildflower-maxi-skirt.json`). **Plan:** `docs/research/shortcut-to-step3.md` §4, days 3-5 ("R5 mock: AU 8/12/16 ring outlines plus neighbour ghost in AvatarView; test with 5 users"). **Go/no-go question:** do users pick a size and say why?

## 1. What the mock shows

On the result screen of the `/embed` flow ("How it fits" tab), over the existing 2D figure:

- **Rings** for the size on screen at bust (tops and dresses), waist, hips and hem. A ring's width comes from the garment girth by the same rule the body outline uses, so a ring smaller than the body sits *inside* the outline (it cuts in) and a roomy ring stands off it.
- **A chip per ring** in words and numbers: "Tight / 6 cm short", "Good fit / 5 cm room", "Loose / 15 cm room", "Not checked / 7 cm room" (the fit engine does not score that point for this cut and we hold no tape of the garment), and for the pilot skirt, from the shop's tape: "Hips / 22 cm room / skirt 124 cm estimated", "Hem / 230 cm measured / wider than drawn", and under the waist chip "band 67-94 cm measured". **measured** = the shop measured that size; **estimated** = that size was not measured and the number comes from the measured sizes (the full sentence says interpolated or extrapolated); **assumed** = a placeholder of ours. Colour is never the only signal; screen readers get one sentence per ring.
- **Ghost rings**: faint dashed rings of the sizes on either side, labelled with their size.
- **Legend** under the figure: which size is solid, which are ghosts, and the estimate notes. A "Hide size rings" button switches the layer off; the tight/loose look of the figure (strain marks, folds) stays either way.
- **3D view** (products with an approved bundle): the same ring numbers (same units as the 2D figure) as a line of text under the 3D estimate. The rings are not drawn in 3D. The hem is left out there, with the note "The 3D drape does not show the hem width yet": the 3D skirt still hangs as a narrow tube (REFINEMENT R3).

Every number on a ring comes from `@curtain/fit-engine`'s per-point output for that size (`chartCm`, `bodyCm`, `band`). The ring code decides no size and no band.

### What is measured, estimated and assumed (say this to nobody in the test, but know it)

All girths are full girths in cm (flat width x 2). Source of truth: the tape file above; `PILOT_SKIRT_TAPE` in `apps/web/src/render/ringInputs.ts` is a copy, and `apps/web/src/__tests__/ringTape.test.ts` fails when the two drift.

| Size | Band relaxed | Band stretched | Garment hip | Hem sweep | Length | Status |
|---|---|---|---|---|---|---|
| AU 8 | 67 | 94 | 112 | 230 | 103 | **measured** by the shop |
| AU 10 | 71 | 100 | 122 | 248 | 103 | **measured** by the shop |
| AU 12 | 75.5 | 105 | 124 | 254 | 103.5 | **interpolated, not measured**: halfway between AU 10 and AU 14 |
| AU 14 | 80 | 110 | 126 | 260 | 104 | **measured** by the shop |
| AU 16 | 84.5 | 115 | 128 | 266 | 104.5 | **extrapolated, not measured**: AU 14 + (AU 14 − AU 10) / 2 |

**The rule** (`fillSizes()` in `ringInputs.ts`): a measured size keeps its value; a size between two measured sizes lies on the straight line between its nearest measured neighbours; a size outside them continues the line through the two nearest measured sizes. Nothing is smoothed. On screen a shopper reads "measured" or "estimated"; the sentence for screen readers and the legend say which sizes were measured and whether the estimate is interpolated or extrapolated. (The length row is not drawn as a ring; its AU 12 and 16 values follow the same rule and are shown here only.)

**Uneven hip steps, not corrected.** The garment hip goes 112 → 122 (+10 cm for one size) → 126 (+4 cm for two sizes). Against the chart's body hip that is +18 / +23 / +17 cm of room at AU 8 / 10 / 14. Band and hem grade more evenly (band stretched +6, then +10 over two sizes; hem +18, then +12 over two sizes; the hem too steps more between 8 and 10), so a likely cause is the measuring height: the hip line of an A-line skirt is not a seam. Between hip (about 120 cm) and hem (about 250 cm) this skirt widens by roughly 1.5 cm of girth per cm of length, so a tape laid 3 cm lower reads 4-5 cm more. AU 10 may have been measured lower than the other two, or AU 10 really is cut fuller. We cannot tell from the page; the shop has to say at what distance below the band it measured (`docs/MERCHANT-MEASUREMENTS.md` now fixes it at 20 cm). Consequence: the interpolated AU 12 hip (124) inherits the doubt, and the extrapolated AU 16 hip (128) more so.

| Input | Status | Value used |
|---|---|---|
| Waist ring | The size chart's **body** girth plus the engine's designed ease (not a garment girth; says so) | AU 12: 77.5 + 3 = 80.5, printed 81 |
| Waistband range under the waist ring | **Measured** AU 8, 10, 14; estimated AU 12, 16 | table above |
| Hip ring | The garment's own hip girth from the tape (**measured** / estimated), with the room as plain arithmetic. No tight / loose word: the fit engine does not score an A-line hip, and the ring code does not either | table above |
| Hem ring | **Measured** / estimated. A 2.3-2.7 m hem spread into a ring is wider than the 2D picture (which holds about 216 cm at 167 cm body height), so every size is drawn at the picture's edge and labelled "wider than drawn". The hem ring therefore no longer grows with the size; the number does | table above |
| Hip measuring height | **Not stated by the shop** (legend says so) | — |
| Closure | **ASSUMED pull-on** (the tape page does not state it; the shop text says "elasticated waistband", "comfortable stretch at the waist"): the stretched band must pass over the hips | `closure` in `PILOT_SKIRT_TAPE` |
| Skirt length in the 2D drawing | Payload `lengthCm.waist_to_hem` 103.3 (mean of the measured 103 / 103 / 104) | on a 165-167 cm figure the hem reaches the floor |
| Body girths | The tester's typed answers; when only height and weight are given, an estimate ("about …", room rounded to 2 cm) | — |

### Band sweep with the measured band (three test bodies)

Generated by `node apps/web/scripts/band-sweep.mjs` (`bandSweep()` in `ringInputs.ts`; `--assumed` prints the old assumed scenarios). Waist % = how far the band is stretched at the body waist (0% = at rest, 100% = at its comfortable limit; below 0 the relaxed band is larger than the waist and does not grip). "Over hips" = stretched band minus body hip. This is arithmetic on the tape, not a fit verdict: the fit engine's words do not change with it.

| Size | Band relaxed-stretched, cm | Source | Stretched minus chart hip of that size | Slim (waist 64, hip 90) | Average (waist 76, hip 102) | Curvy (waist 86, hip 116) |
|---|---|---|---|---|---|---|
| AU 8 | 67-94 | **measured** | +0 cm (chart hip 94) | waist -11% (at rest: does not grip), +4 cm over hips *(engine's pick)* | waist 33%, **-8 cm at hips: will not pull on** | waist 70%, **-22 cm at hips: will not pull on** |
| AU 10 | 71-100 | **measured** | +1 cm (chart hip 99) | waist -24% (at rest: does not grip), +10 cm over hips | waist 17%, **-2 cm at hips: will not pull on** | waist 52%, **-16 cm at hips: will not pull on** |
| AU 12 | 75.5-105 | interpolated, not measured | +1 cm (chart hip 104) | waist -39% (at rest: does not grip), +15 cm over hips | waist 2%, +3 cm over hips *(engine's pick)* | waist 36%, **-11 cm at hips: will not pull on** |
| AU 14 | 80-110 | **measured** | +1 cm (chart hip 109) | waist -53% (at rest: does not grip), +20 cm over hips | waist -13% (at rest: does not grip), +8 cm over hips | waist 20%, **-6 cm at hips: will not pull on** |
| AU 16 | 84.5-115 | extrapolated, not measured | +1 cm (chart hip 114) | waist -67% (at rest: does not grip), +25 cm over hips | waist -28% (at rest: does not grip), +13 cm over hips | waist 5%, **-1 cm at hips: will not pull on** *(engine's pick)* |

Reading:

- **The band, stretched, equals the chart hip of its own size.** Measured: 94 vs chart hip 94 (AU 8), 100 vs 99 (AU 10), 110 vs 109 (AU 14): +0 / +1 / +1 cm. Relaxed it is the chart waist minus 0.5 to 2.5 cm (67 vs 67.5, 71 vs 72.5, 80 vs 82.5). So the skirt is cut to pull on over a body that has exactly the chart hip, with nothing to spare.
- **What that means for a shopper above the chart hip:** if her hips are larger than the chart hip of the size her waist picks, the band at its comfortable limit is smaller than her hips, by the amount she is over (less 0-1 cm). She has to pull it past its comfortable limit, or take the size her hips pick: with this band, the hip decides the size as much as the waist does, although the cut is an A-line with 17-23 cm of room at the hip once it is on.
- **Slim (64 / 90), engine's pick AU 8:** the relaxed band (67) is 3 cm larger than her waist, so it does not grip (−11%); it will sit lower, on her hips, or needs the drawstring the photos show. It passes her hips with 4 cm. No smaller size exists.
- **Average (76 / 102), engine's pick AU 12 (interpolated band 75.5-105):** 2% stretch at the waist, 3 cm over the hips. One size down, AU 10 (measured), is 2 cm short at the hips; AU 8 is 8 cm short. The engine calls AU 10 "snug" and wearable (score 0.7); by the tape it would not pull on within the band's comfortable limit.
- **Curvy (86 / 116), engine's pick AU 16 (extrapolated band 84.5-115):** 5% stretch at the waist, but the stretched band is **1 cm smaller than her hips**. Her hips are 2 cm over the AU 16 chart hip (114) and there is no AU 18. The measured AU 14 is 6 cm short. The AU 16 number is extrapolated, so 1 cm is within its doubt; measuring AU 16 would settle it.
- With a zip the hip column would not apply. The shop should confirm pull-on.

Garment hip and hem (same script):

| Size | Garment hip, cm | Hem sweep, cm | Source | Garment hip minus chart hip | Slim: garment hip minus body hip 90 | Average: garment hip minus body hip 102 | Curvy: garment hip minus body hip 116 |
|---|---|---|---|---|---|---|---|
| AU 8 | 112 | 230 | **measured** | +18 cm | +22 cm | +10 cm | -4 cm |
| AU 10 | 122 | 248 | **measured** | +23 cm | +32 cm | +20 cm | +6 cm |
| AU 12 | 124 | 254 | interpolated, not measured | +20 cm | +34 cm | +22 cm | +8 cm |
| AU 14 | 126 | 260 | **measured** | +17 cm | +36 cm | +24 cm | +10 cm |
| AU 16 | 128 | 266 | extrapolated, not measured | +14 cm | +38 cm | +26 cm | +12 cm |

Once on, the hip has room for every body in its own size: +22 cm (slim, AU 8, measured), +22 cm (average, AU 12, interpolated), +12 cm (curvy, AU 16, extrapolated). The only negative is the curvy body in AU 8 (−4 cm), four sizes down.

### Payload and fit engine (checked 14 Nov)

**What GarmentPayload v1 can carry** (`packages/schema/src/garment.ts`; there is no `sampleMeasurements` or similar field): `sizeChart` is one chart, declared body *or* garment by `sizeChartType`; `ease` is one garment-minus-body number per fit point for all sizes; `lengthCm` is one number per length key. So the pilot payload (`spikes/garment-engine/data/bohohippychic/products.json`, built by `src/shopTape.ts`, also on a rebuild by `shop:bohohippychic`) now carries:

- `lengthCm.waist_to_hem` **103.3** (mean of the measured 103 / 103 / 104);
- `ease.hip` **19.3** (mean of garment hip minus chart hip at the measured sizes: 18 / 23 / 17).

**Missing in the schema** (not added; the values stay in the tape file, named beside the payload under `tape`): (1) a per-size garment measurement next to a body chart; (2) an elastic range, relaxed and stretched, for a stretch zone; (3) a hem girth (`lengthCm` holds lengths); (4) per-size lengths; (5) a marker per value for measured / interpolated / extrapolated; (6) the closure (pull-on or zip). The demo seeds the skirt from the bundle's `payload.json` (git-ignored, `spikes/garment-engine/out/eval/…`); the local copy was refreshed from products.json for the screenshots, a fresh export carries the fields by itself.

**Fit engine, before / after** (`computeFit`, bodies bust / waist / hip; pinned by `spikes/garment-engine/src/shopTape.test.ts`):

| Body | Before: pick, score, waist band (gap) | After (length + hip ease): pick, score, waist band (gap) | Change |
|---|---|---|---|
| Slim 82 / 64 / 90 | AU 8, 1.0, good (+3.6 cm) | AU 8, 1.0, good (+3.6 cm) | none |
| Average 93 / 76 / 102 | AU 12, 1.0, good (+1.6 cm) | AU 12, 1.0, good (+1.6 cm) | none |
| Curvy 106 / 86 / 116 | AU 16, 1.0, good (+1.6 cm) | AU 16, 1.0, good (+1.6 cm) | none |

The whole result object is identical, every size and band. Reason: the A-line block skips the hip, so `ease.hip` is never read, and the engine reads no length. What does change is outside the fit engine: the garment-engine spike takes its hip target from chart + ease, so the AU 12 hip target moves from 109 to **123.3 cm** and the proxy hem from "maxi: just above the ankle" to the printed 103.3 cm (three spike expectations updated). The existing 3D bundle was made before the tape and is unchanged.

Tried and **not** committed (same bodies, same engine):

| Variant | Slim | Average | Curvy | Verdict |
|---|---|---|---|---|
| `ease.waist` −1.5 (relaxed band minus chart waist, mean) | AU 8; AU 10 turns good → loose | AU 12; AU 14 turns good → roomy | AU 16 | picks unchanged, neighbours shift; `ease.waist` is not meant for an elastic range |
| Hip made critical so the engine scores it with ease 19.3 | AU 8 | AU 12 | AU 16, score 1.0 → 0.8 (hip "snug", gap −1.3 cm) | misleading: by the tape the garment hip has about 12 cm room on her; the engine compares against chart + designed ease, not the garment |
| Garment chart: waist = relaxed band, hip = garment hip | AU 8 | **AU 14** | AU 16, waist "snug", 0.7 | wrong: treats the relaxed band as a fixed waist |
| Garment chart: waist = stretched band | none fits | none fits | **AU 8** | nonsense |

**Proposal (not implemented; the fit engine's logic is unchanged).** The engine has no notion of an elastic band and so cannot see the one thing the tape says decides this skirt: whether the band clears the hips.

1. *Pull-on clearance.* For a garment with a `waistband` stretch zone, a pull-on closure and a measured stretched band, a size whose stretched band is smaller than the body hip is not wearable ("will not pull on over the hips"), whatever the waist says. With today's numbers: average body, AU 10 is "snug, wearable 0.7" in the engine but 2 cm short at the hips; curvy body, AU 16 is "good 1.0" but 1 cm short (extrapolated). A pear-shaped shopper, waist 70 / hip 104, is the clear case (run through the engine): it recommends AU 10 (waist good, score 1.0, tie with AU 12 broken by closest ease), whose measured band stretches to 100, 4 cm short of her hips; AU 12 (interpolated 75.5-105) clears them by 1 cm.
2. *Waist band from the elastic range.* Score the waist against the range instead of chart + 3 cm: "good" when the body waist lies between the relaxed girth and roughly the first half of the stretch, "does not grip" below relaxed (slim body in AU 8: 64 < 67), "tight" near the stretched limit. Today the engine prints 80.5 cm for the AU 12 waist where the relaxed band is 75.5.
3. *Schema first.* Both need the per-size band (relaxed, stretched) and the closure in GarmentPayload, with a measured / estimated marker, i.e. the fields listed as missing above. Until then the ring code shows the clearance as arithmetic in the sentence under the ring and never as a tight / loose word.

## 2. Test script (15 minutes per person, 5 people)

**Setup (before the session).** Laptop or phone with `pnpm demo` running (storefront `http://localhost:5180`), Shopify Dawn page of the **Crimson Wildflower Maxi Skirt** (needs the git-ignored skirt bundle) and, as the second product, the **Linen Wrap Dress** (`/products/aalter-studio-1`). Fresh browser profile per tester. A phone-sized window (about 390 px wide) is closest to how shoppers will see it. A printout of this page for notes. Ask for consent to take notes; record no names, no measurements, no photos.

**Recruit.** 5 women who have bought clothes online in the last 6 months; try to cover a slim, an average and a curvy figure. Ask them to use their own height, weight and, if they know them, bust/waist/hip. If they prefer not to, hand them one of the three test bodies below as a persona.

| Persona | Height / weight | Bust / waist / hip | Engine pick for the skirt |
|---|---|---|---|
| Slim | 165 cm / 54 kg | 82 / 64 / 90 | AU 8 |
| Average | 167 cm / 66 kg | 93 / 76 / 102 | AU 12 |
| Curvy | 166 cm / 82 kg | 106 / 86 / 116 | AU 16 |

**0-2 min, intro.** "We are testing a size helper for online shops, not you. Think aloud. There are no wrong answers. The pictures are estimates, not photos." Do not mention the rings.

**2-7 min, task 1: the skirt.** "You like this skirt. Find out which size to order." Let them press "Try it on", fill in About you, and reach the result. Do not help unless stuck for 60 s.
Then ask:
1. "Which size would you order?" (record the size)
2. "Why that one?" (record their words verbatim)
3. "What do the lines around the figure tell you?" (record; do they mention rings, room, tight?)
4. "Look at the size next to it. What changes?" (do they click Compare sizes? Do they read the chips?)

**7-11 min, task 2: the dress.** Same flow on the Linen Wrap Dress (XS-L, bust ring). Ask 1 and 2 again, then:
5. "Is anything on this screen confusing or wrong?"

**11-14 min, rings off.** Press "Hide size rings". "Would you still pick the same size? Is it easier or harder without the lines?" Then "Some numbers say *measured*, *estimated* or *not checked*. What do you think that means? Does it change how much you trust it?"

**14-15 min, wrap-up.** "On a scale of 1-5, how sure are you about your size?" and "Would you rather have this or the shop's size chart?"

### What to record per tester

| Field | Example |
|---|---|
| Persona / own body | own, curvy-ish |
| Device | phone, Safari |
| Size picked, skirt / dress | 14 / L |
| Engine's recommendation | 16 / L |
| Reason in their words | "the waist one said tight on 14 but it stretches" |
| Mentions rings or chip text unprompted (yes/no) | yes |
| Used Compare sizes (yes/no) | yes |
| Confusion points | ghost labels too small |
| Trust in "estimated" (1-5) | 3 |
| Sure about size (1-5) | 4 |
| Rings on vs off: preference | on |

### Success criterion

**Go** for R5 as the step-3 safety net if **at least 4 of 5** testers pick a size **and** give a reason that refers to fit at a body point ("room at the waist", "tight at the bust", "the hem ring is wider"), not only "it's recommended". A size different from the engine's pick still counts if the reason is a fit reason. **No-go / redesign** if 2 or more cannot say why, or if 2 or more read the rings as the actual garment shape (e.g. "the skirt will stick out like that").

## 3. Screenshots

Made with `node apps/web/scripts/rings-shots.mjs <out>` (dev-only harness `apps/web/dev/rings.html`, real `ResultScreen`, 390 px phone viewport at 2x, Chromium; not a real phone). Files are local (the bundle payloads are git-ignored), in the session scratchpad `step3/rings/`:

| File | What it shows |
|---|---|
| `crimson-wildflower-maxi-skirt-tape-sheet.png` (14 Nov, scratchpad `tape/rings/shots/`) | Four results side by side: slim AU 8, average AU 8, average AU 12, curvy AU 16, with the tape values. **Harness renders with forced sizes** |
| `crimson-wildflower-maxi-skirt-average-au12.png` | Average body, recommended AU 12: waist "Good fit / 5 cm room / band 76-105 cm estimated", hip "Hips / 22 cm room / skirt 124 cm estimated", hem "254 cm estimated / wider than drawn", ghosts 10 and 14 |
| `crimson-wildflower-maxi-skirt-slim-au8.png` | Slim body, AU 8: all three tape values "measured" |
| `crimson-wildflower-maxi-skirt-curvy-au16.png` | Curvy body, AU 16: "Good fit" at the waist; the sentence for screen readers adds that the stretched band is 1 cm smaller than her hips (not on a chip) |
| `azure-palm-baby-doll-dress-sheet.png` (10 Nov) | 3 x 3 for an AU 8-16 empire dress: bust ring scored, waist and hip "Not checked" (no tape) |
| `test-results/demo-e2e/shopify-dawn-3b-size-rings-other.png` (demo:e2e) | The real embed after switching to a neighbouring size (Linen Wrap Dress) |
| `test-results/demo-e2e/shopify-dawn-3b-size-rings-skirt.png` (demo:e2e) | The real embed, pilot skirt, after switching to a neighbouring size: waist with the band range, garment hip and hem, each with its source |

What the 14 Nov renders show, defects included: the labels are right and readable; the skirt and its hem ring have the **same width in every size** (the hem is clamped at the picture's edge); the skirt covers the feet (103 cm on a 165-167 cm figure); the waist and hip chips sit on the right half of the figure and cover the right end of the hip ring; the three-line chips are close to each other; in the harness the sticky "Choose size" button covers part of the legend. The pull-on shortfall is only in the screen-reader sentence, not visible on a chip.

## 4. Known limits of the mock

- **The graded step is small on screen.** At true scale a 5 cm waist girth step moves a ring 5 / (π × 1.75) ≈ 0.9 cm per side, about 2.5 viewBox units, which at the mirror's scale (about 0.69 CSS px per unit) is **about 1.7 CSS px per side, roughly 0.3 mm** on a 390 px wide phone. Measured in the harness (`rings-shots.mjs` logs the drawn width): the waist ring is 48.6 / 55.5 / 62.3 CSS px wide at AU 8 / 12 / 16 for the average body, i.e. about 3.5 CSS px wider per size. (The first version said 1.6 cm and 1.5 mm; that was the diameter-style 5/π number and wrong.) The ghost rings nearly overlap the solid ring; the size difference is carried by the chip text, not by the geometry. Exaggerating the rings would misstate the garment, so the test should tell us whether the text is enough.
- **Since the tape (14 Nov):** the hem ring is clamped at the picture's edge in every size, so only its number changes; and whether the band clears the hips is said only in the sentence for screen readers. A tester cannot see either. If the pull-on check matters to testers, it needs a visible line, which needs the fit engine to own the verdict (proposal in §1).
- The 2D garment drawing itself barely changes between sizes for loose-cut points (an A-line skirt hangs the same from the drawing's point of view); only the waist strain and the rings change.
- "Room" on a ring is garment minus body girth (total ease), so a "Good fit" can show 5 cm room; testers may expect 0. The list beside the figure counts room *relative to the designed ease* instead ("3.2 cm less room than designed" next to a ring chip "Snug / 1 cm room" for the same point, seen in the demo:e2e screenshot). Both come from the same engine numbers, but two "room" figures on one screen may confuse; watch for it and pick one wording after the test.
- The engine's confidence on the result card is low for these inputs (22-30%); that is the engine's existing true-to-size handling, unchanged here.
- No real Android phone was used. Screenshots are Chromium at a 390 px viewport.
