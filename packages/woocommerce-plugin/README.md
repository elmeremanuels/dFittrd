# @curtain/woocommerce-plugin

**Curtain for WooCommerce** — a dependency-free PHP 8.2+ WordPress/WooCommerce plugin (docs/DECISIONS.md D6/D7):

- product-edit meta box for every GarmentPayload §3.1 field, saved as `_curtain_*` post meta in the exact formats `@curtain/schema`'s `fromWooMeta` reads;
- push-on-save sync to `PUT /v1/merchant/products/{id}` with **PK-HMAC** auth (retries via Action Scheduler, WP-Cron fallback), `DELETE` on trash/unpublish, "Sync all" backfill;
- bundled `assets/sdk.v1.js` (copied from `@curtain/sdk` at build time — never loaded remotely) + "Try it on" button on single product pages;
- Connect round-trip (`POST /v1/merchant/woo/connect` → Stripe Checkout → `/complete` → `PUT /v1/merchant/shops/self`), manual key paste, status, ads toggle;
- domain proof for every Connect (manual key and Stripe): `GET /wp-json/curtain/v1/verify` at the host root, only while a Connect is pending (the former signed backfill endpoint was removed, see below);
- local validation against `assets/garment-draft.schema.json` (from `@curtain/schema`) and the backend dry-run `POST /v1/merchant/products/validate` for inline completeness feedback;
- HPOS compatibility declaration, `uninstall.php`, `readme.txt` with the WP.org *External services* section, `languages/` with an nl_NL `.po`.

Nothing leaves the site until the merchant clicks **Connect**; the secret key is stored encrypted (libsodium, OpenSSL fallback) using the site salts.

## Layout

```
curtain.php                 plugin header, requirements check (WC ≥ 9, PHP ≥ 8.2), HPOS declaration, boot
uninstall.php                queue + notices always removed; settings/meta only when the option says so
includes/
  autoload.php               class-map autoloader for the Curtain\ namespace
  class-plugin.php           wires everything, activation/deactivation
  class-settings.php         option storage (encrypted secrets) + settings page + Connect handlers
  class-api-client.php       wp_remote_request wrapper: connect/complete/hello/upsert/validate/delete/list
  class-hmac.php             PK-HMAC sign + verify (pure)
  class-secret-store.php     at-rest encryption of sk_/connect token (pure)
  class-vocab.php            vocabularies mirrored from @curtain/schema + category inference (pure)
  class-schema-validator.php JSON Schema draft-2020-12 subset validator (pure)
  class-payload-builder.php  WC snapshot + meta → GarmentPayload draft; PHP twin of fromWooMeta (pure)
  class-sanitizer.php        meta-box POST → _curtain_* meta rows
  class-product-snapshot.php WC_Product → plain array (REST v3 subset) + meta reader
  class-product-meta.php     the meta box (render, save, validate, list column)
  class-sync.php             hooks, jobs, retry policy
  class-queue.php            Action Scheduler / WP-Cron abstraction
  class-frontend.php         SDK enqueue (data-shop/data-api/data-mode/data-size-option/data-locale/data-label), button, shortcode
  class-rest.php             Connect domain proof (verify route + meta tag)
assets/admin/                meta-box.js (repeaters, media picker), meta-box.css
assets/                      sdk.v1.js, garment.schema.json, garment-draft.schema.json (build output, git-ignored)
languages/                   curtain-woocommerce.pot, curtain-woocommerce-nl_NL.po
scripts/                     build.mjs, lint.mjs, export-fixtures.mjs
tests/                       run.php (runner), shims.php (WP/WC shims), *.test.php, fixtures/ (generated)
```

## Public API

This package is an application (a plugin zip); no other package imports it. Its public surfaces are:

**Wire (to apps/api)** — `Authorization: PK-HMAC key=<pk_…>, ts=<unix s>, sig=<hex HMAC-SHA256(sk, "METHOD\n<path+query>\n<ts>\n<sha256hex(body)>")>` on `PUT /v1/merchant/products/{postId}` (body = GarmentPayload draft, `id` = WooCommerce post id as a string), `DELETE /v1/merchant/products/{postId}`, `POST /v1/merchant/products/validate` (`{ payload }`), `PUT /v1/merchant/shops/self` (`{ name, siteUrl, pluginVersion, platformVersion, adsEnabled }`), `GET /v1/merchant/products`. Unauthenticated, merchant-click only: `POST /v1/merchant/woo/connect` (`{ siteUrl, name, email?, returnUrl }`), `POST /v1/merchant/woo/complete` (`{ connectToken }`).

**Inbound: Connect domain proof (carry-over #12)** — on both paths (manual key and Stripe Checkout, whose free trial is no proof of a domain) the api issues keys only after it has read the nonce from `POST /v1/merchant/woo/connect` (`verification.nonce`) back from the root of the claimed host: `GET https://<host>/wp-json/curtain/v1/verify` → `{"nonce": "cv_…"}`, then `https://<host>/?rest_route=/curtain/v1/verify`. The path of the site URL is ignored (the shop is keyed by host, so a subdirectory proves nothing about the host), and there is no meta-tag fallback (a reflected string on a page must not count). The api fetches through its SSRF guard (DNS pinned, private addresses refused) and the final URL after redirects must be the same site (`www.` allowed). The nonce is HMAC-derived from the Connect token with a server key, so serving it publicly does not leak the token. A site on a private address cannot pass; set `WOO_DOMAIN_PROOF=0` on a local api for development.

**Removed: signed backfill endpoint (carry-over #13)** — `GET /wp-json/curtain/v1/products…` existed for an api-side pull that was never built: the api has no signer for it (Bearer auth stores only a hash of the key). The plugin pushes every product on save and "Sync all" re-pushes the catalogue, so the endpoint was removed rather than kept as an unused, publicly reachable surface. If a pull is ever needed, build the signer in the api first (it can decrypt `apiKeyEnc`), then reintroduce the route.

**Post meta** — the 17 `_curtain_*` keys from `WOO_META_KEYS` (JSON strings for json/list kinds, plain strings otherwise, the flat-lay as an absolute URL) plus plugin-private keys `_curtain_flat_lay_photo_id`, `_curtain_sync_status` (`pending|retrying|active|incomplete|archived|error`), `_curtain_sync_error`, `_curtain_synced_at`, `_curtain_content_hash`, `_curtain_score`, `_curtain_missing_fields`, `_curtain_validation`, `_curtain_local_issues`.

**Storefront** — `<script src="…/assets/sdk.v1.js" data-shop="pk_…" data-api="https://api.…" data-mode="embed|app" data-size-option="pa_size" data-locale="en|nl" data-label="…" data-peek="on|off" data-app="https://app.…">` and `<button type="button" class="button alt curtain-try-button" data-curtain-product="<postId>" data-curtain-mode="embed" data-curtain-size-option="pa_size" data-curtain-peek="on|off">`; shortcode `[curtain_button product_id="" label="" class="" peek=""]` (`peek="off"` hides the size peek next to that button).

**Size peek** — setting *Show the shopper's size on product pages* (`show_size`, default on; never in app mode). A shopper who found their size on this shop before sees "Your size: M" and a small drawing of their figure next to the button, in an iframe on the fitting room's origin that the shop page cannot read (`packages/sdk/README.md` "Size peek"). `data-app` is the API origin with `api.` replaced by `app.` (`Settings::app_origin()`); an API host without `api.` gets no peek.

**Standalone is the default** (decision D11, `docs/STANDALONE.md`). With *Experience* = *On the product page (no app needed)* (`mode = embed`), a click opens a full-screen overlay on the product page with the Curtain fitting room in an iframe. The shopper's measurements stay in their browser. When they choose a size, the SDK selects it in `form.variations_form select[name="attribute_<size_attribute>"]` (jQuery `change`, so `wc-add-to-cart-variation` updates price and stock) and the shopper adds to cart with the theme's own button. *Curtain app* (`mode = app`) is the opt-in alternative: deep link on phones, QR code on desktops. Both settings are sanitised (`Settings::sanitize_mode`, `Settings::sanitize_size_attribute`); unknown values fall back to `embed` / `pa_size`.

**WordPress hooks** — jobs `curtain_push_product( $productId, $attempt )`, `curtain_delete_product( $externalId, $attempt )`, `curtain_sync_all( $page )` (Action Scheduler group `curtain`). Option `curtain_settings`.

## Running

```sh
pnpm --filter @curtain/woocommerce-plugin typecheck   # php -l on every PHP file
pnpm --filter @curtain/woocommerce-plugin test        # export fixtures from @curtain/schema, then php tests/run.php
pnpm --filter @curtain/woocommerce-plugin build       # copy sdk + schema json into assets/, php -l, zip → dist/curtain-woocommerce.zip
php tests/run.php hmac                                 # run a subset
```

`build` needs `@curtain/sdk` and `@curtain/schema` built first (the root `pnpm build` does packages before apps). The tests run under plain `php` with the shims in `tests/shims.php` (no WordPress, no Brain Monkey); they cover the HMAC signer against Node-computed vectors, the secret store, the JSON Schema validator against the bundled schema, the sanitiser, the payload builder's byte-for-byte parity with `fromWooMeta` on all 41 `MOCK_GARMENTS`, and the push/delete jobs end-to-end through a mocked `wp_remote_request` (including the retry policy).

## Pilot store install (direct zip)

1. `pnpm --filter @curtain/woocommerce-plugin build` → `dist/curtain-woocommerce.zip`.
2. WordPress admin → *Plugins → Add New → Upload Plugin* → upload the zip → *Activate*. Requires WooCommerce ≥ 9.0, PHP ≥ 8.2.
3. *WooCommerce → Curtain*. For staging, set **API base URL** to the staging api first (Advanced section). Click **Connect to Curtain**:
   - with Stripe configured on the api the admin is sent to Checkout and back to the settings page (`?curtain=connected`), which finishes the token exchange automatically (or via *Finish connection*);
   - without Stripe (`mode: manual-key`) the connection completes immediately on the free plan.
   - Alternative: paste an `sk_live_…` key from the merchant console under *Or paste an API key*; the hello call fills in the `pk_` prefix.
4. The connect enqueues **Sync all**. Open a product → *Curtain — fit data* → fill category, chart type, size chart, fabric, flat-lay → *Update*. The status panel shows the backend verdict (score, missing fields).
5. Visit the product page: the **Try it on** button appears for products synced as `active` (switch *Show for* to all products to test earlier).

## WP.org submission checklist

- [ ] Plugin slug `curtain-woocommerce`, text domain identical, `Stable tag` = plugin header version = `CURTAIN_VERSION` (the build script enforces this).
- [ ] GPL-2.0-or-later headers; no Composer/vendor code; no minified-only JS (meta-box.js is source; sdk.v1.js ships with its source in `packages/sdk`).
- [ ] No remote code: `assets/sdk.v1.js` is bundled; the only external calls are the documented API calls.
- [ ] *External services* section in `readme.txt` lists the API host, what is sent, when, and links to terms + privacy (done; update the URLs when the legal pages go live).
- [ ] No telemetry before Connect (asserted in `tests/sync.test.php`).
- [ ] Nonces + capability checks on every admin action (`manage_woocommerce` for settings, `edit_post` for the meta box); all output escaped; all input sanitised.
- [ ] `uninstall.php` present; data deletion opt-in.
- [ ] HPOS compatibility declared; `Requires Plugins: woocommerce`.
- [ ] Trademark: "WooCommerce" only in the descriptive sense ("for WooCommerce"), not as the first word of the slug.
- [ ] Screenshots `assets/screenshot-1.png` … in the SVN `assets/` folder (not in the zip) — to produce from the pilot store.
- [ ] Run PHPCS with WordPress-Extra + WooCommerce-Core rulesets once available (not available offline here); `php -l` is enforced by the build.
- [ ] Submit at https://wordpress.org/plugins/developers/add/ with the built zip; expect a multi-week review and keep the direct-zip install for the pilot.

## Manual verification (needs a WordPress + WooCommerce install and the api)

1. **Activation guards**: activate on PHP < 8.2 / without WooCommerce / with WooCommerce 8.x → admin error notice, no fatal.
2. **Connect (Stripe mode)**: api with `STRIPE_*` set → Connect redirects to Checkout → after payment the settings page shows *Connected*, plan, `pk_` prefix; `shops` row has `connect_state = complete`. Cancelled checkout → *Finish connection* reports `payment_pending`.
3. **Connect (manual mode)**: api without Stripe → connection completes immediately on the free plan.
4. **Push on save**: update a product → Action Scheduler (*WooCommerce → Status → Scheduled Actions*, group `curtain`) shows `curtain_push_product`; the api `products` row is upserted; the meta box shows the score/missing fields; the product list column shows the status badge. Trash → `curtain_delete_product` → api status `archived`. Untrash/publish → pushed again.
5. **Retry**: stop the api → save a product → the action re-schedules with 1/2/4/8/16 min backoff and the panel shows *Syncing…*; after 6 attempts the status is *Sync error* with the message.
6. **Clock skew**: set the WP server clock 6 min off → `stale_signature` → retried; back in sync → succeeds.
7. **Storefront (standalone, default)**: product page loads `assets/sdk.v1.js` with `data-shop`, `data-api`, `data-mode="embed"`, `data-size-option="pa_size"`, `data-locale`, `data-label`; the button triggers `POST /v1/sdk/sessions` with `surface: 'embed'` and opens the overlay on desktop and on a phone; after *Choose size M* the size dropdown shows M and the price/stock of that variation. Paused plan → button still renders, the overlay shows "shop paused". `[curtain_button]` in a block renders the same button. The local `pnpm demo` storefront (`apps/demo-shop`, WooCommerce-style page) reproduces this without WordPress.
8. **Storefront (Curtain app)**: with *Experience* = *Curtain app*, desktop shows the QR modal with the estimate disclaimer and a phone opens the deep link.
9. **Domain proof**: with the api's Stripe settings empty, click Connect on a site reachable from the internet → while the request runs, `GET https://shop/wp-json/curtain/v1/verify` answers `{"nonce":"cv_…"}` and the front page carries the meta tag; after "Connected" both are gone (404, no tag). A site on localhost gets the "could not confirm" notice.
10. **Media picker**: pick a flat-lay from the media library → preview + attachment id saved; remove → meta deleted.
11. **Uninstall**: with the deletion option off, delete the plugin → settings + `_curtain_*` meta remain, queue cleared; with it on → everything removed.
12. **Translations**: set the site to Dutch → button label "Try it on" and the admin strings from `languages/curtain-woocommerce-nl_NL.po` (compile to `.mo` with `wp i18n make-mo languages/` before shipping — `.mo` files are not generated offline here).
