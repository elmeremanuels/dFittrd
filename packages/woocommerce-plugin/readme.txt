=== Curtain for WooCommerce ===
Contributors: curtain
Tags: woocommerce, virtual try-on, size guide, fit, fashion
Requires at least: 6.6
Tested up to: 6.7
Requires PHP: 8.2
WC requires at least: 9.0
WC tested up to: 9.9
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds a "Try it on" button to your product pages and syncs garment fit data (size chart, fabric, flat-lay photo) to Curtain, the private fitting room.

== Description ==

Curtain is a private fitting room for your shop. Shoppers find their size **right on your product page**: they click **Try it on**, enter their height, weight and fit preference (or their own measurements, or a 30-second camera scan), and see the recommended size, how it fits at each point and an estimate of how it looks. When they choose the size, Curtain selects it in your size dropdown and they add to cart with your own button.

**No app needed.** This standalone experience is the default and works on desktop and mobile. Measurements and photos never leave the shopper's browser. The optional Curtain app (for shoppers who want to keep their fit profile across shops) is a setting you can switch to, never a requirement.

Your shop only provides the garment side: a size chart, the fabric, a flat-lay photo and a few fit hints.

This plugin:

* Adds a **Curtain — fit data** box to the product edit screen with every field the fitting room needs: category, pattern block, fabric (fibre, blend, weight, stretch, drape, opacity, sheen), designed ease, lengths, a size-chart table (bust / waist / hip / shoulder / thigh / inseam / foot), whether the chart lists garment or body measurements, sizing notes, true-to-size score, critical fit points, stretch zones, style tags, colours and a flat-lay photo from your media library.
* Validates the data as you save and shows a completeness score with the fields still missing.
* Pushes published products to Curtain when they are saved (retried in the background through Action Scheduler) and archives them when they are trashed or unpublished.
* Shows a **Try it on** button on single product pages (position, label and language are configurable; there is also a `[curtain_button]` shortcode). The button script is bundled with the plugin; no code is loaded from third-party servers.
* Lets you choose the **Experience**: *On the product page (no app needed)*, the default, or *Curtain app*. The **Size attribute** setting (a dropdown of your product attributes, default `pa_size`) tells Curtain which variation dropdown holds the size.
* Is compatible with WooCommerce High-Performance Order Storage (the plugin never touches orders).

Every fit result and every rendering shown to a shopper is labelled as an **estimate**.

== External services ==

This plugin connects to the **Curtain API** (`https://api.curtain.fit`, operated by Curtain) to provide its functionality. **Nothing is sent until you click "Connect to Curtain" on the settings page.** After that:

* **When you connect:** your site URL, shop name and — if you leave the option ticked — the site admin e-mail are sent to create your merchant account. Billing, when enabled, goes through Stripe Checkout in your browser; the plugin never sees card details.
* **When a published product is saved, trashed or unpublished, and during "Sync all":** the product id, name, price (EUR only), product photo URLs, categories, attributes and the fit data you entered in the Curtain box are sent (`PUT`/`DELETE /v1/merchant/products/{id}`). The dry-run validation on save sends the same payload to `POST /v1/merchant/products/validate` and stores nothing on the server.
* **When you save settings or check the status:** the shop name, site URL, plugin and WooCommerce versions and your sponsored-placement preference are sent (`PUT /v1/merchant/shops/self`).
* **On shoppers' product pages:** the bundled button script contacts the Curtain API only when a shopper clicks the button (it creates a short-lived try-on link) and then opens the Curtain fitting room (`https://app.curtain.fit/embed/…`) in an overlay frame on your page. The script itself sets no cookies and uses no local storage. Inside the frame, the shopper's measurements stay in their browser; only the chosen size label and a confidence score are sent to Curtain, for your analytics and billing. With "Remember me" on, the frame keeps the shopper's fit profile in its own browser storage, which the browser keeps separate per shop.
* **Backfill endpoint:** the plugin exposes `/wp-json/curtain/v1/products/{id}`, readable only with a request signed by your own secret key, so Curtain can re-read a product you ask it to.

No customer data, order data or personal data of your shoppers is ever sent by this plugin. Requests are authenticated with an HMAC signature using a secret key that is stored encrypted in your database.

Curtain terms of service: https://curtain.fit/terms
Curtain privacy policy: https://curtain.fit/privacy

== Source code ==

`assets/sdk.v1.js` is the minified build of the Curtain storefront SDK (vanilla TypeScript, no dependencies). Its human-readable source and build script (`tsup`, see `packages/sdk` — `src/` and `tsup.config.ts`) are published at https://github.com/curtain/curtain/tree/main/packages/sdk. Every other script in this plugin (`assets/admin/meta-box.js`) ships unminified.

== Installation ==

1. Upload the plugin zip under *Plugins → Add New → Upload Plugin* and activate it (WooCommerce 9.0 or newer and PHP 8.2 or newer are required).
2. Go to *WooCommerce → Curtain* and click **Connect to Curtain**. Complete checkout if asked; you are sent back to the settings page and your published products start syncing in the background.
3. Open a product, fill in the **Curtain — fit data** box (at least category, size chart + chart type, fabric and a flat-lay photo) and update it. The box shows the completeness score and what is still missing.
4. Products that are complete ("active") show the **Try it on** button on their product page.

== Frequently Asked Questions ==

= Does the plugin send anything before I connect? =

No. Until you click Connect, the plugin makes no outbound requests at all. Garment data you enter is stored in your own database as product meta.

= Where does the button appear? =

At the `woocommerce_single_product_summary` hook, priority 35 (after the add-to-cart form) by default; change the priority on the settings page or place `[curtain_button]` in your template or a block. By default only products that are complete in Curtain show the button; you can switch to all published products.

= Do my shoppers need to install an app? =

No. By default the whole fit experience runs on your product page in an overlay. The Curtain app is optional: switch *Experience* to *Curtain app* if you prefer the old flow (phones open the app, desktops show a QR code).

= Which size does Curtain select? =

The size option of the product's variation form, named by the *Size attribute* setting (default `pa_size`; `Maat`, `Taille` and `Größe` are also recognised). If no matching dropdown exists, the shopper sees a small "Your size: M" note instead. Themes can hook into the `curtain:size-selected` event or `window.CurtainHooks.onSizeSelected`.

= What happens when my plan is paused? =

The button keeps rendering (your page never breaks); shoppers see a "shop paused" screen until the plan is active again.

= Does it work with the new product editor (block-based)? =

The fit-data box is a classic meta box and works with the classic product editor. Support for the block-based product editor is planned.

= What is removed on uninstall? =

The job queue and temporary notices are always removed. Settings (including the encrypted API key) and the fit data on your products are only deleted when you enable *Delete all Curtain settings and product fit data when the plugin is uninstalled* on the settings page.

== Screenshots ==

1. The Curtain fit-data box on the product edit screen.
2. The settings page with the Connect flow and storefront button options.
3. The "Try it on" button on a product page and the fitting room overlay with the recommended size.

== Changelog ==

= 0.2.0 (unreleased) =
* Standalone by default: the fit experience opens on the product page, no app needed. New settings *Experience* and *Size attribute*; the recommended size is selected in the variation dropdown.

= 0.1.0 =
* Initial release: fit-data meta box, push-on-save sync with HMAC authentication, bundled try-on button, Connect round-trip, signed backfill endpoint, HPOS compatibility, uninstall cleanup.

== Upgrade Notice ==

= 0.1.0 =
First release.
