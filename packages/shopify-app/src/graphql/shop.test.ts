import { describe, expect, it } from 'vitest';
import { ACCESS_TOKEN, SHOP, fetchMock } from '../test/fixtures';
import { createAdminClient } from './client';
import { fetchBillingCurrency, fetchPrimaryDomainHost } from './shop';

const client = (m: ReturnType<typeof fetchMock>) => createAdminClient({ shopDomain: SHOP, accessToken: ACCESS_TOKEN, fetch: m.fetch });

describe('shop reads', () => {
  it('primary domain host is lower-cased and validated', async () => {
    expect(await fetchPrimaryDomainHost(client(fetchMock().data({ shop: { primaryDomain: { host: 'Aalter.Example' } } })))).toBe('aalter.example');
    expect(await fetchPrimaryDomainHost(client(fetchMock().data({ shop: { primaryDomain: { host: 'evil host/' } } })))).toBeNull();
    expect(await fetchPrimaryDomainHost(client(fetchMock().data({ shop: null })))).toBeNull();
  });

  it('billing currency comes from shopBillingPreferences; the selling currency is reported separately', async () => {
    const m = fetchMock().data({ shopBillingPreferences: { currency: 'AUD' }, shop: { currencyCode: 'EUR' } });
    expect(await fetchBillingCurrency(client(m))).toEqual({ billingCurrency: 'AUD', shopCurrency: 'EUR' });
    expect(m.query()).toContain('shopBillingPreferences { currency }');
    const none = fetchMock().data({ shopBillingPreferences: null, shop: { currencyCode: 'bogus' } });
    expect(await fetchBillingCurrency(client(none))).toEqual({ billingCurrency: null, shopCurrency: null });
  });
});
