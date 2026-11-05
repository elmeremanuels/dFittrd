import { SHOPIFY_METAFIELD_NAMESPACE } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN, PRODUCT_GID, PRODUCT_ID, SHOP, fetchMock, wrapDressNode } from '../test/fixtures';
import { createAdminClient } from './client';
import { fetchProduct, fetchProductsPage, iterateProducts, productGid, productExternalId } from './products';

const client = (m: ReturnType<typeof fetchMock>) => createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });

describe('products', () => {
  it('productGid / productExternalId round-trip', () => {
    expect(productGid(PRODUCT_ID)).toBe(PRODUCT_GID);
    expect(productGid(PRODUCT_GID)).toBe(PRODUCT_GID);
    expect(productExternalId(PRODUCT_GID)).toBe(PRODUCT_ID);
  });

  it('fetchProduct queries by GID in our namespace and returns the node', async () => {
    const m = fetchMock().data({ product: wrapDressNode() });
    const node = await fetchProduct(client(m), PRODUCT_ID);
    expect(node?.title).toBe('Linen Wrap Dress');
    expect(m.variables()).toEqual({ id: PRODUCT_GID, namespace: SHOPIFY_METAFIELD_NAMESPACE });
    expect(m.query()).toContain('metafields(namespace: $namespace, first: 50)');
    expect(m.query()).toContain('priceRangeV2 { minVariantPrice { amount currencyCode } }');
  });

  it('fetchProduct returns null for a deleted product', async () => {
    const m = fetchMock().data({ product: null });
    expect(await fetchProduct(client(m), PRODUCT_ID)).toBeNull();
  });

  it('iterateProducts walks pages with the cursor', async () => {
    const m = fetchMock().data(
      { products: { pageInfo: { hasNextPage: true, endCursor: 'c1' }, nodes: [wrapDressNode({ id: 'gid://shopify/Product/1' })] } },
      { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [wrapDressNode({ id: 'gid://shopify/Product/2' })] } },
    );
    const ids: string[] = [];
    for await (const n of iterateProducts(client(m))) ids.push(n.id);
    expect(ids).toEqual(['gid://shopify/Product/1', 'gid://shopify/Product/2']);
    expect(m.variables(0)).toMatchObject({ cursor: null, query: 'status:active' });
    expect(m.variables(1)).toMatchObject({ cursor: 'c1' });
  });

  it('fetchProductsPage passes a custom query', async () => {
    const m = fetchMock().data({ products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } });
    const page = await fetchProductsPage(client(m), null, 'updated_at:>2026-01-01');
    expect(page.nodes).toEqual([]);
    expect(m.variables()).toMatchObject({ query: 'updated_at:>2026-01-01' });
  });
});
