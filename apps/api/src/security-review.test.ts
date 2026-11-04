/**
 * Security / privacy review regression tests (Nov 2026). Each block pins a bug that was found by
 * reading the code and trying to break it; see README "Security review" for the list.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID } from '@paskamer/schema';
import { resetReplayCache } from './auth/merchant.js';
import { StripeClient } from './billing/stripe.js';
import { renderJobs, shops, usageEvents, webhookLog } from './db/schema.js';
import { testEnv } from './env.js';
import { hmacBase64, hmacHex, signMerchantRequest } from './lib/crypto.js';
import { assertPublicUrl, fetchPublicBytes, isBlockedHostname, isPrivateAddress, UnsafeUrlError } from './lib/safeFetch.js';
import { deckBillingDay } from './routes/app.js';
import { loggablePayload } from './shopify/routes.js';
import { archiveProduct, upsertProduct } from './services/products.js';
import { backfillKeyLookups, findShopBySecret } from './services/shops.js';
import { createDevice, makeApp, seedShop, testLookup, type TestApp } from './test/helpers.js';

const SCRATCH = `/tmp/claude-0/paskamer-review-${process.pid}`;

function hmacHeaders(prefix: string, secret: string, method: string, path: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = signMerchantRequest(secret, method, path, String(ts), body);
  return { authorization: `PK-HMAC key=${prefix}, ts=${ts}, sig=${sig}`, 'content-type': 'application/json' };
}

describe('merchant auth: HMAC replay + O(1) Bearer lookup', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    resetReplayCache();
    t = await makeApp();
    s = await seedShop(t, { products: [] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('a captured POST signature cannot be replayed (keys/rotate would hand the new secret to the replayer)', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const headers = hmacHeaders(s.publicKeyPrefix, s.apiKey, 'POST', '/v1/merchant/keys/rotate', '', ts);
    const first = await t.app.inject({ method: 'POST', url: '/v1/merchant/keys/rotate', headers });
    expect(first.statusCode).toBe(200);
    const replay = await t.app.inject({ method: 'POST', url: '/v1/merchant/keys/rotate', headers });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('replayed_signature');
    // the first rotation's key is the live one now; the previous (seed) key is still inside its grace window
    s.apiKey = first.json<{ apiKey: string }>().apiKey;
  });

  it('idempotent PUTs may repeat a signature (WooCommerce save_post fires twice per save)', async () => {
    const body = JSON.stringify({ pluginVersion: '0.1.0' });
    const headers = hmacHeaders(s.publicKeyPrefix, s.apiKey, 'PUT', '/v1/merchant/shops/self', body);
    expect((await t.app.inject({ method: 'PUT', url: '/v1/merchant/shops/self', headers, payload: body })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'PUT', url: '/v1/merchant/shops/self', headers, payload: body })).statusCode).toBe(200);
  });

  it('Bearer sk_ keys resolve through the indexed lookup, never a table scan; legacy rows are backfilled', async () => {
    const row = (await t.handle.db.query.shops.findFirst({ where: eq(shops.id, s.shop.id) }))!;
    expect(row.apiKeyLookup).toMatch(/^[0-9a-f]{64}$/);
    expect(row.previousKeyLookup).toMatch(/^[0-9a-f]{64}$/); // from the rotation above
    expect(row.apiKeyLookup).not.toBe(row.previousKeyLookup);
    expect((await findShopBySecret(t.handle.db, t.env, s.apiKey))?.id).toBe(s.shop.id);
    expect(await findShopBySecret(t.handle.db, t.env, 'sk_test_' + 'x'.repeat(48))).toBeUndefined();

    // Simulate a row issued before migration 0001: no lookup → not found (no scan fallback) → backfill restores it.
    await t.handle.db.update(shops).set({ apiKeyLookup: null, previousKeyLookup: null }).where(eq(shops.id, s.shop.id));
    expect((await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: { authorization: `Bearer ${s.apiKey}` } })).statusCode).toBe(401);
    expect(await backfillKeyLookups(t.handle.db, t.env)).toBe(1);
    expect(await backfillKeyLookups(t.handle.db, t.env)).toBe(0);
    expect((await t.app.inject({ method: 'GET', url: '/v1/merchant/products', headers: { authorization: `Bearer ${s.apiKey}` } })).statusCode).toBe(200);
  });
});

describe('billing integrity: deck swipes', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t);
  });
  afterAll(async () => {
    await t.close();
  });

  const ev = (over: Record<string, unknown> = {}) => ({
    itemId: 'aalter-studio-1',
    action: 'love',
    at: Date.now(),
    sizeAtSwipe: 'M',
    fitScore: 0.9,
    dealIndex: 0,
    shopId: s.shop.id,
    clientId: `c-${Math.random().toString(36).slice(2, 14)}`,
    ...over,
  });

  it('a fit result for an item the shop does not sell (or has archived) is not a billable session', async () => {
    const d = await createDevice(t);
    const ghost = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ itemId: 'does-not-exist-1' }), ev({ itemId: 'does-not-exist-2' })] } });
    expect(ghost.statusCode).toBe(200);
    expect(ghost.json()).toMatchObject({ accepted: 2, usageEventsCreated: 0 });

    await archiveProduct(t.handle.db, s.shop.id, 'raw-denim-01');
    const archived = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ itemId: 'raw-denim-01', sizeAtSwipe: '28' })] } });
    expect(archived.json()).toMatchObject({ accepted: 1, usageEventsCreated: 0 });
    expect(await t.handle.db.select().from(usageEvents).where(eq(usageEvents.shopId, s.shop.id))).toHaveLength(0);
  });

  it('the client timestamp cannot mint one session per fabricated day', async () => {
    const d = await createDevice(t);
    const now = Date.now();
    const events = [0, 1, 2, 3, 4].map((years) => ev({ at: now - years * 365 * 24 * 3600 * 1000 }));
    const res = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events } });
    expect(res.json()).toMatchObject({ accepted: 5, usageEventsCreated: 1 });
    const future = await t.app.inject({ method: 'POST', url: '/v1/swipes', headers: d.auth, payload: { events: [ev({ at: now + 30 * 24 * 3600 * 1000 })] } });
    expect(future.json().usageEventsCreated).toBe(0);
  });

  it('deckBillingDay honours timestamps within ±36 h (offline outbox) and clamps the rest', () => {
    const now = new Date('2026-11-04T12:00:00Z');
    expect(deckBillingDay(Date.parse('2026-11-03T20:00:00Z'), now)).toBe('2026-11-03');
    expect(deckBillingDay(Date.parse('2026-11-01T20:00:00Z'), now)).toBe('2026-11-04');
    expect(deckBillingDay(Date.parse('2030-01-01T00:00:00Z'), now)).toBe('2026-11-04');
  });
});

describe('SDK sessions rate limit is per shop key (not per client IP)', () => {
  it('counts across IPs for one shop and separately per shop', async () => {
    const t = await makeApp({ SDK_RATE_LIMIT_PER_MIN: '2' });
    try {
      const a = await seedShop(t);
      const b = await seedShop(t);
      const hit = (prefix: string, ip: string) =>
        t.app.inject({ method: 'POST', url: '/v1/sdk/sessions', headers: { 'x-forwarded-for': ip }, payload: { shopKeyPrefix: prefix, productExternalId: 'aalter-studio-1', pageUrl: 'https://m.example/p' } });
      expect((await hit(a.publicKeyPrefix, '198.51.100.1')).statusCode).toBe(200);
      expect((await hit(a.publicKeyPrefix, '198.51.100.2')).statusCode).toBe(200);
      const third = await hit(a.publicKeyPrefix, '198.51.100.3');
      expect(third.statusCode).toBe(429);
      expect(third.json().error.code).toBe('rate_limited');
      // another shop from an already-used IP is unaffected
      expect((await hit(b.publicKeyPrefix, '198.51.100.1')).statusCode).toBe(200);
      // a garbage prefix falls back to the IP bucket (and is rejected by the schema) instead of poisoning a shop bucket
      expect((await hit('../../etc', '198.51.100.9')).statusCode).toBe(400);
      expect((await hit('pk_test_unknownprefix1', '198.51.100.9')).statusCode).toBe(404);
    } finally {
      await t.close();
    }
  });
});

describe('Shopify webhooks: GDPR payload hygiene + replay', () => {
  const API_KEY = 'shpa_review';
  const API_SECRET = 'shpss_review_secret_0123456789';
  const SHOP = 'review.myshopify.com';
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp({ SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: API_SECRET });
    await seedShop(t, { platform: 'shopify', domain: SHOP, products: [] });
  });
  afterAll(async () => {
    await t.close();
  });

  const webhook = (topic: string, payload: object, over: Record<string, string | undefined> = {}) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-shopify-topic': topic,
      'x-shopify-shop-domain': SHOP,
      'x-shopify-webhook-id': `wh-${Math.random().toString(36).slice(2)}`,
      'x-shopify-hmac-sha256': hmacBase64(API_SECRET, body),
    };
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete headers[k];
    else headers[k] = v;
    return t.app.inject({ method: 'POST', url: '/shopify/webhooks', headers, payload: body });
  };

  it('customers/data_request + customers/redact never store the customer e-mail, phone or orders', async () => {
    const res = await webhook('customers/data_request', {
      shop_id: 1,
      shop_domain: SHOP,
      customer: { id: 5, email: 'alice@example.com', phone: '+31612345678' },
      orders_requested: [1001, 1002],
      data_request: { id: 77 },
    });
    expect(res.statusCode).toBe(200);
    await webhook('customers/redact', { shop_id: 1, shop_domain: SHOP, customer: { id: 5, email: 'alice@example.com' }, orders_to_redact: [1001] });
    const logs = await t.handle.db.select().from(webhookLog).where(eq(webhookLog.shopDomain, SHOP));
    const customerLogs = logs.filter((l) => l.topic.startsWith('customers/'));
    expect(customerLogs).toHaveLength(2);
    for (const l of customerLogs) {
      const text = JSON.stringify(l.payload);
      expect(text).not.toContain('alice@example.com');
      expect(text).not.toContain('+31612345678');
      expect(text).not.toContain('1001');
      expect(l.payload).toMatchObject({ redacted: true, shop_id: 1, shop_domain: SHOP });
      expect(l.status).toBe('processed');
    }
    expect(loggablePayload('products/update', { id: 9, title: 'x' })).toEqual({ id: 9, title: 'x' });
  });

  it('a validly signed delivery without X-Shopify-Webhook-Id is refused (no dedupe → replayable)', async () => {
    const res = await webhook('app/uninstalled', { id: 1, domain: SHOP }, { 'x-shopify-webhook-id': undefined });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('missing_webhook_id');
    const shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.domain, SHOP) });
    expect(shop?.uninstalledAt).toBeNull();
    expect((await t.handle.db.select().from(webhookLog).where(eq(webhookLog.topic, 'app/uninstalled'))).length).toBe(0);
  });

  it('WooCommerce Connect cannot claim a domain installed through Shopify', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl: `https://${SHOP}`, name: 'Impostor' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('platform_mismatch');
    const shop = await t.handle.db.query.shops.findFirst({ where: eq(shops.domain, SHOP) });
    expect(shop?.platform).toBe('shopify');
    expect(shop?.name).not.toBe('Impostor');
    const foreignReturn = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl: 'https://honest-woo.example', name: 'Woo', returnUrl: 'https://evil.example/phish' } });
    expect(foreignReturn.statusCode).toBe(400);
    expect(foreignReturn.json().error.code).toBe('bad_return_url');
  });
});

describe('Stripe signature header', () => {
  it('accepts any v1 entry (secret rotation sends several) and rejects when none match', () => {
    const env = testEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_a' });
    const stripe = new StripeClient(env, fetch);
    const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', created: 1, data: { object: {} } });
    const t = Math.floor(Date.now() / 1000);
    const good = hmacHex('whsec_a', `${t}.${body}`);
    const other = hmacHex('whsec_b', `${t}.${body}`);
    expect(stripe.verifyWebhook(body, `t=${t},v1=${other},v1=${good}`)?.id).toBe('evt_1');
    expect(stripe.verifyWebhook(body, `t=${t},v1=${good},v1=${other}`)?.id).toBe('evt_1');
    expect(stripe.verifyWebhook(body, `t=${t},v1=${other}`)).toBeNull();
    expect(stripe.verifyWebhook(body, `t=${t},v0=${good}`)).toBeNull();
  });
});

describe('merchant analytics: size buckets clear the k floor on their own', () => {
  it('a size chosen by fewer than K users is dropped from the product histogram', async () => {
    const t = await makeApp({ K_ANON: '5' });
    try {
      const s = await seedShop(t);
      const at = Date.now();
      for (let i = 0; i < 6; i++) {
        const d = await createDevice(t);
        await t.app.inject({
          method: 'POST',
          url: '/v1/swipes',
          headers: d.auth,
          payload: { events: [{ itemId: 'aalter-studio-1', action: 'love', at, sizeAtSwipe: i < 5 ? 'M' : 'XS', fitScore: 0.9, dealIndex: 0, shopId: s.shop.id, clientId: `r-${d.deviceId}` }] },
        });
      }
      const day = new Date(at).toISOString().slice(0, 10);
      const res = await t.app.inject({ method: 'GET', url: `/v1/merchant/analytics/swipes?from=${day}&to=${day}`, headers: { authorization: `Bearer ${s.apiKey}` } });
      const a = res.json<{ byProduct: Array<{ externalId: string; love: number; sizeHistogram: Record<string, number> }>; bySize: Array<{ size: string }> }>();
      expect(a.byProduct).toHaveLength(1);
      expect(a.byProduct[0]!.love).toBe(6);
      expect(a.byProduct[0]!.sizeHistogram).toEqual({ M: 5 });
      expect(a.bySize.map((x) => x.size)).toEqual(['M']);
    } finally {
      await t.close();
    }
  });
});

describe('SSRF guard for merchant-supplied image URLs', () => {
  it('classifies private, link-local, loopback, CGNAT, multicast and v4-mapped addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::abcd', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '64:ff9b::10.0.0.1', 'ff02::1'])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '::ffff:93.184.216.34', '100.128.0.1']) expect(isPrivateAddress(ip), ip).toBe(false);
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    for (const h of ['localhost', 'api.localhost', 'postgres', 'metadata.google.internal', 'db.internal', 'printer.local', 'x.home.arpa']) expect(isBlockedHostname(h), h).toBe(true);
    expect(isBlockedHostname('cdn.shopify.com')).toBe(false);
  });

  it('rejects bad schemes, userinfo, private literals and names resolving privately; accepts public hosts', async () => {
    const reject = async (url: string, reason: string) => {
      await expect(assertPublicUrl(url, testLookup)).rejects.toMatchObject({ name: 'UnsafeUrlError', reason });
    };
    await reject('ftp://cdn.example/x.png', 'bad_scheme');
    await reject('file:///etc/passwd', 'bad_scheme');
    await reject('https://user:pw@cdn.example/x.png', 'userinfo');
    await reject('http://169.254.169.254/latest/meta-data/', 'private_address');
    await reject('http://[::1]:3000/v1/openapi.json', 'private_address');
    await reject('http://0x7f000001/', 'private_address'); // WHATWG URL normalises hex/octal IPv4 forms to 127.0.0.1
    await reject('http://2130706433/', 'private_address'); // decimal form of 127.0.0.1
    await reject('http://postgres:5432/', 'blocked_host');
    await reject('https://cdn.internal.test/flat.png', 'private_address');
    await reject('https://nxdomain.test/flat.png', 'dns');
    const ok = await assertPublicUrl('https://cdn.shopify.com/s/files/flat.png', testLookup);
    expect(ok.addresses).toEqual(['93.184.216.34']);
  });

  it('follows at most 3 redirects and re-checks every hop', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === 'https://cdn.public.example/a.png') return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/token' } });
      if (url === 'https://cdn.public.example/loop') return new Response(null, { status: 302, headers: { location: 'https://cdn.public.example/loop' } });
      if (url === 'https://cdn.public.example/ok') return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
      if (url === 'https://cdn.public.example/html') return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
      return new Response('nope', { status: 404 });
    }) as typeof fetch;
    await expect(fetchPublicBytes(fetchImpl, 'https://cdn.public.example/a.png', { lookup: testLookup })).rejects.toBeInstanceOf(UnsafeUrlError);
    expect(calls.some((c) => c.includes('169.254.169.254'))).toBe(false);
    await expect(fetchPublicBytes(fetchImpl, 'https://cdn.public.example/loop', { lookup: testLookup })).rejects.toMatchObject({ reason: 'redirects' });
    expect(await fetchPublicBytes(fetchImpl, 'https://cdn.public.example/ok', { lookup: testLookup })).toEqual(new Uint8Array([1, 2, 3]));
    expect(await fetchPublicBytes(fetchImpl, 'https://cdn.public.example/html', { lookup: testLookup, contentTypePrefix: 'image/' })).toBeNull();
    expect(await fetchPublicBytes(fetchImpl, 'https://cdn.public.example/ok', { lookup: testLookup, maxBytes: 2 })).toBeNull();
  });

  it('the hero render job never fetches a flat-lay that points inside the network, and still renders', async () => {
    const t = await makeApp({ RENDERS_DIR: SCRATCH });
    try {
      const s = await seedShop(t, { products: [] });
      const base = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
      await upsertProduct(t.handle.db, s.shop.id, 'ssrf-1', { ...base, id: 'ssrf-1', flatLayPhoto: 'https://flat.internal.test/wrap.png' });
      const d = await createDevice(t);
      const { default: sharp } = await import('sharp');
      const png = (await sharp({ create: { width: 256, height: 384, channels: 3, background: '#F5EFE7' } }).png().toBuffer()).toString('base64');
      const res = await t.app.inject({
        method: 'POST',
        url: '/v1/renders/hero',
        headers: d.auth,
        payload: {
          productId: 'ssrf-1',
          shopId: s.shop.id,
          size: 'M',
          person: { kind: 'avatarRender', mimeType: 'image/png', imageBase64: png, width: 256, height: 384 },
          consent: { tier: 'heroOptIn', ack: true, acknowledgedAt: new Date().toISOString() },
        },
      });
      expect(res.statusCode).toBe(202);
      expect(await t.queue.drain()).toBe(1);
      expect(t.queue.failed).toHaveLength(0);
      expect(t.fetchMock.calls.some((c) => c.url.includes('flat.internal.test'))).toBe(false);
      const job = await t.handle.db.query.renderJobs.findFirst({ where: eq(renderJobs.id, res.json<{ jobId: string }>().jobId) });
      expect(job?.status).toBe('done');
    } finally {
      await t.close();
    }
  });
});
