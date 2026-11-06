import { describe, expect, it } from 'vitest';
import { buildMannequinMesh, type Mesh } from '@curtain/mannequin';
import { evaluateGarment } from '../../src/eval';
import { evalBundle } from '../../src/evalBundle';
import { fixtureMannequin as m, reconstructedDress, shopPayload, syntheticSkirt } from '../../src/evalFixtures';
import { bodyField, buildAvatar, mannequinMeasurements } from './body';
import { loadBundle, meshFromGlb } from './bundle';
import { WAISTBAND_CM, openSession, pinHeight, prepareFit, relax, viewerMaterial, yokeHeight } from './engine';
import { fitForBody } from './fitting';

/** An evaluated shop bundle served the way the dev server does it (payload.json included). */
function served(handle: string, mesh: Mesh, baseSize: string) {
  const shop = shopPayload(handle);
  const r = evaluateGarment({ productId: handle, payload: shop.payload, baseSize, mesh, mannequin: m, source: { kind: 'stage4', path: 'stage4/stage2/garment.glb', simulatedError: null } });
  const files = evalBundle(r, shop.payload).files as unknown as Record<string, string | Uint8Array>;
  const fetchFn = async (url: string) => {
    const name = url.split('/').pop()!;
    const body = files[name];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => JSON.parse(body as string) as unknown,
      arrayBuffer: async () => {
        const b = body as Uint8Array;
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
    };
  };
  return { shop, fetchFn };
}

const avatarMeas = mannequinMeasurements(m);
const avatar = buildAvatar(m, buildMannequinMesh(m), avatarMeas);
const field = bodyField(m, avatar);

describe('evaluated shop bundles in the viewer', () => {
  it('loads payload.json and gives it to the fit engine instead of a schema fixture', async () => {
    const { shop, fetchFn } = served('azure-palm-baby-doll-dress', reconstructedDress(), '12');
    const bundle = await loadBundle(fetchFn, 'eval/azure-palm-baby-doll-dress');
    expect(bundle.payload).toEqual(shop.payload);
    const s = openSession(m, bundle);
    expect(s.payload).toBe(bundle.payload);
    const fit = fitForBody(s.payload, avatarMeas);
    expect(fit.recommendedSize ?? fit.closestSize).toMatch(/^(8|10|12|14|16)$/);
  });

  it('fetches payload.json only when anchors.json names it (no 404 for the spike fixtures)', async () => {
    const { fetchFn } = served('azure-palm-baby-doll-dress', reconstructedDress(), '12');
    const asked: string[] = [];
    const fixtureLike = async (url: string) => {
      asked.push(url);
      const res = await fetchFn(url);
      if (!url.endsWith('anchors.json')) return res;
      const { payloadFile: _drop, ...rest } = (await res.json()) as Record<string, unknown>;
      return { ...res, json: async () => rest };
    };
    expect((await loadBundle(fixtureLike, 'x')).payload).toBeUndefined();
    expect(asked.some((u) => u.endsWith('payload.json'))).toBe(false);
  });

  it('hangs a bottom from its waistband and drapes it without blowing up', async () => {
    const { fetchFn } = served('crimson-wildflower-maxi-skirt', syntheticSkirt(), '12');
    const bundle = await loadBundle(fetchFn, 'eval/crimson-wildflower-maxi-skirt');
    expect(bundle.anchors.category).toBe('bottom');
    const s = openSession(m, bundle);
    const top = Math.max(...Array.from({ length: bundle.baseMesh.positions.length / 3 }, (_, i) => bundle.baseMesh.positions[3 * i + 1]!));
    expect(pinHeight(m, 'bottom', bundle.baseMesh.positions, s.chains)).toBeCloseTo(top - WAISTBAND_CM, 6);
    expect(pinHeight(m, 'dress', bundle.baseMesh.positions, s.chains)).toBe(yokeHeight(m));
    const fit = prepareFit(s, avatar, field, fitForBody(s.payload, avatarMeas), '12', viewerMaterial('product', bundle.material));
    const pinned = fit.pinned.reduce((n, v) => n + v, 0);
    expect(pinned).toBeGreaterThan(0);
    const before = Float32Array.from(fit.cloth.pos);
    const pos = relax(fit);
    expect(pos.every(Number.isFinite)).toBe(true);
    // The pinned waistband stays put; the cloth below it does not fall off the body.
    let maxDrop = 0;
    for (let i = 0; i < fit.pinned.length; i++) if (fit.pinned[i]) maxDrop = Math.max(maxDrop, Math.abs(pos[3 * i + 1]! - before[3 * i + 1]!));
    expect(maxDrop).toBeLessThan(1);
    const minY = Math.min(...Array.from({ length: pos.length / 3 }, (_, i) => pos[3 * i + 1]!));
    const minBefore = Math.min(...Array.from({ length: before.length / 3 }, (_, i) => before[3 * i + 1]!));
    expect(minBefore - minY).toBeLessThan(10);
  });

  it('reads the base mesh of an evaluated bundle back in cm', () => {
    const shop = shopPayload('rosewater-blouse');
    const r = evaluateGarment({ productId: shop.handle, payload: shop.payload, baseSize: '12', mesh: reconstructedDress(), mannequin: m, source: { kind: 'stage4', path: 'x', simulatedError: null } });
    const mesh = meshFromGlb(evalBundle(r, shop.payload).files['base.glb']);
    expect(mesh.positions.length).toBe(r.baseMesh.positions.length);
    expect(Math.abs(mesh.positions[1]! - r.baseMesh.positions[1]!)).toBeLessThan(0.01);
  });
});
