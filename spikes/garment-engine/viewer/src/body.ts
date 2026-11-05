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
import { armpitDistance, ellipseRadius, radialMorph, type ChainAssignment } from '../../src/garment';

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

/** Ellipses tabulated every `stepCm`: 5 floats per sample (valid, cx, cz, a, b). */
interface Table {
  lo: number;
  stepCm: number;
  data: Float32Array;
}

export interface BodyField {
  torso: Table;
  legs: [Table, Table];
  arms: [Table, Table];
  armFrames: { joint: [number, number, number]; axis: [number, number, number]; u: [number, number, number]; v: [number, number, number]; s0: number; s1: number }[];
}

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

const sample = (t: Table, x: number, out: Float32Array): boolean => {
  const f = (x - t.lo) / t.stepCm;
  const k = Math.floor(f);
  const n = t.data.length / 5;
  if (k < 0 || k >= n - 1) return false;
  const i0 = k * 5;
  const i1 = i0 + 5;
  if (t.data[i0] === 0 || t.data[i1] === 0) return false;
  const w = f - k;
  for (let j = 1; j < 5; j++) out[j - 1] = t.data[i0 + j]! * (1 - w) + t.data[i1 + j]! * w;
  return true;
};

/** Push the 2D offset (dx, dz) from an ellipse centre out to the ellipse grown by `clearance`; returns the new offset or null when outside. */
export function pushOutOfEllipse(dx: number, dz: number, a: number, b: number, clearance: number): [number, number] | null {
  const r = Math.hypot(dx, dz);
  const A = a + clearance;
  const B = b + clearance;
  if (r < 1e-6) return [A, 0];
  const re = ellipseRadius(A, B, Math.atan2(dz, dx));
  if (r >= re) return null;
  const k = re / r;
  return [dx * k, dz * k];
}

/**
 * Collision of one particle (index `i` in `pos`) against the avatar: torso and legs as horizontal
 * ellipses at the particle's height, arms as ellipses across the arm axis below the armpit. Returns
 * true when the particle was moved.
 *
 * With `chains`, a body-chain particle collides with torso and legs only and a sleeve particle with
 * the arms only: the v0 mannequin's limbs overlap its torso, so at the armpit a particle would
 * otherwise be pushed out of two shapes at once. Particles flagged in `skip` never collide.
 */
export function makeCollider(field: BodyField, clearanceCm = 0.35, chains?: Uint8Array, skip?: Uint8Array): (pos: Float32Array, i: number) => boolean {
  const e = new Float32Array(4);
  const vertical = [field.torso, field.legs[0], field.legs[1]];
  return (pos, i) => {
    if (skip && skip[i] === 1) return false;
    let x = pos[3 * i]!;
    const y = pos[3 * i + 1]!;
    let z = pos[3 * i + 2]!;
    let moved = false;
    const chain = chains ? chains[i]! : -1;
    if (chain <= 0) for (const t of vertical) {
      if (!sample(t, y, e)) continue;
      const p = pushOutOfEllipse(x - e[0]!, z - e[1]!, e[2]!, e[3]!, clearanceCm);
      if (p) {
        x = e[0]! + p[0];
        z = e[1]! + p[1];
        moved = true;
      }
    }
    if (moved) {
      pos[3 * i] = x;
      pos[3 * i + 2] = z;
    }
    let yy = y;
    if (chain !== 0) for (let side = 0; side < 2; side++) {
      const f = field.armFrames[side]!;
      const rx = x - f.joint[0];
      const ry = yy - f.joint[1];
      const rz = z - f.joint[2];
      const s = rx * f.axis[0] + ry * f.axis[1] + rz * f.axis[2];
      if (s <= f.s0 || s >= f.s1 || !sample(field.arms[side]!, s, e)) continue;
      const ru = rx * f.u[0] + ry * f.u[1] + rz * f.u[2];
      const rv = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
      const p = pushOutOfEllipse(ru, rv, e[2]!, e[3]!, clearanceCm);
      if (!p) continue;
      const du = p[0] - ru;
      const dv = p[1] - rv;
      x += f.u[0] * du + f.v[0] * dv;
      yy += f.u[1] * du + f.v[1] * dv;
      z += f.u[2] * du + f.v[2] * dv;
      pos[3 * i] = x;
      pos[3 * i + 1] = yy;
      pos[3 * i + 2] = z;
      moved = true;
    }
    return moved;
  };
}
