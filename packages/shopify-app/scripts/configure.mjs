#!/usr/bin/env node
/**
 * Render shopify.app.toml (template with {{VAR}} placeholders) into shopify.app.<env>.toml from
 * the environment, then validate the result against the api's contracts.
 *
 *   SHOPIFY_API_KEY=… PUBLIC_API_URL=https://api.curtain.fit PUBLIC_APP_URL=https://app.curtain.fit \
 *     pnpm --filter @curtain/shopify-app configure [env]      # default env: "dev"
 *
 * Optional: SHOPIFY_API_VERSION (2025-10), SHOPIFY_DEV_STORE (my-store.myshopify.com),
 * SHOPIFY_APP_HANDLE (curtain). Requires `pnpm build` first (imports ../dist).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distEntry = join(root, 'dist', 'index.js');
if (!existsSync(distEntry)) {
  console.error('configure: dist/index.js missing — run `pnpm --filter @curtain/shopify-app build` first');
  process.exit(1);
}
const { renderAppConfig, validateAppConfig, APP_CONFIG_VARS } = await import(distEntry);

const envName = process.argv[2] ?? 'dev';
if (!/^[a-z0-9-]+$/.test(envName)) {
  console.error(`configure: env name '${envName}' must be [a-z0-9-]`);
  process.exit(1);
}

const vars = {};
for (const name of APP_CONFIG_VARS) if (process.env[name] !== undefined) vars[name] = process.env[name];

const template = readFileSync(join(root, 'shopify.app.toml'), 'utf8');
let rendered;
try {
  rendered = renderAppConfig(template, vars);
} catch (err) {
  console.error(`configure: ${err.message}`);
  process.exit(1);
}

const parsed = parse(rendered);
const result = validateAppConfig(parsed, { apiUrl: vars.PUBLIC_API_URL });
if (!result.ok) {
  console.error('configure: rendered config is invalid:');
  for (const issue of result.issues) console.error(`  - ${issue}`);
  process.exit(1);
}

const out = join(root, `shopify.app.${envName}.toml`);
writeFileSync(out, rendered);
console.log(`configure: wrote ${out}`);
console.log(`  topics: ${result.topics.join(', ')}`);
console.log(`  compliance: ${result.complianceTopics.join(', ')}`);
console.log(`  scopes: ${result.scopes.join(', ')}`);
console.log(`next: shopify app dev --config ${envName}   |   shopify app deploy --config ${envName}`);
