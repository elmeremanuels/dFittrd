#!/usr/bin/env node
/**
 * Export parity fixtures for the PHP tests from @curtain/schema:
 * for every MOCK_GARMENT, the Woo meta rows `toWooMeta` would store, a minimal WC product snapshot,
 * and what the TypeScript normaliser `fromWooMeta` produces from them. The PHP Payload_Builder must
 * reproduce `expected` byte-for-byte (canonical JSON) — it is the PHP twin of fromWooMeta.
 *
 * Also: assets/fabric-library.json (the lexicon the PHP fabric-text twin reads) and
 * tests/fixtures/fabric-text.json, real-looking English and Dutch fabric texts with what
 * `resolveFabricText`, `fabricFromProductText` and `fromWooMeta` make of them.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHART_COLUMN_CASES, checkChartColumns, wlAxesFromLabel, SizeChartSchema, SYNTHETIC_MENS_TEE, SYNTHETIC_MENS_CHINO_WL, GARMENT_TAPE_FORM_CASES, GARMENT_TAPE_FORM_TEXT, PILOT_PULL_ON_SKIRT, checkGarmentTapeInput, refillGarmentTape, measuredFromGarmentTape, MOCK_GARMENTS, MENS_FIXTURE_GARMENTS, AUDIENCE_CASES, inferAudienceDecision, fromWooMeta, toWooMeta, ESTIMATE_DISCLAIMER, FABRIC_TEXT_FIELD, fabricFromProductText, resolveFabricText } from '@curtain/schema';
import { writeChartTemplatesAsset } from './chart-templates.mjs';
import { writeEurRatesAsset } from './eur-rates.mjs';
import { DEFAULT_EUR_RATES } from '@curtain/shopify-app';
import { writeFabricLibraryAsset } from './fabric-library.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const cases = MOCK_GARMENTS.map((g) => {
  const product = {
    id: g.id,
    name: g.name,
    permalink: g.productUrl ?? null,
    price: String(g.priceEur),
    regular_price: String(g.priceEur),
    currency: 'EUR',
    images: (g.productPhotos ?? []).map((src) => ({ src, alt: '' })),
    categories: [],
    brands: [],
    attributes: [],
  };
  const meta = toWooMeta(g);
  const warnings = [];
  const expected = fromWooMeta(product, meta, { warnings, defaultBrand: 'Fixture Shop' });
  return { id: g.id, product, meta, expected, warnings };
});

mkdirSync(join(root, 'tests/fixtures'), { recursive: true });
writeFileSync(join(root, 'tests/fixtures/garments.json'), JSON.stringify({ disclaimer: ESTIMATE_DISCLAIMER, cases }, null, 1));
console.log(`wrote tests/fixtures/garments.json (${cases.length} garments)`);

writeFabricLibraryAsset(root);
writeChartTemplatesAsset(root);
writeEurRatesAsset(root);

// The JSON Schemas the PHP validator reads (also copied by scripts/build.mjs): refreshed here so
// the PHP tests never run against a copy from before a schema change.
const schemaDist = join(dirname(createRequire(import.meta.url).resolve('@curtain/schema/package.json')), 'dist');
for (const name of ['garment.schema.json', 'garment-draft.schema.json']) {
  if (!existsSync(join(schemaDist, name))) {
    console.error(`missing ${join(schemaDist, name)}: build @curtain/schema first`);
    process.exit(1);
  }
  copyFileSync(join(schemaDist, name), join(root, 'assets', name));
}
console.log('copied assets/garment.schema.json and assets/garment-draft.schema.json from @curtain/schema');

// Audience (women / men / unisex): the shared cases with what inferAudienceDecision answers now, and
// WooCommerce products (the two men's fixtures as a shop would hold them, plus override and
// false-positive products) with what fromWooMeta makes of them. Vocab::infer_audience and the PHP
// builder must give the same.
const audienceCases = AUDIENCE_CASES.map((c) => {
  const d = inferAudienceDecision(c.hints);
  return { name: c.name, hints: c.hints, audience: d?.audience ?? null, source: d?.source ?? null };
});
const wooProduct = (g, extra) => ({ id: g.id, name: g.name, price: String(g.priceEur), currency: 'EUR', images: [], categories: [], tags: [], brands: [], attributes: [], ...extra });
const withoutAudience = (g) => toWooMeta(g).filter((row) => row.key !== '_curtain_audience');
const [shirt, jeans] = MENS_FIXTURE_GARMENTS;
const audienceProductInputs = [
  { name: "men's shirt, audience stored in the meta box", product: wooProduct(shirt, {}), meta: toWooMeta(shirt) },
  { name: "men's jeans, audience stored in the meta box", product: wooProduct(jeans, {}), meta: toWooMeta(jeans) },
  { name: "men's shirt, audience read from the name", product: wooProduct(shirt, {}), meta: withoutAudience(shirt) },
  { name: 'jeans, audience read from the category path', product: wooProduct(jeans, { name: 'Straight Jeans', categories: [{ name: 'Heren > Jeans', slug: 'jeans' }] }), meta: withoutAudience(jeans) },
  { name: 'shirt, audience read from a tag', product: wooProduct(shirt, { name: 'Oxford Button-Down Shirt', tags: [{ name: 'mens', slug: 'mens' }] }), meta: withoutAudience(shirt) },
  { name: 'shirt, audience read from a Geslacht attribute', product: wooProduct(shirt, { name: 'Oxford Button-Down Shirt', attributes: [{ name: 'Geslacht', slug: 'pa_geslacht', options: ['Heren'] }] }), meta: withoutAudience(shirt) },
  { name: 'an attribute that is not about the audience is not read', product: wooProduct(shirt, { name: 'Oxford Button-Down Shirt', attributes: [{ name: 'Collectie', slug: 'pa_collectie', options: ['Heren'] }] }), meta: withoutAudience(shirt) },
  { name: 'women contains men: a women\'s product stays women', product: wooProduct(jeans, { name: "Women's Slim Jeans", categories: [{ name: 'Women > Jeans' }], tags: [{ name: 'womens' }] }), meta: withoutAudience(jeans) },
  { name: 'garment, element: no audience', product: wooProduct(shirt, { name: 'Garment-dyed Element Shirt' }), meta: withoutAudience(shirt) },
  { name: 'both categories: unisex', product: wooProduct(shirt, { name: 'Oxford Shirt', categories: [{ name: 'Dames' }, { name: 'Heren' }] }), meta: withoutAudience(shirt) },
  { name: 'merchant override beats the category', product: wooProduct(shirt, { name: 'Oxford Shirt', categories: [{ name: 'Heren' }] }), meta: [...withoutAudience(shirt), { key: '_curtain_audience', value: 'women' }] },
  { name: 'override none: no audience, no inference', product: wooProduct(shirt, {}), meta: [...withoutAudience(shirt), { key: '_curtain_audience', value: 'none' }] },
  { name: 'an override that is not understood warns and is ignored', product: wooProduct(shirt, {}), meta: [...withoutAudience(shirt), { key: '_curtain_audience', value: 'kids' }] },
];
const audienceProducts = audienceProductInputs.map(({ name, product, meta }) => {
  const warnings = [];
  const expected = fromWooMeta(product, meta, { warnings, defaultBrand: 'Fixture Shop' });
  return { name, product, meta, expected, warnings };
});
writeFileSync(join(root, 'tests/fixtures/audience.json'), JSON.stringify({ cases: audienceCases, products: audienceProducts }, null, 1));
console.log(`wrote tests/fixtures/audience.json (${audienceCases.length} cases, ${audienceProducts.length} products)`);

// Shop prices in other currencies (the pilot sells in AUD): what fromWooMeta makes of them with the
// api's EUR rate table. The PHP builder must give the same priceEur and the same warnings.
const priceCases = [['89.95', 'EUR'], ['149', 'AUD'], ['149.00', 'aud'], ['120', 'USD'], ['10', 'XTS']].map(([price, currency]) => {
  const warnings = [];
  const out = fromWooMeta({ id: 1, name: 'Price case', price }, {}, { warnings, currency, eurRates: DEFAULT_EUR_RATES, defaultBrand: 'Fixture Shop' });
  return { price, currency, priceEur: out.priceEur ?? null, warnings };
});
writeFileSync(join(root, 'tests/fixtures/prices.json'), JSON.stringify(priceCases, null, 1));

// Fabric text as shops write it (care labels, attributes, the meta box), English and Dutch.
const texts = [
  'Katoen', 'Linnen', 'Zijde', 'Wol', 'Kasjmier', 'Spijkerstof', 'Tricot', 'LYCRA®', 'Elastaan', 'Polyamide',
  'Lyocell', 'TENCEL™', 'Acryl', 'Satijn', 'Imitatieleer', 'Suède', 'Ribfluweel', 'Merinowol',
  '95% katoen, 5% elastaan', '95% Cotton, 5% Elastane', '100% Linnen', '100% linen', 'Cotton jersey',
  'Buitenstof: 100% wol. Voering: 100% viscose', 'Shell: 100% polyester. Lining: 100% cotton',
  '52% Polyester, 45% Viscose, 3% Elastaan', '70% viscose, 30% polyamide', 'Viscose 70%, Polyamide 30%',
  '60% katoen 40% polyester', 'Katoen met elastaan', 'organic cotton, elastane', '100% merinowol',
  '80% wol, 20% kasjmier', '97,5% katoen, 2,5% elastaan', 'TENCEL™ Lyocell 70%, Linen 30%',
  'Stretch denim (98% cotton, 2% elastane)', 'Gerecycled polyester', 'Faux leather (PU)', 'Bamboe', 'Zie label', '',
];
const fabricTexts = texts.map((text) => ({ text, resolved: resolveFabricText(text) ?? null }));

const attributeSets = [
  [{ name: 'Maat', slug: 'pa_maat', options: ['S', 'M', 'L'] }, { name: 'Materiaal', slug: 'pa_materiaal', options: ['95% viscose, 5% elastaan'] }],
  [{ name: 'Material', slug: 'material', options: ['98% organic cotton', '2% elastane'] }],
  [{ name: 'Samenstelling', slug: 'samenstelling', options: ['Bovenstof: 100% linnen. Voering: 100% katoen'] }],
  [{ name: 'Kleur', slug: 'pa_kleur', options: ['Zijdegrijs'] }],
];
const prefills = attributeSets.map((attributes) => ({
  attributes,
  prefill: fabricFromProductText(attributes.filter((a) => FABRIC_TEXT_FIELD.test(a.slug) || FABRIC_TEXT_FIELD.test(a.name.trim())).flatMap((a) => a.options)) ?? null,
}));

// The fabric meta box value → fromWooMeta's fabric and warnings (the PHP builder must match).
const metas = [
  { primary: 'Katoen', stretchPct: 2, drape: 0.5 },
  { primary: 'Viscose', blend: [['Viscose', 95], ['Elastaan', 5]], weightGsm: 160, stretchPct: 18, drape: 0.85 },
  { primary: '98% organic cotton, 2% elastane', stretchPct: 8, drape: 0.4 },
  { primary: '95% katoen, 5% elastaan', blend: [['cotton', 97], ['elastane', 3]], stretchPct: 12, drape: 0.6 },
  { primary: 'TENCEL™ Lyocell', blend: [['Tencel', 70], ['Linen', 30]], stretchPct: 2, drape: 0.8 },
  { primary: 'Spijkerstof', blend: [{ fibre: 'Katoen', pct: 98 }, { fibre: 'Elastaan', pct: 2 }], stretchPct: 10, drape: 0.25 },
  { primary: 'technical', blend: [['Polyamide', 88], ['Elastane', 12]], stretchPct: 40, drape: 0.5 },
  { primary: 'Bamboe', blend: [['Bamboe', 70], ['Katoen', 30]], stretchPct: 3, drape: 0.7 },
  { primary: 'linen', blend: [['linen', 100]], stretchPct: 2, drape: 0.78 },
  // D25 point 1: a fabric with a part missing keeps the rest; a part that is not valid is left
  // out with a warning. The product goes through either way.
  { primary: 'Katoen' },
  { primary: 'Linen', drape: 0.5 },
  { primary: 'Linen', stretchPct: 2 },
  { primary: 'Viscose', blend: [['Viscose', 95], ['Elastaan', 5]] },
  { stretchPct: 5 },
  { primary: 'Katoen', stretchPct: 150, drape: 0.5 },
  { primary: 'Katoen', stretchPct: -1, drape: 1.4, weightGsm: 0, opacity: 2, sheen: -0.1 },
  { primary: 'Katoen', weightGsm: 5000, stretchPct: 2.5, drape: 0 },
  { primary: 'Katoen', blend: [['Katoen', 120]], stretchPct: 2, drape: 0.5 },
  { primary: 'Katoen', blend: Array.from({ length: 9 }, (_, i) => [`fibre ${i + 1}`, 10]), stretchPct: 2, drape: 0.5 },
  { primary: 'x'.repeat(65), stretchPct: 2, drape: 0.5 },
  { primary: 'Katoen', blend: [['y'.repeat(65), 100]], stretchPct: 2 },
  { stretchPct: 150 },
];
const product = { id: 4182, name: 'Wikkeljurk Lotte', price: '89.95', categories: [{ name: 'Jurken' }] };
const fabricMetas = metas.map((fabric) => {
  const warnings = [];
  const out = fromWooMeta(product, { _curtain_fabric: JSON.stringify(fabric) }, { warnings, defaultBrand: 'Aalter Studio' });
  return { meta: JSON.stringify(fabric), fabric: out.fabric ?? null, warnings };
});

writeFileSync(join(root, 'tests/fixtures/fabric-text.json'), JSON.stringify({ texts: fabricTexts, prefills, metas: fabricMetas }, null, 1));
console.log(`wrote tests/fixtures/fabric-text.json (${fabricTexts.length} texts, ${prefills.length} attribute sets, ${fabricMetas.length} meta values) and assets/fabric-library.json`);

// Garment measurements (the meta box table): every shared form case with what the TypeScript check
// answers, the pilot skirt's stored tape read back through fromWooMeta (as stored, against a chart
// that lost a size, with a broken tape, with an unknown closure), and the form's own words.
// Garment_Tape and Payload_Builder must give the same.
const tapeCases = GARMENT_TAPE_FORM_CASES.map((c) => ({ name: c.name, input: c.input, expected: checkGarmentTapeInput(c.input) }));
const skirtProduct = { id: 4512, name: PILOT_PULL_ON_SKIRT.name, price: '89.95', currency: 'EUR', images: [], categories: [], tags: [], brands: [], attributes: [] };
const skirtMeta = toWooMeta(PILOT_PULL_ON_SKIRT);
const replace = (meta, key, value) => meta.map((m) => (m.key === key ? { ...m, value } : m));
const tapeProductInputs = [
  { name: 'the pilot skirt as stored', meta: skirtMeta },
  { name: 'the chart lost AU 16 after the tape was saved', meta: replace(skirtMeta, '_curtain_size_chart', JSON.stringify(PILOT_PULL_ON_SKIRT.sizeChart.slice(0, 4))) },
  { name: 'the chart lost AU 8 and AU 16', meta: replace(skirtMeta, '_curtain_size_chart', JSON.stringify(PILOT_PULL_ON_SKIRT.sizeChart.slice(1, 4))) },
  { name: 'a tape value without provenance', meta: replace(skirtMeta, '_curtain_garment_tape', JSON.stringify([{ size: '8', waistRelaxed: { cm: 67 } }])) },
  { name: 'an unknown closure', meta: replace(skirtMeta, '_curtain_closure', 'velcro') },
  { name: 'closure in capitals', meta: replace(skirtMeta, '_curtain_closure', 'Pull-On') },
  { name: 'a stored tape and no size chart', meta: skirtMeta.filter((m) => m.key !== '_curtain_size_chart') },
];
const tapeProducts = tapeProductInputs.map(({ name, meta }) => {
  const warnings = [];
  const expected = fromWooMeta(skirtProduct, meta, { warnings, defaultBrand: 'Fixture Shop' });
  return { name, product: skirtProduct, meta, expected, warnings };
});
const refills = [PILOT_PULL_ON_SKIRT.sizeChart, PILOT_PULL_ON_SKIRT.sizeChart.slice(0, 4), PILOT_PULL_ON_SKIRT.sizeChart.map((r) => (r.size === '12' ? { ...r, waist: 80 } : r))].map((chart) => ({
  chart,
  tape: PILOT_PULL_ON_SKIRT.garmentTape,
  expected: refillGarmentTape(chart, PILOT_PULL_ON_SKIRT.garmentTape),
}));
writeFileSync(
  join(root, 'tests/fixtures/garment-tape.json'),
  JSON.stringify({ cases: tapeCases, products: tapeProducts, refills, measured: measuredFromGarmentTape(PILOT_PULL_ON_SKIRT.garmentTape), text: GARMENT_TAPE_FORM_TEXT }, null, 1),
);
console.log(`wrote tests/fixtures/garment-tape.json (${tapeCases.length} form cases, ${tapeProducts.length} products, ${refills.length} refills)`);

// Men's chart columns (men-3d-plan M2): the meta box check (Chart_Columns::check = checkChartColumns),
// waist/leg labels, what the schema refinements of SizeChartSchema say (Schema_Validator and the
// builder must agree), and men's products read back through fromWooMeta (Payload_Builder must agree).
const columnCases = CHART_COLUMN_CASES.map((c) => ({ name: c.name, input: c.input, expected: checkChartColumns(c.input) }));
const labels = ['32/34', 'W32/L34', ' w30 / l32 ', '32x34', '32X30', '32', 'M', '32/34/36', '132/34', '3234', 'W32'].map((label) => ({ label, axes: wlAxesFromLabel(label) }));
const teeRows = SYNTHETIC_MENS_TEE.sizeChart.map((r, i) => ({ ...r, neck: 42 + i, sleeve: 20 + i, length: 70 + 2 * i }));
const wl = SYNTHETIC_MENS_CHINO_WL.sizeChart;
const chartCases = [
  ['a women\'s chart', [{ size: '8', bust: 85, waist: 67.5, hip: 94 }, { size: '10', bust: 90, waist: 72.5, hip: 99 }]],
  ['a men\'s tee with neck, sleeve and length', teeRows],
  ['the W/L chino chart (15 rows with axes)', wl],
  ['some rows with axes, some without', [...wl.slice(0, 2), { size: '34', waist: 88.5 }]],
  ['a waist × leg pair twice', [...wl.slice(0, 3), { ...wl[0], size: 'W30/L30' }]],
  ['a pair twice and a label twice', [wl[0], { ...wl[0] }]],
  ['31 rows (more than the old cap of 30)', Array.from({ length: 31 }, (_, i) => ({ size: `S${i}`, waist: 60 + i }))],
  ['61 rows', Array.from({ length: 61 }, (_, i) => ({ size: `S${i}`, waist: 60 + i }))],
  ['a 24-character label', [{ size: 'X'.repeat(24), waist: 80 }]],
  ['a 25-character label', [{ size: 'X'.repeat(25), waist: 80 }]],
].map(([name, rows]) => {
  const r = SizeChartSchema.safeParse(rows);
  const custom = r.success ? [] : r.error.issues.filter((i) => i.code === 'custom').map((i) => ({ path: ['sizeChart', ...i.path].join('.'), message: i.message }));
  return { name, rows, ok: r.success, custom };
});
const mensProduct = (g) => ({ id: g.id, name: g.name, price: String(g.priceEur), currency: 'EUR', images: [], categories: [], tags: [], brands: [], attributes: [] });
const tee = { ...SYNTHETIC_MENS_TEE, sizeChart: teeRows, sleeveConvention: 'shoulder_point' };
const setMeta = (meta, key, value) => [...meta.filter((m) => m.key !== key), ...(value === undefined ? [] : [{ key, value }])];
const chartMeta = (g, rows) => setMeta(toWooMeta(g), '_curtain_size_chart', JSON.stringify(rows));
const mensInputs = [
  { name: "men's tee: neck, sleeve from the shoulder seam, body length", g: tee, meta: toWooMeta(tee) },
  { name: "men's tee: sleeve measured from the centre back, written 'Centre back'", g: tee, meta: setMeta(toWooMeta(tee), '_curtain_sleeve_convention', 'Centre back') },
  { name: "men's tee: 'center-back' and 'shoulder seam' are understood", g: tee, meta: setMeta(toWooMeta(tee), '_curtain_sleeve_convention', 'center-back') },
  { name: "men's tee: 'shoulder seam'", g: tee, meta: setMeta(toWooMeta(tee), '_curtain_sleeve_convention', 'shoulder seam') },
  { name: "men's tee: an unknown measuring point warns and is left out", g: tee, meta: setMeta(toWooMeta(tee), '_curtain_sleeve_convention', 'armpit') },
  { name: 'W/L chino with rise and inseam', g: SYNTHETIC_MENS_CHINO_WL, meta: toWooMeta(SYNTHETIC_MENS_CHINO_WL) },
  { name: 'seat and collar columns read as hip and neck', g: tee, meta: chartMeta(tee, teeRows.map(({ hip, neck, ...r }) => ({ ...r, seat: hip, collar: neck }))) },
  { name: 'axes written as numbers', g: SYNTHETIC_MENS_CHINO_WL, meta: chartMeta(SYNTHETIC_MENS_CHINO_WL, wl.map((r) => ({ ...r, axes: { waist: Number(r.axes.waist), leg: Number(r.axes.leg) } }))) },
  { name: 'W/L: some rows without axes drop the chart', g: SYNTHETIC_MENS_CHINO_WL, meta: chartMeta(SYNTHETIC_MENS_CHINO_WL, [...wl.slice(0, 2), { size: '34', waist: 88.5 }]) },
  { name: 'W/L: a pair twice drops the chart', g: SYNTHETIC_MENS_CHINO_WL, meta: chartMeta(SYNTHETIC_MENS_CHINO_WL, [...wl.slice(0, 3), { ...wl[0], size: 'W30/L30' }]) },
  { name: 'W/L: an axis without a leg drops the chart', g: SYNTHETIC_MENS_CHINO_WL, meta: chartMeta(SYNTHETIC_MENS_CHINO_WL, [wl[0], { ...wl[1], axes: { waist: '30' } }]) },
  { name: 'a size label twice drops the chart', g: tee, meta: chartMeta(tee, [teeRows[0], { ...teeRows[1], size: 's' }]) },
];
const mensProducts = mensInputs.map(({ name, g, meta }) => {
  const warnings = [];
  const expected = fromWooMeta(mensProduct(g), meta, { warnings, defaultBrand: 'Fixture Shop' });
  return { name, product: mensProduct(g), meta, expected, warnings };
});
writeFileSync(join(root, 'tests/fixtures/mens-charts.json'), JSON.stringify({ columnCases, labels, chartCases, products: mensProducts }, null, 1));
console.log(`wrote tests/fixtures/mens-charts.json (${columnCases.length} column cases, ${labels.length} labels, ${chartCases.length} chart cases, ${mensProducts.length} products)`);
