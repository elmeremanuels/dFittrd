import { readFileSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { chooseMesh, evaluateProduct, readJob, type JobFiles, type ProductEval } from './evalJob';
import { reconstructedDress, shopPayloads, syntheticDress, writeFakeJob } from './evalFixtures';
import { SHOP_UNCOVERED_CATEGORIES } from './shopSelection';
import { consistencyNote, costScope, costTotal, stage2ClipsNote, forPanel, offPanelReason, parsePrintedTable, plannedPhotos, renderReport, stageStatuses, usedInputs, verdicts, type ProductSection, type ReportInput, type ShopImage, type ShopProduct, parseWaistReading, waistReadingLine, joinDetail } from './evalReport';

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

  it('flags off-reference spans of stage 2 and marks the stage 4t hem girth unconfirmed', () => {
    const consistency = {
      version: 'garment-consistency-0.4.0',
      frames: 162,
      flagged: 70,
      off_reference_spans: [
        { clip: 'turntable_a', j0: 19, j1: 30, frame0: 19, frame1: 30, frames: 12, max_px: 1941, side: 'image-left' },
        { clip: 'turntable_b', j0: 18, j1: 78, frame0: 98, frame1: 158, frames: 61, max_px: 1237, side: 'image-left' },
      ],
    };
    expect(consistencyNote(consistency)).toBe(
      "consistency garment-consistency-0.4.0: 70/162 frames flagged; garment off the stills' hull below the hips (flap or panel the stills do not have) in turntable_a j19–30 (max 1941 px, image-left), turntable_b j18–78 (max 1237 px, image-left)",
    );
    expect(consistencyNote({ version: 'garment-consistency-0.3.0', frames: 10, flagged: 0 })).toBe('consistency garment-consistency-0.3.0: 0/10 frames flagged');
    expect(consistencyNote(undefined)).toBe('');
    expect(consistencyNote({ version: 'garment-consistency-0.4.0', frames: 10, flagged: 1, rescored_from: 'stage2/consistency_v2.json', gpu_version: 'garment-consistency-0.3.0' })).toBe(
      'consistency garment-consistency-0.4.0 (re-scored on CPU, `stage2/consistency_v2.json`; the GPU run wrote garment-consistency-0.3.0): 1/10 frames flagged',
    );
    expect(consistencyNote({ version: 'garment-consistency-0.4.0', frames: 10, flagged: 0, rescore_identical: 'stage2/consistency_v2.json' })).toBe(
      'consistency garment-consistency-0.4.0 (CPU re-score `stage2/consistency_v2.json` identical): 0/10 frames flagged',
    );
    expect(consistencyNote({ version: 'garment-consistency-0.4.0', frames: 10, flagged: 0, rescore_ignored: 'stale' })).toMatch(/\(CPU re-score NOT used: stale\)/);
    // Frames flagged for other reasons are listed by reason and clip, not left out.
    const other = {
      version: 'garment-consistency-0.4.0', frames: 10, flagged: 4,
      flagged_frames: [
        { clip: 'turntable_a', j: 7, reasons: ['skirt zone covered 0.88 < 0.9 (narrower than the reference below the crotch: trousers or a narrower garment)', "900 px of garment off the pinned stills' hull below the hips (left 0 right 900; mostly image-right) > 400: a flap or panel the stills do not have"] },
        { clip: 'turntable_a', j: 8, reasons: ['skirt zone covered 0.87 < 0.9 (narrower)'] },
        { clip: 'turntable_a', j: 9, reasons: ['skirt zone covered 0.87 < 0.9 (narrower)'] },
        { clip: 'turntable_b', j: 2, reasons: ['garment IoU vs the pinned stills 0.80 < 0.82'] },
      ],
    };
    expect(consistencyNote(other)).toBe(
      'consistency garment-consistency-0.4.0: 4/10 frames flagged; other flags: skirt cover below the reference: turntable_a j7–9 (3); garment IoU vs the pinned stills low: turntable_b j2 (1)',
    );
    const flaggedJob = { ...job, stage2: { ...(job.stage2 as object), consistency }, stage4t: { stage2: { glb: 'x.glb', metrics: {}, atlas: null, exemplar: null, shadow: null } } };
    const st = stageStatuses(sec, flaggedJob);
    expect(st.find((s) => s.stage === '2 image to video')!.detail).toMatch(/turntable_b j18–78 \(max 1237 px, image-left\)/);
    expect(st.find((s) => s.stage === '4t template fit + bake (CPU)')!.detail).toMatch(/hem girth UNCONFIRMED: fitted from masks of 73 turntable frames/);
    const clean = stageStatuses(sec, { ...flaggedJob, stage2: { ...(job.stage2 as object), consistency: { ...consistency, off_reference_spans: [] } } });
    expect(clean.find((s) => s.stage === '4t template fit + bake (CPU)')!.detail).not.toMatch(/UNCONFIRMED/);
  });

  it('reads a stage 2 run without the motion clip, on one GPU container per clip, and marks an incomplete one failed', () => {
    const cost = (stage: string, gpu: number, wall: number) => ({ stage, estimate: true, gpu: 'H100', region: 'any', gpu_seconds: gpu, wall_seconds: wall, usd_estimate_low: 0.5, usd_estimate_high: 0.55 });
    const costs = [cost('stage2_video[turntable_a]', 480, 495), cost('stage2_video[turntable_b]', 466, 497)];
    const parallel = { runner: 'stage2-parallel-0.1.0', containers: 2, gpu_seconds: 946, load_seconds_total: 29, wall_seconds: 497 };
    const clips = [{ id: 'turntable_a', frames: 81, seed: 43 }, { id: 'turntable_b', frames: 81, seed: 44 }];
    const s2 = { ...(job.stage2 as object), clips, motion: false, complete: true, failed_clips: [], parallel, costs };
    expect(stage2ClipsNote(s2)).toBe('clips turntable_a, turntable_b; no motion clip; 2 GPU containers in parallel, wall 497 s vs 946 GPU s');
    expect(stage2ClipsNote({ clips: [...clips, { id: 'motion' }] })).toBe('clips turntable_a, turntable_b, motion');
    expect(stage2ClipsNote(job.stage2)).toBe('');
    const two = { ...job, stage2: s2, costSummary: { costs, wall_seconds: 900 } };
    const st = stageStatuses(sec, two).find((s) => s.stage === '2 image to video')!;
    expect(st.state).toBe('done');
    expect(st.detail).toMatch(/turntable frames \(clips turntable_a, turntable_b; no motion clip; 2 GPU containers/);
    const ct = costTotal({ ...two, costs: costs.map((c) => ({ stage: c.stage, gpu: c.gpu, region: c.region, gpuSeconds: c.gpu_seconds, wallSeconds: c.wall_seconds, usdLow: c.usd_estimate_low, usdHigh: c.usd_estimate_high, estimate: true })) });
    expect(ct.gpuSeconds).toBe(946);
    expect(ct.usdLow).toBeCloseTo(1.0);
    const failed = { ...s2, complete: false, clips: clips.slice(1), turntable_frames_assembled: 0, failed_clips: [{ id: 'turntable_a', error: 'RuntimeError: CUDA out of memory' }] };
    const bad = stageStatuses(sec, { ...job, stage2: failed }).find((s) => s.stage === '2 image to video')!;
    expect(bad.state).toBe('failed');
    expect(bad.detail).toBe('INCOMPLETE: turntable_a (RuntimeError: CUDA out of memory); clips turntable_b; no motion clip; 2 GPU containers in parallel, wall 497 s vs 946 GPU s; no turntable assembled');
  });

  it('says when a cost total leaves out a stage 1b reused from an earlier run', () => {
    const own = costTotal(job);
    expect(own.stage1bReused).toBeNull();
    expect(costScope(own)).toBe('');
    const reused = costTotal({ ...job, costSummary: { ...(job.costSummary as object), stage1b: { reused: 'recompose' } } });
    expect(reused.gpuSeconds).toBe(350);
    expect(costScope(reused)).toMatch(/stage 1b recomposed on CPU from an earlier run; that run's stage 1b GPU not included/);
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
    // The import gate: an evaluated product whose chart agreement fails is off the panel whatever its review.
    const evalWith = (pass: boolean) => ({ result: { agreement: { pass } } }) as unknown as ProductSection['eval'];
    expect(forPanel({ review: { run: 17, verdict: 'accepted', why: '' }, eval: evalWith(false) })).toBe(false);
    expect(forPanel({ review: { run: 17, verdict: 'accepted', why: '' }, eval: evalWith(true) })).toBe(true);
    expect(offPanelReason({ review: { run: 17, verdict: 'accepted', why: '' }, eval: evalWith(false) })).toMatch(/import gate refuses/);
  });

  it('counts only accepted evaluated products as panel bundles in the size test', () => {
    const ps = shopPayloads().map((p) => missing(p.handle));
    const ev = { result: { agreement: { pass: false, missing: [], maxAbsCm: 1 }, before: { maxAbsCm: 1 }, afterGlobal: { maxAbsCm: 1 }, critical: ['chest'], rows: [], waistband: null }, view: { views: [] } } as unknown as ProductEval;
    const passing = { ...ev, result: { ...ev.result, agreement: { ...ev.result.agreement, pass: true } } } as ProductEval;
    ps[0] = { ...ps[0]!, eval: passing, review: { run: 15, verdict: 'accepted', why: '' } };
    ps[2] = { ...ps[2]!, eval: ev, review: { run: 15, verdict: 'faulty', why: '' } };
    const size = verdicts(input(ps)).find((v) => v.item === 'Size test')!;
    expect(size.text).toContain(`Bundles for the test: 1 of ${ps.length} products (1 more evaluated but kept off the panel: ${ps[2]!.shop.handle} faulty)`);
    // Accepted on review but refused by the import gate (chart FAIL): off the panel, and the reason is named.
    ps[3] = { ...ps[3]!, eval: ev, review: { run: 17, verdict: 'accepted', why: '' } };
    const size2 = verdicts(input(ps)).find((v) => v.item === 'Size test')!;
    expect(size2.text).toContain(`Bundles for the test: 1 of ${ps.length} products (2 more evaluated but kept off the panel: ${ps[2]!.shop.handle} faulty, ${ps[3]!.shop.handle} chart FAIL (import gate refuses the bundle))`);
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

describe('the waist-reading switch (review.json waistReading)', () => {
  it('reads natural by default and low-rise only with a recorded decision', () => {
    expect(parseWaistReading('x', undefined)).toBeNull();
    expect(parseWaistReading('x', 'natural')).toBeNull();
    expect(parseWaistReading('x', { kind: 'natural' })).toBeNull();
    expect(parseWaistReading('x', { kind: 'low-rise', decision: ' founder, 9 Nov ' })).toEqual({ kind: 'low-rise', decision: 'founder, 9 Nov' });
    expect(() => parseWaistReading('x', { kind: 'low-rise' })).toThrow(/decision/);
    expect(() => parseWaistReading('x', 'low-rise')).toThrow();
    expect(() => parseWaistReading('x', { kind: 'band', decision: 'y' })).toThrow();
  });
  it('the report says which reading was used, and names the switch when it is not set', () => {
    const band = { girthCm: 88, centreY: 100.2 } as never;
    const off = waistReadingLine({ category: 'bottom', waistband: band, agreement: { pass: false, missing: ['waist'] } as never });
    expect(off).toMatch(/at our waist ring \(the default\)/);
    expect(off).toMatch(/"waistReading"/);
    const on = waistReadingLine({ category: 'bottom', waistband: band, agreement: { pass: true, missing: [], waistReading: { kind: 'low-rise', decision: 'founder', dropCm: 4.8, bandYCm: 99.4, waistRingYCm: 104.2, chartWaistCm: 80.5, offsetCm: 5.1, bodyAtBandCm: 79.1, bodyAtWaistCm: 74, targetCm: 85.6 } } as never });
    expect(on).toMatch(/LOW-RISE \(founder decision: founder\)/);
    expect(on).toMatch(/low_rise_waist/);
    // The miss before calibration is stated, and a pass with the waist as the only critical point is called automatic.
    const onFull = waistReadingLine({ category: 'bottom', waistband: band, critical: ['waist'], before: { maxAbsCm: 2.49, pass: false }, agreement: { pass: true, toleranceCm: 2, missing: [], waistReading: { kind: 'low-rise', decision: 'founder', dropCm: 4.8, bandYCm: 99.4, waistRingYCm: 104.2, chartWaistCm: 80.5, offsetCm: 5.1, bodyAtBandCm: 79.1, bodyAtWaistCm: 74, targetCm: 85.6 } } as never });
    expect(onFull).toMatch(/misses its target by 2\.49 cm \(tolerance ±2 cm: OUTSIDE\)/);
    expect(onFull).toMatch(/pass after calibration is automatic/);
  });
  it('the trouser join line states the deeper crotch, the band slivers and crossing legs (or that they do not cross)', () => {
    const band = { triangles: 24, longestEdgeCm: 19.41, maxAreaCm2: 27.5, edgesOverCm: 8, overLongCm: 12 };
    const crossing = joinDetail({ belowBodyCrotchCm: 6.5, band: { seat: { ...band, triangles: 114 }, crotch: band }, legOverlap: { fromCm: 69.44, toCm: 54.94, stepCm: 0.5, slices: 30, slicesWithCrossings: 10, crossings: 20, lowestCm: 64.94, byHeight: [] } });
    expect(crossing).toMatch(/6\.5 cm BELOW the body's crotch/);
    expect(crossing).toMatch(/crotch floor 24 triangles, longest edge 19\.41 cm/);
    expect(crossing).toMatch(/leg tubes CROSS each other below the join: 20 crossings in 10 of 30 slices/);
    expect(joinDetail({ legOverlap: { fromCm: 69, toCm: 55, slices: 30, crossings: 0 } })).toMatch(/do not cross/);
    expect(joinDetail(null)).toBe('');
    expect(waistReadingLine({ category: 'dress', waistband: null, agreement: { pass: true, missing: [] } as never })).toBeNull();
  });
});
