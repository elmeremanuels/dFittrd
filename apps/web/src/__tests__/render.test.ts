import { describe, expect, it } from 'vitest';
import { computeFit, fitGapsForRender } from '@paskamer/fit-engine';
import { MOCK_GARMENTS, MOCK_GARMENTS_BY_ID, type UserBody } from '@paskamer/schema';
import { adjustColor, bodyGeometry, fabricLook, garmentGeometry, levelY, VIEW_W } from '@/render/body';
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

  it('draws a human-proportioned body whose widths scale with stature (handoff §9 recognition test)', () => {
    const body = bodyGeometry(REF.measurements, 168);
    // 88 cm bust ≈ 33 cm across; shoulders only a little wider; the head ≈ 15 cm across; neck narrower than the torso
    expect(body.bustHalf).toBeGreaterThan(body.neckHalf * 2);
    expect(body.bustHalf / body.shoulderHalf).toBeGreaterThan(0.7);
    expect(body.bustHalf / body.shoulderHalf).toBeLessThan(1.05);
    expect(body.headR * 2).toBeLessThan(body.shoulderHalf * 2 * 0.6);
    expect(body.hipHalf).toBeGreaterThan(body.waistHalf);
    expect(body.waistHalf).toBeLessThan(body.bustHalf);
    expect(body.thighHalf * 2).toBeLessThan(body.hipHalf * 1.2);
    // same girths on a taller frame are narrower in px (fewer px per cm), never a fixed px count
    const tall = bodyGeometry(REF.measurements, 190);
    expect(tall.bustHalf).toBeLessThan(body.bustHalf);
    expect(tall.bustHalf).toBeGreaterThan(body.bustHalf * 0.8);
  });

  it('each size step is visibly wider than the previous one at the bust (handoff §9 size test)', () => {
    const g = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    const fit = computeFit(g, REF);
    const body = bodyGeometry(REF.measurements, 168);
    const bust = fit.perSize.map((s) => garmentGeometry({ garment: g, gaps: fitGapsForRender(fit, s.size), body }).widths.bustHalf);
    for (let i = 1; i < bust.length; i++) expect(bust[i]! - bust[i - 1]!, `${fit.perSize[i]!.size} vs ${fit.perSize[i - 1]!.size}`).toBeGreaterThanOrEqual(0.0075 * VIEW_W);
    const xs = bust[0]!;
    const l = bust[bust.length - 1]!;
    expect((l - xs) / xs).toBeGreaterThanOrEqual(0.05);
    // a tight size never draws narrower than the body it is on (fabric clings; it cannot shrink the body)
    expect(xs).toBeGreaterThanOrEqual(body.bustHalf);
  });

  it('draws an accessory as what it is: belt at the waist, hat on the head, socks at the ankles, scarf at the neck', () => {
    const body = bodyGeometry(REF.measurements, 168);
    const ys = (d: string): number[] => [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
    const span = (id: string) => {
      const g = MOCK_GARMENTS_BY_ID[id]!;
      const geom = garmentGeometry({ garment: g, gaps: fitGapsForRender(computeFit(g, REF)), body });
      const all = [geom.path, ...geom.extra].flatMap(ys);
      return { min: Math.min(...all), max: Math.max(...all), geom };
    };
    const belt = span('haven-01');
    expect(belt.min).toBeGreaterThan(levelY('bust'));
    expect(belt.max).toBeLessThan(levelY('hip'));
    const hat = span('haven-03');
    expect(hat.max).toBeLessThan(levelY('shoulder'));
    const socks = span('haven-05');
    expect(socks.min).toBeGreaterThan(levelY('calf'));
    const scarf = span('haven-02');
    expect(scarf.min).toBeLessThan(levelY('shoulder'));
    expect(scarf.max).toBeLessThan(levelY('hip'));
    const bag = span('haven-04');
    expect(bag.geom.path).not.toBe(belt.geom.path);
    // belt sizes are waist sizes: a bigger belt is a longer (looser) band
    const g = MOCK_GARMENTS_BY_ID['haven-01']!;
    const fit = computeFit(g, REF);
    const paths = new Set(fit.perSize.map((s) => garmentGeometry({ garment: g, gaps: fitGapsForRender(fit, s.size), body }).path));
    expect(paths.size).toBe(fit.perSize.length);
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

  it('fibre alone changes the look: linen, wool and silk differ at the same weight and drape (handoff §9 fabric test)', () => {
    const at = (primary: string) => fabricLook({ primary, weightGsm: 200, stretchPct: 0, drape: 0.6 } as Parameters<typeof fabricLook>[0]);
    const looks = ['linen', 'wool', 'silk', 'denim'].map((p) => {
      const { label: _label, ...rest } = at(p);
      return JSON.stringify(rest);
    });
    expect(new Set(looks).size).toBe(looks.length);
    // linen reads slubby (anisotropic grain), wool fuzzier (more relief) and silk smoother than both
    expect(at('linen').grain).toBeLessThan(at('wool').grain);
    expect(at('wool').surfaceScale).toBeGreaterThan(at('linen').surfaceScale);
    expect(at('silk').surfaceScale).toBeLessThan(at('linen').surfaceScale);
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
