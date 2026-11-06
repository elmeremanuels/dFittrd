import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AU_WOMENS_BODY_CHART, GarmentPayloadDraftSchema } from '@curtain/schema';
import {
  buildShopPayload,
  classifyPrintedTable,
  fabricStatement,
  htmlToLines,
  parseFlatMeasurements,
  parsePrintedTable,
  parseSizeOffer,
  rankCandidates,
  type ShopifyProduct,
} from './shop';
import { SHOP_IMAGE_CLASSIFICATION, SHOP_SELECTION } from './shopSelection';

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bohohippychic', 'fixtures', 'products.sample.json'), 'utf8'),
) as { products: ShopifyProduct[] };
const product = (handle: string) => fixture.products.find((p) => p.handle === handle)!;

function fake(over: Partial<ShopifyProduct>): ShopifyProduct {
  return {
    id: 1,
    title: 'Test Top',
    handle: 'test-top',
    body_html: '',
    vendor: 'Boho Hippy Chic',
    product_type: 'Tops',
    tags: [],
    options: [{ name: 'Title', values: ['Default Title'] }],
    variants: [{ id: 1, title: 'Default Title', option1: 'Default Title', price: '59.00' }],
    images: [],
    ...over,
  };
}

describe('htmlToLines', () => {
  it('splits on blocks and <br>, decodes entities, drops tags', () => {
    expect(htmlToLines('<p>A&nbsp;&amp; B<br/>C</p><h5>35%WOOL</h5>tail')).toEqual(['A & B', 'C', '35%WOOL', 'tail']);
    expect(htmlToLines(null)).toEqual([]);
  });
});

describe('parseSizeOffer', () => {
  it('reads AU numeric sizes, sorted', () => {
    expect(parseSizeOffer(product('azure-palm-baby-doll-dress'))).toEqual({ kind: 'au-numeric', sizes: ['8', '10', '12', '14', '16'] });
    expect(parseSizeOffer(fake({ options: [{ name: 'Size', values: ['10', '14', '16', '8', '12'] }] }))).toEqual({
      kind: 'au-numeric',
      sizes: ['8', '10', '12', '14', '16'],
    });
  });

  it('maps S-M / M-L to AU ranges from the text, even when the shop glues them together ("12M-L")', () => {
    expect(parseSizeOffer(product('woodstock-wanderer-knit-cardi'))).toEqual({
      kind: 'au-range',
      ranges: [
        { label: 'S-M', au: [8, 12] },
        { label: 'M-L', au: [14, 16] },
      ],
      unresolved: [],
    });
  });

  it('reports range labels the text does not explain', () => {
    const p = fake({ options: [{ name: 'Size', values: ['S-M', 'M-L'] }], body_html: '<p>S-M fits 8 to 12</p>' });
    expect(parseSizeOffer(p)).toMatchObject({ kind: 'au-range', ranges: [{ label: 'S-M', au: [8, 12] }], unresolved: ['M-L'] });
  });

  it('recognises one-size items and the AU range they fit', () => {
    expect(parseSizeOffer(fake({ body_html: '<p>Free Size- 8 to 16</p>' }))).toEqual({ kind: 'free', label: 'Default Title', fitsAu: [8, 16] });
  });
});

describe('printed measurements', () => {
  it('reads a size-per-row table and classifies it as garment measurements', () => {
    const t = parsePrintedTable(htmlToLines(product('azure-palm-baby-doll-dress').body_html).join(' '))!;
    expect(t.layout).toBe('size-per-row');
    expect(t.rows).toEqual([
      { size: '8', bust: 94, length: 90 },
      { size: '10', bust: 98, length: 90 },
      { size: '12', bust: 102, length: 91 },
      { size: '14', bust: 106, length: 92 },
      { size: '16', bust: 112, length: 93 },
    ]);
    expect(classifyPrintedTable(t)).toEqual({ kind: 'garment', meanAbsDiffCm: 7.4 });
  });

  it('reads a size-per-column table', () => {
    const t = parsePrintedTable(htmlToLines(product('rosewater-palazzo-pants').body_html).join(' '))!;
    expect(t.layout).toBe('size-per-column');
    expect(t.rows[2]).toEqual({ size: '12', waist: 112, hip: 118, length: 99 });
  });

  it('classifies a restated AU body chart as a body chart', () => {
    const text = 'Size Bust Waist Hips 8 84 cm 68 cm 93 cm 10 89 cm 73 cm 98 cm 12 94 cm 78 cm 103 cm';
    expect(classifyPrintedTable(parsePrintedTable(text)!).kind).toBe('body');
  });

  it('reads flat measurements of one-size items (flat width doubled, or the stated circumference)', () => {
    expect(parseFlatMeasurements('Chest measured across front, laid flat: 51 cm Length from shoulder: 79 cm')).toMatchObject({ chestCm: 102, lengthCm: 79 });
    expect(parseFlatMeasurements('Ribbed cuffs and hem Chest 124cm circumfrence Length 60cm Free Size- 8 to 16')).toMatchObject({ chestCm: 124, lengthCm: 60 });
    expect(parseFlatMeasurements('No numbers here')).toBeUndefined();
  });
});

describe('fabricStatement', () => {
  it('prefers the composition and ignores styling advice that names a fabric', () => {
    expect(fabricStatement(['Pair it with denim for a relaxed look.', 'Crafted from 100% lightweight rayon, it drapes beautifully.'])).toBe(
      'Crafted from 100% lightweight rayon, it drapes beautifully.',
    );
    expect(fabricStatement(['Wear it with linen pants.'])).toBeUndefined();
    expect(fabricStatement(['Details: Button front', 'Fabric: Lightweight rayon blend — breathable'])).toBe('Lightweight rayon blend — breathable');
  });
});

describe('buildShopPayload', () => {
  it('dress: AU body chart for the offered sizes, ease and length from the printed garment table at base AU 12', () => {
    const r = buildShopPayload(product('azure-palm-baby-doll-dress'));
    expect(GarmentPayloadDraftSchema.safeParse(r.payload).success).toBe(true);
    expect(r.baseSize).toBe('12');
    expect(r.payload).toMatchObject({ category: 'dress', patternBlock: 'empire', sizeChartType: 'body', lengthCm: { shoulder_to_hem: 91 } });
    expect(r.payload.sizeChart).toEqual(AU_WOMENS_BODY_CHART.filter((row) => ['8', '10', '12', '14', '16'].includes(row.size)));
    expect(r.payload.ease).toEqual({ bust: 102 - 95 });
    expect(r.payload.fabric).toMatchObject({ primary: 'viscose', blend: [['viscose', 100]] });
    expect(r.payload.priceEur).toBeUndefined();
    expect(r.completeness.status).toBe('incomplete');
    expect(r.completeness.missing.map((m) => m.field)).toContain('flatLayPhoto');
    expect(r.fullSchemaIssues.some((i) => i.startsWith('primaryColorHex'))).toBe(true);
  });

  it('pants: hip ease from the table, elastic waist not used as ease and flagged, outseam, waistband stretch zone', () => {
    const r = buildShopPayload(product('rosewater-palazzo-pants'));
    expect(r.payload).toMatchObject({ category: 'bottom', patternBlock: 'wide-leg', lengthCm: { outseam: 99 }, stretchZones: ['waistband'] });
    expect(r.payload.ease).toEqual({ hip: 118 - 104 });
    expect(r.warnings.some((w) => w.includes('waist 8→10: 94 → 110'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('elastic'))).toBe(true);
  });

  it('knit: S-M / M-L rows are the mean of the AU rows they cover; base S-M holds AU 12; composition from the label', () => {
    const r = buildShopPayload(product('woodstock-wanderer-knit-cardi'));
    expect(r.payload.category).toBe('outerwear');
    expect(r.payload.sizeChart).toEqual([
      { size: 'S-M', bust: 90, waist: 72.5, hip: 99 },
      { size: 'M-L', bust: 102.5, waist: 85, hip: 111.5 },
    ]);
    expect(r.baseSize).toBe('S-M');
    expect(r.payload.fabric?.blend).toEqual([
      ['acrylic', 65],
      ['wool', 35],
    ]);
    expect(r.warnings.some((w) => w.includes('sweater-knit'))).toBe(true);
  });

  it('one-size item with flat measurements gets a garment chart; without them it stays incomplete', () => {
    const withFlat = buildShopPayload(fake({ title: 'Saltwater Coast Knit', product_type: 'Jackets & Knits', body_html: '<p>Chest 124cm circumfrence Length 60cm Free Size- 8 to 16</p><p>100% acrylic</p>' }));
    expect(withFlat.payload).toMatchObject({ sizeChartType: 'garment', sizeChart: [{ size: 'ONE', bust: 124 }], lengthCm: { shoulder_to_hem: 60 } });
    const without = buildShopPayload(fake({ body_html: '<p>Free size, fits 8-18. 100% cotton.</p>' }));
    expect(without.payload.sizeChart).toBeUndefined();
    expect(without.completeness.missing.map((m) => m.field)).toContain('sizeChart');
  });
});

describe('selection data', () => {
  it('has one product per apparel collection and a classification for every fixture image', () => {
    expect(new Set(SHOP_SELECTION.map((s) => s.productType)).size).toBe(5);
    for (const p of fixture.products) {
      const cls = SHOP_IMAGE_CLASSIFICATION[p.handle]!;
      expect(cls.map((c) => c.position)).toEqual(p.images.map((i) => i.position));
      expect(cls.some((c) => c.role === 'back')).toBe(true);
    }
  });

  it('ranks by the preference order: sizes, 3+ images, fabric, garment measurements', () => {
    const ranked = rankCandidates(fixture.products, 'Dresses');
    expect(ranked[0]).toMatchObject({ handle: 'azure-palm-baby-doll-dress', sizes: true, fabric: true, garmentMeasurements: true, images: 4 });
  });
});
