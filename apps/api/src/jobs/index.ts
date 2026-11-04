/** Registers every job handler and the cron schedules on the queue. */
import type { App } from '../app.js';
import { makePruneRendersHandler, makePurgeDueShopsHandler, makePurgeShopHandler, makeUsageRollupHandler, type PurgeShopJob } from './maintenance.js';
import { JOB } from './queue.js';
import { makeRenderHeroHandler, type RenderHeroJob } from './renderHero.js';
import { makeBackfillHandler, makeSyncShopifyProductHandler, type BackfillJob, type SyncShopifyProductJob } from './syncShopifyProduct.js';

export const CRON = {
  /** Every hour: expire renders past 24 h, purge shops past purge_after. */
  prune: '7 * * * *',
  /** 02:13 UTC: push yesterday's overage to Shopify / Stripe. */
  usageRollup: '13 2 * * *',
} as const;

export function registerJobs(app: App): void {
  const { queue } = app.ctx;
  const prune = makePruneRendersHandler(app);
  const purgeDue = makePurgeDueShopsHandler(app);
  queue.register<RenderHeroJob>(JOB.renderHero, makeRenderHeroHandler(app));
  queue.register(JOB.pruneRenders, async () => {
    await prune();
    await purgeDue();
  });
  queue.register<PurgeShopJob>(JOB.purgeShop, makePurgeShopHandler(app));
  queue.register<{ day?: string }>(JOB.usageRollup, async (d) => {
    await makeUsageRollupHandler(app)(d);
  });
  queue.register<SyncShopifyProductJob>(JOB.syncShopifyProduct, makeSyncShopifyProductHandler(app));
  queue.register<BackfillJob>(JOB.backfillShopify, makeBackfillHandler(app));
}

export async function scheduleCrons(app: App): Promise<void> {
  const { queue } = app.ctx;
  await queue.schedule(JOB.pruneRenders, CRON.prune);
  await queue.schedule(JOB.usageRollup, CRON.usageRollup);
}
