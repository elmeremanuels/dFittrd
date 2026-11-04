/**
 * Catalogue backfill with `bulkOperationRunQuery` (D6): one operation exports every product with
 * its images, variants and `$app:paskamer` metafields as JSONL; `parseBulkJsonl` folds the flat
 * lines back into `ShopifyProductNode`s (children carry `__parentId`).
 *
 * Polling uses `node(id:)` rather than the deprecated `currentBulkOperation`, so it works on
 * 2025-xx and 2026-01+ alike.
 */
import { SHOPIFY_METAFIELD_NAMESPACE, type ShopifyProductNode } from '@paskamer/schema';
import { defaultSleep, type FetchLike, type SleepFn } from '../types';
import { assertNoUserErrors, ShopifyGraphqlError, type AdminGraphqlClient, type UserError } from './client';

export const BULK_OPERATION_STATUSES = ['CREATED', 'RUNNING', 'COMPLETED', 'CANCELING', 'CANCELED', 'FAILED', 'EXPIRED'] as const;
export type BulkOperationStatus = (typeof BULK_OPERATION_STATUSES)[number];

export interface BulkOperation {
  id: string;
  status: BulkOperationStatus;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  objectCount: string | number;
  fileSize: string | number | null;
  url: string | null;
  partialDataUrl: string | null;
}

/**
 * Bulk query: at most five connections, two levels deep, no `node`/`nodes` root. `first:` is
 * ignored in bulk mode but kept so the same document validates in the explorer.
 */
export function bulkProductsQuery(namespace: string = SHOPIFY_METAFIELD_NAMESPACE, query = 'status:active'): string {
  const q = query.replace(/"/g, '\\"');
  return /* GraphQL */ `
  {
    products(query: "${q}") {
      edges {
        node {
          id
          handle
          title
          vendor
          productType
          status
          onlineStoreUrl
          category { name fullName }
          featuredImage { url }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
          images { edges { node { id url } } }
          variants { edges { node { id price selectedOptions { name value } } } }
          metafields(namespace: "${namespace}") { edges { node { id namespace key type value } } }
        }
      }
    }
  }`;
}

export const BULK_OPERATION_RUN_QUERY = /* GraphQL */ `
  mutation PaskamerBulkExport($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status errorCode createdAt completedAt objectCount fileSize url partialDataUrl }
      userErrors { field message }
    }
  }
`;

export const BULK_OPERATION_STATUS_QUERY = /* GraphQL */ `
  query PaskamerBulkStatus($id: ID!) {
    node(id: $id) {
      ... on BulkOperation { id status errorCode createdAt completedAt objectCount fileSize url partialDataUrl }
    }
  }
`;

export const BULK_OPERATION_CANCEL = /* GraphQL */ `
  mutation PaskamerBulkCancel($id: ID!) {
    bulkOperationCancel(id: $id) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

export async function startBulkProductExport(client: AdminGraphqlClient, query = 'status:active'): Promise<BulkOperation> {
  const data = await client.request<{ bulkOperationRunQuery: { bulkOperation: BulkOperation | null; userErrors: UserError[] } }>(BULK_OPERATION_RUN_QUERY, {
    query: bulkProductsQuery(SHOPIFY_METAFIELD_NAMESPACE, query),
  });
  assertNoUserErrors(data.bulkOperationRunQuery.userErrors, 'bulkOperationRunQuery');
  if (!data.bulkOperationRunQuery.bulkOperation) throw new ShopifyGraphqlError('bulkOperationRunQuery returned no operation', 'empty');
  return data.bulkOperationRunQuery.bulkOperation;
}

export async function getBulkOperation(client: AdminGraphqlClient, id: string): Promise<BulkOperation | null> {
  const data = await client.request<{ node: BulkOperation | null }>(BULK_OPERATION_STATUS_QUERY, { id });
  return data.node && 'status' in data.node ? data.node : null;
}

export async function cancelBulkOperation(client: AdminGraphqlClient, id: string): Promise<void> {
  const data = await client.request<{ bulkOperationCancel: { userErrors: UserError[] } }>(BULK_OPERATION_CANCEL, { id });
  assertNoUserErrors(data.bulkOperationCancel.userErrors, 'bulkOperationCancel');
}

export const TERMINAL_BULK_STATUSES: ReadonlySet<BulkOperationStatus> = new Set(['COMPLETED', 'CANCELED', 'FAILED', 'EXPIRED']);

export class BulkOperationError extends Error {
  constructor(
    message: string,
    public readonly operation: BulkOperation | null,
  ) {
    super(message);
    this.name = 'BulkOperationError';
  }
}

export interface WaitOptions {
  pollMs?: number;
  timeoutMs?: number;
  sleep?: SleepFn;
  onPoll?: (op: BulkOperation) => void;
}

/** Poll until terminal. Resolves with the COMPLETED operation (url may be null for an empty catalogue). */
export async function waitForBulkOperation(client: AdminGraphqlClient, id: string, opts: WaitOptions = {}): Promise<BulkOperation> {
  const pollMs = opts.pollMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const sleep = opts.sleep ?? defaultSleep;
  let waited = 0;
  for (;;) {
    const op = await getBulkOperation(client, id);
    if (!op) throw new BulkOperationError(`bulk operation ${id} not found`, null);
    opts.onPoll?.(op);
    if (op.status === 'COMPLETED') return op;
    if (TERMINAL_BULK_STATUSES.has(op.status)) throw new BulkOperationError(`bulk operation ${id} ended with ${op.status}${op.errorCode ? ` (${op.errorCode})` : ''}`, op);
    if (waited >= timeoutMs) throw new BulkOperationError(`bulk operation ${id} still ${op.status} after ${timeoutMs} ms`, op);
    await sleep(pollMs);
    waited += pollMs;
  }
}

/** Download the JSONL file (the URL is a short-lived signed URL; no auth header needed). */
export async function downloadBulkResult(url: string, fetchImpl: FetchLike = globalThis.fetch as FetchLike): Promise<string> {
  const res = await fetchImpl(url, { method: 'GET' });
  if (!res.ok) throw new BulkOperationError(`bulk result download failed (${res.status})`, null);
  return res.text();
}

// ---------------------------------------------------------------------------
// JSONL → product nodes
// ---------------------------------------------------------------------------

type JsonlLine = { id?: string; __parentId?: string } & Record<string, unknown>;

interface Assembled {
  node: ShopifyProductNode & { images: { nodes: Array<{ url?: string }> }; variants: { nodes: Array<{ price?: string; selectedOptions?: Array<{ name: string; value: string }> }> }; metafields: { nodes: Array<{ namespace?: string; key: string; type?: string; value?: string | null }> } };
}

export interface BulkParseResult {
  products: ShopifyProductNode[];
  /** Lines that could not be parsed or attached (kept for logs, never thrown). */
  skipped: Array<{ line: number; reason: string }>;
}

function kindOf(id: string | undefined): 'product' | 'image' | 'variant' | 'metafield' | 'unknown' {
  if (!id) return 'unknown';
  if (id.startsWith('gid://shopify/Product/')) return 'product';
  if (id.startsWith('gid://shopify/ProductImage/') || id.startsWith('gid://shopify/MediaImage/')) return 'image';
  if (id.startsWith('gid://shopify/ProductVariant/')) return 'variant';
  if (id.startsWith('gid://shopify/Metafield/')) return 'metafield';
  return 'unknown';
}

/** Fold the flat JSONL export into product nodes shaped like `PRODUCT_QUERY` results. */
export function parseBulkJsonl(text: string): BulkParseResult {
  const byId = new Map<string, Assembled>();
  const order: string[] = [];
  const skipped: BulkParseResult['skipped'] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let obj: JsonlLine;
    try {
      obj = JSON.parse(line) as JsonlLine;
    } catch {
      skipped.push({ line: i + 1, reason: 'invalid JSON' });
      return;
    }
    const kind = kindOf(obj.id);
    if (kind === 'product' && !obj.__parentId) {
      const { id, ...rest } = obj;
      const node = { ...rest, id: id!, images: { nodes: [] }, variants: { nodes: [] }, metafields: { nodes: [] } } as unknown as Assembled['node'];
      byId.set(id!, { node });
      order.push(id!);
      return;
    }
    const parent = obj.__parentId ? byId.get(obj.__parentId) : undefined;
    if (!parent) {
      skipped.push({ line: i + 1, reason: obj.__parentId ? `orphan child of ${obj.__parentId}` : `unexpected root ${obj.id ?? '(no id)'}` });
      return;
    }
    switch (kind) {
      case 'image':
        parent.node.images.nodes.push({ url: typeof obj.url === 'string' ? obj.url : undefined });
        break;
      case 'variant':
        parent.node.variants.nodes.push({
          price: typeof obj.price === 'string' || typeof obj.price === 'number' ? String(obj.price) : undefined,
          selectedOptions: Array.isArray(obj.selectedOptions) ? (obj.selectedOptions as Array<{ name: string; value: string }>) : undefined,
        });
        break;
      case 'metafield':
        parent.node.metafields.nodes.push({
          namespace: typeof obj.namespace === 'string' ? obj.namespace : undefined,
          key: String(obj.key ?? ''),
          type: typeof obj.type === 'string' ? obj.type : undefined,
          value: typeof obj.value === 'string' ? obj.value : null,
        });
        break;
      default:
        skipped.push({ line: i + 1, reason: `unknown child type ${obj.id ?? '(no id)'}` });
    }
  });
  return { products: order.map((id) => byId.get(id)!.node), skipped };
}

/** Convenience: start → wait → download → parse. Returns an empty list for an empty catalogue. */
export async function runProductBackfill(
  client: AdminGraphqlClient,
  opts: WaitOptions & { fetch?: FetchLike; query?: string } = {},
): Promise<BulkParseResult & { operation: BulkOperation }> {
  const started = await startBulkProductExport(client, opts.query);
  const operation = await waitForBulkOperation(client, started.id, opts);
  if (!operation.url) return { products: [], skipped: [], operation };
  const text = await downloadBulkResult(operation.url, opts.fetch);
  return { ...parseBulkJsonl(text), operation };
}
