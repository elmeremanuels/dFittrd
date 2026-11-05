/**
 * Public types of @curtain/fit-engine (docs/research/fit-engine-spec.md §Types).
 *
 * Wire types (GarmentPayload, SizeRow, UserBody, FitPoint, …) come from @curtain/schema and are
 * never redeclared here. `FitResult` and its parts are NOT wire types: they are computed on-device
 * and never leave the device (AGENTS.md rule 4), so they are defined in this package.
 */
import type { BodyProfile, Fabric, FitPoint, GarmentCategory, GarmentPayload, UserBody } from '@curtain/schema';

/** The fit-engine spec calls the fit point `Point`. */
export type Point = FitPoint;
export type Category = GarmentCategory;

/** Handoff §4.1 bands, extended with `roomy` (fit-engine-spec.md §Step 4). */
export type Band = 'tight' | 'snug' | 'good' | 'roomy' | 'loose';
export const BANDS: readonly Band[] = ['tight', 'snug', 'good', 'roomy', 'loose'];

/**
 * What the engine reads from a garment. Every `GarmentPayload` (and every merchant draft that has
 * at least a category, a pattern block, a fabric stretch value and a chart) is assignable to it.
 * `sizeChartType` defaults to `'garment'` when absent (handoff §4.1 formula), `trueToSizeScore` to 0.8.
 */
export type FitGarment = Pick<GarmentPayload, 'id' | 'brand' | 'category' | 'patternBlock' | 'sizeChart'> & {
  fabric: Pick<Fabric, 'stretchPct'> & Partial<Fabric>;
} & Partial<
    Pick<GarmentPayload, 'ease' | 'sizeChartType' | 'sizingNotes' | 'trueToSizeScore' | 'criticalFitPoints' | 'stretchZones'>
  >;

/** Per-point measurement sigma in cm (decision D5), e.g. from `sigmaFromBodyProfile(profile)`. */
export type PointSigma = Partial<Record<Point, number>>;

export interface ComputeFitOptions {
  /** Reserved by the spec signature; the engine is time-independent and ignores it. */
  now?: number;
  /**
   * Optional per-point standard deviation of the user's measurement (cm). When a point has a
   * sigma > 0 the hard band edges become probabilities P(gap ∈ band) under N(gap, σ²) and the
   * point score is the expected band score. Without sigma (or sigma 0) the result is identical to
   * the deterministic spec.
   */
  sigma?: PointSigma;
}

/** Probability mass per band when a sigma was supplied for the point. */
export type BandProbabilities = Record<Band, number>;

export interface PointFit {
  point: Point;
  /** `round1(chartVal − (userVal + E))`, cm. With sigma this is still the point estimate. */
  gapCm: number;
  /** Deterministic band, or the most probable band when sigma is given. */
  band: Band;
  /** 0..1 band score (expected band score with sigma), 3 dp. */
  score: number;
  /** `(critical ? 2 : 1) × confidence`. */
  weight: number;
  critical: boolean;
  /** `user.confidence[point] ?? 0.8`. */
  confidence: number;
  /** Stretch-adjusted ease target `E` the bands are built on, cm. */
  easeTarget: number;
  /** Point is in one of the garment's stretch zones (tight limit −4, upper edges +4). */
  inZone: boolean;
  /** Chart value after sizeChartType normalisation (body charts: row + designed ease), cm. */
  chartCm: number;
  /** The user's value at this point (foot: length in cm), cm. */
  bodyCm: number;
  /** Tight limit `T` that applied to this point, cm. */
  tightLimit: number;
  /** Present only when a sigma > 0 was supplied for this point. */
  sigma?: number;
  /** Present only when a sigma > 0 was supplied for this point. */
  bandProbabilities?: BandProbabilities;
}

export interface OmittedPoint {
  point: Point;
  /** `'chart'`: the chart has no usable value (or no ease target) · `'user'`: the user has no measurement. */
  omitted: 'chart' | 'user';
}

export function isPointFit(p: PointFit | OmittedPoint): p is PointFit {
  return !('omitted' in p);
}

export interface SizeFit {
  size: string;
  /** 0..1, 3 dp; `null` when no point could be used for this size. */
  score: number | null;
  /** No tight point and score ≥ 0.4. */
  wearable: boolean;
  /** FIT_POINTS order (bust, waist, hip, shoulder, thigh, inseam, foot). */
  points: (PointFit | OmittedPoint)[];
}

export type TieBreak = 'sizingNotes' | 'history' | 'closest-ease' | null;

export interface SkippedPoint {
  point: Point;
  reason: 'pattern-block';
  label: string;
}

export interface FitResult {
  /** `null` when nothing fits (best score < 0.3); first chart size when the item has no fit points. */
  recommendedSize: string | null;
  /** Always set when the chart is non-empty. Equals `recommendedSize` when one exists. */
  closestSize: string | null;
  /** Score of `closestSize` (0..1), `null` when no fit points. */
  score: number | null;
  /** 0..1, 3 dp. */
  confidence: number;
  /** `recommendedSize !== null` and that size is wearable. */
  fits: boolean;
  /** Chart order. */
  perSize: SizeFit[];
  /** Human text (English) in the exact spec order. */
  notes: string[];
  tieBreak: TieBreak;
  /** Points removed by the pattern-block rules (merchant `criticalFitPoints` are never skipped). */
  skippedPoints: SkippedPoint[];
}

export type SizeRecommendation = Pick<
  FitResult,
  'recommendedSize' | 'closestSize' | 'score' | 'confidence' | 'fits' | 'tieBreak'
>;

/** Band edges `bandFor` works with (cm; `E` is the stretch-adjusted ease target). */
export interface BandEdges {
  /** Tight limit `T` (negative). */
  tightLimit: number;
  /** Stretch-adjusted ease target `E`. */
  easeTarget: number;
  /** Good slack (2, shoes 0.5) — already includes the +4 zone shift when applicable. */
  goodSlack: number;
  /** Loose slack (4, shoes 1.0) — already includes the +4 zone shift when applicable. */
  looseSlack: number;
  /** Snug scores 1.0 instead of 0.7. */
  snugOk: boolean;
}

export interface BandResult {
  band: Band;
  score: number;
}

/** Gaps handed to the Path B renderer (`fitGapsForRender`). */
export interface RenderGaps {
  size: string;
  /** Per used point: `gapCm` (positive = garment larger than body + target ease). */
  gaps: Partial<Record<Point, number>>;
  bands: Partial<Record<Point, Band>>;
  /** Per used point: stretch-adjusted ease target the gap is relative to. */
  easeTargets: Partial<Record<Point, number>>;
  /** Per used point: absolute slack `gapCm + easeTarget` = garment − body, cm. */
  slackCm: Partial<Record<Point, number>>;
}

export type { BodyProfile, UserBody, GarmentPayload };
