import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createDemoShopServer } from '../server.mjs';

const dir = mkdtempSync(join(tmpdir(), 'demo-shop-'));
const demoJson = join(dir, 'demo.json');
const key = 'pk_' + 'test_fakeDemoKey01';
writeFileSync(
  demoJson,
  JSON.stringify({
    apiUrl: 'http://localhost:8787',
    sdkUrl: 'http://localhost:8787/sdk/v1.js',
    publicKey: key,
    shops: [
      { key: 'woocommerce', name: 'Aalter Studio', publicKey: key, products: [{ externalId: 'aalter-studio-1', name: 'Linen Wrap Dress', category: 'dress', priceEur: 149, sizes: ['XS', 'S', 'M', 'L'], status: 'active' }] },
      {
        key: 'shopify',
        name: 'Aalter Studio (Shopify)',
        publicKey: key,
        products: [
          {
            externalId: 'azure-palm-baby-doll-dress',
            name: 'Azure Palm Baby Doll Dress',
            category: 'dress',
            priceEur: null,
            sizes: ['8', '10', '12'],
            status: 'active',
            asset3d: '0123456789abcdef',
            details: { name: 'Azure Palm Baby Doll Dress', category: 'dress', patternBlock: 'empire', primaryColorHex: '#4F8FC0', colorways: [{ name: 'Azure', hex: '#4F8FC0' }], sizeChart: [{ size: '8', measurements: {} }], lengthCm: {} },
          },
        ],
      },
    ],
  }),
);

let server;
let base;
before(async () => {
  server = createDemoShopServer({ demoJsonPath: demoJson });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('serves the home page and both product page styles', async () => {
  for (const [path, marker] of [
    ['/', '/home.js'],
    ['/product/aalter-studio-1', '/woo.js'],
    ['/products/aalter-studio-1', '/dawn.js'],
  ]) {
    const res = await fetch(base + path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.ok((await res.text()).includes(marker), `${path} loads ${marker}`);
  }
});

test('serves demo.json as written by the api demo', async () => {
  const res = await fetch(`${base}/demo.json`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.publicKey, key);
  assert.equal(body.sdkUrl, 'http://localhost:8787/sdk/v1.js');
});

test('catalog.json enriches products with colourways and the size chart from the schema fixtures', async () => {
  const body = await (await fetch(`${base}/catalog.json`)).json();
  const p = body.shops[0].products[0];
  assert.equal(p.name, 'Linen Wrap Dress');
  assert.ok(Array.isArray(p.colorways) && p.colorways.length > 0, 'colourways from MOCK_GARMENTS');
  assert.equal(p.colorways[0].name, 'Terracotta');
  assert.ok(p.sizeChart.some((r) => r.size === 'M'));
});

test('serves the Shopify block stylesheet and static assets with types', async () => {
  const css = await fetch(`${base}/ext/curtain-try.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await fetch(`${base}/shop.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('does not serve files outside public/', async () => {
  for (const path of ['/../server.mjs', '/%2e%2e/server.mjs', '/..%2fpackage.json', '/nope.html']) {
    const res = await fetch(base + path);
    assert.equal(res.status, 404, path);
  }
});

test('POST /cart/add redirects back to a same-site path only', async () => {
  const post = (body) => fetch(`${base}/cart/add`, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual' });
  let res = await post({ Size: 'M', return_to: '/products/aalter-studio-1' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/products/aalter-studio-1?added=M');
  res = await post({ Size: 'M', return_to: '//evil.example/x' });
  assert.equal(res.headers.get('location'), '/?added=M');
});

test('missing demo.json answers 503 with a hint to start the demo', async () => {
  const s = createDemoShopServer({ demoJsonPath: join(dir, 'missing.json') });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const res = await fetch(`http://127.0.0.1:${s.address().port}/demo.json`);
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /pnpm demo/);
  s.close();
});

test('serves product illustrations for the embed header (UX-3: no third-party image host)', async () => {
  const res = await fetch(`${base}/img/aalter-studio-1.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.match(await res.text(), /^<svg [^>]*role="img"/);
  assert.equal((await fetch(`${base}/img/no-such-product.svg`)).status, 404);
  assert.equal((await fetch(`${base}/img/..%2Fserver.mjs`)).status, 404);
});

test('a product with a 3D bundle that is not a schema fixture: its page, catalog entry and illustration render', async () => {
  const page = await fetch(`${base}/products/azure-palm-baby-doll-dress`);
  assert.equal(page.status, 200);
  const catalog = await (await fetch(`${base}/catalog.json`)).json();
  const azure = catalog.shops[1].products[0];
  assert.equal(azure.primaryColorHex, '#4F8FC0');
  assert.equal(azure.asset3d, '0123456789abcdef');
  assert.equal(azure.details, undefined);
  const svg = await fetch(`${base}/img/azure-palm-baby-doll-dress.svg`);
  assert.equal(svg.status, 200);
  assert.match(await svg.text(), /#4F8FC0/i);
});
