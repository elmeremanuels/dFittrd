# @curtain/shopify-app

The Shopify side of **Curtain** (decision D6): one app that is installed with managed installation
(token exchange, no OAuth code), declares its webhooks in `shopify.app.toml`, stores garment data in
`$app:curtain` product metafields so the shop stays the source of truth, bills per try-on session
through the Billing API (D7), and ships one theme app extension — the "Try it on" block —
that bundles `sdk.v1.js` so the storefront makes zero third-party requests (D3).

The Node process behind it is `apps/api` (D2: one backend). This package contributes:

```
packages/shopify-app/
├─ shopify.app.toml            app config TEMPLATE ({{VAR}} placeholders → pnpm configure)
├─ extensions/try-button/      theme app extension (block, snippet, CSS, locales; sdk.v1.js copied at build)
├─ admin/index.html            embedded admin page (App Bridge + session-token fetches to the api)
├─ scripts/configure.mjs       renders shopify.app.<env>.toml from env and validates it
├─ scripts/copy-sdk.mjs        copies packages/sdk/dist/sdk.v1.js into the extension assets
└─ src/                        the library apps/api imports (below)
```

## Public API (`import { … } from '@curtain/shopify-app'`)

Everything is pure and dependency-injected: **no module reads `process.env`** (secrets are read only
in `apps/api/src/env.ts`) and nothing touches a database.

| Module | Exports |
| --- | --- |
| `types` | `FetchLike`, `DEFAULT_API_VERSION` (`2026-10`, the one pinned Admin API version; api env, toml and tests re-use it), `isShopifyDomain`, `normaliseShopDomain`, `SleepFn` |
| `graphql/client` | `createAdminClient({ shopDomain, accessToken, apiVersion?, fetch?, maxRetries?, sleep?, adminUrlTemplate? })` → `{ request<T>(query, variables) }` with cost-aware retry on `THROTTLED`/429/5xx; `ShopifyGraphqlError` (`code`: http, graphql, non_json, empty, user_errors, unauthorized, invalid_domain); `assertNoUserErrors`; `adminGraphqlUrl`; `throttleDelaySeconds` |
| `graphql/products` | `PRODUCT_QUERY`, `PRODUCTS_PAGE_QUERY`, `fetchProduct(client, gidOrId)`, `fetchProductsPage(client, cursor, query?)`, `iterateProducts(client)`, `productGid`, `productExternalId` — selections match `ShopifyProductNodeSchema` in `@curtain/schema` |
| `graphql/metafields` | `METAFIELD_DEFINITION_CREATE`, `METAFIELD_DEFINITIONS_QUERY`, `METAFIELDS_SET`, `metafieldsSet` (auto-batches 25), `setProductMetafields(client, gid, payload)` (write-back via `toShopifyMetafields`), `getCurrentAppInstallationId`, `setAppDataMetafields(client, { publicKeyPrefix, apiUrl, appUrl? })` + `APP_DATA_NAMESPACE`/`APP_DATA_KEYS` (what the theme block reads) |
| `metafieldDefinitions` | re-exports `SHOPIFY_METAFIELD_DEFINITIONS`/`SHOPIFY_METAFIELD_NAMESPACE`; `METAFIELD_KEYS`, `HEAVY_METAFIELD_KEYS`, `metafieldDefinitionInput(def)`, `METAFIELD_DEFINITION_INPUTS`, `ensureMetafieldDefinitions(client)` (TAKEN = existing), `listMetafieldDefinitions`, `missingDefinitionKeys` |
| `graphql/bulk` | `bulkProductsQuery()`, `startBulkProductExport`, `getBulkOperation` (via `node(id:)`), `waitForBulkOperation`, `cancelBulkOperation`, `downloadBulkResult`, `parseBulkJsonl(text)` (folds `__parentId` children back into product nodes, in any line order: 2026-01+ exports are ungrouped by default), `runProductBackfill(client)`, `BulkOperationError` |
| `graphql/shop` | `fetchPrimaryDomainHost(client)`, `fetchBillingCurrency(client)` → `{ billingCurrency, shopCurrency }` (`shopBillingPreferences { currency }`) |
| `currency` | `DEFAULT_EUR_RATES` (EUR-based rate table: 1 EUR = n units, every currency Shopify bills merchants in + USD), `resolveChargeCurrency(code, rates?)` (unknown → USD), `convertEur`, `convertEurListPrice`, `formatMoney`, `parseEurRates(json)` |
| `graphql/billing` | `createAppSubscription(client, plan)` (recurring line + usage line with `cappedAmount`, in `plan.currencyCode`/`eurRate`, default EUR) → `{ …, currencyCode, eurRate }`, `createUsageRecord(client, { lineItemId, description, amountEur, idempotencyKey, currencyCode?, eurRate? })` → `{ id, capReached }`, `planAmounts`, `usageTerms`, `usageIdempotencyKey(shopId, sessionKey)`, `getActiveSubscriptions`, `cancelAppSubscription`, `subscriptionLineItems` |
| `tokenExchange` | `requestTokenExchange({ shopDomain, sessionToken, apiKey, apiSecret, fetch?, tokenType?: 'offline' \| 'online', expiring? })` → `{ accessToken, scope, … }`; `TokenExchangeError` (status 400 = stale ID token: fetch a fresh one and retry); `tokenExchangeBody`, `tokenExchangeUrl` |
| `sessionToken` | `verifySessionToken(token, { apiKey, apiSecret, now?, clockToleranceSec? })` → claims or `null`; `verifySessionTokenOrThrow` (`SessionTokenError.reason`); `decodeSessionToken` (unverified); `signSessionToken` (tests/dev) |
| `webhookHmac` | `verifyWebhookHmac(rawBody, header, secret)` (timing-safe, raw bytes), `computeWebhookHmac`, `parseWebhookHeaders(headers)`, `signWebhook` (tests), `SHOPIFY_WEBHOOK_TOPICS`, `SHOPIFY_COMPLIANCE_TOPICS`, `ALL_WEBHOOK_TOPICS`, `WEBHOOK_PATH` (`/shopify/webhooks`), `isComplianceTopic`, `isKnownTopic` |
| `sync` | `syncProductNode(node, { defaultBrand })` → `{ externalId, handle, draft, payload \| null, completeness, warnings, archived, usable }` (uses `fromShopifyProduct` + `completenessScore` + `GarmentPayloadSchema` from `@curtain/schema`), `syncProductNodes`, `shouldArchive`, `isPublished`, `toMerchantUpsertBody` |
| `appConfig` | `renderAppConfig(template, vars)`, `validateAppConfig(parsedToml, { apiUrl? })`, `APP_CONFIG_VARS`, `REQUIRED_SCOPES`, `OPTIONAL_SCOPES`, `AppConfigError` |
| `deepLinks` | `themeEditorAddBlockUrl({ shopDomain, apiKey, template?, target? })`, `adminProductUrl`, `adminAppUrl`, `customInstallUrl`, `BLOCK_HANDLE` (`try-it-on`), `EXTENSION_HANDLE` (`try-button`) |
| `admin` | `renderAdminPage({ apiKey, apiUrl, appUrl, appHandle?, blockHandle? })` → HTML, `adminContentSecurityPolicy(shopDomain)`, `ADMIN_PAGE_PATH` (`/shopify/admin`), `APP_BRIDGE_SCRIPT_URL`, `adminPageTemplate`, `jsonForScript` |

### How apps/api is expected to wire it

```ts
import {
  createAdminClient, requestTokenExchange, verifySessionToken, ensureMetafieldDefinitions,
  setAppDataMetafields, runProductBackfill, syncProductNode, verifyWebhookHmac, parseWebhookHeaders,
  createAppSubscription, createUsageRecord, usageIdempotencyKey, renderAdminPage, adminContentSecurityPolicy,
} from '@curtain/shopify-app';

// POST /shopify/token-exchange { shop, sessionToken }
const claims = verifySessionToken(sessionToken, { apiKey: env.SHOPIFY_API_KEY, apiSecret: env.SHOPIFY_API_SECRET });
const { accessToken, scope } = await requestTokenExchange({ shopDomain: claims.shopDomain, sessionToken, apiKey, apiSecret, fetch });
const client = createAdminClient({ shopDomain, accessToken, apiVersion: env.SHOPIFY_API_VERSION, fetch });
await ensureMetafieldDefinitions(client);                                   // idempotent
await setAppDataMetafields(client, { publicKeyPrefix: shop.apiKeyPrefix, apiUrl: env.PUBLIC_API_URL, appUrl: env.PUBLIC_APP_URL });
const { products } = await runProductBackfill(client);                      // bulk operation → JSONL → nodes
for (const node of products) { const r = syncProductNode(node, { defaultBrand: shop.name }); if (r.usable && !r.archived) await upsertProduct(db, shop.id, r.externalId, r.draft); }

// POST /shopify/webhooks (raw body!)
if (!verifyWebhookHmac(req.rawBody, req.headers['x-shopify-hmac-sha256'], env.SHOPIFY_API_SECRET)) return reply.code(401);
const { topic, shopDomain, webhookId } = parseWebhookHeaders(req.headers);

// GET /shopify/admin?shop=…  (embedded)
reply.header('content-security-policy', adminContentSecurityPolicy(req.query.shop)).type('text/html').send(renderAdminPage({ apiKey, apiUrl, appUrl }));

// billing: once per billable try-on session (D7)
await createUsageRecord(client, { lineItemId: shop.settings.usageLineItemId, description: 'Curtain try-on session', amountEur: 0.05, idempotencyKey: usageIdempotencyKey(shop.id, intentToken) });
```

`apps/api/src/shopify/client.ts` currently contains its own copy of the GraphQL documents and token
exchange; it can be replaced by these helpers one function at a time (same shapes).

## The theme app extension

`extensions/try-button/blocks/try-it-on.liquid` is an **app block** (`target: content`) limited
to the `product` template. It renders

```liquid
<button type="button" data-curtain-product="{{ product.id }}" …>Try it on</button>
```

and injects `sdk.v1.js` from the extension's `assets/` (served by Shopify's CDN) with
`data-shop`, `data-api`, `data-mode`, `data-size-option`, `data-locale`, `data-label` — the SDK's documented script-tag
contract. Because the asset origin is `cdn.shopify.com`, `data-api` is always set explicitly.
A small inline guard loads the script once even if the block is placed twice.

Where the values come from: on install the api writes **app-data metafields** on the
`AppInstallation` (`setAppDataMetafields`): `curtain.public_key` (= `pk_live_…`), `curtain.api_url`,
`curtain.app_url`. The block reads them as `app.metafields.curtain.public_key` and
`app.metafields.curtain.api_url`. The block settings `shop_key` / `api_url` override them for dev
stores. The secret `sk_…` key never appears anywhere in the extension (tested).

Settings (merchant-facing, translated via `locales/*.schema.json`): button label, position
(left / centered / full width), **Experience** (`data-mode`), **Size option name**
(`data-size-option`, default `Size`), privacy hint toggle, "use my theme's button styling", and the
two advanced overrides.

**Standalone is the default** (decision D11, `docs/STANDALONE.md`). With Experience set to *On the
product page (no app needed)* (`embed`), a click opens a full-screen overlay on the product page with
the Curtain fit experience in an iframe: about you, optional camera scan, the recommended size. The
shopper's measurements stay in their browser. When they choose a size, the SDK selects the matching
variant in the theme's product form (the option named by *Size option name*; `Maat`, `Taille` and
`Größe` also match) and the shopper adds to cart with the theme's own button. The shopper never
needs the Curtain app. *Curtain app* (`app`) is the opt-in alternative: phones open the app, desktops
show a QR code. Storefront strings (`locales/en.default.json`,
`nl.json`): label "Try it on", the hint (which says *estimate* /
*schatting*), theme-editor-only setup notices.

Themes without app-block support can `{% render 'curtain-try-button', product: product, label: 'Try it on', show_hint: true %}`
and add the script tag from `packages/sdk/README.md` with `data-api` set.

## The embedded admin page

`admin/index.html` is one static page, Polaris-like via CSS only, no fonts, no storage, no cookies.
It loads App Bridge from `https://cdn.shopify.com/shopifycloud/app-bridge.js` (the one third-party
script; required for embedded apps) with `<meta name="shopify-api-key">`, then:

1. `shopify.idToken()` → `POST /shopify/token-exchange { shop, sessionToken }` (idempotent: creates
   the shop row, stores the offline token, ensures metafield definitions, queues the backfill).
2. With `Authorization: Bearer <session token>` (the api's merchant auth accepts Shopify session
   tokens): `GET /v1/merchant/products?limit=200`, `GET /v1/merchant/usage?from&to` (last 30 days),
   `GET /v1/merchant/ledger?limit=20`.
3. Renders: onboarding checklist (connected · choose plan → `POST /shopify/billing/subscribe` →
   `open(confirmationUrl, '_top')` · add block → theme editor deep link with `addAppBlockId` ·
   complete garment data), the products completeness table with filters and "Edit" links into the
   product admin, plan/usage with the period meter and a 30-day bar strip, and the privacy ledger
   (hero renders only, with the `ESTIMATE_DISCLAIMER`).

The api must serve it at `GET /shopify/admin` with
`Content-Security-Policy: frame-ancestors https://<shop>.myshopify.com https://admin.shopify.com;`
(`adminContentSecurityPolicy`) and must not set `X-Frame-Options: DENY` on that route.
`application_url` in `shopify.app.toml` points at it.

## Running it

```sh
pnpm --filter @curtain/shopify-app typecheck   # tsc --noEmit
pnpm --filter @curtain/shopify-app test        # vitest (mocked fetch, fixtures = MOCK_GARMENTS aalter-studio-1)
pnpm --filter @curtain/shopify-app build       # tsup → dist/ (esm + cjs + d.ts), then copies sdk.v1.js into the extension
pnpm --filter @curtain/shopify-app lint
```

`build` needs `@curtain/sdk` built first (root `pnpm build` does packages/** in dependency order).

### Dev store install flow (Shopify CLI ≥ 3.80)

```sh
npm i -g @shopify/cli                      # or: pnpm --filter @curtain/shopify-app exec shopify …
cd packages/shopify-app
pnpm build

# 1. create the app in the Partner Dashboard (or `shopify app init` is NOT needed: we have the config)
#    → copy the client id + secret into infra/.env (SHOPIFY_API_KEY / SHOPIFY_API_SECRET)
# 2. render the config for this environment
SHOPIFY_API_KEY=<client id> PUBLIC_API_URL=https://api.curtain.test PUBLIC_APP_URL=https://app.curtain.test \
  SHOPIFY_DEV_STORE=curtain-dev.myshopify.com pnpm configure dev        # → shopify.app.dev.toml (git-ignored)
# 3. link + push config (webhooks, scopes, application_url) and the extension
shopify app config link --config dev       # first time only; writes .shopify/project.json
shopify app dev --config dev               # tunnels, hot-reloads the extension, opens the install link
shopify app deploy --config dev            # creates an app version (extension + config) — needed for webhooks to fire
```

Run the api with the same `SHOPIFY_API_KEY/SECRET` and a public `PUBLIC_API_URL` (the Caddy
box or a tunnel). `shopify app dev` prints the install URL for the dev store; opening the app in
the admin loads `/shopify/admin`, which performs the token exchange on first load.

### Pilot: custom distribution

For the pilot shops the app is **not** listed: in the Partner Dashboard → the app → *Distribution*
→ *Custom distribution* → enter the shop's `*.myshopify.com` domain → generate the install link and
send it to the merchant (`customInstallUrl` shows the shape; the signed link only comes from the
dashboard). Custom-distribution apps cannot use the Billing API's public pricing page but **can**
create app subscriptions with `appSubscriptionCreate` (test charges on dev stores). One custom
app per shop; switch to public distribution before the App Store listing (irreversible).

### App Store listing checklist

- [ ] Privacy policy URL (what syncs: 80-float fit signature, swipes, wardrobe, pairings — never a
      photo; merchant sees aggregates only; k-anonymity floor) + data retention (renders ≤ 24 h).
- [ ] GDPR webhooks: `customers/data_request`, `customers/redact`, `shop/redact` declared
      (`compliance_topics`) and tested with `shopify app webhook trigger --topic customers/redact …`;
      the api answers 200 and logs them (no customer PII held); `shop/redact` purges after 48 h.
- [ ] Protected Customer Data: request **no** customer data access (scopes are products only).
      If order attribution is ever enabled (D7), file the Level 1 request first and update the privacy policy.
- [ ] Billing: one plan with trial + usage line with `cappedAmount`; the merchant sees the overage
      terms on the approval screen; the app handles `app_subscriptions/update` (pause below plan,
      never break the merchant page).
- [ ] Embedded app loads with App Bridge, works in the new admin (`admin.shopify.com`), no
      third-party cookies, CSP `frame-ancestors` set, session tokens verified server-side.
- [ ] Theme app extension: passes `shopify app build` (Theme Check), Liquid < 100 KB, JS < 10 KB
      compressed (sdk.v1.js is < 8 KB gz), storefront strings translated (en, nl), no external requests.
- [ ] Uninstall: `app/uninstalled` deletes sessions, pauses the shop, schedules purge; reinstall
      restores from metafields (shop is source of truth).
- [ ] Listing assets: icon, screenshots of the admin page and the block in a theme, support email,
      app name "Curtain" (D1 — check App Store name availability), categories "Store design" / "Selling products".
- [ ] Review-test store with the block installed, 3 complete garments (use `MOCK_GARMENTS` data),
      and a test subscription.

## Must be verified against a live store (cannot be done offline)

1. **Token exchange** end-to-end: App Bridge `idToken()` → `POST /shopify/token-exchange` → `shpat_…`;
   stale-token 400 retry path.
2. **Metafield definitions**: `metafieldDefinitionCreate` with `validations` (`choices`, `min`/`max`)
   and `access` on the `$app:curtain` namespace for API version 2026-10; the exact `code` on
   duplicate creation is `TAKEN` (handled; any other error aborts loudly).
3. **App-data metafields in Liquid**: `app.metafields.curtain.public_key` resolves inside the theme
   app extension for metafields set on `currentAppInstallation` with namespace `curtain`. If the
   store exposes them under a different path, change the two `assign` lines in the block (the
   `shop_key`/`api_url` settings are the fallback either way).
4. **Bulk operation**: the JSONL shape for nested `images`/`variants`/`metafields` (`__parentId`
   ordering, `MediaImage` vs `ProductImage` ids) and the five-connection / two-level limits.
5. **Billing**: `appSubscriptionCreate` in the dev store's billing currency (and an AUD store for the pilot) (`test: true`), `confirmationUrl`
   flow, `app_subscriptions/update` payload, `appUsageRecordCreate` cap error wording (we match
   `/capped amount|cap/i` → `capReached`).
6. **Webhooks**: declared subscriptions fire to `PUBLIC_API_URL/shopify/webhooks` after
   `shopify app deploy`; header names; HMAC with the client secret (not the API key).
7. **Theme editor deep link** `addAppBlockId={client_id}/try-it-on&target=mainSection`
   on a current Online Store 2.0 theme (Dawn), and the block's `enabled_on.templates: ["product"]`.
8. **Admin page** inside the Shopify admin iframe: CSP, `shopify.idToken()`, `open(url, '_top')`
   for the billing confirmation.
9. Universal-link redirect from the storefront button on iOS Safari / Android Chrome (SDK contract).

## Assumptions stated

- Admin API version `2026-10` (`DEFAULT_API_VERSION`, latest stable as of Nov 2026, supported until
  Oct 2027: https://shopify.dev/docs/api/usage/versioning). Release notes 2026-01 … 2026-10
  (https://shopify.dev/changelog/release-notes/2026-01, -04, -07, -10) were checked for the fields
  used here: the only change affecting this package is that `bulkOperationRunQuery` no longer
  groups child objects by default (2026-01), which `parseBulkJsonl` handles. Products, metafields,
  metafield definitions, billing, `shop.primaryDomain` and the webhook topics we subscribe to are
  unchanged. Bump the constant each year before the pinned version leaves support.
- Billing currency (#6): plan prices are authored in EUR; a subscription is created in the shop's
  `shopBillingPreferences.currency` when `DEFAULT_EUR_RATES` has a rate for it (USD otherwise),
  monthly price and cap rounded to whole units, usage to the minor unit. The api stores the
  currency and rate on the shop and reuses them for every usage record. Rates are approximate list
  rates, reviewed with pricing, not live FX; `parseEurRates` reads an override table from JSON.
- `shopify.app.toml` keys follow the current reference (`[access_scopes].use_legacy_install_flow`,
  `[webhooks].api_version`, `[[webhooks.subscriptions]].compliance_topics`, `[build].include_config_on_deploy`).
  Webhook `uri`s are absolute (`{{PUBLIC_API_URL}}/shopify/webhooks`) because `application_url`
  is the admin page on the same origin; relative `/shopify/webhooks` also validates.
- The metafield **keys are the schema contract's** (`size_chart`, `fabric`, `flat_lay_photo`, …),
  not `*_json` variants: `@curtain/schema`'s `fromShopifyProduct` and the api's sync job already
  agree on them, and the data must survive uninstall/reinstall unchanged.
