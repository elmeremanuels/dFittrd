/**
 * The facts behind the merchant's first-run checklist (`merchantSetupSteps` in @curtain/schema), read from
 * the shop's own rows: its products, its try sessions and its fit-session counts. Nothing about a shopper
 * is read or returned (rule 4): counts and the shop's own product pages only.
 */
import { and, asc, eq, gte, ne, sql } from 'drizzle-orm';
import { hasShopMeasurements, merchantSetupSteps, type SetupPlatform, type SetupResponse } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { products, trySessions, type ShopSettings } from '../db/schema.js';
import { qrSvg } from '../lib/qr.js';
import { utcDay } from '../lib/time.js';
import { fitSessionsBetween } from './usage.js';

const DAY = 86_400_000;

export interface SetupInput {
  db: Db;
  shop: { id: string; platform: SetupPlatform; settings: ShopSettings };
  now: Date;
  /** Shopify keeps these two in an AppInstallation metafield; the other platforms in the shop's settings. */
  buttonConfirmed?: boolean;
  phoneConfirmed?: boolean;
}

/** https only: a product page we would show as a link and a QR code. */
function safeHttpsUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export async function merchantSetup(input: SetupInput): Promise<SetupResponse> {
  const { db, shop, now } = input;
  const rows = await db
    .select({ externalId: products.externalId, status: products.status, category: products.category, missingFields: products.missingFields, payload: products.payload })
    .from(products)
    .where(and(eq(products.shopId, shop.id), ne(products.status, 'archived')))
    .orderBy(asc(products.externalId));
  const withChart = rows.filter((r) => !r.missingFields.includes('sizeChart') && !r.missingFields.includes('sizeChartType'));
  const measured = rows.filter((r) => hasShopMeasurements(r.payload.garmentTape));
  const [opened] = await db
    .select({ n: sql<number>`count(*)::int`, shown: sql<number>`count(${trySessions.fitShownAt})::int` })
    .from(trySessions)
    .where(and(eq(trySessions.shopId, shop.id), gte(trySessions.createdAt, new Date(now.getTime() - 30 * DAY))));
  // Sizes shown: the counted fit sessions, or (when higher) every size shown on a product page, also the ones
  // that are not counted (a theme preview, the merchant's own second try on the same day).
  const fitSessions = Math.max(await fitSessionsBetween(db, shop.id, utcDay(new Date(now.getTime() - 29 * DAY)), utcDay(now)), opened?.shown ?? 0);
  const progress = merchantSetupSteps(
    {
      connected: true,
      productsTotal: rows.length,
      productsWithChart: withChart.length,
      productsMeasured: measured.length,
      buttonOpened: (opened?.n ?? 0) > 0,
      fitSessions,
      buttonConfirmed: input.buttonConfirmed ?? shop.settings.setupButtonConfirmed === true,
      phoneConfirmed: input.phoneConfirmed ?? shop.settings.setupPhoneConfirmed === true,
    },
    shop.platform,
  );

  // "Measure one skirt": a skirt (bottom) that has a chart but no measurements yet, else any bottom, else any product with a chart.
  const bottoms = withChart.filter((r) => r.category === 'bottom');
  const pick = bottoms.find((r) => !hasShopMeasurements(r.payload.garmentTape)) ?? bottoms[0] ?? withChart.find((r) => !hasShopMeasurements(r.payload.garmentTape)) ?? withChart[0] ?? null;
  // "Check it on your phone": a product that gives a size, the measured one first.
  const tryable = rows.filter((r) => r.status === 'active' && safeHttpsUrl(r.payload.productUrl));
  const phone = tryable.find((r) => hasShopMeasurements(r.payload.garmentTape)) ?? tryable[0] ?? null;
  const phoneUrl = phone ? safeHttpsUrl(phone.payload.productUrl) : null;
  return {
    ...progress,
    platform: shop.platform,
    measureProduct: pick ? { externalId: pick.externalId, name: pick.payload.name } : null,
    phoneCheck: phone && phoneUrl ? { externalId: phone.externalId, name: phone.payload.name, url: phoneUrl, qrSvg: await qrSvg(phoneUrl) } : null,
  };
}
