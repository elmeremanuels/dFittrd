/**
 * Point 10 (D24 point 4, D25 point 1) on the api: a product whose fabric has only a name is stored
 * and can be sized, whichever way it comes in (the plain merchant PUT, the Shopify sync's mapped
 * product, the WooCommerce plugin's payload).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID, fromShopifyProduct, fromWooMeta } from '@curtain/schema';
import { findProduct, upsertProduct } from './services/products.js';
import { makeApp, seedShop, type TestApp } from './test/helpers.js';

const WRAP = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
const NAME_ONLY = { primary: 'linen' };
const base = (id: string) => ({ id, name: 'Linen Wrap Dress', brand: 'Aalter Studio', category: 'dress', sizeChartType: 'body', sizeChart: WRAP.sizeChart });

describe('a fabric with only a name', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t, { products: [] });
  });
  afterAll(async () => {
    await t.close();
  });
  const put = (id: string, payload: unknown) => t.app.inject({ method: 'PUT', url: `/v1/merchant/products/${id}`, headers: { authorization: `Bearer ${s.apiKey}` }, payload: payload as object });

  it('plain api: PUT stores it as active and keeps the name', async () => {
    const res = await put('plain-1', { ...base('plain-1'), fabric: NAME_ONLY });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ externalId: 'plain-1', status: 'active', changed: true });
    expect((await findProduct(t.handle.db, s.shop.id, 'plain-1'))?.payload.fabric).toEqual(NAME_ONLY);
  });

  it('Shopify: the product the sync job maps from metafields is stored', async () => {
    const mapped = fromShopifyProduct(
      { id: 'gid://shopify/Product/8812345678901', handle: 'linen-wrap-dress', title: 'Linen Wrap Dress', vendor: 'Aalter Studio', productType: 'Dresses', status: 'ACTIVE' },
      [
        { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
        { namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify(WRAP.sizeChart) },
        { namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify(NAME_ONLY) },
      ],
      { defaultBrand: 'Aalter Studio' },
    );
    expect(mapped.fabric).toEqual(NAME_ONLY);
    // As jobs/syncShopifyProduct.ts calls it.
    const r = await upsertProduct(t.handle.db, s.shop.id, mapped.id!, { ...mapped, brand: mapped.brand ?? 'Aalter Studio' }, { handle: 'linen-wrap-dress', audienceSource: null });
    expect(r.status).toBe('active');
    expect(r.product.payload.fabric).toEqual(NAME_ONLY);
  });

  it('WooCommerce: the payload the plugin builds from product meta is stored', async () => {
    const mapped = fromWooMeta({
      id: 42,
      name: 'Linen Wrap Dress',
      slug: 'linen-wrap-dress',
      type: 'variable',
      status: 'publish',
      price: '149',
      categories: [{ id: 7, name: 'Dresses', slug: 'dresses' }],
      attributes: [{ name: 'Brand', slug: 'pa_brand', options: ['Aalter Studio'] }],
      meta_data: [
        { key: '_curtain_size_chart_type', value: 'body' },
        { key: '_curtain_size_chart', value: JSON.stringify(WRAP.sizeChart) },
        { key: '_curtain_fabric', value: JSON.stringify(NAME_ONLY) },
      ],
    });
    expect(mapped.fabric).toEqual(NAME_ONLY);
    const res = await put(mapped.id!, mapped);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ status: 'active' });
  });
});
