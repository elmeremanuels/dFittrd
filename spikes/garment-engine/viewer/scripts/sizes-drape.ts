/**
 * Node: drape every size of an evaluation bundle (out/eval/<id>/) on the canonical mannequin and print, per size, the
 * garment's girth (convex hull of the slice, cm) at fixed heights for the graded mesh, the placed start and the draped
 * cloth: how much the sizes differ in the viewer and where the difference goes. Not part of the tests.
 *
 * Step-3 control (docs/research/shortcut-to-step3.md §4, days 1-2): `--modes` drapes each size once per drape setting
 * and prints how much of the graded spread (largest minus smallest size) survives at the `--hip` and `--hem` heights,
 * plus stability (settle time, residual motion over one more second, worst strain) and solver time.
 *   base               the viewer default (cling on, no loops, no band model)
 *   nocling            cling off
 *   loops:<retain>[:<rings>]  cling off + girth loops holding <retain> of the graded girth at <rings> (e.g. hip+waist; default waist+hip+hem)
 *   cling+loops:<r>    cling on + girth loops
 *   band:<R>:<S>[:<r>] cling off + loops <r> (default 0.9) + stretch waistband relaxed <R> / stretched <S> cm (base size)
 *   band:measured[:r]  the same with the band read from --band-file (refused while it holds no measurement)
 * `--bench <n>`: instead, time 90 frames (1.5 s of cloth) of the base size per mode, n rounds interleaved across the
 * modes (so load from other processes hits all of them alike), and print the min and median ms per frame.
 * Run: pnpm --filter @curtain/garment-spike exec tsx viewer/scripts/sizes-drape.ts out/eval/<id> [y1,y2,...]
 *        [--modes base,nocling,loops:0.9,band:70:100] [--hip 87.36] [--hem 20] [--json out.json] [--band-file f.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { bodyField, buildAvatar, mannequinMeasurements } from '../src/body';
import { sample } from '../src/collide';
import { isSettled, loopGirth, stepCloth, strainQuantile } from '../src/cloth';
import { meshFromGlb, type SpikeBundle } from '../src/bundle';
import { DEFAULT_DRAPE, LOOP_RINGS, LOOP_SLICE_CM, gradedMesh, openSession, prepareFit, sizeLabels, viewerMaterial, type DrapeOptions, type WaistbandSpec } from '../src/engine';
import { fitForBody } from '../src/fitting';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const k = argv.indexOf(`--${name}`);
  if (k < 0) return undefined;
  const v = argv[k + 1];
  argv.splice(k, 2);
  return v;
};
const modesArg = flag('modes');
const jsonOut = flag('json');
const bandFile = flag('band-file');
const hipArg = flag('hip');
const hemArg = flag('hem');
const benchArg = flag('bench');
const dir = argv[0]!;
const ys = (argv[1] ?? '100,95,87,75,60,40,20').split(',').map(Number);
const rd = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));
const bundle: SpikeBundle = { productId: String((rd('anchors.json') as { productId: string }).productId), anchors: rd('anchors.json') as SpikeBundle['anchors'], grading: rd('grading.json') as SpikeBundle['grading'], material: rd('material.json') as SpikeBundle['material'], qa: rd('qa.json') as SpikeBundle['qa'], baseMesh: meshFromGlb(new Uint8Array(readFileSync(join(dir, 'base.glb')))), payload: rd('payload.json') as GarmentPayload };
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const meas = mannequinMeasurements(m);
const avatar = buildAvatar(m, buildMannequinMesh(m), meas);
const field = bodyField(m, avatar);
const session = openSession(m, bundle);
const fit = fitForBody(session.payload, meas);
const hipY = hipArg ? Number(hipArg) : m.morphHeights.hip;
const hemY = hemArg ? Number(hemArg) : 20;

/** Perimeter of the convex hull of the mesh's slice at height y (x–z), cm. */
function girth(pos: ArrayLike<number>, idx: ArrayLike<number>, y: number): number {
  const pts: [number, number][] = [];
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = idx[t + k]!, b = idx[t + ((k + 1) % 3)]!;
    const ya = pos[3 * a + 1]! - y, yb = pos[3 * b + 1]! - y;
    if ((ya < 0) !== (yb < 0)) { const s = ya / (ya - yb); pts.push([pos[3 * a]! + s * (pos[3 * b]! - pos[3 * a]!), pos[3 * a + 2]! + s * (pos[3 * b + 2]! - pos[3 * a + 2]!)]); }
  }
  if (pts.length < 3) return NaN;
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop(); up.push(p); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i]!, b = h[(i + 1) % h.length]!; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return Math.round(per * 10) / 10;
}
const e4 = new Float32Array(4);
const torsoGirth = (y: number): number => {
  if (!sample(field.torso, y, e4)) return NaN;
  const a = e4[2]!, b = e4[3]!;
  return Math.round(Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) * 10) / 10;
};

interface BandFileEntry { relaxedCm: number | null; stretchedCm: number | null; hemSweepCm?: number | null; measuredSize?: string | number | null; gradeCmPerSize?: number | null }
/** The founder's tape measurements (waistbands.json) for this bundle's product, validated before any drape runs. */
let bandEntry: (BandFileEntry & { size: string }) | undefined;
/** "AU 12", "size 12", "12" and 12 all mean the grading label "12". */
function normaliseSize(v: string | number, labels: readonly string[]): string {
  const raw = String(v).trim().replace(/^(au|size|sz)\s*/i, '').trim();
  const hit = labels.find((l) => l.trim().toUpperCase() === raw.toUpperCase());
  if (!hit) throw new Error(`measuredSize ${JSON.stringify(v)} is not one of the grading sizes ${labels.join(', ')}`);
  return hit;
}
function readBandFile(): WaistbandSpec {
  if (!bandEntry) {
    if (!bandFile) throw new Error('band:measured needs --band-file');
    const j = JSON.parse(readFileSync(bandFile, 'utf8')) as { products: Record<string, BandFileEntry> };
    const p = j.products[bundle.productId];
    if (!p || p.relaxedCm == null || p.stretchedCm == null) throw new Error(`${bandFile}: product ${bundle.productId} has no measured band yet`);
    if (!(p.relaxedCm > 20 && p.stretchedCm >= p.relaxedCm)) throw new Error(`${bandFile}: ${bundle.productId} needs 20 < relaxedCm <= stretchedCm (got ${p.relaxedCm} / ${p.stretchedCm})`);
    const size = normaliseSize(p.measuredSize ?? bundle.grading.baseSize, bundle.grading.sizes.map((x) => x.size));
    bandEntry = { ...p, size };
  }
  const p = bandEntry;
  return { relaxedCm: p.relaxedCm!, stretchedCm: p.stretchedCm!, measuredSize: p.size, ...(p.gradeCmPerSize != null ? { gradeCmPerSize: p.gradeCmPerSize } : {}), assumed: false };
}

function parseMode(spec: string): DrapeOptions {
  const o = parseMode0(spec);
  const rings = spec.split(':').find((x) => /^[a-z]+(\+[a-z]+)*$/.test(x) && x !== spec.split(':')[0] && x !== 'measured');
  return rings ? { ...o, loopRings: rings.split('+') as DrapeOptions['loopRings'] } : o;
}
function parseMode0(spec: string): DrapeOptions {
  const [kind, a, b, c] = spec.split(':');
  if (kind === 'base') return DEFAULT_DRAPE;
  if (kind === 'nocling') return { cling: false, loopRetain: 0, waistband: null };
  if (kind === 'loops') return { cling: false, loopRetain: Number(a ?? 0.9), waistband: null };
  if (kind === 'cling+loops') return { cling: true, loopRetain: Number(a ?? 0.9), waistband: null };
  if (kind === 'band' && a === 'measured') return { cling: false, loopRetain: Number(b ?? 0.9), waistband: readBandFile() };
  if (kind === 'band') return { cling: false, loopRetain: Number(c ?? 0.9), waistband: { relaxedCm: Number(a), stretchedCm: Number(b), assumed: true } };
  throw new Error(`unknown mode ${spec}`);
}

interface SizeRow { size: string; graded: number[]; start: number[]; draped: number[]; hip: { graded: number; draped: number }; hem: { graded: number; draped: number }; hemYDraped: number; settledS: number; residualCm: number; p99StrainPct: number; finite: boolean; solveMs: number; band: unknown; loops: unknown; loopState: LoopState[]; lines: string[] }
/** A girth loop after the drape: active when the drape sits on its minimum (the loop, not the cloth, set that girth). */
interface LoopState { ring: string; particles: number; minGirthCm: number; drapedCm: number; active: boolean }
type Spread = { graded: number; draped: number; survivesPct: number };
const results: { mode: string; options: DrapeOptions; rows: SizeRow[]; hipSpread: Spread; hemSpread: Spread; byHeight: (Spread & { y: number; loopRing: string | null })[]; ringsInstalled: string[]; ringsSkipped: string[]; ringsNeverActive: string[] }[] = [];

// Parse every mode (and read the band file) before any drape runs, so a bad mode fails fast instead of after minutes of draping.
const modeList = (modesArg ?? 'base').split(',');
const parsedModes = new Map(modeList.map((k) => [k, parseMode(k)] as const));

if (benchArg) {
  const modes = modeList;
  const times = new Map<string, number[]>(modes.map((k) => [k, []]));
  const material = viewerMaterial('product', bundle.material);
  for (let round = 0; round < Number(benchArg); round++) for (const mode of modes) {
    const f = prepareFit(session, avatar, field, fit, bundle.grading.baseSize, material, 1.5, parsedModes.get(mode)!);
    const t0 = performance.now();
    stepCloth(f.cloth, f.params, f.collide, 90);
    times.get(mode)!.push((performance.now() - t0) / 90);
  }
  for (const [mode, t] of times) {
    t.sort((a, b) => a - b);
    console.log(`[bench] ${bundle.productId} ${mode}: ${t[0]!.toFixed(2)} ms/frame min, ${t[Math.floor(t.length / 2)]!.toFixed(2)} median over ${t.length} rounds (${bundle.baseMesh.positions.length / 3} particles)`);
  }
  process.exit(0);
}
console.log(`${bundle.productId} (${dir}); heights ${ys.join(' / ')} cm; body hull ${ys.map((y) => girth(avatar.mesh.positions, avatar.mesh.indices, y)).join(' / ')}; torso ellipse at hip ${hipY.toFixed(1)}: ${torsoGirth(hipY)}`);
const writeJson = (): void => { if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ productId: bundle.productId, dir, heights: ys, hipY, hemY, torsoAtHip: torsoGirth(hipY), results }, null, 1)); };
for (const mode of modeList) {
  const options = parsedModes.get(mode)!;
  const rows: SizeRow[] = [];
  for (const size of sizeLabels(session)) {
    const g = gradedMesh(session, size);
    const t0 = performance.now();
    const f = prepareFit(session, avatar, field, fit, size, viewerMaterial('product', bundle.material), 1.5, options);
    const start = Float32Array.from(f.cloth.pos);
    while (!isSettled(f.cloth, f.params)) stepCloth(f.cloth, f.params, f.collide, 1);
    const solveMs = performance.now() - t0;
    const settledS = f.cloth.time;
    const out = Float32Array.from(f.cloth.pos);
    // Stability: one more simulated second; the largest move of any particle against the settled pose (jitter or drift).
    stepCloth(f.cloth, f.params, f.collide, 60);
    let residual = 0, finite = true;
    for (let i = 0; i < out.length; i++) { if (!Number.isFinite(f.cloth.pos[i]!)) finite = false; }
    for (let i = 0; i < out.length; i += 3) residual = Math.max(residual, Math.hypot(f.cloth.pos[i]! - out[i]!, f.cloth.pos[i + 1]! - out[i + 1]!, f.cloth.pos[i + 2]! - out[i + 2]!));
    let minY = Infinity;
    for (let i = 1; i < out.length; i += 3) minY = Math.min(minY, out[i]!);
    const c = f.cloth, scratch: number[] = [], hull = new Int32Array(c.loops.length + 2);
    const loopState: LoopState[] = f.loops.map((l, k) => {
      const d = loopGirth(out, c.loops, c.loopStart[k]!, c.loopStart[k + 1]!, scratch, hull);
      return { ring: l.ring, particles: l.particles, minGirthCm: l.minGirthCm, drapedCm: Math.round(d * 10) / 10, active: d <= c.loopMin[k]! * 1.01 };
    });
    rows.push({ size, graded: ys.map((y) => girth(g.positions, f.indices, y)), start: ys.map((y) => girth(start, f.indices, y)), draped: ys.map((y) => girth(out, f.indices, y)), hip: { graded: girth(g.positions, f.indices, hipY), draped: girth(out, f.indices, hipY) }, hem: { graded: girth(g.positions, f.indices, hemY), draped: girth(out, f.indices, hemY) }, hemYDraped: Math.round(minY * 10) / 10, settledS: Math.round(settledS * 100) / 100, residualCm: Math.round(residual * 100) / 100, p99StrainPct: Math.round(strainQuantile(f.cloth, 0.99) * 1000) / 10, finite, solveMs: Math.round(solveMs), band: f.band, loops: f.loops, loopState, lines: f.lines.map((l) => l.text) });
  }
  const spreadOf = (a: { graded: number; draped: number }, z: { graded: number; draped: number }): Spread => {
    const gs = Math.round((z.graded - a.graded) * 10) / 10, ds = Math.round((z.draped - a.draped) * 10) / 10;
    return { graded: gs, draped: ds, survivesPct: Math.round((ds / gs) * 100) };
  };
  const spread = (k: 'hip' | 'hem'): Spread => spreadOf(rows[0]![k], rows[rows.length - 1]![k]);
  // Which rings hold a loop, and at what height: a spread measured at a loop ring is imposed by the loop (it holds the
  // hull at retain × the graded girth there), not predicted by the drape. Off-ring heights are the honest evidence.
  const installed = [...new Set(rows.flatMap((r) => r.loopState.map((l) => l.ring)))];
  const requested = options.loopRetain > 0 ? [...(options.loopRings ?? LOOP_RINGS)] : [];
  const skipped = requested.filter((r) => !installed.includes(r));
  const neverActive = installed.filter((r) => !rows.some((row) => row.loopState.some((l) => l.ring === r && l.active)));
  let restHem = Infinity;
  const g0 = gradedMesh(session, rows[0]!.size).positions;
  for (let i = 1; i < g0.length; i += 3) restHem = Math.min(restHem, g0[i]!);
  const ringY: Record<string, number> = { waist: m.morphHeights.waist, hip: m.morphHeights.hip, hem: restHem + 2 };
  const ringAt = (y: number): string | null => installed.find((r) => Math.abs(ringY[r]! - y) <= LOOP_SLICE_CM + 0.5) ?? null;
  const byHeight = ys.map((y, i) => ({ y, loopRing: ringAt(y), ...spreadOf({ graded: rows[0]!.graded[i]!, draped: rows[0]!.draped[i]! }, { graded: rows[rows.length - 1]!.graded[i]!, draped: rows[rows.length - 1]!.draped[i]! }) }));
  const r = { mode, options, rows, hipSpread: spread('hip'), hemSpread: spread('hem'), byHeight, ringsInstalled: installed, ringsSkipped: skipped, ringsNeverActive: neverActive };
  results.push(r);
  const hipRing = ringAt(hipY);
  const hipTag = hipRing ? ` [AT THE ${hipRing.toUpperCase()} LOOP: imposed by the loop, not predicted]` : '';
  console.log(`\n== ${mode}: hip@${hipY.toFixed(1)} graded spread ${r.hipSpread.graded} -> draped ${r.hipSpread.draped} cm (${r.hipSpread.survivesPct} %)${hipTag}; hem@${hemY} graded ${r.hemSpread.graded} -> draped ${r.hemSpread.draped} cm (${r.hemSpread.survivesPct} %)`);
  console.log(`   spread by height (AU ${rows[0]!.size}->${rows[rows.length - 1]!.size}, graded -> draped cm): ${byHeight.map((b) => `y${b.y} ${b.graded}->${b.draped} (${b.survivesPct}%)${b.loopRing ? `[${b.loopRing} loop]` : ''}`).join(' | ')}`);
  const off = byHeight.filter((b) => !b.loopRing && Number.isFinite(b.survivesPct));
  if (requested.length) console.log(`   loops: requested ${requested.join('+')}; installed ${installed.join('+') || 'none'}${skipped.length ? `; SKIPPED ${skipped.join('+')} (no free cloth particles at that ring, or pinned)` : ''}${neverActive.length ? `; NEVER ACTIVE ${neverActive.join('+')} (the drape never fell to the loop's minimum)` : ''}; off-ring heights: ${off.map((b) => `y${b.y} ${b.survivesPct}%`).join(', ')}`);
  for (const row of rows) {
    console.log(`${row.size}: hip ${row.hip.graded}->${row.hip.draped} hem ${row.hem.graded}->${row.hem.draped} | draped ${row.draped.join(' / ')} | lowest y ${row.hemYDraped}, settled ${row.settledS} s, residual ${row.residualCm} cm/1 s, p99 strain ${row.p99StrainPct} %, ${row.finite ? 'finite' : 'NaN!'}, ${row.solveMs} ms`);
    if (row.band) console.log(`   band ${JSON.stringify(row.band)}`);
    if (row.loopState.length) console.log(`   loops ${row.loopState.map((l) => `${l.ring}(${l.particles}p) min ${l.minGirthCm} draped ${l.drapedCm}${l.active ? ' ACTIVE' : ''}`).join('; ')}`);
  }
  writeJson();
}
// The founder's hem sweep (waistbands.json hemSweepCm, flat × 2) against the graded mesh of the measured size: a check
// of the cut (grading.json), not of the drape. The graded hem tucks in at the floor (REFINEMENT R2), so the widest hull
// girth in the bottom 30 cm is the comparable number.
if (bandEntry) {
  const g = gradedMesh(session, bandEntry.size);
  let widest = 0, at = 0;
  for (let y = 1; y <= 30; y++) { const v = girth(g.positions, g.indices, y); if (v > widest) { widest = v; at = y; } }
  const sweep = bandEntry.hemSweepCm;
  console.log(`\n[hem sweep] AU ${bandEntry.size}: measured ${sweep ?? 'not given'} cm; graded mesh widest hull girth in the bottom 30 cm ${widest} cm (y=${at}), at y=${hemY} ${girth(g.positions, g.indices, hemY)} cm${sweep ? `; mesh / measured ${Math.round((widest / sweep) * 100)} %` : ''}`);
}
