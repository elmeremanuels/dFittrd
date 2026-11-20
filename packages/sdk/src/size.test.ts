// @vitest-environment node
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version';

const root = new URL('..', import.meta.url);
const BUDGET = 8 * 1024;
const QR_BUDGET = 2 * 1024;

async function bundle(entry: string, format: 'iife' | 'esm'): Promise<string> {
  const out = await build({
    entryPoints: [new URL(entry, root).pathname],
    bundle: true,
    minify: true,
    format,
    target: 'es2019',
    platform: 'browser',
    write: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  return out.outputFiles[0]!.text;
}

const gz = (text: string | Buffer): number => gzipSync(text, { level: 9 }).length;

describe('size budget', () => {
  it('the whole SDK (IIFE, es2019, minified) is under 8 KB gzipped', async () => {
    const js = await bundle('src/index.ts', 'iife');
    const size = gz(js);
    console.log(`sdk.v1.js: ${js.length} B raw, ${size} B gzipped`);
    expect(size).toBeLessThan(BUDGET);
  });

  it('the built-in QR encoder alone is at most 2 KB gzipped', async () => {
    const js = await bundle('src/qr.ts', 'esm');
    const size = gz(js);
    console.log(`qr.ts: ${js.length} B raw, ${size} B gzipped`);
    expect(size).toBeLessThanOrEqual(QR_BUDGET);
  });

  it('dist/ artefacts (when built) are under budget too', () => {
    for (const file of ['dist/sdk.v1.js', 'dist/sdk.v1.esm.js']) {
      const p = new URL(file, root).pathname;
      if (!existsSync(p)) continue;
      expect(gz(readFileSync(p))).toBeLessThan(BUDGET);
    }
  });
});

describe('privacy guarantees (D3)', () => {
  it('makes no third-party requests and touches no cookies or storage', async () => {
    const js = await bundle('src/index.ts', 'iife');
    const urls = (js.match(/https?:\/\/[^\s"'`)]+/g) ?? []).filter((u) => u !== 'http://www.w3.org/2000/svg');
    expect(urls).toEqual([]);
    for (const banned of ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'sendBeacon', 'XMLHttpRequest', 'navigator.geolocation']) {
      expect(js, `bundle must not reference ${banned}`).not.toContain(banned);
    }
    expect(js).toContain('credentials:"omit"');
    expect(js).toMatch(/\/v1\/sdk\/sessions/);
  });

  it('never ships a secret-key shape', async () => {
    const js = await bundle('src/index.ts', 'iife');
    expect(js).not.toMatch(/sk_(live|test)_[A-Za-z0-9]{8,}/);
  });
});

describe('contracts', () => {
  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
