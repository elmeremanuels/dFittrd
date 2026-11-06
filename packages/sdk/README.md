# @curtain/sdk

The merchant drop-in for **Curtain**. One `<script>` tag turns any `<button data-curtain-product="…">`
on a product page into the Curtain try-on. Since decision D11 the default is **standalone**: the
shopper gets the whole fit experience in an overlay on the shop's own page and never needs the
Curtain app. The contract is `docs/STANDALONE.md` §2.

```
standalone (data-mode="embed", the default; also "auto"), desktop and mobile:
click → POST {api}/v1/sdk/sessions { shopKeyPrefix, productExternalId, pageUrl, surface: 'embed' }
      → { embedUrl, tryUrl, expiresAt, shopPaused }
      → full-screen overlay with <iframe src="{embedUrl}" allow="camera; fullscreen">
      → iframe posts curtain:size-selected { size } → the SDK selects the variant on the page

app mode (data-mode="app", the pre-standalone flow, unchanged):
click → POST {api}/v1/sdk/sessions { …, surface: 'button' } → { tryUrl, qrSvg, expiresAt, shopPaused }
      → phone/tablet: location.href = tryUrl (universal link into the PWA)
      → desktop:     accessible QR modal ("Scan with your phone to try it on in Curtain")
```

Vanilla TypeScript, **zero runtime dependencies**, es2019, **< 8 KB gzipped** (asserted in
`src/size.test.ts` and at build time by `scripts/check-size.mjs`). The merchant page only ever
learns "opened": no cookies, no storage, no tracking, no third-party requests, and nothing but the
documented fields on the wire (`credentials: 'omit'`). `pageUrl` is sent as origin + path only (query
string and fragment are stripped: they can carry e-mail addresses, UTM ids or tokens).

Hardening: a `tryUrl` that is not an absolute `http(s)` URL is refused (no `javascript:`/`data:`
navigation or link on the merchant page; the shopper sees the polite error instead). When the
SDK is loaded twice on one page, the second copy finds `window.Curtain` already installed and
stays inactive, so buttons are never bound twice. In standalone mode the SDK only accepts messages
whose `event.origin` is the origin of `embedUrl` **and** whose `event.source` is the overlay's own
iframe, and it posts back to that origin only (never `*`). An `embedUrl` that is not `http(s)` is
refused (the SDK falls back to app mode). Measurements and photos never touch the merchant page:
the fit runs inside the iframe, and only the chosen size label comes back (D3).

## Merchant snippet

```html
<script
  src="https://api.curtain.fit/sdk/v1.js"
  data-shop="pk_live_xxxxxxxxxxxx"
  defer
></script>

<button data-curtain-product="aalter-studio-1">Try it on</button>
```

That is all a merchant needs. The Shopify theme app extension and the WooCommerce plugin inject
this tag themselves (the plugin bundles `sdk.v1.js` because of the WP.org no-remote-code rule and
must then set `data-api`).

### Script-tag attributes

| Attribute                | Required | Meaning                                                                                   |
| ------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `data-shop`              | yes      | Public shop key prefix `pk_live_…` / `pk_test_…`. Secret keys (`sk_…`) are rejected.       |
| `data-api`               | no       | API origin, e.g. `https://api.curtain.fit`. Defaults to the origin the script was loaded from. |
| `data-mode`              | no       | `embed` (default): the standalone overlay on this page. `auto`: the same, plus an "Open in the Curtain app" link. `app`: the old QR / deep-link flow (mobile UA → redirect, desktop → QR modal). The legacy values `redirect` and `modal` still force app mode's deep link or QR modal. Anything else falls back to `embed`. |
| `data-size-option`       | no       | The product option that holds the size. Default `Size`; `Maat`, `Taille` and `Größe` always match too (case-insensitive). |
| `data-locale`            | no       | `en` or `nl`. Defaults to `<html lang>`, then `en`. The browser language never changes the button or overlay copy. |
| `data-label`             | no       | Text for buttons that are empty. Default "Try it on".                 |
| `data-app`               | no       | The fitting room's origin, e.g. `https://app.curtain.fit`. Needed for the size peek (below); without it there is no peek. The Shopify block and the Woo plugin set it. |
| `data-peek`              | no       | `on` (default) or `off`: the size peek next to each button. |
| `data-curtain-unstyled` | no       | Do not inject the stylesheet or the `pk-btn` class (you style the buttons yourself).      |

### Button attributes (on `<button>`, `<a>` or any element)

| Attribute                | Meaning                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `data-curtain-product`  | The product's external id (Shopify: numeric part of the Product GID; Woo: post id or SKU as synced). |
| `data-curtain-unstyled` | Skip the built-in coral/cream styling for this element only.                                     |
| `data-curtain-peek`     | `off` keeps the size peek away from this button only.                                            |

Behaviour per element: an empty element gets the default label; a `<button>` without `type` gets
`type="button"`; non-button elements get `role="button"`, `tabindex="0"` and Enter/Space handling;
while a handshake runs the element carries `data-curtain-state="loading"` and `aria-busy="true"`.
A `MutationObserver` binds buttons that appear later (SPA / headless storefronts), so the attribute
just works with React, Hydrogen, etc.

### `window.Curtain`

```ts
window.Curtain.open(productId, { mode?: 'embed' | 'auto' | 'app' | 'redirect' | 'modal', pageUrl?, trigger? })
  // → Promise<OpenResult>; never rejects
window.Curtain.configure({ shop?, api?, mode?, sizeOption?, unstyled?, label?, locale?, timeoutMs? })
window.Curtain.scan()      // bind new buttons now (the observer does this automatically)
window.Curtain.destroy()   // remove listeners, observer, styles and any open modal
window.Curtain.version     // '0.1.0'
```

`OpenResult.kind` is `'embed' | 'redirect' | 'modal' | 'paused' | 'error' | 'ignored'`.

## Standalone overlay

The overlay is the same dialog component as the app-mode modal, in a full-screen variant: a large
centred panel on desktop and edge to edge below 768 px. It has `role="dialog"`, `aria-modal="true"`,
`aria-labelledby` (the "Try it on in Curtain" heading), a close button, `aria-busy` plus a
`role="status"` "Loading…" line until the iframe loads or says `curtain:ready`, and an iframe with
`title` and `allow="camera; fullscreen"`. Focus moves into the dialog and returns to the button on
close; Tab / Shift+Tab are trapped, and focus that leaves the iframe towards the page is pulled back
into the dialog. Escape (while focus is on the page side) and the backdrop close it; the iframe
handles Escape inside itself by posting `curtain:close`. The body is scroll-locked while it is open,
and every animation is off under `prefers-reduced-motion`.

### postMessage protocol

Every message is `{ source: 'curtain', v: 1, type, … }`; anything else is ignored.

| Direction | `type` | Payload | What the SDK does |
| --- | --- | --- | --- |
| iframe → page | `curtain:ready` | `{}` | Clears the loading state and answers with `curtain:context`. |
| page → iframe | `curtain:context` | `{ locale, currentVariantSize? }` | `locale` is `data-locale`, else `<html lang>`, else the browser language. `currentVariantSize` is the size selected on the page when a size control is found. |
| iframe → page | `curtain:size-selected` | `{ productExternalId, size }` | Ignored unless `productExternalId` is the opened product and `size` is 1–64 characters. Closes the overlay, then selects the variant (below). |
| iframe → page | `curtain:close` | `{}` | Closes the overlay. |
| iframe → page | `curtain:resize` | `{ height }` | Ignored: the overlay is full-screen. |
| peek → page | `curtain:peek-size` | `{ height }` | Size peek only (below): sets the peek iframe's height (0–200 px). |
| peek → page | `curtain:peek-open` | `{}` | Size peek only: clicks the shop's button, which opens the overlay. |

### Variant selection

After `curtain:size-selected` the SDK tries, in order:

1. `window.CurtainHooks.onSizeSelected({ size, productExternalId })`. If it returns `true`, the SDK
   does nothing else. A hook that throws is ignored.
2. **Shopify**: a radio or `<select>` owned by a `form[action*="/cart/add"]` (Dawn and other Online
   Store 2.0 themes point at it with the `form` attribute) or inside `<variant-radios>` /
   `<variant-selects>`, whose `name`, fieldset `legend` or `<label>` names the size option. It
   checks the radio or sets the option whose value or text matches the size, then dispatches
   bubbling `input` and `change`. Disabled radios are skipped.
3. **WooCommerce**: `form.variations_form select[name^="attribute_"]` whose name (for example
   `attribute_pa_size`) or label names the size option. It picks the option whose text or slug
   matches (`M` ↔ `m`, `One size` ↔ `one-size`) and triggers `change` through `window.jQuery` when
   present (so `wc-add-to-cart-variation` reacts), else a native bubbling `change`.
4. Otherwise a polite toast on the page: "Your size: M" (`role="status"`, gone after 6 s). Never an
   error.

In every case the button then receives a bubbling DOM event:

```js
document.addEventListener('curtain:size-selected', (e) => {
  // e.target: the button; e.detail: { size: 'M', productExternalId: '…', via: 'hook' | 'shopify' | 'woo' | 'toast' }
});
```

(For a programmatic `Curtain.open()` without a `trigger`, the event fires on `document`.)

When the API has no `embedUrl` (an older backend), the SDK falls back to the app-mode flow. A shop
that is paused (402 with a session) still opens the overlay; the embed shows the paused screen.

## Size peek

A returning shopper (one who found their size in the overlay on this shop, with "Remember me" on)
sees "Your size: M", one short fit note and a small drawing of their own figure in that size, next
to the button on every product page, without clicking. The founder's request; privacy D3 and D7
decide how it is built:

- **A cross-origin iframe.** After each bound button the SDK inserts
  `<iframe src="{data-app}/embed/peek?shop={data-shop}&product={id}" title="Your size"
  referrerpolicy="origin">`, lazily: an `IntersectionObserver` inserts it when the button comes
  within 300 px of the viewport. It starts at `height: 0; visibility: hidden` (no space, out of the
  tab order) and grows only when the peek reports a height, at most 200 px. So a first-time
  visitor never causes a layout shift, and a returning shopper causes one, once.
- **The page never learns the size.** The iframe is on our origin: the page cannot read it. The
  SDK accepts two messages from it, only from that iframe's window and the `data-app` origin:
  `curtain:peek-size { height }` and `curtain:peek-open {}`. Neither carries a size, a measurement
  or an id. The size reaches the page only when the shopper presses "Choose size" in the overlay
  (`curtain:size-selected`, as before).
- **One bit is visible.** The page can see whether the peek grew, so it can tell that this browser
  has a remembered profile on this shop. That is the cost of reserving space only for shoppers who
  have one; it says nothing about the size or the body.
- **Tokenless, and not billed.** The SDK sends nothing to the api for the peek. Inside the iframe
  (`apps/web/src/embed/peek.ts`) the peek first reads its own partitioned storage: no profile, no
  remembered device, or "Remember me" off → it collapses (`height: 0`) without any api request.
  Only with a remembered profile does it mint a session (`POST /v1/sdk/sessions` with
  `surface: 'api'`, which `fit-shown` never bills), resolve it with the remembered device, and
  compute the fit on the device with `@curtain/fit-engine`. It never calls `fit-shown` and never
  registers a device. The billable session starts when the shopper opens the overlay.
- **Opening the overlay.** The peek's "See how size M fits you" button posts `curtain:peek-open`;
  the SDK then clicks the shop's own button, so the normal overlay flow (and the merchant's own
  click listeners) run. A returning shopper lands straight on the result.
- The drawing is labelled "Estimate" (AGENTS.md rule 3) and the peek says "Only you can see this.
  The shop can't."

Turn it off with `data-peek="off"` (Shopify: untick "Show the shopper's size on product pages";
WooCommerce: the same setting, or `[curtain_button peek="off"]`). The plugins also turn it off in
app mode. Bundle cost: about 0.4 KB gzip; `sdk.v1.js` is now 8,188 of 8,192 bytes, so there is no
budget left for anything else.

## App-mode desktop modal (a11y)

`role="dialog"`, `aria-modal="true"`, `aria-labelledby` / `aria-describedby`, focus moved into the
dialog on open and back to the button on close, Tab / Shift+Tab trapped, Esc and backdrop click
close, body scroll locked, animations disabled under `prefers-reduced-motion`. It shows the QR (the
API's `qrSvg`, rendered through an inert `<img src="data:image/svg+xml,…">` so SVG can never run
script), the scan hint, an "open the link on this device" fallback, the expiry, the shop-paused note
when applicable, and the estimate disclaimer (identical to `ESTIMATE_DISCLAIMER` in
`@curtain/schema`, asserted in tests). Design tokens: coral `#FF5A3C`, cream `#F5EFE7`, ink
`#1A1612`; no fonts are loaded.

The API renders `qrSvg` for app-mode surfaces. If a response carries none, the modal still shows the
"open the link" fallback. The built-in QR encoder (`src/qr.ts`, byte mode, EC level L, versions 1–40,
round-trip tested with a real decoder) is kept in the source but no longer bundled: the standalone
overlay needed its 2 KB of the 8 KB budget.

## Never breaking the merchant page (D7)

Every error is caught. If the backend answers 402/423 ("shop paused") **with** a session, or 200
with `shopPaused: true`, the SDK proceeds as normal: the embed or the app shows the paused screen. Without a
`tryUrl` it shows a polite message. Network errors and 5xx also show a polite message. The SDK
never throws into merchant code and never leaves a button in a stuck state.

## ESM use (bundlers)

```ts
import { init } from '@curtain/sdk';
init({ shop: 'pk_live_…', api: 'https://api.curtain.fit' });
```

Everything the IIFE does is exported: `init`, `open`, `configure`, `scan`, `destroy`, `isMobile`,
`openModal`, `openEmbed`, `selectSize`, `currentSize`, `toast`, `pickStrings`, `STRINGS`, `CSS`,
`VERSION`, and the types `CurtainConfig`, `OpenOptions`, `OpenResult`, `CurtainApi`,
`CurtainHooks`, `SizeSelectedDetail`. The wire types (`SdkSessionRequest`, `SdkSessionResponse`,
`EmbedMessage`, `EmbedContextMessage`) are copies of the `@curtain/schema` DTOs in `src/types.ts`,
so the SDK has no dependency at all; keep them in sync with the schema.

## Build / test

```
pnpm --filter @curtain/sdk typecheck   # tsc --noEmit
pnpm --filter @curtain/sdk test        # vitest + jsdom (embed protocol, variant selection, a11y; jsqr for the QR round-trip; esbuild for the size budget)
pnpm --filter @curtain/sdk build       # tsup → dist/sdk.v1.js (IIFE) + dist/sdk.v1.esm.js (ESM) + sdk.v1.d.ts; then the size check
pnpm --filter @curtain/sdk lint
```

Serve `dist/sdk.v1.js` from the API origin (Caddy static route), so `data-api` can be omitted and
the page makes zero third-party requests. The root `scripts/check-bundle-secrets.mjs` scans
`packages/sdk/dist` in CI.
