/**
 * Synthetic garments (Phase 0 stand-in for stages 2 and 4). A dress or a top is lofted around the
 * canonical mannequin: at every anchor ring the garment's girth is the size chart's value for the
 * base size (body chart + ease, or the garment chart as is); between rings the ease follows the
 * same monotone cubic as the grading morph; below the hip a dress flares to its hem and always clears
 * both legs. Sleeves are tubes along the A-pose arms. Everything is deterministic.
 *
 * `distortGarment` then imitates what a reconstruction gets wrong (a global scale error, per-ring
 * bias and surface noise), so stage 5 has something real to calibrate.
 */
import {
  CATEGORY_ANCHORS,
  ellipseCircumference,
  ellipseFromCircumference,
  gradingMorph,
  monotoneProfile,
  type AnchorRing,
  type AnchorValues,
  type GradingMorph,
} from '@curtain/anchors';
import {
  along,
  cross,
  dot,
  loftSections,
  mergeParts,
  polygonCompensation,
  stations,
  sub,
  type Mannequin,
  type Mesh,
  type Section,
  type Side,
  type Vec3,
  vertexNormals,
} from '@curtain/mannequin';

export type SpikeCategory = 'dress' | 'top';

export interface GarmentSpec {
  id: string;
  name: string;
  category: SpikeCategory;
  colorHex: string;
  baseSize: string;
  /** Garment girths at the base size (cm) at the rings the chart (or a default ease) defines. */
  rings: Partial<Record<AnchorRing, number>>;
  /**
   * D15 breadth `shoulder_width` at the base size: seam to seam across the back, cm. Places the
   * shoulder seams (`shoulderSeams`) and, through grading, the yoke; the lofted body itself follows
   * the torso, so a dropped shoulder is not modelled in the synthetic geometry.
   */
  shoulderWidthCm?: number;
  /** High point shoulder to hem, cm. */
  shoulderToHemCm: number;
  /** Sleeve length from the shoulder joint along the arm, cm (0 = sleeveless). */
  sleeveCm: number;
  /** Hem girth / hip girth (1 = straight). */
  hemFlare: number;
}

export const GARMENT_PARTS = ['body', 'sleeve_l', 'sleeve_r'] as const;

/** Ease (cm of girth) used where the spec gives no ring value: a synthetic choice, not chart data. */
export const DEFAULT_GARMENT_EASE: Readonly<Partial<Record<AnchorRing, number>>> = {
  neck: 4,
  shoulder: 4,
  chest: 8,
  waist: 8,
  hip: 6,
  upper_arm: 6,
  wrist: 4,
};

const BODY_SEGMENTS = 64;
const SLEEVE_SEGMENTS = 32;

/** Body (torso) ellipse used under the garment at height `y`: the torso where it exists, else the hip ring. */
function torsoEllipse(m: Mannequin, y: number) {
  return m.torsoAt(y) ?? m.torsoAt(m.morphHeights.hip)!;
}

function ringY(m: Mannequin, id: AnchorRing): number {
  return m.morphHeights[id];
}

/** Garment girth at each body ring between neckline and hem, from the spec or body + default ease. */
export function garmentRingGirths(m: Mannequin, spec: GarmentSpec): Partial<Record<AnchorRing, number>> {
  const out: Partial<Record<AnchorRing, number>> = {};
  for (const id of ['shoulder', 'chest', 'underbust', 'waist', 'hip', 'upper_arm'] as const) {
    const body = m.shape.rings[id].circumferenceCm;
    const given = spec.rings[id];
    if (given !== undefined) out[id] = given;
    else if (DEFAULT_GARMENT_EASE[id] !== undefined) out[id] = body + DEFAULT_GARMENT_EASE[id]!;
  }
  return out;
}

/** Flip an open tube's winding when its first section's normals point inwards (garment surfaces face out). */
function outward(tube: { positions: number[]; indices: number[] }, sections: readonly Section[]): { positions: number[]; indices: number[] } {
  const s0 = sections[0]!;
  const s1 = sections[1] ?? s0;
  const [i, j, k] = [tube.indices[0]!, tube.indices[1]!, tube.indices[2]!];
  const P = (v: number): Vec3 => [tube.positions[3 * v]!, tube.positions[3 * v + 1]!, tube.positions[3 * v + 2]!];
  const fn = cross(sub(P(j), P(i)), sub(P(k), P(i)));
  const mid: Vec3 = [(s0.centre[0] + s1.centre[0]) / 2, (s0.centre[1] + s1.centre[1]) / 2, (s0.centre[2] + s1.centre[2]) / 2];
  if (dot(fn, sub(P(i), mid)) < 0) {
    for (let t = 0; t < tube.indices.length; t += 3) {
      const tmp = tube.indices[t + 1]!;
      tube.indices[t + 1] = tube.indices[t + 2]!;
      tube.indices[t + 2] = tmp;
    }
  }
  return tube;
}

export function generateGarment(m: Mannequin, spec: GarmentSpec): Mesh {
  const girths = garmentRingGirths(m, spec);
  const yShoulder = ringY(m, 'shoulder');
  const yTop = yShoulder + 0.35 * (ringY(m, 'neck') - yShoulder);
  const yHem = m.landmarks.hps[1] - spec.shoulderToHemCm;
  const yHip = ringY(m, 'hip');

  // Ease profile above the hip (cm of girth), zero-slope ends, exact at the rings.
  const easeKnots = [{ x: yTop, y: 3 }];
  for (const id of ['shoulder', 'chest', 'underbust', 'waist', 'hip'] as const) {
    if (girths[id] !== undefined) easeKnots.push({ x: ringY(m, id), y: girths[id]! - m.shape.rings[id].circumferenceCm });
  }
  const ease = monotoneProfile(easeKnots);
  const hipGirth = girths.hip ?? m.shape.rings.hip.circumferenceCm + DEFAULT_GARMENT_EASE.hip!;
  const hipAspect = m.shape.rings.hip.aspect;

  const required = (['shoulder', 'chest', 'underbust', 'waist', 'hip', 'thigh', 'knee'] as const).map((id) => ringY(m, id)).filter((y) => y > yHem && y < yTop);
  const ys = stations(yTop, yHem, 1.5, required);
  const bodySections: Section[] = ys.map((y) => {
    let a: number, b: number;
    if (y >= yHip) {
      const e = torsoEllipse(m, y);
      const cb = ellipseCircumference(e.a, e.b);
      const s = (cb + ease(y)) / cb;
      a = e.a * s;
      b = e.b * s;
    } else {
      const t = (yHip - y) / Math.max(1e-9, yHip - yHem);
      const c = hipGirth * (1 + (spec.hemFlare - 1) * t);
      ({ a, b } = ellipseFromCircumference(c, hipAspect));
      // Clear both legs (and the lower torso) with 1.5 cm to spare.
      const leg = m.legAt(y, 1);
      const torso = m.torsoAt(y);
      if (leg) {
        a = Math.max(a, m.landmarks.legX + leg.a + 1.5);
        b = Math.max(b, Math.abs(leg.cz) + leg.b + 1.5);
      }
      if (torso) {
        a = Math.max(a, torso.a + 1.5);
        b = Math.max(b, torso.b + 1.5);
      }
    }
    const k = polygonCompensation(a, b, BODY_SEGMENTS);
    return { centre: [0, y, 0], u: [1, 0, 0], v: [0, 0, 1], a: a * k, b: b * k };
  });
  const parts = [{ name: 'body', ...outward(loftSections(bodySections, BODY_SEGMENTS), bodySections) }];

  if (spec.sleeveCm > 0) {
    const ua = m.rings.find((r) => r.id === 'upper_arm')!.morphHeight;
    const wr = m.rings.find((r) => r.id === 'wrist')!.morphHeight;
    const end = Math.min(spec.sleeveCm, wr + 1.5);
    const uaEase = (girths.upper_arm ?? m.shape.rings.upper_arm.circumferenceCm + 6) - m.shape.rings.upper_arm.circumferenceCm;
    const sleeveEase = monotoneProfile([{ x: ua, y: uaEase }, { x: wr, y: Math.min(uaEase, DEFAULT_GARMENT_EASE.wrist!) }]);
    for (const side of [1, -1] as Side[]) {
      const frame = side === 1 ? m.arms.left : m.arms.right;
      const sections: Section[] = stations(0, end, 1.5, [ua, wr].filter((s) => s < end)).map((s) => {
        const e = m.armAt(s, side)!;
        const cb = ellipseCircumference(e.a, e.b);
        const f = (cb + sleeveEase(s)) / cb;
        const k = polygonCompensation(e.a * f, e.b * f, SLEEVE_SEGMENTS);
        return { centre: along(frame.joint, frame.axis, s), u: frame.u, v: frame.v, a: e.a * f * k, b: e.b * f * k };
      });
      parts.push({ name: side === 1 ? 'sleeve_l' : 'sleeve_r', ...outward(loftSections(sections, SLEEVE_SEGMENTS), sections) });
    }
  }
  return mergeParts(parts);
}

// ---------------------------------------------------------------------------
// Shoulder seams and yoke (D15 breadth `shoulder_width`)
// ---------------------------------------------------------------------------

/**
 * The garment's shoulder seam points for a shoulder width (seam to seam across the back, cm): at
 * ±width/2, on the shoulder ring's height, in the frontal plane of the mannequin.
 */
export function shoulderSeams(m: Mannequin, widthCm: number): [Vec3, Vec3] {
  const y = m.morphHeights.shoulder;
  return [[widthCm / 2, y, 0], [-widthCm / 2, y, 0]];
}

// ---------------------------------------------------------------------------
// Grading chains: which vertex follows which chain (derived from geometry, no labels needed)
// ---------------------------------------------------------------------------

export type ChainAssignment = Uint8Array; // 0 = body, 1 = left arm, 2 = right arm

/** Polar radius of an ellipse (semi-axes a along the first axis, b along the second) at angle θ. */
export const ellipseRadius = (a: number, b: number, theta: number): number => (a * b) / Math.hypot(b * Math.cos(theta), a * Math.sin(theta));

/**
 * Distance along the arm axis from the shoulder joint to the armpit: the first point where the
 * arm's inner side is clear of the torso. Above it (the sleeve cap) a garment grades with the body.
 */
export function armpitDistance(m: Mannequin): number {
  const arm = m.arms.left;
  for (let s = 0; s < arm.upperArmCm; s += 0.25) {
    const e = m.armAt(s, 1)!;
    const inner = along(e.centre, arm.u, -e.a);
    const t = m.torsoAt(inner[1]);
    if (!t || inner[0] > t.a + 0.5) return s;
  }
  return arm.upperArmCm;
}

/**
 * Assign every garment vertex to the body chain or to an arm chain, from geometry only (a
 * reconstruction has no part labels). Near the armpit a roomy torso and a sleeve can sit at the
 * same place, so position alone is ambiguous; the outward surface normal decides: a torso vertex
 * faces away from the torso axis, a sleeve vertex away from the arm axis. Score per chain =
 * normal · radial direction − 0.15 × radial gap to that body part (cm); the higher score wins.
 * Above the armpit (`armpitDistance`) everything follows the body.
 * Requires outward-oriented triangles (stage 4 output contract).
 */
export function assignChains(m: Mannequin, mesh: Mesh): ChainAssignment {
  const n = mesh.positions.length / 3;
  const out = new Uint8Array(n);
  const normals = vertexNormals(mesh);
  const s0 = armpitDistance(m);
  const armEnd = (side: Side) => {
    const a = side === 1 ? m.arms.left : m.arms.right;
    return a.upperArmCm + a.forearmCm + 0.85 * a.handCm;
  };
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
    const nrm: Vec3 = [normals[3 * i]!, normals[3 * i + 1]!, normals[3 * i + 2]!];
    const side: Side = p[0] >= 0 ? 1 : -1;
    const arm = side === 1 ? m.arms.left : m.arms.right;
    const s = dot(sub(p, arm.joint), arm.axis);
    if (s <= s0) continue;
    const e = m.armAt(Math.min(s, armEnd(side)), side)!;
    const radial = sub(p, along(arm.joint, arm.axis, s));
    const ru = dot(radial, arm.u);
    const rv = dot(radial, arm.v);
    const rLen = Math.hypot(ru, rv) || 1;
    const armGap = rLen - ellipseRadius(e.a, e.b, Math.atan2(rv, ru));
    const armScore = dot(nrm, [radial[0] / rLen, radial[1] / rLen, radial[2] / rLen]) - 0.15 * armGap;
    const t = torsoEllipse(m, p[1]);
    const tx = p[0] - t.cx;
    const tz = p[2] - t.cz;
    const tLen = Math.hypot(tx, tz) || 1;
    const torsoGap = tLen - ellipseRadius(t.a, t.b, Math.atan2(tz, tx));
    const torsoScore = (nrm[0] * tx + nrm[2] * tz) / tLen - 0.15 * torsoGap;
    if (armScore > torsoScore) out[i] = side === 1 ? 1 : 2;
  }
  return out;
}

/**
 * Scale every vertex radially about its chain's axis by the morph's girth scale (body: about the
 * vertical axis at the vertex height; arm: about the arm axis at the vertex's distance from the
 * shoulder joint). Uniform scaling of an elliptical cross-section scales its girth by the same
 * factor, so a ring loop reaches exactly the morph's target girth.
 */
export function radialMorph(m: Mannequin, mesh: Mesh, chains: ChainAssignment, morph: Pick<GradingMorph, 'girthScaleAt'>): Mesh {
  const out = new Float64Array(mesh.positions.length);
  for (let i = 0; i < out.length / 3; i++) {
    const p: Vec3 = [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
    const c = chains[i]!;
    if (c === 0) {
      const s = morph.girthScaleAt(p[1], 'body');
      out[3 * i] = p[0] * s;
      out[3 * i + 1] = p[1];
      out[3 * i + 2] = p[2] * s;
    } else {
      const arm = c === 1 ? m.arms.left : m.arms.right;
      const t = dot(sub(p, arm.joint), arm.axis);
      const axisPoint = along(arm.joint, arm.axis, t);
      const s = morph.girthScaleAt(t, 'arm');
      out[3 * i] = axisPoint[0] + (p[0] - axisPoint[0]) * s;
      out[3 * i + 1] = axisPoint[1] + (p[1] - axisPoint[1]) * s;
      out[3 * i + 2] = axisPoint[2] + (p[2] - axisPoint[2]) * s;
    }
  }
  return { ...mesh, positions: out };
}

/**
 * Change the garment's lengths without touching its rings: below the hip the body stretches about
 * the hip height so that shoulder-to-hem becomes `shoulderToHemScale` times the base value; past the
 * upper-arm ring the sleeve stretches so that the sleeve length scales by `sleeveScale`.
 */
export function lengthMorph(m: Mannequin, mesh: Mesh, chains: ChainAssignment, base: { shoulderToHem?: number; sleeve?: number }, target: { shoulderToHem?: number; sleeve?: number }): Mesh {
  const yHip = m.morphHeights.hip;
  const hps = m.landmarks.hps[1];
  const ua = m.morphHeights.upper_arm;
  const kBody = base.shoulderToHem && target.shoulderToHem && base.shoulderToHem > hps - yHip ? (target.shoulderToHem - (hps - yHip)) / (base.shoulderToHem - (hps - yHip)) : 1;
  const kSleeve = base.sleeve && target.sleeve && base.sleeve > ua ? (target.sleeve - ua) / (base.sleeve - ua) : 1;
  const out = Float64Array.from(mesh.positions);
  for (let i = 0; i < out.length / 3; i++) {
    const c = chains[i]!;
    if (c === 0) {
      const y = out[3 * i + 1]!;
      if (y < yHip) out[3 * i + 1] = yHip - (yHip - y) * kBody;
    } else {
      const arm = c === 1 ? m.arms.left : m.arms.right;
      const p: Vec3 = [out[3 * i]!, out[3 * i + 1]!, out[3 * i + 2]!];
      const t = dot(sub(p, arm.joint), arm.axis);
      if (t > ua) {
        const d = (t - ua) * (kSleeve - 1);
        out[3 * i] = p[0] + arm.axis[0] * d;
        out[3 * i + 1] = p[1] + arm.axis[1] * d;
        out[3 * i + 2] = p[2] + arm.axis[2] * d;
      }
    }
  }
  return { ...mesh, positions: out };
}

// ---------------------------------------------------------------------------
// Simulated reconstruction error
// ---------------------------------------------------------------------------

export interface Distortion {
  /** Overall scale error of the reconstruction (e.g. 1.035 = 3.5 % too big). */
  globalScale: number;
  /** Extra girth error per ring, cm. */
  ringBiasCm: Partial<Record<AnchorRing, number>>;
  /** Radial surface noise, cm (standard deviation). */
  noiseCm: number;
  seed: number;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sampler on top of a uniform PRNG (Box–Muller). */
export function gaussian(rand: () => number): () => number {
  return () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

/** The garment as a reconstruction might return it: scaled, biased per ring and noisy. */
export function distortGarment(m: Mannequin, mesh: Mesh, trueGirths: AnchorValues, d: Distortion): Mesh {
  const chains = assignChains(m, mesh);
  const target: AnchorValues = {};
  for (const [id, g] of Object.entries(trueGirths) as [AnchorRing, number][]) target[id] = g * d.globalScale + (d.ringBiasCm[id] ?? 0);
  const morph = gradingMorph(trueGirths, target, { heights: m.morphHeights });
  // A chain without a ring value (sleeves without an arm ring) still takes the global scale.
  const hasArm = morph.scales.upper_arm !== undefined || morph.scales.wrist !== undefined;
  const scaled = radialMorph(m, mesh, chains, { girthScaleAt: (h, chain) => (chain === 'arm' && !hasArm ? d.globalScale : morph.girthScaleAt(h, chain)) });
  if (d.noiseCm <= 0) return scaled;
  const g = gaussian(mulberry32(d.seed));
  const out = Float64Array.from(scaled.positions);
  for (let i = 0; i < out.length / 3; i++) {
    const c = chains[i]!;
    let centre: Vec3;
    if (c === 0) centre = [0, out[3 * i + 1]!, 0];
    else {
      const arm = c === 1 ? m.arms.left : m.arms.right;
      const p: Vec3 = [out[3 * i]!, out[3 * i + 1]!, out[3 * i + 2]!];
      centre = along(arm.joint, arm.axis, dot(sub(p, arm.joint), arm.axis));
    }
    const r: Vec3 = [out[3 * i]! - centre[0], out[3 * i + 1]! - centre[1], out[3 * i + 2]! - centre[2]];
    const len = Math.hypot(r[0], r[1], r[2]) || 1;
    const f = 1 + (g() * d.noiseCm) / len;
    out[3 * i] = centre[0] + r[0] * f;
    out[3 * i + 1] = centre[1] + r[1] * f;
    out[3 * i + 2] = centre[2] + r[2] * f;
  }
  return { ...scaled, positions: out };
}

/** The rings of a category that a garment can carry (the category subset of `@curtain/anchors`). */
export function categoryRings(category: SpikeCategory): readonly AnchorRing[] {
  return CATEGORY_ANCHORS[category].rings;
}
