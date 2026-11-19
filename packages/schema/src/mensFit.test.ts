/** Schema side of men-3d-plan slices M2a / M2b: the new fit points, columns, W/L axes and body inputs. */
import { describe, expect, it } from 'vitest';
import { BODY_MEASUREMENT_KEYS, confidenceFromSigma, USER_BODY_MEASUREMENT_KEYS, UserBodySchema, toUserBody, type BodyProfile } from './body';
import { completenessScore } from './completeness';
import { FIT_POINTS, GARMENT_LENGTH_POINTS, GarmentPayloadSchema, SizeChartSchema } from './garment';
import { coerceSizeChart } from './mappings/common';
import { MENS_REFERENCE_BODY, SYNTHETIC_MENS_CHINO_WL } from './fixtures';

describe('fit points and garment lengths', () => {
  it('FIT_POINTS keeps its first seven in order and adds neck and sleeve', () => {
    expect(FIT_POINTS).toEqual(['bust', 'waist', 'hip', 'shoulder', 'thigh', 'inseam', 'foot', 'neck', 'sleeve']);
  });
  it('length and rise are garment lengths, never stored body keys', () => {
    expect(GARMENT_LENGTH_POINTS).toEqual(['length', 'rise']);
    for (const k of GARMENT_LENGTH_POINTS) {
      expect(BODY_MEASUREMENT_KEYS as readonly string[]).not.toContain(k);
      expect(USER_BODY_MEASUREMENT_KEYS as readonly string[]).not.toContain(k);
    }
    expect(USER_BODY_MEASUREMENT_KEYS).toEqual(expect.arrayContaining(['neck', 'sleeve']));
  });
});

describe('W/L size charts', () => {
  it('the synthetic W/L chino parses, is complete, and every row carries axes', () => {
    const r = GarmentPayloadSchema.safeParse(SYNTHETIC_MENS_CHINO_WL);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true);
    expect(completenessScore(SYNTHETIC_MENS_CHINO_WL).status).toBe('active');
    expect(SYNTHETIC_MENS_CHINO_WL.sizeChart).toHaveLength(15);
    expect(SYNTHETIC_MENS_CHINO_WL.sizeChart[4]).toEqual({ size: '32/32', waist: 83.5, hip: 104, thigh: 62, rise: 26.5, inseam: 81, axes: { waist: '32', leg: '32' } });
  });
  it('axes on some rows only, or one waist × leg twice, is refused', () => {
    expect(SizeChartSchema.safeParse([{ size: '32/32', waist: 83, axes: { waist: '32', leg: '32' } }, { size: '34/32', waist: 88 }]).success).toBe(false);
    expect(
      SizeChartSchema.safeParse([
        { size: '32/32', axes: { waist: '32', leg: '32' } },
        { size: 'W32 L32', axes: { waist: '32', leg: '32' } },
      ]).success,
    ).toBe(false);
  });
  it('a full 11 × 3 grid fits under the raised row cap', () => {
    const rows = Array.from({ length: 33 }, (_, i) => ({ size: `${28 + i}/${30 + (i % 3) * 2}`, waist: 70 + i, axes: { waist: String(28 + i), leg: String(30 + (i % 3) * 2) } }));
    expect(SizeChartSchema.safeParse(rows).success).toBe(true);
  });
});

describe('mappings keep the men’s columns (plan M2b: seat, neck, sleeve, rise no longer dropped)', () => {
  it('coerceSizeChart carries neck, sleeve, length, rise and axes, and reads seat / collar', () => {
    const rows = coerceSizeChart(
      JSON.stringify([
        { size: '34/32', waist: '88.5', seat: '109', rise: 27, inseam: 81, axes: { waist: '34', leg: 32 } },
        { size: '36/32', waist: 93.5, hips: 114, rise: '27.5', inseam: 81, axes: { waist: 36, leg: '32' } },
      ]),
      [],
      'test',
    );
    expect(rows).toEqual([
      { size: '34/32', waist: 88.5, hip: 109, rise: 27, inseam: 81, axes: { waist: '34', leg: '32' } },
      { size: '36/32', waist: 93.5, hip: 114, rise: 27.5, inseam: 81, axes: { waist: '36', leg: '32' } },
    ]);
    expect(coerceSizeChart([{ size: 'M', collar: 40, sleeve: 64, length: 72 }], [], 'test')).toEqual([{ size: 'M', neck: 40, sleeve: 64, length: 72 }]);
  });
});

describe('body inputs', () => {
  it('MREF is a valid UserBody with neck, arm length and height', () => {
    expect(UserBodySchema.safeParse(MENS_REFERENCE_BODY).success).toBe(true);
    expect(MENS_REFERENCE_BODY.heightCm).toBe(174);
  });
  it('toUserBody projects neck and arm length, and height only when asked', () => {
    const profile: BodyProfile = {
      version: 1,
      measurements: {
        neck: { mean: 39.5, sigma: 1.5, source: 'manual' },
        sleeve: { mean: 64.5, sigma: 1.5, source: 'manual' },
        height: { mean: 174, sigma: 1, source: 'manual' },
      },
    };
    const c = confidenceFromSigma(1.5);
    expect(toUserBody(profile)).toEqual({ measurements: { neck: 39.5, sleeve: 64.5 }, confidence: { neck: c, sleeve: c } });
    expect(toUserBody(profile).heightCm).toBeUndefined();
    expect(toUserBody(profile, { height: true }).heightCm).toBe(174);
  });
});
