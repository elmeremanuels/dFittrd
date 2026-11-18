/**
 * The "Garment measurements" form routes (GET / PUT /shopify/products/:id/garment-tape) against a
 * mocked Shopify Admin API, and the chart cross-check on the merchant PUT. Garment data only: no
 * route here computes a fit or accepts a body measurement (AGENTS.md rule 4).
 */
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PILOT_PULL_ON_SKIRT, PILOT_SKIRT_CHART_ONLY, PILOT_SKIRT_TAPE_MEASURED } from '@curtain/schema';
import { json, makeApp, seedShop, type TestApp } from '../test/helpers.js';

const API_KEY = 'shpa_testkey';
const API_SECRET = 'shpss' + '_test_secret_0123456789';
const SHOP = 'bohohippychic.myshopify.com';
const TOKEN = 'shpat' + '_offline_tape';
const GID = 'gid://shopify/Product/10894387020081';

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

const mf = (key: string, value: string, type = 'json') => ({ namespace: 'app--1--curtain', key, type, value });

describe('Shopify garment measurements form', () => {
  let t: TestApp;
  let calls: GqlCall[];
  let metafields: ReturnType<typeof mf>[];
  let apiKey: string;

  const auth = async () => ({ authorization: `Bearer ${await sessionToken()}` });
  const sets = () => calls.filter((c) => c.query.includes('metafieldsSet')).flatMap((c) => c.variables.metafields as SetInput[]);
  const deletes = () => calls.filter((c) => c.query.includes('metafieldsDelete')).flatMap((c) => c.variables.metafields as { key: string }[]);
  const skirtNode = () => ({
    id: GID,
    handle: 'crimson-wildflower-maxi-skirt',
    title: 'Crimson Wildflower Maxi Skirt',
    vendor: 'Boho Hippy Chic',
    productType: 'Skirts',
    status: 'ACTIVE',
    descriptionHtml: '',
    options: [{ name: 'Size', optionValues: ['8', '10', '12', '14', '16'].map((name) => ({ name })) }],
    variants: { nodes: [{ price: '89.95', selectedOptions: [{ name: 'Size', value: '8' }] }] },
    metafields: { nodes: metafields },
  });

  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
    const { shop, apiKey: key } = await seedShop(t, { platform: 'shopify', domain: SHOP, name: 'Boho Hippy Chic', products: [] });
    apiKey = key;
    await t.app.ctx.shopify.saveOfflineSession(shop.id, SHOP, TOKEN, 'read_products,write_products');
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    calls = [];
    metafields = [
      mf('category', 'bottom', 'single_line_text_field'),
      mf('size_chart_type', 'body', 'single_line_text_field'),
      mf('size_chart', JSON.stringify(PILOT_SKIRT_CHART_ONLY.sizeChart)),
    ];
    t.fetchMock.reset();
    t.fetchMock.on(`https://${SHOP}/admin/api/`, async (_url, init) => {
      const q = JSON.parse(String(init?.body)) as GqlCall;
      calls.push(q);
      if (q.query.includes('metafieldsSet')) {
        const list = q.variables.metafields as SetInput[];
        return json({ data: { metafieldsSet: { metafields: list.map((m, i) => ({ id: `gid://shopify/Metafield/${i}`, key: m.key, namespace: m.namespace, ownerType: 'PRODUCT' })), userErrors: [] } } });
      }
      if (q.query.includes('metafieldsDelete')) {
        const list = q.variables.metafields as { key: string; ownerId: string; namespace: string }[];
        const present = new Set(metafields.map((m) => m.key));
        return json({ data: { metafieldsDelete: { deletedMetafields: list.map((m) => (present.has(m.key) ? m : null)), userErrors: [] } } });
      }
      if (q.query.includes('product(')) return json({ data: { product: skirtNode() } });
      return json({ errors: [{ message: 'unexpected query' }] }, 400);
    });
  });

  it('GET shows the chart sizes and nothing measured yet', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/shopify/products/10894387020081/garment-tape', headers: await auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ productId: '10894387020081', category: 'bottom', sizes: ['8', '10', '12', '14', '16'], closure: null, measured: [], garmentTape: null, errors: [], written: [] });
    expect(sets()).toHaveLength(0);
  });

  it('a dry run checks and fills without writing; the estimates are labelled', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/garment-tape',
      headers: await auth(),
      payload: { closure: 'pull-on', measured: PILOT_SKIRT_TAPE_MEASURED, dryRun: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.garmentTape).toEqual(PILOT_PULL_ON_SKIRT.garmentTape);
    expect(body.warnings.map((w: { code: string }) => w.code)).toEqual(['hip_no_depth', 'edge_unmeasured']);
    expect(body.written).toEqual([]);
    expect(calls.some((c) => c.query.includes('metafieldsSet') || c.query.includes('metafieldsDelete'))).toBe(false);
  });

  it('saving writes closure and garment_tape, and queues the product sync', async () => {
    const res = await t.app.inject({ method: 'PUT', url: '/shopify/products/10894387020081/garment-tape', headers: await auth(), payload: { closure: 'pull-on', measured: PILOT_SKIRT_TAPE_MEASURED } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ written: ['closure', 'garment_tape'], syncQueued: true, closure: 'pull-on' });
    const written = sets();
    expect(written.find((m) => m.key === 'closure')).toMatchObject({ ownerId: GID, namespace: '$app:curtain', type: 'single_line_text_field', value: 'pull-on' });
    expect(JSON.parse(written.find((m) => m.key === 'garment_tape')!.value)).toEqual(PILOT_PULL_ON_SKIRT.garmentTape);
    expect(deletes()).toEqual([]);
    expect(t.queue.pending('sync-shopify-product').some((j) => (j.data as { productGid: string }).productGid === GID)).toBe(true);
  });

  it('GET reads the stored tape back: the measured sizes as typed, the rest estimated', async () => {
    metafields.push(mf('closure', 'pull-on', 'single_line_text_field'), mf('garment_tape', JSON.stringify(PILOT_PULL_ON_SKIRT.garmentTape)));
    const res = await t.app.inject({ method: 'GET', url: '/shopify/products/10894387020081/garment-tape', headers: await auth() });
    expect(res.json()).toMatchObject({ closure: 'pull-on', measured: PILOT_SKIRT_TAPE_MEASURED, garmentTape: PILOT_PULL_ON_SKIRT.garmentTape });
  });

  it('errors stop the save with a 422 and plain English messages', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/garment-tape',
      headers: await auth(),
      payload: { closure: 'pull-on', measured: [{ size: '14', waistRelaxedCm: 80, waistStretchedCm: 78 }, { size: '18', waistRelaxedCm: 90 }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('invalid_garment_tape');
    expect(res.json().error.message).toContain('Size 14: the stretched waistband (78 cm) is smaller than the relaxed waistband (80 cm).');
    expect(res.json().error.message).toContain("Size 18 is not in this product's size chart.");
    expect(sets()).toHaveLength(0);
  });

  it('a bad hip depth (one input in the form) is one error without a size', async () => {
    const measured = PILOT_SKIRT_TAPE_MEASURED.map((m) => ({ ...m, hipDepthBelowBandCm: 90 }));
    const res = await t.app.inject({ method: 'PUT', url: '/shopify/products/10894387020081/garment-tape', headers: await auth(), payload: { closure: 'pull-on', measured, dryRun: true } });
    expect(res.json().errors).toEqual([{ code: 'depth_out_of_range', field: 'hipDepth', message: 'The hip depth below the band (90 cm) must be between 0 and 80 cm. We ask for 20 cm.' }]);
  });

  it('clearing every measured size and the closure deletes the two metafields', async () => {
    metafields.push(mf('closure', 'zip', 'single_line_text_field'), mf('garment_tape', JSON.stringify(PILOT_PULL_ON_SKIRT.garmentTape)));
    const res = await t.app.inject({ method: 'PUT', url: '/shopify/products/10894387020081/garment-tape', headers: await auth(), payload: { closure: null, measured: [] } });
    expect(res.statusCode).toBe(200);
    expect(deletes().map((d) => d.key)).toEqual(['closure', 'garment_tape']);
    expect(res.json().written).toEqual(['closure', 'garment_tape']);
  });

  it('the body has no place for a shopper measurement', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/shopify/products/10894387020081/garment-tape',
      headers: await auth(),
      payload: { closure: 'pull-on', measured: [], dryRun: true, user: { measurements: { hip: 100 } } },
    });
    // Unknown keys are stripped by the schema; the answer is garment data only.
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toMatch(/measurements|bodyHip|"user"/);
  });

  it('needs a merchant session', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/shopify/products/10894387020081/garment-tape' })).statusCode).toBe(401);
  });

  it('merchant PUT stores tape and closure, and refuses a tape row for a size the chart does not have', async () => {
    const headers = { authorization: `Bearer ${apiKey}` };
    const ok = await t.app.inject({ method: 'PUT', url: '/v1/merchant/products/pilot-skirt', headers, payload: { ...PILOT_PULL_ON_SKIRT, id: 'pilot-skirt' } });
    expect(ok.statusCode).toBe(200);
    const row = await t.handle.db.query.products.findFirst({ where: (p, { eq }) => eq(p.externalId, 'pilot-skirt') });
    expect(row?.payload.closure).toBe('pull-on');
    expect(row?.payload.garmentTape).toEqual(PILOT_PULL_ON_SKIRT.garmentTape);
    const extra = [...PILOT_PULL_ON_SKIRT.garmentTape!, { size: '18', waistRelaxed: { cm: 90, provenance: 'extrapolated' } }];
    const bad = await t.app.inject({ method: 'PUT', url: '/v1/merchant/products/pilot-skirt', headers, payload: { ...PILOT_PULL_ON_SKIRT, id: 'pilot-skirt', garmentTape: extra } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toBe('garmentTape names size 18, which sizeChart does not have.');
    const noProvenance = await t.app.inject({
      method: 'PUT',
      url: '/v1/merchant/products/pilot-skirt',
      headers,
      payload: { ...PILOT_PULL_ON_SKIRT, id: 'pilot-skirt', garmentTape: [{ size: '8', waistRelaxed: { cm: 67 } }] },
    });
    expect(noProvenance.statusCode).toBe(400);
    // The dry run says what the PUT refuses (it used to call this payload fine).
    const { sizeChart: _c, ...noChart } = PILOT_PULL_ON_SKIRT;
    const refused = await t.app.inject({ method: 'PUT', url: '/v1/merchant/products/pilot-skirt', headers, payload: { ...noChart, id: 'pilot-skirt' } });
    expect(refused.statusCode).toBe(422);
    const dry = await t.app.inject({ method: 'POST', url: '/v1/merchant/products/validate', headers, payload: { payload: { ...noChart, id: 'pilot-skirt' } } });
    expect(dry.statusCode).toBe(200);
    expect(dry.json().valid).toBe(false);
    expect(dry.json().issues).toContainEqual({ path: 'garmentTape', message: 'garmentTape is set but sizeChart is empty: the garment measurements are per size of the chart.' });
  });
});
