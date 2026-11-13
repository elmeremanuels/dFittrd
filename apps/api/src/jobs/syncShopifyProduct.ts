/** products/update → GraphQL product + metafields → @curtain/schema fromShopifyProduct → upsert (content_hash no-op). */
import { fromShopifyProduct, shopifyExternalId, type MappingWarning } from '@curtain/schema';
import { DEFAULT_EUR_RATES } from '@curtain/shopify-app';
import type { App } from '../app.js';
import { JOB } from './queue.js';
import { archiveProduct, upsertProduct } from '../services/products.js';
import { findShopById } from '../services/shops.js';

export interface SyncShopifyProductJob {
  shopId: string;
  productGid: string;
}

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
    const warnings: MappingWarning[] = [];
    const draft = fromShopifyProduct(node, undefined, { warnings, defaultBrand: shop.name, eurRates: DEFAULT_EUR_RATES });
    if (!draft.id || !draft.name) {
      app.log.warn({ shopId, productGid, warnings }, 'sync skipped: product node unusable');
      return;
    }
    const r = await upsertProduct(db, shopId, draft.id, { ...draft, brand: draft.brand ?? shop.name }, { handle: node.handle ?? null });
    app.log.info({ shopId, externalId: r.product.externalId, status: r.status, changed: r.changed, warnings: warnings.length }, 'shopify product synced');
  };
}

export interface BackfillJob {
  shopId: string;
  cursor?: string | null;
}

/** Walks the whole catalogue page by page (50 per request) after install. */
export function makeBackfillHandler(app: App) {
  const { db, shopify, queue } = app.ctx;
  return async ({ shopId, cursor = null }: BackfillJob): Promise<void> => {
    const shop = await findShopById(db, shopId);
    if (!shop || shop.platform !== 'shopify' || shop.uninstalledAt) return;
    const token = await shopify.accessTokenFor(shop.domain);
    if (!token) return;
    const page = await shopify.fetchProductsPage(shop.domain, token, cursor);
    for (const node of page.nodes) {
      const warnings: MappingWarning[] = [];
      const draft = fromShopifyProduct(node, undefined, { warnings, defaultBrand: shop.name, eurRates: DEFAULT_EUR_RATES });
      if (!draft.id || !draft.name) continue;
      await upsertProduct(db, shopId, draft.id, { ...draft, brand: draft.brand ?? shop.name }, { handle: node.handle ?? null });
    }
    if (page.pageInfo.hasNextPage && page.pageInfo.endCursor) {
      await queue.send(JOB.backfillShopify, { shopId, cursor: page.pageInfo.endCursor }, { startAfter: 1 });
    }
  };
}
