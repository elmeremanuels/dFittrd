import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN, PRODUCT_GID, SHOP, fetchMock, wrapDressJsonl } from '../test/fixtures';
import { createAdminClient } from './client';
import {
  BulkOperationError,
  bulkProductsQuery,
  cancelBulkOperation,
  getBulkOperation,
  parseBulkJsonl,
  runProductBackfill,
  startBulkProductExport,
  waitForBulkOperation,
  type BulkOperation,
} from './bulk';

const client = (m: ReturnType<typeof fetchMock>) => createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });
const op = (status: BulkOperation['status'], extra: Partial<BulkOperation> = {}): BulkOperation => ({
  id: 'gid://shopify/BulkOperation/1',
  status,
  errorCode: null,
  createdAt: '2026-11-04T10:00:00Z',
  completedAt: null,
  objectCount: '0',
  fileSize: null,
  url: null,
  partialDataUrl: null,
  ...extra,
});

describe('bulk query document', () => {
  it('respects the bulk restrictions: ≤5 connections, 2 levels, no node/nodes root, our namespace', () => {
    const q = bulkProductsQuery();
    const connections = (q.match(/edges\s*\{/g) ?? []).length;
    expect(connections).toBeLessThanOrEqual(5);
    expect(q).not.toMatch(/^\s*\{\s*nodes?\(/);
    expect(q).toContain('metafields(namespace: "$app:paskamer")');
    expect(q).toContain('products(query: "status:active")');
    expect(bulkProductsQuery('$app:paskamer', 'tag:"a b"')).toContain('products(query: "tag:\\"a b\\"")');
  });
});

describe('parseBulkJsonl', () => {
  it('folds children onto their product by __parentId', () => {
    const r = parseBulkJsonl(wrapDressJsonl());
    expect(r.skipped).toEqual([]);
    expect(r.products).toHaveLength(1);
    const p = r.products[0]!;
    expect(p.id).toBe(PRODUCT_GID);
    expect(p.images?.nodes?.map((i) => i.url)).toEqual(['https://cdn.shopify.com/s/files/1/aalter/wrap-1.jpg', 'https://cdn.shopify.com/s/files/1/aalter/wrap-2.jpg']);
    expect(p.variants?.nodes?.[0]).toEqual({ price: '149.00', selectedOptions: [{ name: 'Size', value: 'S' }] });
    expect(p.metafields?.nodes?.find((mf) => mf.key === 'size_chart_type')?.value).toBe('body');
    expect(p.metafields?.nodes).toHaveLength(16);
  });

  it('skips orphans, unknown types and garbage lines without throwing', () => {
    const text = [
      'not json',
      JSON.stringify({ id: 'gid://shopify/ProductImage/9', url: 'x', __parentId: 'gid://shopify/Product/404' }),
      JSON.stringify({ id: 'gid://shopify/Product/1', title: 'A' }),
      JSON.stringify({ id: 'gid://shopify/Collection/5', __parentId: 'gid://shopify/Product/1' }),
      JSON.stringify({ id: 'gid://shopify/MediaImage/3', url: 'https://cdn/x.jpg', __parentId: 'gid://shopify/Product/1' }),
      '',
    ].join('\n');
    const r = parseBulkJsonl(text);
    expect(r.products).toHaveLength(1);
    expect(r.products[0]!.images?.nodes).toEqual([{ url: 'https://cdn/x.jpg' }]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['invalid JSON', 'orphan child of gid://shopify/Product/404', 'unknown child type gid://shopify/Collection/5']);
  });

  it('handles an empty export', () => {
    expect(parseBulkJsonl('')).toEqual({ products: [], skipped: [] });
  });
});

describe('bulk operation lifecycle', () => {
  it('start → poll via node(id:) → download → parse', async () => {
    const waits: number[] = [];
    const m = fetchMock()
      .data({ bulkOperationRunQuery: { bulkOperation: op('CREATED'), userErrors: [] } })
      .data({ node: op('RUNNING', { objectCount: '3' }) })
      .data({ node: op('COMPLETED', { objectCount: '20', url: 'https://storage.example/export.jsonl', completedAt: '2026-11-04T10:01:00Z' }) })
      .reply({ text: wrapDressJsonl() });
    const r = await runProductBackfill(client(m), { sleep: async (ms) => void waits.push(ms), pollMs: 1000, fetch: m.fetch });
    expect(r.products).toHaveLength(1);
    expect(r.operation.status).toBe('COMPLETED');
    expect(waits).toEqual([1000]);
    expect(m.query(0)).toContain('bulkOperationRunQuery');
    expect(m.variables(1)).toEqual({ id: 'gid://shopify/BulkOperation/1' });
    expect(m.query(1)).toContain('node(id: $id)');
    expect(m.calls[3]!.url).toBe('https://storage.example/export.jsonl');
    expect(m.calls[3]!.headers['x-shopify-access-token']).toBeUndefined();
  });

  it('an empty catalogue completes with url null and yields no products', async () => {
    const m = fetchMock().data({ bulkOperationRunQuery: { bulkOperation: op('CREATED'), userErrors: [] } }).data({ node: op('COMPLETED') });
    const r = await runProductBackfill(client(m), { sleep: async () => {} });
    expect(r.products).toEqual([]);
    expect(m.calls).toHaveLength(2);
  });

  it('userErrors on start (e.g. an operation already running) throw', async () => {
    const m = fetchMock().data({ bulkOperationRunQuery: { bulkOperation: null, userErrors: [{ field: null, message: 'A bulk query operation for this app and shop is already in progress' }] } });
    await expect(startBulkProductExport(client(m))).rejects.toThrow(/already in progress/);
  });

  it('FAILED / CANCELED / timeout surface as BulkOperationError with the operation attached', async () => {
    const failed = fetchMock().data({ node: op('FAILED', { errorCode: 'ACCESS_DENIED' }) });
    await expect(waitForBulkOperation(client(failed), 'gid://shopify/BulkOperation/1', { sleep: async () => {} })).rejects.toMatchObject({ name: 'BulkOperationError', operation: { errorCode: 'ACCESS_DENIED' } });

    const slow = fetchMock().data({ node: op('RUNNING') });
    await expect(waitForBulkOperation(client(slow), 'gid://shopify/BulkOperation/1', { sleep: async () => {}, pollMs: 1000, timeoutMs: 2500 })).rejects.toThrow(/still RUNNING after 2500 ms/);
    expect(slow.calls).toHaveLength(4);

    const gone = fetchMock().data({ node: null });
    expect(await getBulkOperation(client(gone), 'gid://shopify/BulkOperation/1')).toBeNull();
    await expect(waitForBulkOperation(client(gone), 'gid://shopify/BulkOperation/1')).rejects.toBeInstanceOf(BulkOperationError);
  });

  it('cancel passes the id through', async () => {
    const m = fetchMock().data({ bulkOperationCancel: { bulkOperation: op('CANCELING'), userErrors: [] } });
    await cancelBulkOperation(client(m), 'gid://shopify/BulkOperation/1');
    expect(m.variables()).toEqual({ id: 'gid://shopify/BulkOperation/1' });
  });
});
