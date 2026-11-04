import { describe, expect, it } from 'vitest';
import {
  COLOUR_MATCH,
  SEASONS,
  SEASON_TABLE,
  chroma,
  colourChipLabel,
  colourMatch,
  colourMatchScore,
  deltaE2000,
  hexToLab,
  hueAngle,
  nearestSwatch,
  paletteProximity,
  undertoneAgreement,
  type Lab,
} from './colourHarmony';
import { parseHex } from './colour';

const lab = (hex: string): Lab => hexToLab(hex) as Lab;

describe('hex → CIELAB (D65)', () => {
  it('white is (100, 0, 0) and black is (0, 0, 0)', () => {
    const w = lab('#FFFFFF');
    expect(w.L).toBeCloseTo(100, 3);
    expect(w.a).toBeCloseTo(0, 3);
    expect(w.b).toBeCloseTo(0, 3);
    expect(lab('#000000')).toEqual({ L: 0, a: 0, b: 0 });
  });
  it('sRGB primaries land near the published Lab values', () => {
    const red = lab('#FF0000');
    expect(red.L).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
    expect(red.b).toBeCloseTo(67.2, 1);
    const blue = lab('#0000FF');
    expect(blue.L).toBeCloseTo(32.3, 1);
    expect(blue.a).toBeCloseTo(79.19, 1);
    expect(blue.b).toBeCloseTo(-107.86, 1);
    const green = lab('#00FF00');
    expect(green.L).toBeCloseTo(87.73, 1);
  });
  it('mid grey is achromatic', () => {
    const g = lab('#808080');
    expect(g.L).toBeCloseTo(53.59, 1);
    expect(chroma(g)).toBeLessThan(0.01);
    expect(hexToLab('zzz')).toBeNull();
  });
  it('terracotta is a warm (orange) hue in Lab', () => {
    const t = lab('#C97A4F');
    expect(hueAngle(t)).toBeGreaterThan(40);
    expect(hueAngle(t)).toBeLessThan(75);
    expect(chroma(t)).toBeGreaterThan(30);
  });
});

describe('ΔE2000 (Sharma, Wu & Dalal 2005 reference pairs)', () => {
  const pairs: [Lab, Lab, number][] = [
    [{ L: 50, a: 2.6772, b: -79.7751 }, { L: 50, a: 0, b: -82.7485 }, 2.0425],
    [{ L: 50, a: 3.1571, b: -77.2803 }, { L: 50, a: 0, b: -82.7485 }, 2.8615],
    [{ L: 50, a: 2.8361, b: -74.02 }, { L: 50, a: 0, b: -82.7485 }, 3.4412],
    [{ L: 50, a: -1.3802, b: -84.2814 }, { L: 50, a: 0, b: -82.7485 }, 1.0],
    [{ L: 50, a: 0, b: 0 }, { L: 50, a: -1, b: 2 }, 2.3669],
    [{ L: 50, a: 2.49, b: -0.001 }, { L: 50, a: -2.49, b: 0.0009 }, 7.1792],
    [{ L: 50, a: 2.5, b: 0 }, { L: 50, a: 0, b: -2.5 }, 4.3065],
    [{ L: 50, a: 2.5, b: 0 }, { L: 73, a: 25, b: -18 }, 27.1492],
    [{ L: 50, a: 2.5, b: 0 }, { L: 61, a: -5, b: 29 }, 22.8977],
    [{ L: 50, a: 2.5, b: 0 }, { L: 56, a: -27, b: -3 }, 31.903],
    [{ L: 50, a: 2.5, b: 0 }, { L: 58, a: 24, b: 15 }, 19.4535],
    [{ L: 60.2574, a: -34.0099, b: 36.2677 }, { L: 60.4626, a: -34.1751, b: 39.4387 }, 1.2644],
    [{ L: 2.0776, a: 0.0795, b: -1.135 }, { L: 0.9033, a: -0.0636, b: -0.5514 }, 0.9082],
  ];
  it.each(pairs)('%o vs %o → %f', (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 3);
    expect(deltaE2000(b, a)).toBeCloseTo(expected, 3);
  });
  it('is zero for identical colours and positive otherwise', () => {
    expect(deltaE2000(lab('#C97A4F'), lab('#C97A4F'))).toBe(0);
    expect(deltaE2000(lab('#C97A4F'), lab('#1E2B4D'))).toBeGreaterThan(30);
  });
});

describe('12-season table', () => {
  it('has twelve seasons with eight valid swatches each and a documented undertone', () => {
    expect(SEASONS).toHaveLength(12);
    for (const key of SEASONS) {
      const s = SEASON_TABLE[key];
      expect(s.key).toBe(key);
      expect(s.palette).toHaveLength(8);
      expect(['warm', 'cool', 'neutral']).toContain(s.undertone);
      expect(s.label.length).toBeGreaterThan(0);
      for (const sw of s.palette) expect(parseHex(sw.hex)).not.toBeNull();
      expect(Object.isFrozen(s)).toBe(true);
      expect(Object.isFrozen(s.palette)).toBe(true);
    }
    expect(SEASONS.filter((k) => SEASON_TABLE[k].family === 'spring')).toHaveLength(3);
    expect(SEASONS.filter((k) => SEASON_TABLE[k].family === 'winter')).toHaveLength(3);
  });
  it('terracotta is a True Autumn swatch', () => {
    const n = nearestSwatch(lab('#C97A4F'), 'trueAutumn');
    expect(n.swatch.name).toBe('terracotta');
    expect(n.deltaE).toBe(0);
  });
});

describe('undertoneAgreement', () => {
  it('warm hues agree with warm, disagree with cool; achromatic is neutral', () => {
    const terracotta = lab('#C97A4F');
    expect(undertoneAgreement(terracotta, 'warm')).toBeGreaterThan(0.9);
    expect(undertoneAgreement(terracotta, 'cool')).toBeLessThan(0.1);
    // 'neutral' is bounded to 0.5..1: a strongly warm hue is merely Neutral, never a clash.
    expect(undertoneAgreement(terracotta, 'neutral')).toBeCloseTo(0.5, 1);
    expect(undertoneAgreement(lab('#8A9A7B'), 'neutral')).toBeGreaterThan(0.75); // muted sage sits between warm and cool
    const indigo = lab('#1E2B4D');
    expect(undertoneAgreement(indigo, 'cool')).toBeGreaterThan(0.66);
    expect(undertoneAgreement(indigo, 'warm')).toBeLessThan(0.34);
    expect(undertoneAgreement(lab('#808080'), 'warm')).toBe(0.5);
    expect(undertoneAgreement(lab('#808080'), 'cool')).toBe(0.5);
    expect(undertoneAgreement(lab('#808080'), 'neutral')).toBe(0.5);
  });
  it('is symmetric: warm + cool = 1 for any colour', () => {
    for (const hex of ['#C97A4F', '#1E2B4D', '#6DBE45', '#FF2E88', '#F2E6CF']) {
      expect(undertoneAgreement(lab(hex), 'warm') + undertoneAgreement(lab(hex), 'cool')).toBeCloseTo(1, 10);
    }
  });
});

describe('colourMatchScore / chip label', () => {
  it('thresholds', () => {
    expect(colourChipLabel(0.66)).toBe('Great with your undertone');
    expect(colourChipLabel(0.5)).toBe('Neutral');
    expect(colourChipLabel(0.34)).toBe('Clashes');
    expect(paletteProximity(COLOUR_MATCH.paletteNearDeltaE)).toBe(1);
    expect(paletteProximity(COLOUR_MATCH.paletteFarDeltaE)).toBe(0);
    expect(paletteProximity((COLOUR_MATCH.paletteNearDeltaE + COLOUR_MATCH.paletteFarDeltaE) / 2)).toBeCloseTo(0.5, 10);
  });
  it('terracotta: great for warm / True Autumn, clashes for cool / True Winter', () => {
    expect(colourMatch('#C97A4F', 'warm').label).toBe('Great with your undertone');
    expect(colourMatch('#C97A4F', 'cool').label).toBe('Clashes');
    expect(colourMatchScore('#C97A4F', 'trueAutumn')).toBeGreaterThan(0.99);
    expect(colourMatch('#C97A4F', 'trueAutumn').nearestSwatch?.name).toBe('terracotta');
    const winter = colourMatch('#C97A4F', 'trueWinter');
    expect(winter.label).toBe('Clashes');
    expect(winter.score).toBeLessThan(colourMatchScore('#C97A4F', 'trueAutumn'));
    expect(winter.undertone).toBe('cool');
  });
  it('indigo denim suits the cool / deep seasons more than the warm ones', () => {
    expect(colourMatchScore('#1E2B4D', 'deepWinter')).toBeGreaterThan(colourMatchScore('#1E2B4D', 'trueSpring'));
    expect(colourMatchScore('#1E2B4D', 'cool')).toBeGreaterThan(colourMatchScore('#1E2B4D', 'warm'));
    expect(colourMatch('#1E2B4D', 'deepWinter').nearestSwatch?.name).toBe('navy');
  });
  it('a mid grey is Neutral against every undertone', () => {
    for (const u of ['warm', 'cool', 'neutral'] as const) expect(colourMatch('#8E8E93', u).label).toBe('Neutral');
    expect(colourMatch('#8E8E93', 'softSummer').label).toBe('Great with your undertone'); // pewter is a Soft Summer swatch
  });
  it('a malformed hex is Neutral with no swatch', () => {
    const m = colourMatch('not-a-colour', 'trueSpring');
    expect(m).toMatchObject({ score: 0.5, label: 'Neutral', deltaE: null, nearestSwatch: null, lab: null, undertone: 'warm' });
  });
  it('scores are in 0..1 for every season and a spread of garment colours', () => {
    for (const hex of ['#C97A4F', '#EAEAEA', '#1E2B4D', '#FF5A3C', '#111111', '#F2EBDD', '#8A9A7B']) {
      for (const s of SEASONS) {
        const v = colourMatchScore(hex, s);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
