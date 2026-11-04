import { describe, expect, it } from 'vitest';
import { computeFit, fitGapsForRender } from '@paskamer/fit-engine';
import { MOCK_GARMENTS, MOCK_GARMENTS_BY_ID, type UserBody } from '@paskamer/schema';
import { adjustColor, bodyGeometry, fabricLook, garmentGeometry } from '@/render/body';
import { resolveSwipe } from '@/components/Card';
import { extractToken } from '@/routes/PairRoute';
import { seasonKey } from '@/lib/season';

const REF: UserBody = { measurements: { bust: 88, waist: 70, hip: 96 } };

describe('render path B v0', () => {
  it('S / M / L of the same garment on the same body read as tight / fits / loose', () => {
    const g = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    const fit = computeFit(g, REF);
    const body = bodyGeometry(REF.measurements, 168);
    const widths = fit.perSize.map((s) => {
      const geom = garmentGeometry({ garment: g, gaps: fitGapsForRender(fit, s.size), body });
      const m = /C [^C]*?(\d+\.\d),(\d+\.\d) /.exec(geom.path);
      return { size: s.size, strain: geom.strain.length, tightest: geom.tightestCm, loosest: geom.loosestCm, path: geom.path, m };
    });
    const xs = widths[0]!;
    const l = widths[widths.length - 1]!;
    expect(xs.tightest).toBeLessThan(l.tightest);
    expect(xs.strain).toBeGreaterThan(0); // XS pulls
    expect(l.strain).toBe(0); // L does not
    expect(l.loosest).toBeGreaterThan(xs.loosest);
    expect(new Set(widths.map((w) => w.path)).size).toBe(widths.length); // every size draws differently
  });

  it('has a garment outline for all six categories and a hem from lengthCm scaled by height', () => {
    const body = bodyGeometry(REF.measurements, 168);
    for (const g of MOCK_GARMENTS) {
      const fit = computeFit(g, REF);
      const geom = garmentGeometry({ garment: g, gaps: fitGapsForRender(fit), body });
      expect(geom.path.length, g.id).toBeGreaterThan(10);
    }
    const dress = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    const short = garmentGeometry({ garment: { ...dress, lengthCm: { shoulder_to_hem: 80 } }, gaps: null, body });
    const long = garmentGeometry({ garment: { ...dress, lengthCm: { shoulder_to_hem: 120 } }, gaps: null, body });
    expect(long.hemY).toBeGreaterThan(short.hemY);
    const tall = bodyGeometry(REF.measurements, 190);
    expect(garmentGeometry({ garment: { ...dress, lengthCm: { shoulder_to_hem: 120 } }, gaps: null, body: tall }).hemY).toBeLessThan(long.hemY);
  });

  it('fabric look differs between linen, wool and silk', () => {
    const linen = fabricLook({ primary: 'linen', weightGsm: 240, stretchPct: 2, drape: 0.78 });
    const wool = fabricLook({ primary: 'wool', weightGsm: 420, stretchPct: 5, drape: 0.4 });
    const silk = fabricLook({ primary: 'silk', weightGsm: 120, stretchPct: 0, drape: 0.95 });
    expect(silk.specular).toBeGreaterThan(linen.specular);
    expect(wool.surfaceScale).toBeGreaterThan(silk.surfaceScale);
    expect(silk.baseFrequency).toBeGreaterThan(wool.baseFrequency);
    expect(silk.blur).toBeGreaterThan(wool.blur);
  });

  it('adjustColor handles #RGB, invalid input and clamps', () => {
    expect(adjustColor('#fff', -15)).toBe('#f0f0f0');
    expect(adjustColor('#000000', -10)).toBe('#000000');
    expect(adjustColor('nope', 0)).toBe('#dfc3a8');
    expect(adjustColor('#C97A4F', 0)).toBe('#c97a4f');
  });
});

describe('helpers', () => {
  it('resolves the dominant swipe axis first', () => {
    expect(resolveSwipe({ x: 120, y: 100 })).toBe('love');
    expect(resolveSwipe({ x: -120, y: 100 })).toBe('pass');
    expect(resolveSwipe({ x: 80, y: -120 })).toBe('save');
    expect(resolveSwipe({ x: 80, y: 120 })).toBe('less');
    expect(resolveSwipe({ x: 40, y: 30 })).toBeNull();
  });
  it('extracts try tokens from links and codes', () => {
    expect(extractToken('https://app.paskamer.app/try/abc.def-ghi')).toBe('abc.def-ghi');
    expect(extractToken('mock:aalter-studio-1')).toBe('mock:aalter-studio-1');
    expect(extractToken('hello world')).toBeNull();
  });
  it('maps capture seasons to taste-engine keys', () => {
    expect(seasonKey('warm autumn')).toBe('trueAutumn');
    expect(seasonKey('trueAutumn')).toBe('trueAutumn');
    expect(seasonKey('mauve')).toBeNull();
  });
});
