import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chooseMesh, costRecord, evaluateProduct, readJob, RESCORED_CONSISTENCY, safeJoin, withRescoredConsistency } from './evalJob';
import { reconstructedDress, shopPayload, syntheticDress, writeFakeJob } from './evalFixtures';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('job dir', () => {
  const dir = writeFakeJob({ recon: reconstructedDress(), pinned: syntheticDress(), withCostSummary: true });
  dirs.push(dir);
  const job = readJob(dir);
  const shop = shopPayload('azure-palm-baby-doll-dress');

  it('reads the records a GPU run leaves', () => {
    expect(job.exists).toBe(true);
    expect(job.manifest?.job_id).toBe('fixture-000000000000');
    expect(job.stage1b?.engine).toBe('fashn');
    expect(job.stage2).not.toBeNull();
    expect(job.stage4.stage2?.glb).toBe('stage4/stage2/garment.glb');
    expect(job.costs.map((c) => c.stage)).toEqual(['stage1b_dress', 'stage2_video', 'stage4_recon[stage2]']);
    expect(job.costs.every((c) => c.estimate)).toBe(true);
  });

  it('evaluates the stage 4 mesh, with view agreement against the stage 1b masks and the shop photo masks', () => {
    const choice = chooseMesh(job, { allowSynthetic: false })!;
    expect(choice.kind).toBe('stage4');
    const images = new Map<string, Uint8Array>();
    const ev = evaluateProduct({ productId: shop.handle, payload: shop.payload, baseSize: shop.baseSize, job, choice, writeImage: (n, png) => images.set(n, png) });
    expect(ev.result.source.kind).toBe('stage4');
    expect(ev.view.views.map((v) => v.view)).toEqual(['front', 'back']);
    // The pinned masks are the true dress; the evaluated mesh is the calibrated reconstruction of it.
    for (const v of ev.view.views) expect(v.iou).toBeGreaterThan(0.85);
    expect(ev.view.shopPhotos).toHaveLength(2);
    expect([...images.keys()].sort()).toEqual(['view/back_overlay.png', 'view/back_render.png', 'view/front_overlay.png', 'view/front_render.png']);
    expect(ev.bundle).not.toBeNull();
  });

  it('never falls back to a synthetic mesh for a shop product, and reports a missing job', () => {
    const empty = mkdtempSync(join(tmpdir(), 'curtain-eval-empty-'));
    dirs.push(empty);
    expect(chooseMesh(readJob(empty), { allowSynthetic: false })).toBeNull();
    expect(readJob(join(empty, 'nope')).exists).toBe(false);
    const truth = chooseMesh(readJob(empty), { allowSynthetic: true, fallbackTruth: syntheticDress });
    expect(truth?.kind).toBe('synthetic-truth');
  });

  it('reads a CPU re-score of the stage 2 consistency check in place of the GPU run\'s, keeping the GPU one', () => {
    const d = writeFakeJob({ recon: reconstructedDress(), pinned: syntheticDress() });
    dirs.push(d);
    const before = readJob(d).stage2;
    const rescore = { version: 'garment-consistency-0.4.0', frames: 8, flagged: 2, off_reference_spans: [{ clip: 'turntable_a', j0: 1, j1: 2, frames: 2, max_px: 900, side: 'image-left' }] };
    writeFileSync(join(d, RESCORED_CONSISTENCY), JSON.stringify(rescore));
    const s2 = readJob(d).stage2!;
    expect((s2.consistency as Record<string, unknown>).version).toBe('garment-consistency-0.4.0');
    expect((s2.consistency as Record<string, unknown>).rescored_from).toBe(RESCORED_CONSISTENCY);
    expect(s2.consistency_gpu).toEqual(before?.consistency ?? null);
    expect(s2.steps).toEqual(before?.steps);
    // No record: a re-score alone is not a stage 2 run.
    expect(withRescoredConsistency(null, rescore)).toBeNull();
  });

  it('keeps the GPU check when the re-score has no version, an older version, or predates the record', () => {
    const rec = { steps: [], consistency: { version: 'garment-consistency-0.4.0', frames: 8, flagged: 1 } };
    const why = (r: ReturnType<typeof withRescoredConsistency>) => (r!.consistency as Record<string, unknown>).rescore_ignored;
    expect(why(withRescoredConsistency(rec, { flagged: 1 }))).toMatch(/no version/);
    const old = withRescoredConsistency(rec, { version: 'garment-consistency-0.3.0', frames: 8, flagged: 5 });
    expect((old!.consistency as Record<string, unknown>).flagged).toBe(1);
    expect(why(old)).toMatch(/older than the GPU check/);
    const stale = withRescoredConsistency(rec, { version: 'garment-consistency-0.4.0', frames: 8, flagged: 5 }, { record: 2000, rescore: 1000 });
    expect((stale!.consistency as Record<string, unknown>).flagged).toBe(1);
    expect(why(stale)).toMatch(/predates stage2\/record\.json/);
    expect(withRescoredConsistency({ steps: [] }, { flagged: 1 })).toEqual({ steps: [] });
    // A newer version on an older GPU check is used; a fresh one of the same version too.
    expect((withRescoredConsistency({ consistency: { version: 'garment-consistency-0.3.0' } }, { version: 'garment-consistency-0.4.0', flagged: 3 })!.consistency as Record<string, unknown>).gpu_version).toBe('garment-consistency-0.3.0');
    expect((withRescoredConsistency(rec, { version: 'garment-consistency-0.4.0', frames: 8, flagged: 2 }, { record: 1000, rescore: 2000 })!.consistency as Record<string, unknown>).flagged).toBe(2);
  });

  it('does not substitute a re-score identical to the GPU check, but marks it', () => {
    const c = { version: 'garment-consistency-0.4.0', frames: 8, flagged: 1, flagged_frames: [{ clip: 'turntable_a', j: 3, reasons: ['x'] }], seconds: 10 };
    const r = withRescoredConsistency({ consistency: c }, { ...c, seconds: 99 })!;
    expect(r.consistency).toEqual({ ...c, rescore_identical: RESCORED_CONSISTENCY });
    expect(r.consistency_gpu).toBeUndefined();
  });

  it('marks an invented back from the manifest', () => {
    const d = writeFakeJob({ recon: reconstructedDress(), pinned: syntheticDress(), inventedBack: true });
    dirs.push(d);
    const j = readJob(d);
    const ev = evaluateProduct({ productId: shop.handle, payload: shop.payload, baseSize: shop.baseSize, job: j, choice: chooseMesh(j, { allowSynthetic: false })! });
    expect(ev.view.views.find((v) => v.view === 'back')!.invented).toBe(true);
    expect(j.costs).toHaveLength(3); // from the stage records when there is no cost_summary.json
  });

  it('keeps paths inside the job dir and reads cost records narrowly', () => {
    expect(safeJoin('/job', '../etc/passwd')).toBeNull();
    expect(safeJoin('/job', '/etc/passwd')).toBeNull();
    expect(safeJoin('/job', 'stage1b/a.png')).toBe(join('/job', 'stage1b/a.png'));
    expect(costRecord({ stage: 's', gpu_seconds: 'x' })).toMatchObject({ stage: 's', gpuSeconds: null, estimate: true });
    expect(costRecord(['s'])).toBeNull();
  });
});
