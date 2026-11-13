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
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_GARMENTS, fromWooMeta, toWooMeta, ESTIMATE_DISCLAIMER, FABRIC_TEXT_FIELD, fabricFromProductText, resolveFabricText } from '@curtain/schema';
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
];
const product = { id: 4182, name: 'Wikkeljurk Lotte', price: '89.95', categories: [{ name: 'Jurken' }] };
const fabricMetas = metas.map((fabric) => {
  const warnings = [];
  const out = fromWooMeta(product, { _curtain_fabric: JSON.stringify(fabric) }, { warnings, defaultBrand: 'Aalter Studio' });
  return { meta: JSON.stringify(fabric), fabric: out.fabric ?? null, warnings };
});

writeFileSync(join(root, 'tests/fixtures/fabric-text.json'), JSON.stringify({ texts: fabricTexts, prefills, metas: fabricMetas }, null, 1));
console.log(`wrote tests/fixtures/fabric-text.json (${fabricTexts.length} texts, ${prefills.length} attribute sets, ${fabricMetas.length} meta values) and assets/fabric-library.json`);
