/**
 * The committed images.json pins the hand classification to bytes. These tests use the committed
 * file itself (no image bytes: raw/ is gitignored) and stand-in bytes.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256 } from './exportJob';
import { checkImageBytes, committedImages, imageRecordChanges } from './shopImages';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'bohohippychic');
const imagesJson = JSON.parse(readFileSync(join(dataDir, 'images.json'), 'utf8')) as { products: Record<string, { position: number; url: string; sha256: string | null }[]> };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('committed images.json', () => {
  it('pins every image of the five products to a URL on the Shopify CDN and a sha256', () => {
    const list = committedImages(imagesJson);
    expect(list).toHaveLength(20);
    expect(new Set(list.map((i) => i.handle)).size).toBe(5);
    for (const i of list) {
      expect(i.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(new URL(i.url).hostname).toBe('cdn.shopify.com');
    }
    expect(committedImages(imagesJson, ['azure-palm-baby-doll-dress']).map((i) => i.position)).toEqual([1, 2, 3, 4]);
    expect(() => committedImages(imagesJson, ['no-such-product'])).toThrow(/no images for no-such-product/);
  });

  it('refuses an image without a committed sha256 or off the Shopify CDN', () => {
    const noSha = clone(imagesJson);
    noSha.products['azure-palm-baby-doll-dress']![1]!.sha256 = null;
    expect(() => committedImages(noSha)).toThrow(/#2 has no committed sha256/);
    const offCdn = clone(imagesJson);
    offCdn.products['azure-palm-baby-doll-dress']![0]!.url = 'https://example.com/a.jpg';
    expect(() => committedImages(offCdn)).toThrow(/not an https:\/\/cdn\.shopify\.com URL/);
  });
});

describe('checkImageBytes', () => {
  it('accepts the committed bytes and refuses others, without suggesting a re-fetch as the fix', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const img = { handle: 'h', position: 2, url: 'https://cdn.shopify.com/x.jpg', sha256: sha256(bytes) };
    expect(() => checkImageBytes(img, bytes, sha256)).not.toThrow();
    let msg = '';
    try {
      checkImageBytes(img, new Uint8Array([0xff, 0xd8, 0xff, 9]), sha256);
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/changed or reordered/);
    expect(msg).toMatch(/Nothing was written/);
    expect(msg).toMatch(/SHOP_IMAGE_CLASSIFICATION/);
    expect(msg).toMatch(/--accept-image-changes/);
  });
});

describe('imageRecordChanges (the guard of a full --fetch)', () => {
  it('finds nothing between the committed file and itself, or when a file is just not downloaded', () => {
    expect(imageRecordChanges(imagesJson, clone(imagesJson))).toEqual([]);
    const notDownloaded = clone(imagesJson);
    for (const imgs of Object.values(notDownloaded.products)) for (const i of imgs) i.sha256 = null;
    expect(imageRecordChanges(imagesJson, notDownloaded)).toEqual([]);
  });

  it('reports a changed photo, a reorder, and an added or removed image', () => {
    const next = clone(imagesJson);
    const azure = next.products['azure-palm-baby-doll-dress']!;
    // Reorder: the back photo (4) and a front photo (1) swap positions.
    const [a, d] = [azure[0]!, azure[3]!];
    [a.url, d.url] = [d.url, a.url];
    [a.sha256, d.sha256] = [d.sha256, a.sha256];
    // A photo replaced in place.
    next.products['rosewater-blouse']![0]!.sha256 = 'f'.repeat(64);
    // One image removed, one added.
    next.products['crimson-wildflower-maxi-skirt']!.pop();
    next.products['woodstock-wanderer-knit-cardi']!.push({ position: 9, url: 'https://cdn.shopify.com/new.jpg', sha256: 'e'.repeat(64) });
    const changes = imageRecordChanges(imagesJson, next);
    expect(changes.filter((c) => c.handle === 'azure-palm-baby-doll-dress').map((c) => [c.position, c.change])).toEqual([[1, 'url'], [1, 'sha256'], [4, 'url'], [4, 'sha256']]);
    expect(changes.find((c) => c.handle === 'rosewater-blouse')).toMatchObject({ position: 1, change: 'sha256' });
    expect(changes.find((c) => c.handle === 'crimson-wildflower-maxi-skirt')).toMatchObject({ change: 'removed' });
    expect(changes.find((c) => c.handle === 'woodstock-wanderer-knit-cardi')).toMatchObject({ position: 9, change: 'added' });
  });
});
