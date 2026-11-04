/**
 * Managed installation / token exchange (D6): an App Bridge session token (ID token) is swapped
 * for an offline access token server-side. No authorization-code redirect dance.
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
 */
import { z } from 'zod';
import { isShopifyDomain, type FetchLike, type ShopifyAppCredentials } from './types';

export const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange' as const;
export const SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token' as const;
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
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; error_description?: string };
    throw new TokenExchangeError(b.error_description ?? b.error ?? `token exchange failed (${res.status})`, res.status, body);
  }
  const parsed = TokenExchangeResponseSchema.safeParse(body);
  if (!parsed.success) throw new TokenExchangeError('token exchange returned an unexpected body', res.status, body);
  const d = parsed.data;
  const out: TokenExchangeResult = { accessToken: d.access_token, scope: d.scope, tokenType: req.tokenType ?? 'offline' };
  if (d.expires_in !== undefined) out.expiresIn = d.expires_in;
  if (d.refresh_token !== undefined) out.refreshToken = d.refresh_token;
  if (d.refresh_token_expires_in !== undefined) out.refreshTokenExpiresIn = d.refresh_token_expires_in;
  if (d.associated_user !== undefined) out.associatedUser = d.associated_user;
  return out;
}
