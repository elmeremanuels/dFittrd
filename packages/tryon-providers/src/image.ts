import sharp from 'sharp';
import { ImageInputError } from './errors.js';

/** Maximum size sent to any vendor: 3:4 portrait, within 1024 × 1536. */
export const MAX_WIDTH = 1024;
export const MAX_HEIGHT = 1536;

export interface NormalisedImage {
  png: Uint8Array;
  width: number;
  height: number;
}

/**
 * Normalises any input image before it leaves our infrastructure:
 *  - applies the EXIF orientation, then drops EXIF, ICC, XMP and IPTC (sharp does not copy
 *    metadata unless `withMetadata()` is called);
 *  - converts to sRGB, flattens alpha onto the given background (default white) when asked;
 *  - resizes to fit inside 1024 × 1536 without enlarging;
 *  - encodes as PNG.
 */
export async function normaliseImage(
  bytes: Uint8Array,
  opts: { maxWidth?: number; maxHeight?: number; flatten?: boolean; background?: string } = {},
): Promise<NormalisedImage> {
  const maxWidth = opts.maxWidth ?? MAX_WIDTH;
  const maxHeight = opts.maxHeight ?? MAX_HEIGHT;
  try {
    let pipeline = sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { failOn: 'error' })
      .rotate()
      .resize({ width: maxWidth, height: maxHeight, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb');
    if (opts.flatten) pipeline = pipeline.flatten({ background: opts.background ?? '#ffffff' });
    const { data, info } = await pipeline.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true });
    return { png: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  } catch (e) {
    throw new ImageInputError(`could not decode input image: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
}

/** Reads width/height (and format) of an image buffer. */
export async function readDimensions(bytes: Uint8Array): Promise<{ width: number; height: number; format: string }> {
  try {
    const meta = await sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)).metadata();
    if (!meta.width || !meta.height) throw new Error('no dimensions');
    return { width: meta.width, height: meta.height, format: meta.format ?? 'unknown' };
  } catch (e) {
    throw new ImageInputError(`could not read image dimensions: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
}

/** Re-encodes a vendor output (PNG/JPEG/WebP) as PNG with metadata stripped and reports its size. */
export async function toPng(bytes: Uint8Array): Promise<NormalisedImage> {
  try {
    const { data, info } = await sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      .png({ compressionLevel: 6 })
      .toBuffer({ resolveWithObject: true });
    return { png: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
  } catch (e) {
    throw new ImageInputError(`could not decode vendor output: ${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function toDataUri(png: Uint8Array, mime = 'image/png'): string {
  return `data:${mime};base64,${toBase64(png)}`;
}

/** Accepts a raw base64 string or a data URI and returns the decoded bytes. */
export function fromBase64OrDataUri(value: string): Uint8Array {
  const trimmed = value.trim();
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(trimmed);
  const payload = match ? match[2] ?? '' : trimmed;
  const buf = Buffer.from(payload, 'base64');
  if (buf.length === 0) throw new ImageInputError('empty base64 image payload');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
