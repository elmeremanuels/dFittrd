import { AU_WOMENS_BODY_TEMPLATE, SHOPIFY_METAFIELD_NAMESPACE, chartFromBodyTemplate } from '@curtain/schema';
import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN, SHOP, fetchMock, wrapDressNode } from '../test/fixtures';
import {
  assignChartToTargets,
  countSelection,
  fetchProductDetail,
  fetchSelectionPage,
  parseOnboardingState,
  readOnboardingState,
  searchValue,
  selectorSearchQuery,
  updateOnboardingState,
  type ChartTarget,
} from './charts';
import { createAdminClient } from './client';

const client = (m: ReturnType<typeof fetchMock>) => createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch, maxRetries: 0 });
const chart = chartFromBodyTemplate(AU_WOMENS_BODY_TEMPLATE, ['8', '10', '12']);
const target = (n: number, hasChart = false): ChartTarget => ({ id: `gid://shopify/Product/${n}`, title: `P${n}`, status: 'ACTIVE', hasChart });
type SetVars = { metafields: Array<{ ownerId: string; namespace: string; key: string; type: string; value: string }> };

describe('chart selection', () => {
  it('builds Shopify search queries for collection, tag and product type (quoted, escaped, never archived)', () => {
    expect(selectorSearchQuery({ kind: 'collection', collectionId: 'gid://shopify/Collection/42' })).toBe('collection_id:42 -status:archived');
    expect(selectorSearchQuery({ kind: 'tag', tag: 'boho "maxi"' })).toBe('tag:"boho \\"maxi\\"" -status:archived');
    expect(selectorSearchQuery({ kind: 'productType', productType: 'Dresses' })).toBe('product_type:"Dresses" -status:archived');
    expect(selectorSearchQuery({ kind: 'products', productIds: ['1'] })).toBeNull();
    expect(searchValue('a\\b')).toBe('"a\\\\b"');
  });

  it('counts a search with productsCount and a picker selection locally', async () => {
    const m = fetchMock().data({ productsCount: { count: 37, precision: 'EXACT' } });
    expect(await countSelection(client(m), { kind: 'tag', tag: 'maxi' })).toEqual({ count: 37, precision: 'EXACT' });
    expect(m.query()).toContain('productsCount(query: $query');
    expect(m.variables()).toEqual({ query: 'tag:"maxi" -status:archived' });
    const none = fetchMock();
    expect(await countSelection(client(none), { kind: 'products', productIds: ['1', 'gid://shopify/Product/1', '2'] })).toEqual({ count: 2, precision: 'EXACT' });
    expect(none.calls).toHaveLength(0);
  });

  it('pages a search and marks products that already have a chart', async () => {
    const m = fetchMock().data({
      products: {
        pageInfo: { hasNextPage: true, endCursor: 'c1' },
        nodes: [
          { id: 'gid://shopify/Product/1', title: 'Maxi', status: 'ACTIVE', sizeChart: null },
          { id: 'gid://shopify/Product/2', title: 'Midi', status: 'DRAFT', sizeChart: { id: 'gid://shopify/Metafield/9' } },
        ],
      },
    });
    const page = await fetchSelectionPage(client(m), { kind: 'collection', collectionId: '42' });
    expect(page).toEqual({
      targets: [
        { id: 'gid://shopify/Product/1', title: 'Maxi', status: 'ACTIVE', hasChart: false },
        { id: 'gid://shopify/Product/2', title: 'Midi', status: 'DRAFT', hasChart: true },
      ],
      nextCursor: 'c1',
    });
    expect(m.variables()).toEqual({ query: 'collection_id:42 -status:archived', cursor: null, first: 100, namespace: SHOPIFY_METAFIELD_NAMESPACE });
  });

  it('reads picker selections by id with an offset cursor and drops archived or foreign nodes', async () => {
    const m = fetchMock().data(
      { nodes: [{ id: 'gid://shopify/Product/1', title: 'A', status: 'ACTIVE', sizeChart: null }, null] },
      { nodes: [{ id: 'gid://shopify/Product/3', title: 'C', status: 'ARCHIVED', sizeChart: null }] },
    );
    const sel = { kind: 'products' as const, productIds: ['1', '2', '3'] };
    const p1 = await fetchSelectionPage(client(m), sel, null, 2);
    expect(p1.targets.map((t) => t.id)).toEqual(['gid://shopify/Product/1']);
    expect(p1.nextCursor).toBe('2');
    expect(m.variables()).toEqual({ ids: ['gid://shopify/Product/1', 'gid://shopify/Product/2'], namespace: SHOPIFY_METAFIELD_NAMESPACE });
    const p2 = await fetchSelectionPage(client(m), sel, p1.nextCursor, 2);
    expect(p2).toEqual({ targets: [], nextCursor: null });
  });
});

describe('assignChartToTargets (write path)', () => {
  it('writes size_chart_type + size_chart for each product, 12 products per metafieldsSet, skipping charted products', async () => {
    const m = fetchMock().reply((call) => {
      const mf = (call.body as { variables: SetVars }).variables.metafields;
      return { json: { data: { metafieldsSet: { metafields: mf.map((x, i) => ({ id: `gid://shopify/Metafield/${i}`, key: x.key, namespace: x.namespace, ownerType: 'PRODUCT' })), userErrors: [] } } } };
    });
    const targets = [...Array.from({ length: 14 }, (_, i) => target(i + 1)), target(99, true)];
    const r = await assignChartToTargets(client(m), targets, chart);
    expect(r.written).toHaveLength(14);
    expect(r.skipped).toEqual([{ id: 'gid://shopify/Product/99', title: 'P99', reason: 'already has a size chart' }]);
    expect(r.failed).toEqual([]);
    expect(m.calls).toHaveLength(2);
    const first = m.variables<SetVars>(0).metafields;
    expect(first).toHaveLength(24);
    expect(first.slice(0, 2)).toEqual([
      { ownerId: 'gid://shopify/Product/1', namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
      { ownerId: 'gid://shopify/Product/1', namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify(chart.sizeChart) },
    ]);
    expect(m.query(0)).toContain('metafieldsSet');
  });

  it('overwrites when asked, and reports a failing batch per product without stopping', async () => {
    const m = fetchMock().reply(
      { json: { data: { metafieldsSet: { metafields: null, userErrors: [{ field: ['metafields', '0'], message: 'Owner does not exist', code: 'INVALID' }] } } } },
      { json: { data: { metafieldsSet: { metafields: [], userErrors: [] } } } },
    );
    const targets = [...Array.from({ length: 12 }, (_, i) => target(i + 1, true)), target(13, true)];
    const r = await assignChartToTargets(client(m), targets, chart, { overwrite: true });
    expect(r.failed).toHaveLength(12);
    expect(r.failed[0]!.message).toMatch(/Owner does not exist/);
    expect(r.written).toEqual(['gid://shopify/Product/13']);
    expect(r.skipped).toEqual([]);
  });
});

describe('product detail and onboarding state', () => {
  it('fetches the description, preview URL and options with the product fields', async () => {
    const m = fetchMock().data({ product: { ...wrapDressNode(), descriptionHtml: '<p>Hi</p>', onlineStorePreviewUrl: null, options: [] } });
    const p = await fetchProductDetail(client(m), '8213455001');
    expect(p?.descriptionHtml).toBe('<p>Hi</p>');
    expect(m.query()).toMatch(/descriptionHtml[\s\S]*onlineStorePreviewUrl[\s\S]*optionValues/);
    expect(m.variables()).toEqual({ id: 'gid://shopify/Product/8213455001', namespace: SHOPIFY_METAFIELD_NAMESPACE });
  });

  it('parses stored state defensively', () => {
    expect(parseOnboardingState(null)).toEqual({ templateId: null, themeBlockConfirmed: false, tested: false });
    expect(parseOnboardingState('{bad')).toEqual({ templateId: null, themeBlockConfirmed: false, tested: false });
    expect(parseOnboardingState(JSON.stringify({ templateId: '<script>', tested: true }))).toEqual({ templateId: null, themeBlockConfirmed: false, tested: true });
  });

  it('reads and merges the AppInstallation metafield (write path)', async () => {
    const m = fetchMock().data(
      { currentAppInstallation: { id: 'gid://shopify/AppInstallation/7', metafield: { value: JSON.stringify({ templateId: 'au-womens-body', themeBlockConfirmed: false, tested: false }) } } },
      { metafieldsSet: { metafields: [{ id: 'm', key: 'onboarding', namespace: 'curtain', ownerType: 'APP_INSTALLATION' }], userErrors: [] } },
    );
    const next = await updateOnboardingState(client(m), { themeBlockConfirmed: true });
    expect(next).toEqual({ templateId: 'au-womens-body', themeBlockConfirmed: true, tested: false });
    expect(m.variables(0)).toEqual({ namespace: 'curtain', key: 'onboarding' });
    expect(m.variables<SetVars>(1).metafields).toEqual([
      { ownerId: 'gid://shopify/AppInstallation/7', namespace: 'curtain', key: 'onboarding', type: 'json', value: JSON.stringify(next) },
    ]);
    const r = fetchMock().data({ currentAppInstallation: { id: 'gid://shopify/AppInstallation/7', metafield: null } });
    expect(await readOnboardingState(client(r))).toEqual({ installationId: 'gid://shopify/AppInstallation/7', templateId: null, themeBlockConfirmed: false, tested: false });
  });
});
