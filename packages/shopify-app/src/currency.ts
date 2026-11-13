/**
 * Billing currency for Shopify app charges (finding #6). Curtain's plan prices are authored in EUR
 * (apps/api/src/billing/plans.ts); Shopify bills many merchants in their local currency, and a
 * charge in a currency the merchant is not billed in can be refused (the pilot shop bills in AUD).
 * Shopify's advice is to create charges in the merchant's billing currency, read with the
 * `shopBillingPreferences` query (https://shopify.dev/docs/apps/launch/billing,
 * https://shopify.dev/docs/api/admin-graphql/latest/queries/shopBillingPreferences).
 *
 * How a price is made:
 *  1. Read `shopBillingPreferences { currency }` at subscription time (`fetchBillingCurrency`).
 *  2. `resolveChargeCurrency` picks that currency when this table has a rate for it, else USD
 *     (Shopify bills every other country in USD and converts USD charges itself).
 *  3. Prices are EUR × rate: the monthly price and the cap are rounded to whole units of the
 *     currency (merchant-friendly list prices), usage amounts to the currency's minor unit.
 *  4. The api stores the currency and the rate on the shop, and every later usage record uses the
 *     subscription's currency and that same rate, so a table update never changes a running plan.
 *
 * The table is EUR-based (1 EUR = n units) and covers the currencies Shopify issues bills in
 * (https://help.shopify.com/manual/your-account/manage-billing/your-invoice/local-currency) plus
 * USD. Rates are approximate list-price rates, reviewed with the pricing decision, not live FX;
 * callers may pass their own table (`parseEurRates` reads one from JSON, e.g. from an env var).
 */

/** 1 EUR = n units of the currency. Approximate, reviewed quarterly with pricing (Nov 2026). */
export const DEFAULT_EUR_RATES: Readonly<Record<string, number>> = Object.freeze({
  EUR: 1,
  USD: 1.16,
  AUD: 1.78,
  CAD: 1.62,
  GBP: 0.87,
  INR: 102,
  JPY: 175,
  BRL: 6.3,
  CNY: 8.3,
  CZK: 24.4,
  DKK: 7.46,
  HKD: 9.05,
  IDR: 19000,
  MYR: 4.9,
  MXN: 21.5,
  NZD: 2.0,
  NOK: 11.7,
  PHP: 67,
  PLN: 4.25,
  RON: 5.08,
  SGD: 1.5,
  KRW: 1620,
  SEK: 11,
  CHF: 0.93,
  TWD: 35.5,
  THB: 37.5,
});

export type EurRates = Readonly<Record<string, number>>;

/** Used when the shop's billing currency is not in the table (Shopify converts USD charges). */
export const FALLBACK_CHARGE_CURRENCY = 'USD' as const;

export interface ChargeCurrency {
  /** ISO 4217 code sent as `currencyCode` on every MoneyInput of this subscription. */
  currencyCode: string;
  /** 1 EUR = `eurRate` units of `currencyCode`; store it with the subscription. */
  eurRate: number;
  /** True when the shop's own billing currency had no rate and USD was used instead. */
  fallback: boolean;
}

const CODE_RE = /^[A-Z]{3}$/;

/** The shop's billing currency if we have a rate for it, else USD. */
export function resolveChargeCurrency(billingCurrency: string | null | undefined, rates: EurRates = DEFAULT_EUR_RATES): ChargeCurrency {
  const code = (billingCurrency ?? '').trim().toUpperCase();
  const rate = rates[code];
  if (CODE_RE.test(code) && typeof rate === 'number' && rate > 0) return { currencyCode: code, eurRate: rate, fallback: false };
  const usd = rates[FALLBACK_CHARGE_CURRENCY] ?? DEFAULT_EUR_RATES[FALLBACK_CHARGE_CURRENCY]!;
  return { currencyCode: FALLBACK_CHARGE_CURRENCY, eurRate: usd, fallback: true };
}

/** Minor-unit digits of a currency (JPY/KRW/IDR… 0, most 2), from ICU. */
export function currencyFractionDigits(currencyCode: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function roundTo(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** EUR → currency, rounded to the currency's minor unit (usage amounts). */
export function convertEur(amountEur: number, currencyCode: string, eurRate: number): number {
  return roundTo(amountEur * eurRate, currencyFractionDigits(currencyCode));
}

/** EUR → currency, rounded to whole units (monthly price, capped amount): €29 → A$52, never below 1 when > 0. */
export function convertEurListPrice(amountEur: number, eurRate: number): number {
  if (amountEur <= 0) return 0;
  return Math.max(1, Math.round(amountEur * eurRate));
}

/** `A$0.09`, `€0.05`, `¥9` — for the usage terms the merchant approves. */
export function formatMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currencyCode }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}

/**
 * Read a rate table from JSON (`{"AUD":1.8,"USD":1.15}`): merged over the defaults, EUR forced to 1,
 * invalid entries ignored. Empty/invalid input returns the defaults.
 */
export function parseEurRates(json: string | null | undefined, base: EurRates = DEFAULT_EUR_RATES): EurRates {
  if (!json || !json.trim()) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base;
  const out: Record<string, number> = { ...base };
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const code = k.toUpperCase();
    if (CODE_RE.test(code) && typeof v === 'number' && Number.isFinite(v) && v > 0) out[code] = v;
  }
  out.EUR = 1;
  return Object.freeze(out);
}
