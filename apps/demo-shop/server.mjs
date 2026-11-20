/**
 * Demo storefront server for `pnpm demo` (docs/STANDALONE.md §4). Plain node:http, no framework.
 *
 *   /                    home page with the product grid (public/index.html)
 *   /product/<id>        WooCommerce-style product page (form.variations_form)
 *   /products/<id>       Shopify Dawn-style product page (form action="/cart/add")
 *   /demo.json           <repo>/.demo-db/demo.json as written by `pnpm --filter @curtain/api demo`
 *   /catalog.json        demo.json products enriched with colours/fabric from the schema fixtures
 *   /ext/curtain-try.css the Shopify theme block's stylesheet, served as the real extension would
 *   /img/<id>.svg        the product's flat-lay illustration (the demo seed points productPhotos here,
 *                        so the embed header shows the same garment as the storefront, from no third party;
 *                        for a product that is not a schema fixture, drawn from its demo.json `details`)
 *   POST /cart/add       pretend cart: redirects to the product page with ?added=<size>
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(here, 'public');
const BLOCK_CSS = resolve(here, '..', '..', 'packages', 'shopify-app', 'extensions', 'try-button', 'assets', 'curtain-try.css');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
export const DEFAULT_DEMO_JSON = resolve(here, '..', '..', '.demo-db', 'demo.json');

/** Colours, fabric and notes for each product from @curtain/schema's MOCK_GARMENTS (optional). */
async function fixtureDetails() {
  try {
    const { MOCK_GARMENTS } = await import('@curtain/schema');
    return new Map(MOCK_GARMENTS.map((g) => [g.id, { name: g.name, category: g.category, subcategory: g.subcategory, patternBlock: g.patternBlock, colorways: g.colorways ?? [], primaryColorHex: g.primaryColorHex, fabric: g.fabric?.blend ?? [], sizingNotes: g.sizingNotes, sizeChart: g.sizeChart ?? [], sizeChartType: g.sizeChartType, lengthCm: g.lengthCm ?? {} }]));
  } catch {
    return new Map(); // schema not built: the pages fall back to neutral colours
  }
}

/** Details the demo seed wrote for products that are not schema fixtures (empty when demo.json is missing). */
async function demoDetails(readDemo) {
  try {
    const demo = await readDemo();
    return new Map(demo.shops.flatMap((s) => s.products.filter((p) => p.details).map((p) => [p.externalId, p.details])));
  } catch {
    return new Map();
  }
}

export function createDemoShopServer({ demoJsonPath = DEFAULT_DEMO_JSON } = {}) {
  const details = fixtureDetails();
  const send = (res, status, type, body) => {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  };
  const readDemo = async () => JSON.parse(await readFile(demoJsonPath, 'utf8'));
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    try {
      if (req.method === 'POST' && path === '/cart/add') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const form = new URLSearchParams(body);
        const want = form.get('return_to') ?? '/';
        const back = /^\/(?![/\\])/.test(want) ? want : '/'; // same-site paths only, never //host
        res.writeHead(303, { location: `${back}${back.includes('?') ? '&' : '?'}added=${encodeURIComponent(form.get('Size') ?? form.get('size') ?? '')}` });
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Method not allowed');
      if (path === '/demo.json') return send(res, 200, TYPES['.json'], JSON.stringify(await readDemo()));
      if (path === '/catalog.json') {
        const [demo, map] = [await readDemo(), await details];
        // Products that are not schema fixtures (the azure babydoll from its 3D bundle) carry their own details.
        const shops = demo.shops.map((s) => ({ ...s, products: s.products.map(({ details, ...p }) => ({ ...p, ...(map.get(p.externalId) ?? details ?? {}) })) }));
        return send(res, 200, TYPES['.json'], JSON.stringify({ ...demo, shops }));
      }
      if (path === '/ext/curtain-try.css') return send(res, 200, TYPES['.css'], await readFile(BLOCK_CSS));
      const img = /^\/img\/([\w-]+)\.svg$/.exec(path);
      if (img) {
        const d = (await details).get(img[1]) ?? (await demoDetails(readDemo)).get(img[1]);
        if (!d) return send(res, 404, 'text/plain', 'Not found');
        const { garmentSvg } = await import('./public/garments.js');
        const svg = garmentSvg(d, d.primaryColorHex, { title: d.name });
        res.writeHead(200, { 'content-type': TYPES['.svg'], 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'cross-origin' });
        return res.end(svg);
      }
      const file = /^\/product\/[\w-]+\/?$/.test(path) ? 'woo-product.html' : /^\/products\/[\w-]+\/?$/.test(path) ? 'dawn-product.html' : path === '/' ? 'index.html' : normalize(path).replace(/^([/\\])+/, '');
      const full = join(PUBLIC, file);
      if (!full.startsWith(PUBLIC + '/')) return send(res, 404, 'text/plain', 'Not found');
      return send(res, 200, TYPES[extname(full)] ?? 'application/octet-stream', await readFile(full));
    } catch (err) {
      if (err?.code === 'ENOENT' && (path === '/demo.json' || path === '/catalog.json')) return send(res, 503, TYPES['.json'], JSON.stringify({ error: 'demo.json not found: start the demo api first (pnpm demo)' }));
      if (err?.code === 'ENOENT' || err?.code === 'EISDIR') return send(res, 404, 'text/plain', 'Not found');
      return send(res, 500, 'text/plain', 'Server error');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 5180);
  createDemoShopServer({ demoJsonPath: process.env.DEMO_JSON ?? DEFAULT_DEMO_JSON }).listen(port, process.env.HOST ?? '127.0.0.1', () => {
    console.log(`Aalter Studio demo storefront on http://localhost:${port}/`);
  });
}
