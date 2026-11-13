// Build-time budget guard (also asserted in src/size.test.ts): the IIFE must stay < 8 KB gzipped.
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET = 8 * 1024;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let failed = false;
for (const file of ['sdk.v1.js', 'sdk.v1.esm.js']) {
  const p = join(dist, file);
  const raw = statSync(p).size;
  const gz = gzipSync(readFileSync(p), { level: 9 }).length;
  const ok = gz < BUDGET;
  console.log(`${ok ? '✓' : '✗'} ${file}: ${raw} B raw, ${gz} B gzipped (budget ${BUDGET})`);
  if (!ok) failed = true;
}
if (failed) {
  console.error('SDK bundle exceeds the 8 KB gzipped budget.');
  process.exit(1);
}
