import { describe, expect, it } from 'vitest';
import { PRIOR_COEFFICIENTS, bmi, populationPrior } from '../prior';

describe('populationPrior', () => {
  it('returns the anchor values at the anchor height/weight', () => {
    const f = populationPrior({ heightCm: 165, weightKg: 62, sex: 'female' })!;
    expect(f.bust!.mean).toBe(90);
    expect(f.waist!.mean).toBe(72);
    expect(f.hip!.mean).toBe(97);
    expect(f.waist!.sigma).toBe(3.9);
    const m = populationPrior({ heightCm: 178, weightKg: 78, sex: 'male' })!;
    expect(m.bust!.mean).toBe(98);
    expect(m.waist!.mean).toBe(86);
    expect(m.hip!.sigma).toBe(2.2);
  });

  it('grows with weight and shrinks with height, monotonically', () => {
    const base = populationPrior({ heightCm: 165, weightKg: 62, sex: 'female' })!;
    const heavier = populationPrior({ heightCm: 165, weightKg: 80, sex: 'female' })!;
    const taller = populationPrior({ heightCm: 180, weightKg: 62, sex: 'female' })!;
    expect(heavier.waist!.mean).toBeGreaterThan(base.waist!.mean);
    expect(heavier.hip!.mean).toBeGreaterThan(base.hip!.mean);
    expect(taller.waist!.mean).toBeLessThan(base.waist!.mean);
    expect(heavier.waist!.mean - base.waist!.mean).toBeGreaterThan(8);
    expect(heavier.waist!.mean - base.waist!.mean).toBeLessThan(14);
  });

  it('unspecified sex mixes the two models with a wider sigma', () => {
    const u = populationPrior({ heightCm: 172, weightKg: 70, sex: 'unspecified' })!;
    const f = populationPrior({ heightCm: 172, weightKg: 70, sex: 'female' })!;
    const m = populationPrior({ heightCm: 172, weightKg: 70, sex: 'male' })!;
    expect(u.waist!.mean).toBeCloseTo((f.waist!.mean + m.waist!.mean) / 2, 0);
    expect(u.waist!.sigma).toBeGreaterThan(Math.min(f.waist!.sigma, m.waist!.sigma));
    expect(u.hip!.sigma).toBeLessThan(5);
  });

  it('sigmas are in the published 2–4 cm range (≈ 3.5 cm overall)', () => {
    for (const sex of ['female', 'male'] as const) {
      for (const c of Object.values(PRIOR_COEFFICIENTS[sex])) {
        expect(c.sigma).toBeGreaterThanOrEqual(2);
        expect(c.sigma).toBeLessThanOrEqual(4);
      }
    }
  });

  it('rejects implausible or missing inputs', () => {
    expect(populationPrior({ heightCm: 100, weightKg: 60, sex: 'female' })).toBeNull();
    expect(populationPrior({ heightCm: 170, weightKg: 300, sex: 'male' })).toBeNull();
    expect(populationPrior({ heightCm: Number.NaN, weightKg: 60, sex: 'male' })).toBeNull();
  });

  it('bmi', () => {
    expect(bmi(170, 70)).toBeCloseTo(24.22, 2);
  });
});
