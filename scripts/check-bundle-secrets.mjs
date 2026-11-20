// Fails the build if any client bundle contains something that looks like a server secret.
// Part of decision D3 (privacy by construction): AI/provider keys must never reach the browser.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// AGENTS.md rule 2 names the whole of packages/woocommerce-plugin: its PHP ships to the merchant's
// server, so the plugin's own source (curtain.php, includes/, uninstall.php, …) is scanned too, not
// only assets/. Its dev-only folders (tests, the WordPress e2e, the build output) are skipped.
const roots = ['apps/web/dist', 'apps/site/dist', 'packages/sdk/dist', 'packages/shopify-app/extensions', 'packages/woocommerce-plugin'];
const SKIP_DIRS = new Set(['node_modules', 'tests', 'e2e', 'dist', 'test-results', 'vendor']);
const patterns = [
  /sk_(live|test)_[A-Za-z0-9]{8,}/, // Stripe secret keys
  /whsec_[A-Za-z0-9]{8,}/, // Stripe webhook secrets
  /FASHN_API_KEY|XAI_API_KEY|GOOGLE_APPLICATION_CREDENTIALS|SHOPIFY_API_SECRET|JWT_SECRET|SHOP_KEY_PEPPER|DATABASE_URL/,
  /fa-[A-Za-z0-9]{20,}/, // FASHN key shape
  /xai-[A-Za-z0-9]{20,}/, // xAI key shape
  /AIza[0-9A-Za-z_-]{30,}/, // Google API key shape
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (/\.(js|mjs|cjs|html|css|json|liquid|php|txt)$/.test(name)) out.push(p);
  }
  return out;
}

let failed = false;
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    for (const re of patterns) {
      if (re.test(text)) {
        console.error(`✗ ${file} matches ${re}`);
        failed = true;
      }
    }
  }
}
if (failed) {
  console.error('Secret-looking strings found in a client bundle. Aborting.');
  process.exit(1);
}
console.log('✓ no secret-looking strings in client bundles');
