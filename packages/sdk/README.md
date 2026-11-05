# @paskamer/sdk

The merchant drop-in for **Paskamer** (your private fitting room). One `<script>` tag turns any
`<button data-paskamer-product="…">` on a product page into the try-on handshake described in
`docs/ARCHITECTURE.md` ("Try-on from a shop") and decision D6:

```
click → POST {api}/v1/sdk/sessions { shopKeyPrefix, productExternalId, pageUrl }
      → { tryUrl, qrSvg, expiresAt, shopPaused }
      → phone/tablet: location.href = tryUrl (universal link into the PWA)
      → desktop:     accessible QR modal ("Scan with your phone to try it on in Paskamer")
```

Vanilla TypeScript, **zero runtime dependencies**, es2019, **< 8 KB gzipped** (asserted in
`src/size.test.ts` and at build time by `scripts/check-size.mjs`). The merchant page only ever
learns "opened": no cookies, no storage, no tracking, no third-party requests, and nothing but the
documented fields on the wire (`credentials: 'omit'`). `pageUrl` is sent as origin + path only (query
string and fragment are stripped: they can carry e-mail addresses, UTM ids or tokens).

Hardening: a `tryUrl` that is not an absolute `http(s)` URL is refused (no `javascript:`/`data:`
navigation or link on the merchant page; the shopper sees the polite error instead). When the
SDK is loaded twice on one page, the second copy finds `window.Paskamer` already installed and
stays inactive, so buttons are never bound twice.

## Merchant snippet

```html
<script
  src="https://api.paskamer.app/sdk/v1.js"
  data-shop="pk_live_xxxxxxxxxxxx"
  defer
></script>

<button data-paskamer-product="aalter-studio-1">Try in Paskamer</button>
```

That is all a merchant needs. The Shopify theme app extension and the WooCommerce plugin inject
this tag themselves (the plugin bundles `sdk.v1.js` because of the WP.org no-remote-code rule and
must then set `data-api`).

### Script-tag attributes

| Attribute                | Required | Meaning                                                                                   |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `data-shop`              | yes      | Public shop key prefix `pk_live_…` / `pk_test_…`. Secret keys (`sk_…`) are rejected.       |
| `data-api`               | no       | API origin, e.g. `https://api.paskamer.app`. Defaults to the origin the script was loaded from. |
| `data-mode`              | no       | `auto` (default: mobile UA → redirect, desktop → QR modal), `redirect`, or `modal`.        |
| `data-locale`            | no       | `en` or `nl`. Defaults to `<html lang>`, then the browser language.                       |
| `data-label`             | no       | Text for buttons that are empty. Default "Try in Paskamer" / "Pas in Paskamer".          |
| `data-paskamer-unstyled` | no       | Do not inject the stylesheet or the `pk-btn` class (you style the buttons yourself).      |

### Button attributes (on `<button>`, `<a>` or any element)

| Attribute                | Meaning                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `data-paskamer-product`  | The product's external id (Shopify: numeric part of the Product GID; Woo: post id or SKU as synced). |
| `data-paskamer-unstyled` | Skip the built-in coral/cream styling for this element only.                                     |

Behaviour per element: an empty element gets the default label; a `<button>` without `type` gets
`type="button"`; non-button elements get `role="button"`, `tabindex="0"` and Enter/Space handling;
while a handshake runs the element carries `data-paskamer-state="loading"` and `aria-busy="true"`.
A `MutationObserver` binds buttons that appear later (SPA / headless storefronts), so the attribute
just works with React, Hydrogen, etc.

### `window.Paskamer`

```ts
window.Paskamer.open(productId, { mode?: 'auto' | 'redirect' | 'modal', pageUrl?, trigger? })
  // → Promise<OpenResult>; never rejects
window.Paskamer.configure({ shop?, api?, mode?, unstyled?, label?, locale?, timeoutMs? })
window.Paskamer.scan()      // bind new buttons now (the observer does this automatically)
window.Paskamer.destroy()   // remove listeners, observer, styles and any open modal
window.Paskamer.version     // '0.1.0'
```

`OpenResult.kind` is `'redirect' | 'modal' | 'paused' | 'error' | 'ignored'`.

## Desktop modal (a11y)

`role="dialog"`, `aria-modal="true"`, `aria-labelledby` / `aria-describedby`, focus moved into the
dialog on open and back to the button on close, Tab / Shift+Tab trapped, Esc and backdrop click
close, body scroll locked, animations disabled under `prefers-reduced-motion`. It shows the QR (the
API's `qrSvg`, rendered through an inert `<img src="data:image/svg+xml,…">` so SVG can never run
script), the scan hint, an "open the link on this device" fallback, the expiry, the shop-paused note
when applicable, and the estimate disclaimer (identical to `ESTIMATE_DISCLAIMER` in
`@paskamer/schema`, asserted in tests). Design tokens: coral `#FF5A3C`, cream `#F5EFE7`, ink
`#1A1612`; no fonts are loaded.

If the response carries no `qrSvg`, a built-in encoder (`encodeQr` / `qrToSvg`, byte mode, EC level
L, versions 1–40, ≤ 2 KB gzipped, round-trip tested with a real decoder) renders `tryUrl`.

## Never breaking the merchant page (D7)

Every error is caught. If the backend answers 402/423 ("shop paused") **with** a `tryUrl`, or 200
with `shopPaused: true`, the SDK proceeds as normal — the app shows the paused screen. Without a
`tryUrl` it shows a polite message. Network errors and 5xx also show a polite message. The SDK
never throws into merchant code and never leaves a button in a stuck state.

## ESM use (bundlers)

```ts
import { init } from '@paskamer/sdk';
init({ shop: 'pk_live_…', api: 'https://api.paskamer.app' });
```

Everything the IIFE does is exported: `init`, `open`, `configure`, `scan`, `destroy`, `isMobile`,
`openModal`, `encodeQr`, `qrToSvg`, `pickStrings`, `STRINGS`, `CSS`, `VERSION`, and the types
`PaskamerConfig`, `OpenOptions`, `OpenResult`, `PaskamerApi`. Wire types are re-exported from
`@paskamer/schema` (`SdkSessionRequest`, `SdkSessionResponse`) as types only — nothing from schema
is bundled.

## Build / test

```
pnpm --filter @paskamer/sdk typecheck   # tsc --noEmit
pnpm --filter @paskamer/sdk test        # vitest + jsdom (+ jsqr for the QR round-trip, esbuild for the size budget)
pnpm --filter @paskamer/sdk build       # tsup → dist/sdk.v1.js (IIFE) + dist/sdk.v1.esm.js (ESM) + sdk.v1.d.ts; then the size check
pnpm --filter @paskamer/sdk lint
```

Serve `dist/sdk.v1.js` from the API origin (Caddy static route), so `data-api` can be omitted and
the page makes zero third-party requests. The root `scripts/check-bundle-secrets.mjs` scans
`packages/sdk/dist` in CI.
