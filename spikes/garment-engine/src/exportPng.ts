/**
 * Minimal PNG encoder and decoder for the Phase 0 export (no dependencies beyond node:zlib):
 * 8-bit grey (masks, control frames), 16-bit grey (metric depth in mm) and 8-bit RGB (synthetic
 * frames, synthetic dressed stills). Filter type 0 on every row, so the output is deterministic for
 * a given zlib level. The decoder reads only what the encoder writes (it is for tests and checks).
 */
import { deflateSync, inflateSync } from 'node:zlib';

export interface PngImage {
  width: number;
  height: number;
  /** 1 = grey, 3 = RGB. */
  channels: 1 | 3;
  bitDepth: 8 | 16;
  /** Row-major samples; 16-bit samples are numbers 0…65535. */
  data: ArrayLike<number>;
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + payload.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(out, 4, 8 + payload.length));
  return out;
}

export function encodePng(img: PngImage): Uint8Array {
  const { width, height, channels, bitDepth, data } = img;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`bad PNG size ${width}×${height}`);
  if (data.length !== width * height * channels) throw new Error(`PNG data has ${data.length} samples, expected ${width * height * channels}`);
  const bytesPerSample = bitDepth / 8;
  const rowBytes = width * channels * bytesPerSample;
  const raw = new Uint8Array(height * (rowBytes + 1));
  const max = bitDepth === 16 ? 65535 : 255;
  for (let y = 0; y < height; y++) {
    const o = y * (rowBytes + 1);
    raw[o] = 0; // filter: none
    for (let s = 0; s < width * channels; s++) {
      const v = Math.min(max, Math.max(0, Math.round(data[y * width * channels + s]!)));
      if (bitDepth === 16) {
        raw[o + 1 + 2 * s] = v >>> 8;
        raw[o + 2 + 2 * s] = v & 0xff;
      } else raw[o + 1 + s] = v;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = channels === 3 ? 2 : 0; // colour type: truecolour or greyscale
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const idat = deflateSync(raw, { level: 6 });
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(idat.buffer, idat.byteOffset, idat.byteLength)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Decodes a PNG written by `encodePng` (filter 0, no interlace). Throws on anything else. */
export function decodePng(bytes: Uint8Array): PngImage & { data: Uint16Array } {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  let width = 0, height = 0, bitDepth: 8 | 16 = 8, channels: 1 | 3 = 1;
  const idat: Uint8Array[] = [];
  while (o < bytes.length) {
    const len = view.getUint32(o);
    const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const body = bytes.subarray(o + 8, o + 8 + len);
    if (crc32(bytes, o + 4, o + 8 + len) !== view.getUint32(o + 8 + len)) throw new Error(`bad CRC in ${type}`);
    if (type === 'IHDR') {
      const h = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = h.getUint32(0);
      height = h.getUint32(4);
      if (body[8] !== 8 && body[8] !== 16) throw new Error(`unsupported bit depth ${body[8]}`);
      bitDepth = body[8] as 8 | 16;
      if (body[9] !== 0 && body[9] !== 2) throw new Error(`unsupported colour type ${body[9]}`);
      channels = body[9] === 2 ? 3 : 1;
      if (body[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') idat.push(body);
    o += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of idat) {
    joined.set(p, k);
    k += p.length;
  }
  const raw = inflateSync(joined);
  const bps = bitDepth / 8;
  const rowBytes = width * channels * bps;
  const data = new Uint16Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const r = y * (rowBytes + 1);
    if (raw[r] !== 0) throw new Error(`unsupported PNG filter ${raw[r]} on row ${y}`);
    for (let s = 0; s < width * channels; s++) {
      data[y * width * channels + s] = bitDepth === 16 ? (raw[r + 1 + 2 * s]! << 8) | raw[r + 2 + 2 * s]! : raw[r + 1 + s]!;
    }
  }
  return { width, height, channels, bitDepth, data };
}
