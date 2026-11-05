import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { encodeQr, qrToSvg, type QrMatrix } from './qr';

/** Paint the matrix as RGBA pixels (with a quiet zone) so a real decoder can read it back. */
function rasterise(m: QrMatrix, scale = 4, quiet = 4): { data: Uint8ClampedArray; width: number } {
  const n = (m.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const mx = Math.floor(x / scale) - quiet;
      const my = Math.floor(y / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < m.size && my < m.size && m.modules[my * m.size + mx] === 1;
      const v = dark ? 0 : 255;
      const k = (y * n + x) * 4;
      data[k] = v;
      data[k + 1] = v;
      data[k + 2] = v;
      data[k + 3] = 255;
    }
  return { data, width: n };
}

function roundtrip(text: string): QrMatrix {
  const m = encodeQr(text);
  const { data, width } = rasterise(m);
  const decoded = jsQR(data, width, width, { inversionAttempts: 'dontInvert' });
  expect(decoded, `decode failed for ${text.length} chars (v${m.version})`).not.toBeNull();
  expect(decoded!.data).toBe(text);
  return m;
}

const jwtish = (n: number): string =>
  'https://app.curtain.fit/try/' +
  Array.from({ length: n }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[i % 64]).join('');

describe('encodeQr', () => {
  it('encodes a short URL in version 1–3 and decodes back', () => {
    const m = roundtrip('https://curtain.fit');
    expect(m.version).toBeLessThanOrEqual(3);
    expect(m.size).toBe(m.version * 4 + 17);
  });

  it('decodes a realistic 10-minute try token URL (~250 chars, version ≥ 10, two block groups)', () => {
    const m = roundtrip(jwtish(220));
    expect(m.version).toBeGreaterThanOrEqual(10);
  });

  it('decodes UTF-8 text in byte mode', () => {
    roundtrip('Try it on in Curtain — dress “Aalter” €149 ✓');
  });

  it('decodes across many lengths (hits all block-structure code paths)', () => {
    for (const len of [1, 17, 18, 32, 54, 80, 110, 160, 300, 420, 600, 900, 1270]) roundtrip(jwtish(len));
  });

  it('selects versions at the exact level-L byte-capacity boundaries (validates the packed tables)', () => {
    // Data codewords (L): v1 19, v2 34, v9 232, v10 274, v40 2956; header = 2 bytes (v<10) or 3 bytes.
    const ascii = (n: number): string => 'a'.repeat(n);
    expect(encodeQr(ascii(17)).version).toBe(1);
    expect(encodeQr(ascii(18)).version).toBe(2);
    expect(encodeQr(ascii(230)).version).toBe(9);
    expect(encodeQr(ascii(231)).version).toBe(10);
    expect(encodeQr(ascii(2953)).version).toBe(40);
    expect(() => encodeQr(ascii(2954))).toThrow(/too long/);
  });

  it('reaches version 40 (177 modules) and still decodes', () => {
    const m = roundtrip(jwtish(2900));
    expect(m.version).toBe(40);
    expect(m.size).toBe(177);
  });

  it('picks a mask in 0..7 and has the dark module set', () => {
    const m = encodeQr('hello');
    expect(m.mask).toBeGreaterThanOrEqual(0);
    expect(m.mask).toBeLessThanOrEqual(7);
    // Dark module at (x=8, y=size-8).
    expect(m.modules[(m.size - 8) * m.size + 8]).toBe(1);
  });

  it('is deterministic', () => {
    const a = encodeQr(jwtish(100));
    const b = encodeQr(jwtish(100));
    expect(Array.from(a.modules)).toEqual(Array.from(b.modules));
  });
});

describe('qrToSvg', () => {
  it('produces a self-contained SVG with a quiet zone and the ink colour', () => {
    const svg = qrToSvg('https://curtain.fit');
    const m = encodeQr('https://curtain.fit');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`);
    expect(svg).toContain('fill="#1A1612"');
    expect(svg).not.toMatch(/<script|onload|href=/i);
    const dark = Array.from(m.modules).filter((v) => v === 1).length;
    expect((svg.match(/h1v1h-1z/g) ?? []).length).toBe(dark);
  });

  it('honours colour and quiet-zone options', () => {
    const svg = qrToSvg('x', { fg: '#000', bg: '#F5EFE7', quiet: 2 });
    expect(svg).toContain('fill="#000"');
    expect(svg).toContain('fill="#F5EFE7"');
    expect(svg).toContain('viewBox="0 0 25 25"');
  });
});
