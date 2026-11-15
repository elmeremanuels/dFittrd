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
- `TAPE_TUNING`, `TAPE_NOTES`, `pullOnCheck(stretched, bodyHipCm, tuning?)`, `elasticWaistReading(…)`, `elasticCloseness(…)`, and `opts.tapeTuning` (overrides for sensitivity runs; production callers leave it out): see *Garment tape*.
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
| below −2.5 cm (−5 cm when the band value is extrapolated) | `blocked` | `wearable: false`; the size never competes for the recommendation; its reason is in `pullOn` and, for the nearest blocked size below the chosen one, in `notes` |
| −2.5 cm up to +2.5 cm | `marginal` | still recommended; a warning in `notes` and in `fitSummary` |
| +2.5 cm and more | `clear` | none |

Among sizes that fit equally well (the tie band), one whose band reaches the hips (margin ≥ 0) wins over one that is short within the allowance. When every size is blocked nothing is recommended and `closestSize` is the least short one.

**Which body girth, and why.** The user's `hip`: the fullest girth of the seat, the same quantity as the hip column of a body chart. It is the only girth of the lower body a `UserBody` carries, and the only one the shop's sizes can be checked against. The spike's second reading, the widest convex hull between the band and the crotch, is about 2 cm larger, but it is a property of one posed mesh, the engine has no such number for a shopper, and it says every size misses its own chart body, which a shop's sizes do not do.

**Why these margins.** Measured on the pilot skirt: the stretched band is 94 / 100 / 110 cm in AU 8 / 10 / 14 and the chart hip is 94 / 99 / 109. Every measured size clears its own chart body by 0 to 1 cm, one size down is 4 to 6 cm short, one size up clears by 5 to 6 cm. So:

- Zero cannot be the block line: with it, a body 1 mm over the chart hip could not wear the size made for it. The allowance is 2.5 cm, half of the chart's 5 cm hip step: a body within half a size of the chart body is treated like the chart body, a body a whole size up is blocked.
- The warning line is the same distance on the other side (+2.5 cm). On this skirt that means **every size carries the warning on its own chart body**, because that is what the tape says: the band has 0 to 1 cm to spare.
- An extrapolated band value gets 2.5 cm more before it blocks. Leaving a measured size out of the pilot data and extrapolating it back misses the measured stretched band by 1 cm (AU 8) and 2 cm (AU 14); interpolating AU 10 misses by 0.7 cm (`packages/schema/src/garmentTape.test.ts`). That is two cases, not a calibration.

**What is assumed.** The stretch a shop calls comfortable is not a hard limit: the band goes further, hips give, and a skirt can go on over the head. None of that is measured, so "blocked" means "short by more than 2.5 cm at the stretch the shop measured", not "physically impossible". The margins come from one garment. The check uses the point estimate of the hip; a `sigma` for the hip does not soften it.

**Sensitivity** on the pilot skirt, 54 bodies (hip 88 to 122 in steps of 2, waist = hip − 31.5 / 26.5 / 21.5). `node packages/fit-engine/scripts/pilot-skirt-grid.mjs` prints this and the full before/after grid:

| Setting | Recommendation differs from the engine without tape | differs from the default | no size recommended | recommended size carries the warning |
|---|---|---|---|---|
| default | 15 | 0 | 3 | 26 |
| allowance 0 cm | 18 | 7 | 9 | 19 |
| allowance 1 cm | 17 | 4 | 6 | 22 |
| allowance 4 cm | 15 | 0 | 3 | 26 |
| allowance 5 cm | 16 | 3 | 0 | 29 |
| warning below 0 cm | 15 | 0 | 3 | 10 |
| warning below 1 cm | 15 | 0 | 3 | 15 |
| warning below 5 cm | 15 | 0 | 3 | 37 |
| extrapolated extra 0 cm | 17 | 6 | 9 | 20 |
| extrapolated extra 5 cm | 16 | 3 | 0 | 29 |
| no preference for a passing band | 13 | 4 | 3 | 30 |
| easy stretch share 0.25 / 0.75 / 1 | 13 / 17 / 17 | 2 / 2 / 2 | 3 | 25 / 27 / 27 |

The recommendation is stable for an allowance between 2.5 and 4 cm. The warning line changes only how many shoppers see the warning, never the size.

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

`good` and `loose` are the slacks the point already had (2 and 4 cm, plus 4 in a declared stretch zone). When the user's hip is known, `loose` is at least `hip − waist`: a band longer than the natural waist is not loose until it is as long as the hips; until then it settles lower and reads roomy. The band and score come from the same `bandFor` / `bandForWithSigma`, on the gap shifted by `R/2`, so `sigma` works as on any point. `PointFit` reports `chartCm = relaxed`, `easeTarget = 0`, `tightLimit = −R` and `elasticBand: { relaxedCm, stretchedCm, provenance }`; `slackCm` in `fitGapsForRender` is then `relaxed − body`.

For the closest-ease tie-break a band reading does not count by |gap|: slack counts in full, stretch is scaled so that the end of the easy half of the range is as far as the end of `good` on the slack side (`elasticCloseness`). Without this the tie-break would prefer a band 2 cm too long over one stretched by 2.5 cm, and the pilot's AU 14 chart body would be sent to AU 16.

**What is assumed.** The half (`easyStretchShare 0.5`) is a choice: where in its range a band stops being comfortable is not measured. The body waist is the natural waist, the only waist a `UserBody` has. A band worn lower (the founder's rule for these skirts: just below the navel) meets a larger girth, roughly 10 to 13.5 cm more than the chart waist on the spike's bodies (§9.2, at an assumed level), so the true stretch is larger than `gap` says and "roomy" is too cautious for such a garment. The schema has no field for where a garment sits; until it has, the tight side of this reading is weak and the pull-on check carries the size decision. A size without band values keeps the chart reading, so one result can mix both readings.

### Provenance

Every tape value is `measured`, `interpolated` or `extrapolated`, and the engine passes it on: `SizeFit.pullOn.provenance`, `PointFit.elasticBand.provenance`, and `FitResult.tapeProvenance`, the worst provenance among the tape values the result for `closestSize` rests on. `confidence` is multiplied by 1 / 0.9 / 0.7 for measured / interpolated / extrapolated (ordinal choices, not calibrated), and `notes` says "was not measured by the shop" for the other two. A surface must not print a margin of an unmeasured size without that label.

### Strings

`notes` and `fitSummary` are English, as before; the new sentences are in one table, `TAPE_NOTES`. A surface with its own catalogue (D21) writes its text from the structured fields instead.

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
