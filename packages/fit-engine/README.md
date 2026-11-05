# @curtain/fit-engine

Pure, deterministic fit scoring and size recommendation (handoff §4.1–4.2, `docs/research/fit-engine-spec.md`, decisions D5 and D8). Runs **on-device**; the result never leaves the device (AGENTS.md rule 4).

- Zero runtime dependencies. Only **types** are imported from `@curtain/schema` (`GarmentPayload`, `SizeRow`, `UserBody`, `FitPoint`, `BodyProfile`); the build guard `scripts/check-no-runtime-imports.mjs` and an ESLint rule enforce it.
- Pure: no I/O, no `Date`, inputs are never mutated (tests deep-freeze them).
- Numbers: gaps rounded to 0.1 cm, scores and confidence to 3 dp.

## Run

```sh
pnpm --filter @curtain/fit-engine typecheck
pnpm --filter @curtain/fit-engine test      # T1–T17 spec vectors, property/purity tests, sigma extension
pnpm --filter @curtain/fit-engine build     # tsup → dist/index.{js,cjs,d.ts} + no-runtime-import guard
pnpm --filter @curtain/fit-engine lint
```

## Public API

```ts
import {
  computeFit, recommendSize,             // the engine
  fitSummary, fitGapsForRender,          // UI / Path B renderer helpers
  sigmaFromBodyProfile,                  // D5: per-point sigma from the on-device BodyProfile
  bandFor, bandForWithSigma, parseSizingNotes, easeTargetFor, footLengthFromEu,
  easeTable, CATEGORY_EASE, BLOCKS, CATEGORY_POINTS, POINTS, ZONE_POINTS, blockRule,
  type FitResult, type SizeFit, type PointFit, type OmittedPoint, type SkippedPoint,
  type FitGarment, type ComputeFitOptions, type PointSigma, type Band, type TieBreak,
  type RenderGaps, type SizeRecommendation, type BandEdges, type BandProbabilities,
} from '@curtain/fit-engine';
```

### `computeFit(garment, user, opts?) → FitResult`

- `garment: FitGarment` — any `GarmentPayload` (or a draft that has `category`, `patternBlock`, `fabric.stretchPct` and `sizeChart`). Read fields: `id, brand, category, patternBlock, fabric.stretchPct, ease, sizeChart, sizeChartType, sizingNotes, trueToSizeScore, criticalFitPoints, stretchZones`. `sizeChartType` defaults to `'garment'` when absent; `trueToSizeScore` to 0.8.
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
