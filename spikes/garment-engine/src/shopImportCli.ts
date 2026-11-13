/**
 * Shop-agnostic import CLI (refinement P4). Adapters live in src/shops/; today: nobodyschild.
 * (bohohippychic keeps its own importer, `shop:bohohippychic`, whose AU text parsing predates this.)
 *
 *   pnpm --filter @curtain/garment-spike shop:import -- --shop nobodyschild                    # offline, from raw/: rebuilds products.json and images.json
 *   pnpm --filter @curtain/garment-spike shop:import -- --shop nobodyschild --fetch-images     # images of the committed images.json into raw/, checked against its sha256; writes no JSON
 *   pnpm --filter @curtain/garment-spike shop:import -- --shop nobodyschild --fetch-catalogue  # catalogue pages, size guide and the selected product pages into raw/; writes no JSON
 *   pnpm --filter @curtain/garment-spike shop:import -- --shop nobodyschild --fetch            # all of the above, then rebuild both JSON files
 *
 * Same pinning as shop:bohohippychic: the hand classification is keyed by image position and pinned
 * by the committed sha256; a rebuild that sees a changed image refuses to write unless
 * --accept-image-changes (after the photos were looked at and the classification updated).
 *
 * Reads/writes data/<shop>/raw/ (gitignored): products-page<N>.json, size-guide.html,
 * pages/<handle>.html, <handle>/<NN>.<ext>. Writes data/<shop>/products.json and images.json.
 * Requests are spaced (PAUSE_MS) and carry an honest user agent; downloads are untrusted data: JSON
 * is parsed with JSON.parse, HTML is read as text, images are only hashed here.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ShopifyProduct } from './shop';
import { buildImportPayload, paragraphCells, parseProductPage, parseSizeGuide, type ShopAdapter } from './shopImport';
import { checkImageBytes, committedImages, imageRecordChanges } from './shopImages';
import { threeDReadiness, type ImageRecord } from './shopReadiness';
import {
  NOBODYSCHILD_ID,
  NOBODYSCHILD_IMAGE_CLASSIFICATION,
  NOBODYSCHILD_REJECTED_TYPES,
  NOBODYSCHILD_SELECTION,
  NOBODYSCHILD_SIZE_GUIDE_URL,
  nobodyschildAdapter,
} from './shops/nobodyschild';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    shop: { type: 'string' },
    fetch: { type: 'boolean', default: false },
    'fetch-images': { type: 'boolean', default: false },
    'fetch-catalogue': { type: 'boolean', default: false },
    'accept-image-changes': { type: 'boolean', default: false },
    accessed: { type: 'string' },
  },
});
if (values.shop !== NOBODYSCHILD_ID) throw new Error(`--shop must be ${NOBODYSCHILD_ID} (bohohippychic has its own importer: shop:bohohippychic)`);
const fetchModes = [values.fetch, values['fetch-images'], values['fetch-catalogue']].filter(Boolean).length;
if (fetchModes > 1) throw new Error('--fetch, --fetch-images and --fetch-catalogue exclude each other');

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(pkgDir, 'data', NOBODYSCHILD_ID);
const rawDir = join(dataDir, 'raw');
const DOMAIN = 'nobodyschild.com';
const UA = 'curtain-garment-validation/0.1 (internal test, public data only)';
const PAUSE_MS = 3000;
/** The date the committed chart and pages were read; a refetch must pass --accessed. */
const ACCESSED = values.accessed ?? '2026-11-08';
const MIN_LONG_EDGE = 1600;

const IMAGE_MAGIC: Array<[string, (b: Buffer) => boolean]> = [
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];
const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await sleep(PAUSE_MS);
  return res;
}

async function fetchCatalogue(): Promise<void> {
  mkdirSync(join(rawDir, 'pages'), { recursive: true });
  for (let page = 1; page <= 40; page++) {
    const url = `https://${DOMAIN}/products.json?limit=250&page=${page}`;
    const body = await (await get(url)).text();
    const parsed = JSON.parse(body) as { products?: unknown[] };
    if (!Array.isArray(parsed.products)) throw new Error(`${url}: no products array`);
    if (parsed.products.length === 0) break;
    writeFileSync(join(rawDir, `products-page${page}.json`), body);
    console.log(`[shop:import] page ${page}: ${parsed.products.length} products`);
  }
  writeFileSync(join(rawDir, 'size-guide.html'), await (await get(NOBODYSCHILD_SIZE_GUIDE_URL)).text());
  for (const sel of NOBODYSCHILD_SELECTION) {
    writeFileSync(join(rawDir, 'pages', `${sel.handle}.html`), await (await get(`https://${DOMAIN}/products/${sel.handle}`)).text());
    console.log(`[shop:import] product page ${sel.handle}`);
  }
}

function loadCatalogue(): { products: ShopifyProduct[]; pages: string[] } {
  if (!existsSync(rawDir)) throw new Error(`${relative(pkgDir, rawDir)} is missing; run with --fetch`);
  const pages = readdirSync(rawDir)
    .filter((f) => /^products-page\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!pages.length) throw new Error(`no products-page<N>.json in ${relative(pkgDir, rawDir)}; run with --fetch-catalogue`);
  const byId = new Map<number, ShopifyProduct>();
  for (const f of pages) for (const p of (JSON.parse(readFileSync(join(rawDir, f), 'utf8')) as { products: ShopifyProduct[] }).products) byId.set(p.id, p);
  return { products: [...byId.values()], pages };
}

function imagePath(handle: string, position: number): string | undefined {
  const dir = join(rawDir, handle);
  if (!existsSync(dir)) return undefined;
  const name = readdirSync(dir).find((f) => f.startsWith(`${String(position).padStart(2, '0')}.`));
  return name ? join(dir, name) : undefined;
}

async function downloadImage(handle: string, position: number, url: string, expect?: string): Promise<boolean> {
  const existing = imagePath(handle, position);
  if (existing) {
    if (expect) checkImageBytes({ handle, position, url, sha256: expect }, readFileSync(existing), sha256Hex);
    return false;
  }
  const buf = Buffer.from(await (await fetch(url, { headers: { 'user-agent': UA } }).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r;
  })).arrayBuffer());
  if (expect) checkImageBytes({ handle, position, url, sha256: expect }, buf, sha256Hex);
  const kind = IMAGE_MAGIC.find(([, test]) => test(buf))?.[0];
  if (!kind) throw new Error(`${url}: not a JPEG, PNG or WebP`);
  mkdirSync(join(rawDir, handle), { recursive: true });
  writeFileSync(join(rawDir, handle, `${String(position).padStart(2, '0')}.${kind}`), buf);
  await sleep(500);
  return true;
}

async function fetchCommittedImages(): Promise<void> {
  const list = committedImages(JSON.parse(readFileSync(join(dataDir, 'images.json'), 'utf8')));
  let n = 0;
  for (const img of list) if (await downloadImage(img.handle, img.position, img.url, img.sha256)) n++;
  console.log(`[shop:import] ${list.length} images match the committed sha256 (${n} downloaded); no JSON written`);
}

function adapter(): ShopAdapter {
  const file = join(rawDir, 'size-guide.html');
  if (!existsSync(file)) throw new Error(`${relative(pkgDir, file)} is missing; run with --fetch-catalogue`);
  const chart = parseSizeGuide(paragraphCells(readFileSync(file, 'utf8')), {
    url: NOBODYSCHILD_SIZE_GUIDE_URL,
    accessed: ACCESSED,
    note: 'The shop\'s own women\'s body chart, cm table (the page also prints inches). Single sizes UK 4–24 with EU and US labels; dual (letter) sizes XS–XL; inside leg Short/Regular/Long.',
  });
  if (chart.numeric.length < 8) throw new Error(`size guide: only ${chart.numeric.length} numeric rows parsed; the page layout changed, look at it`);
  return nobodyschildAdapter(chart);
}

async function main(): Promise<void> {
  if (values['fetch-images']) return fetchCommittedImages();
  if (values['fetch-catalogue']) return fetchCatalogue();
  if (values.fetch) await fetchCatalogue();
  const shop = adapter();
  const { products, pages } = loadCatalogue();
  const byHandle = new Map(products.map((p) => [p.handle, p]));
  const typeCounts: Record<string, number> = {};
  for (const p of products) typeCounts[p.product_type] = (typeCounts[p.product_type] ?? 0) + 1;

  const imagesOut: Record<string, ImageRecord[]> = {};
  const productsOut = [];
  for (const sel of NOBODYSCHILD_SELECTION) {
    const p = byHandle.get(sel.handle);
    if (!p) throw new Error(`selected product ${sel.handle} is not in the catalogue`);
    if (p.product_type !== sel.productType) throw new Error(`${sel.handle} is now ${p.product_type}, not ${sel.productType}`);
    if (values.fetch) for (const img of p.images) await downloadImage(p.handle, img.position, img.src);
    const cls = NOBODYSCHILD_IMAGE_CLASSIFICATION[sel.handle] ?? [];
    const records: ImageRecord[] = p.images.map((img) => {
      const c = cls.find((x) => x.position === img.position);
      if (!c) throw new Error(`${sel.handle} image ${img.position} has no classification; look at it and add one`);
      const file = imagePath(sel.handle, img.position);
      const buf = file ? readFileSync(file) : undefined;
      return { ...c, url: img.src, width: img.width, height: img.height, file: file ? relative(dataDir, file) : null, sha256: buf ? sha256Hex(buf) : null, bytes: buf ? buf.length : null };
    });
    imagesOut[sel.handle] = records;
    const pageFile = join(rawDir, 'pages', `${sel.handle}.html`);
    const page = existsSync(pageFile) ? parseProductPage(readFileSync(pageFile, 'utf8')) : undefined;
    const built = buildImportPayload(p, shop, page);
    productsOut.push({
      ...built,
      page: page ?? null,
      selection: { why: sel.why, runnersUp: sel.runnersUp },
      threeD: threeDReadiness(records, built.baseSize, built.baseSizeSource === 'shop', built.payload.fabric !== undefined, MIN_LONG_EDGE),
    });
  }

  const report = {
    shop: { id: shop.id, domain: shop.domain, brand: shop.brand, currency: shop.currency, status: shop.status },
    source: `https://${shop.domain}/products.json?limit=250&page=N (public storefront endpoint), pages ${pages.join(', ')}; the size guide ${NOBODYSCHILD_SIZE_GUIDE_URL}; the product pages of the selection (read ${ACCESSED})`,
    catalogue: { products: products.length, byProductType: typeCounts },
    sizeChart: shop.chart,
    rejectedProductTypes: Object.entries(typeCounts)
      .filter(([t]) => !NOBODYSCHILD_SELECTION.some((s) => s.productType === t))
      .map(([type, count]) => ({ type, count, reason: shop.productTypes[type] ? `mapped to ${shop.productTypes[type]!.category}, but no product selected from it` : (NOBODYSCHILD_REJECTED_TYPES[type] ?? 'not reviewed') })),
    method: {
      sizeChart: "The shop's own printed body chart (size guide, cm table), restricted to the sizes the product offers, sizeChartType 'body'. Letter sizes use the shop's letter table. Trousers get the shop's body inside leg for their length tag.",
      baseSize: "The size the model wears, printed on the product page (the photographed size, stated by the shop). For letter-sized products: the letter the shop's chart maps that size to. Otherwise the middle of the range (our default, flagged).",
      fabric: "The product page's 'Fabric Main:' composition through resolveFabricText/fabricFromText. Lining and trims are listed as warnings (one fabric per payload). The fabric-group tag is never used as a composition.",
      lengths: "The product page's 'Wearing length' (read only inside the product's own block, never from cross-sell drawers), checked against a plausibility range per category and length band; never used for trousers.",
      images: 'images.json: every image looked at and classified by hand; sha256 of the file as downloaded.',
    },
    products: productsOut,
  };
  const imagesJson = { shop: shop.domain, minLongEdgePx: MIN_LONG_EDGE, note: 'Classification by eye; image bytes stay in raw/ (gitignored). Test shop chosen by us, not a partner: no public use.', products: imagesOut };
  const imagesFile = join(dataDir, 'images.json');
  if (existsSync(imagesFile)) {
    const changes = imageRecordChanges(JSON.parse(readFileSync(imagesFile, 'utf8')), JSON.parse(JSON.stringify(imagesJson)));
    if (changes.length && !values['accept-image-changes']) {
      for (const c of changes) console.error(`[shop:import] ${c.handle} #${c.position}: ${c.change} ${c.before ?? '-'} → ${c.after ?? '-'}`);
      throw new Error(`${changes.length} image(s) differ from the committed images.json; nothing written. Look at the photos, update NOBODYSCHILD_IMAGE_CLASSIFICATION, then re-run with --accept-image-changes.`);
    }
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'products.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(imagesFile, `${JSON.stringify(imagesJson, null, 2)}\n`);
  for (const d of shop.chart.defects) console.log(`[shop:import] size guide defect: ${d}`);
  for (const p of productsOut) {
    console.log(
      `[shop:import] ${p.productType.padEnd(10)} ${p.handle.padEnd(34)} completeness ${p.completeness.score.toFixed(3)} ${p.completeness.status}; base ${p.baseSize ?? '-'} (${p.baseSizeSource ?? '-'}); 3D ${p.threeD.ready ? 'ready' : 'not ready'}; ${p.warnings.length} warnings`,
    );
  }
  const missing = Object.values(imagesOut).flat().filter((r) => r.sha256 === null).length;
  if (missing) console.log(`[shop:import] ${missing} images not downloaded yet (sha256 null); run with --fetch-images`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
