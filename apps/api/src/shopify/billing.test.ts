import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_API_VERSION, DEFAULT_EUR_RATES } from '@curtain/shopify-app';
import { shops, usageDaily } from '../db/schema.js';
import { testEnv } from '../env.js';
import { makeUsageRollupHandler } from '../jobs/maintenance.js';
import { recordUsage } from '../services/usage.js';
import { updateSettings } from '../services/shops.js';
import { json, makeApp, seedShop, type TestApp } from '../test/helpers.js';
import { billingSettingsPatch, shopBillingCurrency, type ShopifyBillingSettings } from './client.js';

const API_KEY = 'shpa_billingkey';
const API_SECRET = 'shpss' + '_test_billing_0123456789';

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

/** Mock Admin API for one shop: billing currency + appSubscriptionCreate + appUsageRecordCreate. */
function mockAdmin(t: TestApp, shop: string, billingCurrency: string | null, seen: Gql[]) {
  t.fetchMock.on(`https://${shop}/admin/api/`, async (url, init) => {
    expect(url).toBe(`https://${shop}/admin/api/${DEFAULT_API_VERSION}/graphql.json`);
    const q = JSON.parse(String(init?.body)) as Gql;
    seen.push(q);
    if (q.query.includes('shopBillingPreferences')) return json({ data: { shopBillingPreferences: billingCurrency ? { currency: billingCurrency } : null, shop: { currencyCode: 'EUR' } } });
    if (q.query.includes('appSubscriptionCreate')) {
      return json({
        data: {
          appSubscriptionCreate: {
            userErrors: [],
            confirmationUrl: `https://${shop}/admin/charges/1/confirm`,
            appSubscription: {
              id: 'gid://shopify/AppSubscription/1',
              status: 'PENDING',
              lineItems: [
                { id: 'gid://shopify/AppSubscriptionLineItem/1', plan: { pricingDetails: { __typename: 'AppRecurringPricing' } } },
                { id: 'gid://shopify/AppSubscriptionLineItem/2', plan: { pricingDetails: { __typename: 'AppUsagePricing' } } },
              ],
            },
          },
        },
      });
    }
    if (q.query.includes('appUsageRecordCreate')) return json({ data: { appUsageRecordCreate: { userErrors: [], appUsageRecord: { id: 'gid://shopify/AppUsageRecord/1' } } } });
    return json({ errors: [{ message: 'unexpected query' }] }, 400);
  });
}

describe('Shopify billing in the shop billing currency (#6)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
  });
  afterAll(async () => {
    await t.close();
  });

  async function installed(domain: string) {
    const { shop } = await seedShop(t, { platform: 'shopify', domain, plan: 'free', products: ['aalter-studio-1'] });
    await t.app.ctx.shopify.saveOfflineSession(shop.id, domain, 'shpat' + '_billing_x', 'read_products,write_products');
    return shop;
  }

  async function subscribe(domain: string) {
    return t.app.inject({ method: 'POST', url: '/shopify/billing/subscribe', headers: { authorization: `Bearer ${await sessionToken(domain)}` }, payload: { plan: 'starter', test: true } });
  }

  it('AUD pilot shop: subscription, terms and cap in AUD; currency + rate stored; usage records in AUD', async () => {
    const domain = 'aud-pilot.myshopify.com';
    const shop = await installed(domain);
    const seen: Gql[] = [];
    mockAdmin(t, domain, 'AUD', seen);

    const res = await subscribe(domain);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ confirmationUrl: `https://${domain}/admin/charges/1/confirm`, subscriptionId: 'gid://shopify/AppSubscription/1', currency: 'AUD' });

    const sub = seen.find((q) => q.query.includes('appSubscriptionCreate'))!;
    const rate = DEFAULT_EUR_RATES.AUD!;
    expect(sub.variables.lineItems).toEqual([
      { plan: { appRecurringPricingDetails: { price: { amount: Math.round(29 * rate), currencyCode: 'AUD' }, interval: 'EVERY_30_DAYS' } } },
      { plan: { appUsagePricingDetails: { cappedAmount: { amount: Math.round(100 * rate), currencyCode: 'AUD' }, terms: `A$${(Math.round(0.05 * rate * 100) / 100).toFixed(2)} per try-on session above 500 per month` } } },
    ]);
    expect(JSON.stringify(sub.variables)).not.toContain('EUR');

    const stored = (await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) }))!;
    expect(stored.settings as ShopifyBillingSettings).toMatchObject({ billingCurrency: 'AUD', billingEurRate: rate });
    expect(stored.settings.usageLineItemId).toBe('gid://shopify/AppSubscriptionLineItem/2');
    expect(stored).toMatchObject({ plan: 'starter', billingRef: 'gid://shopify/AppSubscription/1' });

    // nightly rollup: 2 sessions above the quota → €0.10 → AUD at the stored rate
    await updateSettings(t.handle.db, shop.id, { includedSessions: 3 }, { periodStart: '2026-11-01' });
    const day = '2026-11-03';
    for (let i = 0; i < 5; i++) await recordUsage(t.handle.db, { shopId: shop.id, kind: 'fit_session', idempotencyKey: `aud:${i}`, at: new Date(`${day}T1${i}:00:00Z`) });
    // a later change of the rate table must not change a running subscription
    await updateSettings(t.handle.db, shop.id, billingSettingsPatch({ currencyCode: 'AUD', eurRate: 1.5 }));
    expect(await makeUsageRollupHandler(t.app)({ day })).toEqual({ pushed: 1, skipped: 0, errors: 0 });
    const usage = seen.find((q) => q.query.includes('appUsageRecordCreate'))!;
    expect(usage.variables.price).toEqual({ amount: 0.15, currencyCode: 'AUD' });
    expect(await t.handle.db.query.usageDaily.findFirst({ where: eq(usageDaily.shopId, shop.id) })).toMatchObject({ pushedSessions: 2 });
  });

  it('EUR shop: unchanged EUR prices, EUR stored, usage in EUR', async () => {
    const domain = 'eur-shop.myshopify.com';
    const shop = await installed(domain);
    const seen: Gql[] = [];
    mockAdmin(t, domain, 'EUR', seen);
    const res = await subscribe(domain);
    expect(res.json()).toMatchObject({ currency: 'EUR' });
    const sub = seen.find((q) => q.query.includes('appSubscriptionCreate'))!;
    expect(sub.variables.lineItems).toEqual([
      { plan: { appRecurringPricingDetails: { price: { amount: 29, currencyCode: 'EUR' }, interval: 'EVERY_30_DAYS' } } },
      { plan: { appUsagePricingDetails: { cappedAmount: { amount: 100, currencyCode: 'EUR' }, terms: '€0.05 per try-on session above 500 per month' } } },
    ]);
    const stored = (await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shop.id) }))!;
    expect(stored.settings as ShopifyBillingSettings).toMatchObject({ billingCurrency: 'EUR', billingEurRate: 1 });

    const id = await t.app.ctx.shopify.appUsageRecordCreate(domain, 'shpat' + '_billing_x', { lineItemId: 'li', description: 'd', amountEur: 1.234, idempotencyKey: 'k1' });
    expect(id).toBe('gid://shopify/AppUsageRecord/1');
    expect(seen.at(-1)!.variables.price).toEqual({ amount: 1.23, currencyCode: 'EUR' });
  });

  it('a billing currency without a rate is charged in USD (Shopify converts USD charges)', async () => {
    const domain = 'xyz-shop.myshopify.com';
    await installed(domain);
    const seen: Gql[] = [];
    mockAdmin(t, domain, 'XYZ', seen);
    const res = await subscribe(domain);
    expect(res.json()).toMatchObject({ currency: 'USD' });
    const sub = seen.find((q) => q.query.includes('appSubscriptionCreate'))!;
    expect(JSON.stringify(sub.variables.lineItems)).toContain('"currencyCode":"USD"');
  });

  it('a reached cap throws so the rollup keeps the day unpushed', async () => {
    const domain = 'cap-shop.myshopify.com';
    await installed(domain);
    t.fetchMock.on(`https://${domain}/admin/api/`, async () =>
      json({ data: { appUsageRecordCreate: { userErrors: [{ message: 'Total price exceeds balance remaining before capped amount' }], appUsageRecord: null } } }),
    );
    await expect(t.app.ctx.shopify.appUsageRecordCreate(domain, 'tok', { lineItemId: 'li', description: 'd', amountEur: 1, idempotencyKey: 'k' })).rejects.toThrow(/capped amount/);
  });
});

describe('shop billing settings helpers', () => {
  it('reads EUR for shops subscribed before #6 and refuses a non-EUR currency without a rate', () => {
    expect(shopBillingCurrency({})).toEqual({ currencyCode: 'EUR', eurRate: 1 });
    expect(shopBillingCurrency(billingSettingsPatch({ currencyCode: 'AUD', eurRate: 1.78 }))).toEqual({ currencyCode: 'AUD', eurRate: 1.78 });
    expect(() => shopBillingCurrency({ billingCurrency: 'AUD' } as never)).toThrow(/no stored EUR rate/);
  });

  it('the api env defaults to the one pinned Admin API version (#4)', () => {
    expect(testEnv().SHOPIFY_API_VERSION).toBe(DEFAULT_API_VERSION);
    expect(DEFAULT_API_VERSION).toBe('2026-10');
  });
});
