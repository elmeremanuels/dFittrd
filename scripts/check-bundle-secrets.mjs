// Fails the build if any client bundle contains something that looks like a server secret.
// Part of decision D3 (privacy by construction): AI/provider keys must never reach the browser.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['apps/web/dist', 'packages/sdk/dist', 'packages/shopify-app/extensions'];
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
    if (s.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs|html|css|json|liquid)$/.test(name)) out.push(p);
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
