import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN, SHOP, fetchMock } from '../test/fixtures';
import { DEFAULT_EUR_RATES } from '../currency';
import { cancelAppSubscription, createAppSubscription, createUsageRecord, getActiveSubscriptions, planAmounts, subscriptionLineItems, usageIdempotencyKey, usageTerms, type SubscriptionPlanInput } from './billing';
import { createAdminClient } from './client';

const client = (m: ReturnType<typeof fetchMock>) => createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });

const starter: SubscriptionPlanInput = {
  name: 'Curtain Starter',
  returnUrl: 'https://admin.shopify.com/store/aalter-studio/apps/curtain',
  priceEurPerMonth: 29,
  cappedAmountEur: 100,
  overageTerms: '€0.05 per try-on session above 500 per month',
  trialDays: 14,
  test: true,
};

describe('appSubscriptionCreate', () => {
  it('sends a recurring EUR line plus a usage line with cappedAmount (D6)', async () => {
    const m = fetchMock().data({
      appSubscriptionCreate: {
        userErrors: [],
        confirmationUrl: 'https://aalter-studio.myshopify.com/admin/charges/1/confirm',
        appSubscription: {
          id: 'gid://shopify/AppSubscription/1',
          status: 'PENDING',
          lineItems: [
            { id: 'gid://shopify/AppSubscriptionLineItem/1?v=1', plan: { pricingDetails: { __typename: 'AppRecurringPricing' } } },
            { id: 'gid://shopify/AppSubscriptionLineItem/2?v=1', plan: { pricingDetails: { __typename: 'AppUsagePricing' } } },
          ],
        },
      },
    });
    const r = await createAppSubscription(client(m), starter);
    expect(r).toEqual({
      confirmationUrl: 'https://aalter-studio.myshopify.com/admin/charges/1/confirm',
      subscriptionId: 'gid://shopify/AppSubscription/1',
      status: 'PENDING',
      usageLineItemId: 'gid://shopify/AppSubscriptionLineItem/2?v=1',
      recurringLineItemId: 'gid://shopify/AppSubscriptionLineItem/1?v=1',
      currencyCode: 'EUR',
      eurRate: 1,
    });
    const v = m.variables<{ name: string; test: boolean; trialDays: number; returnUrl: string; lineItems: unknown[] }>();
    expect(v).toMatchObject({ name: 'Curtain Starter', test: true, trialDays: 14, returnUrl: starter.returnUrl });
    expect(v.lineItems).toEqual(subscriptionLineItems(starter));
    expect(subscriptionLineItems(starter)[1]).toEqual({ plan: { appUsagePricingDetails: { cappedAmount: { amount: 100, currencyCode: 'EUR' }, terms: starter.overageTerms } } });
    expect(subscriptionLineItems(starter)[0]).toEqual({ plan: { appRecurringPricingDetails: { price: { amount: 29, currencyCode: 'EUR' }, interval: 'EVERY_30_DAYS' } } });
  });

  it('charges an AUD shop in AUD: whole-unit price and cap from the EUR plan, terms in A$ (#6)', async () => {
    const m = fetchMock().data({
      appSubscriptionCreate: {
        userErrors: [],
        confirmationUrl: 'https://aalter-studio.myshopify.com/admin/charges/2/confirm',
        appSubscription: { id: 'gid://shopify/AppSubscription/2', status: 'PENDING', lineItems: [{ id: 'li-usage', plan: { pricingDetails: { __typename: 'AppUsagePricing' } } }] },
      },
    });
    const aud = { ...starter, currencyCode: 'AUD', eurRate: 1.78, overageTerms: usageTerms(0.05, 500, { currencyCode: 'AUD', eurRate: 1.78 }) };
    expect(aud.overageTerms).toBe('A$0.09 per try-on session above 500 per month');
    const r = await createAppSubscription(client(m), aud);
    expect(r).toMatchObject({ subscriptionId: 'gid://shopify/AppSubscription/2', usageLineItemId: 'li-usage', currencyCode: 'AUD', eurRate: 1.78 });
    const v = m.variables<{ lineItems: unknown[] }>();
    expect(v.lineItems).toEqual([
      { plan: { appRecurringPricingDetails: { price: { amount: 52, currencyCode: 'AUD' }, interval: 'EVERY_30_DAYS' } } },
      { plan: { appUsagePricingDetails: { cappedAmount: { amount: 178, currencyCode: 'AUD' }, terms: 'A$0.09 per try-on session above 500 per month' } } },
    ]);
    expect(JSON.stringify(v)).not.toContain('EUR');
  });

  it('uses the default rate table when only the currency is given, and refuses a currency without a rate', () => {
    expect(planAmounts({ priceEurPerMonth: 29, cappedAmountEur: 100, currencyCode: 'AUD' })).toEqual({ currencyCode: 'AUD', eurRate: DEFAULT_EUR_RATES.AUD, price: Math.round(29 * DEFAULT_EUR_RATES.AUD!), cappedAmount: Math.round(100 * DEFAULT_EUR_RATES.AUD!) });
    expect(planAmounts({ priceEurPerMonth: 29.5, cappedAmountEur: 100 })).toMatchObject({ currencyCode: 'EUR', price: 29.5, cappedAmount: 100 });
    expect(() => planAmounts({ priceEurPerMonth: 29, cappedAmountEur: 100, currencyCode: 'XYZ' })).toThrow(/no EUR rate/);
    expect(usageTerms(0.05, 500)).toBe('€0.05 per try-on session above 500 per month');
  });

  it('rejects bad amounts locally and userErrors remotely', async () => {
    await expect(createAppSubscription(client(fetchMock()), { ...starter, cappedAmountEur: 0 })).rejects.toThrow(/cappedAmount/);
    const m = fetchMock().data({ appSubscriptionCreate: { userErrors: [{ field: ['lineItems'], message: 'Usage line requires terms' }], confirmationUrl: null, appSubscription: null } });
    await expect(createAppSubscription(client(m), starter)).rejects.toThrow(/appSubscriptionCreate: lineItems: Usage line requires terms/);
  });
});

describe('appUsageRecordCreate', () => {
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
  it('maps active subscriptions with usage line, cap and balance', async () => {
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
      { id: 'gid://shopify/AppSubscription/1', name: 'Curtain Starter', status: 'ACTIVE', test: true, trialDays: 14, currentPeriodEnd: '2026-12-04T00:00:00Z', usageLineItemId: 'li2', cappedAmountEur: 100, balanceUsedEur: 12.5, currencyCode: 'EUR' },
    ]);
  });

  it('cancel returns the new status', async () => {
    const m = fetchMock().data({ appSubscriptionCancel: { userErrors: [], appSubscription: { id: 'x', status: 'CANCELLED' } } });
    expect(await cancelAppSubscription(client(m), 'x')).toBe('CANCELLED');
    expect(m.variables()).toEqual({ id: 'x', prorate: true });
  });
});
