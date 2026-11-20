/**
 * Standalone mode (docs/STANDALONE.md §2, D11): embed sessions, allowed postMessage origins and the
 * fit-shown billing event (D7 idempotency, paused shops, no measurements).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ledgerEntries, pairings, products, shops, trySessions, usageDaily, usageEvents } from './db/schema.js';
import { embedAllowedOrigins, originOf } from './services/embed.js';
import type { ShopRow } from './services/shops.js';
import { createDevice, makeApp, seedShop, type TestApp } from './test/helpers.js';

const PAGE = 'https://aalter.example/products/wrap?variant=1#x';

describe('embedAllowedOrigins', () => {
  const shop = (over: Partial<ShopRow>): ShopRow => ({ platform: 'woocommerce', domain: 'aalter.example', settings: {}, ...over }) as ShopRow;

  it('Shopify: myshopify origin + primary domain', () => {
    expect(embedAllowedOrigins(shop({ platform: 'shopify', domain: 'aalter.myshopify.com', settings: { primaryDomain: 'aalter.example' } }), null)).toEqual([
      'https://aalter.myshopify.com',
      'https://aalter.example',
    ]);
  });

  it('WooCommerce: the site URL origin, deduplicated', () => {
    expect(embedAllowedOrigins(shop({ settings: { siteUrl: 'https://aalter.example/shop/' } }), null)).toEqual(['https://aalter.example']);
  });

  it('adds the page origin only when it belongs to the shop', () => {
    const s = shop({ settings: { siteUrl: 'https://aalter.example' } });
    expect(embedAllowedOrigins(s, 'https://www.aalter.example')).toEqual(['https://aalter.example', 'https://www.aalter.example']);
    expect(embedAllowedOrigins(s, 'https://evil.example')).toEqual(['https://aalter.example']);
    expect(embedAllowedOrigins(s, 'https://aalter.example.evil.test')).toEqual(['https://aalter.example']);
    expect(embedAllowedOrigins(s, 'http://aalter.example')).toEqual(['https://aalter.example']);
    expect(embedAllowedOrigins(s, 'javascript:alert(1)')).toEqual(['https://aalter.example']);
  });

  it('merchant-configured extra origins (http allowed only when configured exactly)', () => {
    const s = shop({ settings: { embedOrigins: ['http://localhost:5180', 'https://headless.example/'] } });
    expect(embedAllowedOrigins(s, 'http://localhost:5180')).toEqual(['https://aalter.example', 'http://localhost:5180', 'https://headless.example']);
  });

  it('originOf strips path, query and fragment', () => {
    expect(originOf(PAGE)).toBe('https://aalter.example');
    expect(originOf('ftp://x.example')).toBeNull();
    expect(originOf('not a url')).toBeNull();
  });
});

describe('standalone embed: sessions, resolve, fit-shown', () => {
  let t: TestApp;
  let seeded: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    seeded = await seedShop(t, { domain: 'aalter.example' });
    await t.handle.db
      .update(shops)
      .set({ settings: { ...seeded.shop.settings, siteUrl: 'https://aalter.example' } })
      .where(eq(shops.id, seeded.shop.id));
  });
  afterAll(async () => {
    await t.close();
  });

  const session = (surface: 'embed' | 'button' = 'embed', pageUrl = PAGE) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/sdk/sessions',
      headers: { origin: 'https://aalter.example' },
      payload: { shopKeyPrefix: seeded.publicKeyPrefix, productExternalId: 'aalter-studio-1', pageUrl, surface },
    });
  const tokenOf = (embedUrl: string) => embedUrl.split('/embed/')[1]!;

  /** New session + device, resolved through GET /v1/try/:token. */
  async function resolved(pageUrl = PAGE, opts: { device?: Awaited<ReturnType<typeof createDevice>>; surface?: 'embed' | 'button' } = {}) {
    const d = opts.device ?? (await createDevice(t));
    const res = await session(opts.surface ?? 'embed', pageUrl);
    const token = tokenOf(res.json<{ embedUrl: string }>().embedUrl);
    const r = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
    expect(r.statusCode).toBe(200);
    const body = r.json<{ trySession: { intentToken: string }; embed: { allowedOrigins: string[] } }>();
    return { d, token, intentToken: body.trySession.intentToken, body };
  }
  const fitShown = (token: string, auth: Record<string, string>, body: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: `/v1/try/${token}/fit-shown`, headers: auth, payload: body });

  async function usageFor(intentToken: string) {
    return t.handle.db.select().from(usageEvents).where(eq(usageEvents.idempotencyKey, `intent:${intentToken}`));
  }

  it('surface embed → embedUrl, no QR; the session keeps only the page origin', async () => {
    const res = await session('embed');
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const body = res.json<{ tryUrl: string; embedUrl: string; qrSvg?: string }>();
    expect(body.embedUrl.startsWith(`${t.env.PUBLIC_APP_URL}/embed/`)).toBe(true);
    expect(tokenOf(body.embedUrl)).toBe(body.tryUrl.split('/try/')[1]);
    expect(body.qrSvg).toBeUndefined();
    const jti = (await t.app.ctx.tokens.verifyTry(tokenOf(body.embedUrl)))!.jti;
    const row = await t.handle.db.query.trySessions.findFirst({ where: eq(trySessions.tokenJti, jti) });
    expect(row?.surface).toBe('embed');
    expect(row?.pageOrigin).toBe('https://aalter.example');
  });

  it('surface button (app mode) → embedUrl and the QR', async () => {
    const body = (await session('button')).json<{ embedUrl: string; qrSvg?: string }>();
    expect(body.embedUrl).toContain('/embed/');
    expect(body.qrSvg).toContain('<svg');
  });

  it('paused shop → 402 with the embedUrl (the embed shows the paused screen)', async () => {
    await t.handle.db.update(shops).set({ paused: true }).where(eq(shops.id, seeded.shop.id));
    const res = await session('embed');
    await t.handle.db.update(shops).set({ paused: false }).where(eq(shops.id, seeded.shop.id));
    expect(res.statusCode).toBe(402);
    expect(res.json()).toMatchObject({ shopPaused: true });
    expect(res.json().embedUrl).toContain('/embed/');
  });

  it('resolve returns the allowed origins and pairs with source embed', async () => {
    const { d, body } = await resolved('https://www.aalter.example/p/1');
    expect(body.embed.allowedOrigins).toEqual(['https://aalter.example', 'https://www.aalter.example']);
    const pairing = await t.handle.db.query.pairings.findFirst({ where: and(eq(pairings.deviceId, d.deviceId), eq(pairings.shopId, seeded.shop.id)) });
    expect(pairing?.source).toBe('embed');
    const foreign = await resolved('https://evil.example/p/1');
    expect(foreign.body.embed.allowedOrigins).toEqual(['https://aalter.example']);
  });

  it('fit-shown bills exactly once per intent token; replays → billed:false', async () => {
    const { d, token, intentToken } = await resolved();
    const body = { intentToken, recommendedSize: 'M', confidence: 0.74 };
    const day = new Date().toISOString().slice(0, 10);
    const before = await t.handle.db.query.usageDaily.findFirst({ where: and(eq(usageDaily.shopId, seeded.shop.id), eq(usageDaily.day, day)) });

    const first = await fitShown(token, d.auth, body);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ billed: true });
    const replay = await fitShown(token, d.auth, { ...body, recommendedSize: 'L' });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ billed: false });

    const events = await usageFor(intentToken);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ shopId: seeded.shop.id, kind: 'fit_session', deviceId: d.deviceId });
    const after = await t.handle.db.query.usageDaily.findFirst({ where: and(eq(usageDaily.shopId, seeded.shop.id), eq(usageDaily.day, day)) });
    expect((after?.fitSessions ?? 0) - (before?.fitSessions ?? 0)).toBe(1);

    const sess = await t.handle.db.query.trySessions.findFirst({ where: eq(trySessions.intentToken, intentToken) });
    expect(sess?.billedAt).not.toBeNull();
    expect(sess?.recommendedSize).toBe('M'); // the replay did not overwrite it
    expect(sess?.fitConfidence).toBeCloseTo(0.74);

    // One ledger line for the shopper: field names only, no values, no measurements.
    const ledger = await t.handle.db.select().from(ledgerEntries).where(and(eq(ledgerEntries.deviceId, d.deviceId), eq(ledgerEntries.kind, 'fit')));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.payloadSummary.fields).toEqual(['intentToken', 'recommendedSize', 'confidence']);
    expect(ledger[0]!.shopId).toBe(seeded.shop.id);
    expect(JSON.stringify(ledger[0]!.payloadSummary)).not.toContain('0.74');
    const mine = await t.app.inject({ method: 'GET', url: '/v1/me/ledger', headers: d.auth });
    expect(mine.json().entries.map((e: { kind: string }) => e.kind)).toContain('fit');
  });

  it('a swipe with the same intent token after fit-shown does not bill again', async () => {
    const { d, token, intentToken } = await resolved();
    expect((await fitShown(token, d.auth, { intentToken, recommendedSize: 'S', confidence: 0.5 })).json()).toEqual({ billed: true });
    const swipe = await t.app.inject({
      method: 'POST',
      url: '/v1/swipes',
      headers: d.auth,
      payload: {
        events: [
          {
            itemId: 'aalter-studio-1',
            action: 'love',
            at: Date.now(),
            dealIndex: 0,
            sizeAtSwipe: 'S',
            fitScore: 0.8,
            shopId: seeded.shop.id,
            clientId: 'embed-swipe-1',
            intentToken,
          },
        ],
      },
    });
    expect(swipe.statusCode).toBe(200);
    expect(swipe.json().usageEventsCreated).toBe(0);
    expect(await usageFor(intentToken)).toHaveLength(1);
  });

  it('paused shop → 402, not billed', async () => {
    const { d, token, intentToken } = await resolved();
    await t.handle.db.update(shops).set({ paused: true }).where(eq(shops.id, seeded.shop.id));
    const res = await fitShown(token, d.auth, { intentToken, recommendedSize: 'M', confidence: 0.6 });
    await t.handle.db.update(shops).set({ paused: false }).where(eq(shops.id, seeded.shop.id));
    expect(res.statusCode).toBe(402);
    expect(res.json().error.code).toBe('shop_paused');
    expect(await usageFor(intentToken)).toHaveLength(0);
    const sess = await t.handle.db.query.trySessions.findFirst({ where: eq(trySessions.intentToken, intentToken) });
    expect(sess?.billedAt).toBeNull();
  });

  it('rejects measurements, a foreign intent token, other devices, unresolved links and no auth', async () => {
    const { d, token, intentToken } = await resolved();
    const ok = { intentToken, recommendedSize: 'M', confidence: 0.6 };
    expect((await fitShown(token, d.auth, { ...ok, measurements: { bust: 88, waist: 70 } })).statusCode).toBe(400);
    expect((await fitShown(token, d.auth, { ...ok, heightCm: 170 })).statusCode).toBe(400);
    expect((await fitShown(token, {}, ok)).statusCode).toBe(401);
    expect((await fitShown(`${token}x`, d.auth, ok)).statusCode).toBe(401);

    const other = await resolved();
    const mismatch = await fitShown(token, d.auth, { ...ok, intentToken: other.intentToken });
    expect(mismatch.statusCode).toBe(403);
    expect(mismatch.json().error.code).toBe('intent_mismatch');
    const otherDevice = await fitShown(token, other.d.auth, ok);
    expect(otherDevice.statusCode).toBe(403);

    const fresh = await session('embed');
    const freshToken = tokenOf(fresh.json<{ embedUrl: string }>().embedUrl);
    const unresolved = await fitShown(freshToken, d.auth, ok);
    expect(unresolved.statusCode).toBe(409);
    expect(await usageFor(intentToken)).toHaveLength(0);
  });

  it('accepts fit-shown after the 10-minute link TTL (grace window)', async () => {
    const { d, token, intentToken } = await resolved();
    // Re-sign an already expired token for the same session: within the grace window it still counts.
    const jti = (await t.app.ctx.tokens.verifyTry(token))!.jti;
    const sess = (await t.handle.db.query.trySessions.findFirst({ where: eq(trySessions.tokenJti, jti) }))!;
    const { SignJWT } = await import('jose');
    const key = new TextEncoder().encode(t.env.JWT_SECRET);
    const past = Math.floor(Date.now() / 1000) - 1800;
    const expired = await new SignJWT({ typ: 'try', sid: sess.shopId, pid: sess.productId })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(jti)
      .setIssuedAt(past - 600)
      .setExpirationTime(past)
      .sign(key);
    expect(await t.app.ctx.tokens.verifyTry(expired)).toBeNull();
    const res = await fitShown(expired, d.auth, { intentToken, recommendedSize: 'M', confidence: 0.6 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ billed: true });
  });

  it('merchants can add extra embed origins (https origins only)', async () => {
    const auth = { authorization: `Bearer ${seeded.apiKey}` };
    const bad = await t.app.inject({ method: 'PUT', url: '/v1/merchant/shops/self', headers: auth, payload: { embedOrigins: ['http://headless.example'] } });
    expect(bad.statusCode).toBe(400);
    const withPath = await t.app.inject({ method: 'PUT', url: '/v1/merchant/shops/self', headers: auth, payload: { embedOrigins: ['https://headless.example/shop'] } });
    expect(withPath.statusCode).toBe(400);
    const ok = await t.app.inject({ method: 'PUT', url: '/v1/merchant/shops/self', headers: auth, payload: { embedOrigins: ['https://headless.example'] } });
    expect(ok.statusCode).toBe(200);
    const { body } = await resolved();
    expect(body.embed.allowedOrigins).toEqual(['https://aalter.example', 'https://headless.example']);
  });

  describe('billing integrity (SEC-1, SEC-2)', () => {
    const ok = (intentToken: string) => ({ intentToken, recommendedSize: 'M', confidence: 0.6 });

    it('an app-mode session (surface button) is never billed through fit-shown', async () => {
      const { d, token, intentToken } = await resolved(PAGE, { surface: 'button' });
      expect((await fitShown(token, d.auth, ok(intentToken))).json()).toEqual({ billed: false });
      expect(await usageFor(intentToken)).toHaveLength(0);
    });

    it('a session minted from a foreign page is recorded but not billed', async () => {
      const foreign = await resolved('https://evil.example/p/1');
      expect((await fitShown(foreign.token, foreign.d.auth, ok(foreign.intentToken))).json()).toEqual({ billed: false });
      expect(await usageFor(foreign.intentToken)).toHaveLength(0);
      const sess = await t.handle.db.query.trySessions.findFirst({ where: eq(trySessions.intentToken, foreign.intentToken) });
      expect(sess?.fitShownAt).not.toBeNull();
      expect(sess?.billedAt).toBeNull();
      const plainHttp = await resolved('http://aalter.example/p/1');
      expect((await fitShown(plainHttp.token, plainHttp.d.auth, ok(plainHttp.intentToken))).json()).toEqual({ billed: false });
    });

    it('a product archived after resolve is not billed', async () => {
      const { d, token, intentToken } = await resolved();
      await t.handle.db.update(products).set({ status: 'archived' }).where(and(eq(products.shopId, seeded.shop.id), eq(products.externalId, 'aalter-studio-1')));
      try {
        expect((await fitShown(token, d.auth, ok(intentToken))).json()).toEqual({ billed: false });
        expect(await usageFor(intentToken)).toHaveLength(0);
      } finally {
        await t.handle.db.update(products).set({ status: 'active' }).where(and(eq(products.shopId, seeded.shop.id), eq(products.externalId, 'aalter-studio-1')));
      }
    });

    it('bills one session per device, product and day (new intent tokens included)', async () => {
      const first = await resolved();
      expect((await fitShown(first.token, first.d.auth, ok(first.intentToken))).json()).toEqual({ billed: true });
      const again = await resolved(PAGE, { device: first.d });
      expect((await fitShown(again.token, again.d.auth, ok(again.intentToken))).json()).toEqual({ billed: false });
      expect(await usageFor(again.intentToken)).toHaveLength(0);
    });
  });
});

describe('standalone embed: anomaly cap and rate limits (SEC-1)', () => {
  let t: TestApp;
  let seeded: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp({ EMBED_BILLED_SESSIONS_PER_DAY: '1', TRY_RATE_LIMIT_PER_MIN: '3' });
    seeded = await seedShop(t, { domain: 'aalter.example' });
    await t.handle.db
      .update(shops)
      .set({ settings: { ...seeded.shop.settings, siteUrl: 'https://aalter.example' } })
      .where(eq(shops.id, seeded.shop.id));
  });
  afterAll(async () => {
    await t.close();
  });

  async function resolved() {
    const d = await createDevice(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/v1/sdk/sessions',
      payload: { shopKeyPrefix: seeded.publicKeyPrefix, productExternalId: 'aalter-studio-1', pageUrl: PAGE, surface: 'embed' },
    });
    const token = res.json<{ embedUrl: string }>().embedUrl.split('/embed/')[1]!;
    const r = await t.app.inject({ method: 'GET', url: `/v1/try/${token}`, headers: d.auth });
    return { d, token, status: r.statusCode, intentToken: r.statusCode === 200 ? r.json<{ trySession: { intentToken: string } }>().trySession.intentToken : '' };
  }

  it('stops billing a shop at the daily cap, then rate-limits the try routes per IP', async () => {
    const a = await resolved();
    const b = await resolved();
    const post = (x: typeof a) =>
      t.app.inject({ method: 'POST', url: `/v1/try/${x.token}/fit-shown`, headers: x.d.auth, payload: { intentToken: x.intentToken, recommendedSize: 'M', confidence: 0.5 } });
    expect((await post(a)).json()).toEqual({ billed: true });
    expect((await post(b)).json()).toEqual({ billed: false }); // cap of 1 reached
    // Each try route allows 3 calls per IP per minute: the fourth resolve is refused.
    expect((await resolved()).status).toBe(200);
    expect((await resolved()).status).toBe(429);
  });
});
