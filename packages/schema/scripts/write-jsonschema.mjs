// Writes dist/<name>.schema.json (JSON Schema draft 2020-12) from the built ESM bundle.
// Runs after tsup in `pnpm build`; the WooCommerce plugin and the Shopify app read these files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const { allJsonSchemas } = await import(join(dist, 'index.js'));

mkdirSync(dist, { recursive: true });
const schemas = allJsonSchemas();
for (const [name, schema] of Object.entries(schemas)) {
  const file = join(dist, `${name}.schema.json`);
  writeFileSync(file, JSON.stringify(schema, null, 2) + '\n');
  console.log(`wrote ${file}`);
}
