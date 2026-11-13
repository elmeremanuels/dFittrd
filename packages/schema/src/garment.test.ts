import { describe, expect, it } from 'vitest';
import {
  CATEGORY_POINTS,
  FABRIC_PRIMARIES,
  GARMENT_CATEGORIES,
  GarmentPayloadDraftSchema,
  GarmentPayloadSchema,
  PATTERN_BLOCKS,
  parseGarmentPayload,
  safeParseGarmentPayload,
  type FabricPrimary,
  type GarmentPayload,
  type PatternBlock,
} from './garment';

/** The handoff §3.1 payload, verbatim, plus the fields the schema adds. */
const HANDOFF_WRAP: GarmentPayload = {
  schemaVersion: 1,
  id: 'aalter-studio-1',
  brand: 'Aalter Studio',
  name: 'Linen Wrap Dress',
  category: 'dress',
  subcategory: 'wrap-midi',
  priceEur: 149,
  primaryColorHex: '#C97A4F',
  colorways: [{ name: 'Terracotta', hex: '#C97A4F' }],
  productPhotos: ['https://cdn.example.com/aalter/wrap-1.jpg'],
  flatLayPhoto: 'https://cdn.example.com/aalter/wrap-flat.png',
  fabric: {
    primary: 'linen',
    blend: [['linen', 100]],
    weightGsm: 240,
    stretchPct: 2,
    drape: 0.78,
    opacity: 0.92,
    sheen: 0.15,
  },
  patternBlock: 'wrap',
  ease: { bust: 6, waist: 4, hip: 8 },
  lengthCm: { shoulder_to_hem: 118, shoulder_to_waist: 41, sleeve_length: 0 },
  sizeChartType: 'body',
  sizeChart: [
    { size: 'XS', bust: 84, waist: 64, hip: 92, shoulder: 36 },
    { size: 'S', bust: 88, waist: 68, hip: 96, shoulder: 37 },
  ],
  sizingNotes: 'runs small',
  trueToSizeScore: 0.92,
  criticalFitPoints: ['bust', 'shoulder'],
  stretchZones: ['waist-tie'],
};

describe('GarmentPayloadSchema', () => {
  it('accepts the handoff §3.1 payload', () => {
    const parsed = parseGarmentPayload(HANDOFF_WRAP);
    expect(parsed).toEqual(HANDOFF_WRAP);
  });

  it('requires sizeChartType (fit-engine T14)', () => {
    const { sizeChartType: _omit, ...without } = HANDOFF_WRAP;
    const r = safeParseGarmentPayload(without);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('sizeChartType');
  });

  it('requires schemaVersion literal 1', () => {
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, schemaVersion: 2 }).success).toBe(false);
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, schemaVersion: undefined }).success).toBe(false);
  });

  it('accepts shoulder, thigh, inseam, footEu and footLengthCm in size rows', () => {
    const r = safeParseGarmentPayload({
      ...HANDOFF_WRAP,
      sizeChart: [{ size: '38', shoulder: 37, thigh: 56, inseam: 78, footEu: 38, footLengthCm: 24 }],
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown categories, bad hex colours, non-https photos and out-of-range units', () => {
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, category: 'hat' }).success).toBe(false);
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, primaryColorHex: 'C97A4F' }).success).toBe(false);
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, flatLayPhoto: 'ftp://x/y.png' }).success).toBe(false);
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, fabric: { ...HANDOFF_WRAP.fabric, drape: 1.5 } }).success).toBe(false);
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, trueToSizeScore: -0.1 }).success).toBe(false);
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, sizeChart: [] }).success).toBe(false);
  });

  it('allows the (string & {}) escape for fabric.primary, patternBlock and stretchZones', () => {
    const r = safeParseGarmentPayload({
      ...HANDOFF_WRAP,
      fabric: { ...HANDOFF_WRAP.fabric, primary: 'hemp' },
      patternBlock: 'trucker',
      stretchZones: ['collar'],
    });
    expect(r.success).toBe(true);
    // Type-level: known literals and arbitrary strings both type-check.
    const a: PatternBlock = 'wrap';
    const b: PatternBlock = 'mystery';
    const c: FabricPrimary = 'linen';
    const d: FabricPrimary = 'hemp';
    expect([a, b, c, d]).toHaveLength(4);
  });

  it('accepts styleTags only on the five taste axes, in 0..1', () => {
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, styleTags: { bohemian: 0.9, classic: 0.3 } }).success).toBe(true);
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, styleTags: { bohemian: 1.2 } }).success).toBe(false);
    expect(safeParseGarmentPayload({ ...HANDOFF_WRAP, styleTags: { grunge: 0.5 } }).success).toBe(false);
  });

  it('accepts negative ease for stretch garments and arbitrary lengthCm keys', () => {
    const r = safeParseGarmentPayload({
      ...HANDOFF_WRAP,
      ease: { bust: -2, waist: -3 },
      lengthCm: { shoulder_to_hem: 110, custom_point: 12 },
    });
    expect(r.success).toBe(true);
  });

  it('exposes the vocabularies the engines rely on', () => {
    expect(GARMENT_CATEGORIES).toEqual(['top', 'bottom', 'dress', 'outerwear', 'shoes', 'accessory']);
    expect(PATTERN_BLOCKS).toContain('wrap');
    expect(PATTERN_BLOCKS).toContain('bias');
    expect(PATTERN_BLOCKS).toContain('wide-leg');
    expect(FABRIC_PRIMARIES.slice(0, 8)).toEqual(['linen', 'cotton', 'wool', 'silk', 'cashmere', 'tencel', 'modal', 'denim']);
    expect(CATEGORY_POINTS.bottom).toEqual(['waist', 'hip', 'thigh', 'inseam']);
    expect(CATEGORY_POINTS.accessory).toEqual([]);
  });
});

describe('GarmentPayloadDraftSchema', () => {
  it('requires only id, name and brand', () => {
    expect(GarmentPayloadDraftSchema.safeParse({ id: 'x', name: 'Thing', brand: 'B' }).success).toBe(true);
    expect(GarmentPayloadDraftSchema.safeParse({ id: 'x', name: 'Thing' }).success).toBe(false);
  });

  it('still validates optional fields when present', () => {
    expect(GarmentPayloadDraftSchema.safeParse({ id: 'x', name: 'T', brand: 'B', category: 'nope' }).success).toBe(false);
    expect(GarmentPayloadDraftSchema.safeParse({ id: 'x', name: 'T', brand: 'B', sizeChart: [{ size: 'M', bust: 'big' }] }).success).toBe(false);
  });

  it('a full payload is also a valid draft', () => {
    expect(GarmentPayloadDraftSchema.safeParse(HANDOFF_WRAP).success).toBe(true);
    expect(GarmentPayloadSchema.safeParse(HANDOFF_WRAP).success).toBe(true);
  });
});
