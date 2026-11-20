/**
 * Every security header of the fitting room's origin, in one place (OI-66). Two servers send them:
 *   - production: `infra/Caddyfile`, `app.{$DOMAIN}` (`base_headers`, `header @app`, `header @embed`);
 *   - `vite preview`, which the e2e suite and the production-shaped demo (`pnpm demo -- --preview`) run on.
 * Caddy cannot import this file, so `src/__tests__/headers.test.ts` reads the Caddyfile and fails when the
 * two differ by a header, a value or a removal. The differences that are meant are listed there, by name.
 *
 * Before this file the preview sent the policy (config/csp.ts) but no cross-origin isolation, so production
 * ran with `Cross-Origin-Embedder-Policy: require-corp` and the tests never did: a resource without CORP or
 * CORS loads in the tests and is blocked in production.
 */
import { appCsp, type CspOptions, type CspSurface } from './csp';

export interface ResponseHeaders {
  /** Header name → value, as sent. */
  set: Record<string, string>;
  /** Headers a server must not send on this surface (Caddy: `-Name`). */
  remove: string[];
}

/** On every response of the origin (Caddy: `base_headers`). */
export const BASE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
});

/**
 * The app (every path that is not the embed, worker scripts and models included): cross-origin isolated, so
 * the MediaPipe wasm gets SIMD and threads (D5), and never framed.
 */
const APP_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
});

/**
 * `/embed/*` (the overlay and the size peek): framed by shop pages on other origins, so no opener policy and
 * no X-Frame-Options, a cross-origin resource policy, `credentialless` instead of `require-corp`, and kept
 * out of shared caches and search engines (the URL holds a try token).
 */
const EMBED_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
});
const EMBED_REMOVED = ['X-Frame-Options', 'Cross-Origin-Opener-Policy'] as const;

/** The headers of one response: the base set, the surface's own, and its Content-Security-Policy. */
export function responseHeaders(surface: CspSurface, csp: CspOptions = {}): ResponseHeaders {
  return {
    set: { ...BASE_HEADERS, ...(surface === 'app' ? APP_HEADERS : EMBED_HEADERS), 'Content-Security-Policy': appCsp(surface, csp) },
    remove: surface === 'app' ? [] : [...EMBED_REMOVED],
  };
}
