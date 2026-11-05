import { describe, expect, it } from 'vitest';
import { GarmentPayloadSchema } from '../garment';
import { completenessScore } from '../completeness';
import { mockGarment } from '../fixtures';
import {
  SHOPIFY_METAFIELD_DEFINITIONS,
  SHOPIFY_METAFIELD_NAMESPACE,
  fromShopifyProduct,
  indexShopifyMetafields,
  shopifyExternalId,
  toShopifyMetafields,
  type MappingWarning,
  type ShopifyMetafield,
  type ShopifyProductNode,
} from './shopify';

/** A `products/update`-style GraphQL node for the Linen Wrap Dress. */
const PRODUCT: ShopifyProductNode = {
  id: 'gid://shopify/Product/8812345678901',
  handle: 'linen-wrap-dress',
  title: 'Linen Wrap Dress',
  vendor: 'Aalter Studio',
  productType: 'Dresses',
  status: 'ACTIVE',
  onlineStoreUrl: 'https://aalter-studio.myshopify.com/products/linen-wrap-dress',
  featuredImage: { url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg' },
  images: {
    nodes: [{ url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg' }, { url: 'https://cdn.shopify.com/s/files/1/aalter/wrap-2.jpg' }],
  },
  priceRangeV2: { minVariantPrice: { amount: '149.00', currencyCode: 'EUR' } },
  variants: { edges: [{ node: { price: '149.00', selectedOptions: [{ name: 'Size', value: 'S' }] } }] },
};

const WRAP = mockGarment('aalter-studio-1');

const METAFIELDS: ShopifyMetafield[] = [
  { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
  { namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify(WRAP.sizeChart) },
  { namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify(WRAP.fabric) },
  { namespace: '$app:curtain', key: 'flat_lay_photo', type: 'url', value: 'https://cdn.shopify.com/s/files/1/aalter/wrap-flat.png' },
  { namespace: '$app:curtain', key: 'pattern_block', type: 'single_line_text_field', value: 'Wrap' },
  { namespace: '$app:curtain', key: 'ease', type: 'json', value: '{"bust":6,"waist":4,"hip":8}' },
  { namespace: '$app:curtain', key: 'length_cm', type: 'json', value: '{"shoulder_to_hem":118,"shoulder_to_waist":41,"sleeve_length":0}' },
  { namespace: '$app:curtain', key: 'sizing_notes', type: 'multi_line_text_field', value: 'runs small' },
  { namespace: '$app:curtain', key: 'true_to_size_score', type: 'number_decimal', value: '0.92' },
  { namespace: '$app:curtain', key: 'critical_fit_points', type: 'list.single_line_text_field', value: '["bust","shoulder"]' },
  { namespace: '$app:curtain', key: 'stretch_zones', type: 'list.single_line_text_field', value: '["waist-tie"]' },
  { namespace: '$app:curtain', key: 'style_tags', type: 'json', value: '{"bohemian":0.9,"classic":0.3}' },
  { namespace: '$app:curtain', key: 'primary_color_hex', type: 'color', value: '#c97a4f' },
  { namespace: '$app:curtain', key: 'colorways', type: 'json', value: '[{"name":"Terracotta","hex":"#C97A4F","sku":"AS-LWD-TER"},{"name":"Sage","hex":"#8A9A7B"}]' },
  { namespace: '$app:curtain', key: 'subcategory', type: 'single_line_text_field', value: 'wrap-midi' },
  { namespace: 'other_app', key: 'size_chart', type: 'json', value: '[{"size":"IGNORED"}]' },
];

describe('SHOPIFY_METAFIELD_DEFINITIONS', () => {
  it('live in the app-reserved namespace and cover every non-identity payload field', () => {
    expect(SHOPIFY_METAFIELD_NAMESPACE).toBe('$app:curtain');
    const paths = SHOPIFY_METAFIELD_DEFINITIONS.map((d) => d.path);
    for (const p of ['sizeChartType', 'sizeChart', 'fabric', 'flatLayPhoto', 'patternBlock', 'ease', 'lengthCm', 'sizingNotes', 'trueToSizeScore', 'criticalFitPoints', 'stretchZones', 'styleTags', 'colorways', 'primaryColorHex']) {
      expect(paths).toContain(p);
    }
    const keys = SHOPIFY_METAFIELD_DEFINITIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => /^[a-z_]+$/.test(k))).toBe(true);
    expect(SHOPIFY_METAFIELD_DEFINITIONS.filter((d) => d.heavy).map((d) => d.key).sort()).toEqual(['category', 'fabric', 'flat_lay_photo', 'size_chart', 'size_chart_type']);
  });
});

describe('fromShopifyProduct', () => {
  it('normalises a product + metafields into a full, valid GarmentPayload', () => {
    const warnings: MappingWarning[] = [];
    const draft = fromShopifyProduct(PRODUCT, METAFIELDS, { warnings });
    expect(warnings).toEqual([]);
    const parsed = GarmentPayloadSchema.safeParse(draft);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    expect(draft).toMatchObject({
      schemaVersion: 1,
      id: '8812345678901',
      brand: 'Aalter Studio',
      name: 'Linen Wrap Dress',
      category: 'dress',
      subcategory: 'wrap-midi',
      priceEur: 149,
      productUrl: 'https://aalter-studio.myshopify.com/products/linen-wrap-dress',
      primaryColorHex: '#C97A4F',
      flatLayPhoto: 'https://cdn.shopify.com/s/files/1/aalter/wrap-flat.png',
      sizeChartType: 'body',
      patternBlock: 'wrap',
      ease: { bust: 6, waist: 4, hip: 8 },
      lengthCm: { shoulder_to_hem: 118, shoulder_to_waist: 41, sleeve_length: 0 },
      sizingNotes: 'runs small',
      trueToSizeScore: 0.92,
      criticalFitPoints: ['bust', 'shoulder'],
      stretchZones: ['waist-tie'],
      styleTags: { bohemian: 0.9, classic: 0.3 },
    });
    expect(draft.sizeChart).toEqual(WRAP.sizeChart);
    expect(draft.fabric).toEqual(WRAP.fabric);
    expect(draft.productPhotos).toEqual(['https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg', 'https://cdn.shopify.com/s/files/1/aalter/wrap-2.jpg']);
    expect(draft.colorways).toHaveLength(2);
    expect(completenessScore(draft).status).toBe('active');
  });

  it('reads metafields from the product node when none are passed, and accepts a key→value record', () => {
    const withMeta = { ...PRODUCT, metafields: { edges: METAFIELDS.map((node) => ({ node })) } };
    const a = fromShopifyProduct(withMeta);
    expect(a.sizeChartType).toBe('body');
    expect(a.sizeChart).toHaveLength(4);
    const b = fromShopifyProduct(PRODUCT, { size_chart_type: 'garment', 'curtain.ease': { bust: 2 } });
    expect(b.sizeChartType).toBe('garment');
    expect(b.ease).toEqual({ bust: 2 });
  });

  it('infers the category from product type, taxonomy or title and lets the metafield override', () => {
    expect(fromShopifyProduct({ ...PRODUCT, productType: 'Jeans' }).category).toBe('bottom');
    expect(fromShopifyProduct({ ...PRODUCT, productType: '', category: { fullName: 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets' } }).category).toBe('outerwear');
    expect(fromShopifyProduct({ ...PRODUCT, productType: '', title: 'Leather Penny Loafers' }).category).toBe('shoes');
    expect(fromShopifyProduct({ ...PRODUCT, productType: 'Jeans' }, { category: 'top' }).category).toBe('top');
    const warnings: MappingWarning[] = [];
    const none = fromShopifyProduct({ ...PRODUCT, productType: 'Gadget', title: 'Thing' }, { category: 'widget' }, { warnings });
    expect(none.category).toBeUndefined();
    expect(warnings.map((w) => w.path)).toContain('category');
  });

  it('only takes EUR prices and warns on other currencies', () => {
    const warnings: MappingWarning[] = [];
    const usd = fromShopifyProduct({ ...PRODUCT, priceRangeV2: { minVariantPrice: { amount: '160', currencyCode: 'USD' } } }, [], { warnings });
    expect(usd.priceEur).toBeUndefined();
    expect(warnings[0]).toMatchObject({ path: 'priceEur' });
    const legacy = fromShopifyProduct({ ...PRODUCT, priceRangeV2: undefined }, []);
    expect(legacy.priceEur).toBe(149);
  });

  it('reports invalid metafield JSON per field instead of failing the whole product', () => {
    const warnings: MappingWarning[] = [];
    const draft = fromShopifyProduct(
      PRODUCT,
      [
        { key: 'size_chart', type: 'json', value: '{not json' },
        { key: 'fabric', type: 'json', value: '{"primary":"linen","drape":"fluid"}' },
        { key: 'size_chart_type', value: 'flat' },
        { key: 'true_to_size_score', value: '120' },
        { key: 'ease', type: 'json', value: '{"hips":8,"chest":6}' },
      ],
      { warnings },
    );
    expect(draft.sizeChart).toBeUndefined();
    expect(draft.fabric).toEqual({ primary: 'linen' }); // the bad drape is dropped and reported, the rest kept
    expect(draft.sizeChartType).toBeUndefined();
    expect(draft.ease).toEqual({ hip: 8, bust: 6 });
    expect(warnings.map((w) => w.source).sort()).toEqual(['fabric', 'size_chart', 'size_chart_type', 'true_to_size_score']);
    expect(warnings.find((w) => w.source === 'fabric')?.path).toBe('fabric.drape');
    expect(completenessScore(draft).status).toBe('incomplete');
  });

  it('accepts a size chart keyed by size label and merchant aliases (chest/hips/eu)', () => {
    const draft = fromShopifyProduct(PRODUCT, { size_chart: { S: { chest: 88, hips: 96 }, M: { chest: 92, hips: 100 } } });
    expect(draft.sizeChart).toEqual([
      { size: 'S', bust: 88, hip: 96 },
      { size: 'M', bust: 92, hip: 100 },
    ]);
    const shoes = fromShopifyProduct(PRODUCT, { size_chart: '[{"size":"38","eu":38}]' });
    expect(shoes.sizeChart).toEqual([{ size: '38', footEu: 38 }]);
  });

  it('falls back to the first colorway for primaryColorHex and the brand metafield over vendor', () => {
    const draft = fromShopifyProduct({ ...PRODUCT, vendor: null }, { colorways: [{ name: 'Sage', hex: '#8a9a7b' }], brand: 'Aalter' });
    expect(draft.primaryColorHex).toBe('#8A9A7B');
    expect(draft.brand).toBe('Aalter');
    expect(fromShopifyProduct({ ...PRODUCT, vendor: null }, {}, { defaultBrand: 'Shop' }).brand).toBe('Shop');
  });

  it('returns {} with a warning for a node that is not a product', () => {
    const warnings: MappingWarning[] = [];
    expect(fromShopifyProduct({ id: 1 } as unknown as ShopifyProductNode, [], { warnings })).toEqual({});
    expect(warnings).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('shopifyExternalId extracts the numeric id', () => {
    expect(shopifyExternalId('gid://shopify/Product/8812345678901')).toBe('8812345678901');
    expect(shopifyExternalId('gid://shopify/Product/42?foo=bar')).toBe('42');
    expect(shopifyExternalId('already-plain')).toBe('already-plain');
  });

  it('indexShopifyMetafields prefers jsonValue and strips namespaced keys', () => {
    const m = indexShopifyMetafields([
      { key: 'ease', value: '{"bust":1}', jsonValue: { bust: 2 } },
      { key: 'other', value: 'x' },
    ]);
    expect(m.get('ease')).toEqual({ bust: 2 });
    expect(m.get('other')).toBe('x');
  });

  it('toShopifyMetafields serialises every mapped field and round-trips through fromShopifyProduct', () => {
    const inputs = toShopifyMetafields(WRAP, PRODUCT.id);
    expect(inputs.every((i) => i.namespace === '$app:curtain' && i.ownerId === PRODUCT.id)).toBe(true);
    expect(inputs.find((i) => i.key === 'size_chart')?.type).toBe('json');
    expect(inputs.find((i) => i.key === 'critical_fit_points')?.value).toBe('["bust","shoulder"]');
    const back = fromShopifyProduct(PRODUCT, inputs.map(({ key, type, value }) => ({ namespace: '$app:curtain', key, type, value })));
    expect(back.sizeChart).toEqual(WRAP.sizeChart);
    expect(back.fabric).toEqual(WRAP.fabric);
    expect(back.ease).toEqual(WRAP.ease);
    expect(back.lengthCm).toEqual(WRAP.lengthCm);
    expect(back.criticalFitPoints).toEqual(WRAP.criticalFitPoints);
    expect(back.styleTags).toEqual(WRAP.styleTags);
    expect(back.colorways).toEqual(WRAP.colorways);
    expect(back.flatLayPhoto).toBe(WRAP.flatLayPhoto);
    expect(GarmentPayloadSchema.safeParse(back).success).toBe(true);
  });
});
