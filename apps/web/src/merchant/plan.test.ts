import { describe, expect, it } from 'vitest';
import { mockUsage } from './mock';
import { CURTAIN_PRICE_USD, planPriceText, planState, planStatusText } from './plan';

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

  it('B2: a shop still paying a retired plan is not shown as active on Curtain and is told how to switch', () => {
    expect(planState({ name: 'curtain', paused: false })).toBe('active');
    expect(planState({ name: 'free', paused: false })).toBe('none');
    expect(planState({ name: 'curtain', paused: true, legacyPlan: 'pro' })).toBe('paused');
    expect(planState({ name: 'curtain', paused: false, legacyPlan: 'starter' })).toBe('legacy');
    expect(planStatusText({ name: 'curtain', paused: false, legacyPlan: 'starter', switchVia: 'stripe' })).toMatch(/retired “starter” plan at its old price\. Switch to the Curtain plan below/);
    expect(planStatusText({ name: 'curtain', paused: false, legacyPlan: 'pro', switchVia: 'shopify' })).toMatch(/Shopify admin/);
    expect(planStatusText({ name: 'curtain', paused: false })).toBe('Active.');
  });
});
