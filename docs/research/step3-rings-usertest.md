# Step 3, route R5 mock: size rings user test

**Date:** 10 Nov 2026. **Plan:** `docs/research/shortcut-to-step3.md` §4, days 3-5 ("R5 mock: AU 8/12/16 ring outlines plus neighbour ghost in AvatarView; test with 5 users"). **Go/no-go question:** do users pick a size and say why?

## 1. What the mock shows

On the result screen of the `/embed` flow ("How it fits" tab), over the existing 2D figure:

- **Rings** for the size on screen at bust (tops and dresses), waist, hips and hem. A ring's width comes from the garment girth by the same rule the body outline uses, so a ring smaller than the body sits *inside* the outline (it cuts in) and a roomy ring stands off it.
- **A chip per ring** in words and numbers: "Tight / 6 cm short", "Good fit / 5 cm room", "Loose / 15 cm room", "Not checked / 7 cm room" (the fit engine does not score that point for this cut, e.g. an A-line hip), "Hem / 200 cm assumed". Colour is never the only signal; screen readers get one sentence per ring.
- **Ghost rings**: faint dashed rings of the sizes on either side, labelled with their size.
- **Legend** under the figure: which size is solid, which are ghosts, and the estimate notes. A "Hide size rings" button switches the layer off; the tight/loose look of the figure (strain marks, folds) stays either way.
- **3D view** (products with an approved bundle): the same ring numbers as a line of text under the 3D estimate. The rings are not drawn in 3D.

Every number on a ring comes from `@curtain/fit-engine`'s per-point output for that size (`chartCm`, `bodyCm`, `band`). The ring code decides no size and no band.

### What is assumed (say this to nobody in the test, but know it)

| Input | Status | Value used | Where to change it |
|---|---|---|---|
| Garment girth at bust / waist / hip | Size chart + the engine's designed ease | e.g. skirt AU 12 waist 77.5 + 3 = 80.5 cm | — |
| Pilot skirt waistband, relaxed / stretched | **ASSUMED, not measured** | size 12: 69 / 96 cm, graded ±5 cm per size with the chart | `PILOT_SKIRT_TAPE` in `apps/web/src/render/ringInputs.ts` |
| Pilot skirt hem sweep | **ASSUMED, not measured** | size 12: 200 cm, graded with the chart's hip step | same |
| Body | The tester's typed answers | — | — |

The 3D proxy's lowest graded ring (about 102 cm at size 12 in `grading.json`) is **not** used for the hem: it is narrower than the hips, which no A-line maxi is, because the generated mesh clings (REFINEMENT R3).

**To plug in the real numbers:** fill in `PILOT_SKIRT_TAPE = { sampleSize: '12', bandRelaxedCm: …, bandStretchedCm: …, hemSweepCm: … }` (any one sample size; the other sizes are graded with the chart's steps), then run `pnpm --filter @curtain/web test`. The labels then say "measured" and the rings move.

### Band sweep (assumed values; what the measurement will decide)

How far the elastic band would be stretched on each test body (body waist between the assumed relaxed and stretched girth; 0% = band at rest, 100% = fully stretched). The fit engine's word for the waist does not change with these values; only the drawn band bracket does.

| Scenario (size 12 relaxed / stretched) | Slim in AU 8 (waist 64) | Average in AU 12 (76) | Curvy in AU 16 (86) | Average in AU 8 | Curvy in AU 12 |
|---|---|---|---|---|---|
| low 64 / 88 | 54-78: 42% | 64-88: 50% | 74-98: 50% | 54-78: 92% | 64-88: 92% |
| **mid 69 / 96 (drawn)** | 59-86: 19% | 69-96: 26% | 79-106: 26% | 59-86: 63% | 69-96: 63% |
| high 74 / 104 | 64-94: 0% (band does not grip) | 74-104: 7% | 84-114: 7% | 64-94: 40% | 74-104: 40% |

Reading: under every assumed scenario the average body could physically pull on AU 8 and the curvy body AU 12, while the fit engine calls those sizes "tight" (it treats the chart's waist plus 2.9 cm ease as the target). Under "high", the slim body's AU 8 band would not grip at all. Which of these is true is exactly what the founder's tape measurement settles; until then the rings say "assumed".

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

**11-14 min, rings off.** Press "Hide size rings". "Would you still pick the same size? Is it easier or harder without the lines?" Then "Some numbers say *assumed* or *not checked*. What do you think that means? Does it change how much you trust it?"

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
| Trust in "assumed" (1-5) | 3 |
| Sure about size (1-5) | 4 |
| Rings on vs off: preference | on |

### Success criterion

**Go** for R5 as the step-3 safety net if **at least 4 of 5** testers pick a size **and** give a reason that refers to fit at a body point ("room at the waist", "tight at the bust", "the hem ring is wider"), not only "it's recommended". A size different from the engine's pick still counts if the reason is a fit reason. **No-go / redesign** if 2 or more cannot say why, or if 2 or more read the rings as the actual garment shape (e.g. "the skirt will stick out like that").

## 3. Screenshots

Made with `node apps/web/scripts/rings-shots.mjs <out>` (dev-only harness `apps/web/dev/rings.html`, real `ResultScreen`, 390 px phone viewport at 2x, Chromium; not a real phone). Files are local (the bundle payloads are git-ignored), in the session scratchpad `step3/rings/`:

| File | What it shows |
|---|---|
| `crimson-wildflower-maxi-skirt-sheet.png` | 3 x 3: rows slim / average / curvy, columns AU 8 / 12 / 16 (figure only) |
| `crimson-wildflower-maxi-skirt-average-au12.png` | Full result, average body, recommended AU 12: waist "Good fit / 5 cm room", hip "Not checked", hem "200 cm assumed", ghosts 10 and 14 |
| `crimson-wildflower-maxi-skirt-curvy-au12.png` | Curvy body looking at AU 12 (recommended 16): waist ring "Tight / 6 cm short", inside the body outline |
| `crimson-wildflower-maxi-skirt-slim-au16.png` | Slim body looking at AU 16: "Loose / 27 cm room" |
| `azure-palm-baby-doll-dress-sheet.png` | 3 x 3 for an AU 8-16 empire dress: bust ring scored, waist and hip "Not checked" (empire line) |
| `test-results/demo-e2e/shopify-dawn-3b-size-rings-other.png` (demo:e2e) | The real embed after switching to a neighbouring size |

## 4. Known limits of the mock

- **The graded step is small on screen.** At true scale a 5 cm girth step moves a ring about 1.6 cm per side, about 1.5 mm on a phone. The ghost rings nearly overlap the solid ring; the size difference is carried by the chip text, not by the geometry. Exaggerating the rings would misstate the garment, so the test should tell us whether the text is enough.
- The 2D garment drawing itself barely changes between sizes for loose-cut points (an A-line skirt hangs the same from the drawing's point of view); only the waist strain and the rings change.
- "Room" on a ring is garment minus body girth (total ease), so a "Good fit" can show 5 cm room; testers may expect 0. The list beside the figure counts room *relative to the designed ease* instead ("3.2 cm less room than designed" next to a ring chip "Snug / 1 cm room" for the same point, seen in the demo:e2e screenshot). Both come from the same engine numbers, but two "room" figures on one screen may confuse; watch for it and pick one wording after the test.
- The engine's confidence on the result card is low for these inputs (22-30%); that is the engine's existing true-to-size handling, unchanged here.
- No real Android phone was used. Screenshots are Chromium at a 390 px viewport.
