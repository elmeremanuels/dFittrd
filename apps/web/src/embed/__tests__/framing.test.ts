import { describe, expect, it } from 'vitest';
import { EMBED_FRAME_ANCESTORS, framingHeaders } from '../../../vite.config';
import { isEmbedPath } from '../path';

function run(url: string, accept = 'text/html') {
  const headers = new Map<string, string>();
  const removed: string[] = [];
  framingHeaders({ url, headers: { accept } }, { setHeader: (k: string, v: string | number | readonly string[]) => (headers.set(k, String(v)), undefined as never), removeHeader: (k: string) => void removed.push(k) });
  return { headers, removed };
}

describe('dev/preview framing headers', () => {
  it('/embed/* is framable by https shops and the local demo storefront', () => {
    const { headers, removed } = run('/embed/abc?x=1');
    expect(headers.get('Content-Security-Policy')).toBe(EMBED_FRAME_ANCESTORS);
    expect(EMBED_FRAME_ANCESTORS).toContain('https:');
    expect(EMBED_FRAME_ANCESTORS).not.toContain("'none'");
    expect(headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
    expect(removed).toEqual(expect.arrayContaining(['X-Frame-Options', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Embedder-Policy']));
  });

  it('every other page keeps frame-ancestors none', () => {
    expect(run('/deck').headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(run('/embedded-thing').headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    expect(run('/src/main.tsx', '*/*').headers.size).toBe(0);
  });

  it('isEmbedPath', () => {
    expect(isEmbedPath('/embed')).toBe(true);
    expect(isEmbedPath('/embed/tok')).toBe(true);
    expect(isEmbedPath('/embedded')).toBe(false);
    expect(isEmbedPath('/try/x')).toBe(false);
  });
});
