/**
 * App Bridge session tokens (ID tokens): HS256 JWTs signed with the app's client secret.
 * Claims: iss = https://{shop}/admin, dest = https://{shop}, aud = client_id, sub = user id,
 * exp / nbf / iat, jti, sid. Verified with node:crypto only (no jose dependency here).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isShopifyDomain } from './types';

export interface SessionTokenClaims {
  shopDomain: string;
  userId: string | undefined;
  sessionId: string | undefined;
  jti: string | undefined;
  issuedAt: Date | undefined;
  expiresAt: Date;
  raw: Record<string, unknown>;
}

export interface VerifySessionTokenOptions {
  apiKey: string;
  apiSecret: string;
  now?: Date;
  /** Seconds of clock skew tolerated on exp/nbf (default 10). */
  clockToleranceSec?: number;
}

export type SessionTokenFailure =
  | 'malformed'
  | 'bad_signature'
  | 'bad_alg'
  | 'expired'
  | 'not_yet_valid'
  | 'bad_audience'
  | 'bad_shop'
  | 'bad_issuer';

export class SessionTokenError extends Error {
  constructor(public readonly reason: SessionTokenFailure) {
    super(`invalid session token: ${reason}`);
    this.name = 'SessionTokenError';
  }
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Decode without verifying (e.g. to learn the shop before looking up the secret). Never trust the output. */
export function decodeSessionToken(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(b64urlDecode(parts[0]!).toString('utf8')) as Record<string, unknown>;
    const payload = JSON.parse(b64urlDecode(parts[1]!).toString('utf8')) as Record<string, unknown>;
    return { header, payload };
  } catch {
    return null;
  }
}

/** Strict verification; throws SessionTokenError with the reason. */
export function verifySessionTokenOrThrow(token: string, opts: VerifySessionTokenOptions): SessionTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new SessionTokenError('malformed');
  const decoded = decodeSessionToken(token);
  if (!decoded) throw new SessionTokenError('malformed');
  if (decoded.header.alg !== 'HS256') throw new SessionTokenError('bad_alg');

  const expected = createHmac('sha256', opts.apiSecret).update(`${parts[0]}.${parts[1]}`).digest();
  const actual = b64urlDecode(parts[2]!);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new SessionTokenError('bad_signature');

  const p = decoded.payload;
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const tol = opts.clockToleranceSec ?? 10;
  if (typeof p.exp !== 'number' || p.exp + tol <= nowSec) throw new SessionTokenError('expired');
  if (typeof p.nbf === 'number' && p.nbf - tol > nowSec) throw new SessionTokenError('not_yet_valid');
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(opts.apiKey)) throw new SessionTokenError('bad_audience');

  const destHost = hostOf(p.dest);
  const issHost = hostOf(p.iss);
  if (!destHost || !isShopifyDomain(destHost)) throw new SessionTokenError('bad_shop');
  if (!issHost || issHost !== destHost || typeof p.iss !== 'string' || !p.iss.endsWith('/admin')) throw new SessionTokenError('bad_issuer');

  return {
    shopDomain: destHost,
    userId: typeof p.sub === 'string' ? p.sub : typeof p.sub === 'number' ? String(p.sub) : undefined,
    sessionId: typeof p.sid === 'string' ? p.sid : undefined,
    jti: typeof p.jti === 'string' ? p.jti : undefined,
    issuedAt: typeof p.iat === 'number' ? new Date(p.iat * 1000) : undefined,
    expiresAt: new Date(p.exp * 1000),
    raw: p,
  };
}

/** Same as `verifySessionTokenOrThrow` but returns null on any failure (matches the api's helper). */
export function verifySessionToken(token: string, opts: VerifySessionTokenOptions): SessionTokenClaims | null {
  try {
    return verifySessionTokenOrThrow(token, opts);
  } catch {
    return null;
  }
}

/** Test/dev helper: mint a token the way App Bridge would. Never used in production paths. */
export function signSessionToken(
  claims: { shopDomain: string; apiKey: string; sub?: string; sid?: string; jti?: string; iat?: number; exp?: number; nbf?: number },
  apiSecret: string,
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: `https://${claims.shopDomain}/admin`,
    dest: `https://${claims.shopDomain}`,
    aud: claims.apiKey,
    sub: claims.sub ?? '1',
    exp: claims.exp ?? now + 60,
    nbf: claims.nbf ?? now - 5,
    iat: claims.iat ?? now - 5,
    jti: claims.jti ?? `jti-${now}`,
    sid: claims.sid ?? `sid-${now}`,
  };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(payload);
  const sig = createHmac('sha256', apiSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
