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
import { MENS_OXFORD_SHIRT, PILOT_SKIRT_CHART_ONLY, PILOT_SKIRT_TAPE_MEASURED, SYNTHETIC_MENS_CHINO_WL, SYNTHETIC_MENS_TEE } from '@curtain/schema';
import { build } from './app.js';
import { connectPglite } from './db/client.js';
import { DEMO_APP_ORIGIN, DEMO_STOREFRONT_ORIGIN, seedDemo, type DemoGarmentBundle } from './demoSeed.js';
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
  // The optional 3D estimate (D16): bundles copied into the demo database folder, served by this process.
  ASSET_DIR: join(dataDir, 'assets'),
  SERVE_ASSETS: '1',
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

/**
 * Git-ignored bundles (generated or shop-derived; never committed). A missing one means that product
 * simply has no 3D view. `pnpm demo` builds the synthetic one; the azure babydoll and the crimson
 * maxi skirt are the founder's evaluated bundles (spikes/garment-engine report tooling), or set
 * DEMO_AZURE_BUNDLE / DEMO_SKIRT_BUNDLE to their folders. The skirt passes the import gate only
 * under the founder's low-rise waist reading, and missed the chart by 2.49 cm (outside ±2) before
 * calibration, so it must import flagged exactly `low_rise_waist` and `precalibration_outside_tolerance`,
 * or it gets no 3D view (demoSeed `qaFlags`).
 */
const spikeOut = join(repoRoot, 'spikes', 'garment-engine', 'out');
/**
 * DEMO_SKIRT picks which skirt bundle the demo serves: `photo` (default) the run-17d photo reconstruction above;
 * `pom` the POM v2 server drape bake (docs/research/step3-serverdrape-spike.md §10: built from the shop's tape,
 * draped on the server, blended on the device, one plain colour), which must pass the import's automatic bake check
 * (its rings against its own tape, nothing inside the drawn body; @curtain/garment-viewer bakeGate.ts) and then imports
 * with no flag. A bake written before the check (no tape, rings or bodies in it) is refused: re-run
 * `serverdrape/pom-bundle.sh` (only its last step, bake-pom.ts, which needs no Blender). DEMO_SKIRT_BUNDLE
 * still overrides the folder.
 */
const pomSkirt = source.DEMO_SKIRT === 'pom';
const skirtDir = resolve(source.DEMO_SKIRT_BUNDLE ?? (pomSkirt ? join(spikeOut, 'pom2-bundle', 'crimson-wildflower-maxi-skirt') : join(spikeOut, 'eval', 'crimson-wildflower-maxi-skirt')));
const bundles: DemoGarmentBundle[] = [
  { shop: 'woocommerce', externalId: 'aalter-studio-2', dir: join(spikeOut, 'aalter-studio-2') },
  { shop: 'shopify', externalId: 'azure-palm-baby-doll-dress', dir: resolve(source.DEMO_AZURE_BUNDLE ?? join(spikeOut, 'eval', 'azure-palm-baby-doll-dress')), payload: true, colorHex: '#4F8FC0', colorName: 'Azure' },
  {
    shop: 'shopify',
    externalId: 'crimson-wildflower-maxi-skirt',
    dir: skirtDir,
    payload: true,
    colorHex: '#A3243B',
    colorName: 'Crimson',
    qaFlags: pomSkirt ? [] : ['low_rise_waist', 'precalibration_outside_tolerance'],
    // Seeded without 3D when the bundle is absent, so the pull-on advice is always in the demo.
    fallbackPayload: PILOT_SKIRT_CHART_ONLY,
    // The shop's tape of 13 Nov 2026 (AU 8, 10, 14; hip depth not stated) and the founder's closure
    // answer of 15 Nov 2026 (pull-on, not yet confirmed with the shop), through the merchant form's check.
    tape: { closure: 'pull-on', measured: PILOT_SKIRT_TAPE_MEASURED },
  },
];
/**
 * DEMO_MEN=1 (men-3d-plan slice M1; off by default, so the demo is unchanged): two men's products in the Shopify demo
 * shop, stored with a strong audience source as a Shopify sync would. The SYNTHETIC men's test tee (not a product) with
 * its bundle built on the male mannequin by the POM tee builder (slice M3: flagged `tape_built_no_chart_check`) (`out/synthetic-men-tee/`, `pnpm --filter @curtain/garment-spike build:bundle`),
 * and the men's Oxford shirt fixture with no bundle. With MEN_3D_GATE=1 as well, the tee opens in the 3D view on the male
 * body and the shirt answers "Men's clothing: coming soon".
 */
if (source.DEMO_MEN === '1') {
  bundles.push(
    { shop: 'shopify', externalId: SYNTHETIC_MENS_TEE.id, dir: join(spikeOut, SYNTHETIC_MENS_TEE.id), payload: true, colorHex: SYNTHETIC_MENS_TEE.primaryColorHex, colorName: 'Test blue', fallbackPayload: SYNTHETIC_MENS_TEE, audienceSource: 'productType', qaFlags: ['tape_built_no_chart_check'] },
    // The SYNTHETIC men's test chino W/L (not a product), built by the POM chino builder (`pnpm --filter @curtain/garment-spike exec tsx
    // scripts/build-chino-bundle.ts`): its bundle folder carries payload.json, the fixture's chart with W40 to W44 added. Without the
    // folder the fixture itself is seeded with no 3D view.
    { shop: 'shopify', externalId: SYNTHETIC_MENS_CHINO_WL.id, dir: join(spikeOut, SYNTHETIC_MENS_CHINO_WL.id), payload: true, colorHex: SYNTHETIC_MENS_CHINO_WL.primaryColorHex, colorName: 'Test stone', fallbackPayload: SYNTHETIC_MENS_CHINO_WL, audienceSource: 'productType', qaFlags: ['tape_built_no_chart_check'] },
    { shop: 'shopify', externalId: MENS_OXFORD_SHIRT.id, dir: join(spikeOut, 'no-bundle', MENS_OXFORD_SHIRT.id), payload: true, colorHex: MENS_OXFORD_SHIRT.primaryColorHex, colorName: 'Light blue', fallbackPayload: MENS_OXFORD_SHIRT, audienceSource: 'productType' },
  );
}
const manifest = await seedDemo(handle.db, env, { storefrontOrigin, appOrigin: env.PUBLIC_APP_URL, bundles });
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
    `    products     ${s.products.map((p) => `${p.externalId}${p.status === 'active' ? '' : ` [${p.status}]`}${p.asset3d ? ` [3D${p.asset3dFlags?.length ? `, ${p.asset3dFlags.join(', ')}` : ''}]` : ''}`).join(', ')}`,
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
