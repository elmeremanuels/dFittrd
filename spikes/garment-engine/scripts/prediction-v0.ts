/**
 * V0 of the drape prediction engine (docs/PREDICTION-ENGINE.md §7, gate G1), CPU only:
 *
 *   pnpm --filter @curtain/garment-spike prediction:v0 -- <job dir> [<job dir> …] [--out out/prediction-v0/results.json]
 *
 * Can two views (frames 0 and N/2: the pinned front and back stills, like a shop's photos) plus the P0
 * prediction reconstruct a garment almost as well as stage 4t on the full turntable? Per job, from the
 * same masks and cameras:
 *
 * - `P0 alone`: the template itself, no frames. The base template is, on a synthetic job, the true-spec
 *   template (V0 (a)): `buildProxy` given the truth's own length (lofted dresses and tops), and for a
 *   skirt, trousers or cardigan the very proxy the truth is cut from; on a GPU job (run 14) the rule P0
 *   (`buildProxy` with the rules of proxy.ts: FLARE_RULES, LEG_RULES, PROXY_DEFAULT_EASE, hemFor,
 *   sleeveFor). Synthetic dresses and tops also get the rule P0 (printed length, no truth) as a row;
 * - `two-view`: stage 4t from frames 0 and N/2 only with the template's depth (`depthPrior:
 *   'template'`), from (a) the base template, the rule P0, (b) the two `PERTURBATIONS` of the base (a
 *   wrong prediction: ±8 % width and depth, hem ±8 cm, sleeves), the two `DEPTH_PERTURBATIONS` (depth
 *   ±15 % alone: what two views cannot see), (c) another product's proxy; plus the base with the hull's
 *   depth (`depthPrior: 'hull'`), the turntable fit run unchanged on two views, to show why the option
 *   exists;
 * - `full`: stage 4t from the 128 training frames of the turntable, from the base template.
 *
 * Reference: `synthetic/garment_truth.glb` for synthetic jobs (`--source synthetic`, chosen when the job
 * has no stage 2 frames); for a GPU job (run 14) the full stage 4t fit computed here (the GPU frames
 * have no truth). Metrics per mesh: Chamfer and F-score at 1 cm (`chamfer.ts`, 50k samples), hem
 * height (front and back for tops and dresses, centre front and side seam for bottoms: `garmentLength`),
 * length (HPS surface; skirt waist to hem; trousers outseam), cuff (sleeve end along the arm,
 * `measureGarment`), share of vertices inside the mannequin (analytic, 3 mm: `clothInsideBody`) and
 * holdout silhouette IoU (frame index mod 5 = 2). Writes JSON to `--out` (default
 * out/prediction-v0/results.json, gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { BASE_SHAPE_ID, bodyShape, buildMannequin, type Mesh } from '@curtain/mannequin';
import { mockGarment, type GarmentPayload } from '@curtain/schema';
import { measureGarment } from '../src/anchoring';
import { buildBodySdf, type BodySdf } from '../src/bodySdf';
import { chamfer, regionChamfer } from '../src/chamfer';
import { clothInsideBody } from '../src/eval';
import { readGarmentGlb, weldVertices } from '../src/evalMesh';
import { maskIou } from '../src/evalPng';
import { parseFeatures } from '../src/features';
import { assignChains } from '../src/garment';
import { bottomLengths, garmentLengths } from '../src/garmentLength';
import { garmentSpec } from '../src/product';
import { buildProxy, type ProxyOptions } from '../src/proxy';
import { loadJobViews, stage4tSplit, type JobViews, type Stage4tSource } from '../src/stage4t';
import { fitTemplate, type TemplateFitOptions } from '../src/templateFit';
import { DEPTH_PERTURBATIONS, GARMENT_REGIONS, garmentRegion, PERTURBATIONS, perturbTemplate } from '../src/templatePerturb';
import { idMask, rasterize } from '../src/views';

const args = process.argv.slice(2).filter((a) => a !== '--');
const oAt = args.indexOf('--out');
const outPath = resolve(oAt >= 0 ? args[oAt + 1]! : 'out/prediction-v0/results.json');
const dirs = args.filter((a, i) => !a.startsWith('--') && (oAt < 0 || i !== oAt + 1));
if (!dirs.length) throw new Error('usage: prediction:v0 <job dir> [<job dir> …] [--out <file>]');

const SAMPLES = 50000;
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const region = garmentRegion(m);
/** Another product's proxy per proxy kind: a template that is not the garment at all. */
const OTHER: Record<string, string> = { dress: 'linde-dress-01', top: 'noord-top-01', outerwear: 'ostend-01', skirt: 'rue-marais-bottom-01', trousers: 'raw-denim-01' };

const glb = (p: string): Mesh => weldVertices(readGarmentGlb(new Uint8Array(readFileSync(p))).mesh);
const r2 = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const midSize = (p: GarmentPayload): string => {
  const chart = p.sizeChart as unknown;
  const keys = Array.isArray(chart) ? chart.map((r) => String((r as { size?: string }).size)) : Object.keys(chart as object);
  return keys[Math.floor((keys.length - 1) / 2)]!;
};

interface Shape {
  /** Length per the garment type's definition (cm) and the hem heights it is measured to (y, cm). */
  lengthCm: number | null;
  hemY: (number | null)[];
  cuffCm: number | null;
}

function shapeOf(mesh: Mesh, kind: string): Shape {
  if (kind === 'skirt' || kind === 'trousers') {
    const L = bottomLengths(m, mesh, kind === 'trousers');
    const get = (d: string) => L.find((l) => l.definition === d);
    const len = kind === 'trousers' ? get('outseam_side') : get('waist_to_hem_front');
    return { lengthCm: len?.lengthCm ?? null, hemY: kind === 'trousers' ? [get('outseam_side')?.hemY ?? null, get('inseam_inner')?.hemY ?? null] : [get('waist_to_hem_front')?.hemY ?? null, get('outseam_side')?.hemY ?? null], cuffCm: null };
  }
  const L = garmentLengths(m, mesh);
  const get = (d: string) => L.find((l) => l.definition === d);
  const meas = measureGarment(m, mesh, kind === 'dress' ? 'dress' : 'top', assignChains(m, mesh));
  return { lengthCm: get('hps_surface')?.lengthCm ?? null, hemY: [get('hps_drop')?.hemY ?? null, get('back_neck_surface')?.hemY ?? null], cuffCm: meas.lengths.sleeve?.lengthCm ?? null };
}

function holdoutSilhouette(mesh: Mesh, views: JobViews, holdout: readonly number[]): number {
  let s = 0;
  for (const v of holdout) {
    const r = rasterize(views.cameras[v]!, [{ positions: mesh.positions, indices: mesh.indices, id: 2 }]);
    s += maskIou(idMask(r, 2), views.masks[v]!).iou;
  }
  return Math.round((s / holdout.length) * 10000) / 10000;
}

interface Row {
  route: 'P0 alone' | 'two-view' | 'two-view, hull depth' | 'full stage 4t';
  template: string;
  chamferCm: number;
  fscore1cm: number;
  regions: Record<string, number | null>;
  hemErrCm: number | null;
  hemErrMaxCm: number | null;
  lengthErrCm: number | null;
  cuffErrCm: number | null;
  insideShare: number;
  sdfInsideShare: number;
  holdoutSilhouetteIou: number;
  lengthCm: number | null;
  cuffCm: number | null;
  seconds: number;
}

function score(route: Row['route'], template: string, mesh: Mesh, ref: Mesh, refShape: Shape, kind: string, views: JobViews, holdout: readonly number[], sdf: BodySdf, seconds: number): Row {
  // Coarse grid for the nearest-neighbour search: exact either way, and fast when a fit lies far off (two views with the hull's depth).
  const c = chamfer(mesh, ref, SAMPLES, 0, 4);
  const rc = regionChamfer(mesh, ref, GARMENT_REGIONS, region, SAMPLES, 0, 4);
  const sh = shapeOf(mesh, kind);
  const hemErr = sh.hemY.map((y, k) => (y !== null && refShape.hemY[k] !== null && refShape.hemY[k] !== undefined ? y - refShape.hemY[k]! : null)).filter((x): x is number => x !== null);
  let inside = 0;
  const nv = mesh.positions.length / 3;
  for (let i = 0; i < nv; i++) if (sdf.at(mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!) < 0) inside++;
  return {
    route,
    template,
    chamferCm: c.chamferCmMean,
    fscore1cm: c.fscore1cm,
    regions: Object.fromEntries(rc.map((x) => [x.region, x.chamferCmMean])),
    hemErrCm: hemErr.length ? r2(hemErr.reduce((a, b) => a + Math.abs(b), 0) / hemErr.length) : null,
    hemErrMaxCm: hemErr.length ? r2(Math.max(...hemErr.map(Math.abs))) : null,
    lengthErrCm: sh.lengthCm !== null && refShape.lengthCm !== null ? r2(sh.lengthCm - refShape.lengthCm) : null,
    cuffErrCm: sh.cuffCm !== null && refShape.cuffCm !== null ? r2(sh.cuffCm - refShape.cuffCm) : null,
    insideShare: clothInsideBody(m, mesh).share,
    sdfInsideShare: Math.round((inside / nv) * 10000) / 10000,
    holdoutSilhouetteIou: holdoutSilhouette(mesh, views, holdout),
    lengthCm: sh.lengthCm,
    cuffCm: sh.cuffCm,
    seconds: Math.round(seconds * 10) / 10,
  };
}

const results: unknown[] = [];
for (const d of dirs) {
  const jobDir = resolve(d);
  const manifest = JSON.parse(readFileSync(join(jobDir, 'manifest.json'), 'utf8')) as {
    product_id: string;
    category: string;
    base_size: string;
    features?: unknown;
    control?: { proxy?: { kind?: string } | null };
    hash_inputs?: { product?: GarmentPayload };
  };
  const source: Stage4tSource = existsSync(join(jobDir, 'stage2/garment_mask')) ? 'stage2' : 'synthetic';
  const kind = manifest.control?.proxy?.kind ?? manifest.category;
  const category = manifest.category as TemplateFitOptions['category'];
  const payload = manifest.hash_inputs?.product ?? mockGarment(manifest.product_id);
  const features = parseFeatures(manifest.features);
  const proxyOpts: ProxyOptions = features ? { features } : {};
  // The rule template (P0 as production would build it: hem from the printed length or hemFor, no truth).
  const ruleP0 = buildProxy(m, payload, manifest.base_size, proxyOpts).mesh;
  // On synthetic jobs the base template is the true-spec template (V0 (a)), as the exporter builds the
  // control: a lofted synthetic dress or top is given the truth's own length as a vertical drop; a skirt,
  // trousers or cardigan's truth IS this proxy, opened (`syntheticGarmentFromProxy`). On a GPU job the
  // base is the rule P0.
  const lofted = source === 'synthetic' && (payload.category === 'dress' || payload.category === 'top');
  const p0 = lofted ? buildProxy(m, payload, manifest.base_size, { ...proxyOpts, shoulderToHemCm: garmentSpec(payload, manifest.base_size).shoulderToHemCm }).mesh : ruleP0;
  const base = source === 'synthetic' ? 'true-spec template (V0 a)' : 'P0';
  const exported = existsSync(join(jobDir, 'control/proxy.glb')) ? glb(join(jobDir, 'control/proxy.glb')) : null;
  const p0Note = exported ? (weldVertices(p0).positions.length === exported.positions.length ? 'same vertex count as control/proxy.glb' : `control/proxy.glb has ${exported.positions.length / 3} welded vertices, today's P0 ${weldVertices(p0).positions.length / 3} (an older proxy version exported the job)`) : 'no control/proxy.glb';
  const views = loadJobViews(jobDir, source);
  const n = views.cameras.length;
  const full = stage4tSplit(n);
  const two = stage4tSplit(n, [0, n / 2]);
  const body = glb(join(jobDir, 'mannequin.glb'));
  const sdf = buildBodySdf(body);
  const fitViews = (split: { train: number[]; holdout: number[] }) => ({ cameras: views.cameras, masks: views.masks, train: split.train, holdout: split.holdout, frames: views.frames, ...(views.control ? { control: views.control } : {}) });
  const fit = (template: Mesh, split: { train: number[]; holdout: number[] }, depthPrior: 'hull' | 'template'): { mesh: Mesh; seconds: number; twoView: unknown } => {
    const t0 = performance.now();
    const r = fitTemplate({ mannequin: m, body, sdf, proxy: template, views: fitViews(split), options: { category, legs: kind === 'trousers', depthPrior } });
    return { mesh: r.mesh, seconds: (performance.now() - t0) / 1000, twoView: r.report.twoView };
  };
  console.log(`[v0] ${manifest.product_id} (${kind}, ${source}): P0 ${p0Note}`);
  const fullFit = fit(p0, full, 'hull');
  const truthPath = join(jobDir, 'synthetic/garment_truth.glb');
  const ref = source === 'synthetic' && existsSync(truthPath) ? glb(truthPath) : fullFit.mesh;
  const refLabel = ref === fullFit.mesh ? 'full stage 4t fit (128 frames, from P0), computed here' : 'synthetic/garment_truth.glb';
  const refShape = shapeOf(ref, kind);
  const rows: Row[] = [];
  const push = (row: Row): void => {
    rows.push(row);
    console.log(`[v0]   ${row.route.padEnd(20)} ${row.template.padEnd(34)} Chamfer ${row.chamferCm.toFixed(3)} F1 ${row.fscore1cm.toFixed(3)} hem ${row.hemErrCm} length ${row.lengthErrCm} cuff ${row.cuffErrCm} inside ${row.insideShare} IoU ${row.holdoutSilhouetteIou} (${row.seconds} s)`);
  };
  push(score('full stage 4t', base, fullFit.mesh, ref, refShape, kind, views, full.holdout, sdf, fullFit.seconds));
  const other = OTHER[kind];
  const otherPayload = other ? mockGarment(other) : null;
  const short = base === 'P0' ? 'P0' : 'true-spec';
  const templates: { label: string; mesh: Mesh }[] = [
    { label: base, mesh: p0 },
    ...(lofted ? [{ label: 'rule P0 (printed length, no truth)', mesh: ruleP0 }] : []),
    ...PERTURBATIONS.map((p, k) => ({ label: k === 0 ? `${short} wider +8 %, hem 8 cm up` : `${short} narrower −6 %, hem 8 cm down`, mesh: perturbTemplate(m, p0, p) })),
    ...DEPTH_PERTURBATIONS.map((p, k) => ({ label: k === 0 ? `${short} depth +15 % only` : `${short} depth −15 % only`, mesh: perturbTemplate(m, p0, p) })),
    ...(otherPayload ? [{ label: `other product ${other}`, mesh: buildProxy(m, otherPayload, midSize(otherPayload)).mesh }] : []),
  ];
  const twoViewReports: Record<string, unknown> = {};
  for (const t of templates) {
    push(score('P0 alone', t.label, weldVertices(t.mesh), ref, refShape, kind, views, two.holdout, sdf, 0));
    const f = fit(t.mesh, two, 'template');
    twoViewReports[t.label] = f.twoView;
    push(score('two-view', t.label, f.mesh, ref, refShape, kind, views, two.holdout, sdf, f.seconds));
    if (t.label === base) {
      const h = fit(t.mesh, two, 'hull');
      push(score('two-view, hull depth', t.label, h.mesh, ref, refShape, kind, views, two.holdout, sdf, h.seconds));
    }
  }
  results.push({ productId: manifest.product_id, job: basename(jobDir), kind, category, source, reference: refLabel, base, p0: p0Note, refShape, split: { full: { train: full.train.length, holdout: full.holdout.length }, twoView: { train: two.train, holdout: two.holdout.length } }, rows, twoViewReports });
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({ format: 'curtain.prediction.v0', formatVersion: 1, samples: SAMPLES, g1V0ChamferCm: 2, results }, null, 2)}\n`);
console.log(`[v0] wrote ${outPath}`);
