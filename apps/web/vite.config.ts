/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { EMBED_FRAME_ANCESTORS as PROD_EMBED_ANCESTORS, LOCAL_FRAME_ANCESTORS } from './config/csp';
import { assertNoClientSecrets } from './config/envGuard';
import { responseHeaders } from './config/headers';
import { isEmbedPath } from './src/embed/path';

// No `define` of server secrets here, ever (decision D3): the backend is the only place that reads keys.
// Any VITE_* variable whose name contains KEY or SECRET fails the build (AGENTS.md rule 2) — from the
// shell AND from the .env files Vite loads itself (those are not in process.env).
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, __dirname, 'VITE_') };
  assertNoClientSecrets(env);
  return { ...config, plugins: [embedFraming(apiOriginOf(env.VITE_API_URL)), versionFile(buildCommit(env)), ...config.plugins] };
});

/** The commit a build is made from: GIT_SHA, or GITHUB_SHA on a GitHub runner; "unknown" on a laptop. */
export function buildCommit(env: Record<string, string | undefined>): string {
  const sha = (env.GIT_SHA ?? env.GITHUB_SHA ?? '').trim();
  return /^[\w.-]{1,64}$/.test(sha) ? sha : 'unknown';
}

/**
 * `/version.json` = `{ "commit": "<sha>" }`, written into the build and answered by the dev server. The api
 * says the same on `/healthz`; `scripts/post-deploy-check.mjs` compares the two, so a deploy that swapped the
 * api but not the web app (or the other way round) is seen. A commit id only: no secret, nothing of a shopper.
 */
export const VERSION_PATH = '/version.json';
function versionFile(commit: string): Plugin {
  const body = `${JSON.stringify({ commit })}\n`;
  return {
    name: 'curtain-version-file',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: VERSION_PATH.slice(1), source: body });
    },
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if ((req.url ?? '').split('?')[0] !== VERSION_PATH) return next();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      });
    },
  };
}

/** The api origin the built app talks to (`VITE_API_URL`), or undefined when it is same-origin. */
export function apiOriginOf(url: string | undefined): string | undefined {
  const u = url?.trim();
  if (!u) return undefined;
  try {
    return new URL(u).origin;
  } catch {
    return undefined;
  }
}

/**
 * Framing headers for the DEV server, mirroring infra/Caddyfile (docs/STANDALONE.md §2): `/embed/*`
 * is the only framable route (any https shop, plus localhost for the local demo storefront); every
 * other HTML page keeps `frame-ancestors 'none'`. The dev server gets the framing directive only: it
 * needs an inline preamble (React refresh) and a WebSocket (HMR) that the full policy refuses. No
 * COOP/COEP is set here, so nothing blocks a cross-origin parent from framing the embed.
 */
export const EMBED_FRAME_ANCESTORS = `frame-ancestors ${[...PROD_EMBED_ANCESTORS, ...LOCAL_FRAME_ANCESTORS].join(' ')}`;

export function framingHeaders(req: Pick<IncomingMessage, 'url' | 'headers'>, res: Pick<ServerResponse, 'setHeader' | 'removeHeader'>): void {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (isEmbedPath(path)) {
    res.setHeader('Content-Security-Policy', EMBED_FRAME_ANCESTORS);
    embedCrossOrigin(res);
    return;
  }
  const accept = String(req.headers.accept ?? '');
  if (accept.includes('text/html')) res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
}

function embedCrossOrigin(res: Pick<ServerResponse, 'setHeader' | 'removeHeader'>): void {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Cross-Origin-Opener-Policy');
  res.removeHeader('Cross-Origin-Embedder-Policy');
}

/** Where the preview's browsers report CSP violations; `GET` it to read (and clear) what was reported. */
export const CSP_REPORT_PATH = '/__csp-report';

/**
 * Headers for the PREVIEW server (the production build, as the e2e suite runs it): everything Caddy sends
 * in production (`config/headers.ts`: the policy of `config/csp.ts`, cross-origin isolation for the app,
 * the embed's framing set), on EVERY response, so the scan worker and the drape worker run under it too (a
 * worker's policy comes from its own script response). Two things differ from production, both on purpose:
 * the embed's frame-ancestors also allow localhost (the demo storefront), and violations are reported to
 * `CSP_REPORT_PATH`. `src/__tests__/headers.test.ts` holds the two servers together.
 */
export function previewHeaders(req: Pick<IncomingMessage, 'url'>, res: Pick<ServerResponse, 'setHeader' | 'removeHeader'>, api?: string): void {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  const h = isEmbedPath(path)
    ? responseHeaders('embed', { api, extraFrameAncestors: LOCAL_FRAME_ANCESTORS, reportUri: CSP_REPORT_PATH })
    : responseHeaders('app', { api, reportUri: CSP_REPORT_PATH });
  for (const name of h.remove) res.removeHeader(name);
  for (const [name, value] of Object.entries(h.set)) res.setHeader(name, value);
}

/**
 * Keep the headers set so far: the preview's static file handler sets its own `Cache-Control: no-cache` on
 * the page afterwards, which would replace the embed's `no-store` (found by scripts/post-deploy-check.mjs).
 */
function lockHeaders(res: ServerResponse): void {
  const locked = new Set(res.getHeaderNames().map((n) => n.toLowerCase()));
  const set = res.setHeader.bind(res);
  res.setHeader = ((name: string, value: number | string | readonly string[]) => (locked.has(name.toLowerCase()) ? res : set(name, value))) as typeof res.setHeader;
}

function embedFraming(api: string | undefined): Plugin {
  const reports: unknown[] = [];
  return {
    name: 'curtain-embed-framing',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        framingHeaders(req, res);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if ((req.url ?? '').split('?')[0] === CSP_REPORT_PATH) {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (c: Buffer) => (body += c.toString('utf8')));
            req.on('end', () => {
              try {
                reports.push(JSON.parse(body));
              } catch {
                reports.push({ unparsed: body.slice(0, 2000) });
              }
              console.warn(`[csp] violation reported: ${body.slice(0, 3000)}`);
              res.statusCode = 204;
              res.end();
            });
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(reports.splice(0)));
          return;
        }
        if (process.env.CURTAIN_PREVIEW_CSP !== 'off') {
          previewHeaders(req, res, api);
          lockHeaders(res);
        }
        next();
      });
    },
  };
}

const config = {
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'Curtain — your private fitting room',
        short_name: 'Curtain',
        description: 'See how clothes really fit you before you buy. Photos never leave your phone.',
        theme_color: '#F5EFE7',
        background_color: '#F5EFE7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // Offline shell: the app bundle, fonts and icons. Models are cached on first use, not precached.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // The 3D viewer (three.js + the drape worker) is loaded only after the shopper asks for it:
        // never precached, cached on first use instead (scripts/check-viewer-chunk.mjs pins this). drapeBakeRead is the
        // drape bake reader with the meshopt decoder, loaded by the viewer only for a bake bundle. realisticBodyLoad is the
        // realistic body spike's loader (only with VITE_VIEWER_BODY=realistic-spike); its .crb asset is not in globPatterns.
        globIgnores: ['**/models/**', '**/garment-viewer-*.js', '**/drape.worker-*.js', '**/drapeBakeRead-*.js', '**/realisticBodyLoad-*.js'],
        // /embed is framed inside merchant pages: never served from the app's SW cache.
        navigateFallbackDenylist: [/^\/v1\//, /^\/merchant/, /^\/embed/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/(garment-viewer|drape\.worker|drapeBakeRead)-[\w-]+\.js$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'curtain-garment-viewer', expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 30 }, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'curtain-models',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 180 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // Pre-bundle three at dev start-up: discovering it on the first 3D click would make Vite reload the page.
  optimizeDeps: { include: ['three', 'three/addons/controls/OrbitControls.js'] },
  worker: { format: 'es' as const },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          engines: ['@curtain/schema', '@curtain/fit-engine', '@curtain/taste-engine'],
          // Loaded only by import() from the 3D estimate button (embed/Garment3D.tsx).
          'garment-viewer': ['three', '@curtain/garment-viewer'],
          vendor: ['react', 'react-dom', 'react-router', 'motion/react', 'zustand', 'dexie'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
} satisfies UserConfig;
