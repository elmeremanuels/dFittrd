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
import { buildBody, buildMannequinMesh, type BodyFamily, type Mannequin, type Mesh, type MeshOptions } from '@curtain/mannequin';
import { armpitDistance, radialMorph, type ChainAssignment } from '../../src/garment';
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
  return { measurements: meas, morph, rings, mesh: calmHead(m, canonical, radialMorph(m, canonical, mannequinChains(canonical), morph), morph) };
}

/** How much of the neck's girth scale the neutral head takes on: a head does not grow with the bust. */
export const HEAD_SCALE_SHARE = 0.2;

/**
 * The neutral head (part `head` of a mesh built with `head: 'neutral'`) is not widened like the
 * torso: it takes `HEAD_SCALE_SHARE` of the scale at the neck ring. A mesh without that part (the
 * egg head, which belongs to the torso) is returned as it is.
 */
function calmHead(m: Mannequin, canonical: Mesh, morphed: Mesh, morph: Pick<GradingMorph, 'girthScaleAt'>): Mesh {
  const head = canonical.partNames.indexOf('head');
  if (head < 0) return morphed;
  const s = 1 + HEAD_SCALE_SHARE * (morph.girthScaleAt(m.morphHeights.neck, 'body') - 1);
  const out = Float64Array.from(morphed.positions);
  for (let i = 0; i < canonical.vertexPart.length; i++) {
    if (canonical.vertexPart[i] !== head) continue;
    out[3 * i] = canonical.positions[3 * i]! * s;
    out[3 * i + 2] = canonical.positions[3 * i + 2]! * s;
  }
  return { ...morphed, positions: out };
}

// ---------------------------------------------------------------------------
// MountOptions.body: family, height and shoulder width (packages/mannequin README, "Families")
// ---------------------------------------------------------------------------

/**
 * What the host may pass as `MountOptions.body`: the three girths as before, plus the fields of
 * `BodyInput` in `@curtain/mannequin`. Everything is optional; with only girths (or nothing) the
 * avatar is built exactly as before.
 */
export interface BodyOptions extends Partial<BodyMeasurements> {
  /** `female` (default) or `male`. Anything else is read as `female`, today's figure. */
  family?: BodyFamily;
  /** Stature, cm. */
  heightCm?: number;
  /** Straight distance between the two shoulder points, cm (see the mannequin README). */
  shoulderCm?: number;
  /** The same measurement as `bust`; wins over it when both are given. */
  chest?: number;
}

const positive = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

export function bodyFamilyOf(body: { family?: unknown } | null | undefined): BodyFamily {
  return body?.family === 'male' ? 'male' : 'female';
}

/** The family a bundle's garment was draped on. Bundles record none so far: a missing family is `female`. */
export function bundleFamilyOf(anchors: { mannequin?: { family?: unknown } } | null | undefined): BodyFamily {
  return anchors?.mannequin?.family === 'male' ? 'male' : 'female';
}

/** True when the body needs `buildBody` (a typed height or shoulder width); false keeps the morphed base mesh, as before. */
export function isTypedBody(body: BodyOptions): boolean {
  return positive(body.heightCm) !== undefined || positive(body.shoulderCm) !== undefined;
}

/** The girths of `body` with `chest` read as `bust`. */
export function girthInput(body: BodyOptions): Partial<Record<keyof BodyMeasurements, unknown>> {
  return { bust: positive(body.chest) ?? body.bust, waist: body.waist, hip: body.hip };
}

export interface TypedAvatar {
  avatar: Avatar;
  /** The drawn body's collision field in the garment's space: moved down by `garmentLiftCm`. */
  field: BodyField;
  /** The body as drawn (at the typed height), cm. */
  statureCm: number;
  /**
   * How far the draped garment is drawn above where the bundle has it (cm; negative on a shorter
   * body), so that it hangs from the drawn body's own shoulder ring (waist ring for a bottom).
   */
  garmentLiftCm: number;
}

/** A collision field moved up by `dyCm` (the tables are keyed by height, the arm frames by their joint). */
export function liftField(field: BodyField, dyCm: number): BodyField {
  const up = (t: Table): Table => ({ ...t, lo: t.lo + dyCm });
  return {
    torso: up(field.torso),
    legs: [up(field.legs[0]), up(field.legs[1])],
    arms: field.arms,
    armFrames: field.armFrames.map((f) => ({ ...f, joint: [f.joint[0], f.joint[1] + dyCm, f.joint[2]] as [number, number, number] })),
  };
}

/**
 * The avatar for a body with a typed height or shoulder width, built with `buildBody` (the only
 * path that honours them) in the family of `base`, the body the bundle was draped on.
 *
 * The garment keeps its own lengths and hangs from the shoulder ring (from the waist ring for a
 * bottom). The bundle has it on a body of `base`'s stature, so the drape runs in the garment's
 * space against the drawn body moved down by the difference of that support level
 * (`garmentLiftCm`), and the viewer draws the draped garment that much higher. On a taller body
 * the hem therefore ends higher on the leg, and the cloth collides with the body it is drawn on.
 * Known limits: the floor of the drape stays where the bundle body stood (a hem that reaches the
 * floor on a shorter body passes through it and is hidden by the floor), and the grading and the
 * pins are still placed on `base`.
 */
export function buildTypedAvatar(base: Mannequin, body: BodyOptions, category: string, mesh: MeshOptions = {}): TypedAvatar {
  const family = base.shape.family;
  const meas = sanitiseMeasurements(girthInput(body), mannequinMeasurements(base));
  const shoulderCm = positive(body.shoulderCm);
  // Without a typed height the body keeps the stature of the bundle's body, as the morphed avatar does.
  const shown = buildBody({ family, bust: meas.bust, waist: meas.waist, hip: meas.hip, heightCm: positive(body.heightCm) ?? base.statureCm, ...(shoulderCm === undefined ? {} : { shoulderCm }) });
  const rings = {} as Record<AnchorRing, number>;
  for (const r of shown.rings) rings[r.id] = r.circumferenceCm;
  const support: AnchorRing = category === 'bottom' ? 'waist' : 'shoulder';
  const garmentLiftCm = shown.morphHeights[support] - base.morphHeights[support];
  return {
    avatar: { measurements: meas, morph: IDENTITY_MORPH.morph, rings, mesh: buildMannequinMesh(shown, mesh) },
    field: liftField(bodyField(shown, IDENTITY_MORPH), -garmentLiftCm),
    statureCm: shown.statureCm,
    garmentLiftCm,
  };
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
