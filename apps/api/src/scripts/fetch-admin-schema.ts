/**
 * Fetch Shopify's public Admin GraphQL introspection for one API version (dev tool, not runtime).
 *
 * Source: the public proxy behind shopify.dev's GraphiQL explorer. No credentials and no store are
 * involved; it serves the schema only. The output feeds the optional real-schema check in
 * src/shopify/contract.test.ts (CURTAIN_SHOPIFY_INTROSPECTION).
 *
 *   pnpm --filter @curtain/api shopify:schema 2026-10 /tmp/admin-2026-10.json
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getIntrospectionQuery } from 'graphql';

const [version, out] = process.argv.slice(2);
if (!version || !/^\d{4}-\d{2}$/.test(version) || !out) {
  console.error('usage: fetch-admin-schema <YYYY-MM> <out.json>');
  process.exit(2);
}
const res = await fetch(`https://shopify.dev/admin-graphql-direct-proxy/${version}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: getIntrospectionQuery({ inputValueDeprecation: true }) }),
});
const body = (await res.json()) as { data?: { __schema: { types: unknown[] } }; errors?: unknown };
if (!res.ok || !body.data) {
  console.error(`introspection failed: HTTP ${res.status}`, JSON.stringify(body.errors ?? body).slice(0, 500));
  process.exit(1);
}
const path = resolve(process.env.INIT_CWD ?? process.cwd(), out);
writeFileSync(path, JSON.stringify({ data: body.data }));
console.log(`wrote ${path}: ${body.data.__schema.types.length} types (Admin API ${version})`);
