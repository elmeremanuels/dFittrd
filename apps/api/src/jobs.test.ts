import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usageDaily } from './db/schema.js';
import { makeUsageRollupHandler } from './jobs/maintenance.js';
import { recordUsage } from './services/usage.js';
import { updateSettings } from './services/shops.js';
import { json, makeApp, seedShop, type TestApp } from './test/helpers.js';

describe('nightly usage rollup (D7)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ STRIPE_SECRET: 'sk_test_x', STRIPE_PRICE_STARTER: 'price_1' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('pushes only sessions above the included quota to Shopify, idempotently', async () => {
    const { shop } = await seedShop(t, { platform: 'shopify', domain: 'roll.myshopify.com', plan: 'starter', products: ['aalter-studio-1'] });
    await updateSettings(t.handle.db, shop.id, { usageLineItemId: 'gid://shopify/AppSubscriptionLineItem/1', includedSessions: 3 }, { periodStart: '2026-11-01' });
    await t.app.ctx.shopify.saveOfflineSession(shop.id, shop.domain, 'shpat_x', 'read_products');
    const day = '2026-11-03';
    for (let i = 0; i < 5; i++) {
      await recordUsage(t.handle.db, { shopId: shop.id, kind: 'fit_session', idempotencyKey: `t:${i}`, at: new Date(`${day}T1${i}:00:00Z`) });
    }
    let usageMutations = 0;
    t.fetchMock.on('https://roll.myshopify.com/admin/api/', async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { query: string; variables: { price: { amount: number }; idempotencyKey: string; description: string } };
      expect(q.query).toContain('appUsageRecordCreate');
      expect(q.variables.price.amount).toBeCloseTo(2 * 0.05, 5);
      expect(q.variables.idempotencyKey).toBe(`${shop.id}:${day}`);
      usageMutations++;
      return json({ data: { appUsageRecordCreate: { userErrors: [], appUsageRecord: { id: 'gid://shopify/AppUsageRecord/1' } } } });
    });
    const run = makeUsageRollupHandler(t.app);
    expect(await run({ day })).toEqual({ pushed: 1, skipped: 0, errors: 0 });
    expect(usageMutations).toBe(1);
    const row = await t.handle.db.query.usageDaily.findFirst({ where: eq(usageDaily.shopId, shop.id) });
    expect(row).toMatchObject({ day, fitSessions: 5, pushedSessions: 2 });
    expect(row?.pushedAt).not.toBeNull();
    expect(await run({ day })).toEqual({ pushed: 0, skipped: 0, errors: 0 });
  });

  it('free plans and days within quota are marked pushed with nothing billed; Stripe meter events for Woo', async () => {
    const free = await seedShop(t, { platform: 'woocommerce', domain: 'free.example', plan: 'free', products: ['aalter-studio-1'] });
    await recordUsage(t.handle.db, { shopId: free.shop.id, kind: 'fit_session', idempotencyKey: 'f:1', at: new Date('2026-11-02T10:00:00Z') });
    const paid = await seedShop(t, { platform: 'woocommerce', domain: 'paid.example', plan: 'starter', products: ['aalter-studio-1'] });
    await updateSettings(t.handle.db, paid.shop.id, { stripeCustomerId: 'cus_9', includedSessions: 0 }, { periodStart: '2026-11-01' });
    await recordUsage(t.handle.db, { shopId: paid.shop.id, kind: 'fit_session', idempotencyKey: 'p:1', at: new Date('2026-11-02T10:00:00Z') });
    let meter = 0;
    t.fetchMock.on('https://api.stripe.com/v1/billing/meter_events', async (_u, init) => {
      const p = new URLSearchParams(String(init?.body));
      expect(p.get('payload[stripe_customer_id]')).toBe('cus_9');
      expect(p.get('payload[value]')).toBe('1');
      meter++;
      return json({ object: 'billing.meter_event' });
    });
    const r = await makeUsageRollupHandler(t.app)({ day: '2026-11-02' });
    expect(r).toEqual({ pushed: 1, skipped: 1, errors: 0 });
    expect(meter).toBe(1);
  });
});
