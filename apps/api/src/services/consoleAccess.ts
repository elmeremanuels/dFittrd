/**
 * The one-time sign-in link into the web console (inventory S2; founder: "a one-time link from the
 * plugin") and the console session it is exchanged for.
 *
 *  - A link token is 32 random bytes. It works once and for CONSOLE_LINK_TTL_MINUTES, for the shop
 *    that asked for it and no other.
 *  - Neither token is stored: the tables keep `sha256` of it (a random 256-bit value needs no slow
 *    hash). The row is found by that hash and the stored hash is then compared in constant time.
 *  - The link carries the token in the URL fragment. A browser sends the fragment to no server, so
 *    it reaches no access log and no Referer header; the console posts it in a request body.
 *  - Spending a link is one UPDATE with its conditions in the WHERE clause, so of two exchanges at
 *    the same moment exactly one gets a session.
 *  - Every refusal of the exchange is the same answer: it does not say whether the token was
 *    unknown, used or too old.
 *  - A new shop key and an uninstall end every session and every unused link of the shop
 *    (`endConsoleAccess` in services/shops.ts): rotating the key is the remedy for a leaked key,
 *    and whoever held the old key must not keep the console.
 *  - Counting a shop's recent links and adding one happen under a lock on the shop's row, so the
 *    limit also holds for requests that arrive together.
 */
import { randomBytes } from 'node:crypto';
import { and, count, eq, gt, isNull, lt } from 'drizzle-orm';
import { CONSOLE_LINK_TTL_MINUTES, CONSOLE_SESSION_TTL_HOURS, type ConsoleLinkResponse, type ConsoleSessionResponse } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { consoleLinks, consoleSessions, shops } from '../db/schema.js';
import { HttpError, unauthorized } from '../lib/errors.js';
import { safeEqual, sha256Hex } from '../lib/crypto.js';
import { findShopById, type ShopRow } from './shops.js';

export const CONSOLE_LINK_TTL_MS = CONSOLE_LINK_TTL_MINUTES * 60_000;
export const CONSOLE_SESSION_TTL_MS = CONSOLE_SESSION_TTL_HOURS * 3_600_000;
/** At most this many links per shop in any CONSOLE_LINK_WINDOW_MS. */
export const CONSOLE_LINK_MAX_PER_WINDOW = 5;
export const CONSOLE_LINK_WINDOW_MS = 10 * 60_000;
/** Spent and expired rows are kept this long (the rate limit counts them), then removed. */
const KEEP_MS = 24 * 3_600_000;

const LINK_PREFIX = 'cl_';
export const CONSOLE_SESSION_PREFIX = 'cs_';
/** The console page that exchanges the token (apps/web router). */
export const CONSOLE_LINK_PATH = '/merchant/link';

const newToken = (prefix: string): string => prefix + randomBytes(32).toString('base64url');
export const consoleLinkHash = (token: string): string => sha256Hex(`console-link:${token}`);
export const consoleSessionHash = (token: string): string => sha256Hex(`console-session:${token}`);

/** The same refusal for an unknown, a used and an expired link. */
const refusedLink = (): HttpError => unauthorized('this sign-in link is not valid: it was used, it is older than 10 minutes, or it is not a Curtain link', 'invalid_console_link');

export async function mintConsoleLink(input: { db: Db; shop: ShopRow; appUrl: string; now: Date }): Promise<ConsoleLinkResponse> {
  const { db, shop, now } = input;
  // Housekeeping first, so the tables stay as small as the shops' recent use.
  const old = new Date(now.getTime() - KEEP_MS);
  await db.delete(consoleLinks).where(and(eq(consoleLinks.shopId, shop.id), lt(consoleLinks.createdAt, old)));
  await db.delete(consoleSessions).where(and(eq(consoleSessions.shopId, shop.id), lt(consoleSessions.expiresAt, old)));

  const token = newToken(LINK_PREFIX);
  const expiresAt = new Date(now.getTime() + CONSOLE_LINK_TTL_MS);
  await db.transaction(async (tx) => {
    // The shop's row is the lock: a second request for the same shop waits here until this one
    // has written its link, so the count below sees it. Another shop is not held up.
    await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, shop.id)).for('update');
    const [recent] = await tx
      .select({ n: count() })
      .from(consoleLinks)
      .where(and(eq(consoleLinks.shopId, shop.id), gt(consoleLinks.createdAt, new Date(now.getTime() - CONSOLE_LINK_WINDOW_MS))));
    if ((recent?.n ?? 0) >= CONSOLE_LINK_MAX_PER_WINDOW) {
      throw new HttpError(429, 'rate_limited', `too many sign-in links for this shop: at most ${CONSOLE_LINK_MAX_PER_WINDOW} in ${CONSOLE_LINK_WINDOW_MS / 60_000} minutes`);
    }
    await tx.insert(consoleLinks).values({ shopId: shop.id, tokenHash: consoleLinkHash(token), createdAt: now, expiresAt });
  });
  return { url: `${input.appUrl.replace(/\/+$/, '')}${CONSOLE_LINK_PATH}#t=${token}`, expiresAt: expiresAt.toISOString() };
}

export async function exchangeConsoleLink(input: { db: Db; token: string; now: Date }): Promise<ConsoleSessionResponse> {
  const { db, now } = input;
  const hash = consoleLinkHash(input.token);
  // One statement spends the link: unused and not expired are conditions of the write itself.
  const [link] = await db
    .update(consoleLinks)
    .set({ usedAt: now })
    .where(and(eq(consoleLinks.tokenHash, hash), isNull(consoleLinks.usedAt), gt(consoleLinks.expiresAt, now)))
    .returning();
  if (!link || !safeEqual(link.tokenHash, hash)) throw refusedLink();
  const shop = await findShopById(db, link.shopId);
  if (!shop || shop.uninstalledAt) throw refusedLink();

  const sessionToken = newToken(CONSOLE_SESSION_PREFIX);
  const expiresAt = new Date(now.getTime() + CONSOLE_SESSION_TTL_MS);
  await db.insert(consoleSessions).values({ shopId: shop.id, tokenHash: consoleSessionHash(sessionToken), createdAt: now, expiresAt });
  return { sessionToken, expiresAt: expiresAt.toISOString(), shopName: shop.name };
}

/** The shop of a live console session, or undefined (unknown, signed out, expired). */
export async function findShopByConsoleSession(db: Db, token: string, now: Date): Promise<ShopRow | undefined> {
  const hash = consoleSessionHash(token);
  const session = await db.query.consoleSessions.findFirst({ where: and(eq(consoleSessions.tokenHash, hash), isNull(consoleSessions.revokedAt), gt(consoleSessions.expiresAt, now)) });
  if (!session || !safeEqual(session.tokenHash, hash)) return undefined;
  return findShopById(db, session.shopId);
}

/** "Sign out": the session token stops working at once. */
export async function revokeConsoleSession(db: Db, token: string, now: Date): Promise<void> {
  await db
    .update(consoleSessions)
    .set({ revokedAt: now })
    .where(and(eq(consoleSessions.tokenHash, consoleSessionHash(token)), isNull(consoleSessions.revokedAt)));
}
