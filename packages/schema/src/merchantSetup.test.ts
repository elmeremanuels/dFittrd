import { describe, expect, it } from 'vitest';
import { PILOT_PULL_ON_SKIRT, PILOT_SKIRT_CHART_ONLY } from './fixtures';
import { completenessScore } from './completeness';
import { MERCHANT_SETUP_TEXT, hasShopMeasurements, merchantSetupSteps, productNextStep, sizeAdviceScore, type SetupFacts } from './merchantSetup';

const base: SetupFacts = { connected: true, productsTotal: 0, productsWithChart: 0, productsMeasured: 0, buttonOpened: false, fitSessions: 0, buttonConfirmed: false, phoneConfirmed: false };

describe('merchantSetupSteps', () => {
  it('walks connect → chart → measure → button → phone, numbered 1 to 5', () => {
    const order: Array<[Partial<SetupFacts>, string | null]> = [
      [{ connected: false }, 'connect'],
      [{}, 'chart'],
      [{ productsTotal: 12, productsWithChart: 4 }, 'measure'],
      [{ productsTotal: 12, productsWithChart: 4, productsMeasured: 1 }, 'button'],
      [{ productsTotal: 12, productsWithChart: 4, productsMeasured: 1, buttonConfirmed: true }, 'phone'],
      [{ productsTotal: 12, productsWithChart: 4, productsMeasured: 1, buttonConfirmed: true, phoneConfirmed: true }, null],
    ];
    for (const [facts, next] of order) expect(merchantSetupSteps({ ...base, ...facts }, 'shopify').next).toBe(next);
    const r = merchantSetupSteps(base, 'shopify');
    expect(r.steps.map((s) => `${s.number}. ${s.title}`)).toEqual(['1. Connect your shop', '2. Add a size chart', '3. Measure one skirt', '4. Turn the button on', '5. Check it on your phone']);
  });

  it('a size shown to a shopper proves the button and the phone check', () => {
    const r = merchantSetupSteps({ ...base, productsWithChart: 1, fitSessions: 3 }, 'woocommerce');
    expect(r.steps.find((s) => s.key === 'button')!.done).toBe(true);
    expect(r.steps.find((s) => s.key === 'phone')!.detail).toBe('3 sizes were shown on your product pages in the last 30 days.');
  });

  it('a Try it on that was opened proves the button, not the phone check', () => {
    const r = merchantSetupSteps({ ...base, buttonOpened: true }, 'shopify');
    expect(r.steps.find((s) => s.key === 'button')!.done).toBe(true);
    expect(r.steps.find((s) => s.key === 'phone')!.done).toBe(false);
  });

  it('says where to click on each platform, without jargon', () => {
    const shopify = merchantSetupSteps({ ...base, connected: false }, 'shopify');
    const woo = merchantSetupSteps({ ...base, connected: false }, 'woocommerce');
    expect(shopify.steps[0]!.detail).toMatch(/Apps → Curtain/);
    expect(woo.steps[0]!.detail).toMatch(/WooCommerce → Curtain/);
    expect(shopify.steps[3]!.action!.label).toBe('Open the theme editor');
    expect(woo.steps[3]!.action!.label).toBe('Open the Curtain settings');
    const words = JSON.stringify([shopify, woo, MERCHANT_SETUP_TEXT]);
    for (const jargon of ['metafield', 'sizeChart', 'webhook', 'API key', 'token', 'payload', 'SDK', 'app block']) expect(words).not.toContain(jargon);
  });

  it('only steps 4 and 5 can be ticked by hand, and only while not done', () => {
    const r = merchantSetupSteps(base, 'shopify');
    expect(r.steps.map((s) => s.confirmLabel !== null)).toEqual([false, false, false, true, true]);
    const done = merchantSetupSteps({ ...base, buttonConfirmed: true, phoneConfirmed: true }, 'shopify');
    expect(done.steps.every((s) => s.confirmLabel === null)).toBe(true);
  });

  it('counts are plural-aware', () => {
    expect(merchantSetupSteps({ ...base, productsTotal: 1, productsWithChart: 1 }, 'shopify').steps[1]!.detail).toBe('1 product has a size chart.');
    expect(merchantSetupSteps({ ...base, productsTotal: 9, productsWithChart: 9 }, 'shopify').steps[1]!.detail).toBe('9 products have a size chart.');
    expect(merchantSetupSteps({ ...base, productsTotal: 9 }, 'shopify').steps[0]!.detail).toBe('Connected. 9 products brought in from your shop.');
  });
});

describe('productNextStep and sizeAdviceScore', () => {
  const skirt = (garment: unknown, status: 'active' | 'incomplete' = 'active') => {
    const c = completenessScore(garment);
    return { status, category: 'bottom', missingFields: c.missing.map((m) => m.field), measured: hasShopMeasurements((garment as { garmentTape?: never }).garmentTape) };
  };

  it('the pilot skirt with a chart only: shoppers get a size, measuring the band is next', () => {
    const p = skirt(PILOT_SKIRT_CHART_ONLY);
    expect(p.measured).toBe(false);
    expect(productNextStep(p)).toMatchObject({ key: 'measure', tone: 'warning', sizeAdvice: true, action: 'Measure it' });
    expect(productNextStep(p).text).toMatch(/pull over the hips/);
    expect(sizeAdviceScore(p)).toBe(70);
    // completenessScore also counts what only the 3D view uses; the merchant's score does not.
    expect(completenessScore(PILOT_SKIRT_CHART_ONLY).score).toBeLessThan(0.8);
  });

  it('the pilot skirt with its tape is ready at 100', () => {
    const p = skirt(PILOT_PULL_ON_SKIRT);
    expect(p.measured).toBe(true);
    expect(productNextStep(p)).toMatchObject({ key: 'ready', badge: 'Ready', tone: 'success', action: null });
    expect(sizeAdviceScore(p)).toBe(100);
  });

  it('a product without a chart, or without a kind of garment, is not ready and says the one thing to do', () => {
    expect(productNextStep({ status: 'incomplete', category: 'dress', missingFields: ['sizeChartType', 'sizeChart'] })).toMatchObject({ key: 'chart', badge: 'Not ready yet', action: 'Add a size chart', sizeAdvice: false });
    expect(productNextStep({ status: 'incomplete', category: 'dress', missingFields: ['sizeChartType'] }).key).toBe('chartType');
    expect(productNextStep({ status: 'incomplete', category: null, missingFields: ['category', 'sizeChart'] }).key).toBe('category');
    expect(sizeAdviceScore({ category: null, missingFields: ['category', 'sizeChart', 'sizeChartType', 'fabric.primary'] })).toBe(0);
  });

  it('a dress without measurements gets the general hint, not the waistband one', () => {
    expect(productNextStep({ status: 'active', category: 'dress', missingFields: [] }).text).not.toMatch(/waistband/);
  });

  it('only shop-measured values count as measurements, not our estimates', () => {
    expect(hasShopMeasurements([{ size: '12', hip: { cm: 100, provenance: 'interpolated' } }])).toBe(false);
    expect(hasShopMeasurements([{ size: '12', length: { cm: 100, provenance: 'measured' } }])).toBe(true);
    expect(hasShopMeasurements(undefined)).toBe(false);
  });
});

describe('the measuring drawing', () => {
  it('the WooCommerce plugin ships the same drawing as the Shopify admin', async () => {
    const { readFileSync } = await import('node:fs');
    const { GARMENT_TAPE_DIAGRAM_SVG } = await import('./garmentTapeForm');
    const file = readFileSync(new URL('../../woocommerce-plugin/assets/admin/skirt-measure.svg', import.meta.url), 'utf8').trim();
    expect(file).toBe(GARMENT_TAPE_DIAGRAM_SVG);
    expect(GARMENT_TAPE_DIAGRAM_SVG).not.toMatch(/<script|on[a-z]+=|href=/i);
  });
});

describe('the WooCommerce settings page says the same steps', () => {
  it('every WooCommerce word of the checklist is in class-setup.php, word for word', async () => {
    const { readFileSync } = await import('node:fs');
    const php = readFileSync(new URL('../../woocommerce-plugin/includes/class-setup.php', import.meta.url), 'utf8');
    const t = MERCHANT_SETUP_TEXT.steps;
    const lines = [
      MERCHANT_SETUP_TEXT.heading,
      MERCHANT_SETUP_TEXT.intro,
      ...Object.values(t).map((s) => s.title),
      t.connect.todo.woocommerce,
      t.connect.doneImporting,
      t.chart.todo.woocommerce,
      t.measure.todo,
      t.button.todo.woocommerce,
      t.button.done,
      t.button.action.woocommerce,
      t.phone.todo.woocommerce,
      t.phone.confirm,
      t.phone.done(0),
      t.measure.action,
      t.chart.action,
    ];
    for (const line of lines) expect(php, line).toContain(line);
  });
});
