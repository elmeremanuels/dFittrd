/**
 * The SYNTHETIC tape-built babydoll dress (spikes/garment-engine `pomDress.ts`) through the viewer's own drape: held by
 * its top edge band (`GarmentAnchorsJson.support`), its seam kept at the tape's girth, its lengths kept, on the bundle
 * body's stature and on a typed 156 and 180 cm body.
 */
import { describe, expect, it } from 'vitest';
import { AU_WOMENS_BODY_CHART } from '@curtain/schema';
import { measurePomDress } from '../../../spikes/garment-engine/src/pomDress';
import { buildPomDressBundle } from '../../../spikes/garment-engine/src/pomDressBundle';
import { SYNTHETIC_DRESS_ID, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE, SYNTHETIC_TAPE_DRESS } from '../../../spikes/garment-engine/src/pomDressSynthetic';
import { loadBundleFrom, type FetchLike } from './bundle';
import { strainQuantile } from './cloth';
import { openSession, prepareFit, relax, viewerMaterial } from './engine';
import { fitForBody } from './fitting';
import { planAvatar } from './mount';

const serve = (files: Record<string, string | Uint8Array>): FetchLike => async (url) => {
  const data = files[url.split('/').pop()!]!;
  return { ok: true, status: 200, json: async () => JSON.parse(data as string) as unknown, arrayBuffer: async () => { const u = data as Uint8Array; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; } };
};

describe('the tape-built dress in the viewer', () => {
  it('drapes with its seam, bust, hem and length at the tape, at three statures', async () => {
    const pom = buildPomDressBundle(SYNTHETIC_DRESS_ID, SYNTHETIC_TAPE_DRESS, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE.provenance);
    const row = SYNTHETIC_DRESS_POM.find((r) => r.size === '12')!;
    const chart = AU_WOMENS_BODY_CHART.find((r) => r.size === '12')!;
    const hems: number[] = [];
    for (const heightCm of [undefined, 156, 180]) {
      const bundle = await loadBundleFrom(serve(pom.files), '/b', SYNTHETIC_DRESS_ID, { withPayload: false });
      const plan = planAvatar(bundle.anchors, { bust: chart.bust!, waist: chart.waist!, hip: chart.hip!, ...(heightCm ? { heightCm } : {}) });
      const session = openSession(plan.m, bundle, SYNTHETIC_TAPE_DRESS);
      expect(session.sewn).toBe(false);
      const fit = fitForBody(SYNTHETIC_TAPE_DRESS, plan.avatar.measurements);
      expect(fit.recommendedSize).toBe('12');
      const f = prepareFit(session, plan.avatar, plan.field, fit, '12', viewerMaterial('product', bundle.material));
      expect(f.params.clingAccel).toBe(0);
      expect(f.loops.map((l) => l.ring.split('@')[0])).toEqual(['seam']);
      // The top edge band is held, not only the straps.
      for (const i of pom.base.topEdge) expect(f.pinned[i]).toBe(1);
      for (const i of pom.base.seam) expect(f.pinned[i]).toBe(0);
      const t = measurePomDress(relax(f), pom.base);
      const tag = `${heightCm ?? 'bundle stature'}`;
      expect(2 * t.bustWidthCm, tag).toBeCloseTo(2 * row.bustWidthCm, 0);
      expect(2 * t.seamWidthCm, tag).toBeGreaterThan(2 * row.seamWidthCm - 0.5);
      expect(2 * t.seamWidthCm, tag).toBeLessThan(2 * row.seamWidthCm * 1.02);
      expect(Math.abs(2 * t.hemWidthCm - 2 * row.hemWidthCm), tag).toBeLessThan(1.5);
      // The bundle asks the drape to hold length (`support.holdLength`): the centre front comes out about 1 % long, where it
      // was 2 to 3 % (1.8 to 1.9 cm on this size) without it.
      expect(f.params.hangStretch).toBeCloseTo(0.003, 9);
      expect(t.lengthCm - row.lengthCm, tag).toBeGreaterThan(-0.5);
      expect(t.lengthCm - row.lengthCm, tag).toBeLessThan(1.1);
      expect(strainQuantile(f.cloth, 0.99), tag).toBeLessThan(0.1);
      hems.push(pom.base.hem.reduce((s, i) => s + f.cloth.pos[3 * i + 1]!, 0) / pom.base.hem.length + plan.garmentLiftCm);
    }
    // The garment keeps its length and hangs from the shoulders: the hem is about 9.6 cm lower on the short body and higher on the tall one.
    expect(hems[0]! - hems[1]!).toBeGreaterThan(8);
    expect(hems[2]! - hems[0]!).toBeGreaterThan(8);
  }, 300_000);
});
