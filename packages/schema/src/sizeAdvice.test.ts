import { describe, expect, it } from 'vitest';
import { AU_WOMENS_BODY_TEMPLATE, chartFromBodyTemplate, checkChart, bodyTemplateMatching } from './chartTemplates';
import { completenessScore } from './completeness';
import { GarmentPayloadSchema } from './garment';
import { mockGarment } from './fixtures';
import { fromShopifyProduct, type ShopifyMetafield, type ShopifyProductNode } from './mappings/shopify';
import { fromWooMeta } from './mappings/woo';
import type { MappingWarning } from './mappings/common';
import { SIZE_ADVICE_DEFAULTS, SIZE_ADVICE_FIELDS, isSizeAdviceReady, sizeAdviceGarment } from './sizeAdvice';

/** The pilot shop: an AUD boutique (bohohippychic.com.au) selling AU 8–16. */
const AU_CHART = chartFromBodyTemplate(AU_WOMENS_BODY_TEMPLATE, ['8', '10', '12', '14', '16']);

const AUD_DRESS: ShopifyProductNode = {
  id: 'gid://shopify/Product/7001',
  handle: 'gypsy-maxi-dress',
  title: 'Gypsy Maxi Dress',
  vendor: 'Boho Hippy Chic',
  productType: 'Dresses',
  status: 'ACTIVE',
  onlineStoreUrl: 'https://bohohippychic.com.au/products/gypsy-maxi-dress',
  priceRangeV2: { minVariantPrice: { amount: '89.95', currencyCode: 'AUD' } },
};

/** What the builder's bulk assign writes: the chart type and the chart, nothing else. */
const TEMPLATE_ONLY: ShopifyMetafield[] = [
  { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: AU_CHART.sizeChartType },
  { namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify(AU_CHART.sizeChart) },
];

const RATES = { EUR: 1, AUD: 1.78 };

describe('R1: an AUD-priced product maps to a priceEur', () => {
  it('converts AUD with the rate table and reports it', () => {
    const warnings: MappingWarning[] = [];
    const draft = fromShopifyProduct(AUD_DRESS, TEMPLATE_ONLY, { warnings, eurRates: RATES });
    expect(draft.priceEur).toBe(50.53);
    expect(warnings.find((w) => w.path === 'priceEur')?.message).toMatch(/converted from AUD/);
  });

  it('without a rate the price is left out, and the product is still try-able', () => {
    const draft = fromShopifyProduct(AUD_DRESS, TEMPLATE_ONLY);
    expect(draft.priceEur).toBeUndefined();
    const r = sizeAdviceGarment(draft);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.garment.priceEur).toBe(SIZE_ADVICE_DEFAULTS.priceEur);
  });

  it('full metafields + AUD: fromShopifyProduct → GarmentPayloadSchema passes once the rate is known', () => {
    const wrap = mockGarment('aalter-studio-1');
    const full: ShopifyMetafield[] = [
      ...TEMPLATE_ONLY,
      { namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify(wrap.fabric) },
      { namespace: '$app:curtain', key: 'pattern_block', type: 'single_line_text_field', value: 'tent' },
      { namespace: '$app:curtain', key: 'primary_color_hex', type: 'color', value: '#C97A4F' },
    ];
    const without = GarmentPayloadSchema.safeParse(fromShopifyProduct(AUD_DRESS, full));
    expect(without.success).toBe(false); // the bug: priceEur missing
    const withRate = GarmentPayloadSchema.safeParse(fromShopifyProduct(AUD_DRESS, full, { eurRates: RATES }));
    expect(withRate.success).toBe(true);
  });

  it('Woo converts the same way', () => {
    const draft = fromWooMeta({ id: 12, name: 'Kaftan', price: '178' }, [], { currency: 'AUD', eurRates: RATES });
    expect(draft.priceEur).toBe(100);
  });
});

describe('R2: sizeAdviceGarment — size advice from category + chart type + chart', () => {
  it('a template-only product resolves with defaults for price, colour, block and fabric', () => {
    const draft = fromShopifyProduct(AUD_DRESS, TEMPLATE_ONLY, { eurRates: RATES, defaultBrand: 'Boho Hippy Chic' });
    const r = sizeAdviceGarment(draft, { colorHex: '#7A4E2D' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.garment.category).toBe('dress');
    expect(r.garment.sizeChart.map((row) => row.size)).toEqual(['8', '10', '12', '14', '16']);
    expect(r.garment.primaryColorHex).toBe('#7A4E2D');
    expect(r.garment.patternBlock).toBe(SIZE_ADVICE_DEFAULTS.patternBlock);
    expect(r.garment.fabric).toEqual({ primary: 'woven', stretchPct: 0, drape: 0.5 });
    expect(r.defaulted.sort()).toEqual(['fabric.drape', 'fabric.primary', 'fabric.stretchPct', 'patternBlock', 'primaryColorHex']);
    expect(GarmentPayloadSchema.safeParse(r.garment).success).toBe(true);
  });

  it('keeps every field the merchant set and only fills the gaps', () => {
    const g = mockGarment('aalter-studio-1');
    const r = sizeAdviceGarment(g);
    expect(r.ok && r.defaulted).toEqual([]);
    const partialFabric = sizeAdviceGarment({ ...g, fabric: { primary: 'jersey', stretchPct: 30 } });
    expect(partialFabric.ok && partialFabric.garment.fabric).toEqual({ primary: 'jersey', stretchPct: 30, drape: 0.5 });
  });

  it('is not ready without a chart, a chart type or a category, and names the missing field', () => {
    const draft = fromShopifyProduct(AUD_DRESS, TEMPLATE_ONLY, { eurRates: RATES });
    for (const field of SIZE_ADVICE_FIELDS) {
      const r = sizeAdviceGarment({ ...draft, [field]: undefined });
      expect(r.ok, field).toBe(false);
      if (!r.ok) expect(r.missing.map((m) => m.field)).toContain(field);
    }
    expect(isSizeAdviceReady({})).toBe(false);
  });

  it('a present but invalid field is reported, not silently replaced', () => {
    const draft = fromShopifyProduct(AUD_DRESS, TEMPLATE_ONLY, { eurRates: RATES });
    const r = sizeAdviceGarment({ ...draft, fabric: { primary: 'linen', stretchPct: 500, drape: 0.4 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing[0]!.field).toBe('fabric.stretchPct');
  });

  it('size advice ready is wider than full completeness: flat-lay and fabric are not needed', () => {
    const draft = fromShopifyProduct(AUD_DRESS, TEMPLATE_ONLY, { eurRates: RATES });
    expect(completenessScore(draft).status).toBe('incomplete');
    expect(isSizeAdviceReady(draft)).toBe(true);
  });
});

describe('R6: checkChart warns when body numbers are marked as garment', () => {
  it('flags the AU body template sent as a garment chart', () => {
    const c = checkChart({ sizeChartType: 'garment', sizeChart: AU_CHART.sizeChart });
    expect(c.ok).toBe(true);
    expect(c.warnings.join(' ')).toMatch(/body chart, but the chart is marked as garment/);
    expect(bodyTemplateMatching(AU_CHART.sizeChart)?.id).toBe('au-womens-body');
  });

  it('stays quiet for a body chart and for real garment numbers', () => {
    expect(checkChart(AU_CHART).warnings.join(' ')).not.toMatch(/marked as garment/);
    const garment = AU_CHART.sizeChart.map((r) => ({ ...r, bust: (r.bust ?? 0) + 8, waist: (r.waist ?? 0) + 8, hip: (r.hip ?? 0) + 8 }));
    expect(checkChart({ sizeChartType: 'garment', sizeChart: garment }).warnings.join(' ')).not.toMatch(/marked as garment/);
  });
});
