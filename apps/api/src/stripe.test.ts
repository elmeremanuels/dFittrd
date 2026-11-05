import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shops } from './db/schema.js';
import { json, makeApp, type TestApp } from './test/helpers.js';

describe('Stripe (WooCommerce billing)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ STRIPE_SECRET: ('sk_' + 'test_stripe_123'), STRIPE_PRICE_STARTER: 'price_starter', STRIPE_PRICE_OVERAGE: 'price_overage', STRIPE_WEBHOOK_SECRET: ('whsec' + '_test_123') });
    t.fetchMock.on('https://api.stripe.com/v1/checkout/sessions', async (_u, init) => {
      const params = new URLSearchParams(String(init?.body));
      expect(params.get('mode')).toBe('subscription');
      expect(params.get('line_items[0][price]')).toBe('price_starter');
      expect(params.get('line_items[1][price]')).toBe('price_overage');
      return json({ id: 'cs_test_1', url: `https://checkout.stripe.com/c/pay/cs_test_1?shop=${params.get('metadata[shopId]')}` });
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it('connect → checkout → webhook completes → keys issued; subscription lifecycle gates the plan', async () => {
    const connect = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl: 'https://woo.example', name: 'Woo Shop', email: 'owner@woo.example' } });
    expect(connect.statusCode).toBe(200);
    const { shopId, connectToken, mode, checkoutUrl } = connect.json<{ shopId: string; connectToken: string; mode: string; checkoutUrl: string }>();
    expect(mode).toBe('stripe');
    expect(checkoutUrl).toContain('checkout.stripe.com');

    const early = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken } });
    expect(early.statusCode).toBe(503);
    expect(early.json().error.code).toBe('payment_pending');

    const event = (type: string, object: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) => JSON.stringify({ id, type, created: Math.floor(Date.now() / 1000), data: { object } });
    const post = (body: string, sig = t.app.ctx.stripe.sign(body)) =>
      t.app.inject({ method: 'POST', url: '/v1/billing/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': sig }, payload: body });

    const bad = await post(event('checkout.session.completed', { metadata: { shopId } }), 't=1,v1=deadbeef');
    expect(bad.statusCode).toBe(401);
    const stale = event('checkout.session.completed', { metadata: { shopId } });
    expect((await post(stale, t.app.ctx.stripe.sign(stale, Date.now() - 10 * 60_000))).statusCode).toBe(401);

    const completed = event('checkout.session.completed', { id: 'cs_test_1', customer: 'cus_1', subscription: 'sub_1', metadata: { shopId } }, 'evt_fixed');
    expect((await post(completed)).statusCode).toBe(200);
    expect((await post(completed)).json()).toEqual({ ok: true, duplicate: true });
    let shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop).toMatchObject({ plan: 'starter', paused: false, connectState: 'paid', billingRef: 'sub_1' });
    expect(shop?.settings.stripeCustomerId).toBe('cus_1');

    const complete = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken } });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().plan).toBe('starter');
    const key = complete.json<{ apiKey: string }>().apiKey;
    const usage = await t.app.inject({ method: 'GET', url: '/v1/merchant/usage?from=2026-11-01&to=2026-11-04', headers: { authorization: `Bearer ${key}` } });
    expect(usage.json().plan.name).toBe('starter');

    expect((await post(event('customer.subscription.updated', { id: 'sub_1', status: 'past_due', metadata: { shopId } }))).statusCode).toBe(200);
    shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop).toMatchObject({ plan: 'free', paused: true });
    await post(event('customer.subscription.updated', { id: 'sub_1', status: 'active', metadata: { shopId } }));
    shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop).toMatchObject({ plan: 'starter', paused: false });
    await post(event('customer.subscription.deleted', { id: 'sub_1', status: 'canceled', metadata: { shopId } }));
    shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop).toMatchObject({ plan: 'free', paused: true });
    expect((await post(event('invoice.paid', { metadata: { shopId } }))).statusCode).toBe(200);
  });

  it('is skipped gracefully when Stripe is not configured', async () => {
    const t2 = await makeApp();
    try {
      const res = await t2.app.inject({ method: 'POST', url: '/v1/billing/stripe/webhook', headers: { 'stripe-signature': 't=1,v1=x' }, payload: {} });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ ok: false, ignored: true });
    } finally {
      await t2.close();
    }
  });
});
