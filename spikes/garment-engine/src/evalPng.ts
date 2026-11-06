/**
 * PNG reading and mask maths for the Phase 0 evaluation (view agreement). `decodePng` in
 * `exportPng.ts` only reads what our own encoder writes (filter 0); the masks stage 1b writes come
 * from PIL, which uses every row filter. This decoder reads any non-interlaced PNG with bit depth
 * 1–16 and colour type 0, 2, 3, 4 or 6, and turns it into a 0/1 mask.
 *
 * Inputs are files written by our own GPU stages (masks, never shop photos): still treat them as
 * data, so every length and offset is checked before it is used.
 */
import { inflateSync } from 'node:zlib';
import { encodePng } from './exportPng';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Refuse absurd sizes before allocating (the masks are 480×832; shop photos at most a few MP). */
const MAX_PIXELS = 50_000_000;

export interface DecodedPng {
  width: number;
  height: number;
  /** Samples per pixel after palette expansion: 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA. */
  channels: 1 | 2 | 3 | 4;
  /** 8-bit samples (16-bit images keep their high byte), row-major. */
  data: Uint8Array;
}

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodeAnyPng(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 8 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8;
  let width = 0, height = 0, bitDepth = 0, colourType = -1;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o + 12 <= bytes.length) {
    const len = view.getUint32(o);
    if (o + 12 + len > bytes.length) throw new Error('truncated PNG chunk');
    const type = String.fromCharCode(bytes[o + 4]!, bytes[o + 5]!, bytes[o + 6]!, bytes[o + 7]!);
    const body = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      if (len < 13) throw new Error('short IHDR');
      const h = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = h.getUint32(0);
      height = h.getUint32(4);
      bitDepth = body[8]!;
      colourType = body[9]!;
      if (body[12] !== 0) throw new Error('interlaced PNG not supported');
      if (CHANNELS[colourType] === undefined) throw new Error(`unsupported colour type ${colourType}`);
      if (![1, 2, 4, 8, 16].includes(bitDepth)) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (width === 0 || height === 0 || width * height > MAX_PIXELS) throw new Error(`refusing a ${width}×${height} PNG`);
    } else if (type === 'PLTE') palette = body.slice();
    else if (type === 'tRNS') transparency = body.slice();
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!width) throw new Error('PNG without IHDR');
  const samples = CHANNELS[colourType]!;
  const bitsPerPixel = samples * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let k = 0;
  for (const p of idat) {
    joined.set(p, k);
    k += p.length;
  }
  const raw = inflateSync(joined);
  if (raw.length < height * (rowBytes + 1)) throw new Error('PNG data too short');
  // Undo the row filters.
  const rows = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)]!;
    const src = y * (rowBytes + 1) + 1;
    const dst = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const r = raw[src + x]!;
      const a = x >= bpp ? rows[dst + x - bpp]! : 0;
      const b = y > 0 ? rows[dst - rowBytes + x]! : 0;
      const c = y > 0 && x >= bpp ? rows[dst - rowBytes + x - bpp]! : 0;
      let v: number;
      if (filter === 0) v = r;
      else if (filter === 1) v = r + a;
      else if (filter === 2) v = r + b;
      else if (filter === 3) v = r + ((a + b) >> 1);
      else if (filter === 4) v = r + paeth(a, b, c);
      else throw new Error(`bad PNG filter ${filter} on row ${y}`);
      rows[dst + x] = v & 0xff;
    }
  }
  // Unpack to 8-bit samples.
  const sampleAt = (y: number, s: number): number => {
    const base = y * rowBytes;
    if (bitDepth === 8) return rows[base + s]!;
    if (bitDepth === 16) return rows[base + 2 * s]!;
    const bit = s * bitDepth;
    const byte = rows[base + (bit >> 3)]!;
    const v = (byte >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
    return colourType === 3 ? v : Math.round((v * 255) / ((1 << bitDepth) - 1));
  };
  if (colourType === 3) {
    if (!palette) throw new Error('palette PNG without PLTE');
    const hasAlpha = transparency !== null;
    const channels = hasAlpha ? 4 : 3;
    const data = new Uint8Array(width * height * channels);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = sampleAt(y, x);
        const d = (y * width + x) * channels;
        data[d] = palette[3 * idx] ?? 0;
        data[d + 1] = palette[3 * idx + 1] ?? 0;
        data[d + 2] = palette[3 * idx + 2] ?? 0;
        if (hasAlpha) data[d + 3] = transparency![idx] ?? 255;
      }
    }
    return { width, height, channels, data };
  }
  const data = new Uint8Array(width * height * samples);
  for (let y = 0; y < height; y++) for (let s = 0; s < width * samples; s++) data[y * width * samples + s] = sampleAt(y, s);
  return { width, height, channels: samples as DecodedPng['channels'], data };
}

/** A binary mask, 1 = set, row-major. */
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * 0/1 mask from a decoded PNG: alpha when the image has one and it is not fully opaque, else the
 * grey value (or RGB luminance) above `threshold`.
 */
export function maskFromPng(img: DecodedPng, threshold = 127): Mask {
  const n = img.width * img.height;
  const data = new Uint8Array(n);
  const hasAlpha = img.channels === 2 || img.channels === 4;
  let useAlpha = false;
  if (hasAlpha) for (let i = 0; i < n && !useAlpha; i++) if (img.data[i * img.channels + img.channels - 1]! < 255) useAlpha = true;
  for (let i = 0; i < n; i++) {
    const p = i * img.channels;
    let v: number;
    if (useAlpha) v = img.data[p + img.channels - 1]!;
    else if (img.channels >= 3) v = 0.299 * img.data[p]! + 0.587 * img.data[p + 1]! + 0.114 * img.data[p + 2]!;
    else v = img.data[p]!;
    data[i] = v > threshold ? 1 : 0;
  }
  return { width: img.width, height: img.height, data };
}

export function maskPng(mask: Mask): Uint8Array {
  const data = new Uint16Array(mask.data.length);
  for (let i = 0; i < data.length; i++) data[i] = mask.data[i] ? 255 : 0;
  return encodePng({ width: mask.width, height: mask.height, channels: 1, bitDepth: 8, data });
}

export function countMask(mask: Mask): number {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) n += mask.data[i]!;
  return n;
}

export interface MaskIou {
  iou: number;
  intersection: number;
  union: number;
  /** Pixels set in `a` / in `b`. */
  areaA: number;
  areaB: number;
}

/** Intersection over union of two masks of the same size. */
export function maskIou(a: Mask, b: Mask): MaskIou {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`mask sizes differ: ${a.width}×${a.height} vs ${b.width}×${b.height}`);
  let inter = 0, union = 0, areaA = 0, areaB = 0;
  for (let i = 0; i < a.data.length; i++) {
    const x = a.data[i]!, y = b.data[i]!;
    areaA += x;
    areaB += y;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return { iou: union ? inter / union : 0, intersection: inter, union, areaA, areaB };
}

export interface BBox {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

export function maskBBox(mask: Mask): BBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!mask.data[y * mask.width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * The mask's bounding box scaled (uniformly, nearest neighbour) to `height` rows and centred on a
 * `width`-wide canvas: a shape comparison that ignores position and scale. Used only for the
 * indicative comparison with a shop photo, whose body, pose and camera differ from ours.
 */
export function normaliseMask(mask: Mask, width = 192, height = 256): Mask | null {
  const box = maskBBox(mask);
  if (!box) return null;
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const s = height / bh;
  const outW = Math.max(1, Math.round(bw * s));
  const off = Math.round((width - outW) / 2);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(box.y1 - 1, box.y0 + Math.floor((y + 0.5) / s));
    for (let x = 0; x < width; x++) {
      const u = x - off;
      if (u < 0 || u >= outW) continue;
      const sx = Math.min(box.x1 - 1, box.x0 + Math.floor((u + 0.5) / s));
      data[y * width + x] = mask.data[sy * mask.width + sx]!;
    }
  }
  return { width, height, data };
}

/** Horizontal mirror (a back view seen from the front, or a photo shot mirrored). */
export function mirrorMask(mask: Mask): Mask {
  const data = new Uint8Array(mask.data.length);
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) data[y * mask.width + x] = mask.data[y * mask.width + (mask.width - 1 - x)]!;
  return { width: mask.width, height: mask.height, data };
}
