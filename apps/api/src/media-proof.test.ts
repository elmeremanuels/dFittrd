/**
 * Carry-over #11 (image proxy: shop logo + product photo from our origin, allowlisted, typed,
 * capped, cached) and #12 (WooCommerce manual-key Connect needs a domain proof before keys).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { MediaCache, sniffImageType } from './lib/mediaProxy.js';
import { fetchTransport, type LookupLike } from './lib/safeFetch.js';
import { verifyWooDomain, wooDomainNonce } from './routes/merchant.js';
import { updateSettings } from './services/shops.js';
import { json, makeApp, seedShop, testLookup, FetchMock, type TestApp } from './test/helpers.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const img = (bytes: Uint8Array, type: string) => new Response(bytes, { status: 200, headers: { 'content-type': type } });

describe('GET /v1/sdk/media (carry-over #11)', () => {
  let t: TestApp;
  let s: Awaited<ReturnType<typeof seedShop>>;
  const LOGO = 'https://cdn.aalter.example/logo.png';
  const photo = MOCK_GARMENTS_BY_ID['aalter-studio-1']!.productPhotos?.[0] ?? MOCK_GARMENTS_BY_ID['aalter-studio-1']!.flatLayPhoto!;
  const media = (shop: string, u: string) => t.app.inject({ method: 'GET', url: `/v1/sdk/media?shop=${shop}&u=${encodeURIComponent(u)}` });

  beforeAll(async () => {
    t = await makeApp();
    s = await seedShop(t, { products: ['aalter-studio-1'] });
    await updateSettings(t.handle.db, s.shop.id, { logoUrl: LOGO });
  });
  afterAll(async () => {
    await t.close();
  });

  it('serves the shop logo from our origin with the sniffed type, and caches it', async () => {
    t.fetchMock.reset();
    t.fetchMock.on(LOGO, () => img(PNG, 'image/png'));
    const r1 = await media(s.shop.id, LOGO);
    expect(r1.statusCode).toBe(200);
    expect(r1.headers['content-type']).toBe('image/png');
    expect(r1.headers['cache-control']).toMatch(/^public, max-age=\d+$/);
    expect(r1.headers['x-content-type-options']).toBe('nosniff');
    expect(r1.headers['access-control-allow-origin']).toBe('*');
    expect(new Uint8Array(r1.rawPayload)).toEqual(PNG);
    const r2 = await media(s.shop.id, LOGO);
    expect(r2.statusCode).toBe(200);
    expect(t.fetchMock.calls.filter((c) => c.url === LOGO)).toHaveLength(1);
  });

  it('serves a product photo of the shop', async () => {
    t.fetchMock.on(photo, () => img(JPEG, 'image/jpeg'));
    const r = await media(s.shop.id, photo);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
  });

  it('is not an open proxy: unknown URLs, another shop and unknown shops are 404 and never fetched', async () => {
    const other = await seedShop(t, { products: [] });
    t.fetchMock.reset();
    t.fetchMock.on(() => true, () => img(PNG, 'image/png'));
    expect((await media(s.shop.id, 'https://evil.example/track.png')).statusCode).toBe(404);
    expect((await media(other.shop.id, LOGO)).statusCode).toBe(404);
    expect((await media('00000000-0000-4000-8000-00000000abcd', LOGO)).statusCode).toBe(404);
    expect((await media(s.shop.id, 'file:///etc/passwd')).statusCode).toBe(400);
    expect(t.fetchMock.calls).toHaveLength(0);
  });

  it('refuses SVG, HTML behind image/*, oversized bodies and private hosts (502, nothing served)', async () => {
    const urls = {
      svg: 'https://cdn.aalter.example/logo.svg',
      lie: 'https://cdn.aalter.example/lie.png',
      big: 'https://cdn.aalter.example/big.png',
      inside: 'https://cdn.internal.test/logo.png',
    };
    for (const [i, u] of Object.values(urls).entries()) {
      const shop = await seedShop(t, { products: [] });
      await updateSettings(t.handle.db, shop.shop.id, { logoUrl: u });
      t.fetchMock.reset();
      t.fetchMock.on(urls.svg, () => img(new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/svg+xml'));
      t.fetchMock.on(urls.lie, () => img(new TextEncoder().encode('<html><script>1</script>'), 'image/png'));
      t.fetchMock.on(urls.big, () => img(new Uint8Array(t.env.MEDIA_PROXY_MAX_BYTES + 1).fill(0x89), 'image/png'));
      t.fetchMock.on(urls.inside, () => img(PNG, 'image/png'));
      const r = await media(shop.shop.id, u);
      expect(r.statusCode, `case ${i} ${u}`).toBe(502);
      expect(r.json().error.code).toBe('media_unavailable');
    }
    expect(t.fetchMock.calls.some((c) => c.url.includes('internal.test'))).toBe(false);
  });

  it('sniffImageType and the byte-bounded cache', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('GIF89a....'))).toBe('image/gif');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('\0\0\0\x1cftypavif'))).toBe('image/avif');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    const cache = new MediaCache(10);
    cache.set('a', { body: new Uint8Array(6), contentType: 'image/png', expiresAt: 100 });
    cache.set('b', { body: new Uint8Array(6), contentType: 'image/png', expiresAt: 100 });
    expect(cache.get('a', 0)).toBeUndefined(); // evicted (LRU, over 10 bytes)
    expect(cache.get('b', 0)?.body?.length).toBe(6);
    expect(cache.get('b', 100)).toBeUndefined(); // expired
    expect(cache.totalBytes).toBe(0);
  });
});

describe('WooCommerce manual-key Connect: domain proof (carry-over #12)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
  });
  afterAll(async () => {
    await t.close();
  });

  const connect = async (siteUrl: string) => {
    const r = await t.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl, name: 'Woo' } });
    expect(r.statusCode).toBe(200);
    return r.json<{ connectToken: string; mode: string; verification: { nonce: string; restRoute: string } }>();
  };
  const complete = (connectToken: string) => t.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken } });

  it('connect returns a nonce; complete issues keys only after the site serves it at /wp-json/curtain/v1/verify', async () => {
    const c = await connect('https://proof-rest.example/');
    expect(c.mode).toBe('manual-key');
    expect(c.verification).toEqual({ nonce: wooDomainNonce(t.env.JWT_SECRET, c.connectToken), restRoute: '/curtain/v1/verify' });
    expect(c.verification.nonce).not.toContain(c.connectToken);
    t.fetchMock.on('https://proof-rest.example/wp-json/curtain/v1/verify', () => json({ nonce: 'cv_wrong' }));
    const wrong = await complete(c.connectToken);
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('domain_unverified');
    t.fetchMock.reset();
    t.fetchMock.on('https://proof-rest.example/wp-json/curtain/v1/verify', () => json({ nonce: c.verification.nonce }));
    const ok = await complete(c.connectToken);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().apiKey).toMatch(/^sk_test_/);
  });

  it('falls back to ?rest_route= (no pretty permalinks); a meta tag or a reflected string on a page is not proof (SEC-2)', async () => {
    const a = await connect('https://proof-query.example/');
    t.fetchMock.on('https://proof-query.example/?rest_route=%2Fcurtain%2Fv1%2Fverify', () => json({ nonce: a.verification.nonce }));
    expect((await complete(a.connectToken)).statusCode).toBe(200);
    const b = await connect('https://proof-meta.example/');
    t.fetchMock.on('https://proof-meta.example/', () => new Response(`<html><head><meta content="${b.verification.nonce}" name="curtain-site-verification"></head><body><script>var q='<meta name="curtain-site-verification" content="${b.verification.nonce}">'</script></body></html>`, { headers: { 'content-type': 'text/html' } }));
    const r = await complete(b.connectToken);
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('domain_unverified');
  });

  it('a path on a host is not proof for the host: the nonce is read only from the host root (SEC-2)', async () => {
    const c = await connect('https://shared-host.example/~attacker/');
    // The attacker controls only their own directory and answers there, in both REST forms.
    t.fetchMock.on('https://shared-host.example/~attacker/wp-json/curtain/v1/verify', () => json({ nonce: c.verification.nonce }));
    t.fetchMock.on('https://shared-host.example/~attacker/?rest_route=%2Fcurtain%2Fv1%2Fverify', () => json({ nonce: c.verification.nonce }));
    const denied = await complete(c.connectToken);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('domain_unverified');
    expect(t.fetchMock.calls.some((x) => x.url.includes('/~attacker/'))).toBe(false);
    // The host owner answering at the root does prove it.
    t.fetchMock.on('https://shared-host.example/wp-json/curtain/v1/verify', () => json({ nonce: c.verification.nonce }));
    expect((await complete(c.connectToken)).statusCode).toBe(200);
  });

  it('a private site, a redirect off-site and a missing plugin all fail; the token survives for a retry', async () => {
    const lookup: LookupLike = async (h) => (h === 'victim.example' || h === 'www.victim.example' ? [{ address: '93.184.216.34', family: 4 }] : testLookup(h));
    const fm = new FetchMock();
    const base = { lookup, transport: fetchTransport(fm.fetch), nonce: 'cv_abc' };
    // Open redirect on the victim's site to the attacker's page that echoes the nonce.
    fm.on('https://victim.example/wp-json/curtain/v1/verify', () => new Response(null, { status: 302, headers: { location: 'https://attacker.example/n.json' } }));
    fm.on('https://attacker.example/n.json', () => json({ nonce: 'cv_abc' }));
    expect(await verifyWooDomain({ ...base, siteUrl: 'https://victim.example/', domain: 'victim.example' })).toBe(false);
    // A siteUrl on another host than the shop's domain proves nothing.
    expect(await verifyWooDomain({ ...base, siteUrl: 'https://attacker.example/', domain: 'victim.example' })).toBe(false);
    // A redirect to www. of the same site is fine.
    fm.reset();
    fm.on('https://victim.example/wp-json/curtain/v1/verify', () => new Response(null, { status: 301, headers: { location: 'https://www.victim.example/wp-json/curtain/v1/verify' } }));
    fm.on('https://www.victim.example/wp-json/curtain/v1/verify', () => json({ nonce: 'cv_abc' }));
    expect(await verifyWooDomain({ ...base, siteUrl: 'https://victim.example/', domain: 'victim.example' })).toBe(true);
    // A site whose name resolves privately is never fetched.
    fm.reset();
    fm.on(() => true, () => json({ nonce: 'cv_abc' }));
    expect(await verifyWooDomain({ ...base, siteUrl: 'https://shop.internal.test/', domain: 'shop.internal.test' })).toBe(false);
    expect(fm.calls).toHaveLength(0);

    const c = await connect('https://no-plugin.example/');
    expect((await complete(c.connectToken)).statusCode).toBe(403);
    t.fetchMock.on('https://no-plugin.example/wp-json/curtain/v1/verify', () => json({ nonce: c.verification.nonce }));
    expect((await complete(c.connectToken)).statusCode).toBe(200);
  });

  it('WOO_DOMAIN_PROOF=0 skips the proof (local development only)', async () => {
    const dev = await makeApp({ WOO_DOMAIN_PROOF: '0' });
    try {
      const r = await dev.app.inject({ method: 'POST', url: '/v1/merchant/woo/connect', payload: { siteUrl: 'https://local-dev.example/', name: 'Dev' } });
      const done = await dev.app.inject({ method: 'POST', url: '/v1/merchant/woo/complete', payload: { connectToken: r.json().connectToken } });
      expect(done.statusCode).toBe(200);
    } finally {
      await dev.close();
    }
  });
});
