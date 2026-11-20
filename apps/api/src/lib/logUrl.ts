/**
 * The URL as it may appear in a log line (launch-readiness review, finding L1).
 *
 * Several URLs carry a capability or a credential: `/v1/try/<try token JWT>`, the signed render
 * URLs `/v1/renders/<job>/image?exp=…&sig=…` (they show the shopper's hero render for up to 24 h),
 * `/shopify/admin?id_token=…&hmac=…`, `/v1/peek?shop=…&product=…&page=…`, `/v1/sdk/media?url=…`.
 * The request log keeps 7 days on the VPS, so it must never hold those values. A log line gets:
 *  - the matched route pattern (`/v1/try/:token`), never the concrete path parameters;
 *  - the query parameter NAMES only, each value replaced by `[redacted]`;
 *  - for a request that matched no route (404s, scanners): the path with every segment that is
 *    long, or looks like a token, replaced by `[redacted]`.
 */

const REDACTED = '[redacted]';
/** A path segment this long, or with characters a token has and a route name never has, is redacted. */
const MAX_PLAIN_SEGMENT = 24;
const PLAIN_SEGMENT = /^[a-z0-9_-]*(\.[a-z0-9]{1,8})?$/i;

export interface LogUrlInput {
  url: string;
  /** Fastify's matched route pattern (`request.routeOptions.url`); undefined or `*`-style when nothing matched. */
  routePattern?: string | undefined;
}

function redactQuery(query: string): string {
  if (!query) return '';
  const names: string[] = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawName = eq === -1 ? part : part.slice(0, eq);
    let name: string;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, ' '));
    } catch {
      name = rawName;
    }
    // A parameter name is not a secret, but it is attacker-chosen text: keep it short and plain.
    names.push(/^[a-z0-9_.[\]-]{1,32}$/i.test(name) ? name : REDACTED);
  }
  return names.length ? `?${names.map((n) => `${n}=${REDACTED}`).join('&')}` : '';
}

function redactPath(path: string): string {
  return path
    .split('/')
    .map((seg) => (seg.length <= MAX_PLAIN_SEGMENT && PLAIN_SEGMENT.test(seg) ? seg : REDACTED))
    .join('/');
}

export function logSafeUrl({ url, routePattern }: LogUrlInput): string {
  const q = url.indexOf('?');
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? '' : url.slice(q + 1);
  // A real route pattern names its parameters (`:token`); a catch-all (`*`, the 404 handler) does not help.
  const usePattern = !!routePattern && !routePattern.includes('*');
  return `${usePattern ? routePattern : redactPath(path)}${redactQuery(query)}`;
}
