import { describe, expect, it } from 'vitest';
import { FIT_POINT_LABELS_EN, bustLabelKey, fitPointLabel, fitPointLabelKey } from './audience';
import { FIT_POINTS, GARMENT_AUDIENCES, GarmentPayloadSchema, GarmentPayloadDraftSchema, type GarmentAudience } from './garment';
import { MOCK_GARMENTS } from './fixtures';

describe('audience on the payload', () => {
  const base = MOCK_GARMENTS[0]!;

  it('is optional: a payload without it parses exactly as before', () => {
    expect('audience' in base).toBe(false);
    const parsed = GarmentPayloadSchema.parse(base);
    expect(parsed).toEqual(base);
    expect('audience' in parsed).toBe(false);
  });

  it('accepts women, men and unisex and nothing else', () => {
    for (const audience of GARMENT_AUDIENCES) expect(GarmentPayloadSchema.parse({ ...base, audience }).audience).toBe(audience);
    for (const bad of ['mens', 'Men', 'male', '', null, 1]) expect(GarmentPayloadSchema.safeParse({ ...base, audience: bad }).success, String(bad)).toBe(false);
    expect(GarmentPayloadDraftSchema.safeParse({ id: '1', name: 'x', brand: 'y', audience: 'men' }).success).toBe(true);
    expect(GarmentPayloadDraftSchema.safeParse({ id: '1', name: 'x', brand: 'y', audience: 'heren' }).success).toBe(false);
  });
});

describe('label choice', () => {
  it('shows Chest for men and unisex, Bust for women and for no audience', () => {
    expect(bustLabelKey('men')).toBe('chest');
    expect(bustLabelKey('unisex')).toBe('chest');
    expect(bustLabelKey('women')).toBe('bust');
    expect(bustLabelKey(undefined)).toBe('bust');
    expect(bustLabelKey(null)).toBe('bust');
    expect(bustLabelKey('mens' as GarmentAudience)).toBe('bust');
    expect(fitPointLabel('bust', 'men')).toBe('Chest');
    expect(fitPointLabel('bust', 'unisex')).toBe('Chest');
    expect(fitPointLabel('bust', 'women')).toBe('Bust');
    expect(fitPointLabel('bust')).toBe('Bust');
  });

  it('leaves every other fit point alone, for every audience', () => {
    for (const p of FIT_POINTS) {
      if (p === 'bust') continue;
      for (const a of [...GARMENT_AUDIENCES, undefined, null]) {
        expect(fitPointLabelKey(p, a)).toBe(p);
        expect(fitPointLabel(p, a)).toBe(FIT_POINT_LABELS_EN[p]);
      }
    }
    expect(Object.keys(FIT_POINT_LABELS_EN).sort()).toEqual([...FIT_POINTS, 'chest'].sort());
  });
});
