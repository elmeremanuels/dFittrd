/**
 * Point 10 (D24 point 4, D25 point 1): a product whose fabric has only a name, with no stretch and
 * no drape, must be accepted as a draft on every way in: the plain merchant api body, the Shopify
 * metafield mapping and the WooCommerce meta mapping. Only the missing part is left out.
 */
import { describe, expect, it } from 'vitest';
import { MerchantProductSummarySchema, MerchantProductUpsertRequestSchema, MerchantProductUpsertResponseSchema, MerchantSettingsResponseSchema, MerchantSettingsUpdateRequestSchema, SdkShopStatusQuerySchema, SdkShopStatusResponseSchema, ShopBrandingSchema, TryResolveResponseSchema } from './api';
import {
  DEFAULT_INCOMPLETE_PRODUCT_DATA,
  INCOMPLETE_PRODUCT_DATA_POLICIES,
  IncompleteProductDataSchema,
  ProductHeldBackSchema,
  heldBackFor,
  incompleteProductDataFields,
  leaveOutInvalidFabricParts,
  leaveOutInvalidParts,
} from './incompleteData';
import { GarmentPayloadDraftSchema } from './garment';
import { mockGarment } from './fixtures';
import { fromShopifyProduct, type ShopifyMetafield, type ShopifyProductNode } from './mappings/shopify';
import { fromWooMeta, type WooProduct } from './mappings/woo';
import type { MappingWarning } from './mappings/common';
import { sizeAdviceGarment } from './sizeAdvice';

const WRAP = mockGarment('aalter-studio-1');
const NAME_ONLY = { primary: 'linen' };
const sink: MappingWarning[] = [];

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

describe('a fabric with a value that is not valid', () => {
  const body = (fabric: unknown) => ({ id: 'p-1', name: 'Linen Wrap Dress', brand: 'Aalter Studio', category: 'dress', sizeChartType: 'body', sizeChart: WRAP.sizeChart, fabric });

  it('the draft schema itself still refuses stretch 150 (a present value is validated)', () => {
    expect(GarmentPayloadDraftSchema.safeParse(body({ primary: 'linen', stretchPct: 150 })).success).toBe(false);
    expect(GarmentPayloadDraftSchema.safeParse(body({ primary: 'linen', drape: 2 })).success).toBe(false);
  });

  it('the upsert body lets it in, and leaveOutInvalidParts drops only that part, with a report', () => {
    const input = body({ primary: 'linen', blend: [['linen', 100]], stretchPct: 150, drape: 0.7, opacity: 'sheer', weightGsm: null });
    const req = MerchantProductUpsertRequestSchema.safeParse(input);
    expect(req.success).toBe(true);
    const { payload, leftOut } = leaveOutInvalidParts(req.data);
    expect(leftOut.map((l) => l.field)).toEqual(['fabric.stretchPct', 'fabric.opacity']);
    expect(leftOut.every((l) => l.reason.length > 0)).toBe(true);
    const draft = GarmentPayloadDraftSchema.parse(payload);
    expect(draft.fabric).toEqual({ primary: 'linen', blend: [['linen', 100]], drape: 0.7 });
    expect(draft.sizeChart).toEqual(WRAP.sizeChart);
  });

  it('every valid value that is present is kept untouched', () => {
    const { payload, leftOut } = leaveOutInvalidParts(WRAP);
    expect(leftOut).toEqual([]);
    expect(payload).toEqual(WRAP);
    expect(leaveOutInvalidFabricParts({ primary: 'linen', stretchPct: 0, drape: 0 })).toEqual({ fabric: { primary: 'linen', stretchPct: 0, drape: 0 }, leftOut: [] });
  });

  it('leaves anything that is not a fabric object alone (the draft schema reports it)', () => {
    expect(leaveOutInvalidParts(null)).toEqual({ payload: null, leftOut: [] });
    expect(leaveOutInvalidParts({ id: 'x' })).toEqual({ payload: { id: 'x' }, leftOut: [] });
    expect(leaveOutInvalidFabricParts('95% cotton')).toEqual({ fabric: '95% cotton', leftOut: [] });
    expect(MerchantProductUpsertRequestSchema.safeParse(body('95% cotton')).success).toBe(false);
  });

  it.each([
    ['Shopify', (fabric: unknown) => fromShopifyProduct(SHOPIFY_PRODUCT, shopifyMetafields(fabric), { warnings: sink })],
    ['WooCommerce', (fabric: unknown) => fromWooMeta(wooProduct(fabric), undefined, { warnings: sink })],
  ])('%s mapping: stretch 150 is left out with a warning, the name and the drape are kept', (_n, map) => {
    sink.length = 0;
    const mapped = map({ primary: 'linen', stretchPct: 150, drape: 0.7 });
    expect(mapped.fabric).toEqual({ primary: 'linen', drape: 0.7 });
    expect(sink.map((w) => w.path)).toEqual(['fabric.stretchPct']);
    expect(GarmentPayloadDraftSchema.safeParse(mapped).success).toBe(true);
  });
});

describe('the shop setting: what counts as incomplete, and when a product is held back', () => {
  const draft = (extra: object) => ({ id: 'p', name: 'n', brand: 'b', category: 'dress', ...extra });

  it('has two values and lets through by default', () => {
    expect([...INCOMPLETE_PRODUCT_DATA_POLICIES]).toEqual(['let-through', 'hold-back']);
    expect(DEFAULT_INCOMPLETE_PRODUCT_DATA).toBe('let-through');
    expect(IncompleteProductDataSchema.safeParse('refuse').success).toBe(false);
  });

  it('a missing stretch is incomplete; a missing drape alone is not', () => {
    expect(incompleteProductDataFields(draft({ fabric: { primary: 'linen' } }))).toEqual(['fabric.stretchPct']);
    expect(incompleteProductDataFields(draft({}))).toEqual(['fabric.stretchPct']);
    expect(incompleteProductDataFields(draft({ fabric: { primary: 'linen', stretchPct: 0 } }))).toEqual([]);
    expect(incompleteProductDataFields(WRAP)).toEqual([]);
  });

  it('a value that was left out is incomplete, whichever it is', () => {
    expect(incompleteProductDataFields(draft({ fabric: { primary: 'linen', stretchPct: 2 } }), [{ field: 'fabric.drape', reason: 'Too big' }])).toEqual(['fabric.drape']);
  });

  it('an accessory does not need a stretch value', () => {
    expect(incompleteProductDataFields(draft({ category: 'accessory' }))).toEqual([]);
  });

  it('heldBackFor: only under hold-back, and only with something incomplete', () => {
    const nameOnly = draft({ fabric: { primary: 'linen' } });
    expect(heldBackFor('let-through', nameOnly)).toBeNull();
    expect(heldBackFor('hold-back', nameOnly)).toEqual({ reason: 'incomplete_product_data', fields: ['fabric.stretchPct'] });
    expect(heldBackFor('hold-back', WRAP)).toBeNull();
    expect(ProductHeldBackSchema.safeParse(heldBackFor('hold-back', nameOnly)).success).toBe(true);
  });

  it('the settings DTOs name their keys: an unknown key is refused', () => {
    expect(MerchantSettingsUpdateRequestSchema.safeParse({ incompleteProductData: 'hold-back' }).success).toBe(true);
    expect(MerchantSettingsUpdateRequestSchema.safeParse({}).success).toBe(true);
    expect(MerchantSettingsUpdateRequestSchema.safeParse({ incompleteProductData: 'hold-back', garment3d: true }).success).toBe(false);
    expect(MerchantSettingsUpdateRequestSchema.safeParse({ incompleteProductData: 'sometimes' }).success).toBe(false);
    expect(MerchantSettingsResponseSchema.safeParse({ incompleteProductData: 'let-through' }).success).toBe(true);
  });

  it('settings: the wordmark switch, colour and logo are named keys; the shop name cannot be written', () => {
    const ok = (v: unknown) => MerchantSettingsUpdateRequestSchema.safeParse(v).success;
    expect(ok({ showFitByCurtain: false, brandColor: '#2F4F3A', logoUrl: 'https://shop.example/logo.png' })).toBe(true);
    expect(ok({ brandColor: null, logoUrl: null })).toBe(true);
    expect(ok({ showFitByCurtain: 'no' })).toBe(false);
    expect(ok({ brandColor: 'green' })).toBe(false);
    expect(ok({ logoUrl: 'http://shop.example/logo.png' })).toBe(false);
    expect(ok({ shopName: 'Other' })).toBe(false);
    expect(MerchantSettingsResponseSchema.safeParse({ incompleteProductData: 'let-through', showFitByCurtain: true, shopName: 'Aalter', platform: 'woocommerce', brandColor: null, logoUrl: null }).success).toBe(true);
  });

  it('the popup flags are literal true or absent, so an older embed and an older api keep working', () => {
    const shop = { id: '00000000-0000-4000-8000-0000000000e1', name: 'Aalter', platform: 'woocommerce' };
    expect(ShopBrandingSchema.parse(shop)).not.toHaveProperty('hideWordmark');
    expect(ShopBrandingSchema.parse({ ...shop, hideWordmark: true }).hideWordmark).toBe(true);
    expect(ShopBrandingSchema.safeParse({ ...shop, hideWordmark: false }).success).toBe(false);
    expect(TryResolveResponseSchema.shape.stretchAssumed.safeParse(undefined).success).toBe(true);
    expect(TryResolveResponseSchema.shape.stretchAssumed.safeParse(true).success).toBe(true);
    expect(TryResolveResponseSchema.shape.stretchAssumed.safeParse(false).success).toBe(false);
  });

  it('the SDK shop status takes a public key prefix only and answers paused or not', () => {
    expect(SdkShopStatusQuerySchema.safeParse({ shop: 'pk_' + 'live_abcdef123456' }).success).toBe(true);
    expect(SdkShopStatusQuerySchema.safeParse({ shop: 'sk_' + 'live_abcdef123456' }).success).toBe(false);
    expect(SdkShopStatusResponseSchema.parse({ paused: true })).toEqual({ paused: true });
  });

  it('a product summary may carry notices', () => {
    expect(MerchantProductSummarySchema.shape.notices.safeParse({ defaulted: ['fabric.stretchPct'], leftOut: [{ field: 'fabric.drape', reason: 'Too big' }] }).success).toBe(true);
    expect(MerchantProductSummarySchema.shape.notices.safeParse(undefined).success).toBe(true);
  });

  it('the upsert response carries notices and the held-back state', () => {
    const res = { externalId: '42', status: 'incomplete', score: 0.3, missingFields: [], contentHash: 'a'.repeat(64), changed: true, updatedAt: '2026-11-20T10:00:00.000Z' };
    expect(MerchantProductUpsertResponseSchema.safeParse({ ...res, notices: { defaulted: ['fabric.stretchPct'], leftOut: [] }, heldBack: { reason: 'incomplete_product_data', fields: ['fabric.stretchPct'] } }).success).toBe(true);
    expect(MerchantProductUpsertResponseSchema.safeParse({ ...res, notices: { defaulted: [], leftOut: [] }, heldBack: null }).success).toBe(true);
    expect(MerchantProductUpsertResponseSchema.safeParse({ ...res, heldBack: { reason: 'other', fields: [] } }).success).toBe(false);
  });
});
