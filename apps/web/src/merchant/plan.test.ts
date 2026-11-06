import { describe, expect, it } from 'vitest';
import { mockUsage } from './mock';
import { CURTAIN_PRICE_USD, planPriceText } from './plan';

describe('merchant console plan display (D17)', () => {
  it('shows the one flat USD price, or the charged local amount with the USD price', () => {
    expect(planPriceText({ priceUsdPerMonth: 8.99 })).toBe('$8.99 per month');
    expect(planPriceText({})).toBe('$8.99 per month');
    expect(planPriceText({ priceUsdPerMonth: 8.99, chargePrice: 13.8, chargeCurrency: 'AUD' })).toBe('A$13.80 per month ($8.99)');
    expect(planPriceText({ priceUsdPerMonth: 8.99, chargePrice: 8.99, chargeCurrency: 'USD' })).toBe('$8.99 per month');
    expect(CURTAIN_PRICE_USD).toBe(8.99);
  });

  it('the demo data is on the one plan with no per-session charge', () => {
    const u = mockUsage('2026-11-01', '2026-11-30');
    expect(u.plan).toMatchObject({ name: 'curtain', overageEurPerSession: 0, priceUsdPerMonth: 8.99 });
  });
});
