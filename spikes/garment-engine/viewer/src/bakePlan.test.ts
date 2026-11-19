import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import { buildAvatar } from '../../../../packages/garment-viewer/src/body';
import { widestBelowWaistCm } from '../../../../packages/garment-viewer/src/bodyGirth';
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
const m = buildMannequin(bodyShape(BASE_SHAPE_ID));
const canon = buildMannequinMesh(m, { head: 'neutral' });
const widest = (t: number): number => {
  const b = chartBody(t);
  return widestBelowWaistCm(m, buildAvatar(m, canon, { bust: b.bust, waist: b.waist, hip: b.hip }).mesh).girthCm;
};
const WIDEST = new Map([...CHART, ...OWN].map((t) => [t, widest(t)]));
const plan = (size: string, has: (t: number) => boolean = () => true) => planSizeBodies(CHART, OWN, (t) => pullOnRefusal(BANDS[size]!, WIDEST.get(t)!, chartBody(t).hip), has);

describe('POM bake: a size is not draped on a drawn body its band cannot be pulled over (§10.9)', () => {
  it('measures the drawn bodies at their widest below the waist, as the drape pipeline does (2.5-3 cm over the chart hip)', () => {
    expect([...WIDEST.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g)).toEqual([96.5, 101.6, 106.8, 111.9, 117]);
  });

  it('uses the fit engine’s pull-on allowance: 2.5 cm, none for an extrapolated band', () => {
    expect(pullOnRefusal(BANDS['8']!, 96.5, 94)).toBeNull();
    expect(pullOnRefusal(BANDS['8']!, 106.8, 104)).toEqual({ rule: 'pull-on', reason: 'its band cannot be pulled over the drawn body with 104 cm hips: 94 cm at full stretch against 106.8 cm at its widest below the waist, 12.8 cm short (the size advice allows 2.5 cm)' });
    expect(pullOnRefusal(BANDS['16']!, 115, 112)).toBeNull();
    expect(pullOnRefusal(BANDS['16']!, 117, 114)?.reason).toMatch(/2 cm short \(the size advice allows 0 cm\)/);
  });

  it('drapes each size from the AU 8 body up to the last body its band goes over, and declares every body beyond', () => {
    const got = Object.fromEntries(Object.keys(BANDS).map((s) => [s, plan(s)]));
    expect(got['8']).toMatchObject({ baseT: -1, targetT: [] });
    expect(got['8']!.notDraped.map((n) => n.t)).toEqual([-0.5, 0, 0.5, 1]);
    expect(got['10']).toMatchObject({ baseT: -0.5, targetT: [-1] });
    expect(got['10']!.notDraped.map((n) => n.t)).toEqual([0, 0.5, 1]);
    expect(got['12']).toMatchObject({ baseT: 0, targetT: [-1] });
    expect(got['12']!.notDraped.map((n) => n.t)).toEqual([0.5, 1]);
    expect(got['14']).toMatchObject({ baseT: 0, targetT: [-1, 0.5] });
    expect(got['14']!.notDraped.map((n) => n.t)).toEqual([1]);
    // AU 16: 115 cm at full stretch, extrapolated (allowance 0), against the 114 cm body's 117 cm at its widest.
    expect(got['16']).toMatchObject({ baseT: 0, targetT: [-1, 0.5] });
    expect(got['16']!.notDraped).toEqual([{ t: 1, rule: 'pull-on', reason: expect.stringMatching(/^its band cannot be pulled over the drawn body with 114 cm hips: 115 cm at full stretch against 117 cm/) }]);
    for (const p of Object.values(got)) for (const n of p.notDraped) expect(n.rule).toBe('pull-on');
  });

  it('refuses a plan that would bake a missing drape, a refusal between drapes or a body with no reason', () => {
    expect(() => plan('12', (t) => t !== -1)).toThrow(/no drape there/);
    expect(() => planSizeBodies(CHART, OWN, (t) => (t === 0 ? { reason: 'no' } : null), () => true)).toThrow(/between two drapes/);
    expect(() => planSizeBodies([-1, 0], [1], () => null, (t) => t !== 1)).toThrow(/no reason why/);
  });
});
