# Platform checks: WooCommerce on a real WordPress, Shopify against shopify.dev (19 Nov 2026)

Branch `claude/platform-checks`, started from `claude/garment-engine`. I did not touch `packages/fit-engine`,
`packages/schema/src/garment.ts` or the About-you form.

## Summary

| | Result |
|---|---|
| WooCommerce, PHP **8.5.12** (the newest PHP; `wordpress:php8.5-apache`) | **64/64 checks pass**, WordPress 7.1.4, WooCommerce 11.2.2, MariaDB 11.8 |
| WooCommerce, PHP **8.1.34** (`wordpress:php8.1-apache`, core 6.9 updated to 7.1.4 by the script) | **64/64 checks pass** |
| Plugin Check 2.2.0 | 0 errors after the fix (before it: **4 ERRORs** in the new garment-tape code), 2 warnings (below) |
| Shopify: every Admin GraphQL document against the **real 2026-10 schema** (public introspection, 3716 types) | all validate, the variables really sent coerce; only `Product.featuredImage`/`images` are deprecated |
| Shopify: the fake's schema excerpt against the real schema | 4 differences found and corrected; a new opt-in test keeps it a faithful subset |
| `npm_config_workspace_concurrency=1 pnpm check` | passes |

### Bugs found and fixed (each with a test)

1. **Plugin Check ERROR in the garment-tape code** (`class-garment-tape.php:471`). `Garment_Tape::fill` threw a
   `RangeException` with an unescaped message, and Plugin Check 2.2.0 reports `WordPress.Security.EscapeOutput.ExceptionNotEscaped`
   four times as ERROR. WordPress.org review would refuse the zip. Fixed with `esc_html()`.
   Test: `tests/platform-checks.test.php` scans every `throw new` in the plugin.
2. **The merchant could not tell which field broke a sync.** The api refuses a product whose fabric has no drape with 400
   `validation`. The meta box showed only "request validation failed (validation)". `Api_Client` now appends the
   api's `details`: "request validation failed — fabric.drape: Invalid input: expected number, received undefined".
   There is a PHP unit test and an e2e check (screenshot `php85-08-sync-error-names-field.png`).
3. **On a phone, the size chart was cut off by the meta box.** The chart has a column per measurement, about 1025 px
   wide, and the right-hand columns could not be reached. It also clipped on desktop at 1400 px: "Foot cm" was cut.
   The table is now in a wrapper that scrolls sideways. An e2e check scrolls it on a 390 px screen and confirms the
   last column is inside the box (`php85-16/17-phone-admin-size-chart*.png`).
4. **Shopify: installing could leave the metafield definitions half done.** `ensureMetafieldDefinitions` threw on the
   first `UNSTRUCTURED_ALREADY_EXISTS`. That code means the shop holds `curtain` metafields without a definition. The
   loop stopped there, so the remaining definitions were never created. The api logs and goes on, so this failed
   silently. Those keys are now reported as `unstructured` and the loop continues (vitest in `metafieldDefinitions.test.ts`).
5. **The fake Shopify accepted input the real API refuses.** Its excerpt had `AppRecurringPricingInput.planHandle`,
   which exists only on the output type, and it typed `BulkOperation` counts as `String` instead of `UnsignedInt64`.
   I also added the missing user-error fields and codes (below). The new test in `contract.test.ts` fails on the old
   excerpt and passes on the corrected one.

## 1. WooCommerce on a real WordPress

**How it ran.** Docker works in this container: `dockerd` was started by hand. Docker Hub answered `429 Too Many
Requests`; parallel sessions share the IP. The WordPress images were pulled from Google's Docker Hub mirror
(`mirror.gcr.io/library/wordpress:*`) and tagged with their Docker Hub names. The digests are the same as Docker Hub's
and `report.json` records them: php8.5-apache `sha256:346b6d0e…`, php8.1-apache `sha256:f7339662…`, cli-php8.3
`sha256:e4980e3e…`, mariadb:11 `sha256:d36f18d6…`. The api ran from this repo (demo entry, PGlite, no keys) and so did
the web dev server. Nothing was mocked on the WordPress side.

**What the existing e2e already covered, and what passed on both PHP versions:**
- upload and activate through the admin
- settings and API base
- Connect with the domain proof (refused for localhost, and the nonce is checked), then finish the connection
- the encrypted key
- the meta box filled from a template
- the media modal
- the HMAC push (signed read-back; a forged signature gets 401)
- the AUD to EUR price conversion
- the shopper flow on Storefront, Twenty Twenty-Four, Twenty Twenty-Five and TT5 with a template part: button under
  the form → overlay → About you → advice → "Choose size 12" → variation and price selected
- deactivate, reactivate, uninstall with data deletion, uninstall without WooCommerce
- Plugin Check
- a clean `debug.log`

**Added in `e2e/run.mjs` (garment measurements, on a published "Pull-on Midi Skirt", category bottom):**

| Step | Checked (all pass on 8.5 and 8.1) |
|---|---|
| Before the chart is saved | the table says "Add a size chart to this product first" |
| Fabric without drape | the api refuses it (sync status `error`); the status panel names `fabric.drape` |
| Chart saved (AU body template 8–20) | one row per size; unticked rows read-only |
| **Save**: 8, 12 and 16 ticked and typed, closure pull-on, hip depth 20 | `_curtain_garment_tape` has 7 rows: 8/12/16 `measured`, 10/14 `interpolated`, 18/20 `extrapolated`, depth 20; closure stored; rows labelled "estimated" / "rough estimate" |
| **Sync** | push accepted (`active`); `Sync::build` carries closure + the 7-row tape. The same payload sent again by the script with PK-HMAC returns `changed: false` and the content hash the plugin stored, so the api holds exactly the tape the plugin sent. A tape row for a size not in the chart gets **422 `invalid_garment_tape`** |
| **Error**: "6O" in size 8 A, size 12 B (70) below A (75) | both English messages; both inputs `aria-invalid`; what was typed comes back; stored tape unchanged. After the fix, the messages go and the same tape is stored |
| **Renamed size**: chart 8 → 6 while size 8's A is edited in the same update | chart saves as 6, 10…; the typed row comes back as an editable orphan row "8" with "Size 8 is not in this product's size chart". Typing "6" there and updating stores the numbers under size 6 (A = 66, measured); the push is accepted |
| **Emptying the chart** (every row removed) | chart, tape and draft meta removed; no error; the table asks for a chart; the push carries neither tape nor chart and the api accepts it (`incomplete`). The closure stays stored; it does not depend on sizes (by design, `Sanitizer::garment_tape`) |
| Phone (390 × 844 @2x, touch) | admin settings, size chart (scrolls), tape table (stacked cards, no overflow: table 324 px in a 350 px box); shop archive, product page, overlay to the size advice on Storefront and TT5; the button is a tap target (101 × 43 and 120 × 49) and the page does not scroll sideways |

Measured: everything in the tables above is read back from the database (WP-CLI), the api (signed HTTP) or the DOM.
Assumed: none of the Woo results are assumed. One limit: the api's stored copy is shown by content hash, not read back
field by field; the merchant api has no "get product payload" route.

**Not bugs (looked like it, were not):** the first error-flow run "lost" what was typed. The cause was Playwright
filling `sixty-seven` into an input with `maxlength="8"`; the browser cuts it just as it would for a merchant. The
test now types the realistic typo "6O".

**Plugin Check warnings, left as they are:**
- `trademarked_term`: the slug `curtain-woocommerce` holds "woocommerce". WordPress.org would ask for e.g.
  `curtain-for-woocommerce`. That is a release and listing decision; renaming the slug changes the plugin directory
  on every install.
- `load_plugin_textdomain` is discouraged. The call is harmless.

## 2. Shopify: admin GraphQL, billing, webhooks, extension vs shopify.dev

There is no dev store here, so this checks our side of each contract against the documentation and the real schema.
It does not prove live behaviour.

**Strongest check: the real schema.** `pnpm --filter @curtain/api shopify:schema 2026-10 /tmp/admin-2026-10.json`
fetched Shopify's public introspection from `https://shopify.dev/admin-graphql-direct-proxy/2026-10` (no credentials).
`CURTAIN_SHOPIFY_INTROSPECTION=… vitest run src/shopify/contract.test.ts` then:
- validates every document the api and `@curtain/shopify-app` send in the contract suite
- coerces the variables they really sent (more than 20 calls)
- lists the deprecated fields in use (exactly `Product.featuredImage` and `Product.images`)
- (new) diffs the fake's excerpt against the real schema

26/26 pass.

**Doc checks, one per row.** Pages are at the version-pinned `https://shopify.dev/docs/api/admin-graphql/2026-10/…`
(AG below), read on 2026-11-19.

| What | Doc | Verdict |
|---|---|---|
| `metafieldsSet(metafields: [MetafieldsSetInput!]!)` → `metafields{id key namespace ownerType}`, `userErrors{field message code}`; batches of 25 (`graphql/metafields.ts`) | AG mutations/metafieldsSet, input-objects/MetafieldsSetInput, objects/MetafieldsSetUserError | matches. "Maximum of 25", atomic ("no changes are persisted if an error is encountered"), input `ownerId! key! value! namespace type compareDigest`, user error has `code` + `elementIndex` |
| `metafieldsDelete(metafields: [MetafieldIdentifierInput!]!)` → `deletedMetafields{key namespace ownerId}`, `userErrors{field message}`; null entries filtered (used to clear `closure` / `garment_tape`) | AG mutations/metafieldsDelete, input-objects/MetafieldIdentifierInput | matches. Input `ownerId! namespace! key!`; a missing metafield "still succeeds but returns null"; `UserError` has no `code` |
| Garment measurement metafield types: `closure` = `single_line_text_field`, `garment_tape` = `json` (`schema/src/mappings/shopify.ts`) | /docs/apps/build/metafields/list-of-data-types | matches |
| `metafieldDefinitionCreate` input and payload; `TAKEN` handling | AG mutations/metafieldDefinitionCreate, enums/MetafieldDefinitionCreateUserErrorCode | **differed**: `UNSTRUCTURED_ALREADY_EXISTS` was not handled (fixed, bug 4) |
| `choices` validation on `critical_fit_points` (`list.single_line_text_field`) | /docs/apps/build/metafields/list-of-validation-options | **doc says choices is for `single_line_text_field`**; list types get `list.min`/`list.max`. Not changed: the schema cannot show validation rules, so this needs the dev store (step D2). If refused there (`INVALID_OPTION`), drop that one validation |
| `metafieldDefinitions(ownerType:, namespace:, first:, after:)` | AG queries/metafieldDefinitions | matches |
| Product reads: `tags`, `collections(first:10){nodes{title handle}}`, `category{name fullName}`, `priceRangeV2`, `variants…selectedOptions`, `metafields(namespace:, first:)` | AG objects/Product, Collection, TaxonomyCategory | matches; `read_products` |
| `featuredImage`, `images(first:)` (`products.ts`, `bulk.ts`) | AG objects/Product | **deprecated** (still served in 2026-10; replacements `featuredMedia` / `media`). Not changed here: the move touches `ShopifyProductNodeSchema`, `fromShopifyProduct` and the bulk parser. Open issue |
| `products(first:, after:, query:, sortKey: ID)`; `productsCount(query:, limit:){count precision}`; `nodes(ids:)`; filters `collection_id`, `tag`, `product_type`, `status` | AG queries/products, productsCount, nodes, enums/ProductSortKeys | matches |
| `appSubscriptionCreate(name!, returnUrl: URL!, test, trialDays, lineItems!)`, recurring plan `price` + `interval: EVERY_30_DAYS` | AG mutations/appSubscriptionCreate, input-objects/AppRecurringPricingInput, AppPlanInput | matches (`replacementBehavior` is optional and defaults to STANDARD) |
| `appUsageRecordCreate`, `appSubscriptionCancel(prorate)`, `currentAppInstallation.activeSubscriptions`, `shop.plan.partnerDevelopment` | AG mutations/appUsageRecordCreate, appSubscriptionCancel, objects/AppInstallation, AppSubscription, ShopPlan | matches (`ACCEPTED` status deprecated; the api records it only) |
| `shop.primaryDomain.host`, `shopBillingPreferences.currency`, `shop.currencyCode` | AG objects/Shop, queries/shopBillingPreferences | matches |
| `bulkOperationRunQuery` (limits: 5 connections, depth 2, no `node` root) | AG mutations/bulkOperationRunQuery, /docs/api/usage/bulk-operations/queries | matches. The guide prefers `bulkOperation(id:)` for polling from 2026-01; `node(id:)` still works |
| Webhooks: `products/create|update|delete`, `app/uninstalled`, `app_subscriptions/update`, compliance `customers/data_request`, `customers/redact`, `shop/redact`; HMAC of the raw body with the client secret; dedupe on `X-Shopify-Webhook-Id` | /docs/api/webhooks/2026-10, /docs/apps/build/webhooks/subscribe/https, /docs/apps/build/compliance/privacy-law-compliance | matches (payload samples match the fields `routes.ts` reads) |
| `shopify.app.toml` keys (`use_legacy_install_flow`, `[access.admin]`, `[webhooks] api_version`, `compliance_topics`, `[build]`) | /docs/apps/build/cli-for-apps/app-configuration | matches |
| Token exchange `POST /admin/oauth/access_token`, grant/subject/requested token type URNs, `expiring` | /docs/apps/build/authentication-authorization/get-access-tokens/exchange-tokens | parameters match. The code posts JSON; the doc's sample is form-encoded and names no encoding. Not changed (refresh and migrate already send form-encoded); confirm on the dev store |
| Theme app extension: `type = "theme"`, block `target: "content"`, `stylesheet`, `enabled_on.templates`, settings types, locale files and size limits | /docs/apps/build/online-store/theme-app-extensions/configuration, /docs/storefronts/themes/architecture/settings/input-settings | matches; `"product"` as an `enabled_on` value and the `t:` key syntax are not stated on those pages |

**Fake excerpt corrected** (`apps/api/src/test/fakeShopify/admin-2026-10.excerpt.graphql`), each confirmed against
the real introspection:
- `AppRecurringPricingInput`: removed `planHandle`, added `discount`
- `BulkOperation.objectCount`/`rootObjectCount`/`fileSize`: changed to `UnsignedInt64`
- `MetafieldDefinitionCreateUserError`: added `elementIndex`/`elementKey`, plus the 12 missing codes
- `MetafieldsSetUserErrorCode`: added `CAPABILITY_VIOLATION`, `INTERNAL_ERROR`
- `AppSubscriptionStatus.ACCEPTED`: marked deprecated

**Could not verify** (needs the dev store, `docs/LAUNCH-SHOPIFY.md` step D2):
- whether `$app:curtain` resolves in `metafieldsDelete`
- `choices` on a list metafield
- the Liquid path `app.metafields.curtain.*`
- the theme editor deep link
- Theme Check: running the downloaded `@shopify/theme-check-node` in this container was refused by the session's
  permission policy, so it did not run
- the maximum `first` for products and the maximum number of ids for `nodes`

## Screenshots (`docs/screens/claude-platform-checks/`, 26 PNG, 4.5 MB)

Desktop admin is 1400 × 1000 at @1 and the desktop shop is 1280 × 900 at @1; the crops of the tape table are sharp
at that scale. Phone shots are 390 × 844 at @2. All are from the PHP 8.5 run except `php81-12-tape-3-error.png`.
- `php85-05-settings-connected`: Connected, pk_test prefix, plan free. Plain WordPress admin.
- `php85-07-meta-box-active`: the dress's status panel, Active.
- `php85-08-sync-error-names-field`: red "Sync error" badge; the line now reads "…— fabric.drape: Invalid input…";
  below it the missing fields and local issues. The long api wording ("expected number, received undefined") is
  technical but names the field.
- `php85-11-tape-2-saved-table`: the 7-row table. Solid inputs for 8/12/16, dashed grey for the estimates, labels
  "estimated" and, in brown, "rough estimate"; the warning for size 20. Clean.
- `php85-13-tape-3-error-table` / `php81-12-tape-3-error`: two red inputs, a blue note "The estimates below are from
  your last valid numbers", a red box with the two English messages. Clear.
- `php85-14-tape-4-renamed-orphan`: the orphan row "8" with a red editable label and a hint. Cosmetic: while the orphan
  row is there, the Size column widens and pushes the table right.
- `php85-15..19-phone-admin-*`: settings readable at phone width. The size chart scrolls (17 shows the far end: Foot
  EU / Foot cm and the × buttons). The tape table becomes stacked cards (size + "Measured" tick, five labelled fields).
  The update nag "WordPress 7.1.5 is available" shows because the run pins 7.1.4.
- `php85-20-tape-5-chart-emptied`: an empty chart and the blue note asking for a chart; the closure select keeps
  "Pull-on".
- `php85-21/23/24-storefront-*`, `33/35-twentytwentyfive-*`: product page with "Try it on" under the form, the overlay
  ("We recommend 12", confidence 29 % · estimate, "Estimate · not measured" on the figure), and size 12 selected with
  its price. The fixture products have no photos, so the shop shows WooCommerce's placeholder image.
- `php85-25..28-phone-storefront-*`, `37/38/40-phone-twentytwentyfive-*`: shop archive, product page, overlay full
  screen with the coral "Choose size 12" bar at the bottom. No sideways scroll.
- `php85-46-plugins-deleted`: the plugin row gone after uninstall.

## Open issues

- **Shopify `featuredImage` / `images` are deprecated** in 2026-10. They still work and are known in the test
  (`KNOWN_DEPRECATED`). The move to `featuredMedia` / `media` changes `ShopifyProductNodeSchema` and the bulk parser,
  so it needs its own change.
- `choices` on `critical_fit_points` (a list type) may be refused by Shopify; check in D2.
- Token exchange sends JSON while the doc sample is form-encoded; check in D2.
- Woo slug `curtain-woocommerce` breaks the WordPress.org trademark rule (Plugin Check warning); decide before listing.
- Woo: a product with a fabric but no drape is still refused as a whole (400). The merchant now sees why. Whether the
  payload builder should leave out an incomplete fabric instead is a product decision.
- Woo: the rename state in between (chart saved as 6…, tape still names 8) pushes the tape re-read against the chart
  (row 8 dropped, other rows re-estimated), which the api accepts. This is the documented behaviour, but the
  merchant sees "rough estimate" on rows that were interpolated before until they fix the orphan row.
- Docker Hub rate-limits this network; use the `mirror.gcr.io` pulls below.

## Reproduce

```bash
pnpm install --frozen-lockfile && pnpm build:packages
(dockerd > /tmp/dockerd.log 2>&1 &)            # only where no Docker daemon runs
for t in php8.5-apache php8.1-apache cli-php8.3; do docker pull mirror.gcr.io/library/wordpress:$t && docker tag mirror.gcr.io/library/wordpress:$t wordpress:$t; done
docker pull mirror.gcr.io/library/mariadb:11 && docker tag mirror.gcr.io/library/mariadb:11 mariadb:11   # if Docker Hub answers 429
pnpm --filter @curtain/woocommerce-plugin e2e:wp -- --php=8.5   # ~8 min; test-results/woo-wp-e2e/php85/
pnpm --filter @curtain/woocommerce-plugin e2e:wp -- --php=8.1 --skip-build
pnpm --filter @curtain/woocommerce-plugin test                  # PHP unit tests (102)

pnpm --filter @curtain/api shopify:schema 2026-10 /tmp/admin-2026-10.json
CURTAIN_SHOPIFY_INTROSPECTION=/tmp/admin-2026-10.json pnpm --filter @curtain/api exec vitest run src/shopify/contract.test.ts
pnpm --filter @curtain/shopify-app test
npm_config_workspace_concurrency=1 pnpm check
```
