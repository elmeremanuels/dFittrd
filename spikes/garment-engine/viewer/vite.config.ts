/**
 * Spike viewer dev server (`pnpm --filter @curtain/garment-spike viewer`). Serves the two pages and
 * the spike bundles from `../out/<productId>/` under `/bundle/`, plus the evaluated Phase 0 bundles
 * from `../out/eval/<id>/` as product `eval/<id>` (`report:bohohippychic`). Never builds for
 * production: the shipped viewer is `packages/garment-viewer` (Phase 2).
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const viewerDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(viewerDir, '..', 'out');

const BUNDLE_FILES = ['base.glb', 'anchors.json', 'grading.json', 'material.json', 'qa.json'];
/** Served when present: the product payload of a bundle that is not a schema fixture (evaluated shop products). */
const OPTIONAL_FILES = ['payload.json'];
const TYPES: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary' };

function bundleServer(): Plugin {
  return {
    name: 'curtain-spike-bundles',
    configureServer(server) {
      server.middlewares.use('/bundle', (req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        if (path === '/index.json') {
          const complete = (dir: string): boolean => BUNDLE_FILES.every((f) => existsSync(join(outDir, dir, f)));
          const evalDir = join(outDir, 'eval');
          const products = [
            ...(existsSync(outDir) ? readdirSync(outDir).filter((d) => d !== 'screens' && d !== 'eval' && complete(d)).sort() : []),
            ...(existsSync(evalDir) ? readdirSync(evalDir).map((d) => `eval/${d}`).filter(complete).sort() : []),
          ];
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ products, hint: products.length ? null : 'Run `pnpm --filter @curtain/garment-spike build:bundle` first.' }));
          return;
        }
        const file = resolve(outDir, `.${path}`);
        const name = path.split('/').pop() ?? '';
        if (!file.startsWith(outDir + sep) || ![...BUNDLE_FILES, ...OPTIONAL_FILES].includes(name) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file));
      });
    },
  };
}

/**
 * R2 spike (docs/research/step3-serverdrape-spike.md): `/serverdrape/` serves the baked morph GLBs and the Anny body
 * OBJs from `../out/serverdrape/` for `morph.html`. Only those two file shapes; nothing else under out/.
 */
function serverdrapeServer(): Plugin {
  const dir = resolve(outDir, 'serverdrape');
  const ok = /^\/(web\/skirt-[\w.+-]+\.glb|bodies\/t[-+]\d\.\d\d\.obj|bodies\/bodies\.json|report-[\w.+-]+\.json)$/;
  return {
    name: 'curtain-spike-serverdrape',
    configureServer(server) {
      server.middlewares.use('/serverdrape', (req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        const file = resolve(dir, `.${path}`);
        if (!ok.test(path) || !file.startsWith(dir + sep) || !existsSync(file)) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', path.endsWith('.glb') ? 'model/gltf-binary' : path.endsWith('.json') ? 'application/json' : 'text/plain');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  root: viewerDir,
  plugins: [bundleServer(), serverdrapeServer()],
  server: { port: 5178, strictPort: false, host: '127.0.0.1' },
  build: {
    outDir: resolve(outDir, 'viewer-dist'),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(viewerDir, 'index.html'), blind: resolve(viewerDir, 'blind.html') } },
  },
});
