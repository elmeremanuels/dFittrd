import { describe, expect, it } from 'vitest';
import { TryResolveResponseSchema } from './api';
import { checkGarmentBundle, garmentBundleFor, garmentQaFlagNote, garmentQaFlags, GarmentAssetRefSchema, MAX_GARMENT_BUNDLE_BYTES } from './garmentAsset';

const meta = (over: Partial<{ sizes: string[]; pass: boolean; bytes: number; format: string; waistReading: unknown }> = {}) => ({
  anchors: { format: 'curtain.garment.anchors' },
  grading: { format: over.format ?? 'curtain.garment.grading', baseSize: '12', sizes: (over.sizes ?? ['8', '10', '12', '14', '16']).map((size) => ({ size })) },
  material: { format: 'curtain.garment.material' },
  qa: { format: 'curtain.garment.qa', chartAgreement: { pass: over.pass ?? true, ...('waistReading' in over ? { waistReading: over.waistReading } : {}) } },
  ...(over.bytes !== undefined ? { bytes: over.bytes } : {}),
});

describe('checkGarmentBundle', () => {
  it('accepts a bundle that grades every size of the chart', () => {
    expect(checkGarmentBundle(meta(), ['AU 8', '10', '12', '14', '16'].map((s) => s.replace('AU ', '')))).toEqual({ ok: true, info: { baseSize: '12', sizes: ['8', '10', '12', '14', '16'], qaFlags: [] } });
  });
  it('falls back when the live chart has a size the bundle cannot show', () => {
    expect(checkGarmentBundle(meta(), ['8', '10', '12', '14', '16', '18'])).toEqual({ ok: false, problem: 'chart_mismatch' });
    expect(garmentBundleFor(meta(), { sizeChart: [{ size: 'XS', measurements: {} }] as never })).toBeNull();
  });
  it('rejects a failed QA, a wrong format and an oversized bundle', () => {
    expect(checkGarmentBundle(meta({ pass: false }), ['12'])).toEqual({ ok: false, problem: 'qa_failed' });
    expect(checkGarmentBundle(meta({ format: 'x' }), ['12'])).toEqual({ ok: false, problem: 'format' });
    expect(checkGarmentBundle(meta({ bytes: MAX_GARMENT_BUNDLE_BYTES + 1 }), ['12'])).toEqual({ ok: false, problem: 'too_large' });
  });
});

describe('low-rise waist reading (a recorded founder decision, never silent)', () => {
  const lowRise = { kind: 'low-rise', decision: 'founder, 2026-11-09', offsetCm: 8.1, targetCm: 88.6, dropCm: 5.5 };
  it('passes only with the decision recorded, and always carries the flag', () => {
    expect(checkGarmentBundle(meta({ waistReading: lowRise }), ['8', '10', '12', '14', '16'])).toEqual({ ok: true, info: { baseSize: '12', sizes: ['8', '10', '12', '14', '16'], qaFlags: ['low_rise_waist'] } });
    expect(garmentQaFlags({ chartAgreement: { waistReading: lowRise } })).toEqual(['low_rise_waist']);
    expect(garmentQaFlags({ chartAgreement: { waistReading: null } })).toEqual([]);
  });
  it('refuses a low-rise reading without a decision or offset, and never lets it lift a failed chart', () => {
    for (const bad of [{ ...lowRise, decision: '' }, { ...lowRise, decision: undefined }, { ...lowRise, offsetCm: Number.NaN }, { ...lowRise, kind: 'band' }, 'low-rise']) {
      expect(checkGarmentBundle(meta({ waistReading: bad }), ['12'])).toEqual({ ok: false, problem: 'qa_failed' });
    }
    expect(checkGarmentBundle(meta({ pass: false, waistReading: lowRise }), ['12'])).toEqual({ ok: false, problem: 'qa_failed' });
  });
});

describe('a pass after calibration over a miss outside tolerance (never looks clean)', () => {
  const lowRise = { kind: 'low-rise', decision: 'founder, 2026-11-08', offsetCm: 5.08, targetCm: 85.58, dropCm: 4.76 };
  it('is flagged when the miss before calibration exceeds the tolerance, with or without a low-rise reading', () => {
    expect(garmentQaFlags({ chartAgreement: { pass: true, toleranceCm: 2, beforeCalibrationMaxAbsCm: 2.49, waistReading: lowRise } })).toEqual(['low_rise_waist', 'precalibration_outside_tolerance']);
    expect(garmentQaFlags({ chartAgreement: { pass: true, toleranceCm: 2, beforeCalibrationMaxAbsCm: 2.49 } })).toEqual(['precalibration_outside_tolerance']);
    expect(garmentQaFlags({ chartAgreement: { pass: true, toleranceCm: 2, beforeCalibrationMaxAbsCm: 0.5 } })).toEqual([]);
    expect(garmentQaFlags({ chartAgreement: { pass: true, toleranceCm: 2, beforeCalibrationMaxAbsCm: 2 } })).toEqual([]);
    expect(garmentQaFlags({ chartAgreement: { pass: true, beforeCalibrationMaxAbsCm: 9 } })).toEqual([]);
  });
  it('has a plain sentence for each flag', () => {
    const qa = { chartAgreement: { pass: true, toleranceCm: 2, beforeCalibrationMaxAbsCm: 2.49, waistReading: lowRise } };
    expect(garmentQaFlagNote('low_rise_waist', qa)).toMatch(/4\.76 cm below .*founder, 2026-11-08.*5\.08 cm.*85\.58 cm/);
    expect(garmentQaFlagNote('precalibration_outside_tolerance', qa)).toMatch(/2\.49 cm, outside the ±2 cm tolerance.*not evidence of fit/);
  });
});

describe('GarmentAssetRefSchema', () => {
  const ref = { version: '0123456789abcdef', baseUrl: 'https://api.example.com/assets/a/b/0123456789abcdef', baseSize: '12', sizes: ['12'], label: 'estimate' };
  it('is always labelled an estimate', () => {
    expect(GarmentAssetRefSchema.parse(ref)).toEqual(ref);
    expect(() => GarmentAssetRefSchema.parse({ ...ref, label: 'exact' })).toThrow();
    expect(() => GarmentAssetRefSchema.parse({ ...ref, version: 'XYZ' })).toThrow();
  });
  it('is optional on the try response, so older payloads keep parsing', () => {
    const shape = TryResolveResponseSchema.shape.asset;
    expect(shape.safeParse(undefined).success).toBe(true);
    expect(shape.safeParse(null).success).toBe(true);
    expect(shape.safeParse(ref).success).toBe(true);
  });
});
