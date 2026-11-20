/**
 * The committed image record of a validated shop (data/<shop>/images.json) as the pin for the hand
 * classification. The classification (front/back, on model) is keyed by image position, so it is
 * only valid for the exact bytes that were looked at. Everything here compares against the
 * COMMITTED sha256 values and never rewrites them:
 *
 * - `committedImages` lists what `shop:<shop> -- --fetch-images` downloads (URL and expected hash).
 * - `checkImageBytes` refuses bytes whose hash differs, before they are written to raw/.
 * - `imageRecordChanges` is the guard of a full `--fetch`: it refuses to write a new images.json
 *   whose hashes, URLs or positions differ from the committed one unless the classification was
 *   reviewed (`--accept-image-changes`).
 *
 * Pure functions, no I/O.
 */

/** One committed image: where to get it and the bytes it must have. */
export interface CommittedImage {
  handle: string;
  position: number;
  url: string;
  sha256: string;
}

interface ImageRecordLike {
  position: number;
  url?: string;
  sha256?: string | null;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function productsOf(imagesJson: unknown): Record<string, ImageRecordLike[]> {
  const products = (imagesJson as { products?: unknown })?.products;
  if (!products || typeof products !== 'object') throw new Error('images.json has no products object');
  return products as Record<string, ImageRecordLike[]>;
}

/** Every image of images.json with its URL and committed sha256; throws when one lacks either. */
export function committedImages(imagesJson: unknown, handles?: readonly string[]): CommittedImage[] {
  const products = productsOf(imagesJson);
  const wanted = handles ?? Object.keys(products);
  const out: CommittedImage[] = [];
  for (const handle of wanted) {
    const imgs = products[handle];
    if (!Array.isArray(imgs) || !imgs.length) throw new Error(`images.json has no images for ${handle}`);
    for (const img of imgs) {
      if (!img.url) throw new Error(`images.json: ${handle} #${img.position} has no url`);
      if (!img.sha256 || !SHA256_HEX.test(img.sha256)) {
        throw new Error(`images.json: ${handle} #${img.position} has no committed sha256, so its hand classification is not pinned to any bytes`);
      }
      const url = new URL(img.url);
      if (url.protocol !== 'https:' || url.hostname !== 'cdn.shopify.com') throw new Error(`images.json: ${handle} #${img.position} is not an https://cdn.shopify.com URL (${img.url})`);
      out.push({ handle, position: img.position, url: img.url, sha256: img.sha256 });
    }
  }
  return out;
}

/** Throws when downloaded bytes are not the committed ones (the shop changed or reordered the photo). */
export function checkImageBytes(img: CommittedImage, bytes: Uint8Array, sha: (b: Uint8Array) => string): void {
  const got = sha(bytes);
  if (got !== img.sha256) {
    throw new Error(
      `${img.handle} #${img.position}: the bytes at ${img.url} (sha256 ${got.slice(0, 12)}…) are not the committed image (${img.sha256.slice(0, 12)}…). ` +
        'The shop changed or reordered its photos, so the hand classification in src/shopSelection.ts no longer applies. ' +
        'Nothing was written. Look at the new photos, update SHOP_IMAGE_CLASSIFICATION, then rebuild images.json locally with `--fetch --accept-image-changes` and commit it.',
    );
  }
}

/** One difference between the committed images.json and a freshly built one. */
export interface ImageRecordChange {
  handle: string;
  position: number;
  change: 'sha256' | 'url' | 'added' | 'removed';
  before?: string | null;
  after?: string | null;
}

/** What differs per image between two images.json files (hash, URL, an image added or removed). */
export function imageRecordChanges(committed: unknown, next: unknown): ImageRecordChange[] {
  const a = productsOf(committed);
  const b = productsOf(next);
  const changes: ImageRecordChange[] = [];
  for (const handle of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const before = new Map((a[handle] ?? []).map((i) => [i.position, i]));
    const after = new Map((b[handle] ?? []).map((i) => [i.position, i]));
    for (const pos of [...new Set([...before.keys(), ...after.keys()])].sort((x, y) => x - y)) {
      const x = before.get(pos);
      const y = after.get(pos);
      if (!x) changes.push({ handle, position: pos, change: 'added', after: y?.url ?? null });
      else if (!y) changes.push({ handle, position: pos, change: 'removed', before: x.url ?? null });
      else {
        if ((x.url ?? null) !== (y.url ?? null)) changes.push({ handle, position: pos, change: 'url', before: x.url ?? null, after: y.url ?? null });
        // A missing file on either side (sha256 null) is not a change of the image.
        if (x.sha256 && y.sha256 && x.sha256 !== y.sha256) changes.push({ handle, position: pos, change: 'sha256', before: x.sha256, after: y.sha256 });
      }
    }
  }
  return changes;
}
