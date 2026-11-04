import { describe, expect, it } from 'vitest';
import { GARMENT_CATEGORIES, GarmentPayloadSchema } from '../garment';
import { completenessScore } from '../completeness';
import { MOCK_GARMENTS, MOCK_GARMENTS_BY_CATEGORY, MOCK_GARMENTS_BY_ID, PROTOTYPE_GARMENT_IDS, grade, mockGarment } from './index';

describe('MOCK_GARMENTS', () => {
  it('has at least 40 items, all valid GarmentPayload v1, with unique ids', () => {
    expect(MOCK_GARMENTS.length).toBeGreaterThanOrEqual(40);
    for (const g of MOCK_GARMENTS) {
      const r = GarmentPayloadSchema.safeParse(g);
      expect(r.success, `${g.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
    expect(new Set(MOCK_GARMENTS.map((g) => g.id)).size).toBe(MOCK_GARMENTS.length);
  });

  it('covers all six categories and several brands', () => {
    for (const c of GARMENT_CATEGORIES) {
      expect(MOCK_GARMENTS_BY_CATEGORY[c].length, c).toBeGreaterThanOrEqual(5);
      expect(MOCK_GARMENTS_BY_CATEGORY[c].every((g) => g.category === c)).toBe(true);
    }
    expect(new Set(MOCK_GARMENTS.map((g) => g.brand)).size).toBeGreaterThanOrEqual(8);
  });

  it('every item carries the render + fit fields and placeholder photos', () => {
    for (const g of MOCK_GARMENTS) {
      expect(g.flatLayPhoto, g.id).toMatch(/^https:\/\/placehold\.co\//);
      expect(g.productPhotos?.length, g.id).toBeGreaterThanOrEqual(1);
      expect(g.sizeChart.length, g.id).toBeGreaterThanOrEqual(1);
      expect(g.fabric.drape, g.id).toBeGreaterThanOrEqual(0);
      expect(['garment', 'body']).toContain(g.sizeChartType);
      if (g.category !== 'accessory') {
        expect(g.sizingNotes, g.id).toBeTruthy();
        expect(g.trueToSizeScore, g.id).toBeDefined();
        expect(g.criticalFitPoints?.length, g.id).toBeGreaterThanOrEqual(1);
      }
      if (['top', 'dress', 'outerwear', 'bottom'].includes(g.category)) {
        expect(g.ease, g.id).toBeDefined();
        expect(g.lengthCm, g.id).toBeDefined();
      }
      expect(completenessScore(g).status, g.id).toBe('active');
    }
  });

  it('size charts are ascending per fit point', () => {
    for (const g of MOCK_GARMENTS) {
      for (const key of ['bust', 'waist', 'hip', 'shoulder', 'thigh', 'footEu', 'footLengthCm'] as const) {
        const vals = g.sizeChart.map((r) => r[key]).filter((v): v is number => typeof v === 'number' && v > 0);
        for (let i = 1; i < vals.length; i++) expect(vals[i]!, `${g.id}.${key}`).toBeGreaterThanOrEqual(vals[i - 1]!);
      }
    }
  });

  it('shoe charts and clothing charts carry the category-specific columns', () => {
    for (const g of MOCK_GARMENTS_BY_CATEGORY.shoes) {
      expect(g.sizeChart.every((r) => r.footEu && r.footLengthCm), g.id).toBe(true);
      expect(g.criticalFitPoints).toEqual(['foot']);
    }
    for (const g of [...MOCK_GARMENTS_BY_CATEGORY.top, ...MOCK_GARMENTS_BY_CATEGORY.dress, ...MOCK_GARMENTS_BY_CATEGORY.outerwear]) {
      // Bias-cut slips (incl. the fit-engine `SLIP` fixture monochrome-02) have no shoulder seam.
      if (g.patternBlock === 'bias') continue;
      expect(g.sizeChart.some((r) => r.shoulder), g.id).toBe(true);
    }
    expect(MOCK_GARMENTS_BY_CATEGORY.bottom.some((g) => g.sizeChart.every((r) => r.thigh && r.inseam))).toBe(true);
  });

  it('contains the three prototype items with the exact fit-engine fixture charts and sizeChartType body', () => {
    expect(PROTOTYPE_GARMENT_IDS).toEqual(['aalter-studio-1', 'monochrome-02', 'raw-denim-01']);

    const wrap = mockGarment('aalter-studio-1');
    expect(wrap).toMatchObject({
      brand: 'Aalter Studio',
      name: 'Linen Wrap Dress',
      category: 'dress',
      subcategory: 'wrap-midi',
      priceEur: 149,
      primaryColorHex: '#C97A4F',
      patternBlock: 'wrap',
      sizeChartType: 'body',
      ease: { bust: 6, waist: 4, hip: 8 },
      lengthCm: { shoulder_to_hem: 118, shoulder_to_waist: 41, sleeve_length: 0 },
      sizingNotes: 'runs small',
      trueToSizeScore: 0.92,
      criticalFitPoints: ['bust', 'shoulder'],
      stretchZones: ['waist-tie'],
      styleTags: { bohemian: 0.9, classic: 0.3 },
    });
    expect(wrap.fabric).toMatchObject({ primary: 'linen', weightGsm: 240, stretchPct: 2, drape: 0.78, opacity: 0.92, sheen: 0.15 });
    expect(wrap.sizeChart).toEqual([
      { size: 'XS', bust: 84, waist: 64, hip: 92, shoulder: 36 },
      { size: 'S', bust: 88, waist: 68, hip: 96, shoulder: 37 },
      { size: 'M', bust: 92, waist: 72, hip: 100, shoulder: 38 },
      { size: 'L', bust: 96, waist: 76, hip: 104, shoulder: 39 },
    ]);

    const slip = mockGarment('monochrome-02');
    expect(slip).toMatchObject({ brand: 'Monochrome', category: 'top', patternBlock: 'bias', sizeChartType: 'body', priceEur: 89, primaryColorHex: '#EAEAEA', criticalFitPoints: ['bust'], trueToSizeScore: 0.8 });
    expect(slip.fabric).toMatchObject({ primary: 'silk', weightGsm: 120, stretchPct: 0, drape: 0.95 });
    expect(slip.sizeChart).toEqual([
      { size: 'XS', bust: 80, waist: 60, hip: 88 },
      { size: 'S', bust: 84, waist: 64, hip: 92 },
      { size: 'M', bust: 88, waist: 68, hip: 96 },
    ]);

    const jeans = mockGarment('raw-denim-01');
    expect(jeans).toMatchObject({ brand: 'Indigo', category: 'bottom', patternBlock: 'straight', sizeChartType: 'body', priceEur: 120, primaryColorHex: '#1E2B4D', criticalFitPoints: ['waist'], trueToSizeScore: 0.85 });
    expect(jeans.fabric).toMatchObject({ primary: 'denim', weightGsm: 400, stretchPct: 1, drape: 0.2 });
    expect(jeans.sizeChart).toEqual([
      { size: '26', waist: 66, hip: 91 },
      { size: '27', waist: 68.5, hip: 93.5 },
      { size: '28', waist: 71, hip: 96 },
    ]);
  });

  it('includes the taste-engine JACKET vector item', () => {
    const jacket = mockGarment('indigo-04');
    expect(jacket).toMatchObject({ styleTags: { classic: 0.5, sporty: 0.3 }, primaryColorHex: '#1E2B4D', patternBlock: 'trucker', priceEur: 150 });
    expect(jacket.fabric.primary).toBe('denim');
  });

  it('is frozen and lookups throw for unknown ids', () => {
    expect(Object.isFrozen(MOCK_GARMENTS)).toBe(true);
    expect(MOCK_GARMENTS_BY_ID['aalter-studio-1']).toBe(MOCK_GARMENTS[0]);
    expect(() => mockGarment('nope')).toThrow(/unknown mock garment/);
  });

  it('grade() builds linear size charts', () => {
    expect(grade(['S', 'M'], { bust: 84, waist: 64 }, { bust: 4, waist: 4 })).toEqual([
      { size: 'S', bust: 84, waist: 64 },
      { size: 'M', bust: 88, waist: 68 },
    ]);
  });
});
