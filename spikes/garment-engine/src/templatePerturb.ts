/**
 * Perturbed templates for checking stage 4t when the template is NOT the garment (review F1): the
 * spike's synthetic proxy is built from the same garment spec as `garment_truth.glb`, so it starts
 * about 0.3 cm (Chamfer) from the truth and a good score after the fit says little. These
 * deformations move the closed proxy away from the truth in known ways (girth, hem height, sleeve
 * width and length) so the fit has to find the garment from the masks. Also the regions the Chamfer
 * is reported in (`garmentRegion`).
 */
import type { Mannequin, Mesh } from '@curtain/mannequin';

export interface TemplatePerturbation {
  label: string;
  /** Body: horizontal scale about the body axis (x and z), e.g. 1.08 = 8 % wider and deeper. */
  bodyScale: number;
  /** Body: hem raised (+) or lowered (−) by this many cm; the skirt below the waist is stretched linearly. */
  hemRaiseCm: number;
  /** Sleeves: radial scale about the arm axis. */
  sleeveScale: number;
  /** Sleeves: length scale along the arm axis from the shoulder joint. */
  sleeveLengthScale: number;
  /**
   * Body and legs: an extra scale of the depth (z) alone, about the mannequin's centre at each height
   * (torso, below the crotch the leg), after `bodyScale`. Default 1. Front and back views see width, not
   * depth, so a template wrong only here tests what two views recover of depth (review F1).
   */
  depthScale?: number;
}

export const PERTURBATIONS: readonly TemplatePerturbation[] = [
  { label: 'wider +8 %, hem 8 cm higher, sleeves +10 % wide, 15 % shorter', bodyScale: 1.08, hemRaiseCm: 8, sleeveScale: 1.1, sleeveLengthScale: 0.85 },
  { label: 'narrower −6 %, hem 8 cm lower, sleeves +10 % wide, 10 % longer', bodyScale: 0.94, hemRaiseCm: -8, sleeveScale: 1.1, sleeveLengthScale: 1.1 },
];

/** Depth-only wrong templates: width, hem and sleeves as predicted, the body's (and legs') depth 15 % off. */
export const DEPTH_PERTURBATIONS: readonly TemplatePerturbation[] = [
  { label: 'depth +15 % (width unchanged)', bodyScale: 1, hemRaiseCm: 0, sleeveScale: 1, sleeveLengthScale: 1, depthScale: 1.15 },
  { label: 'depth −15 % (width unchanged)', bodyScale: 1, hemRaiseCm: 0, sleeveScale: 1, sleeveLengthScale: 1, depthScale: 0.85 },
];

/**
 * A deformed copy of a closed proxy whose parts are named `body`, `sleeve_l`, `sleeve_r` (proxy.ts),
 * or, for trousers, `body` (the seat), `leg_l`, `leg_r`. Trousers: the legs scale about the mannequin
 * leg's centre at each height and carry the hem change (stretched linearly below the crotch); the seat
 * only scales.
 */
export function perturbTemplate(m: Mannequin, proxy: Mesh, p: TemplatePerturbation): Mesh {
  const P = Float64Array.from(proxy.positions);
  const body = proxy.partNames.indexOf('body');
  if (body < 0) throw new Error(`perturbTemplate: the template has no 'body' part (parts: ${proxy.partNames.join(', ')}); a proxy read back from a .glb loses its parts, build it with buildProxy`);
  const waist = m.morphHeights.waist;
  const crotch = m.landmarks.crotch[1];
  const trousers = proxy.partNames.includes('leg_l');
  let yMin = Infinity, legMin = Infinity;
  for (let i = 0; i < P.length / 3; i++) {
    const part = proxy.partNames[proxy.vertexPart[i]!];
    if (part === 'body') yMin = Math.min(yMin, P[3 * i + 1]!);
    if (part === 'leg_l' || part === 'leg_r') legMin = Math.min(legMin, P[3 * i + 1]!);
  }
  const ds = p.depthScale ?? 1;
  const torsoTop = m.morphHeights.shoulder;
  const centreZ = (y: number, side: 1 | -1): number => (y < crotch ? m.legAt(y, side)?.cz : m.torsoAt(Math.min(y, torsoTop))?.cz) ?? m.torsoAt(crotch + 1)?.cz ?? 0;
  for (let i = 0; i < P.length / 3; i++) {
    const part = proxy.partNames[proxy.vertexPart[i]!];
    const x = P[3 * i]!, y = P[3 * i + 1]!, z = P[3 * i + 2]!;
    if (part === 'body') {
      P[3 * i] = x * p.bodyScale;
      P[3 * i + 2] = z * p.bodyScale;
      if (ds !== 1) {
        const cz = centreZ(y, x >= 0 ? 1 : -1);
        P[3 * i + 2] = cz + (P[3 * i + 2]! - cz) * ds;
      }
      if (!trousers && y < waist && waist > yMin) P[3 * i + 1] = y + p.hemRaiseCm * ((waist - y) / (waist - yMin));
    } else if (part === 'leg_l' || part === 'leg_r') {
      const l = m.legAt(Math.min(y, crotch - 0.5), part === 'leg_l' ? 1 : -1);
      const cx = l?.cx ?? 0, cz = l?.cz ?? 0;
      P[3 * i] = cx + (x - cx) * p.bodyScale;
      P[3 * i + 2] = cz + (z - cz) * p.bodyScale * ds;
      if (y < crotch && crotch > legMin) P[3 * i + 1] = y + p.hemRaiseCm * ((crotch - y) / (crotch - legMin));
    } else if (part === 'sleeve_l' || part === 'sleeve_r') {
      const f = part === 'sleeve_l' ? m.arms.left : m.arms.right;
      const r = [x - f.joint[0], y - f.joint[1], z - f.joint[2]];
      const t = r[0]! * f.axis[0] + r[1]! * f.axis[1] + r[2]! * f.axis[2];
      const radial = [r[0]! - t * f.axis[0], r[1]! - t * f.axis[1], r[2]! - t * f.axis[2]];
      for (let d = 0; d < 3; d++) P[3 * i + d] = f.joint[d]! + t * p.sleeveLengthScale * f.axis[d]! + radial[d]! * p.sleeveScale;
    }
  }
  return { ...proxy, positions: P };
}

export const GARMENT_REGIONS = ['shoulders', 'bodice', 'skirt', 'sleeves'] as const;

/**
 * Region of a point on a dress: sleeves = above the waist and more than 2 cm outside the torso's
 * half-width at that height; shoulders = the rest above the chest ring; bodice = waist to chest;
 * skirt = below the waist.
 */
export function garmentRegion(m: Mannequin): (x: number, y: number, z: number) => string {
  const h = m.morphHeights;
  return (x, y) => {
    if (y >= h.waist) {
      const t = m.torsoAt(Math.min(y, h.shoulder));
      if (t && Math.abs(x) > t.a + 2) return 'sleeves';
      return y >= h.chest ? 'shoulders' : 'bodice';
    }
    return 'skirt';
  };
}
