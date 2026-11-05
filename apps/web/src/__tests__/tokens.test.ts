import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** WCAG 2.x relative luminance / contrast ratio for the design tokens in src/index.css. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad hex ${hex}`);
  const n = parseInt(m[1]!, 16);
  const ch = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(n >> 16) + 0.7152 * ch((n >> 8) & 0xff) + 0.0722 * ch(n & 0xff);
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

function tokens(): Record<string, string> {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

describe('design tokens (handoff §7) meet WCAG AA where they are used as text', () => {
  const t = tokens();
  it('keeps the brand colours', () => {
    expect(t.coral?.toLowerCase()).toBe('#ff5a3c');
    expect(t.cream?.toLowerCase()).toBe('#f5efe7');
    expect(t.ink?.toLowerCase()).toBe('#1a1612');
  });
  it('text tones on cream and on white reach 4.5:1', () => {
    for (const name of ['ink', 'ink-soft', 'ink-mute', 'coral-ink', 'ok', 'warn', 'bad']) {
      expect(t[name], name).toBeDefined();
      expect(contrast(t[name]!, t.cream!), `${name} on cream`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[name]!, '#ffffff'), `${name} on white`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('text on filled coral and ink surfaces reaches 4.5:1', () => {
    expect(contrast(t.ink!, t.coral!)).toBeGreaterThanOrEqual(4.5); // selected chips / coral buttons use ink text
    expect(contrast('#ffffff', t.ink!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.cream!, t.ink!)).toBeGreaterThanOrEqual(4.5);
  });
  it('documents why plain coral is not a text colour', () => {
    expect(contrast(t.coral!, t.cream!)).toBeLessThan(4.5); // 2.8:1 — fills and decorative icons only
  });
});

describe('coral is never used as a text colour where it fails AA', () => {
  it('source uses coral-ink for coral text and ink (not white) on filled coral', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = new URL('..', import.meta.url).pathname;
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) {
          if (n !== '__tests__' && n !== 'features') walk(p);
        } else if (/\.(tsx|css)$/.test(n)) files.push(p);
      }
    };
    walk(root);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      if (/text-coral-deep/.test(src)) offenders.push(`${f}: text-coral-deep (3.8:1)`);
      for (const m of src.matchAll(/bg-coral\b(?!\/)[^'"`;\n]*?text-white|text-white[^'"`;\n]*?bg-coral\b(?!\/)/g)) {
        // the Love button carries only an icon (non-text contrast 3:1 applies, white on coral is 3.1:1)
        if (!/h-8 w-8|icon/.test(src.slice(Math.max(0, (m.index ?? 0) - 120), (m.index ?? 0)))) offenders.push(`${f}: white text on coral`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
