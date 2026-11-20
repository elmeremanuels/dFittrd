/** The console's analytics shapes and wording (launch-readiness finding 1): whole months, and why a row is hidden. */
import { describe, expect, it } from 'vitest';
import { AnalyticsAbandonedResponseSchema, AnalyticsFitSizesResponseSchema, AnalyticsPeriodsResponseSchema, AnalyticsSwipesResponseSchema } from '@curtain/schema';
import { ApiClient } from '@/api/client';
import { mockAbandonedAnalytics, mockAnalytics, mockFitSizes, mockPeriods, mockUsage } from './mock';
import { ANALYTICS_EN } from './strings';

describe('merchant analytics in whole months', () => {
  it('the demo data has the real response shapes, one closed month each', () => {
    const periods = AnalyticsPeriodsResponseSchema.parse(mockPeriods(new Date('2026-11-19T10:00:00Z')));
    expect(periods).toMatchObject({ periods: ['2026-10', '2026-09', '2026-08'], openPeriod: '2026-11', openPeriodAvailableAt: '2026-12-02T00:00:00.000Z' });
    expect(mockPeriods(new Date('2026-12-01T10:00:00Z')).periods[0]).toBe('2026-10');
    expect(AnalyticsSwipesResponseSchema.parse(mockAnalytics('2026-10'))).toMatchObject({ period: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    expect(AnalyticsFitSizesResponseSchema.parse(mockFitSizes('2026-02')).to).toBe('2026-02-28');
    AnalyticsAbandonedResponseSchema.parse(mockAbandonedAnalytics('2026-10', mockUsage('2026-10-01', '2026-10-31')));
  });

  it('asks the api for a month, never for a from/to', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const m = new ApiClient({
      baseUrl: 'https://api.test',
      fetchImpl,
      getDevice: () => ({ deviceId: 'd', token: 't', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
      setDevice: () => undefined,
      onLedger: () => undefined,
    }).merchant('key');
    await m.analyticsPeriods();
    await m.analyticsSwipes('2026-10');
    await m.analyticsFitSizes('2026-10');
    await m.analyticsAbandoned('2026-10');
    expect(urls).toEqual([
      'https://api.test/v1/merchant/analytics/periods',
      'https://api.test/v1/merchant/analytics/swipes?period=2026-10',
      'https://api.test/v1/merchant/analytics/fit-sizes?period=2026-10',
      'https://api.test/v1/merchant/analytics/abandoned?period=2026-10',
    ]);
  });

  it('says in plain English why rows are hidden', () => {
    const noun = { one: 'product', many: 'products' };
    expect(ANALYTICS_EN.hidden({ belowFloor: 0, complementary: 0 }, 5, noun)).toBe('Nothing is hidden this month: every product had at least 5 shoppers.');
    expect(ANALYTICS_EN.hidden({ belowFloor: 2, complementary: 1 }, 5, noun)).toBe(
      '2 products are hidden because fewer than 5 shoppers were in each. 1 product is hidden as well, although it had enough shoppers, so the small hidden products cannot be worked out by subtracting the rows shown from a total.',
    );
    expect(ANALYTICS_EN.hidden({ belowFloor: 1, complementary: 0 }, 5, noun)).toBe('1 product is hidden because fewer than 5 shoppers were in it.');
    expect(ANALYTICS_EN.monthName('2026-10')).toBe('October 2026');
  });
});
