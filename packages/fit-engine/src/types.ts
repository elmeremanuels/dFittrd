/**
 * Public types of @curtain/fit-engine (docs/research/fit-engine-spec.md §Types).
 *
 * Wire types (GarmentPayload, SizeRow, UserBody, FitPoint, …) come from @curtain/schema and are
 * never redeclared here. `FitResult` and its parts are NOT wire types: they are computed on-device
 * and never leave the device (AGENTS.md rule 4), so they are defined in this package.
 */
import type { BodyProfile, Fabric, FitPoint, GarmentCategory, GarmentPayload, TapeProvenance, UserBody } from '@curtain/schema';

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
    Pick<
      GarmentPayload,
      'ease' | 'sizeChartType' | 'sizingNotes' | 'trueToSizeScore' | 'criticalFitPoints' | 'stretchZones' | 'closure' | 'garmentTape'
    >
  >;

/**
 * The numbers behind the garment tape readings (`TAPE_TUNING` in pullOn.ts holds the defaults and
 * README §Garment tape says where each comes from). All of them are choices, not measurements.
 */
export interface TapeTuning {
  /** Shortfall of the stretched band against the hips that still goes on, cm. */
  pullOnAllowanceCm: number;
  /** A size that clears the hips by less than this (and is not blocked) is `marginal`, cm. */
  pullOnMarginalBelowCm: number;
  /**
   * Shortfall tolerated when the stretched band is extrapolated, cm. Never applied wider than
   * `pullOnAllowanceCm`: an unmeasured band is trusted less, not more.
   */
  pullOnExtrapolatedAllowanceCm: number;
  /**
   * Among sizes that fit equally well, one whose band passes the hips (margin ≥ 0) is preferred
   * over one that is short within the allowance.
   */
  pullOnPreferPassing: boolean;
  /** Share (0..1) of the band's stretch range that reads `good`; above it the waist reads `snug`. */
  easyStretchShare: number;
  /** Multiplier on `FitResult.confidence` by the worst provenance of the tape values used. */
  provenanceConfidence: Record<TapeProvenance, number>;
}

export type PullOnStatus = 'clear' | 'marginal' | 'blocked';

/**
 * Pull-on check of one size: can the waistband, at the stretch the shop measured, pass the
 * wearer's hips. Present only for a `closure: 'pull-on'` bottom whose size has a stretched band
 * value, and only when the user gave a hip measurement.
 */
export interface PullOnCheck {
  /**
   * `blocked`: the band is short by more than `allowanceCm`; the size is never recommended.
   * `marginal`: within the allowance, or clearing by less than the marginal margin; a warning.
   * `clear`: no remark.
   */
  status: PullOnStatus;
  /** `round1(stretched band − body hip)`, cm. Negative = short at the shop's comfortable stretch. */
  marginCm: number;
  bandStretchedCm: number;
  /** The body girth the band has to pass: the user's hip measurement (fullest girth of the seat). */
  bodyHipCm: number;
  /** Shortfall tolerated for this size, cm (smaller, 0 by default, when the band value is extrapolated). */
  allowanceCm: number;
  /** Provenance of the stretched band value: never present an interpolated or extrapolated one as measured. */
  provenance: TapeProvenance;
}

/** The measured band a waist point was read from (`PointFit.elasticBand`). */
export interface ElasticBandReading {
  relaxedCm: number;
  stretchedCm: number;
  /** The worse provenance of the two values. */
  provenance: TapeProvenance;
}

/** Per-point measurement sigma in cm (decision D5), e.g. from `sigmaFromBodyProfile(profile)`. */
export type PointSigma = Partial<Record<Point, number>>;

export interface ComputeFitOptions {
  /** Reserved by the spec signature; the engine is time-independent and ignores it. */
  now?: number;
  /**
   * Overrides for the garment tape readings, for sensitivity runs. Has no effect on a garment
   * without `closure` / `garmentTape`. Production callers leave it out.
   */
  tapeTuning?: Partial<TapeTuning>;
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
  /**
   * Present only on a waist point that was read from the garment's measured band range in place
   * of chart waist + ease. Then `chartCm` is the relaxed band, `easeTarget` is 0, `gapCm` is
   * `relaxed − body` (negative = the band is stretched by that much) and `tightLimit` is
   * `−(stretched − relaxed)`.
   */
  elasticBand?: ElasticBandReading;
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
  /** No tight point and score ≥ 0.4, and the pull-on check (when there is one) is not `blocked`. */
  wearable: boolean;
  /** Pull-on check of this size; absent when the garment or the user lacks the data for it. */
  pullOn?: PullOnCheck;
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
  /**
   * Index of `closestSize` in `perSize` (chart order); absent when the chart is empty. The UI helpers
   * read the row through this index, never by searching for the label (finding #2).
   */
  closestIndex?: number;
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
  /**
   * Worst provenance of the garment tape values the result for `closestSize` rests on. Absent when
   * no tape value was used. `interpolated` and `extrapolated` have lowered `confidence`.
   */
  tapeProvenance?: TapeProvenance;
  /**
   * `true` when the garment has a pull-on check (pull-on bottom with stretched band values) that
   * could not run because the user gave no hip measurement. Absent otherwise. The recommendation
   * then says nothing about whether the band passes the hips; a surface should ask for the hips.
   */
  pullOnUnchecked?: true;
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

/**
 * D15 anchor ids of the fit points, as in `@curtain/anchors` (`FIT_POINT_TO_ANCHOR`). Declared here
 * so the engine keeps zero dependencies; a test keeps both tables equal. `foot` has no anchor.
 */
export type FitAnchorId = 'chest' | 'waist' | 'hip' | 'shoulder_width' | 'thigh' | 'inseam';

/**
 * `RenderGaps` keyed by D15 anchor id instead of fit point (`anchorGaps`). Same numbers, same rounding:
 * the 3D viewer reads these and never computes fit a second time (ENGINE-HANDOFF rule 4).
 */
export interface AnchorGaps {
  size: string;
  /** Per used anchor: `gapCm` (positive = garment larger than body + target ease). */
  gaps: Partial<Record<FitAnchorId, number>>;
  bands: Partial<Record<FitAnchorId, Band>>;
  /** Per used anchor: stretch-adjusted ease target the gap is relative to. */
  easeTargets: Partial<Record<FitAnchorId, number>>;
  /** Per used anchor: absolute slack `gapCm + easeTarget` = garment − body, cm. */
  slackCm: Partial<Record<FitAnchorId, number>>;
}

export type { BodyProfile, UserBody, GarmentPayload, TapeProvenance };
