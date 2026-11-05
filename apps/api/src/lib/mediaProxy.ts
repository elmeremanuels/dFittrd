/**
 * Image proxy helpers (carry-over #11): the shop logo on /try and the product photo in the
 * standalone embed are served from our origin, so a shopper's browser never requests the
 * merchant's server (no IP, no referrer, no tracking pixel through a "logo").
 *
 * The proxy is NOT open: a URL is served only when it is the shop's stored logo or a photo of one
 * of the shop's live products (allowlist in routes/sdk.ts). Downloads go through `safeFetch` (DNS
 * pinned, redirects re-checked), raster images only (no SVG: it can carry script), the bytes must
 * match the claimed type, and a size cap applies. Results are kept in a small in-memory LRU.
 */

/** Raster types we serve. SVG is excluded on purpose (script, external references). */
export const PROXY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'] as const;
export type ProxyImageType = (typeof PROXY_IMAGE_TYPES)[number];

/** Detects the image type from its first bytes; `null` when it is not one of PROXY_IMAGE_TYPES. */
export function sniffImageType(bytes: Uint8Array): ProxyImageType | null {
  const b = bytes;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(8, 12))) return 'image/avif';
  return null;
}

export interface CachedMedia {
  /** `null` = negative entry (unavailable / refused), kept for a short time. */
  body: Uint8Array | null;
  contentType: ProxyImageType | null;
  expiresAt: number;
}

/** Byte-bounded LRU with per-entry expiry (Map keeps insertion order; a hit re-inserts). */
export class MediaCache {
  private readonly map = new Map<string, CachedMedia>();
  private bytes = 0;
  constructor(private readonly maxBytes: number) {}

  get(key: string, now: number): CachedMedia | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= now) {
      this.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }

  set(key: string, value: CachedMedia): void {
    const size = value.body?.length ?? 0;
    if (size > this.maxBytes) return;
    this.delete(key);
    this.map.set(key, value);
    this.bytes += size;
    for (const [k] of this.map) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(k);
    }
  }

  get size(): number {
    return this.map.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  private delete(key: string): void {
    const old = this.map.get(key);
    if (!old) return;
    this.bytes -= old.body?.length ?? 0;
    this.map.delete(key);
  }
}
