#!/usr/bin/env node
/**
 * Render shopify.app.toml (template with {{VAR}} placeholders) into shopify.app.<env>.toml from
 * the environment, then validate the result against the api's contracts.
 *
 *   SHOPIFY_API_KEY=… PUBLIC_API_URL=https://api.curtain.fit PUBLIC_APP_URL=https://app.curtain.fit \
 *     pnpm --filter @curtain/shopify-app configure [env] [--dry-run]     # default env: "dev"
 *   SHOPIFY_API_KEY=… DOMAIN=curtain.fit pnpm --filter @curtain/shopify-app configure prod
 *
 * DOMAIN (the deploy workflow's repository variable) stands in for PUBLIC_API_URL=https://api.<domain>
 * and PUBLIC_APP_URL=https://app.<domain>. --dry-run validates and prints the rendered config to
 * stdout instead of writing the file (.github/workflows/shopify-deploy.yml and the tests use it).
 *
 * Optional: SHOPIFY_API_VERSION (DEFAULT_API_VERSION from src/types.ts), SHOPIFY_DEV_STORE (my-store.myshopify.com),
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
const { renderAppConfig, validateAppConfig, resolveAppConfigVars } = await import(distEntry);

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const unknownFlags = args.filter((a) => a.startsWith('-') && a !== '--dry-run');
if (unknownFlags.length) {
  console.error(`configure: unknown option ${unknownFlags.join(' ')} (only --dry-run)`);
  process.exit(1);
}
const envName = args.find((a) => !a.startsWith('-')) ?? 'dev';
if (!/^[a-z0-9-]+$/.test(envName)) {
  console.error(`configure: env name '${envName}' must be [a-z0-9-]`);
  process.exit(1);
}

const template = readFileSync(join(root, 'shopify.app.toml'), 'utf8');
let vars;
let rendered;
try {
  vars = resolveAppConfigVars(process.env);
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

const summary = [
  `  application_url: ${parsed.application_url}`,
  `  redirect_urls: ${(parsed.auth?.redirect_urls ?? []).join(', ')}`,
  `  webhooks: ${[...new Set((parsed.webhooks?.subscriptions ?? []).map((s) => s.uri))].join(', ')}`,
  `  topics: ${result.topics.join(', ')}`,
  `  compliance: ${result.complianceTopics.join(', ')}`,
  `  scopes: ${result.scopes.join(', ')}`,
];
if (dryRun) {
  // Rendered config on stdout, the summary on stderr, nothing written.
  process.stdout.write(rendered.endsWith('\n') ? rendered : `${rendered}\n`);
  console.error(`configure: dry run for shopify.app.${envName}.toml, nothing written`);
  for (const line of summary) console.error(line);
  process.exit(0);
}

const out = join(root, `shopify.app.${envName}.toml`);
writeFileSync(out, rendered);
console.log(`configure: wrote ${out}`);
for (const line of summary) console.log(line);
console.log(`next: shopify app dev --config ${envName}   |   shopify app deploy --config ${envName}`);
