/**
 * Admin deep links used by the onboarding checklist (theme editor "add app block", product pages,
 * the app itself). Pure string builders.
 */
import { isShopifyDomain } from './types';

/** Directory name under extensions/ and the `handle` in its shopify.extension.toml. */
export const EXTENSION_HANDLE = 'try-button' as const;
/** `blocks/try-in-paskamer.liquid` → the block handle used in `addAppBlockId`. */
export const BLOCK_HANDLE = 'try-in-paskamer' as const;

export type ThemeEditorTarget = 'mainSection' | 'newAppsSection' | `sectionId:${string}` | `sectionGroup:${'header' | 'footer' | 'aside'}`;

export interface ThemeEditorLinkOptions {
  shopDomain: string;
  /** The app's client_id (api key). */
  apiKey: string;
  blockHandle?: string;
  /** JSON template name without `.json` (default `product`). */
  template?: string;
  target?: ThemeEditorTarget;
}

function assertShop(shopDomain: string): string {
  const s = shopDomain.toLowerCase();
  if (!isShopifyDomain(s)) throw new Error(`not a Shopify domain: ${shopDomain}`);
  return s;
}

/** Opens the theme editor with the "Try in Paskamer" block pre-added to the product template. */
export function themeEditorAddBlockUrl(opts: ThemeEditorLinkOptions): string {
  const shop = assertShop(opts.shopDomain);
  const params = new URLSearchParams({
    template: opts.template ?? 'product',
    addAppBlockId: `${opts.apiKey}/${opts.blockHandle ?? BLOCK_HANDLE}`,
    target: opts.target ?? 'mainSection',
  });
  return `https://${shop}/admin/themes/current/editor?${params.toString()}`;
}

export function adminProductUrl(shopDomain: string, externalId: string): string {
  const shop = assertShop(shopDomain);
  const id = externalId.replace(/^gid:\/\/shopify\/Product\//, '');
  if (!/^\d+$/.test(id)) throw new Error(`not a Shopify product id: ${externalId}`);
  return `https://${shop}/admin/products/${id}`;
}

/** The embedded app's home in the new admin (`admin.shopify.com/store/<store>/apps/<handle>`). */
export function adminAppUrl(shopDomain: string, appHandle: string): string {
  const shop = assertShop(shopDomain);
  const store = shop.replace(/\.myshopify\.com$/, '').replace(/\.shopify\.com$/, '');
  return `https://admin.shopify.com/store/${store}/apps/${encodeURIComponent(appHandle)}`;
}

/** Custom-distribution install link (Partner Dashboard → Distribution → Custom → generate). Shape only; the token comes from the dashboard. */
export function customInstallUrl(shopDomain: string, appHandle: string): string {
  const shop = assertShop(shopDomain);
  const store = shop.replace(/\.myshopify\.com$/, '');
  return `https://admin.shopify.com/store/${store}/oauth/install_custom_app?client_id=<from-partner-dashboard>&signature=<from-partner-dashboard>#${encodeURIComponent(appHandle)}`;
}
