/**
 * Regression on a REAL export of the 3D view (apps/web/e2e/aiRealism.spec.ts, WebGL in Chromium, 19 Nov 2026): the
 * pilot skirt at size 10 with the size-12 neighbour mask. The synthetic fixture missed two bugs that this one caught:
 * the lit edges of a real garment lose chroma but keep their hue (the garment key), and a frame with no room under
 * the hem hid a moved hem (the pass frame).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodePasses } from './codec.js';
import { FakeRealismProvider, type FakeRealismMode } from './fake.js';
import { checkFidelity } from './fidelity.js';
import { checkRenderPasses, type RenderPassMeta } from './passes.js';

const dir = fileURLToPath(new URL('../../fixtures/realism-pom-v2-rest-10/', import.meta.url));
const file = (n: string): Uint8Array => new Uint8Array(readFileSync(join(dir, n)));

async function passes() {
  const { meta } = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { meta: RenderPassMeta };
  return decodePasses(
    { colour: file('colour.png'), depth: file('depth.png'), normal: file('normal.png'), garmentMask: file('garmentMask.png'), figureMask: file('figureMask.png'), neighbour: { size: '12', garmentMask: file('neighbour-12-garmentMask.png') } },
    meta,
  );
}

const run = async (mode: FakeRealismMode, extra: { cm?: number; light?: number } = {}) => {
  const p = await passes();
  const out = await new FakeRealismProvider({ mode, ...extra }).enhance({ kind: 'renderPasses', passes: p, png: {} as never, prompt: '', strength: 0.3 });
  return checkFidelity(p, out.image);
};

describe('checks on a real export of the 3D view', () => {
  it('the export passes the guard (it is our render)', async () => {
    expect(checkRenderPasses(await passes())).toEqual([]);
  });
  it('a faithful image and a mild relight pass', async () => {
    expect((await run('faithful')).reasons).toEqual([]);
    expect((await run('relight', { light: 0.9 })).reasons).toEqual([]);
  });
  it('a moved hem, a recolour, a widened garment, strong relighting and a repainted backdrop are refused', async () => {
    expect((await run('move-hem', { cm: 4 })).reasons).toContain('hem');
    expect((await run('recolour')).reasons).toContain('colour');
    expect((await run('widen', { cm: 2 })).reasons).toContain('width');
    expect((await run('relight', { light: 0.75 })).reasons).toContain('colour');
    expect((await run('repaint-backdrop')).reasons).toContain('silhouette');
  });
});
