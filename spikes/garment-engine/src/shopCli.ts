/**
 * Shop validation for bohohippychic.com.au: public catalogue → five GarmentPayload v1 drafts.
 *
 *   pnpm --filter @curtain/garment-spike shop:bohohippychic            # offline, from data/bohohippychic/raw/
 *   pnpm --filter @curtain/garment-spike shop:bohohippychic -- --fetch # (re)download catalogue pages and the images
 *
 * Reads  data/bohohippychic/raw/products-page<N>.json (Shopify /products.json?limit=250&page=N) and
 *        data/bohohippychic/raw/<handle>/<NN>.<ext> (the product images, as served).
 * Writes data/bohohippychic/products.json (payloads, completeness, selection notes) and
 *        data/bohohippychic/images.json (URLs, sha256, classification; no image bytes).
 * raw/ is gitignored: shop images and raw downloads are never committed.
 *
 * Downloads are untrusted data: JSON is parsed with JSON.parse, images are only hashed and
 * size-checked here, never decoded or executed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SHOP, buildShopPayload, rankCandidates, type ShopifyProduct } from './shop';
import { SHOP_IMAGE_CLASSIFICATION, SHOP_REJECTED_TYPES, SHOP_SELECTION, type ImageClassification } from './shopSelection';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { fetch: { type: 'boolean', default: false } },
});

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(pkgDir, 'data', 'bohohippychic');
const rawDir = join(dataDir, 'raw');
const UA = 'curtain-garment-validation/0.1 (with the shop owner\'s consent)';

/** Long edge the engine requires for a front/back photo (ENGINE-HANDOFF "Photos"). */
const MIN_LONG_EDGE = 1600;

const IMAGE_MAGIC: Array<[string, (b: Buffer) => boolean]> = [
  ['jpg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];

async function fetchCatalogue(): Promise<void> {
  mkdirSync(rawDir, { recursive: true });
  for (let page = 1; page <= 20; page++) {
    const url = `https://${SHOP.domain}/products.json?limit=250&page=${page}`;
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const body = await res.text();
    const parsed = JSON.parse(body) as { products?: unknown[] };
    if (!Array.isArray(parsed.products)) throw new Error(`${url}: no products array`);
    if (parsed.products.length === 0) break;
    writeFileSync(join(rawDir, `products-page${page}.json`), body);
    console.log(`[shop] page ${page}: ${parsed.products.length} products`);
  }
}

function loadCatalogue(): { products: ShopifyProduct[]; pages: string[] } {
  if (!existsSync(rawDir)) throw new Error(`${relative(pkgDir, rawDir)} is missing; run with --fetch`);
  const pages = readdirSync(rawDir)
    .filter((f) => /^products-page\d+\.json$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (!pages.length) throw new Error(`no products-page<N>.json in ${relative(pkgDir, rawDir)}; run with --fetch`);
  const byId = new Map<number, ShopifyProduct>();
  for (const f of pages) {
    const parsed = JSON.parse(readFileSync(join(rawDir, f), 'utf8')) as { products: ShopifyProduct[] };
    for (const p of parsed.products) byId.set(p.id, p);
  }
  return { products: [...byId.values()], pages };
}

function imagePath(handle: string, position: number): string | undefined {
  const dir = join(rawDir, handle);
  if (!existsSync(dir)) return undefined;
  const name = readdirSync(dir).find((f) => f.startsWith(`${String(position).padStart(2, '0')}.`));
  return name ? join(dir, name) : undefined;
}

async function downloadImages(p: ShopifyProduct): Promise<void> {
  const dir = join(rawDir, p.handle);
  mkdirSync(dir, { recursive: true });
  for (const img of p.images) {
    if (imagePath(p.handle, img.position)) continue;
    // The src without size parameters is the original upload, the largest size Shopify serves.
    const res = await fetch(img.src, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`${img.src}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const kind = IMAGE_MAGIC.find(([, test]) => test(buf))?.[0];
    if (!kind) throw new Error(`${img.src}: not a JPEG, PNG or WebP`);
    writeFileSync(join(dir, `${String(img.position).padStart(2, '0')}.${kind}`), buf);
    console.log(`[shop] ${p.handle} #${img.position}: ${buf.length} bytes`);
  }
}

interface ImageRecord extends ImageClassification {
  url: string;
  width: number;
  height: number;
  file: string | null;
  sha256: string | null;
  bytes: number | null;
}

function threeDReadiness(images: readonly ImageRecord[], baseSize: string | undefined, hasFabric: boolean): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const usable = (role: string) =>
    images.filter((i) => i.role === role && !i.onModel && i.background === 'plain' && i.garmentFullyVisible && Math.max(i.width, i.height) >= MIN_LONG_EDGE);
  for (const role of ['front', 'back'] as const) {
    if (usable(role).length) continue;
    const any = images.filter((i) => i.role === role);
    if (!any.length) reasons.push(`add a ${role} photo`);
    else {
      const why = new Set<string>();
      for (const i of any) {
        if (i.onModel) why.add('worn by a model');
        if (i.background !== 'plain') why.add('busy background');
        if (!i.garmentFullyVisible) why.add('garment partly hidden');
        if (Math.max(i.width, i.height) < MIN_LONG_EDGE) why.add(`long edge ${Math.max(i.width, i.height)} px < ${MIN_LONG_EDGE}`);
      }
      reasons.push(`${role} photo does not meet the contract (${[...why].join(', ')}); add one on a hanger, flat-lay or ghost mannequin`);
    }
  }
  if (!baseSize) reasons.push('set the base size');
  else reasons.push(`base size ${baseSize} is our default, not confirmed by the shop`);
  if (!hasFabric) reasons.push('add the fabric');
  return { ready: reasons.length === 1 && reasons[0]!.startsWith('base size'), reasons };
}

async function main(): Promise<void> {
  if (values.fetch) await fetchCatalogue();
  const { products, pages } = loadCatalogue();
  const byHandle = new Map(products.map((p) => [p.handle, p]));
  const typeCounts: Record<string, number> = {};
  for (const p of products) typeCounts[p.product_type] = (typeCounts[p.product_type] ?? 0) + 1;

  const imagesOut: Record<string, ImageRecord[]> = {};
  const productsOut = [];
  for (const sel of SHOP_SELECTION) {
    const p = byHandle.get(sel.handle);
    if (!p) throw new Error(`selected product ${sel.handle} is not in the catalogue`);
    if (p.product_type !== sel.productType) throw new Error(`${sel.handle} is now ${p.product_type}, not ${sel.productType}`);
    if (values.fetch) await downloadImages(p);

    const cls = SHOP_IMAGE_CLASSIFICATION[sel.handle] ?? [];
    const records: ImageRecord[] = p.images.map((img) => {
      const c = cls.find((x) => x.position === img.position);
      if (!c) throw new Error(`${sel.handle} image ${img.position} has no classification; look at it and add one`);
      const file = imagePath(sel.handle, img.position);
      const buf = file ? readFileSync(file) : undefined;
      return {
        ...c,
        url: img.src,
        width: img.width,
        height: img.height,
        file: file ? relative(dataDir, file) : null,
        sha256: buf ? createHash('sha256').update(buf).digest('hex') : null,
        bytes: buf ? buf.length : null,
      };
    });
    imagesOut[sel.handle] = records;

    const built = buildShopPayload(p);
    const ranking = rankCandidates(products, sel.productType).slice(0, 5);
    productsOut.push({
      ...built,
      selection: { why: sel.why, runnersUp: sel.runnersUp, topByTextCriteria: ranking },
      threeD: threeDReadiness(records, built.baseSize, built.payload.fabric !== undefined),
    });
  }

  const missingFiles = Object.values(imagesOut).flat().filter((r) => r.sha256 === null).length;
  const report = {
    shop: SHOP,
    source: `https://${SHOP.domain}/products.json?limit=250&page=N (public storefront endpoint), pages ${pages.join(', ')}`,
    catalogue: { products: products.length, byProductType: typeCounts },
    rejectedProductTypes: Object.entries(typeCounts)
      .filter(([t]) => !SHOP_SELECTION.some((s) => s.productType === t))
      .map(([type, count]) => ({ type, count, reason: SHOP_REJECTED_TYPES[type] ?? 'not reviewed' })),
    method: {
      sizeChart: "AU size options use AU_WOMENS_BODY_CHART (@curtain/schema, docs/research/au-size-chart.md) restricted to the sizes offered, sizeChartType 'body'; S-M style options use the mean of the AU rows the stated range covers; one-size items use flat measurements from the text as a 'garment' chart.",
      baseSize: 'AU 12 (or the range that holds it) for every size-ranged item: our default, not stated by the shop. GarmentPayload v1 has no baseSize field, so it sits beside the payload.',
      ease: 'Only where the shop prints garment measurements: printed value at the base size minus the AU body chart at the base size.',
      fabric: 'The fabric sentence of the description (labels, percentages, "crafted from", never styling advice) through resolveFabricText/fabricFromText; the fabric library fills weight, stretch, drape, opacity and sheen.',
      images: 'images.json: every image looked at and classified by hand; sha256 of the file as downloaded.',
    },
    products: productsOut,
  };
  writeFileSync(join(dataDir, 'products.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(
    join(dataDir, 'images.json'),
    `${JSON.stringify({ shop: SHOP.domain, minLongEdgePx: MIN_LONG_EDGE, note: 'Classification by eye; image bytes stay in raw/ (gitignored).', products: imagesOut }, null, 2)}\n`,
  );
  for (const p of productsOut) {
    console.log(
      `[shop] ${p.productType.padEnd(16)} ${p.handle.padEnd(32)} completeness ${p.completeness.score.toFixed(3)} ${p.completeness.status}; ` +
        `3D ${p.threeD.ready ? 'ready' : 'not ready'}; ${p.warnings.length} warnings`,
    );
  }
  if (missingFiles) console.log(`[shop] ${missingFiles} images not downloaded yet (sha256 null); run with --fetch`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
