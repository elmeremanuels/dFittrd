import { describe, expect, it } from 'vitest';
import type { BodyProfile } from '@curtain/schema';
import { fitContextFromProfile, hasMeasurements, withPriorFill } from '@/store/fit';

const base = (measurements: BodyProfile['measurements']): BodyProfile =>
  ({ version: 1, createdAt: 0, updatedAt: 0, measurements } as unknown as BodyProfile);

describe('withPriorFill (app uses the same prior as the embed)', () => {
  it('adds prior girths when only height and weight are known', () => {
    const p = withPriorFill(base({ height: { mean: 170, sigma: 1, source: 'manual' }, weight: { mean: 64, sigma: 1, source: 'manual' } }));
    expect(p.measurements.bust?.source).toBe('prior');
    expect(p.measurements.waist?.source).toBe('prior');
    expect(p.measurements.hip?.source).toBe('prior');
    expect(p.measurements.bust!.sigma).toBeGreaterThan(1.5);
  });
  it('never overwrites a typed value', () => {
    const p = withPriorFill(base({ height: { mean: 170, sigma: 1, source: 'manual' }, weight: { mean: 64, sigma: 1, source: 'manual' }, waist: { mean: 70, sigma: 1.5, source: 'manual' } }));
    expect(p.measurements.waist).toEqual({ mean: 70, sigma: 1.5, source: 'manual' });
  });
  it('leaves a profile without weight unchanged', () => {
    const prof = base({ height: { mean: 170, sigma: 1, source: 'manual' } });
    expect(withPriorFill(prof)).toBe(prof);
  });
  it('gives the deck a usable fit context from height and weight alone', () => {
    const ctx = fitContextFromProfile(base({ height: { mean: 170, sigma: 1, source: 'manual' }, weight: { mean: 64, sigma: 1, source: 'manual' } }));
    expect(hasMeasurements(ctx)).toBe(true);
    expect(Object.keys(ctx!.userBody.measurements)).toEqual(expect.arrayContaining(['bust', 'waist', 'hip']));
  });
});
