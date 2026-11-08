/**
 * Phase 0 evaluation and write-up for the bohohippychic.com.au validation set. Run it after the GPU
 * stages have produced `out/phase0/<handle>/stage4/stage2/garment.glb` (plus the stage 1b and 2
 * records) for any of the five products; products without a mesh are reported as not run.
 *
 *   pnpm --filter @curtain/garment-spike report:bohohippychic [-- --renders] [--no-synthetic]
 *        [--only <handle,…>] [--date YYYY-MM-DD] [--out <path>]
 *
 * Per product with a stage 4 mesh: anchoring + calibration against the AU chart (+ ease), grading to
 * the chart's sizes, view agreement against the stage 1b stills and the shop photo masks, and a
 * bundle in `out/eval/<handle>/` the spike viewer loads as `eval/<handle>`. `--renders` then runs
 * `viewer/render-eval.mjs` (sizes 8/12/16 on the M mannequin at front, three-quarter and side view and the XS and XXL shapes, with and
 * without the fit map, and the blind page with these products pre-selected). The synthetic spike
 * product goes through the same tooling as a dry run (its stage 4 output when present, else its
 * ground-truth garment with the spike's simulated reconstruction error). Finally it writes
 * docs/research/phase0-bohohippychic.md.
 *
 * Everything under out/ is gitignored; shop images are never read here (only the stage 1b masks).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_SHAPE_ID, bodyShape, buildMannequin } from '@curtain/mannequin';
import { mockGarment, type GarmentPayload } from '@curtain/schema';
import { arr, chooseMesh, evaluateProduct, num, obj, readJob, str, type Json, type ProductEval } from '../src/evalJob';
import { decodeAnyPng } from '../src/evalPng';
import { forPanel, parsePrintedTable, REVIEW_VERDICTS, renderReport, type ReviewVerdict, type EarlierRun, type ProductRenders, type ProductSection, type RenderShot, type ShopImage, type ShopProduct, type SyntheticSection } from '../src/evalReport';
import { stackPng } from '../src/evalView';
import { generateGarment } from '../src/garment';
import { garmentSpec } from '../src/product';
import { SHOP_UNCOVERED_CATEGORIES } from '../src/shopSelection';

const here = dirname(fileURLToPath(import.meta.url));
const spikeDir = resolve(here, '..');
const repoRoot = resolve(spikeDir, '..', '..');
const dataDir = join(spikeDir, 'data', 'bohohippychic');
const outDir = join(spikeDir, 'out');
const evalOut = join(outDir, 'eval');
const SYNTHETIC_ID = 'aalter-studio-2';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function option(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

const rel = (p: string): string => relative(repoRoot, p).split('\\').join('/');
const readJsonFile = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;

// ---------------------------------------------------------------------------
// The committed selection
// ---------------------------------------------------------------------------

function shopProducts(): { shop: { domain: string; brand: string; currency: string }; products: ShopProduct[]; images: Record<string, ShopImage[]> } {
  const data = readJsonFile(join(dataDir, 'products.json'));
  const imgs = readJsonFile(join(dataDir, 'images.json'));
  const shop = obj(data.shop);
  const products: ShopProduct[] = arr(data.products).map((x) => {
    const p = obj(x)!;
    const sel = obj(p.selection);
    const three = obj(p.threeD);
    const comp = obj(p.completeness);
    return {
      handle: str(p.handle)!,
      productType: str(p.productType) ?? '',
      // A v1 draft: colour and EUR price are deliberately absent (the selection does not invent them).
      payload: p.payload as GarmentPayload,
      baseSize: str(p.baseSize)!,
      why: str(sel?.why) ?? '',
      runnersUp: arr(sel?.runnersUp).map((r) => ({ handle: str(obj(r)?.handle) ?? '?', whyNot: str(obj(r)?.whyNot) ?? '' })),
      warnings: arr(p.warnings).map(String),
      threeD: { ready: three?.ready === true, reasons: arr(three?.reasons).map(String) },
      completeness: comp ? { score: num(comp.score) ?? 0, status: str(comp.status) ?? '?' } : null,
      printed: parsePrintedTable(str(obj(p.evidence)?.printedTable)),
    };
  });
  const images: Record<string, ShopImage[]> = {};
  for (const [handle, list] of Object.entries(obj(imgs.products) ?? {})) {
    images[handle] = arr(list).map((i) => {
      const o = obj(i)!;
      return {
        position: num(o.position) ?? 0,
        role: str(o.role) ?? '?',
        onModel: o.onModel === true,
        background: str(o.background) ?? '?',
        garmentFullyVisible: o.garmentFullyVisible === true,
        notes: str(o.notes) ?? '',
        width: num(o.width) ?? 0,
        height: num(o.height) ?? 0,
        sha256: str(o.sha256) ?? '',
      };
    });
  }
  return { shop: { domain: str(shop?.domain) ?? 'bohohippychic.com.au', brand: str(shop?.brand) ?? 'Boho Hippy Chic', currency: str(shop?.currency) ?? 'AUD' }, products, images };
}

// ---------------------------------------------------------------------------
// Evaluation and bundle output
// ---------------------------------------------------------------------------

/** The 2DGS (stage 4) bundle of a product whose asset is stage 4t, kept for the before/after renders. */
const ALT_SUFFIX = '-2dgs';

function writeBundle(id: string, ev: ProductEval, images: Map<string, Uint8Array>): string | null {
  if (!ev.bundle) return null;
  const dir = join(evalOut, id);
  // A changed bundle replaces the old one, and the old renders go with it; the same bundle keeps them.
  const qaPath = join(dir, 'qa.json');
  const previous = existsSync(qaPath) ? str((JSON.parse(readFileSync(qaPath, 'utf8')) as Json).inputHash) : null;
  if (previous !== ev.bundle.inputHash) rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'view'), { recursive: true });
  for (const [name, data] of Object.entries(ev.bundle.files)) writeFileSync(join(dir, name), data);
  for (const [name, png] of images) writeFileSync(join(dir, name), png);
  return rel(dir);
}

function run(id: string, payload: GarmentPayload, baseSize: string, jobDir: string, allowSynthetic: boolean, opts: { alternative?: boolean } = {}): { job: ReturnType<typeof readJob>; ev: ProductEval | null; alternative: ProductEval | null; error: string | null; bundleRel: string | null } {
  const job = readJob(jobDir);
  const choice = chooseMesh(job, {
    allowSynthetic,
    ...(allowSynthetic ? { fallbackTruth: () => generateGarment(buildMannequin(bodyShape(BASE_SHAPE_ID)), garmentSpec(payload, baseSize)) } : {}),
  });
  if (!choice) return { job, ev: null, alternative: null, error: job.exists ? 'no stage 4 mesh (stage4/stage2/garment.glb) in the job dir' : 'no job dir', bundleRel: null };
  // The spike's synthetic garment drops its printed length vertically; a shop's printed length is flat-lay.
  const printedLength = allowSynthetic ? 'drop' : 'flat-lay';
  try {
    const images = new Map<string, Uint8Array>();
    const ev = evaluateProduct({ productId: id, payload, baseSize, job, choice, printedLength, writeImage: (name, png) => images.set(name, png) });
    // Stage 4t is the asset when it exists; stage 4 (2DGS) is evaluated alongside for the comparison table only (no bundle, no pictures).
    let alternative: ProductEval | null = null;
    if (choice.kind === 'stage4t' && job.stage4.stage2?.glb && opts.alternative !== false) {
      const alt = chooseMesh(job, { allowSynthetic: false, prefer: 'stage4' });
      if (alt && alt.kind === 'stage4') {
        // Its bundle and turntable pictures go to eval/<id>-2dgs, so --renders can draw the old asset next to the new one.
        const altImages = new Map<string, Uint8Array>();
        alternative = evaluateProduct({ productId: id, payload, baseSize, job, choice: alt, printedLength, writeImage: (name, png) => altImages.set(name, png) });
        writeBundle(`${id}${ALT_SUFFIX}`, alternative, altImages);
      }
    }
    const bundleRel = writeBundle(id, ev, images);
    const r = ev.result;
    console.log(
      `[report] ${id}: ${r.source.kind}, chart agreement ${r.agreement.pass ? 'pass' : 'FAIL'} (before ${r.before.maxAbsCm ?? '—'} cm, after global ${r.afterGlobal.maxAbsCm ?? '—'} cm, after calibration ${Number.isFinite(r.agreement.maxAbsCm) ? r.agreement.maxAbsCm.toFixed(2) : '—'} cm), ` +
        `view ${ev.view.views.map((v) => `${v.view} ${v.iou.toFixed(3)}`).join(', ') || '—'}, ${r.health.triangles} triangles, bundle ${ev.bundle ? `${(ev.bundle.bytes / 1024).toFixed(0)} KB` : 'not written'}`,
    );
    for (const w of r.warnings) console.log(`[report] ${id}: warning: ${w}`);
    return { job, ev, alternative, error: null, bundleRel };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[report] ${id}: evaluation failed: ${error}`);
    return { job, ev: null, alternative: null, error: `evaluation failed: ${error}`, bundleRel: null };
  }
}

// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------

interface RendersFile {
  products: Record<string, { inputHash: string | null; shots: RenderShot[]; problems: string[] }>;
  blindShots: string[];
  problems: string[];
}

function readRenders(): RendersFile | null {
  const p = join(evalOut, 'renders.json');
  if (!existsSync(p)) return null;
  const j = readJsonFile(p);
  const products: RendersFile['products'] = {};
  for (const [id, v] of Object.entries(obj(j.products) ?? {})) {
    const o = obj(v)!;
    products[id] = {
      inputHash: str(o.inputHash),
      shots: arr(o.shots).map((s) => {
        const so = obj(s)!;
        return { file: str(so.file) ?? '', shape: (str(so.shape) ?? 'M') as RenderShot['shape'], view: (str(so.view) ?? 'front') as NonNullable<RenderShot['view']>, fitMap: so.fitMap === true, sizes: arr(so.sizes).map(String), settleMs: arr(so.settleMs).map((x) => num(x) ?? 0) };
      }),
      problems: arr(o.problems).map(String),
    };
  }
  return { products, blindShots: arr(j.blindShots).map(String), problems: arr(j.problems).map(String) };
}

/** Renders of a product, only when they were made from the bundle that exists now. */
function rendersFor(r: RendersFile | null, id: string, ev: ProductEval | null): ProductRenders | null {
  const e = r?.products[`eval/${id}`];
  if (!e || !ev?.bundle || e.inputHash !== ev.bundle.inputHash) return null;
  // Rewriting a bundle deletes its renders: link only files that are still there.
  const shots = e.shots.filter((x) => existsSync(join(repoRoot, x.file)));
  return shots.length ? { shots, problems: e.problems } : null;
}

// ---------------------------------------------------------------------------

const only = option('only')?.split(',').map((s) => s.trim()) ?? null;
const date = option('date') ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`--date must be YYYY-MM-DD, got ${date}`);
const reportPath = resolve(repoRoot, option('out') ?? 'docs/research/phase0-bohohippychic.md');

/**
 * Earlier GPU runs of a product kept beside its current job: `out/phase0/<handle>-run<N>/` (e.g. run 14's babydoll after
 * run 15 replaced `out/phase0/<handle>/`). Evaluated like the current job (no 2DGS alternative), bundled as eval/<dir>.
 */
function earlierDirs(handle: string): { dir: string; label: string; n: number }[] {
  const root = join(outDir, 'phase0');
  if (!existsSync(root)) return [];
  const re = new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-run(\\d+)$`);
  return readdirSync(root)
    .map((d) => ({ d, m: re.exec(d) }))
    .filter((x) => x.m && statSync(join(root, x.d)).isDirectory())
    .map((x) => ({ dir: x.d, label: `run ${Number(x.m![1])}`, n: Number(x.m![1]) }))
    .sort((a, b) => a.n - b.n);
}

/** The reviewer's verdict per product on its current run (data/<shop>/review.json, hand-written). */
function reviews(): Record<string, ProductSection['review']> {
  const p = join(dataDir, 'review.json');
  if (!existsSync(p)) return {};
  const out: Record<string, ProductSection['review']> = {};
  for (const [h, v] of Object.entries(obj(readJsonFile(p).products) ?? {})) {
    const o = obj(v);
    const verdict = str(o?.verdict);
    if (!REVIEW_VERDICTS.includes(verdict as ReviewVerdict)) throw new Error(`review.json: ${h} has verdict ${JSON.stringify(verdict)}; expected ${REVIEW_VERDICTS.join(', ')}`);
    out[h] = { run: num(o?.run), verdict: verdict as ReviewVerdict, why: str(o?.why) ?? '' };
  }
  return out;
}

type Earlier = Omit<EarlierRun, 'renders' | 'comparisons'> & { id: string };
const review = reviews();
const { shop, products, images } = shopProducts();
const sections: (Omit<ProductSection, 'renders' | 'earlier'> & { id: string; earlierRuns: Earlier[] })[] = [];
for (const p of products) {
  if (only && !only.includes(p.handle)) continue;
  const jobDir = join(outDir, 'phase0', p.handle);
  const r = run(p.handle, p.payload, p.baseSize, jobDir, false);
  if (!r.ev) console.log(`[report] ${p.handle}: ${r.error}`);
  const earlierRuns: Earlier[] = earlierDirs(p.handle).map((e) => {
    const d = join(outDir, 'phase0', e.dir);
    const er = run(e.dir, p.payload, p.baseSize, d, false, { alternative: false });
    if (!er.ev) console.log(`[report] ${e.dir}: ${er.error}`);
    return { id: e.dir, label: e.label, jobRel: rel(d), job: er.job, eval: er.ev, evalError: er.error, bundleRel: er.bundleRel };
  });
  sections.push({ id: p.handle, shop: p, images: images[p.handle] ?? [], job: r.job, jobRel: rel(jobDir), eval: r.ev, evalError: r.error, bundleRel: r.bundleRel, alternative: r.alternative, earlierRuns, review: review[p.handle] ?? null });
}

let synthetic: (Omit<SyntheticSection, 'renders'> & { ev: ProductEval | null }) | null = null;
if (!flag('no-synthetic')) {
  const r = run(SYNTHETIC_ID, mockGarment(SYNTHETIC_ID), 'M', join(outDir, 'phase0', SYNTHETIC_ID), true);
  synthetic = { productId: SYNTHETIC_ID, eval: r.ev, ev: r.ev, evalError: r.error, bundleRel: r.bundleRel };
}

// A product whose current run the reviewer rejected is evaluated (its numbers show the failure) but not rendered or blind-tested;
// a faulty one is rendered too (so the fault can be seen) but kept off the blind page and out of the panel bundles.
const usable = sections.filter((s) => s.review?.verdict !== 'rejected');
const panel = sections.filter(forPanel);
if (flag('renders')) {
  const ids = [
    ...usable.filter((s) => s.eval?.bundle).map((s) => `eval/${s.id}`),
    ...usable.flatMap((s) => s.earlierRuns.filter((e) => e.eval?.bundle).map((e) => `eval/${e.id}`)),
    ...usable.filter((s) => s.alternative?.bundle && existsSync(join(evalOut, `${s.id}${ALT_SUFFIX}`, 'grading.json'))).map((s) => `eval/${s.id}${ALT_SUFFIX}`),
    ...(synthetic?.ev?.bundle ? [`eval/${SYNTHETIC_ID}`] : []),
  ];
  if (ids.length === 0) console.log('[report] --renders: no bundle to render');
  else {
    const earlierIds = new Set(sections.flatMap((s) => s.earlierRuns.map((e) => `eval/${e.id}`)));
    const panelIds = new Set(panel.map((s) => `eval/${s.id}`));
    const shopIds = ids.filter((id) => panelIds.has(id) && !earlierIds.has(id));
    const blind = shopIds.length ? ['--blind', shopIds.join(',')] : ['--no-blind'];
    const res = spawnSync(process.execPath, [join(spikeDir, 'viewer', 'render-eval.mjs'), ...ids, ...blind], { stdio: 'inherit', cwd: spikeDir });
    if (res.status !== 0) console.error(`[report] render-eval exited with ${res.status}; its problems are listed in the report`);
  }
}

// ---------------------------------------------------------------------------
// Earlier run against the current job: the same pictures stacked (earlier on top), same camera, so hem heights compare.
// ---------------------------------------------------------------------------

const PAIRS: { from: (r: RendersFile | null, id: string) => string | null; name: string; caption: string }[] = [
  { name: 'turntable-0', caption: 'stage 2 frame | mesh | overlay at 0°, the earlier run on top', from: (_r, id) => join(evalOut, id, 'view', 'turntable_0.png') },
  { name: 'turntable-90', caption: 'the same at 90°', from: (_r, id) => join(evalOut, id, 'view', 'turntable_90.png') },
  { name: 'viewer-M-front', caption: 'viewer, AU 8 / 12 / 16 on the M mannequin, front, the earlier run on top', from: (r, id) => shotFile(r, id, 'front') },
  { name: 'viewer-M-side', caption: 'the same from the side', from: (r, id) => shotFile(r, id, 'side') },
];

function shotFile(r: RendersFile | null, id: string, view: string): string | null {
  const s = r?.products[`eval/${id}`]?.shots.find((x) => x.shape === 'M' && (x.view ?? 'front') === view && !x.fitMap);
  return s ? join(repoRoot, s.file) : null;
}

function comparisons(r: RendersFile | null, current: string, earlier: Earlier): EarlierRun['comparisons'] {
  const out: EarlierRun['comparisons'] = [];
  const dir = join(evalOut, current, 'compare');
  for (const pair of PAIRS) {
    const a = pair.from(r, earlier.id), b = pair.from(r, current);
    if (!a || !b || !existsSync(a) || !existsSync(b)) continue;
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${earlier.id.slice(current.length + 1)}-vs-current-${pair.name}.png`);
    writeFileSync(file, stackPng([decodeAnyPng(new Uint8Array(readFileSync(a))), decodeAnyPng(new Uint8Array(readFileSync(b)))]));
    out.push({ file: rel(file), caption: pair.caption });
  }
  return out;
}

const writtenPath = join(dataDir, 'phase0-written.md');
const written = existsSync(writtenPath) ? readFileSync(writtenPath, 'utf8') : null;
// One hand-written sentence when the current assets are not fit for the five-person panel; delete the file once they are.
const panelHoldPath = join(dataDir, 'panel-hold.txt');
const panelHold = existsSync(panelHoldPath) ? readFileSync(panelHoldPath, 'utf8').trim() || null : null;
const renders = readRenders();
const shopIds = panel.filter((s) => s.eval?.bundle).map((s) => `eval/${s.id}`);
const blindIds = shopIds.length ? shopIds : panel.map((s) => `eval/${s.id}`);
const markdown = renderReport({
  date,
  shop,
  products: sections.map(({ id, earlierRuns, ...s }) => ({
    ...s,
    renders: rendersFor(renders, id, s.eval),
    earlier: earlierRuns.map(({ id: eid, ...e }) => ({ ...e, renders: rendersFor(renders, eid, e.eval), comparisons: s.eval?.bundle && e.eval?.bundle ? comparisons(renders, id, { id: eid, ...e }) : [] })),
  })),
  synthetic: synthetic ? { productId: synthetic.productId, eval: synthetic.eval, evalError: synthetic.evalError, bundleRel: synthetic.bundleRel, renders: rendersFor(renders, SYNTHETIC_ID, synthetic.ev) } : null,
  blindUrl: `http://127.0.0.1:5178/blind.html?products=${blindIds.join(',')}`,
  blindShot: renders && shopIds.length && renders.blindShots.length ? renders.blindShots[renders.blindShots.length - 1]! : null,
  toRoot: relative(dirname(reportPath), repoRoot).split('\\').join('/') || '.',
  uncoveredCategories: SHOP_UNCOVERED_CATEGORIES,
  written,
  writtenSource: written ? rel(writtenPath) : null,
  panelHold: panelHold ? `${panelHold} (\`${rel(panelHoldPath)}\`)` : null,
});
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, markdown);
console.log(`[report] wrote ${rel(reportPath)} (${sections.filter((s) => s.eval).length} of ${sections.length} shop products evaluated${synthetic ? `, synthetic dry run ${synthetic.ev ? 'done' : 'failed'}` : ''})`);
