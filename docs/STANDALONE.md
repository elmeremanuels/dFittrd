# Standalone mode: the shop works without the Curtain app

Founder decision (Nov 2026): we start with the plugin alone. A shopper on a merchant's product page
must get the full fit experience **on that page**, without installing or opening the Curtain
consumer app. The app stays as an optional extra ("save your fit profile across shops"), never a
requirement. This document is the contract every package builds against. Decision D11 in
`docs/DECISIONS.md` points here.

## 1. Shopper flow

1. The merchant's product page shows the **Try it on** button. The plugin installs the button: a
   Shopify theme block, or the Woo button/shortcode. The SDK (`@curtain/sdk`) handles it.
2. Click → the SDK calls `POST /v1/sdk/sessions` with `surface: 'embed'` and opens a full-screen
   **overlay on the merchant page**. The overlay holds an `<iframe>` pointing at `embedUrl`
   (`https://app.<domain>/embed/<tryToken>`). This happens on desktop **and** on mobile. There is
   no QR code and no deep link in standalone mode.
3. Inside the iframe (our origin, `apps/web` route `/embed/:token`) the shopper goes through:
   1. **Product header**: shop name or brand colour, product name, product photo, and a short
      privacy line ("Your measurements stay on this device").
   2. **About you** (one screen, under 30 seconds): height (cm), weight (kg), fit preference
      (snug / regular / relaxed), optional age range. An expandable "I know my measurements"
      section takes bust / waist / hip (and inseam for bottoms) with a "measured with a tape"
      toggle. Missing girths come from the population prior (`apps/web/src/features/capture` prior
      module) with honest, lower confidence.
   3. Optional **camera scan** ("More accurate: 30-second scan"), only shown when
      `navigator.mediaDevices` exists. It reuses the existing CaptureStep; frames never leave the
      device. Skipping it is a first-class path.
   4. **Result**: the recommended size from `@curtain/fit-engine`, the per-point fit (FitPanel),
      the avatar with the garment overlay (Avatar, Path B v0), the confidence, and the estimate
      disclaimer. The shopper can switch to the neighbouring sizes and see the difference.
   5. **Choose size X** → the iframe posts `curtain:size-selected` to the parent. The SDK selects
      the matching variant on the merchant page and closes the overlay. Add-to-cart stays the
      merchant's own button.
   6. Optional, only when the shop has hero renders enabled: **See it on me**. This is the
      existing hero-render API with explicit consent. It renders the avatar, never a photo.
   7. Footer: "Remember me on this shop" (default on; stores the profile in the iframe's own
      IndexedDB, which the browser partitions per shop site), **Forget me** (deletes local data
      and calls `DELETE /v1/me`), and a small "Get the Curtain app" link that is never required.
4. A returning shopper on the same shop skips straight to the result when a remembered profile
   exists, with an "Edit my measurements" link.

## 2. Wire contract

### `POST /v1/sdk/sessions` (changed)

- `surface`: `'button' | 'api' | 'embed'`. The SDK sends `'embed'` in standalone mode.
- The response gains `embedUrl` (`${PUBLIC_APP_URL}/embed/${token}`) on every response. `tryUrl`
  and `qrSvg` stay for app mode; the SDK may skip the QR work when `surface` is `'embed'`
  (`qrSvg` becomes optional in the response schema).
- Same 402-with-body behaviour when the shop is paused. The embed shows the paused screen.

### `GET /v1/try/:token` (unchanged path, extended response)

- Still needs a device token. The embed registers its own anonymous device with `POST /v1/devices`
  on first load and stores it in its partitioned IndexedDB. With "Remember me" off, it uses memory
  only.
- The response gains `embed: { allowedOrigins: string[] }`. These are the https origins of the
  shop's storefront (Shopify: `https://<shop>.myshopify.com` plus the shop's primary domain if
  known; Woo: the site URL origin), plus the origin of the session's `pageUrl` when it belongs to
  the shop. The embed uses them as the `targetOrigin` for `postMessage` and never posts to `*`.
- The pairing source for `surface: 'embed'` is `'embed'`.

### `POST /v1/try/:token/fit-shown` (new, the billing event for standalone)

- Body: `{ intentToken, recommendedSize, confidence }`. Device-authenticated.
- Records exactly one billable try-on session per intent token (D7 idempotency; replays return
  200 with `billed: false`). It writes a ledger entry for the shopper (kind `fit`, payload summary
  only, no measurements) and a usage event for the shop.
- Response `{ billed: boolean }`. A paused shop gets 402 and is not billed.
- No body measurements ever go to the server in standalone mode. The fit runs in the iframe. Only
  the chosen size label and the confidence go up, for merchant analytics.

### `postMessage` protocol (iframe → parent, parent → iframe)

All messages are objects `{ source: 'curtain', v: 1, type, ... }`.

| Direction | type | payload |
|---|---|---|
| iframe → parent | `curtain:ready` | `{}`, after the first paint |
| iframe → parent | `curtain:resize` | `{ height }`, optional; the overlay is full-screen anyway |
| iframe → parent | `curtain:size-selected` | `{ productExternalId, size }`, where `size` is the size label from the size chart |
| iframe → parent | `curtain:close` | `{}` |
| parent → iframe | `curtain:context` | `{ locale, currentVariantSize? }`, sent after `curtain:ready` |

- The parent (SDK) accepts messages only when `event.origin` equals the origin of `embedUrl` and
  `event.source` is the iframe's `contentWindow`.
- The iframe posts only to an origin in `embed.allowedOrigins`. If `document.referrer`'s origin is
  not in that list, it still works but does not post `size-selected`, and shows "choose size X on
  the shop page" instead.

### Variant selection on the merchant page (SDK)

`data-size-option` names the product option that holds the size (default: `Size`, matched
case-insensitively, also `Maat`, `Taille`, `Größe`). The SDK tries, in this order:

1. A custom handler: `window.CurtainHooks?.onSizeSelected?.({ size, productExternalId })`. When it
   returns `true`, the SDK stops.
2. Shopify: a radio input or `<select>` inside `form[action*="/cart/add"]` whose `name` or legend
   matches the option. It sets the value and dispatches `change` and `input` (bubbling), which
   Dawn and most Online Store 2.0 themes listen to.
3. WooCommerce: `select[name^="attribute_"]` in `form.variations_form` whose label or attribute
   name matches (for example `attribute_pa_size`). It sets the value whose text or slug matches the
   size and triggers `change` (jQuery's `.trigger('change')` when `window.jQuery` exists, so
   `wc-add-to-cart-variation` reacts).
4. Otherwise a small toast on the page: "Your size: M". Never an error.

The SDK fires a DOM event `curtain:size-selected` on the button element in every case, so themes
can hook in.

### SDK configuration

- `data-mode`: `'embed'` (default, standalone) | `'app'` (the old deep-link/QR flow) | `'auto'`
  (embed, plus an "Open in the Curtain app" link inside the overlay). Unknown values fall back to
  `'embed'`.
- `data-size-option`, as above.
- The overlay is accessible: focus trap, Escape closes, `aria-modal`, return focus to the button,
  `prefers-reduced-motion`. The iframe gets `allow="camera; fullscreen"` and `title`, plus a
  loading state. The body is scroll-locked while the overlay is open.
- The gzip budget stays at 8 KB for `sdk.v1.js`.

### Framing and headers

- `/embed/*` on the web origin is the only framable route: `frame-ancestors https:` (any https
  shop; the token, not the frame, is the access control) and no `X-Frame-Options`. Every other
  route keeps `frame-ancestors 'none'`. Update `infra/Caddyfile` with a separate `@embed` matcher
  and header block. COEP must not break the embed. Check the Caddy config for
  `Cross-Origin-Embedder-Policy` and `Cross-Origin-Resource-Policy` and make sure a cross-origin
  parent can frame the page (`Cross-Origin-Resource-Policy: cross-origin` on the embed document
  if needed).
- The Vite dev server must also serve `/embed/*` framable for the local demo.

## 3. Merchant side (plugins)

- **Shopify theme block** ("Try it on"): a new setting "Experience" with choices *On the product
  page (no app needed)*, the default, and *Curtain app*. It is rendered as `data-mode`. A new
  "Size option name" setting is rendered as `data-size-option`. Update the locales (en + nl).
- **WooCommerce**: the same two settings on the Curtain settings page (`mode`, `size_attribute`
  with a dropdown of the product attributes, default `pa_size`). They are rendered on the button
  and the shortcode. Update the `.pot` file and `nl_NL.po`.
- The merchant console and the README files describe standalone as the default.

## 4. Local demo (needed for screenshots and for the founder)

`pnpm demo` at the repo root starts, with no Docker and no keys:

- the api on PGlite (in-memory or `./.demo-db`), migrated and **seeded** with a demo shop ("Aalter
  Studio", `pk_test_` key built at runtime), 8 or more active products from the schema fixtures,
  and the mock try-on provider;
- the web app (Vite) with `/embed` framable;
- a **demo storefront** at `http://localhost:<port>/` (a static page served by a tiny Node server
  or by Vite from `apps/demo-shop/`). It has a product grid and two product pages: one in
  Shopify-Dawn style with a size radio group, one in WooCommerce style with
  `select[name=attribute_pa_size]`. Both load `sdk.v1.js` from the api and show the button.

It prints the URLs. `scripts/demo.mjs` orchestrates the processes and stops them on Ctrl-C. A
Playwright smoke test (`pnpm demo:e2e`, outside `pnpm check`) clicks through: storefront → button →
overlay → about you → result → choose size → the variant is selected on the page.

## 5. What stays out of standalone mode

- The swipe deck, wardrobe and Style DNA belong to the app. The embed does not show them.
- Pairing across shops: each shop's embed is its own island. The app can pair later.
- Order attribution stays off (D7).
