import { readFileSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { chooseMesh, evaluateProduct, readJob, type JobFiles, type ProductEval } from './evalJob';
import { reconstructedDress, shopPayloads, syntheticDress, writeFakeJob } from './evalFixtures';
import { SHOP_UNCOVERED_CATEGORIES } from './shopSelection';
import { costTotal, plannedPhotos, renderReport, stageStatuses, usedInputs, verdicts, type ProductSection, type ReportInput, type ShopImage, type ShopProduct } from './evalReport';

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
    expect(md).toMatch(/\| back \| stage1b `stage1b\/garment_mask_back\.png` \| [0-9.]+ \| (pass|FAIL) \| YES \|/);
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
});
