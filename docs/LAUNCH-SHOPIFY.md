# Shopify go-live: the Curtain pilot at Bohohippychic

Ordered checklist for the founder, written 9 Nov 2026 against the shopify.dev documentation of that
date (sources at the end). Scope: the Shopify app (`packages/shopify-app`, the Shopify routes in
`apps/api`, the "Try it on" theme block, `.github/workflows/shopify-deploy.yml`). The new VPS itself
is in `docs/DEPLOY.md`; this list assumes `https://api.curtain.fit/healthz` already answers.

Status in one line: everything that can be checked without a store passes (unit tests and the
offline contract harness, `apps/api/src/shopify/contract.test.ts`). **Nothing has run against a real
Shopify store yet.** Part D below is the script that does that.

---

## A. Two decisions first (they cannot be undone)

**A1. The pilot runs on a custom-distribution app, and that app cannot bill through Shopify.**
Shopify: custom distribution "Can't charge merchants through Shopify's app billing system", and
"You can't change the distribution method after you select it"
(https://shopify.dev/docs/apps/launch/distribution). Consequences, already built in:

- Set `SHOPIFY_DISTRIBUTION=custom` in `/etc/curtain/curtain.env`. The api then gives the shop the
  Curtain plan on install (and again on a reinstall), the admin page says "arranged with Curtain"
  instead of showing a Subscribe button, and the billing route answers 409 `billing_not_available`.
- Payment for the pilot (free, or an invoice outside Shopify) is your agreement with the merchant.
- To pause the shop by hand: `UPDATE shops SET paused = true WHERE domain = '<handle>.myshopify.com';`
  (the next admin open leaves a pause alone; a reinstall grants the plan again).

**A2. The App Store listing will be a second app.** Because the method is fixed, the public listing
needs a new app created with public distribution: a new client id and secret, its own review. The
size charts the pilot app writes live in `$app:curtain`, which Shopify expands per app
(`app--{app id}--curtain`), so the App Store app will not see them. Moving Bohohippychic to that app
later means re-assigning its charts (the api keeps a copy; a write-back tool is not built yet).
Accept this now, or create the public app first and wait for its review before the pilot (slower).
This checklist assumes the first option.

---

## B. Accounts and dashboard clicks (once)

Shopify now manages apps in the **Dev Dashboard** (`https://dev.shopify.com/dashboard/`). The
Distribution card only appears for apps that belong to a **Partner organisation**, so create the app
from your Partner account, not from a store's organisation.

1. **Partner account**: sign in at `partners.shopify.com`; note the organisation.
2. **Create the app** (Dev Dashboard → *Create app* → create it manually; do not run
   `shopify app init`, the repository has the config). Name: anything for the pilot, e.g.
   `Curtain` (the listing name question, checklist E1, only matters for the second app).
3. **Client credentials** (the app → Settings): copy the **Client ID** and the **Client secret**.
   - Client ID → GitHub secret `SHOPIFY_API_KEY` and `SHOPIFY_API_KEY` in `/etc/curtain/curtain.env`.
   - Client secret → **only** `SHOPIFY_API_SECRET` in `/etc/curtain/curtain.env`. Never GitHub,
     never chat. It signs webhooks and session tokens.
4. **CI credential**: create a **service account** with the *App development* permission (the app
   → Settings, or the organisation's Settings → Users → Security), copy its token into the GitHub
   secret `SHOPIFY_SERVICE_ACCOUNT_TOKEN`. (The older Partner "CLI token" also works, as
   `SHOPIFY_CLI_PARTNERS_TOKEN`, if your dashboard still offers it.)
5. **GitHub repository variable** `DOMAIN` = `curtain.fit`; optional `SHOPIFY_APP_HANDLE`
   (default `curtain`, must match the app's handle).
6. **Server env** (`/etc/curtain/curtain.env`, then restart the api):
   `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_DISTRIBUTION=custom`,
   `SHOPIFY_API_VERSION=2026-10`, `SHOPIFY_APP_HANDLE=curtain`, `SHOPIFY_EXPIRING_OFFLINE_TOKENS=1`.
7. **Emergency developer contact** (Partner Dashboard → Settings): an e-mail you read. Shopify
   sends webhook failure warnings there.
8. **Development store** (Dev Dashboard → *Dev stores* → create): for the dry run in part D. Give
   it a few dresses with S/M/L or 8–14 size variants.
9. **Deploy the app config and the theme block**: GitHub → Actions → `shopify-deploy` → Run
   workflow on `release`, tick *release* (or push to `release`). Expected: the run summary says
   "Shopify deploy: success", version `git-…`, application_url
   `https://api.curtain.fit/shopify/admin`, webhooks `https://api.curtain.fit/shopify/webhooks`.
   Then in the Dev Dashboard the app's *Versions* list shows it as the active version, and the app
   URL reads `https://api.curtain.fit/shopify/admin`.
10. **Do not choose the distribution yet.** Install on the development store first (part D);
    choose *Custom distribution* only in part E.

---

## C. What the offline harness already proved (and what it cannot)

`pnpm --filter @curtain/api exec vitest run src/shopify/contract.test.ts` runs the api against a
fake Shopify (`apps/api/src/test/fakeShopify`): ID tokens and webhooks signed with a fake client
secret exactly as Shopify signs them, and every GraphQL document validated against an excerpt of the
2026-10 Admin schema. It found and now guards three defects (checklist G4 to G6): live metafields
come back as `app--{id}--curtain` and were being ignored; custom apps cannot bill; failed webhooks
were acknowledged and lost.

It **cannot** prove: that Shopify behaves as the fake assumes (each `ASSUMPTION` in the fake's
source), that the hand-written schema excerpt matches the real schema in every detail, anything in
Liquid or the theme editor, App Bridge inside the admin iframe, real deliveries and retries, or the
storefront. Those are part D.

---

## D. Dev store test script (do this before the pilot; about 60 minutes)

Keep `docker compose -p curtain logs -f api` open on the server. "DB:" lines are SQL for
`docker compose -p curtain exec postgres psql -U curtain -d curtain`. Record each result in the last column; every row must pass before
part E. README numbers refer to `packages/shopify-app/README.md` "Must be verified against a live
store".

| # | Do | Expected | Covers | Result |
|---|---|---|---|---|
| D1 | Dev Dashboard → the app → install on the development store (the *Test on dev store* / install option). Approve the scopes. | The consent screen lists only *products* (read and write). You land inside the Shopify admin on the Curtain page, no login form, no shop-domain field. The page says "Connected. Public key pk_live_…". Log: `shopify metafield definitions ensured`, `created: 17`. DB: `SELECT plan, paused, billing_ref, settings->>'subscriptionStatus' FROM shops WHERE domain='<dev>.myshopify.com';` → `curtain`, `false`, NULL, `ARRANGED`. | README 1, A1/A2 | |
| D2 | Reload the Curtain page twice. | No error banner. Log: `created: 0, existing: 17`. DB: `SELECT expires_at, refresh_token_enc IS NOT NULL FROM shopify_sessions;` → an expiry about 1 h ahead, `true`. | README 1 and 2 (TAKEN path), A3 | |
| D3 | Shopify admin → Settings → Custom data → Products. | 17 Curtain definitions (Size chart type, Size chart (cm), Fabric, …), owned by the app. Open a product: the Curtain metafields are editable. | README 2 | |
| D4 | In the Curtain page keep the AU template, assign it to a collection of dresses (Preview first). | Preview shows the right count and a sample. Assign reports N written. Within a minute the products table shows them as **Try-able**. DB: `SELECT status, count(*) FROM products GROUP BY 1;` → `active` for those products. (This is the namespace check of G4 on real data.) | README 9, G4 | |
| D5 | Edit one product's title in Shopify. | Within seconds: DB `SELECT topic, status FROM webhook_log ORDER BY received_at DESC LIMIT 3;` → `products/update`, `processed`. The Curtain products table shows the new title after a reload. | README 6 | |
| D6 | Curtain page → "Add the block" (onboarding step). | The theme editor opens on a product template of the current theme (use **Dawn**) with "Try it on" added in the main section. Save. | README 7, checklist D3 | |
| D7 | Open a product page on the storefront, view source. | A `<script … data-curtain-sdk data-shop="pk_live_…" data-api="https://api.curtain.fit" …>` is added (via the inline loader), `sdk.v1.js` comes from `cdn.shopify.com`. If `data-shop` is empty: the app-data metafields did not reach Liquid; fill the block's two advanced settings and report it (README 3). | README 3 | |
| D8 | On that page: *Try it on* → height and weight → result. Choose the size. | The overlay shows a size labelled as an estimate; choosing it selects that variant in the product form; *Add to cart* adds it. Reload: the size peek shows the size. Try once on an iPhone (Safari) and an Android phone (Chrome). | storefront, README 10 | |
| D9 | Open the Curtain page in a Chrome **incognito** window (third-party cookies blocked). | It loads and works the same. Browser console: no CSP or frame errors. | checklist A1, D8 | |
| D10 | Wait more than 1 hour, open the Curtain page. | It works. Log shows no `shopify token refresh failed`. DB: `expires_at` moved forward. | A3 (expiring tokens) | |
| D11 | Plan card on the Curtain page. | No Subscribe button; "Your Curtain plan is arranged directly with Curtain." | A1 | |
| D12 | From your laptop: `shopify app webhook trigger --topic customers/redact --api-version 2026-10 --delivery-method http --address https://api.curtain.fit/shopify/webhooks --client-secret <secret>` (type the secret in your terminal only), then the same for `customers/data_request` and `shop/redact`. | Each answers 200. DB: the `customers/*` rows have a payload with `"redacted": true` and no e-mail. Then send one with a wrong `--client-secret`: 401. (This checks our endpoint; it does not prove Shopify's own subscription, see D15.) If a sample answers 400 `missing_webhook_id`, the CLI's sample came without `X-Shopify-Webhook-Id` (the api refuses those so a captured delivery cannot be replayed); write it down, real deliveries carry the header. | README 6, checklist C1/C2 | |
| D13 | Settings → Apps → Curtain → Uninstall. | Within seconds: DB `webhook_log` has `app/uninstalled` `processed`; `shops`: `plan=free`, `paused=true`, `uninstalled_at` set; `shopify_sessions` empty. The storefront no longer shows the button. | README 5/6, checklist C5 | |
| D14 | Reinstall from the Dev Dashboard; open the app. | Lands in the app; plan `curtain` again (`ARRANGED`); log `created: 0, existing: 17` (definitions survived) or `created: 17` (they did not: write down which). The products assigned in D4 are **Try-able** again without re-assigning (if not: `$app` metafields did not survive the uninstall; write it down). Re-add the block if the theme lost it. | checklist C5, the fake's uninstall ASSUMPTIONs | |
| D15 | 48 hours after D13 (optional on the dev store). | A `shop/redact` row in `webhook_log` from Shopify itself (not the CLI). This is the only proof that the compliance subscription in the toml is live. | checklist C1/C4 | |

Not on the pilot path, so not in this script: billing (custom apps cannot use it; see part F) and
the bulk export (`runProductBackfill`; the api backfills with the paged products query).

---

## E. Pilot install at Bohohippychic

1. **Find the shop's myshopify domain.** Ask the merchant, or it is in their admin address:
   `admin.shopify.com/store/<handle>` means `<handle>.myshopify.com`. Not `bohohippychic.com.au`.
2. **Choose the distribution** (irreversible): Dev Dashboard → the app → Home → *Distribution* →
   *Select distribution method* → **Custom distribution** → confirm.
3. *Manage custom install link* → enter `<handle>.myshopify.com` → untick "Allow multi-store installs
   for one Plus organization" unless they run several stores → *Generate link* → copy.
4. **Send the link** to the store owner (e-mail), with: "Open this while logged in to your Shopify
   admin and approve. It reads and writes your products only; it never sees your customers or
   orders. Then open Apps → Curtain once."
5. **When they have installed** (DB: the shop row exists with `plan=curtain`, `ARRANGED`), do the
   10-minute setup with them on a call: keep the AU template, untick sizes they do not sell, assign
   to the Dresses (and Tops) collections, "Add the block", place it under the size picker, Save.
6. **Verify on the live shop**: D4, D5, D7 and D8 on two real products (one dress, one skirt), on a
   phone. Write the results next to part D.
7. **Watch the first week**: `webhook_log` rows with `status='failed'` (Shopify retries those for 4
   hours; a row that stays failed needs a look), and the emergency-contact inbox.
8. **Rollback**: pause (`UPDATE shops SET paused = true …`) shows shoppers a short-break screen
   while the button stays; the merchant can also remove the block in the theme editor or uninstall.

---

## F. App Store listing later (the second app)

Status as of 9 Nov 2026. "Code" means it exists and is tested offline; nothing is verified on a store.

| Requirement (shopify.dev id) | Status | What is left |
|---|---|---|
| New app with **public** distribution (method is permanent) | open | Create it when the pilot is done; new client id/secret; point the api's `SHOPIFY_API_KEY`/`SECRET` at it and set `SHOPIFY_DISTRIBUTION=public`. One api serves one app today: running the pilot app and the public app side by side needs multi-app support in the api (per-shop client id, HMAC and session-token check against either secret). Not built. |
| Moving Bohohippychic to the public app | open | `$app:curtain` is per app: write the charts back from the api's copy after the new install (tool not built), or have the merchant re-assign templates (2 minutes). |
| 1.2.1 Shopify billing for all charges | code | `appSubscriptionCreate` (Billing API, one USD 8.99 plan, trial, test charges on dev stores) with decline/approve/reinstall handling (contract steps 8, 9, 13, 14). **Check first:** Shopify now calls **Shopify App Pricing** (plans defined in the dashboard, Shopify-hosted plan page) "the default for new public apps" and the Billing API "still supported for existing apps and outlier pricing models" (https://shopify.dev/docs/apps/launch/billing/manual-pricing). A flat monthly plan with a trial fits App Pricing, so review may ask for it. Switching means: define the plan in the dashboard, replace the Subscribe call by a link to the plan page; the `app_subscriptions/update` and `activeSubscriptions` handling stays. Decide before submitting. |
| 1.2.2 accept / decline / re-approve on reinstall | code | Dev-store run of contract steps 8, 9, 13, 14 with the public app (AUD billing currency): approve, decline, uninstall, reinstall, approve again. |
| 1.2.3 plan changes without support | code (one plan) | Only relevant if a second plan appears. |
| 1.1.1 session tokens, no third-party cookies | code | D9 again on the public app. |
| 2.3.1–2.3.4 install from Shopify, auth immediately, land in the UI, same on reinstall | code | D1, D14 on the public app. |
| 3.1.1 TLS | done on the VPS (Caddy) | — |
| 3.1.2 expiring offline tokens (public apps: mandatory) | code | D10 on the public app. |
| Compliance webhooks subscribed and answering (401 on bad HMAC) | code | D12, D15 on the public app. |
| 2.2.3 latest App Bridge, script first | done | — |
| 5.1.1 theme changes only through theme app extensions | done | — |
| 5.1.2 block works in editor and storefront | verify | D6–D8 on Dawn and one more Online Store 2.0 theme; `shopify app build` (Theme Check) clean. |
| 5.1.3 onboarding with a deep link | done | Help page with screenshots. |
| Theme extension limits: Liquid ≤ 100 KB (enforced), JS ≤ 10 KB compressed (suggested), block name < 25 characters | done | `sdk.v1.js` ≤ 8,192 B gzip (CI budget), block name "Try it on". |
| Storefront performance (Built for Shopify 2.2.1: at most 10 Lighthouse points lower) | not measured | Measure home, collection, product with and without the block on the review store (checklist D5). |
| Admin API version | done | `2026-10` is the latest stable (supported until 16 Oct 2027). Bump `DEFAULT_API_VERSION` to `2027-07` in the summer of 2027. |
| Deprecated fields in use | open | `Product.featuredImage` and `Product.images` are deprecated in 2026-10 (the harness lists them). Move to `featuredMedia` / `media` before Shopify removes them. |
| 4.1.1 / 4.1.2 name, unique, ≤ 30 characters | founder | "Curtain: Fit & Size Finder" (toml), trademark clearance (D1). |
| 4.3.1 "Merchant must have online store" | to set | Listing form. |
| 4.4.x icon 1200×1200, screenshots 1600×900, no pricing in images | gap | `docs/app-store/listing.md`. |
| 4.5.3 demo screencast in English | gap | Script in `listing.md`. |
| 4.5.4/4.5.5 test credentials without 2FA, still working after publication | to set | Review store with the block and 3 complete products. |
| 4.5.6 emergency developer contact | founder | Part B step 7. |
| Privacy policy and terms URLs | draft | `docs/legal/privacy.md`, `terms.md` (legal review; retention period C9). |
| Support e-mail and help docs | founder | Placeholders in `listing.md`. |
| Built for Shopify (optional badge): admin LCP ≤ 2.5 s, CLS ≤ 0.1, INP ≤ 200 ms; `s-app-nav`, `s-modal`, contextual save bar; 50 installs, 5 reviews | gap | The admin page is Polaris-like CSS, not the Polaris web components BfS asks for; plan a port after launch. |

Full requirement list: `docs/app-store/checklist.md`.

---

## Sources (read 9 Nov 2026)

- Distribution methods, custom distribution limits and install link: https://shopify.dev/docs/apps/launch/distribution, https://shopify.dev/docs/apps/launch/distribution/select-distribution-method
- Billing: https://shopify.dev/docs/apps/launch/billing, https://shopify.dev/docs/apps/launch/billing/manual-pricing, https://shopify.dev/docs/api/admin-graphql/latest/mutations/appSubscriptionCreate; the custom-app refusal text as developers report it: https://community.shopify.dev/t/getting-custom-apps-cannot-use-the-billing-api-on-public-app/32616
- Token exchange and expiring offline tokens: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
- Compliance webhooks: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- Webhook delivery, HMAC, timeouts, retries, duplicate detection: https://shopify.dev/docs/apps/build/webhooks/subscribe/https, https://shopify.dev/docs/api/webhooks/latest
- API versions: https://shopify.dev/docs/api/usage/versioning
- App configuration (toml keys): https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration
- CI deploy with a service account: https://shopify.dev/docs/apps/launch/deployment/deploy-in-ci-cd-pipeline
- Theme app extension limits and schema: https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
- App Store requirements: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- Built for Shopify: https://shopify.dev/docs/apps/launch/built-for-shopify/requirements
- `$app` namespace expansion: https://shopify.dev/docs/apps/build/metafields
- Admin schema pages used for the harness excerpt: listed at the top of `apps/api/src/test/fakeShopify/admin-2026-10.excerpt.graphql`
- Shopify CLI behaviour (service-account variable only in 5.x, `include_config_on_deploy` removed): read from the published `@shopify/cli` 4.9.5 and 5.0.1 packages
