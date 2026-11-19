import { describe, expect, it } from 'vitest';
import { TryResolveResponseSchema } from './api';
import { BAKE_CHECK_IDS, bakeCheckRefusal, bakeRingToleranceCm, bundleMannequinFamily, checkGarmentBundle, passedBakeCheck, garmentBodyFamily, garmentBundleFor, garmentQaFlagNote, garmentQaFlags, GarmentAssetRefSchema, MAX_GARMENT_BUNDLE_BYTES } from './garmentAsset';

const meta = (over: Partial<{ sizes: string[]; pass: boolean; bytes: number; format: string; waistReading: unknown }> = {}) => ({
  anchors: { format: 'curtain.garment.anchors' },
  grading: { format: over.format ?? 'curtain.garment.grading', baseSize: '12', sizes: (over.sizes ?? ['8', '10', '12', '14', '16']).map((size) => ({ size })) },
  material: { format: 'curtain.garment.material' },
  qa: { format: 'curtain.garment.qa', chartAgreement: { pass: over.pass ?? true, ...('waistReading' in over ? { waistReading: over.waistReading } : {}) } },
  ...(over.bytes !== undefined ? { bytes: over.bytes } : {}),
});

describe('checkGarmentBundle', () => {
  it('accepts a bundle that grades every size of the chart', () => {
    expect(checkGarmentBundle(meta(), ['AU 8', '10', '12', '14', '16'].map((s) => s.replace('AU ', '')))).toEqual({ ok: true, info: { baseSize: '12', sizes: ['8', '10', '12', '14', '16'], qaFlags: [], family: 'female' } });
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

describe('the body family a bundle was built on (men-3d-plan slice M1)', () => {
  const sized = ['8', '10', '12', '14', '16'];
  const chart = { sizeChart: sized.map((size) => ({ size, measurements: {} })) } as never as { sizeChart: { size: string }[] };
  const fam = (anchors: unknown, qa: unknown) => ({ ...meta(), anchors: { format: 'curtain.garment.anchors', ...(anchors === undefined ? {} : { mannequin: anchors }) }, qa: { format: 'curtain.garment.qa', chartAgreement: { pass: true }, ...(qa === undefined ? {} : { mannequin: qa }) } }) as never;
  const male = { version: '0.1.0', shape: 'M', family: 'male' };
  it('reads the family from anchors.json and qa.json, which must agree; absent in both is female', () => {
    expect(bundleMannequinFamily(fam(undefined, undefined))).toBe('female');
    expect(bundleMannequinFamily(fam({ version: '0.1.0', shape: 'M' }, undefined))).toBe('female');
    expect(bundleMannequinFamily(fam(male, { family: 'male' }))).toBe('male');
    expect(bundleMannequinFamily(fam({ family: 'female' }, { family: 'female' }))).toBe('female');
    // Absent means female, so `female` named in one file only agrees with the other: female.
    expect(bundleMannequinFamily(fam({ family: 'female' }, undefined))).toBe('female');
    expect(bundleMannequinFamily(fam(undefined, { family: 'female' }))).toBe('female');
    // Disagreeing files (so `male` named in one file only), or an unknown family: malformed.
    expect(bundleMannequinFamily(fam(male, undefined))).toBeNull();
    expect(bundleMannequinFamily(fam(undefined, { family: 'male' }))).toBeNull();
    expect(bundleMannequinFamily(fam({ family: 'Male' }, { family: 'Male' }))).toBeNull();
    expect(bundleMannequinFamily(fam('male', 'male'))).toBeNull();
    expect(checkGarmentBundle(fam(male, undefined), sized)).toEqual({ ok: false, problem: 'format' });
    expect(checkGarmentBundle(fam({ family: 'child' }, { family: 'child' }), sized)).toEqual({ ok: false, problem: 'format' });
  });
  it('reports the family, and refuses a bundle of the other family when the product family is given', () => {
    expect(checkGarmentBundle(fam(male, { family: 'male' }), sized)).toEqual({ ok: true, info: { baseSize: '12', sizes: sized, qaFlags: [], family: 'male' } });
    expect(checkGarmentBundle(fam(male, { family: 'male' }), sized, { family: 'male' })).toMatchObject({ ok: true });
    expect(checkGarmentBundle(fam(male, { family: 'male' }), sized, { family: 'female' })).toEqual({ ok: false, problem: 'family_mismatch' });
    expect(checkGarmentBundle(fam(undefined, undefined), sized, { family: 'male' })).toEqual({ ok: false, problem: 'family_mismatch' });
    expect(checkGarmentBundle(fam(undefined, undefined), sized, { family: 'female' })).toMatchObject({ ok: true });
  });
  it('garmentBundleFor: a men’s garment takes a male bundle only, every other garment a female one only', () => {
    expect(garmentBodyFamily({ audience: 'men' })).toBe('male');
    for (const audience of ['women', 'unisex', undefined] as const) expect(garmentBodyFamily({ audience })).toBe('female');
    expect(garmentBundleFor(fam(male, { family: 'male' }), { ...chart, audience: 'men' } as never)?.family).toBe('male');
    expect(garmentBundleFor(fam(undefined, undefined), { ...chart, audience: 'men' } as never)).toBeNull();
    expect(garmentBundleFor(fam(male, { family: 'male' }), chart as never)).toBeNull();
    expect(garmentBundleFor(fam(male, { family: 'male' }), { ...chart, audience: 'unisex' } as never)).toBeNull();
    expect(garmentBundleFor(fam(undefined, undefined), { ...chart, audience: 'women' } as never)?.family).toBe('female');
  });
});

describe('low-rise waist reading (a recorded founder decision, never silent)', () => {
  const lowRise = { kind: 'low-rise', decision: 'founder, 2026-11-09', offsetCm: 8.1, targetCm: 88.6, dropCm: 5.5 };
  it('passes only with the decision recorded, and always carries the flag', () => {
    expect(checkGarmentBundle(meta({ waistReading: lowRise }), ['8', '10', '12', '14', '16'])).toEqual({ ok: true, info: { baseSize: '12', sizes: ['8', '10', '12', '14', '16'], qaFlags: ['low_rise_waist'], family: 'female' } });
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

describe('a tape-built drape bake (no chart agreement was measured)', () => {
  const bake = (kind: unknown) => ({ ...meta(), anchors: { format: 'curtain.garment.anchors', drapeBake: 'base.glb' }, qa: { format: 'curtain.garment.qa', chartAgreement: { pass: true, ...(kind === undefined ? {} : { kind }) } } });
  it('is admitted only flagged, and only when qa.json says it is tape-built', () => {
    expect(checkGarmentBundle(bake('tape-built'), ['8', '10', '12', '14', '16'])).toEqual({ ok: true, info: { baseSize: '12', sizes: ['8', '10', '12', '14', '16'], qaFlags: ['tape_built_no_chart_check'], family: 'female' } });
    expect(checkGarmentBundle(bake(undefined), ['12'])).toEqual({ ok: false, problem: 'qa_failed' });
    expect(checkGarmentBundle(bake('calibrated'), ['12'])).toEqual({ ok: false, problem: 'qa_failed' });
    expect(garmentQaFlags({ chartAgreement: { pass: true, kind: 'tape-built' } })).toEqual(['tape_built_no_chart_check']);
    expect(garmentQaFlagNote('tape_built_no_chart_check', {})).toMatch(/no agreement with the size chart or the tape was measured.*Import the bundle again to run the check/);
  });

  const report = (pass: (id: string) => boolean | null) => ({
    format: 'curtain.garment.bakeCheck', version: 1, pass: BAKE_CHECK_IDS.every((id) => pass(id) === true),
    checks: BAKE_CHECK_IDS.map((id) => ({ id, pass: pass(id), reasons: pass(id) === false ? [`${id} went wrong`] : [] })),
    tape: null, drapes: [], checkedAt: '2026-11-19T00:00:00.000Z',
  });
  it('after the import’s bake check passed it is an ordinary pass (no flag); a failed, partial or malformed check keeps the flag', () => {
    const passed = report(() => true);
    const qa = (bakeCheck: unknown) => ({ format: 'curtain.garment.qa', chartAgreement: { pass: true, kind: 'tape-built' }, bakeCheck });
    expect(garmentQaFlags(qa(passed))).toEqual([]);
    expect(passedBakeCheck(qa(passed))).not.toBeNull();
    expect(checkGarmentBundle({ ...bake('tape-built'), qa: qa(passed) }, ['12'])).toMatchObject({ ok: true, info: { qaFlags: [] } });
    for (const bad of [report((id) => id !== 'inside_body'), { ...passed, checks: passed.checks.slice(1) }, { ...passed, pass: 'yes' }, { pass: true }]) {
      expect(garmentQaFlags(qa(bad))).toEqual(['tape_built_no_chart_check']);
      expect(passedBakeCheck(qa(bad))).toBeNull();
    }
  });
  it('a refusal reads as plain English, every failed check with its first reason', () => {
    const r = report((id) => (id === 'tape_rings' || id === 'at_rest' ? false : id === 'size_order' ? null : true));
    expect(bakeCheckRefusal(r)).toBe('Every drape says it came to rest: no. at_rest went wrong Hip line and hem agree with the tape: no. tape_rings went wrong');
    expect(bakeRingToleranceCm(50)).toBe(2);
    expect(bakeRingToleranceCm(254)).toBeCloseTo(5.08, 5);
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
