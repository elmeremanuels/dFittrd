/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { assertNoClientSecrets } from './config/envGuard';

// No `define` of server secrets here, ever (decision D3): the backend is the only place that reads keys.
// Any VITE_* variable whose name contains KEY or SECRET fails the build (AGENTS.md rule 2) — from the
// shell AND from the .env files Vite loads itself (those are not in process.env).
export default defineConfig(({ mode }) => {
  assertNoClientSecrets({ ...process.env, ...loadEnv(mode, __dirname, 'VITE_') });
  return config;
});

/**
 * Framing headers for the dev and preview servers, mirroring infra/Caddyfile (docs/STANDALONE.md §2):
 * `/embed/*` is the only framable route (any https shop, plus localhost for the local demo
 * storefront); every other HTML page keeps `frame-ancestors 'none'`. No COOP/COEP is set here,
 * so nothing blocks a cross-origin parent from framing the embed.
 */
export const EMBED_FRAME_ANCESTORS = "frame-ancestors https: http://localhost:* http://127.0.0.1:*";

export function framingHeaders(req: Pick<IncomingMessage, 'url' | 'headers'>, res: Pick<ServerResponse, 'setHeader' | 'removeHeader'>): void {
  const path = (req.url ?? '/').split('?')[0] ?? '/';
  if (path === '/embed' || path.startsWith('/embed/')) {
    res.setHeader('Content-Security-Policy', EMBED_FRAME_ANCESTORS);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Cross-Origin-Opener-Policy');
    res.removeHeader('Cross-Origin-Embedder-Policy');
    return;
  }
  const accept = String(req.headers.accept ?? '');
  if (accept.includes('text/html')) res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
}

function embedFraming(): Plugin {
  const mw = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    framingHeaders(req, res);
    next();
  };
  return {
    name: 'curtain-embed-framing',
    configureServer(server) {
      server.middlewares.use(mw);
    },
    configurePreviewServer(server) {
      server.middlewares.use(mw);
    },
  };
}

const config = {
  plugins: [
    embedFraming(),
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
        // never precached, cached on first use instead (scripts/check-viewer-chunk.mjs pins this).
        globIgnores: ['**/models/**', '**/garment-viewer-*.js', '**/drape.worker-*.js'],
        // /embed is framed inside merchant pages: never served from the app's SW cache.
        navigateFallbackDenylist: [/^\/v1\//, /^\/merchant/, /^\/embed/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/(garment-viewer|drape\.worker)-[\w-]+\.js$/.test(url.pathname),
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
