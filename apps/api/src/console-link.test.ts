/**
 * The one-time sign-in link into the web console (inventory S2): `POST /v1/merchant/console-link`,
 * `POST /v1/merchant/console-session`, the `cs_…` session and `DELETE /v1/merchant/console-session`.
 * The security points: single use, expiry, bound to the shop, a hash at rest, no token in the log,
 * the token in the URL fragment only, constant-time compare, a rate limit per shop.
 */
import { readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CONSOLE_LINK_TTL_MINUTES, CONSOLE_SESSION_TTL_HOURS, ConsoleLinkResponseSchema, ConsoleSessionResponseSchema } from '@curtain/schema';
import { resetReplayCache } from './auth/merchant.js';
import { consoleLinks, consoleSessions, shops } from './db/schema.js';
import { sha256Hex, signMerchantRequest } from './lib/crypto.js';
import { CONSOLE_LINK_MAX_PER_WINDOW, consoleLinkHash, consoleSessionHash } from './services/consoleAccess.js';
import { makeApp, seedShop, type TestApp } from './test/helpers.js';
import { eq } from 'drizzle-orm';

const API_KEY = 'shpa_testkey';
const API_SECRET = 'shpss' + '_test_secret_0123456789';
const SHOPIFY_DOMAIN = 'console-link.myshopify.com';
const T0 = Date.parse('2026-11-20T10:00:00Z');
const MIN = 60_000;

describe('one-time sign-in link into the console', () => {
  let t: TestApp;
  let a: Awaited<ReturnType<typeof seedShop>>;
  let b: Awaited<ReturnType<typeof seedShop>>;
  let clock = T0;
  const logLines: string[] = [];
  let ip = 0;

  /** The plugin's own credentials: a PK-HMAC signature over the request. */
  const hmac = (s: { apiKey: string; publicKeyPrefix: string }, method: string, url: string, body = '') => {
    const ts = String(Math.floor(clock / 1000));
    return { authorization: `PK-HMAC key=${s.publicKeyPrefix}, ts=${ts}, sig=${signMerchantRequest(s.apiKey, method, url, ts, body)}` };
  };
  // A second later each time: the same signed request is accepted once (the replay guard).
  const mint = (s: { apiKey: string; publicKeyPrefix: string }) => {
    clock += 1000;
    return t.app.inject({ method: 'POST', url: '/v1/merchant/console-link', headers: hmac(s, 'POST', '/v1/merchant/console-link') });
  };
  const tokenOf = (url: string): string => new URL(url).hash.replace(/^#t=/, '');
  const mintToken = async (s: { apiKey: string; publicKeyPrefix: string }): Promise<string> => {
    const res = await mint(s);
    expect(res.statusCode, res.body).toBe(200);
    return tokenOf(res.json<{ url: string }>().url);
  };
  // A new client address per exchange, so the per-address limit of the route is not what a test meets.
  const exchange = (token: unknown) => t.app.inject({ method: 'POST', url: '/v1/merchant/console-session', payload: { token }, remoteAddress: `198.51.100.${(ip = (ip % 250) + 1)}` });
  const session = async (s: { apiKey: string; publicKeyPrefix: string }): Promise<string> => {
    const res = await exchange(await mintToken(s));
    expect(res.statusCode, res.body).toBe(200);
    return res.json<{ sessionToken: string }>().sessionToken;
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const settings = (token: string) => t.app.inject({ method: 'GET', url: '/v1/merchant/settings', headers: bearer(token) });

  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET, LOG_LEVEL: 'trace' }, { now: () => new Date(clock), logStream: { write: (l) => void logLines.push(l) } });
    a = await seedShop(t, { domain: 'shop-a.example', name: 'Shop A', products: [] });
    b = await seedShop(t, { domain: 'shop-b.example', name: 'Shop B', products: [] });
    await seedShop(t, { platform: 'shopify', domain: SHOPIFY_DOMAIN, name: 'Shopify Shop', products: [] });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    // Each test starts a day later: outside every earlier link's life and rate-limit window.
    clock += 24 * 60 * MIN;
    resetReplayCache();
  });

  describe('asking for a link', () => {
    it('gives the plugin (PK-HMAC) a link to the console page with the token in the fragment only, good for 10 minutes', async () => {
      const res = await mint(a);
      expect(res.statusCode, res.body).toBe(200);
      const body = ConsoleLinkResponseSchema.parse(res.json());
      const url = new URL(body.url);
      expect(url.origin + url.pathname).toBe(`${t.env.PUBLIC_APP_URL}/merchant/link`);
      // Nothing of the token is in what a browser sends to a server.
      expect(url.search).toBe('');
      expect(url.hash).toMatch(/^#t=cl_[A-Za-z0-9_-]{43}$/);
      expect(Date.parse(body.expiresAt) - clock).toBe(CONSOLE_LINK_TTL_MINUTES * MIN);
      expect(CONSOLE_LINK_TTL_MINUTES).toBe(10);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('needs the shop\'s credentials', async () => {
      const none = await t.app.inject({ method: 'POST', url: '/v1/merchant/console-link' });
      expect(none.statusCode).toBe(401);
      const forged = await t.app.inject({ method: 'POST', url: '/v1/merchant/console-link', headers: hmac({ ...a, apiKey: 'sk_' + 'test_' + 'x'.repeat(48) }, 'POST', '/v1/merchant/console-link') });
      expect(forged.statusCode).toBe(401);
      expect(forged.json().error.code).toBe('bad_signature');
    });

    it('accepts one signed request once: a captured request cannot be sent again for a second link', async () => {
      const headers = hmac(a, 'POST', '/v1/merchant/console-link');
      expect((await t.app.inject({ method: 'POST', url: '/v1/merchant/console-link', headers })).statusCode).toBe(200);
      const again = await t.app.inject({ method: 'POST', url: '/v1/merchant/console-link', headers });
      expect(again.statusCode).toBe(401);
      expect(again.json().error.code).toBe('replayed_signature');
    });

    it('gives two different tokens for two requests', async () => {
      expect(await mintToken(a)).not.toBe(await mintToken(a));
    });

    it(`limits a shop to ${CONSOLE_LINK_MAX_PER_WINDOW} links in ten minutes, and another shop is not affected`, async () => {
      for (let i = 0; i < CONSOLE_LINK_MAX_PER_WINDOW; i++) {
        expect((await mint(a)).statusCode, `link ${i + 1}`).toBe(200);
      }
      const refused = await mint(a);
      expect(refused.statusCode).toBe(429);
      expect(refused.json().error.code).toBe('rate_limited');
      expect(refused.body).not.toContain('cl_');
      expect((await mint(b)).statusCode).toBe(200);
      // Ten minutes after the first of them the shop may ask again.
      clock += 10 * MIN;
      expect((await mint(a)).statusCode).toBe(200);
    });

    it('serves the Shopify admin too: a session token gets a link for its own shop', async () => {
      const jwt = await new SignJWT({ iss: `https://${SHOPIFY_DOMAIN}/admin`, dest: `https://${SHOPIFY_DOMAIN}`, sub: '42', sid: 'sid-1' })
        .setProtectedHeader({ alg: 'HS256' })
        .setAudience(API_KEY)
        .setIssuedAt(Math.floor(clock / 1000))
        .setNotBefore(Math.floor(clock / 1000) - 1)
        .setExpirationTime(Math.floor(clock / 1000) + 60)
        .setJti(`jti-${Math.random()}`)
        .sign(new TextEncoder().encode(API_SECRET));
      const res = await t.app.inject({ method: 'POST', url: '/v1/merchant/console-link', headers: bearer(jwt) });
      expect(res.statusCode, res.body).toBe(200);
      const ex = await exchange(tokenOf(res.json<{ url: string }>().url));
      expect(ex.json()).toMatchObject({ shopName: 'Shopify Shop' });
      expect((await settings(ex.json<{ sessionToken: string }>().sessionToken)).json()).toMatchObject({ platform: 'shopify', shopName: 'Shopify Shop' });
    });
  });

  describe('exchanging the link', () => {
    it('gives a console session for the shop that asked, and for no other shop', async () => {
      const res = await exchange(await mintToken(a));
      expect(res.statusCode, res.body).toBe(200);
      const body = ConsoleSessionResponseSchema.parse(res.json());
      expect(body.shopName).toBe('Shop A');
      expect(Date.parse(body.expiresAt) - clock).toBe(CONSOLE_SESSION_TTL_HOURS * 60 * MIN);
      expect(res.headers['cache-control']).toBe('no-store');
      // The session reads shop A's data: what the console asks for when it opens.
      const own = await settings(body.sessionToken);
      expect(own.statusCode, own.body).toBe(200);
      expect(own.json()).toMatchObject({ shopName: 'Shop A', platform: 'woocommerce' });
      for (const url of ['/v1/merchant/products', '/v1/merchant/ledger', '/v1/merchant/setup', '/v1/merchant/usage?from=2026-11-01&to=2026-11-20']) {
        expect((await t.app.inject({ method: 'GET', url, headers: bearer(body.sessionToken) })).statusCode, url).toBe(200);
      }
      // A change through the session lands on shop A's row and on no other.
      const put = await t.app.inject({ method: 'PUT', url: '/v1/merchant/settings', headers: bearer(body.sessionToken), payload: { showFitByCurtain: false } });
      expect(put.statusCode, put.body).toBe(200);
      expect((await settings(a.apiKey)).json().showFitByCurtain).toBe(false);
      expect((await settings(b.apiKey)).json().showFitByCurtain).toBe(true);
    });

    it('works once: the second exchange of the same link gets no session', async () => {
      const token = await mintToken(a);
      expect((await exchange(token)).statusCode).toBe(200);
      const second = await exchange(token);
      expect(second.statusCode).toBe(401);
      expect(second.json()).toEqual({ error: { code: 'invalid_console_link', message: expect.any(String) } });
      expect(second.body).not.toContain('sessionToken');
    });

    it('works once also when two exchanges arrive at the same moment', async () => {
      const token = await mintToken(a);
      const results = await Promise.all(Array.from({ length: 6 }, () => exchange(token)));
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 401)).toHaveLength(5);
      expect(await t.handle.db.select().from(consoleSessions).where(eq(consoleSessions.createdAt, new Date(clock)))).toHaveLength(1);
    });

    it('works for 10 minutes and not a second longer', async () => {
      const inTime = await mintToken(a);
      clock += CONSOLE_LINK_TTL_MINUTES * MIN - 1000;
      expect((await exchange(inTime)).statusCode).toBe(200);
      const late = await mintToken(a);
      clock += CONSOLE_LINK_TTL_MINUTES * MIN;
      const res = await exchange(late);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('invalid_console_link');
      // An expired link is not spent by the attempt, and stays refused.
      expect((await exchange(late)).statusCode).toBe(401);
    });

    it('answers an unknown, a used and an expired token with the same words', async () => {
      const used = await mintToken(a);
      await exchange(used);
      const old = await mintToken(a);
      clock += 11 * MIN;
      const answers = await Promise.all([exchange('cl_' + 'x'.repeat(43)), exchange(used), exchange(old)]);
      expect(answers.map((r) => r.statusCode)).toEqual([401, 401, 401]);
      expect(new Set(answers.map((r) => r.body)).size).toBe(1);
    });

    it('refuses anything that is not a token, without a session', async () => {
      for (const token of ['', 'short', 'x'.repeat(200), 42, null]) {
        const res = await exchange(token);
        expect(res.statusCode, String(token)).toBe(400);
      }
      expect((await t.app.inject({ method: 'POST', url: '/v1/merchant/console-session', payload: { token: 'cl_' + 'y'.repeat(43), shopId: a.shop.id } })).statusCode).toBe(400);
      // A session token is not a link token, and a link token is not a session.
      const s = await session(a);
      expect((await exchange(s)).statusCode).toBe(401);
      expect((await settings(await mintToken(a))).statusCode).toBe(401);
    });

    it('gives no session for a shop that uninstalled after asking', async () => {
      const token = await mintToken(b);
      await t.handle.db.update(shops).set({ uninstalledAt: new Date(clock) }).where(eq(shops.id, b.shop.id));
      try {
        expect((await exchange(token)).statusCode).toBe(401);
      } finally {
        await t.handle.db.update(shops).set({ uninstalledAt: null }).where(eq(shops.id, b.shop.id));
      }
    });

    it('limits how often one address may try', async () => {
      let last = 200;
      for (let i = 0; i < 25 && last !== 429; i++) {
        last = (await t.app.inject({ method: 'POST', url: '/v1/merchant/console-session', payload: { token: 'cl_' + 'z'.repeat(43) }, remoteAddress: '203.0.113.77' })).statusCode;
      }
      expect(last).toBe(429);
    });
  });

  describe('the console session', () => {
    it('ends by itself after 12 hours', async () => {
      const s = await session(a);
      clock += CONSOLE_SESSION_TTL_HOURS * 60 * MIN - 1000;
      expect((await settings(s)).statusCode).toBe(200);
      clock += 1000;
      const res = await settings(s);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('invalid_console_session');
    });

    it('ends at once on "Sign out", and only that session', async () => {
      const one = await session(a);
      const two = await session(a);
      const out = await t.app.inject({ method: 'DELETE', url: '/v1/merchant/console-session', headers: bearer(one) });
      expect(out.statusCode, out.body).toBe(200);
      expect((await settings(one)).statusCode).toBe(401);
      expect((await settings(two)).statusCode).toBe(200);
    });

    it('cannot replace the shop\'s key or ask for another link', async () => {
      const s = await session(a);
      for (const url of ['/v1/merchant/keys/rotate', '/v1/merchant/console-link']) {
        const res = await t.app.inject({ method: 'POST', url, headers: bearer(s) });
        expect(res.statusCode, url).toBe(403);
        expect(res.json().error.code).toBe('console_session_not_allowed');
      }
      // The plugin's key still works: nothing was rotated.
      expect((await settings(a.apiKey)).statusCode).toBe(200);
    });

    it('is refused for an uninstalled shop', async () => {
      const s = await session(b);
      await t.handle.db.update(shops).set({ uninstalledAt: new Date(clock) }).where(eq(shops.id, b.shop.id));
      try {
        expect((await settings(s)).statusCode).toBe(403);
      } finally {
        await t.handle.db.update(shops).set({ uninstalledAt: null }).where(eq(shops.id, b.shop.id));
      }
    });

    it('is not accepted when made up', async () => {
      expect((await settings('cs_' + 'q'.repeat(43))).statusCode).toBe(401);
    });
  });

  describe('at rest and in the log', () => {
    it('stores a hash of each token, never the token', async () => {
      const link = await mintToken(a);
      const res = await exchange(link);
      const sessionToken = res.json<{ sessionToken: string }>().sessionToken;
      const dump = JSON.stringify({ links: await t.handle.db.select().from(consoleLinks), sessions: await t.handle.db.select().from(consoleSessions), shops: await t.handle.db.select().from(shops) });
      expect(dump).not.toContain(link);
      expect(dump).not.toContain(link.slice(3));
      expect(dump).not.toContain(sessionToken);
      expect(dump).not.toContain(sessionToken.slice(3));
      // What is stored is a sha256, and not the bare sha256 of the token either.
      const row = (await t.handle.db.select().from(consoleLinks).where(eq(consoleLinks.tokenHash, consoleLinkHash(link))))[0]!;
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.tokenHash).not.toBe(sha256Hex(link));
      expect(row.shopId).toBe(a.shop.id);
      expect(row.usedAt).toEqual(new Date(clock));
      expect(await t.handle.db.select().from(consoleSessions).where(eq(consoleSessions.tokenHash, consoleSessionHash(sessionToken)))).toHaveLength(1);
    });

    it('writes no token to the log, at the most talkative log level', async () => {
      logLines.length = 0;
      const link = await mintToken(a);
      const res = await exchange(link);
      const sessionToken = res.json<{ sessionToken: string }>().sessionToken;
      await exchange(link); // a refusal
      await settings(sessionToken);
      await t.app.inject({ method: 'DELETE', url: '/v1/merchant/console-session', headers: bearer(sessionToken) });
      await settings(sessionToken); // a refused session
      const log = logLines.join('');
      // The requests were logged: the check below is not about an empty log.
      expect(log).toContain('/v1/merchant/console-session');
      expect(log).toContain('/v1/merchant/console-link');
      for (const secret of [link, link.slice(3), sessionToken, sessionToken.slice(3), consoleLinkHash(link), consoleSessionHash(sessionToken)]) expect(log).not.toContain(secret);
    });

    it('compares the stored hash in constant time, after finding the row by the hash', () => {
      const src = readFileSync(new URL('./services/consoleAccess.ts', import.meta.url), 'utf8');
      // Both lookups end in safeEqual (crypto.timingSafeEqual); no `===` on a token or a hash.
      expect(src.match(/safeEqual\((link|session)\.tokenHash, hash\)/g)).toHaveLength(2);
      expect(src).not.toMatch(/(token|hash|tokenHash)\s*[!=]==/i);
    });

    it('removes a shop\'s links and sessions with the shop', async () => {
      const gone = await seedShop(t, { domain: 'gone.example', products: [] });
      await session(gone);
      await t.handle.db.delete(shops).where(eq(shops.id, gone.shop.id));
      expect(await t.handle.db.select().from(consoleLinks).where(eq(consoleLinks.shopId, gone.shop.id))).toHaveLength(0);
      expect(await t.handle.db.select().from(consoleSessions).where(eq(consoleSessions.shopId, gone.shop.id))).toHaveLength(0);
    });

    it('clears rows older than a day when the shop asks for a new link', async () => {
      await mintToken(a);
      await mintToken(a);
      const before = (await t.handle.db.select().from(consoleLinks).where(eq(consoleLinks.shopId, a.shop.id))).length;
      expect(before).toBeGreaterThan(1);
      clock += 25 * 60 * MIN;
      await mintToken(a);
      expect(await t.handle.db.select().from(consoleLinks).where(eq(consoleLinks.shopId, a.shop.id))).toHaveLength(1);
    });
  });
});
