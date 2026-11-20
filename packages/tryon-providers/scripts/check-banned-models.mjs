// Lint step for AGENTS.md hard rule 6 / decision D4: no non-commercial model may be referenced by
// provider code. Reads BANNED_MODELS from src/bannedModels.ts (the single list); that file, the
// registry and the tests that assert the ban are the only files allowed to spell the names out.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const listSource = readFileSync(join(srcDir, 'bannedModels.ts'), 'utf8');
const listMatch = /export const BANNED_MODELS = \[([\s\S]*?)\] as const;/.exec(listSource);
const BANNED = listMatch ? [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
if (BANNED.length === 0) {
  console.error('✗ could not read BANNED_MODELS from src/bannedModels.ts');
  process.exit(1);
}
const ALLOWED_FILES = new Set(['src/bannedModels.ts', 'src/bannedModels.test.ts', 'src/registry.ts', 'src/registry.test.ts']);
const normalise = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const bannedNormalised = BANNED.map(normalise);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts|cts|js|mjs|json)$/.test(name)) out.push(p);
  }
  return out;
}

let failed = false;
for (const file of walk(srcDir)) {
  const rel = relative(root, file).split('\\').join('/');
  if (ALLOWED_FILES.has(rel)) continue;
  const text = readFileSync(file, 'utf8');
  // Check line by line so the report is actionable; separators are ignored like in isBanned().
  text.split('\n').forEach((line, i) => {
    const n = normalise(line);
    bannedNormalised.forEach((b, idx) => {
      if (n.includes(b)) {
        console.error(`✗ ${rel}:${i + 1} references banned non-commercial model "${BANNED[idx]}"`);
        failed = true;
      }
    });
  });
}
if (failed) {
  console.error('Non-commercial models are banned from the provider registry (AGENTS.md rule 6).');
  process.exit(1);
}
console.log(`✓ no banned models referenced in packages/tryon-providers/src (${BANNED.length} names checked)`);
