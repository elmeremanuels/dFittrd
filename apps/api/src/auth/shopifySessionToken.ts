/**
 * Shopify session tokens (App Bridge): JWT HS256 signed with the app's API secret.
 * Claims per https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens:
 * iss = https://{shop}/admin, dest = https://{shop}, aud = API key, sub = user id, exp/nbf/iat, jti, sid.
 */
import { jwtVerify } from 'jose';

export interface ShopifySessionClaims {
  shopDomain: string;
  userId: string | undefined;
  sessionId: string | undefined;
  expiresAt: Date;
}

export async function verifyShopifySessionToken(
  token: string,
  apiKey: string,
  apiSecret: string,
  now = new Date(),
): Promise<ShopifySessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(apiSecret), {
      algorithms: ['HS256'],
      audience: apiKey,
      clockTolerance: 10,
      currentDate: now,
    });
    const dest = typeof payload.dest === 'string' ? payload.dest : '';
    const iss = typeof payload.iss === 'string' ? payload.iss : '';
    const destHost = hostOf(dest);
    const issHost = hostOf(iss);
    if (!destHost || !issHost || destHost !== issHost || !isShopifyDomain(destHost)) return null;
    if (!iss.endsWith('/admin')) return null;
    if (!payload.exp) return null;
    return {
      shopDomain: destHost,
      userId: typeof payload.sub === 'string' ? payload.sub : undefined,
      sessionId: typeof payload.sid === 'string' ? payload.sid : undefined,
      expiresAt: new Date(payload.exp * 1000),
    };
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.host.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isShopifyDomain(host: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host) || /^[a-z0-9][a-z0-9-]*\.shopify\.com$/.test(host);
}
