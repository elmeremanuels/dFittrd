/**
 * Shopify Billing API, D17: one plan, "Curtain", USD 8.99 per 30 days per shop, flat. The
 * subscription has exactly one line item, an `appRecurringPricingDetails` line; there is no usage
 * line and no `cappedAmount`. The try-on session stays the unit we count (D7) for analytics and the
 * fair-use daily caps, but nothing is billed per session.
 *
 * Currency (D17 "USD as the base"): the price is authored in USD. Shopify recommends charging in
 * the merchant's local billing currency (https://shopify.dev/docs/apps/launch/billing, best
 * practices: "Create charges in the merchant's local billing currency"), read with
 * `shopBillingPreferences`. When our EUR-based rate table (../currency.ts) has that currency, the
 * USD price is converted through it (cross rate `rate[X] / rate[USD]`) and rounded to the
 * currency's minor unit; the rate used is returned so the api can record it. Any other currency is
 * charged in USD, which Shopify converts itself when it issues the charge.
 *
 * `createUsageRecord` is kept only for subscriptions created before D17 (they carried a usage
 * line); the api's nightly rollup bills nothing on the Curtain plan, so it is never called for it.
 *
 * Mutation reference: https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate
 * Time-based (recurring-only) plans: https://shopify.dev/docs/apps/launch/billing/subscription-billing/create-time-based-subscriptions
 */
import { convertEur, currencyFractionDigits, DEFAULT_EUR_RATES, formatMoney, resolveChargeCurrency, type EurRates } from '../currency';
import { assertNoUserErrors, type AdminGraphqlClient, type UserError } from './client';

/** The one plan (D17). Prices are USD; the trial length is chosen by the caller (api env). */
export const CURTAIN_PLAN = Object.freeze({
  name: 'Curtain',
  priceUsdPerMonth: 8.99,
  interval: 'EVERY_30_DAYS',
} as const);

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

/** `shop.plan.partnerDevelopment`: development stores can only accept test charges. */
export const DEVELOPMENT_STORE_QUERY = /* GraphQL */ `
  query CurtainDevStore { shop { plan { partnerDevelopment } } }
`;

export interface SubscriptionPlanInput {
  /** Shown to the merchant on the approval screen; "Curtain" for the D17 plan. */
  name: string;
  returnUrl: string;
  /** The list price in USD (D17: 8.99). */
  priceUsdPerMonth: number;
  trialDays: number;
  /** Test charge: development stores, and every non-production environment. */
  test: boolean;
  /** Charge currency (`resolveUsdChargeCurrency`). Default USD. */
  currencyCode?: string;
  /** 1 USD = `usdRate` units of `currencyCode`. Default: the cross rate from DEFAULT_EUR_RATES. */
  usdRate?: number;
}

export interface UsdChargeCurrency {
  /** ISO 4217 code sent on the recurring line's MoneyInput. */
  currencyCode: string;
  /** 1 USD = `usdRate` units of `currencyCode` (1 for USD). Record it with the subscription. */
  usdRate: number;
  /** True when the shop's billing currency had no rate and USD is charged instead. */
  fallback: boolean;
}

/** USD → X cross rate from the EUR-based table, rounded to 6 significant decimals. */
export function usdCrossRate(currencyCode: string, rates: EurRates = DEFAULT_EUR_RATES): number | undefined {
  const code = currencyCode.toUpperCase();
  if (code === 'USD') return 1;
  const x = rates[code];
  const usd = rates.USD ?? DEFAULT_EUR_RATES.USD;
  if (typeof x !== 'number' || !(x > 0) || typeof usd !== 'number' || !(usd > 0)) return undefined;
  return Math.round((x / usd) * 1e6) / 1e6;
}

/** The shop's billing currency when the rate table covers it, else USD (Shopify converts USD). */
export function resolveUsdChargeCurrency(billingCurrency: string | null | undefined, rates: EurRates = DEFAULT_EUR_RATES): UsdChargeCurrency {
  const picked = resolveChargeCurrency(billingCurrency, rates);
  const usdRate = usdCrossRate(picked.currencyCode, rates);
  if (picked.fallback || usdRate === undefined) return { currencyCode: 'USD', usdRate: 1, fallback: picked.fallback || picked.currencyCode !== 'USD' };
  return { currencyCode: picked.currencyCode, usdRate, fallback: false };
}

/** USD → currency, rounded to the currency's minor unit (A$13.80, ¥1,507). */
export function convertUsd(amountUsd: number, currencyCode: string, usdRate: number): number {
  const digits = currencyFractionDigits(currencyCode);
  const f = 10 ** digits;
  return Math.round(amountUsd * usdRate * f) / f;
}

/** The monthly price in the charge currency, and the rate used. */
export function planPrice(plan: Pick<SubscriptionPlanInput, 'priceUsdPerMonth' | 'currencyCode' | 'usdRate'>): { currencyCode: string; usdRate: number; price: number } {
  const currencyCode = (plan.currencyCode ?? 'USD').toUpperCase();
  const usdRate = plan.usdRate ?? usdCrossRate(currencyCode);
  if (!/^[A-Z]{3}$/.test(currencyCode) || typeof usdRate !== 'number' || !(usdRate > 0)) throw new Error(`no USD rate for billing currency '${currencyCode}'`);
  if (currencyCode === 'USD' && usdRate !== 1) throw new Error('a USD charge must use rate 1');
  return { currencyCode, usdRate, price: currencyCode === 'USD' ? plan.priceUsdPerMonth : convertUsd(plan.priceUsdPerMonth, currencyCode, usdRate) };
}

/** "US$8.99 per month" / "A$13.80 per month" — for the merchant console and admin text. */
export function planPriceLabel(plan: Pick<SubscriptionPlanInput, 'priceUsdPerMonth' | 'currencyCode' | 'usdRate'>): string {
  const p = planPrice(plan);
  return `${formatMoney(p.price, p.currencyCode)} per month`;
}

/** D17: one recurring line, no usage line. */
export function subscriptionLineItems(plan: SubscriptionPlanInput) {
  const p = planPrice(plan);
  return [
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: p.price, currencyCode: p.currencyCode },
          interval: CURTAIN_PLAN.interval,
        },
      },
    },
  ];
}

export interface SubscriptionCreated {
  confirmationUrl: string | null;
  subscriptionId: string | null;
  status: string | null;
  recurringLineItemId: string | null;
  /** The subscription's currency, price and the USD rate used (store them). */
  currencyCode: string;
  usdRate: number;
  price: number;
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
  if (!(plan.priceUsdPerMonth > 0)) throw new Error('createAppSubscription: priceUsdPerMonth must be > 0');
  if (!Number.isInteger(plan.trialDays) || plan.trialDays < 0) throw new Error('createAppSubscription: trialDays must be a whole number >= 0');
  const p = planPrice(plan);
  const data = await client.request<SubscriptionCreatePayload>(APP_SUBSCRIPTION_CREATE, {
    name: plan.name,
    returnUrl: plan.returnUrl,
    test: plan.test,
    trialDays: plan.trialDays,
    lineItems: subscriptionLineItems(plan),
  });
  const r = data.appSubscriptionCreate;
  assertNoUserErrors(r.userErrors, 'appSubscriptionCreate');
  const recurring = r.appSubscription?.lineItems.find((l) => l.plan.pricingDetails.__typename === 'AppRecurringPricing');
  return {
    confirmationUrl: r.confirmationUrl,
    subscriptionId: r.appSubscription?.id ?? null,
    status: r.appSubscription?.status ?? null,
    recurringLineItemId: recurring?.id ?? null,
    currencyCode: p.currencyCode,
    usdRate: p.usdRate,
    price: p.price,
  };
}

/** True for partner development stores (they can only accept test charges). */
export async function isDevelopmentStore(client: AdminGraphqlClient): Promise<boolean> {
  const data = await client.request<{ shop: { plan: { partnerDevelopment?: boolean | null } | null } | null }>(DEVELOPMENT_STORE_QUERY);
  return data.shop?.plan?.partnerDevelopment === true;
}

// ---- legacy (pre-D17 subscriptions with a usage line) -------------------------------------------

export interface ChargeMoney {
  currencyCode: string;
  eurRate: number;
}

/** Currency + EUR rate for a legacy usage record; throws when a non-EUR currency has no rate. */
export function chargeMoney(input: { currencyCode?: string; eurRate?: number }): ChargeMoney {
  const currencyCode = (input.currencyCode ?? 'EUR').toUpperCase();
  const eurRate = input.eurRate ?? (currencyCode === 'EUR' ? 1 : DEFAULT_EUR_RATES[currencyCode]);
  if (!/^[A-Z]{3}$/.test(currencyCode) || typeof eurRate !== 'number' || !(eurRate > 0)) throw new Error(`no EUR rate for billing currency '${currencyCode}'`);
  return { currencyCode, eurRate };
}

export interface UsageRecordInput {
  lineItemId: string;
  description: string;
  amountEur: number;
  /** Stable per billed unit; Shopify dedupes on it. */
  idempotencyKey: string;
  currencyCode?: string;
  eurRate?: number;
}

export interface UsageRecordResult {
  id: string | null;
  /** True when Shopify refused because the capped amount is reached. */
  capReached: boolean;
}

interface UsageRecordPayload {
  appUsageRecordCreate: { userErrors: UserError[]; appUsageRecord: { id: string } | null };
}

/** Legacy only: one usage record on a pre-D17 subscription's usage line. D17 subscriptions have none. */
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

/** Bounded idempotency key for a usage record. */
export function usageIdempotencyKey(shopId: string, sessionKey: string): string {
  return `curtain:${shopId}:${sessionKey}`.slice(0, 255);
}

// ---- status ---------------------------------------------------------------------------------------

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  /** The recurring line's price and currency. */
  price: number | null;
  currencyCode: string | null;
  /** Only on legacy (pre-D17) subscriptions. */
  usageLineItemId: string | null;
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
        lineItems: Array<{ id: string; plan: { pricingDetails: { __typename: string; price?: { amount: string; currencyCode?: string } } } }>;
      }>;
    };
  }>(ACTIVE_SUBSCRIPTIONS_QUERY);
  return data.currentAppInstallation.activeSubscriptions.map((s) => {
    const recurring = s.lineItems.find((l) => l.plan.pricingDetails.__typename === 'AppRecurringPricing');
    const usage = s.lineItems.find((l) => l.plan.pricingDetails.__typename === 'AppUsagePricing');
    const price = recurring?.plan.pricingDetails.price;
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      test: s.test,
      trialDays: s.trialDays,
      currentPeriodEnd: s.currentPeriodEnd,
      price: price ? Number(price.amount) : null,
      currencyCode: price?.currencyCode ?? null,
      usageLineItemId: usage?.id ?? null,
    };
  });
}

export async function cancelAppSubscription(client: AdminGraphqlClient, id: string, prorate = true): Promise<string> {
  const data = await client.request<{ appSubscriptionCancel: { userErrors: UserError[]; appSubscription: { id: string; status: string } | null } }>(APP_SUBSCRIPTION_CANCEL, { id, prorate });
  assertNoUserErrors(data.appSubscriptionCancel.userErrors, 'appSubscriptionCancel');
  return data.appSubscriptionCancel.appSubscription?.status ?? 'CANCELLED';
}
