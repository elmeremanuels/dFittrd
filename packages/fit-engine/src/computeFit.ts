/**
 * computeFit — fit-engine-spec.md §Step 1–6 and §Notes, plus the sigma-aware extension (D5).
 *
 * Pure and deterministic: no I/O, no Date, never mutates its inputs (they may be deep-frozen).
 * Gaps are rounded to 0.1 cm, scores and confidence to 3 dp.
 */
import type { SizeRow, UserBody } from '@curtain/schema';
import { bandFor, bandForWithSigma } from './bands';
import {
  BLOCKS,
  ENGINE_POINTS,
  LENGTH_NEAR_SCORE,
  LENGTH_SLACK,
  MENS_BLOCKS,
  MENS_CATEGORY_POINTS,
  MENS_INSEAM_HEM_OFFSET_CM,
  MENS_POINT_LABELS,
  MENS_SHOULDER_SEAM_OFFSET_CM,
  MENS_SLIM_BOTTOM_BLOCKS,
  MENS_TOP_BLOCKS,
  MENS_TOP_LENGTH_PER_HEIGHT,
  NECK_DEFAULT_EASE_CM,
  NECK_SLACK,
  WORN_WAIST_RISE_CM,
  CATEGORY_EASE,
  CATEGORY_POINTS,
  CRITICAL_PENALTY,
  CRITICAL_WEIGHT,
  DEFAULT_CONFIDENCE,
  DEFAULT_SLACK,
  DEFAULT_TRUE_TO_SIZE,
  EASE_STRETCH_DIVISOR,
  LOW_CONFIDENCE_BELOW,
  NON_CRITICAL_PENALTY,
  NOTE_ORDER,
  NOTHING_FITS_BELOW,
  POINTS,
  POINT_LABELS as POINT_LABELS_DEFAULT,
  SHOES_EASE_FOOT_EU,
  SHOES_SLACK,
  SNUG_OK_STRETCH_PCT,
  TIGHT_BASE_CM,
  TIGHT_FLOOR_CM,
  TIGHT_PER_STRETCH_PCT,
  WEARABLE_MIN_SCORE,
  ZONE_POINTS,
  ZONE_SHIFT_CM,
  blockRule,
  type BandSlack,
  type BlockRule,
  type EaseMap,
  type MensBlockId,
} from './constants';
import { clamp, finite, normalMass, positive, round1, round3 } from './math';
import { TAPE_NOTES, bandTapePerSize, elasticBandOf, elasticWaistReading, pullOnCheck, resolveTuning, worseProvenance, type BandTape } from './pullOn';
import { parseSizingNotes } from './sizingNotes';
import {
  isPointFit,
  type Band,
  type BandEdges,
  type ComputeFitOptions,
  type FitGarment,
  type FitResult,
  type OmittedPoint,
  type Point,
  type PointFit,
  type SizeFit,
  type SizeRecommendation,
  type SkippedPoint,
  type TapeProvenance,
  type TapeTuning,
  type TieBreak,
} from './types';

/** EU shoe size → foot length in cm (spec §Step 2): `(eu − 2) × 2 / 3`. */
export function footLengthFromEu(eu: number): number {
  return ((eu - 2) * 2) / 3;
}

/** The user's foot length in cm: `footLengthCm` (or legacy `foot`), else converted from `footEu`. */
function userFootLength(m: UserBody['measurements']): number | undefined {
  const len = positive(m.footLengthCm) ?? positive(m.foot);
  if (len !== undefined) return len;
  const eu = positive(m.footEu);
  return eu === undefined ? undefined : footLengthFromEu(eu);
}

function chartFootLength(row: SizeRow): number | undefined {
  const len = positive(row.footLengthCm);
  if (len !== undefined) return len;
  const eu = positive(row.footEu);
  return eu === undefined ? undefined : footLengthFromEu(eu);
}

function userValue(point: Point, user: UserBody | undefined, m: UserBody['measurements'], centreBackSleeve: boolean): number | undefined {
  if (point === 'foot') return userFootLength(m);
  // Garment body length (men's tops, slice M2b): a share of stature [A], see MENS_TOP_LENGTH_PER_HEIGHT.
  if (point === 'length') {
    const h = positive(user?.heightCm);
    return h === undefined ? undefined : h * MENS_TOP_LENGTH_PER_HEIGHT;
  }
  // A centre-back sleeve also spans half the shoulders: arm length + biacromial / 2.
  if (point === 'sleeve' && centreBackSleeve) {
    const arm = positive(m.sleeve);
    const shoulder = positive(m.shoulder);
    return arm === undefined || shoulder === undefined ? undefined : arm + shoulder / 2;
  }
  return positive(m[point]);
}

function chartValue(point: Point, row: SizeRow): number | undefined {
  return point === 'foot' ? chartFootLength(row) : positive(row[point]);
}

/**
 * Whether a fit uses the men's tables (men-3d-plan slice M2a): `audience: 'men'` always, `'unisex'`
 * only on the male body. `'women'` and an absent audience: never (today's behaviour, byte for byte).
 */
export function usesMensTables(garment: Pick<FitGarment, 'audience'>, opts: Pick<ComputeFitOptions, 'bodyFamily'> = {}): boolean {
  return garment.audience === 'men' || (garment.audience === 'unisex' && opts.bodyFamily === 'male');
}

/** The men's block family of a top or bottom; `undefined` for the other categories (they keep today's rules). */
export function mensBlockFor(garment: Pick<FitGarment, 'category' | 'patternBlock' | 'fabric' | 'subcategory'>): MensBlockId | undefined {
  const key = typeof garment.patternBlock === 'string' ? norm(garment.patternBlock) : '';
  if (garment.category === 'top') return Object.prototype.hasOwnProperty.call(MENS_TOP_BLOCKS, key) ? MENS_TOP_BLOCKS[key] : 'tee';
  if (garment.category !== 'bottom') return undefined;
  const sub = typeof garment.subcategory === 'string' ? norm(garment.subcategory) : '';
  const denim = norm(String(garment.fabric?.primary ?? '')) === 'denim' || sub.includes('jean');
  const slim = MENS_SLIM_BOTTOM_BLOCKS.includes(key);
  return denim ? (slim ? 'jeans-slim' : 'jeans-regular') : slim ? 'chino-slim' : 'chino-regular';
}

function ruleFor(garment: FitGarment, mens: boolean): BlockRule {
  const id = mens ? mensBlockFor(garment) : undefined;
  return id === undefined ? blockRule(garment.patternBlock) : MENS_BLOCKS[id];
}

/** Points the engine reads as lengths (slice M2b): sleeve and body length always, the inseam in a men's fit. */
function isLengthPoint(point: Point, mens: boolean): boolean {
  return point === 'sleeve' || point === 'length' || (point === 'inseam' && mens);
}

function easeOf(map: Readonly<EaseMap> | undefined, point: Point): number | undefined {
  if (!map || typeof map !== 'object') return undefined;
  const v = map[point];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Designed ease target `E0` for a point (spec §Step 2 resolution order):
 * `garment.ease[p] ?? BLOCKS[block].ease[p] ?? CATEGORY_EASE[category][p]`.
 * Shoes: the category default is 0.7 cm only when the user supplied a foot length; with a
 * `footEu` size it is 0. `undefined` means the point has no ease target and is omitted.
 */
export function easeTargetFor(garment: FitGarment, point: Point, user?: UserBody, opts: Pick<ComputeFitOptions, 'bodyFamily'> = {}): number | undefined {
  const own = easeOf(garment.ease, point);
  if (own !== undefined) return own;
  const mens = usesMensTables(garment, opts);
  const rule = ruleFor(garment, mens);
  const fromBlock = easeOf(rule.ease, point);
  if (fromBlock !== undefined) return fromBlock;
  // A men's collar has an ease even where no block gives one [A, the men's shirt value]. Outside a
  // men's fit the neck is not a point at all (computeFit), so no default is invented for it.
  if (point === 'neck' && mens) return NECK_DEFAULT_EASE_CM;
  // A men's top or bottom takes its eases from its men's block only (no women's category default).
  if (mens && rule !== blockRule(garment.patternBlock)) return undefined;
  if (garment.category === 'shoes' && point === 'foot') {
    const m = user?.measurements;
    const hasLength = m !== undefined && (positive(m.footLengthCm) ?? positive(m.foot)) !== undefined;
    return hasLength ? CATEGORY_EASE.shoes.foot : SHOES_EASE_FOOT_EU;
  }
  return easeOf(CATEGORY_EASE[garment.category], point);
}

function zonePoints(zones: readonly string[] | undefined): ReadonlySet<Point> {
  const out = new Set<Point>();
  if (!Array.isArray(zones)) return out;
  for (const z of zones) {
    if (typeof z !== 'string') continue;
    const mapped = ZONE_POINTS[z.trim().toLowerCase()];
    if (mapped === undefined) continue;
    for (const p of mapped === 'all' ? POINTS : mapped) out.add(p);
  }
  return out;
}

function criticalPoints(list: readonly string[] | undefined): ReadonlySet<Point> {
  const out = new Set<Point>();
  if (!Array.isArray(list)) return out;
  for (const p of list) if ((POINTS as readonly string[]).includes(p)) out.add(p as Point);
  return out;
}

const norm = (s: string): string => s.trim().toLowerCase();

interface PointContext {
  point: Point;
  /** `girth` as before; `neck`: a narrow girth (slice M2b); `length`: inseam, sleeve, body length of a men's fit. */
  kind: 'girth' | 'neck' | 'length';
  critical: boolean;
  /** Designed ease target; `undefined` → omitted ('chart'). */
  e0: number | undefined;
  /** Stretch-adjusted ease target the bands use. */
  e: number;
  inZone: boolean;
  edges: BandEdges;
  confidence: number;
  weight: number;
  sigma: number | undefined;
  userVal: number | undefined;
}

export function computeFit(garment: FitGarment, user: UserBody, opts: ComputeFitOptions = {}): FitResult {
  const rows: readonly SizeRow[] = Array.isArray(garment.sizeChart) ? garment.sizeChart : [];
  const sizes = rows.map((r) => String(r?.size ?? ''));
  const measurements = (user?.measurements ?? {}) as UserBody['measurements'];
  const confidenceMap = user?.confidence ?? {};
  const sigmaMap = opts.sigma ?? {};

  const mens = usesMensTables(garment, opts);
  const rule = ruleFor(garment, mens);
  const critical = criticalPoints(garment.criticalFitPoints);
  const zones = zonePoints(garment.stretchZones);
  const stretch = clamp(finite(garment.fabric?.stretchPct, 0), 0, 100);
  const tts = clamp(finite(garment.trueToSizeScore, DEFAULT_TRUE_TO_SIZE), 0, 1);
  const bodyChart = garment.sizeChartType === 'body';
  const slack: BandSlack = garment.category === 'shoes' ? SHOES_SLACK : DEFAULT_SLACK;
  const snugOk = rule.snugOk || stretch >= SNUG_OK_STRETCH_PCT;
  const stretchFactor = Math.max(0, 1 - stretch / EASE_STRETCH_DIVISOR);
  const baseTight = Math.max(TIGHT_FLOOR_CM, -(TIGHT_BASE_CM + TIGHT_PER_STRETCH_PCT * stretch));

  // Step 1 — applicable points (FIT_POINTS order), pattern-block skips (merchant authority wins).
  // The men's points (neck, sleeve, body length; slice M2b) apply only when the chart has the column,
  // so a chart without them is read exactly as before.
  const categoryPoints = (mens ? MENS_CATEGORY_POINTS : CATEGORY_POINTS)[garment.category] ?? [];
  const chartHas = (p: Point): boolean => rows.some((r) => r !== null && typeof r === 'object' && chartValue(p, r) !== undefined);
  const columnPoint = (p: Point): boolean =>
    (p === 'neck' || p === 'sleeve' || (p === 'length' && mens && garment.category === 'top' && !bodyChart)) && chartHas(p);
  const centreBackSleeve = garment.sleeveConvention === 'centre_back';
  const skippedPoints: SkippedPoint[] = [];
  const contexts: PointContext[] = [];
  for (const point of ENGINE_POINTS) {
    // Outside a men's fit the men's points do not exist: before slice M2 the schema dropped these
    // columns, so a women's or unisex chart that now carries them is read exactly as before.
    if (!mens && MENS_ONLY_POINTS.has(point)) continue;
    const isCritical = point !== 'length' && critical.has(point);
    if (!categoryPoints.includes(point as never) && !isCritical && !columnPoint(point)) continue;
    if (rule.skip.includes(point) && !isCritical) {
      skippedPoints.push({ point, reason: 'pattern-block', label: rule.label });
      continue;
    }
    // A garment sleeve column says nothing without its convention (MT12); a body chart's sleeve is the arm length.
    if (point === 'sleeve' && !bodyChart && garment.sleeveConvention === undefined) {
      skippedPoints.push({ point, reason: 'sleeve-convention', label: 'the size chart does not say where the sleeve is measured from' });
      continue;
    }
    const confidence = clamp(finite(confidenceMap[point as keyof typeof confidenceMap], DEFAULT_CONFIDENCE), 0, 1);
    const common = {
      point,
      critical: isCritical,
      confidence,
      weight: (isCritical ? CRITICAL_WEIGHT : 1) * confidence,
      sigma: positive(sigmaMap[point as keyof typeof sigmaMap]),
      userVal: userValue(point, user, measurements, centreBackSleeve),
    };
    if (isLengthPoint(point, mens)) {
      // Lengths (slice M2b): the target is the body length plus an offset; stretch never changes it.
      const own = easeOf(garment.ease, point);
      const offset = own ?? (point === 'inseam' && !bodyChart ? -MENS_INSEAM_HEM_OFFSET_CM : 0);
      contexts.push({
        ...common,
        kind: 'length',
        e0: offset,
        e: offset,
        inZone: false,
        edges: { tightLimit: -LENGTH_SLACK.fail, easeTarget: 0, goodSlack: LENGTH_SLACK.good, looseSlack: LENGTH_SLACK.fail, snugOk: false },
      });
      continue;
    }
    const e0 = easeTargetFor(garment, point, user, opts);
    // A men's block that gives no ease for a point the chart does carry (a seat column on a tee):
    // the point is not checked, and the note says why, not that the chart lacks the column.
    if (mens && e0 === undefined && chartHas(point)) {
      skippedPoints.push({ point, reason: 'no-ease', label: 'we have no designed room for it on this kind of garment' });
      continue;
    }
    const e = e0 === undefined ? 0 : round1(e0 * stretchFactor);
    if (point === 'neck') {
      contexts.push({
        ...common,
        kind: 'neck',
        e0,
        e,
        inZone: false,
        edges: { tightLimit: -NECK_SLACK.tight, easeTarget: 0, goodSlack: NECK_SLACK.good, looseSlack: NECK_SLACK.loose, snugOk: false },
      });
      continue;
    }
    const inZone = zones.has(point);
    const shift = inZone ? ZONE_SHIFT_CM : 0;
    contexts.push({
      ...common,
      kind: 'girth',
      e0,
      e,
      inZone,
      edges: {
        tightLimit: baseTight - shift,
        easeTarget: e,
        goodSlack: slack.good + shift,
        looseSlack: slack.loose + shift,
        snugOk,
      },
    });
  }
  const mensFit: MensContext | null = mens
    ? {
        category: garment.category,
        bodyChart,
        userWaist: positive(measurements.waist),
        userSeat: positive(measurements.hip),
      }
    : null;
  const applicableAfterSkips = contexts.length;

  // Garment tape (optional). `tape === null` for every garment without it: nothing below changes.
  const bandTape = bandTapePerSize(garment.garmentTape, sizes);
  const tape: TapeContext | null =
    bandTape === null
      ? null
      : {
          tuning: resolveTuning(opts.tapeTuning),
          // The pull-on check: bottoms only (a dress or top goes on over the head and shoulders).
          pullOnHipCm: garment.closure === 'pull-on' && garment.category === 'bottom' ? positive(measurements.hip) : undefined,
        };
  const pullOnApplies =
    bandTape !== null && garment.closure === 'pull-on' && garment.category === 'bottom' && bandTape.some((b) => b?.stretched !== undefined);

  // Belly-aware chest (men's top, slice M2a): the smallest size whose waist is not tight is the one
  // the waist needs; only there may the chest's room be read as the cost of fitting the waist.
  const waistNeedIndex = mensFit?.category === 'top' ? waistNeededIndex(rows, contexts, bodyChart) : -1;

  // Steps 2–5 — per size.
  const scoredSizes = rows.map((row, i) =>
    scoreSize(row ?? { size: sizes[i] ?? '' }, sizes[i] ?? '', contexts, bodyChart, tape, bandTape?.[i], mensFit, i === waistNeedIndex),
  );
  // A men's W/L chart (slice M2b): each size also names its waist and leg, so a surface can step
  // along one axis (a snug preference is one waist down at the same leg, not the next row).
  const twoAxis = mens && tape === null && !opts.axisPass && isTwoAxisChart(rows);
  const perSize: SizeFit[] = scoredSizes.map((s, i) =>
    twoAxis ? { ...s.fit, axes: { waist: rows[i]!.axes!.waist, leg: rows[i]!.axes!.leg } } : s.fit,
  );
  // Closeness = mean |gap| over the size's used points. The spec writes Σ|gap|; the mean orders
  // identically when every size uses the same points and stops a row that lists fewer points from
  // looking "closer" merely because it has fewer gaps to add up (README §Spec deviations).
  // A waist read from a measured band counts by its distance from the band's designed state
  // (pullOn.ts `elasticCloseness`); every other point by |gap|, as before.
  const meanAbsGap = scoredSizes.map(({ closeness }) =>
    closeness.length === 0 ? Infinity : closeness.reduce((acc, c) => acc + c, 0) / closeness.length,
  );

  // Step 6 — recommendation.
  const allScored = perSize.map((s, i) => ({ s, i })).filter(({ s }) => s.score !== null);
  // A size whose band cannot pass the hips never competes. Without a pull-on check no size is
  // blocked and `scored` is every scored size, as before.
  const passable = allScored.filter(({ s }) => s.pullOn?.status !== 'blocked');
  const noneGoesOn = allScored.length > 0 && passable.length === 0;
  const scored = noneGoesOn ? allScored : passable;
  if (scored.length === 0) {
    // No point could be used. The placeholder is the first chart size, as before; with a pull-on
    // check it is the first size that is not blocked, and nothing when every size is blocked
    // (then the closest is the one least short).
    let index = 0;
    let offered = rows.length > 0;
    const notes = ['No fit points for this item'];
    if (tape !== null && perSize.some((s) => s.pullOn !== undefined)) {
      const open = perSize.findIndex((s) => s.pullOn?.status !== 'blocked');
      if (open >= 0) {
        index = open;
      } else {
        offered = false;
        perSize.forEach((s, i) => {
          if (s.pullOn!.marginCm > perSize[index]!.pullOn!.marginCm) index = i;
        });
        notes.push(TAPE_NOTES.noneGoesOn(perSize[index]!.size, perSize[index]!.pullOn!));
      }
    }
    const unchecked = tape !== null && pullOnApplies && tape.pullOnHipCm === undefined;
    if (unchecked) notes.push(TAPE_NOTES.hipMissing);
    const size = sizes[index] ?? null;
    return {
      recommendedSize: offered ? size : null,
      closestSize: size,
      ...(rows.length > 0 ? { closestIndex: index } : {}),
      score: null,
      confidence: 0,
      fits: false,
      perSize,
      notes,
      tieBreak: null,
      skippedPoints,
      ...(unchecked ? { pullOnUnchecked: true as const } : {}),
    };
  }

  const best = Math.max(...scored.map(({ s }) => s.score as number));
  let chosenIndex: number;
  let recommended: boolean;
  let tieBreak: TieBreak = null;

  const closestByEase = (cands: { i: number }[]): number => {
    let bestI = cands[0]!.i;
    for (const { i } of cands) if (meanAbsGap[i]! < meanAbsGap[bestI]!) bestI = i;
    return bestI;
  };

  if (noneGoesOn) {
    // Every size is blocked: nothing is recommended; the closest is the one least short.
    recommended = false;
    chosenIndex = scored[0]!.i;
    for (const { s, i } of scored) if (s.pullOn!.marginCm > perSize[chosenIndex]!.pullOn!.marginCm) chosenIndex = i;
  } else if (best < NOTHING_FITS_BELOW) {
    recommended = false;
    chosenIndex = closestByEase(scored);
  } else {
    recommended = true;
    const delta = 0.05 + 0.15 * (1 - tts);
    const inBand = scored.filter(({ s }) => (s.score as number) >= best - delta - 1e-9);
    // A tight point is a bad fit (handoff §4.1). When the tie band holds both wearable and
    // unwearable sizes, only the wearable ones compete: no tie-break (closest-ease, sizing notes
    // or history) may hand the user a size with a tight point while a wearable one is as good.
    const wearable = inBand.filter(({ s }) => s.wearable);
    const fitCandidates = wearable.length > 0 ? wearable : inBand;
    // Pull-on: a size whose band is short of the hips at the shop's stretch (but within the
    // allowance) competes only when no candidate passes. Without a pull-on check every candidate
    // passes this filter and nothing changes.
    const passing =
      tape !== null && tape.tuning.pullOnPreferPassing ? fitCandidates.filter(({ s }) => s.pullOn === undefined || s.pullOn.marginCm >= 0) : fitCandidates;
    const candidates = passing.length > 0 ? passing : fitCandidates;
    if (candidates.length === 1) {
      chosenIndex = candidates[0]!.i;
    } else {
      const bias = parseSizingNotes(garment.sizingNotes);
      const brand = typeof garment.brand === 'string' ? norm(garment.brand) : '';
      const kept = Array.isArray(user?.history)
        ? candidates.find(({ s }) =>
            user.history!.some((h) => h && h.kept === true && norm(String(h.brand)) === brand && norm(String(h.size)) === norm(s.size)),
          )
        : undefined;
      if (bias !== 0) {
        chosenIndex = (bias > 0 ? candidates[candidates.length - 1] : candidates[0])!.i;
        tieBreak = 'sizingNotes';
      } else if (kept) {
        chosenIndex = kept.i;
        tieBreak = 'history';
      } else {
        chosenIndex = closestByEase(candidates);
        tieBreak = 'closest-ease';
      }
    }
  }

  // Two-dimensional chart (W/L, slice M2b): the waist and the leg are picked on their own, each by
  // the same rules as a one-dimensional chart, and the row with both is the size.
  let sizeAxes: FitResult['sizeAxes'];
  // Men's fits only: outside one, a chart with `axes` is read as the flat list it was before M2.
  let axisMissing: 'waist' | 'leg' | null = null;
  if (twoAxis) {
    const pick = pickAxes(garment, user, opts, rows, perSize, chosenIndex);
    chosenIndex = pick.index;
    recommended = pick.recommended;
    tieBreak = pick.tieBreak;
    axisMissing = pick.missing;
    if (pick.axes.waist !== undefined || pick.axes.leg !== undefined) sizeAxes = pick.axes;
  }
  // A men's size is recommended only when it is wearable: no tight girth, no length past the fail
  // band (our decision of 19 Nov 2026, review of men-m2 [A]: the belly-aware intent of MT5 is that
  // a tight waist on the largest size is said, not recommended). Women's semantics are unchanged.
  if (mens && recommended && !perSize[chosenIndex]!.wearable) recommended = false;

  const chosen = perSize[chosenIndex]!;
  const used = chosen.points.filter(isPointFit);
  const meanConf = used.length === 0 ? 0 : used.reduce((a, p) => a + p.confidence, 0) / used.length;
  // Tape values the chosen size's result rests on: an interpolated or extrapolated one lowers confidence.
  let tapeProvenance: TapeProvenance | undefined;
  if (tape !== null) {
    for (const p of used) tapeProvenance = worseProvenance(tapeProvenance, p.elasticBand?.provenance);
    tapeProvenance = worseProvenance(tapeProvenance, chosen.pullOn?.provenance);
  }
  const tapeFactor = tapeProvenance === undefined || tape === null ? 1 : tape.tuning.provenanceConfidence[tapeProvenance];
  const confidence =
    applicableAfterSkips === 0
      ? 0
      : round3(meanConf * (0.6 + 0.4 * tts) * (used.length / applicableAfterSkips) * tapeFactor);

  // Belly-aware reading (slice M2a): the size shown is roomier at the chest because it fits the waist.
  const chestPoint = used.find((p) => p.point === 'bust');
  const waistLed =
    chestPoint?.waistLedCm !== undefined && chestPoint.band !== 'tight' && chestPoint.band !== 'snug' && chestPoint.gapCm > chestPoint.easeTarget + DEFAULT_SLACK.good;
  const notes = buildNotes(chosen, chosenIndex, rows.length, recommended, skippedPoints, noneGoesOn, mens, waistLed, axisMissing, sizeAxes);
  const pullOnUnchecked = tape !== null && pullOnApplies && tape.pullOnHipCm === undefined;
  if (tape !== null) addTapeNotes(notes, perSize, chosenIndex, noneGoesOn, tapeProvenance, pullOnUnchecked);

  return {
    recommendedSize: recommended ? chosen.size : null,
    closestSize: chosen.size,
    closestIndex: chosenIndex,
    score: chosen.score,
    confidence,
    fits: recommended && chosen.wearable,
    perSize,
    notes,
    tieBreak,
    skippedPoints,
    ...(tapeProvenance !== undefined ? { tapeProvenance } : {}),
    ...(pullOnUnchecked ? { pullOnUnchecked: true as const } : {}),
    ...(mens ? { mens: true as const } : {}),
    ...(sizeAxes !== undefined ? { sizeAxes } : {}),
    ...(waistLed ? { waistLed: true as const } : {}),
  };
}

/** Index of the smallest row whose waist is not tight for this body, or −1 (no waist point, no waist value). */
function waistNeededIndex(rows: readonly SizeRow[], contexts: readonly PointContext[], bodyChart: boolean): number {
  const w = contexts.find((c) => c.point === 'waist' && c.kind === 'girth');
  const b = contexts.find((c) => c.point === 'bust' && c.kind === 'girth');
  if (!w || !b || w.e0 === undefined || w.userVal === undefined || b.userVal === undefined) return -1;
  return rows.findIndex((row) => {
    const raw = row && typeof row === 'object' ? chartValue('waist', row) : undefined;
    if (raw === undefined) return false;
    return round1((bodyChart ? raw + (w.e0 as number) : raw) - (w.userVal as number + w.e)) >= w.edges.tightLimit;
  });
}

/** Every row carries `axes` (a W/L chart, slice M2b). */
/** Points that exist only in a men's fit (slice M2b). */
const MENS_ONLY_POINTS: ReadonlySet<Point> = new Set<Point>(['neck', 'sleeve', 'length']);

function isTwoAxisChart(rows: readonly SizeRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r !== null && typeof r === 'object' && r.axes !== undefined && typeof r.axes.waist === 'string' && typeof r.axes.leg === 'string');
}

/** Points picked on the leg axis of a W/L chart; every other point is on the waist axis. */
const LEG_AXIS_POINTS: ReadonlySet<string> = new Set(['inseam']);

/**
 * The waist and the leg of a W/L chart (men's fits only). The waist is picked by `computeFit` on a
 * one-dimensional chart of its own (one row per waist, the girth columns); the leg then by the same
 * rules on the rows of THAT waist only (their inseams), so the row with both always exists and the
 * leg is never read from another waist's rows. An axis with no scored point is not picked: then no
 * full W/L size is recommended and `axes` names only what was picked.
 */
function pickAxes(
  garment: FitGarment,
  user: UserBody,
  opts: ComputeFitOptions,
  rows: readonly SizeRow[],
  perSize: readonly SizeFit[],
  fallbackIndex: number,
): { index: number; recommended: boolean; tieBreak: TieBreak; axes: { waist?: string; leg?: string }; missing: 'waist' | 'leg' | null } {
  const distinct = (source: readonly SizeRow[], key: 'waist' | 'leg'): SizeRow[] => {
    const seen = new Set<string>();
    const out: SizeRow[] = [];
    for (const r of source) {
      const label = norm(r.axes![key]);
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(r);
    }
    return out;
  };
  const strip = (r: SizeRow, size: string, keepLeg: boolean): SizeRow => {
    const out: Record<string, unknown> = { size };
    for (const [k, v] of Object.entries(r)) {
      if (k === 'size' || k === 'axes') continue;
      if (LEG_AXIS_POINTS.has(k) === keepLeg) out[k] = v;
    }
    return out as SizeRow;
  };
  const sub = (source: readonly SizeRow[], key: 'waist' | 'leg'): FitResult => {
    const leg = key === 'leg';
    const g: FitGarment = {
      ...garment,
      sizeChart: distinct(source, key).map((r) => strip(r, r.axes![key], leg)),
      garmentTape: undefined,
      criticalFitPoints: garment.criticalFitPoints?.filter((p) => LEG_AXIS_POINTS.has(p) === leg),
      ...(leg ? { sizingNotes: undefined } : {}),
    };
    return computeFit(g, user, { ...opts, axisPass: true });
  };
  const w = sub(rows, 'waist');
  if (w.score === null || w.closestSize === null) {
    // No girth could be read (no girth columns, or no waist from the shopper): no waist is picked.
    return { index: fallbackIndex, recommended: false, tieBreak: null, axes: {}, missing: 'waist' };
  }
  const waist = w.closestSize;
  const waistRows = rows.filter((r) => norm(r.axes!.waist) === norm(waist));
  const firstOfWaist = rows.findIndex((r) => norm(r.axes!.waist) === norm(waist));
  const l = sub(waistRows, 'leg');
  if (l.score === null || l.closestSize === null) {
    // No inseam column, or no inside leg: the waist is picked, the leg is not, and no leg is invented.
    return { index: firstOfWaist, recommended: false, tieBreak: w.tieBreak, axes: { waist: rows[firstOfWaist]!.axes!.waist }, missing: 'leg' };
  }
  const leg = l.closestSize;
  const index = rows.findIndex((r) => norm(r.axes!.waist) === norm(waist) && norm(r.axes!.leg) === norm(leg));
  const row = rows[index]!;
  const final = perSize[index]!;
  return {
    index,
    // Recomputed on the row itself: both axes recommended, and the row as a whole wearable.
    recommended: w.recommendedSize !== null && l.recommendedSize !== null && final.score !== null && final.score >= NOTHING_FITS_BELOW && final.wearable,
    tieBreak: w.tieBreak ?? l.tieBreak,
    axes: { waist: row.axes!.waist, leg: row.axes!.leg },
    missing: null,
  };
}

/** What the men's readings need per size (slice M2): null for every other fit. */
interface MensContext {
  category: FitGarment['category'];
  bodyChart: boolean;
  userWaist: number | undefined;
  userSeat: number | undefined;
}

/**
 * Body girth where a men's waistband sits (slice M2b, plan §4 "Worn waist" [A, M]): between the
 * natural waist and the seat, by the chart's front rise (`WORN_WAIST_RISE_CM`).
 */
export function wornWaistCm(naturalWaistCm: number, seatCm: number, riseCm: number): number {
  const { atWaist, atSeat } = WORN_WAIST_RISE_CM;
  const f = clamp((atWaist - riseCm) / (atWaist - atSeat), 0, 1);
  return naturalWaistCm + f * (seatCm - naturalWaistCm);
}

/**
 * Band of a length (slice M2b, plan §4 [A]): within ±2 cm `good` (1.0), up to ±4 `short` / `long` at
 * 0.6, beyond ±4 `short` / `long` at 0 (fails). With a sigma the score is the expected score and the
 * band the most probable of short / good / long.
 */
function lengthBand(gap: number, sigma: number | undefined): { band: 'short' | 'good' | 'long'; score: number; pFail: number } {
  const { good, fail } = LENGTH_SLACK;
  if (sigma === undefined) {
    const off = Math.abs(gap);
    if (off <= good) return { band: 'good', score: 1, pFail: 0 };
    const band = gap < 0 ? 'short' : 'long';
    return off <= fail ? { band, score: LENGTH_NEAR_SCORE, pFail: 0 } : { band, score: 0, pFail: 1 };
  }
  const pShortFar = normalMass(gap, sigma, -Infinity, -fail);
  const pShortNear = normalMass(gap, sigma, -fail, -good);
  const pGood = normalMass(gap, sigma, -good, good);
  const pLongNear = normalMass(gap, sigma, good, fail);
  const pLongFar = normalMass(gap, sigma, fail, Infinity);
  const score = clamp(pGood + LENGTH_NEAR_SCORE * (pShortNear + pLongNear), 0, 1);
  const pShort = pShortFar + pShortNear;
  const pLong = pLongNear + pLongFar;
  const band = pGood >= pShort && pGood >= pLong ? 'good' : pShort >= pLong ? 'short' : 'long';
  return { band, score, pFail: pShortFar + pLongFar };
}

interface TapeContext {
  tuning: TapeTuning;
  /** The user's hip when the pull-on check applies and the hip is known. */
  pullOnHipCm: number | undefined;
}

/** Internal per-size result: the public `SizeFit` plus what the closest-ease tie-break compares. */
interface ScoredSize {
  fit: SizeFit;
  /** Per used point, in `fit.points` order: |gap|, or the band reading's closeness. */
  closeness: number[];
}

/**
 * The notes of the tape readings, added after the point notes. `notes` already holds the default
 * "fits you well" line when no point had a remark; a pull-on warning takes its place (a size that
 * only just goes on does not "fit well" without a remark), a provenance line is added after it.
 */
function addTapeNotes(
  notes: string[],
  perSize: readonly SizeFit[],
  chosenIndex: number,
  noneGoesOn: boolean,
  provenance: TapeProvenance | undefined,
  hipMissing: boolean,
): void {
  const chosen = perSize[chosenIndex]!;
  const extra: string[] = [];
  if (!noneGoesOn && chosen.pullOn?.status === 'marginal') extra.push(TAPE_NOTES.marginal(chosen.pullOn));
  if (!noneGoesOn) {
    // The nearest smaller size that does not go on: the one a shopper would size down to.
    for (let i = chosenIndex - 1; i >= 0; i--) {
      const s = perSize[i]!;
      if (s.pullOn?.status === 'blocked') {
        extra.push(TAPE_NOTES.smallerBlocked(s.size, s.pullOn));
        break;
      }
    }
  }
  if (hipMissing) extra.push(TAPE_NOTES.hipMissing);
  if (extra.length > 0) {
    const fitsWell = `Size ${chosen.size} fits you well.`;
    if (notes.length === 1 && notes[0] === fitsWell && chosen.pullOn?.status === 'marginal') notes.length = 0;
    notes.push(...extra);
  }
  const line = provenance === undefined ? null : TAPE_NOTES.provenance(chosen.size, provenance);
  if (line !== null) notes.push(line);
}

function scoreSize(
  row: SizeRow,
  size: string,
  contexts: readonly PointContext[],
  bodyChart: boolean,
  tape: TapeContext | null = null,
  bandTape: BandTape | undefined = undefined,
  mensFit: MensContext | null = null,
  waistLedRow = false,
): ScoredSize {
  const points: (PointFit | OmittedPoint)[] = [];
  const closeness: number[] = [];
  let weighted = 0;
  let weightSum = 0;
  let plain = 0;
  let penalty = 1;
  let anyTight = false;

  // The waist is read from the measured band when the size has one that stretches (pullOn.ts).
  const elastic = tape === null ? undefined : elasticBandOf(bandTape);

  // Men's top (slice M2a, belly-aware): this size's waist gap, so the chest can be read against it.
  const waistCtx = mensFit?.category === 'top' ? contexts.find((c) => c.point === 'waist' && c.kind === 'girth') : undefined;
  const waistRaw = waistCtx && waistCtx.e0 !== undefined ? chartValue('waist', row) : undefined;
  const waistGap =
    waistCtx && waistRaw !== undefined && waistCtx.userVal !== undefined
      ? round1((bodyChart ? waistRaw + (waistCtx.e0 as number) : waistRaw) - (waistCtx.userVal + waistCtx.e))
      : undefined;

  for (const c of contexts) {
    const fromBand = c.point === 'waist' ? elastic : undefined;
    const raw = fromBand !== undefined ? fromBand.relaxedCm : c.e0 === undefined ? undefined : chartValue(c.point, row);
    if (raw === undefined) {
      points.push({ point: c.point, omitted: 'chart' });
      continue;
    }
    let userVal = c.userVal;
    // Men's trousers on a garment chart with a front rise: the band meets the body at the worn height (MT13).
    let worn: PointFit['wornWaist'];
    if (fromBand === undefined && mensFit !== null && mensFit.category === 'bottom' && !mensFit.bodyChart && c.point === 'waist') {
      const rise = positive(row.rise);
      if (rise !== undefined && mensFit.userWaist !== undefined && mensFit.userSeat !== undefined) {
        userVal = wornWaistCm(mensFit.userWaist, mensFit.userSeat, rise);
        worn = { riseCm: round1(rise), naturalWaistCm: round1(mensFit.userWaist), seatCm: round1(mensFit.userSeat) };
      }
    }
    if (userVal === undefined) {
      points.push({ point: c.point, omitted: 'user' });
      continue;
    }
    let chartCm: number;
    let gapCm: number;
    let easeTarget = c.e;
    let tightLimit = c.edges.tightLimit;
    // What the band classifier sees: the point's own gap and edges, or the band reading's.
    let classGap: number;
    let classEdges: BandEdges = c.edges;
    if (fromBand !== undefined) {
      const t = tape as TapeContext;
      const reading = elasticWaistReading(fromBand, userVal, c.edges, t.tuning);
      closeness.push(reading.closenessCm);
      chartCm = fromBand.relaxedCm;
      gapCm = reading.gapCm;
      easeTarget = 0;
      tightLimit = reading.tightLimit;
      classGap = reading.shiftedGap;
      classEdges = reading.edges;
    } else if (c.kind === 'length') {
      // A length: chart against body length + offset, no ease, no stretch (body charts: offset 0).
      chartCm = raw;
      gapCm = round1(chartCm - (userVal + c.e));
      closeness.push(Math.abs(gapCm));
      classGap = gapCm;
    } else {
      chartCm = bodyChart ? raw + (c.e0 as number) : raw;
      // A men's garment chart gives the shoulder seam to seam; the body value is the biacromial
      // breadth. The seam sits about 3.5 cm outside it [A], so that offset joins the target: the
      // chart value is reported as the merchant wrote it, the gap is the same as before.
      if (mensFit !== null && !bodyChart && c.point === 'shoulder') easeTarget = round1(c.e + MENS_SHOULDER_SEAM_OFFSET_CM);
      gapCm = round1(chartCm - (userVal + easeTarget));
      closeness.push(Math.abs(gapCm));
      classGap = gapCm;
    }

    // Belly-aware chest (men's top): when this size is tighter at the waist than at the chest, the
    // chest room above the target is what fitting the waist costs, so the chest's upper bands widen
    // by that much. A body whose drop matches the garment's gets no change.
    // Only the size the waist needs counts: the smallest one whose waist is not tight. A larger size
    // has room to spare at the waist and was not chosen by it.
    let waistLedCm: number | undefined;
    if (
      waistLedRow &&
      waistGap !== undefined &&
      c.point === 'bust' &&
      c.kind === 'girth' &&
      fromBand === undefined &&
      gapCm > waistGap
    ) {
      waistLedCm = round1(gapCm - waistGap);
      classEdges = { ...classEdges, goodSlack: classEdges.goodSlack + waistLedCm, looseSlack: classEdges.looseSlack + waistLedCm };
    }

    let band: Band;
    let score: number;
    let pBad: number;
    let extra: Pick<PointFit, 'sigma' | 'bandProbabilities' | 'elasticBand' | 'measure' | 'wornWaist' | 'waistLedCm'> = {};
    if (c.kind === 'length') {
      const r = lengthBand(classGap, c.sigma);
      band = r.band;
      score = r.score;
      pBad = r.pFail;
      extra = c.sigma !== undefined ? { sigma: c.sigma, measure: 'length' } : { measure: 'length' };
      easeTarget = c.e;
      tightLimit = -LENGTH_SLACK.fail;
    } else if (c.sigma !== undefined) {
      const r = bandForWithSigma(classGap, c.sigma, classEdges);
      band = r.band;
      score = r.score;
      pBad = r.probabilities.tight + r.probabilities.loose;
      extra = { sigma: c.sigma, bandProbabilities: r.probabilities };
    } else {
      const r = bandFor(classGap, classEdges);
      band = r.band;
      score = r.score;
      pBad = band === 'tight' || band === 'loose' ? 1 : 0;
    }
    if (fromBand !== undefined) {
      extra = {
        ...extra,
        elasticBand: { relaxedCm: round1(fromBand.relaxedCm), stretchedCm: round1(fromBand.stretchedCm), provenance: fromBand.provenance },
      };
    }

    points.push({
      point: c.point,
      gapCm,
      band,
      score: round3(score),
      weight: c.weight,
      critical: c.critical,
      confidence: c.confidence,
      easeTarget,
      inZone: c.inZone,
      chartCm: round1(chartCm),
      bodyCm: round1(userVal),
      tightLimit,
      ...extra,
      ...(worn !== undefined ? { wornWaist: worn } : {}),
      ...(waistLedCm !== undefined ? { waistLedCm } : {}),
    });

    weighted += c.weight * score;
    weightSum += c.weight;
    plain += score;
    const m = c.critical ? CRITICAL_PENALTY : NON_CRITICAL_PENALTY;
    penalty *= 1 - (1 - m) * pBad;
    if (band === 'tight') anyTight = true;
    // A length more than `fail` cm off fails like a tight girth (plan §4).
    if (c.kind === 'length' && Math.abs(gapCm) > LENGTH_SLACK.fail) anyTight = true;
  }

  // Pull-on check: independent of the fit points (it runs even when no point could be used).
  const pullOn =
    tape !== null && tape.pullOnHipCm !== undefined && bandTape?.stretched !== undefined
      ? pullOnCheck(bandTape.stretched, tape.pullOnHipCm, tape.tuning)
      : undefined;
  const withPullOn = pullOn === undefined ? {} : { pullOn };

  const usedCount = points.filter(isPointFit).length;
  if (usedCount === 0) return { fit: { size, score: null, wearable: false, points, ...withPullOn }, closeness };
  const avg = (weightSum > 0 ? weighted / weightSum : plain / usedCount) * penalty;
  const score = round3(clamp(avg, 0, 1));
  const wearable = !anyTight && score >= WEARABLE_MIN_SCORE && pullOn?.status !== 'blocked';
  return { fit: { size, score, wearable, points, ...withPullOn }, closeness };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function buildNotes(
  fit: SizeFit,
  index: number,
  chartLength: number,
  recommended: boolean,
  skipped: readonly SkippedPoint[],
  noneGoesOn = false,
  mens = false,
  waistLed = false,
  axisMissing: 'waist' | 'leg' | null = null,
  sizeAxes: FitResult['sizeAxes'] = undefined,
): string[] {
  const POINT_LABELS = mens ? MENS_POINT_LABELS : POINT_LABELS_DEFAULT;
  const notes: string[] = [];
  const byPoint = new Map<Point, PointFit | OmittedPoint>(fit.points.map((p) => [p.point, p]));
  const ordered = NOTE_ORDER.map((p) => byPoint.get(p)).filter((p): p is PointFit | OmittedPoint => p !== undefined);
  const used = ordered.filter(isPointFit);
  const hasLarger = index + 1 < chartLength;
  const hasSmaller = index > 0;

  if (noneGoesOn && fit.pullOn) {
    notes.push(TAPE_NOTES.noneGoesOn(fit.size, fit.pullOn));
  } else if (axisMissing === 'waist') {
    notes.push('No W/L size picked: the waist could not be checked');
  } else if (axisMissing === 'leg' && sizeAxes?.waist !== undefined) {
    notes.push(`Waist ${sizeAxes.waist} is the best match; the leg length could not be checked, so no full size is picked`);
  } else if (!recommended) {
    let worst: PointFit | undefined;
    for (const p of used) if (worst === undefined || p.score < worst.score) worst = p;
    if (worst) notes.push(`No size fits well — closest is ${fit.size}, ${worst.band} at the ${POINT_LABELS[worst.point]}`);
  }

  for (const p of used) {
    const label = POINT_LABELS[p.point];
    let text: string | null = null;
    switch (p.band) {
      case 'tight':
        text = `Tight at the ${label}` + (hasLarger ? ' — consider sizing up' : '');
        break;
      case 'snug':
        text = `Snug at the ${label}`;
        break;
      case 'roomy':
        text = `Roomy at the ${label}`;
        break;
      case 'loose':
        text = `Loose at the ${label}` + (hasSmaller ? ' — consider sizing down' : '');
        break;
      case 'short':
        text = `Short at the ${label}`;
        break;
      case 'long':
        text = `Long at the ${label}`;
        break;
      case 'good':
        break;
    }
    if (text !== null) notes.push(p.inZone ? `${text} (stretch zone adjusts)` : text);
  }

  const skippedOrdered = [...skipped].sort((a, b) => NOTE_ORDER.indexOf(a.point) - NOTE_ORDER.indexOf(b.point));
  for (const s of skippedOrdered) notes.push(`${cap(POINT_LABELS[s.point])} not checked: ${s.label}`);
  if (mens) {
    // A men's chart without a column the fit needs says so (MT10: a W/L chart with labels only).
    for (const p of ordered) {
      if (!isPointFit(p) && p.omitted === 'chart') notes.push(`${cap(POINT_LABELS[p.point])} not checked: the size chart has no ${POINT_LABELS[p.point]} measurement`);
    }
    if (waistLed) notes.push(`Sized to fit your waist — roomier at the ${POINT_LABELS.bust}`);
  }

  for (const p of ordered) {
    if (!isPointFit(p) && p.omitted === 'user') notes.push(`We don't have your ${POINT_LABELS[p.point]} measurement yet`);
  }
  for (const p of used) {
    if (p.confidence < LOW_CONFIDENCE_BELOW) {
      notes.push(`Your ${POINT_LABELS[p.point]} measurement is low-confidence — remeasure to sharpen this`);
    }
  }

  if (notes.length === 0) notes.push(`Size ${fit.size} fits you well.`);
  return notes;
}

/** Thin wrapper over `computeFit` returning only the recommendation fields. */
export function recommendSize(garment: FitGarment, user: UserBody, opts?: ComputeFitOptions): SizeRecommendation {
  const r = computeFit(garment, user, opts);
  return {
    recommendedSize: r.recommendedSize,
    closestSize: r.closestSize,
    score: r.score,
    confidence: r.confidence,
    fits: r.fits,
    tieBreak: r.tieBreak,
  };
}

export { BLOCKS };
