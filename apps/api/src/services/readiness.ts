/**
 * The men's gate (decision D20 point 3, docs/research/men-3d-plan.md section 6, slice M0): the ONE
 * place that decides whether a product is ready for the shopper experience.
 *
 * Rule: no men's product goes live with a 2D figure only. A product whose payload says
 * `audience: 'men'` is shown with the full 3D experience or not at all; until then every route
 * that serves product or fit data answers "Men's clothing: coming soon" with no garment, no 2D
 * figure and no size advice. Every such route calls `shopperReadiness` (or `withoutComingSoon` for
 * a list) and nothing else decides this:
 *
 *   GET  /v1/try/:token              422 `men_coming_soon`, before pairing or resolving
 *   POST /v1/try/:token/fit-shown    never billed
 *   POST /v1/swipes                  stored without size and fit score, never billed    (flat)
 *   POST /v1/sdk/sessions            `productState: 'coming_soon'` next to the usual body
 *   GET  /v1/peek                    404, like any product the button cannot open       (flat)
 *   GET  /v1/shops/:shopId/products  left out of the list                               (flat)
 *   GET  /v1/products/:id            422 `men_coming_soon`                              (flat)
 *   POST /v1/renders/hero            422 `men_coming_soon`                              (flat)
 *   GET  /v1/renders/:jobId[/:kind]  404 for a render queued before the gate            (flat)
 *   GET  /v1/fit/cohort/:productId   the shop's rows left out (no size histogram)       (flat)
 *   GET  /v1/merchant/products       `menGate` per product (the merchant's badge)
 *
 * Surfaces. Only the standalone overlay has a 3D view (`surface: 'embed'` try sessions). The
 * routes marked (flat) feed surfaces that draw the 2D figure only: the size peek, the app's deck
 * and product page, the hero render of the avatar drawing, and the cohort's size histogram. On
 * those a gated men's product is always coming soon, also when its 3D bundle is live, because
 * showing it there would be a men's product with a 2D figure only. The same holds for a try
 * session opened in app mode (`surface` 'button' or 'api').
 *
 * What is NOT gated, so it keeps today's behaviour byte for byte:
 *  - the gate is off (`MEN_3D_GATE`, default off; read in env.ts only);
 *  - `audience` is `women`, `unisex` or absent (the plan's conflict and no-signal cases are founder
 *    decisions and are not built);
 *  - the audience `men` was read from a title or a collection only (`isWeakAudienceSource`): a
 *    guess from free text must not hide a product before the merchant confirms it. The merchant
 *    list marks it `audience_unconfirmed`;
 *  - the source of the audience is unknown (null): a row stored before the column existed, or
 *    written through the merchant API by a caller that did not say (`?audienceSource=`). The value
 *    may be the same guess from a title (the WooCommerce plugin infers it itself), so it is not
 *    gated either and is marked `audience_unconfirmed` until a sync reports a strong source;
 *  - men's shoes and accessories, unless `MEN_3D_GATE_SHOES_ACCESSORIES` is on (open founder
 *    question; they have no 3D for anyone).
 *
 * A gated men's product is ready only when all of these hold (plan conditions 2 and 4):
 *  - the product is try-able (category, chart type and chart present);
 *  - the shop has the 3D estimate on, the merchant approved the bundle and it still covers the live
 *    chart (`activeAsset`, D13/D16);
 *  - the bundle was built on the male mannequin (`assetMannequinFamily`).
 * Then `GET /v1/try` sends the asset with `requires3d: true`, and the embed must end in the
 * coming-soon screen when the 3D view fails on the device (no 2D fallback). The garment is only
 * sent to a client that says it enforces that rule (`?caps=requires3d`, `TRY_CAP_REQUIRES_3D`); an
 * embed build from before the rule gets the coming-soon answer.
 *
 * Not gated on purpose: `GET /v1/wardrobe` and `GET /v1/me/export` return what the device itself
 * stored earlier (the shopper's own data, D3), not new advice.
 *
 * Not built in M0 (they need later slices and no bundle can pass before them): plan condition 1
 * (the supported men's garment types, section 2) and condition 3 (men's chart columns, M2a).
 */
import { and, eq, sql } from 'drizzle-orm';
import { MEN_COMING_SOON_CODE, isWeakAudienceSource, type GarmentAssetRef, type GarmentPayload } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { products } from '../db/schema.js';
import type { Env } from '../env.js';
import { unprocessable, type HttpError } from '../lib/errors.js';
import { activeAsset, assetMannequinFamily } from './assets.js';
import { asTryGarment, type ProductRow } from './products.js';
import { findShopById, type ShopRow } from './shops.js';

/** Why a gated men's product is not ready (for the merchant badge and the logs; never sent to shoppers). */
export type ComingSoonReason = 'flat_surface' | 'product_incomplete' | 'shop_3d_off' | 'no_approved_bundle' | 'not_male_bundle' | 'client_without_3d_rule';

/** `overlay`: the standalone embed, which has the 3D view. `flat`: a surface that draws the 2D figure only. */
export type ShopperSurface = 'overlay' | 'flat';

/** The surface a try session was minted for: only `embed` sessions open the overlay with the 3D view. */
export const surfaceOfSession = (sdkSurface: string): ShopperSurface => (sdkSurface === 'embed' ? 'overlay' : 'flat');

export type ShopperReadiness =
  /** Not a gated men's product: today's flow, unchanged. */
  | { state: 'ready'; requires3d: false }
  /** A men's product with the full 3D experience: only shown with this asset and a working 3D view. */
  | { state: 'ready'; requires3d: true; garment: GarmentPayload; asset: GarmentAssetRef }
  | { state: 'coming_soon'; reason: ComingSoonReason };

const UNGATED: ShopperReadiness = { state: 'ready', requires3d: false };

/** Categories behind `MEN_3D_GATE_SHOES_ACCESSORIES` (open founder question; default: not gated). */
export const MEN_GATE_OPEN_CATEGORIES: readonly string[] = ['shoes', 'accessory'];

type GateEnv = Pick<Env, 'MEN_3D_GATE' | 'MEN_3D_GATE_SHOES_ACCESSORIES'>;
type GateProduct = Pick<ProductRow, 'payload' | 'category' | 'audienceSource'>;

/**
 * Whether the gate applies to a product at all (no I/O). `unconfirmed`: a men's product whose
 * audience is a guess from a title or a collection, or whose source is unknown (null), so it is
 * not gated until a strong source confirms it. Only a known strong source gates.
 */
export function menGateScope(env: GateEnv, product: GateProduct): 'none' | 'unconfirmed' | 'gated' {
  if (!env.MEN_3D_GATE) return 'none';
  if (product.payload.audience !== 'men') return 'none';
  const category = product.payload.category ?? product.category;
  if (!env.MEN_3D_GATE_SHOES_ACCESSORIES && category && MEN_GATE_OPEN_CATEGORIES.includes(category)) return 'none';
  if (!product.audienceSource || isWeakAudienceSource(product.audienceSource)) return 'unconfirmed';
  return 'gated';
}

/**
 * THE helper: the state of one product for shoppers on one surface. Pass the shop row when the
 * route has it; otherwise it is loaded, and only for a gated men's product (no extra query for
 * anything else).
 *
 * `enforces3dRule: false`: the client did not say it enforces "3D or nothing" (GET /v1/try without
 * `caps=requires3d`), so a product that would be ready with `requires3d` is coming soon for it.
 */
export async function shopperReadiness(
  ctx: { db: Db; env: Env },
  product: ProductRow,
  on: { surface: ShopperSurface; shop?: ShopRow; enforces3dRule?: boolean },
): Promise<ShopperReadiness> {
  if (menGateScope(ctx.env, product) !== 'gated') return UNGATED;
  if (on.surface === 'flat') return { state: 'coming_soon', reason: 'flat_surface' };
  if (on.enforces3dRule === false) return { state: 'coming_soon', reason: 'client_without_3d_rule' };
  const owner = on.shop ?? (await findShopById(ctx.db, product.shopId));
  const garment = owner ? asTryGarment(product, { colorHex: owner.settings.brandColor ?? undefined }) : null;
  if (!owner || !garment) return { state: 'coming_soon', reason: 'product_incomplete' };
  if (owner.settings.garment3d !== true) return { state: 'coming_soon', reason: 'shop_3d_off' };
  const active = await activeAsset(ctx.db, ctx.env, owner, product, garment);
  if (!active) return { state: 'coming_soon', reason: 'no_approved_bundle' };
  if (assetMannequinFamily(active.row) !== 'male') return { state: 'coming_soon', reason: 'not_male_bundle' };
  return { state: 'ready', requires3d: true, garment, asset: active.ref };
}

/** The 422 a route throws for a product in the coming-soon state: a code and a line, no product data. */
export function menComingSoon(): HttpError {
  return unprocessable(MEN_COMING_SOON_CODE, 'Men’s clothing: coming soon');
}

/** For the (flat) list route: keeps the rows that are ready for shoppers. Without the gate it returns the input untouched. */
export async function withoutComingSoon(ctx: { db: Db; env: Env }, rows: ProductRow[]): Promise<ProductRow[]> {
  if (!ctx.env.MEN_3D_GATE) return rows;
  const kept: ProductRow[] = [];
  for (const row of rows) if ((await shopperReadiness(ctx, row, { surface: 'flat' })).state === 'ready') kept.push(row);
  return kept;
}

/**
 * For the (flat) cohort route, which only has a product's external id: the shops whose product
 * with that id is in the coming-soon state. Their wardrobe rows are left out of the cohort, so a
 * gated men's product shows no size histogram, and a product of another shop that happens to share
 * the id (WooCommerce ids are small integers) keeps its own rows. With `shopId` only that shop is
 * read. Without the gate it answers [] and reads nothing.
 */
export async function comingSoonShopIds(ctx: { db: Db; env: Env }, externalId: string, shopId?: string): Promise<string[]> {
  if (!ctx.env.MEN_3D_GATE) return [];
  // Only men's rows can be gated; the filter keeps the read small and needs no limit.
  const men = sql`${products.payload}->>'audience' = 'men'`;
  const rows = await ctx.db
    .select()
    .from(products)
    .where(shopId ? and(eq(products.externalId, externalId), eq(products.shopId, shopId), men) : and(eq(products.externalId, externalId), men));
  const ids: string[] = [];
  for (const row of rows) if ((await shopperReadiness(ctx, row, { surface: 'flat' })).state === 'coming_soon') ids.push(row.shopId);
  return ids;
}

/** The merchant's badge for a product (`MerchantProductSummary.menGate`), or undefined. */
export async function merchantMenGate(ctx: { db: Db; env: Env }, product: ProductRow, shop: ShopRow): Promise<'coming_soon' | 'audience_unconfirmed' | undefined> {
  const scope = menGateScope(ctx.env, product);
  if (scope === 'none') return undefined;
  if (scope === 'unconfirmed') return 'audience_unconfirmed';
  return (await shopperReadiness(ctx, product, { surface: 'overlay', shop })).state === 'coming_soon' ? 'coming_soon' : undefined;
}
