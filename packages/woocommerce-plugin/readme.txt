=== Paskamer for WooCommerce ===
Contributors: paskamer
Tags: woocommerce, virtual try-on, size guide, fit, fashion
Requires at least: 6.6
Tested up to: 6.7
Requires PHP: 8.2
WC requires at least: 9.0
WC tested up to: 9.9
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds a "Try in Paskamer" button to your product pages and syncs garment fit data (size chart, fabric, flat-lay photo) to Paskamer, the private fitting room.

== Description ==

Paskamer (Dutch for "fitting room") lets your shoppers see how a garment fits *their* body before they buy. They measure themselves once, on their own phone, with the camera — the photos never leave their device. Your shop only provides the garment side: a size chart, the fabric, a flat-lay photo and a few fit hints.

This plugin:

* Adds a **Paskamer — fit data** box to the product edit screen with every field the fitting room needs: category, pattern block, fabric (fibre, blend, weight, stretch, drape, opacity, sheen), designed ease, lengths, a size-chart table (bust / waist / hip / shoulder / thigh / inseam / foot), whether the chart lists garment or body measurements, sizing notes, true-to-size score, critical fit points, stretch zones, style tags, colours and a flat-lay photo from your media library.
* Validates the data as you save and shows a completeness score with the fields still missing.
* Pushes published products to Paskamer when they are saved (retried in the background through Action Scheduler) and archives them when they are trashed or unpublished.
* Shows a **Try in Paskamer** button on single product pages (position, label and language are configurable; there is also a `[paskamer_button]` shortcode). The button script is bundled with the plugin; no code is loaded from third-party servers.
* Is compatible with WooCommerce High-Performance Order Storage (the plugin never touches orders).

Every fit result and every rendering shown to a shopper is labelled as an **estimate**.

== External services ==

This plugin connects to the **Paskamer API** (`https://api.paskamer.app`, operated by Paskamer) to provide its functionality. **Nothing is sent until you click "Connect to Paskamer" on the settings page.** After that:

* **When you connect:** your site URL, shop name and — if you leave the option ticked — the site admin e-mail are sent to create your merchant account. Billing, when enabled, goes through Stripe Checkout in your browser; the plugin never sees card details.
* **When a published product is saved, trashed or unpublished, and during "Sync all":** the product id, name, price (EUR only), product photo URLs, categories, attributes and the fit data you entered in the Paskamer box are sent (`PUT`/`DELETE /v1/merchant/products/{id}`). The dry-run validation on save sends the same payload to `POST /v1/merchant/products/validate` and stores nothing on the server.
* **When you save settings or check the status:** the shop name, site URL, plugin and WooCommerce versions and your sponsored-placement preference are sent (`PUT /v1/merchant/shops/self`).
* **On shoppers' product pages:** the bundled button script contacts the Paskamer API only when a shopper clicks the button (it creates a short-lived try-on link). It sets no cookies and uses no local storage.
* **Backfill endpoint:** the plugin exposes `/wp-json/paskamer/v1/products/{id}`, readable only with a request signed by your own secret key, so Paskamer can re-read a product you ask it to.

No customer data, order data or personal data of your shoppers is ever sent by this plugin. Requests are authenticated with an HMAC signature using a secret key that is stored encrypted in your database.

Paskamer terms of service: https://paskamer.app/terms
Paskamer privacy policy: https://paskamer.app/privacy

== Source code ==

`assets/sdk.v1.js` is the minified build of the Paskamer storefront SDK (vanilla TypeScript, no dependencies). Its human-readable source and build script (`tsup`, see `packages/sdk` — `src/` and `tsup.config.ts`) are published at https://github.com/paskamer/paskamer/tree/main/packages/sdk. Every other script in this plugin (`assets/admin/meta-box.js`) ships unminified.

== Installation ==

1. Upload the plugin zip under *Plugins → Add New → Upload Plugin* and activate it (WooCommerce 9.0 or newer and PHP 8.2 or newer are required).
2. Go to *WooCommerce → Paskamer* and click **Connect to Paskamer**. Complete checkout if asked; you are sent back to the settings page and your published products start syncing in the background.
3. Open a product, fill in the **Paskamer — fit data** box (at least category, size chart + chart type, fabric and a flat-lay photo) and update it. The box shows the completeness score and what is still missing.
4. Products that are complete ("active") show the **Try in Paskamer** button on their product page.

== Frequently Asked Questions ==

= Does the plugin send anything before I connect? =

No. Until you click Connect, the plugin makes no outbound requests at all. Garment data you enter is stored in your own database as product meta.

= Where does the button appear? =

At the `woocommerce_single_product_summary` hook, priority 35 (after the add-to-cart form) by default; change the priority on the settings page or place `[paskamer_button]` in your template or a block. By default only products that are complete in Paskamer show the button; you can switch to all published products.

= What happens when my plan is paused? =

The button keeps rendering (your page never breaks); the Paskamer app shows shoppers a "shop paused" screen until the plan is active again.

= Does it work with the new product editor (block-based)? =

The fit-data box is a classic meta box and works with the classic product editor. Support for the block-based product editor is planned.

= What is removed on uninstall? =

The job queue and temporary notices are always removed. Settings (including the encrypted API key) and the fit data on your products are only deleted when you enable *Delete all Paskamer settings and product fit data when the plugin is uninstalled* on the settings page.

== Screenshots ==

1. The Paskamer fit-data box on the product edit screen.
2. The settings page with the Connect flow and storefront button options.
3. The "Try in Paskamer" button on a product page and the QR hand-off on desktop.

== Changelog ==

= 0.1.0 =
* Initial release: fit-data meta box, push-on-save sync with HMAC authentication, bundled try-on button, Connect round-trip, signed backfill endpoint, HPOS compatibility, uninstall cleanup.

== Upgrade Notice ==

= 0.1.0 =
First release.
