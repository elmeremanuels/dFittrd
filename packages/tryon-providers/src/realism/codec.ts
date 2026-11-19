/**
 * PNG ⇄ render passes. Decoding runs every pass through sharp with a pixel limit and drops all
 * metadata (nothing but pixels survives); masks and depth are read as one grey channel. The passes
 * stay in memory: nothing here writes a file.
 */
import sharp from 'sharp';
import { ImageInputError } from '../errors.js';
import type { EncodedPasses } from './provider.js';
import { PASS_MAX_HEIGHT, PASS_MAX_WIDTH, type MaskImage, type RenderPassMeta, type RenderPasses, type RgbaImage } from './passes.js';

const LIMIT = PASS_MAX_WIDTH * PASS_MAX_HEIGHT;

async function raw(bytes: Uint8Array, channels: 1 | 4): Promise<{ width: number; height: number; data: Uint8Array }> {
  try {
    let img = sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { failOn: 'error', limitInputPixels: LIMIT });
    const meta = await img.metadata();
    if (meta.format !== 'png') throw new Error('render passes must be PNG');
    img = channels === 1 ? img.removeAlpha().toColourspace('b-w') : img.ensureAlpha().toColourspace('srgb');
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== channels) throw new Error(`expected ${channels} channels, got ${info.channels}`);
    return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch (e) {
    throw new ImageInputError(`render pass could not be decoded: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

export interface EncodedRenderPasses extends EncodedPasses {
  figureMask: Uint8Array;
  neighbour?: { size: string; garmentMask: Uint8Array } | undefined;
}

export async function decodePasses(png: EncodedRenderPasses, meta: RenderPassMeta): Promise<RenderPasses> {
  const [colour, depth, normal, garmentMask, figureMask, neighbourMask] = await Promise.all([
    raw(png.colour, 4),
    raw(png.depth, 1),
    raw(png.normal, 4),
    raw(png.garmentMask, 1),
    raw(png.figureMask, 1),
    png.neighbour ? raw(png.neighbour.garmentMask, 1) : Promise.resolve(null),
  ]);
  return {
    kind: 'renderPasses',
    width: colour.width,
    height: colour.height,
    colour,
    depth,
    normal,
    garmentMask,
    figureMask,
    ...(png.neighbour && neighbourMask ? { neighbour: { size: png.neighbour.size, garmentMask: neighbourMask } } : {}),
    meta,
  };
}

export async function encodeRgba(img: RgbaImage): Promise<Uint8Array> {
  const buf = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } }).png().toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export async function encodeMask(img: MaskImage): Promise<Uint8Array> {
  const buf = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 1 } }).png().toBuffer();
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** A provider's PNG/JPEG/WebP output to RGBA at the passes' size (fit: fill, so a vendor's rounding is undone; a wrong aspect is refused by the caller). */
export async function decodeOutput(bytes: Uint8Array): Promise<RgbaImage> {
  try {
    const { data, info } = await sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), { failOn: 'error', limitInputPixels: LIMIT * 4 })
      .ensureAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } catch (e) {
    throw new ImageInputError(`provider output could not be decoded: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}

/** Resize an RGBA image to w × h when only the provider's rounding differs (≤ 2 % per side); else unchanged. */
export async function fitToPasses(img: RgbaImage, w: number, h: number): Promise<RgbaImage> {
  if (img.width === w && img.height === h) return img;
  const ar = img.width / img.height, target = w / h;
  if (Math.abs(ar - target) / target > 0.02) return img;
  const { data, info } = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}
