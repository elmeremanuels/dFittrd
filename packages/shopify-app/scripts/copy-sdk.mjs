#!/usr/bin/env node
/**
 * Copy the built merchant SDK into the theme app extension's assets so the storefront loads it
 * from Shopify's CDN (zero third-party requests on the merchant page, D3). Runs as part of
 * `pnpm build`; `@paskamer/sdk` must be built first (root `pnpm build` orders packages/** before
 * apps/**, and sdk is a devDependency of this package so pnpm builds it first with -r).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let src;
try {
  src = require.resolve('@paskamer/sdk/sdk.v1.js');
} catch {
  src = join(here, '..', '..', 'sdk', 'dist', 'sdk.v1.js');
}
if (!existsSync(src)) {
  console.error(`copy-sdk: ${src} not found — run \`pnpm --filter @paskamer/sdk build\` first`);
  process.exit(1);
}

const text = readFileSync(src, 'utf8');
// Belt and braces: the SDK's own tests assert this, but the extension ships to merchants' storefronts.
const secretLike = /(sk_(live|test)_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN (RSA |EC )?PRIVATE KEY-----)/;
if (secretLike.test(text)) {
  console.error('copy-sdk: refusing to copy — the SDK bundle contains something that looks like a secret');
  process.exit(1);
}

const assets = join(here, '..', 'extensions', 'try-button', 'assets');
mkdirSync(assets, { recursive: true });
const dest = join(assets, 'sdk.v1.js');
copyFileSync(src, dest);
const kb = (statSync(dest).size / 1024).toFixed(1);
console.log(`copy-sdk: ${dest} (${kb} KB)`);
