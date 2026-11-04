import { describe, expect, it } from 'vitest';
import { FS_INDEX, FS_LENGTH, FitSignatureWireSchema, decodeFitSignature, type BodyProfile } from '@paskamer/schema';
import { ageBucket, assertNoColourData, buildFitSignature } from '../signature';
import { fuseProfile } from '../fuse';
import type { ScanMeasurements } from '../types';

const scan: ScanMeasurements = {
  girths: {
    neck: { mean: 36.2, sigma: 1.5, aspect: 0.95 },
    bust: { mean: 90.3, sigma: 3, aspect: 0.72 },
    waist: { mean: 72.1, sigma: 3, aspect: 0.78 },
    hip: { mean: 97.4, sigma: 2.5, aspect: 0.72 },
    thigh: { mean: 56.6, sigma: 3.5, aspect: 0.95 },
    wrist: { mean: 15.9, sigma: 1, aspect: 0.75 },
  },
  lengths: { stature: 168, inseam: 77.6, biacromialBreadth: 38.2, kneeHeight: 46 },
  posture: { shoulderSlopeDeg: 21.3, waistToHip: 0.74 },
  quality: 0.83,
  warnings: [],
};

describe('buildFitSignature', () => {
  const fused = fuseProfile({ scan, manual: { height: 168, weight: 62, bust: 92, footEu: 39 }, manualMethod: 'tape', sex: 'female', now: 1 });
  const sig = buildFitSignature(fused.profile, scan, { sex: 'female', ageYears: 31 });

  it('encodes an 80-float vector with version and quality slots', () => {
    expect(sig.vector).toHaveLength(FS_LENGTH);
    expect(sig.vector[FS_INDEX.VERSION]).toBe(1);
    expect(sig.vector[FS_INDEX.QUALITY]).toBe(0.83);
    expect(sig.wire.quality).toBe(0.83);
    expect(FitSignatureWireSchema.safeParse(sig.wire).success).toBe(true);
  });

  it('uses the fused fit points (scan ⊕ manual) and quantises girths 0.5 / sigma 0.25 / lengths 1', () => {
    const bust = fused.profile.measurements.bust!;
    expect(bust.source).toBe('fused');
    expect(sig.vector[FS_INDEX.girth.bust]).toBe(Math.round(bust.mean * 2) / 2);
    expect(sig.vector[FS_INDEX.sigma.bust]).toBe(Math.round(bust.sigma * 4) / 4);
    expect(sig.vector[FS_INDEX.girth.neck]).toBe(36);
    expect(sig.vector[FS_INDEX.aspect.waist]).toBe(0.78);
    expect(sig.vector[FS_INDEX.length.inseam]).toBe(78);
    expect(sig.vector[FS_INDEX.length.stature]).toBe(168);
    expect(sig.vector[FS_INDEX.length.footLength]).toBeCloseTo(Math.round(((39 - 2) * 2) / 3), 0);
    expect(sig.vector[FS_INDEX.posture.shoulderSlopeDeg]).toBe(21.3);
    expect(sig.vector[FS_INDEX.demographics.weightKg]).toBe(62);
    expect(sig.vector[FS_INDEX.demographics.bmi]).toBeCloseTo(22, 0);
    expect(sig.vector[FS_INDEX.demographics.sizingSexF]).toBe(1);
    expect(sig.vector[FS_INDEX.demographics.sizingSexM]).toBe(0);
    expect(sig.vector[FS_INDEX.demographics.ageBucket]).toBe(3);
    // unknown levels stay 0
    expect(sig.vector[FS_INDEX.girth.calf]).toBe(0);
  });

  it('round-trips through decodeFitSignature', () => {
    const dec = decodeFitSignature(sig.vector);
    expect(dec.girths.hip).toBe(97.5);
    expect(dec.lengths.biacromialBreadth).toBe(38);
    expect(dec.quality).toBe(0.83);
  });

  it('never carries face/skin/hair data and the guard catches it', () => {
    const keys = JSON.stringify(sig.profile);
    expect(keys).not.toMatch(/skin|hair|face|monk|season/i);
    expect(() => assertNoColourData({ ...sig.profile, shape: { ...sig.profile.shape, skinL: 1 } as never })).toThrow(/colour/);
  });

  it('works without a scan (manual-only profile)', () => {
    const p: BodyProfile = { version: 1, measurements: { height: { mean: 180, sigma: 1, source: 'manual' }, waist: { mean: 84, sigma: 4, source: 'manual' } } };
    const s = buildFitSignature(p, null);
    expect(s.vector[FS_INDEX.girth.waist]).toBe(84);
    expect(s.vector[FS_INDEX.length.stature]).toBe(180);
    expect(s.vector[FS_INDEX.QUALITY]).toBe(0);
    expect(s.vector.filter((v) => v !== 0)).toHaveLength(4); // waist, sigma, stature, version
  });

  it('ageBucket', () => {
    expect(ageBucket(undefined)).toBe(0);
    expect(ageBucket(17)).toBe(1);
    expect(ageBucket(24)).toBe(2);
    expect(ageBucket(70)).toBe(7);
  });
});
