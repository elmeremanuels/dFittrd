#!/usr/bin/env node
/**
 * `php -l` on every PHP file of the plugin (the closest thing to a typecheck without a WordPress
 * runtime or PHPStan offline). Exits non-zero on the first syntax error.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function phpFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) phpFiles(p, out);
    else if (name.endsWith('.php')) out.push(p);
  }
  return out;
}

export function lintAll() {
  const files = phpFiles(root).sort();
  let failed = 0;
  for (const file of files) {
    try {
      execFileSync('php', ['-l', file], { stdio: 'pipe' });
      console.log(`ok   ${relative(root, file)}`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${relative(root, file)}\n${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`);
    }
  }
  console.log(`${files.length - failed}/${files.length} PHP files pass php -l`);
  return failed === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(lintAll() ? 0 : 1);
}
