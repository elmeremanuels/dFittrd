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
  POINT_LABELS,
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
  type EaseMap,
} from './constants';
import { clamp, finite, positive, round1, round3 } from './math';
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

function userValue(point: Point, m: UserBody['measurements']): number | undefined {
  return point === 'foot' ? userFootLength(m) : positive(m[point]);
}

function chartValue(point: Point, row: SizeRow): number | undefined {
  return point === 'foot' ? chartFootLength(row) : positive(row[point]);
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
export function easeTargetFor(garment: FitGarment, point: Point, user?: UserBody): number | undefined {
  const own = easeOf(garment.ease, point);
  if (own !== undefined) return own;
  const fromBlock = easeOf(blockRule(garment.patternBlock).ease, point);
  if (fromBlock !== undefined) return fromBlock;
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

  const rule = blockRule(garment.patternBlock);
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
  const categoryPoints = CATEGORY_POINTS[garment.category] ?? [];
  const skippedPoints: SkippedPoint[] = [];
  const contexts: PointContext[] = [];
  for (const point of POINTS) {
    if (!categoryPoints.includes(point) && !critical.has(point)) continue;
    if (rule.skip.includes(point) && !critical.has(point)) {
      skippedPoints.push({ point, reason: 'pattern-block', label: rule.label });
      continue;
    }
    const e0 = easeTargetFor(garment, point, user);
    const e = e0 === undefined ? 0 : round1(e0 * stretchFactor);
    const inZone = zones.has(point);
    const shift = inZone ? ZONE_SHIFT_CM : 0;
    const confidence = clamp(finite(confidenceMap[point], DEFAULT_CONFIDENCE), 0, 1);
    contexts.push({
      point,
      critical: critical.has(point),
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
      confidence,
      weight: (critical.has(point) ? CRITICAL_WEIGHT : 1) * confidence,
      sigma: positive(sigmaMap[point]),
      userVal: userValue(point, measurements),
    });
  }
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

  // Steps 2–5 — per size.
  const scoredSizes = rows.map((row, i) =>
    scoreSize(row ?? { size: sizes[i] ?? '' }, sizes[i] ?? '', contexts, bodyChart, tape, bandTape?.[i]),
  );
  const perSize: SizeFit[] = scoredSizes.map((s) => s.fit);
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

  const notes = buildNotes(chosen, chosenIndex, rows.length, recommended, skippedPoints, noneGoesOn);
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
  };
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

  for (const c of contexts) {
    const fromBand = c.point === 'waist' ? elastic : undefined;
    const raw = fromBand !== undefined ? fromBand.relaxedCm : c.e0 === undefined ? undefined : chartValue(c.point, row);
    if (raw === undefined) {
      points.push({ point: c.point, omitted: 'chart' });
      continue;
    }
    if (c.userVal === undefined) {
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
      const reading = elasticWaistReading(fromBand, c.userVal, c.edges, t.tuning);
      closeness.push(reading.closenessCm);
      chartCm = fromBand.relaxedCm;
      gapCm = reading.gapCm;
      easeTarget = 0;
      tightLimit = reading.tightLimit;
      classGap = reading.shiftedGap;
      classEdges = reading.edges;
    } else {
      chartCm = bodyChart ? raw + (c.e0 as number) : raw;
      gapCm = round1(chartCm - (c.userVal + c.e));
      closeness.push(Math.abs(gapCm));
      classGap = gapCm;
    }

    let band: Band;
    let score: number;
    let pBad: number;
    let extra: Pick<PointFit, 'sigma' | 'bandProbabilities' | 'elasticBand'> = {};
    if (c.sigma !== undefined) {
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
      bodyCm: round1(c.userVal),
      tightLimit,
      ...extra,
    });

    weighted += c.weight * score;
    weightSum += c.weight;
    plain += score;
    const m = c.critical ? CRITICAL_PENALTY : NON_CRITICAL_PENALTY;
    penalty *= 1 - (1 - m) * pBad;
    if (band === 'tight') anyTight = true;
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
): string[] {
  const notes: string[] = [];
  const byPoint = new Map<Point, PointFit | OmittedPoint>(fit.points.map((p) => [p.point, p]));
  const ordered = NOTE_ORDER.map((p) => byPoint.get(p)).filter((p): p is PointFit | OmittedPoint => p !== undefined);
  const used = ordered.filter(isPointFit);
  const hasLarger = index + 1 < chartLength;
  const hasSmaller = index > 0;

  if (noneGoesOn && fit.pullOn) {
    notes.push(TAPE_NOTES.noneGoesOn(fit.size, fit.pullOn));
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
      case 'good':
        break;
    }
    if (text !== null) notes.push(p.inZone ? `${text} (stretch zone adjusts)` : text);
  }

  const skippedOrdered = [...skipped].sort((a, b) => NOTE_ORDER.indexOf(a.point) - NOTE_ORDER.indexOf(b.point));
  for (const s of skippedOrdered) notes.push(`${cap(POINT_LABELS[s.point])} not checked: ${s.label}`);

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
