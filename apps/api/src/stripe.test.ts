import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StripeClient } from './billing/stripe.js';
import { shops } from './db/schema.js';
import { testEnv } from './env.js';
import { json, makeApp, type TestApp } from './test/helpers.js';

describe('Stripe (WooCommerce billing)', () => {
  let t: TestApp;
  beforeAll(async () => {
    // A leftover metered price in the env must not reach Checkout (D17: no meter).
    t = await makeApp({ STRIPE_SECRET: ('sk_' + 'test_stripe_123'), STRIPE_PRICE_CURTAIN: 'price_curtain', STRIPE_PRICE_OVERAGE: 'price_overage', STRIPE_WEBHOOK_SECRET: ('whsec' + '_test_123') });
    t.fetchMock.on('https://api.stripe.com/v1/checkout/sessions', async (_u, init) => {
      const params = new URLSearchParams(String(init?.body));
      expect(params.get('mode')).toBe('subscription');
      expect(params.get('line_items[0][price]')).toBe('price_curtain');
      expect(params.get('line_items[0][quantity]')).toBe('1');
      expect([...params.keys()].filter((k) => k.startsWith('line_items[1]'))).toEqual([]);
      expect(params.get('subscription_data[trial_period_days]')).toBe('7');
      expect(params.get('subscription_data[metadata][plan]')).toBe('curtain');
      return json({ id: 'cs_test_1', url: `https://checkout.stripe.com/c/pay/cs_test_1?shop=${params.get('metadata[shopId]')}` });
    });
  });
  afterAll(async () => {
    await t.close();
  });

  it('connect → checkout → webhook completes → keys issued; subscription lifecycle gates the plan', async () => {
    const connect = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl: 'https://woo.example', name: 'Woo Shop', email: 'owner@woo.example' } });
    expect(connect.statusCode).toBe(200);
    const { shopId, connectToken, mode, checkoutUrl, verification } = connect.json<{ shopId: string; connectToken: string; mode: string; checkoutUrl: string; verification: { nonce: string } }>();
    expect(mode).toBe('stripe');
    expect(checkoutUrl).toContain('checkout.stripe.com');
    // SEC-1: the Stripe path proves the domain too; the plugin publishes this nonce like in manual mode.
    t.fetchMock.on('https://woo.example/wp-json/curtain/v1/verify', () => json({ nonce: verification.nonce }));

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
    expect(shop).toMatchObject({ plan: 'curtain', paused: false, connectState: 'paid', billingRef: 'sub_1' });
    expect(shop?.settings.stripeCustomerId).toBe('cus_1');

    const complete = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken } });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().plan).toBe('curtain');
    const key = complete.json<{ apiKey: string }>().apiKey;
    const usage = await t.app.inject({ method: 'GET', url: '/v1/merchant/usage?from=2026-11-01&to=2026-11-04', headers: { authorization: `Bearer ${key}` } });
    expect(usage.json().plan).toMatchObject({ name: 'curtain', priceUsdPerMonth: 8.99, overageEurPerSession: 0 });

    expect((await post(event('customer.subscription.updated', { id: 'sub_1', status: 'past_due', metadata: { shopId } }))).statusCode).toBe(200);
    shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop).toMatchObject({ plan: 'free', paused: true });
    await post(event('customer.subscription.updated', { id: 'sub_1', status: 'active', metadata: { shopId } }));
    shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop).toMatchObject({ plan: 'curtain', paused: false });
    // an older subscription ending never pauses the shop's current one
    await post(event('customer.subscription.deleted', { id: 'sub_old', status: 'canceled', metadata: { shopId } }));
    await post(event('customer.subscription.updated', { id: 'sub_old', status: 'past_due', metadata: { shopId } }));
    shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop).toMatchObject({ plan: 'curtain', paused: false, billingRef: 'sub_1' });
    await post(event('customer.subscription.deleted', { id: 'sub_1', status: 'canceled', metadata: { shopId } }));
    shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop).toMatchObject({ plan: 'free', paused: true });
    expect((await post(event('invoice.paid', { metadata: { shopId } }))).statusCode).toBe(200);
  });

  it('SEC-1: a paid (trial) Checkout without the domain proof gets no keys: 403 domain_unverified', async () => {
    const connect = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl: 'https://victim-shop.example/', name: 'Not mine' } });
    expect(connect.statusCode).toBe(200);
    const { shopId, connectToken, mode } = connect.json<{ shopId: string; connectToken: string; mode: string }>();
    expect(mode).toBe('stripe');
    const body = JSON.stringify({ id: 'evt_sec1', type: 'checkout.session.completed', created: Math.floor(Date.now() / 1000), data: { object: { id: 'cs_test_2', customer: 'cus_2', subscription: 'sub_2', metadata: { shopId } } } });
    const paid = await t.app.inject({ method: 'POST', url: '/v1/billing/stripe/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': t.app.ctx.stripe.sign(body) }, payload: body });
    expect(paid.statusCode).toBe(200);
    expect((await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) }))?.connectState).toBe('paid');
    // The real site does not publish the attacker's nonce.
    t.fetchMock.on('https://victim-shop.example/wp-json/curtain/v1/verify', () => json({ error: { code: 'not_found' } }, 404));
    const complete = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken } });
    expect(complete.statusCode).toBe(403);
    expect(complete.json().error.code).toBe('domain_unverified');
    const shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.id, shopId) });
    expect(shop?.connectState).toBe('paid');
    expect(shop?.apiKeyPrefix ?? null).toBeNull();
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

describe('Stripe Checkout parameters for the one Curtain plan (D17)', () => {
  const base = { shopId: 'shop-1', shopDomain: 'woo.example', successUrl: 'https://woo.example/ok', cancelUrl: 'https://woo.example/no' };

  it('one licensed price, quantity 1, configurable trial, no metered line', () => {
    const c = new StripeClient(testEnv({ STRIPE_SECRET: 'sk_' + 'test_1', STRIPE_PRICE_CURTAIN: 'price_curtain', STRIPE_PRICE_OVERAGE: 'price_meter', BILLING_TRIAL_DAYS: '14' }), fetch);
    const p = Object.fromEntries(c.checkoutParams({ ...base, email: 'o@woo.example' }));
    expect(p).toEqual({
      mode: 'subscription',
      success_url: base.successUrl,
      cancel_url: base.cancelUrl,
      'line_items[0][price]': 'price_curtain',
      'line_items[0][quantity]': '1',
      'metadata[shopId]': 'shop-1',
      'metadata[shopDomain]': 'woo.example',
      'metadata[plan]': 'curtain',
      'subscription_data[metadata][shopId]': 'shop-1',
      'subscription_data[metadata][plan]': 'curtain',
      'subscription_data[trial_period_days]': '14',
      client_reference_id: 'shop-1',
      customer_email: 'o@woo.example',
    });
  });

  it('a zero trial sends no trial parameter; the legacy STRIPE_PRICE_STARTER name still works; no price → not configured', () => {
    const legacy = new StripeClient(testEnv({ STRIPE_SECRET: 'sk_' + 'test_1', STRIPE_PRICE_STARTER: 'price_old_name', BILLING_TRIAL_DAYS: '0' }), fetch);
    expect(legacy.configured()).toBe(true);
    const p = legacy.checkoutParams(base);
    expect(p.get('line_items[0][price]')).toBe('price_old_name');
    expect(p.has('subscription_data[trial_period_days]')).toBe(false);
    expect(new StripeClient(testEnv({ STRIPE_SECRET: 'sk_' + 'test_1' }), fetch).configured()).toBe(false);
    expect(testEnv().BILLING_TRIAL_DAYS).toBe(7);
  });
});

