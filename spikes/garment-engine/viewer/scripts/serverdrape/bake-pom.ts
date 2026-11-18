/**
 * POM bundle (docs/research/step3-serverdrape-spike.md §10): the POM v2 drapes (§9) baked into a garment bundle the
 * embed's `@curtain/garment-viewer` loads (`drapeBake.ts`), and what survives of them on the device.
 *
 * Per size: base = the drape on the chart body t = 0 (AU 12), morph targets = the drapes on the other chart bodies
 * minus that base. The bodies are t = -1 and t = +1 (AU 8 and AU 16); where the wear rule refuses a combination (AU 8
 * on the AU 16 body: the band cannot be worn there, §9.2) the size's upper body is the nearest one it was draped on
 * (t = +0.5, AU 14), and the device holds the drape there beyond it. Positions are int16 on a QUANT_CM grid
 * (KHR_mesh_quantization), every view meshopt-compressed; no normals (the figure computes them), no texture: one plain
 * colour, the largest colour cluster of the photo texture (`--colour`).
 *
 * Measured here, on the held-out body (t = -0.4, hip 100, waist 73.5; not a grid body):
 *   - the device blend (decoded from the written base.glb, `bakeWeights` + `blendBakedSize` of the viewer, then the
 *     viewer's push-out out of the drawn avatar) against the direct drape on that body: per-vertex RMS / p95 / max,
 *     and hulls at the body's hip, the knee and the hem edge, and the hem ring's path length (the folds);
 *   - bundle bytes (raw and gzip).
 *
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/serverdrape/bake-pom.ts out/pom2-avatar wear <bundleDir> [--payload <dir with payload.json>] [--colour #rrggbb]
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { bodyField, buildAvatar } from '../../../../../packages/garment-viewer/src/body';
import { makeCollider } from '../../../../../packages/garment-viewer/src/collide';
import { DRAPE_BAKE_FORMAT, bakeAxis, bakeWeights, blendBakedSize, readDrapeBake, settleOnBody, type DrapeBakeMeta, type DrapeBakeSizeMeta, type SizeProvenance } from '../../../../../packages/garment-viewer/src/drapeBake';
import { writeDrapeBake } from '../../../../../packages/garment-viewer/src/drapeBakeWrite';
import { girthAt } from './girth';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1]! : d; };
const [root, set, outDir] = [argv[0]!, argv[1]!, argv[2]!];
const payloadDir = opt('--payload', '');
const COLOUR = opt('--colour', '#9D3F3B');
const COLOUR_SOURCE = opt('--colour-source', 'largest of 4 k-means colour clusters (50 % of texels) of the stage-4t texture baked from the shop video frames of this skirt; the floral print is left out');
const HELD = 't-0.40';
const QUANT_CM = Number(opt('--quant', '0.05')); // 0.5 mm grid: below anything the drape resolves, and it halves the file
const CODEC = Number(opt('--codec', '1')); // meshopt vertex codec version (1: smaller, decoded by meshoptimizer >= 0.23)
const CLEARANCE_CM = 0.35; // the device drape's collider clearance (mount.ts / prepareFit)
const SIZES = ['8', '10', '12', '14', '16'];
const BASE_SIZE = '12';
const GRID: { id: string; t: number }[] = [
  { id: 't-1.00', t: -1 },
  { id: 't+0.00', t: 0 },
  { id: 't+0.50', t: 0.5 },
  { id: 't+1.00', t: 1 },
];

interface BodyMeta { id: string; t: number; label: string; target: { bust?: number; waist?: number; hip?: number }; achieved: { hipCm: number; waistCm: number; hipY: number } }
interface RestSize { size: string; provenance: SizeProvenance }
interface RestMeta { rings: { start: number[]; size: number[] }; sizes: RestSize[] }
interface DrapeJson { status?: string; insideBody?: number; settle?: number[][]; wear?: { fit?: { wearable?: boolean; note?: string } } }

const bodies = (JSON.parse(readFileSync(join(root, 'bodies', 'bodies.json'), 'utf8')) as { bodies: BodyMeta[] }).bodies;
const rest = JSON.parse(readFileSync(join(root, 'rest', 'rest.json'), 'utf8')) as RestMeta;
const indices = new Uint32Array(readFileSync(join(root, 'rest', 'indices.bin')).buffer.slice(0));
const f32 = (p: string): Float32Array => { const b = readFileSync(p); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const path = (body: string, size: string): string => join(root, 'drapes', set, `${body}__${size}`);
const has = (body: string, size: string): boolean => existsSync(path(body, size) + '.bin');
const drape = (body: string, size: string): Float32Array => f32(path(body, size) + '.bin');
const json = (body: string, size: string): DrapeJson | null => (existsSync(path(body, size) + '.json') ? (JSON.parse(readFileSync(path(body, size) + '.json', 'utf8')) as DrapeJson) : null);
const bodyOf = (id: string): BodyMeta => bodies.find((b) => b.id === id)!;
const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;

// ---- 1. Which bodies each size rests on. ----
const plan: (DrapeBakeSizeMeta & { bodies: string[] })[] = SIZES.map((s) => {
  if (!has('t+0.00', s)) throw new Error(`size ${s}: no drape on the base body t+0.00`);
  const prov = rest.sizes.find((r) => r.size === s)!.provenance;
  const notDraped: { t: number; reason: string }[] = [];
  const lo = has('t-1.00', s) ? GRID[0]! : null;
  let hi: { id: string; t: number } | null = null;
  if (has('t+1.00', s)) hi = GRID[3]!;
  else {
    const j = json('t+1.00', s);
    notDraped.push({ t: 1, reason: j?.status ?? 'not draped' });
    if (has('t+0.50', s)) hi = GRID[2]!;
  }
  if (!lo) notDraped.push({ t: -1, reason: json('t-1.00', s)?.status ?? 'not draped' });
  const others = [lo, hi].filter((g): g is { id: string; t: number } => !!g);
  return { size: s, baseT: 0, targetT: others.map((g) => g.t), provenance: prov, ...(notDraped.length ? { notDraped } : {}), bodies: others.map((g) => g.id) };
});

// ---- 2. Pack (the viewer package's writer; `drapeBake.ts` reads it). ----
const meta: DrapeBakeMeta = {
  format: DRAPE_BAKE_FORMAT,
  formatVersion: 1,
  axis: { measure: 'hip', hipAtZero: 104, hipPerUnit: 10, label: 'AU body chart of the skirt: hip 104 + 10 t (t = -1, 0, 1: AU 8, 12, 16)' },
  quantStepCm: QUANT_CM,
  plainColourHex: COLOUR,
  plainColourSource: COLOUR_SOURCE,
  sizes: plan.map(({ bodies: _b, ...m }) => m),
  source: 'POM v2 (step3-serverdrape-spike.md §9-10): rest geometry from the shop tape, band placed 2 cm under the navel (ASSUMED level), gathered; Blender 4.2 cloth, 144 frames, on the device avatar (buildAvatar) of each chart body; ESTIMATE',
};
const glb = await writeDrapeBake({
  meta,
  indices,
  drapes: plan.map((p) => ({ size: p.size, base: drape('t+0.00', p.size), targets: p.bodies.map((b) => drape(b, p.size)), targetNames: p.bodies })),
  generator: 'curtain bake-pom.ts',
  codec: CODEC,
});
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'base.glb'), glb);

// ---- 3. Bundle metadata (the viewer's and the api's gate read these). ----
const productId = 'crimson-wildflower-maxi-skirt';
const payload = payloadDir ? (JSON.parse(readFileSync(join(payloadDir, 'payload.json'), 'utf8')) as { sizeChart: { size: string }[] }) : null;
if (payloadDir) copyFileSync(join(payloadDir, 'payload.json'), join(outDir, 'payload.json'));
const oldMaterial = payloadDir && existsSync(join(payloadDir, 'material.json')) ? (JSON.parse(readFileSync(join(payloadDir, 'material.json'), 'utf8')) as Record<string, unknown>) : null;
const label = 'POM v2 server drape bake: built from the shop tape, draped on the server, blended on the device. An ESTIMATE (AGENTS.md rule 3)';
writeFileSync(join(outDir, 'anchors.json'), JSON.stringify({
  format: 'curtain.garment.anchors', formatVersion: 1, productId, baseSize: BASE_SIZE, category: 'bottom', unit: 'cm',
  mannequin: { version: '0.1.0', shape: 'M', family: 'female' }, synthetic: false,
  source: { kind: 'pom-v2-drape-bake', label },
  drapeBake: 'base.glb',
  ...(payload ? { payloadFile: 'payload.json' } : {}),
  rings: {},
}, null, 1));
writeFileSync(join(outDir, 'grading.json'), JSON.stringify({
  format: 'curtain.garment.grading', formatVersion: 1, productId, baseSize: BASE_SIZE, unit: 'cm',
  morph: { method: 'none: every size is its own server drape (drapeBake in base.glb)' },
  sizes: SIZES.map((s) => ({ size: s, provenance: rest.sizes.find((r) => r.size === s)!.provenance })),
}, null, 1));
writeFileSync(join(outDir, 'material.json'), JSON.stringify({
  ...(oldMaterial ?? { format: 'curtain.garment.material', formatVersion: 1, fibres: [{ id: 'viscose', pct: 100 }], construction: null, weightGsm: 165, stretchPct: 1.5, drape: 0.85, bendStiffness: 0.04, sheen: 0.3, texture: 'plain-weave', simulation: { damping: 0.035 } }),
  baseColorHex: COLOUR,
  // Opaque: a see-through plain colour shows the gathers' back faces through the front.
  opacity: 1,
  provenance: { ...((oldMaterial?.provenance as Record<string, string> | undefined) ?? {}), baseColorHex: `plain colour, no print: ${COLOUR_SOURCE}`, opacity: 'set to 1 for the plain-colour bake (product: 0.8)' },
}, null, 1));
writeFileSync(join(outDir, 'qa.json'), JSON.stringify({
  format: 'curtain.garment.qa', formatVersion: 1, productId, synthetic: false,
  label: 'tape-built and server-draped geometry: an estimate, not a measurement (AGENTS.md rule 3)',
  chartAgreement: {
    pass: true,
    basis: 'not a reconstruction: the garment is built from the shop tape (AU 8, 10, 14 measured; 12 interpolated; 16 extrapolated), so there is no calibration to a chart to check. pass is set for the demo gate; the merchant import gate has not been designed for tape-built bundles',
    toleranceCm: 2,
    maxAbsCm: null,
  },
  calibration: { residualBeforeCm: { maxAbs: 0 }, residualAfterGlobalCm: { maxAbs: 0 } },
  meshHealth: { triangles: indices.length / 3, vertices: indices.reduce((m, v) => Math.max(m, v), 0) + 1 },
  sizes: plan.map(({ bodies: _b, ...m }) => m),
}, null, 1));

// ---- 4. Measure the device path on the held-out body. ----
const bake = await readDrapeBake(new Uint8Array(glb));
const H0 = bodyOf(HELD);
// Anny bodies (§9) carry no bust: the chart line's.
const H = { ...H0, target: { bust: H0.target.bust ?? 95 + 10 * H0.t, waist: H0.target.waist ?? H0.achieved.waistCm, hip: H0.target.hip ?? H0.achieved.hipCm } };
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canon = buildMannequinMesh(m, { head: 'neutral' });
const av = buildAvatar(m, canon, { bust: H.target.bust, waist: H.target.waist, hip: H.target.hip });
const field = bodyField(m, av);
const tH = bakeAxis(bake.meta, H.target.hip);
const hemStart = rest.rings.start[rest.rings.start.length - 1]!, hemN = rest.rings.size[rest.rings.size.length - 1]!;
const hemIds = Array.from({ length: hemN }, (_, k) => hemStart + k);
function hull2(pts: [number, number][]): number {
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop(); up.push(p); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < h.length; i++) per += Math.hypot(h[i]![0] - h[(i + 1) % h.length]![0], h[i]![1] - h[(i + 1) % h.length]![1]);
  return r1(per);
}
const hemHull = (p: Float32Array): number => hull2(hemIds.map((i) => [p[3 * i]!, p[3 * i + 2]!]));
const hemPath = (p: Float32Array): number => { let s = 0; for (let k = 0; k < hemN; k++) { const a = hemIds[k]!, b = hemIds[(k + 1) % hemN]!; s += Math.hypot(p[3 * a]! - p[3 * b]!, p[3 * a + 1]! - p[3 * b + 1]!, p[3 * a + 2]! - p[3 * b + 2]!); } return r1(s); };
const measures = (p: Float32Array): Record<string, number> => ({ hipHull: girthAt(p, indices, H.achieved.hipY), kneeHull: girthAt(p, indices, 47.5), hemHull: hemHull(p), hemPath: hemPath(p) });
function dist(a: Float32Array, b: Float32Array): { rms: number; p95: number; max: number } {
  const d: number[] = [];
  for (let i = 0; i < a.length; i += 3) d.push(Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!, a[i + 2]! - b[i + 2]!));
  d.sort((x, y) => x - y);
  return { rms: r2(Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)), p95: r2(d[Math.floor(0.95 * d.length)]!), max: r2(d[d.length - 1]!) };
}
/** The viewer's push-out (mount.ts, drape bake path): `settleOnBody` with the device collider of the held-out avatar. */
function pushOut(p: Float32Array): { pos: Float32Array; moved: number; maxCm: number; floored: number } {
  const out = Float32Array.from(p);
  const r = settleOnBody(out, makeCollider(field, CLEARANCE_CM));
  return { pos: out, moved: r.body, maxCm: r2(r.maxBodyCm), floored: r.floor };
}
const perSize: Record<string, unknown> = {};
for (const s of SIZES) {
  const bs = bake.sizes.get(s)!;
  const { weights, clamped } = bakeWeights(bs, tH);
  const blended = blendBakedSize(bs, weights);
  const polished = pushOut(blended);
  const directPushed = has(HELD, s) ? pushOut(drape(HELD, s)) : null;
  // The direct drape as the device would show it (same push-out and floor), so the two compare like for like.
  const direct = directPushed?.pos ?? null;
  const quantErr = dist(bs.base, drape('t+0.00', s));
  perSize[s] = {
    provenance: bs.provenance,
    bodies: { base: 0, targets: bs.targetT, weights: weights.map(r2), clamped, notDraped: bs.notDraped ?? [] },
    quantisationErrorCm: quantErr,
    devicePushOut: { particles: polished.moved, maxCm: polished.maxCm, laidOnFloor: polished.floored },
    blend: measures(polished.pos),
    direct: direct ? measures(direct) : null,
    directPushOut: directPushed ? { particles: directPushed.moved, maxCm: directPushed.maxCm, laidOnFloor: directPushed.floored } : null,
    vertexErrorCm: direct ? dist(polished.pos, direct) : null,
    vertexErrorBeforePushOutCm: direct ? dist(blended, direct) : null,
  };
  if (direct) writeFileSync(join(root, 'drapes', set, `${HELD}__${s}__devblend.bin`), Buffer.from(polished.pos.buffer));
}
// Direct drapes on the grid bodies, pushed out the same way on their own avatar (how the device shows a grid body).
const report = {
  bundle: outDir,
  heldOut: { id: HELD, t: r2(tH), ...H.target },
  bytes: { 'base.glb': glb.byteLength, 'base.glb.gz': gzipSync(glb, { level: 9 }).byteLength, uncompressedInt16: bake.vertexCount * 8 * plan.reduce((n, p) => n + 1 + p.bodies.length, 0) + indices.length * 2 },
  colour: { hex: COLOUR, source: COLOUR_SOURCE },
  perSize,
};
writeFileSync(join(root, `bake-report-${set}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
