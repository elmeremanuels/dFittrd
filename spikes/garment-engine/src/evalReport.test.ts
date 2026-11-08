import { readFileSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { chooseMesh, evaluateProduct, readJob, type JobFiles, type ProductEval } from './evalJob';
import { reconstructedDress, shopPayloads, syntheticDress, writeFakeJob } from './evalFixtures';
import { SHOP_UNCOVERED_CATEGORIES } from './shopSelection';
import { costTotal, forPanel, parsePrintedTable, plannedPhotos, renderReport, stageStatuses, usedInputs, verdicts, type ProductSection, type ReportInput, type ShopImage, type ShopProduct } from './evalReport';

const images = (JSON.parse(readFileSync(new URL('../data/bohohippychic/images.json', import.meta.url), 'utf8')) as { products: Record<string, ShopImage[]> }).products;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const shop = (handle: string, payload: ShopProduct['payload'], baseSize: string): ShopProduct => ({
  handle,
  productType: 'Dresses',
  payload,
  baseSize,
  why: 'fixture reason',
  runnersUp: [],
  warnings: ['fixture warning'],
  threeD: { ready: false, reasons: ['front photo worn by a model'] },
  completeness: { score: 0.5, status: 'incomplete' },
});

function section(handle: string, job: JobFiles, ev: ProductEval | null): ProductSection {
  const p = shopPayloads().find((x) => x.handle === handle)!;
  return { shop: shop(handle, p.payload, p.baseSize), images: images[handle]!, job, jobRel: `out/phase0/${handle}`, eval: ev, evalError: ev ? null : 'no job dir', bundleRel: ev ? `out/eval/${handle}` : null, renders: null };
}

const input = (products: ProductSection[]): ReportInput => ({ date: '2026-11-06', shop: { domain: 'bohohippychic.com.au', brand: 'Boho Hippy Chic', currency: 'AUD' }, products, synthetic: null, blindUrl: 'http://127.0.0.1:5178/blind.html?products=eval/x', blindShot: null, toRoot: '../..' });
const missing = (h: string) => section(h, readJob(`/nonexistent/${h}`), null);

describe('report with nothing run', () => {
  const md = renderReport(input(shopPayloads().map((p) => missing(p.handle))));

  it('says "not run" and invents no number', () => {
    expect(md).toMatch(/\| `azure-palm-baby-doll-dress` \| dress \| real \(planned\) \| not run \| not run \| not run \| not measured \| — \| — \|/);
    expect(md).not.toMatch(/\$\d/);
    expect(md).toMatch(/No GPU run on these products yet/);
    expect(md).toMatch(/does not know the shop products yet/);
  });

  it('gives a verdict per acceptance item and leaves the people tests to people', () => {
    const v = verdicts(input(shopPayloads().map((p) => missing(p.handle))));
    expect(v.map((x) => x.item)).toEqual(['Size test', 'Fabric test', 'Chart agreement', 'View agreement', 'Cost', 'Write-up']);
    expect(v.find((x) => x.item === 'Size test')!.state).toBe('needs people');
    expect(v.find((x) => x.item === 'Chart agreement')!.state).toBe('not yet measurable');
  });

  it('names a clothing category without a validation product as a deviation, not as the brief', () => {
    const withGap = renderReport({ ...input(shopPayloads().map((p) => missing(p.handle))), uncoveredCategories: SHOP_UNCOVERED_CATEGORIES });
    expect(withGap).toMatch(/\*\*Not covered: Jumpsuits & Sets\.\*\* The request was one product from each clothing category/);
    expect(withGap).toMatch(/founder decides/);
    expect(withGap).not.toMatch(/brief/);
    expect(md).not.toMatch(/Not covered/);
  });

  it('is deterministic', () => {
    expect(renderReport(input(shopPayloads().map((p) => missing(p.handle))))).toBe(md);
  });

  it('plans the first fully visible front and the back photo', () => {
    const plan = plannedPhotos(images['rosewater-palazzo-pants']!);
    expect(plan.front?.position).toBe(2); // photo 1 hides part of the garment
    expect(plan.back?.position).toBe(4);
  });
});

describe('report with a GPU run', () => {
  const dir = writeFakeJob({ recon: reconstructedDress(), pinned: syntheticDress(), inventedBack: true, withCostSummary: true });
  dirs.push(dir);
  const job = readJob(dir);
  const p = shopPayloads()[0]!;
  const ev = evaluateProduct({ productId: p.handle, payload: p.payload, baseSize: p.baseSize, job, choice: chooseMesh(job, { allowSynthetic: false })! });
  const sec = section(p.handle, job, ev);
  const md = renderReport(input([sec, ...shopPayloads().slice(1).map((x) => missing(x.handle))]));

  it('shows the per-anchor table, view agreement, mesh health and costs as estimates', () => {
    expect(md).toMatch(/\| chest \| yes \| 102\.00 \| \+7\.00 \|/);
    expect(md).toMatch(/\| front \| stage1b `stage1b\/garment_mask_front\.png` \|/);
    expect(md).toMatch(/Against the shop photo \(indicative only/);
    expect(md).toMatch(/\*\*Mesh health\*\*/);
    expect(md).toMatch(/\*\*estimates\*\*/);
    expect(md).toMatch(/Total: 350 s GPU, 400 s wall, \$0\.03–\$0\.06 \(estimate\)/);
  });

  it('flags the invented back everywhere it matters', () => {
    expect(usedInputs(job, images[p.handle]!).inventedBack).toBe(true);
    expect(md).toMatch(/invented back: \*\*YES\*\*/);
    expect(md).toMatch(/\| INVENTED \|/);
    expect(md).toMatch(/\| back \| stage1b `stage1b\/garment_mask_back\.png` \| [0-9.]+ \| [0-9.]+ \| (pass|FAIL) \| YES \|/);
  });

  it('lists every stage with its state', () => {
    const st = stageStatuses(sec, job);
    expect(st.map((s) => s.stage)).toEqual(['1 ingest and validate', 'job export', '1b dress the mannequin', '2 image to video', '3 separation', '4 reconstruction', '5 anchoring and calibration', '6 grading', '7 QA (chart, view, mesh)', '8 bundle']);
    expect(st.find((s) => s.stage === '3 separation')!.state).toBe('not built');
    expect(st.find((s) => s.stage === '4 reconstruction')!.state).toBe('done');
    expect(costTotal(job).gpuSeconds).toBe(350);
  });

  it('calls chart agreement met only with at least 4 of 5 products evaluated and passing', () => {
    expect(verdicts(input([sec, ...shopPayloads().slice(1).map((x) => missing(x.handle))])).find((v) => v.item === 'Chart agreement')!.state).toBe('not yet measurable');
    expect(verdicts(input([sec, sec, sec, sec, sec])).find((v) => v.item === 'Chart agreement')!.state).toBe('met');
  });

  it('agrees with a hand-written hold: final chart residual, partly measured cost, no panel yet', () => {
    const v = verdicts({ ...input([sec, ...shopPayloads().slice(1).map((x) => missing(x.handle))]), panelHold: 'the renders are not ready.' });
    const chart = v.find((x) => x.item === 'Chart agreement')!.text;
    expect(chart).toMatch(/after calibration/);
    expect(chart).toMatch(/before calibration/);
    expect(v.find((x) => x.item === 'Cost')!.state).toBe('measured, partly');
    expect(v.find((x) => x.item === 'Cost')!.text).toMatch(/ s wall/);
    for (const item of ['Size test', 'Fabric test']) expect(v.find((x) => x.item === item)!.text).toMatch(/Do not run the panel on these assets yet:\*\* the renders are not ready\./);
    expect(verdicts(input([sec, ...shopPayloads().slice(1).map((x) => missing(x.handle))])).find((x) => x.item === 'Size test')!.text).not.toMatch(/Do not run/);
  });
});

describe('report with stage 2 garment masks, a printed table and a written section', () => {
  const dir = writeFakeJob({ recon: reconstructedDress(), pinned: syntheticDress(), withStage2Masks: true });
  dirs.push(dir);
  const job = readJob(dir);
  const p = shopPayloads()[0]!;
  const written = new Map<string, Uint8Array>();
  const ev = evaluateProduct({ productId: p.handle, payload: p.payload, baseSize: p.baseSize, job, choice: chooseMesh(job, { allowSynthetic: false })!, writeImage: (n, png) => written.set(n, png) });
  const printed = parsePrintedTable('size-per-row: "Size Bust Length 8 94cm 90cm 10 98cm 90cm 12 102cm 91cm 14 106cm 92cm 16 112cm 93cm"');
  const sec = { ...section(p.handle, job, ev), shop: { ...section(p.handle, job, ev).shop, printed } };
  const md = renderReport({ ...input([sec]), written: '## Runs 10–14 timeline\n\nHand-written text.', writtenSource: 'spikes/garment-engine/data/bohohippychic/phase0-written.md' });

  it('compares the mesh with the generated turntable at 0°, 90° and 180°, both meshes, and writes the pictures', () => {
    expect([...new Set(ev.view.turntable.map((t) => t.angleDeg))]).toEqual([0, 90, 180]);
    expect(ev.view.turntable.map((t) => t.frame)).toEqual([0, 0, 2, 2, 4, 4]); // 8 frames
    for (const t of ev.view.turntable) {
      expect(t.iouSilhouette).toBeGreaterThan(0.5);
      expect(t.iouSilhouette).toBeGreaterThanOrEqual(t.iouVisible - 0.02);
    }
    expect([...written.keys()]).toEqual(expect.arrayContaining(['view/turntable_0.png', 'view/turntable_90.png', 'view/turntable_180.png']));
    expect(md).toMatch(/\| 90° \| 2 \| [0-9.]+ \| [0-9.]+ \| [0-9.]+ \| [0-9.]+ \| \[turntable_90\.png\]/);
    expect(ev.view.views.every((v) => v.silhouetteIou !== undefined)).toBe(true);
  });

  it('counts the stage 2 garment masks as the separation stage', () => {
    expect(stageStatuses(sec, job).find((s) => s.stage === '3 separation')!.state).toBe('done');
  });

  it('parses the printed garment table and grades against it', () => {
    expect(printed).toHaveLength(5);
    expect(printed[0]).toEqual({ size: '8', values: { chest: 94, shoulder_to_hem: 90 } });
    expect(md).toMatch(/Grading against the shop's printed garment table/);
    expect(md).toMatch(/\| 8 \| [0-9.]+ \| 94\.00 \| [-+0-9.]+ \| [0-9.]+ \| 90\.00 \|/);
    expect(parsePrintedTable('as-text: "Bust 94cm"')).toEqual([]);
    expect(parsePrintedTable('size-per-row: "Size Bust 8 94cm 10"')).toEqual([{ size: '8', values: { chest: 94 } }]);
  });

  it('copies the written section in after the acceptance table, and names its source', () => {
    expect(md.indexOf('## Runs 10–14 timeline')).toBeGreaterThan(md.indexOf('## Phase 0 acceptance'));
    expect(md.indexOf('## Runs 10–14 timeline')).toBeLessThan(md.indexOf('## What this set can and cannot show'));
    expect(md).toMatch(/written by hand in `spikes\/garment-engine\/data\/bohohippychic\/phase0-written\.md`/);
  });
});

describe('review verdicts and earlier runs', () => {
  it('marks a rejected run in the summary, the product section and the size test, and counts it out of the panel bundles', () => {
    const ps = shopPayloads().map((p) => missing(p.handle));
    ps[1] = { ...ps[1]!, review: { run: 15, verdict: 'rejected', why: 'stills torn' } };
    ps[0] = { ...ps[0]!, review: { run: 15, verdict: 'accepted', why: 'stills right' } };
    const md = renderReport(input(ps));
    expect(md).toContain(`\`${ps[1]!.shop.handle}\` (run 15 rejected on review)`);
    // No evaluation (no job dir here): it does not claim numbers it does not have.
    expect(md).toMatch(/\*\*Review of run 15 \(stills and frames looked at\):\*\* \*\*rejected\*\*\. stills torn\. not rendered and not on the blind page\./);
    expect(md).not.toMatch(/stills torn\. Evaluated below/);
    expect(md).toMatch(/\*\*Review of run 15 \(stills and frames looked at\):\*\* accepted\. stills right\./);
  });

  it('keeps a faulty run in the evaluation but out of the panel bundles and off the blind page', () => {
    const ps = shopPayloads().map((p) => missing(p.handle));
    ps[0] = { ...ps[0]!, review: { run: 15, verdict: 'accepted', why: 'stills right' } };
    ps[2] = { ...ps[2]!, review: { run: 15, verdict: 'faulty', why: 'hips narrow' } };
    const md = renderReport(input(ps));
    expect(md).toContain(`\`${ps[2]!.shop.handle}\` (run 15 faulty, evaluation only on review)`);
    expect(md).toMatch(/\*\*Review of run 15 \(stills and frames looked at\):\*\* \*\*faulty, for evaluation only\*\*\. hips narrow\. Evaluated and rendered below so the fault can be seen, but not a panel bundle and not on the blind page\./);
    expect(forPanel(ps[0]!)).toBe(true);
    expect(forPanel(ps[2]!)).toBe(false);
    expect(forPanel({ review: { run: 15, verdict: 'rejected', why: '' } })).toBe(false);
    expect(forPanel({ review: null })).toBe(true);
  });

  it('counts only accepted evaluated products as panel bundles in the size test', () => {
    const ps = shopPayloads().map((p) => missing(p.handle));
    const ev = { result: { agreement: { pass: false, missing: [], maxAbsCm: 1 }, before: { maxAbsCm: 1 }, afterGlobal: { maxAbsCm: 1 }, critical: ['chest'], rows: [], waistband: null }, view: { views: [] } } as unknown as ProductEval;
    ps[0] = { ...ps[0]!, eval: ev, review: { run: 15, verdict: 'accepted', why: '' } };
    ps[2] = { ...ps[2]!, eval: ev, review: { run: 15, verdict: 'faulty', why: '' } };
    const size = verdicts(input(ps)).find((v) => v.item === 'Size test')!;
    expect(size.text).toContain(`Bundles for the test: 1 of ${ps.length} products (1 more evaluated but kept off the panel on review: ${ps[2]!.shop.handle} faulty)`);
  });

  it('puts an earlier run next to the current job, with its comparison pictures, and invents nothing for a run without a mesh', () => {
    const ps = shopPayloads().map((p) => missing(p.handle));
    const h = ps[0]!.shop.handle;
    ps[0] = { ...ps[0]!, earlier: [{ label: 'run 14', jobRel: `out/phase0/${h}-run14`, job: readJob(`/nonexistent/${h}-run14`), eval: null, evalError: 'no job dir', bundleRel: null, renders: null, comparisons: [{ file: `spikes/garment-engine/out/eval/${h}/compare/run14-vs-current-turntable-0.png`, caption: 'at 0°' }] }] };
    const md = renderReport(input(ps));
    expect(md).toContain(`| Metric | run 14 (\`out/phase0/${h}-run14\`) | this job (\`out/phase0/${h}\`) |`);
    expect(md).toMatch(/\| hem line above the floor \(median of the lowest cloth per 10° sector, exemplar\.json\), cm \| — \| — \|/);
    expect(md).toContain('- run 14: no job dir');
    expect(md).toContain('run14-vs-current-turntable-0.png](');
  });
});
