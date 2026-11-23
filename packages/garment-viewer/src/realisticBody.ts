/**
 * Realistic body spike (docs/research/realistic-avatar-route.md §7, route B), female family only: the MakeHuman CC0
 * base mesh, baked offline (`scripts/bake-realistic-body.ts`, provenance in `assets/realistic-body/PROVENANCE.md`),
 * deformed on the device so that its girth at each of the 12 D15 rings is the ring table's girth.
 *
 * What it is and is not:
 * - A drawn skin only. The ring table (the mannequin's rings and its collision field) stays the body of record for
 *   measuring and for cloth collision; nothing here feeds a size, a fit or the collider. Sizing stays with
 *   `@curtain/fit-engine` (AGENTS.md rule 4).
 * - Opt-in, off by default (`MountOptions.bodyShape`). Every default, golden and bundle is unchanged.
 * - Computed from the typed measurements only, on the device. The asset is a static file; nothing is sent.
 * - Girth here is the LOOP: the length of the closed plane section of the mesh round the ring centre, the same
 *   measure as `meshRingCircumference` and every ring test of the mannequin. The tape girth (convex hull of that
 *   section) is reported next to it (`ringReport`); which one a typed girth means is a founder decision (OI-141).
 *
 * Pure: no WebGL, no I/O. The loader (`realisticBodyLoad.ts`) fetches the bytes.
 */
import { monotoneProfile, type AnchorRing } from '@curtain/anchors';
import { loopLength, polarStack, sectionPolar, slice, type Loop, type Mannequin, type MannequinOutlines, type Mesh } from '@curtain/mannequin';
import { sample, type BodyField } from './collide';

type V3 = [number, number, number];

export const REALISTIC_BODY_FORMAT = 'curtain.realistic-body';
export const REALISTIC_BODY_VERSION = 1;
const MAGIC = 0x31425243; // 'CRB1' little-endian

/** Body-chain rings, from the top down (horizontal planes). */
export const BODY_RINGS = ['neck', 'shoulder', 'chest', 'underbust', 'waist', 'hip', 'thigh', 'knee', 'calf', 'ankle'] as const;
export type BodyRing = (typeof BODY_RINGS)[number];
/** Arm-chain rings (planes perpendicular to the arm axis, at a distance from the shoulder joint). */
export const ARM_RINGS = ['upper_arm', 'wrist'] as const;
export type ArmRing = (typeof ARM_RINGS)[number];
/** The shape targets the asset carries, as signed sliders: `weight` (MakeHuman min/max weight), `cup` (min/max cup). */
export const SHAPE_TARGETS = ['weight+', 'weight-', 'cup+', 'cup-'] as const;
export type ShapeTarget = (typeof SHAPE_TARGETS)[number];

/** What the bake measured and placed on the baked mesh (cm, the asset's own space: floor y = 0, +Z front, +X the body's left). */
export interface RealisticBodyMeta {
  format: typeof REALISTIC_BODY_FORMAT;
  version: number;
  family: 'female';
  vertexCount: number;
  /** Vertices of the body surface; the rest (from this index on) are the two eye spheres. */
  bodyVertexCount: number;
  triangleCount: number;
  statureCm: number;
  /** Heights of the anatomical levels on the baked mesh that correspond to the mannequin's rings. */
  levels: Record<BodyRing | 'crotch' | 'top', number>;
  /**
   * The left arm's centre line after the arm was posed to the A-pose: MakeHuman's shoulder and wrist joints projected
   * onto the least-squares line through the arm's section centres.
   */
  arm: { joint: V3; wrist: V3 };
  /** Loop girth at each level (body rings) of the baked mesh, alone and with each target at full strength. */
  girths: Record<'base' | ShapeTarget, Record<BodyRing, number>>;
  /** Quantisation: position = offset + step · int16; delta = step · int16. */
  quant: { offset: V3; step: number; deltaStep: number };
  /** Sparse delta counts, in `SHAPE_TARGETS` order. */
  targetCounts: number[];
  source: { name: string; repository: string; commit: string; licence: string };
}

export interface RealisticBodyAsset {
  meta: RealisticBodyMeta;
  /** xyz per vertex, cm, the baked A-pose. */
  positions: Float32Array;
  indices: Uint32Array;
  /** 0..1 per vertex: how much the vertex follows its arm (MakeHuman's own skin weights of the arm bones). */
  armWeight: Float32Array;
  /** 0..1 per vertex: how much the vertex belongs to the head (MakeHuman's weights of the head and its child bones). */
  headWeight: Float32Array;
  /** Per shape target: vertex ids and xyz deltas (cm) at full strength. */
  targets: Record<ShapeTarget, { ids: Uint32Array; deltas: Float32Array }>;
}

// ---------------------------------------------------------------------------
// Binary file: 'CRB1', u32 JSON length, JSON meta (padded to 4), then the arrays in a fixed order.
// ---------------------------------------------------------------------------

const pad4 = (n: number): number => (n + 3) & ~3;

export function encodeRealisticBody(asset: RealisticBodyAsset): Uint8Array {
  const { meta } = asset;
  const n = meta.vertexCount;
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const parts: Uint8Array[] = [];
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, MAGIC, true);
  new DataView(head.buffer).setUint32(4, json.length, true);
  parts.push(head, json, new Uint8Array(pad4(json.length) - json.length));
  const q = new Int16Array(3 * n);
  for (let i = 0; i < 3 * n; i++) q[i] = quant((asset.positions[i]! - meta.quant.offset[i % 3]!) / meta.quant.step);
  parts.push(bytesOf(q));
  for (const t of SHAPE_TARGETS) {
    const { ids, deltas } = asset.targets[t];
    const qi = Uint16Array.from(ids);
    const qd = new Int16Array(deltas.length);
    for (let i = 0; i < deltas.length; i++) qd[i] = quant(deltas[i]! / meta.quant.deltaStep);
    parts.push(bytesOf(qi), new Uint8Array(pad4(qi.byteLength) - qi.byteLength), bytesOf(qd), new Uint8Array(pad4(qd.byteLength) - qd.byteLength));
  }
  const idx = Uint16Array.from(asset.indices);
  parts.push(bytesOf(idx), new Uint8Array(pad4(idx.byteLength) - idx.byteLength));
  parts.push(Uint8Array.from(asset.armWeight, (w) => Math.round(Math.min(1, Math.max(0, w)) * 255)));
  parts.push(Uint8Array.from(asset.headWeight, (w) => Math.round(Math.min(1, Math.max(0, w)) * 255)));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function quant(v: number): number {
  const r = Math.round(v);
  if (r < -32768 || r > 32767) throw new RangeError(`realistic body: value ${v} out of int16 range`);
  return r;
}

const bytesOf = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** Decode the asset. Throws on a wrong magic, format or version, or a truncated file. */
export function decodeRealisticBody(bytes: Uint8Array): RealisticBodyAsset {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) throw new Error('realistic body: not a CRB1 file');
  const jl = dv.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + jl))) as RealisticBodyMeta;
  if (meta.format !== REALISTIC_BODY_FORMAT || meta.version !== REALISTIC_BODY_VERSION) throw new Error('realistic body: unknown format or version');
  let o = 8 + pad4(jl);
  const n = meta.vertexCount;
  const take = (len: number): Uint8Array => {
    if (o + len > bytes.byteLength) throw new Error('realistic body: truncated file');
    // A copy with its own buffer (a Node Buffer's slice is a view on a shared pool).
    const s = new Uint8Array(len);
    s.set(bytes.subarray(o, o + len));
    o += pad4(len);
    return s;
  };
  const i16 = (count: number): Int16Array => new Int16Array(take(2 * count).buffer, 0, count);
  const u16 = (count: number): Uint16Array => new Uint16Array(take(2 * count).buffer, 0, count);
  const qp = i16(3 * n);
  const positions = new Float32Array(3 * n);
  for (let i = 0; i < 3 * n; i++) positions[i] = meta.quant.offset[i % 3]! + qp[i]! * meta.quant.step;
  const targets = {} as RealisticBodyAsset['targets'];
  SHAPE_TARGETS.forEach((t, k) => {
    const c = meta.targetCounts[k]!;
    const ids = Uint32Array.from(u16(c));
    const qd = i16(3 * c);
    targets[t] = { ids, deltas: Float32Array.from(qd, (v) => v * meta.quant.deltaStep) };
  });
  const indices = Uint32Array.from(u16(3 * meta.triangleCount));
  const aw = take(n);
  const hw = take(n);
  return { meta, positions, indices, armWeight: Float32Array.from(aw, (v) => v / 255), headWeight: Float32Array.from(hw, (v) => v / 255), targets };
}

// ---------------------------------------------------------------------------
// The target: the ring table of the body to draw
// ---------------------------------------------------------------------------

export interface FitRing {
  id: AnchorRing;
  girthCm: number;
  centre: V3;
  /** Plane normal (+Y for body rings, the arm axis for arm rings). */
  normal: V3;
  u: V3;
  v: V3;
}

export interface FitArm {
  joint: V3;
  /** Unit axis towards the hand. */
  axis: V3;
  /**
   * Wrist to fingertip along the axis (cm): the ring table's hand (0.108 × stature, the mannequin's `handCm`). Absent:
   * 0.108 × the target's stature.
   */
  handCm?: number;
}

/** Hand length as a share of stature (wrist to fingertip; the mannequin's `HAND`, ordinary human proportion). */
export const HAND_SHARE = 0.108;

export interface FitTarget {
  statureCm: number;
  crotchY: number;
  /** All 12 rings, left side for the limbs (the right is the mirror). */
  rings: FitRing[];
  arms: { left: FitArm; right: FitArm };
}

/**
 * The ring table of a drawn body: the mannequin `m` with every body ring's girth multiplied by `scaleAt(height)` (the
 * avatar's grading morph; 1 for a body built with `buildBody`) and arm rings as they are, or the given girths.
 * Centres of the body rings scale like the collision field's sections (about the vertical axis).
 */
export function fitTargetOf(m: Mannequin, girths?: Partial<Record<AnchorRing, number>>, scaleAt: (y: number) => number = () => 1): FitTarget {
  const rings: FitRing[] = m.rings.map((r) => {
    const arm = r.part.startsWith('arm');
    const s = arm ? 1 : scaleAt(m.morphHeights[r.id]);
    return {
      id: r.id,
      girthCm: girths?.[r.id] ?? r.circumferenceCm * s,
      centre: [r.centre[0] * s, r.centre[1], r.centre[2] * s],
      normal: [...r.normal] as V3,
      u: [...r.u] as V3,
      v: [...r.v] as V3,
    };
  });
  const arm = (f: Mannequin['arms']['left']): FitArm => ({ joint: [...f.joint] as V3, axis: [...f.axis] as V3, handCm: f.handCm });
  return { statureCm: m.statureCm, crotchY: m.landmarks.crotch[1], rings, arms: { left: arm(m.arms.left), right: arm(m.arms.right) } };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const dot3 = (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Plane coordinates of a loop's points. */
function planePoints(loop: Loop, origin: V3, u: V3, v: V3): [number, number][] {
  return loop.points.map((p) => {
    const d: V3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    return [dot3(d, u), dot3(d, v)];
  });
}

function contains(q: readonly [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i]!;
    const [xj, yj] = q[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function area(q: readonly [number, number][]): number {
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i]!;
    const [x1, y1] = q[(i + 1) % q.length]!;
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** Perimeter of the convex hull of plane points (the tape girth). */
export function hullPerimeter(q: readonly [number, number][]): number {
  const p = [...q].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return 0;
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, pt) <= 0) lower.pop();
    lower.push(pt);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, pt) <= 0) upper.pop();
    upper.push(pt);
  }
  const h = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  let l = 0;
  for (let i = 0; i < h.length; i++) l += Math.hypot(h[(i + 1) % h.length]![0] - h[i]![0], h[(i + 1) % h.length]![1] - h[i]![1]);
  return l;
}

export interface Section {
  loop: Loop;
  /** Plane coordinates (along u, v) about the plane origin. */
  q: [number, number][];
  /** Loop girth, cm. */
  loopCm: number;
  /** Convex hull girth (tape), cm. */
  tapeCm: number;
  /** Centroid of the points in plane coordinates. */
  cu: number;
  cv: number;
  /** Centroid of the enclosed area in plane coordinates (the section's centre used to place it). */
  au: number;
  av: number;
  /** Whether the plane origin lies inside the loop. */
  containsOrigin: boolean;
}

function sectionOf(loop: Loop, origin: V3, u: V3, v: V3): Section {
  const q = planePoints(loop, origin, u, v);
  let cu = 0, cv = 0;
  for (const [x, y] of q) {
    cu += x / q.length;
    cv += y / q.length;
  }
  let a = 0, au = 0, av = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i]!;
    const [x1, y1] = q[(i + 1) % q.length]!;
    const c = x0 * y1 - x1 * y0;
    a += c;
    au += (x0 + x1) * c;
    av += (y0 + y1) * c;
  }
  const areaOk = Math.abs(a) > 1e-9;
  return { loop, q, loopCm: loopLength(loop), tapeCm: hullPerimeter(q), cu, cv, au: areaOk ? au / (3 * a) : cu, av: areaOk ? av / (3 * a) : cv, containsOrigin: contains(q, 0, 0) };
}

/**
 * The closed section of the mesh in the plane round `origin` (the smallest closed loop that contains it), or, when
 * no closed loop contains it and `strict` is not set, the closed loop whose centroid is nearest. Null when the plane
 * meets no closed loop (or, with `strict`, none that contains the origin). Measuring uses `strict` (a ring centre
 * outside the drawn section is a misplaced body, not a girth); only the fit's own placement steps use the fallback.
 */
export function sectionAt(positions: ArrayLike<number>, indices: ArrayLike<number>, origin: V3, normal: V3, u: V3, v: V3, filter?: (t: number) => boolean, strict = false): Section | null {
  const loops = slice(positions, indices, { origin, normal }, filter).filter((l) => l.closed && l.points.length > 2);
  let best: Section | null = null;
  let bestArea = Infinity;
  let near: Section | null = null;
  let nearD = Infinity;
  for (const loop of loops) {
    const s = sectionOf(loop, origin, u, v);
    if (s.containsOrigin) {
      const a = Math.abs(area(s.q));
      if (a < bestArea) {
        best = s;
        bestArea = a;
      }
    }
    const d = Math.hypot(s.cu, s.cv);
    if (d < nearD) {
      near = s;
      nearD = d;
    }
  }
  return best ?? (strict ? null : near);
}

/** All closed horizontal sections at height y. */
export function horizontalSections(positions: ArrayLike<number>, indices: ArrayLike<number>, y: number): Section[] {
  return slice(positions, indices, { origin: [0, y, 0], normal: [0, 1, 0] })
    .filter((l) => l.closed && l.points.length > 2)
    .map((l) => sectionOf(l, [0, y, 0], [1, 0, 0], [0, 0, 1]));
}

// ---------------------------------------------------------------------------
// Fit
// ---------------------------------------------------------------------------

/** The share of the neck's girth scale the head takes on (as the procedural mannequin's `HEAD_SCALE_SHARE`). */
const HEAD_SHARE = 0.2;
/** Width of the smooth left/right switch of the leg centres across the midline, cm. */
const MIDLINE_CM = 3;
/** Iterations of the girth and centre correction (each sets every ring's scale to target / measured, and moves each section's centre onto its ring's). */
const FIT_ITERATIONS = 8;
/**
 * Half-height of the band round the shoulder ring whose horizontal scale sets the shoulder girth, cm. Wide and with a
 * C2 fade (smootherstep), so the change of scale leaves no ridge across the upper chest; the arms are not in it (they
 * stay on the ring table's arm frame).
 */
const SHOULDER_BAND_CM = 11;
/** Stations along each arm, as shares of the way from the upper-arm ring to the wrist ring, where the section is centred on the axis. */
const ARM_STATIONS = [0, 0.25, 0.5, 0.75, 1];

export interface FitOptions {
  /** Shape sliders in [-1, 1]; by default solved from the target's girths (`shapeFor`). */
  shape?: { weight: number; cup: number };
  /** Correction iterations (default 8; 0 leaves the rings at the uniform start). */
  iterations?: number;
  /** `false` leaves the arm sections where the rigid placement puts them (for the negative control of the centre test). */
  centreArms?: boolean;
}

export interface RingResult {
  id: AnchorRing;
  targetCm: number;
  /** Loop girth on the fitted mesh, cm (null: the plane met no closed section). */
  loopCm: number | null;
  /** Tape (convex hull) girth on the fitted mesh, cm. */
  tapeCm: number | null;
  /** (loop − target) / target, %. */
  errorPct: number | null;
}

export interface FitResult {
  mesh: Mesh;
  shape: { weight: number; cup: number };
  rings: RingResult[];
}

/**
 * The shape sliders, before the per-ring scale (which makes every girth exact anyway): `weight` in [-1, 1] so that the
 * seat girth over stature is the target's (a slim body draws MakeHuman's low weight, a full one its high weight), and
 * `cup` in [-1, 0] so that the bust's own size, chest minus underbust in cm (how a cup is measured), is the target's
 * at that weight. Uses the bake's girths (`meta.girths`), linear in each slider's half; a grid of 0.05.
 *
 * Until 21 Nov the cup matched chest OVER underbust. MakeHuman's high weight already raises that ratio, so a full body
 * got the cup at -0.85 (a flat bust) and the per-ring scale put the chest's girth into the back and shoulders instead.
 * The difference keeps the bust's own volume. `cup+` is not used: at full strength its breast falls through the bake's
 * underbust level (that level's girth grows 28 cm, the chest level's 4 cm), so the level girths read it as a smaller
 * bust; a bigger bust than MakeHuman's default comes from the per-ring scale.
 */
export function shapeFor(meta: RealisticBodyMeta, target: FitTarget): { weight: number; cup: number } {
  const want = new Map(target.rings.map((r) => [r.id, r.girthCm]));
  const g = meta.girths;
  const at = (r: BodyRing, w: number, c: number): number => {
    const base = g.base[r];
    const gw = w >= 0 ? w * (g['weight+'][r] - base) : -w * (g['weight-'][r] - base);
    const gc = c >= 0 ? c * (g['cup+'][r] - base) : -c * (g['cup-'][r] - base);
    return base + gw + gc;
  };
  const seat = Math.log(want.get('hip')! / target.statureCm);
  const cupCm = want.get('chest')! - want.get('underbust')!;
  const chest = want.get('chest')!;
  let best = { weight: 0, cup: 0 };
  let bestCost = Infinity;
  for (let wi = -20; wi <= 20; wi++) {
    for (let ci = -20; ci <= 0; ci++) {
      const w = wi / 20, c = ci / 20;
      const cost = (Math.log(at('hip', w, c) / meta.statureCm) - seat) ** 2 + ((at('chest', w, c) - at('underbust', w, c) - cupCm) / chest) ** 2 + 1e-5 * (w * w + c * c);
      if (cost < bestCost) {
        bestCost = cost;
        best = { weight: w, cup: c };
      }
    }
  }
  return best;
}

/** The asset with its shape sliders applied (positions only). */
export function morphed(asset: RealisticBodyAsset, shape: { weight: number; cup: number }): Float64Array {
  const p = Float64Array.from(asset.positions);
  const add = (t: ShapeTarget, k: number): void => {
    if (k <= 0) return;
    const { ids, deltas } = asset.targets[t];
    for (let j = 0; j < ids.length; j++) {
      const i = ids[j]!;
      for (let c = 0; c < 3; c++) p[3 * i + c] = p[3 * i + c]! + k * deltas[3 * j + c]!;
    }
  };
  add('weight+', shape.weight);
  add('weight-', -shape.weight);
  add('cup+', shape.cup);
  add('cup-', -shape.cup);
  return p;
}

/** Rotation matrix (row-major 3x3) taking unit vector a onto unit vector b. */
function rotationBetween(a: V3, b: V3): number[] {
  const c = dot3(a, b);
  const v: V3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const k = 1 / (1 + c);
  return [
    v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1],
    v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0],
    v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c,
  ];
}

const mul = (r: number[], x: V3): V3 => [r[0]! * x[0] + r[1]! * x[1] + r[2]! * x[2], r[3]! * x[0] + r[4]! * x[1] + r[5]! * x[2], r[6]! * x[0] + r[7]! * x[1] + r[8]! * x[2]];
const unit = (x: V3): V3 => {
  const l = Math.hypot(x[0], x[1], x[2]) || 1;
  return [x[0] / l, x[1] / l, x[2] / l];
};
const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** C2 smootherstep on [0, 1]. */
const smoother = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c * (c * (6 * c - 15) + 10);
};
/** A unit vector perpendicular to `a`, and the third one of the frame. */
function planeBasis(a: V3): { u: V3; v: V3 } {
  const ref: V3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const d = dot3(ref, a);
  const v = unit([ref[0] - d * a[0], ref[1] - d * a[1], ref[2] - d * a[2]]);
  const u: V3 = [v[1] * a[2] - v[2] * a[1], v[2] * a[0] - v[0] * a[2], v[0] * a[1] - v[1] * a[0]];
  return { u, v };
}

/**
 * Deform the asset so that its loop girth at every ring of `target` is the target girth:
 *
 * 1. shape sliders (weight, cup) from the target's seat over stature and chest minus underbust (`shapeFor`);
 * 2. a vertical warp (monotone C1 cubic, `warpThrough`) that puts each anatomical level of the bake at its ring's height, the crotch
 *    at the target's crotch and the top of the head at the stature;
 * 3. the torso's sections moved to the ring table's centre line, the legs' to the table's leg centres;
 * 4. each arm moved rigidly onto the table's arm frame (joint, axis) and stretched along it so the wrist joint lands
 *    on the wrist ring, blended into the torso by MakeHuman's own arm weights;
 * 5. a radial scale per height (body chain, about the section centre) and per distance along the arm (arm chain,
 *    about the axis), a monotone cubic through one knot per ring, corrected `iterations` times to target / measured;
 *    in the same loop each torso ring's section and five stations along each arm are moved so the centre of the
 *    section's area lies on the ring table's centre line or arm axis.
 *
 * The head takes a fifth of the neck's scale. The result is a plain `Mesh` (one part, `body`).
 */
export function fitRealisticBody(asset: RealisticBodyAsset, target: FitTarget, options: FitOptions = {}): FitResult {
  const meta = asset.meta;
  const n = meta.vertexCount;
  const idx = asset.indices;
  const shape = options.shape ?? shapeFor(meta, target);
  const P = morphed(asset, shape);
  const ring = new Map(target.rings.map((r) => [r.id, r]));
  const h = (id: AnchorRing): number => ring.get(id)!.centre[1];

  // 2. Vertical warp of the body (arms are placed in step 4).
  // The shoulder and neck rings are not knots: from the chest to the top of the head the body is stretched evenly, so the
  // slope from neck to shoulder keeps MakeHuman's proportions (with them as knots the trapezius was squashed flat).
  const knots = [{ x: 0, y: 0 }, { x: meta.levels.crotch, y: target.crotchY }, { x: meta.levels.top, y: target.statureCm }, ...BODY_RINGS.filter((r) => r !== 'shoulder' && r !== 'neck').map((r) => ({ x: meta.levels[r], y: h(r) }))];
  const warp = warpThrough(knots);
  const B = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    B[3 * i] = P[3 * i]!;
    B[3 * i + 1] = warp(P[3 * i + 1]!);
    B[3 * i + 2] = P[3 * i + 2]!;
  }

  // 3. Section centres onto the table's centre lines. Torso: at each torso ring and between them; legs: at the leg rings.
  const legLo = h('thigh');
  // From the hip ring (0: the torso's centre) down to the thigh ring (1: each leg's own centre), smoothly: a short
  // switch just over the crotch left a crease across the tops of the thighs.
  const legHi = h('hip');
  const legness = (y: number): number => smooth((legHi - y) / (legHi - legLo));
  const legRings: BodyRing[] = ['thigh', 'knee', 'calf', 'ankle'];
  const torsoRings: BodyRing[] = ['hip', 'waist', 'underbust', 'chest', 'shoulder', 'neck'];
  const torsoKnots: { x: number; y: number }[] = [];
  const torsoKnotsX: { x: number; y: number }[] = [];
  for (const r of torsoRings) {
    const rr = ring.get(r)!;
    const s = sectionAt(B, idx, rr.centre, [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    if (!s) continue;
    // The section's own centre (centroid of its points) is moved to the ring's centre.
    torsoKnots.push({ x: rr.centre[1], y: -s.cv });
    torsoKnotsX.push({ x: rr.centre[1], y: -s.cu });
  }
  const legKnotsX: { x: number; y: number }[] = [];
  const legKnotsZ: { x: number; y: number }[] = [];
  for (const r of legRings) {
    const rr = ring.get(r)!;
    const s = sectionAt(B, idx, rr.centre, [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    if (!s) continue;
    legKnotsX.push({ x: rr.centre[1], y: -s.cu });
    legKnotsZ.push({ x: rr.centre[1], y: -s.cv });
  }
  const tdz = monotoneProfile(torsoKnots), tdx = monotoneProfile(torsoKnotsX);
  const ldx = monotoneProfile(legKnotsX), ldz = monotoneProfile(legKnotsZ);
  const legCentreX = monotoneProfile(legRings.map((r) => ({ x: h(r), y: ring.get(r)!.centre[0] })));
  for (let i = 0; i < n; i++) {
    const y = B[3 * i + 1]!;
    const l = legness(y);
    const side = smoothSign(B[3 * i]!);
    B[3 * i] = B[3 * i]! + (1 - l) * tdx(y) + l * side * ldx(y);
    B[3 * i + 2] = B[3 * i + 2]! + (1 - l) * tdz(y) + l * ldz(y);
  }

  // 4. Arms: rigid onto the table's frame, stretched along the axis so the wrist joint lands at the wrist ring, and the
  //    hand (past the wrist joint) scaled on its own to the table's hand length. Until 22 Nov the hand took the arm's
  //    stretch and came out at 0.122 × stature instead of 0.108, so the fingertips hung about 2.4 cm too low (WO-001).
  const A = new Float64Array(3 * n);
  const armS = new Float64Array(n);
  const sides: { side: 1 | -1; frame: FitArm }[] = [{ side: 1, frame: target.arms.left }, { side: -1, frame: target.arms.right }];
  const wristRing = ring.get('wrist')!;
  const tj = target.arms.left.joint;
  const sWrist = dot3([wristRing.centre[0] - tj[0], wristRing.centre[1] - tj[1], wristRing.centre[2] - tj[2]], target.arms.left.axis);
  for (const { side, frame } of sides) {
    const j0: V3 = [side * meta.arm.joint[0], meta.arm.joint[1], meta.arm.joint[2]];
    const w0: V3 = [side * meta.arm.wrist[0], meta.arm.wrist[1], meta.arm.wrist[2]];
    const d0: V3 = [w0[0] - j0[0], w0[1] - j0[1], w0[2] - j0[2]];
    const len0 = Math.hypot(...d0);
    const a0 = unit(d0);
    const R = rotationBetween(a0, frame.axis);
    const stretch = sWrist / len0;
    // MakeHuman's own hand: from its wrist joint to the farthest arm vertex along its arm axis.
    let tip0 = len0;
    for (let i = 0; i < n; i++) {
      if (Math.sign(P[3 * i]!) !== side || asset.armWeight[i]! < 0.5) continue;
      tip0 = Math.max(tip0, dot3([P[3 * i]! - j0[0], P[3 * i + 1]! - j0[1], P[3 * i + 2]! - j0[2]], a0));
    }
    const handK = tip0 > len0 ? (frame.handCm ?? HAND_SHARE * target.statureCm) / (tip0 - len0) : stretch;
    for (let i = 0; i < n; i++) {
      const x = P[3 * i]!;
      if (Math.sign(x) !== side || asset.armWeight[i] === 0) continue;
      const rel: V3 = [x - j0[0], P[3 * i + 1]! - j0[1], P[3 * i + 2]! - j0[2]];
      const along = dot3(rel, a0);
      // Stretch only the part along the axis below the shoulder joint; past the wrist joint, the hand's own scale.
      const to = along <= 0 ? along : along <= len0 ? along * stretch : sWrist + (along - len0) * handK;
      const moved = mul(R, [rel[0] + a0[0] * (to - along), rel[1] + a0[1] * (to - along), rel[2] + a0[2] * (to - along)]);
      A[3 * i] = frame.joint[0] + moved[0];
      A[3 * i + 1] = frame.joint[1] + moved[1];
      A[3 * i + 2] = frame.joint[2] + moved[2];
      armS[i] = dot3(moved, frame.axis);
    }
  }

  // 5. Radial scale, corrected per ring; section centres, corrected onto the ring table's centre line (torso) and arm
  // axis (arms). MakeHuman's forearm is bent forward of the straight line through its joints: without the arm
  // centring the wrist section lay 5 to 7 cm in front of the wrist ring's centre (outside the wrist).
  const bodyScale: Record<BodyRing, number> = Object.fromEntries(BODY_RINGS.map((r) => [r, 1])) as Record<BodyRing, number>;
  const armScale: Record<ArmRing, number> = { upper_arm: 1, wrist: 1 };
  const armDist: Record<ArmRing, number> = { upper_arm: 0, wrist: 0 };
  for (const r of ARM_RINGS) {
    const rr = ring.get(r)!;
    armDist[r] = dot3([rr.centre[0] - tj[0], rr.centre[1] - tj[1], rr.centre[2] - tj[2]], target.arms.left.axis);
  }
  // How far along the arm the shoulder band reaches (to halfway between the upper-arm ring and the wrist ring): a
  // longer fade than to the upper-arm ring, so the arm root bends into the arm without a notch; the arm's own scale and
  // centring take the rest of it out at the upper-arm ring.
  const armFade = armDist.upper_arm + 0.5 * (armDist.wrist - armDist.upper_arm);
  const torsoCentre = torsoRings.map((r) => ({ ring: r, y: h(r), dx: 0, dz: 0 }));
  const legCentre = legRings.map((r) => ({ ring: r, y: h(r), dx: 0, dz: 0 }));
  const stations = ARM_STATIONS.map((f) => armDist.upper_arm + f * (armDist.wrist - armDist.upper_arm));
  const armFix = sides.map(({ frame }) => ({ frame, basis: planeBasis(frame.axis), at: stations.map((s) => ({ s, d: [0, 0, 0] as V3 })) }));
  const neckY = h('neck');
  // The shoulder ring cuts through the arm roots, which follow the arm (step 4), not the body's scale: its girth is
  // set by a horizontal scale of the body (not the arms) in a band round the ring (`shoulderBand`), fading out over SHOULDER_BAND_CM.
  const shoulderY = h('shoulder');
  let shoulderBand = 1;
  const band = (y: number): number => 1 - smoother(Math.abs(y - shoulderY) / SHOULDER_BAND_CM);
  const out = new Float64Array(3 * n);
  const apply = (): void => {
    // The body's own scale at the shoulder ring is halfway between the chest's and the neck's; the band does the rest.
    bodyScale.shoulder = (bodyScale.chest + bodyScale.neck) / 2;
    const kb = monotoneProfile(BODY_RINGS.map((r) => ({ x: h(r), y: bodyScale[r] })));
    const ka = monotoneProfile(ARM_RINGS.map((r) => ({ x: armDist[r], y: armScale[r] })));
    const cxT = monotoneProfile(torsoCentre.map((c) => ({ x: c.y, y: c.dx })));
    const czT = monotoneProfile(torsoCentre.map((c) => ({ x: c.y, y: c.dz })));
    const cxL = monotoneProfile(legCentre.map((c) => ({ x: c.y, y: c.dx })));
    const czL = monotoneProfile(legCentre.map((c) => ({ x: c.y, y: c.dz })));
    // Per arm, the centring offset along the axis: 0 at the shoulder joint, through the stations, held past the wrist.
    const fix = armFix.map((a) => [0, 1, 2].map((c) => monotoneProfile([{ x: 0, y: 0 }, ...a.at.map((p) => ({ x: p.s, y: p.d[c]! }))])));
    for (let i = 0; i < n; i++) {
      const y = B[3 * i + 1]!;
      const l = legness(y);
      const cx = l * smoothSign(B[3 * i]!) * legCentreX(y);
      let k = kb(y);
      const hw = asset.headWeight[i]!;
      if (hw > 0 && y > neckY) k = k + (1 + HEAD_SHARE * (k - 1) - k) * hw;
      const b = band(y);
      const kband = b > 0 ? Math.pow(shoulderBand, b) : 1;
      const sg = smoothSign(B[3 * i]!);
      let x = kband * (cx + k * (B[3 * i]! - cx) + (1 - l) * cxT(y) + l * sg * cxL(y));
      let yy = y;
      let z = kband * (k * B[3 * i + 2]! + (1 - l) * czT(y) + l * czL(y));
      const w = asset.armWeight[i]!;
      if (w > 0) {
        const left = Math.sign(P[3 * i]!) >= 0;
        const side = left ? target.arms.left : target.arms.right;
        const f = fix[left ? 0 : 1]!;
        const s = armS[i]!;
        const ks = ka(s);
        const c: V3 = [side.joint[0] + side.axis[0] * s, side.joint[1] + side.axis[1] * s, side.joint[2] + side.axis[2] * s];
        const ax = c[0] + ks * (A[3 * i]! + f[0]!(s) - c[0]);
        const ay = c[1] + ks * (A[3 * i + 1]! + f[1]!(s) - c[1]);
        const az = c[2] + ks * (A[3 * i + 2]! + f[2]!(s) - c[2]);
        // The arm's root takes the shoulder band too (the shoulder ring goes round it), fading out along the arm
        // before the upper-arm ring, so the upper arm stays on the table's arm frame and the root bends smoothly into it.
        const ab = band(ay) * (1 - smoother(s / armFade));
        const karm = ab > 0 ? Math.pow(shoulderBand, ab) : 1;
        x += w * (karm * ax - x);
        yy += w * (ay - yy);
        z += w * (karm * az - z);
      }
      out[3 * i] = x;
      out[3 * i + 1] = yy;
      out[3 * i + 2] = z;
    }
  };
  const iterations = options.iterations ?? FIT_ITERATIONS;
  apply();
  for (let it = 0; it < iterations; it++) {
    for (const r of [...BODY_RINGS, ...ARM_RINGS]) {
      const rr = ring.get(r)!;
      const s = sectionAt(out, idx, rr.centre, rr.normal, rr.u, rr.v);
      if (!s || !(s.loopCm > 0)) continue;
      const f = rr.girthCm / s.loopCm;
      if (r === 'shoulder') shoulderBand *= f;
      else if ((BODY_RINGS as readonly string[]).includes(r)) bodyScale[r as BodyRing] *= f;
      else armScale[r as ArmRing] *= f;
      const tc = torsoCentre.find((c) => c.ring === r) ?? legCentre.find((c) => c.ring === r);
      if (tc) {
        tc.dx -= s.au;
        tc.dz -= s.av;
      }
    }
    if (options.centreArms !== false) {
      for (const a of armFix) {
        for (const p of a.at) {
          const o: V3 = [a.frame.joint[0] + a.frame.axis[0] * p.s, a.frame.joint[1] + a.frame.axis[1] * p.s, a.frame.joint[2] + a.frame.axis[2] * p.s];
          const s = sectionAt(out, idx, o, a.frame.axis, a.basis.u, a.basis.v);
          if (!s) continue;
          for (let c = 0; c < 3; c++) p.d[c] = p.d[c]! - (s.au * a.basis.u[c]! + s.av * a.basis.v[c]!);
        }
      }
    }
    apply();
  }
  const mesh: Mesh = { positions: out, indices: Uint32Array.from(idx), vertexPart: new Uint8Array(n), partNames: ['body'] };
  return { mesh, shape, rings: ringReport(mesh, target) };
}

/** Loop and tape girth of the mesh at every ring of the target, and the loop's error against the table. */
export function ringReport(mesh: Pick<Mesh, 'positions' | 'indices'>, target: FitTarget): RingResult[] {
  return target.rings.map((r) => {
    // Strict: a ring centre outside every drawn section reads as no section (null), never as the nearest loop.
    const s = sectionAt(mesh.positions, mesh.indices, r.centre, r.normal, r.u, r.v, undefined, true);
    return {
      id: r.id,
      targetCm: r.girthCm,
      loopCm: s ? s.loopCm : null,
      tapeCm: s ? s.tapeCm : null,
      errorPct: s ? (100 * (s.loopCm - r.girthCm)) / r.girthCm : null,
    };
  });
}

/**
 * Monotone C1 cubic through rising knots (Fritsch–Carlson slopes, the end slopes the end secants), extrapolated along
 * the end slopes. C1, so the stretch changes smoothly between levels and leaves no crease in the shading.
 */
export function warpThrough(knots: { x: number; y: number }[]): (x: number) => number {
  const k = [...knots].sort((a, b) => a.x - b.x);
  const n = k.length;
  const h = k.slice(1).map((p, i) => p.x - k[i]!.x);
  const d = k.slice(1).map((p, i) => (p.y - k[i]!.y) / h[i]!);
  const m = k.map((_, i) => (i === 0 ? d[0]! : i === n - 1 ? d[n - 2]! : d[i - 1]! * d[i]! <= 0 ? 0 : (3 * (h[i - 1]! + h[i]!)) / ((2 * h[i]! + h[i - 1]!) / d[i - 1]! + (h[i]! + 2 * h[i - 1]!) / d[i]!)));
  return (x) => {
    if (x <= k[0]!.x) return k[0]!.y + m[0]! * (x - k[0]!.x);
    if (x >= k[n - 1]!.x) return k[n - 1]!.y + m[n - 1]! * (x - k[n - 1]!.x);
    let i = 0;
    while (i < n - 2 && x > k[i + 1]!.x) i++;
    const t = (x - k[i]!.x) / h[i]!;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * k[i]!.y + (t3 - 2 * t2 + t) * h[i]! * m[i]! + (-2 * t3 + 3 * t2) * k[i + 1]!.y + (t3 - t2) * h[i]! * m[i + 1]!;
  };
}

const smoothSign = (x: number): number => {
  const t = Math.max(-1, Math.min(1, x / MIDLINE_CM));
  return t * (1.5 - 0.5 * t * t) * (1 / 1);
};

// ---------------------------------------------------------------------------
// Conform: the drawn skin kept inside the collision field where a garment covers it
// ---------------------------------------------------------------------------

/** Where a garment covers the body (body space, cm): a height range for the torso and legs, a reach along each arm. */
export interface CoverZone {
  yLo: number;
  yHi: number;
  /** Largest distance along the left and the right arm axis that the garment reaches (0: the arm is bare). */
  armS: [number, number];
}

/**
 * The zone a garment's particles cover, with a margin: their height range, and per arm the farthest point along its
 * axis that lies within the arm's collision ellipse grown 1.6 times plus 2 cm (a sleeve; a bodice beside the arm is
 * further out). `positions` and `field` in the same space.
 */
export function coverZone(positions: ArrayLike<number>, field: BodyField, marginCm = 2): CoverZone {
  let yLo = Infinity, yHi = -Infinity;
  const armS: [number, number] = [0, 0];
  const e = new Float32Array(4);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    yLo = Math.min(yLo, y);
    yHi = Math.max(yHi, y);
    for (let side = 0; side < 2; side++) {
      const f = field.armFrames[side]!;
      const r: V3 = [x - f.joint[0], y - f.joint[1], z - f.joint[2]];
      const sAlong = dot3(r, f.axis);
      if (sAlong <= f.s0 || sAlong >= f.s1 || !sample(field.arms[side]!, sAlong, e)) continue;
      const pu = dot3(r, f.u), pv = dot3(r, f.v);
      if (Math.hypot(pu / (1.6 * e[2]! + 2), pv / (1.6 * e[3]! + 2)) <= 1) armS[side] = Math.max(armS[side]!, sAlong);
    }
  }
  return { yLo: yLo - marginCm, yHi: yHi + marginCm, armS: [armS[0] > 0 ? armS[0] + marginCm : 0, armS[1] > 0 ? armS[1] + marginCm : 0] };
}

/** The largest outward scale of the covered skin inside the field when the girth is given back (`conformToField`). */
const GIRTH_BACK_MAX = 0.2;
/** Secant refinements of the share per station (`conformToField`). */
const GIRTH_BACK_PASSES = 3;

/** Options of `conformToField`. */
export interface ConformOptions {
  /** Pull the skin inside the field this much beyond it, cm (under the cloth's own 0.35 cm). Default 0.1. */
  clearanceCm?: number;
  /** Fade of the pull at the zone's edges (hem, sleeve end), cm. Default 3. */
  blendCm?: number;
  /**
   * Default true: give back the girth the pull took, by pushing the covered skin that lies inside the field out
   * towards it (never past it), per height, by the share that makes the loop at that height the fitted mesh's again.
   * False: the pull alone (before 21 Nov: chest 2 to 5 %, waist 3 to 4 %, hip up to 2.3 % under the table).
   */
  keepGirth?: boolean;
  /** Spacing of the heights where the girth is given back, cm. Default 1.5. */
  stepCm?: number;
}

/**
 * The fitted mesh with every vertex that a garment covers (`zone`) pulled inside the collision field the cloth meets
 * (grown by `clearanceCm`), so the drawn skin does not show through the garment. Only vertices outside the field
 * move, straight towards the section's centre; then (`keepGirth`) the covered skin inside the field is pushed out
 * towards it, so that the torso's and legs' girths are the fitted mesh's again (the cleavage and the small of the back
 * are filled in under the garment; nothing ends up outside the field). The pull fades out over `blendCm` at the zone's
 * edges. Torso, the arm's root above the armpit and legs by height, arms (arm weight over a half, beyond the armpit)
 * along the arm axis; the head and the band under the armpit are left as fitted.
 *
 * A DISPLAY mesh: it is drawn, never measured. Girths, ring reports, the fit and the sizes use the fitted mesh (the
 * mount draws this one only while a garment is on screen). The arms are pulled but not given their girth back.
 */
export function conformToField(mesh: Mesh, asset: Pick<RealisticBodyAsset, 'armWeight' | 'headWeight'>, field: BodyField, crotchY: number, zone: CoverZone, options: ConformOptions = {}): Mesh {
  const clearanceCm = options.clearanceCm ?? 0.1;
  const blendCm = options.blendCm ?? 3;
  const src = mesh.positions;
  const p = Float64Array.from(src);
  const e = new Float32Array(4);
  const n = p.length / 3;
  const fade = (d: number): number => smooth(d / blendCm);
  // Per vertex held by height (torso and legs): the zone weight, the section centre, and how far it may go out (room).
  const held = new Uint8Array(n);
  const room = new Float64Array(n);
  const wz = new Float64Array(n);
  const ce = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    if (asset.headWeight[i]! > 0.5) continue;
    const x = p[3 * i]!, y = p[3 * i + 1]!, z = p[3 * i + 2]!;
    const side = x >= 0 ? 0 : 1;
    const f = field.armFrames[side]!;
    const r: V3 = [x - f.joint[0], y - f.joint[1], z - f.joint[2]];
    const sAlong = dot3(r, f.axis);
    const aw = asset.armWeight[i]!;
    // Above the armpit (along the arm, up to the collider's `s0`) the cloth meets the torso's section, which takes the
    // arm's root in: those vertices are held to it like the torso's. Under the armpit, a vertex between torso and arm
    // (arm weight 0.15 to 0.5) is left as fitted: neither ellipse is the right one there.
    const cap = aw > 0.15 && sAlong <= f.s0;
    if (!cap && aw > 0.15 && aw <= 0.5) continue;
    if (!cap && aw > 0.5) {
      // An arm vertex: inside the arm's ellipse, in its (u, v) frame about the axis.
      const reach = zone.armS[side]!;
      if (!(reach > 0) || sAlong >= f.s1 || !sample(field.arms[side]!, sAlong, e)) continue;
      const w = fade(reach - sAlong);
      if (w <= 0) continue;
      const pu = dot3(r, f.u), pv = dot3(r, f.v);
      const k = limit(pu, pv, e[2]!, e[3]!, clearanceCm);
      if (k >= 1) continue;
      const kk = 1 + (k - 1) * w;
      for (let c = 0; c < 3; c++) p[3 * i + c] = f.joint[c]! + f.axis[c]! * sAlong + (f.u[c]! * pu + f.v[c]! * pv) * kk;
      continue;
    }
    const w = Math.min(fade(y - zone.yLo), fade(zone.yHi - y));
    if (w <= 0) continue;
    const table = y < crotchY ? field.legs[side] : field.torso;
    if (!sample(table, y, e)) continue;
    const k = limit(x - e[0]!, z - e[1]!, e[2]!, e[3]!, clearanceCm);
    held[i] = 1;
    wz[i] = w;
    ce[2 * i] = e[0]!;
    ce[2 * i + 1] = e[1]!;
    if (k >= 1) {
      // Inside: how far out it may be pushed (onto the grown ellipse along its ray).
      room[i] = reach(x - e[0]!, z - e[1]!, e[2]!, e[3]!, clearanceCm);
      continue;
    }
    room[i] = 1;
    const kk = 1 + (k - 1) * w;
    p[3 * i] = e[0]! + (x - e[0]!) * kk;
    p[3 * i + 2] = e[1]! + (z - e[1]!) * kk;
  }
  if (options.keepGirth === false) return { ...mesh, positions: p };

  // Girth back, per height: the covered skin inside the field is scaled out about the section centre by 1 + g (never
  // past the grown ellipse; a scale keeps folds such as the cleavage and the seat's cleft, which filling in would
  // shorten), g = share · GIRTH_BACK_MAX. The share at each station makes the loop the fitted mesh's again: secant from
  // the pulled mesh (share 0) and the full scale (share 1), one secant step refined. Torso stations about the field's
  // torso centre; leg stations about the left leg's (the body is symmetric) and used for both legs.
  const idx = mesh.indices;
  const step = options.stepCm ?? 1.5;
  const loopAt = (pos: ArrayLike<number>, y: number, leg: boolean): number | null => {
    if (!sample(leg ? field.legs[0] : field.torso, y, e)) return null;
    const s = sectionAt(pos, idx, [e[0]!, y, e[1]!], [0, 1, 0], [1, 0, 0], [0, 0, 1], undefined, true);
    return s ? s.loopCm : null;
  };
  const mix = (share: (y: number, leg: boolean) => number): Float64Array => {
    const q = Float64Array.from(p);
    for (let i = 0; i < n; i++) {
      if (!held[i] || !(room[i]! > 1)) continue;
      const y = p[3 * i + 1]!;
      const k = 1 + (Math.min(1 + share(y, y < crotchY) * GIRTH_BACK_MAX, room[i]!) - 1) * wz[i]!;
      q[3 * i] = ce[2 * i]! + (p[3 * i]! - ce[2 * i]!) * k;
      q[3 * i + 2] = ce[2 * i + 1]! + (p[3 * i + 2]! - ce[2 * i + 1]!) * k;
    }
    return q;
  };
  const full = mix(() => 1);
  // Stations: not within 2 cm of the crotch, where torso and legs meet and no one section is the right one.
  const solved: { y: number; leg: boolean; t: number; l0: number; b: number }[] = [];
  for (let y = Math.max(zone.yLo, 0); y <= zone.yHi; y += step) {
    if (Math.abs(y - crotchY) < 2) continue;
    const leg = y < crotchY;
    const t = loopAt(src, y, leg), l0 = loopAt(p, y, leg), l1 = loopAt(full, y, leg);
    if (t === null || l0 === null || l1 === null) continue;
    solved.push({ y, leg, t, l0, b: l1 > l0 + 1e-6 ? Math.min(1, Math.max(0, (t - l0) / (l1 - l0))) : 0 });
  }
  const profile = (leg: boolean): ((y: number) => number) => {
    const k = solved.filter((s) => s.leg === leg).map((s) => ({ x: s.y, y: s.b }));
    return k.length ? monotoneProfile(k) : () => 0;
  };
  // Secant refinements: the loop is close to linear in the share, not exactly, and a vertex takes the share of its own
  // height, so a station's loop also feels its neighbours' shares.
  let bt = profile(false), bl = profile(true);
  let res = mix((y, leg) => (leg ? bl(y) : bt(y)));
  for (let pass = 0; pass < GIRTH_BACK_PASSES; pass++) {
    for (const s of solved) {
      const lb = loopAt(res, s.y, s.leg);
      if (lb === null || !(Math.abs(lb - s.l0) > 1e-6)) continue;
      if (s.b <= 0 && lb < s.t) s.b = 0.05;
      else s.b = Math.min(1, Math.max(0, (s.b * (s.t - s.l0)) / (lb - s.l0)));
    }
    bt = profile(false);
    bl = profile(true);
    res = mix((y, leg) => (leg ? bl(y) : bt(y)));
  }
  return { ...mesh, positions: res };
}

/** The factor (≥ 1) that takes the point (pu, pv) out onto the ellipse a, b grown by `grow` along its ray. */
function reach(pu: number, pv: number, a: number, b: number, grow: number): number {
  const r = Math.hypot(pu, pv);
  if (r === 0) return 1;
  const re = (a * b) / Math.hypot(b * (pu / r), a * (pv / r)) + grow;
  return Math.max(1, re / r);
}

/** The factor (≤ 1) that brings the point (pu, pv) onto the ellipse a, b grown by `grow` along its ray, or 1 inside. */
function limit(pu: number, pv: number, a: number, b: number, grow: number): number {
  const r = Math.hypot(pu, pv);
  if (r === 0) return 1;
  const re = (a * b) / Math.hypot(b * (pu / r), a * (pv / r)) + grow;
  return r > re ? re / r : 1;
}

// ---------------------------------------------------------------------------
// Polar outlines of the fitted realistic mesh (WO-016 iteration 1, OI-143).
// ---------------------------------------------------------------------------

/** Sampling step for the torso's and legs' polar stack, cm (1 cm paired with the vertex-envelope pass follows bust, underbust, shoulder and seat curves tightly in ~40 ms). */
export const REALISTIC_TORSO_STEP_CM = 1;
export const REALISTIC_LEG_STEP_CM = 2;
/** Arm stations as fractions of the arm frame length (shoulder joint to fingertip `s1`). */
export const REALISTIC_ARM_STATIONS = [0.08, 0.14, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.80, 0.88, 0.95, 1] as const;
/** Where the cap above the shoulder joint closes. Matches male v2. */
const ARM_CAP_REACH_CM = 1.5;

/** Arms and their frame, for the realistic mesh's polar outlines. */
export interface RealisticArmFrame {
  side: 1 | -1;
  /** Shoulder joint in the fitted mesh's space. */
  joint: V3;
  /** Unit axis towards the wrist. */
  axis: V3;
  /** Optional arm section basis matching `Mannequin.arms[side].u / .v` so polar angles align 1:1 with `collide.ts`. */
  u?: V3;
  v?: V3;
  /** The arm's length along its axis (joint to hand end `s1`, cm). */
  lengthCm: number;
  /** Distance along the arm axis to the armpit (cm); vertices with `s <= s0` belong to the shoulder/torso cap. */
  s0?: number;
}

/**
 * Raise bracketing polar outline bins so the piecewise-linear polar stack tightly encloses a mesh
 * vertex `(u, v)` at station coordinate `coord`, using the minimum-L2-norm update on the 4 corner
 * bins `(k0..k1, j0..j1)`. Only moves bins when the vertex strictly exceeds the interpolated radius
 * (convex peaks between slices such as the breast apex, shoulder dome or wrist); flat/concave
 * regions are untouched.
 */
function enclosePolarPoint(
  keys: readonly number[],
  secs: readonly { cu: number; cv: number; r: Float64Array }[],
  coord: number,
  u: number,
  v: number,
  maxDeltaCm = Infinity,
): void {
  if (keys.length < 2 || !(coord >= keys[0]! && coord <= keys[keys.length - 1]!)) return;
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]! <= coord) lo = mid;
    else hi = mid;
  }
  const k0 = lo, k1 = hi;
  const s0 = secs[k0]!, s1 = secs[k1]!;
  const wt = Math.min(1, Math.max(0, (coord - keys[k0]!) / (keys[k1]! - keys[k0]! || 1)));
  const cx = s0.cu + (s1.cu - s0.cu) * wt;
  const cv = s0.cv + (s1.cv - s0.cv) * wt;
  const du = u - cx, dv = v - cv;
  const rv = Math.hypot(du, dv);
  if (!(rv > 1e-6)) return;
  const n = s0.r.length;
  let a = (Math.atan2(dv, du) / (2 * Math.PI)) * n;
  if (a < 0) a += n;
  const j0 = Math.floor(a) % n;
  const j1 = (j0 + 1) % n;
  const wa = a - Math.floor(a);
  const c00 = (1 - wt) * (1 - wa);
  const c01 = (1 - wt) * wa;
  const c10 = wt * (1 - wa);
  const c11 = wt * wa;
  const rCur = c00 * s0.r[j0]! + c01 * s0.r[j1]! + c10 * s1.r[j0]! + c11 * s1.r[j1]!;
  const diff = rv - rCur;
  if (!(diff > 1e-5) || diff > maxDeltaCm) return;
  const norm2 = c00 * c00 + c01 * c01 + c10 * c10 + c11 * c11;
  const scale = diff / norm2;
  s0.r[j0] = s0.r[j0]! + c00 * scale;
  s0.r[j1] = s0.r[j1]! + c01 * scale;
  s1.r[j0] = s1.r[j0]! + c10 * scale;
  s1.r[j1] = s1.r[j1]! + c11 * scale;
}

/**
 * Polar outlines of a fitted realistic body mesh (female; WO-016 iter 1 + iter 2 fixes, OI-143).
 *
 * The torso and legs are sliced by horizontal planes, each closed section turned into a polar outline
 * about its own area centroid `(au, av)` — preserving that true centre `(cx, cz)` in world coordinates
 * (or arm `(u, v)` coordinates for arms) so the collider meets the drawn realistic body everywhere
 * (bust, underbust, waist, seat, both legs and both arms) instead of ellipses or origin-centred loops.
 * A single vertex-envelope pass then ensures convex domes between slices (breast apex, shoulder slope,
 * seat curve, wrist) never protrude past the piecewise-linear polar table.
 *
 * Not a fit target: the fit and sizes stay with the ring table. The outlines describe the skin
 * the cloth meets; the ring table still decides the size.
 */
export function realisticOutlinesOf(
  mesh: Pick<Mesh, 'positions' | 'indices'>,
  statureCm: number,
  crotchY: number,
  arms: readonly RealisticArmFrame[],
  stepCm = { torso: REALISTIC_TORSO_STEP_CM, leg: REALISTIC_LEG_STEP_CM },
  armWeight?: ArrayLike<number>,
): MannequinOutlines {
  const pos = mesh.positions;
  const idx = mesh.indices;
  const sectionToPolar = (s: Section): { cu: number; cv: number; r: Float64Array } | null => {
    if (s.q.length < 3) return null;
    // Use the section's area centroid (guaranteed inside the closed section on torso/legs/arms) as
    // the ray origin and preserve it as (cu, cv) so `polarStack` returns the real world/frame centre.
    const cx = s.au;
    const cv = s.av;
    const outline = new Float64Array(s.q.length * 2);
    for (let i = 0; i < s.q.length; i++) {
      outline[2 * i] = s.q[i]![0] - cx;
      outline[2 * i + 1] = s.q[i]![1] - cv;
    }
    const p = sectionPolar({ centre: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], a: 0, b: 0, outline }, s.q.length, 0, 0);
    return { cu: cx, cv, r: p.r };
  };

  // Pre-bucket triangles into 2 cm vertical bands so 250+ horizontal slices stay under a few ms.
  const BAND_CM = 2;
  const bandTris = new Map<number, number[]>();
  for (let t = 0; t < idx.length; t += 3) {
    const ya = pos[3 * idx[t]! + 1]!, yb = pos[3 * idx[t + 1]! + 1]!, yc = pos[3 * idx[t + 2]! + 1]!;
    const b0 = Math.floor(Math.min(ya, yb, yc) / BAND_CM);
    const b1 = Math.floor(Math.max(ya, yb, yc) / BAND_CM);
    for (let b = b0; b <= b1; b++) {
      let arr = bandTris.get(b);
      if (!arr) { arr = []; bandTris.set(b, arr); }
      arr.push(idx[t]!, idx[t + 1]!, idx[t + 2]!);
    }
  }
  const hSectionsAt = (y: number): Section[] => {
    const arr = bandTris.get(Math.floor(y / BAND_CM));
    return arr ? horizontalSections(pos, arr, y) : [];
  };

  const torsoKeys: number[] = [];
  const torsoSecs: { cu: number; cv: number; r: Float64Array }[] = [];
  // Torso starts at the crotch (never grabbing a single leg below it), sampled densely at 0.5 cm.
  const torsoStart = Math.max(0, crotchY - 1.5);
  for (let y = torsoStart; y <= statureCm + 1e-9; y += stepCm.torso) {
    const secs = hSectionsAt(y).filter((s) => Math.abs(s.au) < 5);
    if (!secs.length) continue;
    secs.sort((a, b) => b.loopCm - a.loopCm);
    const p = sectionToPolar(secs[0]!);
    if (p && p.r.length > 0) {
      torsoKeys.push(y);
      torsoSecs.push(p);
    }
  }

  const buildLeg = (side: 1 | -1): { keys: number[]; secs: { cu: number; cv: number; r: Float64Array }[] } => {
    const keys: number[] = [];
    const secs: { cu: number; cv: number; r: Float64Array }[] = [];
    const legYs: number[] = [];
    for (let y = 0; y < Math.max(0, crotchY - 2); y += stepCm.leg) legYs.push(y);
    for (let y = Math.max(0, crotchY - 2); y <= crotchY + 1; y += 0.5) legYs.push(y);
    for (const y of legYs) {
      // Pick the closed loop on this leg's side (`side * au > 1`), never the opposite leg or the merged torso.
      const candidates = hSectionsAt(y).filter((s) => side * s.au > 1 && side * s.au < 28);
      if (!candidates.length) continue;
      candidates.sort((a, b) => b.loopCm - a.loopCm);
      const p = sectionToPolar(candidates[0]!);
      if (p && p.r.length > 0) {
        keys.push(y);
        secs.push(p);
      }
    }
    return { keys, secs };
  };
  const legLeftData = buildLeg(1);
  const legRightData = buildLeg(-1);

  const armFramesNorm = arms.map((frame) => {
    const basis = frame.u && frame.v ? { u: frame.u, v: frame.v } : planeBasis(frame.axis);
    return { frame, u: basis.u, v: basis.v, s0: frame.s0 ?? 7.5 };
  });

  // Pre-filter triangles per arm side so `sectionAt` only tests ~15% of the mesh per arm slice.
  const sideArmTris = (side: 1 | -1): number[] => {
    const out: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
      const xa = pos[3 * a]!, xb = pos[3 * b]!, xc = pos[3 * c]!;
      if (side * xa < 6 && side * xb < 6 && side * xc < 6) continue;
      if (armWeight && armWeight[a]! < 0.05 && armWeight[b]! < 0.05 && armWeight[c]! < 0.05) continue;
      out.push(a, b, c);
    }
    return out;
  };

  const buildArm = (entry: (typeof armFramesNorm)[number]): { keys: number[]; secs: { cu: number; cv: number; r: Float64Array }[] } => {
    const { frame, u, v } = entry;
    const armIdx = sideArmTris(frame.side);
    const keys: number[] = [];
    const secs: { cu: number; cv: number; r: Float64Array }[] = [];
    for (const f of REALISTIC_ARM_STATIONS) {
      const s = f * frame.lengthCm;
      const o: V3 = [frame.joint[0] + frame.axis[0] * s, frame.joint[1] + frame.axis[1] * s, frame.joint[2] + frame.axis[2] * s];
      const sec = sectionAt(pos, armIdx, o, frame.axis, u, v);
      // Skip giant torso-merged sections above the armpit (`loopCm > 60 cm`) so the arm table stays pure arm.
      if (!sec || sec.loopCm > 60) continue;
      const p = sectionToPolar(sec);
      if (p && p.r.length > 0) {
        keys.push(s);
        secs.push(p);
      }
    }
    if (keys.length) {
      // Close the shoulder cap smoothly from the first valid arm section back to -ARM_CAP_REACH_CM.
      const first = secs[0]!;
      keys.unshift(-ARM_CAP_REACH_CM);
      secs.unshift({ cu: first.cu, cv: first.cv, r: Float64Array.from(first.r, (x) => 0.02 * x) });
      // Extend cleanly to the end of the arm frame (`lengthCm`) if the fingertip slice fell just past the last closed loop.
      if (keys[keys.length - 1]! < frame.lengthCm) {
        const last = secs[secs.length - 1]!;
        keys.push(frame.lengthCm);
        secs.push({ cu: last.cu, cv: last.cv, r: Float64Array.from(last.r, (x) => Math.max(0.4, 0.5 * x)) });
      }
    }
    return { keys, secs };
  };
  const armLeftEntry = armFramesNorm.find((a) => a.frame.side === 1);
  const armRightEntry = armFramesNorm.find((a) => a.frame.side === -1);
  const armLeftData = armLeftEntry ? buildArm(armLeftEntry) : { keys: [], secs: [] };
  const armRightData = armRightEntry ? buildArm(armRightEntry) : { keys: [], secs: [] };

  // Vertex-envelope pass: ensure convex peaks between slices (breast apex, shoulder dome, buttocks,
  // elbow/wrist) never stick out past the piecewise-linear polar tables.
  const nv = pos.length / 3;
  for (let i = 0; i < nv; i++) {
    const x = pos[3 * i]!, y = pos[3 * i + 1]!, z = pos[3 * i + 2]!;
    const aw = armWeight ? armWeight[i]! : 0;
    const armEntry = x >= 0 ? armLeftEntry : armRightEntry;
    let sAlong = Infinity;
    let pu = 0, pv = 0;
    if (armEntry) {
      const rx = x - armEntry.frame.joint[0];
      const ry = y - armEntry.frame.joint[1];
      const rz = z - armEntry.frame.joint[2];
      sAlong = rx * armEntry.frame.axis[0] + ry * armEntry.frame.axis[1] + rz * armEntry.frame.axis[2];
      pu = rx * armEntry.u[0] + ry * armEntry.u[1] + rz * armEntry.u[2];
      pv = rx * armEntry.v[0] + ry * armEntry.v[1] + rz * armEntry.v[2];
    }
    const isArmFree = armWeight ? aw > 0.35 && sAlong > (armEntry?.s0 ?? 7.5) : false;
    if (isArmFree && armEntry && sAlong <= armEntry.frame.lengthCm) {
      const armData = x >= 0 ? armLeftData : armRightData;
      enclosePolarPoint(armData.keys, armData.secs, sAlong, pu, pv, 4);
      continue;
    }
    if (y >= torsoStart && y <= statureCm) {
      // Without `armWeight`, guard delta <= 3.0 cm so free arms below the armpit aren't absorbed into the torso.
      enclosePolarPoint(torsoKeys, torsoSecs, y, x, z, armWeight ? 4 : 3);
    }
    if (y >= 0 && y <= crotchY + 0.5 && !isArmFree) {
      if (x >= 0) enclosePolarPoint(legLeftData.keys, legLeftData.secs, y, x, z, 3);
      else enclosePolarPoint(legRightData.keys, legRightData.secs, y, x, z, 3);
    }
  }

  const torsoAt = torsoKeys.length >= 2 ? polarStack(torsoKeys, torsoSecs) : () => null;
  const legLeft = legLeftData.keys.length >= 2 ? polarStack(legLeftData.keys, legLeftData.secs) : () => null;
  const legRight = legRightData.keys.length >= 2 ? polarStack(legRightData.keys, legRightData.secs) : () => null;
  const armLeftAt = armLeftData.keys.length >= 2 ? polarStack(armLeftData.keys, armLeftData.secs) : () => null;
  const armRightAt = armRightData.keys.length >= 2 ? polarStack(armRightData.keys, armRightData.secs) : () => null;
  return {
    torso: (y) => (y >= torsoStart && y <= statureCm ? torsoAt(y) : null),
    leg: (y, side) => (y >= 0 && y <= crotchY + 0.5 ? (side === 1 ? legLeft(y) : legRight(y)) : null),
    arm: (s, side) => (side === 1 ? armLeftAt(s) : armRightAt(s)),
  };
}
