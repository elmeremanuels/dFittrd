/**
 * The one not-drawn rule (`notDrawn.ts`) on every garment the 3D view shows: the tape-built dress, the azure dress and
 * the photo skirt (reconstructed bundles, device drape), the POM skirt bake, the men's tee and the men's chino. For each:
 * a size the fit engine blocks on the body is declared with its point and shortfall, a size that is only snug, tight
 * with room left, roomy or loose is not, and every chart body's own size is drawn (no change where a size fits).
 *
 * The rule reads the FitResult only, so the reconstructed bundles that are git-ignored (azure dress, photo skirt, the
 * skirt's server bake) are covered through their real payloads; the dress and the lofted stand-in are also loaded as
 * bundles, to pin that the device path asks the rule for the bundle's own size labels and no longer for `sewn`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeFit, fitGapsForRender, type FitResult } from '@curtain/fit-engine';
import { MALE_BODY_SHAPE_IDS, MALE_REFERENCE } from '@curtain/mannequin';
import { AU_WOMENS_BODY_CHART, MOCK_GARMENTS_BY_ID, PILOT_PULL_ON_SKIRT, SYNTHETIC_MENS_TEE, type GarmentPayload } from '@curtain/schema';
import { buildBundle } from '../../../spikes/garment-engine/src/bundle';
import { SYNTHETIC_CHINO_PAYLOAD } from '../../../spikes/garment-engine/src/pomChinoSynthetic';
import { buildPomDressBundle } from '../../../spikes/garment-engine/src/pomDressBundle';
import { SYNTHETIC_DRESS_ID, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE, SYNTHETIC_TAPE_DRESS } from '../../../spikes/garment-engine/src/pomDressSynthetic';
import { buildShopPayload, type ShopifyProduct } from '../../../spikes/garment-engine/src/shop';
import { loadBundleFrom, type FetchLike } from './bundle';
import { checkBundle } from './bundleCheck';
import { openSession, sewnNotDrawn } from './engine';
import { planAvatar } from './mount';
import { notDrawnSizes, sizeNotDrawn } from './notDrawn';

const serve = (files: Record<string, string | Uint8Array>): FetchLike => async (url) => {
  const data = files[url.split('/').pop()!]!;
  return { ok: true, status: 200, json: async () => JSON.parse(data as string) as unknown, arrayBuffer: async () => { const u = data as Uint8Array; return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer; } };
};
const AU = AU_WOMENS_BODY_CHART.filter((r) => ['8', '10', '12', '14', '16'].includes(r.size));
const auBody = (size: string) => {
  const r = AU.find((x) => x.size === size)!;
  return { measurements: { bust: r.bust!, waist: r.waist!, hip: r.hip! } };
};
const maleBody = (id: keyof typeof MALE_REFERENCE) => {
  const t = MALE_REFERENCE[id];
  return { measurements: { bust: t.chest, waist: t.waist, hip: t.hip, thigh: t.thigh, inseam: t.inseam }, heightCm: t.stature };
};
const labels = (fit: FitResult): string[] => fit.perSize.map((s) => s.size);
const blocked = (fit: FitResult): string[] => Object.keys(notDrawnSizes(fit, labels(fit)));

/** The azure babydoll's payload as the shop import builds it (the reconstructed bundle itself is git-ignored). */
const AZURE = buildShopPayload((JSON.parse(readFileSync(new URL('../../../spikes/garment-engine/data/bohohippychic/fixtures/products.sample.json', import.meta.url), 'utf8')) as { products: ShopifyProduct[] }).products.find((p) => p.handle === 'azure-palm-baby-doll-dress')!).payload as GarmentPayload;

describe('the one not-drawn rule, per garment', () => {
  describe.each([
    ['the tape-built dress (DEMO_DRESS=1)', SYNTHETIC_TAPE_DRESS],
    ['the azure dress (reconstructed bundle, device drape)', AZURE],
  ] as const)('%s: a woven dress, the bust cannot give', (_name, dress) => {
    it('every AU chart body in its own size is drawn, and so is one size down (tight, but it closes)', () => {
      AU.forEach((row, i) => {
        const fit = computeFit(dress, auBody(row.size));
        expect(fit.recommendedSize).toBe(row.size);
        expect(sizeNotDrawn(fit, row.size), `body ${row.size} in its own size`).toBeNull();
        const down = AU[i - 1]?.size;
        if (!down) return;
        // One size down the engine says tight, with 2 cm of the dress left over the bust: it closes, so it is drawn.
        expect(fitGapsForRender(fit, down)).toMatchObject({ bands: { bust: 'tight' }, slackCm: { bust: 2 } });
        expect(sizeNotDrawn(fit, down), `body ${row.size} in ${down}`).toBeNull();
      });
    });
    it('a body two sizes larger is not drawn in it: the bust is 3 cm larger than the dress, 8 cm three sizes down', () => {
      expect(sizeNotDrawn(computeFit(dress, auBody('12')), '8')).toEqual({ anchor: 'chest', bodyLargerCm: 3, reason: 'tight', label: 'bust' });
      const fit = computeFit(dress, auBody('16'));
      expect(notDrawnSizes(fit, labels(fit))).toEqual({
        '8': { anchor: 'chest', bodyLargerCm: 13, reason: 'tight', label: 'bust' },
        '10': { anchor: 'chest', bodyLargerCm: 8, reason: 'tight', label: 'bust' },
        '12': { anchor: 'chest', bodyLargerCm: 3, reason: 'tight', label: 'bust' },
      });
    });
    it('a size too large is drawn (loose is not a block)', () => {
      const fit = computeFit(dress, auBody('8'));
      expect(fitGapsForRender(fit, '16')?.bands.bust).toBe('loose');
      expect(blocked(fit)).toEqual([]);
    });
  });

  it('the tape-built dress as a bundle: the device path blocks the bundle’s own size labels, sewn or not', async () => {
    const pom = buildPomDressBundle(SYNTHETIC_DRESS_ID, SYNTHETIC_TAPE_DRESS, SYNTHETIC_DRESS_POM, SYNTHETIC_DRESS_TAPE.provenance);
    const bundle = await loadBundleFrom(serve(pom.files), '/b', SYNTHETIC_DRESS_ID, { withPayload: false });
    const ok = checkBundle({ anchors: bundle.anchors, grading: bundle.grading, material: bundle.material, qa: bundle.qa }, SYNTHETIC_TAPE_DRESS)!;
    const body = auBody('16');
    const plan = planAvatar(bundle.anchors, body.measurements);
    const session = openSession(plan.m, bundle, SYNTHETIC_TAPE_DRESS);
    // Not a sewn top and not a trouser: before the one rule this dress was draped on any body, in any size.
    expect(session.sewn).toBe(false);
    const fit = computeFit(SYNTHETIC_TAPE_DRESS, body);
    expect(Object.keys(notDrawnSizes(fit, ok.sizes))).toEqual(['8', '10', '12']);
    expect(notDrawnSizes(fit, ok.sizes)['12']).toMatchObject({ anchor: 'chest', bodyLargerCm: 3 });
    // The first name of the rule (the callers of M3 and of the chino slices) gives the same answer.
    expect(sewnNotDrawn(session, plan.avatar, fit, '12')).toEqual({ anchor: 'chest', bodyLargerCm: 3 });
    expect(sewnNotDrawn(session, plan.avatar, fit, '16')).toBeNull();
  }, 120_000);

  it('a reconstructed-style bundle (the lofted aalter-studio-2 dress): blocked at the bust on a larger body, its own size drawn', async () => {
    const garment = MOCK_GARMENTS_BY_ID['aalter-studio-2']!;
    const built = buildBundle('aalter-studio-2', { skipSeparation: true });
    const bundle = await loadBundleFrom(serve(built.files), '/b', 'aalter-studio-2', { withPayload: false });
    const ok = checkBundle({ anchors: bundle.anchors, grading: bundle.grading, material: bundle.material, qa: bundle.qa }, garment)!;
    const large = computeFit(garment, auBody('14'));
    expect(large.recommendedSize).toBe('XL');
    expect(notDrawnSizes(large, ok.sizes)).toEqual({
      XS: { anchor: 'chest', bodyLargerCm: 8, reason: 'tight', label: 'bust' },
      S: { anchor: 'chest', bodyLargerCm: 4, reason: 'tight', label: 'bust' },
    });
    // M and L are tight at bust and waist with room left: the engine does not recommend them, the picture still draws them.
    expect(fitGapsForRender(large, 'L')).toMatchObject({ bands: { bust: 'tight', waist: 'tight' } });
    expect(blocked(computeFit(garment, auBody('8')))).toEqual([]);
  }, 120_000);

  describe('the pull-on skirt (the photo bundle on the device, and the POM server bake): the band over the hips cannot give', () => {
    it('blocks every size whose stretched band the engine says does not pass the hips, at the hips, with the shortfall', () => {
      const fit = computeFit(PILOT_PULL_ON_SKIRT, auBody('14'));
      expect(fit.recommendedSize).toBe('14');
      expect(notDrawnSizes(fit, labels(fit))).toEqual({
        '8': { anchor: 'hip', bodyLargerCm: 15, reason: 'pull-on', label: 'hips' },
        '10': { anchor: 'hip', bodyLargerCm: 9, reason: 'pull-on', label: 'hips' },
        '12': { anchor: 'hip', bodyLargerCm: 4, reason: 'pull-on', label: 'hips' },
      });
      // Exactly the engine's pull-on verdicts, on every chart body: the bake path hid these before, and still does.
      for (const row of AU) {
        const f = computeFit(PILOT_PULL_ON_SKIRT, auBody(row.size));
        expect(blocked(f), `body ${row.size}`).toEqual(f.perSize.filter((s) => s.pullOn?.status === 'blocked').map((s) => s.size));
        expect(sizeNotDrawn(f, row.size), `body ${row.size} in its own size`).toBeNull();
      }
    });
    it('a band that only just passes (marginal) is drawn', () => {
      const fit = computeFit(PILOT_PULL_ON_SKIRT, auBody('12'));
      expect(fit.perSize.find((s) => s.size === '12')?.pullOn?.status).toBe('marginal');
      expect(sizeNotDrawn(fit, '12')).toBeNull();
    });
    it('keys the blocks by the bundle’s spelling of a size, and skips a chart row the bundle does not have', () => {
      const fit = computeFit(PILOT_PULL_ON_SKIRT, auBody('14'));
      expect(Object.keys(notDrawnSizes(fit, [' 8', '10 ', '12', '14'])).sort()).toEqual([' 8', '10 ', '12']);
      expect(notDrawnSizes(fit, ['12', '14', '18'])).toEqual({ '12': { anchor: 'hip', bodyLargerCm: 4, reason: 'pull-on', label: 'hips' } });
    });
  });

  it('the men’s tee: the chest of a sewn jersey top (as before this rule was general)', () => {
    const xxl = computeFit(SYNTHETIC_MENS_TEE, maleBody('XXL'));
    expect(notDrawnSizes(xxl, labels(xxl))).toEqual({
      S: { anchor: 'chest', bodyLargerCm: 25, reason: 'tight', label: 'chest' },
      M: { anchor: 'chest', bodyLargerCm: 17, reason: 'tight', label: 'chest' },
      L: { anchor: 'chest', bodyLargerCm: 9, reason: 'tight', label: 'chest' },
      XL: { anchor: 'chest', bodyLargerCm: 1, reason: 'tight', label: 'chest' },
    });
    for (const id of MALE_BODY_SHAPE_IDS) {
      const fit = computeFit(SYNTHETIC_MENS_TEE, maleBody(id));
      expect(sizeNotDrawn(fit, fit.recommendedSize!), `${id} in its own size`).toBeNull();
    }
    expect(blocked(computeFit(SYNTHETIC_MENS_TEE, maleBody('M')))).toEqual([]);
  });

  it('the men’s chino: the waistband of a woven trouser (as before this rule was general)', () => {
    const xxl = computeFit(SYNTHETIC_CHINO_PAYLOAD, maleBody('XXL'));
    expect(sizeNotDrawn(xxl, '30/32')).toEqual({ anchor: 'waist', bodyLargerCm: 33.7, reason: 'tight', label: 'waist' });
    expect(sizeNotDrawn(xxl, '38/32')).toEqual({ anchor: 'waist', bodyLargerCm: 13.1, reason: 'tight', label: 'waist' });
    expect(sizeNotDrawn(xxl, '44/32')).toBeNull();
    for (const id of MALE_BODY_SHAPE_IDS) {
      const fit = computeFit(SYNTHETIC_CHINO_PAYLOAD, maleBody(id));
      expect(sizeNotDrawn(fit, fit.recommendedSize!), `${id} in its own size`).toBeNull();
    }
  });

  it('no fit result, or a size the result does not know: drawn (the view never invents a block)', () => {
    expect(sizeNotDrawn(null, 'M')).toBeNull();
    expect(notDrawnSizes(undefined, ['S', 'M'])).toEqual({});
    expect(sizeNotDrawn(computeFit(SYNTHETIC_TAPE_DRESS, auBody('16')), '20')).toBeNull();
  });
});
