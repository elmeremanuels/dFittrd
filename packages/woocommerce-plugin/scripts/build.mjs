#!/usr/bin/env node
/**
 * Build the distributable plugin zip:
 *   1. copy ../sdk/dist/sdk.v1.js            → assets/sdk.v1.js         (bundled, never remote: WP.org rule)
 *   2. copy ../schema/dist/garment*.schema.json → assets/                (local JSON Schema validation)
 *   3. php -l every PHP file
 *   4. zip dist/paskamer-woocommerce.zip with a top-level `paskamer-woocommerce/` folder
 *
 * Requires `pnpm --filter @paskamer/sdk build` and `pnpm --filter @paskamer/schema build` to have run
 * (the root `pnpm build` orders packages/* before apps/*; sdk/schema are plain devDependencies here).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintAll } from './lint.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

function resolvePkgFile(pkg, file, fallback) {
  try {
    return join(dirname(require.resolve(`${pkg}/package.json`)), file);
  } catch {
    return join(root, fallback);
  }
}

const sources = [
  [resolvePkgFile('@paskamer/sdk', 'dist/sdk.v1.js', '../sdk/dist/sdk.v1.js'), 'assets/sdk.v1.js'],
  [resolvePkgFile('@paskamer/schema', 'dist/garment.schema.json', '../schema/dist/garment.schema.json'), 'assets/garment.schema.json'],
  [resolvePkgFile('@paskamer/schema', 'dist/garment-draft.schema.json', '../schema/dist/garment-draft.schema.json'), 'assets/garment-draft.schema.json'],
];

for (const [from, to] of sources) {
  if (!existsSync(from)) {
    console.error(`missing ${from} — build @paskamer/sdk and @paskamer/schema first`);
    process.exit(1);
  }
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(from, join(root, to));
  console.log(`copied ${to} (${statSync(join(root, to)).size} B)`);
}

// Secret guard (AGENTS.md rule 2): the bundled SDK must not carry any provider key.
const sdk = readFileSync(join(root, 'assets/sdk.v1.js'), 'utf8');
if (/sk_(live|test)_[A-Za-z0-9]{24,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(sdk)) {
  console.error('assets/sdk.v1.js contains a secret-looking string; refusing to build');
  process.exit(1);
}

if (!lintAll()) process.exit(1);

// Version consistency: plugin header, readme.txt stable tag, package.json.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const header = readFileSync(join(root, 'paskamer.php'), 'utf8');
const headerVersion = /^\s*\*\s*Version:\s*([0-9.]+)/m.exec(header)?.[1];
const define = /define\(\s*'PASKAMER_VERSION',\s*'([0-9.]+)'/.exec(header)?.[1];
const readme = readFileSync(join(root, 'readme.txt'), 'utf8');
const stableTag = /^Stable tag:\s*([0-9.]+)/m.exec(readme)?.[1];
if (new Set([pkg.version, headerVersion, define, stableTag]).size !== 1) {
  console.error(`version mismatch: package.json ${pkg.version}, header ${headerVersion}, PASKAMER_VERSION ${define}, readme Stable tag ${stableTag}`);
  process.exit(1);
}

const dist = join(root, 'dist');
const stage = join(dist, 'paskamer-woocommerce');
rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const include = ['paskamer.php', 'uninstall.php', 'readme.txt', 'includes', 'assets', 'languages'];
for (const entry of include) {
  execFileSync('cp', ['-R', join(root, entry), join(stage, entry)]);
}
// Dev-only files never ship.
rmSync(join(stage, 'assets/.gitkeep'), { force: true });

const zipName = 'paskamer-woocommerce.zip';
execFileSync('zip', ['-rq', '-X', zipName, 'paskamer-woocommerce'], { cwd: dist });
rmSync(stage, { recursive: true, force: true });
console.log(`built dist/${zipName} (${statSync(join(dist, zipName)).size} B)`);
