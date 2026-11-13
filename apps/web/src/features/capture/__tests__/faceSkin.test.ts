import { describe, expect, it } from 'vitest';
import { FACE_REGIONS, SEG } from '../landmarks';
import {
  MONK_ITA_THRESHOLDS,
  chroma,
  dominantSkinCluster,
  estimateSkin,
  hueAngle,
  ita,
  kMeansLab,
  labToSrgb,
  monkFromIta,
  rgbToHex,
  sampleClassLab,
  sampleSkinLab,
  seasonEstimate,
  srgbToLab,
  undertoneFromLab,
} from '../faceSkin';
import type { Landmark } from '../types';

describe('colour conversions', () => {
  it('sRGB → Lab on reference colours', () => {
    const white = srgbToLab(255, 255, 255);
    expect(white.L).toBeCloseTo(100, 2);
    expect(Math.abs(white.a)).toBeLessThan(0.02);
    expect(Math.abs(white.b)).toBeLessThan(0.02);
    const red = srgbToLab(255, 0, 0);
    expect(red.L).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
    expect(red.b).toBeCloseTo(67.2, 1);
    const grey = srgbToLab(128, 128, 128);
    expect(grey.L).toBeCloseTo(53.59, 1);
    expect(srgbToLab(0, 0, 0).L).toBeCloseTo(0, 6);
  });

  it('round-trips Lab → sRGB', () => {
    for (const [r, g, b] of [[224, 172, 105], [60, 40, 30], [245, 222, 196]] as const) {
      const back = labToSrgb(srgbToLab(r, g, b));
      expect(Math.abs(back.r - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - b)).toBeLessThanOrEqual(1);
    }
    expect(rgbToHex(255, 90, 60)).toBe('#FF5A3C');
  });
});

describe('ITA → Monk', () => {
  it('maps each published band to its class', () => {
    expect(monkFromIta(85)).toBe(1);
    expect(monkFromIta(78)).toBe(2);
    expect(monkFromIta(70)).toBe(3);
    expect(monkFromIta(60)).toBe(4);
    expect(monkFromIta(40)).toBe(5);
    expect(monkFromIta(10)).toBe(6);
    expect(monkFromIta(-20)).toBe(7);
    expect(monkFromIta(-50)).toBe(8);
    expect(monkFromIta(-75)).toBe(9);
    expect(monkFromIta(-90)).toBe(10);
    expect(MONK_ITA_THRESHOLDS).toEqual([81.62, 75.99, 68.24, 57.53, 30.61, -4.63, -37.77, -66.87, -81.33]);
  });

  it('computes ITA with atan2 (negative b* safe) and classifies known skin colours', () => {
    expect(ita({ L: 50, a: 0, b: 10 })).toBeCloseTo(0, 6);
    expect(ita({ L: 70, a: 0, b: -10 })).toBeCloseTo(116.57, 1);
    const light = srgbToLab(245, 222, 196);
    expect(monkFromIta(ita(light))).toBeLessThanOrEqual(3);
    const medium = srgbToLab(198, 134, 66);
    expect([5, 6]).toContain(monkFromIta(ita(medium)));
    const dark = srgbToLab(60, 40, 30);
    expect(monkFromIta(ita(dark))).toBeGreaterThanOrEqual(8);
  });
});

describe('undertone and season', () => {
  it('derives undertone from the hue angle', () => {
    expect(undertoneFromLab({ L: 70, a: 10, b: 25 })).toBe('warm'); // h ≈ 68°
    expect(undertoneFromLab({ L: 70, a: 20, b: 18 })).toBe('cool'); // h ≈ 42°
    expect(undertoneFromLab({ L: 70, a: 15, b: 18 })).toBe('neutral'); // h ≈ 50°, ratio 1.2
    expect(hueAngle({ L: 0, a: 0, b: 1 })).toBeCloseTo(90, 6);
    expect(chroma({ L: 0, a: 3, b: 4 })).toBe(5);
  });

  it('season estimate is labelled and follows the axes', () => {
    const warmLight = seasonEstimate({ L: 72, a: 10, b: 26 }, { L: 55, a: 5, b: 15 });
    expect(warmLight.label).toBe('estimate');
    expect(warmLight.axes.undertone).toBe('warm');
    expect(warmLight.axes.value).toBe('light');
    expect(warmLight.season).toMatch(/spring/);
    const coolDeep = seasonEstimate({ L: 35, a: 14, b: 12 }, { L: 10, a: 0, b: 0 });
    expect(coolDeep.axes.undertone).toBe('cool');
    expect(coolDeep.season).toMatch(/winter/);
    const warmDeep = seasonEstimate({ L: 40, a: 12, b: 24 }, { L: 20, a: 5, b: 8 });
    expect(warmDeep.season).toMatch(/autumn/);
    const coolLight = seasonEstimate({ L: 70, a: 16, b: 14 }, null);
    expect(coolLight.season).toMatch(/summer/);
    expect(Object.keys(warmLight.scores)).toHaveLength(12);
  });
});

describe('k-means / dominant cluster', () => {
  it('separates three well-separated groups and picks the mid-lightness majority', () => {
    const pts = [
      ...Array.from({ length: 40 }, (_, i) => ({ L: 65 + (i % 3), a: 12, b: 20 })), // skin
      ...Array.from({ length: 10 }, (_, i) => ({ L: 95 + (i % 2), a: 0, b: 2 })), // highlights
      ...Array.from({ length: 15 }, (_, i) => ({ L: 30 + (i % 2), a: 8, b: 10 })), // shadow
    ];
    const clusters = kMeansLab(pts, 3);
    expect(clusters.reduce((s, c) => s + c.count, 0)).toBe(65);
    const dom = dominantSkinCluster(pts)!;
    expect(dom.L).toBeGreaterThan(60);
    expect(dom.L).toBeLessThan(70);
    expect(dominantSkinCluster([])).toBeNull();
    expect(kMeansLab([{ L: 1, a: 1, b: 1 }], 5)).toHaveLength(1);
  });
});

describe('pixel sampling', () => {
  const W = 64;
  const Hh = 64;
  const img = { width: W, height: Hh, data: new Uint8ClampedArray(W * Hh * 4) };
  const mask = { width: W, height: Hh, data: new Uint8Array(W * Hh) };
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const skin = x < 32;
      img.data[o] = skin ? 224 : 20;
      img.data[o + 1] = skin ? 172 : 20;
      img.data[o + 2] = skin ? 105 : 20;
      img.data[o + 3] = 255;
      mask.data[y * W + x] = skin ? SEG.FACE_SKIN : SEG.HAIR;
    }
  }
  const lm: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.25, y: 0.5 }));
  lm[FACE_REGIONS.leftCheek[0]] = { x: 0.75, y: 0.5 }; // one landmark on the hair side

  it('keeps only face-skin pixels and ignores landmarks outside the mask', () => {
    const samples = sampleSkinLab(img, lm, [FACE_REGIONS.leftCheek[0], FACE_REGIONS.forehead[0]], mask, 3);
    expect(samples.length).toBeGreaterThan(20);
    for (const s of samples) expect(s.L).toBeGreaterThan(60);
    const hair = sampleClassLab(img, mask, SEG.HAIR, 8);
    expect(hair.length).toBeGreaterThan(0);
    for (const s of hair) expect(s.L).toBeLessThan(15);
    const est = estimateSkin(samples, hair)!;
    expect(est.isEstimate).toBe(true);
    expect(est.srgbHex).toBe('#E0AC69');
    expect(est.undertone).toBe('warm');
    expect([4, 5, 6]).toContain(est.monk);
    expect(est.hairHex).toBeDefined();
    expect(est.season.axes.contrast).toBe('high');
    expect(estimateSkin([])).toBeNull();
  });
});
