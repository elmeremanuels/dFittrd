import { and, eq, gt, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { shops, type Plan, type ShopSettings } from '../db/schema.js';
import type { Env } from '../env.js';
import {
  decryptString,
  encryptString,
  hashSecret,
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
      previousKeyHash: shop.apiKeyHash,
      previousKeyEnc: shop.apiKeyEnc,
      previousKeyValidUntil: shop.apiKeyHash ? previousKeyValidUntil : null,
      updatedAt: new Date(),
    })
    .where(eq(shops.id, shop.id));
  return { keys, previousKeyValidUntil };
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

export async function findShopBySecret(db: Db, env: Env, secret: string): Promise<ShopRow | undefined> {
  // Bearer sk_ keys do not carry the prefix; scan candidates with a key set (small table, indexed by prefix).
  const candidates = await db
    .select()
    .from(shops)
    .where(or(gt(shops.apiKeyHash, ''), gt(shops.previousKeyHash, '')));
  return candidates.find((s) => verifyMerchantBearer(s, secret, env));
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
