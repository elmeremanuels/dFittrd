/**
 * Typed HTTP client for the one backend. Every DTO comes from @curtain/schema (API_ROUTES).
 *
 * Privacy (D3): the client can only send what these DTOs describe — there is no method that
 * takes a Blob/File, and `PersonInput.kind` is the closed literal 'avatarRender'. Every network
 * WRITE appends a client-side ledger entry `{ at, path, bytes, fields }` (field names, never
 * values) through `onLedger`, mirroring the server's ledger.
 */
import type {
  DeviceCreateRequest,
  DeviceTokenResponse,
  FitCohortResponse,
  HeroRenderAccepted,
  HeroRenderRequest,
  HeroRenderStatus,
  LedgerListResponse,
  MeDeleteResponse,
  MeExportResponse,
  MerchantLedgerResponse,
  MerchantProductsQuery,
  MerchantProductsResponse,
  ProductGetResponse,
  ShopProductsQuery,
  ShopProductsResponse,
  SignaturePutRequest,
  SignaturePutResponse,
  SwipeBatchRequest,
  SwipeBatchResponse,
  TryResolveResponse,
  AnalyticsSwipesResponse,
  UsageResponse,
  WardrobeItem,
  WardrobeListResponse,
  WardrobePutRequest,
} from '@curtain/schema';
import type { ClientLedgerEntry } from '@/db/db';
import { newId } from '@/lib/ids';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface DeviceCredentials {
  deviceId: string | null;
  token: string | null;
  expiresAt: string | null;
}

export interface ApiClientOptions {
  /** e.g. import.meta.env.VITE_API_URL — no trailing slash. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getDevice: () => DeviceCredentials;
  setDevice: (d: DeviceTokenResponse) => void | Promise<void>;
  onLedger: (entry: ClientLedgerEntry) => void | Promise<void>;
  appVersion?: string;
  now?: () => Date;
  timeoutMs?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
  /** 4xx other than 401/408/429 — retrying will not help. */
  get permanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 401 && this.status !== 408 && this.status !== 429;
  }
}

export class NetworkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** Rotate the device token once less than this is left (tokens live 30 days). */
export const ROTATE_WITHIN_MS = 7 * 86_400_000;

const WRITE_KIND: Record<string, ClientLedgerEntry['kind']> = {
  '/v1/devices': 'device',
  '/v1/devices/rotate': 'device',
  '/v1/me/signature': 'signature_sync',
  '/v1/swipes': 'swipe_batch',
  '/v1/me': 'erase',
  '/v1/renders/hero': 'hero_render',
};

function ledgerKind(path: string): ClientLedgerEntry['kind'] {
  const clean = path.split('?')[0] ?? path;
  if (WRITE_KIND[clean]) return WRITE_KIND[clean];
  if (clean.startsWith('/v1/wardrobe/')) return 'wardrobe_sync';
  if (clean.startsWith('/v1/try/')) return 'pairing';
  return 'pairing';
}

function byteLength(s: string): number {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length;
}

export class ApiClient {
  private readonly opts: Required<Pick<ApiClientOptions, 'baseUrl' | 'appVersion' | 'now' | 'timeoutMs'>> & ApiClientOptions;
  private devicePromise: Promise<string> | null = null;

  constructor(options: ApiClientOptions) {
    this.opts = {
      appVersion: '0.1.0',
      now: () => new Date(),
      timeoutMs: 15_000,
      ...options,
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
    };
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  // ---------------------------------------------------------------------------
  // Core
  // ---------------------------------------------------------------------------

  async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    init: { auth?: 'device' | 'none' | { bearer: string }; ledger?: boolean; retryOn401?: boolean } = {},
  ): Promise<T> {
    const auth = init.auth ?? 'device';
    const headers: Record<string, string> = { Accept: 'application/json' };
    let json: string | undefined;
    if (body !== undefined) {
      json = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (auth === 'device') headers.Authorization = `Bearer ${await this.ensureDevice()}`;
    else if (typeof auth === 'object') headers.Authorization = `Bearer ${auth.bearer}`;

    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), this.opts.timeoutMs) : null;
    const isWrite = method !== 'GET';
    let res: Response;
    try {
      res = await fetchImpl(`${this.opts.baseUrl}${path}`, { method, headers, body: json, signal: controller?.signal });
    } catch (e) {
      if (isWrite && init.ledger !== false) await this.appendLedger(method, path, json, body, 'failed');
      throw new NetworkError(`network error on ${method} ${path}`, e);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (isWrite && init.ledger !== false) await this.appendLedger(method, path, json, body, res.status);

    if (res.status === 401 && auth === 'device' && init.retryOn401 !== false) {
      this.devicePromise = null;
      await this.opts.setDevice({ deviceId: this.opts.getDevice().deviceId ?? '', token: '', expiresAt: new Date(0).toISOString(), tokenVersion: 0 });
      return this.request<T>(method, path, body, { ...init, retryOn401: false });
    }
    if (!res.ok) {
      let code = `http_${res.status}`;
      let message = res.statusText || `HTTP ${res.status}`;
      let details: unknown;
      try {
        const err = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } };
        if (err?.error) {
          code = err.error.code ?? code;
          message = err.error.message ?? message;
          details = err.error.details;
        }
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, code, message, details);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private async appendLedger(method: HttpMethod, path: string, json: string | undefined, body: unknown, status: number | 'failed'): Promise<void> {
    const fields = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body as Record<string, unknown>).slice(0, 64) : [];
    const entry: ClientLedgerEntry = {
      id: newId(),
      at: this.opts.now().toISOString(),
      kind: ledgerKind(path),
      method,
      path: path.split('?')[0] ?? path,
      bytes: json ? byteLength(json) : 0,
      fields,
      status,
    };
    await this.opts.onLedger(entry);
  }

  /**
   * Device JWT: memory/IndexedDB first. A token in its last week is ROTATED (`POST /v1/devices/rotate`,
   * same device id) — registering a fresh device instead would orphan this device's server rows (its
   * signature, swipes, pairings), and a later `DELETE /v1/me` would erase the wrong device.
   * `POST /v1/devices` only on first run, or when the old token is already unusable.
   */
  async ensureDevice(): Promise<string> {
    const d = this.opts.getDevice();
    const left = d.token && d.expiresAt ? new Date(d.expiresAt).getTime() - this.opts.now().getTime() : -1;
    if (d.token && left > ROTATE_WITHIN_MS) return d.token;
    if (d.token && left > 60_000) return this.rotateDevice(d.token);
    if (!this.devicePromise) {
      const req: DeviceCreateRequest = { platform: 'web', appVersion: this.opts.appVersion };
      this.devicePromise = this.request<DeviceTokenResponse>('POST', '/v1/devices', req, { auth: 'none' })
        .then(async (res) => {
          await this.opts.setDevice(res);
          return res.token;
        })
        .catch((e: unknown) => {
          this.devicePromise = null;
          throw e;
        });
    }
    return this.devicePromise;
  }

  private rotateDevice(current: string): Promise<string> {
    if (!this.devicePromise) {
      this.devicePromise = this.request<DeviceTokenResponse>('POST', '/v1/devices/rotate', { appVersion: this.opts.appVersion }, { auth: { bearer: current }, retryOn401: false })
        .then(async (res) => {
          await this.opts.setDevice(res);
          this.devicePromise = null;
          return res.token;
        })
        .catch((e: unknown) => {
          this.devicePromise = null;
          // Offline / server hiccup: the current token is still valid for a while — keep using it.
          if (!(e instanceof ApiError && e.status === 401)) return current;
          throw e;
        });
    }
    return this.devicePromise;
  }

  // ---------------------------------------------------------------------------
  // App routes
  // ---------------------------------------------------------------------------

  putSignature(wire: SignaturePutRequest): Promise<SignaturePutResponse> {
    return this.request('PUT', '/v1/me/signature', wire);
  }
  postSwipes(batch: SwipeBatchRequest): Promise<SwipeBatchResponse> {
    return this.request('POST', '/v1/swipes', batch);
  }
  putWardrobe(productId: string, req: WardrobePutRequest): Promise<WardrobeItem> {
    return this.request('PUT', `/v1/wardrobe/${encodeURIComponent(productId)}`, req);
  }
  getWardrobe(): Promise<WardrobeListResponse> {
    return this.request('GET', '/v1/wardrobe');
  }
  deleteMe(): Promise<MeDeleteResponse> {
    return this.request('DELETE', '/v1/me');
  }
  exportMe(): Promise<MeExportResponse> {
    return this.request('GET', '/v1/me/export');
  }
  getLedger(cursor?: string): Promise<LedgerListResponse> {
    return this.request('GET', `/v1/me/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
  }
  resolveTry(token: string): Promise<TryResolveResponse> {
    return this.request('GET', `/v1/try/${encodeURIComponent(token)}`);
  }
  shopProducts(shopId: string, query: Partial<ShopProductsQuery> = {}): Promise<ShopProductsResponse> {
    const q = new URLSearchParams();
    if (query.cursor) q.set('cursor', query.cursor);
    if (query.category) q.set('category', query.category);
    if (query.limit) q.set('limit', String(query.limit));
    const qs = q.toString();
    return this.request('GET', `/v1/shops/${encodeURIComponent(shopId)}/products${qs ? `?${qs}` : ''}`);
  }
  getProduct(id: string): Promise<ProductGetResponse> {
    return this.request('GET', `/v1/products/${encodeURIComponent(id)}`);
  }
  fitCohort(productId: string): Promise<FitCohortResponse> {
    return this.request('GET', `/v1/fit/cohort/${encodeURIComponent(productId)}`);
  }
  /** Opt-in hero render: `person.kind` is 'avatarRender' by type — a raw frame cannot be passed. */
  requestHeroRender(req: HeroRenderRequest): Promise<HeroRenderAccepted> {
    return this.request('POST', '/v1/renders/hero', req);
  }
  heroRenderStatus(jobId: string): Promise<HeroRenderStatus> {
    return this.request('GET', `/v1/renders/${encodeURIComponent(jobId)}`);
  }

  // ---------------------------------------------------------------------------
  // Merchant routes (secret key `sk_…` as bearer; kept in sessionStorage by the console)
  // ---------------------------------------------------------------------------

  merchant(secretKey: string): MerchantApi {
    return new MerchantApi(this, secretKey);
  }
}

export class MerchantApi {
  constructor(
    private readonly client: ApiClient,
    private readonly key: string,
  ) {}
  private get auth(): { bearer: string } {
    return { bearer: this.key };
  }
  products(query: Partial<MerchantProductsQuery> = {}): Promise<MerchantProductsResponse> {
    const q = new URLSearchParams();
    if (query.status) q.set('status', query.status);
    if (query.cursor) q.set('cursor', query.cursor);
    if (query.limit) q.set('limit', String(query.limit));
    const qs = q.toString();
    return this.client.request('GET', `/v1/merchant/products${qs ? `?${qs}` : ''}`, undefined, { auth: this.auth });
  }
  usage(from: string, to: string): Promise<UsageResponse> {
    return this.client.request('GET', `/v1/merchant/usage?from=${from}&to=${to}`, undefined, { auth: this.auth });
  }
  analyticsSwipes(from: string, to: string): Promise<AnalyticsSwipesResponse> {
    return this.client.request('GET', `/v1/merchant/analytics/swipes?from=${from}&to=${to}`, undefined, { auth: this.auth });
  }
  ledger(cursor?: string): Promise<MerchantLedgerResponse> {
    return this.client.request('GET', `/v1/merchant/ledger${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, undefined, { auth: this.auth });
  }
}

export const MERCHANT_KEY_PATTERN = /^sk_(live|test)_[A-Za-z0-9]{8,64}$/;

/** Base URL from the environment; defaults to same-origin `/` (Caddy proxies /v1 to the api). */
export function apiBaseUrl(): string {
  const env = (import.meta.env?.VITE_API_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/+$/, '');
  return typeof location !== 'undefined' ? location.origin : 'http://localhost:3000';
}
