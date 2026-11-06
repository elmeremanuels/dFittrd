import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { chooseMesh, costRecord, evaluateProduct, readJob, safeJoin } from './evalJob';
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
