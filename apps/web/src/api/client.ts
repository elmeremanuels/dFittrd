/**
 * Typed HTTP client for the one backend. Every DTO comes from @curtain/schema (API_ROUTES).
 *
 * Privacy (D3): the client can only send what these DTOs describe — there is no method that
 * takes a Blob/File, and `PersonInput.kind` is the closed literal 'avatarRender'. Every network
 * WRITE appends a client-side ledger entry `{ at, path, bytes, fields }` (field names, never
 * values) through `onLedger`, mirroring the server's ledger.
 */
import type {
  AnalyticsAbandonedResponse,
  AnalyticsFitSizesResponse,
  BillingAnomaliesResponse,
  DeviceCreateRequest,
  DeviceTokenResponse,
  FitCohortResponse,
  FitShownRequest,
  FitShownResponse,
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
  SignatureDeleteResponse,
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
import { WARDROBE_SIZE_UNKNOWN } from '@curtain/schema';
import type { ClientLedgerEntry } from '@/db/db';
import { newId } from '@/lib/ids';

/** A cohort without the unknown-size bucket (#24): "unknown" is a marker, not a size people chose. */
export function withoutUnknownSize(cohort: FitCohortResponse): FitCohortResponse {
  if (!(WARDROBE_SIZE_UNKNOWN in cohort.sizeHistogram)) return cohort;
  const { [WARDROBE_SIZE_UNKNOWN]: _unknown, ...sizeHistogram } = cohort.sizeHistogram;
  return { ...cohort, sizeHistogram };
}

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
  /**
   * Re-reads the persisted credentials (IndexedDB), updates memory and returns them. Another tab or
   * window shares that storage and may have rotated the token meanwhile (AUTH-1). Without it the
   * client falls back to `getDevice`.
   */
  reloadDevice?: () => Promise<DeviceCredentials>;
  /** How long to wait for another tab's rotated token after a `token_rotated` 401 (tests: 0). */
  rotatedWaitMs?: number;
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

/**
 * An expired token can still be rotated (never used for anything else) for this long past its
 * expiry; it mirrors the api's DEVICE_TOKEN_ROTATE_GRACE_DAYS default (carry-over #10). Rotating
 * keeps the device id, so the server rows stay reachable by `DELETE /v1/me`.
 */
export const ROTATE_GRACE_MS = 180 * 86_400_000;

const WRITE_KIND: Record<string, ClientLedgerEntry['kind']> = {
  '/v1/devices': 'device',
  '/v1/devices/rotate': 'device',
  '/v1/me/signature': 'signature_sync',
  '/v1/swipes': 'swipe_batch',
  '/v1/me': 'erase',
  '/v1/renders/hero': 'hero_render',
};

function ledgerKind(path: string, method?: HttpMethod): ClientLedgerEntry['kind'] {
  const clean = path.split('?')[0] ?? path;
  if (method === 'DELETE' && clean === '/v1/me/signature') return 'erase';
  if (WRITE_KIND[clean]) return WRITE_KIND[clean];
  if (clean.startsWith('/v1/wardrobe/')) return 'wardrobe_sync';
  if (clean.startsWith('/v1/try/') && clean.endsWith('/fit-shown')) return 'fit';
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
      const current = this.opts.getDevice();
      const code = await res
        .clone()
        .json()
        .then((b: { error?: { code?: string } }) => b?.error?.code)
        .catch(() => undefined);
      if (code === 'token_expired' && current.token) {
        // Expired but genuine: keep the token and mark it expired now, so ensureDevice rotates it
        // (same device id) instead of registering a new device (carry-over #10).
        await this.opts.setDevice({ deviceId: current.deviceId ?? '', token: current.token, expiresAt: this.opts.now().toISOString(), tokenVersion: 0 });
      } else if (code === 'token_rotated' && current.token) {
        // Another tab rotated this device (AUTH-1): pick up its new token (same device id). Only
        // when no context kept the new token is the old one dropped, which registers a new device.
        const stale = current.token;
        const next = await this.withDeviceLock(() => this.awaitNewerToken(stale));
        if (!next) await this.opts.setDevice({ deviceId: current.deviceId ?? '', token: '', expiresAt: new Date(0).toISOString(), tokenVersion: 0 });
      } else {
        await this.opts.setDevice({ deviceId: current.deviceId ?? '', token: '', expiresAt: new Date(0).toISOString(), tokenVersion: 0 });
      }
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
      kind: ledgerKind(path, method),
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
   * signature, swipes, pairings), and a later `DELETE /v1/me` would erase the wrong device. An
   * already expired token is rotated too, within ROTATE_GRACE_MS past its expiry (carry-over #10).
   *
   * Tabs and windows share the stored token (AUTH-1). Rotation and registration run under one Web
   * Lock across tabs, and re-read the stored credentials first, so a tab that waited for the lock
   * finds the token the other tab just rotated instead of rotating it again. A `token_rotated` 401
   * (the race was lost anyway, e.g. without Web Locks) waits for the other tab's token.
   * `POST /v1/devices` only on first run, on `invalid_token` (erased, unknown, past the grace), or
   * when a rotation's new token was kept by no context at all (it is then lost for good).
   */
  async ensureDevice(): Promise<string> {
    const d = this.opts.getDevice();
    if (d.token && this.msLeft(d) > ROTATE_WITHIN_MS) return d.token;
    if (!this.devicePromise) {
      const run = this.withDeviceLock(() => this.refreshDevice());
      this.devicePromise = run;
      void run.then(
        () => this.clearDevicePromise(run),
        () => this.clearDevicePromise(run),
      );
    }
    return this.devicePromise;
  }

  private clearDevicePromise(run: Promise<string>): void {
    if (this.devicePromise === run) this.devicePromise = null;
  }

  private msLeft(d: DeviceCredentials): number {
    return d.token && d.expiresAt ? new Date(d.expiresAt).getTime() - this.opts.now().getTime() : -Infinity;
  }

  private async loadDevice(): Promise<DeviceCredentials> {
    return this.opts.reloadDevice ? await this.opts.reloadDevice() : this.opts.getDevice();
  }

  /** Runs `fn` under a lock shared by every tab of this origin (Web Locks API), when the browser has one. */
  private withDeviceLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (!locks || typeof locks.request !== 'function') return fn();
    return locks.request(`curtain-device:${this.opts.baseUrl}`, () => fn()) as Promise<T>;
  }

  /** The stored token once it differs from `stale` (another tab rotated), or null after a short wait. */
  private async awaitNewerToken(stale: string): Promise<string | null> {
    const waitMs = this.opts.rotatedWaitMs ?? 1500;
    const deadline = Date.now() + waitMs;
    for (let pause = 100; ; pause *= 2) {
      const d = await this.loadDevice();
      if (d.token && d.token !== stale && this.msLeft(d) > -ROTATE_GRACE_MS) return d.token;
      if (Date.now() + pause > deadline) return null;
      await new Promise((r) => setTimeout(r, pause));
    }
  }

  private async refreshDevice(): Promise<string> {
    // Another tab may have rotated or registered while this one waited for the lock.
    const d = await this.loadDevice();
    const left = this.msLeft(d);
    if (d.token && left > ROTATE_WITHIN_MS) return d.token;
    if (d.token && left > -ROTATE_GRACE_MS) {
      try {
        return await this.rotateDevice(d.token, left > 60_000);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 401)) throw e;
        if (e.code === 'token_rotated') {
          const next = await this.awaitNewerToken(d.token);
          if (next) return next;
        }
        // invalid_token (erased, unknown, past the grace) or a rotated token nobody kept: register.
      }
    }
    return this.registerDevice();
  }

  private async registerDevice(): Promise<string> {
    const req: DeviceCreateRequest = { platform: 'web', appVersion: this.opts.appVersion };
    const res = await this.request<DeviceTokenResponse>('POST', '/v1/devices', req, { auth: 'none' });
    await this.opts.setDevice(res);
    return res.token;
  }

  private async rotateDevice(current: string, stillValid: boolean): Promise<string> {
    try {
      const res = await this.request<DeviceTokenResponse>('POST', '/v1/devices/rotate', { appVersion: this.opts.appVersion }, { auth: { bearer: current }, retryOn401: false });
      await this.opts.setDevice(res);
      return res.token;
    } catch (e) {
      // Offline / server hiccup: a token that is still valid for a while keeps working.
      if (stillValid && !(e instanceof ApiError && e.status === 401)) return current;
      throw e;
    }
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
  /** "Delete my scan": removes the fit signature on the server (carry-over #9); everything else stays. */
  deleteSignature(): Promise<SignatureDeleteResponse> {
    return this.request('DELETE', '/v1/me/signature');
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
  /** Standalone embed billing event: the size label and confidence only — never a measurement (D3, D11). */
  fitShown(token: string, req: FitShownRequest): Promise<FitShownResponse> {
    return this.request('POST', `/v1/try/${encodeURIComponent(token)}/fit-shown`, req);
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
  /**
   * Cohort of one product in one shop (#22: ids are only unique within a shop). The unknown-size
   * marker is not a size, so its bucket is dropped from the histogram (#24).
   */
  async fitCohort(productId: string, shopId: string): Promise<FitCohortResponse> {
    const res = await this.request<FitCohortResponse>('GET', `/v1/fit/cohort/${encodeURIComponent(productId)}?shopId=${encodeURIComponent(shopId)}`);
    return withoutUnknownSize(res);
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
  /** Billing anomaly signal: today's cap/spike flags and recorded anomalies (carry-over #7). */
  usageAnomalies(from: string, to: string): Promise<BillingAnomaliesResponse> {
    return this.client.request('GET', `/v1/merchant/usage/anomalies?from=${from}&to=${to}`, undefined, { auth: this.auth });
  }
  /** Sizes recommended in standalone (on-page) fit sessions, k floor applied (carry-over #18). */
  analyticsFitSizes(from: string, to: string): Promise<AnalyticsFitSizesResponse> {
    return this.client.request('GET', `/v1/merchant/analytics/fit-sizes?from=${from}&to=${to}`, undefined, { auth: this.auth });
  }
  /** Opens that never got a fit, k floor on distinct shoppers (carry-over #19). */
  analyticsAbandoned(from: string, to: string): Promise<AnalyticsAbandonedResponse> {
    return this.client.request('GET', `/v1/merchant/analytics/abandoned?from=${from}&to=${to}`, undefined, { auth: this.auth });
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
