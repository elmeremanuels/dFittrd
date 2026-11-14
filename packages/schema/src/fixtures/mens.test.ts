import { describe, expect, it } from 'vitest';
import { UserBodySchema } from '../body';
import { completenessScore } from '../completeness';
import { GarmentPayloadSchema } from '../garment';
import { fitPointLabel } from '../audience';
import { fromWooMeta, toWooMeta } from '../mappings/woo';
import { fromShopifyProduct, toShopifyMetafields } from '../mappings/shopify';
import { MENS_FIXTURE_GARMENTS, MENS_OXFORD_SHIRT, MENS_STRAIGHT_JEANS, MENS_TEST_BODIES, MOCK_GARMENTS } from './index';

describe("men's fixture products", () => {
  it('are a shirt and jeans that parse as GarmentPayload v1 and are complete', () => {
    expect(MENS_FIXTURE_GARMENTS.map((g) => g.category)).toEqual(['top', 'bottom']);
    for (const g of MENS_FIXTURE_GARMENTS) {
      const r = GarmentPayloadSchema.safeParse(g);
      expect(r.success, `${g.id}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
      expect(g.audience).toBe('men');
      expect(g.sizeChartType).toBe('body');
      expect(completenessScore(g).status, g.id).toBe('active');
      expect(fitPointLabel('bust', g.audience)).toBe('Chest');
    }
  });

  it('stay out of MOCK_GARMENTS, which keeps no audience', () => {
    const ids = new Set(MOCK_GARMENTS.map((g) => g.id));
    for (const g of MENS_FIXTURE_GARMENTS) expect(ids.has(g.id)).toBe(false);
    expect(MOCK_GARMENTS.every((g) => g.audience === undefined)).toBe(true);
  });

  it('carry the chest in `bust`: the shirt has chest, waist and seat, the jeans waist and inseam', () => {
    expect(MENS_OXFORD_SHIRT.sizeChart.map((r) => r.size)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    expect(MENS_OXFORD_SHIRT.sizeChart[2]).toEqual({ size: 'M', bust: 100.5, waist: 86, hip: 100 });
    expect(MENS_STRAIGHT_JEANS.sizeChart).toHaveLength(19);
    expect(MENS_STRAIGHT_JEANS.sizeChart.find((r) => r.size === '34/32')).toEqual({ size: '34/32', waist: 86, inseam: 81 });
  });

  it('round-trip through the WooCommerce and Shopify mappings with the audience kept', () => {
    for (const g of MENS_FIXTURE_GARMENTS) {
      const woo = fromWooMeta({ id: g.id, name: g.name, price: String(g.priceEur) }, toWooMeta(g), { defaultBrand: g.brand });
      expect(woo.audience).toBe('men');
      expect(woo.sizeChart).toEqual(g.sizeChart);
      const metafields = toShopifyMetafields(g, 'gid://shopify/Product/1').map((m) => ({ namespace: m.namespace, key: m.key, type: m.type, value: m.value }));
      expect(metafields.find((m) => m.key === 'audience')?.value).toBe('men');
      const shopify = fromShopifyProduct({ id: 'gid://shopify/Product/1', title: g.name, vendor: g.brand }, metafields);
      expect(shopify.audience).toBe('men');
      expect(shopify.sizeChart).toEqual(g.sizeChart);
    }
  });

  it('three male test bodies are valid fit-engine input', () => {
    expect(MENS_TEST_BODIES.map((b) => b.id)).toEqual(['slim', 'medium', 'broad']);
    for (const b of MENS_TEST_BODIES) expect(UserBodySchema.safeParse(b.body).success, b.id).toBe(true);
  });
});
