/**
 * Standalone embed (docs/STANDALONE.md §2, D11): which storefront origins the iframe on our origin
 * may use as its `postMessage` targetOrigin. It never posts to `*`.
 *
 *  - Shopify: `https://<shop>.myshopify.com`, plus the primary domain when known.
 *  - WooCommerce: the site URL origin (the shop's `domain` is that URL's host).
 *  - Any extra origins the merchant configured (`settings.embedOrigins`, e.g. a headless storefront).
 *  - The origin of the session's `pageUrl`, but only when its host belongs to the shop (the same
 *    host, or the `www.` variant of one). `pageUrl` comes from an unauthenticated request, so a
 *    foreign origin is never trusted.
 */
import type { ShopRow } from './shops.js';

const MAX_ORIGINS = 32;

/** `scheme://host[:port]` of an http(s) URL, or null. Never keeps a path, query or fragment. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

function hostOf(origin: string): string {
  return new URL(origin).host.toLowerCase();
}

const stripWww = (host: string) => host.replace(/^www\./, '');

export function embedAllowedOrigins(shop: ShopRow, pageOrigin: string | null | undefined): string[] {
  const out = new Set<string>();
  const add = (o: string | null) => {
    if (o) out.add(o);
  };
  const domain = shop.domain.toLowerCase();
  if (domain && !domain.includes('/')) add(originOf(`https://${domain}`));
  if (shop.platform === 'shopify' && shop.settings.primaryDomain) add(originOf(`https://${shop.settings.primaryDomain}`));
  if (shop.platform === 'woocommerce') add(originOf(shop.settings.siteUrl));
  for (const o of shop.settings.embedOrigins ?? []) add(originOf(o));

  const page = originOf(pageOrigin);
  if (page && !out.has(page)) {
    const pageHost = hostOf(page);
    const known = [...out];
    // An https page on a host the shop owns (or its www. twin). Plain http only when that exact
    // origin is already allowed (handled by the `out.has` check above).
    const belongs = page.startsWith('https://') && known.some((o) => stripWww(hostOf(o)) === stripWww(pageHost));
    if (belongs) add(page);
  }
  return [...out].slice(0, MAX_ORIGINS);
}
