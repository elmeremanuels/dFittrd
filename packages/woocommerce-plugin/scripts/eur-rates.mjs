/**
 * assets/eur-rates.json: the EUR rate table (1 EUR = n units) the api uses for Shopify products
 * (`DEFAULT_EUR_RATES`, packages/shopify-app/src/currency.ts). The PHP payload builder converts a
 * non-EUR shop price with it, like `priceToEur` in @curtain/schema, so an AUD WooCommerce shop
 * pushes an (approximate) `priceEur` instead of none. Generated, never edited.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_EUR_RATES } from '@curtain/shopify-app';

export function eurRatesAsset() {
  return { source: '@curtain/shopify-app currency.ts DEFAULT_EUR_RATES', rates: { ...DEFAULT_EUR_RATES } };
}

export function writeEurRatesAsset(root) {
  const file = join(root, 'assets/eur-rates.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(eurRatesAsset()));
  return file;
}
