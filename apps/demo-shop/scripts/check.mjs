#!/usr/bin/env node
/**
 * Typecheck/lint stand-in for a dependency-free package: `node --check` on every script (syntax),
 * plus project rules: no external URLs in the storefront (no third-party requests, D3), no
 * secret-looking strings, English copy (no Dutch shop words), no inline event handlers.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(m?js|html|css)$/.test(name)) files.push(p);
  }
})(root);

const problems = [];
// Prefixes are split so this file never contains a token-shaped literal itself.
const secret = new RegExp(['sk' + '_(live|test)_[A-Za-z0-9]', 'pk' + '_live_[A-Za-z0-9]', 'shp' + '(at|ss)_[A-Za-z0-9]', 'wh' + 'sec_[A-Za-z0-9]', 'AI' + 'za[0-9A-Za-z_-]{10}'].join('|'));
const dutch = /\b(paskamer|maat kiezen|winkelmand|in winkelwagen|bekijk|nieuw binnen|verzending)\b/i;
for (const f of files) {
  const rel = relative(root, f);
  const text = readFileSync(f, 'utf8');
  if (/\.m?js$/.test(f)) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    } catch (e) {
      problems.push(`${rel}: syntax error\n${e.stderr}`);
    }
  }
  if (secret.test(text)) problems.push(`${rel}: secret-looking string`);
  if (rel.startsWith('public') && /https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(text)) problems.push(`${rel}: external URL (the storefront must not load third-party resources)`);
  if (rel.startsWith('public') && dutch.test(text)) problems.push(`${rel}: Dutch copy (the demo storefront is English)`);
  if (/\son(click|load|error|submit)=["']/i.test(text) && f.endsWith('.html')) problems.push(`${rel}: inline event handler`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`demo-shop: ${files.length} files ok`);
