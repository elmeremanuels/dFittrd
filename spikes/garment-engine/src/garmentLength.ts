/**
 * Garment length definitions (the 83.3 cm vs printed 91 cm question of run 14). A shop's "Length" of
 * a dress is a flat measurement: the garment laid flat, a tape from a start point straight down to
 * the hem. Laid flat, the front panel's length is its surface length, so on the worn 3D garment the
 * comparable number is the path ALONG the garment, not the vertical drop: a worn dress goes forward
 * over the bust and out over a flared skirt, and its hem sits higher than the printed length says.
 *
 * Measured here on a garment mesh on the mannequin (cm, mannequin space), each from a different start:
 *
 *   hps_drop          high point shoulder (the mannequin's landmark) straight down to the front hem:
 *                     the spike's `measureGarment` shoulder_to_hem so far;
 *   hps_surface       from the HPS height along the garment's front surface in the sagittal plane
 *                     through the HPS to the front hem (a gap such as a V-neck is bridged straight):
 *                     the flat-lay "Length from the high point shoulder";
 *   back_neck_surface from the garment's back neckline at the centre back down its back surface to the
 *                     back hem (the "back length" some shops print);
 *   shoulder_point_drop from the end of the shoulder (the mannequin's shoulder ring at its widest)
 *                     straight down to the front hem at that x: a "shoulder seam" length.
 */
import { slice, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';

/** Height over which a profile is smoothed before its length is taken, cm (a tape bridges folds and noise). */
export const PROFILE_SMOOTH_CM = 4;

export const LENGTH_DEFINITIONS = ['hps_drop', 'hps_surface', 'back_neck_surface', 'shoulder_point_drop'] as const;
export type LengthDefinition = (typeof LENGTH_DEFINITIONS)[number];

export const LENGTH_LABEL: Readonly<Record<LengthDefinition, string>> = {
  hps_drop: 'high point shoulder, vertical drop to the front hem',
  hps_surface: 'high point shoulder, along the garment front to the hem (flat-lay length)',
  back_neck_surface: 'back neck at the centre back, along the garment back to the hem',
  shoulder_point_drop: 'shoulder point (end of the shoulder), vertical drop to the front hem',
};

export interface ProfilePoint {
  y: number;
  /** Outer surface's depth (front: max z; back: min z) in this height bin. */
  z: number;
}

/**
 * The garment's front (side = 1) or back (side = −1) profile in the plane x = `x`: per `binCm` of
 * height the outermost z among the slice points on that side, top to bottom, smoothed over
 * `smoothCm` of height (median, then mean). Empty bins are bridged by straight lines (a neckline
 * opening, a hole).
 */
export function sagittalProfile(mesh: Pick<Mesh, 'positions' | 'indices'>, x: number, side: 1 | -1, binCm = 0.5, smoothCm = PROFILE_SMOOTH_CM): ProfilePoint[] {
  const loops = slice(mesh.positions, mesh.indices, { origin: [x, 0, 0], normal: [1, 0, 0] });
  const pts: Vec3[] = [];
  for (const l of loops) for (const p of l.points) if (side * p[2] > 0) pts.push(p);
  if (pts.length < 2) return [];
  const top = Math.max(...pts.map((p) => p[1]));
  const bottom = Math.min(...pts.map((p) => p[1]));
  const n = Math.max(1, Math.ceil((top - bottom) / binCm));
  const z = new Float64Array(n + 1).fill(NaN);
  for (const p of pts) {
    const k = Math.min(n, Math.round((top - p[1]) / binCm));
    if (Number.isNaN(z[k]!) || side * p[2] > side * z[k]!) z[k] = p[2];
  }
  const raw: ProfilePoint[] = [];
  for (let k = 0; k <= n; k++) if (!Number.isNaN(z[k]!)) raw.push({ y: top - k * binCm, z: z[k]! });
  // Exact ends: the top and the hem are the extreme points, not bin centres.
  raw[0] = { y: top, z: raw[0]!.z };
  raw[raw.length - 1] = { y: bottom, z: raw[raw.length - 1]!.z };
  if (smoothCm <= 0 || raw.length < 5) return raw;
  // A tape lies over folds and surface noise, not into them: median, then mean, over `smoothCm` of height.
  const half = Math.max(1, Math.round(smoothCm / binCm / 2));
  const med = raw.map((_, i) => {
    const w = raw.slice(Math.max(0, i - half), i + half + 1).map((q) => q.z).sort((a, b) => a - b);
    return w[w.length >> 1]!;
  });
  return raw.map((q, i) => {
    const w = med.slice(Math.max(0, i - half), i + half + 1);
    return { y: q.y, z: w.reduce((a, b) => a + b, 0) / w.length };
  });
}

export function profileLength(profile: readonly ProfilePoint[], fromY = Infinity): number {
  let len = 0;
  let prev: ProfilePoint | null = null;
  for (const p of profile) {
    if (p.y > fromY) continue;
    if (!prev) {
      // Start exactly at fromY when the profile reaches above it.
      const above = profile.filter((q) => q.y > fromY);
      if (above.length && Number.isFinite(fromY)) {
        const a = above[above.length - 1]!;
        const t = (a.y - fromY) / Math.max(1e-9, a.y - p.y);
        prev = { y: fromY, z: a.z + t * (p.z - a.z) };
      } else prev = p;
    }
    len += Math.hypot(p.y - prev.y, p.z - prev.z);
    prev = p;
  }
  return len;
}

export interface LengthMeasure {
  definition: LengthDefinition;
  label: string;
  lengthCm: number | null;
  start: Vec3 | null;
  hemY: number | null;
  note: string | null;
}

/** Every definition on one mesh. */
export function garmentLengths(m: Mannequin, mesh: Pick<Mesh, 'positions' | 'indices'>): LengthMeasure[] {
  const hps = m.landmarks.hps;
  const out: LengthMeasure[] = [];
  const front = sagittalProfile(mesh, hps[0], 1);
  const r1 = (x: number): number => Math.round(x * 100) / 100;
  if (front.length >= 2) {
    const hem = front[front.length - 1]!;
    out.push({ definition: 'hps_drop', label: LENGTH_LABEL.hps_drop, lengthCm: r1(hps[1] - hem.y), start: [...hps] as Vec3, hemY: r1(hem.y), note: null });
    const topY = front[0]!.y;
    // From the HPS height; when the garment's top at this x is below it, bridge straight from the HPS.
    let len = profileLength(front, hps[1]);
    let note: string | null = null;
    if (topY < hps[1] - 0.5) {
      len += Math.hypot(hps[1] - topY, front[0]!.z - hps[2]);
      note = `the garment starts ${r1(hps[1] - topY)} cm below the HPS at this x (neckline); bridged straight`;
    }
    out.push({ definition: 'hps_surface', label: LENGTH_LABEL.hps_surface, lengthCm: r1(len), start: [...hps] as Vec3, hemY: r1(hem.y), note });
  } else {
    out.push({ definition: 'hps_drop', label: LENGTH_LABEL.hps_drop, lengthCm: null, start: null, hemY: null, note: 'no garment in the plane through the HPS' });
    out.push({ definition: 'hps_surface', label: LENGTH_LABEL.hps_surface, lengthCm: null, start: null, hemY: null, note: 'no garment in the plane through the HPS' });
  }
  const back = sagittalProfile(mesh, 0, -1);
  if (back.length >= 2) {
    const top = back[0]!, hem = back[back.length - 1]!;
    out.push({ definition: 'back_neck_surface', label: LENGTH_LABEL.back_neck_surface, lengthCm: r1(profileLength(back)), start: [0, top.y, top.z], hemY: r1(hem.y), note: null });
  } else out.push({ definition: 'back_neck_surface', label: LENGTH_LABEL.back_neck_surface, lengthCm: null, start: null, hemY: null, note: 'no garment at the centre back' });
  const sh = m.rings.find((r) => r.id === 'shoulder');
  const t = m.torsoAt(m.morphHeights.shoulder);
  if (sh && t) {
    const x = t.cx + t.a * 0.95;
    const prof = sagittalProfile(mesh, x, 1);
    if (prof.length >= 2) {
      const hem = prof[prof.length - 1]!;
      out.push({ definition: 'shoulder_point_drop', label: LENGTH_LABEL.shoulder_point_drop, lengthCm: r1(m.morphHeights.shoulder - hem.y), start: [x, m.morphHeights.shoulder, 0], hemY: r1(hem.y), note: null });
    } else out.push({ definition: 'shoulder_point_drop', label: LENGTH_LABEL.shoulder_point_drop, lengthCm: null, start: null, hemY: null, note: 'no garment below the shoulder point' });
  }
  return out;
}

/** The definition whose value is closest to the printed length, and the residual of each. */
export function matchPrinted(lengths: readonly LengthMeasure[], printedCm: number): { best: LengthDefinition | null; residualCm: Partial<Record<LengthDefinition, number>> } {
  const residualCm: Partial<Record<LengthDefinition, number>> = {};
  let best: LengthDefinition | null = null;
  for (const l of lengths) {
    if (l.lengthCm === null) continue;
    residualCm[l.definition] = Math.round((l.lengthCm - printedCm) * 100) / 100;
    if (best === null || Math.abs(l.lengthCm - printedCm) < Math.abs(residualCm[best]!)) best = l.definition;
  }
  return { best, residualCm };
}

/**
 * Where the hem must sit (y, cm) for a garment whose front surface from the HPS has the printed
 * length: walk down a front profile z(y) (e.g. the proxy's, which hangs from the HPS) until the path
 * length reaches `lengthCm`. `profileZ(y)` gives the front surface depth at the HPS's x.
 */
export function hemForSurfaceLength(hps: Vec3, lengthCm: number, profileZ: (y: number) => number, stepCm = 0.1, floorY = 0): number {
  let y = hps[1];
  let z = profileZ(y);
  let len = 0;
  while (y > floorY) {
    const y2 = y - stepCm;
    const z2 = profileZ(y2);
    const d = Math.hypot(stepCm, z2 - z);
    if (len + d >= lengthCm) return y - (stepCm * (lengthCm - len)) / d;
    len += d;
    y = y2;
    z = z2;
  }
  return floorY;
}
