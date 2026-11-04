/** Test harness: PGlite + MemoryQueue + MockProvider; every suite gets a fresh database. */
import { MockProvider, TryOnRouter, type TryOnProvider } from '@paskamer/tryon-providers';
import { build, type App } from '../app.js';
import { connectPglite, type DbHandle } from '../db/client.js';
import { testEnv, type Env } from '../env.js';
import { MemoryQueue } from '../jobs/queue.js';
import type { FetchLike } from '../context.js';
import type { LookupLike } from '../lib/safeFetch.js';
import { createShop, issueMerchantKeys, type ShopRow } from '../services/shops.js';
import { upsertProduct } from '../services/products.js';
import { MOCK_GARMENTS_BY_ID } from '@paskamer/schema';

export interface TestApp {
  app: App;
  env: Env;
  handle: DbHandle;
  queue: MemoryQueue;
  fetchMock: FetchMock;
  close(): Promise<void>;
}

export type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export class FetchMock {
  readonly calls: Array<{ url: string; init?: RequestInit }> = [];
  private handlers: Array<{ test: (url: string) => boolean; handler: FetchHandler }> = [];
  on(test: string | RegExp | ((url: string) => boolean), handler: FetchHandler): this {
    const fn = typeof test === 'string' ? (u: string) => u.startsWith(test) : test instanceof RegExp ? (u: string) => test.test(u) : test;
    this.handlers.push({ test: fn, handler });
    return this;
  }
  reset(): void {
    this.handlers = [];
    this.calls.length = 0;
  }
  readonly fetch: FetchLike = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    this.calls.push({ url, ...(init ? { init } : {}) });
    const h = this.handlers.find((x) => x.test(url));
    if (!h) return new Response('not mocked', { status: 599 });
    return h.handler(url, init);
  }) as FetchLike;
}

export const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Offline DNS for the SSRF guard: `*.internal.test` resolves privately, everything else to a public address. */
export const testLookup: LookupLike = async (hostname) => {
  if (hostname.endsWith('.internal.test')) return [{ address: '10.0.0.5', family: 4 }];
  if (hostname === 'nxdomain.test') throw new Error('ENOTFOUND');
  return [{ address: '93.184.216.34', family: 4 }];
};

export async function makeApp(envOverrides: Record<string, string> = {}, opts: { providers?: TryOnProvider[]; now?: () => Date } = {}): Promise<TestApp> {
  const env = testEnv(envOverrides);
  const handle = await connectPglite();
  await handle.migrate();
  const queue = new MemoryQueue();
  const fetchMock = new FetchMock();
  const providers = opts.providers ?? [new MockProvider({ video: true, latencyMs: 1 })];
  const tryon = new TryOnRouter({ providers, policy: { order: providers.map((p) => p.name), maxCostUsd: 1 } });
  const app = await build({ env, db: handle.db, queue, fetch: fetchMock.fetch, lookup: testLookup, tryon, ...(opts.now ? { now: opts.now } : {}) });
  await app.ready();
  await queue.start({ work: false });
  return {
    app,
    env,
    handle,
    queue,
    fetchMock,
    async close() {
      await app.close();
      await handle.close();
    },
  };
}

export async function createDevice(t: TestApp): Promise<{ deviceId: string; token: string; auth: Record<string, string> }> {
  const res = await t.app.inject({ method: 'POST', url: '/v1/devices', payload: { platform: 'web', appVersion: '0.1.0' } });
  if (res.statusCode !== 201) throw new Error(`device create failed: ${res.body}`);
  const body = res.json<{ deviceId: string; token: string }>();
  return { deviceId: body.deviceId, token: body.token, auth: { authorization: `Bearer ${body.token}` } };
}

export async function seedShop(
  t: TestApp,
  input: { platform?: 'shopify' | 'woocommerce'; domain?: string; name?: string; products?: string[]; plan?: 'free' | 'starter' | 'pro' } = {},
): Promise<{ shop: ShopRow; apiKey: string; publicKeyPrefix: string; productIds: Record<string, string> }> {
  const shop = await createShop(t.handle.db, {
    platform: input.platform ?? 'woocommerce',
    domain: input.domain ?? `shop-${Math.random().toString(36).slice(2, 8)}.example`,
    name: input.name ?? 'Aalter Studio',
    plan: input.plan ?? 'starter',
    settings: { brandColor: '#FF5A3C' },
  });
  const { keys } = await issueMerchantKeys(t.handle.db, t.env, shop);
  const productIds: Record<string, string> = {};
  for (const id of input.products ?? ['aalter-studio-1', 'monochrome-02', 'raw-denim-01']) {
    const g = MOCK_GARMENTS_BY_ID[id];
    if (!g) throw new Error(`no fixture ${id}`);
    const r = await upsertProduct(t.handle.db, shop.id, id, g);
    productIds[id] = r.product.id;
  }
  const fresh = (await t.handle.db.query.shops.findFirst({ where: (s, { eq }) => eq(s.id, shop.id) }))!;
  return { shop: fresh, apiKey: keys.apiKey, publicKeyPrefix: keys.publicKeyPrefix, productIds };
}
