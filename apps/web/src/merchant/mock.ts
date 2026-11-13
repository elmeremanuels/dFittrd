/**
 * Mock console data, used only when the API is unreachable (no secret, no real shop). Shapes are
 * the real DTOs so the console renders exactly what the backend will send.
 */
import {
  completenessScore,
  MOCK_GARMENTS,
  type AnalyticsAbandonedResponse,
  type AnalyticsFitSizesResponse,
  type AnalyticsSwipesResponse,
  type BillingAnomaliesResponse,
  type MerchantLedgerResponse,
  type MerchantProductsResponse,
  type UsageResponse,
} from '@curtain/schema';
import { dayIso } from '@/lib/format';

export function mockProducts(): MerchantProductsResponse {
  const items = MOCK_GARMENTS.slice(0, 24).map((g, i) => {
    const draft = i % 5 === 3 ? { ...g, fabric: undefined, sizeChartType: undefined } : i % 7 === 6 ? { ...g, flatLayPhoto: undefined } : g;
    const c = completenessScore(draft);
    return {
      externalId: g.id,
      name: g.name,
      category: g.category,
      status: c.status,
      score: c.score,
      missingFields: c.missing.map((m) => m.field),
      flatLayProcessedUrl: null,
      updatedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
    };
  });
  return {
    items,
    nextCursor: null,
    counts: { active: items.filter((i) => i.status === 'active').length, incomplete: items.filter((i) => i.status === 'incomplete').length, archived: 0 },
  };
}

export function mockUsage(from: string, to: string): UsageResponse {
  const days: UsageResponse['days'] = [];
  const start = new Date(from);
  const end = new Date(to);
  let fit = 0;
  let hero = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const f = 18 + ((d.getUTCDate() * 7) % 23);
    const h = d.getUTCDay() === 6 ? 3 : 1;
    fit += f;
    hero += h;
    days.push({ day: dayIso(d), fitSessions: f, heroRenders: h, costUsd: Math.round(h * 0.075 * 100) / 100 });
  }
  return {
    from,
    to,
    days,
    totals: { fitSessions: fit, heroRenders: hero, costUsd: Math.round(hero * 0.075 * 100) / 100 },
    plan: { name: 'curtain', includedSessions: 5000, overageEurPerSession: 0, priceUsdPerMonth: 8.99, periodStart: from, periodEnd: to, sessionsUsedThisPeriod: fit, paused: false },
  };
}

export function mockAnalytics(from: string, to: string): AnalyticsSwipesResponse {
  const byProduct = MOCK_GARMENTS.slice(0, 8).map((g, i) => ({
    externalId: g.id,
    love: 40 + i * 7,
    pass: 55 - i * 3,
    save: 12 + i,
    less: 6 + (i % 3),
    sizeHistogram: Object.fromEntries(g.sizeChart.map((r, j) => [r.size, 5 + ((j * 13 + i) % 17)])),
    passReasons: { fit: 9 + i, price: 4, colour: 3, style: 7, unknown: 2 },
  }));
  return {
    from,
    to,
    kAnonymityFloor: 5,
    suppressedGroups: 3,
    byProduct,
    byColour: [
      { hue: 'orange', love: 120, pass: 80, save: 30, less: 10 },
      { hue: 'blue', love: 90, pass: 110, save: 22, less: 14 },
      { hue: 'white', love: 70, pass: 60, save: 18, less: 6 },
    ],
    byFabric: [
      { fabric: 'linen', love: 150, pass: 90, save: 40, less: 9 },
      { fabric: 'denim', love: 80, pass: 120, save: 20, less: 20 },
      { fabric: 'silk', love: 60, pass: 50, save: 25, less: 5 },
    ],
    bySize: [
      { size: 'S', love: 70, pass: 60, save: 20, less: 8 },
      { size: 'M', love: 140, pass: 100, save: 45, less: 12 },
      { size: 'L', love: 90, pass: 110, save: 25, less: 14 },
    ],
  };
}

export function mockLedger(): MerchantLedgerResponse {
  return {
    entries: [
      { id: '7a9f3b2e-1c4d-4e5f-8a6b-0c1d2e3f4a5b', at: new Date(Date.now() - 2 * 3_600_000).toISOString(), kind: 'hero_render', productExternalId: 'aalter-studio-1', provider: 'fashn', model: 'tryon-v1.6', retentionHours: 24, inputs: ['avatarRender', 'flatLayPhoto'] },
      { id: '2b8c4d6e-9f0a-4b1c-8d2e-3f4a5b6c7d8e', at: new Date(Date.now() - 26 * 3_600_000).toISOString(), kind: 'hero_render', productExternalId: 'monochrome-02', provider: 'fashn', model: 'tryon-v1.6', retentionHours: 24, inputs: ['avatarRender', 'flatLayPhoto', 'metadataPrompt'] },
    ],
    nextCursor: null,
  };
}

/** Mock opens/abandoned counts derived from the mock usage (the live console reads GET /v1/merchant/analytics/abandoned). */
export function mockAbandoned(usage: UsageResponse): { opens: number; abandoned: number } {
  const opens = Math.round(usage.totals.fitSessions * 1.6);
  return { opens, abandoned: opens - usage.totals.fitSessions };
}

/** Standalone (on-page) fit sizes, same shape as GET /v1/merchant/analytics/fit-sizes. */
export function mockFitSizes(from: string, to: string): AnalyticsFitSizesResponse {
  const bySize = [
    { size: 'S', sessions: 64 },
    { size: 'M', sessions: 131 },
    { size: 'L', sessions: 88 },
    { size: 'XL', sessions: 21 },
  ];
  return { from, to, kAnonymityFloor: 5, suppressedGroups: 1, bySize, totals: { sessions: bySize.reduce((n, s) => n + s.sessions, 0) } };
}

/** Same shape as GET /v1/merchant/analytics/abandoned. */
export function mockAbandonedAnalytics(from: string, to: string, usage: UsageResponse): AnalyticsAbandonedResponse {
  const { opens, abandoned } = mockAbandoned(usage);
  return { from, to, kAnonymityFloor: 5, suppressedGroups: 2, totals: { sessions: opens, resolved: opens - Math.round(abandoned / 2), withFit: opens - abandoned }, byProduct: [] };
}

/** Same shape as GET /v1/merchant/usage/anomalies: one capped day in the range. */
export function mockAnomalies(from: string, to: string): BillingAnomaliesResponse {
  const day = dayIso(new Date(new Date(to).getTime() - 3 * 86_400_000));
  return {
    from,
    to,
    dailyCap: 334,
    today: { day: to, billedSessions: 27, trailingAverage: 28.4, spikeThreshold: 86, capReached: false, spike: false },
    anomalies: [
      { day, kind: 'spike', billedSessions: 212, deniedSessions: 0, threshold: 86, trailingAverage: 28.1, firstAt: `${day}T09:12:00.000Z`, lastAt: `${day}T21:40:00.000Z` },
    ],
  };
}
