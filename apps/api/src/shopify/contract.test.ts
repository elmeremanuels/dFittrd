/**
 * Offline contract harness: the api against a faithful fake of Shopify (src/test/fakeShopify).
 * One ordered flow per distribution type, following the live-store list in
 * packages/shopify-app/README.md ("Must be verified against a live store") and
 * docs/LAUNCH-SHOPIFY.md:
 *
 *   install → token exchange → metafield definitions → app-data metafields → backfill (paged, and the
 *   package's bulk export) → chart builder write → billing decline / approve → app_subscriptions/update
 *   → token refresh → webhook retry → uninstall → reinstall → missed webhook → compliance webhooks.
 *
 * Every GraphQL document the code sends is validated against an excerpt of the 2026-10 Admin schema
 * (graphql-js); the suite fails on any violation. What this CANNOT prove is listed in
 * docs/LAUNCH-SHOPIFY.md: the excerpt is hand-written from the reference, the fake's ASSUMPTIONs
 * (marked in its source) are not Shopify's behaviour until a store confirms them, and nothing here
 * touches Liquid, the theme editor, App Bridge or the admin iframe.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CHART_TEMPLATES } from '@curtain/schema';
import { createAdminClient, METAFIELD_DEFINITION_INPUTS, runProductBackfill, syncProductNode } from '@curtain/shopify-app';
import { products, shopifySessions, shops, webhookLog } from '../db/schema.js';
import { FakeShopify } from '../test/fakeShopify/index.js';
import { makeApp, type TestApp } from '../test/helpers.js';

const API_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const API_SECRET = 'fake' + '_client_secret_' + 'x'.repeat(24);

const SIZE_CHART = JSON.stringify([
  { size: '8', bust: 84, waist: 66, hip: 92 },
  { size: '10', bust: 89, waist: 71, hip: 97 },
  { size: '12', bust: 94, waist: 76, hip: 102 },
  { size: '14', bust: 99, waist: 81, hip: 107 },
]);

interface Harness {
  t: TestApp;
  fake: FakeShopify;
  clock: { at: Date };
}

async function harness(distribution: 'public' | 'custom', envDistribution: 'public' | 'custom' = distribution): Promise<Harness> {
  const clock = { at: new Date('2026-11-09T09:00:00Z') };
  const now = () => new Date(clock.at);
  const t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET, SHOPIFY_DISTRIBUTION: envDistribution }, { now });
  const fake = new FakeShopify({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    distribution,
    now,
    deliver: async ({ url, headers, body }) => (await t.app.inject({ method: 'POST', url, headers, payload: body })).statusCode,
  });
  t.fetchMock.on(() => true, (url, init) => fake.fetch(url, init));
  return { t, fake, clock };
}

const auth = (fake: FakeShopify, shop: string) => ({ authorization: `Bearer ${fake.idToken(shop)}` });

async function openAdmin(h: Harness, shop: string) {
  return h.t.app.inject({ method: 'POST', url: '/shopify/token-exchange', payload: { shop, sessionToken: h.fake.idToken(shop) } });
}

/** Run queued jobs until none is left (backfill pages schedule each other). */
async function drainAll(t: TestApp): Promise<void> {
  for (let i = 0; i < 20; i++) if ((await t.queue.drain(true)) === 0) return;
}

const shopRow = (t: TestApp, domain: string) => t.handle.db.query.shops.findFirst({ where: eq(shops.domain, domain) });

describe('contract: public-distribution app on an AUD development store', () => {
  const SHOP = 'curtain-dev-au.myshopify.com';
  let h: Harness;
  let dress: string;
  let draft: string;
  let skirt: string;
  let trialStartedAt = '';

  beforeAll(async () => {
    h = await harness('public');
    h.fake.addStore(SHOP, { billingCurrency: 'AUD', shopCurrency: 'AUD', devStore: true, primaryDomain: 'curtain-dev-au.example' });
    dress = h.fake.addProduct(SHOP, { title: 'Azure Palm Baby Doll Dress', tags: ['dresses'] }, {
      category: { type: 'single_line_text_field', value: 'dress' },
      size_chart_type: { type: 'single_line_text_field', value: 'body' },
      size_chart: { type: 'json', value: SIZE_CHART },
    }).id;
    draft = h.fake.addProduct(SHOP, { title: 'Unreleased Wrap Dress', status: 'DRAFT' }, { size_chart_type: { type: 'single_line_text_field', value: 'body' }, size_chart: { type: 'json', value: SIZE_CHART } }).id;
    skirt = h.fake.addProduct(SHOP, { title: 'Crimson Wildflower Maxi Skirt', productType: 'Skirts', tags: ['skirts'], category: { id: 'gid://shopify/TaxonomyCategory/aa-1-15', name: 'Skirts', fullName: 'Apparel & Accessories > Clothing > Skirts' } }).id;
  });
  afterAll(async () => {
    await h.t.close();
  });

  it('1. install → token exchange: ID token for an expiring offline token (+ refresh token), shop row and keys', async () => {
    h.fake.install(SHOP);
    const res = await openAdmin(h, SHOP);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ shopDomain: SHOP, scope: 'read_products,write_products', backfillQueued: true });
    const ex = h.fake.requests.find((r) => r.kind === 'oauth')!;
    expect(ex.body).toMatchObject({
      client_id: API_KEY,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      expiring: '1',
    });
    expect(ex.status).toBe(200);
    const sess = await h.t.handle.db.query.shopifySessions.findFirst({ where: eq(shopifySessions.shopDomain, SHOP) });
    expect(sess?.expiresAt).toBeInstanceOf(Date);
    expect(sess?.refreshTokenEnc).toBeTruthy();
    expect((await shopRow(h.t, SHOP))?.settings.primaryDomain).toBe('curtain-dev-au.example');
  });

  it('2. metafield definitions: every one created once on PRODUCT in $app:curtain, accepted by the validations rules', () => {
    const defs = [...h.fake.store(SHOP).definitions.values()];
    expect(defs).toHaveLength(METAFIELD_DEFINITION_INPUTS.length);
    expect(new Set(defs.map((d) => d.namespace))).toEqual(new Set([`app--${h.fake.appId}--curtain`]));
    expect(defs.every((d) => d.ownerType === 'PRODUCT' && d.access.admin === 'MERCHANT_READ_WRITE')).toBe(true);
    expect(defs.find((d) => d.key === 'size_chart_type')?.validations).toEqual([{ name: 'choices', value: '["garment","body"]' }]);
  });

  it('3. app-data metafields: the theme block reads app.metafields.curtain.{public_key,api_url,app_url}; never a secret key', () => {
    const appData = h.fake.store(SHOP).appData;
    expect([...appData.keys()].sort()).toEqual(['curtain.api_url', 'curtain.app_url', 'curtain.public_key']);
    expect(appData.get('curtain.public_key')?.value).toMatch(/^pk_test_/);
    expect(appData.get('curtain.api_url')?.value).toBe(h.t.env.PUBLIC_API_URL);
    expect(JSON.stringify([...appData.values()])).not.toMatch(/sk_(live|test)_/);
  });

  it('4. opening the app again is idempotent: TAKEN definitions are not an error', async () => {
    const before = h.fake.store(SHOP).definitions.size;
    const res = await openAdmin(h, SHOP);
    expect(res.statusCode).toBe(200);
    expect(h.fake.store(SHOP).definitions.size).toBe(before);
  });

  it('5. backfill (paged): active products only; the size chart is read back from the namespace Shopify returns (app--{id}--curtain)', async () => {
    await drainAll(h.t);
    expect(h.t.queue.failed).toHaveLength(0);
    const shop = (await shopRow(h.t, SHOP))!;
    const rows = await h.t.handle.db.select().from(products).where(eq(products.shopId, shop.id));
    const byId = new Map(rows.map((r) => [r.externalId, r]));
    expect([...byId.keys()].sort()).toEqual([dress, skirt].map((g) => g.split('/').pop()!).sort());
    expect(byId.has(draft.split('/').pop()!)).toBe(false);
    const d = byId.get(dress.split('/').pop()!)!;
    expect(d.status).toBe('active');
    expect((d.payload as { sizeChart?: unknown[] }).sizeChart).toHaveLength(4);
    expect(byId.get(skirt.split('/').pop()!)!.status).toBe('incomplete');
  });

  it('6. backfill (bulk export in the package): query within the limits, ungrouped JSONL folded back, products usable', async () => {
    const token = (await h.t.app.ctx.shopify.accessTokenFor(SHOP))!;
    const client = createAdminClient({ shopDomain: SHOP, accessToken: token, fetch: h.fake.fetch, sleep: async () => {} });
    const r = await runProductBackfill(client, { fetch: h.fake.fetch, sleep: async () => {}, pollMs: 1 });
    expect(r.operation.status).toBe('COMPLETED');
    expect(r.skipped).toEqual([]);
    expect(r.products.map((p) => p.title).sort()).toEqual(['Azure Palm Baby Doll Dress', 'Crimson Wildflower Maxi Skirt']);
    const synced = r.products.map((p) => syncProductNode(p, { defaultBrand: 'Curtain dev' }));
    const az = synced.find((s) => s.externalId === dress.split('/').pop())!;
    expect(az.usable).toBe(true);
    expect(az.draft.sizeChart).toHaveLength(4);
  });

  it('7. chart builder: preview + assign by product type writes valid metafields (choices honoured); the sync makes it try-able', async () => {
    const selector = { kind: 'productType', productType: 'Skirts' };
    const prev = await h.t.app.inject({ method: 'POST', url: '/shopify/charts/preview', headers: auth(h.fake, SHOP), payload: { selector } });
    expect(prev.statusCode).toBe(200);
    expect(prev.json()).toMatchObject({ count: 1, precision: 'EXACT' });
    const template = CHART_TEMPLATES.find((x) => x.id === 'au-womens-body')!;
    const res = await h.t.app.inject({ method: 'POST', url: '/shopify/charts/assign', headers: auth(h.fake, SHOP), payload: { selector, chart: { templateId: template.id } } });
    expect(res.statusCode).toBe(200);
    expect(res.json().written).toEqual([skirt.split('/').pop()]);
    const keys = h.fake.store(SHOP).products.get(skirt)!.metafields.map((m) => m.key).sort();
    expect(keys).toEqual(expect.arrayContaining(['size_chart', 'size_chart_type']));
    await drainAll(h.t);
    const row = await h.t.handle.db.query.products.findFirst({ where: eq(products.externalId, skirt.split('/').pop()!) });
    expect(row?.status).toBe('active'); // chart + type from the builder; the category comes from Shopify's taxonomy (Skirts)
    expect((row?.payload as { sizeChartType?: string }).sizeChartType).toBe('body');
  });

  it('8. billing, decline: a test charge in AUD on the development store; DECLINED keeps the shop free and the trial unused', async () => {
    const res = await h.t.app.inject({ method: 'POST', url: '/shopify/billing/subscribe', headers: auth(h.fake, SHOP), payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ currency: 'AUD', test: true, trialDays: 7 });
    expect(body.confirmationUrl).toMatch(new RegExp(`^https://${SHOP.replace(/\./g, '\\.')}/admin/charges/`));
    const sub = h.fake.store(SHOP).subscriptions.at(-1)!;
    expect(sub).toMatchObject({ status: 'PENDING', test: true, name: 'Curtain', trialDays: 7 });
    expect(sub.lineItems).toHaveLength(1);
    expect(sub.lineItems[0]!.price.currencyCode).toBe('AUD');
    await h.fake.decline(SHOP, sub.id);
    const s = (await shopRow(h.t, SHOP))!;
    expect(s.plan).toBe('free');
    expect(s.settings.pendingSubscriptionId).toBeUndefined();
    expect(s.settings.trialStartedAt).toBeUndefined();
  });

  it('9. billing, approve: ACTIVE update → plan curtain, unpaused, billingRef, trial clock starts', async () => {
    const res = await h.t.app.inject({ method: 'POST', url: '/shopify/billing/subscribe', headers: auth(h.fake, SHOP), payload: {} });
    const sub = h.fake.store(SHOP).subscriptions.at(-1)!;
    expect(res.json().subscriptionId).toBe(sub.id);
    await h.fake.approve(SHOP, sub.id);
    const s = (await shopRow(h.t, SHOP))!;
    expect(s).toMatchObject({ plan: 'curtain', paused: false, billingRef: sub.id });
    expect(s.settings.trialStartedAt).toBe(h.clock.at.toISOString());
    trialStartedAt = s.settings.trialStartedAt!;
    // the next admin open reconciles with currentAppInstallation.activeSubscriptions: nothing changes
    expect((await openAdmin(h, SHOP)).statusCode).toBe(200);
    expect((await shopRow(h.t, SHOP))).toMatchObject({ plan: 'curtain', billingRef: sub.id });
  });

  it('10. expiring token: an expired access token is refreshed (refresh-token rotation) and the request succeeds', async () => {
    h.clock.at = new Date(h.clock.at.getTime() + 2 * 3600_000);
    h.fake.expireAccessTokens(SHOP);
    const before = h.fake.requests.filter((r) => r.kind === 'oauth' && r.body?.grant_type === 'refresh_token').length;
    const res = await h.t.app.inject({ method: 'GET', url: '/shopify/charts/onboarding', headers: auth(h.fake, SHOP) });
    expect(res.statusCode).toBe(200);
    const refreshes = h.fake.requests.filter((r) => r.kind === 'oauth' && r.body?.grant_type === 'refresh_token');
    expect(refreshes.length).toBe(before + 1);
    expect(refreshes.at(-1)!.status).toBe(200);
    expect(h.fake.validAccessTokens(SHOP)).toBeGreaterThan(0);
  });

  it('11. webhooks: a delivery whose processing fails is answered 500 and reprocessed when Shopify retries it', async () => {
    const spy = vi.spyOn(h.t.queue, 'send').mockRejectedValueOnce(new Error('queue down'));
    const first = await h.fake.productUpdated(SHOP, dress);
    expect(first).toBe(500);
    const id = h.fake.webhooks.at(-1)!.webhookId;
    expect((await h.t.handle.db.query.webhookLog.findFirst({ where: eq(webhookLog.eventId, id) }))?.status).toBe('failed');
    expect(await h.fake.retryFailedDeliveries()).toBe(1);
    expect(h.fake.webhooks.at(-1)!.lastStatus).toBe(200);
    expect((await h.t.handle.db.query.webhookLog.findFirst({ where: eq(webhookLog.eventId, id) }))?.status).toBe('processed');
    spy.mockRestore();
    // an already processed delivery is acknowledged as a duplicate, not processed twice
    const d = h.fake.webhooks.at(-1)!;
    const again = await h.t.app.inject({ method: 'POST', url: '/shopify/webhooks', headers: d.headers, payload: d.body });
    expect(again.json()).toEqual({ ok: true, duplicate: true });
    await drainAll(h.t);
  });

  it('12. uninstall: app/uninstalled drops the shop to free, pauses it, deletes the tokens; Shopify refuses the old token', async () => {
    const token = (await h.t.app.ctx.shopify.accessTokenFor(SHOP))!;
    await h.fake.uninstall(SHOP);
    expect(h.fake.webhooks.at(-1)).toMatchObject({ topic: 'app/uninstalled', lastStatus: 200 });
    const s = (await shopRow(h.t, SHOP))!;
    expect(s).toMatchObject({ plan: 'free', paused: true, billingRef: null });
    expect(s.uninstalledAt).toBeInstanceOf(Date);
    expect(await h.t.handle.db.select().from(shopifySessions).where(eq(shopifySessions.shopId, s.id))).toHaveLength(0);
    const direct = await h.fake.fetch(`https://${SHOP}/admin/api/2026-10/graphql.json`, { method: 'POST', headers: { 'x-shopify-access-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ shop { name } }' }) });
    expect(direct.status).toBe(401);
    expect((await h.t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: auth(h.fake, SHOP) })).statusCode).toBe(403);
  });

  it('13. reinstall: a new token, still free with no subscription, definitions kept, app data rewritten, products restored from the shop', async () => {
    h.fake.install(SHOP);
    const res = await openAdmin(h, SHOP);
    expect(res.statusCode).toBe(200);
    const s = (await shopRow(h.t, SHOP))!;
    expect(s).toMatchObject({ plan: 'free', paused: false, billingRef: null, uninstalledAt: null });
    expect(s.settings.subscriptionStatus).toBeUndefined();
    expect(h.fake.store(SHOP).subscriptions.filter((x) => x.status === 'ACTIVE')).toHaveLength(0);
    expect(h.fake.store(SHOP).appData.has('curtain.public_key')).toBe(true);
    await drainAll(h.t);
    const d = await h.t.handle.db.query.products.findFirst({ where: eq(products.externalId, dress.split('/').pop()!) });
    expect(d?.status).toBe('active');
    // the trial clock survives the uninstall (a reinstall never earns a second full trial)
    expect(s.settings.trialStartedAt).toBe(trialStartedAt);
    h.clock.at = new Date(h.clock.at.getTime() + 3 * 86400_000);
    const sub = await h.t.app.inject({ method: 'POST', url: '/shopify/billing/subscribe', headers: auth(h.fake, SHOP), payload: {} });
    expect(sub.statusCode).toBe(200);
    expect(sub.json().trialDays).toBe(4);
  });

  it('14. a missed app_subscriptions/update is repaired at the next admin open (activeSubscriptions reconcile)', async () => {
    const sub = h.fake.store(SHOP).subscriptions.at(-1)!;
    await h.fake.approve(SHOP, sub.id, { dropWebhooks: true });
    expect((await shopRow(h.t, SHOP))?.plan).toBe('free');
    await openAdmin(h, SHOP);
    expect(await shopRow(h.t, SHOP)).toMatchObject({ plan: 'curtain', paused: false, billingRef: sub.id });
  });

  it('15. compliance webhooks: 401 on a bad HMAC; customer topics acknowledged without storing PII; shop/redact purges after 48 h', async () => {
    for (const topic of ['customers/data_request', 'customers/redact', 'shop/redact']) {
      expect(await h.fake.webhook(SHOP, topic, { shop_id: 1, shop_domain: SHOP }, { secret: 'not-the-secret' })).toBe(401);
    }
    expect(await h.fake.customersDataRequest(SHOP)).toBe(200);
    expect(await h.fake.customersRedact(SHOP)).toBe(200);
    const logs = await h.t.handle.db.select().from(webhookLog).where(eq(webhookLog.shopDomain, SHOP));
    expect(JSON.stringify(logs.filter((l) => l.topic.startsWith('customers/')))).not.toContain('john@example.com');
    await h.fake.uninstall(SHOP);
    h.clock.at = new Date(h.clock.at.getTime() + 48 * 3600_000);
    expect(await h.fake.shopRedact(SHOP)).toBe(200);
    const purge = h.t.queue.pending('purge-shop');
    expect(purge).toHaveLength(1);
    expect(await h.t.queue.drain(true)).toBeGreaterThanOrEqual(1);
    expect(await shopRow(h.t, SHOP)).toBeUndefined();
  });

  it('every GraphQL document the code sent validates against the 2026-10 excerpt; the deprecated fields in use are known', () => {
    expect(h.fake.violations).toEqual([]);
    const ops = new Set(h.fake.requests.filter((r) => r.kind === 'graphql' && r.status === 200).map((r) => r.operationName));
    for (const op of ['CurtainDefinition', 'CurtainInstallation', 'CurtainMetafieldsSet', 'CurtainProducts', 'CurtainProduct', 'CurtainBulkExport', 'CurtainBulkStatus', 'CurtainSubscribe', 'CurtainSubscriptions', 'CurtainBillingCurrency', 'CurtainPrimaryDomain', 'CurtainProductsCount', 'CurtainChartTargets', 'CurtainOnboarding']) {
      expect(ops, op).toContain(op);
    }
    // Product.featuredImage / Product.images are deprecated in 2026-10 (still served). Replace with
    // featuredMedia / media before they are removed; this list makes a new deprecated use visible.
    expect([...h.fake.deprecatedUses].sort()).toEqual(['Product.featuredImage', 'Product.images']);
  });
});

describe('contract: custom-distribution app (the pilot)', () => {
  const SHOP = 'pilot-au.myshopify.com';
  let h: Harness;
  beforeAll(async () => {
    h = await harness('custom');
    h.fake.addStore(SHOP, { billingCurrency: 'AUD', shopCurrency: 'AUD', devStore: false });
    h.fake.addProduct(SHOP, { title: 'Azure Palm Baby Doll Dress' }, { category: { type: 'single_line_text_field', value: 'dress' }, size_chart_type: { type: 'single_line_text_field', value: 'body' }, size_chart: { type: 'json', value: SIZE_CHART } });
  });
  afterAll(async () => {
    await h.t.close();
  });

  it('install grants the plan by hand (no Shopify billing for custom apps), unpaused, no billingRef', async () => {
    h.fake.install(SHOP);
    expect((await openAdmin(h, SHOP)).statusCode).toBe(200);
    const s = (await shopRow(h.t, SHOP))!;
    expect(s).toMatchObject({ plan: 'curtain', paused: false, billingRef: null });
    expect(s.settings.subscriptionStatus).toBe('ARRANGED');
    await drainAll(h.t);
    const rows = await h.t.handle.db.select().from(products).where(eq(products.shopId, s.id));
    expect(rows.map((r) => r.status)).toEqual(['active']);
  });

  it('subscribe answers 409 billing_not_available and never calls appSubscriptionCreate; the admin page hides the button', async () => {
    const res = await h.t.app.inject({ method: 'POST', url: '/shopify/billing/subscribe', headers: auth(h.fake, SHOP), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('billing_not_available');
    expect(h.fake.requests.some((r) => r.operationName === 'CurtainSubscribe')).toBe(false);
    const page = await h.t.app.inject({ method: 'GET', url: `/shopify/admin?shop=${SHOP}` });
    expect(page.body).toContain('"billing":"arranged"');
  });

  it('an operator pause survives the next admin open; uninstall → free; reinstall → granted again', async () => {
    const id = (await shopRow(h.t, SHOP))!.id;
    await h.t.handle.db.update(shops).set({ paused: true }).where(eq(shops.id, id));
    await openAdmin(h, SHOP);
    expect((await shopRow(h.t, SHOP))?.paused).toBe(true);
    await h.fake.uninstall(SHOP);
    expect(await shopRow(h.t, SHOP)).toMatchObject({ plan: 'free', paused: true });
    h.fake.install(SHOP);
    await openAdmin(h, SHOP);
    expect(await shopRow(h.t, SHOP)).toMatchObject({ plan: 'curtain', paused: false, billingRef: null });
  });

  it('no GraphQL violations', () => {
    expect(h.fake.violations).toEqual([]);
  });
});

describe('contract: SHOPIFY_DISTRIBUTION=public on an app the Dev Dashboard set to custom', () => {
  it("Shopify's refusal is answered 409 billing_not_available (not a 500), and the log says what to change", async () => {
    const SHOP = 'misconfigured-au.myshopify.com';
    const h = await harness('custom', 'public');
    try {
      h.fake.addStore(SHOP, { billingCurrency: 'AUD' });
      h.fake.install(SHOP);
      expect((await openAdmin(h, SHOP)).statusCode).toBe(200);
      const res = await h.t.app.inject({ method: 'POST', url: '/shopify/billing/subscribe', headers: auth(h.fake, SHOP), payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('billing_not_available');
      expect(h.fake.requests.filter((r) => r.operationName === 'CurtainSubscribe')).toHaveLength(1);
      expect((await shopRow(h.t, SHOP))?.settings.pendingSubscriptionId).toBeUndefined();
    } finally {
      await h.t.close();
    }
  });
});
