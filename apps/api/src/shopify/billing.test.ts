import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_API_VERSION, DEFAULT_EUR_RATES } from '@curtain/shopify-app';
import { shops, webhookLog } from '../db/schema.js';
import { testEnv } from '../env.js';
import { hmacBase64 } from '../lib/crypto.js';
import { updateSettings } from '../services/shops.js';
import { json, makeApp, seedShop, type TestApp } from '../test/helpers.js';
import { billingSettingsPatch, shopBillingCurrency, type ShopifyBillingSettings } from './client.js';

const API_KEY = 'shpa_billingkey';
const API_SECRET = 'shpss' + '_test_billing_0123456789';
const TOKEN = 'shp' + 'at_billing_x';

async function sessionToken(shop: string) {
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, sub: '42', sid: 'sid-1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(API_KEY)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('1m')
    .setJti(`jti-${Math.random()}`)
    .sign(new TextEncoder().encode(API_SECRET));
}

type Gql = { query: string; variables: Record<string, unknown> };

/** Mock Admin API for one shop: billing currency, development-store flag, appSubscriptionCreate. */
function mockAdmin(t: TestApp, shop: string, billingCurrency: string | null, seen: Gql[], opts: { devStore?: boolean; subscriptionId?: string } = {}) {
  t.fetchMock.on(`https://${shop}/admin/api/`, async (url, init) => {
    expect(url).toBe(`https://${shop}/admin/api/${DEFAULT_API_VERSION}/graphql.json`);
    const q = JSON.parse(String(init?.body)) as Gql;
    seen.push(q);
    if (q.query.includes('shopBillingPreferences')) return json({ data: { shopBillingPreferences: billingCurrency ? { currency: billingCurrency } : null, shop: { currencyCode: 'EUR' } } });
    if (q.query.includes('partnerDevelopment')) return json({ data: { shop: { plan: { partnerDevelopment: opts.devStore ?? false } } } });
    if (q.query.includes('appSubscriptionCreate')) {
      return json({
        data: {
          appSubscriptionCreate: {
            userErrors: [],
            confirmationUrl: `https://${shop}/admin/charges/1/confirm`,
            appSubscription: {
              id: opts.subscriptionId ?? 'gid://shopify/AppSubscription/1',
              status: 'PENDING',
              lineItems: [{ id: 'gid://shopify/AppSubscriptionLineItem/1', plan: { pricingDetails: { __typename: 'AppRecurringPricing' } } }],
            },
          },
        },
      });
    }
    return json({ errors: [{ message: 'unexpected query' }] }, 400);
  });
}

const subscribeVars = (seen: Gql[]) => seen.find((q) => q.query.includes('appSubscriptionCreate'))!.variables as { name: string; test: boolean; trialDays: number; lineItems: unknown[] };

describe('Shopify billing: the one Curtain plan (D17)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
  });
  afterAll(async () => {
    await t.close();
  });

  async function installed(domain: string, plan: 'free' | 'curtain' = 'free') {
    const { shop } = await seedShop(t, { platform: 'shopify', domain, plan, products: ['aalter-studio-1'] });
    await t.app.ctx.shopify.saveOfflineSession(shop.id, domain, TOKEN, 'read_products,write_products');
    return shop;
  }

  async function subscribe(domain: string, payload: Record<string, unknown> = {}) {
    return t.app.inject({ method: 'POST', url: '/shopify/billing/subscribe', headers: { authorization: `Bearer ${await sessionToken(domain)}` }, payload });
  }

  it('USD shop: one recurring line of USD 8.99 every 30 days, 7-day trial, test charge outside production, no usage line', async () => {
    const domain = 'usd-shop.myshopify.com';
    const shop = await installed(domain);
    const seen: Gql[] = [];
    mockAdmin(t, domain, 'USD', seen);

    const res = await subscribe(domain);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ confirmationUrl: `https://${domain}/admin/charges/1/confirm`, subscriptionId: 'gid://shopify/AppSubscription/1', currency: 'USD', price: 8.99, trialDays: 7, test: true });
    const v = subscribeVars(seen);
    expect(v).toMatchObject({ name: 'Curtain', test: true, trialDays: 7 });
    expect(v.lineItems).toEqual([{ plan: { appRecurringPricingDetails: { price: { amount: 8.99, currencyCode: 'USD' }, interval: 'EVERY_30_DAYS' } } }]);
    expect(JSON.stringify(v)).not.toMatch(/appUsagePricingDetails|cappedAmount/);

    const stored = (await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) }))!;
    expect(stored.settings as ShopifyBillingSettings).toMatchObject({ billingCurrency: 'USD', billingUsdRate: 1, billingPrice: 8.99 });
    expect(stored.settings).toMatchObject({ subscriptionStatus: 'PENDING', pendingSubscriptionId: 'gid://shopify/AppSubscription/1' });
    expect(stored.settings.trialStartedAt).toBeTypeOf('string');
    // nothing changes until Shopify reports the subscription ACTIVE
    expect(stored).toMatchObject({ plan: 'free', billingRef: null });
  });

  it('AUD pilot shop: the USD price converted through the rate table, the rate recorded', async () => {
    const domain = 'aud-pilot.myshopify.com';
    const shop = await installed(domain);
    const seen: Gql[] = [];
    mockAdmin(t, domain, 'AUD', seen);
    const res = await subscribe(domain);
    const usdRate = Math.round((DEFAULT_EUR_RATES.AUD! / DEFAULT_EUR_RATES.USD!) * 1e6) / 1e6;
    const price = Math.round(8.99 * usdRate * 100) / 100;
    expect(price).toBe(13.8);
    expect(res.json()).toMatchObject({ currency: 'AUD', price });
    expect(subscribeVars(seen).lineItems).toEqual([{ plan: { appRecurringPricingDetails: { price: { amount: price, currencyCode: 'AUD' }, interval: 'EVERY_30_DAYS' } } }]);
    const stored = (await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) }))!;
    expect(stored.settings as ShopifyBillingSettings).toMatchObject({ billingCurrency: 'AUD', billingUsdRate: usdRate, billingPrice: price });

    // the merchant console shows the charged price once the subscription is active
    await updateSettings(t.handle.db, shop.id, {}, { plan: 'curtain' });
    const usage = await t.app.inject({ method: 'GET', url: '/v1/merchant/usage?from=2026-11-01&to=2026-11-04', headers: { authorization: `Bearer ${await sessionToken(domain)}` } });
    expect(usage.json().plan).toMatchObject({ name: 'curtain', priceUsdPerMonth: 8.99, chargePrice: price, chargeCurrency: 'AUD', overageEurPerSession: 0 });
  });

  it('a billing currency without a rate is charged in USD (Shopify converts USD charges)', async () => {
    const domain = 'xyz-shop.myshopify.com';
    await installed(domain);
    const seen: Gql[] = [];
    mockAdmin(t, domain, 'XYZ', seen);
    const res = await subscribe(domain);
    expect(res.json()).toMatchObject({ currency: 'USD', price: 8.99 });
  });

  it('subscribing again never restarts the trial; the retired plan names are accepted and mean Curtain', async () => {
    const domain = 'again.myshopify.com';
    const shop = await installed(domain);
    const seen: Gql[] = [];
    mockAdmin(t, domain, 'USD', seen);
    await updateSettings(t.handle.db, shop.id, { trialStartedAt: new Date(Date.now() - 5 * 86_400_000 - 60_000).toISOString() });
    const res = await subscribe(domain, { plan: 'starter' });
    expect(res.statusCode).toBe(200);
    expect(res.json().trialDays).toBe(2);
    expect(subscribeVars(seen)).toMatchObject({ name: 'Curtain', trialDays: 2 });
    expect((await subscribe(domain, { plan: 'enterprise' })).statusCode).toBe(400);
  });

  it('refuses WooCommerce shops and shops without an offline token', async () => {
    const { shop } = await seedShop(t, { platform: 'shopify', domain: 'no-token.myshopify.com', products: [] });
    expect(shop.plan).toBe('curtain');
    const res = await subscribe('no-token.myshopify.com');
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('shop_not_installed');
  });
});

describe('Shopify billing test flag in production', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ NODE_ENV: 'production', SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
  });
  afterAll(async () => {
    await t.close();
  });

  async function run(domain: string, devStore: boolean, payload: Record<string, unknown>) {
    const { shop } = await seedShop(t, { platform: 'shopify', domain, plan: 'free', products: [] });
    await t.app.ctx.shopify.saveOfflineSession(shop.id, domain, TOKEN, 'read_products');
    const seen: Gql[] = [];
    mockAdmin(t, domain, 'USD', seen, { devStore });
    const res = await t.app.inject({ method: 'POST', url: '/shopify/billing/subscribe', headers: { authorization: `Bearer ${await sessionToken(domain)}` }, payload });
    expect(res.statusCode).toBe(200);
    return subscribeVars(seen).test;
  }

  it('a merchant cannot ask for a free test charge on a live store; development stores get test charges', async () => {
    expect(await run('live-shop.myshopify.com', false, { test: true })).toBe(false);
    expect(await run('dev-shop.myshopify.com', true, {})).toBe(true);
  });

  it('SHOPIFY_BILLING_TEST forces the flag (staging)', async () => {
    const env = testEnv({ SHOPIFY_BILLING_TEST: '1' });
    expect(env.SHOPIFY_BILLING_TEST).toBe(true);
    expect(testEnv().SHOPIFY_BILLING_TEST).toBeUndefined();
  });
});

describe('APP_SUBSCRIPTIONS_UPDATE webhook (D17)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
  });
  afterAll(async () => {
    await t.close();
  });

  const SUB = (n: number) => `gid://shopify/AppSubscription/${n}`;
  const webhook = (shop: string, status: string, id: string, webhookId = `wh-${Math.random().toString(36).slice(2)}`) => {
    const body = JSON.stringify({ app_subscription: { admin_graphql_api_id: id, name: 'Curtain', status, admin_graphql_api_shop_id: 'gid://shopify/Shop/1', created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z', currency: 'USD' } });
    return t.app.inject({
      method: 'POST',
      url: '/shopify/webhooks',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'app_subscriptions/update', 'x-shopify-shop-domain': shop, 'x-shopify-webhook-id': webhookId, 'x-shopify-hmac-sha256': hmacBase64(API_SECRET, body) },
      payload: body,
    });
  };
  const row = async (id: string) => (await t.handle.db.query.shops.findFirst({ where: eq(shops.id, id) }))!;

  it('ACTIVE → curtain, unpaused, billingRef; FROZEN pauses and keeps the plan; ACTIVE again resumes', async () => {
    const domain = 'hook-a.myshopify.com';
    const { shop } = await seedShop(t, { platform: 'shopify', domain, plan: 'free', products: [] });
    await updateSettings(t.handle.db, shop.id, { pendingSubscriptionId: SUB(1), subscriptionStatus: 'PENDING' });
    expect((await webhook(domain, 'ACTIVE', SUB(1))).statusCode).toBe(200);
    let s = await row(shop.id);
    expect(s).toMatchObject({ plan: 'curtain', paused: false, billingRef: SUB(1) });
    expect(s.settings.subscriptionStatus).toBe('ACTIVE');
    expect(s.settings.pendingSubscriptionId).toBeUndefined();
    expect(s.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await webhook(domain, 'FROZEN', SUB(1));
    expect(await row(shop.id)).toMatchObject({ plan: 'curtain', paused: true });
    await webhook(domain, 'ACTIVE', SUB(1));
    s = await row(shop.id);
    expect(s).toMatchObject({ plan: 'curtain', paused: false });
  });

  it('an old subscription cancelled after a new one is approved never pauses the shop', async () => {
    const domain = 'hook-b.myshopify.com';
    const { shop } = await seedShop(t, { platform: 'shopify', domain, plan: 'free', products: [] });
    await webhook(domain, 'ACTIVE', SUB(1));
    await webhook(domain, 'ACTIVE', SUB(2)); // the replacement
    await webhook(domain, 'CANCELLED', SUB(1)); // Shopify cancels the replaced one
    expect(await row(shop.id)).toMatchObject({ plan: 'curtain', paused: false, billingRef: SUB(2) });
    await webhook(domain, 'DECLINED', SUB(3)); // a second attempt the merchant declined
    expect(await row(shop.id)).toMatchObject({ plan: 'curtain', paused: false, billingRef: SUB(2) });
  });

  it('CANCELLED / EXPIRED of the current subscription → free and paused; a declined first attempt only records the status', async () => {
    const domain = 'hook-c.myshopify.com';
    const { shop } = await seedShop(t, { platform: 'shopify', domain, plan: 'free', products: [] });
    await updateSettings(t.handle.db, shop.id, { pendingSubscriptionId: SUB(5) });
    await webhook(domain, 'DECLINED', SUB(5));
    let s = await row(shop.id);
    expect(s).toMatchObject({ plan: 'free', paused: false, billingRef: null });
    expect(s.settings).toMatchObject({ subscriptionStatus: 'DECLINED' });
    expect(s.settings.pendingSubscriptionId).toBeUndefined();

    await webhook(domain, 'ACTIVE', SUB(6));
    await webhook(domain, 'EXPIRED', SUB(6));
    s = await row(shop.id);
    expect(s).toMatchObject({ plan: 'free', paused: true, billingRef: SUB(6) });
    await webhook(domain, 'ACTIVE', SUB(7));
    await webhook(domain, 'CANCELLED', SUB(7));
    expect(await row(shop.id)).toMatchObject({ plan: 'free', paused: true });
  });

  it('a replayed delivery is acknowledged once and processed once', async () => {
    const domain = 'hook-d.myshopify.com';
    const { shop } = await seedShop(t, { platform: 'shopify', domain, plan: 'free', products: [] });
    expect((await webhook(domain, 'ACTIVE', SUB(9), 'wh-fixed-9')).json()).toEqual({ ok: true });
    expect((await webhook(domain, 'CANCELLED', SUB(9), 'wh-fixed-9')).json()).toEqual({ ok: true, duplicate: true });
    expect(await row(shop.id)).toMatchObject({ plan: 'curtain', paused: false });
    const logs = await t.handle.db.select().from(webhookLog).where(eq(webhookLog.eventId, 'wh-fixed-9'));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.status).toBe('processed');
  });

  it('a bad HMAC is refused', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/shopify/webhooks',
      headers: { 'content-type': 'application/json', 'x-shopify-topic': 'app_subscriptions/update', 'x-shopify-shop-domain': 'hook-a.myshopify.com', 'x-shopify-webhook-id': 'wh-bad', 'x-shopify-hmac-sha256': hmacBase64('wrong', '{}') },
      payload: '{}',
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('shop billing settings helpers', () => {
  it('legacy usage records read EUR for pre-#6 shops and refuse a non-EUR currency without a rate', () => {
    expect(shopBillingCurrency({})).toEqual({ currencyCode: 'EUR', eurRate: 1 });
    expect(shopBillingCurrency({ billingCurrency: 'AUD', billingEurRate: 1.78 } as never)).toEqual({ currencyCode: 'AUD', eurRate: 1.78 });
    expect(() => shopBillingCurrency({ billingCurrency: 'AUD' } as never)).toThrow(/no stored EUR rate/);
    expect(billingSettingsPatch({ currencyCode: 'AUD', usdRate: 1.53, price: 13.8 })).toEqual({ billingCurrency: 'AUD', billingUsdRate: 1.53, billingPrice: 13.8 });
  });

  it('the api env defaults to the one pinned Admin API version (#4)', () => {
    expect(testEnv().SHOPIFY_API_VERSION).toBe(DEFAULT_API_VERSION);
    expect(DEFAULT_API_VERSION).toBe('2026-10');
  });
});
