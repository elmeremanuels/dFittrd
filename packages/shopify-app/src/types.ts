/**
 * Shared primitives for the Shopify helpers. Nothing here reads the environment: apps/api/src/env.ts
 * is the only reader of secrets and passes them in (AGENTS.md hard rule 2).
 */

/** `fetch`-compatible function so tests and the api can inject their own. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The ONE place the Shopify Admin API version is pinned. Everything else re-uses it: the api's
 * `SHOPIFY_API_VERSION` default (apps/api/src/env.ts), `APP_CONFIG_DEFAULTS` (shopify.app.toml
 * `[webhooks].api_version`), `signWebhook`. `infra/.env.example` repeats the value (a test keeps it
 * in sync). 2026-10 is the latest stable version as of Nov 2026, supported until Oct 2027
 * (https://shopify.dev/docs/api/usage/versioning). Bump each quarter after reading the release notes.
 */
export const DEFAULT_API_VERSION = '2026-10' as const;

/** The app's credentials from the Partner Dashboard (client_id / client_secret). */
export interface ShopifyAppCredentials {
  apiKey: string;
  apiSecret: string;
}

const MYSHOPIFY_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const SHOPIFY_RE = /^[a-z0-9][a-z0-9-]*\.shopify\.com$/;

/** `x.myshopify.com` (or a `*.shopify.com` host for Plus/dev tooling). Lower-case input expected. */
export function isShopifyDomain(host: string): boolean {
  return MYSHOPIFY_RE.test(host) || SHOPIFY_RE.test(host);
}

/**
 * Normalise what merchants/App Bridge hand us (`https://x.myshopify.com/admin`, `x.myshopify.com`,
 * `x`) into the canonical `x.myshopify.com`, or `null` if it cannot be a Shopify shop.
 */
export function normaliseShopDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  // Unified admin (`https://admin.shopify.com/store/<handle>/…`): the store handle is the shop.
  const unified = /^(?:https?:\/\/)?admin\.shopify\.com(?::\d+)?(?:\/store\/([a-z0-9][a-z0-9-]*))?(?:[/?#]|$)/.exec(s);
  if (unified) return unified[1] ? `${unified[1]}.myshopify.com` : null;
  if (s.includes('://')) {
    try {
      s = new URL(s).host;
    } catch {
      return null;
    }
  }
  s = s.replace(/\/.*$/, '').replace(/:\d+$/, '');
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  return isShopifyDomain(s) ? s : null;
}

/** Sleep helper that tests can replace. */
export type SleepFn = (ms: number) => Promise<void>;
export const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
