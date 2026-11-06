# Shopify App Store listing (DRAFT)

Draft of the listing form for the standalone plugin (size advice without the 3D garment engine, D11 and D17). Field limits are from Shopify's listing guidance (https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices, read 2026-11-06) and the App Store requirements (https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements, numbers like 4.3.3 below). Everything in [SQUARE BRACKETS] is for the founder. Readiness per requirement: `docs/app-store/checklist.md`.

Order of release: first **custom distribution** for the pilot shop bohohippychic.com.au (no listing needed, see `packages/shopify-app/README.md` "Pilot: custom distribution"), then this listing for public distribution.

## Name and short texts

| Field | Draft | Limit / rule |
| --- | --- | --- |
| App name | **Curtain: Fit & Size Finder** (26 characters) | ≤ 30 characters; same as `name` in `packages/shopify-app/shopify.app.toml` (4.1.1); unique, leads with the brand (4.1.2). Two apps about real curtains already exist (*InterioApp Curtains*, *Curtain and Blind Calculator*), so the bare word "Curtain" is ambiguous in App Store search. [FOUNDER: confirm against D1 and trademark clearance.] |
| App card subtitle | Size advice on your product page, from your own size charts | Benefit, no keywords or numbers (4.4.1) |
| App introduction | Help shoppers pick the right size on the product page, with their measurements kept private. | ≤ 100 characters (92) |
| Tagline (brand, not a form field) | Your private fitting room | Used in screenshots and the icon area, never as a bare word in ads (D1) |

### App details (≤ 500 characters)

> Curtain adds a Try it on button to your product pages. Shoppers enter their height, weight and fit preference, or their own measurements, and get a size recommendation based on your size chart, with how each size fits at bust, waist and hips. They stay on your page and need no account. Their measurements stay in their browser: you see totals, never personal data. Start from a sourced AU, UK, EU or US women's chart template, assign it to collections in bulk, and add the block in the theme editor.

(500 characters. Rules 4.4.2: explain the functionality, no bare feature list; 4.3.3: no statistics or guarantees, so no "fewer returns" figures.)

### Feature list (≤ 80 characters each)

1. Size recommendation on the product page, from your own size charts (66)
2. Per-size fit at bust, waist and hips, with a clear confidence level (67)
3. Women's body chart templates: AU, UK, EU and US, with sources (61)
4. Assign charts in bulk by collection, tag, product type or product (65)
5. Shoppers' measurements stay in their browser; you see totals only (65)
6. Selects the recommended size in your product form; your cart stays yours (72)
7. Theme app block: add it in the theme editor, no code changes (60)

## Key benefits versus size chart apps

Written for the "app details" media captions and the demo video, not as competitor claims in the listing (no comparisons with named apps in the listing itself).

- **A recommendation, not homework.** A size chart table asks the shopper to measure themselves and read a grid. Curtain asks for height, weight and fit preference (under 30 seconds) and answers with a size, the fit per body point, and the table with that size highlighted.
- **Honest confidence.** When the shopper gives only height and weight, the missing girths come from a population prior and the confidence says so. Tape measurements or the optional camera scan raise it.
- **Body or garment charts, explicitly.** Each chart says whether its numbers are the body a size fits or the finished garment, so ease is never guessed.
- **Privacy you can state on the page.** Measurements and photos never leave the shopper's device; the merchant sees aggregates above a minimum group size. Shopify customer data scopes are not requested at all.
- **Works with the theme's own form.** The chosen size is selected in the product form and the shopper adds to cart with the theme's button.

## Pricing (Pricing details section only, 4.2.1 and 4.2.3)

D17 (founder decision, Nov 2026) sets one flat plan. The rest is open for the founder.

| Plan | Price | Includes | Trial |
| --- | --- | --- | --- |
| [PLAN NAME, for example "Curtain"] | USD 8.99 / month (D17) [FOUNDER: annual option?] | Unlimited products, all chart templates, bulk assign, size recommendation on every product page, fit analytics | [TRIAL DAYS, for example 14] |
| [FREE PLAN? yes / no] | [USD 0] | [LIMIT, for example N products or N sessions] | n/a |

Notes for the founder:
- The code does not match D17 yet: `apps/api/src/billing/plans.ts` still has free / starter (EUR 29 + usage) / pro (EUR 149 + usage) and `POST /shopify/billing/subscribe` creates a recurring line plus a usage line with `cappedAmount`. The listing must show exactly what the approval screen charges (1.2.2, 4.2.1). See the checklist, item B1.
- No prices in the icon, screenshots or video (4.2.2), and nowhere outside Pricing details (4.2.3).

## Listing settings

- **Category:** [FOUNDER: primary category; SmartSize uses "Product comparison" with tag "Product variants"; Curtain fits the same area].
- **Languages (4.3.2):** English only. The storefront strings also exist in Dutch (`extensions/try-button/locales/nl.json`) but the admin and the fit tool are English, so only English may be listed. Dutch can be mentioned in the details text as a storefront translation.
- **Sales channel requirement (4.3.1):** "Merchant must have online store" (the button is a theme app block).
- **Geographic requirements (4.3.8):** none. Size chart templates cover AU, UK, EU and US women's sizes; men's, kids' and other categories need a merchant's own chart.
- **Works with:** [none at launch].
- **Privacy policy URL:** `https://app.<domain>/privacy` (apps/web route; text `docs/legal/privacy.md`, DRAFT for legal review).
- **Terms of service URL:** `https://app.<domain>/terms` (text `docs/legal/terms.md`, DRAFT).
- **Support:** [SUPPORT EMAIL], [SUPPORT URL / help docs with Shopify-specific setup steps], [RESPONSE TIME].
- **Emergency developer contact (4.5.6):** [NAME, EMAIL, PHONE] in the Partner Dashboard.
- **Demo store URL:** [DEV STORE URL]/products/[PRODUCT HANDLE] with the block installed and a chart assigned.

## Visual assets

- **Icon:** 1200 × 1200 px, JPEG or PNG, no text with prices, no Shopify trademarks (4.2.2, 4.4.3). [DESIGN: coral #FF5A3C curtain mark on cream #F5EFE7, from the design tokens.]
- **Screenshots:** 1600 × 900 px (16:9), 3 to 6 desktop images, at least one of the app UI, each unique, real UI only, no reviews, no statistics, no prices (4.3.4, 4.3.6, 4.4.4, 4.4.5). Mobile screenshots optional.
- **Video:** 2 to 3 minutes, English (4.5.3 asks for a screencast of onboarding and core features for review; the listing video is optional).

### Screenshots to capture

All screens come from the local demo (`pnpm demo`, no keys: storefront `http://localhost:5180/?theme=dawn`, api `http://localhost:8787`, web app `http://localhost:3000`) or from the review dev store. Use a Shopify-Dawn product page, AU sizes 8 to 16 to match the pilot.

| # | Screen | How to get there | Caption draft |
| --- | --- | --- | --- |
| 1 | Product page with the **Try it on** button next to the size selector | Demo storefront, `?theme=dawn`, open a dress | Size advice right next to your size selector |
| 2 | **About you** step in the overlay (height, weight, fit preference, "I know my measurements" open) | Click Try it on | Under 30 seconds for the shopper |
| 3 | **Result** with the recommended size, per-point fit, confidence, and the size chart table with the size highlighted | Fill About you, continue | A size, the fit at each point, and your own chart |
| 4 | Product page after **Choose size 12**, the size selected in the theme's form | Choose the size on the result | The size is selected in your product form |
| 5 | Admin: **size chart builder** with the AU body template (8 to 16 ticked) and the body / garment radio | Embedded admin page on the dev store, chart step | Start from a sourced chart template |
| 6 | Admin: **bulk assign** preview by collection with the product count | Chart builder, assign step | Assign a chart to a whole collection at once |
| Optional | Admin: onboarding checklist, or the theme editor with the Try it on block selected | Embedded admin home / theme editor deep link | Add the block in the theme editor |

Do not show the privacy ledger, the deck, wardrobe or Style DNA (not part of the standalone plan), the hero render (opt-in, not in this plan), or the 3D garment viewer (D12, priced separately after Phase 0).

## Review submission (4.5.x)

- **Screencast (4.5.3):** install from the Shopify-owned install link → OAuth/managed install lands in the embedded admin → pick the AU template → assign to a collection → add the block from the deep link → open a product → Try it on → choose size → size selected → approve the subscription → uninstall.
- **Test credentials (4.5.4, 4.5.5):** none needed for the merchant side (Shopify login). The fit tool needs no account. [If a review store is supplied: store URL, staff account without 2FA.]
- **Instructions for the reviewer:** which products have charts assigned, which template was used, and that the camera scan is optional and runs on the device.

## How far from SmartSize (benchmark, read 2026-11-06)

SmartSize ("Smart Size Chart & Size Guide", https://apps.shopify.com/smartsize): 4.9 stars, 152 reviews, Built for Shopify, launched January 2022. Plans: Free (2 charts), Starter USD 9 (10 charts, multi-tab, fit scale, translations), Growth USD 12 (unlimited charts), Pro 100 USD 19 (AI "Find my size" quiz, 100 users per month). 10 listed languages, templates for men, women, kids, lingerie and pets, AI chart import from a screenshot, auto-placed button.

| | SmartSize | Curtain now | Gap to close before or after launch |
| --- | --- | --- | --- |
| Size chart table for shoppers | yes, the core product | yes, on the result screen, recommended size highlighted (`apps/web/src/embed/SizeChartTable.tsx`) | none |
| Size recommendation | AI quiz, top plan only | fit engine on-device, the one plan | none |
| Chart templates | men, women, kids, lingerie, pets | women's body AU / UK / EU / US, garment templates | men's and kids' templates (after launch) |
| Chart import | AI from screenshot | text import from the product description (one size) | screenshot import (after launch, optional) |
| Unit conversion | yes | cm / in in the builder and for shoppers | none |
| Button placement | automatic | theme app block, merchant adds it once (deep link) | an app embed block that places itself is optional; the deep link meets 5.1.3 |
| Languages | 10 listed | English (Dutch storefront strings) | more storefront locales; list English only |
| Free plan | yes | open (D17 is one paid plan) | founder decision |
| Reviews / Built for Shopify | 152 / yes | none / not yet | after launch; BFS needs installs and reviews |
| Privacy | not a selling point | measurements never leave the device | our differentiator |

Before the public listing, the blockers are in the checklist (expiring offline tokens, billing matching D17, live-store verification, real policy texts), not features.
