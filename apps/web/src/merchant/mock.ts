/**
 * Mock console data, used only when the API is unreachable (no secret, no real shop). Shapes are
 * the real DTOs so the console renders exactly what the backend will send.
 */
import {
  bakeCheckRefusal,
  completenessScore,
  hasShopMeasurements,
  merchantSetupSteps,
  productNextStep,
  sizeAdviceScore,
  type SetupResponse,
  PILOT_PULL_ON_SKIRT,
  garmentQaFlagNote,
  type BakeCheckReport,
  type MerchantGarmentAsset,
  MOCK_GARMENTS,
  type AnalyticsAbandonedResponse,
  type AnalyticsFitSizesResponse,
  type AnalyticsPeriodsResponse,
  type AnalyticsSwipesResponse,
  type BillingAnomaliesResponse,
  type MerchantLedgerResponse,
  type MerchantProductsResponse,
  type MerchantSettingsResponse,
  type UsageResponse,
} from '@curtain/schema';
import { dayIso } from '@/lib/format';
import MOCK_BAKE_CHECKS from './mockBakeChecks.json';

function nextOf(status: 'active' | 'incomplete', category: string, missingFields: string[], measured: boolean) {
  const p = { status, category, missingFields, measured };
  return { measured, next: productNextStep(p), adviceScore: sizeAdviceScore(p) };
}

export function mockProducts(): MerchantProductsResponse {
  // The pilot skirt (tape-built 3D versions in `mockAssets`) first, then the mock catalogue.
  const items = [PILOT_PULL_ON_SKIRT, ...MOCK_GARMENTS.slice(0, 23)].map((g, i) => {
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
      ...nextOf(c.status, g.category, c.missing.map((m) => m.field), hasShopMeasurements(draft.garmentTape)),
      updatedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
      notices: { defaulted: [] as string[], leftOut: [] as { field: string; reason: string }[] },
    };
  });
  // Incomplete fabric details (D25 point 1), as the api reports them: a stretch that was not valid
  // and was left out, a product with no stretch at all, and one the shop's setting holds back.
  const [, leftOut, noStretch, , held] = items;
  if (leftOut && leftOut.status === 'active') leftOut.notices = { defaulted: ['fabric.stretchPct'], leftOut: [{ field: 'fabric.stretchPct', reason: 'Too big: expected number to be <=100' }] };
  if (noStretch && noStretch.status === 'active') noStretch.notices = { defaulted: ['fabric.stretchPct', 'fabric.drape'], leftOut: [] };
  if (held) Object.assign(held, { status: 'incomplete' as const, heldBack: { reason: 'incomplete_product_data' as const, fields: ['fabric.stretchPct'] } });
  return {
    items,
    nextCursor: null,
    counts: { active: items.filter((i) => i.status === 'active').length, incomplete: items.filter((i) => i.status === 'incomplete').length, archived: 0 },
  };
}

export function mockSettings(): MerchantSettingsResponse {
  return { incompleteProductData: 'let-through', showFitByCurtain: true, shopName: 'Aalter Studio', platform: 'woocommerce', brandColor: '#2F4F3A', logoUrl: null };
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

/** The last closed month and the two before it, as GET /v1/merchant/analytics/periods would answer today. */
export function mockPeriods(now = new Date()): AnalyticsPeriodsResponse {
  // a month is served from the second day of the next month (ANALYTICS_PERIOD_GRACE_HOURS)
  const grace = new Date(now.getTime() - 86_400_000);
  const month = (offset: number) => new Date(Date.UTC(grace.getUTCFullYear(), grace.getUTCMonth() + offset, 1)).toISOString().slice(0, 7);
  return {
    granularity: 'month',
    kAnonymityFloor: 5,
    periods: [month(-1), month(-2), month(-3)],
    openPeriod: month(0),
    openPeriodAvailableAt: new Date(Date.UTC(grace.getUTCFullYear(), grace.getUTCMonth() + 1, 2)).toISOString(),
  };
}

function mockPeriodFields(period: string, suppression: { belowFloor: number; complementary: number }) {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { period, from, to, kAnonymityFloor: 5, suppressedGroups: suppression.belowFloor + suppression.complementary, suppression };
}

export function mockAnalytics(period: string): AnalyticsSwipesResponse {
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
    ...mockPeriodFields(period, { belowFloor: 2, complementary: 1 }),
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
export function mockFitSizes(period: string): AnalyticsFitSizesResponse {
  const bySize = [
    { size: 'S', sessions: 64 },
    { size: 'M', sessions: 131 },
    { size: 'L', sessions: 88 },
    { size: 'XL', sessions: 21 },
  ];
  return { ...mockPeriodFields(period, { belowFloor: 1, complementary: 1 }), bySize, totals: { sessions: bySize.reduce((n, s) => n + s.sessions, 0) } };
}

/** Same shape as GET /v1/merchant/analytics/abandoned. */
export function mockAbandonedAnalytics(period: string, usage: UsageResponse): AnalyticsAbandonedResponse {
  const { opens, abandoned } = mockAbandoned(usage);
  return { ...mockPeriodFields(period, { belowFloor: 2, complementary: 0 }), totals: { sessions: opens, resolved: opens - Math.round(abandoned / 2), withFit: opens - abandoned }, byProduct: [] };
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

/**
 * The 3D versions of a product in demo mode: one refused by the automatic bake check, one that passed and waits for
 * approval, and one imported before the check existed (flagged). The two reports are real output of the check
 * (`checkDrapeBake`) on the POM v2 tape-built fixture of the pilot skirt and on a copy with a wrong tape
 * (mockBakeChecks.json, see docs/reports/claude/bake-qa-gate.md).
 */
export function mockAssets(productExternalId: string): MerchantGarmentAsset[] {
  if (productExternalId !== PILOT_PULL_ON_SKIRT.id) return [];
  const { bytes, pass, refused } = MOCK_BAKE_CHECKS as unknown as { bytes: number; pass: BakeCheckReport; refused: BakeCheckReport };
  const common = { productExternalId, bytes, baseSize: '12', sizes: ['8', '10', '12', '14', '16'], qaPass: true };
  return [
    { ...common, id: '00000000-0000-4000-8000-00000000a003', version: '7c1e9a40d2b35f88', status: 'awaiting_approval', live: false, qaFlags: [], qaNotes: [], createdAt: pass.checkedAt, approvedAt: null, rejectReason: null, bakeCheck: pass },
    { ...common, id: '00000000-0000-4000-8000-00000000a002', version: '3fa0b6c19e7d2214', status: 'refused', live: false, qaFlags: ['tape_built_no_chart_check'], qaNotes: [], createdAt: refused.checkedAt, approvedAt: null, rejectReason: bakeCheckRefusal(refused), bakeCheck: refused },
    {
      ...common, id: '00000000-0000-4000-8000-00000000a001', version: '91d4c0e7a6b8f305', status: 'superseded', live: false,
      qaFlags: ['tape_built_no_chart_check'], qaNotes: [garmentQaFlagNote('tape_built_no_chart_check', {})],
      createdAt: '2026-11-18T09:02:00.000Z', approvedAt: '2026-11-18T09:30:00.000Z', rejectReason: null,
    },
  ];
}

/** The first-run checklist for the demo data (the real @curtain/schema list, from the demo products). */
export function mockSetup(products: MerchantProductsResponse): SetupResponse {
  const live = products.items.filter((p) => p.status !== 'archived');
  const withChart = live.filter((p) => !p.missingFields.includes('sizeChart') && !p.missingFields.includes('sizeChartType'));
  const progress = merchantSetupSteps(
    { connected: true, productsTotal: live.length, productsWithChart: withChart.length, productsMeasured: live.filter((p) => p.measured).length, buttonOpened: true, fitSessions: 0, buttonConfirmed: false, phoneConfirmed: false },
    'woocommerce',
  );
  return { ...progress, platform: 'woocommerce', measureProduct: withChart[0] ? { externalId: withChart[0].externalId, name: withChart[0].name } : null, phoneCheck: null };
}
