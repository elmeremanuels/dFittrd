#!/usr/bin/env node
/**
 * Export parity fixtures for the PHP tests from @curtain/schema:
 * for every MOCK_GARMENT, the Woo meta rows `toWooMeta` would store, a minimal WC product snapshot,
 * and what the TypeScript normaliser `fromWooMeta` produces from them. The PHP Payload_Builder must
 * reproduce `expected` byte-for-byte (canonical JSON) — it is the PHP twin of fromWooMeta.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_GARMENTS, fromWooMeta, toWooMeta, ESTIMATE_DISCLAIMER } from '@curtain/schema';

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
