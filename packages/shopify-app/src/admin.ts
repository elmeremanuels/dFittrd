/**
 * The embedded admin page (admin/index.html): static HTML + App Bridge from Shopify's CDN. The api
 * serves it at `ADMIN_PAGE_PATH` with the CSP below; the page gets a session token from App Bridge
 * and calls the merchant routes with `Authorization: Bearer <session token>`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESTIMATE_DISCLAIMER } from '@curtain/schema';
import { BLOCK_HANDLE } from './deepLinks';

export const ADMIN_PAGE_PATH = '/shopify/admin' as const;
export const APP_BRIDGE_SCRIPT_URL = 'https://cdn.shopify.com/shopifycloud/app-bridge.js' as const;

export interface AdminPageConfig {
  /** client_id — public, goes into `<meta name="shopify-api-key">`. */
  apiKey: string;
  /** Our API origin (PUBLIC_API_URL); the page fetches /shopify/* and /v1/merchant/* from it. */
  apiUrl: string;
  /** Consumer app origin (PUBLIC_APP_URL) for the "open Curtain" link. */
  appUrl: string;
  appHandle?: string;
  blockHandle?: string;
  /** Override the HTML template (tests). */
  template?: string;
}

/** Only the embedding admin may frame the page: the shop's own domain and admin.shopify.com. */
export function adminContentSecurityPolicy(shopDomain: string | null | undefined): string {
  const shop = shopDomain && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain) ? `https://${shopDomain} ` : '';
  return `frame-ancestors ${shop}https://admin.shopify.com;`;
}

let cachedTemplate: string | null = null;

export function adminPageTemplate(): string {
  if (cachedTemplate === null) {
    cachedTemplate = readFileSync(fileURLToPath(new URL('../admin/index.html', import.meta.url)), 'utf8');
  }
  return cachedTemplate;
}

/** JSON safe for a `<script type="application/json">` block (no `</script>` break-out). */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').split(LS).join('\\u2028').split(PS).join('\\u2029');
}

function attr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Render the page for one install. Pure string work; the api decides headers and caching. */
export function renderAdminPage(cfg: AdminPageConfig): string {
  if (!/^[a-f0-9]{32}$/i.test(cfg.apiKey) && !/^[A-Za-z0-9_-]{8,64}$/.test(cfg.apiKey)) throw new Error('renderAdminPage: apiKey does not look like a Shopify client id');
  for (const [k, v] of [
    ['apiUrl', cfg.apiUrl],
    ['appUrl', cfg.appUrl],
  ] as const) {
    if (!/^https?:\/\/[^\s"'<>]+$/.test(v)) throw new Error(`renderAdminPage: ${k} must be an http(s) origin`);
  }
  const config = {
    apiKey: cfg.apiKey,
    apiUrl: cfg.apiUrl.replace(/\/$/, ''),
    appUrl: cfg.appUrl.replace(/\/$/, ''),
    appHandle: cfg.appHandle ?? 'curtain',
    blockHandle: cfg.blockHandle ?? BLOCK_HANDLE,
    /** Hard rule 3: every render is labelled an estimate — the page shows this next to the ledger. */
    disclaimer: ESTIMATE_DISCLAIMER,
  };
  const html = cfg.template ?? adminPageTemplate();
  // Function replacers: a string replacement would interpret `$&`, `$'`, `` $` `` inside the values.
  return html
    .replace('__CURTAIN_SHOPIFY_API_KEY__', () => attr(config.apiKey))
    .replace('__CURTAIN_APP_BRIDGE_URL__', () => APP_BRIDGE_SCRIPT_URL)
    .replace('__CURTAIN_CONFIG_JSON__', () => jsonForScript(config));
}
