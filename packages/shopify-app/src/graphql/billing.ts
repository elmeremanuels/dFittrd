/**
 * Shopify Billing API (D6/D7): a recurring Starter/Pro line plus a usage line with
 * `cappedAmount`; every billable try-on session becomes one `appUsageRecordCreate`, idempotent by
 * intent token. Managed Pricing is not used because it cannot meter usage.
 */
import { assertNoUserErrors, type AdminGraphqlClient, type UserError } from './client';

export const APP_SUBSCRIPTION_CREATE = /* GraphQL */ `
  mutation PaskamerSubscribe($name: String!, $returnUrl: URL!, $test: Boolean, $trialDays: Int, $lineItems: [AppSubscriptionLineItemInput!]!) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, trialDays: $trialDays, lineItems: $lineItems) {
      userErrors { field message }
      confirmationUrl
      appSubscription {
        id
        status
        lineItems { id plan { pricingDetails { __typename } } }
      }
    }
  }
`;

export const APP_USAGE_RECORD_CREATE = /* GraphQL */ `
  mutation PaskamerUsage($subscriptionLineItemId: ID!, $description: String!, $price: MoneyInput!, $idempotencyKey: String!) {
    appUsageRecordCreate(subscriptionLineItemId: $subscriptionLineItemId, description: $description, price: $price, idempotencyKey: $idempotencyKey) {
      userErrors { field message }
      appUsageRecord { id }
    }
  }
`;

export const APP_SUBSCRIPTION_CANCEL = /* GraphQL */ `
  mutation PaskamerCancel($id: ID!, $prorate: Boolean) {
    appSubscriptionCancel(id: $id, prorate: $prorate) {
      userErrors { field message }
      appSubscription { id status }
    }
  }
`;

export const ACTIVE_SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query PaskamerSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        currentPeriodEnd
        lineItems {
          id
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing { price { amount currencyCode } interval }
              ... on AppUsagePricing { terms cappedAmount { amount currencyCode } balanceUsed { amount currencyCode } }
            }
          }
        }
      }
    }
  }
`;

export interface SubscriptionPlanInput {
  /** e.g. "Paskamer Starter". Also parsed by the api's app_subscriptions/update handler (/pro/i → pro). */
  name: string;
  returnUrl: string;
  priceEurPerMonth: number;
  /** Max overage Shopify lets us bill per 30 days before the merchant must raise the cap. */
  cappedAmountEur: number;
  /** Shown to the merchant on the approval screen, e.g. "€0.05 per try-on session above 500 per month". */
  overageTerms: string;
  trialDays: number;
  /** Test charges on dev stores (never on production shops). */
  test: boolean;
}

export interface SubscriptionCreated {
  confirmationUrl: string | null;
  subscriptionId: string | null;
  status: string | null;
  /** The usage line's id — store it; `createUsageRecord` needs it. */
  usageLineItemId: string | null;
  recurringLineItemId: string | null;
}

export function subscriptionLineItems(plan: SubscriptionPlanInput) {
  return [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: plan.priceEurPerMonth, currencyCode: 'EUR' },
          interval: 'EVERY_30_DAYS',
        },
      },
    },
    {
      plan: {
        appUsagePricingDetails: {
          cappedAmount: { amount: plan.cappedAmountEur, currencyCode: 'EUR' },
          terms: plan.overageTerms,
        },
      },
    },
  ];
}

interface SubscriptionCreatePayload {
  appSubscriptionCreate: {
    userErrors: UserError[];
    confirmationUrl: string | null;
    appSubscription: { id: string; status: string; lineItems: Array<{ id: string; plan: { pricingDetails: { __typename: string } } }> } | null;
  };
}

/** Creates the subscription; the merchant must approve at `confirmationUrl` (open it with `_top`). */
export async function createAppSubscription(client: AdminGraphqlClient, plan: SubscriptionPlanInput): Promise<SubscriptionCreated> {
  if (plan.priceEurPerMonth < 0 || plan.cappedAmountEur <= 0) throw new Error('createAppSubscription: price must be >= 0 and cappedAmount > 0');
  const data = await client.request<SubscriptionCreatePayload>(APP_SUBSCRIPTION_CREATE, {
    name: plan.name,
    returnUrl: plan.returnUrl,
    test: plan.test,
    trialDays: plan.trialDays,
    lineItems: subscriptionLineItems(plan),
  });
  const r = data.appSubscriptionCreate;
  assertNoUserErrors(r.userErrors, 'appSubscriptionCreate');
  const usage = r.appSubscription?.lineItems.find((l) => l.plan.pricingDetails.__typename === 'AppUsagePricing');
  const recurring = r.appSubscription?.lineItems.find((l) => l.plan.pricingDetails.__typename === 'AppRecurringPricing');
  return {
    confirmationUrl: r.confirmationUrl,
    subscriptionId: r.appSubscription?.id ?? null,
    status: r.appSubscription?.status ?? null,
    usageLineItemId: usage?.id ?? null,
    recurringLineItemId: recurring?.id ?? null,
  };
}

export interface UsageRecordInput {
  lineItemId: string;
  description: string;
  amountEur: number;
  /** Stable per billable session (see `usageIdempotencyKey`); Shopify dedupes on it. */
  idempotencyKey: string;
}

export interface UsageRecordResult {
  id: string | null;
  /** True when Shopify refused because the capped amount is reached (merchant must raise the cap). */
  capReached: boolean;
}

interface UsageRecordPayload {
  appUsageRecordCreate: { userErrors: UserError[]; appUsageRecord: { id: string } | null };
}

/** One usage record per billable session. Cap-reached is reported, not thrown, so the api can pause the shop. */
export async function createUsageRecord(client: AdminGraphqlClient, input: UsageRecordInput): Promise<UsageRecordResult> {
  const data = await client.request<UsageRecordPayload>(APP_USAGE_RECORD_CREATE, {
    subscriptionLineItemId: input.lineItemId,
    description: input.description,
    price: { amount: round2(input.amountEur), currencyCode: 'EUR' },
    idempotencyKey: input.idempotencyKey,
  });
  const r = data.appUsageRecordCreate;
  if (r.userErrors.length) {
    if (r.userErrors.some((e) => /capped amount|cap/i.test(e.message))) return { id: null, capReached: true };
    assertNoUserErrors(r.userErrors, 'appUsageRecordCreate');
  }
  return { id: r.appUsageRecord?.id ?? null, capReached: false };
}

/** D7: billing unit = try-on session, idempotent by intent token; deck sessions key on device×shop×product×day. */
export function usageIdempotencyKey(shopId: string, sessionKey: string): string {
  return `paskamer:${shopId}:${sessionKey}`.slice(0, 255);
}

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  usageLineItemId: string | null;
  cappedAmountEur: number | null;
  balanceUsedEur: number | null;
}

export async function getActiveSubscriptions(client: AdminGraphqlClient): Promise<ActiveSubscription[]> {
  const data = await client.request<{
    currentAppInstallation: {
      activeSubscriptions: Array<{
        id: string;
        name: string;
        status: string;
        test: boolean;
        trialDays: number;
        currentPeriodEnd: string | null;
        lineItems: Array<{
          id: string;
          plan: { pricingDetails: { __typename: string; cappedAmount?: { amount: string }; balanceUsed?: { amount: string } } };
        }>;
      }>;
    };
  }>(ACTIVE_SUBSCRIPTIONS_QUERY);
  return data.currentAppInstallation.activeSubscriptions.map((s) => {
    const usage = s.lineItems.find((l) => l.plan.pricingDetails.__typename === 'AppUsagePricing');
    const pd = usage?.plan.pricingDetails;
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      test: s.test,
      trialDays: s.trialDays,
      currentPeriodEnd: s.currentPeriodEnd,
      usageLineItemId: usage?.id ?? null,
      cappedAmountEur: pd?.cappedAmount ? Number(pd.cappedAmount.amount) : null,
      balanceUsedEur: pd?.balanceUsed ? Number(pd.balanceUsed.amount) : null,
    };
  });
}

export async function cancelAppSubscription(client: AdminGraphqlClient, id: string, prorate = true): Promise<string> {
  const data = await client.request<{ appSubscriptionCancel: { userErrors: UserError[]; appSubscription: { id: string; status: string } | null } }>(APP_SUBSCRIPTION_CANCEL, { id, prorate });
  assertNoUserErrors(data.appSubscriptionCancel.userErrors, 'appSubscriptionCancel');
  return data.appSubscriptionCancel.appSubscription?.status ?? 'CANCELLED';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
