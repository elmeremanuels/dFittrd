/**
 * Local demo server (docs/STANDALONE.md §4): `pnpm --filter @curtain/api demo`.
 *
 * No Docker, no keys: the api on PGlite persisted to <repo>/.demo-db, migrated and seeded with the
 * "Aalter Studio" demo shops (src/demoSeed.ts), the in-memory job queue and the mock try-on
 * provider. Serves /sdk/v1.js when @curtain/sdk is built. Prints the public key and the product
 * ids and writes them to <repo>/.demo-db/demo.json for the demo storefront.
 *
 * Every value below can be overridden through the environment (it goes through env.ts like the
 * real server). This file is for local use only; the production entry is src/server.ts.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockProvider, TryOnRouter } from '@curtain/tryon-providers';
import { build } from './app.js';
import { connectPglite } from './db/client.js';
import { DEMO_APP_ORIGIN, DEMO_STOREFRONT_ORIGIN, seedDemo } from './demoSeed.js';
import { loadEnv } from './env.js';
import { MemoryQueue } from './jobs/queue.js';
import { resolveSdkFile } from './routes/sdk.js';

const here = dirname(fileURLToPath(import.meta.url));
// src/ (tsx) and dist/ (node) both sit two levels below the repo root's apps/api.
const repoRoot = resolve(here, '..', '..', '..');
const source = process.env;
const dataDir = resolve(source.DEMO_DB_DIR ?? join(repoRoot, '.demo-db'));
const storefrontOrigin = source.DEMO_STOREFRONT_ORIGIN ?? DEMO_STOREFRONT_ORIGIN;
const port = source.PORT ?? '8787';

const env = loadEnv({
  NODE_ENV: 'development',
  HOST: '127.0.0.1',
  LOG_LEVEL: 'info',
  JOBS: '0',
  TRYON_ORDER: 'mock',
  RENDERS_DIR: join(dataDir, 'renders'),
  ...source,
  PORT: port,
  PUBLIC_APP_URL: source.PUBLIC_APP_URL ?? DEMO_APP_ORIGIN,
  PUBLIC_API_URL: source.PUBLIC_API_URL ?? `http://localhost:${port}`,
  CORS_ORIGINS: source.CORS_ORIGINS ?? [storefrontOrigin, DEMO_APP_ORIGIN, 'http://127.0.0.1:3000', 'http://127.0.0.1:5180'].join(','),
});

// Fail before touching the database: two PGlite processes on one data directory corrupt it.
const free = await new Promise<boolean>((done) => {
  const probe = createServer();
  probe.once('error', () => done(false));
  probe.listen(env.PORT, env.HOST, () => probe.close(() => done(true)));
});
if (!free) {
  console.error(`Port ${env.PORT} is in use (another demo api running?). Stop it or set PORT.`);
  process.exit(1);
}

await mkdir(dataDir, { recursive: true });
// The data directory ignores itself, so the demo database never ends up in git.
await writeFile(join(dataDir, '.gitignore'), '*\n');

const handle = await connectPglite(join(dataDir, 'pgdata'));
await handle.migrate();

const queue = new MemoryQueue({ autoRun: true, tickMs: 250 });
const providers = [new MockProvider({ video: true, latencyMs: 800 })];
const tryon = new TryOnRouter({ providers, policy: { order: providers.map((p) => p.name), maxCostUsd: env.TRYON_MAX_COST_USD } });
const app = await build({ env, db: handle.db, queue, tryon });
await app.renders.init();
await queue.start({ work: true });

const manifest = await seedDemo(handle.db, env, { storefrontOrigin, appOrigin: env.PUBLIC_APP_URL });
await writeFile(join(dataDir, 'demo.json'), `${JSON.stringify(manifest, null, 2)}\n`);

await app.listen({ host: env.HOST, port: env.PORT });

const sdk = await resolveSdkFile(env.SDK_FILE);
const lines = [
  '',
  'Curtain demo api is running (PGlite, mock try-on provider, no keys).',
  `  api        ${env.PUBLIC_API_URL}`,
  `  sdk        ${manifest.sdkUrl}${sdk ? '' : '  (not built yet: run pnpm --filter @curtain/sdk build)'}`,
  `  app/embed  ${env.PUBLIC_APP_URL}/embed/<token>`,
  `  database   ${join(dataDir, 'pgdata')}`,
  `  manifest   ${join(dataDir, 'demo.json')}`,
  '',
  ...manifest.shops.flatMap((s) => [
    `  ${s.name} (${s.platform})`,
    `    public key   ${s.publicKey}`,
    `    origins      ${s.allowedOrigins.join(', ')}`,
    `    products     ${s.products.map((p) => `${p.externalId}${p.status === 'active' ? '' : ` [${p.status}]`}`).join(', ')}`,
  ]),
  '',
];
console.log(lines.join('\n'));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'demo api shutting down');
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
