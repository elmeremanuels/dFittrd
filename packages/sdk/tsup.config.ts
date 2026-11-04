import { defineConfig } from 'tsup';

// One entry, two formats:
//   dist/sdk.v1.js      IIFE  — the merchant <script> tag; auto-inits from data-* attributes.
//   dist/sdk.v1.esm.js  ESM   — for bundlers (Shopify theme app extension, Woo plugin build).
// Both are minified, target es2019, no runtime dependencies. Budget: < 8 KB gzipped (scripts/check-size.mjs).
export default defineConfig({
  entry: { 'sdk.v1': 'src/index.ts' },
  format: ['iife', 'esm'],
  outExtension: ({ format }) => ({ js: format === 'iife' ? '.js' : '.esm.js' }),
  target: 'es2019',
  platform: 'browser',
  minify: true,
  sourcemap: true,
  dts: true,
  clean: true,
  treeshake: true,
  legalComments: 'none',
});
