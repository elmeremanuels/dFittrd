import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usageDaily } from './db/schema.js';
import { makeUsageRollupHandler } from './jobs/maintenance.js';
import { recordUsage } from './services/usage.js';
import { updateSettings } from './services/shops.js';
import { json, makeApp, seedShop, type TestApp } from './test/helpers.js';

describe('nightly usage rollup under D17: sessions counted, nothing billed', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ STRIPE_SECRET: 'sk_' + 'test_x', STRIPE_PRICE_CURTAIN: 'price_1' });
  });
  afterAll(async () => {
    await t.close();
  });

  it('a Curtain shop far above its fair-use reference gets no usage record, even with a stale usage line and overage override', async () => {
    const { shop } = await seedShop(t, { platform: 'shopify', domain: 'roll.myshopify.com', plan: 'curtain', products: ['aalter-studio-1'] });
    await updateSettings(t.handle.db, shop.id, { usageLineItemId: 'gid://shopify/AppSubscriptionLineItem/1', includedSessions: 3, overageEurPerSession: 0.05 }, { periodStart: '2026-11-01' });
    await t.app.ctx.shopify.saveOfflineSession(shop.id, shop.domain, 'shp' + 'at_x', 'read_products');
    const day = '2026-11-03';
    for (let i = 0; i < 5; i++) {
      await recordUsage(t.handle.db, { shopId: shop.id, kind: 'fit_session', idempotencyKey: `t:${i}`, at: new Date(`${day}T1${i}:00:00Z`) });
    }
    let adminCalls = 0;
    t.fetchMock.on('https://roll.myshopify.com/admin/api/', async () => {
      adminCalls++;
      return json({ data: {} });
    });
    const run = makeUsageRollupHandler(t.app);
    expect(await run({ day })).toEqual({ pushed: 0, skipped: 1, errors: 0 });
    expect(adminCalls).toBe(0);
    const row = await t.handle.db.query.usageDaily.findFirst({ where: eq(usageDaily.shopId, shop.id) });
    // still counted for analytics, marked done with nothing pushed
    expect(row).toMatchObject({ day, fitSessions: 5, pushedSessions: 0 });
    expect(row?.pushedAt).not.toBeNull();
  });

  it('WooCommerce: no Stripe meter event on any plan', async () => {
    const free = await seedShop(t, { platform: 'woocommerce', domain: 'free.example', plan: 'free', products: ['aalter-studio-1'] });
    await recordUsage(t.handle.db, { shopId: free.shop.id, kind: 'fit_session', idempotencyKey: 'f:1', at: new Date('2026-11-02T10:00:00Z') });
    const paid = await seedShop(t, { platform: 'woocommerce', domain: 'paid.example', plan: 'curtain', products: ['aalter-studio-1'] });
    await updateSettings(t.handle.db, paid.shop.id, { stripeCustomerId: 'cus_9', includedSessions: 0 }, { periodStart: '2026-11-01' });
    await recordUsage(t.handle.db, { shopId: paid.shop.id, kind: 'fit_session', idempotencyKey: 'p:1', at: new Date('2026-11-02T10:00:00Z') });
    let meter = 0;
    t.fetchMock.on('https://api.stripe.com/v1/billing/meter_events', async () => {
      meter++;
      return json({ object: 'billing.meter_event' });
    });
    const r = await makeUsageRollupHandler(t.app)({ day: '2026-11-02' });
    expect(r).toEqual({ pushed: 0, skipped: 2, errors: 0 });
    expect(meter).toBe(0);
  });
});
