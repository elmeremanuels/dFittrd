/**
 * R2 spike, steps 4–5 (docs/research/step3-serverdrape-spike.md): bake the server drapes into one glTF with morph
 * targets, and measure what survives on the held-out body.
 *
 * Per size: base = the drape on the grid body t = 0, targets = drape(t = -1) − base and drape(t = +1) − base (POSITION
 * and NORMAL). Packed as KHR_mesh_quantization (positions and position deltas int16 on a 0.005 cm grid via the node's
 * scale and translation; normals and normal deltas int8) and, in a second file, EXT_meshopt_compression on top.
 *
 * Measures (girth = viewer/scripts/sizes-drape.ts measure, `girthAt`): the garment girth at the body's hip height and at
 * the hem line (y = 22 cm) for every direct drape, plus the garment-relative measures of relgirth.ts (hipRel: 14.2 cm
 * below the settled top edge; hemRel: 15 cm above the settled bottom edge; hipRing: the rest hip-line particles), which
 * do not move along the garment when the band changes how high a skirt sits; on the held-out body the blend of each size (piecewise and linear
 * basis, `morphBlend.ts`) against that body's direct drape: per-vertex distance and the girth spread across sizes,
 * against the graded spread (rest geometry: 20.1 cm at the mannequin hip).
 *
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/serverdrape/bake.ts out/serverdrape W-6 [heldOutId]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MeshoptEncoder } from 'meshoptimizer';
import { blend, morphWeights, type MorphBasis } from '../../src/morphBlend';
import { girthAt } from './girth';
import { relGirths, rings } from './relgirth';

const [root, band, heldOut = 't-0.40'] = [process.argv[2]!, process.argv[3]!, process.argv[4]];
const GRID = [
  { id: 't-1.00', t: -1 },
  { id: 't+0.00', t: 0 },
  { id: 't+1.00', t: 1 },
];
const SIZES = ['8', '12', '16'];
const HEM_Y = 22;
const STEP_CM = 0.005;

interface BodyMeta { id: string; t: number; label: string; achieved: { hipY: number; hipCm: number; waistCm: number } }
interface DrapeJson { cpuSecondsSim: number; wallSecondsSim: number; band: { relaxedCm: number; settledGirthCm: number; settledMeanY: number; source: string; strainVsRelaxed: number }; insideBody: number; settle: number[][] }
interface RestMeta { sizes: { size: string; girths: Record<string, number>; bandGradedGirthCm: number }[] }

const bodies = (JSON.parse(readFileSync(join(root, 'bodies', 'bodies.json'), 'utf8')) as { bodies: BodyMeta[] }).bodies;
const restMeta = JSON.parse(readFileSync(join(root, 'rest', 'rest.json'), 'utf8')) as RestMeta;
const indices = new Uint32Array(readFileSync(join(root, 'rest', 'indices.bin')).buffer.slice(0));
const f32 = (p: string): Float32Array => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const drapePath = (body: string, size: string): string => join(root, 'drapes', band, `${body}__${size}`);
const drape = (body: string, size: string): Float32Array => f32(drapePath(body, size) + '.bin');
const drapeJson = (body: string, size: string): DrapeJson => JSON.parse(readFileSync(drapePath(body, size) + '.json', 'utf8')) as DrapeJson;
const bodyOf = (id: string): BodyMeta => bodies.find((b) => b.id === id)!;
const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

function normals(pos: Float32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 3, b = indices[t + 1]! * 3, c = indices[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] = n[i]! + nx; n[i + 1] = n[i + 1]! + ny; n[i + 2] = n[i + 2]! + nz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1; n[i] = n[i]! / l; n[i + 1] = n[i + 1]! / l; n[i + 2] = n[i + 2]! / l; }
  return n;
}

function dist(a: Float32Array, b: Float32Array): { rms: number; p95: number; max: number } {
  const d: number[] = [];
  for (let i = 0; i < a.length; i += 3) d.push(Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!));
  d.sort((x, y) => x - y);
  return { rms: r2(Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)), p95: r2(d[Math.floor(0.95 * d.length)]!), max: r2(d[d.length - 1]!) };
}

type G = { hip: number; hem: number; hipRel: number; hemRel: number; hipRing: number };
const KEYS = ['hip', 'hem', 'hipRel', 'hemRel', 'hipRing'] as const;
const restOf = (s: string): Float32Array => f32(join(root, 'rest', `rest-${s}.bin`));
const RINGS = rings(restOf('8'));
/** Girth at the body's hip and at the hem line (fixed heights), and the garment-relative girths. */
function girths(pos: Float32Array, body: BodyMeta): G {
  const r = relGirths(pos, indices, RINGS);
  return { hip: girthAt(pos, indices, body.achieved.hipY), hem: girthAt(pos, indices, HEM_Y), hipRel: r.hipRel, hemRel: r.hemRel, hipRing: r.hipRing };
}
const sp = (a: G, b: G): G => Object.fromEntries(KEYS.map((k) => [k, r1(b[k] - a[k])])) as G;

// ---- 1. Direct drapes: girth table, CPU cost. ----
const table: Record<string, Record<string, unknown>> = {};
let cpu = 0, wall = 0, n = 0;
for (const b of [...GRID.map((g) => g.id), heldOut]) {
  const body = bodyOf(b);
  table[b] = {};
  for (const s of SIZES) {
    const j = drapeJson(b, s);
    cpu += j.cpuSecondsSim; wall += j.wallSecondsSim; n++;
    table[b]![s] = { ...girths(drape(b, s), body), bandY: j.band.settledMeanY, bandGirth: j.band.settledGirthCm, bandRelaxed: j.band.relaxedCm, bandStrain: j.band.strainVsRelaxed, inside: j.insideBody, cpuS: j.cpuSecondsSim, lastMaxMoveCm: j.settle.at(-1)?.[1] };
  }
}
const spread = (b: string, k: keyof G): number => r1((table[b]!['16'] as Record<string, number>)[k]! - (table[b]!['8'] as Record<string, number>)[k]!);
const relRef = Object.fromEntries(['8', '16'].map((s) => [s, relGirths(restOf(s), indices, RINGS)]));
const graded: G = {
  hip: r1(restMeta.sizes.find((s) => s.size === '16')!.girths['87']! - restMeta.sizes.find((s) => s.size === '8')!.girths['87']!),
  hem: r1(restMeta.sizes.find((s) => s.size === '16')!.girths['20']! - restMeta.sizes.find((s) => s.size === '8')!.girths['20']!),
  hipRel: r1(relRef['16']!.hipRel - relRef['8']!.hipRel),
  hemRel: r1(relRef['16']!.hemRel - relRef['8']!.hemRel),
  hipRing: r1(relRef['16']!.hipRing - relRef['8']!.hipRing),
};

// ---- 2. Blend on the held-out body. ----
const H = bodyOf(heldOut);
const blendOut = join(root, 'blend', band);
mkdirSync(blendOut, { recursive: true });
const blends: Record<string, unknown> = {};
for (const basis of ['piecewise', 'linear'] as MorphBasis[]) {
  const per: Record<string, unknown> = {};
  const g: Record<string, G> = {};
  const gp: Record<string, G> = {};
  for (const s of SIZES) {
    const base = drape('t+0.00', s), lo = drape('t-1.00', s), hi = drape('t+1.00', s);
    const targets = basis === 'piecewise'
      ? [lo.map((v, i) => v - base[i]!), hi.map((v, i) => v - base[i]!)]
      : [hi.map((v, i) => (v - lo[i]!) / 2)];
    const out = blend(base, targets, morphWeights(H.t, basis));
    writeFileSync(join(blendOut, `${heldOut}__${s}__${basis}.bin`), Buffer.from(out.buffer));
    g[s] = girths(out, H);
    const direct = drape(heldOut, s);
    // With polish: polish_blender.py's projection-only push-out of particles inside the held-out body (when run).
    const pp = join(blendOut, `${heldOut}__${s}__${basis}__polished.bin`);
    const polished = existsSync(pp) ? girths(f32(pp), H) : null;
    if (polished) gp[s] = polished;
    per[s] = { girth: g[s], polished, direct: girths(direct, H), vertexErrorCm: dist(out, direct) };
  }
  blends[basis] = {
    perSize: per,
    spread: sp(g['8']!, g['16']!),
    spreadPolished: gp['8'] && gp['16'] ? sp(gp['8'], gp['16']) : null,
  };
}

// ---- 3. Pack: KHR_mesh_quantization (+ EXT_meshopt_compression). ----
await MeshoptEncoder.ready;
function packGlb(meshopt: boolean): Uint8Array {
  const chunks: Uint8Array[] = [];
  const views: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  let raw = 0, packed = 0;
  const pad4 = (x: number): number => (x + 3) & ~3;
  function view(data: Uint8Array, count: number, stride: number, mode: 'ATTRIBUTES' | 'TRIANGLES', target: number): number {
    const v: Record<string, unknown> = { buffer: meshopt ? 1 : 0, byteOffset: raw, byteLength: data.byteLength, target };
    if (mode === 'ATTRIBUTES') v.byteStride = stride;
    if (meshopt) {
      const enc = MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode);
      v.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: packed, byteLength: enc.byteLength, byteStride: stride, mode, count } };
      chunks.push(enc, new Uint8Array(pad4(enc.byteLength) - enc.byteLength));
      packed += pad4(enc.byteLength);
    } else {
      chunks.push(data, new Uint8Array(pad4(data.byteLength) - data.byteLength));
    }
    raw += pad4(data.byteLength);
    views.push(v);
    return views.length - 1;
  }
  function i16vec3(q: Int16Array, count: number): number {
    const buf = new Int16Array(count * 4);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) { const v = q[3 * i + k]!; buf[4 * i + k] = v; mn[k] = Math.min(mn[k]!, v); mx[k] = Math.max(mx[k]!, v); }
    if (count === 0) { mn = [0, 0, 0]; mx = [0, 0, 0]; }
    const bv = view(new Uint8Array(buf.buffer), count, 8, 'ATTRIBUTES', 34962);
    accessors.push({ bufferView: bv, componentType: 5122, count, type: 'VEC3', min: mn, max: mx });
    return accessors.length - 1;
  }
  function i8vec3(v: Float32Array, count: number): number {
    const buf = new Int8Array(count * 4);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) buf[4 * i + k] = Math.max(-127, Math.min(127, Math.round(v[3 * i + k]! * 127)));
    const bv = view(new Uint8Array(buf.buffer), count, 4, 'ATTRIBUTES', 34962);
    accessors.push({ bufferView: bv, componentType: 5120, normalized: true, count, type: 'VEC3' });
    return accessors.length - 1;
  }
  const idx16 = Uint16Array.from(indices);
  const ibv = view(new Uint8Array(idx16.buffer), idx16.length, 2, 'TRIANGLES', 34963);
  accessors.push({ bufferView: ibv, componentType: 5123, count: idx16.length, type: 'SCALAR' });
  const idxAcc = accessors.length - 1;
  // One quantisation grid for every size: origin at the min corner of all drapes.
  const all = SIZES.flatMap((s) => GRID.map((g) => drape(g.id, s)));
  const origin = [0, 1, 2].map((k) => Math.min(...all.map((p) => { let m = Infinity; for (let i = k; i < p.length; i += 3) m = Math.min(m, p[i]!); return m; })));
  const q = (p: Float32Array, o: number[] | null): Int16Array => Int16Array.from(p, (v, i) => Math.round((v - (o ? o[i % 3]! : 0)) / STEP_CM));
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  for (const s of SIZES) {
    const base = drape('t+0.00', s), lo = drape('t-1.00', s), hi = drape('t+1.00', s);
    const nb = normals(base), nl = normals(lo), nh = normals(hi);
    const qb = q(base, origin);
    const count = base.length / 3;
    const pos = i16vec3(qb, count);
    const nor = i8vec3(nb, count);
    const tgt = [lo, hi].map((d, k) => {
      const qd = Int16Array.from(q(d, origin), (v, i) => v - qb[i]!);
      const nd = (k === 0 ? nl : nh).map((v, i) => v - nb[i]!);
      return { POSITION: i16vec3(qd, count), NORMAL: i8vec3(nd, count) };
    });
    meshes.push({ name: `AU${s}`, primitives: [{ attributes: { POSITION: pos, NORMAL: nor }, indices: idxAcc, targets: tgt, mode: 4 }], weights: [0, 0], extras: { targetNames: ['t-1', 't+1'] } });
    nodes.push({ name: `AU${s}`, mesh: meshes.length - 1, translation: origin, scale: [STEP_CM, STEP_CM, STEP_CM] });
  }
  const bin = new Uint8Array(chunks.reduce((s, c) => s + c.byteLength, 0));
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'curtain R2 spike bake.ts' },
    extensionsUsed: ['KHR_mesh_quantization', ...(meshopt ? ['EXT_meshopt_compression'] : [])],
    extensionsRequired: ['KHR_mesh_quantization', ...(meshopt ? ['EXT_meshopt_compression'] : [])],
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    accessors,
    bufferViews: views,
    buffers: meshopt ? [{ byteLength: bin.byteLength }, { byteLength: raw, extensions: { EXT_meshopt_compression: { fallback: true } } }] : [{ byteLength: bin.byteLength }],
    extras: {
      curtain: {
        spike: 'R2 server drape, morph blend (ESTIMATE)',
        units: 'cm, mannequin frame (Y up, front +Z)',
        axis: 'AU body chart: t = (hip - 104) / 10; grid bodies t = -1, 0, 1 (AU 8, 12, 16)',
        weights: 'piecewise: [max(0, -t), max(0, t)], clamped to [-1, 1]',
        band: (drapeJson('t+0.00', '12').band.source),
        quantStepCm: STEP_CM,
      },
    },
  };
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = pad4(json.byteLength);
  const total = 12 + 8 + jsonPad + 8 + bin.byteLength;
  const glb = new Uint8Array(total);
  const dv = new DataView(glb.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonPad, true); dv.setUint32(16, 0x4e4f534a, true);
  glb.set(json, 20); glb.fill(0x20, 20 + json.byteLength, 20 + jsonPad);
  dv.setUint32(20 + jsonPad, bin.byteLength, true); dv.setUint32(24 + jsonPad, 0x004e4942, true);
  glb.set(bin, 28 + jsonPad);
  return glb;
}
const webDir = join(root, 'web');
mkdirSync(webDir, { recursive: true });
const sizes: Record<string, number> = {};
for (const meshopt of [false, true]) {
  const glb = packGlb(meshopt);
  const name = `skirt-${band}${meshopt ? '-meshopt' : '-quant'}.glb`;
  writeFileSync(join(webDir, name), glb);
  sizes[name] = glb.byteLength;
  sizes[`${name}.gz`] = gzipSync(glb, { level: 9 }).byteLength;
}
// The quantisation error of the packed base (round trip of the grid).
const report = {
  band,
  bandSource: drapeJson('t+0.00', '12').band.source,
  heldOut: { id: heldOut, t: H.t, label: H.label, hipCm: H.achieved.hipCm, waistCm: H.achieved.waistCm },
  graded,
  direct: table,
  directSpread: Object.fromEntries([...GRID.map((g) => g.id), heldOut].map((b) => [b, Object.fromEntries(KEYS.map((k) => [k, spread(b, k)]))])),
  blends,
  survivalOnHeldOut: {
    direct: Object.fromEntries(KEYS.map((k) => [k, r2(spread(heldOut, k) / graded[k])])),
    piecewise: Object.fromEntries(KEYS.map((k) => [k, r2((blends.piecewise as { spread: G }).spread[k] / graded[k])])),
    linear: Object.fromEntries(KEYS.map((k) => [k, r2((blends.linear as { spread: G }).spread[k] / graded[k])])),
  },
  bundleBytes: sizes,
  cost: { drapes: n, cpuSecondsSimTotal: r1(cpu), cpuSecondsPerDrape: r1(cpu / n), wallSecondsPerDrape: r1(wall / n) },
};
writeFileSync(join(root, `report-${band}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
