/**
 * The merchant's own choices (D24), behind `GET/PUT /v1/merchant/settings` (the console, the
 * WooCommerce plugin) and `GET/PUT /shopify/settings` (the Shopify embedded admin). A fixed list of
 * keys, each named in the DTOs: nothing else of the shop's stored settings (billing, operator
 * switches) is read or written here.
 */
import type { MerchantSettingsResponse, MerchantSettingsUpdateRequest } from '@curtain/schema';
import type { Db } from '../db/client.js';
import { notFound } from '../lib/errors.js';
import { reapplyIncompleteProductData } from './products.js';
import { patchSettings, type ShopRow } from './shops.js';

export function merchantSettings(shop: ShopRow): MerchantSettingsResponse {
  return {
    incompleteProductData: shop.incompleteProductData,
    showFitByCurtain: shop.settings.showFitByCurtain !== false,
    shopName: shop.name,
    platform: shop.platform,
    brandColor: shop.settings.brandColor ?? null,
    logoUrl: shop.settings.logoUrl ?? null,
  };
}

export async function updateMerchantSettings(input: { db: Db; shop: ShopRow; body: MerchantSettingsUpdateRequest; now: Date }): Promise<MerchantSettingsResponse> {
  const { db, shop, body: b, now } = input;
  // Only the keys named here are written, and each on the stored row as it is now (patchSettings):
  // billing and operator keys are untouched, also when another request changed them since auth.
  const set: Partial<ShopRow['settings']> = {};
  const remove: Array<keyof ShopRow['settings']> = [];
  if (b.showFitByCurtain !== undefined) set.showFitByCurtain = b.showFitByCurtain;
  if (b.brandColor === null) remove.push('brandColor');
  else if (b.brandColor !== undefined) set.brandColor = b.brandColor;
  if (b.logoUrl === null) remove.push('logoUrl');
  else if (b.logoUrl !== undefined) set.logoUrl = b.logoUrl;
  const policy = b.incompleteProductData;
  const policyChanged = policy !== undefined && policy !== shop.incompleteProductData;
  const settingsChanged = b.showFitByCurtain !== undefined || b.brandColor !== undefined || b.logoUrl !== undefined;
  if (!policyChanged && !settingsChanged) return merchantSettings(shop);
  const row = await patchSettings(db, shop.id, { set, remove }, { ...(policyChanged ? { incompleteProductData: policy } : {}), updatedAt: now });
  if (!row) throw notFound('shop');
  // The products the shop already has follow the new choice (held back, or released).
  if (policyChanged) await reapplyIncompleteProductData(db, shop.id, policy);
  return merchantSettings(row);
}
