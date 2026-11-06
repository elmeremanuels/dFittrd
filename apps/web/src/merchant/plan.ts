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
