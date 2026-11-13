/**
 * `pnpm --filter @curtain/api asset:import --shop <domain> --product <externalId> --dir <bundle dir>`
 * (production: `node dist/scripts/import-asset.js …` inside the api container).
 *
 * How founder and pilot bundles get in until the GPU pipeline exists (D16). Copies the five bundle
 * files into ASSET_DIR and records the version as `awaiting_approval`: nothing reaches shoppers
 * until the merchant approves it (D13) and the shop has the 3D estimate switched on.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { connectPostgres } from '../db/client.js';
import { loadEnv } from '../env.js';
import { AssetImportError, importBundle } from '../services/assets.js';
import { findShopByDomain } from '../services/shops.js';

const { values } = parseArgs({ options: { shop: { type: 'string' }, product: { type: 'string' }, dir: { type: 'string' } } });
if (!values.shop || !values.product || !values.dir) {
  console.error('usage: asset:import --shop <shop domain> --product <product external id> --dir <bundle directory>');
  process.exit(2);
}
const env = loadEnv();
const handle = connectPostgres(env.DATABASE_URL, { max: 1 });
try {
  const shop = await findShopByDomain(handle.db, values.shop);
  if (!shop) throw new Error(`no shop ${values.shop}`);
  const { asset, created } = await importBundle(handle.db, env, shop.id, values.product, resolve(process.env.INIT_CWD ?? process.cwd(), values.dir));
  console.log(`${created ? 'imported' : 'already imported'}: version ${asset.version}, ${asset.bytes} bytes, sizes ${asset.sizes.join(', ')}, status ${asset.status}`);
  console.log('Nothing is shown to shoppers until the merchant approves it and settings.garment3d is on.');
} catch (err) {
  console.error(err instanceof AssetImportError ? `bundle rejected: ${err.problem}` : String(err instanceof Error ? err.message : err));
  process.exitCode = 1;
} finally {
  await handle.close();
}
