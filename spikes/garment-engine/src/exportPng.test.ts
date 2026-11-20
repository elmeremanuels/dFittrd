import { describe, expect, it } from 'vitest';
import { crc32, decodePng, encodePng } from './exportPng';

describe('PNG writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips 8-bit grey, 16-bit grey and 8-bit RGB', () => {
    const w = 7, h = 5;
    const g8 = Array.from({ length: w * h }, (_, i) => (i * 37) % 256);
    const g16 = Array.from({ length: w * h }, (_, i) => (i * 4099) % 65536);
    const rgb = Array.from({ length: w * h * 3 }, (_, i) => (i * 11) % 256);
    for (const [img, data] of [
      [{ width: w, height: h, channels: 1, bitDepth: 8 }, g8],
      [{ width: w, height: h, channels: 1, bitDepth: 16 }, g16],
      [{ width: w, height: h, channels: 3, bitDepth: 8 }, rgb],
    ] as const) {
      const bytes = encodePng({ ...img, data });
      expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      const back = decodePng(bytes);
      expect(back).toMatchObject(img);
      expect([...back.data]).toEqual(data);
    }
  });

  it('clamps and rounds samples, and rejects a wrong sample count', () => {
    const back = decodePng(encodePng({ width: 3, height: 1, channels: 1, bitDepth: 8, data: [-4, 12.6, 300] }));
    expect([...back.data]).toEqual([0, 13, 255]);
    expect(() => encodePng({ width: 2, height: 2, channels: 1, bitDepth: 8, data: [1, 2, 3] })).toThrow(/expected 4/);
  });

  it('is deterministic', () => {
    const img = { width: 16, height: 16, channels: 1 as const, bitDepth: 16 as const, data: Array.from({ length: 256 }, (_, i) => i * 200) };
    expect(Buffer.from(encodePng(img)).equals(Buffer.from(encodePng(img)))).toBe(true);
  });
});
