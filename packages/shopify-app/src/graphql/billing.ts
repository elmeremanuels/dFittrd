/**
 * Shopify Billing API (D6/D7): a recurring Starter/Pro line plus a usage line with
 * `cappedAmount`; every billable try-on session becomes one `appUsageRecordCreate`, idempotent by
 * intent token. Managed Pricing is not used because it cannot meter usage.
 *
 * Amounts are authored in EUR; `currencyCode` + `eurRate` (see ../currency.ts) turn them into the
 * shop's billing currency. Without `currencyCode` everything is charged in EUR, as before.
 */
import { convertEur, convertEurListPrice, DEFAULT_EUR_RATES, formatMoney } from '../currency';
import { assertNoUserErrors, type AdminGraphqlClient, type UserError } from './client';

export const APP_SUBSCRIPTION_CREATE = /* GraphQL */ `
  mutation CurtainSubscribe($name: String!, $returnUrl: URL!, $test: Boolean, $trialDays: Int, $lineItems: [AppSubscriptionLineItemInput!]!) {
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
  mutation CurtainUsage($subscriptionLineItemId: ID!, $description: String!, $price: MoneyInput!, $idempotencyKey: String!) {
    appUsageRecordCreate(subscriptionLineItemId: $subscriptionLineItemId, description: $description, price: $price, idempotencyKey: $idempotencyKey) {
      userErrors { field message }
      appUsageRecord { id }
    }
  }
`;

export const APP_SUBSCRIPTION_CANCEL = /* GraphQL */ `
  mutation CurtainCancel($id: ID!, $prorate: Boolean) {
    appSubscriptionCancel(id: $id, prorate: $prorate) {
      userErrors { field message }
      appSubscription { id status }
    }
  }
`;

export const ACTIVE_SUBSCRIPTIONS_QUERY = /* GraphQL */ `
  query CurtainSubscriptions {
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
  /** e.g. "Curtain Starter". Also parsed by the api's app_subscriptions/update handler (/pro/i → pro). */
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
  /** Charge currency (the shop's billing currency, `resolveChargeCurrency`). Default EUR. */
  currencyCode?: string;
  /** 1 EUR = `eurRate` units of `currencyCode`. Default: `DEFAULT_EUR_RATES[currencyCode]`. */
  eurRate?: number;
}

export interface ChargeMoney {
  currencyCode: string;
  eurRate: number;
}

/** Currency + rate for a plan or usage input; throws when a non-EUR currency has no rate. */
export function chargeMoney(input: { currencyCode?: string; eurRate?: number }): ChargeMoney {
  const currencyCode = (input.currencyCode ?? 'EUR').toUpperCase();
  const eurRate = input.eurRate ?? (currencyCode === 'EUR' ? 1 : DEFAULT_EUR_RATES[currencyCode]);
  if (!/^[A-Z]{3}$/.test(currencyCode) || typeof eurRate !== 'number' || !(eurRate > 0)) throw new Error(`no EUR rate for billing currency '${currencyCode}'`);
  return { currencyCode, eurRate };
}

/** Monthly price and cap in the charge currency: EUR unchanged, other currencies whole units. */
export function planAmounts(plan: Pick<SubscriptionPlanInput, 'priceEurPerMonth' | 'cappedAmountEur' | 'currencyCode' | 'eurRate'>): { currencyCode: string; eurRate: number; price: number; cappedAmount: number } {
  const m = chargeMoney(plan);
  if (m.currencyCode === 'EUR' && m.eurRate === 1) return { ...m, price: plan.priceEurPerMonth, cappedAmount: plan.cappedAmountEur };
  return { ...m, price: convertEurListPrice(plan.priceEurPerMonth, m.eurRate), cappedAmount: convertEurListPrice(plan.cappedAmountEur, m.eurRate) };
}

/** The usage terms the merchant approves, in the charge currency: "A$0.09 per try-on session above 500 per month". */
export function usageTerms(overageEurPerSession: number, includedSessions: number, money: { currencyCode?: string; eurRate?: number } = {}): string {
  const m = chargeMoney(money);
  return `${formatMoney(convertEur(overageEurPerSession, m.currencyCode, m.eurRate), m.currencyCode)} per try-on session above ${includedSessions} per month`;
}

export interface SubscriptionCreated {
  confirmationUrl: string | null;
  subscriptionId: string | null;
  status: string | null;
  /** The usage line's id — store it; `createUsageRecord` needs it. */
  usageLineItemId: string | null;
  recurringLineItemId: string | null;
  /** The subscription's currency; every usage record for it must use the same one. */
  currencyCode: string;
  eurRate: number;
}

export function subscriptionLineItems(plan: SubscriptionPlanInput) {
  const a = planAmounts(plan);
  return [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: a.price, currencyCode: a.currencyCode },
          interval: 'EVERY_30_DAYS',
        },
      },
    },
    {
      plan: {
        appUsagePricingDetails: {
          cappedAmount: { amount: a.cappedAmount, currencyCode: a.currencyCode },
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
  const money = chargeMoney(plan);
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
    currencyCode: money.currencyCode,
    eurRate: money.eurRate,
  };
}

export interface UsageRecordInput {
  lineItemId: string;
  description: string;
  amountEur: number;
  /** Stable per billable session (see `usageIdempotencyKey`); Shopify dedupes on it. */
  idempotencyKey: string;
  /** The subscription's currency and rate (`SubscriptionCreated`). Default EUR. */
  currencyCode?: string;
  eurRate?: number;
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
  const m = chargeMoney(input);
  const data = await client.request<UsageRecordPayload>(APP_USAGE_RECORD_CREATE, {
    subscriptionLineItemId: input.lineItemId,
    description: input.description,
    price: { amount: convertEur(input.amountEur, m.currencyCode, m.eurRate), currencyCode: m.currencyCode },
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
  return `curtain:${shopId}:${sessionKey}`.slice(0, 255);
}

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  usageLineItemId: string | null;
  /** In `currencyCode` (named Eur for compatibility; EUR for subscriptions created before #6). */
  cappedAmountEur: number | null;
  balanceUsedEur: number | null;
  /** The usage line's currency (cappedAmount.currencyCode). */
  currencyCode: string | null;
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
          plan: { pricingDetails: { __typename: string; cappedAmount?: { amount: string; currencyCode?: string }; balanceUsed?: { amount: string } } };
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
      currencyCode: pd?.cappedAmount?.currencyCode ?? null,
    };
  });
}

export async function cancelAppSubscription(client: AdminGraphqlClient, id: string, prorate = true): Promise<string> {
  const data = await client.request<{ appSubscriptionCancel: { userErrors: UserError[]; appSubscription: { id: string; status: string } | null } }>(APP_SUBSCRIPTION_CANCEL, { id, prorate });
  assertNoUserErrors(data.appSubscriptionCancel.userErrors, 'appSubscriptionCancel');
  return data.appSubscriptionCancel.appSubscription?.status ?? 'CANCELLED';
}
