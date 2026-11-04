# Fit engine v1 — specification and test vectors

> Implementation spec for packages/fit-engine, derived from handoff §4.1–4.2. The package tests are the test vectors below.

## Fit engine v1 — pure TypeScript spec (`src/fit/computeFit.ts`)

**Signature**: `computeFit(garment: GarmentPayload, user: UserBody, opts?: { now?: number }): FitResult` — pure, deterministic, no I/O, never mutates inputs (freeze in tests). Numbers rounded: gaps to 0.1 cm, scores/confidence to 3 dp.

### Types
```ts
type Point = 'bust'|'waist'|'hip'|'shoulder'|'thigh'|'inseam'|'foot';
type Category = 'top'|'bottom'|'dress'|'outerwear'|'shoes'|'accessory';
interface SizeRow { size: string; bust?: number; waist?: number; hip?: number; shoulder?: number; thigh?: number; inseam?: number; footEu?: number; footLengthCm?: number }
interface GarmentPayload {                      // §3.1, only the fields the engine reads
  id: string; brand: string; category: Category; patternBlock: string;
  fabric: { primary: string; stretchPct: number; drape: number };
  ease?: Partial<Record<Point, number>>;        // designed ease, garment minus body, cm
  sizeChart: SizeRow[];                         // in ascending size order
  sizeChartType?: 'garment'|'body';             // default 'garment' (handoff formula says garment_size_at_point)
  sizingNotes?: string; trueToSizeScore?: number; // default tts 0.8
  criticalFitPoints?: Point[]; stretchZones?: string[];
}
interface UserBody {
  measurements: Partial<Record<Point|'footLengthCm'|'footEu', number>>;
  confidence?: Partial<Record<Point, number>>;  // 0..1, default 0.8 (scan-only 0.6, scan+manual 0.95 per §2.1C)
  history?: { brand: string; size: string; kept: boolean }[];
}
type Band = 'tight'|'snug'|'good'|'roomy'|'loose';
interface PointFit { point: Point; gapCm: number; band: Band; score: number; weight: number; critical: boolean; confidence: number; easeTarget: number; inZone: boolean }
interface OmittedPoint { point: Point; omitted: 'chart'|'user' }
interface SizeFit { size: string; score: number|null; wearable: boolean; points: (PointFit|OmittedPoint)[] }
interface FitResult {
  recommendedSize: string|null;   // null when nothing fits (best < 0.3) or no fit points
  closestSize: string|null;       // always set when the chart is non-empty
  score: number|null;             // score of closestSize (0..1)
  confidence: number;             // 0..1
  fits: boolean;                  // recommendedSize != null && that size is wearable
  perSize: SizeFit[];             // chart order
  notes: string[];                // human text, see §Notes
  tieBreak: 'sizingNotes'|'history'|'closest-ease'|null;
  skippedPoints: { point: Point; reason: 'pattern-block'; label: string }[];
}
```

### Step 1 — applicable points
`CATEGORY_POINTS = { top: [bust,waist,hip,shoulder], dress: [bust,waist,hip,shoulder], bottom: [waist,hip,thigh,inseam], outerwear: [bust,waist,hip,shoulder], shoes: [foot], accessory: [] }`.
`applicable = union(CATEGORY_POINTS[category], criticalFitPoints)` (merchant may add e.g. `waist` for a belt).
Pattern-block skip rules remove a point **only if it is not in criticalFitPoints** (merchant authority wins) and record `{point, reason:'pattern-block', label}`.

### Step 2 — ease target table (cm, garment minus body)
Category defaults `CATEGORY_EASE`:
| category | bust | waist | hip | shoulder | thigh | inseam | foot |
|---|---|---|---|---|---|---|---|
| top | 8 | 8 | 6 | 1 | – | – | – |
| dress | 6 | 4 | 6 | 1 | – | – | – |
| bottom | – | 2 | 5 | – | 3 | 0 | – |
| outerwear | 12 | 12 | 10 | 2 | – | – | – |
| shoes | – | – | – | – | – | – | 0.7 (only when user supplies `footLengthCm`; with `footEu` ease = 0 because a shoe size is already a size) |
| accessory | none (no points unless critical) |

Pattern-block overrides `BLOCKS[patternBlock] = { ease, skip, snugOk, label }` (unknown block → `{ease:{}, skip:[], snugOk:false}`):
- `wrap`: ease {bust 6, waist 4, hip 8}
- `a-line`, `fit-and-flare`, `skater`: ease {waist 3}; skip [hip] ('A-line hem flares freely' / 'flared hem flares freely')
- `sheath`: ease {bust 4, waist 3, hip 4}; snugOk
- `bodycon`: ease {bust 2, waist 2, hip 2}; snugOk
- `column`: ease {bust 5, waist 4, hip 5}
- `empire`: skip [waist, hip] ('empire line hangs from the bust')
- `tent`, `trapeze`: ease {bust 10}; skip [waist, hip]
- `oversized`: ease {bust 14, shoulder 4}; skip [waist, hip] · `boxy`: ease {bust 12, shoulder 3}; skip [waist, hip]
- `bias`: ease {bust 4, hip 4}; skip [waist] ('bias cut skims the waist'); snugOk
- `shirt`: ease {bust 10, shoulder 1.5}; skip [waist, hip] · `t-shirt`: ease {bust 6, shoulder 1}; skip [waist, hip]; snugOk
- `straight`, `wide-leg` (hip 6): skip [thigh] ('straight leg does not grip the thigh') · `bootcut`: none · `skinny`: ease {hip 2, thigh 1}; snugOk · `slim`: ease {hip 3, thigh 2}; snugOk

Resolution order per point: `E0 = garment.ease[p] ?? BLOCKS.ease[p] ?? CATEGORY_EASE[category][p]`; if `E0` undefined the point is omitted (`'chart'`).
**Normalisation**: if `sizeChartType === 'body'`, `chartVal = row[p] + E0` (chart is the body the size is cut for). Foot: `chartVal = row.footLengthCm ?? (row.footEu-2)*2/3`; `userVal = measurements.footLengthCm ?? (measurements.footEu-2)*2/3`.

### Step 3 — stretch and zones
`stretch = fabric.stretchPct` (0..30+). `E = round1(E0 * max(0, 1 - stretch/40))` (jersey 30% → ease target quartered; ≥40% → 0).
Tight limit `T = max(-12, -(2 + 0.25*stretch))` cm. `snugOk = BLOCKS.snugOk || stretch >= 15`.
`stretchZones` map to points: `waist-tie|waistband|side-panel → waist`, `back-panel → bust`, `cuff → shoulder`, `rib-hem → hip`, `stretch-knit → all`. A point in a zone gets `T -= 4` and both upper band edges `+4`.
Band slack: default `{good: 2, loose: 4}`; shoes `{good: 0.5, loose: 1.0}`.

### Step 4 — gap and band (handoff §4.1 bands, extended)
`gap = round1(chartVal - (userVal + E))`.
| condition | band | point score |
|---|---|---|
| gap < T | tight | 0 |
| T ≤ gap < 0 | snug | 1.0 if snugOk else 0.7 |
| 0 ≤ gap ≤ E + good | good | 1.0 |
| E + good < gap ≤ E + loose | roomy | 0.6 |
| gap > E + loose | loose | 0.2 if gap ≤ E + loose + 4, else 0 |
Point omitted if chart value is undefined/0 (`'chart'`) or user value undefined/0 (`'user'`).

### Step 5 — weights and size score
`base = critical ? 2 : 1`; `conf = user.confidence[p] ?? 0.8`; `weight = base*conf`.
`avg = Σ(weight*score)/Σ(weight)`; then for every point in band tight or loose multiply `avg` by 0.5 if critical else 0.75. `score = round3(avg)`. `wearable = no tight point && score ≥ 0.4`. If no points used, `score = null`.

### Step 6 — recommendation (§4.2)
`best = max(score)`. If every size has `score === null` → `recommendedSize = sizeChart[0]?.size ?? null`, `score = null`, `confidence 0`, notes `['No fit points for this item']`.
If `best < 0.3` → nothing fits: `recommendedSize = null`, `closestSize` = size with the smallest Σ|gap| over used points (ties → lower index), `tieBreak = null`.
Else tie band `δ = 0.05 + 0.15*(1 - tts)` (tts 0.92 → 0.062; 0.5 → 0.125): `candidates = sizes with score ≥ best - δ`. If one → it. If several, in order:
1. `bias = parseSizingNotes(sizingNotes)`: `+1` for /runs? small|size up|order (a size )?up|small fit|tight fit|snug fit/i, `-1` for /runs? (large|big)|size down|order (a size )?down|generous|oversized fit|roomy fit/i, else 0. bias +1 → last candidate in chart order, −1 → first (`tieBreak:'sizingNotes'`).
2. `history`: a candidate the user `kept` from the same brand (`'history'`).
3. smallest Σ|gap|, then lower chart index (`'closest-ease'`).
`confidence = round3(meanConf(used points of chosen size) * (0.6 + 0.4*tts) * usedPoints/applicablePointsAfterSkips)`.

### Notes (English, in this order; point names bust/shoulders/waist/hips/thighs/inseam/foot)
- nothing fits: `No size fits well — closest is {size}, {band} at the {point}` (lowest-scoring point)
- per used point in order bust, shoulder, waist, hip, thigh, inseam, foot: tight → `Tight at the {p}` + ` — consider sizing up` if a larger size exists; snug → `Snug at the {p}`; roomy → `Roomy at the {p}`; loose → `Loose at the {p}` + ` — consider sizing down` if a smaller size exists; in-zone points append ` (stretch zone adjusts)`.
- per skipped point: `{Point} not checked: {label}` · per omitted-user point: `We don't have your {p} measurement yet` · per used point with confidence < 0.7: `Your {p} measurement is low-confidence — remeasure to sharpen this`
- if nothing else: `Size {size} fits you well.`

### Test vectors (vitest; fixtures as named)
Fixtures: `WRAP` = handoff §3.1 payload with chart XS 84/64/92/36, S 88/68/96/37, M 92/72/100/38, L 96/76/104/39 (bust/waist/hip/shoulder), ease {6,4,8}, `sizeChartType:'body'`, stretch 2, zones ['waist-tie'], critical [bust, shoulder], sizingNotes 'runs small', tts 0.92. `REF` = measurements {bust 88, waist 70, hip 96, shoulder 38}, confidence {0.95,0.95,0.95, shoulder 0.6}. `SLIP` = top/bias, silk stretch 0, body chart XS 80/60/88, S 84/64/92, M 88/68/96 (no shoulder), critical [bust], tts 0.8. `JEANS` = bottom/straight, denim stretch 1, body chart 26 {waist 66, hip 91}, 27 {68.5, 93.5}, 28 {71, 96}, critical [waist], tts 0.85.
1. **T1 reference body × WRAP** → `recommendedSize 'M'`, `score 1`, `confidence 0.835`, `fits true`, `tieBreak null`, `notes ['Your shoulders measurement is low-confidence — remeasure to sharpen this']`; perSize scores XS 0.113, S 0.871, M 1, L 0.848; M points: bust gap 4.3 good w1.9, waist 2.2 good w0.95 (zone), hip 4.4 good, shoulder 0 good w1.2; XS bust −3.7 tight, hip −3.6 tight.
2. **T2 same, no confidence map** → M, score 1, confidence 0.774, notes `['Size M fits you well.']`, perSize XS 0.131 / S 0.85 / M 1 / L 0.867.
3. **T3 SLIP × REF** → `M`, score 1, confidence 0.583, `skippedPoints [{waist, 'pattern-block'}]`, notes `['Waist not checked: bias cut skims the waist']`; XS and S score 0 (bust −8 / −4 tight); shoulder omitted `'chart'`. (Current engine: XS, 0.)
4. **T4 JEANS × REF** → `'28'`, score **1** (not 0.533), confidence 0.595, thigh skipped, notes `['Thighs not checked: straight leg does not grip the thigh']`; 27 → 0.35 not wearable (hip −2.4 < T −2.25 → tight, waist −1.5 snug); 26 → 0.
5. **T5 A-line ignores hip**: WRAP with patternBlock 'a-line', no `ease`, critical [bust], zones [], no sizingNotes, tts 0.9, every hip = 70 → still `M`, score 1, skipped hip, notes `['Hips not checked: A-line hem flares freely', 'Your shoulders measurement is low-confidence — remeasure to sharpen this']`; L 0.67 (bust 8.3 roomy, waist 6.2 roomy).
6. **T6 jersey negative ease**: bodycon dress, modal stretch 30, garment chart S {80,62,88}, M {86,68,94}, critical [bust,hip], 'true to size', tts 0.9 → both sizes score 1 (all snug, snugOk via stretch; E for bust = 6*(1−0.75)=... with block ease 2 → 0.5; gaps −8.5 (S) / −2.5 (M), T = −9.5) → `tieBreak 'closest-ease'`, `recommendedSize 'M'`, notes `['Snug at the bust','Snug at the waist','Snug at the hips']`.
7. **T7 nothing fits**: WRAP × {bust 112, waist 96, hip 120, shoulder 44} → `recommendedSize null`, `closestSize 'L'`, `score 0`, `fits false`, `tieBreak null`, first note `'No size fits well — closest is L, tight at the bust'`, then `'Tight at the bust'`, `'Tight at the shoulders'`, `'Tight at the waist (stretch zone adjusts)'`, `'Tight at the hips'`.
8. **T8 sizingNotes tie-break**: dress chart S {88,68,96,37}, M {91,71,99,38}, ease {6,4,6}, critical [bust], tts 0.5, user {86,68,94,37} → S and M both 1 → 'runs small' ⇒ `'M'`, `tieBreak 'sizingNotes'`; with 'true to size' ⇒ `'S'`, `'closest-ease'`; with history `[{brand, size:'M', kept:true}]` and 'true to size' ⇒ `'M'`, `'history'`.
9. **T9 trueToSizeScore widens the tie band**: same as T8 but M waist 75 (gap 7 > E + 2 = 6 → roomy, score 0.92) → tts 0.92 (δ 0.062) picks S (M outside band, tieBreak null); tts 0.5 (δ 0.125) keeps M via 'runs small'. *(Corrected 2026-11-04: the original fixture "M bust 93 (score 0.9)" is still a good fit with a body chart and ease.bust 6 — gap (93 + 6) − (86 + 6) = 7 ≤ E + 2 = 8 → score 1 — so the tie band was never exercised. `packages/fit-engine` tests pin both fixtures; see its README §Spec deviations.)*
10. **T10 missing measurement**: WRAP × REF without hip → M, score 1, confidence 0.581, hip omitted `'user'`, notes `[\"We don't have your hips measurement yet\"]`.
11. **T11 confidence weighting**: WRAP (no sizingNotes, no zones) × {bust 88, waist 76, hip 96, shoulder 38}, confidence {waist 0.3} → `'L'`, score 0.851, notes `['Roomy at the bust', 'Your waist measurement is low-confidence — remeasure to sharpen this']`; M scores 0.698 (waist tight ×0.75 penalty, weight 0.3) and is not wearable.
12. **T12 shoes**: chart 37/38/39 (`footEu`), user `{footEu: 38}` → `'38'`, score 1, confidence 0.768; 37 snug 0.7 (−0.7), 39 roomy 0.6 (+0.7). With scan `{footLengthCm 24.6}` confidence 0.6 → `'39'`, score 0.7, notes `['Snug at the foot', 'Your foot measurement is low-confidence — remeasure to sharpen this']`.
13. **T13 accessory**: belt, chart `[{size:'ONE'}]` → `recommendedSize 'ONE'`, `score null`, `confidence 0`, notes `['No fit points for this item']`.
14. **T14 chart-type normalisation**: WRAP with `sizeChartType:'garment'` × REF → `'L'` (S 0.113, M 0.425, L 1) — proves the field matters and must be mandatory in the merchant schema.
15. **T15 unknown pattern block** ('mystery', no ease) → category defaults, `'M'`, score 1, L 0.772.
16. **T16 purity**: `Object.freeze` deep on inputs, call twice → `toEqual` both results; inputs unchanged; 1000 random bodies never throw and always yield `score ∈ [0,1] | null`.
17. **T17 stretch zone**: WRAP S for REF has waist −1.8 snug; with `stretchZones: []` and waist conf 0.95 the band is unchanged, but a user waist of 74 (gap −5.8) is tight without the zone and snug with it (zone tight limit T = −2.5 − 4 = −6.5). Waist 76 (gap −7.8) and 78 (gap −9.8) stay tight in both cases. *(Corrected 2026-11-04: the original text proposed waist 76 as "tight without zone, snug with zone", but −7.8 < −6.5 is still tight by the rule stated in the same sentence; `packages/fit-engine` tests assert the corrected vector.)*
