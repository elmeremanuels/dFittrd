/**
 * Internal types of the on-device capture pipeline (apps/web/src/features/capture).
 *
 * Wire/body types (BodyProfile, Measurement, UserBody, FitSignature…) come ONLY from
 * `@paskamer/schema`; nothing here is ever sent over the network. Raw frames never appear in
 * these types on purpose: the worker posts landmarks, masks, widths/depths, quality features,
 * ONE background-replaced base frame and one face tile — never a video frame.
 */
import type { FS_GIRTH_LEVELS } from '@paskamer/schema';

/** Minimal landmark shape (matches MediaPipe `NormalizedLandmark`; x/y normalised 0..1). */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** The 12 cross-section levels of handoff §2.1B, in FitSignature order. */
export type Level = (typeof FS_GIRTH_LEVELS)[number];

export type ViewKind = 'front' | 'back' | 'left' | 'right' | 'oblique' | 'none';

export type GateReason =
  | 'no_person'
  | 'not_full_body'
  | 'low_visibility'
  | 'too_close_to_edge'
  | 'tilted'
  | 'arms_not_in_a_pose'
  | 'unstable'
  | 'too_small';

export interface GateFeatures {
  /** Minimum visibility over the required landmarks. */
  visibilityMin: number;
  /** Lean of the shoulder-mid → hip-mid axis vs. vertical, degrees (pixel space). */
  tiltDeg: number;
  /** Shoulder line roll vs. horizontal, degrees. */
  rollDeg: number;
  /** Elbow–hip horizontal gap / shoulder width (min of both sides). */
  armGapRatio: number;
  /** Nose → heel vertical span, normalised to frame height. */
  heightSpan: number;
  /** Shoulder width / torso height (pixel space): ~0.6–0.8 frontal, <0.25 side-on. */
  frontalRatio: number;
  view: ViewKind;
}

export interface GateResult {
  ok: boolean;
  reasons: GateReason[];
  features: GateFeatures;
}

/** One cross-section placement in normalised image coordinates. */
export interface LevelPlacement {
  level: Level;
  /** Normalised y of the scan line. */
  y: number;
  /** Normalised x of the blob the width is measured on (torso centre, left thigh, left arm…). */
  x: number;
  /** Angle of the limb axis vs. vertical (deg); widths across a slanted limb are corrected by cos. */
  axisDeg: number;
  /**
   * Front-view contact guard (normalised x). `clip`: the run is cut at the limits (legs touching each
   * other are split at the midline between them). `reject`: a run reaching past the limits is merged
   * with a neighbouring blob (an arm pressed against the torso, an arm run that swallowed the torso)
   * and the level is reported as not measurable instead of silently measuring both blobs.
   */
  limits?: { min: number; max: number; mode: 'clip' | 'reject' } | undefined;
  /**
   * Take the narrowest run over the rows y0..y1 (normalised) instead of the single row at `y` — used
   * for the neck, whose band between chin and shoulders is too thin to hit with a fixed fraction.
   */
  search?: { y0: number; y1: number } | undefined;
}

export interface LevelSample {
  level: Level;
  /** Pixel width of the blob at this level (front) or depth (side). NaN when not found. */
  px: number;
  /** clothes / (clothes + skin) on the run, 0..1. */
  coverage: number;
  /** True when the level was rejected because a limb touches the body there (see `LevelPlacement.limits`). */
  contact?: boolean | undefined;
}

export interface SideSelection {
  frontIndex: number;
  sideIndex: number;
  frontScore: number;
  sideScore: number;
}

export interface FrameFeatures {
  index: number;
  timestamp: number;
  gate: GateResult;
}

/** What the worker computes per view from the (median of 3) masks. */
export interface ViewMeasurement {
  view: 'front' | 'side';
  width: number;
  height: number;
  landmarks: Landmark[];
  samples: LevelSample[];
  /** First foreground row of the person mask near the head (pixels). */
  headTopPx: number;
  /** Lowest heel landmark row (pixels). */
  heelPx: number;
  tiltDeg: number;
  /** Shoulder slope from the mask's top contour (deg below horizontal), when it could be traced. */
  shoulderSlopeDeg?: number | undefined;
}

export type Sex = 'female' | 'male' | 'unspecified';

export interface GirthEstimate {
  mean: number;
  sigma: number;
  widthCm?: number;
  depthCm?: number;
  aspect?: number;
  coverage?: number;
}

export interface ScanMeasurements {
  girths: Partial<Record<Level, GirthEstimate>>;
  lengths: Partial<Record<string, number>>;
  posture: Partial<Record<string, number>>;
  /** Clothing-coverage and gating quality in 0..1. */
  quality: number;
  warnings: string[];
}

export interface SkinEstimate {
  lab: { L: number; a: number; b: number };
  srgbHex: string;
  ita: number;
  monk: number;
  undertone: 'warm' | 'cool' | 'neutral';
  hueAngle: number;
  chroma: number;
  season: SeasonEstimate;
  hairLab?: { L: number; a: number; b: number } | undefined;
  hairHex?: string | undefined;
  sampleCount: number;
  /** Always true: skin tone and season are estimates, the user confirms the swatch. */
  isEstimate: true;
}

export type Season =
  | 'light spring'
  | 'warm spring'
  | 'bright spring'
  | 'light summer'
  | 'cool summer'
  | 'soft summer'
  | 'soft autumn'
  | 'warm autumn'
  | 'deep autumn'
  | 'deep winter'
  | 'cool winter'
  | 'bright winter';

export interface SeasonEstimate {
  season: Season;
  scores: Record<Season, number>;
  axes: { undertone: 'warm' | 'cool' | 'neutral'; value: 'light' | 'medium' | 'deep'; chroma: 'clear' | 'medium' | 'soft'; contrast: 'high' | 'medium' | 'low' };
  label: 'estimate';
}
