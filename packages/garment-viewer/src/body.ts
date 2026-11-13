/**
 * The avatar of the spike viewer: the canonical mannequin (shape M), or a body built from given
 * measurements by scaling the mannequin's rings to them with the same `gradingMorph` the garment
 * uses (docs/ENGINE-HANDOFF.md §Avatar, "our own low-parameter model fitted to the rings"). Stature
 * and arms stay those of the mannequin in the spike.
 *
 * Measurements live in the browser only (D3): nothing here does I/O.
 */
import { gradingMorph, type AnchorRing, type AnchorValues, type GradingMorph } from '@curtain/anchors';
import type { UserBody } from '@curtain/schema';
import type { Mannequin, Mesh } from '@curtain/mannequin';
import { armpitDistance, radialMorph, type ChainAssignment } from './core/garment';
import { makeCollider, type BodyField, type Table } from './collide';

/** The girths a shopper types (cm). They are the fit-engine points `bust`, `waist`, `hip`. */
export interface BodyMeasurements {
  bust: number;
  waist: number;
  hip: number;
}

export const MEASUREMENT_LIMITS: Readonly<Record<keyof BodyMeasurements, readonly [number, number]>> = {
  bust: [60, 160],
  waist: [45, 150],
  hip: [65, 170],
};

/** Fit point → body ring (D15 ids). */
const RING_OF: Readonly<Record<keyof BodyMeasurements, AnchorRing>> = { bust: 'chest', waist: 'waist', hip: 'hip' };

export function mannequinMeasurements(m: Mannequin): BodyMeasurements {
  return { bust: m.shape.rings.chest.circumferenceCm, waist: m.shape.rings.waist.circumferenceCm, hip: m.shape.rings.hip.circumferenceCm };
}

/** Clamp to the limits and round to 0.5 cm; a missing or non-numeric value keeps the fallback. */
export function sanitiseMeasurements(input: Partial<Record<keyof BodyMeasurements, unknown>>, fallback: BodyMeasurements): BodyMeasurements {
  const out = { ...fallback };
  for (const k of Object.keys(MEASUREMENT_LIMITS) as (keyof BodyMeasurements)[]) {
    const v = Number(input[k]);
    if (!Number.isFinite(v)) continue;
    const [lo, hi] = MEASUREMENT_LIMITS[k];
    out[k] = Math.round(Math.min(hi, Math.max(lo, v)) * 2) / 2;
  }
  return out;
}

/** What the fit engine reads (wire type from @curtain/schema). */
export function userBody(meas: BodyMeasurements): UserBody {
  return { measurements: { bust: meas.bust, waist: meas.waist, hip: meas.hip } };
}

export interface Avatar {
  measurements: BodyMeasurements;
  /** Ring scales from the mannequin to this body (body chain; arms stay 1). */
  morph: GradingMorph;
  /** Body ring girths of the avatar, cm. */
  rings: Record<AnchorRing, number>;
  mesh: Mesh;
}

/** Chains of the mannequin mesh from its part labels: arms follow their arm, the rest the body. */
export function mannequinChains(mesh: Mesh): ChainAssignment {
  const armL = mesh.partNames.indexOf('arm_l');
  const armR = mesh.partNames.indexOf('arm_r');
  const out = new Uint8Array(mesh.vertexPart.length);
  for (let i = 0; i < out.length; i++) out[i] = mesh.vertexPart[i] === armL ? 1 : mesh.vertexPart[i] === armR ? 2 : 0;
  return out;
}

export function buildAvatar(m: Mannequin, canonical: Mesh, meas: BodyMeasurements): Avatar {
  const base: AnchorValues = {};
  const target: AnchorValues = {};
  for (const [k, ring] of Object.entries(RING_OF) as [keyof BodyMeasurements, AnchorRing][]) {
    base[ring] = m.shape.rings[ring].circumferenceCm;
    target[ring] = meas[k];
  }
  // Only the measured rings are knots; the morph holds the end scales beyond them (neck and
  // shoulder follow the bust, the legs follow the hip).
  const morph = gradingMorph(base, target, { heights: m.morphHeights });
  const rings = {} as Record<AnchorRing, number>;
  for (const r of m.rings) rings[r.id] = r.circumferenceCm * (r.part.startsWith('arm') ? 1 : morph.girthScaleAt(m.morphHeights[r.id], 'body'));
  return { measurements: meas, morph, rings, mesh: radialMorph(m, canonical, mannequinChains(canonical), morph) };
}

// ---------------------------------------------------------------------------
// Collision field: the avatar's analytic cross-sections, tabulated for the cloth solver
// ---------------------------------------------------------------------------

export { makeCollider, pushOutOfEllipse, type BodyField, type Table } from './collide';

function tabulate(lo: number, hi: number, stepCm: number, at: (x: number) => { cx: number; cz: number; a: number; b: number } | null): Table {
  const n = Math.max(2, Math.ceil((hi - lo) / stepCm) + 1);
  const data = new Float32Array(n * 5);
  for (let k = 0; k < n; k++) {
    const e = at(lo + k * stepCm);
    if (!e) continue;
    data.set([1, e.cx, e.cz, e.a, e.b], k * 5);
  }
  return { lo, stepCm, data };
}

/** Avatar cross-sections for collision. Body sections are scaled about the vertical axis like `radialMorph`. */
export function bodyField(m: Mannequin, avatar: Pick<Avatar, 'morph'>, stepCm = 0.5): BodyField {
  const S = m.statureCm;
  const scaled = (e: { cx: number; cz: number; a: number; b: number } | null, y: number) => {
    if (!e) return null;
    const s = avatar.morph.girthScaleAt(y, 'body');
    return { cx: e.cx * s, cz: e.cz * s, a: e.a * s, b: e.b * s };
  };
  const s0 = armpitDistance(m);
  const arms = [m.arms.left, m.arms.right].map((f) => {
    const side = f.side;
    const s1 = f.upperArmCm + f.forearmCm + 0.85 * f.handCm;
    // Arm sections in the arm's own (u, v) frame: centre is on the axis, so cx = cz = 0.
    const table = tabulate(0, s1, stepCm, (s) => {
      const e = m.armAt(s, side);
      return e ? { cx: 0, cz: 0, a: e.a, b: e.b } : null;
    });
    return { table, frame: { joint: [...f.joint] as [number, number, number], axis: [...f.axis] as [number, number, number], u: [...f.u] as [number, number, number], v: [...f.v] as [number, number, number], s0, s1 } };
  });
  return {
    torso: tabulate(0, S, stepCm, (y) => scaled(m.torsoAt(y), y)),
    legs: [tabulate(0, S * 0.6, stepCm, (y) => scaled(m.legAt(y, 1), y)), tabulate(0, S * 0.6, stepCm, (y) => scaled(m.legAt(y, -1), y))],
    arms: [arms[0]!.table, arms[1]!.table],
    armFrames: [arms[0]!.frame, arms[1]!.frame],
  };
}

/** Body morph of the canonical mannequin itself (every scale 1). */
export const IDENTITY_MORPH: Pick<Avatar, 'morph'> = { morph: { scales: {}, missing: [], girthScaleAt: () => 1 } };

/**
 * Particles of the base-size garment that already sit inside the canonical mannequin (with the
 * same chain rule as the collider). That is where the v0 mannequin's limbs overlap its torso, or
 * where the reconstruction cut into the body; colliding there would tear the cloth, so these
 * particles keep their place relative to the garment instead.
 */
export function insideCanonical(m: Mannequin, positions: ArrayLike<number>, chains: Uint8Array): Uint8Array {
  const collide = makeCollider(bodyField(m, IDENTITY_MORPH), 0, chains);
  const probe = Float32Array.from(positions);
  const out = new Uint8Array(chains.length);
  for (let i = 0; i < out.length; i++) out[i] = collide(probe, i) ? 1 : 0;
  return out;
}
