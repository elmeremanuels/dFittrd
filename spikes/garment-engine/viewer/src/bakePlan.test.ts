import { describe, expect, it } from 'vitest';
import { chartBody, planSizeBodies, pullOnRefusal } from '../scripts/serverdrape/bakeTape';

// The pilot skirt's stretched bands (spikes/garment-engine/data/bohohippychic/tape): AU 8, 10, 14 measured, 12
// interpolated, 16 extrapolated; the chart bodies of the bake (hip 104 + 10 t).
const BANDS: Record<string, { cm: number; source: string }> = {
  '8': { cm: 94, source: 'measured' },
  '10': { cm: 100, source: 'measured' },
  '12': { cm: 105, source: 'interpolated (between AU 10 and 14)' },
  '14': { cm: 110, source: 'measured' },
  '16': { cm: 115, source: 'extrapolated (from AU 10 and 14)' },
};
const CHART = [-1, 0, 1];
const OWN = [-0.5, 0.5];
const plan = (size: string, has: (t: number) => boolean = () => true) => planSizeBodies(CHART, OWN, (t) => pullOnRefusal(BANDS[size]!, chartBody(t).hip), has);

describe('POM bake: a size is not draped on a body whose hips its band cannot be pulled over (§10.9)', () => {
  it('uses the fit engine’s pull-on allowance: 2.5 cm, none for an extrapolated band', () => {
    expect(pullOnRefusal(BANDS['8']!, 94)).toBeNull();
    expect(pullOnRefusal(BANDS['8']!, 96.5)).toBeNull();
    expect(pullOnRefusal(BANDS['8']!, 104)).toBe('its band cannot be pulled over 104 cm hips: 94 cm at full stretch, 10 cm short (the size advice allows 2.5 cm)');
    expect(pullOnRefusal(BANDS['16']!, 115)).toBeNull();
    expect(pullOnRefusal(BANDS['16']!, 116)).toMatch(/1 cm short \(the size advice allows 0 cm\)/);
  });

  it('drapes each size from the AU 8 body up to its own chart body, and declares every body beyond', () => {
    const got = Object.fromEntries(Object.keys(BANDS).map((s) => [s, plan(s)]));
    expect(got['8']).toMatchObject({ baseT: -1, targetT: [] });
    expect(got['8']!.notDraped.map((n) => n.t)).toEqual([-0.5, 0, 0.5, 1]);
    expect(got['10']).toMatchObject({ baseT: -0.5, targetT: [-1] });
    expect(got['10']!.notDraped.map((n) => n.t)).toEqual([0, 0.5, 1]);
    expect(got['12']).toMatchObject({ baseT: 0, targetT: [-1] });
    expect(got['12']!.notDraped.map((n) => n.t)).toEqual([0.5, 1]);
    expect(got['14']).toMatchObject({ baseT: 0, targetT: [-1, 0.5] });
    expect(got['14']!.notDraped.map((n) => n.t)).toEqual([1]);
    expect(got['16']).toMatchObject({ baseT: 0, targetT: [-1, 1], notDraped: [] });
  });

  it('refuses a plan that would bake a missing drape, a refusal between drapes or a body with no reason', () => {
    expect(() => plan('12', (t) => t !== -1)).toThrow(/no drape there/);
    expect(() => planSizeBodies(CHART, OWN, (t) => (t === 0 ? 'no' : null), () => true)).toThrow(/between two drapes/);
    expect(() => planSizeBodies([-1, 0], [1], () => null, (t) => t !== 1)).toThrow(/no reason why/);
  });
});
