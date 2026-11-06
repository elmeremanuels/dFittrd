import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN, SHOP, fetchMock } from '../test/fixtures';
import { DEFAULT_EUR_RATES } from '../currency';
import {
  cancelAppSubscription,
  createAppSubscription,
  createUsageRecord,
  CURTAIN_PLAN,
  getActiveSubscriptions,
  isDevelopmentStore,
  planPrice,
  planPriceLabel,
  resolveUsdChargeCurrency,
  usageIdempotencyKey,
  usdCrossRate,
  type SubscriptionPlanInput,
} from './billing';
import { createAdminClient } from './client';

const client = (m: ReturnType<typeof fetchMock>) => createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });

const curtain: SubscriptionPlanInput = {
  name: CURTAIN_PLAN.name,
  returnUrl: 'https://admin.shopify.com/store/aalter-studio/apps/curtain',
  priceUsdPerMonth: CURTAIN_PLAN.priceUsdPerMonth,
  trialDays: 7,
  test: true,
};

describe('appSubscriptionCreate (D17: one flat plan)', () => {
  it('sends exactly one recurring USD line, no usage line and no cappedAmount', async () => {
    const m = fetchMock().data({
      appSubscriptionCreate: {
        userErrors: [],
        confirmationUrl: 'https://aalter-studio.myshopify.com/admin/charges/1/confirm',
        appSubscription: {
          id: 'gid://shopify/AppSubscription/1',
          status: 'PENDING',
          lineItems: [{ id: 'gid://shopify/AppSubscriptionLineItem/1?v=1', plan: { pricingDetails: { __typename: 'AppRecurringPricing' } } }],
        },
      },
    });
    const r = await createAppSubscription(client(m), curtain);
    expect(r).toEqual({
      confirmationUrl: 'https://aalter-studio.myshopify.com/admin/charges/1/confirm',
      subscriptionId: 'gid://shopify/AppSubscription/1',
      status: 'PENDING',
      recurringLineItemId: 'gid://shopify/AppSubscriptionLineItem/1?v=1',
      currencyCode: 'USD',
      usdRate: 1,
      price: 8.99,
    });
    const v = m.variables<{ name: string; test: boolean; trialDays: number; returnUrl: string; lineItems: unknown[] }>();
    expect(v).toMatchObject({ name: 'Curtain', test: true, trialDays: 7, returnUrl: curtain.returnUrl });
    expect(v.lineItems).toEqual([{ plan: { appRecurringPricingDetails: { price: { amount: 8.99, currencyCode: 'USD' }, interval: 'EVERY_30_DAYS' } } }]);
    expect(JSON.stringify(v)).not.toMatch(/appUsagePricingDetails|cappedAmount/);
  });

  it('charges an AUD shop the converted price through the rate table, with the rate returned (D17)', async () => {
    const m = fetchMock().data({
      appSubscriptionCreate: {
        userErrors: [],
        confirmationUrl: 'https://aalter-studio.myshopify.com/admin/charges/2/confirm',
        appSubscription: { id: 'gid://shopify/AppSubscription/2', status: 'PENDING', lineItems: [{ id: 'li-1', plan: { pricingDetails: { __typename: 'AppRecurringPricing' } } }] },
      },
    });
    const aud = resolveUsdChargeCurrency('AUD');
    expect(aud).toEqual({ currencyCode: 'AUD', usdRate: 1.534483, fallback: false });
    const r = await createAppSubscription(client(m), { ...curtain, currencyCode: aud.currencyCode, usdRate: aud.usdRate });
    expect(r).toMatchObject({ subscriptionId: 'gid://shopify/AppSubscription/2', currencyCode: 'AUD', usdRate: 1.534483, price: 13.8 });
    expect(m.variables<{ lineItems: unknown[] }>().lineItems).toEqual([{ plan: { appRecurringPricingDetails: { price: { amount: 13.8, currencyCode: 'AUD' }, interval: 'EVERY_30_DAYS' } } }]);
    expect(planPriceLabel({ priceUsdPerMonth: 8.99, currencyCode: 'AUD', usdRate: aud.usdRate })).toBe('A$13.80 per month');
    expect(planPriceLabel({ priceUsdPerMonth: 8.99 })).toBe('$8.99 per month');
  });

  it('resolves the charge currency: USD itself, table currencies converted, unknown ones fall back to USD', () => {
    expect(resolveUsdChargeCurrency('USD')).toEqual({ currencyCode: 'USD', usdRate: 1, fallback: false });
    expect(resolveUsdChargeCurrency('XYZ')).toEqual({ currencyCode: 'USD', usdRate: 1, fallback: true });
    expect(resolveUsdChargeCurrency(null)).toEqual({ currencyCode: 'USD', usdRate: 1, fallback: true });
    expect(resolveUsdChargeCurrency('EUR')).toEqual({ currencyCode: 'EUR', usdRate: Math.round((1 / DEFAULT_EUR_RATES.USD!) * 1e6) / 1e6, fallback: false });
    // JPY has no minor unit
    const jpy = resolveUsdChargeCurrency('JPY');
    expect(planPrice({ priceUsdPerMonth: 8.99, ...jpy })).toEqual({ currencyCode: 'JPY', usdRate: jpy.usdRate, price: 1356 });
    expect(usdCrossRate('AUD', { ...DEFAULT_EUR_RATES, USD: 1, AUD: 1.5 })).toBe(1.5);
    expect(() => planPrice({ priceUsdPerMonth: 8.99, currencyCode: 'XYZ' })).toThrow(/no USD rate/);
    expect(() => planPrice({ priceUsdPerMonth: 8.99, currencyCode: 'USD', usdRate: 2 })).toThrow(/rate 1/);
  });

  it('rejects bad inputs locally and userErrors remotely', async () => {
    await expect(createAppSubscription(client(fetchMock()), { ...curtain, priceUsdPerMonth: 0 })).rejects.toThrow(/priceUsdPerMonth/);
    await expect(createAppSubscription(client(fetchMock()), { ...curtain, trialDays: -1 })).rejects.toThrow(/trialDays/);
    await expect(createAppSubscription(client(fetchMock()), { ...curtain, trialDays: 2.5 })).rejects.toThrow(/trialDays/);
    const m = fetchMock().data({ appSubscriptionCreate: { userErrors: [{ field: ['returnUrl'], message: 'Return url is invalid' }], confirmationUrl: null, appSubscription: null } });
    await expect(createAppSubscription(client(m), curtain)).rejects.toThrow(/appSubscriptionCreate: returnUrl: Return url is invalid/);
  });

  it('detects partner development stores (test charges only)', async () => {
    const dev = fetchMock().data({ shop: { plan: { partnerDevelopment: true } } });
    expect(await isDevelopmentStore(client(dev))).toBe(true);
    expect(dev.query()).toContain('partnerDevelopment');
    expect(await isDevelopmentStore(client(fetchMock().data({ shop: { plan: { partnerDevelopment: false } } })))).toBe(false);
  });
});

describe('appUsageRecordCreate (legacy pre-D17 subscriptions only)', () => {
  it('posts one record with the idempotency key and rounded EUR amount', async () => {
    const m = fetchMock().data({ appUsageRecordCreate: { userErrors: [], appUsageRecord: { id: 'gid://shopify/AppUsageRecord/9' } } });
    const key = usageIdempotencyKey('shop-uuid', 'intent-token-abc');
    const r = await createUsageRecord(client(m), { lineItemId: 'gid://shopify/AppSubscriptionLineItem/2', description: '1 try-on session', amountEur: 0.049999, idempotencyKey: key });
    expect(r).toEqual({ id: 'gid://shopify/AppUsageRecord/9', capReached: false });
    expect(m.variables()).toEqual({
      subscriptionLineItemId: 'gid://shopify/AppSubscriptionLineItem/2',
      description: '1 try-on session',
      price: { amount: 0.05, currencyCode: 'EUR' },
      idempotencyKey: 'curtain:shop-uuid:intent-token-abc',
    });
  });

  it("uses the subscription's currency and rate: an AUD daily total is converted, JPY has no decimals (#6)", async () => {
    const m = fetchMock().data({ appUsageRecordCreate: { userErrors: [], appUsageRecord: { id: 'gid://shopify/AppUsageRecord/10' } } });
    await createUsageRecord(client(m), { lineItemId: 'li', description: '7 sessions', amountEur: 0.35, idempotencyKey: 'k', currencyCode: 'AUD', eurRate: 1.78 });
    expect(m.variables<{ price: unknown }>().price).toEqual({ amount: 0.62, currencyCode: 'AUD' });
    const j = fetchMock().data({ appUsageRecordCreate: { userErrors: [], appUsageRecord: { id: 'gid://shopify/AppUsageRecord/11' } } });
    await createUsageRecord(client(j), { lineItemId: 'li', description: '7 sessions', amountEur: 0.35, idempotencyKey: 'k', currencyCode: 'JPY', eurRate: 175 });
    expect(j.variables<{ price: unknown }>().price).toEqual({ amount: 61, currencyCode: 'JPY' });
  });

  it('reports a reached cap instead of throwing', async () => {
    const m = fetchMock().data({ appUsageRecordCreate: { userErrors: [{ message: 'Total price exceeds balance remaining before capped amount' }], appUsageRecord: null } });
    const r = await createUsageRecord(client(m), { lineItemId: 'x', description: 'd', amountEur: 0.05, idempotencyKey: 'k' });
    expect(r).toEqual({ id: null, capReached: true });
    const other = fetchMock().data({ appUsageRecordCreate: { userErrors: [{ message: 'Subscription line item not found' }], appUsageRecord: null } });
    await expect(createUsageRecord(client(other), { lineItemId: 'x', description: 'd', amountEur: 0.05, idempotencyKey: 'k' })).rejects.toThrow(/not found/);
  });

  it('idempotency keys are bounded', () => {
    expect(usageIdempotencyKey('s', 'x'.repeat(400))).toHaveLength(255);
  });
});

describe('subscription status', () => {
  it('maps active subscriptions: recurring price and currency, legacy usage line id', async () => {
    const m = fetchMock().data({
      currentAppInstallation: {
        activeSubscriptions: [
          {
            id: 'gid://shopify/AppSubscription/1',
            name: 'Curtain Starter',
            status: 'ACTIVE',
            test: true,
            trialDays: 14,
            currentPeriodEnd: '2026-12-04T00:00:00Z',
            lineItems: [
              { id: 'li1', plan: { pricingDetails: { __typename: 'AppRecurringPricing', price: { amount: '29.0', currencyCode: 'EUR' }, interval: 'EVERY_30_DAYS' } } },
              { id: 'li2', plan: { pricingDetails: { __typename: 'AppUsagePricing', terms: 't', cappedAmount: { amount: '100.0', currencyCode: 'EUR' }, balanceUsed: { amount: '12.5', currencyCode: 'EUR' } } } },
            ],
          },
        ],
      },
    });
    const subs = await getActiveSubscriptions(client(m));
    expect(subs).toEqual([
      { id: 'gid://shopify/AppSubscription/1', name: 'Curtain Starter', status: 'ACTIVE', test: true, trialDays: 14, currentPeriodEnd: '2026-12-04T00:00:00Z', price: 29, currencyCode: 'EUR', usageLineItemId: 'li2' },
    ]);
  });

  it('cancel returns the new status', async () => {
    const m = fetchMock().data({ appSubscriptionCancel: { userErrors: [], appSubscription: { id: 'x', status: 'CANCELLED' } } });
    expect(await cancelAppSubscription(client(m), 'x')).toBe('CANCELLED');
    expect(m.variables()).toEqual({ id: 'x', prorate: true });
  });
});
