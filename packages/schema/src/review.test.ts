/** Review probes (2026-11-04): edge cases around the body projection, signature quantisation, completeness and category inference. */
import { describe, expect, it } from 'vitest';
import { confidenceFromSigma, toUserBody, type BodyProfile } from './body';
import { completenessScore, missingFields } from './completeness';
import { decodeFitSignature, encodeFitSignature, FitSignatureWireSchema, FS_INDEX, quantiseFitSignature, toFitSignatureWire } from './fitSignature';
import { inferCategory, coerceSizeChart, coerceUnit, coerceFitPoints } from './mappings/common';
import { validateGarmentDraft } from './api';
import { MOCK_GARMENTS } from './fixtures';

describe('toUserBody', () => {
  const base: BodyProfile = {
    version: 1,
    measurements: {
      bust: { mean: 88, sigma: 1.66, source: 'fused' },
      waist: { mean: 0, sigma: 1, source: 'scan' },
      hip: { mean: Number.NaN, sigma: 1, source: 'scan' },
      shoulder: { mean: 38, sigma: 3, source: 'scan' },
      foot: { mean: 24.6, sigma: 0.5, source: 'scan' },
      footEu: { mean: 38, sigma: 0.6, source: 'manual' },
      height: { mean: 170, sigma: 1, source: 'manual' },
      weight: { mean: 60, sigma: 1, source: 'manual' },
    },
    conflicts: ['shoulder', 'footEu'],
    history: [{ brand: 'A', size: 'M', kept: true }],
  };
  it('drops zero/NaN means, height and weight; caps conflicting points at 0.5; copies history', () => {
    const u = toUserBody(base);
    expect(u.measurements).toEqual({ bust: 88, shoulder: 38, footLengthCm: 24.6, footEu: 38 });
    expect(u.confidence).toEqual({ bust: 0.95, shoulder: 0.5, foot: confidenceFromSigma(0.5) });
    expect(u.history).toEqual(base.history);
    expect(u.history).not.toBe(base.history);
  });
  it('a footEu-only profile gets its confidence from the footEu sigma', () => {
    const u = toUserBody({ version: 1, measurements: { footEu: { mean: 38, sigma: 0.6, source: 'manual' } } });
    expect(u.measurements).toEqual({ footEu: 38 });
    expect(u.confidence).toEqual({ foot: confidenceFromSigma(0.6) });
  });
  it('an empty profile projects to an empty body', () => {
    expect(toUserBody({ version: 1, measurements: {} })).toEqual({ measurements: {} });
  });
});

describe('fit signature quantisation', () => {
  it('round-trips negatives and kills −0', () => {
    const vec = encodeFitSignature({ posture: { shoulderSlopeDeg: -3.456, forwardLeanDeg: -0.004 }, prefs: { easeBust: -0.024 }, quality: 0.5 });
    expect(vec[FS_INDEX.posture.shoulderSlopeDeg]).toBe(-3.46);
    expect(Object.is(vec[FS_INDEX.posture.forwardLeanDeg], -0)).toBe(false);
    expect(Object.is(vec[FS_INDEX.prefs.easeBust], -0)).toBe(false);
    const profile = decodeFitSignature(vec);
    expect(profile.posture).toEqual({ shoulderSlopeDeg: -3.46 });
    expect(profile.prefs).toEqual({});
    expect(quantiseFitSignature(vec)).toEqual(vec);
  });
  it('the wire form validates and rejects a mismatched quality slot', () => {
    const wire = toFitSignatureWire({ girths: { bust: 88.26 }, quality: 0.734 });
    expect(wire.quality).toBe(0.73);
    expect(FitSignatureWireSchema.safeParse(wire).success).toBe(true);
    expect(FitSignatureWireSchema.safeParse({ ...wire, quality: 0.9 }).success).toBe(false);
    expect(() => decodeFitSignature(wire.vector.slice(0, 79))).toThrow(RangeError);
  });
});

describe('completeness on garbage', () => {
  it('never throws and reports every heavy field', () => {
    for (const input of [null, undefined, 'x', 42, [], { sizeChart: 'nope', fabric: [], category: 'hat' }]) {
      const r = completenessScore(input);
      expect(r.status).toBe('incomplete');
      expect(r.missing.filter((m) => m.severity === 'heavy').map((m) => m.field)).toEqual([
        'category',
        'sizeChartType',
        'sizeChart',
        'fabric.primary',
        'flatLayPhoto',
      ]);
    }
    expect(validateGarmentDraft([]).valid).toBe(false);
  });
  it('every mock garment is active with no missing heavy/medium fields', () => {
    for (const g of MOCK_GARMENTS) {
      const r = completenessScore(g);
      expect(r.status, g.id).toBe('active');
      expect(missingFields(g).length, g.id).toBeLessThanOrEqual(3);
    }
  });
});

describe('mapping coercions', () => {
  it('size rows with numeric labels and chest/hips aliases', () => {
    const rows = coerceSizeChart([{ size: 38, chest: '92', hips: '100,5' }, { label: 'M', bust: 94 }], undefined, 'x');
    expect(rows).toEqual([{ size: '38', bust: 92, hip: 100.5 }, { size: 'M', bust: 94 }]);
  });
  it('coerceUnit accepts fractions and percentages, rejects 1.5 instead of reading it as 1.5 %', () => {
    expect(coerceUnit('0.92')).toBe(0.92);
    expect(coerceUnit('92')).toBe(0.92);
    expect(coerceUnit('92%')).toBe(0.92);
    expect(coerceUnit(' 7.5% ')).toBe(0.075);
    expect(coerceUnit(1)).toBe(1);
    expect(coerceUnit(0)).toBe(0);
    expect(coerceUnit(1.5)).toBeUndefined();
    expect(coerceUnit('1,5')).toBeUndefined();
    expect(coerceUnit('150%')).toBeUndefined();
    expect(coerceUnit(-0.1)).toBeUndefined();
  });
  it('coerceFitPoints de-duplicates and maps aliases', () => {
    expect(coerceFitPoints('Chest, hips, Hips, shoulders, nose')).toEqual(['bust', 'hip', 'shoulder']);
  });
  it('inferCategory: explicit beats taxonomy beats title; last taxonomy segment wins', () => {
    expect(inferCategory('Dresses', 'Shoes')).toBe('dress');
    expect(inferCategory(undefined, 'Apparel > Women > Jeans')).toBe('bottom');
    expect(inferCategory(undefined, undefined, 'Chelsea boot')).toBe('shoes');
    expect(inferCategory('', null, 'Linen Wrap Dress')).toBe('dress');
    expect(inferCategory('gadget')).toBeUndefined();
  });
});
