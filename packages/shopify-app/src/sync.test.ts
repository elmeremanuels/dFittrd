import { GarmentPayloadDraftSchema, mockGarment } from '@paskamer/schema';
import { describe, expect, it } from 'vitest';
import { parseBulkJsonl } from './graphql/bulk';
import { isPublished, shouldArchive, syncProductNode, syncProductNodes, toMerchantUpsertBody } from './sync';
import { PRODUCT_ID, WRAP_METAFIELDS, wrapDressJsonl, wrapDressNode } from './test/fixtures';

describe('syncProductNode', () => {
  it('normalises the fixture to the WRAP prototype garment (fit-engine aalter-studio-1) and is active', () => {
    const r = syncProductNode(wrapDressNode());
    expect(r.usable).toBe(true);
    expect(r.archived).toBe(false);
    expect(r.externalId).toBe(PRODUCT_ID);
    expect(r.handle).toBe('linen-wrap-dress');
    expect(r.payload).not.toBeNull();
    expect(r.completeness.status).toBe('active');
    expect(r.completeness.missing).toEqual([]);
    expect(r.warnings).toEqual([]);

    const wrap = mockGarment('aalter-studio-1');
    const p = r.payload!;
    expect(p.id).toBe(PRODUCT_ID);
    expect(p.name).toBe(wrap.name);
    expect(p.brand).toBe(wrap.brand);
    expect(p.category).toBe('dress');
    expect(p.subcategory).toBe(wrap.subcategory);
    expect(p.priceEur).toBe(149);
    expect(p.primaryColorHex).toBe(wrap.primaryColorHex);
    expect(p.sizeChartType).toBe('body');
    expect(p.sizeChart).toEqual(wrap.sizeChart);
    expect(p.fabric).toEqual(wrap.fabric);
    expect(p.patternBlock).toBe('wrap');
    expect(p.ease).toEqual(wrap.ease);
    expect(p.lengthCm).toEqual(wrap.lengthCm);
    expect(p.sizingNotes).toBe('runs small');
    expect(p.trueToSizeScore).toBe(0.92);
    expect(p.criticalFitPoints).toEqual(['bust', 'shoulder']);
    expect(p.stretchZones).toEqual(['waist-tie']);
    expect(p.styleTags).toEqual({ bohemian: 0.9, classic: 0.3 });
    expect(p.flatLayPhoto).toBe('https://cdn.shopify.com/s/files/1/aalter/flat-lay-wrap.jpg');
    expect(p.productPhotos).toEqual(['https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg', 'https://cdn.shopify.com/s/files/1/aalter/wrap-2.jpg']);
    expect(p.productUrl).toBe('https://aalter-studio.myshopify.com/products/linen-wrap-dress');
  });

  it('the bulk export and the single query produce the same payload', () => {
    const fromBulk = syncProductNode(parseBulkJsonl(wrapDressJsonl()).products[0]!);
    const fromQuery = syncProductNode(wrapDressNode());
    expect(fromBulk.payload).toEqual(fromQuery.payload);
  });

  it('missing heavy fields → incomplete with named paths; still a valid draft for the merchant upsert', () => {
    const node = wrapDressNode({ metafields: { nodes: WRAP_METAFIELDS.filter((m) => !['size_chart', 'fabric', 'flat_lay_photo'].includes(m.key)) } });
    const r = syncProductNode(node);
    expect(r.usable).toBe(true);
    expect(r.payload).toBeNull();
    expect(r.completeness.status).toBe('incomplete');
    const missing = r.completeness.missing.map((m) => m.field);
    expect(missing).toEqual(expect.arrayContaining(['sizeChart', 'fabric.primary', 'flatLayPhoto']));
    expect(GarmentPayloadDraftSchema.safeParse(toMerchantUpsertBody(r)).success).toBe(true);
  });

  it('collects mapping warnings (non-EUR price, bad JSON) instead of throwing', () => {
    const node = wrapDressNode({
      priceRangeV2: { minVariantPrice: { amount: '149.00', currencyCode: 'USD' } },
      metafields: { nodes: WRAP_METAFIELDS.map((m) => (m.key === 'fabric' ? { ...m, value: '{not json' } : m)) },
    });
    const r = syncProductNode(node);
    expect(r.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['priceEur', 'fabric']));
    expect(r.draft.priceEur).toBeUndefined();
    expect(r.completeness.status).toBe('incomplete');
  });

  it('brand falls back to the shop name; a node without title is unusable', () => {
    const r = syncProductNode(wrapDressNode({ vendor: null }), { defaultBrand: 'Aalter Studio Shop' });
    expect(r.draft.brand).toBe('Aalter Studio Shop');
    const bad = syncProductNode({ id: 'gid://shopify/Product/1', title: '' } as never, { defaultBrand: 'X' });
    expect(bad.usable).toBe(false);
  });

  it('archived / deleted products are flagged for archiving, drafts stay syncable', () => {
    expect(shouldArchive(null)).toBe(true);
    expect(shouldArchive(wrapDressNode({ status: 'ARCHIVED' }))).toBe(true);
    expect(shouldArchive(wrapDressNode({ status: 'DRAFT' }))).toBe(false);
    expect(isPublished(wrapDressNode({ status: 'DRAFT' }))).toBe(false);
    expect(isPublished(wrapDressNode())).toBe(true);
    expect(syncProductNode(null).archived).toBe(true);
  });

  it('syncProductNodes partitions products / archived / skipped', () => {
    const r = syncProductNodes([wrapDressNode(), wrapDressNode({ id: 'gid://shopify/Product/2', status: 'ARCHIVED' }), { id: 'gid://shopify/Product/3', title: '' } as never], { defaultBrand: 'S' });
    expect(r.products.map((p) => p.externalId)).toEqual([PRODUCT_ID]);
    expect(r.archived).toEqual(['2']);
    expect(r.skipped).toEqual(['3']);
  });
});
