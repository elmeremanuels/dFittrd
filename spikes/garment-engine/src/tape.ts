/**
 * Tape-measure girth of a reconstructed garment at an anchor plane (stage 5 on real stage 4 meshes).
 *
 * `measureRing` takes the length of the closed slice loop around the ring centre. That is exact on
 * the spike's smooth synthetic garments, and breaks on the first real reconstruction (run 14, the
 * Azure Palm babydoll, gsplat 2DGS + TSDF at 0.4 cm voxels):
 *
 * - the surface is noisy (±1–2 cm ripples along the loop), and a polyline that follows the noise is
 *   far longer than the cloth: the hip loop measured 129.6 cm while it sits about 1 cm off a body
 *   of 104 cm;
 * - at chest height the sleeves are fused to the bodice (A-pose arms close to the torso), so the
 *   only loop runs around torso and both arms, and a hole leaves it open: no girth at all.
 *
 * A tape measure does neither: it goes round the outside of the cloth at the ring, bridges hollows
 * and openings, and passes under the arms. This module does that on the slice points:
 *
 * 1. take the closed slice loop round the ring centre when there is one and it holds no other body
 *    part; otherwise (an open loop, or sleeves fused to the bodice) every slice point that belongs to
 *    the ring's own body part: each point goes to the nearest loop of the **mannequin's** slice in
 *    the same plane (torso for torso rings, the arm for arm rings), so a fused sleeve is cut off at
 *    the armpit (`anchoring.ts` `measureRing`);
 * 2. bin them by angle around the ring centre (`bins`, 5° by default) and take the median radius per
 *    bin, then a circular median over `smoothBins` neighbouring bins: reconstruction ripples shorter
 *    than about 25° go, the cloth's shape stays;
 * 3. bridge empty bins by linear interpolation of the radius (a hole), refusing when less than
 *    `minCoverage` of the bins have points or one gap is wider than `maxGapDeg` or `maxGapCm`;
 * 4. the convex hull of that polygon (a tape bridges the hollow between the breasts or under a
 *    belt): its perimeter is the girth, its vertices the garment loop.
 *
 * On a smooth convex loop (the synthetic garments) the result equals the loop length to a few mm
 * (tests). The method assumes the section is star-shaped around the centre, which holds for a
 * garment around a torso, a limb or both legs.
 */
import type { Loop, Vec3 } from '@curtain/mannequin';

export interface TapeOptions {
  /** Angular bins around the centre. */
  bins?: number;
  /** Width of the circular median over bins (odd); 1 = none. */
  smoothBins?: number;
  /** Share of bins that must hold a slice point. */
  minCoverage?: number;
  /** Widest run of empty bins that is bridged, degrees. */
  maxGapDeg?: number;
  /** Widest gap that is bridged, as the straight distance between the cloth on either side, cm. */
  maxGapCm?: number;
  /**
   * Outerwear with a front opening (a V-neck cardigan, an open front): one gap centred on the front (+v, within
   * `FRONT_SECTOR_DEG`) is bridged up to this chord (cm) and 150 degrees, as a flat-lay chest measure lays the fronts
   * closed. 0 (default): an opening at the front is a gap like any other.
   */
  frontOpeningCm?: number;
}

/** Half-width of the front sector a front opening's middle must lie in, degrees round +v. */
export const FRONT_SECTOR_DEG = 35;

/**
 * `maxGapCm` 4: run 14's holes are 1–2 bins (5–10°, under 3 cm at the chest); an open front a few
 * cm wide (a cardigan) is not bridged, so it is reported as no girth rather than as a closed one.
 */
export const TAPE_DEFAULTS: Required<TapeOptions> = { bins: 72, smoothBins: 5, minCoverage: 0.6, maxGapDeg: 60, maxGapCm: 4, frontOpeningCm: 0 };
/** 0.2.0: `frontOpeningCm` (an outerwear front opening bridged as the fronts closed). */
export const TAPE_VERSION = 'tape-girth-0.2.0';

export interface TapeGirth {
  girthCm: number;
  /** Convex hull of the smoothed section, closed, in 3D on the plane. */
  loop: Loop;
  /** Share of angular bins with cloth (`support`), before bridging. */
  coverage: number;
  /** Widest bridged gap, degrees, and as a chord, cm. */
  maxGapDeg: number;
  maxGapCm: number;
  /** Chord (cm) of the front opening bridged under `frontOpeningCm` (null: none). Not counted in maxGapDeg/maxGapCm. */
  frontGapCm: number | null;
  /** Slice points used (after the body-part filter). */
  points: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Tape girth of the points `pts` (on the plane through `centre` spanned by `u`, `v`), or null when
 * the cloth does not go round. `support` is all the cloth in the plane (default `pts`): coverage and
 * gaps are judged on it, so a stretch where the cloth belongs to another body part (under a fused
 * sleeve) is bridged like a tape under the arm, while a stretch with no cloth at all (a hole, an open
 * front) counts as a gap.
 */
export function tapeGirth(pts: readonly Vec3[], centre: Vec3, u: Vec3, v: Vec3, options: TapeOptions = {}, support: readonly Vec3[] = pts): TapeGirth | null {
  const o = { ...TAPE_DEFAULTS, ...options };
  const B = o.bins;
  const polar = (p: Vec3): { bin: number; r: number } | null => {
    const d: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    const x = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const z = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    const r = Math.hypot(x, z);
    if (r < 1e-9) return null;
    const a = (Math.atan2(z, x) + 2 * Math.PI) % (2 * Math.PI);
    return { bin: Math.min(B - 1, Math.floor((a / (2 * Math.PI)) * B)), r };
  };
  const perBin: number[][] = Array.from({ length: B }, () => []);
  for (const p of pts) {
    const q = polar(p);
    if (q) perBin[q.bin]!.push(q.r);
  }
  const clothBins: number[][] = Array.from({ length: B }, () => []);
  for (const p of support) {
    const q = polar(p);
    if (q) clothBins[q.bin]!.push(q.r);
  }
  const radius: (number | null)[] = perBin.map((b) => (b.length ? median(b) : null));
  const cloth: (number | null)[] = clothBins.map((b) => (b.length ? median(b) : null));
  const filled = radius.filter((r) => r !== null).length;
  const clothFilled = cloth.filter((r) => r !== null).length;
  if (filled === 0) return null;
  // Circular runs of bins without cloth: angle, chord across the empty arc, and the angle of the run's middle.
  const runs: { bins: number; chord: number; midDeg: number }[] = [];
  if (clothFilled < B) {
    const start = cloth.findIndex((r) => r !== null);
    let run = 0;
    for (let k = 1; k <= B; k++) {
      const i = (start + k) % B;
      if (cloth[i] === null) run++;
      else {
        if (run > 0) {
          const ra = cloth[(i - run - 1 + B) % B]!, rb = cloth[i]!;
          const dTheta = (run * 2 * Math.PI) / B;
          const first = (i - run + B) % B;
          runs.push({ bins: run, chord: Math.sqrt(Math.max(0, ra * ra + rb * rb - 2 * ra * rb * Math.cos(dTheta))), midDeg: (((first + run / 2) / B) * 360) % 360 });
        }
        run = 0;
      }
    }
  }
  // The front opening: the widest run centred on +v (90 degrees in this frame), when the option allows it.
  let front: (typeof runs)[number] | null = null;
  if (o.frontOpeningCm > 0) {
    for (const r of runs) {
      const off = Math.abs(((r.midDeg - 90 + 540) % 360) - 180);
      if (off <= FRONT_SECTOR_DEG && r.chord <= o.frontOpeningCm && (r.bins * 360) / B <= 150 && (!front || r.bins > front.bins)) front = r;
    }
  }
  const others = runs.filter((r) => r !== front);
  const maxGap = Math.max(0, ...others.map((r) => r.bins));
  const maxChord = Math.max(0, ...others.map((r) => r.chord));
  // Coverage counts the bridged front opening as cloth: the fronts are laid closed.
  const coverage = (clothFilled + (front?.bins ?? 0)) / B;
  const maxGapDeg = (maxGap * 360) / B;
  if (coverage < o.minCoverage || filled / B < o.minCoverage / 2 || maxGapDeg > o.maxGapDeg || maxChord > o.maxGapCm) return null;
  // Bridge: linear in the angle between the nearest bins of the own part on either side.
  const r0 = radius.map((r, i) => {
    if (r !== null) return r;
    let a = 1;
    while (radius[(i - a + B) % B] === null) a++;
    let b = 1;
    while (radius[(i + b) % B] === null) b++;
    return (radius[(i - a + B) % B]! * b + radius[(i + b) % B]! * a) / (a + b);
  });
  const h = Math.max(0, Math.floor(o.smoothBins / 2));
  const rs = r0.map((_, i) => (h ? median(Array.from({ length: 2 * h + 1 }, (_, k) => r0[(i + k - h + B) % B]!)) : r0[i]!));
  const poly = rs.map((r, i): [number, number] => {
    const a = ((i + 0.5) / B) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  const hp = hull(poly);
  let girth = 0;
  for (let i = 0; i < hp.length; i++) {
    const a = hp[i]!, b = hp[(i + 1) % hp.length]!;
    girth += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const loop: Loop = { closed: true, points: hp.map(([x, z]): Vec3 => [centre[0] + u[0] * x + v[0] * z, centre[1] + u[1] * x + v[1] * z, centre[2] + u[2] * x + v[2] * z]) };
  return { girthCm: girth, loop, coverage, maxGapDeg, maxGapCm: Math.round(maxChord * 100) / 100, frontGapCm: front ? Math.round(front.chord * 100) / 100 : null, points: pts.length };
}

/** Points along a loop's segments, at most `stepCm` apart, so an empty angular bin means missing cloth, not a long edge. */
export function densifyLoop(loop: Loop, stepCm = 0.5): Loop {
  const p = loop.points;
  if (p.length < 2) return loop;
  const out: Vec3[] = [];
  const n = loop.closed ? p.length : p.length - 1;
  for (let i = 0; i < n; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!;
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / stepCm));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k, a[2] + ((b[2] - a[2]) * j) / k]);
  }
  if (!loop.closed) out.push(p[p.length - 1]!);
  return { points: out, closed: loop.closed };
}

/**
 * The slice points of a garment that belong to the body part whose loop is `own` in the mannequin's
 * slice of the same plane: each point goes to the nearest body loop (by distance to its points).
 */
export function pointsOfPart(garment: readonly Loop[], body: readonly Loop[], own: Loop): Vec3[] {
  const out: Vec3[] = [];
  const bodyPts = body.map((l) => l.points);
  const ownIdx = body.indexOf(own);
  for (const l of garment) {
    for (const p of l.points) {
      let best = -1;
      let bestD = Infinity;
      bodyPts.forEach((ps, i) => {
        for (const q of ps) {
          const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      });
      if (best === ownIdx || best < 0) out.push(p);
    }
  }
  return out;
}
