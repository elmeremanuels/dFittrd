import { describe, expect, it } from 'vitest';
import {
  BodyProfileSchema,
  MANUAL_SIGMA_CM,
  UserBodySchema,
  confidenceFromSigma,
  fuseMeasurements,
  measurementsAgree,
  toUserBody,
  type BodyProfile,
  type UserBody,
} from './body';

describe('confidenceFromSigma', () => {
  it('reproduces the handoff §2.1C targets (scan-only ≈ 60 %, scan+tape ≈ 95 %)', () => {
    expect(confidenceFromSigma(3)).toBe(0.602);
    expect(confidenceFromSigma(1.66)).toBe(0.95);
    // scan σ 3 fused with tape σ 2 → σ ≈ 1.66
    const fused = fuseMeasurements([
      { mean: 88, sigma: 3 },
      { mean: 88, sigma: 2 },
    ]);
    expect(fused?.sigma).toBeCloseTo(1.664, 3);
    expect(confidenceFromSigma(fused!.sigma)).toBeCloseTo(0.95, 2);
  });

  it('clamps to [0.2, 0.98]', () => {
    expect(confidenceFromSigma(0)).toBe(0.98);
    expect(confidenceFromSigma(10)).toBe(0.2);
    expect(confidenceFromSigma(Number.NaN)).toBe(0.2);
  });
});

describe('fuseMeasurements / measurementsAgree', () => {
  it('inverse-variance weights toward the tighter estimate', () => {
    const f = fuseMeasurements([
      { mean: 90, sigma: 3 },
      { mean: 86, sigma: 1.5 },
    ]);
    expect(f!.mean).toBeCloseTo(86.8, 1);
    expect(f!.sigma).toBeCloseTo(1.342, 3);
  });

  it('an exact estimate wins; empty input is null', () => {
    expect(fuseMeasurements([{ mean: 1, sigma: 4 }, { mean: 2, sigma: 0 }])).toEqual({ mean: 2, sigma: 0 });
    expect(fuseMeasurements([])).toBeNull();
  });

  it('agreement test uses 2·sqrt(σa² + σb²)', () => {
    const scan = { mean: 88, sigma: 3, source: 'scan' as const };
    expect(measurementsAgree(scan, { mean: 94, sigma: 2, source: 'manual' })).toBe(true); // 6 ≤ 7.21
    expect(measurementsAgree(scan, { mean: 96, sigma: 2, source: 'manual' })).toBe(false); // 8 > 7.21
  });

  it('exposes the manual sigma table from body-scan.md', () => {
    expect(MANUAL_SIGMA_CM).toEqual({ tape: 1.5, memory: 2.5, guess: 4 });
  });
});

describe('toUserBody', () => {
  const profile: BodyProfile = {
    version: 1,
    measurements: {
      bust: { mean: 88, sigma: 1.66, source: 'fused' },
      waist: { mean: 70, sigma: 1.66, source: 'fused' },
      hip: { mean: 96, sigma: 1.66, source: 'fused' },
      shoulder: { mean: 38, sigma: 3, source: 'scan' },
      height: { mean: 168, sigma: 1, source: 'manual' },
      weight: { mean: 62, sigma: 1, source: 'manual' },
      footEu: { mean: 38, sigma: 0.5, source: 'manual' },
    },
    conflicts: ['shoulder'],
    history: [{ brand: 'Aalter Studio', size: 'M', kept: true }],
  };

  it('yields the fit-engine REF body with per-point confidence', () => {
    const u = toUserBody(profile);
    expect(u.measurements).toEqual({ bust: 88, waist: 70, hip: 96, shoulder: 38, footEu: 38 });
    expect(u.confidence).toEqual({ bust: 0.95, waist: 0.95, hip: 0.95, shoulder: 0.5, foot: 0.98 });
    expect(u.history).toEqual([{ brand: 'Aalter Studio', size: 'M', kept: true }]);
    expect(UserBodySchema.safeParse(u).success).toBe(true);
  });

  it('drops height/weight, exposes legacy foot as footLengthCm, and copies history', () => {
    const u = toUserBody({
      version: 1,
      measurements: { foot: { mean: 24.6, sigma: 3, source: 'scan' }, height: { mean: 170, sigma: 1, source: 'manual' } },
    });
    expect(u.measurements).toEqual({ footLengthCm: 24.6 });
    expect(u.confidence).toEqual({ foot: 0.602 });
    expect(u.history).toBeUndefined();
    expect(u.measurements).not.toHaveProperty('height');
  });

  it('does not mutate the profile', () => {
    const frozen = Object.freeze(structuredClone(profile));
    const a = toUserBody(frozen);
    const b = toUserBody(frozen);
    expect(a).toEqual(b);
    a.history!.push({ brand: 'x', size: 'S', kept: false });
    expect(frozen.history).toHaveLength(1);
  });
});

describe('schemas', () => {
  it('BodyProfileSchema validates the on-device record', () => {
    expect(BodyProfileSchema.safeParse({ version: 1, measurements: {} }).success).toBe(true);
    expect(BodyProfileSchema.safeParse({ version: 1, measurements: { bust: { mean: 88, sigma: -1, source: 'scan' } } }).success).toBe(false);
    expect(BodyProfileSchema.safeParse({ version: 1, measurements: { bust: { mean: 88, sigma: 1, source: 'photo' } } }).success).toBe(false);
    expect(BodyProfileSchema.safeParse({ version: 2, measurements: {} }).success).toBe(false);
  });

  it('UserBodySchema matches the fit-engine spec shape', () => {
    const ok: UserBody = { measurements: { bust: 88, footLengthCm: 24.6 }, confidence: { bust: 0.95 } };
    expect(UserBodySchema.safeParse(ok).success).toBe(true);
    expect(UserBodySchema.safeParse({ measurements: { height: 168 } }).success).toBe(false);
    expect(UserBodySchema.safeParse({ measurements: { bust: 88 }, confidence: { bust: 1.2 } }).success).toBe(false);
  });
});
