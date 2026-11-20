import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodeSessionToken, signSessionToken, verifySessionToken, verifySessionTokenOrThrow } from './sessionToken';
import { API_KEY, API_SECRET, SHOP } from './test/fixtures';

const opts = { apiKey: API_KEY, apiSecret: API_SECRET };

describe('session tokens', () => {
  it('verifies a token signed with the client secret and extracts the shop', () => {
    const token = signSessionToken({ shopDomain: SHOP, apiKey: API_KEY, sub: '42', sid: 'sid-1', jti: 'jti-1' }, API_SECRET);
    const claims = verifySessionTokenOrThrow(token, opts);
    expect(claims.shopDomain).toBe(SHOP);
    expect(claims.userId).toBe('42');
    expect(claims.sessionId).toBe('sid-1');
    expect(claims.jti).toBe('jti-1');
    expect(claims.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(decodeSessionToken(token)?.payload.dest).toBe(`https://${SHOP}`);
  });

  it('rejects wrong secret, wrong audience, alg=none and malformed input', () => {
    const token = signSessionToken({ shopDomain: SHOP, apiKey: API_KEY }, API_SECRET);
    expect(verifySessionToken(token, { ...opts, apiSecret: 'other' })).toBeNull();
    expect(() => verifySessionTokenOrThrow(token, { ...opts, apiSecret: 'other' })).toThrow(/bad_signature/);
    expect(() => verifySessionTokenOrThrow(token, { ...opts, apiKey: 'another-app' })).toThrow(/bad_audience/);
    expect(() => verifySessionTokenOrThrow('abc', opts)).toThrow(/malformed/);
    expect(() => verifySessionTokenOrThrow('a.b.c', opts)).toThrow(/malformed/);

    const [, body, sig] = token.split('.');
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(() => verifySessionTokenOrThrow(`${noneHeader}.${body}.${sig}`, opts)).toThrow(/bad_alg/);
  });

  it('enforces exp / nbf with clock tolerance', () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = signSessionToken({ shopDomain: SHOP, apiKey: API_KEY, exp: now - 60 }, API_SECRET);
    expect(() => verifySessionTokenOrThrow(expired, opts)).toThrow(/expired/);
    const justExpired = signSessionToken({ shopDomain: SHOP, apiKey: API_KEY, exp: now - 5 }, API_SECRET);
    expect(verifySessionToken(justExpired, opts)).not.toBeNull();
    const future = signSessionToken({ shopDomain: SHOP, apiKey: API_KEY, nbf: now + 120 }, API_SECRET);
    expect(() => verifySessionTokenOrThrow(future, opts)).toThrow(/not_yet_valid/);
    const fixedNow = new Date((now + 200) * 1000);
    expect(verifySessionToken(future, { ...opts, now: fixedNow })).toBeNull(); // exp = now+60 < now+200
  });

  it('rejects dest/iss that are not the same Shopify host', () => {
    const now = Math.floor(Date.now() / 1000);
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const mk = (payload: Record<string, unknown>) => {
      const head = enc({ alg: 'HS256', typ: 'JWT' });
      const body = enc({ aud: API_KEY, exp: now + 60, nbf: now - 5, iat: now - 5, ...payload });
      const sig = createHmac('sha256', API_SECRET).update(`${head}.${body}`).digest('base64url');
      return `${head}.${body}.${sig}`;
    };
    expect(() => verifySessionTokenOrThrow(mk({ iss: `https://${SHOP}/admin`, dest: 'https://evil.example' }), opts)).toThrow(/bad_shop/);
    expect(() => verifySessionTokenOrThrow(mk({ iss: 'https://other.myshopify.com/admin', dest: `https://${SHOP}` }), opts)).toThrow(/bad_issuer/);
    expect(() => verifySessionTokenOrThrow(mk({ iss: `https://${SHOP}`, dest: `https://${SHOP}` }), opts)).toThrow(/bad_issuer/);
    expect(() => verifySessionTokenOrThrow(mk({ iss: `http://${SHOP}/admin`, dest: `http://${SHOP}` }), opts)).toThrow(/bad_shop/);
  });
});
