/**
 * Static site build for curtain.fit: renders every page to HTML, bundles one CSS and one JS file,
 * copies self-hosted fonts and images, writes sitemap.xml and robots.txt, then checks internal links.
 * No framework, no runtime dependencies, no third-party requests.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { pages } from '../src/pages/index.ts';
import { layout, type Assets } from '../src/lib/layout.ts';
import { resetFigures } from '../src/lib/components.ts';
import { launchGates, openDecisions, site } from '../src/data/site.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'public'), dist, { recursive: true });

/* fonts: the two variable families, Latin subset only (Fraunces upright + italic carry opsz/wght/SOFT/WONK) */
const fontFiles: [string, string][] = [
  ['@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2', 'fraunces-latin-full-normal.woff2'],
  ['@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2', 'fraunces-latin-full-italic.woff2'],
  ['@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'inter-latin-wght-normal.woff2'],
];
mkdirSync(join(dist, 'fonts'), { recursive: true });
for (const [src, name] of fontFiles) cpSync(join(root, 'node_modules', src), join(dist, 'fonts', name));

/* css + js, content-hashed */
const result = await build({
  entryPoints: { site: join(root, 'src/client/main.ts'), styles: join(root, 'src/styles/site.css') },
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  outdir: join(dist, 'assets'),
  entryNames: '[name]-[hash]',
  external: ['/fonts/*', '/img/*'],
  metafile: true,
  legalComments: 'none',
  logLevel: 'warning',
});
const outputs = Object.keys(result.metafile.outputs).map((p) => '/' + relative(dist, join(process.cwd(), p)).replace(/\\/g, '/'));
const css = outputs.find((p) => p.endsWith('.css'));
const js = outputs.find((p) => p.endsWith('.js'));
if (!css || !js) throw new Error('esbuild produced no css/js');
// Preload only the upright Fraunces and Inter (the italic loads on demand).
const assets: Assets = { css, js, fonts: ['/fonts/fraunces-latin-full-normal.woff2', '/fonts/inter-latin-wght-normal.woff2'] };

/* pages */
for (const page of pages) {
  resetFigures();
  const out = layout(page.meta, assets, page.body());
  const file = page.file ?? join(page.meta.path, 'index.html');
  const dest = join(dist, file);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out);
}

/* sitemap + robots */
const today = new Date().toISOString().slice(0, 10);
const urls = pages.filter((p) => !p.hidden && !p.meta.noindex).map((p) => `  <url><loc>${site.url}${p.meta.path}</loc><lastmod>${today}</lastmod></url>`);
writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /og-card.html\n\nSitemap: ${site.url}/sitemap.xml\n`);

/* checks: internal links/assets resolve, one h1 per page, every estimate image tagged */
const problems: string[] = [];
function walk(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
const htmlFiles = walk(dist).filter((f) => f.endsWith('.html'));
for (const f of htmlFiles) {
  const text = readFileSync(f, 'utf8');
  const rel = '/' + relative(dist, f);
  const h1 = (text.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1 && !rel.endsWith('og-card.html')) problems.push(`${rel}: ${h1} <h1> elements`);
  const ids = new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of text.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) {
    const url = m[1] ?? '';
    const [pathPart = '', hash] = url.split('#');
    let target = join(dist, decodeURIComponent(pathPart));
    if (pathPart.endsWith('/')) target = join(target, 'index.html');
    if (!existsSync(target)) problems.push(`${rel}: broken link ${url}`);
    else if (hash && target.endsWith('.html')) {
      const tText = target === f ? text : readFileSync(target, 'utf8');
      if (!new RegExp(`\\sid="${hash}"`).test(tText) && !(target === f && ids.has(hash))) problems.push(`${rel}: missing anchor ${url}`);
    }
  }
  for (const m of text.matchAll(/\shref="#([^"]*)"/g)) {
    const hash = m[1] ?? '';
    if (hash && !ids.has(hash)) problems.push(`${rel}: missing same-page anchor #${hash}`);
  }
  for (const m of text.matchAll(/\s(?:srcset|imagesrcset)="([^"]+)"/g)) {
    for (const part of (m[1] ?? '').split(',')) {
      const u = part.trim().split(' ')[0] ?? '';
      if (/^(?:https?:)?\/\//.test(u)) problems.push(`${rel}: absolute image URL ${u} (self-host it)`);
      else if (u.startsWith('/') && !existsSync(join(dist, u))) problems.push(`${rel}: missing image ${u}`);
    }
  }
  for (const m of text.matchAll(/\ssrc="((?:https?:)?\/\/[^"]+)"/g)) problems.push(`${rel}: absolute src ${m[1] ?? ''} (self-host it)`);
  if (/https?:\/\/(?!curtain\.fit|creativecommons\.org|wordpress\.org|bohohippychic\.com\.au|www\.sitemaps\.org)[^"\s]*\.(?:js|css|woff2?)/.test(text)) problems.push(`${rel}: third-party asset reference`);
}
/* image weight budget: every image variant under 250 KB */
for (const f of walk(join(dist, 'img'))) {
  const kb = statSync(f).size / 1024;
  if (kb > 250) problems.push(`/${relative(dist, f)}: ${kb.toFixed(0)} KB, over the 250 KB image budget`);
}
if (problems.length) {
  console.error('Site checks failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const size = walk(dist).reduce((n, f) => n + statSync(f).size, 0);
const hash = createHash('sha256').update(readFileSync(join(dist, 'index.html'))).digest('hex').slice(0, 8);
console.log(`✓ curtain.fit: ${htmlFiles.length} pages, ${(size / 1024 / 1024).toFixed(1)} MB in dist/ (index ${hash})`);
const open = openDecisions();
if (open.length) console.log(`  Still to decide before launch (src/data/site.ts): ${open.join('; ')}`);
const gates = launchGates();
if (gates.length) {
  const msg = `Launch gates still open (src/data/site.ts, docs/SITE.md):\n  - ${gates.join('\n  - ')}`;
  if (process.env.CURTAIN_SITE_RELEASE === '1') {
    console.error(`✗ Release build refused. ${msg}`);
    process.exit(1);
  }
  console.log(`  Preview build only. ${msg}`);
}
