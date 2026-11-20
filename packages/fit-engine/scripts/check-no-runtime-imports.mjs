// Build guard (AGENTS.md rule 5 / DECISIONS D8): the built engine must have zero runtime imports.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const checks = [
  { file: 'index.js', pattern: /^\s*import\s[^;]*from\s*['"]|\brequire\(/m },
  { file: 'index.cjs', pattern: /\brequire\(\s*['"](?!node:)/ },
];
let failed = false;
for (const { file, pattern } of checks) {
  const src = readFileSync(join(dist, file), 'utf8');
  if (pattern.test(src)) {
    console.error(`[fit-engine] ${file} contains a runtime import — the engine must stay dependency-free.`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('[fit-engine] dist has no runtime imports');
