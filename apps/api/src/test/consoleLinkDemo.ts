/**
 * A real api for the browser walk of the one-time sign-in link
 * (packages/woocommerce-plugin/e2e/console-link-shots.mjs): PGlite in memory, one connected
 * WooCommerce shop with three products. Local use only; excluded from the build.
 *
 *   tsx src/test/consoleLinkDemo.ts <port> <console origin>
 *
 * Prints one JSON line with the shop's test credentials for the plugin stand-in, then serves until killed.
 */
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { upsertProduct } from '../services/products.js';
import { makeApp, seedShop } from './helpers.js';

const port = Number(process.argv[2] ?? 8791);
const appUrl = process.argv[3] ?? 'http://localhost:3000';

const t = await makeApp({ PUBLIC_APP_URL: appUrl, PUBLIC_API_URL: `http://localhost:${port}`, LOG_LEVEL: 'info' });
const s = await seedShop(t, { domain: 'aalter-studio.example', name: 'Aalter Studio', products: ['aalter-studio-1', 'monochrome-02'] });
// One product whose fabric has no usable stretch: the product list shows the notice.
const wrap = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
await upsertProduct(t.handle.db, s.shop.id, 'boho-kaftan', { ...wrap, id: 'boho-kaftan', name: 'Boho kaftan', fabric: { name: 'Cotton voile', stretchPct: 150 } });
await t.app.listen({ port, host: '127.0.0.1' });
console.log(JSON.stringify({ apiKey: s.apiKey, publicKeyPrefix: s.publicKeyPrefix }));
