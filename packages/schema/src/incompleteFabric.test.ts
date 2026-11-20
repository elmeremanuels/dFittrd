/**
 * Point 10 (D24 point 4, D25 point 1): a product whose fabric has only a name, with no stretch and
 * no drape, must be accepted as a draft on every way in: the plain merchant api body, the Shopify
 * metafield mapping and the WooCommerce meta mapping. Only the missing part is left out.
 */
import { describe, expect, it } from 'vitest';
import { MerchantProductUpsertRequestSchema } from './api';
import { GarmentPayloadDraftSchema } from './garment';
import { mockGarment } from './fixtures';
import { fromShopifyProduct, type ShopifyMetafield, type ShopifyProductNode } from './mappings/shopify';
import { fromWooMeta, type WooProduct } from './mappings/woo';
import type { MappingWarning } from './mappings/common';
import { sizeAdviceGarment } from './sizeAdvice';

const WRAP = mockGarment('aalter-studio-1');
const NAME_ONLY = { primary: 'linen' };

const SHOPIFY_PRODUCT: ShopifyProductNode = {
  id: 'gid://shopify/Product/8812345678901',
  handle: 'linen-wrap-dress',
  title: 'Linen Wrap Dress',
  vendor: 'Aalter Studio',
  productType: 'Dresses',
  status: 'ACTIVE',
  onlineStoreUrl: 'https://aalter-studio.myshopify.com/products/linen-wrap-dress',
  priceRangeV2: { minVariantPrice: { amount: '149.00', currencyCode: 'EUR' } },
};
const shopifyMetafields = (fabric: unknown): ShopifyMetafield[] => [
  { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
  { namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify(WRAP.sizeChart) },
  { namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify(fabric) },
];

const wooProduct = (fabric: unknown): WooProduct => ({
  id: 42,
  name: 'Linen Wrap Dress',
  slug: 'linen-wrap-dress',
  permalink: 'https://aalter.example/product/linen-wrap-dress/',
  type: 'variable',
  status: 'publish',
  price: '149',
  categories: [{ id: 7, name: 'Dresses', slug: 'dresses' }],
  attributes: [{ name: 'Brand', slug: 'pa_brand', options: ['Aalter Studio'] }],
  meta_data: [
    { key: '_curtain_size_chart_type', value: 'body' },
    { key: '_curtain_size_chart', value: JSON.stringify(WRAP.sizeChart) },
    { key: '_curtain_fabric', value: JSON.stringify(fabric) },
  ],
});

describe('a fabric with only a name', () => {
  it('plain api: the merchant upsert body accepts it', () => {
    const body = { id: 'p-1', name: 'Linen Wrap Dress', brand: 'Aalter Studio', category: 'dress', sizeChartType: 'body', sizeChart: WRAP.sizeChart, fabric: NAME_ONLY };
    const parsed = MerchantProductUpsertRequestSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    const draft = GarmentPayloadDraftSchema.safeParse(body);
    expect(draft.success, JSON.stringify(draft.success ? null : draft.error.issues)).toBe(true);
    expect(draft.data?.fabric).toEqual(NAME_ONLY);
  });

  it('Shopify: the mapped product is a valid draft that keeps the name and can be sized', () => {
    const warnings: MappingWarning[] = [];
    const mapped = fromShopifyProduct(SHOPIFY_PRODUCT, shopifyMetafields(NAME_ONLY), { warnings });
    expect(mapped.fabric).toEqual(NAME_ONLY);
    const draft = GarmentPayloadDraftSchema.safeParse(mapped);
    expect(draft.success, JSON.stringify(draft.success ? null : draft.error.issues)).toBe(true);
    expect(sizeAdviceGarment(draft.data).ok).toBe(true);
  });

  it('WooCommerce: the mapped product is a valid draft that keeps the name and can be sized', () => {
    const warnings: MappingWarning[] = [];
    const mapped = fromWooMeta(wooProduct(NAME_ONLY), undefined, { warnings });
    expect(mapped.fabric).toEqual(NAME_ONLY);
    const draft = GarmentPayloadDraftSchema.safeParse(mapped);
    expect(draft.success, JSON.stringify(draft.success ? null : draft.error.issues)).toBe(true);
    expect(sizeAdviceGarment(draft.data).ok).toBe(true);
  });
});
