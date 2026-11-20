/**
 * Size chart builder routes against a mocked Shopify Admin API: every write path (bulk assign,
 * single-product chart, onboarding state) is checked for the exact metafieldsSet input and the
 * product sync job it queues.
 */
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AU_WOMENS_BODY_TEMPLATE, MERCHANT_SETUP_TEXT } from '@curtain/schema';
import { json, makeApp, seedShop, type TestApp } from '../test/helpers.js';

const API_KEY = 'shpa_testkey';
const API_SECRET = 'shpss' + '_test_secret_0123456789';
const SHOP = 'bohohippychic.myshopify.com';
const TOKEN = 'shpat' + '_offline_charts';

async function sessionToken(shop = SHOP) {
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, sub: '42', sid: 'sid-1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(API_KEY)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('1m')
    .setJti(`jti-${Math.random()}`)
    .sign(new TextEncoder().encode(API_SECRET));
}

interface GqlCall {
  query: string;
  variables: Record<string, unknown>;
}
type SetInput = { ownerId: string; namespace: string; key: string; type: string; value: string };

describe('Shopify size chart builder routes', () => {
  let t: TestApp;
  let shopId: string;
  let calls: GqlCall[];
  let handler: (q: GqlCall) => unknown;
  let metafieldsSetError: string | null;

  const auth = async () => ({ authorization: `Bearer ${await sessionToken()}` });
  const sets = () => calls.filter((c) => c.query.includes('metafieldsSet')).flatMap((c) => c.variables.metafields as SetInput[]);

  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
    const { shop } = await seedShop(t, { platform: 'shopify', domain: SHOP, name: 'Boho Hippy Chic', products: ['aalter-studio-1', 'monochrome-02'] });
    shopId = shop.id;
    await t.app.ctx.shopify.saveOfflineSession(shop.id, SHOP, TOKEN, 'read_products,write_products');
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    calls = [];
    metafieldsSetError = null;
    handler = () => ({ errors: [{ message: 'unexpected query' }] });
    t.fetchMock.reset();
    t.fetchMock.on(`https://${SHOP}/admin/api/`, async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-shopify-access-token')).toBe(TOKEN);
      const q = JSON.parse(String(init?.body)) as GqlCall;
      calls.push(q);
      if (q.query.includes('metafieldsSet')) {
        const mf = q.variables.metafields as SetInput[];
        if (metafieldsSetError) return json({ data: { metafieldsSet: { metafields: null, userErrors: [{ field: ['metafields'], message: metafieldsSetError, code: 'INVALID' }] } } });
        return json({ data: { metafieldsSet: { metafields: mf.map((m, i) => ({ id: `gid://shopify/Metafield/${i}`, key: m.key, namespace: m.namespace, ownerType: 'PRODUCT' })), userErrors: [] } } });
      }
      const r = handler(q);
      return json(r && typeof r === 'object' && 'errors' in r ? r : { data: r }, r && typeof r === 'object' && 'errors' in r ? 400 : 200);
    });
  });

  it('serves the chart templates to merchants', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/merchant/charts/templates', headers: await auth() });
    expect(res.statusCode).toBe(200);
    const ids = res.json().templates.map((x: { id: string }) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['au-womens-body', 'uk-womens-body', 'eu-womens-body', 'us-womens-body', 'garment-one-size']));
    const au = res.json().templates.find((x: { id: string }) => x.id === 'au-womens-body');
    expect(au.rows).toEqual(AU_WOMENS_BODY_TEMPLATE.rows);
    expect(au.sources[0].url).toMatch(/^https:/);
    const anon = await t.app.inject({ method: 'GET', url: '/v1/merchant/charts/templates' });
    expect(anon.statusCode).toBe(401);
  });

  it('previews a selection: count + sample', async () => {
    handler = (q) =>
      q.query.includes('productsCount')
        ? { productsCount: { count: 23, precision: 'EXACT' } }
        : { products: { pageInfo: { hasNextPage: true, endCursor: 'c' }, nodes: [{ id: 'gid://shopify/Product/11', title: 'Maxi', status: 'ACTIVE', sizeChart: { id: 'gid://shopify/Metafield/1' } }] } };
    const res = await t.app.inject({ method: 'POST', url: '/shopify/charts/preview', headers: await auth(), payload: { selector: { kind: 'productType', productType: 'Dresses' } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ count: 23, precision: 'EXACT', sample: [{ id: '11', title: 'Maxi', hasChart: true }] });
    expect(calls.find((c) => c.query.includes('productsCount'))!.variables).toEqual({ query: 'product_type:"Dresses" -status:archived' });
  });

  it('assigns a template to a collection: writes metafields, skips charted products, queues the sync, pages on', async () => {
    handler = () => ({
      products: {
        pageInfo: { hasNextPage: true, endCursor: 'next-1' },
        nodes: [
          { id: 'gid://shopify/Product/101', title: 'Black Haven Midi', status: 'ACTIVE', sizeChart: null },
          { id: 'gid://shopify/Product/102', title: 'Gypsy Maxi', status: 'DRAFT', sizeChart: null },
          { id: 'gid://shopify/Product/103', title: 'Has one', status: 'ACTIVE', sizeChart: { id: 'gid://shopify/Metafield/5' } },
        ],
      },
    });
    const res = await t.app.inject({
      method: 'POST',
      url: '/shopify/charts/assign',
      headers: await auth(),
      payload: { selector: { kind: 'collection', collectionId: '555' }, chart: { templateId: 'au-womens-body', sizes: ['8', '10', '12', '14', '16'] } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.written).toEqual(['101', '102']);
    expect(body.skipped).toEqual([{ id: '103', title: 'Has one', reason: 'already has a size chart' }]);
    expect(body.nextCursor).toBe('next-1');
    expect(body.syncQueued).toBe(2);
    expect(body.chart.sizeChartType).toBe('body');
    expect(body.chart.sizeChart.map((r: { size: string }) => r.size)).toEqual(['8', '10', '12', '14', '16']);
    const written = sets();
    expect(written).toHaveLength(4);
    expect(written[0]).toEqual({ ownerId: 'gid://shopify/Product/101', namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' });
    expect(JSON.parse(written[1]!.value)[0]).toEqual({ size: '8', bust: 85, waist: 67.5, hip: 94 });
    const targets = calls.find((c) => c.query.includes('CurtainChartTargets'))!;
    expect(targets.variables).toMatchObject({ query: 'collection_id:555 -status:archived', cursor: null });
    const jobs = t.queue.pending('sync-shopify-product').map((j) => j.data);
    expect(jobs).toEqual(expect.arrayContaining([{ shopId, productGid: 'gid://shopify/Product/101' }, { shopId, productGid: 'gid://shopify/Product/102' }]));
  });

  it('assigns a typed garment chart in inches to picked products, overwriting, and reports a failed batch', async () => {
    handler = () => ({ nodes: [{ id: 'gid://shopify/Product/201', title: 'Kaftan', status: 'ACTIVE', sizeChart: { id: 'x' } }] });
    const payload = { selector: { kind: 'products', productIds: ['gid://shopify/Product/201'] }, chart: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 55 }], unit: 'in' }, overwrite: true };
    const ok = await t.app.inject({ method: 'POST', url: '/shopify/charts/assign', headers: await auth(), payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().written).toEqual(['201']);
    expect(JSON.parse(sets()[1]!.value)).toEqual([{ size: 'ONE', bust: 139.5 }]);

    calls = [];
    metafieldsSetError = 'Owner does not exist';
    const bad = await t.app.inject({ method: 'POST', url: '/shopify/charts/assign', headers: await auth(), payload });
    expect(bad.statusCode).toBe(200);
    expect(bad.json()).toMatchObject({ written: [], syncQueued: 0, failed: [{ id: '201' }] });
    expect(bad.json().failed[0].message).toMatch(/Owner does not exist/);
  });

  it('refuses invalid charts and unknown templates before touching Shopify', async () => {
    const empty = await t.app.inject({
      method: 'POST',
      url: '/shopify/charts/assign',
      headers: await auth(),
      payload: { selector: { kind: 'tag', tag: 'x' }, chart: { sizeChartType: 'garment', sizeChart: [{ size: 'S' }] } },
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json().error.message).toMatch(/no measurements/);
    const garmentTpl = await t.app.inject({ method: 'POST', url: '/shopify/charts/assign', headers: await auth(), payload: { selector: { kind: 'tag', tag: 'x' }, chart: { templateId: 'garment-one-size' } } });
    expect(garmentTpl.statusCode).toBe(400);
    const unknown = await t.app.inject({ method: 'POST', url: '/shopify/charts/assign', headers: await auth(), payload: { selector: { kind: 'tag', tag: 'x' }, chart: { templateId: 'nope' } } });
    expect(unknown.statusCode).toBe(400);
    expect(calls).toHaveLength(0);
  });

  const kaftan = {
    id: 'gid://shopify/Product/301',
    handle: 'boho-kaftan',
    title: 'Boho Kaftan',
    vendor: 'Boho Hippy Chic',
    productType: 'Dresses',
    status: 'ACTIVE',
    onlineStoreUrl: 'https://bohohippychic.com.au/products/boho-kaftan',
    onlineStorePreviewUrl: null,
    descriptionHtml: '<p>Made from 100% rayon.</p><p>Bust 140cm circumference. Length 110cm.</p>',
    options: [{ name: 'Size', optionValues: [{ name: 'One Size' }] }],
    variants: { nodes: [{ price: '89.95', selectedOptions: [{ name: 'Size', value: 'One Size' }] }] },
    metafields: { nodes: [] },
  };

  it('proposes a one-size garment chart from the description without writing anything', async () => {
    handler = () => ({ product: kaftan });
    const res = await t.app.inject({ method: 'GET', url: '/shopify/products/301/chart-import', headers: await auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      productId: '301',
      oneSize: true,
      hasChart: false,
      proposal: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }] },
      lengthCm: { shoulder_to_hem: 110 },
    });
    // The fabric is what the description states; the stretch is our estimate and travels apart from it (D18, F20).
    expect(res.json().fabric).toEqual({ primary: 'viscose', blend: [['viscose', 100]] });
    expect(res.json().fabricEstimate).toEqual({ stretchPct: expect.any(Number) });
    expect(sets()).toHaveLength(0);
    handler = () => ({ product: null });
    expect((await t.app.inject({ method: 'GET', url: '/shopify/products/999/chart-import', headers: await auth() })).statusCode).toBe(404);
  });

  it('writes a confirmed product chart with fabric and lengths and queues its sync', async () => {
    handler = () => ({ product: kaftan });
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/301/chart',
      headers: await auth(),
      payload: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }], fabric: { primary: 'viscose', stretchPct: 0, drape: 0.85 }, lengthCm: { shoulder_to_hem: 110 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().written.sort()).toEqual(['fabric', 'length_cm', 'size_chart', 'size_chart_type']);
    expect(sets().every((m) => m.ownerId === 'gid://shopify/Product/301' && m.namespace === '$app:curtain')).toBe(true);
    expect(t.queue.pending('sync-shopify-product').some((j) => (j.data as { productGid: string }).productGid === 'gid://shopify/Product/301')).toBe(true);
    // Fibre names without a stretch (the import form's default) are a valid write: only the names are stored.
    const before = sets().length;
    const names = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/301/chart',
      headers: await auth(),
      payload: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }], fabric: { primary: 'viscose', blend: [['viscose', 100]] } },
    });
    expect(names.statusCode).toBe(200);
    const fabricSet = sets().slice(before).find((m) => m.key === 'fabric')!;
    expect(JSON.parse(fabricSet.value)).toEqual({ primary: 'viscose', blend: [['viscose', 100]] });
    // A product that is not there: nothing is written.
    handler = () => ({ product: null });
    const gone = await t.app.inject({ method: 'PUT', url: '/shopify/products/999/chart', headers: await auth(), payload: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }], fabric: { primary: 'viscose' } } });
    expect(gone.statusCode).toBe(404);
    const bad = await t.app.inject({ method: 'PUT', url: '/shopify/products/abc/chart', headers: await auth(), payload: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }] } });
    expect(bad.statusCode).toBe(400);
  });

  it('a fabric write keeps the stretch, drape and weight the product already has', async () => {
    // The merchant entered these before; the description import sends fibre names only.
    const stored = { primary: 'cotton', stretchPct: 12, drape: 0.6, weightGsm: 180 };
    handler = () => ({ product: { ...kaftan, metafields: { nodes: [{ namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify(stored) }] } } });
    const write = async (fabric: object) => {
      const before = sets().length;
      const res = await t.app.inject({ method: 'PUT', url: '/shopify/products/301/chart', headers: await auth(), payload: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }], fabric } });
      expect(res.statusCode, res.body).toBe(200);
      return JSON.parse(sets().slice(before).find((m) => m.key === 'fabric')!.value) as Record<string, unknown>;
    };
    expect(await write({ primary: 'viscose', blend: [['viscose', 100]] })).toEqual({ primary: 'viscose', blend: [['viscose', 100]], stretchPct: 12, drape: 0.6, weightGsm: 180 });
    // A stretch the merchant ticks in the form replaces the stored one.
    expect(await write({ primary: 'viscose', stretchPct: 3 })).toMatchObject({ primary: 'viscose', stretchPct: 3, drape: 0.6 });
    // No fabric in the request: the fabric metafield is not written at all.
    const before = sets().length;
    await t.app.inject({ method: 'PUT', url: '/shopify/products/301/chart', headers: await auth(), payload: { sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 140 }] } });
    expect(sets().slice(before).some((m) => m.key === 'fabric')).toBe(false);
  });

  it('returns the product checklist with the Try it on preview link', async () => {
    handler = () => ({ product: kaftan });
    const res = await t.app.inject({ method: 'GET', url: '/shopify/products/301/checklist', headers: await auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.previewUrl).toBe('https://bohohippychic.com.au/products/boho-kaftan');
    expect(body.adminUrl).toBe(`https://${SHOP}/admin/products/301`);
    expect(body.status).toBe('incomplete');
    expect(body.items.find((i: { key: string }) => i.key === 'sizeChart')).toMatchObject({ done: false, required: true });
  });

  it('onboarding: reads the steps and stores the picked template on the AppInstallation', async () => {
    let stored: string | null = null;
    handler = (q) => (q.query.includes('CurtainOnboarding') ? { currentAppInstallation: { id: 'gid://shopify/AppInstallation/9', metafield: stored ? { value: stored } : null } } : {});
    const first = await t.app.inject({ method: 'GET', url: '/shopify/charts/onboarding', headers: await auth() });
    expect(first.statusCode).toBe(200);
    // The seeded fixtures already have charts, so "Add a size chart" is done without a saved pick;
    // none has the shop's own garment measurements yet, so "Measure one skirt" is next.
    expect(first.json().next).toBe('measure');
    expect(first.json().steps.find((s: { key: string }) => s.key === 'chart').done).toBe(true);
    expect(first.json().steps.map((s: { key: string }) => s.key)).toEqual(['connect', 'chart', 'measure', 'button', 'phone']);
    expect(first.json().measureProduct).not.toBeNull();
    // OI-99: while the phone check is open, the Shopify admin is told about the store password page.
    expect(first.json().steps.find((s: { key: string }) => s.key === 'phone').detail).toContain(MERCHANT_SETUP_TEXT.steps.phone.passwordNote);

    const put = await t.app.inject({ method: 'PUT', url: '/shopify/charts/onboarding', headers: await auth(), payload: { templateId: 'au-womens-body' } });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ templateId: 'au-womens-body', themeBlockConfirmed: false, tested: false });
    const w = sets();
    expect(w).toEqual([{ ownerId: 'gid://shopify/AppInstallation/9', namespace: 'curtain', key: 'onboarding', type: 'json', value: JSON.stringify({ templateId: 'au-womens-body', themeBlockConfirmed: false, tested: false }) }]);
    stored = w[0]!.value;
    const after = await t.app.inject({ method: 'GET', url: '/shopify/charts/onboarding', headers: await auth() });
    expect(after.json().next).toBe('measure');
    expect(after.json().state.templateId).toBe('au-womens-body');

    // "I have saved it" on the theme block ticks step 4 (the api cannot look inside the theme).
    stored = JSON.stringify({ templateId: 'au-womens-body', themeBlockConfirmed: true, tested: false });
    const ticked = await t.app.inject({ method: 'GET', url: '/shopify/charts/onboarding', headers: await auth() });
    expect(ticked.json().steps.find((s: { key: string }) => s.key === 'button').done).toBe(true);
    expect(ticked.json().doneCount).toBe(3);

    const bad = await t.app.inject({ method: 'PUT', url: '/shopify/charts/onboarding', headers: await auth(), payload: { templateId: 'nope' } });
    expect(bad.statusCode).toBe(400);
  });

  it('maps a Shopify outage to 502 and a WooCommerce shop to 400', async () => {
    handler = () => ({ errors: [{ message: 'Internal error' }] });
    const res = await t.app.inject({ method: 'GET', url: '/shopify/products/301/checklist', headers: await auth() });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('shopify_error');

    const { apiKey } = await seedShop(t, { platform: 'woocommerce', products: [] });
    const woo = await t.app.inject({ method: 'POST', url: '/shopify/charts/preview', headers: { authorization: `Bearer ${apiKey}` }, payload: { selector: { kind: 'tag', tag: 'x' } } });
    expect(woo.statusCode).toBe(400);
    expect(woo.json().error.code).toBe('not_shopify');
  });
});
