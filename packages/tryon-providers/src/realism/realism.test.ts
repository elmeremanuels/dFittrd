import { describe, expect, it } from 'vitest';
import { deltaE2000, srgbToLab } from './colour.js';
import { checkFidelity } from './fidelity.js';
import { FakeRealismProvider } from './fake.js';
import { checkRenderPasses, type RenderPasses } from './passes.js';
import { AI_ENHANCED_LABEL, assertRealismProviderAllowed, runRealism } from './pipeline.js';
import { realismPrompt } from './provider.js';
import { syntheticPasses } from './synthetic.js';
import { DISCLAIMER } from '../types.js';

const withNeighbour = (): RenderPasses => syntheticPasses({ neighbour: { size: 'L', grow: 10, longer: 14 } });

describe('CIEDE2000', () => {
  it('matches the Sharma et al. 2005 test pairs', () => {
    // Pairs 1, 7 and 17 of the published table.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(deltaE2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 3);
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 3);
    expect(deltaE2000(srgbToLab(10, 20, 30), srgbToLab(10, 20, 30))).toBe(0);
  });
});

describe('the passes guard: only our render, never a photo', () => {
  it('accepts the synthetic render', () => {
    expect(checkRenderPasses(syntheticPasses())).toEqual([]);
  });
  it('refuses a picture whose background is not the flat backdrop (a camera photo)', () => {
    const p = syntheticPasses();
    for (let i = 0; i < p.width * p.height; i++) if (p.figureMask.data[i]! < 128) p.colour.data[4 * i] = (i * 7) % 256;
    expect(checkRenderPasses(p)).toContain('backdrop_not_flat');
  });
  it('refuses soft masks, a garment outside the figure, depth off the figure and non-unit normals', () => {
    const soft = syntheticPasses();
    soft.garmentMask.data.forEach((v, i) => (soft.garmentMask.data[i] = v ? 180 : 0));
    expect(checkRenderPasses(soft)).toContain('mask_not_binary');
    const out = syntheticPasses();
    out.garmentMask.data.fill(255);
    expect(checkRenderPasses(out)).toContain('garment_outside_figure');
    const d = syntheticPasses();
    d.depth.data.fill(90);
    expect(checkRenderPasses(d)).toContain('depth_off_figure');
    const nn = syntheticPasses();
    nn.normal.data.fill(128);
    expect(checkRenderPasses(nn)).toContain('normals_not_unit');
    const tiny = syntheticPasses({ width: 128, height: 128 });
    expect(checkRenderPasses(tiny)).toEqual(['dimensions']);
  });
});

describe('fidelity checks: the AI image may not lie about the estimate', () => {
  it('passes a faithful image and reports the metrics', async () => {
    const passes = withNeighbour();
    const out = await new FakeRealismProvider().enhance({ kind: 'renderPasses', passes, png: {} as never, prompt: '', strength: 0.3 });
    const r = checkFidelity(passes, out.image);
    expect(r.reasons).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.metrics!.silhouetteIoU).toBeGreaterThan(0.98);
    expect(r.metrics!.colourDeltaE00).toBeLessThan(2);
    expect(r.metrics!.hemShiftCm).toBeLessThan(0.5);
    expect(r.sizeSeparation).toMatchObject({ neighbour: 'L', visible: true, ok: true });
  });

  it('passes faithful images of plain garments in several colours', async () => {
    for (const garmentHex of ['#1F4E79', '#B0303A', '#1A1612', '#FF5A3C', '#3E7D4F']) {
      const passes = syntheticPasses({ garmentHex, neighbour: { size: 'L', grow: 10, longer: 14 } });
      const out = await new FakeRealismProvider().enhance({ kind: 'renderPasses', passes, png: {} as never, prompt: '', strength: 0.3 });
      expect(checkFidelity(passes, out.image).reasons, garmentHex).toEqual([]);
    }
  });

  it('rejects an image that moved the hem', async () => {
    const passes = withNeighbour();
    const out = await new FakeRealismProvider({ mode: 'move-hem', cm: 4 }).enhance({ kind: 'renderPasses', passes, png: {} as never, prompt: '', strength: 0.3 });
    const r = checkFidelity(passes, out.image);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('hem');
    expect(r.metrics!.hemShiftCm).toBeGreaterThan(3);
  });

  it('rejects an image that changed the colour', async () => {
    const passes = syntheticPasses({ garmentHex: '#B0303A' });
    const out = await new FakeRealismProvider({ mode: 'recolour' }).enhance({ kind: 'renderPasses', passes, png: {} as never, prompt: '', strength: 0.3 });
    const r = checkFidelity(passes, out.image);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('colour');
    expect(r.metrics!.colourDeltaE00).toBeGreaterThan(10);
  });

  it('rejects an image that drew the neighbouring size, and one that widened the garment', async () => {
    const passes = withNeighbour();
    const nb = await new FakeRealismProvider({ mode: 'neighbour-size' }).enhance({ kind: 'renderPasses', passes, png: {} as never, prompt: '', strength: 0.3 });
    const r = checkFidelity(passes, nb.image);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('size_difference');
    const wide = await new FakeRealismProvider({ mode: 'widen', cm: 2 }).enhance({ kind: 'renderPasses', passes, png: {} as never, prompt: '', strength: 0.3 });
    expect(checkFidelity(passes, wide.image).reasons).toContain('width');
  });

  it('rejects a repainted backdrop (silhouette) and a garment it cannot tell from the backdrop (unverifiable)', async () => {
    const passes = syntheticPasses();
    const bd = await new FakeRealismProvider({ mode: 'repaint-backdrop' }).enhance({ kind: 'renderPasses', passes, png: {} as never, prompt: '', strength: 0.3 });
    expect(checkFidelity(passes, bd.image).reasons).toContain('silhouette');
    const cream = syntheticPasses({ garmentHex: '#F2ECE2' });
    const out = await new FakeRealismProvider().enhance({ kind: 'renderPasses', passes: cream, png: {} as never, prompt: '', strength: 0.3 });
    expect(checkFidelity(cream, out.image).reasons).toEqual(['unverifiable']);
  });
});

describe('runRealism', () => {
  it('returns the image with the AI-enhanced estimate label, or a refusal that is labelled too', async () => {
    const ok = await runRealism({ passes: withNeighbour(), provider: new FakeRealismProvider(), prompt: realismPrompt({ category: 'dress' }) });
    expect(ok.status).toBe('ok');
    expect(ok.label).toBe(AI_ENHANCED_LABEL);
    expect(ok.disclaimer).toBe(DISCLAIMER);
    const bad = await runRealism({ passes: withNeighbour(), provider: new FakeRealismProvider({ mode: 'move-hem' }), prompt: '' });
    expect(bad).toMatchObject({ status: 'refused', stage: 'checks', label: AI_ENHANCED_LABEL, disclaimer: DISCLAIMER });
    const photo = syntheticPasses();
    photo.colour.data.fill(77);
    const fake = new FakeRealismProvider();
    expect(await runRealism({ passes: photo, provider: fake, prompt: '' })).toMatchObject({ status: 'refused', stage: 'passes' });
    expect(fake.calls).toHaveLength(0);
  });
  it('refuses a provider with a banned model, and one over the cost cap', async () => {
    expect(() => assertRealismProviderAllowed({ name: 'x', models: ['IDM-VTON'] })).toThrow(/banned/);
    await expect(runRealism({ passes: syntheticPasses(), provider: new FakeRealismProvider({ costUsd: 1 }), prompt: '', maxCostUsd: 0.1 })).rejects.toThrow(/cost/);
  });
  it('refuses an output of the wrong size', async () => {
    const r = await runRealism({ passes: syntheticPasses(), provider: new FakeRealismProvider({ wrongSize: true }), prompt: '' });
    expect(r).toMatchObject({ status: 'refused', stage: 'checks' });
    if (r.status === 'refused' && r.stage === 'checks') expect(r.report.reasons).toEqual(['dimensions']);
  });
});
