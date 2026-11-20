/**
 * The real cross-sections of a body whose sections are not ellipses (the male shape v2), as polar
 * outlines: for the torso, a leg or an arm at one station, the distance from a centre to the surface
 * at `POLAR_N` evenly spaced angles. `torsoAt`/`legAt`/`armAt` of such a body return an ellipse that
 * CONTAINS the section (4 to 13 cm more girth than the drawn body on the male v2 table bodies); cloth
 * collision and a garment builder that must hug the drawn body read these outlines instead.
 *
 * Angles: φ = atan2(z, x) for the torso and the legs (x to the wearer's left, z to the front), and
 * atan2(v, u) in an arm's own frame (`ArmFrame.u`, `.v`); `r[j]` is the radius at φ = 2πj / POLAR_N.
 */
import type { PartSpec, Section, Side } from './model';

export const POLAR_N = 96;

export interface PolarSection {
  /** Centre the radii are measured from: world x, z for the torso and legs; along u, v from the arm axis for an arm. */
  cx: number;
  cz: number;
  r: Float64Array;
}

export interface MannequinOutlines {
  /** The torso's outline at height y (cm), or null outside the torso. */
  torso(y: number): PolarSection | null;
  /** A leg's outline at height y, or null outside the leg. */
  leg(y: number, side: Side): PolarSection | null;
  /** An arm's outline at distance s along its axis from the shoulder joint (negative: the cap above the joint), or null outside. */
  arm(s: number, side: Side): PolarSection | null;
}

/** Radius of a polar outline along the angle φ (radians), linear between its samples. */
export function polarRadius(r: ArrayLike<number>, phi: number): number {
  const n = r.length;
  let f = (phi / (2 * Math.PI)) * n;
  f -= Math.floor(f / n) * n;
  const j = Math.floor(f);
  const w = f - j;
  return r[j % n]! * (1 - w) + r[(j + 1) % n]! * w;
}

/** The points of a section in its own (u, v) frame: the outline, or the ellipse's vertices. */
function sectionPoints(s: Section, segments: number): Float64Array {
  if (s.outline) return s.outline;
  const o = new Float64Array(2 * segments);
  for (let j = 0; j < segments; j++) {
    const t = (2 * Math.PI * j) / segments;
    o[2 * j] = s.a * Math.sin(t);
    o[2 * j + 1] = s.b * Math.cos(t);
  }
  return o;
}

/**
 * A section as a polar outline about (cu, cv) in its (u, v) frame: per angle the farthest crossing of
 * the ray with the section's polygon (so a centre in a notch gives the outer surface).
 */
export function sectionPolar(s: Section, segments: number, cu = 0, cv = 0): { cu: number; cv: number; r: Float64Array } {
  const o = sectionPoints(s, segments);
  const n = o.length / 2;
  const r = new Float64Array(POLAR_N);
  for (let j = 0; j < POLAR_N; j++) {
    const phi = (2 * Math.PI * j) / POLAR_N;
    const dx = Math.cos(phi), dz = Math.sin(phi);
    let best = 0;
    for (let k = 0; k < n; k++) {
      const q = (k + 1) % n;
      const x0 = o[2 * k]! - cu, z0 = o[2 * k + 1]! - cv;
      const ex = o[2 * q]! - cu - x0, ez = o[2 * q + 1]! - cv - z0;
      const det = ex * dz - ez * dx;
      if (Math.abs(det) < 1e-12) continue;
      // Ray t·(dx, dz) against the segment p0 + w·e.
      const t = (ex * z0 - ez * x0) / det;
      const w = (dx * z0 - dz * x0) / det;
      if (w >= -1e-9 && w <= 1 + 1e-9 && t > best) best = t;
    }
    r[j] = best;
  }
  return { cu, cv, r };
}

/** Mean of a section's points (its centre when the surface was moved off the axis, as the clamped arm cap). */
export function sectionCentroid(s: Section, segments: number): [number, number] {
  const o = sectionPoints(s, segments);
  let x = 0, z = 0;
  for (let j = 0; j < o.length; j += 2) {
    x += o[j]!;
    z += o[j + 1]!;
  }
  return [x / (o.length / 2), z / (o.length / 2)];
}

/** Polar outlines at ascending stations `keys`, interpolated linearly between neighbours; null outside. */
export function polarStack(keys: readonly number[], secs: readonly { cu: number; cv: number; r: Float64Array }[]): (x: number) => PolarSection | null {
  return (x) => {
    if (!(x >= keys[0]! && x <= keys[keys.length - 1]!)) return null;
    let i = 1;
    while (i < keys.length - 1 && keys[i]! < x) i++;
    const p = secs[i - 1]!, q = secs[i]!;
    const t = Math.min(1, Math.max(0, (x - keys[i - 1]!) / (keys[i]! - keys[i - 1]! || 1)));
    const r = new Float64Array(POLAR_N);
    for (let j = 0; j < POLAR_N; j++) r[j] = p.r[j]! + (q.r[j]! - p.r[j]!) * t;
    return { cx: p.cu + (q.cu - p.cu) * t, cz: p.cv + (q.cv - p.cv) * t, r };
  };
}

/** The outlines of a part lofted along the vertical (torso, leg): stations by height, centres in world x, z. */
export function verticalOutlines(part: PartSpec): (y: number) => PolarSection | null {
  let stack: ((y: number) => PolarSection | null) | null = null;
  return (y) => {
    if (!stack) {
      const secs = [...part.sections].sort((a, b) => a.centre[1] - b.centre[1]);
      const polar = secs.map((s) => {
        const p = sectionPolar(s, part.segments);
        return { cu: s.centre[0], cv: s.centre[2], r: p.r };
      });
      stack = polarStack(secs.map((s) => s.centre[1]), polar);
    }
    return stack(y);
  };
}
