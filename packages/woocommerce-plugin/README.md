# @paskamer/woocommerce-plugin

**Paskamer for WooCommerce** — a dependency-free PHP 8.2+ WordPress/WooCommerce plugin (docs/DECISIONS.md D6/D7):

- product-edit meta box for every GarmentPayload §3.1 field, saved as `_paskamer_*` post meta in the exact formats `@paskamer/schema`'s `fromWooMeta` reads;
- push-on-save sync to `PUT /v1/merchant/products/{id}` with **PK-HMAC** auth (retries via Action Scheduler, WP-Cron fallback), `DELETE` on trash/unpublish, "Sync all" backfill;
- bundled `assets/sdk.v1.js` (copied from `@paskamer/sdk` at build time — never loaded remotely) + "Try in Paskamer" button on single product pages;
- Connect round-trip (`POST /v1/merchant/woo/connect` → Stripe Checkout → `/complete` → `PUT /v1/merchant/shops/self`), manual key paste, status, ads toggle;
- signed read endpoint `GET /wp-json/paskamer/v1/products/{id}` for backfill;
- local validation against `assets/garment-draft.schema.json` (from `@paskamer/schema`) and the backend dry-run `POST /v1/merchant/products/validate` for inline completeness feedback;
- HPOS compatibility declaration, `uninstall.php`, `readme.txt` with the WP.org *External services* section, `languages/` with an nl_NL `.po`.

Nothing leaves the site until the merchant clicks **Connect**; the secret key is stored encrypted (libsodium, OpenSSL fallback) using the site salts.

## Layout

```
paskamer.php                 plugin header, requirements check (WC ≥ 9, PHP ≥ 8.2), HPOS declaration, boot
uninstall.php                queue + notices always removed; settings/meta only when the option says so
includes/
  autoload.php               class-map autoloader for the Paskamer\ namespace
  class-plugin.php           wires everything, activation/deactivation
  class-settings.php         option storage (encrypted secrets) + settings page + Connect handlers
  class-api-client.php       wp_remote_request wrapper: connect/complete/hello/upsert/validate/delete/list
  class-hmac.php             PK-HMAC sign + verify (pure)
  class-secret-store.php     at-rest encryption of sk_/connect token (pure)
  class-vocab.php            vocabularies mirrored from @paskamer/schema + category inference (pure)
  class-schema-validator.php JSON Schema draft-2020-12 subset validator (pure)
  class-payload-builder.php  WC snapshot + meta → GarmentPayload draft; PHP twin of fromWooMeta (pure)
  class-sanitizer.php        meta-box POST → _paskamer_* meta rows
  class-product-snapshot.php WC_Product → plain array (REST v3 subset) + meta reader
  class-product-meta.php     the meta box (render, save, validate, list column)
  class-sync.php             hooks, jobs, retry policy
  class-queue.php            Action Scheduler / WP-Cron abstraction
  class-frontend.php         SDK enqueue (data-shop/data-api/data-locale/data-label), button, shortcode
  class-rest.php             signed backfill endpoint
assets/admin/                meta-box.js (repeaters, media picker), meta-box.css
assets/                      sdk.v1.js, garment.schema.json, garment-draft.schema.json (build output, git-ignored)
languages/                   paskamer-woocommerce.pot, paskamer-woocommerce-nl_NL.po
scripts/                     build.mjs, lint.mjs, export-fixtures.mjs
tests/                       run.php (runner), shims.php (WP/WC shims), *.test.php, fixtures/ (generated)
```

## Public API

This package is an application (a plugin zip); no other package imports it. Its public surfaces are:

**Wire (to apps/api)** — `Authorization: PK-HMAC key=<pk_…>, ts=<unix s>, sig=<hex HMAC-SHA256(sk, "METHOD\n<path+query>\n<ts>\n<sha256hex(body)>")>` on `PUT /v1/merchant/products/{postId}` (body = GarmentPayload draft, `id` = WooCommerce post id as a string), `DELETE /v1/merchant/products/{postId}`, `POST /v1/merchant/products/validate` (`{ payload }`), `PUT /v1/merchant/shops/self` (`{ name, siteUrl, pluginVersion, platformVersion, adsEnabled }`), `GET /v1/merchant/products`. Unauthenticated, merchant-click only: `POST /v1/merchant/woo/connect` (`{ siteUrl, name, email?, returnUrl }`), `POST /v1/merchant/woo/complete` (`{ connectToken }`).

**Inbound (for apps/api backfill)** — `GET /wp-json/paskamer/v1/products/{id}` and `GET /wp-json/paskamer/v1/products?page&per_page&status`, signed with the same PK-HMAC scheme (backend signs with the shop's `sk_`, presents the `pk_` prefix; target = path + query as sent, e.g. `/wp-json/paskamer/v1/products/42`). The single-product response is the WC REST v3 product subset `WooProductSchema` accepts plus `meta_data: [{key, value}]` (the `_paskamer_*` keys), `payload` (the plugin's own draft), `warnings`, `syncState`.

**Post meta** — the 17 `_paskamer_*` keys from `WOO_META_KEYS` (JSON strings for json/list kinds, plain strings otherwise, the flat-lay as an absolute URL) plus plugin-private keys `_paskamer_flat_lay_photo_id`, `_paskamer_sync_status` (`pending|retrying|active|incomplete|archived|error`), `_paskamer_sync_error`, `_paskamer_synced_at`, `_paskamer_content_hash`, `_paskamer_score`, `_paskamer_missing_fields`, `_paskamer_validation`, `_paskamer_local_issues`.

**Storefront** — `<script src="…/assets/sdk.v1.js" data-shop="pk_…" data-api="https://api.…" data-locale="en|nl" data-label="…">` and `<button type="button" class="button alt paskamer-try-button" data-paskamer-product="<postId>">`; shortcode `[paskamer_button product_id="" label="" class=""]`.

**WordPress hooks** — jobs `paskamer_push_product( $productId, $attempt )`, `paskamer_delete_product( $externalId, $attempt )`, `paskamer_sync_all( $page )` (Action Scheduler group `paskamer`). Option `paskamer_settings`.

## Running

```sh
pnpm --filter @paskamer/woocommerce-plugin typecheck   # php -l on every PHP file
pnpm --filter @paskamer/woocommerce-plugin test        # export fixtures from @paskamer/schema, then php tests/run.php
pnpm --filter @paskamer/woocommerce-plugin build       # copy sdk + schema json into assets/, php -l, zip → dist/paskamer-woocommerce.zip
php tests/run.php hmac                                 # run a subset
```

`build` needs `@paskamer/sdk` and `@paskamer/schema` built first (the root `pnpm build` does packages before apps). The tests run under plain `php` with the shims in `tests/shims.php` (no WordPress, no Brain Monkey); they cover the HMAC signer against Node-computed vectors, the secret store, the JSON Schema validator against the bundled schema, the sanitiser, the payload builder's byte-for-byte parity with `fromWooMeta` on all 41 `MOCK_GARMENTS`, and the push/delete jobs end-to-end through a mocked `wp_remote_request` (including the retry policy).

## Pilot store install (direct zip)

1. `pnpm --filter @paskamer/woocommerce-plugin build` → `dist/paskamer-woocommerce.zip`.
2. WordPress admin → *Plugins → Add New → Upload Plugin* → upload the zip → *Activate*. Requires WooCommerce ≥ 9.0, PHP ≥ 8.2.
3. *WooCommerce → Paskamer*. For staging, set **API base URL** to the staging api first (Advanced section). Click **Connect to Paskamer**:
   - with Stripe configured on the api the admin is sent to Checkout and back to the settings page (`?paskamer=connected`), which finishes the token exchange automatically (or via *Finish connection*);
   - without Stripe (`mode: manual-key`) the connection completes immediately on the free plan.
   - Alternative: paste an `sk_live_…` key from the merchant console under *Or paste an API key*; the hello call fills in the `pk_` prefix.
4. The connect enqueues **Sync all**. Open a product → *Paskamer — fit data* → fill category, chart type, size chart, fabric, flat-lay → *Update*. The status panel shows the backend verdict (score, missing fields).
5. Visit the product page: the **Try in Paskamer** button appears for products synced as `active` (switch *Show for* to all products to test earlier).

## WP.org submission checklist

- [ ] Plugin slug `paskamer-woocommerce`, text domain identical, `Stable tag` = plugin header version = `PASKAMER_VERSION` (the build script enforces this).
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
4. **Push on save**: update a product → Action Scheduler (*WooCommerce → Status → Scheduled Actions*, group `paskamer`) shows `paskamer_push_product`; the api `products` row is upserted; the meta box shows the score/missing fields; the product list column shows the status badge. Trash → `paskamer_delete_product` → api status `archived`. Untrash/publish → pushed again.
5. **Retry**: stop the api → save a product → the action re-schedules with 1/2/4/8/16 min backoff and the panel shows *Syncing…*; after 6 attempts the status is *Sync error* with the message.
6. **Clock skew**: set the WP server clock 6 min off → `stale_signature` → retried; back in sync → succeeds.
7. **Storefront**: product page loads `assets/sdk.v1.js` with `data-shop`, `data-api`, `data-locale`, `data-label`; the button triggers `POST /v1/sdk/sessions`; on desktop the QR modal appears with the estimate disclaimer; on a phone the deep link opens the PWA. Paused plan → button still renders, app shows "shop paused". `[paskamer_button]` in a block renders the same button.
8. **Backfill endpoint**: from the api host, `GET https://shop/wp-json/paskamer/v1/products/42` signed with `PK-HMAC` (secret = the shop's `sk_`, key = `pk_` prefix, target = `/wp-json/paskamer/v1/products/42`) → 200 with `meta_data` + `payload`; unsigned → 401; before Connect → 403. On sites without pretty permalinks the target is `/?rest_route=/paskamer/v1/products/42`.
9. **Media picker**: pick a flat-lay from the media library → preview + attachment id saved; remove → meta deleted.
10. **Uninstall**: with the deletion option off, delete the plugin → settings + `_paskamer_*` meta remain, queue cleared; with it on → everything removed.
11. **Translations**: set the site to Dutch → button label "Pas in Paskamer" and the admin strings from `languages/paskamer-woocommerce-nl_NL.po` (compile to `.mo` with `wp i18n make-mo languages/` before shipping — `.mo` files are not generated offline here).
