/**
 * Managed installation / token exchange (D6): an App Bridge session token (ID token) is swapped
 * for an offline access token server-side. No authorization-code redirect dance.
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
 *
 * Expiring offline tokens (App Store requirement 3.1.2, checklist A3; read 2026-11-06):
 *  - `expiring=1` on the token exchange returns an access token that lives `expires_in` seconds
 *    (3600 today; read it, never hard-code it) plus a `refresh_token` that lives
 *    `refresh_token_expires_in` (7776000 = 90 days when issued).
 *    https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens
 *  - Refresh: `POST https://{shop}/admin/oauth/access_token`, form-encoded, `client_id`,
 *    `client_secret`, `grant_type=refresh_token`, `refresh_token`. Every refresh returns a new
 *    access token AND a new refresh token (rotation). A terminal failure is `401` with
 *    `{"error":"invalid_request"}` for every cause: stop retrying and run token exchange the next
 *    time the merchant opens the app. Network errors, timeouts, 5xx and 429 may be retried with the
 *    same refresh token.
 *    https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange#refresh-an-expiring-offline-token
 *  - "Acquiring a token and refreshing one each retire the other's result": never run a token
 *    exchange and a refresh for the same shop at the same time (the api serialises them per shop).
 *  - Migration of a stored non-expiring token: token exchange with the old offline token as
 *    `subject_token` (`subject_token_type` = the offline-access-token URN), `expiring=1`. It
 *    permanently invalidates the old token for the Admin API; a lost response can be recovered by
 *    repeating the same request within seven days.
 *    https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
 */
import { z } from 'zod';
import { isShopifyDomain, type FetchLike, type ShopifyAppCredentials } from './types';

export const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange' as const;
export const SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token' as const;
/** `subject_token_type` when migrating a stored non-expiring offline token. */
export const OFFLINE_SUBJECT_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:offline-access-token' as const;
export const REFRESH_GRANT_TYPE = 'refresh_token' as const;
export const REQUESTED_TOKEN_TYPES = {
  offline: 'urn:shopify:params:oauth:token-type:offline-access-token',
  online: 'urn:shopify:params:oauth:token-type:online-access-token',
} as const;
export type RequestedTokenType = keyof typeof REQUESTED_TOKEN_TYPES;

export const TokenExchangeResponseSchema = z.object({
  access_token: z.string().min(1),
  scope: z.string().default(''),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
  associated_user_scope: z.string().optional(),
  associated_user: z
    .object({
      id: z.number(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      email_verified: z.boolean().optional(),
      account_owner: z.boolean().optional(),
      locale: z.string().optional(),
      collaborator: z.boolean().optional(),
    })
    .optional(),
});

export interface TokenExchangeResult {
  accessToken: string;
  scope: string;
  tokenType: RequestedTokenType;
  /** Present for expiring offline tokens and online tokens (seconds). */
  expiresIn?: number;
  refreshToken?: string;
  refreshTokenExpiresIn?: number;
  associatedUser?: z.infer<typeof TokenExchangeResponseSchema>['associated_user'];
}

export class TokenExchangeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'TokenExchangeError';
  }

  /**
   * A refresh failure that will never succeed with this refresh token (Shopify answers 401 for
   * every terminal case, and 400 for an invalid grant): stop retrying and re-run token exchange.
   */
  get terminal(): boolean {
    return this.status === 401 || this.status === 400 || this.status === 403;
  }

  /** Network error (status 0 from a thrown fetch is reported as `retryable`), 429 or 5xx: retry with the same token. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface TokenExchangeRequest extends ShopifyAppCredentials {
  shopDomain: string;
  /** The App Bridge ID token (`await shopify.idToken()`), verified first with `verifySessionToken`. */
  sessionToken: string;
  tokenType?: RequestedTokenType;
  /** Offline only: request an expiring (1 h) token with a refresh token. Default non-expiring. */
  expiring?: boolean;
  fetch?: FetchLike;
}

export function tokenExchangeUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/oauth/access_token`;
}

export function tokenExchangeBody(req: Pick<TokenExchangeRequest, 'apiKey' | 'apiSecret' | 'sessionToken' | 'tokenType' | 'expiring'>): Record<string, string> {
  const body: Record<string, string> = {
    client_id: req.apiKey,
    client_secret: req.apiSecret,
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token: req.sessionToken,
    subject_token_type: SUBJECT_TOKEN_TYPE,
    requested_token_type: REQUESTED_TOKEN_TYPES[req.tokenType ?? 'offline'],
  };
  if ((req.tokenType ?? 'offline') === 'offline' && req.expiring !== undefined) body.expiring = req.expiring ? '1' : '0';
  return body;
}

/** Session token → access token. Throws TokenExchangeError (400 = stale ID token: fetch a fresh one and retry). */
export async function requestTokenExchange(req: TokenExchangeRequest): Promise<TokenExchangeResult> {
  const shopDomain = req.shopDomain.toLowerCase();
  if (!isShopifyDomain(shopDomain)) throw new TokenExchangeError(`invalid shop domain '${req.shopDomain}'`, 0, null);
  if (!req.apiKey || !req.apiSecret) throw new TokenExchangeError('Shopify app credentials are not configured', 0, null);
  const fetchImpl = req.fetch ?? (globalThis.fetch as FetchLike);
  const res = await fetchImpl(tokenExchangeUrl(shopDomain), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(tokenExchangeBody(req)),
  });
  return parseTokenResponse(res, req.tokenType ?? 'offline', 'token exchange');
}

async function parseTokenResponse(res: Response, tokenType: RequestedTokenType, what: string): Promise<TokenExchangeResult> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; error_description?: string };
    throw new TokenExchangeError(b.error_description ?? b.error ?? `${what} failed (${res.status})`, res.status, body);
  }
  const parsed = TokenExchangeResponseSchema.safeParse(body);
  if (!parsed.success) throw new TokenExchangeError(`${what} returned an unexpected body`, res.status, body);
  const d = parsed.data;
  const out: TokenExchangeResult = { accessToken: d.access_token, scope: d.scope, tokenType };
  if (d.expires_in !== undefined) out.expiresIn = d.expires_in;
  if (d.refresh_token !== undefined) out.refreshToken = d.refresh_token;
  if (d.refresh_token_expires_in !== undefined) out.refreshTokenExpiresIn = d.refresh_token_expires_in;
  if (d.associated_user !== undefined) out.associatedUser = d.associated_user;
  return out;
}

export interface RefreshTokenRequest extends ShopifyAppCredentials {
  shopDomain: string;
  /** The refresh token stored with the current expiring offline token. */
  refreshToken: string;
  fetch?: FetchLike;
}

/** Form body of the refresh grant (implement-token-exchange#refresh-an-expiring-offline-token). */
export function refreshTokenBody(req: Pick<RefreshTokenRequest, 'apiKey' | 'apiSecret' | 'refreshToken'>): URLSearchParams {
  return new URLSearchParams({ client_id: req.apiKey, client_secret: req.apiSecret, grant_type: REFRESH_GRANT_TYPE, refresh_token: req.refreshToken });
}

/**
 * Expiring offline token refresh. Returns the new access token AND the new (rotated) refresh token;
 * store both, the old refresh token is retired once the new one is used. Throws TokenExchangeError:
 * `terminal` (401) → re-run token exchange on the next admin open; `retryable` → try again later.
 * A network failure is rethrown as a TokenExchangeError with status 503 (retryable).
 */
export async function refreshAccessToken(req: RefreshTokenRequest): Promise<TokenExchangeResult> {
  const shopDomain = req.shopDomain.toLowerCase();
  if (!isShopifyDomain(shopDomain)) throw new TokenExchangeError(`invalid shop domain '${req.shopDomain}'`, 0, null);
  if (!req.apiKey || !req.apiSecret) throw new TokenExchangeError('Shopify app credentials are not configured', 0, null);
  if (!req.refreshToken) throw new TokenExchangeError('no refresh token', 401, null);
  const fetchImpl = req.fetch ?? (globalThis.fetch as FetchLike);
  let res: Response;
  try {
    res = await fetchImpl(tokenExchangeUrl(shopDomain), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: refreshTokenBody(req).toString(),
    });
  } catch (err) {
    throw new TokenExchangeError(`token refresh request failed: ${err instanceof Error ? err.message : String(err)}`, 503, null);
  }
  const out = await parseTokenResponse(res, 'offline', 'token refresh');
  if (!out.refreshToken || out.expiresIn === undefined) throw new TokenExchangeError('token refresh returned no refresh token or expiry', res.status, null);
  return out;
}

export interface MigrateTokenRequest extends ShopifyAppCredentials {
  shopDomain: string;
  /** The stored, still active, non-expiring offline access token. */
  accessToken: string;
  fetch?: FetchLike;
}

/** Form body of the one-off migration of a non-expiring offline token to an expiring one. */
export function migrateTokenBody(req: Pick<MigrateTokenRequest, 'apiKey' | 'apiSecret' | 'accessToken'>): URLSearchParams {
  return new URLSearchParams({
    client_id: req.apiKey,
    client_secret: req.apiSecret,
    grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
    subject_token: req.accessToken,
    subject_token_type: OFFLINE_SUBJECT_TOKEN_TYPE,
    requested_token_type: REQUESTED_TOKEN_TYPES.offline,
    expiring: '1',
  });
}

/**
 * Non-expiring offline token → expiring offline token + refresh token, without a merchant session.
 * The old token is permanently invalid for the Admin API afterwards: store the result first.
 */
export async function migrateToExpiringToken(req: MigrateTokenRequest): Promise<TokenExchangeResult> {
  const shopDomain = req.shopDomain.toLowerCase();
  if (!isShopifyDomain(shopDomain)) throw new TokenExchangeError(`invalid shop domain '${req.shopDomain}'`, 0, null);
  if (!req.apiKey || !req.apiSecret) throw new TokenExchangeError('Shopify app credentials are not configured', 0, null);
  const fetchImpl = req.fetch ?? (globalThis.fetch as FetchLike);
  let res: Response;
  try {
    res = await fetchImpl(tokenExchangeUrl(shopDomain), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: migrateTokenBody(req).toString(),
    });
  } catch (err) {
    throw new TokenExchangeError(`token migration request failed: ${err instanceof Error ? err.message : String(err)}`, 503, null);
  }
  const out = await parseTokenResponse(res, 'offline', 'token migration');
  if (!out.refreshToken || out.expiresIn === undefined) throw new TokenExchangeError('token migration returned no refresh token or expiry', res.status, null);
  return out;
}

/** Absolute expiry instants of an expiring token result (null for a non-expiring token). */
export function tokenExpiries(r: Pick<TokenExchangeResult, 'expiresIn' | 'refreshTokenExpiresIn'>, now: Date): { expiresAt: Date | null; refreshTokenExpiresAt: Date | null } {
  return {
    expiresAt: r.expiresIn !== undefined ? new Date(now.getTime() + r.expiresIn * 1000) : null,
    refreshTokenExpiresAt: r.refreshTokenExpiresIn !== undefined ? new Date(now.getTime() + r.refreshTokenExpiresIn * 1000) : null,
  };
}
