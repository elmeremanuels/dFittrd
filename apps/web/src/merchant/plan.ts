/** Plan display for the merchant console (D17: one plan, "Curtain", USD 8.99 per month, flat). */
import type { UsageResponse } from '@curtain/schema';

/** D17 list price, used when an older api does not send `priceUsdPerMonth`. */
export const CURTAIN_PRICE_USD = 8.99;

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** "$8.99 per month", or "A$13.80 per month ($8.99)" when Shopify charges the shop in its billing currency. */
export function planPriceText(plan: Pick<UsageResponse['plan'], 'priceUsdPerMonth' | 'chargePrice' | 'chargeCurrency'>): string {
  const usd = money(plan.priceUsdPerMonth || CURTAIN_PRICE_USD, 'USD');
  if (plan.chargeCurrency && plan.chargeCurrency !== 'USD' && typeof plan.chargePrice === 'number') return `${money(plan.chargePrice, plan.chargeCurrency)} per month (${usd})`;
  return `${usd} per month`;
}

export type PlanState = 'legacy' | 'active' | 'paused' | 'none';

/**
 * Which plan state the console shows. `legacy` (B2): the shop still pays a retired pre-D17
 * subscription at its old price, so it is not "Active" on Curtain and is offered the switch.
 */
export function planState(plan: Pick<UsageResponse['plan'], 'name' | 'paused' | 'legacyPlan'>): PlanState {
  if (plan.paused) return 'paused';
  if (plan.name === 'free') return 'none';
  return plan.legacyPlan ? 'legacy' : 'active';
}

/** The status line under the plan card. */
export function planStatusText(plan: Pick<UsageResponse['plan'], 'name' | 'paused' | 'legacyPlan' | 'switchVia'>): string {
  switch (planState(plan)) {
    case 'paused':
      return 'Paused: no active subscription.';
    case 'none':
      return 'Not subscribed yet.';
    case 'active':
      return 'Active.';
    case 'legacy':
      return `Still billed on the retired “${plan.legacyPlan}” plan at its old price. ${
        plan.switchVia === 'shopify' ? 'Open Curtain in your Shopify admin and approve the Curtain plan to switch.' : 'Switch to the Curtain plan below; the old subscription is cancelled when the new one starts.'
      }`;
  }
}
