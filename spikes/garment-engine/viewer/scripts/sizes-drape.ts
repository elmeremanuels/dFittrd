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
 *   band:measured[:r]  the same with the band read from --band-file (refused while it holds no measurement); sizes the
 *                      file does not measure are interpolated or extrapolated (`bandFor`) and printed as such
 *   cling+band:…       any band mode with the cling pull left on (r = 0 switches the loops off: `band:measured:0`)
 * What a band mode IMPOSES and what the drape predicts: the band's girth on the body is set by the placement rule
 * (`fitElasticBand`: clamp(body girth at the band's height, relaxed, stretched), then the top of the mesh is scaled to it
 * and blended back to the cut over `BAND_BLEND_CM` below). No cloth physics decides it. So "does the band slide" and every
 * spread at a height inside that zone are consequences of the rule and of the band height the reconstructed mesh happens to
 * have; they are printed with an [IMPOSED] tag. Heights below the zone are drape results. With per-size tape measurements
 * the spread between the smallest and largest MEASURED size is printed first; the spread to an interpolated or
 * extrapolated end size is printed after it and says so. `[band-height sensitivity]` repeats the rule with the band 2 and
 * 4 cm higher and at the height the tape's length would put it (hem kept where it is).
 * With a band file that holds per-size tape measurements the script ends with the cut check: hip girth, hem girth and
 * length of the graded mesh per size next to the tape values (measured, interpolated or extrapolated, labelled).
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
import { BAND_BLEND_CM, CLEARANCE_CM, DEFAULT_DRAPE, LOOP_RINGS, LOOP_SLICE_CM, WAISTBAND_CM, bandFor, fitElasticBand, gradedMesh, openSession, prepareFit, sizeLabels, viewerMaterial, waistbandFromFile, type BandFileEntry, type BandSource, type DrapeOptions, type ElasticBand, type WaistbandSpec } from '../src/engine';
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

/** The founder's tape measurements (waistbands.json) for this bundle's product, validated before any drape runs. */
let bandEntry: BandFileEntry | undefined;
let bandSpec: WaistbandSpec | undefined;
function readBandFile(): WaistbandSpec {
  if (!bandSpec) {
    if (!bandFile) throw new Error('band:measured needs --band-file');
    const j = JSON.parse(readFileSync(bandFile, 'utf8')) as { products: Record<string, BandFileEntry> };
    bandEntry = j.products[bundle.productId];
    try { bandSpec = waistbandFromFile(bandEntry, bundle.grading); } catch (e) { throw new Error(`${bandFile}: product ${bundle.productId}: ${(e as Error).message}`); }
  }
  return bandSpec;
}

function parseMode(spec: string): DrapeOptions {
  const o = parseMode0(spec);
  const rings = spec.split(':').find((x) => /^[a-z]+(\+[a-z]+)*$/.test(x) && x !== spec.split(':')[0] && x !== 'measured' && x !== 'band');
  return rings ? { ...o, loopRings: rings.split('+') as DrapeOptions['loopRings'] } : o;
}
function parseMode0(spec: string): DrapeOptions {
  if (spec.startsWith('cling+band:')) return { ...parseMode0(spec.slice('cling+'.length)), cling: true };
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
type HeightSpread = Spread & { y: number; loopRing: string | null; bandImposed: boolean };
const results: { mode: string; options: DrapeOptions; rows: SizeRow[]; hipSpread: Spread; hemSpread: Spread; byHeight: HeightSpread[]; measuredEnds: { from: string; to: string; byHeight: HeightSpread[] } | null; endSources: { from: BandSource; to: BandSource } | null; bandZoneAboveY: number | null; ringsInstalled: string[]; ringsSkipped: string[]; ringsNeverActive: string[] }[] = [];

// The tape's per-size spec when a band file is given: labels every mode's rows (measured / interpolated / extrapolated).
let tapeSpec: WaistbandSpec | null = null;
if (bandFile) { try { tapeSpec = readBandFile(); } catch { tapeSpec = null; } }
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
  // The band rule scales the mesh top to the band's girth on the body and blends back to the cut over BAND_BLEND_CM
  // below the band: a spread measured above that line is set by the rule (clamp(body, relaxed, stretched)), not by the drape.
  let restTop = -Infinity;
  for (let i = 1; i < g0.length; i += 3) restTop = Math.max(restTop, g0[i]!);
  const maxDrop = Math.max(0, ...rows.map((row) => (row.band as { dropCm?: number } | null)?.dropCm ?? 0));
  const bandZoneAboveY = options.waistband ? Math.round((restTop - maxDrop - WAISTBAND_CM - BAND_BLEND_CM) * 10) / 10 : null;
  const heightSpread = (a: SizeRow, z: SizeRow): HeightSpread[] => ys.map((y, i) => ({ y, loopRing: ringAt(y), bandImposed: bandZoneAboveY !== null && y >= bandZoneAboveY, ...spreadOf({ graded: a.graded[i]!, draped: a.draped[i]! }, { graded: z.graded[i]!, draped: z.draped[i]! }) }));
  const byHeight = heightSpread(rows[0]!, rows[rows.length - 1]!);
  // With per-size tape measurements: the spread between the smallest and the largest MEASURED size is the primary result
  // of every mode (so the modes compare on the same pair); the first-to-last spread may rest on an interpolated or
  // extrapolated band.
  const src = (size: string): BandSource | null => (tapeSpec ? bandFor(tapeSpec, bundle.grading, size).source : null);
  const measuredRows = rows.filter((row) => src(row.size) === 'measured');
  const measuredEnds = tapeSpec && measuredRows.length >= 2 ? { from: measuredRows[0]!.size, to: measuredRows[measuredRows.length - 1]!.size, byHeight: heightSpread(measuredRows[0]!, measuredRows[measuredRows.length - 1]!) } : null;
  const endSources = tapeSpec ? { from: src(rows[0]!.size)!, to: src(rows[rows.length - 1]!.size)! } : null;
  const r = { mode, options, rows, hipSpread: spread('hip'), hemSpread: spread('hem'), byHeight, measuredEnds, endSources, bandZoneAboveY, ringsInstalled: installed, ringsSkipped: skipped, ringsNeverActive: neverActive };
  results.push(r);
  const hipRing = ringAt(hipY);
  const hipTag = hipRing ? ` [AT THE ${hipRing.toUpperCase()} LOOP: imposed by the loop, not predicted]` : '';
  console.log(`\n== ${mode}: hip@${hipY.toFixed(1)} graded spread ${r.hipSpread.graded} -> draped ${r.hipSpread.draped} cm (${r.hipSpread.survivesPct} %)${hipTag}; hem@${hemY} graded ${r.hemSpread.graded} -> draped ${r.hemSpread.draped} cm (${r.hemSpread.survivesPct} %)`);
  const fmt = (hs: HeightSpread[]): string => hs.map((b) => `y${b.y} ${b.graded}->${b.draped} (${b.survivesPct}%)${b.loopRing ? `[${b.loopRing} loop]` : ''}${b.bandImposed ? '[IMPOSED: band rule]' : ''}`).join(' | ');
  if (measuredEnds) console.log(`   PRIMARY, measured sizes only: spread by height (AU ${measuredEnds.from}->${measuredEnds.to}, graded -> draped cm): ${fmt(measuredEnds.byHeight)}`);
  const restsOn = endSources && options.waistband && (endSources.from !== 'measured' || endSources.to !== 'measured') ? ` [rests on a band that is ${endSources.from !== 'measured' ? `${endSources.from} (AU ${rows[0]!.size})` : ''}${endSources.from !== 'measured' && endSources.to !== 'measured' ? ' and ' : ''}${endSources.to !== 'measured' ? `${endSources.to} (AU ${rows[rows.length - 1]!.size})` : ''}, not measured]` : '';
  console.log(`   spread by height (AU ${rows[0]!.size}->${rows[rows.length - 1]!.size}, graded -> draped cm)${restsOn}: ${fmt(byHeight)}`);
  if (bandZoneAboveY !== null) console.log(`   band rule: the band's girth on the body is IMPOSED (clamp(body girth at the band's height, relaxed, stretched)), not simulated; the mesh is scaled to it down to y ${bandZoneAboveY}, so spreads at or above that height are set by the rule. Heights below are drape results.`);
  const off = byHeight.filter((b) => !b.loopRing && !b.bandImposed && Number.isFinite(b.survivesPct));
  if (requested.length) console.log(`   loops: requested ${requested.join('+')}; installed ${installed.join('+') || 'none'}${skipped.length ? `; SKIPPED ${skipped.join('+')} (no free cloth particles at that ring, or pinned)` : ''}${neverActive.length ? `; NEVER ACTIVE ${neverActive.join('+')} (the drape never fell to the loop's minimum)` : ''}; off-ring heights: ${off.map((b) => `y${b.y} ${b.survivesPct}%`).join(', ')}`);
  for (const row of rows) {
    console.log(`${row.size}: hip ${row.hip.graded}->${row.hip.draped} hem ${row.hem.graded}->${row.hem.draped} | draped ${row.draped.join(' / ')} | lowest y ${row.hemYDraped}, settled ${row.settledS} s, residual ${row.residualCm} cm/1 s, p99 strain ${row.p99StrainPct} %, ${row.finite ? 'finite' : 'NaN!'}, ${row.solveMs} ms`);
    if (row.band) {
      const b = row.band as Partial<ElasticBand>;
      const margin = b.relaxedCm !== undefined && b.bodyAtBandCm !== undefined ? `; body at the band minus relaxed ${Math.round((b.bodyAtBandCm - b.relaxedCm) * 10) / 10} cm (holds while > -1; IMPOSED by the placement rule, not simulated)` : '';
      console.log(`   band ${JSON.stringify(row.band)}${margin}`);
    }
    if (row.loopState.length) console.log(`   loops ${row.loopState.map((l) => `${l.ring}(${l.particles}p) min ${l.minGirthCm} draped ${l.drapedCm}${l.active ? ' ACTIVE' : ''}`).join('; ')}`);
  }
  writeJson();
}
// The cut check (not a drape result): the graded mesh per size against the tape. The mesh numbers are convex-hull girths
// of the graded (undraped) mesh; the tape numbers are flat widths × 2 (`hipCm` at the shop's hip line, whose distance
// below the band is not on record; `hemSweepCm` the full hem; `lengthCm` band to hem). A size the tape does not hold is
// interpolated or extrapolated by the rule of `bandFor` (a line on the grading step through the two measured sizes
// around it, or the two nearest) and printed with that label, never as measured.
const sensitivity: unknown[] = [];
if (bandSpec && bandEntry) {
  const labels = sizeLabels(session);
  const tape = (key: 'hipCm' | 'hemSweepCm' | 'lengthCm', size: string): { v: number; source: BandSource } | null => {
    const sizes: Record<string, { relaxedCm: number; stretchedCm: number }> = {};
    for (const [l, e] of Object.entries(bandEntry!.sizes ?? {})) if (typeof e[key] === 'number' && labels.includes(l)) sizes[l] = { relaxedCm: e[key], stretchedCm: e[key] };
    if (Object.keys(sizes).length < 2) { const own = sizes[size]; return own ? { v: own.relaxedCm, source: 'measured' } : null; }
    const b = bandFor({ relaxedCm: 0, stretchedCm: 0, sizes, assumed: false }, bundle.grading, size);
    return { v: Math.round(b.relaxedCm * 10) / 10, source: b.source };
  };
  const show = (t: { v: number; source: BandSource } | null): string => (t ? `${t.v} (${t.source})` : 'not given');
  const pct = (mesh: number, t: { v: number } | null): string => (t ? `, mesh/tape ${Math.round((mesh / t.v) * 100)} %` : '');
  console.log(`\n[cut check] graded mesh (hull girths, cm) against the tape; tape values are measured only where they say so`);
  const cut: unknown[] = [];
  for (const size of labels) {
    const g = gradedMesh(session, size);
    let top = -Infinity, bottom = Infinity;
    for (let i = 1; i < g.positions.length; i += 3) { top = Math.max(top, g.positions[i]!); bottom = Math.min(bottom, g.positions[i]!); }
    let widest = 0, at = 0;
    for (let y = Math.ceil(bottom) + 1; y <= bottom + 30; y++) { const v = girth(g.positions, g.indices, y); if (v > widest) { widest = v; at = y; } }
    let hipMax = 0, hipMaxAt = 0;
    for (let d = 10; d <= 30; d++) { const v = girth(g.positions, g.indices, top - d); if (v > hipMax) { hipMax = v; hipMaxAt = d; } }
    const below = [15, 20, 25].map((d) => `${d} cm below the band ${girth(g.positions, g.indices, top - d)}`);
    const hipRing = girth(g.positions, g.indices, hipY), hemLow = girth(g.positions, g.indices, bottom + 1), length = Math.round((top - bottom) * 10) / 10;
    const band = bandFor(bandSpec, bundle.grading, size);
    const tHip = tape('hipCm', size), tHem = tape('hemSweepCm', size), tLen = tape('lengthCm', size);
    cut.push({ size, band, mesh: { hipRingCm: hipRing, hipWidest10to30BelowBandCm: hipMax, hemWidestBottom30Cm: widest, hemLowestCm: hemLow, lengthCm: length, topY: Math.round(top * 10) / 10, bottomY: Math.round(bottom * 10) / 10 }, tape: { hip: tHip, hem: tHem, length: tLen } });
    console.log(`AU ${size}: band relaxed ${Math.round(band.relaxedCm * 10) / 10} / stretched ${Math.round(band.stretchedCm * 10) / 10} (${band.source})`);
    console.log(`   hip: tape ${show(tHip)}; mesh at the hip ring y=${hipY.toFixed(1)} ${hipRing}${pct(hipRing, tHip)}; ${below.join(', ')}; widest 10-30 cm below the band ${hipMax} (${hipMaxAt} cm below)${pct(hipMax, tHip)}`);
    console.log(`   hem: tape ${show(tHem)}; mesh widest in the bottom 30 cm ${widest} (y=${at})${pct(widest, tHem)}; 1 cm above the mesh's lowest point ${hemLow}${pct(hemLow, tHem)}`);
    console.log(`   length: tape ${show(tLen)}; mesh top y=${top.toFixed(1)} to lowest y=${bottom.toFixed(1)}: ${length}${pct(length, tLen)}`);
  }
  // Band-height sensitivity (the placement rule alone, no drape): the band's height comes from the reconstructed mesh,
  // whose length is not the tape's. Lift the placed garment by 0, 2 and 4 cm, and by tape length minus mesh length (the
  // band's height if the hem stayed where the mesh has it), and apply `fitElasticBand` again (to a ring at the band's
  // height: the rule reads nothing else from the cloth).
  console.log(`\n[band-height sensitivity] the placement rule (IMPOSED, not simulated) with the band higher on the M mannequin; "tape length" lifts the band by tape length minus mesh length (hem kept where it is)`);
  for (const size of labels) {
    const g = gradedMesh(session, size);
    let top = -Infinity, bottom = Infinity;
    for (let i = 1; i < g.positions.length; i += 3) { top = Math.max(top, g.positions[i]!); bottom = Math.min(bottom, g.positions[i]!); }
    const tLen = tape('lengthCm', size);
    const band = bandFor(bandSpec, bundle.grading, size);
    const lifts: { label: string; cm: number }[] = [{ label: 'as reconstructed', cm: 0 }, { label: '+2 cm', cm: 2 }, { label: '+4 cm', cm: 4 }, ...(tLen ? [{ label: `tape length (${tLen.source})`, cm: Math.round((tLen.v - (top - bottom)) * 10) / 10 }] : [])];
    const parts: string[] = [];
    for (const lift of lifts) {
      // The rule reads only the height of the band's top from the cloth: a ring of points at that height stands in for it.
      const ring = new Float32Array(3 * 16);
      for (let i = 0; i < 16; i++) { ring[3 * i] = 12 * Math.cos((i * Math.PI) / 8); ring[3 * i + 1] = top + lift.cm; ring[3 * i + 2] = 12 * Math.sin((i * Math.PI) / 8); }
      const e = fitElasticBand(field, ring, new Uint8Array(16), CLEARANCE_CM, band, false);
      const marginCm = Math.round((e.bodyAtBandCm - e.relaxedCm) * 10) / 10;
      sensitivity.push({ size, source: band.source, lift: lift.label, liftCm: lift.cm, bodyAtBandCm: e.bodyAtBandCm, relaxedCm: e.relaxedCm, marginCm, dropCm: e.dropCm, onBodyCm: e.onBodyCm, pastHips: e.pastHips });
      parts.push(`${lift.label}${lift.cm && lift.label.startsWith('tape') ? ` = +${lift.cm} cm` : ''}: body ${e.bodyAtBandCm}, margin ${marginCm >= 0 ? '+' : ''}${marginCm}, ${e.dropCm > 0 ? `SLIDES ${e.dropCm} cm to ${e.onBodyCm}` : `holds at ${e.onBodyCm}`}`);
    }
    console.log(`AU ${size} (band ${band.source}, relaxed ${Math.round(band.relaxedCm * 10) / 10}): ${parts.join(' | ')}`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ productId: bundle.productId, dir, heights: ys, hipY, hemY, torsoAtHip: torsoGirth(hipY), results, cutCheck: cut, bandHeightSensitivity: sensitivity }, null, 1));
}
