# WooCommerce plugin: go-live check on a real WordPress (9 Nov 2026)

Branch `claude/golive-woo`. Until this run the WooCommerce plugin (`packages/woocommerce-plugin`) had only
been tested with PHP shims and against the demo storefront, never inside WordPress. This run puts the built
zip on the **official WordPress and MariaDB Docker images**, with the **real WooCommerce 11.2.2**, and walks
the merchant and the shopper through it against the local api and web of this repo. Six defects came out
of it; all are fixed on this branch (below). The run is a repeatable script:

```bash
flock /tmp/curtain-pnpm.lock pnpm install
pnpm build:packages                                       # once: the sdk, schema and shopify-app dist
pnpm --filter @curtain/woocommerce-plugin e2e:wp          # PHP 8.3 (about 3 minutes)
pnpm --filter @curtain/woocommerce-plugin e2e:wp -- --php=8.1   # or 8.2
pnpm --filter @curtain/woocommerce-plugin e2e:wp:matrix   # 8.3, 8.2 and 8.1 one after another
```

Needs Docker and Chromium (Playwright). Flags: `--keep` leaves the containers running (WordPress on
`http://localhost:809<minor>`, Apache bound to 127.0.0.1 only, user `admin`, password in `e2e/run.mjs`), `--skip-build`,
`--headed`. `report.json` also records the content digest of each Docker image that ran (the tags move).
Screenshots, `report.json`, `plugin-check.json` and the PHP `debug.log` go to
`test-results/woo-wp-e2e/php<XY>/` (git-ignored). The script exits non-zero on the first failed check.

## What runs

| Part | What it is |
|---|---|
| WordPress | official `wordpress:php8.1-apache`, `php8.2-apache`, `php8.3-apache` images, **WordPress 7.1.4** (the 8.1 image ships 6.9; the script updates it from the pinned `wordpress-7.1.4.zip`, because WooCommerce 11.2 needs 7.0) |
| Database | official `mariadb:11` (11.8.9) |
| WooCommerce | 11.2.2 from downloads.wordpress.org (pinned; every zip's SHA-256 is checked against `DOWNLOADS` in `e2e/stack.mjs` and a mismatch fails the run. The hashes were recorded from the first download; the WordPress zip also matches wordpress.org's published `.sha1`) |
| Themes | Storefront 4.6.2 (classic), Twenty Twenty-Four 1.6 and Twenty Twenty-Five 1.5 (block themes; 1.4 on the 8.1 image) |
| WP-CLI | official `wordpress:cli-php8.3`, only for setup and read-back (install, fixtures, meta and option reads, Plugin Check) |
| Shop | AUD store, global attribute `pa_size` with AU sizes 8–16, one published variable dress (`e2e/fixtures.php`), a flat-lay PNG drawn by the script |
| Curtain | the plugin zip from `pnpm --filter @curtain/woocommerce-plugin build`, uploaded through the admin; the api demo entry (PGlite, mock try-on, no keys) on `:8797` with its own data folder; the web dev server on `:3010` |
| Browser | Playwright Chromium; WordPress, the api and the web app all on `localhost` (host networking), since the plugin accepts `http://` API bases only for localhost |

Docker Hub was reachable through this machine's proxy, so the fallback (PHP built-in server + SQLite
integration plugin) was not needed.

## Verified, on PHP 8.1.34, 8.2.35 and 8.3.36 (every check passed on all three)

Evidence: `test-results/woo-wp-e2e/php81|php82|php83/report.json` (39, 39 and 39 checks on the final run; 33 before the review follow-up below added the
template-part variant, the wider nonce check and the uninstall-without-WooCommerce check).

**Merchant**

1. Plugins → Add New → Upload Plugin → the zip installs; **Activate** works; the "installed but not connected" notice shows.
2. WooCommerce → Curtain: "Not connected — nothing is sent to Curtain"; the API base saves (http only for localhost).
3. **Connect with the domain proof on** (production default): the api refuses a localhost site (`domain_unverified`) and the
   admin shows the plugin's explanation. While the Connect is pending, `/wp-json/curtain/v1/verify` and
   `/?rest_route=/curtain/v1/verify` both publish **exactly the nonce the api derives** from the Connect token
   (HMAC of the token with the api's secret, recomputed by the script); the nonce is not in the HTML of the front page,
   the product page, the shop page or the Curtain settings page in wp-admin (the pages the run fetches).
4. The api restarts with `WOO_DOMAIN_PROOF=0` (a localhost site cannot be proven, see "Not verified"); **Finish connection**
   → Connected, `pk_` prefix, plan `free` (no Stripe: the api runs without Stripe keys, so Connect takes the manual-key path).
   The verify route then answers 404. The secret key is stored encrypted in `wp_options` (no `sk_` in the row).
5. Product → **Curtain — fit data**: category, pattern block, **"Start from a template" → AU women's body chart** fills sizes
   8–20 with cm values and ticks "body measurements"; fabric, drape, colour, fit points, a length; the flat-lay is picked in
   **WordPress's own media modal**. Update.
6. The push job (Action Scheduler, group `curtain`) runs; the meta box shows **Active** (completeness 76 %, missing fields
   listed); post meta `_curtain_sync_status = active`; the AUD price is converted to `priceEur` with the api's rate table.
7. The push really arrived: a **PK-HMAC-signed** `GET /v1/merchant/products` (signed by the script exactly as the plugin
   signs) returns the product as active; a forged signature gets 401.

**Shopper, on Storefront, Twenty Twenty-Four, Twenty Twenty-Five, and Twenty Twenty-Five with the add-to-cart form moved
into a template part** (`e2e/template-part.php` stores the part and a customised `single-product` template the way the
Site Editor does)

8. The product page loads the **bundled** `sdk.v1.js` from the plugin folder with `data-shop`, `data-api`, `data-mode="embed"`,
   `data-size-option="pa_size"`.
9. Exactly **one** "Try it on" button, **directly under the variation form** (DOM order and on-screen position checked).
10. Try it on → overlay → About you (168 cm, 62 kg) → result **"We recommend 12"** → **Choose size 12** → the overlay closes,
    the variation dropdown holds **12**, and WooCommerce shows that variation's price ($151.00) and stock.
11. No console error from the SDK or the overlay.

**Lifecycle and checks**

12. Deactivate from the Plugins screen: **every pending Curtain job is cancelled**, no button and no script on the product page.
13. Reactivate: settings kept, the button is back without reconnecting.
14. Tick "Delete all Curtain settings and product fit data", deactivate, **Delete**: plugin files, `curtain_settings`, all
    `_curtain_*` post meta and the Curtain transients are gone.
15. **Plugin Check** (official plugin-check 2.2.0, all categories, low severity and experimental checks included):
    **0 errors**, 2 warnings (below).
16. PHP `debug.log` (WP_DEBUG on): no fatal, warning, notice or deprecation from the plugin. (WordPress itself logs that it
    cannot reach wordpress.org for update checks from the container: not ours.)

Also, outside the script: the PHP unit tests (75) pass on PHP 8.1, 8.2 and 8.3 (official images), and
PHPCompatibilityWP reports nothing for `testVersion 8.1-`.

## Defects found and fixed

| # | Found on the real install | Fix |
|---|---|---|
| W1 (high) | **Deactivate, Disconnect and uninstall left every queued push behind.** `as_unschedule_all_actions( $hook, array(), 'curtain' )` only cancels jobs whose args are exactly `[]` (Action Scheduler matches args literally) and every Curtain job carries `[id, attempt]`; seen as a pending `curtain_push_product` after deactivation. A later reactivation (or a disconnected shop) would still push. | `Queue::cancel_all()` and `uninstall.php` use Action Scheduler's group-wide and hook-wide forms, and `wp_unschedule_hook()` for the WP-Cron backend (`wp_clear_scheduled_hook( $hook )` has the same args-must-match trap). Uninstall after WooCommerce was already deactivated deletes the Curtain rows from the Action Scheduler tables directly. Regression tests with the real matching rules of both backends (`tests/golive.test.php`). |
| W2 (high) | **Block themes put the button in the wrong place.** On Twenty Twenty-Four/Five WooCommerce's block-template compatibility fires every `woocommerce_single_product_summary` callback *before the excerpt*, whatever the priority, so the button sat above the size dropdown and the price. | On a block single-product template the button is appended after the `woocommerce/add-to-cart-form` (or `add-to-cart-with-options`) block; the form block is found wherever the template pulls it in (nested, in a template part, a synced pattern or a registered pattern), so a merchant who moves it in the Site Editor keeps the button under it; classic themes keep the summary hook and its priority setting; one button per product either way. Setting text updated (EN + NL). |
| W3 (medium) | **Plugin Check errors** that block a WordPress.org review: the direct-access guard form `defined('ABSPATH') \|\| defined('CURTAIN_TESTING') \|\| exit;` is not recognised (17 files), `parse_url()` (3), unescaped exception text (2). Nonce checks lived in a helper, so the sniff flagged the form handlers. | `defined( 'ABSPATH' ) \|\| exit;` everywhere (the test shims define `ABSPATH`), `wp_parse_url()`, `esc_html()` in exceptions, `check_admin_referer()` in each handler. |
| W4 (medium) | **AUD shops pushed no price** and every product showed "price is in AUD, not EUR" in the meta box and an invalid backend validation; the pilot sells in AUD. (The TypeScript mapping already converts; the PHP twin did not.) | The PHP builder converts with the api's EUR rate table (`assets/eur-rates.json`, generated from `DEFAULT_EUR_RATES`) exactly like `priceToEur`, with the same "converted … (approximate)" warning; parity fixtures from `@curtain/schema`. |
| W5 (medium) | **No size chart templates in the Woo meta box** (docs/PLUGIN.md promised "from a template or by hand"; only Shopify had them). | "Start from a template": the AU/UK/EU/FR/US body charts and the garment charts from `@curtain/schema` (`assets/chart-templates.json`, generated at build); a body chart fills the numbers, a garment chart the labels; asks before replacing a filled chart. EN + NL strings. |
| W6 (low) | Checkbox lists in the meta box (critical fit points, stretch zones) rendered each label under its box. | CSS fix. |

Also changed: the plugin now **requires PHP 8.1** (was 8.2), because it is verified there end to end; PHPCS
(WordPress-Extra) is clean of errors after `phpcbf` and a few manual fixes.

## PHPCS

`packages/woocommerce-plugin/phpcs.xml.dist` (WordPress-Extra + PHPCompatibilityWP 8.1+, text domain and the
`manage_woocommerce` capability declared). The composer tools are not part of the workspace; install them
as the file says. Result on this branch: **0 errors, 16 warnings**, all deliberate: `base64_encode/decode`
of the encrypted key (6), `json_encode` for the canonical content hash (5, must stay byte-stable),
`file_get_contents` of the plugin's own JSON files (2), `@iconv`/`@preg_match` with checked results (2),
a parameter named `$class` (1). The security sniffs (escaping, nonces, input sanitising, SQL) report nothing.
With `--standard=WooCommerce-Core` 329 docblock-style errors remain (missing `@param` tags and the like);
they are cosmetic and not required by the WordPress.org review.

## Plugin Check warnings (open, not code defects)

- **`trademarked_term`: the slug `curtain-woocommerce` contains "woocommerce".** WordPress.org only allows a
  trademark at the end as "…-for-woocommerce". Before submitting, the founder chooses the directory slug, e.g.
  `curtain-for-woocommerce` or `curtain-size-finder-for-woocommerce`; the text domain, folder name, `.pot`/`.po`
  file names and the build's zip folder then follow it (a mechanical rename, best done in one commit right
  before submission). The direct-zip install for a pilot is not affected.
- `load_plugin_textdomain()` is "discouraged" for directory plugins (translate.wordpress.org loads translations).
  Kept on purpose: the direct zip ships its own `nl_NL` translation, which needs it. Remove it once the plugin
  is in the directory and its Dutch translation is on translate.wordpress.org.

## Screenshots (per PHP version, in `test-results/woo-wp-e2e/php<XY>/`)

| File | Shows |
|---|---|
| `01-admin-upload-installed.png` | Plugins → Upload: "Plugin installed successfully" |
| `02-admin-activated-nudge.png` | Activated, with the "not connected" notice |
| `03-settings-not-connected.png` | WooCommerce → Curtain before Connect (full page) |
| `04-connect-domain-proof-refused.png` | Connect refused by the domain proof (localhost site) |
| `05-settings-connected.png` | Connected: pk_ prefix, plan, key storage, queue |
| `06-meta-box-filled-from-template.png` | The fit-data box filled from the AU template, flat-lay picked (full page) |
| `07-meta-box-active.png` | After Update: status Active, completeness, the AUD conversion note |
| `08…11-storefront-*.png` | Storefront: product with button, About you, size advice, size 12 selected with price |
| `12…15-twentytwentyfour-*.png` | The same on Twenty Twenty-Four |
| `16…19-twentytwentyfive-*.png` | The same on Twenty Twenty-Five |
| `20…23-twentytwentyfive-template-part-*.png` | The same on Twenty Twenty-Five with the add-to-cart form inside a template part |
| `24-plugins-deactivated.png`, `25-plugins-deleted.png` | Deactivated; deleted |
| `plugin-check.json`, `report.json`, `debug.log` | Raw Plugin Check findings, every check with environment and versions, the PHP log |

## Review follow-up (9 Nov 2026)

An adversarial review re-ran the 8.3 leg, the unit tests on 8.1, PHPCS and the gates, and passed the work with low and
informational findings. Changes made for them:

- **WP-Cron cleanup** (low): `Queue::cancel_all()` and `uninstall.php` used `wp_clear_scheduled_hook( $hook )`, which
  core only applies to events with args `[]`; every Curtain event has args, so on a shop without Action Scheduler the
  jobs survived. Now `wp_unschedule_hook()`. Uninstall after WooCommerce was deactivated also removes the Curtain rows
  from the Action Scheduler tables (e2e: jobs on both backends, WooCommerce deactivated, `wp plugin uninstall` → none
  left). The test shim now has core's matching rule, and the new unit test fails with the old call (77/78).
- **Button placement with a template part** (low): the form block was only found when it sat in the top-level template
  text. Detection now walks the parsed blocks, template parts, synced patterns and registered patterns. New e2e variant
  (TT5 with the form moved into a template part): the old code put the button 290 px *above* the form
  (`test-results/golive-woo-e2e-8.3-old-frontend-regression.log`), the new code passes.
- The "api log shows the PUT" check could not fail; it now requires a `PUT` of the product in the api log.
- The nonce check fetched only the front page; it now covers the front, product, shop and Curtain settings pages.
- README said PHP ≥ 8.2 in one place; now 8.1 everywhere.
- Download hashes are verified, image digests recorded, the e2e Apache listens on 127.0.0.1 only, and two
  `(array) preg_split()` casts were replaced by an `is_array()` check.

Still open from the review: the PHP 8.1 minimum is a product decision for the founder (8.1 has had no security fixes
since 31 Dec 2025; revert `Requires PHP`, `CURTAIN_MIN_PHP`, readme.txt and the PHPCS `testVersion` to keep 8.2);
the size chart templates fill every size of the template (AU 8–20) even when the shop sells fewer, and nothing marks
the rows as template values until the merchant edits them.

## Not verified here (needs a live site, the VPS or the founder)

- **The domain proof succeeding.** The api refuses private and loopback addresses by design, so a local site can only be
  refused; the run proves the site publishes the right nonce on both routes and the api's verification code is unit-tested
  (`apps/api/src/media-proof.test.ts`). First real success: a WordPress site on a public https address against
  `https://api.curtain.fit` (or a staging api).
- **Stripe.** Connect ran on the free, no-billing path. Checkout, the webhook that marks the shop paid, "Finish connection"
  after payment, a cancelled Checkout and the legacy-plan switch are covered only by api unit tests (`stripe.test.ts`).
  Needs `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CURTAIN` on the VPS and a test-mode run.
- **HTTPS and real hosting**: page caches and security plugins (they may cache or block `/wp-json/curtain/v1/verify`),
  WP-Cron on a low-traffic host (the e2e runs the queue with WP-CLI right after saving; on a host it waits for the next
  visit or a real cron), multisite.
- **The size peek** (returning shopper's size next to the button): it needs an `api.` / `app.` domain pair
  (`Settings::app_origin()`), so it is off against `localhost`. Covered by `pnpm demo:e2e` on the demo storefront.
- **WooCommerce's newer "Add to Cart with Options" block** (opt-in in WooCommerce 11.2; the default templates still use the
  classic form): the button is placed after it, but the SDK's size selection targets the classic
  `form.variations_form select`; with that block it would fall back to its "choose size X" message. Check when
  WooCommerce makes the block the default.
- Uninstall with "delete data" **off** (keeps settings and meta; unit-level only), the Dutch admin translation on a Dutch
  site, Disconnect from the settings page, the retry/backoff against a stopped api, clock skew. All are in the plugin
  README's manual list.

## Remaining before the WooCommerce launch

1. Server: the new VPS, DNS for `curtain.fit`, `app.` and `api.`, the deploy workflow (`docs/DEPLOY.md`). The plugin's
   default API base is already `https://api.curtain.fit`.
2. Stripe live keys and webhook secret on the VPS (above), then one test-mode Connect with payment on a public test site.
3. A public WordPress test site (any cheap host with https) for the real domain proof and one pass of the manual list.
4. WordPress.org submission (optional for a pilot, which can install the zip directly):
   - the slug decision and rename above;
   - a wordpress.org account for `Contributors:` in `readme.txt` (now `curtain`, which must be the real username);
   - live privacy and terms pages at the URLs in `readme.txt` ("External services") and the settings page;
   - screenshots `screenshot-1.png …` and banner/icon for the SVN `assets/` folder (not in the zip);
   - a support e-mail and help page; trademark clearance for the name;
   - then upload the zip at wordpress.org/plugins/developers/add, expect a review of several weeks, answer from the
     submitting account, and publish through SVN.
5. Keep `Tested up to` / `WC tested up to` current when WordPress or WooCommerce release (re-run `e2e:wp` against the
   new versions: bump the pins in `e2e/stack.mjs`).
