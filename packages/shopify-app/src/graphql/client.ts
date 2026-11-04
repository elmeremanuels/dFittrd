/**
 * Minimal Admin GraphQL client: pure `fetch`, offline access token, cost-aware retry on
 * THROTTLED / 429 / 5xx. No SDK dependency (D2: one Node process, few moving parts).
 */
import { DEFAULT_API_VERSION, defaultSleep, isShopifyDomain, type FetchLike, type SleepFn } from '../types';

export interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

export type ShopifyGraphqlErrorCode = 'http' | 'graphql' | 'non_json' | 'empty' | 'user_errors' | 'unauthorized' | 'invalid_domain';

export class ShopifyGraphqlError extends Error {
  constructor(
    message: string,
    public readonly code: ShopifyGraphqlErrorCode,
    public readonly status?: number,
    public readonly errors?: unknown,
  ) {
    super(message);
    this.name = 'ShopifyGraphqlError';
  }
}

export interface GraphqlCostExtensions {
  cost?: {
    requestedQueryCost?: number;
    actualQueryCost?: number | null;
    throttleStatus?: { maximumAvailable?: number; currentlyAvailable?: number; restoreRate?: number };
  };
}

export interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } & Record<string, unknown> }>;
  extensions?: GraphqlCostExtensions;
}

export interface AdminClientOptions {
  shopDomain: string;
  accessToken: string;
  apiVersion?: string;
  fetch?: FetchLike;
  /** Retries for THROTTLED / 429 / 5xx (default 2). */
  maxRetries?: number;
  sleep?: SleepFn;
  /** Default `https://{shop}/admin/api/{version}/graphql.json`; the api overrides it for tests. */
  adminUrlTemplate?: string;
}

export interface AdminGraphqlClient {
  readonly shopDomain: string;
  readonly apiVersion: string;
  readonly url: string;
  request<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export const DEFAULT_ADMIN_URL_TEMPLATE = 'https://{shop}/admin/api/{version}/graphql.json';

export function adminGraphqlUrl(shopDomain: string, apiVersion: string = DEFAULT_API_VERSION, template: string = DEFAULT_ADMIN_URL_TEMPLATE): string {
  return template.replace('{shop}', shopDomain).replace('{version}', apiVersion);
}

/** Seconds to wait before retrying a THROTTLED response, derived from the cost extension (min 1 s). */
export function throttleDelaySeconds(ext: GraphqlCostExtensions | undefined): number {
  const cost = ext?.cost;
  const requested = cost?.requestedQueryCost ?? 0;
  const available = cost?.throttleStatus?.currentlyAvailable ?? 0;
  const restore = cost?.throttleStatus?.restoreRate ?? 50;
  const deficit = Math.max(0, requested - available);
  return Math.max(1, Math.ceil(deficit / Math.max(1, restore)));
}

export function createAdminClient(opts: AdminClientOptions): AdminGraphqlClient {
  const shopDomain = opts.shopDomain.toLowerCase();
  if (!isShopifyDomain(shopDomain)) throw new ShopifyGraphqlError(`invalid shop domain '${opts.shopDomain}'`, 'invalid_domain');
  const apiVersion = opts.apiVersion ?? DEFAULT_API_VERSION;
  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike);
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 2;
  const url = adminGraphqlUrl(shopDomain, apiVersion, opts.adminUrlTemplate);

  async function once<T>(query: string, variables: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; retryAfterMs: number; error: ShopifyGraphqlError }> {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-shopify-access-token': opts.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    let body: GraphqlResponse<T> = {};
    let nonJson = false;
    if (text) {
      try {
        body = JSON.parse(text) as GraphqlResponse<T>;
      } catch {
        nonJson = true;
      }
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, retryAfterMs: -1, error: new ShopifyGraphqlError(`Shopify rejected the access token (${res.status})`, 'unauthorized', res.status, body.errors) };
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') ?? '2');
      return { ok: false, retryAfterMs: (Number.isFinite(ra) && ra > 0 ? ra : 2) * 1000, error: new ShopifyGraphqlError('Shopify rate limit (429)', 'http', 429, body.errors) };
    }
    if (res.status >= 500) {
      return { ok: false, retryAfterMs: 1000, error: new ShopifyGraphqlError(`Shopify GraphQL HTTP ${res.status}`, 'http', res.status, body.errors ?? text) };
    }
    if (!res.ok) {
      return { ok: false, retryAfterMs: -1, error: new ShopifyGraphqlError(`Shopify GraphQL HTTP ${res.status}`, 'http', res.status, body.errors ?? text) };
    }
    if (nonJson) {
      return { ok: false, retryAfterMs: -1, error: new ShopifyGraphqlError(`Shopify returned non-JSON (${res.status})`, 'non_json', res.status, text.slice(0, 200)) };
    }
    if (body.errors?.length) {
      const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED');
      const error = new ShopifyGraphqlError(body.errors.map((e) => e.message).join('; '), 'graphql', res.status, body.errors);
      return { ok: false, retryAfterMs: throttled ? throttleDelaySeconds(body.extensions) * 1000 : -1, error };
    }
    if (body.data === undefined || body.data === null) {
      return { ok: false, retryAfterMs: -1, error: new ShopifyGraphqlError('Shopify GraphQL: empty data', 'empty', res.status) };
    }
    return { ok: true, data: body.data };
  }

  return {
    shopDomain,
    apiVersion,
    url,
    async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
      let attempt = 0;
      for (;;) {
        const r = await once<T>(query, variables);
        if (r.ok) return r.data;
        if (r.retryAfterMs < 0 || attempt >= maxRetries) throw r.error;
        attempt += 1;
        await sleep(r.retryAfterMs);
      }
    },
  };
}

/** Throw a `user_errors` ShopifyGraphqlError when a mutation payload reports userErrors. */
export function assertNoUserErrors(errors: ReadonlyArray<UserError> | null | undefined, context: string): void {
  if (!errors || errors.length === 0) return;
  const msg = errors.map((e) => (e.field?.length ? `${e.field.join('.')}: ${e.message}` : e.message)).join('; ');
  throw new ShopifyGraphqlError(`${context}: ${msg}`, 'user_errors', undefined, errors);
}
