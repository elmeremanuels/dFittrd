/**
 * prediction.json and exemplar.json (docs/PREDICTION-ENGINE.md §4.1, §4.3). Types only.
 *
 * The predictor has no sizing output (§2): nothing here is a chart girth, an ease the fit engine reads, a
 * stretch the fit engine reads or a pattern block. `material.stretchPct` is simulation only. Girths at the
 * critical anchors stay with the chart (`proxy.ts` `ringGirths`, the fit engine's targets); the pattern
 * parameters fill only what lies between and beyond the anchors.
 */
import type { AnchorRing } from '@curtain/anchors';
import type { FrontClosure, Neckline, SleeveStyle } from '../features';

export const PROXY_KINDS = ['dress', 'skirt', 'trousers', 'top', 'outerwear'] as const;
export type ProxyKind = (typeof PROXY_KINDS)[number];

/**
 * Where a value came from, most trusted first (§3.1; `description`: read from the shop's own text, `library`:
 * the fabric library or the drape table's prior for a known fabric key, `rule`: a P0 rule of the predictor fired on
 * something known (a word, a derivation from a known value), `default`: nothing known, the global fallback, with the
 * widest σ). `synthetic`: not a prediction at all, a value the exporter fixed to a synthetic job's own truth
 * (synthetic stills: the hem of the lofted synthetic garment); a shadow row on it measures nothing.
 */
export const PROVENANCES = ['merchant', 'video', 'swatch', 'calibrated', 'description', 'library', 'rule', 'exemplar', 'regressor', 'default', 'synthetic'] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** A predicted value with its uncertainty (σ, same unit; for log-space material values σ is in natural-log units) and provenance. */
export interface Predicted<T = number> {
  value: T;
  sigma: number | null;
  provenance: Provenance;
  /** Human-readable reason (the rule, the field, the word). */
  source: string;
}

/** A height of the canonical mannequin (`Mannequin.morphHeights` body-chain keys, plus the HPS and the crotch landmarks). */
export type HeightLandmark = 'ankle' | 'calf' | 'knee' | 'thigh' | 'hip' | 'waist' | 'underbust' | 'chest';

/**
 * Where the hem goes, in the mannequin's own terms (the predictor does not know the mannequin's numbers; `proxy.ts`
 * resolves the rule on mannequin M). `printed`: a length the shop printed, from `origin` down (`hps_surface`: along
 * the garment front from the HPS, a flat-lay length). `landmark`: the mean of the landmark heights + `plusCm`.
 */
export type LengthRule =
  | { from: 'printed'; key: 'shoulder_to_hem' | 'waist_to_hem' | 'outseam' | 'inseam'; cm: number; origin: 'hps' | 'waist' | 'crotch'; definition: 'drop' | 'hps_surface' }
  | { from: 'landmark'; at: readonly [HeightLandmark] | readonly [HeightLandmark, HeightLandmark]; plusCm: number };

/**
 * Sleeve length along the arm from the shoulder joint, in the arm's own terms: `ua`, `fa` are the mannequin's
 * upper-arm and forearm lengths, `wrist` its wrist distance along the arm (`morphHeights.wrist`).
 * `printed`: the shop's sleeve length, capped at the wrist + 1.5 cm.
 */
export type SleeveRule =
  | { from: 'none' }
  | { from: 'printed'; cm: number }
  | { from: 'style'; style: SleeveStyle; along: ArmFractions; where: string }
  | { from: 'kind-default'; along: ArmFractions; where: string };

/** cm = round1(ua·upperArm + fa·forearm + wrist·wristDistance + plusCm) (`kind-default`: not rounded). */
export interface ArmFractions {
  ua: number;
  fa: number;
  wrist: number;
  plusCm: number;
}

export const CUT_TOKENS = [
  'maxi', 'midi', 'mini', 'tiered', 'wrap', 'slip', 'smock', 'empire', 'babydoll', 'a-line', 'shift', 'shirt', 'oversized', 'boxy', 'cropped',
  'puff-sleeve', 'bell-sleeve', 'flutter-sleeve', 'batwing-sleeve', 'wide-leg', 'palazzo', 'straight-leg', 'tapered', 'harem', 'jeans',
  'bias', 'lined', 'ruffle', 'fringe', 'asymmetric-hem', 'cut-out', 'cowl', 'peplum', 'patchwork', 'jumpsuit',
] as const;
export type CutToken = (typeof CUT_TOKENS)[number];

/** Cut features outside the v1 pattern vocabulary (§4.4): always GPU. */
export const HARD_FEATURES: readonly CutToken[] = ['wrap', 'bias', 'lined', 'ruffle', 'fringe', 'asymmetric-hem', 'cut-out', 'cowl', 'peplum', 'patchwork', 'jumpsuit'];

export const LENGTH_BANDS = ['cropped', 'hip', 'thigh', 'mini', 'above-knee', 'knee', 'midi', 'maxi', 'full'] as const;
export type LengthBand = (typeof LENGTH_BANDS)[number] | 'unknown';

export interface CutFeatures {
  kind: ProxyKind;
  category: string;
  patternBlock: string | null;
  subcategory: string | null;
  /** Tokens from the title, subcategory and pattern block (`cut.ts`), with the word each came from. */
  tokens: CutToken[];
  tokenEvidence: string[];
  hardFeatures: CutToken[];
  sleeveStyle: SleeveStyle | null;
  front: FrontClosure | null;
  neckline: Neckline | null;
  /** Length band from the length rule (printed lengths banded on mannequin M's proportions is P1 work; P0 bands the rule only). */
  lengthBand: LengthBand;
  /** Elastic or drawstring waist (`stretchZones` holds `waistband`): a skirt or trousers hangs from it. */
  elasticWaist: boolean;
}

export type Region = 'shoulders' | 'bodice' | 'skirt' | 'sleeves' | 'legs';

export interface RegionUncertainty {
  /** Expected surface error of the predicted shape there, cm (P0: rule priors, not yet calibrated against shadow data). */
  sigmaCm: number;
  /** 1 − sigmaCm / 5, clamped to [0, 1]. */
  confidence: number;
  reasons: string[];
}

export interface PatternParams {
  kind: ProxyKind;
  /** Dress/skirt: undraped hem girth over hip girth (before leg clearance). Top/outerwear: hem over hip. Trousers: hem over thigh girth (null: tapered to the ankle). */
  hemFlare: Predicted<number | null>;
  /** Trousers only. */
  legs: { thighOfHip: Predicted; hemOfThigh: Predicted<number | 'ankle'> } | null;
  /**
   * Ease (cm of girth) over the mannequin at a ring where the chart gives no value (a control and template choice, never
   * chart data): off-anchor rings (underbust, thigh, knee, upper arm, wrist) and anchor rings the chart lacks.
   */
  defaultEase: Partial<Record<AnchorRing, Predicted>>;
  length: {
    rule: LengthRule;
    offsetCm: Predicted;
    source: string;
    sigmaCm: number;
    provenance: Provenance;
    /** Set when the exporter fixed the length to a synthetic job's truth (`withSyntheticLength`): the rule the predictor gave. */
    overridden?: { rule: LengthRule; source: string; sigmaCm: number; provenance: Provenance };
  };
  sleeve: { rule: SleeveRule; style: SleeveStyle | null; source: string; sigmaCm: number; provenance: Provenance };
  /** Outerwear front opening words (the geometry is `proxy.ts` `frontOpeningFor`, on mannequin M). */
  front: { front: FrontClosure | null; neckline: Neckline | null } | null;
  tiers: number | null;
  elasticWaist: boolean;
}

export interface MaterialPrediction {
  /**
   * Fabric key: fibres (normalised %) and construction. `provenance` is the fibre's (`default` when no fibre is known,
   * even if a construction word is: "knit" says nothing about the fibre); `constructionProvenance` is the construction's.
   */
  key: { fibres: { id: string; pct: number }[]; fibreKnown: boolean; construction: string | null; constructionProvenance: Provenance | null; provenance: Provenance; source: string; cell: string };
  weightGsm: Predicted;
  massKgM2: Predicted;
  /** Simulation only (§2): never written to the payload and never read by the fit engine. */
  stretchPct: Predicted;
  /** N/m; warp and weft equal in P0 (isotropic). */
  stretchStiffness: { warp: Predicted; weft: Predicted };
  shearStiffness: Predicted;
  /** KES-F B, gf·cm²/cm, and N·m. */
  bendStiffness: Predicted;
  bendStiffnessNm: Predicted;
  damping: Predicted;
  friction: Predicted;
  thicknessMm: Predicted;
  drape: Predicted;
  sheen: Predicted;
  opacity: Predicted;
  texture: Predicted<string>;
  /** θ = (log B, log k_stretch, log k_shear, log damping, μ) of the table cell, and how many observations it holds per level. */
  theta: { logB: number; logStretch: number; logShear: number; logDamping: number; friction: number };
  levels: { level: 'global' | 'fibre' | 'construction' | 'cell'; key: string; observations: number }[];
}

export interface Prediction {
  format: 'curtain.drape.prediction';
  formatVersion: 1;
  predictorVersion: string;
  tier: 'P0';
  drapeTableVersion: string;
  fabricLibraryVersion: string;
  exemplars: { count: number; setHash: string; used: number };
  productId: string;
  /** The payload's own id (`GarmentPayload.id`; a shop product's id is its handle, its payload id the shop's number): `proxy.ts` refuses a prediction made for another payload. */
  payloadId: string;
  baseSize: string;
  cut: CutFeatures;
  /** Exemplar cell key (§4.3): proxy kind | pattern block | length band | fabric class. */
  cell: string;
  material: MaterialPrediction;
  pattern: PatternParams;
  regions: Partial<Record<Region, RegionUncertainty>>;
  /** P0 always routes to the GPU (design `full`). */
  route: { decision: 'gpu'; designRoute: 'full'; reasons: string[] };
  confidence: { value: number; reasons: string[] };
  notes: string[];
}

/** One measured garment (§4.3 P1): numbers only, no image bytes. */
export interface Exemplar {
  format: 'curtain.drape.exemplar';
  formatVersion: 1;
  productId: string;
  familyId: string | null;
  cell: string;
  kind: ProxyKind;
  source: 'stage4t-stage2' | 'stage4t-synthetic';
  /** Measured pattern parameters on the stage 4t mesh (cm, ratios). null: not measurable on this mesh. */
  pattern: MeasuredPattern;
  /**
   * The material the asset was PREDICTED with (the prior), copied from prediction.json: stage 4t measures shape, not
   * material, so this is never an observation. §5 calibration must not read it as one (`materialSource`).
   */
  material: MaterialPrediction;
  materialSource: 'prediction-prior';
  /** The cell key is the prediction's (cut words and the prior's fabric class), not measured. */
  cellSource: 'prediction';
  quality: { holdoutVisibleIou: number | null; holdoutSilhouetteIou: number | null; trainVisibleIou: number | null; insideBody: number | null; approved: boolean };
  versions: Record<string, string>;
  /** sha256 of the mesh the numbers were measured on (positions + indices). */
  meshSha256: string;
}

export interface MeasuredPattern {
  /** Girth per anchor ring (tape, `tape.ts`), cm. */
  girthsCm: Partial<Record<AnchorRing, number>>;
  /** Girth minus the mannequin's ring girth, cm. */
  easeCm: Partial<Record<AnchorRing, number>>;
  hemY: number | null;
  hemGirthCm: number | null;
  /** Dress/skirt/top/outerwear: hem girth over hip girth; trousers: leg hem over thigh. */
  hemFlare: number | null;
  thighOfHip: number | null;
  /** The length in the definition the prediction's rule uses (HPS surface, drop, outseam, waist to hem), cm. */
  lengthCm: number | null;
  lengthDefinition: string | null;
  sleeveCm: number | null;
  /** Upper-arm and wrist girth over the mannequin's (sleeve volume profile). */
  upperArmRatio: number | null;
  cuffRatio: number | null;
  /** Front-to-back depth over width at the hip and just above the hem. */
  depthRatio: { hip: number | null; hem: number | null };
}
