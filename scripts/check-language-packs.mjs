#!/usr/bin/env node
/**
 * DECISIONS.md D21: translation packs land on every surface together.
 *
 * The Shopify theme extension and the WooCommerce plugin pick their own text by the shop's
 * language (Shopify's `| t`, WordPress's text domain) and tell the SDK and the embed which pack
 * that was. A language shipped on one of those two without an SDK and an embed catalogue would
 * give a page in two languages (a Dutch hint over an English overlay). This check fails on that.
 * Today every surface ships English only, so it passes with one language.
 *
 * Usage: node scripts/check-language-packs.mjs [repo root]
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const language = (locale) => locale.toLowerCase().split(/[-_]/)[0];
const list = (dir, pattern) =>
  (existsSync(join(root, dir)) ? readdirSync(join(root, dir)) : []).flatMap((name) => {
    const m = pattern.exec(name);
    return m ? [language(m[1])] : [];
  });

const surfaces = {
  'embed (apps/web/src/embed/strings)': new Set(list('apps/web/src/embed/strings', /^(?!index\.)([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)\.ts$/)),
  'SDK (packages/sdk/src/strings)': new Set(list('packages/sdk/src/strings', /^([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)\.ts$/)),
  'Shopify (extensions/try-button/locales)': new Set(list('packages/shopify-app/extensions/try-button/locales', /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)(?:\.default)?\.json$/)),
  'WooCommerce (languages)': new Set(['en', ...list('packages/woocommerce-plugin/languages', /^curtain-woocommerce-([A-Za-z]{2,3}(?:_[A-Za-z0-9]+)*)\.po$/)]),
};

const all = new Set(Object.values(surfaces).flatMap((s) => [...s]));
const problems = [];
for (const lang of [...all].sort()) {
  const missing = Object.entries(surfaces)
    .filter(([, langs]) => !langs.has(lang))
    .map(([name]) => name);
  if (missing.length > 0) problems.push(`"${lang}" is shipped on some surfaces but has no pack for: ${missing.join('; ')}`);
}

if (problems.length > 0) {
  console.error('Language packs are not complete across the surfaces (docs/i18n/README.md):');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`language packs: ${[...all].sort().join(', ')} on all ${Object.keys(surfaces).length} surfaces`);
