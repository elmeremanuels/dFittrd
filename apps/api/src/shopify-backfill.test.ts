/**
 * Repair R1 of the merchant-settings inventory: one product that cannot be stored must not stop a
 * Shopify backfill page or the pages after it. Slice 1 step 4: a product whose fabric has only a
 * name goes through the sync, and what the upsert did with incomplete data is logged.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from './app.js';
import { products } from './db/schema.js';
import { JOB } from './jobs/queue.js';
import { makeBackfillHandler, makeSyncShopifyProductHandler } from './jobs/syncShopifyProduct.js';
import { makeApp, seedShop, type TestApp } from './test/helpers.js';

const SHOP = 'backfill.myshopify.com';

const node = (n: number, over: { title?: string; fabric?: object | null } = {}) => ({
  id: `gid://shopify/Product/${n}`,
  handle: `product-${n}`,
  title: over.title ?? `Linen dress ${n}`,
  vendor: 'Aalter Studio',
  productType: 'Dress',
  status: 'ACTIVE',
  priceRangeV2: { minVariantPrice: { amount: '189.00', currencyCode: 'EUR' } },
  variants: { nodes: [{ price: '189.00', selectedOptions: [{ name: 'Size', value: 'M' }] }] },
  metafields: {
    nodes: [
      { namespace: '$app:curtain', key: 'category', type: 'single_line_text_field', value: 'dress' },
      { namespace: '$app:curtain', key: 'size_chart_type', type: 'single_line_text_field', value: 'body' },
      { namespace: '$app:curtain', key: 'size_chart', type: 'json', value: JSON.stringify([{ size: 'S', bust: 86, waist: 68, hip: 94 }, { size: 'M', bust: 90, waist: 72, hip: 98 }]) },
      ...(over.fabric === null ? [] : [{ namespace: '$app:curtain', key: 'fabric', type: 'json', value: JSON.stringify(over.fabric ?? { primary: 'linen', stretchPct: 0, drape: 0.5 }) }]),
    ],
  },
});

/** A title Shopify allows (255 characters) and the product schema does not (200): the upsert refuses it. */
const TOO_LONG = 'L'.repeat(230);

describe('Shopify backfill and sync: one product that cannot be stored (R1)', () => {
  let t: TestApp;
  let shopId: string;
  const logged: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
  let pages: Record<string, { nodes: unknown[]; next: string | null }> = {};
  let single: Record<string, unknown> = {};
  let failUpstream = false;

  const stubApp = (): App => {
    const log = Object.fromEntries(
      ['info', 'warn', 'error'].map((level) => [level, (obj: Record<string, unknown>, msg: string) => void logged.push({ level, obj, msg })]),
    );
    const shopify = {
      accessTokenFor: async () => 'offline-token',
      fetchProductsPage: async (_domain: string, _token: string, cursor: string | null) => {
        const page = pages[cursor ?? 'first']!;
        return { nodes: page.nodes, pageInfo: { hasNextPage: page.next !== null, endCursor: page.next } };
      },
      fetchProduct: async (_domain: string, _token: string, gid: string) => {
        if (failUpstream) throw new Error('upstream 503');
        return single[gid] ?? null;
      },
    };
    return { ctx: { ...t.app.ctx, db: t.handle.db, queue: t.queue, shopify }, log } as unknown as App;
  };

  beforeAll(async () => {
    t = await makeApp();
    shopId = (await seedShop(t, { platform: 'shopify', domain: SHOP, products: [] })).shop.id;
  });
  afterAll(async () => {
    await t.close();
  });

  const stored = async () => (await t.handle.db.select().from(products).where(eq(products.shopId, shopId))).map((r) => r.externalId).sort();

  it('backfill: the products after a bad one on the page are stored, the next page is queued, and the reason is logged', async () => {
    pages = {
      first: { nodes: [node(1), node(2, { title: TOO_LONG }), node(3)], next: 'cursor-2' },
      'cursor-2': { nodes: [node(4)], next: null },
    };
    await makeBackfillHandler(stubApp())({ shopId });
    expect(await stored()).toEqual(['1', '3']);
    expect(t.queue.pending(JOB.backfillShopify).map((j) => j.data)).toEqual([{ shopId, cursor: 'cursor-2' }]);
    const skipped = logged.filter((l) => l.level === 'warn' && l.obj.productGid === 'gid://shopify/Product/2');
    expect(skipped).toHaveLength(1);
    expect(String(skipped[0]!.obj.reason)).toMatch(/^name: /);
    expect(JSON.stringify(skipped[0]!.obj)).not.toContain(TOO_LONG);
    // A product the schema refuses is not retried on its own: the same data would be refused again.
    expect(t.queue.pending(JOB.syncShopifyProduct)).toHaveLength(0);
  });

  it('backfill: a product that fails for another reason is queued on its own and the page goes on', async () => {
    const broken = node(7);
    Object.defineProperty(broken, 'metafields', {
      get() {
        throw new Error('connection reset');
      },
    });
    pages = { first: { nodes: [broken, node(8)], next: null } };
    logged.length = 0;
    await makeBackfillHandler(stubApp())({ shopId });
    expect(await stored()).toContain('8');
    expect(t.queue.pending(JOB.syncShopifyProduct).map((j) => j.data)).toEqual([{ shopId, productGid: 'gid://shopify/Product/7' }]);
    expect(logged.find((l) => l.msg === 'shopify backfill page done')!.obj).toMatchObject({ products: 2, stored: 1, refused: 0, requeued: 1 });
  });

  it('sync: a product the schema refuses is logged with the reason and does not fail the job; an outage still does', async () => {
    single = { 'gid://shopify/Product/2': node(2, { title: TOO_LONG }) };
    logged.length = 0;
    const sync = makeSyncShopifyProductHandler(stubApp());
    await expect(sync({ shopId, productGid: 'gid://shopify/Product/2' })).resolves.toBeUndefined();
    expect(logged.filter((l) => l.level === 'warn' && String(l.obj.reason).startsWith('name: '))).toHaveLength(1);
    expect(await stored()).not.toContain('2');
    failUpstream = true;
    await expect(sync({ shopId, productGid: 'gid://shopify/Product/2' })).rejects.toThrow('upstream 503');
    failUpstream = false;
  });

  it('sync: a fabric with only a name goes through, and the log says what was assumed and left out', async () => {
    single = {
      'gid://shopify/Product/5': node(5, { fabric: { primary: 'Katoen' } }),
      'gid://shopify/Product/6': node(6, { fabric: { primary: 'Katoen', stretchPct: 150, drape: 0.4 } }),
    };
    logged.length = 0;
    const sync = makeSyncShopifyProductHandler(stubApp());
    await sync({ shopId, productGid: 'gid://shopify/Product/5' });
    await sync({ shopId, productGid: 'gid://shopify/Product/6' });
    const rows = await t.handle.db.select().from(products).where(eq(products.shopId, shopId));
    const five = rows.find((r) => r.externalId === '5')!;
    const six = rows.find((r) => r.externalId === '6')!;
    expect(five.status).toBe('active');
    expect(five.payload.fabric).toEqual({ primary: 'cotton' });
    expect(six.status).toBe('active');
    expect(six.payload.fabric).toEqual({ primary: 'cotton', drape: 0.4 });
    const info = logged.filter((l) => l.level === 'info');
    expect(info[0]!.obj).toMatchObject({ externalId: '5', status: 'active', heldBack: null });
    expect(info[0]!.obj.defaulted).toEqual(expect.arrayContaining(['fabric.stretchPct', 'fabric.drape']));
    expect(info[1]!.obj.defaulted).toEqual(expect.arrayContaining(['fabric.stretchPct']));
    // The mapping already left the stretch of 150 out and said so; the warning count carries it.
    expect(info[1]!.obj.warnings).toBe(1);
  });
});
