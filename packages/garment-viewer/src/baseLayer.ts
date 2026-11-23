/**
 * Procedural base layer (D30, WO-009 / CUR-22) on the realistic body: a plain fitted vest (tank top) and briefs in one
 * neutral colour, generated in code from the fitted body mesh with no external assets.
 *
 * - Built by clipping the fitted body's triangles against smooth anatomical signed-distance fields (marching triangles).
 * - Uses strictly outward-only normal displacement: a gentle broad bust-dome envelope lifts the cloth smoothly over the
 *   nipple peaks, followed by outward-only Laplacian bridging over cleavage, navel, and pelvic/gluteal creases — so
 *   nipples and genitals are smoothly covered with zero skin poke-through on every body size.
 * - Cut-edge loops are smoothed tangentially (never inward) with a narrow tucked hem lip so straps, scoop neckline,
 *   armholes, waist hem, and briefs leg cuts sit crisply against the skin.
 * - `baseLayerVisibility` implements D30 garment replacement: a top replaces the vest, a bottom (skirt/trousers) replaces
 *   the briefs, and a dress replaces both; when no garment is shown, both vest and briefs are visible.
 */
import * as THREE from 'three';
import type { Mannequin, Mesh } from '@curtain/mannequin';
import type { RealisticBodyAsset } from './realisticBody';

/** Name of the base-layer group attached to `figure.group` (parallel to `HAIR_GROUP`). */
export const BASE_LAYER_GROUP = 'base-layer';

/** Single neutral cotton-jersey shade (warm stone grey): calm contrast on light, medium, deep skin and light studio backdrop. */
export const BASE_LAYER_COLOUR = '#989189';

/** Anatomical heights (cm, body space) used to place the vest and briefs cut lines on any body size. */
export interface BaseLayerRings {
  neck: number;
  shoulder: number;
  chest: number;
  underbust: number;
  waist: number;
  hip: number;
  crotch: number;
  thigh: number;
}

export interface BaseLayerCoverage {
  /** Garment category (`'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory'`, or friendly aliases). */
  category?: string | null;
  /** Whether the garment is currently shown on screen (default `true` when `category` is given). */
  garmentShown?: boolean;
}

export interface BaseLayerVisibility {
  vest: boolean;
  briefs: boolean;
}

export interface BaseLayerPieceMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  triangleCount: number;
}

export interface BaseLayerBuild {
  vest: BaseLayerPieceMesh;
  briefs: BaseLayerPieceMesh;
  /** Signed scalar field per body vertex (> 0 inside the vest). */
  vestField: Float32Array;
  /** Signed scalar field per body vertex (> 0 inside the briefs). */
  briefsField: Float32Array;
  colour: string;
}

export interface BaseLayerOptions {
  /** Override neutral colour (`#rrggbb`); defaults to `BASE_LAYER_COLOUR`. */
  colour?: string;
  /** Initial garment coverage for vest/briefs visibility. */
  coverage?: BaseLayerCoverage;
  /**
   * Optional conformed body mesh drawn under a mounted garment (`conformToField`). When provided and a garment is
   * shown (`garmentShown !== false`), the uncovered base-layer piece switches to the conformed geometry so it stays
   * strictly inside the garment's collision hull and never pokes through overlapping hems (e.g. briefs under a long tee).
   */
  conformedMesh?: Pick<Mesh, 'positions' | 'indices'> | null;
}

export interface BaseLayerView {
  group: THREE.Group;
  vest: THREE.Mesh;
  briefs: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  build: BaseLayerBuild;
  setCoverage(coverage?: BaseLayerCoverage): BaseLayerVisibility;
  dispose(): void;
}

/** Extract `BaseLayerRings` from a mannequin's rings and crotch landmark. */
export function baseLayerRingsOf(drawn: Pick<Mannequin, 'rings' | 'landmarks'>): BaseLayerRings {
  const y = (id: string): number => drawn.rings.find((r) => r.id === id)?.centre[1] ?? 0;
  return {
    neck: y('neck'),
    shoulder: y('shoulder'),
    chest: y('chest'),
    underbust: y('underbust'),
    waist: y('waist'),
    hip: y('hip'),
    crotch: drawn.landmarks.crotch[1],
    thigh: y('thigh'),
  };
}

/**
 * D30 garment replacement rule:
 * - No garment (or garment hidden, shoes, accessory): both vest and briefs are shown.
 * - Top / outerwear (shirt, tee, blouse, sweater, jacket): replaces the vest; briefs stay visible.
 * - Bottom (skirt, trousers, pants, shorts, jeans): replaces the briefs; vest stays visible.
 * - Dress (jumpsuit, playsuit, overall): replaces both vest and briefs.
 */
export function baseLayerVisibility(coverage?: BaseLayerCoverage): BaseLayerVisibility {
  if (!coverage || coverage.garmentShown === false || !coverage.category) {
    return { vest: true, briefs: true };
  }
  const cat = coverage.category.trim().toLowerCase();
  if (cat === 'dress' || cat === 'jumpsuit' || cat === 'playsuit' || cat === 'overall') {
    return { vest: false, briefs: false };
  }
  if (
    cat === 'top' ||
    cat === 'outerwear' ||
    cat === 'shirt' ||
    cat === 'tee' ||
    cat === 't-shirt' ||
    cat === 'blouse' ||
    cat === 'sweater' ||
    cat === 'jacket' ||
    cat === 'coat'
  ) {
    return { vest: false, briefs: true };
  }
  if (cat === 'bottom' || cat === 'skirt' || cat === 'trousers' || cat === 'pants' || cat === 'shorts' || cat === 'jeans') {
    return { vest: true, briefs: false };
  }
  return { vest: true, briefs: true };
}

/** Area-weighted outward vertex normals of a mesh. */
function computeNormals(P: ArrayLike<number>, indices: ArrayLike<number>, n: number): Float32Array {
  const N = new Float32Array(3 * n);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!,
      b = indices[t + 1]!,
      c = indices[t + 2]!;
    if (a >= n || b >= n || c >= n) continue;
    const ux = P[3 * b]! - P[3 * a]!,
      uy = P[3 * b + 1]! - P[3 * a + 1]!,
      uz = P[3 * b + 2]! - P[3 * a + 2]!;
    const vx = P[3 * c]! - P[3 * a]!,
      vy = P[3 * c + 1]! - P[3 * a + 1]!,
      vz = P[3 * c + 2]! - P[3 * a + 2]!;
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      N[3 * k] = N[3 * k]! + nx;
      N[3 * k + 1] = N[3 * k + 1]! + ny;
      N[3 * k + 2] = N[3 * k + 2]! + nz;
    }
  }
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(N[3 * i]!, N[3 * i + 1]!, N[3 * i + 2]!) || 1;
    N[3 * i] = N[3 * i]! / l;
    N[3 * i + 1] = N[3 * i + 1]! / l;
    N[3 * i + 2] = N[3 * i + 2]! / l;
  }
  return N;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Build unique vertex adjacency list for the body mesh (only vertices within `field > -4`). */
function buildAdjacency(indices: ArrayLike<number>, field: Float32Array, n: number): number[][] {
  const adjSets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!,
      b = indices[t + 1]!,
      c = indices[t + 2]!;
    if (a >= n || b >= n || c >= n) continue;
    if (field[a]! < -4 && field[b]! < -4 && field[c]! < -4) continue;
    adjSets[a]!.add(b);
    adjSets[a]!.add(c);
    adjSets[b]!.add(a);
    adjSets[b]!.add(c);
    adjSets[c]!.add(a);
    adjSets[c]!.add(b);
  }
  return adjSets.map((s) => Array.from(s));
}

/** Gentle graph-Laplacian smoothing of a scalar field so marching-triangle contours follow clean smooth curves. */
function smoothScalarField(field: Float32Array, adj: number[][], passes: number, weight: number): Float32Array {
  let cur = new Float32Array(field);
  let nxt = new Float32Array(field.length);
  for (let p = 0; p < passes; p++) {
    nxt.set(cur);
    for (let i = 0; i < cur.length; i++) {
      const nb = adj[i]!;
      if (nb.length === 0) continue;
      let sum = 0;
      for (const j of nb) sum += cur[j]!;
      nxt[i] = cur[i]! + weight * (sum / nb.length - cur[i]!);
    }
    const tmp = cur;
    cur = nxt;
    nxt = tmp;
  }
  return cur;
}

/**
 * Evaluate smooth signed fields (> 0 inside garment, < 0 outside, 0 on exact cut edge) for the fitted vest and briefs
 * on every body vertex. Uses the fitted mesh's own torso and hip widths so cut lines adapt cleanly from slim to full.
 */
function evaluateFields(
  P: ArrayLike<number>,
  asset: Pick<RealisticBodyAsset, 'meta' | 'armWeight' | 'headWeight'>,
  rings: BaseLayerRings,
): { vestField: Float32Array; briefsField: Float32Array } {
  const nb = asset.meta.bodyVertexCount;
  const vestField = new Float32Array(nb);
  const briefsField = new Float32Array(nb);

  let chestHalfX = 12;
  let hipHalfX = 16;
  let shoulderTopY = rings.shoulder + 4;
  for (let i = 0; i < nb; i++) {
    const ax = Math.abs(P[3 * i]!);
    const y = P[3 * i + 1]!;
    const aw = asset.armWeight[i]!;
    if (aw < 0.12 && Math.abs(y - rings.chest) < 3) chestHalfX = Math.max(chestHalfX, ax);
    if (aw < 0.1 && Math.abs(y - rings.hip) < 3) hipHalfX = Math.max(hipHalfX, ax);
    if (aw < 0.35 && asset.headWeight[i]! < 0.2 && ax > 6 && ax < chestHalfX * 1.15 && y > rings.shoulder - 2 && y < rings.neck + 6) {
      shoulderTopY = Math.max(shoulderTopY, y);
    }
  }

  // --- Vest (plain fitted scoop-neck tank top) ---
  const vestBot = rings.hip + 0.56 * (rings.waist - rings.hip);
  const shSpan = Math.max(8, rings.shoulder - rings.chest);
  // Classic modest scoop neckline in front, higher tank back.
  const frontNeckMid = rings.chest + 0.68 * shSpan;
  const backNeckMid = rings.chest + 0.85 * shSpan;
  // Armhole curves cleanly under the armpit crease so side bust stays fully covered on every body.
  const armholeBot = rings.chest + 0.05 * shSpan;
  // Balanced shoulder straps seated squarely over the trapezius with an open, natural scoop width.
  const strapIn = clamp(0.50 * chestHalfX, 6.2, 10.0);
  const strapOut = clamp(0.77 * chestHalfX, strapIn + 3.2, 15.2);
  const armOutX = Math.max(strapOut + 3.0, chestHalfX * 0.98);
  const topCap = shoulderTopY + 5;

  // --- Briefs (classic modest mid-rise briefs) ---
  const briefsTop = rings.hip + 0.34 * (rings.waist - rings.hip);
  const hipCrotch = Math.max(6, rings.hip - rings.crotch);
  const sideLegY = rings.crotch + 0.44 * hipCrotch;
  const crotchFloorY = rings.crotch - 2.6;
  const gussetHalfX = clamp(0.18 * hipHalfX, 2.6, 4.0);

  for (let i = 0; i < nb; i++) {
    const ax = Math.abs(P[3 * i]!);
    const y = P[3 * i + 1]!;
    const z = P[3 * i + 2]!;
    const aw = asset.armWeight[i]!;
    const hw = asset.headWeight[i]!;

    // 1. Vest signed field (cm-like units): positive inside vest, negative outside.
    const frontW = smoothstep(-2.5, 2.5, z);
    const neckMid = backNeckMid + frontW * (frontNeckMid - backNeckMid);
    const uNeck = clamp(ax / strapIn, 0, 1);
    const neckCurveY = neckMid + (topCap - neckMid) * Math.pow(uNeck, 2.8);
    const uArm = clamp((ax - strapOut) / (armOutX - strapOut), 0, 1);
    const armCurveY = armholeBot + (topCap - armholeBot) * Math.pow(1 - uArm, 2.1);

    const dBot = y - vestBot;
    const dNeck = neckCurveY - y;
    const dArmCurve = armCurveY - y;
    const dHead = (0.24 - hw) * 16;
    const dArmWeight = (0.48 - aw) * 14;
    vestField[i] = Math.min(dBot, dNeck, dArmCurve, dHead, dArmWeight);

    // 2. Briefs signed field (cm-like units): positive inside briefs, negative outside.
    const dBriefsTop = briefsTop - y;
    const uLeg = clamp((ax - gussetHalfX) / Math.max(3, 0.84 * hipHalfX - gussetHalfX), 0, 1);
    const frontLegY = crotchFloorY + (sideLegY - crotchFloorY) * Math.pow(uLeg, 0.7);
    const backLegY = crotchFloorY + (sideLegY - crotchFloorY) * (uLeg * uLeg);
    const legCutY = backLegY + frontW * (frontLegY - backLegY);
    const dBriefsLeg = y - legCutY;
    const dBriefsArm = (0.14 - aw) * 18;
    briefsField[i] = Math.min(dBriefsTop, dBriefsLeg, dBriefsArm);
  }

  return { vestField, briefsField };
}

/** Find the left and right front bust apex coordinates (highest forward Z in the chest band) on the fitted body. */
function findBustApices(
  P: ArrayLike<number>,
  n: number,
  rings: BaseLayerRings,
): [[number, number, number], [number, number, number]] {
  let lx = -7,
    ly = rings.chest,
    lz = -1e9;
  let rx = 7,
    ry = rings.chest,
    rz = -1e9;
  const yLo = rings.underbust - 1;
  const yHi = rings.chest + 0.55 * (rings.shoulder - rings.chest);
  for (let i = 0; i < n; i++) {
    const x = P[3 * i]!,
      y = P[3 * i + 1]!,
      z = P[3 * i + 2]!;
    if (y < yLo || y > yHi || Math.abs(x) < 2.5) continue;
    if (x > 0 && z > rz) {
      rx = x;
      ry = y;
      rz = z;
    } else if (x < 0 && z > lz) {
      lx = x;
      ly = y;
      lz = z;
    }
  }
  return [
    [lx, ly, lz],
    [rx, ry, rz],
  ];
}

/**
 * Strictly outward-only offset surface builder:
 * 1. Starts every vertex strictly outside the body (`P + N * offset`).
 * 2. On the vest, lifts the ring immediately around each bust apex smoothly up to a broad, gentle spherical cloth dome
 *    (`z >= domeZ`) so tiny conical nipple bumps vanish completely into natural fitted-jersey breast contours while
 *    remaining strictly outside the body.
 * 3. Runs outward-only normal-projected Laplacian bridging (`proj > 0` only, NEVER inward and NEVER tangential sliding),
 *    so concavities (cleavage, navel, groin/gluteal cleft) bridge smoothly with ZERO skin poke-through anywhere.
 */
function buildOutwardSurface(
  P: ArrayLike<number>,
  N: Float32Array,
  adj: number[][],
  field: Float32Array,
  n: number,
  baseOffsetCm: number,
  hemOffsetCm: number,
  bustApices: readonly [readonly [number, number, number], readonly [number, number, number]] | null,
  passes: number,
  weight: number,
): Float64Array {
  const pos = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const f = field[i]!;
    const off = hemOffsetCm + (baseOffsetCm - hemOffsetCm) * smoothstep(0, 1.8, Math.max(0, f));
    const qx = P[3 * i]! + N[3 * i]! * off;
    const qy = P[3 * i + 1]! + N[3 * i + 1]! * off;
    let qz = P[3 * i + 2]! + N[3 * i + 2]! * off;

    // Broad smooth bust dome over each nipple apex: lifts only the immediate surround (+Z) to match a gentle fabric curve.
    if (bustApices && f > 0.5 && N[3 * i + 2]! > 0.15) {
      for (const [ax, ay, az] of bustApices) {
        const dx = qx - ax;
        const dy = qy - ay;
        const r2 = dx * dx + dy * dy;
        const capRadius = 4.6;
        if (r2 < capRadius * capRadius && qz > az - 4.8) {
          const r = Math.sqrt(r2);
          // Broad smooth spherical cloth cap over the bust apex so tiny nipple peaks vanish completely on every body size.
          const domeZ = az + baseOffsetCm + 0.24 - r2 / 26.0;
          const blend = smoothstep(capRadius, 1.6, r) * smoothstep(0.5, 2.0, f);
          const liftedZ = qz + Math.max(0, domeZ - qz) * blend;
          if (liftedZ > qz) qz = liftedZ;
        }
      }
    }

    pos[3 * i] = qx;
    pos[3 * i + 1] = qy;
    pos[3 * i + 2] = qz;
  }

  // Strictly outward-only normal-projected relaxation: bridges concavities & blends dome rim smoothly, never moves inward.
  const next = new Float64Array(3 * n);
  for (let pass = 0; pass < passes; pass++) {
    next.set(pos);
    for (let i = 0; i < n; i++) {
      const f = field[i]!;
      if (f <= 0.35) continue;
      const nb = adj[i]!;
      if (nb.length === 0) continue;
      let mx = 0,
        my = 0,
        mz = 0;
      for (const j of nb) {
        mx += pos[3 * j]!;
        my += pos[3 * j + 1]!;
        mz += pos[3 * j + 2]!;
      }
      mx /= nb.length;
      my /= nb.length;
      mz /= nb.length;
      const dx = mx - pos[3 * i]!,
        dy = my - pos[3 * i + 1]!,
        dz = mz - pos[3 * i + 2]!;
      const nx = N[3 * i]!,
        ny = N[3 * i + 1]!,
        nz = N[3 * i + 2]!;
      const proj = dx * nx + dy * ny + dz * nz;
      if (proj > 0) {
        const k = weight * smoothstep(0.35, 2.0, f);
        next[3 * i] = pos[3 * i]! + nx * proj * k;
        next[3 * i + 1] = pos[3 * i + 1]! + ny * proj * k;
        next[3 * i + 2] = pos[3 * i + 2]! + nz * proj * k;
      }
    }
    pos.set(next);
  }
  return pos;
}

/** Gentle shading-normal smoothing on the extracted garment piece so knit jersey shades softly without sharp body facets. */
function smoothMeshNormals(normals: Float32Array, indices: Uint32Array, passes: number): Float32Array {
  const n = normals.length / 3;
  const adjSets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!,
      b = indices[t + 1]!,
      c = indices[t + 2]!;
    adjSets[a]!.add(b);
    adjSets[a]!.add(c);
    adjSets[b]!.add(a);
    adjSets[b]!.add(c);
    adjSets[c]!.add(a);
    adjSets[c]!.add(b);
  }
  let cur = new Float32Array(normals);
  let nxt = new Float32Array(normals.length);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let nx = cur[3 * i]! * 2,
        ny = cur[3 * i + 1]! * 2,
        nz = cur[3 * i + 2]! * 2;
      for (const j of adjSets[i]!) {
        // Only average neighbours facing broadly the same way (preserves crisp tucked hem crease).
        const dot = cur[3 * i]! * cur[3 * j]! + cur[3 * i + 1]! * cur[3 * j + 1]! + cur[3 * i + 2]! * cur[3 * j + 2]!;
        if (dot > 0.5) {
          nx += cur[3 * j]!;
          ny += cur[3 * j + 1]!;
          nz += cur[3 * j + 2]!;
        }
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      nxt[3 * i] = nx / l;
      nxt[3 * i + 1] = ny / l;
      nxt[3 * i + 2] = nz / l;
    }
    const tmp = cur;
    cur = nxt;
    nxt = tmp;
  }
  return cur;
}

/**
 * Extract a clean clipped sub-mesh where `field >= 0` using marching-triangles edge interpolation, smooth the cut-edge
 * boundary loops tangentially to eliminate coarse-mesh zigzags, and add a narrow inward-tucked hem lip along every edge.
 */
function clipAndFinish(
  baseP: ArrayLike<number>,
  offsetP: Float64Array,
  N: Float32Array,
  indices: ArrayLike<number>,
  field: Float32Array,
  n: number,
  hemOffsetCm: number,
): BaseLayerPieceMesh {
  const verts: number[] = [];
  const tris: number[] = [];
  const interiorMap = new Map<number, number>();
  const edgeMap = new Map<string, number>();
  const hemEdges: [number, number][] = [];
  const hemInner = new Map<number, number>();
  const edgeNormal = new Map<number, [number, number, number]>();

  const pushVert = (x: number, y: number, z: number): number => {
    const id = verts.length / 3;
    verts.push(x, y, z);
    return id;
  };

  const interiorVert = (i: number): number => {
    const existing = interiorMap.get(i);
    if (existing !== undefined) return existing;
    const id = pushVert(offsetP[3 * i]!, offsetP[3 * i + 1]!, offsetP[3 * i + 2]!);
    interiorMap.set(i, id);
    return id;
  };

  const edgeVert = (a: number, b: number): number => {
    const lo = a < b ? a : b,
      hi = a < b ? b : a;
    const key = `${lo}:${hi}`;
    const existing = edgeMap.get(key);
    if (existing !== undefined) return existing;
    const fa = field[a]!,
      fb = field[b]!;
    const t = clamp(fa / (fa - fb), 0, 1);
    const bx = baseP[3 * a]! + t * (baseP[3 * b]! - baseP[3 * a]!);
    const by = baseP[3 * a + 1]! + t * (baseP[3 * b + 1]! - baseP[3 * a + 1]!);
    const bz = baseP[3 * a + 2]! + t * (baseP[3 * b + 2]! - baseP[3 * a + 2]!);
    let nx = N[3 * a]! + t * (N[3 * b]! - N[3 * a]!);
    let ny = N[3 * a + 1]! + t * (N[3 * b + 1]! - N[3 * a + 1]!);
    let nz = N[3 * a + 2]! + t * (N[3 * b + 2]! - N[3 * a + 2]!);
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const outerId = pushVert(bx + nx * hemOffsetCm, by + ny * hemOffsetCm, bz + nz * hemOffsetCm);
    const innerId = pushVert(bx + nx * 0.03, by + ny * 0.03, bz + nz * 0.03);
    edgeMap.set(key, outerId);
    hemInner.set(outerId, innerId);
    edgeNormal.set(outerId, [nx, ny, nz]);
    return outerId;
  };

  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!,
      b = indices[t + 1]!,
      c = indices[t + 2]!;
    if (a >= n || b >= n || c >= n) continue;
    const fa = field[a]!,
      fb = field[b]!,
      fc = field[c]!;
    const inA = fa >= 0,
      inB = fb >= 0,
      inC = fc >= 0;
    const count = (inA ? 1 : 0) + (inB ? 1 : 0) + (inC ? 1 : 0);
    if (count === 0) continue;
    if (count === 3) {
      tris.push(interiorVert(a), interiorVert(b), interiorVert(c));
      continue;
    }
    if (count === 1) {
      const [i0, o1, o2] = inA ? [a, b, c] : inB ? [b, c, a] : [c, a, b];
      const e1 = edgeVert(i0, o1);
      const e2 = edgeVert(i0, o2);
      tris.push(interiorVert(i0), e1, e2);
      hemEdges.push([e1, e2]);
    } else {
      const [o0, i1, i2] = !inA ? [a, b, c] : !inB ? [b, c, a] : [c, a, b];
      const e1 = edgeVert(i1, o0);
      const e2 = edgeVert(i2, o0);
      const v1 = interiorVert(i1);
      const v2 = interiorVert(i2);
      tris.push(v1, v2, e2, v1, e2, e1);
      hemEdges.push([e2, e1]);
    }
  }

  // Smooth the cut-edge boundary loops tangentially (3 passes), never pulling inward into the skin.
  const bAdj = new Map<number, number[]>();
  for (const [u, v] of hemEdges) {
    let lu = bAdj.get(u);
    if (!lu) {
      lu = [];
      bAdj.set(u, lu);
    }
    lu.push(v);
    let lv = bAdj.get(v);
    if (!lv) {
      lv = [];
      bAdj.set(v, lv);
    }
    lv.push(u);
  }
  const bIds = Array.from(bAdj.keys());
  for (let pass = 0; pass < 4; pass++) {
    const deltas = new Map<number, [number, number, number]>();
    for (const id of bIds) {
      const nb = bAdj.get(id)!;
      if (nb.length !== 2) continue;
      const p = nb[0]!,
        q = nb[1]!;
      const mx = 0.5 * (verts[3 * p]! + verts[3 * q]!);
      const my = 0.5 * (verts[3 * p + 1]! + verts[3 * q + 1]!);
      const mz = 0.5 * (verts[3 * p + 2]! + verts[3 * q + 2]!);
      let dx = (mx - verts[3 * id]!) * 0.48;
      let dy = (my - verts[3 * id + 1]!) * 0.48;
      let dz = (mz - verts[3 * id + 2]!) * 0.48;
      const en = edgeNormal.get(id);
      if (en) {
        const dot = dx * en[0] + dy * en[1] + dz * en[2];
        if (dot < 0) {
          dx -= en[0] * dot;
          dy -= en[1] * dot;
          dz -= en[2] * dot;
        }
      }
      deltas.set(id, [dx, dy, dz]);
    }
    for (const [id, [dx, dy, dz]] of deltas) {
      verts[3 * id] = verts[3 * id]! + dx;
      verts[3 * id + 1] = verts[3 * id + 1]! + dy;
      verts[3 * id + 2] = verts[3 * id + 2]! + dz;
      const inner = hemInner.get(id);
      if (inner !== undefined) {
        verts[3 * inner] = verts[3 * inner]! + dx;
        verts[3 * inner + 1] = verts[3 * inner + 1]! + dy;
        verts[3 * inner + 2] = verts[3 * inner + 2]! + dz;
      }
    }
  }

  for (const [eA, eB] of hemEdges) {
    const inA = hemInner.get(eA);
    const inB = hemInner.get(eB);
    if (inA === undefined || inB === undefined) continue;
    tris.push(eA, inA, inB, eA, inB, eB);
  }

  const positions = Float32Array.from(verts);
  const idxOut = Uint32Array.from(tris);
  const rawNormals = computeNormals(positions, idxOut, positions.length / 3);
  const normals = smoothMeshNormals(rawNormals, idxOut, 2);
  return { positions, normals, indices: idxOut, triangleCount: idxOut.length / 3 };
}

/**
 * Pure geometry builder for the fitted vest and briefs on any fitted realistic body mesh.
 */
export function buildBaseLayer(
  mesh: Pick<Mesh, 'positions' | 'indices'>,
  asset: Pick<RealisticBodyAsset, 'meta' | 'armWeight' | 'headWeight'>,
  rings: BaseLayerRings,
  options: BaseLayerOptions & { tightOffset?: boolean } = {},
): BaseLayerBuild {
  const nb = asset.meta.bodyVertexCount;
  const N = computeNormals(mesh.positions, mesh.indices, nb);
  const raw = evaluateFields(mesh.positions, asset, rings);

  const vestAdj = buildAdjacency(mesh.indices, raw.vestField, nb);
  const briefsAdj = buildAdjacency(mesh.indices, raw.briefsField, nb);
  const vestField = smoothScalarField(raw.vestField, vestAdj, 2, 0.35);
  const briefsField = smoothScalarField(raw.briefsField, briefsAdj, 2, 0.35);
  const bustApices = findBustApices(mesh.positions, nb, rings);

  const tight = options.tightOffset === true;
  const vestOffsetP = buildOutwardSurface(mesh.positions, N, vestAdj, vestField, nb, tight ? 0.16 : 0.30, tight ? 0.09 : 0.17, bustApices, tight ? 4 : 8, 0.6);
  const briefsOffsetP = buildOutwardSurface(mesh.positions, N, briefsAdj, briefsField, nb, tight ? 0.14 : 0.28, tight ? 0.08 : 0.16, null, tight ? 3 : 6, 0.65);

  const vest = clipAndFinish(mesh.positions, vestOffsetP, N, mesh.indices, vestField, nb, tight ? 0.09 : 0.17);
  const briefs = clipAndFinish(mesh.positions, briefsOffsetP, N, mesh.indices, briefsField, nb, tight ? 0.08 : 0.16);
  return { vest, briefs, vestField, briefsField, colour: options.colour ?? BASE_LAYER_COLOUR };
}

function pieceGeometry(piece: BaseLayerPieceMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(piece.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(piece.normals, 3));
  g.setIndex(new THREE.BufferAttribute(piece.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/**
 * Build the Three.js `Group` (`BASE_LAYER_GROUP`) with one plain neutral matte cotton-jersey material shared by the vest
 * and briefs meshes, and a `setCoverage` method for D30 garment replacement.
 */
export function createBaseLayer(
  mesh: Pick<Mesh, 'positions' | 'indices'>,
  asset: Pick<RealisticBodyAsset, 'meta' | 'armWeight' | 'headWeight'>,
  rings: BaseLayerRings,
  options: BaseLayerOptions = {},
): BaseLayerView {
  const build = buildBaseLayer(mesh, asset, rings, options);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(build.colour),
    roughness: 0.92,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const vestGeom = pieceGeometry(build.vest);
  const briefsGeom = pieceGeometry(build.briefs);
  const conformedBuild = options.conformedMesh ? buildBaseLayer(options.conformedMesh, asset, rings, { ...options, tightOffset: true }) : null;
  const conformedVestGeom = conformedBuild ? pieceGeometry(conformedBuild.vest) : null;
  const conformedBriefsGeom = conformedBuild ? pieceGeometry(conformedBuild.briefs) : null;
  const vest = new THREE.Mesh(vestGeom, material);
  vest.name = 'base-layer-vest';
  vest.renderOrder = 1;
  const briefs = new THREE.Mesh(briefsGeom, material);
  briefs.name = 'base-layer-briefs';
  briefs.renderOrder = 1;

  const group = new THREE.Group();
  group.name = BASE_LAYER_GROUP;
  group.add(vest, briefs);

  const setCoverage = (coverage?: BaseLayerCoverage): BaseLayerVisibility => {
    const vis = baseLayerVisibility(coverage);
    const useConformed = Boolean(conformedVestGeom && conformedBriefsGeom && coverage && coverage.garmentShown !== false && coverage.category);
    vest.geometry = useConformed ? conformedVestGeom! : vestGeom;
    briefs.geometry = useConformed ? conformedBriefsGeom! : briefsGeom;
    vest.visible = vis.vest;
    briefs.visible = vis.briefs;
    return vis;
  };
  setCoverage(options.coverage);

  return {
    group,
    vest,
    briefs,
    material,
    build,
    setCoverage,
    dispose() {
      group.removeFromParent();
      vestGeom.dispose();
      briefsGeom.dispose();
      conformedVestGeom?.dispose();
      conformedBriefsGeom?.dispose();
      material.dispose();
    },
  };
}
