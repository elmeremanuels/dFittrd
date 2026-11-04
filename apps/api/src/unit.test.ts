import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHash, decryptString, encryptString, hashSecret, pseudonymFor, signMerchantRequest, verifySecret } from './lib/crypto.js';
import { EnvError, loadEnv, testEnv } from './env.js';
import { daysBetween, periodFor } from './lib/time.js';
import { parseHmacHeader } from './auth/merchant.js';
import { verifyShopifySessionToken } from './auth/shopifySessionToken.js';
import { TokenService } from './auth/tokens.js';
import { MemoryQueue } from './jobs/queue.js';
import { videoDuration } from './jobs/renderHero.js';

describe('crypto', () => {
  it('scrypt hash verifies with the pepper and fails without', () => {
    const h = hashSecret('sk_test_abc', 'pepper');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(verifySecret('sk_test_abc', h, 'pepper')).toBe(true);
    expect(verifySecret('sk_test_abc', h, 'other')).toBe(false);
    expect(verifySecret('sk_test_abd', h, 'pepper')).toBe(false);
    expect(verifySecret('x', null, 'pepper')).toBe(false);
  });

  it('AES-GCM round trip and tamper detection', () => {
    const key = 'ab'.repeat(32);
    const blob = encryptString('shpat_secret', key);
    expect(blob).not.toContain('shpat');
    expect(decryptString(blob, key)).toBe('shpat_secret');
    const parts = blob.split('.');
    parts[3] = Buffer.from('tampered!!!!').toString('base64');
    expect(() => decryptString(parts.join('.'), key)).toThrow();
  });

  it('pseudonyms differ per shop and never contain the device id', () => {
    const a = pseudonymFor('dev-1', 'shop-1', 'pepper');
    const b = pseudonymFor('dev-1', 'shop-2', 'pepper');
    expect(a).not.toBe(b);
    expect(a).toHaveLength(32);
    expect(a).not.toContain('dev-1');
    expect(pseudonymFor('dev-1', 'shop-1', 'pepper')).toBe(a);
  });

  it('content hash is key-order independent and ignores undefined', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 1 }], e: undefined })).toBe('{"a":[{"c":1,"d":2}],"b":1}');
    expect(contentHash({ b: 1, a: 2 })).toBe(contentHash({ a: 2, b: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });

  it('merchant signature covers method, target, ts and body hash', () => {
    const s1 = signMerchantRequest('sk', 'PUT', '/v1/merchant/products/1', '100', '{}');
    expect(signMerchantRequest('sk', 'put', '/v1/merchant/products/1', '100', '{}')).toBe(s1);
    expect(signMerchantRequest('sk', 'PUT', '/v1/merchant/products/2', '100', '{}')).not.toBe(s1);
    expect(signMerchantRequest('sk', 'PUT', '/v1/merchant/products/1', '101', '{}')).not.toBe(s1);
    expect(signMerchantRequest('sk', 'PUT', '/v1/merchant/products/1', '100', '{"a":1}')).not.toBe(s1);
    expect(parseHmacHeader('PK-HMAC key=pk_test_abc, ts=100, sig="deadbeef"')).toEqual({ key: 'pk_test_abc', ts: '100', sig: 'deadbeef' });
    expect(parseHmacHeader('PK-HMAC key=pk_test_abc')).toBeNull();
    expect(parseHmacHeader('Bearer x')).toBeNull();
  });
});

describe('env', () => {
  it('production requires the secrets; development falls back with a flag', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(EnvError);
    expect(() => loadEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), SHOP_KEY_PEPPER: 'p', ENCRYPTION_KEY: 'a'.repeat(64) })).not.toThrow();
    const dev = loadEnv({ NODE_ENV: 'development' });
    expect(dev.devSecrets).toBe(true);
    expect(dev.K_ANON).toBe(5);
    expect(dev.TRYON_ORDER).toBe('mock');
    expect(dev.RENDER_RETENTION_HOURS).toBe(24);
    expect(() => loadEnv({ JWT_SECRET: 'short' })).toThrow(/32 characters/);
    expect(() => loadEnv({ ENCRYPTION_KEY: 'nothex' })).toThrow(/64 hex/);
    expect(() => loadEnv({ RENDER_RETENTION_HOURS: '48' })).toThrow(EnvError);
    expect(() => loadEnv({ SHOPIFY_API_KEY: 'k' })).toThrow(/SHOPIFY_API_SECRET/);
    expect(loadEnv({ TRYON_REQUIRE_EU: 'true', CORS_ORIGINS: 'https://a.test, https://b.test' })).toMatchObject({ TRYON_REQUIRE_EU: true, CORS_ORIGINS: ['https://a.test', 'https://b.test'] });
    expect(testEnv().devSecrets).toBe(false);
  });
});

describe('tokens', () => {
  const tokens = new TokenService('s'.repeat(40));
  it('device and try tokens round-trip and are type-separated', async () => {
    const d = await tokens.signDevice('dev-1', 3, 30);
    expect(await tokens.verifyDevice(d.token)).toMatchObject({ deviceId: 'dev-1', tokenVersion: 3 });
    expect(await tokens.verifyTry(d.token)).toBeNull();
    const t = await tokens.signTry('shop-1', 'prod-1', 600);
    expect(await tokens.verifyTry(t.token)).toMatchObject({ shopId: 'shop-1', productId: 'prod-1', jti: t.jti });
    expect(await tokens.verifyDevice(t.token)).toBeNull();
    expect(await new TokenService('o'.repeat(40)).verifyDevice(d.token)).toBeNull();
  });
  it('render signatures expire', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = tokens.signRender('job', 'image', exp);
    expect(tokens.verifyRender('job', 'image', exp, sig)).toBe(true);
    expect(tokens.verifyRender('job', 'video', exp, sig)).toBe(false);
    expect(tokens.verifyRender('job', 'image', exp, sig, (exp + 1) * 1000)).toBe(false);
  });
});

describe('shopify session token', () => {
  it('rejects wrong audience, non-https dest and iss/dest mismatch', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode('secret');
    const mk = (claims: Record<string, unknown>, aud = 'key') =>
      new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setAudience(aud).setIssuedAt().setExpirationTime('1m').sign(secret);
    const ok = await mk({ iss: 'https://a.myshopify.com/admin', dest: 'https://a.myshopify.com' });
    expect(await verifyShopifySessionToken(ok, 'key', 'secret')).toMatchObject({ shopDomain: 'a.myshopify.com' });
    expect(await verifyShopifySessionToken(ok, 'other', 'secret')).toBeNull();
    expect(await verifyShopifySessionToken(ok, 'key', 'wrong')).toBeNull();
    expect(await verifyShopifySessionToken(await mk({ iss: 'https://a.myshopify.com/admin', dest: 'http://a.myshopify.com' }), 'key', 'secret')).toBeNull();
    expect(await verifyShopifySessionToken(await mk({ iss: 'https://b.myshopify.com/admin', dest: 'https://a.myshopify.com' }), 'key', 'secret')).toBeNull();
    expect(await verifyShopifySessionToken(await mk({ iss: 'https://evil.com/admin', dest: 'https://evil.com' }), 'key', 'secret')).toBeNull();
  });
});

describe('time + queue + misc', () => {
  it('billing periods anchor on the period start day', () => {
    expect(periodFor('2026-01-15', new Date('2026-11-04T10:00:00Z'))).toEqual({ start: '2026-10-15', end: '2026-11-14' });
    expect(periodFor('2026-01-15', new Date('2026-11-20T10:00:00Z'))).toEqual({ start: '2026-11-15', end: '2026-12-14' });
    expect(periodFor(null, new Date('2026-11-04T10:00:00Z'))).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(daysBetween('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });
  it('memory queue honours singleton keys and delays', async () => {
    const q = new MemoryQueue();
    const ran: string[] = [];
    q.register<{ n: string }>('j', async (d) => {
      ran.push(d.n);
    });
    expect(await q.send('j', { n: 'a' }, { singletonKey: 'k' })).toBeTruthy();
    expect(await q.send('j', { n: 'b' }, { singletonKey: 'k' })).toBeNull();
    await q.send('j', { n: 'later' }, { startAfter: 3600 });
    expect(await q.drain()).toBe(1);
    expect(ran).toEqual(['a']);
    expect(await q.drain(true)).toBe(1);
    expect(ran).toEqual(['a', 'later']);
  });
  it('snaps video seconds to the provider grid', () => {
    expect(videoDuration(2)).toBe(4);
    expect(videoDuration(5)).toBe(4);
    expect(videoDuration(7)).toBe(6);
    expect(videoDuration(10)).toBe(10);
  });
});
