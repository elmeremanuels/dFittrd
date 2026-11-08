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

// ---------------------------------------------------------------------------
// Per garment type: what a shop's printed length means for bottoms
// ---------------------------------------------------------------------------

/**
 * Length definitions per garment type. Tops, dresses and outerwear: from the high point shoulder
 * (`garmentLengths` above). A skirt: waist to hem along the centre front from the garment's top edge
 * (the waistband), and down the side seam. Trousers: the outseam (top edge down the side seam to the
 * hem, along the garment) and the inseam (from the crotch down the inner leg to the hem). Each also
 * as a vertical drop (what the evaluation's `outseam`, the vertical extent, was before).
 */
export const BOTTOM_LENGTH_DEFINITIONS = ['waist_to_hem_front', 'outseam_side', 'outseam_drop', 'inseam_inner', 'inseam_drop'] as const;
export type BottomLengthDefinition = (typeof BOTTOM_LENGTH_DEFINITIONS)[number];

export const BOTTOM_LENGTH_LABEL: Readonly<Record<BottomLengthDefinition, string>> = {
  waist_to_hem_front: 'top edge at the centre front, along the garment front to the hem (skirt length, flat-lay)',
  outseam_side: 'top edge at the side, along the side seam to the hem (outseam, flat-lay)',
  outseam_drop: 'top edge at the side, vertical drop to the hem',
  inseam_inner: 'crotch along the inner leg to the hem (inseam, flat-lay)',
  inseam_drop: 'crotch point, vertical drop to the hem of the inner leg',
};

export interface BottomLengthMeasure {
  definition: BottomLengthDefinition;
  label: string;
  lengthCm: number | null;
  topY: number | null;
  hemY: number | null;
  note: string | null;
}

/**
 * Profile of the garment in the plane z = `z` (normal +z), on the side `side` of x = 0: per `binCm`
 * of height the outermost (`outer`: largest |x|) or innermost (smallest |x| beyond `minAbsX`) slice
 * point, smoothed as `sagittalProfile`. The returned `z` field holds that |x|.
 */
export function coronalProfile(
  mesh: Pick<Mesh, 'positions' | 'indices'>,
  z: number,
  side: 1 | -1,
  outer: boolean,
  opts: { binCm?: number; smoothCm?: number; maxY?: number; minAbsX?: number; maxAbsX?: number } = {},
): ProfilePoint[] {
  const binCm = opts.binCm ?? 0.5;
  const smoothCm = opts.smoothCm ?? PROFILE_SMOOTH_CM;
  // Every triangle's crossing of the plane, unchained: the seat and the leg tubes overlap and open polylines through them
  // did not survive loop chaining (the side profile jumped to the inner surface over 8 cm of height).
  const pts: [number, number][] = [];
  const P = mesh.positions, I = mesh.indices;
  const zc = z + 0.013; // off the exact plane: a grid fitted round a vertical axis has a column of vertices on it
  const keep = (x: number, y: number): void => {
    if (side * x > (opts.minAbsX ?? 0) && side * x < (opts.maxAbsX ?? Infinity) && y <= (opts.maxY ?? Infinity)) pts.push([side * x, y]);
  };
  for (let t = 0; t < I.length; t += 3) {
    const cut: [number, number][] = [];
    for (let k = 0; k < 3; k++) {
      const a = I[t + k]!, b = I[t + ((k + 1) % 3)]!;
      const za = P[3 * a + 2]! - zc, zb = P[3 * b + 2]! - zc;
      if ((za < 0) === (zb < 0)) continue;
      const f = za / (za - zb);
      cut.push([P[3 * a]! + f * (P[3 * b]! - P[3 * a]!), P[3 * a + 1]! + f * (P[3 * b + 1]! - P[3 * a + 1]!)]);
    }
    if (cut.length !== 2) continue;
    // Sampled along the segment, so every height bin it spans gets a point (a coarse grid's rows are further apart than a bin).
    const [p0, p1] = cut as [[number, number], [number, number]];
    const n = Math.max(1, Math.ceil(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / (binCm / 2)));
    for (let j = 0; j <= n; j++) keep(p0[0] + ((p1[0] - p0[0]) * j) / n, p0[1] + ((p1[1] - p0[1]) * j) / n);
  }
  if (pts.length < 2) return [];
  const top = Math.max(...pts.map((p) => p[1]));
  const bottom = Math.min(...pts.map((p) => p[1]));
  const n = Math.max(1, Math.ceil((top - bottom) / binCm));
  const v = new Float64Array(n + 1).fill(NaN);
  for (const [ax, y] of pts) {
    const k = Math.min(n, Math.round((top - y) / binCm));
    if (Number.isNaN(v[k]!) || (outer ? ax > v[k]! : ax < v[k]!)) v[k] = ax;
  }
  const raw: ProfilePoint[] = [];
  for (let k = 0; k <= n; k++) if (!Number.isNaN(v[k]!)) raw.push({ y: top - k * binCm, z: v[k]! });
  // The ends: a tape along the side stops at the hem's own edge. A hem that is not level ends in bins holding only the
  // other side of the tube (the inner hem of a leg, 24 cm across): drop end bins that jump more than END_JUMP_CM.
  const END_JUMP_CM = 3, END_WINDOW_CM = 6;
  for (let i = raw.length - 1; i > 0 && raw[raw.length - 1]!.y > raw[i]!.y - END_WINDOW_CM; i--) {
    if (Math.abs(raw[i]!.z - raw[i - 1]!.z) > END_JUMP_CM) {
      raw.length = i;
      break;
    }
  }
  for (let i = 1; i < raw.length - 1 && raw[i]!.y > raw[0]!.y - END_WINDOW_CM; i++) {
    if (Math.abs(raw[i]!.z - raw[i - 1]!.z) > END_JUMP_CM) {
      raw.splice(0, i);
      break;
    }
  }
  if (smoothCm <= 0 || raw.length < 5) return raw;
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

/** Length definitions of a skirt (`trousers` false) or of trousers worn on the mannequin. */
export function bottomLengths(m: Mannequin, mesh: Pick<Mesh, 'positions' | 'indices'>, trousers: boolean): BottomLengthMeasure[] {
  const r1 = (x: number): number => Math.round(x * 100) / 100;
  const out: BottomLengthMeasure[] = [];
  const none = (d: BottomLengthDefinition, note: string): BottomLengthMeasure => ({ definition: d, label: BOTTOM_LENGTH_LABEL[d], lengthCm: null, topY: null, hemY: null, note });
  const measure = (d: BottomLengthDefinition, prof: ProfilePoint[], drop: boolean, note: string | null = null): BottomLengthMeasure => {
    const top = prof[0]!, hem = prof[prof.length - 1]!;
    return { definition: d, label: BOTTOM_LENGTH_LABEL[d], lengthCm: r1(drop ? top.y - hem.y : profileLength(prof)), topY: r1(top.y), hemY: r1(hem.y), note };
  };
  if (!trousers) {
    const front = sagittalProfile(mesh, 0, 1);
    out.push(front.length >= 2 ? measure('waist_to_hem_front', front, false) : none('waist_to_hem_front', 'no garment at the centre front'));
  }
  // Side seam: the outermost garment points on the left in the frontal plane through the hip's centre.
  const cz = m.torsoAt(m.morphHeights.hip)?.cz ?? 0;
  // Outer and inner surfaces apart at the leg's centre line: a tube's far side never enters the other's profile.
  const legX = m.landmarks.legX;
  const side = coronalProfile(mesh, cz, 1, true, { minAbsX: legX });
  if (side.length >= 2) out.push(measure('outseam_side', side, false), measure('outseam_drop', side, true));
  else out.push(none('outseam_side', 'no garment at the side'), none('outseam_drop', 'no garment at the side'));
  if (trousers) {
    // Inner leg: the innermost garment points left of the centre plane, below the crotch (+2 cm: the seat's lower edge).
    const crotch = m.landmarks.crotch;
    const leg = m.legAt(crotch[1] - 10, 1);
    const inner = coronalProfile(mesh, leg?.cz ?? 0, 1, false, { maxY: crotch[1] + 2, minAbsX: 0.05, maxAbsX: legX });
    if (inner.length >= 2) {
      // From the crotch point: where the fitted inner leg starts lower (thighs that touch leave no ray to carve), the gap is
      // bridged straight up to the crotch, as a tape from the crotch seam would run.
      const start = inner[0]!;
      const gap = crotch[1] - start.y;
      const hem = inner[inner.length - 1]!;
      const bridge = gap > 0 ? Math.hypot(gap, start.z) : 0;
      const cloth = profileLength(inner, crotch[1]);
      // The bridge is not cloth: say how much of the inseam it is and what the cloth alone measures, so a deeper garment
      // crotch than the body's (trousers sewn below the crotch, template fit 0.4.0) is not hidden in the number.
      const note = gap > 3 ? `the inner leg starts ${r1(gap)} cm below the crotch point (at ${r1(start.y)} cm); bridged straight: ${r1(bridge)} cm of this inseam is the straight bridge, not cloth; the cloth inner leg from ${r1(start.y)} cm to the hem is ${r1(cloth)} cm (drop ${r1(start.y - hem.y)} cm)` : null;
      const flat = cloth + bridge;
      out.push(
        { definition: 'inseam_inner', label: BOTTOM_LENGTH_LABEL.inseam_inner, lengthCm: r1(flat), topY: r1(Math.max(crotch[1], start.y)), hemY: r1(hem.y), note },
        { definition: 'inseam_drop', label: BOTTOM_LENGTH_LABEL.inseam_drop, lengthCm: r1(crotch[1] - hem.y), topY: r1(crotch[1]), hemY: r1(hem.y), note },
      );
    } else out.push(none('inseam_inner', 'no inner leg below the crotch: one closed volume (a skirt), not trousers'), none('inseam_drop', 'no inner leg below the crotch'));
  }
  return out;
}
