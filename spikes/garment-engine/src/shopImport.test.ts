import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GarmentPayloadDraftSchema, isSizeAdviceReady } from '@curtain/schema';
import type { ShopifyProduct } from './shop';
import {
  buildImportPayload,
  categoryFor,
  lengthBand,
  paragraphCells,
  parseNumericSizeTable,
  parseProductPage,
  parseSizeGuide,
  sizeOffer,
  wearingLengthUse,
  type ShopBodyChart,
} from './shopImport';
import { threeDReadiness, type ImageRecord } from './shopReadiness';
import { NOBODYSCHILD_IMAGE_CLASSIFICATION, NOBODYSCHILD_REJECTED_TYPES, NOBODYSCHILD_SELECTION, NOBODYSCHILD_STATUS, nobodyschildAdapter } from './shops/nobodyschild';
import { SHOPS, shopPhotoChoice, shopProduct } from './product';
import { adviseProduct, chartBodies } from './shopSizeAdvice';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'nobodyschild');
const cells = (JSON.parse(readFileSync(join(dir, 'fixtures', 'size-guide.cells.json'), 'utf8')) as { cells: string[] }).cells;
const sample = (JSON.parse(readFileSync(join(dir, 'fixtures', 'products.sample.json'), 'utf8')) as { products: ShopifyProduct[] }).products;
const byHandle = (h: string): ShopifyProduct => sample.find((p) => p.handle === h)!;
const SOURCE = { url: 'https://nobodyschild.com/pages/size-guide', accessed: '2026-11-08', note: 'test' };
const chart: ShopBodyChart = parseSizeGuide(cells, SOURCE);
const adapter = nobodyschildAdapter(chart);

/** A product page in the theme's structure, with a shop-the-look drawer that carries ANOTHER product's facts. */
function page(own: { model?: string; fabric?: string }, other = "Model's height is 5'10\" - she wears a UK size 8. Wearing length is: 53cm."): string {
  return [
    '<html><body>',
    own.model !== undefined ? `<span class="product-page__details--model-size body-3"><p class="body-3">${own.model}</p></span>` : '',
    `<p class="shop-the-look-drawer__model-size body-3">Model wears a UK size ${other}</p>`,
    own.fabric !== undefined
      ? `<div class="accordion-fabric-and-care accordion-flex-container"><div class="fabric-care-paragraph"><span class="body-2"> Fabric </span><p>${own.fabric}</p><p>Excludes non-textile components</p></div><div><span> Washcare </span><p>Machine wash</p></div></div>`
      : '',
    '<script>var x = "Wearing length is: 999cm";</script></body></html>',
  ].join('\n');
}

describe('size guide → the shop\'s body chart', () => {
  it('reads the cm numeric table UK 4–24 (the inch copy is skipped)', () => {
    expect(chart.system).toBe('UK');
    expect(chart.numeric.map((r) => r.size)).toEqual(['4', '6', '8', '10', '12', '14', '16', '18', '20', '22', '24']);
    expect(chart.numeric.find((r) => r.size === '8')).toEqual({ size: '8', bust: 86, waist: 68, hip: 93 });
    expect(chart.numeric.find((r) => r.size === '24')).toEqual({ size: '24', bust: 129, waist: 112, hip: 136 });
  });

  it('reads the letter table with the UK sizes each letter covers', () => {
    expect(chart.letter.map((r) => [r.size, r.covers.join('-'), r.bust])).toEqual([
      ['XS', '4-6', 82],
      ['S', '8-10', 90],
      ['M', '12-14', 100],
      ['L', '16-18', 114],
      ['XL', '20-22', 124],
    ]);
  });

  it('reads the body inside leg per trouser length in cm', () => {
    expect(chart.insideLeg).toEqual({ short: 74, regular: 79, long: 84 });
  });

  it('reports the printed chart\'s own defects instead of correcting them', () => {
    expect(chart.defects).toContain('letter XS: EU range printed as "32-24"');
    expect(chart.defects.some((d) => d.startsWith('letter M: US size'))).toBe(true);
    // Each letter is the body of the top of its UK range, which is consistent: no defect for that.
    expect(chart.defects.some((d) => d.includes('repeats the body'))).toBe(false);
  });

  it('infers the block width of unlabelled blocks from the UK sizes and stops at a malformed block', () => {
    const t = ['UK SIZE', '4', '6', 'EU', '32', '34', 'US', '0', '2', 'BUST', '78', '82', 'WAIST', '60', '64', 'HIPS', '85', '89', '8', '10', '12', '36', '38', '40', '4', '6', '8', '86', '90', '95', '68', '72', '78', '93', '97', '102', '14', 'x'];
    const r = parseNumericSizeTable(t, 0)!;
    expect(r.rows.map((x) => x.size)).toEqual(['4', '6', '8', '10', '12']);
    expect(r.rows[4]).toMatchObject({ size: '12', eu: '40', us: '8', bust: 95, waist: 78, hip: 102 });
    expect(parseNumericSizeTable(['UK SIZE', '4', 'EU', '32', 'BUST', '78'], 0)).toBeUndefined();
  });

  it('works on HTML paragraphs', () => {
    expect(paragraphCells('<p>UK SIZE</p><script>"<p>no</p>"</script><p> 4 &amp; </p><p></p>')).toEqual(['UK SIZE', '4 &']);
  });
});

describe('product page facts', () => {
  it('reads composition, model size and wearing length from the product\'s own blocks only', () => {
    const f = parseProductPage(page({ model: "Model's height is 5'7\" - she wears a UK size 8. Wearing Length is: 90cm", fabric: 'Main: 100% Cotton | Lining: 100% Cotton' }));
    expect(f.fabricMain).toBe('100% Cotton');
    expect(f.fabricOther).toEqual(['Lining: 100% Cotton']);
    expect(f.modelSize).toEqual({ system: 'UK', size: '8' });
    expect(f.wearingLengthCm).toBe(90);
  });

  it('never takes a cross-sell drawer\'s wearing length (the skirt page carries the matching top\'s 53 cm)', () => {
    const f = parseProductPage(page({ model: "Model's height is 5'9 - she wears a UK size 8.", fabric: 'Main: 100% Cotton' }));
    expect(f.wearingLengthCm).toBeUndefined();
    const none = parseProductPage(page({}));
    expect(none.modelSize).toBeUndefined();
    expect(none.wearingLengthCm).toBeUndefined();
    expect(none.fabricMain).toBeUndefined();
    expect(none.evidence.modelSize).toMatch(/no "product-page__details--model-size" block/);
  });

  it('reads a letter size labelled "UK size S" and refuses a length without cm', () => {
    const f = parseProductPage(page({ model: "Model's height is 5'10\" - she wears a UK size S. Wearing length is: 4.7cm.", fabric: 'Main: 51% Wool, 49% Polyester | Binding: 100% Cotton' }));
    expect(f.modelSize).toEqual({ system: 'UK', size: 'S' });
    expect(f.wearingLengthCm).toBeUndefined();
    expect(f.evidence.wearingLength).toMatch(/not used/);
    expect(f.fabricMain).toBe('51% Wool, 49% Polyester');
  });
});

describe('category, length band and wearing length', () => {
  it('maps product types and tags to category, subcategory and pattern block', () => {
    expect(categoryFor(byHandle('ezra-midi-dress-2616487001'), adapter)).toMatchObject({ category: 'dress', subcategory: 'midaxi-dress' });
    expect(categoryFor(byHandle('ronda-skirt-2614903002'), adapter)).toMatchObject({ category: 'bottom', subcategory: 'midi-skirt' });
    expect(categoryFor(byHandle('topaz-trousers-2616025001'), adapter)).toMatchObject({ category: 'bottom', subcategory: 'wide-leg-trousers', patternBlock: 'wide-leg' });
    expect(categoryFor(byHandle('tie-neck-df-jacket-2616863001'), adapter)).toMatchObject({ category: 'outerwear', subcategory: 'jacket' });
    expect(categoryFor({ ...byHandle('ezra-midi-dress-2616487001'), product_type: 'Footwear' }, adapter)).toBeUndefined();
    expect(lengthBand(byHandle('ronda-skirt-2614903002'))).toBe('midi');
  });

  it('checks a wearing length against the category and band before using it', () => {
    expect(wearingLengthUse(90, { category: 'bottom', subcategory: 'midi-skirt' }, 'midi')).toMatchObject({ key: 'waist_to_hem', ok: true });
    // The matching top's 53 cm on a midi skirt: rejected, not silently used.
    expect(wearingLengthUse(53, { category: 'bottom', subcategory: 'midi-skirt' }, 'midi')).toMatchObject({ ok: false });
    expect(wearingLengthUse(130, { category: 'dress', subcategory: 'midaxi-dress' }, 'midaxi')).toMatchObject({ key: 'shoulder_to_hem', ok: true });
    expect(wearingLengthUse(60, { category: 'bottom', subcategory: 'wide-leg-trousers' }, 'regular').ok).toBe(false);
  });
});

describe('size offer against the shop chart', () => {
  it('numeric, letter and a second Length option', () => {
    expect(sizeOffer(byHandle('ezra-midi-dress-2616487001'), chart)).toMatchObject({ kind: 'numeric', missing: [], extraOptions: [] });
    expect(sizeOffer(byHandle('tie-neck-df-jacket-2616863001'), chart)).toMatchObject({ kind: 'letter', sizes: ['XS', 'S', 'M', 'L', 'XL'], missing: [] });
    const petite = { ...byHandle('ezra-midi-dress-2616487001'), options: [{ name: 'Size', values: ['4', '6', '26'] }, { name: 'Length', values: ['Regular', 'Petite'] }] };
    expect(sizeOffer(petite, chart)).toMatchObject({ missing: ['26'], extraOptions: [{ name: 'Length', values: ['Regular', 'Petite'] }] });
  });
});

describe('buildImportPayload', () => {
  const skirtPage = parseProductPage(page({ model: "Model's height is 5'7\" - she wears a UK size 8. Wearing Length is: 90cm", fabric: 'Main: 100% Cotton' }));

  it('builds a valid draft from the shop chart, the page composition and the photographed size', () => {
    const r = buildImportPayload(byHandle('ronda-skirt-2614903002'), adapter, skirtPage);
    expect(GarmentPayloadDraftSchema.safeParse(r.payload).success).toBe(true);
    expect(r.payload.sizeChartType).toBe('body');
    expect(r.payload.sizeChart?.map((x) => x.size)).toEqual(['4', '6', '8', '10', '12', '14', '16', '18']);
    expect(r.payload.fabric).toMatchObject({ primary: 'cotton', blend: [['cotton', 100]] });
    expect(r.payload.lengthCm).toEqual({ waist_to_hem: 90 });
    expect(r.payload.stretchZones).toEqual(['waistband']);
    expect(r).toMatchObject({ baseSize: '8', baseSizeSource: 'shop', price: { amount: 55, currency: 'GBP' } });
    expect(r.payload).not.toHaveProperty('primaryColorHex');
    expect(r.payload).not.toHaveProperty('priceEur');
    expect(isSizeAdviceReady(r.payload)).toBe(true);
  });

  it('without a product page: no fabric (the fabric-group tag is a family, never a composition) and our default base size, flagged', () => {
    const r = buildImportPayload(byHandle('ronda-skirt-2614903002'), adapter);
    expect(r.payload.fabric).toBeUndefined();
    expect(r.warnings.some((w) => w.includes('fabric-group tag'))).toBe(true);
    expect(r.baseSizeSource).toBe('ours');
    expect(r.evidence.baseSize).toMatch(/our default/);
  });

  it('trousers: inside leg from the length tag, never a wearing length', () => {
    const p = parseProductPage(page({ model: "Model's height is 5'9 - she wears a UK size 8. Wearing length is: 60cm", fabric: 'Main: 100% Cotton' }));
    const r = buildImportPayload(byHandle('topaz-trousers-2616025001'), adapter, p);
    expect(r.payload.sizeChart?.every((x) => x.inseam === 79)).toBe(true);
    expect(r.payload.lengthCm).toBeUndefined();
    expect(r.warnings.some((w) => w.startsWith('wearing length: trousers'))).toBe(true);
  });

  it('letter sizes: the letter chart, the model\'s letter size as base', () => {
    const p = parseProductPage(page({ model: "Model's height is 5'10\" - she wears a UK size S. Wearing length is: 59cm", fabric: 'Main: 51% Wool, 49% Polyester | Binding: 100% Cotton' }));
    const r = buildImportPayload(byHandle('tie-neck-df-jacket-2616863001'), adapter, p);
    expect(r.payload.sizeChart?.map((x) => x.size)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    expect(r.baseSize).toBe('S');
    expect(r.payload.fabric?.blend).toEqual([['wool', 51], ['polyester', 49]]);
    expect(r.warnings.some((w) => w.includes('Binding'))).toBe(true);
    expect(r.features).toMatchObject({ sleeve: 'long', front: 'buttoned' });
  });

  it('a model size in a letter range maps to that letter, flagged as inferred', () => {
    const p = parseProductPage(page({ model: "Model's height is 5'10\" - she wears a UK size 8.", fabric: 'Main: 100% Wool' }));
    const r = buildImportPayload(byHandle('tie-neck-df-jacket-2616863001'), adapter, p);
    expect(r.baseSize).toBe('S');
    expect(r.warnings.some((w) => w.includes('inferred'))).toBe(true);
  });
});

describe('3D readiness and photo choice', () => {
  const img = (o: Partial<ImageRecord>): ImageRecord => ({ position: 1, role: 'front', onModel: true, background: 'plain', garmentFullyVisible: true, notes: '', url: 'u', width: 1600, height: 2080, file: null, sha256: null, bytes: null, ...o });

  it('a base size stated by the shop is not a reason; ours is', () => {
    const ok = [img({ onModel: false }), img({ position: 2, role: 'back', onModel: false })];
    expect(threeDReadiness(ok, '8', true, true, 1600)).toEqual({ ready: true, reasons: [] });
    expect(threeDReadiness(ok, '8', false, true, 1600).ready).toBe(true);
    expect(threeDReadiness(ok, '8', false, true, 1600).reasons).toEqual(['base size 8 is our default, not confirmed by the shop']);
    expect(threeDReadiness([img({ onModel: false, width: 960, height: 1248 })], 'S', true, true, 1600).reasons[0]).toMatch(/long edge 1248 px < 1600/);
  });

  it('prefers a plain-background photo over an earlier busy one', () => {
    const imagesJson = { products: { h: [img({ position: 1, background: 'busy' }), img({ position: 2 }), img({ position: 3, role: 'back' })] } };
    expect(shopPhotoChoice(imagesJson, 'h').front.position).toBe(2);
  });
});

describe('committed nobodyschild data', () => {
  const products = JSON.parse(readFileSync(join(dir, 'products.json'), 'utf8')) as {
    shop: { status: string };
    sizeChart: ShopBodyChart;
    products: Array<{ handle: string; productType: string; baseSize?: string; baseSizeSource?: string; payload: unknown; warnings: string[] }>;
  };
  const images = JSON.parse(readFileSync(join(dir, 'images.json'), 'utf8')) as { products: Record<string, Array<{ position: number; sha256: string | null }>> };

  it('is labelled a test shop, not a partner', () => {
    expect(products.shop.status).toBe(NOBODYSCHILD_STATUS);
    expect(NOBODYSCHILD_STATUS).toMatch(/Not a partner/);
  });

  it('one product per selection entry, each a valid draft with the photographed base size', () => {
    expect(SHOPS).toContain('nobodyschild');
    expect(products.products.map((p) => p.handle)).toEqual(NOBODYSCHILD_SELECTION.map((s) => s.handle));
    for (const p of products.products) {
      expect(GarmentPayloadDraftSchema.safeParse(p.payload).success, p.handle).toBe(true);
      expect(p.baseSizeSource, p.handle).toBe('shop');
      const r = shopProduct('nobodyschild', products, p.handle);
      expect(r.baseSize).toBe(p.baseSize);
    }
  });

  it('every image classified and pinned by a sha256; the chart parsed with its defects', () => {
    for (const s of NOBODYSCHILD_SELECTION) {
      const imgs = images.products[s.handle]!;
      expect(imgs.length).toBe(NOBODYSCHILD_IMAGE_CLASSIFICATION[s.handle]!.length);
      for (const i of imgs) expect(i.sha256, `${s.handle} #${i.position}`).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(products.sizeChart.numeric).toHaveLength(11);
    expect(products.sizeChart.defects.length).toBeGreaterThan(0);
    for (const t of Object.keys(NOBODYSCHILD_REJECTED_TYPES)) expect(adapter.productTypes[t]).toBeUndefined();
  });

  it('size advice on the shop chart gives a chart row its own size or a neighbour', () => {
    const bodies = chartBodies(chart.numeric, ['8', '12', '16'], 79);
    for (const p of products.products.filter((x) => x.productType !== 'Outerwear')) {
      for (const row of adviseProduct(p.handle, p.payload as never, bodies, 'shop')) expect(row.ok, `${p.handle} ${row.body} → ${row.recommended}`).toBe(true);
    }
  });
});
