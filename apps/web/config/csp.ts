/**
 * The Content-Security-Policy of the fitting room (DECISIONS.md D3: onboarding makes zero third-party
 * requests). One source for every place the app is served:
 *   - production: `infra/Caddyfile`, `app.{$DOMAIN}` (the PWA, `@app`) and `/embed/*` (the overlay and
 *     the size peek, `@embed`). Caddy cannot import this file, so `src/__tests__/csp.test.ts` checks
 *     that the two policies there are exactly `appCsp(...)` with the api origin `https://api.{$DOMAIN}`;
 *   - `vite preview` (the e2e suite): `vite.config.ts` sends the same policy on every HTML response.
 *
 * This is the second wall behind `src/features/capture/sameOriginOnly.ts` (the scan worker refuses
 * off-origin requests itself): MediaPipe Tasks 1.2.2 POSTs usage logs to odml.pa.googleapis.com, and
 * `connect-src` refuses that too. A dedicated worker loaded from an https URL is NOT governed by the
 * page's policy but by the CSP header of its own script response (only blob:/data: workers inherit the
 * owner's). So the policy is sent on every response of the app origin, worker scripts included:
 * Caddy's `header @app` covers every path, and the preview does the same. That is what puts the scan
 * worker and the drape worker under it.
 *
 * Why each source is there (keep this list short; every addition is a new place data can go):
 *   script-src 'self' 'wasm-unsafe-eval'
 *       Our own bundles only; no 'unsafe-inline' (the built index.html has no inline script) and no
 *       'unsafe-eval'. 'wasm-unsafe-eval' lets WebAssembly compile: the MediaPipe runtime
 *       (/models/wasm/*.wasm) and the meshopt decoder in the drape bake reader. It does not allow
 *       eval() or new Function().
 *   style-src 'self'
 *       The built CSS only. React and motion set styles through the CSSOM (element.style), which CSP
 *       does not restrict; `style-src-attr 'unsafe-inline'` covers style="" attributes that libraries
 *       write as markup. No inline <style> element is allowed.
 *   connect-src 'self' <api>
 *       fetch/XHR/WebSocket/sendBeacon: our origin (models, bundles) and the api. Nothing else.
 *   img-src / media-src 'self' data: blob: <api>
 *       Merchant photos come through the api media proxy (GET /v1/sdk/media); hero renders from signed
 *       api URLs; data:/blob: are the avatar, the face tile and the rasterised avatar.
 *   font-src 'self'   Fraunces and Inter are self-hosted (@fontsource, bundled).
 *   worker-src 'self' The scan worker and the drape worker are same-origin module workers.
 *   frame-ancestors   The app: 'none'. The embed and the peek: any https page (Shopify and WooCommerce
 *       storefronts live on any domain, custom or *.myshopify.com, and the Shopify theme editor previews
 *       them inside admin.shopify.com). The per-shop check is the try token and the publishable key, not
 *       the frame (docs/STANDALONE.md §2, D11). The preview adds localhost for the demo storefront.
 */

export type CspSurface = 'app' | 'embed';

export interface CspOptions {
  /** The api origin (`https://api.{$DOMAIN}` in production); omitted when the api is same-origin. */
  api?: string | undefined;
  /** The embed's extra framing parents, e.g. localhost for the demo storefront (preview only). */
  extraFrameAncestors?: readonly string[];
  /** Preview only: where the browser reports a violation (the e2e suite reads it). Never in production. */
  reportUri?: string | undefined;
}

export const EMBED_FRAME_ANCESTORS = ['https:'] as const;
export const LOCAL_FRAME_ANCESTORS = ['http://localhost:*', 'http://127.0.0.1:*'] as const;

export function cspDirectives(surface: CspSurface, opts: CspOptions = {}): [string, string[]][] {
  const api = opts.api ? [opts.api] : [];
  const ancestors = surface === 'app' ? ["'none'"] : [...EMBED_FRAME_ANCESTORS, ...(opts.extraFrameAncestors ?? [])];
  const d: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", "'wasm-unsafe-eval'"]],
    ['style-src', ["'self'"]],
    ['style-src-attr', ["'unsafe-inline'"]],
    ['connect-src', ["'self'", ...api]],
    ['img-src', ["'self'", 'data:', 'blob:', ...api]],
    ['media-src', ["'self'", 'blob:', ...api]],
    ['font-src', ["'self'"]],
    ['worker-src', ["'self'"]],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['frame-ancestors', ancestors],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ];
  if (opts.reportUri) d.push(['report-uri', [opts.reportUri]]);
  return d;
}

export function appCsp(surface: CspSurface, opts: CspOptions = {}): string {
  return cspDirectives(surface, opts)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}
