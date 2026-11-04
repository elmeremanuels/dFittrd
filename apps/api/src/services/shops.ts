import { and, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { shops, type Plan, type ShopSettings } from '../db/schema.js';
import type { Env } from '../env.js';
import {
  decryptString,
  encryptString,
  hashSecret,
  hmacHex,
  newMerchantKeyPair,
  sha256Hex,
  verifySecret,
  type KeyMode,
  type MerchantKeyPair,
} from '../lib/crypto.js';
import { DAY } from '../lib/time.js';
import { planSpec } from '../billing/plans.js';

export type ShopRow = typeof shops.$inferSelect;

export const keyMode = (env: Env): KeyMode => (env.NODE_ENV === 'production' ? 'live' : 'test');

export async function findShopByPrefix(db: Db, prefix: string): Promise<ShopRow | undefined> {
  return db.query.shops.findFirst({ where: eq(shops.apiKeyPrefix, prefix) });
}

export async function findShopByDomain(db: Db, domain: string): Promise<ShopRow | undefined> {
  return db.query.shops.findFirst({ where: eq(shops.domain, domain.toLowerCase()) });
}

export async function findShopById(db: Db, id: string): Promise<ShopRow | undefined> {
  return db.query.shops.findFirst({ where: eq(shops.id, id) });
}

export interface CreateShopInput {
  platform: 'shopify' | 'woocommerce';
  domain: string;
  name: string;
  plan?: Plan;
  settings?: ShopSettings;
}

export async function createShop(db: Db, input: CreateShopInput): Promise<ShopRow> {
  const [row] = await db
    .insert(shops)
    .values({
      platform: input.platform,
      domain: input.domain.toLowerCase(),
      name: input.name,
      plan: input.plan ?? 'free',
      settings: input.settings ?? {},
      periodStart: new Date().toISOString().slice(0, 10),
    })
    .returning();
  return row!;
}

/**
 * Deterministic, indexed lookup value for a secret key: HMAC-SHA256(pepper, key). The key itself
 * has ~285 bits of entropy, so this is safe to store; it only exists so `Bearer sk_…` auth costs
 * one indexed row fetch + one scrypt instead of scrypt over every shop.
 */
export function merchantKeyLookup(secret: string, pepper: string): string {
  return hmacHex(pepper, `merchant-key:${secret}`);
}

/** Issues (or rotates) the merchant key pair. The public prefix stays stable across rotations. */
export async function issueMerchantKeys(db: Db, env: Env, shop: ShopRow): Promise<{ keys: MerchantKeyPair; previousKeyValidUntil: Date }> {
  const keys = newMerchantKeyPair(keyMode(env), shop.apiKeyPrefix ?? undefined);
  const previousKeyValidUntil = new Date(Date.now() + DAY);
  await db
    .update(shops)
    .set({
      apiKeyPrefix: keys.publicKeyPrefix,
      apiKeyHash: hashSecret(keys.apiKey, env.SHOP_KEY_PEPPER),
      apiKeyEnc: encryptString(keys.apiKey, env.ENCRYPTION_KEY),
      apiKeyLookup: merchantKeyLookup(keys.apiKey, env.SHOP_KEY_PEPPER),
      previousKeyHash: shop.apiKeyHash,
      previousKeyEnc: shop.apiKeyEnc,
      previousKeyLookup: shop.apiKeyHash ? shop.apiKeyLookup : null,
      previousKeyValidUntil: shop.apiKeyHash ? previousKeyValidUntil : null,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));
  return { keys, previousKeyValidUntil };
}

/**
 * Fills `api_key_lookup` / `previous_key_lookup` for rows issued before migration 0001 (the
 * plaintext is recoverable from the AES-GCM copy). Runs at server start; a no-op afterwards.
 */
export async function backfillKeyLookups(db: Db, env: Env): Promise<number> {
  const rows = await db
    .select()
    .from(shops)
    .where(or(and(isNotNull(shops.apiKeyEnc), isNull(shops.apiKeyLookup)), and(isNotNull(shops.previousKeyEnc), isNull(shops.previousKeyLookup))));
  let n = 0;
  for (const shop of rows) {
    const patch: Partial<typeof shops.$inferInsert> = {};
    if (shop.apiKeyEnc && !shop.apiKeyLookup) patch.apiKeyLookup = merchantKeyLookup(decryptString(shop.apiKeyEnc, env.ENCRYPTION_KEY), env.SHOP_KEY_PEPPER);
    if (shop.previousKeyEnc && !shop.previousKeyLookup) patch.previousKeyLookup = merchantKeyLookup(decryptString(shop.previousKeyEnc, env.ENCRYPTION_KEY), env.SHOP_KEY_PEPPER);
    if (Object.keys(patch).length === 0) continue;
    await db.update(shops).set(patch).where(eq(shops.id, shop.id));
    n++;
  }
  return n;
}

/** Secrets usable for HMAC verification right now: current + previous within its grace window. */
export function merchantSecrets(shop: ShopRow, env: Env, now = new Date()): string[] {
  const out: string[] = [];
  if (shop.apiKeyEnc) out.push(decryptString(shop.apiKeyEnc, env.ENCRYPTION_KEY));
  if (shop.previousKeyEnc && shop.previousKeyValidUntil && shop.previousKeyValidUntil > now) {
    out.push(decryptString(shop.previousKeyEnc, env.ENCRYPTION_KEY));
  }
  return out;
}

export function verifyMerchantBearer(shop: ShopRow, secret: string, env: Env, now = new Date()): boolean {
  if (verifySecret(secret, shop.apiKeyHash, env.SHOP_KEY_PEPPER)) return true;
  if (shop.previousKeyValidUntil && shop.previousKeyValidUntil > now && verifySecret(secret, shop.previousKeyHash, env.SHOP_KEY_PEPPER)) return true;
  return false;
}

export async function findShopBySecret(db: Db, env: Env, secret: string, now = new Date()): Promise<ShopRow | undefined> {
  // Bearer sk_ keys do not carry the prefix: resolve the row through the indexed HMAC lookup, then
  // confirm with the scrypt hash. Never scan the table — scrypt per shop per request is a CPU DoS.
  const lookup = merchantKeyLookup(secret, env.SHOP_KEY_PEPPER);
  const candidates = await db
    .select()
    .from(shops)
    .where(or(eq(shops.apiKeyLookup, lookup), eq(shops.previousKeyLookup, lookup)))
    .limit(2);
  return candidates.find((s) => verifyMerchantBearer(s, secret, env, now));
}

export function shopBranding(shop: ShopRow) {
  return {
    id: shop.id,
    name: shop.name,
    ...(shop.settings.brandColor ? { brandColor: shop.settings.brandColor } : {}),
    ...(shop.settings.logoUrl ? { logoUrl: shop.settings.logoUrl } : {}),
    platform: shop.platform,
    paused: isPaused(shop),
  };
}

export function isPaused(shop: ShopRow): boolean {
  return shop.paused || shop.uninstalledAt !== null;
}

export function planInfo(shop: ShopRow) {
  return planSpec(shop.plan, {
    includedSessions: shop.settings.includedSessions,
    overageEurPerSession: shop.settings.overageEurPerSession,
  });
}

export async function updateSettings(db: Db, shopId: string, patch: Partial<ShopSettings>, extra: Partial<typeof shops.$inferInsert> = {}): Promise<ShopRow> {
  const current = await findShopById(db, shopId);
  const settings = { ...(current?.settings ?? {}), ...compact(patch) };
  const [row] = await db
    .update(shops)
    .set({ settings, updatedAt: new Date(), ...extra })
    .where(eq(shops.id, shopId))
    .returning();
  return row!;
}

function compact<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** WooCommerce Connect token (D6): random, stored hashed, 1 h validity. */
export function connectTokenHash(token: string): string {
  return sha256Hex(`connect:${token}`);
}

export async function findShopByConnectToken(db: Db, token: string): Promise<ShopRow | undefined> {
  return db.query.shops.findFirst({
    where: and(eq(shops.connectTokenHash, connectTokenHash(token)), gt(shops.connectTokenExpiresAt, new Date())),
  });
}
