/**
 * Stage 5 — anchoring (docs/ENGINE-HANDOFF.md). Intersect the garment mesh with every anchor plane
 * of the mannequin: per ring the garment loop (its vertices), its girth and its offset from the body
 * ring; per length the point where the garment's edge meets the mannequin's length line. Then
 * calibrate against the size chart (and the merchant's sample measurements when given): one global
 * scale plus per-ring corrections. The residual after the global scale is the QA metric.
 */
import { gradingMorph, type AnchorLength, type AnchorRing, type AnchorValues } from '@curtain/anchors';
import { dot, loopAround, loopContains, loopLength, planeCoords, resampleLoop, slice, sub, type Loop, type Mannequin, type Mesh, type RingFrame, type Vec3 } from '@curtain/mannequin';
import { assignChains, categoryRings, radialMorph, type ChainAssignment, type SpikeCategory } from './garment';
import { densifyLoop, pointsOfPart, tapeGirth, type TapeGirth } from './tape';

export interface RingMeasurement {
  id: AnchorRing;
  circumferenceCm: number;
  /** The garment loop resampled to `LOOP_POINTS` points, starting at the front. */
  loop: Vec3[];
  /** Radial distance garment − body ring in the ring plane, cm; `null` when the loop spans both legs. */
  offsetCm: { mean: number; min: number; max: number } | null;
  /** The loop encloses both legs (a skirt at thigh or knee height). */
  spansBothLegs: boolean;
  /** `girth: 'tape'` only: how the tape went round (coverage, bridged gap, points used). */
  tape?: Omit<TapeGirth, 'loop' | 'girthCm'> & { loopLengthCm: number | null };
}

/**
 * How a ring's girth is taken. `loop` (default): the length of the closed slice loop around the
 * ring centre, exact on smooth meshes (the synthetic garments). `tape`: a tape measure round the
 * outside of the slice (`src/tape.ts`), for noisy reconstructions with holes and sleeves fused to
 * the bodice; with `body` (the mannequin mesh) only the ring's own body part is measured.
 */
export interface MeasureOptions {
  girth?: 'loop' | 'tape';
  body?: Mesh;
  /**
   * `girth: 'tape'`: the widest front opening (chord, cm) bridged at a ring at height y, the fronts laid closed
   * (outerwear with an opening; `TapeOptions.frontOpeningCm`). 0 or absent: no front opening is bridged at that ring.
   */
  frontOpeningAt?: (y: number) => number;
}

export interface LengthMeasurement {
  id: AnchorLength;
  lengthCm: number;
  /** Where the length starts and where the garment edge meets the line. */
  start: Vec3;
  end: Vec3;
  /** `true` when the value is the mannequin's own length (the garment only has to cover it). */
  fromMannequin: boolean;
}

export interface AnchorMeasurements {
  rings: Partial<Record<AnchorRing, RingMeasurement>>;
  lengths: Partial<Record<AnchorLength, LengthMeasurement>>;
}

export const LOOP_POINTS = 32;

/** Polar radius of an ellipse with semi-axes a (along u) and b (along v) at angle θ from u. */
import { ellipseRadius } from './garment';

function mirror(p: Vec3): Vec3 {
  return [-p[0], p[1], p[2]];
}

export function measureRing(mesh: Mesh, ring: RingFrame, opts: MeasureOptions = {}): RingMeasurement | null {
  const loops = slice(mesh.positions, mesh.indices, { origin: ring.centre, normal: ring.normal });
  const closedLoop = loopAround(loops, ring.centre, ring.u, ring.v);
  const spansBothLegs = closedLoop !== null && ring.side === 'left' && ring.part.startsWith('leg') && closedLoop === loopAround(loops, mirror(ring.centre), ring.u, ring.v);
  let loop: Loop | null = closedLoop;
  let tape: RingMeasurement['tape'];
  if (opts.girth === 'tape') {
    // A skirt round both legs is measured round its own middle; otherwise only the ring's body part.
    const centre: Vec3 = spansBothLegs ? [0, ring.centre[1], ring.centre[2]] : ring.centre;
    const dense = (closedLoop ? [closedLoop] : loops).map((l) => densifyLoop(l));
    const all: Vec3[] = dense.flatMap((l) => l.points);
    let pts = all;
    if (opts.body && !spansBothLegs) {
      const bodyLoops = slice(opts.body.positions, opts.body.indices, { origin: ring.centre, normal: ring.normal });
      const own = loopAround(bodyLoops, ring.centre, ring.u, ring.v);
      // A closed loop that holds another body part (a sleeve fused to the bodice) or no closed loop: keep the own part's points.
      const centroid = (l: Loop): Vec3 => l.points.reduce<Vec3>((a, p) => [a[0] + p[0] / l.points.length, a[1] + p[1] / l.points.length, a[2] + p[2] / l.points.length], [0, 0, 0]);
      const fused = closedLoop !== null && bodyLoops.some((b) => b !== own && b.points.length > 2 && loopContains(closedLoop, centroid(b), ring.u, ring.v));
      if (own && (closedLoop === null || fused)) pts = pointsOfPart(dense, bodyLoops, own);
    }
    const frontCap = opts.frontOpeningAt ? opts.frontOpeningAt(ring.centre[1]) : 0;
    const t = tapeGirth(pts, centre, ring.u, ring.v, frontCap > 0 ? { frontOpeningCm: frontCap } : {}, all);
    if (!t) return null;
    loop = t.loop;
    tape = { coverage: t.coverage, maxGapDeg: t.maxGapDeg, maxGapCm: t.maxGapCm, frontGapCm: t.frontGapCm, points: t.points, loopLengthCm: closedLoop ? loopLength(closedLoop) : null };
  }
  if (!loop) return null;
  let offsetCm: RingMeasurement['offsetCm'] = null;
  if (!spansBothLegs) {
    const offsets = loop.points.map((p) => {
      const [x, z] = planeCoords(p, ring.centre, ring.u, ring.v);
      return Math.hypot(x, z) - ellipseRadius(ring.a, ring.b, Math.atan2(z, x));
    });
    offsetCm = { mean: offsets.reduce((s, o) => s + o, 0) / offsets.length, min: Math.min(...offsets), max: Math.max(...offsets) };
  }
  return { id: ring.id, circumferenceCm: loopLength(loop), loop: resampleLoop(loop, LOOP_POINTS, ring.centre, ring.v), offsetCm, spansBothLegs, ...(tape ? { tape } : {}) };
}

/** Lowest point of the garment's front (z > 0) in the sagittal plane through `x`. */
function hemBelow(mesh: Mesh, x: number): { y: number; maxY: number; point: Vec3 } | null {
  const loops = slice(mesh.positions, mesh.indices, { origin: [x, 0, 0], normal: [1, 0, 0] });
  let best: Vec3 | null = null;
  let maxY = -Infinity;
  for (const l of loops) {
    for (const p of l.points) {
      if (p[2] <= 0) continue;
      if (!best || p[1] < best[1]) best = p;
      if (p[1] > maxY) maxY = p[1];
    }
  }
  return best ? { y: best[1], maxY, point: best } : null;
}

export function measureGarment(m: Mannequin, mesh: Mesh, category: SpikeCategory, chains: ChainAssignment = assignChains(m, mesh), opts: MeasureOptions = {}): AnchorMeasurements {
  const rings: AnchorMeasurements['rings'] = {};
  const subset = new Set(categoryRings(category));
  for (const ring of m.rings) {
    if (!subset.has(ring.id)) continue;
    const r = measureRing(mesh, ring, opts);
    if (r) rings[ring.id] = r;
  }
  const lengths: AnchorMeasurements['lengths'] = {};
  const line = (id: AnchorLength) => m.lengths.find((l) => l.id === id)!;
  const hps = line('shoulder_to_hem').start;
  const front = hemBelow(mesh, hps[0]);
  if (front && front.maxY > hps[1] - 10) {
    lengths.shoulder_to_hem = { id: 'shoulder_to_hem', lengthCm: hps[1] - front.y, start: hps, end: [hps[0], front.y, front.point[2]], fromMannequin: false };
    const stw = line('shoulder_to_waist');
    if (front.y < stw.bodyEnd[1]) lengths.shoulder_to_waist = { id: 'shoulder_to_waist', lengthCm: stw.bodyLengthCm, start: stw.start, end: stw.bodyEnd, fromMannequin: true };
  }
  const wl = line('waist_to_hem');
  const centre = hemBelow(mesh, wl.start[0]);
  if (centre && centre.maxY > wl.start[1] && centre.y < wl.start[1]) {
    lengths.waist_to_hem = { id: 'waist_to_hem', lengthCm: wl.start[1] - centre.y, start: wl.start, end: [wl.start[0], centre.y, centre.point[2]], fromMannequin: false };
  }
  const arm = m.arms.left;
  let maxS = -Infinity;
  for (let i = 0; i < chains.length; i++) {
    if (chains[i] !== 1) continue;
    const s = dot(sub([mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!], arm.joint), arm.axis);
    if (s > maxS) maxS = s;
  }
  if (maxS > 2) {
    const end: Vec3 = [arm.joint[0] + arm.axis[0] * maxS, arm.joint[1] + arm.axis[1] * maxS, arm.joint[2] + arm.axis[2] * maxS];
    lengths.sleeve = { id: 'sleeve', lengthCm: maxS, start: arm.joint, end, fromMannequin: false };
  }
  return { rings, lengths };
}

export function ringGirths(meas: AnchorMeasurements): Partial<Record<AnchorRing, number>> {
  const out: Partial<Record<AnchorRing, number>> = {};
  for (const [id, r] of Object.entries(meas.rings) as [AnchorRing, RingMeasurement][]) out[id] = r.circumferenceCm;
  return out;
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export interface CalibrationInput {
  /** Girths measured on the reconstructed base-size garment. */
  measured: Partial<Record<AnchorRing, number>>;
  /** Size-chart girths of the base size (garment girths). */
  chart: Partial<Record<AnchorRing, number>>;
  /** The merchant's own flat measurements of the photographed sample, as girths (2 × flat width). Wins over the chart. */
  sample?: Partial<Record<AnchorRing, number>>;
}

export interface ResidualStats {
  rmsCm: number;
  maxAbsCm: number;
  perRingCm: Partial<Record<AnchorRing, number>>;
}

export interface Calibration {
  /** Least-squares scale of measured onto target girths over the rings with a target. */
  globalScale: number;
  /** Final target girth of every measured ring (sample, chart, or measured × global scale). */
  targets: Partial<Record<AnchorRing, number>>;
  sources: Partial<Record<AnchorRing, 'sample' | 'chart' | 'global'>>;
  /** `target / (measured × globalScale)` per ring with a target: the per-ring corrections. */
  ringCorrections: Partial<Record<AnchorRing, number>>;
  /** Measured − target before any calibration. */
  residualBefore: ResidualStats;
  /** globalScale × measured − target: what the per-ring corrections had to fix (QA metric). */
  residualAfterGlobal: ResidualStats;
}

function stats(diffs: Partial<Record<AnchorRing, number>>): ResidualStats {
  const v = Object.values(diffs) as number[];
  return {
    rmsCm: v.length ? Math.sqrt(v.reduce((s, d) => s + d * d, 0) / v.length) : 0,
    maxAbsCm: v.length ? Math.max(...v.map(Math.abs)) : 0,
    perRingCm: diffs,
  };
}

export function calibrate(input: CalibrationInput): Calibration {
  const ids = Object.keys(input.measured) as AnchorRing[];
  const targeted = ids.filter((id) => (input.sample?.[id] ?? input.chart[id]) !== undefined);
  let num = 0, den = 0;
  for (const id of targeted) {
    const mv = input.measured[id]!;
    const t = input.sample?.[id] ?? input.chart[id]!;
    num += mv * t;
    den += mv * mv;
  }
  const globalScale = den > 0 ? num / den : 1;
  const targets: Calibration['targets'] = {};
  const sources: Calibration['sources'] = {};
  const corrections: Calibration['ringCorrections'] = {};
  const before: Partial<Record<AnchorRing, number>> = {};
  const afterGlobal: Partial<Record<AnchorRing, number>> = {};
  for (const id of ids) {
    const mv = input.measured[id]!;
    const sample = input.sample?.[id];
    const chart = input.chart[id];
    if (sample !== undefined || chart !== undefined) {
      const t = (sample ?? chart)!;
      targets[id] = t;
      sources[id] = sample !== undefined ? 'sample' : 'chart';
      corrections[id] = t / (mv * globalScale);
      before[id] = mv - t;
      afterGlobal[id] = mv * globalScale - t;
    } else {
      targets[id] = mv * globalScale;
      sources[id] = 'global';
    }
  }
  return { globalScale, targets, sources, ringCorrections: corrections, residualBefore: stats(before), residualAfterGlobal: stats(afterGlobal) };
}

/** The calibrated base mesh: each ring scaled to its target, smooth in between (the grading morph of `@curtain/anchors`). */
export function applyCalibration(m: Mannequin, mesh: Mesh, measured: Partial<Record<AnchorRing, number>>, cal: Calibration, chains: ChainAssignment = assignChains(m, mesh), heights: Mannequin['morphHeights'] = m.morphHeights): Mesh {
  const morph = gradingMorph(measured as AnchorValues, cal.targets as AnchorValues, { heights });
  const hasArm = morph.scales.upper_arm !== undefined || morph.scales.wrist !== undefined;
  return radialMorph(m, mesh, chains, { girthScaleAt: (h, chain) => (chain === 'arm' && !hasArm ? cal.globalScale : morph.girthScaleAt(h, chain)) });
}

export interface ChartAgreement {
  toleranceCm: number;
  perRingCm: Partial<Record<AnchorRing, number>>;
  maxAbsCm: number;
  pass: boolean;
}

/** QA "chart agreement": calibrated girth − chart girth at the critical rings (Phase 0 tolerance ±2 cm). */
export function chartAgreement(measured: Partial<Record<AnchorRing, number>>, chart: Partial<Record<AnchorRing, number>>, critical: readonly AnchorRing[], toleranceCm = 2): ChartAgreement {
  const perRingCm: Partial<Record<AnchorRing, number>> = {};
  for (const id of critical) if (measured[id] !== undefined && chart[id] !== undefined) perRingCm[id] = measured[id]! - chart[id]!;
  const v = Object.values(perRingCm) as number[];
  const maxAbsCm = v.length ? Math.max(...v.map(Math.abs)) : Infinity;
  return { toleranceCm, perRingCm, maxAbsCm, pass: v.length > 0 && maxAbsCm <= toleranceCm };
}
