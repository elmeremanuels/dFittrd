# @curtain/fit-engine

Pure, deterministic fit scoring and size recommendation (handoff §4.1–4.2, `docs/research/fit-engine-spec.md`, decisions D5 and D8). Runs **on-device**; the result never leaves the device (AGENTS.md rule 4).

- Zero runtime dependencies. Only **types** are imported from `@curtain/schema` (`GarmentPayload`, `SizeRow`, `UserBody`, `FitPoint`, `BodyProfile`); the build guard `scripts/check-no-runtime-imports.mjs` and an ESLint rule enforce it.
- Pure: no I/O, no `Date`, inputs are never mutated (tests deep-freeze them).
- Numbers: gaps rounded to 0.1 cm, scores and confidence to 3 dp.

## Run

```sh
pnpm --filter @curtain/fit-engine typecheck
pnpm --filter @curtain/fit-engine test      # T1–T17 spec vectors, property/purity tests, sigma extension, garment tape (pull-on)
pnpm --filter @curtain/fit-engine build     # tsup → dist/index.{js,cjs,d.ts} + no-runtime-import guard
pnpm --filter @curtain/fit-engine lint
```

## Public API

```ts
import {
  computeFit, recommendSize,             // the engine
  fitSummary, fitGapsForRender,          // UI / Path B renderer helpers
  anchorGaps, FIT_POINT_ANCHORS,         // the same gaps keyed by D15 anchor id (3D viewer)
  sigmaFromBodyProfile,                  // D5: per-point sigma from the on-device BodyProfile
  bandFor, bandForWithSigma, parseSizingNotes, easeTargetFor, footLengthFromEu,
  easeTable, CATEGORY_EASE, BLOCKS, CATEGORY_POINTS, POINTS, ZONE_POINTS, blockRule,
  type FitResult, type SizeFit, type PointFit, type OmittedPoint, type SkippedPoint,
  type FitGarment, type ComputeFitOptions, type PointSigma, type Band, type TieBreak,
  type RenderGaps, type SizeRecommendation, type BandEdges, type BandProbabilities,
} from '@curtain/fit-engine';
```

### `computeFit(garment, user, opts?) → FitResult`

- `garment: FitGarment` — any `GarmentPayload` (or a draft that has `category`, `patternBlock`, `fabric.stretchPct` and `sizeChart`). Read fields: `id, brand, category, patternBlock, fabric.stretchPct, ease, sizeChart, sizeChartType, sizingNotes, trueToSizeScore, criticalFitPoints, stretchZones`, and the optional `closure` and `garmentTape` (see *Garment tape*). `sizeChartType` defaults to `'garment'` when absent; `trueToSizeScore` to 0.8.
- `user: UserBody` from `@curtain/schema` (`toUserBody(bodyProfile)` in the capture pipeline). Confidence defaults to 0.8 per point.
- `opts.sigma?: Partial<Record<Point, number>>` — see *Sigma-aware extension*. `opts.now` is accepted (spec signature) and ignored.

`FitResult` (defined in this package — it is not a wire type):

```ts
interface FitResult {
  recommendedSize: string | null;  // null when nothing fits (best < 0.3); chart[0] when no fit points
  closestSize: string | null;      // always set when the chart is non-empty; = recommendedSize when one exists
  score: number | null;            // score of closestSize, 0..1
  confidence: number;              // 0..1
  fits: boolean;                   // recommendedSize !== null && that size is wearable
  perSize: SizeFit[];              // chart order; points in FIT_POINTS order
  notes: string[];                 // English, exact spec order
  tieBreak: 'sizingNotes' | 'history' | 'closest-ease' | null;
  skippedPoints: { point; reason: 'pattern-block'; label }[];
}
```

`PointFit` carries the spec fields (`point, gapCm, band, score, weight, critical, confidence, easeTarget, inZone`) plus `chartCm`, `bodyCm`, `tightLimit`, and — only when a sigma was given — `sigma` and `bandProbabilities`.

### Other exports

- `recommendSize(garment, user, opts?)` → `{ recommendedSize, closestSize, score, confidence, fits, tieBreak }`.
- `fitSummary(result)` → one sentence for the UI, always marked *estimate* with the confidence, e.g. `Size M fits you well (estimate, 84% confidence).`, `Size L should fit — roomy at the bust (estimate, 65% confidence).`, `No size fits well — the closest is L, tight at the bust (estimate).`
- `fitGapsForRender(result, size?)` → `{ size, gaps, bands, easeTargets, slackCm } | null` for the Path B renderer (D4: per-point ease from the fit result). `slackCm = gapCm + easeTarget` = garment − body in cm. Defaults to the recommended size, else the closest.
- `anchorGaps(result, size?)` → the same numbers as `fitGapsForRender`, keyed by D15 anchor id (`bust` → `chest`, `shoulder` → `shoulder_width`; `foot` dropped). The shoulder gap is a width across the back, so it is keyed by the breadth `shoulder_width`, never the `shoulder` ring, which is a girth (R1), for the 3D viewer. It has no maths of its own (ENGINE-HANDOFF rule 4); `FIT_POINT_ANCHORS` mirrors `FIT_POINT_TO_ANCHOR` in `@curtain/anchors` (a test keeps them equal, the engine keeps zero dependencies).
- `TAPE_TUNING`, `pullOnCheck(stretched, bodyHipCm, tuning?)`, `elasticWaistReading(…)`, `elasticCloseness(…)`, and `opts.tapeTuning` (overrides for sensitivity runs; production callers leave it out): see *Garment tape*.
- `FitResult.closestIndex` is the row of `closestSize` in `perSize`. The helpers read that row through the index, and any other label only when it is unique, so duplicate size labels in an unvalidated chart can never pick the wrong row (finding #2; the schema rejects duplicates).
- `sigmaFromBodyProfile(profile)` → per-point sigma (cm) from a `BodyProfile` (foot: `footLengthCm` sigma, else `footEu` sigma × 2/3).
- `bandFor(gap, edges)` / `bandForWithSigma(gap, sigma, edges)` → `{ band, score }` (+ `probabilities`).
- `parseSizingNotes(text)` → `-1 | 0 | 1` (contradictory notes → 0).
- `easeTargetFor(garment, point, user?)` → designed ease `E0` after the resolution order `garment.ease → BLOCKS → CATEGORY_EASE`.
- `easeTable` (= `CATEGORY_EASE`), `BLOCKS`, `CATEGORY_POINTS`, `POINTS`, `ZONE_POINTS` — the spec tables. `CATEGORY_POINTS`/`POINTS` mirror `@curtain/schema` and a test keeps them in sync.

### Typical use (capture pipeline → engine → render)

```ts
import { toUserBody } from '@curtain/schema';
import { computeFit, fitSummary, fitGapsForRender, sigmaFromBodyProfile } from '@curtain/fit-engine';

const user = toUserBody(bodyProfile);
const result = computeFit(garment, user, { sigma: sigmaFromBodyProfile(bodyProfile) });
fitSummary(result);                 // "Size M fits you well (estimate, 84% confidence)."
fitGapsForRender(result);           // { size: 'M', gaps: { bust: 4.3, … }, … } → Path B warp
```

## Algorithm (spec summary)

1. **Applicable points** = `CATEGORY_POINTS[category] ∪ criticalFitPoints`; pattern-block skips remove a point only if the merchant did not mark it critical.
2. **Ease target** `E0 = garment.ease[p] ?? BLOCKS[block].ease[p] ?? CATEGORY_EASE[category][p]` (undefined → point omitted `'chart'`). Body charts: `chartVal = row[p] + E0`. Foot: `footLengthCm ?? (footEu − 2) × 2/3`; shoe ease 0.7 only when the user supplied a foot length.
3. **Stretch**: `E = round1(E0 × max(0, 1 − stretch/40))`, `T = max(−12, −(2 + 0.25·stretch))`, `snugOk = block.snugOk || stretch ≥ 15`; stretch zones shift `T −4` and both upper edges `+4`. Slack `{good 2, loose 4}` (shoes `{0.5, 1.0}`).
4. **Band**: `gap = round1(chartVal − (userVal + E))` → tight 0 / snug 0.7 (1.0 if snugOk) / good 1 / roomy 0.6 / loose 0.2 (0 beyond `E + loose + 4`).
5. **Score**: weights `(critical ? 2 : 1) × confidence`, weighted mean, then ×0.5 (critical) or ×0.75 per tight/loose point. Wearable = no tight point and score ≥ 0.4.
6. **Recommendation**: best < 0.3 → nothing fits (closest = smallest mean |gap|). Otherwise candidates within `δ = 0.05 + 0.15·(1 − tts)` of the best, restricted to wearable sizes when any candidate is wearable; tie-break by `sizingNotes` bias → kept history for the same brand → smallest mean |gap| (lower index). `confidence = meanConf × (0.6 + 0.4·tts) × used/applicableAfterSkips`.

## Sigma-aware extension (decision D5)

`opts.sigma[p]` (cm, from `sigmaFromBodyProfile`) treats the true gap as `N(gap, σ²)`. Each band gets a probability mass (`bandProbabilities`), the point score becomes the **expected** band score, the reported `band` is the most probable one, and the tight/loose penalty is applied softly: `× (1 − (1 − m)·P(tight ∪ loose))`. With no sigma, or sigma 0, the one-hot distribution reproduces the deterministic spec **exactly** (asserted by `sigma.test.ts`). Notes, wearability and Σ|gap| use the point estimate / most probable band.

## Garment tape: the pull-on check and the band waist reading

Optional garment data (`@curtain/schema` `closure`, `garmentTape`; `docs/MERCHANT-MEASUREMENTS.md`). **A garment without it gives exactly the result it gave before**: no new key, no changed number (`pullOn.test.ts` compares the serialised results of every fixture). The code is in `src/pullOn.ts`; the numbers are in `TAPE_TUNING`.

### Pull-on check

Runs when `closure === 'pull-on'`, the category is `bottom`, the size has a stretched waistband value and the user has a hip measurement.

`marginCm = stretched band − body hip`, per size, in `SizeFit.pullOn` (`status`, `marginCm`, `bandStretchedCm`, `bodyHipCm`, `allowanceCm`, `provenance`).

| margin | status | effect |
|---|---|---|
| below −2.5 cm (below 0 cm when the band value is extrapolated) | `blocked` | `wearable: false`; the size never competes for the recommendation; its reason is in `pullOn` and, for the nearest blocked size below the chosen one, in `notes` |
| −2.5 cm (0 cm when extrapolated) up to +2.5 cm | `marginal` | still recommended; a warning in `notes` and in `fitSummary` |
| +2.5 cm and more | `clear` | none |

Among sizes that fit equally well (the tie band), one whose band reaches the hips (margin ≥ 0) wins over one that is short within the allowance. When every size is blocked nothing is recommended and `closestSize` is the least short one.

**Which body girth, and why.** The user's `hip`: the fullest girth of the seat, the same quantity as the hip column of a body chart. It is the only girth of the lower body a `UserBody` carries, and the only one the shop's sizes can be checked against. The spike's second reading, the widest convex hull between the band and the crotch, is about 2 cm larger, but it is a property of one posed mesh, the engine has no such number for a shopper, and it says every size misses its own chart body, which a shop's sizes do not do.

**Why these margins.** Measured on the pilot skirt: the stretched band is 94 / 100 / 110 cm in AU 8 / 10 / 14 and the chart hip is 94 / 99 / 109. Every measured size clears its own chart body by 0 to 1 cm, one size down is 4 to 6 cm short, one size up clears by 5 to 6 cm. So:

- Zero cannot be the block line: with it, a body 1 mm over the chart hip could not wear the size made for it. The allowance is 2.5 cm, half of the chart's 5 cm hip step: a body within half a size of the chart body is treated like the chart body, a body a whole size up is blocked.
- The warning line is the same distance on the other side (+2.5 cm). On this skirt that means **every size carries the warning on its own chart body**, because that is what the tape says: the band has 0 to 1 cm to spare.
- An extrapolated band value gets **no allowance**: it has to reach the hips on paper (margin ≥ 0) or the size is blocked. Uncertainty narrows what is offered. The evidence, signed (filled minus measured, `packages/schema/src/garmentTape.test.ts`): leaving AU 14 out of the pilot data and extrapolating it back gives 112 against a measured 110 (**+2 cm**), AU 8 gives 95 against 94 (**+1 cm**). Both overstate the band, which is the unsafe side for this check. The measured slope also falls, from 1.2 cm of band per cm of chart waist (AU 8 to 10) to 1.0 (AU 10 to 14), and AU 16 = 115 continues the 1.0, so it is more likely too long than too short. Interpolating AU 10 gives 99.3 against 100 (**−0.7 cm**, the safe side), so an interpolated value keeps the 2.5 cm. That is three cases on one garment, not a calibration. The first version of this rule went the other way (2.5 cm *more* tolerance for an extrapolated band) and told a body with a 120 cm hip "Size 16 should fit" on a guessed band 5 cm short; `pullOn.test.ts` pins that body to "no size". `tapeTuning.pullOnExtrapolatedAllowanceCm` can raise the 0 but never above `pullOnAllowanceCm`.

**What is assumed.** The stretch a shop calls comfortable is not a hard limit: the band goes further, hips give, and a skirt can go on over the head. None of that is measured, so "blocked" means "short by more than 2.5 cm at the stretch the shop measured" (or "short at all, on a band nobody measured"), not "physically impossible". The 2.5 cm is half a chart hip step, a choice; nobody measured how far a band goes beyond the stretch a shop calls comfortable. The margins come from one garment with three measured sizes. The pilot skirt's closure (pull-on, no zip, no drawstring) is the founder's answer of 15 November 2026 and is **not yet confirmed with the shop**; the depth at which the shop measured the hip is unknown. Everything in the tables below depends on the closure being pull-on. The check uses the point estimate of the hip; a `sigma` for the hip does not soften it, so a hip of 102.4 against 102.6 flips a 100 cm band between offered and blocked. A probabilistic block line would be one more rule without evidence; a surface that holds an estimated hip should ask for the measurement instead (the embed does, see *Strings*).

**What the before/after shows, and what it does not.** The held-out body (73.5 / 100) moves from AU 12 to AU 10. That is a *change*, not a demonstrated improvement: the body is the spike's simulated mannequin, nobody tried the skirt on, and there is no ground truth for which size it wears. AU 10's band has 0 cm to spare over its hips (warned); AU 12's clears by 5 cm. The move comes from the closest-ease scaling (`elasticCloseness`) with `easyStretchShare 0.5`, and that scaling was introduced to keep the AU 14 chart body on AU 14, so it was tuned on the same five chart bodies the table reports. What the tape adds that does not depend on those choices: sizes whose measured band is 4 cm or more short of the hips are no longer offered.

**Sensitivity** on the pilot skirt, 54 bodies (hip 88 to 122 in steps of 2, waist = hip − 31.5 / 26.5 / 21.5). `node packages/fit-engine/scripts/pilot-skirt-grid.mjs` prints this and the full before/after grid:

| Setting | Recommendation differs from the engine without tape | differs from the default | no size recommended | recommended size carries the warning |
|---|---|---|---|---|
| default | 18 | 0 | 14 | 17 |
| allowance 0 cm | 19 | 1 | 14 | 16 |
| allowance 1 cm | 19 | 1 | 14 | 16 |
| allowance 4 cm | 18 | 0 | 14 | 17 |
| allowance 5 cm | 18 | 0 | 14 | 17 |
| allowance 7.5 cm | 19 | 3 | 11 | 20 |
| warning below 0 cm | 18 | 0 | 14 | 1 |
| warning below 1 cm | 18 | 0 | 14 | 6 |
| warning below 5 cm | 18 | 0 | 14 | 27 |
| extrapolated allowance 1 cm or 2.5 cm | 17 | 3 | 11 | 20 |
| no preference for a passing band | 16 | 4 | 14 | 21 |
| easy stretch share 0.25 / 0.75 / 1 | 16 / 20 / 20 | 2 / 2 / 2 | 14 | 16 / 18 / 18 |

Of the 14 bodies without a size, 3 had none under the first version of the rule (hip 122). 9 are the hips of 116, 118 and 120 cm: AU 16's band is a guess of 115 cm and is no longer offered when it is short; these shoppers were told "Size 16" before (6 of them also by the engine without tape). 2 are the curviest small bodies (hip 88 and 90, waist 56.5 and 58.5): AU 8's relaxed band is 10.5 and 8.5 cm longer than the waist, past the 8 cm loose line (below). Whether "no size" or "Size 16, with a warning" is the better answer for a 116 to 120 cm hip is a product decision; measuring AU 16 settles it.

The recommendation is stable for an allowance between 0 and 5 cm (0 or 1 of 54 bodies change). The warning line changes only how many shoppers see the warning, never the size.

### Waist read from the band

Runs for the waist point of a size whose tape row has both band values with `stretched > relaxed`, whatever the closure. It replaces chart waist + ease for that size:

- Before: `gap = (chart waist + E0) − (body waist + E)`, with the block's ease and the tight limit from the fabric stretch.
- Now: `gap = relaxed band − body waist` (negative = the band is stretched by that much), ease target 0. With `R = stretched − relaxed`:

| body waist | band |
|---|---|
| above `stretched` | tight |
| from `relaxed + R/2` to `stretched` | snug |
| from `relaxed − good` to `relaxed + R/2` | good |
| down to `relaxed − loose` | roomy |
| below that | loose |

`good` and `loose` are the slacks the point already had (2 and 4 cm, plus 4 in a declared stretch zone), with or without a known hip. A first version widened `loose` to `hip − waist` when the hip was known, on the assumption that a long band settles lower and is merely roomy; with it a 60 cm waist read "roomy" and wearable in every size up to AU 16 (24.5 cm of slack), and the engine has no field for where a garment sits, so it was removed. The band and score come from the same `bandFor` / `bandForWithSigma`, on the gap shifted by `R/2`, so `sigma` works as on any point. `PointFit` reports `chartCm = relaxed`, `easeTarget = 0`, `tightLimit = −R` and `elasticBand: { relaxedCm, stretchedCm, provenance }`; `slackCm` in `fitGapsForRender` is then `relaxed − body`.

For the closest-ease tie-break a band reading does not count by |gap|: slack counts in full, stretch is scaled so that the end of the easy half of the range is as far as the end of `good` on the slack side (`elasticCloseness`). Without this the tie-break would prefer a band 2 cm too long over one stretched by 2.5 cm, and the pilot's AU 14 chart body would be sent to AU 16.

**What is assumed.** The half (`easyStretchShare 0.5`) is a choice: where in its range a band stops being comfortable is not measured. The body waist is the natural waist, the only waist a `UserBody` has. A band worn lower (the founder's rule for these skirts: just below the navel) meets a larger girth, roughly 10 to 13.5 cm more than the chart waist on the spike's bodies (§9.2, at an assumed level), so the true stretch is larger than `gap` says and "roomy" is too cautious for such a garment. The schema has no field for where a garment sits; until it has, the tight side of this reading is weak and the pull-on check carries the size decision. A size without band values keeps the chart reading, so one result can mix both readings.

### Provenance

Every tape value is `measured`, `interpolated` or `extrapolated`, and the engine passes it on: `SizeFit.pullOn.provenance`, `PointFit.elasticBand.provenance`, and `FitResult.tapeProvenance`, the worst provenance among the tape values the result for `closestSize` rests on. `confidence` is multiplied by 1 / 0.9 / 0.7 for measured / interpolated / extrapolated (ordinal choices, not calibrated), and `notes` says "was not measured by the shop" for the other two. A surface must not print a margin of an unmeasured size without that label. `FitResult.pullOnUnchecked` is `true` when the garment has a pull-on check that could not run because the user gave no hip.

### Strings

`notes` and `fitSummary` are English sentences written in the engine, as they were before the tape; the tape sentences are in one internal table (`TAPE_NOTES` in `pullOn.ts`, not exported from the package). They are **not** in a D21 catalogue, and a translation pack cannot replace them. They reach a shopper only where a surface prints the engine's `notes` or `fitSummary` as they are: the consumer app's fit panel and try screen (`apps/web/src/components/FitPanel.tsx`, `routes/TryRoute.tsx`), which `docs/i18n/README.md` lists under "not in a catalogue yet" together with the rest of the engine's sentences.

The embed, the surface shops ship, never prints them. It writes its own notes from the structured fields in its catalogue (`apps/web/src/embed/strings/en.ts`, `fit.notes.pullOnTight`, `pullOnNone`, `pullOnUnchecked`, `tapeEstimated`; `embedNoteList` in `aboutYou.ts`): a size whose band only just passes the hips never reads "fits you well", a size whose band was not measured by the shop always carries that label, no margin in cm is printed, and a pull-on check that ran on an estimated hip asks for the measurement (`apps/web/src/embed/__tests__/aboutYou.test.ts`). Merchants now enter the tape and the closure in the Shopify admin's and the WooCommerce meta box's "Garment measurements" form (`@curtain/schema` `checkGarmentTapeInput`); the api stores them in the payload, `GET /v1/try/:token` hands them to the embed with the rest of the garment, and the embed passes the payload to `computeFit` on the device. The demo seeds the pilot skirt with the shop's tape (AU 8, 10, 14) and `closure: 'pull-on'`, and `pnpm demo:e2e` checks in a browser that the held-out body (waist 73.5, hip 100, typed in) gets Size 10 with the pull-on warning, and that the "Compare sizes" chip of AU 8 (band 6 cm short) shows "too small to pull on" instead of a fit score (`ResultScreen.tsx`, `fit.compareNoPullOn`). The recommended AU 10, whose band only just passes, shows "Only just pulls on" in place of the fit score and on its chip (`fit.scorePullOnTight`, `compareJustPullsOn`), and when the shop page holds AU 8 the result says its waistband does not stretch over the hips (`fit.onPageNoPullOn`). The engine's own `score` is unchanged (0.999 for AU 8, 1.0 for AU 10 on that body): the embed hides it where it contradicts the pull-on check. The waist card ("Good fit", the waist against the chart) and the figure label ("Good fit by the size chart") still describe the waist as worn, not the pull-on.

## Men's fit (men-3d-plan slices M2a and M2b)

Switched on only by `audience: 'men'`, or `audience: 'unisex'` with `opts.bodyFamily: 'male'`. Every
other payload is computed exactly as before: `src/mens.test.ts` (MT3) pins sha256 of `computeFit` over
every existing fixture × 10 bodies, with and without sigma, against the engine before M2.

| What | Value | Where it comes from |
|---|---|---|
| Points, tops | chest, waist, shoulder (seat not scored); neck, sleeve, body `length` when the chart has the column | plan §4 |
| Points, bottoms | waist (at the worn height), seat, thigh, inseam as a length | plan §4 |
| Eases | `MENS_BLOCKS` (tee 8/8/1, knit 10/10/1.5, shirt slim/tailored/classic, chino and jeans slim/regular) | plan §4 table: shirt chest 21.5 / 26 [S] Paul Fredrick (one retailer); all other values [A] |
| `shirt` block | read as tailored | [A] the middle of the three |
| Garment shoulder | seam to seam − 3.5 against biacromial | [A, M] plan §4 |
| Garment inseam | against inside leg − 3 | [A] plan §4 |
| Length bands | ±2 good (1.0), ±4 short / long (0.6), beyond fails (0, not wearable); no stretch | [A] plan §4 |
| Neck | tight < −1, snug −1..0, good 0..1, roomy 1..2; default ease 1.5 | [A] plan §4 |
| Worn waist | natural waist → seat, front rise 30 cm or more at the waist, 18 or less at the seat | [A, M] assumed here, no source read |
| Body length | target 0.41 × stature (`UserBody.heightCm`) | [A] no source read |
| Sleeve | needs `sleeveConvention`; `centre_back` adds half the shoulders | plan §4; MT12 |
| W/L | rows with `axes`: waist axis and leg axis each picked by the one-dimensional rules | plan §4 |
| Belly-aware chest | in the smallest size whose waist is not tight, the chest's upper bands widen by (chest gap − waist gap); `FitResult.waistLed` and a note | ours, no constant |

Known: the bands still put "good" up to E + 2 cm over the target (spec §Step 4), so with shirt eases of
21.5 to 26 cm three body-chart sizes read good and closest-ease decides. The M1 tee's shoulder
(biacromial + 3.5) and the tee shoulder ease 1 disagree by 1 cm: MREF reads "Snug at the shoulders" in M.

## Spec deviations

Two test vectors in `fit-engine-spec.md` contain arithmetic that contradicts the spec's own rules; the tests assert the rule-correct behaviour and additionally pin the spec's literal fixture so the discrepancy stays visible.

- **T9** — "same as T8 but M bust 93 (score 0.9)". With a body chart and `ease.bust 6`, M bust 93 gives `gap = (93 + 6) − (86 + 6) = 7 ≤ E + 2 = 8` → still *good*, score 1, so the tie band is never exercised. The test instead uses **M waist 75** (`gap 7 > E + 2 = 6` → roomy), giving M score **0.92**: at tts 0.92 (δ 0.062) only S is a candidate (tieBreak `null`), at tts 0.5 (δ 0.125) both are and 'runs small' picks M.
- **T17** — "use waist 76, gap −7.8: tight without zone, snug with zone". The zone tight limit is `T = −2.5 − 4 = −6.5` (the spec says so itself), and −7.8 < −6.5 is still tight. The test uses **waist 74 (gap −5.8)**: tight without the zone, snug with it; it also asserts that waist 76 and 78 stay tight in both cases.

Two further deviations were introduced by the 2026-11-04 review (regressions in `review.test.ts`):

- **Wearable sizes win the tie band.** The spec's tie-break (sizing notes → kept history → closest ease) runs over every size within `δ` of the best score. That could hand the user a size with a *tight* point (handoff §4.1: bad fit) because its Σ|gap| was smaller than a wearable, slightly roomier size inside the same band. Now, when the band holds both wearable and unwearable sizes, only the wearable ones compete; when none is wearable the tie-break runs as the spec says. All seventeen spec vectors are unaffected (their candidates are always wearable).
- **Closeness is mean |gap|, not Σ|gap|.** Identical ordering whenever every size uses the same points (the spec's case); it only differs when a chart row lists fewer points, which under Σ|gap| looked "closer" merely for having fewer gaps to add up.

Other interpretations worth knowing (spec silent):

- `T10` expects confidence 0.581 and only the hips note, which holds when REF's measurements are used **without** its confidence map (as in T2); the test does that.
- A chart-omitted point (`'chart'`) counts in `applicablePointsAfterSkips` (T3, T4 confirm: ratio 2/3) but produces no note; a user-omitted point produces the "We don't have your … measurement yet" note.
- Non-finite, zero or negative measurement/chart values mean "not provided". Unknown categories give no points; unknown pattern blocks/zones/critical points are ignored.
- Both tie-break history keys (`brand`, `size`) are compared case-insensitively after trimming.
- If the weighted sum of confidences is 0, the size score falls back to the plain mean of the point scores (never NaN).
- Shoes with a `'body'` chart also get `+E0` normalisation (E0 = 0 for a `footEu` user, 0.7 for a foot-length user).
