/**
 * The POM tee's UVs and print (slice M3, defect 5 of the M3 report) and its rounded shoulders (defect 4), on the SYNTHETIC
 * men's test tee (not a product).
 */
import { describe, expect, it } from 'vitest';
import { MALE_REFERENCE, buildBody, buildMannequin, familyShape } from '@curtain/mannequin';
import { POM_PANELS, buildPomTee, shoulderSeamBumpCm } from './pomTee';
import { SYNTHETIC_TEE_POM } from './pomTeeSynthetic';
import { flatLayPainter, paintAtlas, sampleFlatLay, teeUvLayout } from './pomUv';
import { PRINT_BACKGROUND, stripePrint, syntheticFlatLay } from './pomPrint';

const male = buildMannequin(familyShape('male', 'M')!);
const m = SYNTHETIC_TEE_POM.find((r) => r.size === 'M')!;
const tee = buildPomTee(male, m);
const layout = teeUvLayout(tee);

describe('POM tee UVs', () => {
  it('cuts the tee into four pattern pieces: the welded vertices first, a copy per extra panel and at each sleeve’s underarm', () => {
    const n = tee.mesh.positions.length / 3;
    for (let i = 0; i < n; i++) expect(layout.remap[i]).toBe(i);
    expect(layout.remap.length).toBeGreaterThan(n);
    // Every render triangle is the welded triangle it came from.
    for (let k = 0; k < layout.indices.length; k++) expect(layout.remap[layout.indices[k]!]).toBe(tee.mesh.indices[k]);
    // One panel per triangle's three corners.
    for (let t = 0; t < layout.indices.length; t += 3) {
      const p = layout.panelOf[layout.indices[t]!];
      expect(layout.panelOf[layout.indices[t + 1]!]).toBe(p);
      expect(layout.panelOf[layout.indices[t + 2]!]).toBe(p);
      expect(p).toBe(tee.triPanel[t / 3]);
    }
    expect(layout.islands.map((i) => i.panel)).toEqual([...POM_PANELS]);
  });

  it('flattens every piece without a fold, close to its lengths on the garment, at one scale in a 1024 px atlas', () => {
    for (let t = 0; t < layout.indices.length; t += 3) {
      const [a, b, c] = [layout.indices[t]!, layout.indices[t + 1]!, layout.indices[t + 2]!];
      const f = layout.patternCm;
      const area = (f[2 * b]! - f[2 * a]!) * (f[2 * c + 1]! - f[2 * a + 1]!) - (f[2 * c]! - f[2 * a]!) * (f[2 * b + 1]! - f[2 * a + 1]!);
      expect(area).toBeLessThan(0);
    }
    // Measured: body pieces 0.95 … 1.10 / 1.14 (1st / 99th percentile of flat ÷ garment edge length), sleeves 0.85 … 1.30.
    for (const p of ['front', 'back'] as const) {
      expect(Math.abs(layout.distortion[p].median - 1)).toBeLessThan(0.01);
      expect(layout.distortion[p].p01).toBeGreaterThan(0.9);
      expect(layout.distortion[p].p99).toBeLessThan(1.2);
    }
    for (const p of ['sleeve_l', 'sleeve_r'] as const) {
      expect(layout.distortion[p].p01).toBeGreaterThan(0.8);
      expect(layout.distortion[p].p99).toBeLessThan(1.35);
    }
    for (let k = 0; k < layout.uvs.length; k++) {
      expect(layout.uvs[k]).toBeGreaterThan(0);
      expect(layout.uvs[k]).toBeLessThan(1);
    }
    expect(layout.sizePx).toBe(1024);
    expect(layout.pxPerCm).toBeGreaterThan(8);
  });

  it('lays the front and back flat at about the chest width across, centred on the centre line, the HPS at v = 0, the sleeves as mirror images', () => {
    const [front, back, sl, sr] = layout.islands;
    // Measured 55.1 and 53.8 cm across (the chest width is 53: the flattened shoulders are a little wider).
    for (const isl of [front!, back!]) {
      expect(isl.max[0] - isl.min[0]).toBeGreaterThan(2 * m.chestWidthCm / 2 - 1);
      expect(isl.max[0] - isl.min[0]).toBeLessThan(m.chestWidthCm + 3);
      expect(Math.abs(isl.max[0] + isl.min[0])).toBeLessThan(1);
      expect(isl.min[1]).toBeCloseTo(0, 0);
    }
    expect(sl!.max[0] - sl!.min[0]).toBeCloseTo(sr!.max[0] - sr!.min[0], 1);
    expect(sl!.max[1] - sl!.min[1]).toBeCloseTo(sr!.max[1] - sr!.min[1], 1);
    // The front is longer than the back below the HPS (the front neck drops 9 cm, the back 2): the neckline is a hole in v.
    const neckV = (panel: number): number => {
      let v = Infinity;
      for (let r = 0; r < layout.remap.length; r++) if (layout.panelOf[r] === panel && Math.abs(tee.mesh.positions[3 * layout.remap[r]!]!) < 1e-6 && tee.mesh.positions[3 * layout.remap[r]! + 1]! > tee.levels.armholeY + 3) v = Math.min(v, layout.patternCm[2 * r + 1]!);
      return v;
    };
    expect(neckV(0) - neckV(1)).toBeGreaterThan(5);
  });

  it('paints the atlas from pattern cm: a flat-lay photo onto front and back by its scale and HPS, a repeating print onto the sleeves', () => {
    const flat = syntheticFlatLay(8);
    // The photo sampled at a pattern point is the photo's pixel at the calibrated place.
    const c = sampleFlatLay(flat.front.photo, flat.front.cal, 9, 17);
    expect(c).toEqual([0xff, 0x5a, 0x3c]);
    const img = paintAtlas(layout, flatLayPainter(flat.front, flat.back, stripePrint()), PRINT_BACKGROUND);
    expect(img.length).toBe(1024 * 1024 * 3);
    // The sun is on the front piece only: coral texels inside the front island, none inside the back's.
    const coral = (isl: (typeof layout.islands)[number]): number => {
      let k = 0;
      const S = layout.sizePx;
      for (let y = Math.floor(isl.originPx[1]); y < isl.originPx[1] + (isl.max[1] - isl.min[1]) * layout.pxPerCm; y++)
        for (let x = Math.floor(isl.originPx[0]); x < isl.originPx[0] + (isl.max[0] - isl.min[0]) * layout.pxPerCm; x++) if (img[3 * (y * S + x)] === 0xff && img[3 * (y * S + x) + 1] === 0x5a) k++;
      return k;
    };
    expect(coral(layout.islands[0]!)).toBeGreaterThan(1000);
    expect(coral(layout.islands[2]!)).toBe(0);
  });
});

describe('POM tee shoulders (defect 4)', () => {
  it('the shoulder seam falls from the HPS to the shoulder point without a bump, every size on its own table body', () => {
    // Measured bumps 0.05 / 0.14 / 0.22 / 0.40 / 0.54 cm (before the yoke was smoothed: 0.88 / 1.13 / 1.21 / 1.48 / 1.76,
    // the seam riding over the arm's closing cone).
    SYNTHETIC_TEE_POM.forEach((row, i) => {
      const t = MALE_REFERENCE[row.size as keyof typeof MALE_REFERENCE];
      const body = buildBody({ family: 'male', bust: t.chest, waist: t.waist, hip: t.hip, heightCm: t.stature, shoulderCm: t.shoulderWidth });
      expect(shoulderSeamBumpCm(buildPomTee(body, row, { sizeStep: i - 1 })), row.size).toBeLessThan(0.6);
    });
    expect(shoulderSeamBumpCm(tee)).toBeLessThan(0.2);
  });
});
