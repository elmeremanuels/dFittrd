/**
 * Analytic v1 measurement (DECISIONS.md D5): per-level width (front) × depth (side) → Ramanujan
 * ellipse girth, scale from the user's height over the pixel head-top → heel span, blended with the
 * population prior for the mean, clothing coverage as a quality gate.
 *
 * This file is the interface a trained ONNX regressor (post-MVP) drops in behind: `measureScan`
 * takes the same inputs and returns the same `ScanMeasurements`.
 */
import { populationPrior, type PriorLevel } from './prior';
import { landmarkSpans } from './crossSections';
import type { GirthEstimate, Level, ScanMeasurements, Sex, ViewMeasurement } from './types';

/** Ramanujan's first approximation of the ellipse perimeter with semi-axes a, b. */
export function ellipsePerimeter(a: number, b: number): number {
  if (!(a >= 0) || !(b >= 0)) return Number.NaN;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/**
 * cm per pixel from the user's stature and the pixel distance head-top → heel, corrected for camera
 * tilt (the body axis leaning by θ shortens the projected height by cos θ).
 */
export function scaleCmPerPx(heightCm: number, headTopPx: number, heelPx: number, tiltDeg = 0): number {
  const span = (heelPx - headTopPx) / Math.cos((tiltDeg * Math.PI) / 180);
  if (!(span > 0) || !(heightCm > 0)) return Number.NaN;
  return heightCm / span;
}

/** Per-girth scan sigma (cm) for v1 (body-scan.md §Accuracy evidence → verdict). */
export const SCAN_SIGMA_CM: Record<Level, number> = {
  neck: 1.5,
  shoulder: 2.5,
  bust: 3.0,
  underbust: 3.0,
  waist: 3.0,
  hip: 2.5,
  thigh: 3.5,
  knee: 1.5,
  calf: 1.5,
  ankle: 1.0,
  upperArm: 2.0,
  wrist: 1.0,
};

/** Typical depth / width ratio per level, used when no side view is available. */
export const DEFAULT_ASPECT: Record<Level, number> = {
  neck: 0.95,
  shoulder: 0.5,
  bust: 0.72,
  underbust: 0.72,
  waist: 0.78,
  hip: 0.72,
  thigh: 0.95,
  knee: 1.0,
  calf: 1.0,
  ankle: 1.1,
  upperArm: 1.0,
  wrist: 0.75,
};

/** Levels whose width is measured on a limb blob (both limbs exist; girth of one). */
const LIMB_LEVELS: ReadonlySet<Level> = new Set<Level>(['thigh', 'knee', 'calf', 'ankle', 'upperArm', 'wrist']);

/**
 * Levels whose side-view "depth" cannot be measured: in a side view the arms hang over the torso
 * and hips, so the run at the upper-arm or wrist level is the torso/hip depth (≈ 25 cm), which
 * would double the arm girth. These always use the population aspect (σ inflated).
 */
export const SIDE_DEPTH_UNRELIABLE: ReadonlySet<Level> = new Set<Level>(['upperArm', 'wrist']);

/** Sigma inflation when depth is a population guess rather than a measured side view. */
const NO_SIDE_SIGMA_FACTOR = 1.35;
/** Fitted clothing adds roughly this much to a girth; scaled by coverage. */
const CLOTHING_ALLOWANCE_CM = 1.0;
/** Extra sigma per unit coverage (loose garments are the largest error source). */
const CLOTHING_SIGMA_CM = 1.0;

/** Girth from a width and depth (cm). Falls back to a per-level default aspect when depth is missing. */
export function girthFromWidthDepth(level: Level, widthCm: number, depthCm?: number): GirthEstimate {
  const hasDepth = depthCm !== undefined && Number.isFinite(depthCm) && depthCm > 0;
  const d = hasDepth ? (depthCm as number) : widthCm * DEFAULT_ASPECT[level];
  const g = ellipsePerimeter(widthCm / 2, d / 2);
  const sigma = SCAN_SIGMA_CM[level] * (hasDepth ? 1 : NO_SIDE_SIGMA_FACTOR);
  return { mean: g, sigma, widthCm, depthCm: d, aspect: widthCm > 0 ? d / widthCm : undefined };
}

/**
 * Coverage quality gate: 0..1 quality from clothing coverage of the torso levels. Fitted clothing
 * is fine (we cannot see looseness), but heavy coverage lowers quality and inflates sigma.
 */
export function coverageQuality(coverages: readonly number[]): number {
  const v = coverages.filter((c) => Number.isFinite(c));
  if (v.length === 0) return 0.5;
  const mean = v.reduce((s, c) => s + c, 0) / v.length;
  return Math.max(0, Math.min(1, 1 - 0.4 * mean));
}

export interface MeasureInput {
  heightCm: number;
  weightKg?: number | undefined;
  sex?: Sex | undefined;
  front: ViewMeasurement;
  side?: ViewMeasurement | null | undefined;
  /** 0..1 share of recorded frames that passed the gate (feeds captureQuality). */
  gatePassRate?: number | undefined;
}

/**
 * Turn the worker's per-view level samples into girths, lengths, posture and a quality score.
 * The mean of bust/waist/hip/thigh is blended with the population prior by inverse variance
 * (the ellipse alone over-/under-estimates by several cm), but the reported sigma stays the
 * published-style v1 table: ellipse and prior errors are not independent of real-world clothing and
 * pose error, so the formal inverse-variance sigma would be over-confident. This keeps scan-only
 * confidence at the handoff's ~60 %.
 */
export function measureScan(input: MeasureInput): ScanMeasurements {
  const warnings: string[] = [];
  const { front, side } = input;
  const scaleF = scaleCmPerPx(input.heightCm, front.headTopPx, front.heelPx, front.tiltDeg);
  if (!Number.isFinite(scaleF)) {
    return { girths: {}, lengths: {}, posture: {}, quality: 0, warnings: ['front scale could not be established'] };
  }
  const scaleS = side ? scaleCmPerPx(input.heightCm, side.headTopPx, side.heelPx, side.tiltDeg) : Number.NaN;
  if (side && !Number.isFinite(scaleS)) warnings.push('side scale could not be established; using population depth ratios');
  const sideOk = side !== undefined && side !== null && Number.isFinite(scaleS);
  if (!sideOk) warnings.push('no side view: depths are population estimates (σ inflated)');

  const girths: Partial<Record<Level, GirthEstimate>> = {};
  const covs: number[] = [];
  for (const s of front.samples) {
    if (!Number.isFinite(s.px) || s.px <= 0) {
      warnings.push(s.contact ? `${s.level}: a limb touches the body at this level (not measured)` : `${s.level}: no silhouette at level`);
      continue;
    }
    const widthCm = s.px * scaleF;
    let depthCm: number | undefined;
    if (sideOk && !SIDE_DEPTH_UNRELIABLE.has(s.level)) {
      const ss = side?.samples.find((q) => q.level === s.level);
      if (ss && Number.isFinite(ss.px) && ss.px > 0) depthCm = ss.px * scaleS;
    }
    const g = girthFromWidthDepth(s.level, widthCm, depthCm);
    // clothing: subtract a small allowance, inflate sigma with coverage
    const cov = s.coverage;
    g.mean -= CLOTHING_ALLOWANCE_CM * cov;
    g.sigma = Math.sqrt(g.sigma * g.sigma + (CLOTHING_SIGMA_CM * cov) ** 2);
    g.coverage = cov;
    if (!LIMB_LEVELS.has(s.level)) covs.push(cov);
    girths[s.level] = g;
  }

  // Blend bust/waist/hip/thigh means with the population prior.
  if (input.weightKg !== undefined) {
    const prior = populationPrior({ heightCm: input.heightCm, weightKg: input.weightKg, sex: input.sex ?? 'unspecified' });
    if (prior) {
      for (const level of Object.keys(prior) as PriorLevel[]) {
        const g = girths[level];
        const p = prior[level];
        if (!g || !p) continue;
        // ellipse-on-silhouette error is larger than the published table; weight it like σ = 4 cm
        const wS = 1 / 16;
        const wP = 1 / (p.sigma * p.sigma);
        g.mean = (g.mean * wS + p.mean * wP) / (wS + wP);
      }
    }
  }
  for (const g of Object.values(girths)) {
    g.mean = round1(g.mean);
    g.sigma = round2(g.sigma);
    if (g.widthCm !== undefined) g.widthCm = round1(g.widthCm);
    if (g.depthCm !== undefined) g.depthCm = round1(g.depthCm);
    if (g.aspect !== undefined) g.aspect = round2(g.aspect);
  }

  // Lengths from front landmarks (cm). Vertical scale = scaleF; horizontal uses the frame aspect.
  const sp = landmarkSpans(front.landmarks);
  const H = front.height;
  const W = front.width;
  const vcm = (dyNorm: number): number => dyNorm * H * scaleF;
  const hcm = (dxNorm: number): number => dxNorm * W * scaleF;
  const crotchY = sp.hipMidY + 0.1 * (sp.hipMidY - sp.shoulderMidY);
  const waistY = sp.shoulderMidY + 0.625 * (sp.hipMidY - sp.shoulderMidY);
  const bustY = sp.shoulderMidY + 0.375 * (sp.hipMidY - sp.shoulderMidY);
  const lengths: Partial<Record<string, number>> = {
    stature: input.heightCm,
    inseam: round1(vcm(sp.heelY - crotchY)),
    shoulderToWaistFront: round1(vcm(waistY - sp.shoulderMidY)),
    torsoShoulderToHip: round1(vcm(sp.hipMidY - sp.shoulderMidY)),
    armLength: round1(Math.hypot(hcm(sp.armLen.dx), vcm(sp.armLen.dy))),
    biacromialBreadth: round1(hcm(sp.biacromialX)),
    bustPointHeight: round1(vcm(sp.heelY - bustY)),
    waistHeight: round1(vcm(sp.heelY - waistY)),
    hipHeight: round1(vcm(sp.heelY - sp.hipMidY)),
    kneeHeight: round1(vcm(sp.heelY - sp.kneeY)),
  };

  // Posture / shape descriptors.
  const posture: Partial<Record<string, number>> = {};
  // Shoulder slope comes from the mask contour (ViewMeasurement.shoulderSlopeDeg). The ear→shoulder
  // landmark angle is ≈ 50–80° for every body (it is the neck, not the shoulder line) and is not used.
  if (front.shoulderSlopeDeg !== undefined && Number.isFinite(front.shoulderSlopeDeg)) {
    posture.shoulderSlopeDeg = round1(Math.max(0, Math.min(45, front.shoulderSlopeDeg)));
  }
  if (sideOk && side) posture.forwardLeanDeg = round1(side.tiltDeg);
  const b = girths.bust?.mean;
  const w = girths.waist?.mean;
  const h = girths.hip?.mean;
  if (b && w) posture.bustToWaist = round2(b / w);
  if (w && h) posture.waistToHip = round2(w / h);
  if (b && h) posture.shoulderToHip = round2((lengths.biacromialBreadth ?? 0) > 0 ? (lengths.biacromialBreadth as number) / h : b / h);
  if (w) posture.waistToHeight = round2(w / input.heightCm);
  if (lengths.inseam && lengths.torsoShoulderToHip) posture.limbToTorso = round2(lengths.inseam / lengths.torsoShoulderToHip);

  const quality = round2(
    Math.max(0, Math.min(1, 0.6 * coverageQuality(covs) + 0.25 * (sideOk ? 1 : 0.4) + 0.15 * (input.gatePassRate ?? 0.5))),
  );

  return { girths, lengths, posture, quality, warnings };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
