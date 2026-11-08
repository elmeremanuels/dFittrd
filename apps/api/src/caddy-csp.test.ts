/**
 * infra/Caddyfile CSP for app.<domain> (the PWA and the /embed overlay). Merchant logos and product
 * photos load through the api media proxy (GET /v1/sdk/media, carry-over #11) and hero renders from
 * signed api URLs, so img-src no longer needs every https host. This pins the narrowed policy and
 * checks that the web app has no hard-coded third-party image host that the CSP would now block.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const caddyfile = readFileSync(join(root, 'infra/Caddyfile'), 'utf8');

const policies = [...caddyfile.matchAll(/Content-Security-Policy "([^"]+)"/g)].map((m) => {
  const directives = new Map<string, string[]>();
  for (const part of m[1]!.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) directives.set(name, values);
  }
  return directives;
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(tsx?|css|html)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('infra/Caddyfile CSP img-src', () => {
  it('has the app and the embed policy', () => {
    expect(policies).toHaveLength(2);
    expect(policies.map((p) => p.get('frame-ancestors'))).toEqual([["'none'"], ['https:']]);
  });

  it('allows images from our own origins only: self, data:, blob: and the api', () => {
    for (const p of policies) {
      expect(p.get('img-src')).toEqual(["'self'", 'data:', 'blob:', 'https://api.{$DOMAIN}']);
      // The api origin is also where the app connects and loads render videos from.
      expect(p.get('connect-src')).toContain('https://api.{$DOMAIN}');
      expect(p.get('media-src')).toContain('https://api.{$DOMAIN}');
    }
  });

  it('apps/web has no hard-coded third-party image URL the narrowed policy would block', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, 'apps/web/src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:<img[^>]*\ssrc|<image[^>]*\shref|backgroundImage)\s*[=:]\s*["'`{]\s*["'`]?(https?:\/\/[^"'`\s)]+)/g)) offenders.push(`${file}: ${m[1]}`);
      for (const m of text.matchAll(/url\(\s*["']?(https?:\/\/[^"')\s]+)/g)) offenders.push(`${file}: ${m[1]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('merchant images in the web app go through the media proxy helper', () => {
    const web = (p: string) => readFileSync(join(root, 'apps/web/src', p), 'utf8');
    expect(web('routes/TryRoute.tsx')).toMatch(/mediaProxyUrl\(shop\.id, shop\.logoUrl\)/);
    expect(web('embed/EmbedScreens.tsx')).toMatch(/mediaProxyUrl\(shop\?\.id, garment\?\.productPhotos/);
    expect(web('embed/media.ts')).toContain('/v1/sdk/media?shop=');
  });
});

describe('infra/Caddyfile garment assets (D16)', () => {
  const block = /handle_path \/assets\/\* \{([\s\S]*?)\n\t\}/.exec(caddyfile)?.[1] ?? '';
  it('serves the bundle files read-only, immutable, cross-origin for the app only, without logs or cookies', () => {
    expect(block).toContain('root * /srv/assets');
    expect(block).toContain('file_server');
    expect(block).toContain('header Cache-Control "public, max-age=31536000, immutable"');
    expect(block).toContain('header Cross-Origin-Resource-Policy "cross-origin"');
    expect(block).toContain('header Access-Control-Allow-Origin "https://app.{$DOMAIN}"');
    expect(block).toContain('log_skip');
    expect(block).toContain('header -Set-Cookie');
    // Only the five bundle files: never payload.json, renders or photos.
    expect(block).toMatch(/base\\\.glb\|anchors\\\.json\|grading\\\.json\|material\\\.json\|qa\\\.json/);
    expect(block).not.toContain('payload');
  });
  it('needs no CSP change: the embed already connects to the api origin only', () => {
    for (const p of policies) expect(p.get('connect-src')).toEqual(["'self'", 'https://api.{$DOMAIN}']);
  });
});
