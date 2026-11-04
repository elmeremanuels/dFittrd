import { describe, expect, it } from 'vitest';
import { API_KEY, API_SECRET, SHOP, fetchMock } from './test/fixtures';
import { requestTokenExchange, tokenExchangeBody, tokenExchangeUrl, TokenExchangeError } from './tokenExchange';

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
