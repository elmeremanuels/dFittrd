/**
 * Size chart builder, Admin API side: which products a selection means (collection, tag, product
 * type or the App Bridge resource picker), how many there are, and writing one chart to all of
 * them as `$app:curtain` metafields (`size_chart_type` + `size_chart`, via `toShopifyMetafields`).
 * The api queues the product sync for every written product, so the shop stays the source of truth.
 */
import { SHOPIFY_METAFIELD_NAMESPACE, chartPayload, toShopifyMetafields, type ChartInput, type ProductSelector, type ShopifyProductNode } from '@curtain/schema';
import type { AdminGraphqlClient } from './client';
import { APP_DATA_NAMESPACE, metafieldsSet } from './metafields';
import { PRODUCT_NODE_FIELDS, productGid } from './products';

/** Fields per product in a selection: enough to report and to skip products that already have a chart. */
const TARGET_FIELDS = /* GraphQL */ `
  id
  title
  status
  sizeChart: metafield(namespace: $namespace, key: "size_chart") { id }
`;

export const PRODUCTS_COUNT_QUERY = /* GraphQL */ `
  query CurtainProductsCount($query: String) {
    productsCount(query: $query, limit: 10000) { count precision }
  }
`;

export const CHART_TARGETS_QUERY = /* GraphQL */ `
  query CurtainChartTargets($query: String, $cursor: String, $first: Int!, $namespace: String!) {
    products(first: $first, after: $cursor, query: $query, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes { ${TARGET_FIELDS} }
    }
  }
`;

export const CHART_TARGET_NODES_QUERY = /* GraphQL */ `
  query CurtainChartTargetNodes($ids: [ID!]!, $namespace: String!) {
    nodes(ids: $ids) { ... on Product { ${TARGET_FIELDS} } }
  }
`;

export interface ChartTarget {
  id: string;
  title: string;
  status: string;
  hasChart: boolean;
}

interface TargetNode {
  id?: string;
  title?: string;
  status?: string;
  sizeChart?: { id: string } | null;
}

function toTarget(n: TargetNode): ChartTarget | null {
  if (!n || typeof n.id !== 'string' || !n.id.startsWith('gid://shopify/Product/')) return null;
  return { id: n.id, title: n.title ?? '', status: n.status ?? 'ACTIVE', hasChart: Boolean(n.sizeChart) };
}

/** A value inside Shopify search syntax: quoted, with `\` and `"` escaped. */
export function searchValue(v: string): string {
  return `"${v.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const numericId = (id: string) => id.replace(/^gid:\/\/shopify\/\w+\//, '');

/**
 * The product search query for a selector (archived products are never touched). Resource-picker
 * selections are fetched by id instead and have no query.
 * https://shopify.dev/docs/api/admin-graphql/latest/queries/products#argument-query
 */
export function selectorSearchQuery(selector: ProductSelector): string | null {
  const live = '-status:archived';
  switch (selector.kind) {
    case 'collection':
      return `collection_id:${numericId(selector.collectionId)} ${live}`;
    case 'tag':
      return `tag:${searchValue(selector.tag)} ${live}`;
    case 'productType':
      return `product_type:${searchValue(selector.productType)} ${live}`;
    default:
      return null;
  }
}

export interface SelectionCount {
  count: number;
  precision: 'EXACT' | 'AT_LEAST';
}

export async function countSelection(client: AdminGraphqlClient, selector: ProductSelector): Promise<SelectionCount> {
  if (selector.kind === 'products') return { count: new Set(selector.productIds.map(productGid)).size, precision: 'EXACT' };
  const data = await client.request<{ productsCount: { count: number; precision: string } | null }>(PRODUCTS_COUNT_QUERY, { query: selectorSearchQuery(selector) });
  const c = data.productsCount;
  return { count: c?.count ?? 0, precision: c?.precision === 'AT_LEAST' ? 'AT_LEAST' : 'EXACT' };
}

export interface SelectionPage {
  targets: ChartTarget[];
  nextCursor: string | null;
}

/** Page size of one assign call: 100 products = 200 metafields = 8 `metafieldsSet` calls. */
export const ASSIGN_PAGE_SIZE = 100;

/**
 * One page of the selection. Picker selections (≤ 250 ids) are read in pages of `ASSIGN_PAGE_SIZE`
 * with a numeric offset cursor; searches use Shopify's cursor.
 */
export async function fetchSelectionPage(client: AdminGraphqlClient, selector: ProductSelector, cursor: string | null = null, first = ASSIGN_PAGE_SIZE): Promise<SelectionPage> {
  if (selector.kind === 'products') {
    const ids = [...new Set(selector.productIds.map(productGid))];
    const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    const slice = ids.slice(offset, offset + first);
    if (!slice.length) return { targets: [], nextCursor: null };
    const data = await client.request<{ nodes: Array<TargetNode | null> }>(CHART_TARGET_NODES_QUERY, { ids: slice, namespace: SHOPIFY_METAFIELD_NAMESPACE });
    const targets = data.nodes.map((n) => (n ? toTarget(n) : null)).filter((t): t is ChartTarget => t !== null && t.status !== 'ARCHIVED');
    return { targets, nextCursor: offset + first < ids.length ? String(offset + first) : null };
  }
  const data = await client.request<{ products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: TargetNode[] } }>(CHART_TARGETS_QUERY, {
    query: selectorSearchQuery(selector),
    cursor,
    first,
    namespace: SHOPIFY_METAFIELD_NAMESPACE,
  });
  const targets = data.products.nodes.map(toTarget).filter((t): t is ChartTarget => t !== null);
  return { targets, nextCursor: data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null };
}

export interface AssignResult {
  written: string[];
  skipped: Array<{ id: string; title: string; reason: string }>;
  failed: Array<{ id: string; message: string }>;
}

/** Products per `metafieldsSet` call (2 metafields each, Shopify's limit is 25 per call). */
const PRODUCTS_PER_CALL = 12;

/**
 * Write `chart` to each target. Targets that already have a chart are skipped unless `overwrite`.
 * A failing batch (userErrors, HTTP) is reported per product and does not stop the other batches.
 */
export async function assignChartToTargets(client: AdminGraphqlClient, targets: readonly ChartTarget[], chart: ChartInput, opts: { overwrite?: boolean } = {}): Promise<AssignResult> {
  const out: AssignResult = { written: [], skipped: [], failed: [] };
  const todo: ChartTarget[] = [];
  for (const t of targets) {
    if (t.hasChart && !opts.overwrite) out.skipped.push({ id: t.id, title: t.title, reason: 'already has a size chart' });
    else todo.push(t);
  }
  const payload = chartPayload(chart);
  for (let i = 0; i < todo.length; i += PRODUCTS_PER_CALL) {
    const batch = todo.slice(i, i + PRODUCTS_PER_CALL);
    try {
      await metafieldsSet(client, batch.flatMap((t) => toShopifyMetafields(payload, t.id)));
      out.written.push(...batch.map((t) => t.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.failed.push(...batch.map((t) => ({ id: t.id, message })));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One product: description import, checklist, preview link
// ---------------------------------------------------------------------------

export const PRODUCT_DETAIL_QUERY = /* GraphQL */ `
  query CurtainProductDetail($id: ID!, $namespace: String!) {
    product(id: $id) {
      ${PRODUCT_NODE_FIELDS}
      descriptionHtml
      onlineStorePreviewUrl
      options { name optionValues { name } }
    }
  }
`;

export type ProductDetailNode = ShopifyProductNode & {
  descriptionHtml?: string | null;
  onlineStorePreviewUrl?: string | null;
  options?: Array<{ name: string; optionValues?: Array<{ name: string }> | null }> | null;
};

export async function fetchProductDetail(client: AdminGraphqlClient, gidOrExternalId: string): Promise<ProductDetailNode | null> {
  const data = await client.request<{ product: ProductDetailNode | null }>(PRODUCT_DETAIL_QUERY, { id: productGid(gidOrExternalId), namespace: SHOPIFY_METAFIELD_NAMESPACE });
  return data.product;
}

// ---------------------------------------------------------------------------
// Onboarding state (AppInstallation metafield: the shop stays the source of truth, no db column)
// ---------------------------------------------------------------------------

export const ONBOARDING_METAFIELD_KEY = 'onboarding' as const;

export interface OnboardingState {
  templateId: string | null;
  themeBlockConfirmed: boolean;
  tested: boolean;
}

export const ONBOARDING_STATE_QUERY = /* GraphQL */ `
  query CurtainOnboarding($namespace: String!, $key: String!) {
    currentAppInstallation { id metafield(namespace: $namespace, key: $key) { value } }
  }
`;

export function parseOnboardingState(value: string | null | undefined): OnboardingState {
  const out: OnboardingState = { templateId: null, themeBlockConfirmed: false, tested: false };
  if (!value) return out;
  try {
    const v = JSON.parse(value) as Record<string, unknown>;
    if (typeof v.templateId === 'string' && /^[a-z0-9-]{1,64}$/.test(v.templateId)) out.templateId = v.templateId;
    out.themeBlockConfirmed = v.themeBlockConfirmed === true;
    out.tested = v.tested === true;
  } catch {
    /* a hand-edited value: start over */
  }
  return out;
}

export async function readOnboardingState(client: AdminGraphqlClient): Promise<OnboardingState & { installationId: string }> {
  const data = await client.request<{ currentAppInstallation: { id: string; metafield: { value: string } | null } }>(ONBOARDING_STATE_QUERY, {
    namespace: APP_DATA_NAMESPACE,
    key: ONBOARDING_METAFIELD_KEY,
  });
  return { ...parseOnboardingState(data.currentAppInstallation.metafield?.value), installationId: data.currentAppInstallation.id };
}

/** Merge `patch` into the stored state and write it back (one read, one `metafieldsSet`). */
export async function updateOnboardingState(client: AdminGraphqlClient, patch: Partial<OnboardingState>): Promise<OnboardingState> {
  const { installationId, ...current } = await readOnboardingState(client);
  const next: OnboardingState = { ...current };
  if (patch.templateId !== undefined) next.templateId = patch.templateId;
  if (patch.themeBlockConfirmed !== undefined) next.themeBlockConfirmed = patch.themeBlockConfirmed;
  if (patch.tested !== undefined) next.tested = patch.tested;
  await metafieldsSet(client, [{ ownerId: installationId, namespace: APP_DATA_NAMESPACE, key: ONBOARDING_METAFIELD_KEY, type: 'json', value: JSON.stringify(next) }]);
  return next;
}
