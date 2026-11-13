/**
 * Merchant images through our own origin (carry-over #11): the shop logo on /try and the product
 * photo in the embed load from `GET /v1/sdk/media?shop=<id>&u=<url>` on the api, which fetches
 * them server-side through the SSRF guard. The shopper's browser never contacts the merchant's
 * server for them (no IP, no referrer, no tracking pixel posing as a logo).
 *
 * The api serves only URLs that are the shop's stored logo or a photo of one of its products, so a
 * URL built here for anything else is a 404, never an open proxy.
 */
import { apiBaseUrl } from '@/api/client';
import { MOCK_EMBED_SHOP } from './deps';

/**
 * The proxied URL of a merchant image, or `null` (no image, not an http(s) URL, or the fabricated
 * shop of `mock:` tokens, which has no server row; /try guards its own demo shop the same way).
 */
export function mediaProxyUrl(shopId: string | null | undefined, url: string | null | undefined, base: string = apiBaseUrl()): string | null {
  if (!shopId || !url || shopId === MOCK_EMBED_SHOP.id) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return `${base}/v1/sdk/media?shop=${encodeURIComponent(shopId)}&u=${encodeURIComponent(url)}`;
}
