import { describe, expect, it } from 'vitest';
import { GarmentPayloadSchema } from '../garment';
import { completenessScore } from '../completeness';
import { mockGarment } from '../fixtures';
import type { MappingWarning } from './common';
import { WOO_META_KEYS, WOO_META_PREFIX, fromWooMeta, indexWooMeta, toWooMeta, type WooProduct } from './woo';

const JEANS = mockGarment('raw-denim-01');

/** WC REST v3 `GET /wc/v3/products/42` shape with the plugin's meta rows. */
const PRODUCT: WooProduct = {
  id: 42,
  name: 'High-Rise Straight Jeans',
  slug: 'high-rise-straight-jeans',
  permalink: 'https://indigo.example/product/high-rise-straight-jeans/',
  type: 'variable',
  status: 'publish',
  price: '120',
  regular_price: '120',
  images: [{ src: 'https://indigo.example/wp-content/uploads/jeans-1.jpg' }, { src: 'https://indigo.example/wp-content/uploads/jeans-2.jpg' }],
  categories: [{ id: 7, name: 'Jeans', slug: 'jeans' }],
  attributes: [
    { name: 'Size', slug: 'pa_size', options: ['26', '27', '28'] },
    { name: 'Brand', slug: 'pa_brand', options: ['Indigo'] },
  ],
  meta_data: [
    { key: '_paskamer_size_chart_type', value: 'body' },
    { key: '_paskamer_size_chart', value: JSON.stringify(JEANS.sizeChart) },
    { key: '_paskamer_fabric', value: JSON.stringify(JEANS.fabric) },
    { key: '_paskamer_flat_lay_photo', value: { id: 991, url: 'https://indigo.example/wp-content/uploads/jeans-flat.png' } },
    { key: '_paskamer_pattern_block', value: 'straight' },
    { key: '_paskamer_ease', value: '{"waist":2,"hip":5}' },
    { key: '_paskamer_length_cm', value: '{"inseam":76,"rise":29,"outseam":105}' },
    { key: '_paskamer_sizing_notes', value: 'raw denim relaxes ~1 cm at the waist with wear' },
    { key: '_paskamer_true_to_size_score', value: '0.85' },
    { key: '_paskamer_critical_fit_points', value: 'waist' },
    { key: '_paskamer_style_tags', value: '{"classic":0.6,"minimal":0.3,"sporty":0.3}' },
    { key: '_paskamer_primary_color_hex', value: '1E2B4D' },
    { key: '_paskamer_colorways', value: JSON.stringify(JEANS.colorways) },
    { key: '_paskamer_subcategory', value: 'straight' },
    { key: '_yoast_wpseo_title', value: 'ignored' },
  ],
};

describe('WOO_META_KEYS', () => {
  it('are prefixed, unique, and cover the heavy fields', () => {
    expect(WOO_META_PREFIX).toBe('_paskamer_');
    expect(WOO_META_KEYS.every((k) => k.key.startsWith('_paskamer_'))).toBe(true);
    expect(new Set(WOO_META_KEYS.map((k) => k.key)).size).toBe(WOO_META_KEYS.length);
    expect(WOO_META_KEYS.filter((k) => k.heavy).map((k) => k.path).sort()).toEqual(['category', 'fabric', 'flatLayPhoto', 'sizeChart', 'sizeChartType']);
    expect(WOO_META_KEYS.find((k) => k.path === 'sizeChartType')?.options).toEqual(['garment', 'body']);
  });
});

describe('fromWooMeta', () => {
  it('normalises a REST product with meta_data into a full, valid GarmentPayload', () => {
    const warnings: MappingWarning[] = [];
    const draft = fromWooMeta(PRODUCT, undefined, { warnings });
    expect(warnings).toEqual([]);
    const parsed = GarmentPayloadSchema.safeParse(draft);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    expect(draft).toMatchObject({
      schemaVersion: 1,
      id: '42',
      name: 'High-Rise Straight Jeans',
      brand: 'Indigo',
      category: 'bottom',
      subcategory: 'straight',
      priceEur: 120,
      productUrl: 'https://indigo.example/product/high-rise-straight-jeans/',
      primaryColorHex: '#1E2B4D',
      flatLayPhoto: 'https://indigo.example/wp-content/uploads/jeans-flat.png',
      sizeChartType: 'body',
      patternBlock: 'straight',
      ease: { waist: 2, hip: 5 },
      lengthCm: { inseam: 76, rise: 29, outseam: 105 },
      trueToSizeScore: 0.85,
      criticalFitPoints: ['waist'],
      styleTags: { classic: 0.6, minimal: 0.3, sporty: 0.3 },
    });
    expect(draft.sizeChart).toEqual(JEANS.sizeChart);
    expect(draft.fabric).toEqual(JEANS.fabric);
    expect(draft.productPhotos).toHaveLength(2);
    expect(completenessScore(draft).status).toBe('active');
  });

  it('accepts a separate meta record (get_post_meta shape, single-value arrays) and un-prefixed keys', () => {
    const { meta_data: _m, ...bare } = PRODUCT;
    const draft = fromWooMeta(bare, {
      _paskamer_size_chart_type: ['garment'],
      size_chart: ['[{"size":"28","waist":74,"hip":99}]'],
      _paskamer_critical_fit_points: 'waist, hips',
      _paskamer_stretch_zones: ['waistband|rib-hem'],
    });
    expect(draft.sizeChartType).toBe('garment');
    expect(draft.sizeChart).toEqual([{ size: '28', waist: 74, hip: 99 }]);
    expect(draft.criticalFitPoints).toEqual(['waist', 'hip']);
    expect(draft.stretchZones).toEqual(['waistband', 'rib-hem']);
  });

  it('infers category from WooCommerce categories / name and respects the explicit meta', () => {
    const { meta_data: _m, ...bare } = PRODUCT;
    expect(fromWooMeta({ ...bare, categories: [{ name: 'Jurken' }] }).category).toBe('dress');
    expect(fromWooMeta({ ...bare, categories: [], name: 'Wool Overcoat' }).category).toBe('outerwear');
    expect(fromWooMeta({ ...bare, categories: [{ name: 'Clothing > Shoes' }] }, { _paskamer_category: 'accessory' }).category).toBe('accessory');
  });

  it('brand: meta > brands taxonomy > Brand attribute > defaultBrand', () => {
    const { meta_data: _m, ...bare } = PRODUCT;
    expect(fromWooMeta(bare).brand).toBe('Indigo');
    expect(fromWooMeta({ ...bare, brands: [{ name: 'Indigo Denim Co' }] }).brand).toBe('Indigo Denim Co');
    expect(fromWooMeta(bare, { _paskamer_brand: 'Override' }).brand).toBe('Override');
    expect(fromWooMeta({ ...bare, attributes: [] }, {}, { defaultBrand: 'My Shop' }).brand).toBe('My Shop');
  });

  it('respects the shop currency and warns when it is not EUR', () => {
    const warnings: MappingWarning[] = [];
    const gbp = fromWooMeta(PRODUCT, undefined, { currency: 'GBP', warnings });
    expect(gbp.priceEur).toBeUndefined();
    expect(warnings.map((w) => w.path)).toEqual(['priceEur']);
    expect(fromWooMeta({ ...PRODUCT, price: '' }).priceEur).toBe(120); // regular_price fallback
  });

  it('warns per invalid field and keeps the rest', () => {
    const warnings: MappingWarning[] = [];
    const { meta_data: _m, ...bare } = PRODUCT;
    const draft = fromWooMeta(
      bare,
      {
        _paskamer_size_chart: 'not json',
        _paskamer_fabric: '{"primary":"denim","stretchPct":-5,"drape":0.2}',
        _paskamer_flat_lay_photo: 'wp-content/uploads/not-absolute.png',
        _paskamer_true_to_size_score: 'high',
        _paskamer_sizing_notes: 'true to size',
      },
      { warnings },
    );
    expect(draft.sizeChart).toBeUndefined();
    expect(draft.fabric).toBeUndefined();
    expect(draft.flatLayPhoto).toBeUndefined();
    expect(draft.sizingNotes).toBe('true to size');
    expect(warnings.map((w) => w.path).sort()).toEqual(['fabric', 'flatLayPhoto', 'sizeChart', 'trueToSizeScore']);
  });

  it('returns {} for a non-product', () => {
    expect(fromWooMeta({ foo: 'bar' } as unknown as WooProduct)).toEqual({});
  });
});

describe('toWooMeta / indexWooMeta', () => {
  it('round-trips a payload through meta rows', () => {
    const rows = toWooMeta(JEANS);
    expect(rows.find((r) => r.key === '_paskamer_size_chart')?.value).toBe(JSON.stringify(JEANS.sizeChart));
    expect(rows.find((r) => r.key === '_paskamer_critical_fit_points')?.value).toBe('["waist"]');
    const { meta_data: _m, ...bare } = PRODUCT;
    const back = fromWooMeta(bare, rows);
    expect(back.sizeChart).toEqual(JEANS.sizeChart);
    expect(back.fabric).toEqual(JEANS.fabric);
    expect(back.ease).toEqual(JEANS.ease);
    expect(back.lengthCm).toEqual(JEANS.lengthCm);
    expect(back.styleTags).toEqual(JEANS.styleTags);
    expect(back.colorways).toEqual(JEANS.colorways);
    expect(back.flatLayPhoto).toBe(JEANS.flatLayPhoto);
    expect(GarmentPayloadSchema.safeParse(back).success).toBe(true);
  });

  it('indexWooMeta unwraps get_post_meta one-element string arrays and keeps real arrays', () => {
    const m = indexWooMeta({ _paskamer_pattern_block: ['wrap'], _paskamer_critical_fit_points: ['bust'], _paskamer_stretch_zones: ['cuff', 'rib-hem'], _paskamer_ease: [{ bust: 1 }] });
    expect(m.get('_paskamer_pattern_block')).toBe('wrap');
    expect(m.get('_paskamer_critical_fit_points')).toBe('bust');
    expect(m.get('_paskamer_stretch_zones')).toEqual(['cuff', 'rib-hem']);
    expect(m.get('_paskamer_ease')).toEqual([{ bust: 1 }]);
  });
});
