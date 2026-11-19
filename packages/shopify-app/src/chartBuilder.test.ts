import { completenessScore } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { HEAVY_FIELDS, productChecklist, tryItOnPreviewUrl } from './chartBuilder';
import { SHOP, WRAP_METAFIELDS, wrapDressNode } from './test/fixtures';

describe('productChecklist', () => {
  it('a complete product is try-able, every item done, with the live product page as preview', () => {
    const c = productChecklist(wrapDressNode(), SHOP);
    expect(c.status).toBe('active');
    expect(c.items.map((i) => i.key)).toEqual(['sizeChartType', 'sizeChart', 'category', 'fabric', 'lengthCm']);
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

  it('R3: a chart alone makes the product try-able; flat-lay and fabric are never required in the size plan', () => {
    const keep = WRAP_METAFIELDS.filter((m) => ['size_chart', 'size_chart_type'].includes(m.key));
    const c = productChecklist(wrapDressNode({ metafields: { nodes: keep } }), SHOP);
    expect(c.status).toBe('active');
    expect(c.items.find((i) => i.key === 'flatLayPhoto')).toBeUndefined();
    expect(c.items.filter((i) => i.required).map((i) => i.key).sort()).toEqual(['category', 'sizeChart', 'sizeChartType']);
    expect(c.items.find((i) => i.key === 'fabric')).toMatchObject({ done: false, required: false });
    const withRender = productChecklist(wrapDressNode({ metafields: { nodes: keep } }), SHOP, 'shop', { render: true });
    expect(withRender.items.find((i) => i.key === 'flatLayPhoto')).toMatchObject({ done: false, required: false });
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
