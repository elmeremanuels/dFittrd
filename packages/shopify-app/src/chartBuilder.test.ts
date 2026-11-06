import { completenessScore } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { HEAVY_FIELDS, onboardingSteps, productChecklist, tryItOnPreviewUrl } from './chartBuilder';
import { SHOP, WRAP_METAFIELDS, wrapDressNode } from './test/fixtures';

describe('productChecklist', () => {
  it('a complete product is try-able, every item done, with the live product page as preview', () => {
    const c = productChecklist(wrapDressNode(), SHOP);
    expect(c.status).toBe('active');
    expect(c.items.map((i) => i.key)).toEqual(['sizeChartType', 'sizeChart', 'category', 'fabric', 'lengthCm', 'flatLayPhoto']);
    expect(c.items.every((i) => i.done)).toBe(true);
    expect(c.previewUrl).toBe('https://aalter-studio.myshopify.com/products/linen-wrap-dress');
    expect(c.adminUrl).toBe(`https://${SHOP}/admin/products/8213455001`);
  });

  it('a product without a chart lists what is missing, and an unpublished one previews via the preview URL', () => {
    const keep = WRAP_METAFIELDS.filter((m) => !['size_chart', 'size_chart_type', 'length_cm'].includes(m.key));
    const c = productChecklist({ ...wrapDressNode({ metafields: { nodes: keep }, onlineStoreUrl: null }), onlineStorePreviewUrl: 'https://aalter-studio.myshopify.com/products/linen-wrap-dress?preview_key=x' }, SHOP);
    expect(c.status).toBe('incomplete');
    const byKey = Object.fromEntries(c.items.map((i) => [i.key, i]));
    expect(byKey.sizeChart).toMatchObject({ done: false, required: true });
    expect(byKey.sizeChartType).toMatchObject({ done: false, required: true });
    expect(byKey.lengthCm).toMatchObject({ done: false, required: false });
    expect(byKey.fabric!.done).toBe(true);
    expect(c.previewUrl).toMatch(/preview_key=x$/);
  });

  it('never links a non-https preview', () => {
    expect(tryItOnPreviewUrl({ onlineStoreUrl: 'javascript:alert(1)', onlineStorePreviewUrl: null })).toBeNull();
    expect(tryItOnPreviewUrl({ onlineStoreUrl: null, onlineStorePreviewUrl: null })).toBeNull();
  });

  it('HEAVY_FIELDS matches the heavy checks of completenessScore', () => {
    const heavy = new Set<string>();
    for (const g of [{}, { category: 'dress' }]) for (const m of completenessScore(g).missing) if (m.severity === 'heavy') heavy.add(m.field);
    expect([...HEAVY_FIELDS].sort()).toEqual([...heavy].sort());
  });
});

describe('onboardingSteps', () => {
  const base = { connected: true, templateId: null, themeBlockConfirmed: false, tested: false, productsWithChart: 0, fitSessions: 0 };

  it('walks connect → template → assign → theme block → test', () => {
    expect(onboardingSteps({ ...base, connected: false }).next).toBe('connect');
    expect(onboardingSteps(base).next).toBe('template');
    expect(onboardingSteps({ ...base, templateId: 'au-womens-body' }).next).toBe('assign');
    expect(onboardingSteps({ ...base, templateId: 'au-womens-body', productsWithChart: 3 }).next).toBe('themeBlock');
    expect(onboardingSteps({ ...base, templateId: 'au-womens-body', productsWithChart: 3, themeBlockConfirmed: true }).next).toBe('test');
    const done = onboardingSteps({ ...base, templateId: 'au-womens-body', productsWithChart: 3, themeBlockConfirmed: true, tested: true });
    expect(done.next).toBeNull();
    expect(done.steps).toHaveLength(5);
  });

  it('a real fit result proves the block and the test', () => {
    const r = onboardingSteps({ ...base, fitSessions: 4 });
    expect(r.steps.find((s) => s.key === 'themeBlock')!.done).toBe(true);
    expect(r.steps.find((s) => s.key === 'test')!.detail).toMatch(/4 size recommendation/);
  });
});
