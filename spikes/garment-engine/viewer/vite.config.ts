/**
 * Spike viewer dev server (`pnpm --filter @curtain/garment-spike viewer`). Serves the two pages and
 * the spike bundles from `../out/<productId>/` under `/bundle/`. Never builds for production: the
 * shipped viewer is `packages/garment-viewer` (Phase 2).
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const viewerDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(viewerDir, '..', 'out');

const BUNDLE_FILES = ['base.glb', 'anchors.json', 'grading.json', 'material.json', 'qa.json'];
const TYPES: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary' };

function bundleServer(): Plugin {
  return {
    name: 'curtain-spike-bundles',
    configureServer(server) {
      server.middlewares.use('/bundle', (req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
        if (path === '/index.json') {
          const products = existsSync(outDir)
            ? readdirSync(outDir).filter((d) => d !== 'screens' && BUNDLE_FILES.every((f) => existsSync(join(outDir, d, f)))).sort()
            : [];
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify({ products, hint: products.length ? null : 'Run `pnpm --filter @curtain/garment-spike build:bundle` first.' }));
          return;
        }
        const file = resolve(outDir, `.${path}`);
        const name = path.split('/').pop() ?? '';
        if (!file.startsWith(outDir + sep) || !BUNDLE_FILES.includes(name) || !existsSync(file) || !statSync(file).isFile()) {
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

export default defineConfig({
  root: viewerDir,
  plugins: [bundleServer()],
  server: { port: 5178, strictPort: false, host: '127.0.0.1' },
  build: {
    outDir: resolve(outDir, 'viewer-dist'),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(viewerDir, 'index.html'), blind: resolve(viewerDir, 'blind.html') } },
  },
});
