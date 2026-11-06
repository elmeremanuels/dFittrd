/**
 * Release v1 pilot (bohohippychic.com.au, AUD, AU 8–16): a product that only has the AU template
 * chart assigned by the builder must get a size in the standalone embed (review findings R1, R2).
 * Path under test: fromShopifyProduct (AUD price) → upsertProduct (stored status) → POST
 * /v1/sdk/sessions → GET /v1/try/:token.
 */
import { AU_WOMENS_BODY_TEMPLATE, chartFromBodyTemplate, fromShopifyProduct, type ShopifyMetafield, type ShopifyProductNode } from '@curtain/schema';
import { DEFAULT_EUR_RATES } from '@curtain/shopify-app';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upsertProduct } from './services/products.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const AU = chartFromBodyTemplate(AU_WOMENS_BODY_TEMPLATE, ['8', '10', '12', '14', '16']);

const node = (id: string, title: string): ShopifyProductNode => ({
  id: `gid://shopify/Product/${id}`,
  handle: title.toLowerCase().replace(/\s+/g, '-'),
  title,
  vendor: 'Boho Hippy Chic',
  productType: 'Dresses',
  status: 'ACTIVE',
  priceRangeV2: { minVariantPrice: { amount: '89.95', currencyCode: 'AUD' } },
});

/** Exactly what POST /shopify/charts/assign writes for the AU template. */
const TEMPLATE_ONLY: ShopifyMetafield[] = [
  { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
  { namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify(AU.sizeChart) },
];

describe('pilot: AUD product with only a template chart resolves in /v1/try', () => {
  let t: TestApp;
  let seeded: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    seeded = await seedShop(t, { products: [] });
    for (const [id, title, meta] of [
      ['7001', 'Gypsy Maxi Dress', TEMPLATE_ONLY],
      ['7002', 'Unsized Kaftan', []],
    ] as const) {
      const draft = fromShopifyProduct(node(id, title), [...meta], { defaultBrand: 'Boho Hippy Chic', eurRates: DEFAULT_EUR_RATES });
      await upsertProduct(t.handle.db, seeded.shop.id, draft.id!, draft);
    }
  });
  afterAll(async () => {
    await t.close();
  });

  async function tryProduct(productExternalId: string) {
    const d = await createDevice(t);
    const s = await t.app.inject({
      method: 'POST',
      url: '/v1/sdk/sessions',
      headers: { origin: 'https://bohohippychic.com.au' },
      payload: { shopKeyPrefix: seeded.publicKeyPrefix, productExternalId, pageUrl: 'https://bohohippychic.com.au/products/x', surface: 'embed' },
    });
    expect(s.statusCode).toBe(200);
    const token = s.json<{ embedUrl: string }>().embedUrl.split('/embed/')[1]!;
    return t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
  }

  it('stores the template-only product as try-able (active) with a converted EUR price', async () => {
    const list = await t.app.inject({ method: 'GET', url: '/v1/merchant/products?limit=10', headers: { authorization: `Bearer ${seeded.apiKey}` } });
    expect(list.statusCode).toBe(200);
    const items = list.json<{ items: Array<{ externalId: string; status: string; missingFields: string[] }> }>().items;
    expect(items.find((p) => p.externalId === '7001')).toMatchObject({ status: 'active' });
    expect(items.find((p) => p.externalId === '7002')).toMatchObject({ status: 'incomplete' });
  });

  it('GET /v1/try returns a sizeable garment with defaults for fabric, block and colour', async () => {
    const r = await tryProduct('7001');
    expect(r.statusCode).toBe(200);
    const g = r.json<{ garment: { category: string; sizeChartType: string; sizeChart: Array<{ size: string }>; fabric: { primary: string; stretchPct: number }; patternBlock: string; primaryColorHex: string; priceEur: number } }>().garment;
    expect(g.category).toBe('dress');
    expect(g.sizeChartType).toBe('body');
    expect(g.sizeChart.map((row) => row.size)).toEqual(['8', '10', '12', '14', '16']);
    expect(g.fabric).toMatchObject({ primary: 'woven', stretchPct: 0 });
    expect(g.patternBlock).toBe('unspecified');
    expect(g.primaryColorHex).toBe('#FF5A3C'); // the shop's brand colour
    expect(g.priceEur).toBeCloseTo(89.95 / DEFAULT_EUR_RATES.AUD!, 2);
  });

  it('a product without a chart still answers 422 product_incomplete', async () => {
    const r = await tryProduct('7002');
    expect(r.statusCode).toBe(422);
    expect(r.json<{ error: { code: string } }>().error.code).toBe('product_incomplete');
  });
});
