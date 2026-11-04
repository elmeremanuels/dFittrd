import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN, SHOP, fetchMock } from '../test/fixtures';
import { cancelAppSubscription, createAppSubscription, createUsageRecord, getActiveSubscriptions, subscriptionLineItems, usageIdempotencyKey, type SubscriptionPlanInput } from './billing';
import { createAdminClient } from './client';

const client = (m: ReturnType<typeof fetchMock>) => createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });

const starter: SubscriptionPlanInput = {
  name: 'Paskamer Starter',
  returnUrl: 'https://admin.shopify.com/store/aalter-studio/apps/paskamer',
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
    });
    const v = m.variables<{ name: string; test: boolean; trialDays: number; returnUrl: string; lineItems: unknown[] }>();
    expect(v).toMatchObject({ name: 'Paskamer Starter', test: true, trialDays: 14, returnUrl: starter.returnUrl });
    expect(v.lineItems).toEqual(subscriptionLineItems(starter));
    expect(subscriptionLineItems(starter)[1]).toEqual({ plan: { appUsagePricingDetails: { cappedAmount: { amount: 100, currencyCode: 'EUR' }, terms: starter.overageTerms } } });
    expect(subscriptionLineItems(starter)[0]).toEqual({ plan: { appRecurringPricingDetails: { price: { amount: 29, currencyCode: 'EUR' }, interval: 'EVERY_30_DAYS' } } });
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
      idempotencyKey: 'paskamer:shop-uuid:intent-token-abc',
    });
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
            name: 'Paskamer Starter',
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
      { id: 'gid://shopify/AppSubscription/1', name: 'Paskamer Starter', status: 'ACTIVE', test: true, trialDays: 14, currentPeriodEnd: '2026-12-04T00:00:00Z', usageLineItemId: 'li2', cappedAmountEur: 100, balanceUsedEur: 12.5 },
    ]);
  });

  it('cancel returns the new status', async () => {
    const m = fetchMock().data({ appSubscriptionCancel: { userErrors: [], appSubscription: { id: 'x', status: 'CANCELLED' } } });
    expect(await cancelAppSubscription(client(m), 'x')).toBe('CANCELLED');
    expect(m.variables()).toEqual({ id: 'x', prorate: true });
  });
});
