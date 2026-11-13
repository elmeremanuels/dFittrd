import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN, SHOP, fetchMock } from '../test/fixtures';
import { adminGraphqlUrl, assertNoUserErrors, createAdminClient, ShopifyGraphqlError, throttleDelaySeconds } from './client';

const Q = 'query { shop { name } }';

describe('createAdminClient', () => {
  it('posts to the versioned admin endpoint with the access token header', async () => {
    const m = fetchMock().data({ shop: { name: 'Aalter' } });
    const c = createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });
    const data = await c.request<{ shop: { name: string } }>(Q, { a: 1 });
    expect(data.shop.name).toBe('Aalter');
    expect(c.url).toBe(`https://${SHOP}/admin/api/2026-10/graphql.json`);
    expect(m.last().url).toBe(c.url);
    expect(m.last().headers['x-shopify-access-token']).toBe(ACCESS_TOKEN);
    expect(m.last().headers['content-type']).toBe('application/json');
    expect(m.last().body).toEqual({ query: Q, variables: { a: 1 } });
  });

  it('honours apiVersion and a custom URL template', () => {
    expect(adminGraphqlUrl(SHOP, '2026-01')).toBe(`https://${SHOP}/admin/api/2026-01/graphql.json`);
    const c = createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, apiVersion: '2026-01', adminUrlTemplate: 'http://localhost:9999/{shop}/{version}', fetch: fetchMock().fetch });
    expect(c.url).toBe(`http://localhost:9999/${SHOP}/2026-01`);
  });

  it('rejects non-Shopify domains up front', () => {
    expect(() => createAdminClient({ shopDomain: 'evil.example.com', accessToken: ACCESS_TOKEN, fetch: fetchMock().fetch })).toThrow(ShopifyGraphqlError);
  });

  it('throws graphql errors with code', async () => {
    const m = fetchMock().reply({ json: { errors: [{ message: 'Field x does not exist' }] } });
    const c = createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });
    await expect(c.request(Q)).rejects.toMatchObject({ name: 'ShopifyGraphqlError', code: 'graphql', message: 'Field x does not exist' });
  });

  it('retries THROTTLED using the cost extension, then succeeds', async () => {
    const waits: number[] = [];
    const m = fetchMock()
      .reply({
        json: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }], extensions: { cost: { requestedQueryCost: 120, throttleStatus: { currentlyAvailable: 20, restoreRate: 50 } } } },
      })
      .data({ ok: true });
    const c = createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch, sleep: async (ms) => void waits.push(ms) });
    await expect(c.request(Q)).resolves.toEqual({ ok: true });
    expect(waits).toEqual([2000]);
    expect(m.calls).toHaveLength(2);
  });

  it('retries 429 with Retry-After and 5xx once, then gives up after maxRetries', async () => {
    const waits: number[] = [];
    const m = fetchMock().reply({ status: 429, json: {}, headers: { 'retry-after': '3' } }, { status: 502, text: 'bad gateway' }, { status: 503, text: 'nope' });
    const c = createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch, sleep: async (ms) => void waits.push(ms), maxRetries: 2 });
    await expect(c.request(Q)).rejects.toMatchObject({ code: 'http', status: 503 });
    expect(waits).toEqual([3000, 1000]);
  });

  it('does not retry 401 (unauthorized) or 400', async () => {
    const m = fetchMock().reply({ status: 401, json: { errors: 'Invalid API key or access token' } });
    const c = createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });
    await expect(c.request(Q)).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    expect(m.calls).toHaveLength(1);
  });

  it('reports non-JSON and empty data', async () => {
    const m = fetchMock().reply({ status: 200, text: '<html>maintenance</html>' });
    const c = createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });
    await expect(c.request(Q)).rejects.toMatchObject({ code: 'non_json' });
    const m2 = fetchMock().reply({ json: { data: null } });
    const c2 = createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m2.fetch });
    await expect(c2.request(Q)).rejects.toMatchObject({ code: 'empty' });
  });

  it('throttleDelaySeconds never returns < 1 and scales with the deficit', () => {
    expect(throttleDelaySeconds(undefined)).toBe(1);
    expect(throttleDelaySeconds({ cost: { requestedQueryCost: 1000, throttleStatus: { currentlyAvailable: 0, restoreRate: 100 } } })).toBe(10);
  });

  it('assertNoUserErrors formats field paths', () => {
    expect(() => assertNoUserErrors([], 'x')).not.toThrow();
    expect(() => assertNoUserErrors([{ field: ['definition', 'key'], message: 'is taken' }], 'metafieldDefinitionCreate')).toThrow('metafieldDefinitionCreate: definition.key: is taken');
  });
});
