import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, encodePng } from './exportPng';
import { decodeAnyPng, maskBBox, maskFromPng, maskIou, maskPng, mirrorMask, normaliseMask, type Mask } from './evalPng';

/** A PNG with the given colour type and bit depth whose rows use `filters` (cycled), like PIL writes. */
function pngWith(width: number, height: number, colourType: number, bitDepth: number, rows: Uint8Array[], filters: number[], extra: [string, Uint8Array][] = []): Uint8Array {
  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType]!;
  const bpp = Math.max(1, (samples * bitDepth) >> 3);
  const rowBytes = rows[0]!.length;
  const raw = new Uint8Array(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length]!;
    raw[y * (rowBytes + 1)] = f;
    for (let x = 0; x < rowBytes; x++) {
      const v = rows[y]![x]!;
      const a = x >= bpp ? rows[y]![x - bpp]! : 0;
      const b = y > 0 ? rows[y - 1]![x]! : 0;
      const c = y > 0 && x >= bpp ? rows[y - 1]![x - bpp]! : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, pr][f]!;
      raw[y * (rowBytes + 1) + 1 + x] = (v - pred) & 0xff;
    }
  }
  const chunk = (type: string, body: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + body.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(body, 8);
    dv.setUint32(8 + body.length, crc32(out, 4, 8 + body.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colourType;
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra.map(([t, b]) => chunk(t, b)), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    total.set(p, o);
    o += p.length;
  }
  return total;
}

const rand = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) & 0xff;

describe('decodeAnyPng', () => {
  it('reads every row filter (0–4), as PIL writes them', () => {
    const r = rand(7);
    const rows = Array.from({ length: 10 }, () => Uint8Array.from({ length: 13 * 3 }, r));
    const img = decodeAnyPng(pngWith(13, 10, 2, 8, rows, [0, 1, 2, 3, 4]));
    expect(img.channels).toBe(3);
    for (let y = 0; y < 10; y++) expect(Array.from(img.data.subarray(y * 39, y * 39 + 39))).toEqual(Array.from(rows[y]!));
  });

  it('reads grey+alpha, RGBA, 16-bit, 1-bit grey and palette images', () => {
    const ga = decodeAnyPng(pngWith(2, 1, 4, 8, [Uint8Array.from([10, 0, 200, 255])], [1]));
    expect(ga.channels).toBe(2);
    expect(Array.from(ga.data)).toEqual([10, 0, 200, 255]);
    const g16 = decodeAnyPng(pngWith(2, 1, 0, 16, [Uint8Array.from([0x12, 0x34, 0xff, 0x00])], [2]));
    expect(Array.from(g16.data)).toEqual([0x12, 0xff]);
    const bits = decodeAnyPng(pngWith(10, 1, 0, 1, [Uint8Array.from([0b10100000, 0b01000000])], [0]));
    expect(Array.from(bits.data)).toEqual([255, 0, 255, 0, 0, 0, 0, 0, 0, 255]);
    const pal = decodeAnyPng(pngWith(3, 1, 3, 8, [Uint8Array.from([0, 1, 1])], [0], [['PLTE', Uint8Array.from([0, 0, 0, 255, 255, 255])], ['tRNS', Uint8Array.from([0, 255])]]));
    expect(pal.channels).toBe(4);
    expect(Array.from(pal.data)).toEqual([0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255]);
  });

  it('reads what our own encoder writes, and rejects what it cannot', () => {
    const img = decodeAnyPng(encodePng({ width: 3, height: 2, channels: 1, bitDepth: 8, data: [0, 128, 255, 1, 2, 3] }));
    expect(Array.from(img.data)).toEqual([0, 128, 255, 1, 2, 3]);
    expect(() => decodeAnyPng(Uint8Array.from([1, 2, 3]))).toThrow(/not a PNG/);
    const interlaced = pngWith(1, 1, 0, 8, [Uint8Array.from([0])], [0]);
    interlaced[8 + 8 + 12] = 1; // IHDR interlace byte (CRC no longer checked by this reader; the flag is)
    expect(() => decodeAnyPng(interlaced)).toThrow(/interlaced/);
  });
});

const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number): Mask => {
  const data = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * w + x] = 1;
  return { width: w, height: h, data };
};

describe('masks', () => {
  it('thresholds grey, and uses alpha when the image has transparency', () => {
    expect(Array.from(maskFromPng({ width: 3, height: 1, channels: 1, data: Uint8Array.from([0, 127, 255]) }).data)).toEqual([0, 0, 1]);
    expect(Array.from(maskFromPng({ width: 2, height: 1, channels: 4, data: Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 0]) }).data)).toEqual([1, 0]);
  });

  it('round-trips through maskPng', () => {
    const m = rect(9, 7, 2, 1, 6, 5);
    expect(maskFromPng(decodeAnyPng(maskPng(m))).data).toEqual(m.data);
  });

  it('IoU, bounding box, and a shape comparison that ignores position and scale', () => {
    const a = rect(40, 40, 5, 5, 15, 25);
    const b = rect(40, 40, 10, 5, 20, 25);
    expect(maskIou(a, a).iou).toBe(1);
    expect(maskIou(a, b).iou).toBeCloseTo(100 / 300, 6);
    expect(maskBBox(a)).toEqual({ x0: 5, y0: 5, x1: 15, y1: 25 });
    const big = rect(200, 200, 60, 20, 100, 100); // same 1:2 box, 4× larger, elsewhere
    expect(maskIou(normaliseMask(a)!, normaliseMask(big)!).iou).toBeGreaterThan(0.95);
    expect(normaliseMask(rect(10, 10, 0, 0, 0, 0))).toBeNull();
    expect(() => maskIou(a, rect(10, 10, 0, 0, 1, 1))).toThrow(/sizes differ/);
  });

  it('mirrors left to right', () => {
    expect(maskBBox(mirrorMask(rect(10, 4, 0, 0, 3, 4)))).toEqual({ x0: 7, y0: 0, x1: 10, y1: 4 });
  });
});
