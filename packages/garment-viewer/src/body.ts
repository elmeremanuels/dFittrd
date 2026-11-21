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
import { POLAR_N, buildBody, buildMannequinMesh, type PolarSection, type BodyFamily, type BuildOptions, type Mannequin, type Mesh, type MeshOptions } from '@curtain/mannequin';
import { armpitDistance, radialMorph, type ChainAssignment } from './core/garment';
import { makeCollider, type BodyField, type PolarTable, type Table } from './collide';

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
  /** How the neck was narrowed to sit under the neutral head (`fitNeckToHead`); absent or null: not at all. */
  neck?: NeckFit | null;
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
  const fitted = fitNeckToHead(calmHead(m, canonical, radialMorph(m, canonical, mannequinChains(canonical), morph), morph), m);
  if (fitted.neck) rings.neck *= fitted.neck.scale;
  return { measurements: meas, morph, rings, mesh: fitted.mesh, neck: fitted.neck };
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
  const levels = canonical.headLevels;
  for (let i = 0; i < canonical.vertexPart.length; i++) {
    if (canonical.vertexPart[i] !== head) continue;
    // The v2 head's tube on the neck follows the neck's scale, so it stays just on the neck's surface.
    const w = levels ? tubeWeight(levels, canonical.positions[3 * i + 1]!) : 0;
    const k = w > 0 ? s + (morph.girthScaleAt(canonical.positions[3 * i + 1]!, 'body') - s) * w : s;
    out[3 * i] = canonical.positions[3 * i]! * k;
    out[3 * i + 2] = canonical.positions[3 * i + 2]! * k;
  }
  return { ...morphed, positions: out };
}

/**
 * How much a vertex of the v2 head at height `y` belongs to its tube on the neck (1) rather than to
 * the head (0): all of it below the chin, none from a fifth of the head's height up.
 */
export function tubeWeight(levels: { chinY: number; topY: number }, y: number): number {
  const hi = levels.chinY + 0.2 * (levels.topY - levels.chinY);
  const t = Math.min(1, Math.max(0, (hi - y) / (hi - levels.chinY)));
  return t * t * (3 - 2 * t);
}

/** The neck under the neutral head is at most this share of the head's half-width at the jaw (the base body: 0.88). */
export const NECK_TO_HEAD = 0.9;
/** The jaw band, as shares of the head's height above the chin (87.5 % to 90.5 % of stature on the base body). */
const JAW_BAND = [0.074, 0.296] as const;

/** A narrowing of the neck: full (`scale`) from height `to` (the neck ring) up, none at `from` (the shoulder ring) and below. */
export interface NeckFit {
  scale: number;
  from: number;
  to: number;
}

/** The share of its width the torso keeps at height `y` (1 without a fit). */
export function neckScaleAt(fit: NeckFit | null | undefined, y: number): number {
  if (!fit) return 1;
  const t = Math.min(1, Math.max(0, (y - fit.from) / (fit.to - fit.from)));
  return 1 - (1 - fit.scale) * t * t * (3 - 2 * t);
}

/**
 * Keep the neck under the jaw of the neutral head. The head does not grow with the girths (and a
 * short typed body has a small head), while the neck ring follows the bust, so on a large or a
 * short body the neck column came out wider than the head and the chin sat inside a collar. When
 * the neck is wider than `NECK_TO_HEAD` of the head at the jaw, the torso's sections are narrowed
 * about their own centres, fully from the neck ring up and not at all at the shoulder ring. A mesh
 * without the part `head` (the egg head), or with a neck that already fits (the base body), is
 * returned as it is. `drawn` is the mannequin the mesh shows (its shoulder and neck ring heights).
 */
export function fitNeckToHead(mesh: Mesh, drawn: Pick<Mannequin, 'morphHeights'>): { mesh: Mesh; neck: NeckFit | null } {
  const head = mesh.partNames.indexOf('head');
  const torso = mesh.partNames.indexOf('torso');
  if (head < 0 || torso < 0) return { mesh, neck: null };
  const p = mesh.positions;
  let chin = Infinity, top = -Infinity;
  for (let i = 0; i < mesh.vertexPart.length; i++) {
    if (mesh.vertexPart[i] !== head) continue;
    chin = Math.min(chin, p[3 * i + 1]!);
    top = Math.max(top, p[3 * i + 1]!);
  }
  // The v2 head reaches below its chin (its tube on the neck): its own levels say where the chin is.
  if (mesh.headLevels) ({ chinY: chin, topY: top } = mesh.headLevels);
  const lo = chin + JAW_BAND[0] * (top - chin);
  const hi = chin + JAW_BAND[1] * (top - chin);
  // The torso's sections are horizontal rings: every vertex of one has the same height, and their mean is its centre.
  const rings = new Map<number, number[]>();
  let headHalf = 0;
  for (let i = 0; i < mesh.vertexPart.length; i++) {
    const y = p[3 * i + 1]!;
    // On the v2 head only the part above its tube counts as the jaw (the tube is the neck, widened with it).
    if (mesh.vertexPart[i] === head && y >= lo && y <= hi && (!mesh.headLevels || tubeWeight(mesh.headLevels, y) === 0)) headHalf = Math.max(headHalf, Math.abs(p[3 * i]!));
    if (mesh.vertexPart[i] !== torso || y <= drawn.morphHeights.shoulder) continue;
    const ring = rings.get(y);
    if (ring) ring.push(i);
    else rings.set(y, [i]);
  }
  const centres = new Map<number, [number, number]>();
  let neckHalf = 0;
  for (const [y, ring] of rings) {
    let cx = 0, cz = 0;
    for (const i of ring) {
      cx += p[3 * i]! / ring.length;
      cz += p[3 * i + 2]! / ring.length;
    }
    centres.set(y, [cx, cz]);
    if (y >= lo && y <= hi) for (const i of ring) neckHalf = Math.max(neckHalf, Math.abs(p[3 * i]! - cx));
  }
  if (!(headHalf > 0) || neckHalf <= NECK_TO_HEAD * headHalf) return { mesh, neck: null };
  const neck: NeckFit = { scale: (NECK_TO_HEAD * headHalf) / neckHalf, from: drawn.morphHeights.shoulder, to: drawn.morphHeights.neck };
  const out = Float64Array.from(p);
  for (const [y, ring] of rings) {
    const k = neckScaleAt(neck, y);
    const [cx, cz] = centres.get(y)!;
    for (const i of ring) {
      out[3 * i] = cx + (p[3 * i]! - cx) * k;
      out[3 * i + 2] = cz + (p[3 * i + 2]! - cz) * k;
    }
  }
  if (mesh.headLevels) {
    // The v2 head's tube is narrowed with the neck it sits on, about the neck's centre at its height.
    const ys = [...centres.keys()].sort((a, b) => a - b);
    const centreAt = (y: number): [number, number] => {
      let best = ys[0]!;
      for (const v of ys) if (Math.abs(v - y) < Math.abs(best - y)) best = v;
      return centres.get(best)!;
    };
    for (let i = 0; i < mesh.vertexPart.length; i++) {
      if (mesh.vertexPart[i] !== head) continue;
      const y = p[3 * i + 1]!;
      const w = tubeWeight(mesh.headLevels, y);
      if (w <= 0) continue;
      const k = 1 + (neckScaleAt(neck, y) - 1) * w;
      const [cx, cz] = centreAt(y);
      out[3 * i] = cx + (p[3 * i]! - cx) * k;
      out[3 * i + 2] = cz + (p[3 * i + 2]! - cz) * k;
    }
  }
  return { mesh: { ...mesh, positions: out }, neck };
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

/**
 * The male body shape a bundle's garment was built and draped on (anchors.json `mannequin.maleShape`): `v2` only when it
 * says so, a missing shape is `v1` (every male bundle before the tee was built on v2). Read for a male bundle only.
 */
export function bundleMaleShapeOf(anchors: { mannequin?: { maleShape?: unknown } } | null | undefined): 'v1' | 'v2' {
  return anchors?.mannequin?.maleShape === 'v2' ? 'v2' : 'v1';
}

/** The family a bundle's garment was draped on (anchors.json `mannequin.family`, slice M1): a missing family is `female`. */
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
  /** The mannequin drawn (`buildBody` of the typed measurements): its rings, heights and arm frames, in body space. */
  drawn: Mannequin;
  /**
   * How far the draped garment is drawn above where the bundle has it (cm; negative on a shorter
   * body), so that it hangs from the drawn body's own shoulder ring (waist ring for a bottom).
   */
  garmentLiftCm: number;
}

/** A collision field moved up by `dyCm` (the tables are keyed by height, the arm frames by their joint). */
export function liftField(field: BodyField, dyCm: number): BodyField {
  const up = (t: Table): Table => ({ ...t, lo: t.lo + dyCm, ...(t.polar ? { polar: { ...t.polar, lo: t.polar.lo + dyCm } } : {}) });
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
export function buildTypedAvatar(base: Mannequin, body: BodyOptions, category: string, mesh: MeshOptions = {}, build: BuildOptions = {}): TypedAvatar {
  const family = base.shape.family;
  const meas = sanitiseMeasurements(girthInput(body), mannequinMeasurements(base));
  const shoulderCm = positive(body.shoulderCm);
  // Without a typed height the body keeps the stature of the bundle's body, as the morphed avatar does.
  const shown = buildBody({ family, bust: meas.bust, waist: meas.waist, hip: meas.hip, heightCm: positive(body.heightCm) ?? base.statureCm, ...(shoulderCm === undefined ? {} : { shoulderCm }) }, build);
  const rings = {} as Record<AnchorRing, number>;
  for (const r of shown.rings) rings[r.id] = r.circumferenceCm;
  const support: AnchorRing = category === 'bottom' ? 'waist' : 'shoulder';
  const garmentLiftCm = shown.morphHeights[support] - base.morphHeights[support];
  const fitted = fitNeckToHead(buildMannequinMesh(shown, mesh), shown);
  if (fitted.neck) rings.neck *= fitted.neck.scale;
  return {
    avatar: { measurements: meas, morph: IDENTITY_MORPH.morph, rings, mesh: fitted.mesh, neck: fitted.neck },
    field: liftField(bodyField(shown, { ...IDENTITY_MORPH, neck: fitted.neck }), -garmentLiftCm),
    statureCm: shown.statureCm,
    drawn: shown,
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

/** Polar outlines (`Mannequin.outlines`) tabulated for the collider; radii and centres scaled by `scale(x)`. */
function tabulatePolar(lo: number, hi: number, stepCm: number, at: (x: number) => PolarSection | null, scale: (x: number) => number = () => 1): PolarTable {
  const rows = Math.max(2, Math.ceil((hi - lo) / stepCm) + 1);
  const stride = POLAR_N + 3;
  const data = new Float32Array(rows * stride);
  for (let k = 0; k < rows; k++) {
    const x = lo + k * stepCm;
    const o = at(x);
    if (!o) continue;
    const s = scale(x);
    data[k * stride] = 1;
    data[k * stride + 1] = o.cx * s;
    data[k * stride + 2] = o.cz * s;
    for (let j = 0; j < POLAR_N; j++) data[k * stride + 3 + j] = o.r[j]! * s;
  }
  return { lo, stepCm, n: POLAR_N, data };
}

/**
 * Avatar cross-sections for collision. Body sections are scaled about the vertical axis like `radialMorph`. A body with
 * drawn outlines (the male shape v2) also carries them (`Table.polar`): the collider then meets the drawn body, not the
 * ellipse that contains it.
 */
export function bodyField(m: Mannequin, avatar: Pick<Avatar, 'morph' | 'neck'>, stepCm = 0.5): BodyField {
  const S = m.statureCm;
  const scaled = (e: { cx: number; cz: number; a: number; b: number } | null, y: number, narrow = 1) => {
    if (!e) return null;
    const s = avatar.morph.girthScaleAt(y, 'body');
    return { cx: e.cx * s, cz: e.cz * s, a: e.a * s * narrow, b: e.b * s * narrow };
  };
  const o = m.outlines;
  const bodyScale = (y: number): number => avatar.morph.girthScaleAt(y, 'body');
  const s0 = armpitDistance(m);
  const arms = [m.arms.left, m.arms.right].map((f) => {
    const side = f.side;
    const s1 = f.upperArmCm + f.forearmCm + 0.85 * f.handCm;
    // Arm sections in the arm's own (u, v) frame: centre is on the axis, so cx = cz = 0.
    const table = tabulate(0, s1, stepCm, (s) => {
      const e = m.armAt(s, side);
      return e ? { cx: 0, cz: 0, a: e.a, b: e.b } : null;
    });
    // The drawn arm from its cap above the joint (the outline's own first station) down.
    if (o) table.polar = tabulatePolar(-ARM_CAP_REACH_CM, s1, stepCm / 2, (s) => o.arm(s, side));
    return { table, frame: { joint: [...f.joint] as [number, number, number], axis: [...f.axis] as [number, number, number], u: [...f.u] as [number, number, number], v: [...f.v] as [number, number, number], s0, s1 } };
  });
  // The neck is the drawn one: narrowed where `fitNeckToHead` narrowed the mesh.
  const torso = tabulate(0, S, stepCm, (y) => scaled(m.torsoAt(y), y, neckScaleAt(avatar.neck, y)));
  const legs: [Table, Table] = [tabulate(0, S * 0.6, stepCm, (y) => scaled(m.legAt(y, 1), y)), tabulate(0, S * 0.6, stepCm, (y) => scaled(m.legAt(y, -1), y))];
  if (o) {
    torso.polar = tabulatePolar(0, S, stepCm, (y) => o.torso(y), (y) => bodyScale(y) * neckScaleAt(avatar.neck, y));
    legs[0].polar = tabulatePolar(0, S * 0.6, stepCm, (y) => o.leg(y, 1), bodyScale);
    legs[1].polar = tabulatePolar(0, S * 0.6, stepCm, (y) => o.leg(y, -1), bodyScale);
  }
  return { torso, legs, arms: [arms[0]!.table, arms[1]!.table], armFrames: [arms[0]!.frame, arms[1]!.frame] };
}

/** How far above the shoulder joint an arm's outline table starts, cm (the v2 cap is 0.55 + 0.12 joint radii high: under 5 cm at XXL). */
const ARM_CAP_REACH_CM = 8;

/** Body morph of the canonical mannequin itself (every scale 1). */
export const IDENTITY_MORPH: Pick<Avatar, 'morph' | 'neck'> = { morph: { scales: {}, missing: [], girthScaleAt: () => 1 } };

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
