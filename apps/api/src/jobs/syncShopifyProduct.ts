/** products/update → GraphQL product + metafields → @curtain/schema fromShopifyProduct → upsert (content_hash no-op). */
import { fromShopifyProduct, shopifyExternalId, type AudienceSource, type MappingWarning, type ShopifyProductNode } from '@curtain/schema';
import { DEFAULT_EUR_RATES } from '@curtain/shopify-app';
import { ZodError } from 'zod';
import type { App } from '../app.js';
import { HttpError } from '../lib/errors.js';
import { JOB } from './queue.js';
import { archiveProduct, upsertProduct, type UpsertResult } from '../services/products.js';
import { findShopById, type ShopRow } from '../services/shops.js';

export interface SyncShopifyProductJob {
  shopId: string;
  productGid: string;
}

/**
 * Why a product could not be stored, when the product itself is the cause (the schema or a rule
 * refuses it): the same data would be refused again, so it is recorded and not retried. Null for
 * anything else (database, network), which a retry can fix. The refused value is never included.
 */
export function productRefusal(err: unknown): string | null {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    return first ? `${first.path.join('.') || '(root)'}: ${first.message}` : 'invalid product';
  }
  if (err instanceof HttpError && err.status >= 400 && err.status < 500) return `${err.code}: ${err.message}`;
  return null;
}

type Synced = { r: UpsertResult; warnings: MappingWarning[] } | null;

/** Maps one product node and stores it. Null: the node has no id or name, nothing was stored. */
async function syncNode(app: App, shop: ShopRow, node: ShopifyProductNode): Promise<Synced> {
  const warnings: MappingWarning[] = [];
  // The men's gate (services/readiness.ts) needs to know when `men` is only a guess from a title or a collection.
  const audience: { source: AudienceSource | null } = { source: null };
  const draft = fromShopifyProduct(node, undefined, { warnings, defaultBrand: shop.name, eurRates: DEFAULT_EUR_RATES, onAudience: (d) => (audience.source = d?.source ?? null) });
  if (!draft.id || !draft.name) return null;
  const r = await upsertProduct(app.ctx.db, shop.id, draft.id, { ...draft, brand: draft.brand ?? shop.name }, { handle: node.handle ?? null, audienceSource: audience.source });
  return { r, warnings };
}

/** What the log keeps of a stored product: its state and what was done with incomplete data (payload paths only). */
const syncedLog = (shopId: string, { r, warnings }: NonNullable<Synced>) => ({
  shopId,
  externalId: r.product.externalId,
  status: r.status,
  changed: r.changed,
  warnings: warnings.length,
  defaulted: r.notices.defaulted,
  leftOut: r.notices.leftOut.map((l) => l.field),
  heldBack: r.heldBack ? r.heldBack.fields : null,
});

export function makeSyncShopifyProductHandler(app: App) {
  const { db, shopify } = app.ctx;
  return async ({ shopId, productGid }: SyncShopifyProductJob): Promise<void> => {
    const shop = await findShopById(db, shopId);
    if (!shop || shop.platform !== 'shopify' || shop.uninstalledAt) return;
    const token = await shopify.accessTokenFor(shop.domain);
    if (!token) {
      app.log.warn({ shopId }, 'sync skipped: no offline token');
      return;
    }
    const node = await shopify.fetchProduct(shop.domain, token, productGid);
    const externalId = shopifyExternalId(productGid);
    if (!node || (node.status && node.status.toUpperCase() === 'ARCHIVED')) {
      await archiveProduct(db, shopId, externalId);
      return;
    }
    let synced: Synced;
    try {
      synced = await syncNode(app, shop, node);
    } catch (err) {
      const reason = productRefusal(err);
      if (reason === null) throw err; // The queue retries: the product is not the cause.
      app.log.warn({ shopId, productGid, reason }, 'shopify product not synced: the product was refused');
      return;
    }
    if (!synced) {
      app.log.warn({ shopId, productGid }, 'sync skipped: product node unusable');
      return;
    }
    app.log.info(syncedLog(shopId, synced), 'shopify product synced');
  };
}

export interface BackfillJob {
  shopId: string;
  cursor?: string | null;
}

/**
 * Walks the whole catalogue page by page (50 per request) after install. One product that cannot
 * be stored never stops the page or the pages after it (inventory repair R1): a refused product is
 * logged with the reason; any other failure is logged and that one product is queued as its own
 * sync job, which retries without holding up the rest.
 */
export function makeBackfillHandler(app: App) {
  const { db, shopify, queue } = app.ctx;
  return async ({ shopId, cursor = null }: BackfillJob): Promise<void> => {
    const shop = await findShopById(db, shopId);
    if (!shop || shop.platform !== 'shopify' || shop.uninstalledAt) return;
    const token = await shopify.accessTokenFor(shop.domain);
    if (!token) return;
    const page = await shopify.fetchProductsPage(shop.domain, token, cursor);
    let stored = 0;
    let refused = 0;
    let requeued = 0;
    for (const node of page.nodes) {
      try {
        if (await syncNode(app, shop, node)) stored++;
      } catch (err) {
        const reason = productRefusal(err);
        if (reason !== null) {
          refused++;
          app.log.warn({ shopId, productGid: node.id, reason }, 'backfill: product not synced: the product was refused');
          continue;
        }
        requeued++;
        app.log.warn({ shopId, productGid: node.id, reason: err instanceof Error ? err.message : 'unknown error' }, 'backfill: product failed, queued on its own');
        await queue
          .send(JOB.syncShopifyProduct, { shopId, productGid: node.id }, { singletonKey: `sync:${shopId}:${node.id}`, startAfter: 30 })
          .catch((e: unknown) => app.log.error({ shopId, productGid: node.id, reason: e instanceof Error ? e.message : 'unknown error' }, 'backfill: could not queue the product'));
      }
    }
    app.log.info({ shopId, cursor, products: page.nodes.length, stored, refused, requeued }, 'shopify backfill page done');
    if (page.pageInfo.hasNextPage && page.pageInfo.endCursor) {
      await queue.send(JOB.backfillShopify, { shopId, cursor: page.pageInfo.endCursor }, { startAfter: 1 });
    }
  };
}
