/**
 * Product + `$app:curtain` metafields queries. The selection matches `ShopifyProductNodeSchema`
 * in @curtain/schema so the result goes straight into `fromShopifyProduct`.
 */
import { SHOPIFY_METAFIELD_NAMESPACE, shopifyExternalId, type ShopifyProductNode } from '@curtain/schema';
import type { AdminGraphqlClient } from './client';

export const PRODUCT_NODE_FIELDS = /* GraphQL */ `
  id
  handle
  title
  vendor
  productType
  status
  onlineStoreUrl
  category { name fullName }
  featuredImage { url }
  images(first: 20) { nodes { url } }
  priceRangeV2 { minVariantPrice { amount currencyCode } }
  variants(first: 50) { nodes { price selectedOptions { name value } } }
  metafields(namespace: $namespace, first: 50) { nodes { namespace key type value } }
`;

export const PRODUCT_QUERY = /* GraphQL */ `
  query CurtainProduct($id: ID!, $namespace: String!) {
    product(id: $id) { ${PRODUCT_NODE_FIELDS} }
  }
`;

export const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query CurtainProducts($cursor: String, $namespace: String!, $query: String) {
    products(first: 50, after: $cursor, query: $query) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PRODUCT_NODE_FIELDS} }
    }
  }
`;

export interface ProductsPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: ShopifyProductNode[];
}

/** `123` → `gid://shopify/Product/123` (idempotent on a GID). */
export function productGid(externalId: string): string {
  return externalId.startsWith('gid://') ? externalId : `gid://shopify/Product/${externalId}`;
}

export { shopifyExternalId as productExternalId };

export async function fetchProduct(client: AdminGraphqlClient, gidOrExternalId: string): Promise<ShopifyProductNode | null> {
  const data = await client.request<{ product: ShopifyProductNode | null }>(PRODUCT_QUERY, {
    id: productGid(gidOrExternalId),
    namespace: SHOPIFY_METAFIELD_NAMESPACE,
  });
  return data.product;
}

/** One page of 50 products; default query limits to `status:active`. */
export async function fetchProductsPage(client: AdminGraphqlClient, cursor: string | null = null, query = 'status:active'): Promise<ProductsPage> {
  const data = await client.request<{ products: ProductsPage }>(PRODUCTS_PAGE_QUERY, { cursor, namespace: SHOPIFY_METAFIELD_NAMESPACE, query });
  return data.products;
}

/** Walk every page (for small catalogues; use the bulk backfill for large ones). */
export async function* iterateProducts(client: AdminGraphqlClient, query = 'status:active'): AsyncGenerator<ShopifyProductNode, void, undefined> {
  let cursor: string | null = null;
  for (;;) {
    const page: ProductsPage = await fetchProductsPage(client, cursor, query);
    for (const node of page.nodes) yield node;
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return;
    cursor = page.pageInfo.endCursor;
  }
}
