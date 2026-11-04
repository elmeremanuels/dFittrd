/**
 * Merchant authentication, three forms (architecture-panel "MERCHANT" + D6):
 *  1. WooCommerce plugin — `Authorization: PK-HMAC key=pk_live_…, ts=<unix seconds>, sig=<hex>`
 *     where sig = HMAC-SHA256(secret, `${METHOD}\n${request target}\n${ts}\n${sha256hex(body)}`),
 *     ±5 minutes, secret = the shop's `sk_…` key (current or previous within its 24 h grace).
 *  2. Merchant console / scripts — `Authorization: Bearer sk_live_…` (scrypt hash compare).
 *  3. Shopify embedded app — `Authorization: Bearer <session token>` (HS256 with the API secret).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { safeEqual, signMerchantRequest } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { findShopByDomain, findShopByPrefix, findShopBySecret, merchantSecrets, type ShopRow } from '../services/shops.js';
import { verifyShopifySessionToken } from './shopifySessionToken.js';
import { bearerToken } from './device.js';

export const HMAC_WINDOW_SEC = 300;

export function parseHmacHeader(h: string): { key: string; ts: string; sig: string } | null {
  const m = /^PK-HMAC\s+(.+)$/i.exec(h.trim());
  if (!m) return null;
  const parts: Record<string, string> = {};
  for (const kv of m[1]!.split(',')) {
    const i = kv.indexOf('=');
    if (i <= 0) continue;
    parts[kv.slice(0, i).trim().toLowerCase()] = kv.slice(i + 1).trim().replace(/^"|"$/g, '');
  }
  if (!parts.key || !parts.ts || !parts.sig) return null;
  return { key: parts.key, ts: parts.ts, sig: parts.sig };
}

export type MerchantAuthKind = 'hmac' | 'secret' | 'shopify';

export async function authenticateMerchant(req: FastifyRequest): Promise<{ shop: ShopRow; kind: MerchantAuthKind }> {
  const { ctx } = req.server;
  const header = req.headers.authorization;
  if (!header) throw unauthorized('merchant credentials required');

  if (/^PK-HMAC\s/i.test(header)) {
    const parsed = parseHmacHeader(header);
    if (!parsed) throw unauthorized('malformed PK-HMAC header', 'bad_signature');
    const ts = Number(parsed.ts);
    if (!Number.isFinite(ts) || Math.abs(ctx.now().getTime() / 1000 - ts) > HMAC_WINDOW_SEC) throw unauthorized('signature timestamp outside window', 'stale_signature');
    const shop = await findShopByPrefix(ctx.db, parsed.key);
    if (!shop) throw unauthorized('unknown key', 'unknown_key');
    const body = req.rawBody ?? Buffer.alloc(0);
    const target = req.raw.url ?? req.url;
    const ok = merchantSecrets(shop, ctx.env, ctx.now()).some((secret) => safeEqual(signMerchantRequest(secret, req.method, target, parsed.ts, body), parsed.sig));
    if (!ok) throw unauthorized('bad signature', 'bad_signature');
    return { shop, kind: 'hmac' };
  }

  const token = bearerToken(req);
  if (!token) throw unauthorized('unsupported authorization scheme');
  if (/^sk_(live|test)_/.test(token)) {
    const shop = await findShopBySecret(ctx.db, ctx.env, token);
    if (!shop) throw unauthorized('invalid merchant key', 'invalid_key');
    return { shop, kind: 'secret' };
  }
  if (ctx.shopify.configured()) {
    const claims = await verifyShopifySessionToken(token, ctx.env.SHOPIFY_API_KEY!, ctx.env.SHOPIFY_API_SECRET!, ctx.now());
    if (!claims) throw unauthorized('invalid session token', 'invalid_session_token');
    const shop = await findShopByDomain(ctx.db, claims.shopDomain);
    if (!shop) throw unauthorized('shop not installed — call POST /shopify/token-exchange first', 'shop_not_installed');
    return { shop, kind: 'shopify' };
  }
  throw unauthorized('invalid credentials', 'invalid_key');
}

export async function requireMerchant(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const { shop, kind } = await authenticateMerchant(req);
  if (shop.uninstalledAt) throw forbidden('shop is uninstalled', 'shop_uninstalled');
  req.shop = shop;
  req.merchantAuth = kind;
}
