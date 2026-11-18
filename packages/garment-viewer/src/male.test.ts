/**
 * The male body in the viewer (men-3d-plan slice M1): a bundle built on the male mannequin (the
 * SYNTHETIC men's test tee of the spike, not a product) passes the device check for a men's garment
 * only, mounts on the male body family only, and drapes on male bodies S to XXL without exploding.
 * No WebGL: `planAvatar` is what `mountGarmentView` decides before it draws, and the drape is the
 * one the mount runs (`prepareFit` + `relax`).
 */
import { describe, expect, it } from 'vitest';
import { MALE_BODY_SHAPE_IDS, MALE_REFERENCE } from '@curtain/mannequin';
import { MOCK_GARMENTS_BY_ID, SYNTHETIC_MENS_TEE } from '@curtain/schema';
import type { Mesh } from '@curtain/mannequin';
import { measureRing } from '../../../spikes/garment-engine/src/anchoring';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { makeCollider } from './body';
import { loadBundleFrom, type FetchLike } from './bundle';
import { checkBundle } from './bundleCheck';
import { isSettled, strainQuantile } from './cloth';
import { openSession, prepareFit, relax, viewerMaterial } from './engine';
import { fitForBody } from './fitting';
import { GarmentViewError, planAvatar } from './mount';

const tee = buildBundle('synthetic-men-tee', { skipSeparation: true });
const dress = buildBundle('aalter-studio-2', { skipSeparation: true });

/** The bundle files as the dev server or the asset route would serve them. */
function serve(files: Record<string, string | Uint8Array>): FetchLike {
  return async (url) => {
    const name = url.split('/').pop()!;
    const data = files[name];
    if (data === undefined) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(data as string) as unknown,
      arrayBuffer: async () => {
        const u = data as Uint8Array;
        return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
      },
    };
  };
}

const incompatible = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    return e instanceof GarmentViewError ? e.code : String(e);
  }
  return undefined;
};

describe('a bundle built on the male mannequin', () => {
  it('carries the family in anchors.json and qa.json; a female bundle carries none (unchanged)', () => {
    expect(JSON.parse(tee.files['anchors.json']).mannequin).toEqual({ version: '0.1.0', shape: 'M', family: 'male' });
    expect(JSON.parse(tee.files['qa.json']).mannequin).toEqual({ version: '0.1.0', shape: 'M', family: 'male' });
    expect(JSON.parse(dress.files['anchors.json']).mannequin).toEqual({ version: '0.1.0', shape: 'M' });
    expect(JSON.parse(dress.files['qa.json'])).not.toHaveProperty('mannequin');
  });

  it('passes the device check for the men’s garment only, and a female bundle never for a men’s garment', async () => {
    const bundle = await loadBundleFrom(serve(tee.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
    const meta = { anchors: bundle.anchors, grading: bundle.grading, material: bundle.material, qa: bundle.qa };
    expect(checkBundle(meta, SYNTHETIC_MENS_TEE)).toMatchObject({ family: 'male', baseSize: 'M', sizes: ['S', 'M', 'L', 'XL', 'XXL'] });
    expect(checkBundle(meta, { ...SYNTHETIC_MENS_TEE, audience: 'women' })).toBeNull();
    expect(checkBundle(meta, { ...SYNTHETIC_MENS_TEE, audience: undefined })).toBeNull();
    const female = { anchors: JSON.parse(dress.files['anchors.json']), grading: JSON.parse(dress.files['grading.json']), material: JSON.parse(dress.files['material.json']), qa: JSON.parse(dress.files['qa.json']) };
    const womens = MOCK_GARMENTS_BY_ID['aalter-studio-2']!;
    expect(checkBundle(female, womens)?.family).toBe('female');
    expect(checkBundle(female, { ...womens, audience: 'men' })).toBeNull();
    // anchors.json says male, qa.json does not: malformed, refused.
    expect(checkBundle({ ...meta, qa: { ...meta.qa, mannequin: undefined } } as never, SYNTHETIC_MENS_TEE)).toBeNull();
  });

  it('mounts on the male body family only (strict both ways)', () => {
    const anchors = JSON.parse(tee.files['anchors.json']) as { category: string; mannequin: { family?: unknown } };
    expect(planAvatar(anchors, { family: 'male' }).m.shape.family).toBe('male');
    expect(planAvatar(anchors, { family: 'male', heightCm: 180 }).statureCm).toBeCloseTo(180, 6);
    expect(incompatible(() => planAvatar(anchors, {}))).toBe('incompatible');
    expect(incompatible(() => planAvatar(anchors, { family: 'female', heightCm: 168 }))).toBe('incompatible');
    const femaleAnchors = JSON.parse(dress.files['anchors.json']) as { category: string; mannequin: { family?: unknown } };
    expect(incompatible(() => planAvatar(femaleAnchors, { family: 'male', heightCm: 174 }))).toBe('incompatible');
  });

  it('drapes on the male bodies S to XXL in their own size: settled, finite, outside the body, chest girth near the chart and S < … < XXL', async () => {
    const bundle = await loadBundleFrom(serve(tee.files), '/b', SYNTHETIC_MENS_TEE.id, { withPayload: false });
    const anchors = bundle.anchors;
    const widths: number[] = [];
    for (const id of MALE_BODY_SHAPE_IDS) {
      const r = MALE_REFERENCE[id];
      const body = { family: 'male' as const, heightCm: r.stature, bust: r.chest, waist: r.waist, hip: r.hip, shoulderCm: r.shoulderWidth };
      const plan = planAvatar(anchors, body);
      const session = openSession(plan.m, bundle, SYNTHETIC_MENS_TEE);
      const fit = fitForBody(SYNTHETIC_MENS_TEE, plan.avatar.measurements);
      const f = prepareFit(session, plan.avatar, plan.field, fit, id, viewerMaterial('product', bundle.material));
      const pos = relax(f);
      expect(isSettled(f.cloth, f.params)).toBe(true);
      expect(pos.every(Number.isFinite)).toBe(true);
      expect(strainQuantile(f.cloth, 0.99)).toBeLessThan(0.2);
      const collide = makeCollider(plan.field, 0, session.chains, f.noCollide);
      const probe = Float32Array.from(pos);
      let inside = 0;
      for (let i = 0; i < probe.length / 3; i++) if (collide(probe, i)) inside++;
      expect(inside / (probe.length / 3)).toBeLessThan(0.02);
      // Girth of the draped tee at the base body's chest ring (garment space; the spike's tape).
      const chest = plan.m.rings.find((x) => x.id === 'chest')!;
      widths.push(measureRing({ positions: Float64Array.from(pos), indices: f.indices, vertexPart: new Uint8Array(0), partNames: [] } as Mesh, chest)!.circumferenceCm);
    }
    // Measured 98.7, 105.7, 113.5, 121.3, 130.5 cm on 18 Nov 2026 against the chart's 98 … 131: the drape keeps the graded girth.
    SYNTHETIC_MENS_TEE.sizeChart.forEach((row, i) => expect(Math.abs(widths[i]! - row.bust!)).toBeLessThan(1.5));
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThan(widths[i - 1]!);
  }, 180_000);
});
