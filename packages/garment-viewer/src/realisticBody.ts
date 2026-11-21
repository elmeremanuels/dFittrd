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
import { loopLength, slice, type Loop, type Mannequin, type Mesh } from '@curtain/mannequin';

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
}

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
  const arm = (f: Mannequin['arms']['left']): FitArm => ({ joint: [...f.joint] as V3, axis: [...f.axis] as V3 });
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
}

function sectionOf(loop: Loop, origin: V3, u: V3, v: V3): Section {
  const q = planePoints(loop, origin, u, v);
  let cu = 0, cv = 0;
  for (const [x, y] of q) {
    cu += x / q.length;
    cv += y / q.length;
  }
  return { loop, q, loopCm: loopLength(loop), tapeCm: hullPerimeter(q), cu, cv };
}

/**
 * The closed section of the mesh in the plane round `origin` (the smallest closed loop that contains it), or, when
 * no closed loop contains it, the closed loop whose centroid is nearest. Null when the plane meets no closed loop.
 */
export function sectionAt(positions: ArrayLike<number>, indices: ArrayLike<number>, origin: V3, normal: V3, u: V3, v: V3, filter?: (t: number) => boolean): Section | null {
  const loops = slice(positions, indices, { origin, normal }, filter).filter((l) => l.closed && l.points.length > 2);
  let best: Section | null = null;
  let bestArea = Infinity;
  let near: Section | null = null;
  let nearD = Infinity;
  for (const loop of loops) {
    const s = sectionOf(loop, origin, u, v);
    if (contains(s.q, 0, 0)) {
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
  return best ?? near;
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
/** Iterations of the girth correction (each sets every ring's scale to target / measured). */
const FIT_ITERATIONS = 6;
/** Half-height of the band round the shoulder ring whose horizontal scale sets the shoulder girth, cm. */
const SHOULDER_BAND_CM = 7;

export interface FitOptions {
  /** Shape sliders in [-1, 1]; by default solved from the target's girths (`shapeFor`). */
  shape?: { weight: number; cup: number };
  /** Correction iterations (default 6; 0 leaves the rings at the uniform start). */
  iterations?: number;
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
 * `cup` in [-1, 1] so that chest over underbust is the target's. Uses the bake's girths (`meta.girths`), linear in each
 * slider's half; a grid of 0.05.
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
  const bust = Math.log(want.get('chest')! / want.get('underbust')!);
  let best = { weight: 0, cup: 0 };
  let bestCost = Infinity;
  for (let wi = -20; wi <= 20; wi++) {
    for (let ci = -20; ci <= 20; ci++) {
      const w = wi / 20, c = ci / 20;
      const cost = (Math.log(at('hip', w, c) / meta.statureCm) - seat) ** 2 + (Math.log(at('chest', w, c) / at('underbust', w, c)) - bust) ** 2 + 1e-5 * (w * w + c * c);
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

/**
 * Deform the asset so that its loop girth at every ring of `target` is the target girth:
 *
 * 1. shape sliders (weight, cup) from the target's seat over stature and chest over underbust (`shapeFor`);
 * 2. a vertical warp (monotone C1 cubic, `warpThrough`) that puts each anatomical level of the bake at its ring's height, the crotch
 *    at the target's crotch and the top of the head at the stature;
 * 3. the torso's sections moved to the ring table's centre line, the legs' to the table's leg centres;
 * 4. each arm moved rigidly onto the table's arm frame (joint, axis) and stretched along it so the wrist joint lands
 *    on the wrist ring, blended into the torso by MakeHuman's own arm weights;
 * 5. a radial scale per height (body chain, about the section centre) and per distance along the arm (arm chain,
 *    about the axis), a monotone cubic through one knot per ring, corrected `iterations` times to target / measured.
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
  const crotch = target.crotchY;
  const legLo = h('thigh');
  const legness = (y: number): number => smooth((crotch + 4 - y) / (crotch + 4 - legLo));
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

  // 4. Arms: rigid onto the table's frame, stretched along the axis so the wrist joint lands at the wrist ring.
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
    for (let i = 0; i < n; i++) {
      const x = P[3 * i]!;
      if (Math.sign(x) !== side || asset.armWeight[i] === 0) continue;
      const rel: V3 = [x - j0[0], P[3 * i + 1]! - j0[1], P[3 * i + 2]! - j0[2]];
      const along = dot3(rel, a0);
      // Stretch only the part along the axis below the joint.
      const k = along > 0 ? stretch : 1;
      const moved = mul(R, [rel[0] + a0[0] * along * (k - 1), rel[1] + a0[1] * along * (k - 1), rel[2] + a0[2] * along * (k - 1)]);
      A[3 * i] = frame.joint[0] + moved[0];
      A[3 * i + 1] = frame.joint[1] + moved[1];
      A[3 * i + 2] = frame.joint[2] + moved[2];
      armS[i] = dot3(moved, frame.axis);
    }
  }

  // 5. Radial scale, corrected per ring.
  const bodyScale: Record<BodyRing, number> = Object.fromEntries(BODY_RINGS.map((r) => [r, 1])) as Record<BodyRing, number>;
  const armScale: Record<ArmRing, number> = { upper_arm: 1, wrist: 1 };
  const armDist: Record<ArmRing, number> = { upper_arm: 0, wrist: 0 };
  for (const r of ARM_RINGS) {
    const rr = ring.get(r)!;
    armDist[r] = dot3([rr.centre[0] - tj[0], rr.centre[1] - tj[1], rr.centre[2] - tj[2]], target.arms.left.axis);
  }
  const neckY = h('neck');
  // The shoulder ring cuts through the arm roots, which follow the arm (step 4), not the body's scale: its girth is
  // set by a horizontal scale of everything in a band round the ring (`shoulderBand`), fading out over SHOULDER_BAND_CM.
  const shoulderY = h('shoulder');
  let shoulderBand = 1;
  const band = (y: number): number => 1 - smooth(Math.abs(y - shoulderY) / SHOULDER_BAND_CM);
  const out = new Float64Array(3 * n);
  const apply = (): void => {
    // The body's own scale at the shoulder ring follows the chest's; the band does the rest.
    bodyScale.shoulder = bodyScale.chest;
    const kb = monotoneProfile(BODY_RINGS.map((r) => ({ x: h(r), y: bodyScale[r] })));
    const ka = monotoneProfile(ARM_RINGS.map((r) => ({ x: armDist[r], y: armScale[r] })));
    for (let i = 0; i < n; i++) {
      const y = B[3 * i + 1]!;
      const l = legness(y);
      const cx = l * smoothSign(B[3 * i]!) * legCentreX(y);
      let k = kb(y);
      const hw = asset.headWeight[i]!;
      if (hw > 0 && y > neckY) k = k + (1 + HEAD_SHARE * (k - 1) - k) * hw;
      let x = cx + k * (B[3 * i]! - cx);
      let yy = y;
      let z = k * B[3 * i + 2]!;
      const w = asset.armWeight[i]!;
      if (w > 0) {
        const side = Math.sign(P[3 * i]!) >= 0 ? target.arms.left : target.arms.right;
        const s = armS[i]!;
        const ks = ka(s);
        const c: V3 = [side.joint[0] + side.axis[0] * s, side.joint[1] + side.axis[1] * s, side.joint[2] + side.axis[2] * s];
        const ax = c[0] + ks * (A[3 * i]! - c[0]);
        const ay = c[1] + ks * (A[3 * i + 1]! - c[1]);
        const az = c[2] + ks * (A[3 * i + 2]! - c[2]);
        x += w * (ax - x);
        yy += w * (ay - yy);
        z += w * (az - z);
      }
      const b = band(yy);
      const kband = b > 0 ? Math.pow(shoulderBand, b) : 1;
      out[3 * i] = kband * x;
      out[3 * i + 1] = yy;
      out[3 * i + 2] = kband * z;
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
    }
    apply();
  }
  const mesh: Mesh = { positions: out, indices: Uint32Array.from(idx), vertexPart: new Uint8Array(n), partNames: ['body'] };
  return { mesh, shape, rings: ringReport(mesh, target) };
}

/** Loop and tape girth of the mesh at every ring of the target, and the loop's error against the table. */
export function ringReport(mesh: Pick<Mesh, 'positions' | 'indices'>, target: FitTarget): RingResult[] {
  return target.rings.map((r) => {
    const s = sectionAt(mesh.positions, mesh.indices, r.centre, r.normal, r.u, r.v);
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
