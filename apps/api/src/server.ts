/**
 * Process entry: one Fastify process = app API + merchant API + SDK host + Shopify backend +
 * pg-boss jobs (D2). JOBS=1 → jobs-only worker (no listener); JOBS=0 → API without workers.
 */
import { build } from './app.js';
import { connectPostgres } from './db/client.js';
import { isShopifyConfigured, loadEnv } from './env.js';
import { scheduleCrons } from './jobs/index.js';
import { PgBossQueue } from './jobs/queue.js';
import { backfillKeyLookups } from './services/shops.js';

const env = loadEnv();
const handle = connectPostgres(env.DATABASE_URL);
const queue = new PgBossQueue({ connectionString: env.DATABASE_URL, onError: (err) => app.log.error({ err }, 'pg-boss error') });
const app = await build({ env, db: handle.db, queue });

if (isShopifyConfigured(env)) app.log.info({ distribution: env.SHOPIFY_DISTRIBUTION, apiVersion: env.SHOPIFY_API_VERSION }, 'shopify app configured');
if (env.devSecrets) app.log.warn('running with generated dev secrets — set JWT_SECRET, SHOP_KEY_PEPPER and ENCRYPTION_KEY');
await app.renders.init();
const backfilled = await backfillKeyLookups(handle.db, env);
if (backfilled) app.log.info({ shops: backfilled }, 'merchant key lookups backfilled (migration 0001)');

if (env.JOBS !== '0') {
  await queue.start({ work: true });
  await scheduleCrons(app);
  app.log.info({ order: env.TRYON_ORDER }, 'jobs started');
} else {
  await queue.start({ work: false });
}

if (env.JOBS !== '1') {
  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info({ url: env.PUBLIC_API_URL }, 'api listening');
} else {
  app.log.info('jobs-only replica (JOBS=1): no HTTP listener');
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
