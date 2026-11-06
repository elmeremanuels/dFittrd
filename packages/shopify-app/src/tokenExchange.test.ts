import { describe, expect, it } from 'vitest';
import { API_KEY, API_SECRET, SHOP, fetchMock } from './test/fixtures';
import { migrateToExpiringToken, refreshAccessToken, requestTokenExchange, tokenExchangeBody, tokenExchangeUrl, TokenExchangeError, tokenExpiries } from './tokenExchange';

describe('token exchange', () => {
  it('posts the exact RFC 8693 body for an offline token', async () => {
    const m = fetchMock().reply({ json: { access_token: 'shp' + 'at_offline', scope: 'read_products,write_products' } });
    const r = await requestTokenExchange({ shopDomain: SHOP, sessionToken: 'id.token.here', apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch });
    expect(r).toEqual({ accessToken: 'shp' + 'at_offline', scope: 'read_products,write_products', tokenType: 'offline' });
    expect(m.last().url).toBe(`https://${SHOP}/admin/oauth/access_token`);
    expect(tokenExchangeUrl(SHOP)).toBe(m.last().url);
    expect(m.last().method).toBe('POST');
    expect(m.last().headers['content-type']).toBe('application/json');
    expect(m.last().body).toEqual({
      client_id: API_KEY,
      client_secret: API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: 'id.token.here',
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    });
  });

  it('supports online tokens and expiring offline tokens', async () => {
    expect(tokenExchangeBody({ apiKey: 'k', apiSecret: 's', sessionToken: 't', tokenType: 'online' }).requested_token_type).toBe('urn:shopify:params:oauth:token-type:online-access-token');
    expect(tokenExchangeBody({ apiKey: 'k', apiSecret: 's', sessionToken: 't', expiring: true })).toMatchObject({ expiring: '1' });
    expect(tokenExchangeBody({ apiKey: 'k', apiSecret: 's', sessionToken: 't', tokenType: 'online', expiring: true }).expiring).toBeUndefined();

    const m = fetchMock().reply({ json: { access_token: 'shp' + 'at_x', scope: 'read_products', expires_in: 3600, refresh_token: 'shprt_y', refresh_token_expires_in: 7776000 } });
    const r = await requestTokenExchange({ shopDomain: SHOP, sessionToken: 't', apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch, expiring: true });
    expect(r).toMatchObject({ expiresIn: 3600, refreshToken: 'shprt_y', refreshTokenExpiresIn: 7776000 });

    const on = fetchMock().reply({ json: { access_token: 'shp' + 'at_o', scope: 'read_products', expires_in: 86399, associated_user_scope: 'read_products', associated_user: { id: 42, email: 'owner@example.com', account_owner: true } } });
    const ro = await requestTokenExchange({ shopDomain: SHOP, sessionToken: 't', apiKey: API_KEY, apiSecret: API_SECRET, fetch: on.fetch, tokenType: 'online' });
    expect(ro.tokenType).toBe('online');
    expect(ro.associatedUser?.id).toBe(42);
  });

  it('turns a 400 (stale ID token) into TokenExchangeError with the body', async () => {
    const m = fetchMock().reply({ status: 400, json: { error: 'invalid_subject_token', error_description: 'The subject token is expired' } });
    const err = await requestTokenExchange({ shopDomain: SHOP, sessionToken: 'old', apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenExchangeError);
    expect((err as TokenExchangeError).status).toBe(400);
    expect((err as TokenExchangeError).message).toBe('The subject token is expired');
  });

  it('rejects bad domains and missing credentials before any request', async () => {
    const m = fetchMock();
    await expect(requestTokenExchange({ shopDomain: 'attacker.example', sessionToken: 't', apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch })).rejects.toThrow(/invalid shop domain/);
    await expect(requestTokenExchange({ shopDomain: SHOP, sessionToken: 't', apiKey: '', apiSecret: API_SECRET, fetch: m.fetch })).rejects.toThrow(/not configured/);
    expect(m.calls).toHaveLength(0);
  });

  it('rejects an unexpected success body', async () => {
    const m = fetchMock().reply({ json: { ok: true } });
    await expect(requestTokenExchange({ shopDomain: SHOP, sessionToken: 't', apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch })).rejects.toThrow(/unexpected body/);
  });
});

const RT = 'shp' + 'rt_refresh_1';
const RT2 = 'shp' + 'rt_refresh_2';
const AT = 'shp' + 'at_expiring_2';

describe('expiring offline tokens (A3)', () => {
  it('refresh posts the form-encoded refresh grant and returns the rotated pair', async () => {
    const m = fetchMock().reply({ json: { access_token: AT, scope: 'read_products,write_products', expires_in: 3600, refresh_token: RT2, refresh_token_expires_in: 7700000 } });
    const r = await refreshAccessToken({ shopDomain: SHOP, refreshToken: RT, apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch });
    expect(r).toEqual({ accessToken: AT, scope: 'read_products,write_products', tokenType: 'offline', expiresIn: 3600, refreshToken: RT2, refreshTokenExpiresIn: 7700000 });
    expect(m.last().url).toBe(`https://${SHOP}/admin/oauth/access_token`);
    expect(m.last().method).toBe('POST');
    expect(m.last().headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(m.last().body)))).toEqual({ client_id: API_KEY, client_secret: API_SECRET, grant_type: 'refresh_token', refresh_token: RT });
  });

  it('a 401 invalid_request is terminal; 429/5xx and network errors are retryable', async () => {
    const dead = fetchMock().reply({ status: 401, json: { error: 'invalid_request', error_description: 'This request requires an active refresh_token' } });
    const e1 = (await refreshAccessToken({ shopDomain: SHOP, refreshToken: RT, apiKey: API_KEY, apiSecret: API_SECRET, fetch: dead.fetch }).catch((e: unknown) => e)) as TokenExchangeError;
    expect(e1).toBeInstanceOf(TokenExchangeError);
    expect([e1.status, e1.terminal, e1.retryable]).toEqual([401, true, false]);
    const busy = fetchMock().reply({ status: 503, text: 'busy' });
    const e2 = (await refreshAccessToken({ shopDomain: SHOP, refreshToken: RT, apiKey: API_KEY, apiSecret: API_SECRET, fetch: busy.fetch }).catch((e: unknown) => e)) as TokenExchangeError;
    expect([e2.terminal, e2.retryable]).toEqual([false, true]);
    const offline = async () => {
      throw new TypeError('fetch failed');
    };
    const e3 = (await refreshAccessToken({ shopDomain: SHOP, refreshToken: RT, apiKey: API_KEY, apiSecret: API_SECRET, fetch: offline }).catch((e: unknown) => e)) as TokenExchangeError;
    expect([e3.status, e3.retryable]).toEqual([503, true]);
  });

  it('refuses a refresh response without a new refresh token, bad domains and empty tokens', async () => {
    const m = fetchMock().reply({ json: { access_token: AT, scope: 'x' } });
    await expect(refreshAccessToken({ shopDomain: SHOP, refreshToken: RT, apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch })).rejects.toThrow(/no refresh token/);
    await expect(refreshAccessToken({ shopDomain: 'evil.example', refreshToken: RT, apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch })).rejects.toThrow(/invalid shop domain/);
    await expect(refreshAccessToken({ shopDomain: SHOP, refreshToken: '', apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch })).rejects.toThrow(/no refresh token/);
  });

  it('migrates a non-expiring token with the offline-token subject and expiring=1', async () => {
    const old = 'shp' + 'at_non_expiring';
    const m = fetchMock().reply({ json: { access_token: AT, scope: 'read_products', expires_in: 3600, refresh_token: RT, refresh_token_expires_in: 7776000 } });
    const r = await migrateToExpiringToken({ shopDomain: SHOP, accessToken: old, apiKey: API_KEY, apiSecret: API_SECRET, fetch: m.fetch });
    expect(r).toMatchObject({ accessToken: AT, refreshToken: RT, expiresIn: 3600 });
    expect(m.last().headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(String(m.last().body)))).toEqual({
      client_id: API_KEY,
      client_secret: API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: old,
      subject_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
      expiring: '1',
    });
  });

  it('tokenExpiries turns the relative lifetimes into instants', () => {
    const now = new Date('2026-11-06T00:00:00Z');
    expect(tokenExpiries({ expiresIn: 3600, refreshTokenExpiresIn: 7776000 }, now)).toEqual({ expiresAt: new Date('2026-11-06T01:00:00Z'), refreshTokenExpiresAt: new Date('2027-02-04T00:00:00Z') });
    expect(tokenExpiries({}, now)).toEqual({ expiresAt: null, refreshTokenExpiresAt: null });
  });
});
