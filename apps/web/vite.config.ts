/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// No `define` of server secrets here, ever (decision D3): the backend is the only place that reads keys.
// Any VITE_* variable whose name contains KEY or SECRET fails the build (AGENTS.md rule 2).
for (const name of Object.keys(process.env)) {
  if (name.startsWith('VITE_') && /KEY|SECRET/i.test(name)) {
    throw new Error(`Refusing to build: ${name} looks like a secret and would ship to the browser.`);
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'],
      manifest: {
        name: 'Paskamer — your private fitting room',
        short_name: 'Paskamer',
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
        globIgnores: ['**/models/**'],
        navigateFallbackDenylist: [/^\/v1\//, /^\/merchant/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'paskamer-models',
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
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          engines: ['@paskamer/schema', '@paskamer/fit-engine', '@paskamer/taste-engine'],
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
});
