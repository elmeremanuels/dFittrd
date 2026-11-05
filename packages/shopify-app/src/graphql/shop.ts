/**
 * Shop-level reads used at install / subscription time: the storefront's primary domain (the
 * standalone embed's postMessage target, docs/STANDALONE.md §2) and the currency Shopify bills the
 * merchant in (finding #6, see ../currency.ts).
 */
import type { AdminGraphqlClient } from './client';

export const PRIMARY_DOMAIN_QUERY = /* GraphQL */ `
  query CurtainPrimaryDomain { shop { primaryDomain { host } } }
`;

/**
 * `shopBillingPreferences.currency` is what Shopify bills the merchant in (apps and services);
 * `shop.currencyCode` is the store's selling currency, only a hint when the former is missing.
 * https://shopify.dev/docs/api/admin-graphql/latest/queries/shopBillingPreferences
 */
export const BILLING_CURRENCY_QUERY = /* GraphQL */ `
  query CurtainBillingCurrency { shopBillingPreferences { currency } shop { currencyCode } }
`;

const HOST_RE = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/;

/** The storefront's primary domain host (e.g. `shop.example`), lower-cased, or null. */
export async function fetchPrimaryDomainHost(client: AdminGraphqlClient): Promise<string | null> {
  const data = await client.request<{ shop?: { primaryDomain?: { host?: string | null } | null } | null }>(PRIMARY_DOMAIN_QUERY);
  const host = data.shop?.primaryDomain?.host?.toLowerCase() ?? null;
  return host && HOST_RE.test(host) ? host : null;
}

export interface BillingCurrencyInfo {
  /** `shopBillingPreferences.currency` (ISO 4217), or null when Shopify did not return it. */
  billingCurrency: string | null;
  /** `shop.currencyCode`, the store's selling currency. */
  shopCurrency: string | null;
}

const CODE_RE = /^[A-Z]{3}$/;
const code = (v: unknown): string | null => (typeof v === 'string' && CODE_RE.test(v.toUpperCase()) ? v.toUpperCase() : null);

export async function fetchBillingCurrency(client: AdminGraphqlClient): Promise<BillingCurrencyInfo> {
  const data = await client.request<{ shopBillingPreferences?: { currency?: string | null } | null; shop?: { currencyCode?: string | null } | null }>(BILLING_CURRENCY_QUERY);
  return { billingCurrency: code(data.shopBillingPreferences?.currency), shopCurrency: code(data.shop?.currencyCode) };
}
