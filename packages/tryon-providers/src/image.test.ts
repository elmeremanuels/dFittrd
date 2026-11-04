import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageInputError } from './errors.js';
import { MAX_HEIGHT, MAX_WIDTH, fromBase64OrDataUri, normaliseImage, readDimensions, toDataUri, toPng } from './image.js';
import { makePng, makeTaggedJpeg } from './test-utils.js';

describe('normaliseImage', () => {
  it('strips EXIF and ICC, applies orientation and outputs PNG', async () => {
    const tagged = await makeTaggedJpeg(400, 300);
    const inMeta = await sharp(Buffer.from(tagged)).metadata();
    expect(inMeta.exif).toBeDefined();
    expect(inMeta.icc).toBeDefined();

    const out = await normaliseImage(tagged);
    const meta = await sharp(Buffer.from(out.png)).metadata();
    expect(meta.format).toBe('png');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    // orientation 6 = rotate 90°, so the landscape input becomes portrait
    expect(out.width).toBe(300);
    expect(out.height).toBe(400);
  });

  it('resizes to fit inside 1024 × 1536 without enlarging', async () => {
    const big = await makePng(3000, 4000);
    const out = await normaliseImage(big);
    expect(out.width).toBeLessThanOrEqual(MAX_WIDTH);
    expect(out.height).toBeLessThanOrEqual(MAX_HEIGHT);
    // 3:4 input: the width bound (1024) wins, height follows the aspect ratio
    expect(out.width).toBe(1024);
    expect(out.height).toBe(1365);
    const small = await makePng(300, 400);
    const kept = await normaliseImage(small);
    expect(kept.width).toBe(300);
    expect(kept.height).toBe(400);
  });

  it('rejects garbage input with ImageInputError', async () => {
    await expect(normaliseImage(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(ImageInputError);
  });
});

describe('helpers', () => {
  it('round-trips data URIs and bare base64', async () => {
    const png = await makePng(10, 10);
    const uri = toDataUri(png);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    expect(Buffer.from(fromBase64OrDataUri(uri))).toEqual(Buffer.from(png));
    expect(Buffer.from(fromBase64OrDataUri(Buffer.from(png).toString('base64')))).toEqual(Buffer.from(png));
    expect(() => fromBase64OrDataUri('data:image/png;base64,')).toThrow(ImageInputError);
  });

  it('reads dimensions and re-encodes vendor output as PNG', async () => {
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    expect(await readDimensions(new Uint8Array(jpeg))).toEqual({ width: 64, height: 48, format: 'jpeg' });
    const png = await toPng(new Uint8Array(jpeg));
    expect(png.width).toBe(64);
    expect((await sharp(Buffer.from(png.png)).metadata()).format).toBe('png');
  });
});
