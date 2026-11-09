# Shopify App Store requirements checklist

Checked against the repository on 2026-11-06 (branch `claude/garment-engine`) for the standalone plugin (D11, D17). Nothing here has been run against a live Shopify store yet; "done" means done in code and tests, "verify" means it needs the dev store.

Sources (read 2026-11-06):

- App Store requirements, numbered items: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- Listing and performance guidance (Lighthouse, field limits): https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices
- Mandatory compliance webhooks: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- Expiring offline access tokens: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/offline-access-tokens

Status: **done**, **verify** (code is there, a live store must confirm), **gap** (work needed), **founder** (a decision or an account action), **n/a**.

## Summary

Two stages, two different bars:

1. **Pilot (custom distribution, bohohippychic.com.au).** Custom apps are not reviewed and the expiring-token deadline does not apply to them. What is needed: the dev store end-to-end (STATUS "Recommended next steps" 2), the AU chart assigned, billing matching D17, the privacy policy reviewed enough to link from the fit tool. Blocking: the live-store items marked verify (B1, the D17 plan, and A3 are built; the second release review fixed reinstall, legacy-plan and trial-clock billing gaps, see `docs/STATUS.md` Release v1). Fixed in the release v1 pass (see section G): **G1** (AUD prices made every product of the pilot shop un-try-able) and **G2** (a chart assigned in the builder was not enough to get a size).
2. **Public listing.** Additionally blocking: **A3** verified on a live store (built in code; non-expiring tokens are delisted from 1 January 2027), **L1** (final privacy policy and terms, not drafts), **P1** (Lighthouse impact measured), the listing assets and the review screencast.

## A. Authentication and installation

| # | Requirement | Status | Evidence / what to do |
| --- | --- | --- | --- |
| A1 | 1.1.1 Session tokens; works without third-party cookies or local storage (also in Chrome incognito) | done, verify | `packages/shopify-app/admin/index.html` uses `shopify.idToken()` and sends `Authorization: Bearer <session token>`; no cookies or storage in the admin page (README "The embedded admin page"). The api verifies the token: `apps/api/src/auth/shopifySessionToken.ts`, `packages/shopify-app/src/sessionToken.ts`. Verify in incognito on the dev store. |
| A2 | 2.3.1 to 2.3.4 Install from a Shopify surface, authenticate immediately, land in the app UI, same on reinstall | done, verify | Managed installation (`use_legacy_install_flow = false` in `packages/shopify-app/shopify.app.toml`), token exchange on first admin load (`POST /shopify/token-exchange`, `apps/api/src/shopify/routes.ts`). No shop-domain field anywhere. Reinstall clears `uninstalledAt`/`purgeAfter` and unpauses (`routes.ts` token-exchange handler). `[auth].redirect_urls` answers with a redirect to the embedded home (`GET /shopify/auth/callback`). |
| A3 | 3.1.2 Expiring offline access tokens (non-expiring tokens are not permitted for public apps; delisted 1 Jan 2027, API rejected 1 Apr 2027; custom apps exempt) | done, verify | Token exchange asks for `expiring=1` (`SHOPIFY_EXPIRING_OFFLINE_TOKENS`, default on), the refresh token is stored encrypted with both expiries (migration 0004), `accessTokenFor` refreshes within `SHOPIFY_TOKEN_REFRESH_MARGIN_SEC`, the daily job refreshes dormant shops and migrates non-expiring tokens, exchange and refresh share a per-shop lock, a terminal refresh failure keeps the still-valid access token until it expires (`apps/api/src/shopify/client.ts`; tests `apps/api/src/shopify/tokens.test.ts`). Verify on the dev store. |
| A4 | 3.1.1 Valid TLS | done (prod) | Caddy terminates TLS (`infra/Caddyfile`, D9). |
| A5 | 3.2.x Only necessary scopes | done | `read_products,write_products` only (`shopify.app.toml`, `REQUIRED_SCOPES` in `packages/shopify-app/src/appConfig.ts`). No customer, order or script-tag scopes, so no Protected Customer Data request is needed. `read_orders` stays off (D7). |

## B. Billing

| # | Requirement | Status | Evidence / what to do |
| --- | --- | --- | --- |
| B1 | 1.2.1 Charge through Shopify Billing API | done, verify | D17: one plan "Curtain", one recurring line of USD 8.99 per 30 days through `appSubscriptionCreate` (`POST /shopify/billing/subscribe`, `apps/api/src/shopify/routes.ts`), converted for the shop's billing currency with the rate recorded, no usage line, daily caps kept as fair use (`apps/api/src/billing/plans.ts`; tests `apps/api/src/shopify/billing.test.ts`). Verify the AUD charge on a dev store. |
| B2 | 1.2.2 Accept, decline and re-approve on reinstall | done, verify | `app_subscriptions/update` sets `paused` from the status and `plan` to free on CANCELLED/EXPIRED/DECLINED of the current subscription; FROZEN pauses. `app/uninstalled` drops the shop to `free` with no subscription (Shopify cancels it on uninstall and the CANCELLED update never arrives), a reinstall starts there, and every token exchange reconciles the plan with `currentAppInstallation.activeSubscriptions`, so the admin offers Subscribe again after a reinstall. Shops moved from the retired starter/pro plans see "Switch to Curtain" until the new subscription is ACTIVE. Tests: `billing.test.ts`, `adminCharts.test.ts`. Verify on the dev store: decline, approve, uninstall, reinstall, approve again. |
| B3 | 1.2.3 Plan changes without support or reinstall | verify | With one plan (D17) this is subscribe / cancel from the admin page plan button. If a second plan or an annual option comes back, `appSubscriptionCreate` with `replacementBehavior` is needed (not used today). |
| B4 | 4.2.1 to 4.2.3 Pricing only in the Pricing section, complete, including trial | founder | `docs/app-store/listing.md` "Pricing". Trial is `BILLING_TRIAL_DAYS` (default 7), counted from the first approval and never handed out twice; the listing must match the value the founder confirms. |

## C. Webhooks, privacy and data (GDPR)

| # | Requirement | Status | Evidence / what to do |
| --- | --- | --- | --- |
| C1 | Subscribe to `customers/data_request`, `customers/redact`, `shop/redact` before publishing | done, verify | `compliance_topics` in `shopify.app.toml`; handled in `apps/api/src/shopify/routes.ts`; tested in `apps/api/src/shopify.test.ts` ("GDPR topics"). Shopify notes that `shopify app webhook trigger` does not test the subscription itself: confirm deliveries after `shopify app deploy`. |
| C2 | Invalid HMAC answers 401; valid requests answer 2xx | done | `verifyWebhookHmac` on the raw body, `unauthorized('bad webhook hmac')` (`routes.ts`); duplicates by `X-Shopify-Webhook-Id` (`security-review.test.ts`). |
| C3 | Complete data requests within 30 days, even when no personal data is held | done | `customers/*` are acknowledged and logged without the customer fields (`loggablePayload`, `apps/api/README.md` security review). We hold no Shopify customer data, so there is nothing to return or erase; the privacy policy says so. |
| C4 | `shop/redact` (sent 48 h after uninstall) erases shop data | done | `purge-shop` job 48 h later, cascade delete (`apps/api/src/jobs/maintenance.ts`). |
| C5 | Uninstall cleanup | done, verify | `app/uninstalled`: pause, delete the offline sessions, `purgeAfter` = now + 48 h; the hourly prune purges even if `shop/redact` never arrives (`routes.ts`, `maintenance.ts`). Shopify stops rendering the app block once the app is uninstalled. Verify whether `$app:curtain` product metafields survive uninstall (the README assumes the shop keeps them for reinstall). |
| C6 | Privacy policy (required by the listing guidance) | **draft** | `docs/legal/privacy.md`, served at `/privacy` (`apps/web/src/routes/LegalRoute.tsx`). DRAFT for legal review; placeholders for entity, retention, hosting region, subprocessors. |
| C7 | Terms of service | **draft** | `docs/legal/terms.md`, served at `/terms`. DRAFT. |
| C8 | 5.1.5 Customer data collected through the Online Store must be returned to the merchant's admin | n/a (legal review) | Curtain collects no Shopify customer data; shoppers are anonymous devices and merchants get aggregates only (D3). Confirm with Shopify review that anonymous size advice is not "customer data" in the sense of API Terms 2.3.17. |
| C9 | Retention of shopper records | **gap** (policy) | Devices, try sessions, ledger and usage rows have no automatic expiry (only renders, 24 h, and shops after uninstall). The privacy policy carries a placeholder; add a prune job once the founder sets the period. Also the AUTH-1 residual (STATUS "Known gaps"): a lost rotated token orphans server rows out of reach of Forget me. |

## D. Platform and storefront

| # | Requirement | Status | Evidence / what to do |
| --- | --- | --- | --- |
| D1 | 5.1.1 Theme changes only through theme app extensions; no Script Tag or Asset API | done | One app block, `packages/shopify-app/extensions/try-button/blocks/try-it-on.liquid` (`target: content`, product template only). No `write_script_tags` or `write_themes` scope; no ScriptTag or theme Asset API calls in `apps/api` or `packages/shopify-app`. |
| D2 | 5.1.2 Block shows correctly in the theme editor and storefront | verify | `extension.test.ts` covers the Liquid output; setup notices for the editor are in `locales/en.default.json`. Run `shopify app build` (Theme Check) and test on Dawn and one other Online Store 2.0 theme. |
| D3 | 5.1.3 Detailed onboarding for adding the block, deep link recommended | done | Admin onboarding step "Add the Try it on block" with `addAppBlockId` deep link (`packages/shopify-app/src/deepLinks.ts`, `admin/index.html`). Add a help page with screenshots (support docs). |
| D4 | 5.1.4 App name branding on the storefront | done | The storefront shows "Try it on"; the Curtain name appears inside the overlay the shopper uses directly, plus a privacy line. |
| D5 | Performance: must not lower Lighthouse performance by more than 10 points (weighted home 17 %, product 40 %, collection 43 %) | **gap** (not measured) | Block only on product pages; `sdk.v1.js` is 19.5 KB raw, 7.8 KB gzip (budget 8 KB), loaded `defer` from Shopify's CDN, once per page; CSS 1 KB; no request to our api until the shopper clicks. Measure: average several Lighthouse runs on the review store's home, a collection and a product page, with and without the block, and record the numbers here. |
| D6 | 2.2.3 Latest App Bridge, script first | done | `admin/index.html` loads `https://cdn.shopify.com/shopifycloud/app-bridge.js` as the first script (`APP_BRIDGE_SCRIPT_URL`). |
| D7 | 2.2.4 GraphQL Admin API only | done | All Admin calls go to `/admin/api/{version}/graphql.json` (`packages/shopify-app/src/graphql/client.ts`); version `2026-10`. |
| D8 | 2.2.2 Consistent embedded experience; 2.1.3 working UI, no 404/500 | verify | Polaris-like static admin page with CSP `frame-ancestors` for the shop and `admin.shopify.com` (`adminContentSecurityPolicy`). Check every admin link and the billing redirect (`open(url, '_top')`) inside the admin iframe. |
| D9 | 2.1.4 Data sync | done, verify | Product webhooks and the bulk backfill (`packages/shopify-app/src/graphql/bulk.ts`, `apps/api/src/jobs/syncShopifyProduct.ts`). |

## E. Listing and submission

| # | Requirement | Status | Evidence / what to do |
| --- | --- | --- | --- |
| E1 | 4.1.1 / 4.1.2 Name matches the dashboard, unique, ≤ 30 characters | founder | `name = "Curtain: Fit & Size Finder"` in `shopify.app.toml` and the listing draft. "Curtain" alone collides with curtain-calculator apps in search. Trademark clearance still open (D1). |
| E2 | 4.3.1 "Merchant must have online store" | to set | Listing form. |
| E3 | 4.3.2 Only fully supported languages | to set | List English only (admin and fit tool are English). |
| E4 | 4.3.3 to 4.3.7 No statistics, guarantees, reviews or prices in texts and images | done in draft | `docs/app-store/listing.md`. Keep "estimate" wording (AGENTS.md rule 3). |
| E5 | 4.4.x Icon 1200 × 1200, 3 to 6 screenshots 1600 × 900, real UI, unique, no Shopify marks | gap | Screenshot plan in `listing.md`; capture from `pnpm demo` and the review store. |
| E6 | 4.5.3 Demo screencast (English) | gap | Script in `listing.md` "Review submission". |
| E7 | 4.5.4 / 4.5.5 Test credentials without 2FA | to set | Fit tool needs no account; give a review store if one is used. |
| E8 | 4.5.6 Emergency developer contact | founder | Partner Dashboard. |
| E9 | Support contact and Shopify-specific help docs | founder | Placeholders in `listing.md`. |
| E10 | Public distribution | founder | The distribution method of an app cannot be changed once chosen (https://shopify.dev/docs/apps/launch/distribution). The pilot app is custom; the App Store needs a **second app** created with public distribution, its own client id and secret, and its own `$app:curtain` metafields (the pilot app's size charts do not carry over). `docs/LAUNCH-SHOPIFY.md` "App Store listing later". |

## F. Our own release gates (not Shopify's, from AGENTS.md and STATUS.md)

- Privacy e2e (Playwright, no image or large body leaves the page) running in CI: not yet (STATUS "Recommended next steps" 5).
- Live-store verification list in `packages/shopify-app/README.md` "Must be verified against a live store": items 1 to 9 still open.
- The fit tool's privacy line should link to `/privacy` once the policy is final (embed code, not changed here).

## G. Pilot blockers found in the release v1 review (6 Nov 2026)

| # | Blocker | Status | Evidence / fix |
| --- | --- | --- | --- |
| G1 | Every product of an AUD shop failed with "the shop has not finished this product": `fromShopifyProduct` dropped non-EUR prices, `priceEur` is required in `GarmentPayloadSchema`, and `GET /v1/try` answered 422 `product_incomplete`. bohohippychic.com.au prices in AUD. | **fixed** | The mapper converts with the EUR rate table (`priceToEur` in `packages/schema/src/mappings/common.ts`; the sync jobs pass `DEFAULT_EUR_RATES`), and the try route no longer needs a price at all (G2). Tests: `packages/schema/src/sizeAdvice.test.ts` (AUD → mapper → `GarmentPayloadSchema`), `apps/api/src/pilot-size-advice.test.ts` (AUD product → upsert → `/v1/sdk/sessions` → `/v1/try`). |
| G2 | Assigning a template chart (the two-minute setup) did not make a product try-able: fabric, pattern block and colour were also required and only fabric had a UI. | **fixed** | `sizeAdviceGarment` (`packages/schema/src/sizeAdvice.ts`): category + chart type + chart are enough; price, colour (the shop's brand colour), pattern block (`unspecified`, the fit engine's category defaults) and fabric (non-stretch woven) default. The try route, the stored product status and the admin checklist use this one predicate. |
| G3 | The admin said "Needs data" and asked for flat-lay photos that size advice does not use. | **fixed** | The checklist marks only the three size-advice fields required; the flat-lay row is hidden unless the 3D render is on the plan (`productChecklist(..., { render: true })`). |
| G4 | Live products would have synced without their size chart: the Admin API returns the app-reserved namespace expanded (`app--{app id}--curtain`), and `indexShopifyMetafields` kept only `$app:curtain` / `curtain`. Every mock echoed the request form, so no test saw it. Found by the offline contract harness (9 Nov 2026). | **fixed** | `isCurtainMetafieldNamespace` (`packages/schema/src/mappings/shopify.ts`) accepts `app--<digits>--curtain`. Tests: `packages/schema/src/mappings/shopify.test.ts`, `apps/api/src/shopify/contract.test.ts` (steps 5, 6, 13 fail without the fix). |
| G5 | The pilot is a custom-distribution app, and those "can't charge merchants through Shopify's app billing system": Subscribe would have failed with a Shopify userError (500), and the shop would have sat on `free`. | **fixed** | `SHOPIFY_DISTRIBUTION=custom` (api env): install and reinstall grant the plan (`subscriptionStatus: ARRANGED`, no `billingRef`), the admin page shows the plan as arranged, `/shopify/billing/subscribe` answers 409 `billing_not_available` (also when Shopify refuses it while the env says public). Tests: `contract.test.ts`, `packages/shopify-app/src/adminCharts.test.ts`. |
| G6 | A webhook whose processing failed was answered 200, so Shopify never retried it and the event was lost (no replay tool exists). | **fixed** | The api answers 500, keeps the row as `failed`, and reprocesses the same `X-Shopify-Webhook-Id` when Shopify redelivers it. A claim left in `received` for over 30 s (crash, restart or DB outage before the row was finished) is reclaimed by the redelivery too (`apps/api/src/shopify/routes.ts`; `contract.test.ts` steps 11 and 11b). Open: every failure answers 500, also a deterministic one, so a persistent bug burns all 8 retries; watch `failed` rows (LAUNCH-SHOPIFY.md E7). |

