/**
 * Expiring offline access tokens (App Store 3.1.2, checklist A3) against mocked Shopify endpoints:
 * token exchange with `expiring=1`, encrypted refresh token storage, refresh before expiry and on a
 * 401, rotation, terminal and transient failures, serialisation per shop, the dormant-shop job and
 * the migration of a stored non-expiring token.
 * Docs (read 2026-11-06):
 *  https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 *  https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange#refresh-an-expiring-offline-token
 *  https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
 */
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { shopifySessions } from '../db/schema.js';
import { CRON } from '../jobs/index.js';
import { JOB } from '../jobs/queue.js';
import { json, makeApp, seedShop, type TestApp } from '../test/helpers.js';
import { ShopifyClient } from './client.js';

const API_KEY = 'shpa_tokenskey';
const API_SECRET = 'shpss' + '_test_tokens_0123456789';
const AT = (n: number) => 'shp' + `at_expiring_${n}`;
const RT = (n: number) => 'shp' + `rt_refresh_${n}`;
const LEGACY = 'shp' + 'at_non_expiring';
const HOUR = 3_600_000;

async function sessionToken(shop: string) {
  return new SignJWT({ iss: `https://${shop}/admin`, dest: `https://${shop}`, sub: '42', sid: 'sid-1' })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(API_KEY)
    .setIssuedAt()
    .setNotBefore('0s')
    .setExpirationTime('1m')
    .setJti(`jti-${Math.random()}`)
    .sign(new TextEncoder().encode(API_SECRET));
}

const form = (init?: RequestInit) => Object.fromEntries(new URLSearchParams(String(init?.body)));
const tokenReply = (n: number, over: Record<string, unknown> = {}) => json({ access_token: AT(n), scope: 'read_products,write_products', expires_in: 3600, refresh_token: RT(n), refresh_token_expires_in: 7_776_000, ...over });

describe('expiring offline tokens (A3)', () => {
  let t: TestApp;
  let clock: Date;
  let client: ShopifyClient;
  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    t.fetchMock.reset();
    clock = new Date('2026-11-06T10:00:00Z');
    client = new ShopifyClient(t.env, t.handle.db, t.fetchMock.fetch, undefined, () => clock);
  });

  async function shopWithSession(domain: string, n = 1) {
    const { shop } = await seedShop(t, { platform: 'shopify', domain, products: [] });
    await client.saveOfflineSession(shop.id, domain, AT(n), 'read_products', { expiresIn: 3600, refreshToken: RT(n), refreshTokenExpiresIn: 7_776_000 });
    return shop;
  }

  it('token exchange asks for an expiring token and stores the refresh token encrypted with both expiries', async () => {
    const domain = 'exchange.myshopify.com';
    const { shop } = await seedShop(t, { platform: 'shopify', domain, products: [] });
    let body: Record<string, unknown> = {};
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, (_u, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return tokenReply(1);
    });
    t.fetchMock.on(`https://${domain}/admin/api/`, () => json({ errors: [{ message: 'not needed' }] }, 400));
    const res = await t.app.inject({ method: 'POST', url: '/shopify/token-exchange', payload: { shop: domain, sessionToken: await sessionToken(domain) } });
    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ expiring: '1', requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token' });

    const row = (await t.handle.db.query.shopifySessions.findFirst({ where: eq(shopifySessions.shopId, shop.id) }))!;
    expect(row.refreshTokenEnc).toBeTruthy();
    expect(row.refreshTokenEnc).not.toContain(RT(1));
    expect(row.accessTokenEnc).not.toContain(AT(1));
    expect(row.expiresAt!.getTime() - row.updatedAt.getTime()).toBe(3600 * 1000);
    expect(row.refreshTokenExpiresAt!.getTime() - row.updatedAt.getTime()).toBe(7_776_000 * 1000);
    const s = await t.app.ctx.shopify.offlineSession(domain);
    expect(s).toMatchObject({ accessToken: AT(1), refreshToken: RT(1) });
  });

  it('SHOPIFY_EXPIRING_OFFLINE_TOKENS=0 sends no expiring flag', async () => {
    const t2 = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET, SHOPIFY_EXPIRING_OFFLINE_TOKENS: '0' });
    try {
      let body: Record<string, unknown> = {};
      t2.fetchMock.on('https://flag-off.myshopify.com/admin/oauth/access_token', (_u, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json({ access_token: LEGACY, scope: 'read_products' });
      });
      await t2.app.ctx.shopify.tokenExchange('flag-off.myshopify.com', 'id.token');
      expect(body.expiring).toBeUndefined();
    } finally {
      await t2.close();
    }
  });

  it('a valid token is used as is; within the margin it is refreshed with the form grant and the rotated pair is stored', async () => {
    const domain = 'margin.myshopify.com';
    await shopWithSession(domain);
    const calls: Array<Record<string, string>> = [];
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, (_u, init) => {
      calls.push(form(init));
      return tokenReply(2);
    });
    clock = new Date(clock.getTime() + 30 * 60_000);
    expect(await client.accessTokenFor(domain)).toBe(AT(1));
    expect(calls).toHaveLength(0);

    clock = new Date(clock.getTime() + 26 * 60_000); // 4 minutes left, margin is 5
    expect(await client.accessTokenFor(domain)).toBe(AT(2));
    expect(calls).toEqual([{ client_id: API_KEY, client_secret: API_SECRET, grant_type: 'refresh_token', refresh_token: RT(1) }]);
    const s = (await client.offlineSession(domain))!;
    expect(s).toMatchObject({ accessToken: AT(2), refreshToken: RT(2) });
    expect(s.expiresAt!.getTime()).toBe(clock.getTime() + HOUR);
    const row = (await t.handle.db.query.shopifySessions.findFirst({ where: eq(shopifySessions.shopDomain, domain) }))!;
    expect(row.refreshedAt?.getTime()).toBe(clock.getTime());
  });

  it('concurrent callers share one refresh (never two grants with the same refresh token)', async () => {
    const domain = 'concurrent.myshopify.com';
    await shopWithSession(domain);
    let grants = 0;
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, async () => {
      grants++;
      await new Promise((r) => setTimeout(r, 20));
      return tokenReply(2);
    });
    clock = new Date(clock.getTime() + HOUR + 1);
    const tokens = await Promise.all([client.accessTokenFor(domain), client.accessTokenFor(domain), client.accessTokenFor(domain)]);
    expect(tokens).toEqual([AT(2), AT(2), AT(2)]);
    expect(grants).toBe(1);
  });

  it('token exchange and refresh for one shop never overlap', async () => {
    const domain = 'serial.myshopify.com';
    await shopWithSession(domain);
    const log: string[] = [];
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, async (_u, init) => {
      const kind = String(init?.body).includes('refresh_token') && !String(init?.body).includes('subject_token') ? 'refresh' : 'exchange';
      log.push(`${kind}:start`);
      await new Promise((r) => setTimeout(r, 15));
      log.push(`${kind}:end`);
      return kind === 'refresh' ? tokenReply(2) : tokenReply(3);
    });
    clock = new Date(clock.getTime() + HOUR + 1);
    const refresh = client.accessTokenFor(domain);
    await new Promise((r) => setTimeout(r, 5)); // the refresh holds the lock and is in flight
    const exchange = client.lockShop(domain, async () => {
      const r = await client.tokenExchange(domain, 'id.token');
      const shop = (await t.handle.db.query.shopifySessions.findFirst({ where: eq(shopifySessions.shopDomain, domain) }))!;
      await client.saveOfflineSession(shop.shopId, domain, r.accessToken, r.scope, r);
    });
    await Promise.all([refresh, exchange]);
    expect(log).toEqual(['refresh:start', 'refresh:end', 'exchange:start', 'exchange:end']);
    expect((await client.offlineSession(domain))!.accessToken).toBe(AT(3));
  });

  it('a 401 from the Admin API refreshes once and repeats the request with the new token', async () => {
    const domain = 'admin401.myshopify.com';
    await shopWithSession(domain);
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, () => tokenReply(2));
    const seen: string[] = [];
    t.fetchMock.on(`https://${domain}/admin/api/`, (_u, init) => {
      const tok = (init?.headers as Record<string, string>)['x-shopify-access-token']!;
      seen.push(tok);
      if (tok !== AT(2)) return json({ errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' }, 401);
      return json({ data: { shop: { primaryDomain: { host: 'shop.example' } } } });
    });
    const token = (await client.accessTokenFor(domain))!;
    expect(token).toBe(AT(1));
    expect(await client.fetchPrimaryDomainHost(domain, token)).toBe('shop.example');
    expect(seen).toEqual([AT(1), AT(2)]);
    expect((await client.offlineSession(domain))!.refreshToken).toBe(RT(2));
  });

  it('a terminal refresh failure (401) drops the refresh token; once expired the shop has no token until the next token exchange', async () => {
    const domain = 'terminal.myshopify.com';
    await shopWithSession(domain);
    let grants = 0;
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, () => {
      grants++;
      return json({ error: 'invalid_request', error_description: 'This request requires an active refresh_token' }, 401);
    });
    clock = new Date(clock.getTime() + HOUR + 1);
    expect(await client.accessTokenFor(domain)).toBeNull();
    expect(await client.accessTokenFor(domain)).toBeNull();
    expect(grants).toBe(1); // never retried with the dead refresh token
    expect((await client.offlineSession(domain))!.refreshToken).toBeNull();
  });

  it('a terminal refresh failure within the margin keeps the still-valid access token until it expires (T1)', async () => {
    const domain = 'terminal-valid.myshopify.com';
    await shopWithSession(domain);
    let grants = 0;
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, () => {
      grants++;
      return json({ error: 'invalid_request', error_description: 'This request requires an active refresh_token' }, 401);
    });
    clock = new Date(clock.getTime() + 58 * 60_000); // inside SHOPIFY_TOKEN_REFRESH_MARGIN_SEC, not expired
    expect(await client.accessTokenFor(domain)).toBe(AT(1));
    expect((await client.offlineSession(domain))!.refreshToken).toBeNull();
    expect(await client.accessTokenFor(domain)).toBe(AT(1));
    expect(grants).toBe(1);
    clock = new Date(clock.getTime() + 3 * 60_000);
    expect(await client.accessTokenFor(domain)).toBeNull();
  });

  it('the daily job counts a refresh that did not produce a new token as failed, not refreshed', async () => {
    const domain = 'job-terminal.myshopify.com';
    const { shop } = await seedShop(t, { platform: 'shopify', domain, products: [] });
    await client.saveOfflineSession(shop.id, domain, AT(1), 'read_products', { expiresIn: 3600, refreshToken: RT(1), refreshTokenExpiresIn: 86_400 });
    t.fetchMock.on(/\/admin\/oauth\/access_token$/, () => json({ error: 'invalid_request' }, 401));
    const r = await client.refreshDueTokens();
    expect(r.refreshed).toBe(0);
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect(await client.accessTokenFor(domain)).toBe(AT(1)); // still usable until it expires
  });

  it('a transient failure keeps the still-valid token, and throws once it has expired (the job retries later)', async () => {
    const domain = 'transient.myshopify.com';
    await shopWithSession(domain);
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, () => new Response('busy', { status: 503 }));
    clock = new Date(clock.getTime() + 58 * 60_000);
    expect(await client.accessTokenFor(domain)).toBe(AT(1));
    clock = new Date(clock.getTime() + 5 * 60_000);
    await expect(client.accessTokenFor(domain)).rejects.toThrow();
    expect((await client.offlineSession(domain))!.refreshToken).toBe(RT(1)); // safe to retry with the same one
  });

  it('a non-expiring (legacy) token is returned unchanged and never refreshed', async () => {
    const domain = 'legacy-read.myshopify.com';
    const { shop } = await seedShop(t, { platform: 'shopify', domain, products: [] });
    await client.saveOfflineSession(shop.id, domain, LEGACY, 'read_products');
    clock = new Date(clock.getTime() + 1000 * HOUR);
    expect(await client.accessTokenFor(domain)).toBe(LEGACY);
    expect(t.fetchMock.calls).toHaveLength(0);
  });

  it('the daily job refreshes dormant shops near the 90-day limit and migrates non-expiring tokens', async () => {
    const t3 = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
    try {
      const c = new ShopifyClient(t3.env, t3.handle.db, t3.fetchMock.fetch, undefined, () => clock);
      const fresh = (await seedShop(t3, { platform: 'shopify', domain: 'fresh.myshopify.com', products: [] })).shop;
      const dormant = (await seedShop(t3, { platform: 'shopify', domain: 'dormant.myshopify.com', products: [] })).shop;
      const legacy = (await seedShop(t3, { platform: 'shopify', domain: 'legacy.myshopify.com', products: [] })).shop;
      await c.saveOfflineSession(fresh.id, 'fresh.myshopify.com', AT(1), 'read_products', { expiresIn: 3600, refreshToken: RT(1), refreshTokenExpiresIn: 7_776_000 });
      await c.saveOfflineSession(dormant.id, 'dormant.myshopify.com', AT(1), 'read_products', { expiresIn: 3600, refreshToken: RT(1), refreshTokenExpiresIn: 10 * 86_400 });
      await c.saveOfflineSession(legacy.id, 'legacy.myshopify.com', LEGACY, 'read_products');
      const grants: Record<string, Record<string, string>> = {};
      t3.fetchMock.on(/\/admin\/oauth\/access_token$/, (url, init) => {
        grants[new URL(url).host] = form(init);
        return tokenReply(4);
      });
      expect(await c.refreshDueTokens()).toEqual({ refreshed: 1, migrated: 1, failed: 0 });
      expect(Object.keys(grants).sort()).toEqual(['dormant.myshopify.com', 'legacy.myshopify.com']);
      expect(grants['dormant.myshopify.com']).toMatchObject({ grant_type: 'refresh_token', refresh_token: RT(1) });
      expect(grants['legacy.myshopify.com']).toEqual({
        client_id: API_KEY,
        client_secret: API_SECRET,
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: LEGACY,
        subject_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
        expiring: '1',
      });
      expect(await c.offlineSession('legacy.myshopify.com')).toMatchObject({ accessToken: AT(4), refreshToken: RT(4) });
      expect((await c.offlineSession('dormant.myshopify.com'))!.refreshTokenExpiresAt!.getTime()).toBe(clock.getTime() + 7_776_000_000);
      // a second run has nothing to do
      expect(await c.refreshDueTokens()).toEqual({ refreshed: 0, migrated: 0, failed: 0 });

      // the job is registered and scheduled daily
      expect(JOB.shopifyTokens).toBe('shopify-tokens');
      expect(CRON.shopifyTokens).toBe('41 3 * * *');
    } finally {
      await t3.close();
    }
  });

  it('a failed migration keeps the old token so the next run can repeat the same request', async () => {
    const domain = 'migrate-fail.myshopify.com';
    const { shop } = await seedShop(t, { platform: 'shopify', domain, products: [] });
    await client.saveOfflineSession(shop.id, domain, LEGACY, 'read_products');
    t.fetchMock.on(`https://${domain}/admin/oauth/access_token`, () => new Response('gateway', { status: 502 }));
    await expect(client.migrateLegacyToken(domain)).rejects.toThrow();
    expect(await client.offlineSession(domain)).toMatchObject({ accessToken: LEGACY, refreshToken: null, expiresAt: null });
  });
});
