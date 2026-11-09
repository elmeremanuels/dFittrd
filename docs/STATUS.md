# Status — 2026-11-06

This is the integration snapshot after the parallel build and review passes. Read it with
`docs/DECISIONS.md` (why), `docs/ARCHITECTURE.md` (layout) and `docs/HANDOFF.md` (product truth).

## Go-live rehearsal of the server stack (branch `claude/golive-prod`) — 9 Nov 2026

The production path ran end to end on a simulated fresh Ubuntu 24.04 VPS (systemd, sshd, ufw, Docker from Docker's
repo) with the unchanged `infra/Caddyfile` and `docker-compose.yml`: bootstrap (idempotent, `--harden-ssh`), first
deploy (29 s), upgrade with a site release (14 s), automatic rollback of a broken release, an invalid Caddyfile refused
untouched, manual rollbacks, nightly backup from the cron line, restore drill passed, a real restore, restarts, a reboot
and a power cut (back in 4–5 s), 46 edge checks after each. Fixed: Docker Hub 429s no longer block a deploy;
`DOMAIN=app.curtain.fit` is refused; a refused site release build leaves nothing to publish. Refinement M3 closed.
Measured: idle RSS 100 MiB, under load < 0.8 GB with cache, disk < 5 GB; advice 2 vCPU / 2 GB / 40 GB, Sydney, IPv4
only at first. Details and what is still open: `docs/GOLIVE-REHEARSAL.md`.

## Garment engine — refinement R1, R3, R5, R6 on CPU (branch `claude/refine-cpu`) — 8 Nov 2026

No GPU. Stage 4t 0.5.0 (template fit 0.5.0) re-run on azure 17b, the skirt and the palazzo (17d) from their existing frames;
`report:bohohippychic --renders` re-run. Details and every table: `spikes/garment-engine/data/bohohippychic/phase0-written.md`,
"Refinement R1, R3, R5, R6 on CPU"; backlog status in `docs/REFINEMENT.md`.

| Item | Result |
|---|---|
| R1 azure flap/panel | Consistency 0.4.0's off-reference pixels (`phase0_garment.py --write-off-reference`) are left out of the fit and the bake, an evidence choice listed in `metrics.json` `offReference` and in the report (EXCLUDED, not UNCONFIRMED). Hem girth 157.7 → **151.8 cm** (run 15: 149.5); holdout mean unchanged (0.9119), holdout min 0.8747 → 0.8727 visible, 0.8264 → 0.8130 silhouette; on the 73 flagged frames, against the masks as segmented, 0.9023 → 0.8969 (the flap is no longer covered; 0.9121 with those pixels as don't care), the other 87 frames 0.9187 → 0.9236. Not confirmed by a clean draw (GPU part open). Stage 4t now refuses a job whose consistency check found off-reference spans but has no masks written (run `phase0_garment.py <job> --write-off-reference` first, or pass `--off-reference none`) |
| R6 bake | Two-band blend (layout from the views' consensus, half the detail of the most face-on view). Holdout MAE, old bake → new, same pixels scored: azure 20.76 → 19.29 (off-reference pixels unscored), skirt 29.21 → 27.51 (0.4.0 mesh, all pixels), **palazzo 29.72 → 26.98, below one flat colour (27.97)**. The gain (0.5) was chosen with the holdout in view, so it was re-scored on a split that played no part (index mod 5 = 4 left out of the bake): palazzo 26.96 against flat 28.01, azure 19.29 against old 20.74, skirt 27.22 against 28.75. Flagged: softer than one frame; palazzo PSNR still below flat colour (17.00 against 17.27 dB) |
| R5 palazzo | Legs no longer cross (20 → 0); one piece, 0 inside. The frames put the garment's crotch 2.75 / 3.5 cm below the body's; the mesh's join stays 6.5 cm below it, and 27 seat vertices pushed into the crease show as a stepped, boxy notch above the leg gap that does not connect to it (a light strip of the old crotch floor remains between them). Still faulty: that notch, texture seam at the join, the viewer's V fold |
| R3 skirt sizes | Investigated: grading is right, the drape folds 20 cm of graded hip spread into 5.4 cm and every size hangs from the same band. Viewer (both copies): a non-elastic band slides to where the body fills it, cloth stands on the floor. The skirt's band is elastic and its relaxed girth unmeasured, so it is not slid: **open** |
| Gates (this worktree) | `pnpm check` pass (a first run failed one fit-engine property test on its 5 s timeout while renders and stage 4t loaded the CPU; fit-engine untouched; passed on an idle machine, the timeout not changed); spike vitest 415 + viewer 57 (`--maxWorkers=2`); modal pytest 276 passed, 2 skipped; `pnpm demo:e2e` pass, both flows, azure and skirt 3D from this worktree's re-evaluated bundles |

Bundles: `out/eval/<handle>/` in this worktree (gitignored); `pnpm demo` reads them from the tree it runs in (or
`DEMO_AZURE_BUNDLE` / `DEMO_SKIRT_BUNDLE`). The main tree's `out/` was not touched. **Merge notes:** the off-reference
masks are gitignored job data and exist only in this worktree; in the main tree run `modal/phase0_garment.py <job>
--write-off-reference` (CPU) for azure and the skirt before stage 4t (stage 4t now refuses a job with off-reference spans
and no masks), then stage 4t, the report and copy the bundles.

## Release v1 + optional 3D estimate (branch `claude/plugin-v1`) — 8 Nov 2026

Release v1 unchanged, plus an opt-in **3D estimate** in the overlay for products with an approved
garment bundle. Operator guide: `docs/PLUGIN.md`. Not pushed, not deployed.

| Command (worktree, fresh `.demo-db`) | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` | pass (new workspace package `@curtain/garment-viewer`; `three@0.186.1` for it and apps/web) |
| `pnpm check` | pass: SDK 8,178 B gzip of 8,192 (untouched); viewer chunk 148.5 KB gzip of 400 KB, three.js in no other chunk, not precached; secret scan clean |
| `pnpm demo:e2e` | pass, both flows; aalter-studio-1 shows no 3D button (today's flow); 3D step on aalter-studio-2 (Woo, synthetic bundle) and on the azure babydoll (Dawn, evaluated bundle): drape settles, label says estimate and names the recommended size, after the click only GETs of code and the five `/assets/` files; 8 Nov: also the crimson maxi skirt (Dawn, evaluated bundle, live only flagged `low_rise_waist` and `precalibration_outside_tolerance`, checked in demo.json), drape settles, labelled an estimate |

Tests: schema 356, garment-viewer 47 (incl. parity with the spike), api 211, web 331, demo-shop 9; the rest as in the release run below.

What was added: `@curtain/schema` `GarmentAssetRef` + `checkGarmentBundle`, optional `asset` on
`GET /v1/try`; `packages/garment-viewer` (device modules forked from the spike, which is untouched;
takes the embed's FitResult, never recomputes a fit); api migration 0005 (`garment_assets`,
`products.active_asset_version`), `asset:import`, merchant approve/reject routes, `/assets/*` in demo
and dev; Caddy `/assets/*` from the `assets` volume, included in the backup; `embed/Garment3D.tsx`.

Gated: the shop switch `settings.garment3d` (off by default until D17 prices 3D), the merchant's
approval (D13), and the bundle covering the live chart. Founder-blocked as before (`docs/PLUGIN.md` §4),
plus: founder review of the azure and skirt bundles, the pilot merchant's approval, legal text for 3D. Not built
yet: the approval buttons in the Shopify checklist and the Woo console, and the approval preview page.

Import the founder's local azure bundle (stays `awaiting_approval`):
`pnpm --filter @curtain/api asset:import --shop <pilot>.myshopify.com --product azure-palm-baby-doll-dress --dir spikes/garment-engine/out/eval/azure-palm-baby-doll-dress`
(the product id is the shop's external id of that product).

## Release v1 (standalone plugin) — 6 Nov 2026

Goal: ship size advice **without** the 3D engine (D11, D17) to Shopify, first as a custom
(unlisted) app for the pilot shop bohohippychic.com.au (Australia, AUD, AU 8–16), then the public
App Store. Benchmark: SmartSize (size charts, chart templates, unit conversion, fit quiz, a button
next to the size selector). The 3D garment engine keeps being built on this branch in the
background (section below); nothing in the release depends on it.

### Verification run (6 Nov 2026, second review pass, repo root, demo stopped, `.demo-db` removed first)

| Command | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` | pass, lockfile up to date, no dependency changes |
| `pnpm check` | pass (build, typecheck, lint, tests, app builds, secret scan clean; SDK 8,178 B gzip of 8,192) |
| `pnpm demo:e2e` | pass, both flows (WooCommerce and Shopify Dawn), returning shopper and the size peek included (peek frame exactly 112 px, one `GET /v1/peek`, no try session) |

Tests: schema 351, shopify-app 165, api 203, web 324, sdk 102, fit-engine 111, taste-engine 95,
tryon-providers 70, anchors 53, mannequin 38, woocommerce-plugin 69 (PHP), demo-shop 8,
garment spike 219 + 47 (the spike is another workflow's; it passed in this run).

### Fixed in the second release review pass (P1, P2, B1–B4, C1, C2, T1)

| # | Finding | Fix | Test |
|---|---|---|---|
| P1 (high) | The size peek collapsed when no size fitted, so any script on the merchant page could frame `/embed/peek?product=<any id>` and bisect the shopper's measurements with one-size or narrow-chart products; every probe also minted and resolved a try session. | Once a remembered profile exists the peek always opens, at one fixed height, with a neutral "No size fits well" / "Can't recommend a size yet" line in the same box (`peekOutcome`, `apps/web/src/embed/peek.ts`). Expand/collapse now depends only on profile presence, the shop and the product. The lookup is the new read-only `GET /v1/peek` (`apps/api/src/routes/try.ts`): only for a device already paired with the shop and a product with status `active`. The SDK README's "one bit" paragraph now says exactly what that bit is. | `apps/web/src/embed/__tests__/peek.test.tsx` (P1: shown whether or not a size fits), `apps/api/src/peek.test.ts` |
| P2 (medium) | The peek posted its measured height on every resize, so the page could read the size label length and which note was picked by stepping the frame width. | `PEEK_HEIGHT = 112` posted once, never measured or re-posted; the box clips and every line is truncated to one line; the page body cannot scroll. The SDK accepts exactly 112 or collapses to 0 (`packages/sdk/src/peek.ts`). | `peek.test.tsx` (P1/P2, P2), `packages/sdk/src/peek.test.ts` (privacy P2), demo e2e (frame is 112 px) |
| B1 (high) | Uninstall then reinstall left the shop on `curtain`, unpaused, with no subscription (Shopify cancels on uninstall and the CANCELLED webhook never arrives); the admin showed "Subscribed" and disabled the button. | `app/uninstalled` sets `plan: 'free'`, clears `billingRef`, `subscriptionStatus`, `pendingSubscriptionId`, `legacyPlan` (keeps `trialStartedAt`); a reinstall starts from that state; every token exchange reconciles with `currentAppInstallation.activeSubscriptions` (`reconcileSubscription`, `apps/api/src/shopify/routes.ts`). A plan granted by hand (no Shopify `billingRef`, e.g. a free pilot) is never reconciled away. | `apps/api/src/shopify/billing.test.ts` (uninstall → reinstall → usage `free`, Subscribe offered; missed webhook; by-hand plan), `packages/shopify-app/src/adminCharts.test.ts` (plan button) |
| B2 (high) | Migration 0004 moved starter/pro shops to `curtain` while their old EUR 29/149 subscription kept charging; the admin showed "Curtain · US$8.99", Subscribed. | `GET /v1/merchant/usage` returns `plan.legacyPlan` and `switchVia` (and no `chargePrice`) while `settings.legacyPlan` is set. The Shopify admin shows "Retired plan (starter) at its old price" with an enabled **Switch to Curtain (US$8.99)**; the ACTIVE update of the new subscription ends the legacy state (Shopify replaces the old one on approval). WooCommerce: the console shows the same state with a **Switch to Curtain** button (`POST /v1/merchant/billing/stripe/checkout`, no trial); the completed Checkout cancels the old Stripe subscription (`StripeClient.cancelSubscription`). | `billing.test.ts` (legacy switch), `apps/api/src/stripe.test.ts` (Stripe switch, old subscription cancelled, never billed twice), `apps/web/src/merchant/plan.test.ts`, `adminCharts.test.ts` |
| B3 (medium) | The trial clock started when the subscription was created (PENDING), so a merchant who declined and came back a week later got no trial. | `trialStartedAt` is written on the first ACTIVE (`applySubscriptionUpdate`), never at subscribe time. | `billing.test.ts` (trial clock) |
| B4 (low) | WooCommerce got a full trial on every reconnect. | `/v1/merchant/woo/connect` passes `remainingTrialDays(...)`; the Stripe webhook records `trialStartedAt` on the first trialing/active subscription (Stripe's `trial_start` when sent). | `stripe.test.ts` (remaining trial) |
| C1 (medium) | Peek views were counted as abandoned try-on sessions and toward the k floor. | The peek no longer creates try sessions at all (`GET /v1/peek` is read-only), so analytics see only real button sessions. | `peek.test.ts`, `peek.test.tsx`, demo e2e |
| C2 (low) | Peek mints used the shop's SDK rate limit that real "Try it on" clicks need. | No mint; `GET /v1/peek` has its own per-IP limit (`peek-ip:`, `TRY_RATE_LIMIT_PER_MIN`). | `peek.test.ts` (six peeks, then the button's sessions still pass at `SDK_RATE_LIMIT_PER_MIN=3`) |
| T1 (low) | A terminal refresh failure discarded a still-valid access token. | Returns the current token while it is valid; the daily job counts a refresh as done only when a new token came back. | `apps/api/src/shopify/tokens.test.ts` |

### Fixed in the first release review pass (R1–R7)

| # | Finding | Fix | Test |
|---|---|---|---|
| R1 (high) | Every product of an AUD shop failed `GET /v1/try` with 422 `product_incomplete`: the Shopify mapper dropped non-EUR prices and `priceEur` is required. The pilot shop prices in AUD. | `priceToEur` (`packages/schema/src/mappings/common.ts`) converts with the EUR rate table and warns; both Shopify sync jobs pass `DEFAULT_EUR_RATES`; Woo takes the same option. Size advice no longer needs a price at all (R2). Listed as pilot blocker G1 in `docs/app-store/checklist.md`. | `packages/schema/src/sizeAdvice.test.ts` (AUD → `fromShopifyProduct` → `GarmentPayloadSchema`), `apps/api/src/pilot-size-advice.test.ts` (AUD → upsert → `/v1/sdk/sessions` → `/v1/try`) |
| R2 (high) | A chart assigned in the builder did not make a product try-able: fabric, pattern block and colour were also required, and only fabric had a UI. | New `sizeAdviceGarment` (`packages/schema/src/sizeAdvice.ts`): category + chart type + chart are required; price (0), colour (the shop's brand colour), pattern block (`unspecified` → fit-engine category defaults) and fabric (non-stretch woven, drape 0.5) default; present fields must still be valid. `GET /v1/try` uses it (`asTryGarment`, `apps/api/src/services/products.ts`). The app-mode try page hides a defaulted price, fabric and block. | same two files |
| R3 (medium) | Admin "Try-able / Needs data" and the checklist's "required" marks did not match what the try route accepts; flat-lay photos were demanded. | One predicate: the stored product status, `productChecklist().status` and the "required" marks all come from `sizeAdviceGarment` / `SIZE_ADVICE_FIELDS`. The flat-lay row only appears with `{ render: true }` (3D plan). Admin text now says what is really missing. `score`/`missingFields` stay the full completeness. | `packages/shopify-app/src/chartBuilder.test.ts`, `apps/api/src/pilot-size-advice.test.ts` |
| R4 (medium) | Production SSH key was a repository secret (readable by any branch's workflow, before approval); any branch could be deployed. | `.github/workflows/deploy.yml`: the guard reads no secret, allows only `release` and `main`, checks variables; the secret check runs first inside the `production` environment jobs. `docs/DEPLOY.md` §5: `VPS_*` are **environment** secrets, required reviewer and deployment branches `release`/`main` are mandatory. | YAML parse; the GitHub-side rules must be set by the founder |
| R5 (low) | The "Pick a template" step never completed for the default AU template, and a saved template was never restored. | `onboardingSteps` marks the step done once products have a chart; a successful assign saves the template; `loadOnboarding` restores the saved template before the AU default. | `chartBuilder.test.ts`, `adminCharts.test.ts`, `apps/api/src/shopify/charts.test.ts` (updated: it asserted the old behaviour) |
| R6 (low) | Switching "These numbers are" to garment silently turned a body template into a garment chart (one size too large). | The admin clears the body numbers on a body → garment switch and warns (switching back restores the template); `checkChart` warns when garment rows equal a body template (`bodyTemplateMatching`). | `adminCharts.test.ts`, `sizeAdvice.test.ts` |
| R7 (low) | Privacy policy said merchants see a per-shop pseudonym. | `docs/legal/privacy.md` (Security and the try-on session paragraph) and the app's pairing screen now say merchants see totals only; the pseudonym is internal (k-floor counting). | `apps/web/src/routes/legal.test.tsx` (renders the policy) |

### What is ready (code and tests, not yet on a live store)

- Shopper side: the "Try it on" theme app block (placed by the merchant, under the size picker on
  Dawn), the full-screen overlay with About you (metric or imperial), optional on-device scan, the
  size recommendation with per-point fit, the product's own size table with the size highlighted,
  "Choose size" selecting the variant on the page, remember me / forget me, and the size peek next
  to the button for returning shoppers (one fixed height, read-only lookup, never billed). No app
  install.
- Merchant side: embedded admin with five-step onboarding, AU/UK/EU/US women's body templates and
  garment templates, cm/in, bulk assign by collection, tag, type or picker, description import for
  one-size items, per-product checklist and preview link, usage and privacy ledger.
- A product is try-able as soon as a chart is assigned (R2), also in AUD (R1).
- Billing (D17, checklist B1): one flat plan "Curtain", USD 8.99 per 30 days through
  `appSubscriptionCreate` (one recurring line, no usage line), converted for the shop's billing
  currency (AUD for the pilot), 7-day trial (`BILLING_TRIAL_DAYS`) that starts on approval and is
  never handed out twice; decline, cancel, freeze, uninstall/reinstall and pre-D17 legacy shops are
  handled; WooCommerce the same through Stripe.
- Expiring offline tokens (checklist A3): token exchange asks for expiring tokens, refresh tokens are
  stored encrypted, refreshed before use and daily for dormant shops, never refreshed and exchanged
  at the same time.
- Backend: managed install and token exchange, GDPR webhooks, product sync and backfill, one-click
  VPS deploy with rollback, backups and a restore drill script (`docs/DEPLOY.md`), and the
  `shopify-deploy` workflow that renders the app config and runs `shopify app deploy`.

### Still blocking

| For | Item | Where |
|---|---|---|
| pilot | The live-store items in `packages/shopify-app/README.md` "Must be verified against a live store" (GraphQL `2026-10` queries, theme block on Dawn and the pilot theme, sync, billing in AUD incl. decline / reinstall, `activeSubscriptions` shape, GDPR deliveries). Nothing has run against a real store yet. | README, checklist B2, D2 |
| pilot | Founder accounts and settings below; legal review of the privacy policy enough to link it from the fit tool. | below, checklist C6 |
| public | Lighthouse impact measured (D5), privacy e2e in CI, listing screenshots and screencast, final privacy policy and terms. | checklist D5, E5, E6, F, C6, C7 |
| competitive | Versus SmartSize: no men / kids / lingerie / shoe templates, no screenshot import, no automatic button placement on every theme, admin in English only, no reviews or Built for Shopify badge yet. Where we are ahead: an actual size recommendation on every plan, from body or garment charts, without the shopper's measurements leaving the browser. | `packages/shopify-app/README.md` "Versus SmartSize" |

### What the founder must provide

1. **Shopify Partner account**, an app created manually in it (name `Curtain: Fit & Size Finder`,
   matching `shopify.app.toml`; trademark question in checklist E1), a development store for the dry
   run, and an emergency contact (`docs/DEPLOY.md` "Shopify app deploy", "Set once: Partner
   Dashboard").
2. **VPS** (2 vCPU / 4 GB is enough), bootstrapped with `scripts/deploy-bootstrap.sh`, and **DNS**
   `app.<domain>` and `api.<domain>` A/AAAA records to it (`docs/DEPLOY.md` §1–§4).
3. **Secrets, each in exactly one place** (never in the repository):

   | Name | Where | Value |
   |---|---|---|
   | `SHOPIFY_API_KEY` | `/etc/curtain/curtain.env` on the VPS **and** GitHub secret (for `shopify-deploy`) | the app's Client ID (Partner Dashboard → the app → Client credentials) |
   | `SHOPIFY_API_SECRET` | **only** `/etc/curtain/curtain.env` on the VPS, never GitHub | the app's Client secret (webhook HMAC, session tokens, token exchange) |
   | `SHOPIFY_CLI_PARTNERS_TOKEN` | GitHub secret (for `shopify-deploy`) | Partner Dashboard → Settings → CLI token; shortest expiry you will renew; it can deploy every app in the organisation |
   | `VPS_HOST`, `VPS_USER` (`deploy`), `VPS_SSH_KEY`, `VPS_SSH_KNOWN_HOSTS` | GitHub **environment** secrets of `production` (not repository secrets) | `docs/DEPLOY.md` §3 and §5 |
   | `ACME_EMAIL`, `BACKUP_AGE_RECIPIENT` (and optionally `BACKUP_RCLONE_REMOTE`) | `/etc/curtain/curtain.env` | `docs/DEPLOY.md` §4 |

4. **Variable**: repository variable `DOMAIN` = the bare domain (e.g. `curtain.fit`); optional
   `SHOPIFY_APP_HANDLE` (default `curtain`) and `VPS_PORT`.
5. **GitHub environment protection** (Settings → Environments):
   - `production`: **Required reviewers** = you; **Deployment branches** = `release` and `main`
     only; *Allow administrators to bypass* off. Required: it is the gate in front of the deploy key.
   - `shopify` (created by the first `shopify-deploy` run): before the pilot goes live add yourself
     as required reviewer and move `SHOPIFY_CLI_PARTNERS_TOKEN` and `SHOPIFY_API_KEY` there as
     environment secrets, then delete the repository secrets. Restrict its deployment branches to
     `release`/`main` once agents no longer deploy from `claude/**` branches (`docs/DEPLOY.md`
     "Harden").
6. **Prices**: D17 is built (USD 8.99 per month, flat). Confirm the trial length (default 7 days,
   `BILLING_TRIAL_DAYS` in `/etc/curtain/curtain.env`) and whether the pilot shop pays: a free pilot
   is `UPDATE shops SET plan = 'curtain' WHERE domain = '<shop>.myshopify.com'` with no
   `billing_ref` (the token-exchange reconcile never touches a plan granted by hand); otherwise the
   merchant subscribes in the admin.
7. **Legal review** of `docs/legal/privacy.md` and `docs/legal/terms.md`: legal entity, address,
   retention period for shopper records (C9), hosting region, subprocessors. Not legal advice.
8. Support e-mail and a help page for the listing; trademark clearance (D1) before the public listing.

### Install unlisted at the pilot shop, step by step

1. **Server**: `scripts/deploy-bootstrap.sh` on the VPS, fill `/etc/curtain/curtain.env`
   (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `ACME_EMAIL`, `BACKUP_AGE_RECIPIENT`; the bootstrap
   generated the database password and the JWT, pepper and encryption keys), set the GitHub
   `production` environment, its secrets and `DOMAIN` as above.
2. **Deploy the backend**: push to `release` (or Actions → deploy → branch `release` → `deploy`),
   approve the run, wait for `https://api.<domain>/healthz` to answer.
3. **Deploy the Shopify app**: run the `shopify-deploy` workflow on `release` (or push to `release`
   with a change under `packages/shopify-app`, `packages/sdk`, `packages/schema` or
   `.github/shopify/deploy.txt`). It renders `shopify.app.prod.toml` for `https://api.<domain>`,
   builds the theme block with the SDK and runs `shopify app deploy`, which publishes the block, the
   webhooks and the GDPR topics. Check the app URL in the Partner Dashboard is
   `https://api.<domain>/shopify/admin`.
4. **Dry run on a development store** with an AUD billing currency: install, open the app in the
   admin (token exchange), pick the AU template, assign it to a collection, add the block with the
   theme editor deep link, open a product, "Try it on", get a size, choose it, reload and see the
   size peek. Billing: Subscribe → approve (test charge), decline once, then uninstall and
   reinstall and check the admin offers Subscribe again. Work through the live-store verification
   list in `packages/shopify-app/README.md`.
5. **Custom distribution**: Partner Dashboard → the app → Distribution → *Custom distribution* →
   the pilot shop's `*.myshopify.com` domain (not `bohohippychic.com.au`) → generate the install
   link (irreversible for that app; one custom app per shop).
6. **Merchant install**: the owner opens the link while logged in to their store admin, approves
   the scopes (`read_products`, `write_products`) and lands in the Curtain admin. The catalogue
   backfill starts on its own.
7. **Setup in the admin (about 10 minutes)**: keep the preselected AU template, untick sizes the shop
   does not sell (keep 8–16), assign it to the Dresses (and Tops) collections, click "Add the block"
   (theme editor deep link), place it under the size picker, save the theme. Paid pilot: Subscribe
   and approve (AUD, about A$13.80); free pilot: the founder grants the plan by hand (founder step 6).
8. **Test**: open a dress on the live shop, "Try it on", enter height and weight, get a size, choose
   it, check the size is selected on the page and the admin shows the session. Reload: the size
   peek shows the size next to the button. Then mark "Test it on a product" done.
9. **Watch the first week**: usage and anomalies in the admin, `docker compose logs api` on the VPS,
   the nightly backup and one restore drill.
10. **Public listing later**: Lighthouse (D5), the legal review and the listing assets, then a
    (new) app with public distribution and submit (`docs/app-store/checklist.md`).

## Garment engine — run 15: five products, two good assets (7 Nov 2026)

Modal run 15 (GitHub Actions 42402554810, code at 91ed5b2) put all five Bohohippychic products through
stage 1b → 2 → 4. Reviewed by eye (`spikes/garment-engine/data/bohohippychic/review.json`): **azure babydoll
accepted; crimson maxi skirt `faulty`: evaluated and rendered, but off the blind page and not a panel bundle (narrow at the hips)** (the founder: "see the hips"); **blouse and cardigan rejected** (FASHN stills torn / a bolero, black panels in
the frames; stage 2 ran only because `--accept-failed-dress` overrides silhouette and fidelity failures),
**palazzo stopped before stage 2** by the type gate (FASHN drew a closed skirt). GPU: 6,295 s, $6.66–6.93
(estimate), of which $3.29–3.40 on the two rejected products; runs 10–15: 12,943 GPU s, $13.55–14.45. Details,
every render: [`docs/research/phase0-bohohippychic.md`](research/phase0-bohohippychic.md) ("Run 15").

Stage 4t and the drape log ran on both good products (CPU, 82–92 s each). Measured (stage 4t, same tooling):

| | Azure run 15 | Azure run 14 | Skirt run 15 |
| --- | --- | --- | --- |
| Critical girth before calibration | chest 101.27 vs 102 (−0.73) | 101.15 (−0.85) | waist: no girth (band below the waist ring, open 5.8 cm at one side; bridged 94.23 vs 80.5) |
| Length | flat-lay 90.12 vs printed 91 | 92.54 | waist to hem 91.63 (nothing printed) |
| Hem line above the floor | 57.35 cm | 55.46 (run 15 is 1.9 cm higher) | 4.16 (floor-length) |
| Stills IoU visible front / back | 0.889 / 0.938 | 0.904 / 0.933 | 0.894 / 0.891 |
| Holdout IoU visible / silhouette | 0.918 / 0.899 | 0.901 / 0.884 | 0.915 / 0.883 |
| Inside the mannequin | 0 of 5,661 (2DGS 24.7 %) | 0 | 0 of 6,250 (2DGS 17.5 %) |
| Hip | not fitted (+2.88) | | no girth: open at both sides (10.2 cm at the left, 92 → 70 cm; 7.8 cm at the right, 92 → 86 cm); bridged 107.65 vs the chart's 109 (−1.35) |

Shadow mode, P0 against the measured mesh (first real comparisons): azure run 15 hem height +0.08 cm, flat-lay
length −1.02 cm, flare 1.35 → 1.325, underbust ease +9.0 cm, sleeves 0 → 32.5 cm (4.1 σ), Chamfer 1.67 cm;
4 of 5 informative rows within 1.28 σ. Skirt: hem height −7.24 cm (P0's maxi stops above the ankle, FASHN drew it
to the floor), hem girth −18.5 %, flare not measurable, Chamfer 1.40 cm. Run 14 re-logged: hem −1.81 cm, Chamfer 2.03.

**The skirt's hips, measured** (`src/bottomOpenings.ts`, in the report): FASHN's stage 1b stills are narrower than our mannequin
on the hip row (34.75 / 35.59 cm against 37.55 cm, front / back), so our grey hip shows 1–2 cm outside the skirt on
both sides; the video opens a slit from the band to 63–65 cm above the floor at the left (up to 10.6 cm across) and a
narrower one at the right; stage 4t keeps the cloth outside the body and carves those openings (nothing filled from the
template). The 3D skirt is not too small (bridged hip −1.35 cm against the chart + ease) and nowhere inside the
mannequin: it is open. The cause is stage 1b, not stages 2–4t; the skirt is not fit for the panel.

Fixed at the cause on the skirt: (1) the stage 4t hem scan ended a column at the generated side opening under the
waistband and interpolated a slit up the side (`runEnd` with `OPENING`; holdout visible 0.905 → 0.915; azure
refitted identically); (2) no waist girth because the band is worn 2.6–10.8 cm below our waist ring and tilted
(`src/waistband.ts`: the band measured on its own plane, report only, never calibrated); (3) in the viewer the skirt
slid down the legs because only the top 4 cm under its highest point were pinned (`waistbandPins`: the band under its
own plane); (4) the drape log's hem girth slice now moves up until the cloth closes; the report and viewer captions
follow the category for bottoms. The report also evaluates earlier runs kept as `out/phase0/<handle>-run<N>/`
(run 14 next to run 15, stacked comparison pictures) and marks rejected products (evaluated, not rendered, off the
blind page). Chart agreement: 1 of 2 good products passes (azure); the skirt has neither a waist nor a hip girth (open), so it fails.
The panel stays on hold (1 of 5 panel bundles: the skirt's bundle is kept for evaluation only, verdict `faulty`). Next: stage 1b is the bottleneck (3 of 5 failed there); stop
spending stage 2 on stills a person or the QA rejects.

## Garment engine — first real asset (run 14)

Bohohippychic `azure-palm-baby-doll-dress`, job `azure-palm-baby-doll-dress-6d2f2611a144`:
stage 1b FASHN on the proxy-dressed mannequin (QA overridden), stage 2 Wan2.2-Fun-A14B-Control
with the proxy control, stage 4 gsplat 2DGS on the stage 2 garment masks, and since 7 Nov stage 4t
(CPU template fit + texture bake, branch `claude/garment-engine-template-fit-wip`), which is now the
evaluated asset. Full write-up, every render and the runs 10–14 timeline:
[`docs/research/phase0-bohohippychic.md`](research/phase0-bohohippychic.md) ("Template fit"
section; renders under `spikes/garment-engine/out/eval/`, gitignored: the links resolve only in a
checkout where run 14's outputs are in `out/phase0/` and `report:bohohippychic -- --renders` has run).

**Run 15 and stage 1b QA 0.7.0 (7 Nov).** Run 15 (one product per category, FASHN, `--accept-failed-dress`):
azure dress looks right; the maxi skirt's waistband and print are right but it is narrower than our hips (0.8.0
below); the blouse and cardigan stills were torn or shrunken and still cost
about $1.64 and $1.65 of stage 2 (whose black panels come from those stills, not from stage 2); the palazzo
was stopped by the merged-legs check (~$0.03). Causes and fixes (`spikes/garment-engine/modal/README.md`,
"Stage 1b after run 15"): the composite pasted a difference mask that lost the blouse's cream ground (the
proxy's beige) → a colour-model composite mask; holes in the shop photo's SAM 2 mask became FASHN's grey
127 sleeves → mask closing and hole fill; the trouser edit region closed the palazzo's 6 px leg gap → a
20 px strip kept open and visible to FASHN. New type checks (see-through, body too short, front/back of
different garments; merged legs on what the engine drew) stop such stills before stage 2 even with
`--accept-failed-dress`; replayed on run 15 they stop blouse and cardigan and pass azure.
The cardigan front (a cropped open cardigan over a drawn midriff) is not fixed. **0.8.0, the skirt's hips**
(founder's review: "see the hips"): FASHN's grey box hides our hips, so it draws the skirt on a slimmer body of its
own; pasted on our render, our hips show beside it (front row 428: garment 176-306, our hips 170-309, proxy
165-314) and the video opened a side slit. The hips of a skirt or dress are now stretched to the proxy's width
(`conform_to_proxy`; replay: 64/64 and 92/94 short rows → 0, max stretch 1.14), and "narrow at the hips" is a new
type check (replay: stops the skirt in both views, passes azure). **0.9.0** (review of 0.8.0): the
replay now rebuilds the composite as the GPU app does (`--path app`, default); on that path the blouse passes, so the
earlier "stops the blouse" held only for run 15's pasted masks. Composite fixes seen on the stills: a notch cut into the
blouse's front hem (the shirt-tail below the proxy was never pasted), white background slivers pasted down our legs
under run 14's azure (also the cause of a 27/109 leg gap), FASHN's floor under the palazzo hem; a new type check for
cloth drawn but not pasted (blouse notch 0.014, controls ≤ 0.003); trousers conformed above the crotch; the conform
ramps in at the waistband (a squared-off shelf before); print fidelity's edge ratio floor 0.35 → 0.5 (the blouse's
washed-out back, 0.400). Replay on the app path: azure (runs 14 and 15) passes; skirt passes the type checks (front
fails only the provisional torso cover); blouse front passes, back fails print fidelity; cardigan and palazzo stopped.
Run 16a (8 Nov, stage 1b only, QA 0.9.0): five reviews of the stills found defects QA passed. **0.10.0**
(`spikes/garment-engine/modal/README.md`, "Stage 1b after run 16a"; CPU replay of run 16a's raw outputs, no GPU):
our code caused the palazzo's leg holes (the mannequin colour test applied off our body; now on the body only, and holes
off it are counted), azure's grey shoulder caps (present in runs 14-16a, never flagged; the engines draw narrower
shoulders than our mannequin: `conform_edges` stretches the garment's outer band over our body, and what is left is a
new type check), the palazzo's yoke shelf (the trouser conform to the proxy's stepped hip block: removed, plus a shelf
check), the mixed-engine palazzo pair (the back now prefers the front's engine) and the blouse's inflated mask. New
checks for what the engines drew: a crotch split far above the proxy's, a waistband at another height front and back
(type), front and back of different colours, sleeves swapped against the shop photo (hard). Replayed: azure passes
(runs 14, 15, 16a), the palazzo passes with Qwen for both views (holes 752 → 24 px, no shelf, crotch on the proxy's
line); skirt (front waist 40 px low), blouse (back colour) and cardigan (shoulder band, swapped back sleeves) are
stopped. `run_phase0.py --recompose-dress --dress-pin ...` re-makes the stills on CPU from the raw outputs the jobs
Volume keeps, so run 16b's stage 2 pins the reviewed stills (not tested against Modal). Run 16b (proposed): azure
(FASHN) and palazzo (Qwen) end to end, about $3.2-3.4 (at most about $3.5); skirt front, blouse and cardigan need another stage 1b attempt.
Review of 0.10.0 → **0.10.1**: the palazzo's recomposed stills still showed our grey thighs in a rectangular notch at the
crotch (the trouser gap strip, out of the edit region, was never pasted, though Qwen drew cloth there: front 715, back
657 px), and QA passed it. The composite now pastes the engine's cloth in the strip (and its own background gap's edge),
and a new type check fails our body left in it (> 40 px at 832; Qwen 0 / 0 px after, FASHN 704 / 696). `--dress-expect`
pins each recomposed still by the hash of its decoded pixels (identical with numpy 2.2.6 as in the Modal image). The
failure text for "our mannequin beside" no longer blames shoulder caps; the reuse options are checked before the upload.
Run 16b (proposed): **azure only**, about $1.6-1.7; the palazzo (passes 0.10.1) waits for the founder's sign-off on Qwen's
invented pockets and darker print.
Run 17a prep → **0.11.0** + Qwen prompt 0.2.0 (README, "Stage 1b for run 17a"; not run on a GPU): two causes of the open
products were our Qwen input and are fixed. The cardigan back was told "no closed pullover, no high round neckline",
exactly what its shop back shows, and nothing said each sleeve keeps its side. The blouse's two views named different
colours ("cream" / "peach", shop cut-outs 4.7 apart): one phrase now names both when the cut-outs are one colour. The
rest is how the engines drew (the skirt's low front waist, the blouse's 0.0003 torso-cover miss), so 17a draws more:
a draw plan runs several seeds of both engines per view in one container, can KEEP a view from the earlier run (the
skirt's good FASHN back, re-scored with the current QA, never redrawn), and picks the front/back pair only when the
pair checks already in the app (back view, view agreement incl. the waistband, view colour) pass. No threshold changed.
Every stage 1b run now moves the earlier `stage1b/` into `stage1b/history/` (no stale candidates). Replayed on run 16a
on CPU: every 0.10.1 verdict holds, and azure's and the palazzo's finalized stills are pixel-identical to the reviewed
16b hashes; a smoke run with stub models ran every line of the new GPU path. Run 17a (proposed, stage 1b only): skirt,
blouse and cardigan, about $1.0-1.2 (at most about $1.5); the blouse and cardigan keep run 16a's Qwen fronts (their failures are the proxy's), every keep names its seed, and the cardigan line is a diagnostic of the 0.2.0 back prompt. Expected to stay open and flagged: the uncovered shoulder caps
of our proxy, the blouse proxy shorter than the garment, the fitted outerwear proxy against an oversized knit (all
exporter changes with new job ids: the founder's decision).

**Run 16b (8 Nov, azure: stage 2 + 4 on run 16a's stills recomposed with QA 0.10.1), evaluated like run 15**
(`spikes/garment-engine/data/bohohippychic/phase0-written.md`, "Run 16b"; stage 4t, drape log, report with renders,
side-by-side pictures against run 15 in `out/eval/azure-palm-baby-doll-dress/compare/`, gitignored). No grey cap above
the sleeves in the stills or in any turntable frame (grey shoulder pixels per frame 357 → 78, the rest at the neck edge;
stage 4t's cap texels sampled from frames 47.5 % → 79.8 %, so run 15's asset had synthesized most of its cap print); no
black panels or flicker; consistency flags 31 of 243 frames (run 15: 41). Same chest (101.26 cm, −0.74 against 102; run 15
−0.73) and graded table; texture holdout MAE 20.65 (21.86). Mixed: pinned stills 0.901 / 0.924 (0.889 / 0.938). Worse:
holdout IoU 0.9127 / 0.8956 (0.9176 / 0.8986), turntable IoU at 90° and 180°; two new visible defects. (1) QA 0.10.1's
recompose grows the garment mask along the whole outline, not only at the caps, and keeps a cream tail below the hem of
the back still (missed in the still review); stage 2 grows it into a plain cream, unprinted flap swinging out at one side
of the hem in turntable_b frames about 84-159 (half the turn, up to ~10 cm), which stage 4t fits (hem girth 155.9 against
149.5 cm, hem line 56.46 against 57.35 cm, flat-lay 89.79 against 89.98 / printed 91, P0 shadow Chamfer 1.871 against
1.672 cm, skirt region 1.06 against 0.70). Fix in stage 1b: limit `conform_edges` to the cap rows or trim hanging hem
fragments in QA. (2) A translucent lower skirt with the grey leg showing through and ragged tips in turntable_a frames
about 32-56 (stage 2; most of the holdout IoU loss is in frames 40-80). Also 2 vertices 3.3 mm from the mannequin
(clearance 4 mm). Run 16b is now the azure panel bundle (`review.json`), all of these flagged, not repaired; the AU 8
back-shoulder patch and the straight side view remain. Panel still on hold (1 of 5 bundles). GPU 1,503 s, $1.59-1.62 for
stages 2 + 4 only (stage 1b ran in run 16a: 34.6 s, about $0.04; run 15's 1,576 s include its stage 1b).

**Run 17a (8 Nov, stage 1b only, draw plans, QA 0.11.0) and QA 0.12.0** (`spikes/garment-engine/modal/README.md`,
"Stage 1b after run 16b and run 17a"; CPU only, no GPU). Run 16b's cream hem flap starts in stage 1b, but not in
`conform_edges`, which only touched rows 221-460. FASHN drew a cut tie string below azure's back hem.
`still_garment_mask`'s 0.9.0 outside-the-proxy step (made for the blouse's shirt-tail) pasted it, and QA had no check
below the hem. **0.12.0** leaves at most a few thin strings hanging below the hem outside the proxy out of the paste (only
our bare render shows there; nothing painted), and a new type check fails any thin piece left hanging (a fringe is never
trimmed, only flagged). Replayed on 41 candidate stills (azure 14/15/16a, palazzo 16a, skirt, blouse and cardigan 17a): 3
change. The azure back loses the 49 px string (pixel hash `c3e193ed…`, front `d4cbc556…` unchanged). Run 15's back and a
broken blouse front change in grey only. A trim is never silent: it is a warning on the still's QA and in the stage 1b
summary, and is printed. The check also finds two thin dark pieces (a string or a leg-shadow sliver) under run 14's azure,
which runs 14-16b passed unseen. Skirt: run 17a has an eligible pair (front FASHN seed 44, its waistband at row 361 and the grey belly gone; the 16a
back kept), but the pair disagrees twice by eye: the kept back has no pink smocked waistband (the front and the shop back
have one; no check measures the band), and the smocked tier seam sits about 38 px (about 10 cm) higher on the back than on
the front, which stage 2 would have to join. The back with a matching seam (seed 44) misses torso cover (0.9156 < 0.92). The next step is more FASHN
backs (about $0.1-0.2) before $1.6 end to end. Blouse: a FASHN front passes now. Every back fails: FASHN loses the print
and draws a front neckline; Qwen draws the shirt-tail past the proxy's hem. Next step: a longer blouse proxy (exporter,
founder's call). Cardigan: the 0.2.0 back prompt removed the button and argyle, but all 4 backs still swap the sleeve
colours. Parked until the founder decides on the oversized outerwear proxy. Run 17b (proposed): azure end to end again from
its 16a raw with 0.12.0 (about $1.6-1.7) and the skirt's extra backs. turntable_a is pinned to the back still at its last
frame, and 16b's turntable_a shows the string too (frames 40-80); whether the see-through panel in frames 32-56 goes with it
is what 17b tests (the front still is unchanged).

**Run 17b (8 Nov, azure: stage 2 + 4 again on run 16a's stills recomposed with QA 0.12.0; skirt: 8 more FASHN backs)**,
evaluated like run 16b (`spikes/garment-engine/data/bohohippychic/phase0-written.md`, "Run 17b"; stage 4t, drape log,
report with renders, which now lists run 16b as an earlier run; side by side pictures of runs 15 / 16b / 17b in
`out/eval/azure-palm-baby-doll-dress/compare/run15-16b-17b-*.png` and `run16b-vs-current-*.png`, gitignored). With the cut
string gone from the back still, the see-through lower skirt with the grey leg through (turntable_a 32-56) and the strings
(40-80) are gone. **The cream flap in turntable_b 82-155 is not**: same width per frame as in 16b (within 1-4 px), so the
string did not seed it. **New:** a flat, hard-edged pale rectangle beside the hem in turntable_a 13-31 (up to ~10 cm at frame
28; fainter also at the right at about 20-28), fully detached from the skirt at frame 30 (gap up to 18 px) and gone in one
frame at 31 (a local 41-51 px jump; no global flicker). Hem girth 157.7 cm (16b 155.9, run 15 149.5), P0 skirt Chamfer 1.13 cm (1.06, 0.70); holdout IoU 0.9119 / 0.8951, level
with 16b (0.9127 / 0.8956); chest 101.50 cm (−0.50; 16b −0.74); flat-lay 90.00 (16b 89.79, printed 91); shoulders as 16b;
2 vertices 3.2 mm from the mannequin. Run 17b replaces 16b as the azure panel bundle, accepted pending founder review: a judgement
call between two different visible defects (16b: grey leg through a see-through lower skirt plus strings; 17b: the floating
flat panel), neither panel-clean, the founder chooses; its flap and panel flagged in `review.json` and `panel-hold.txt`, not
repaired. What still differs from run 15's stills (whose frames had only small flaps) is the hem: the 0.10.1+ composite
adds about 220-250 px per view in the hem rows and a corner at the flap's side of the back hem; untested. GPU 1,464 s,
$1.54-1.57. **Skirt:** 5 of 9 backs pair with the front fashn@44 (auto-pick 49), but by eye none has the front's pale pink
smocked waistband and a clean hem: back 49 has the tier seam exactly where the front's is (row 590 against 593) but a red
gathered band and a hem 14-66 px wider than the front's over rows 665-715 (stage 2 may grow it into side flaps as in azure); back 50 has the pale band and the seam (585) but a dark strip hanging below the hem between the feet, 16-18 px
wide (not thin, so QA 0.12.0 neither trims nor fails it); 46 a slit with the grey leg above the hem; 43 and 47 no band. No
pair pinned. On copies of the artifact, `--recompose-dress --dress-pin front=fashn@44,back=fashn@49` resolves in 17b's
`stage1b/` and reproduces `8909a1c0…` / `ec73328e…` (numpy 2.2.6 and 2.5.3 alike); 17a-only candidates cannot be pinned
(only kept from `history/`). Run 17c's stopping rule: if none of its 16 backs passes, a founder decision on 49 or a change to
the waistband conditioning, not more seeds. 66 GPU s, $0.07-0.18. Panel still on hold (1 of 5 bundles).

**Run 17d (8 Nov, stage 2 + 4 for the maxi skirt, front fashn@44 + back fashn@63 from run 17c, and the palazzo, run 16a's
Qwen front + back approved by the founder; both recomposed with QA 0.12.0)**, evaluated like azure
(`spikes/garment-engine/data/bohohippychic/phase0-written.md`, "Run 17d": stage 4t, `predict:log`, consistency re-score,
report with renders; every render and all 160 turntable frames of each looked at). The CPU consistency re-score
(`phase0_garment.py --score`, `stage2/consistency_v2.json`) now reaches the report (`src/evalJob.ts`
`withRescoredConsistency`, used only when its version is at least the GPU record's and it is not older than the record);
on both 17d jobs it equals the GPU check (already 0.4.0), so nothing changes there. The jobs Modal scored 0.3.0 were
re-scored with 0.4.0 on CPU: **azure 17b (the accepted bundle) now shows its hem flaps in the report as off-reference
spans, turntable_a j19-30 (up to 2,249 px) and turntable_b j18-78 (frames 98-158, up to 1,237 px), 89 / 243 frames
flagged (0.3.0: 30), so its hem girth reads UNCONFIRMED**; also azure 16b, 15, 14, the skirt's run 15, blouse and
cardigan. The stage table also lists frames flagged for other reasons, by reason and clip. **Skirt: the hips are closed** (no grey hip beside the
skirt in any front or back frame, at most 3 px against run 15's up to 1,356 px; no opening wider than 4 cm in the asset,
run 15 10.2 and 7.8 cm); hip 110.35 cm against 109 (+1.35); holdout IoU 0.947 (run 15 0.915). Open, flagged: the band sits
4.0 cm below our waist ring, so there is no chart girth at the waist (on the band 88.07 against 80.5, uncalibrated): chart
agreement fails and **the plugin's import gate refuses the bundle (`qa_failed`), so it is not in the demo shop**; the hem
is drawn over the feet (red round both feet in turntable_b 85-159; hem 2.2 cm above the floor, pinched to 86 cm, foot
lobes in the viewer); short-lived pale side panels and a flat tongue on the floor in turntable_b 81-94 and a hem flare in
turntable_a 1-14 (consistency 0.4.0 off-reference up to 1,928 px, hem girth unconfirmed); smeared print; sizes differ only a
little; the turntable_a 15-25 frames flagged only for skirt cover (11 of 41) are a normal rotation, looked at. Verdict:
**faulty, pending a founder decision** on the low band (first written as accepted; a bundle the plugin's import gate
refuses is not a panel bundle, and the report's `forPanel` now enforces that). **Palazzo: two legs in every turntable
frame** (touching to a seam line over up to 65 % of the leg rows in a 75-76 and b 155-156, flagged), chart pass (waist +3.18 cm before calibration, +1.30 after the
global scale; hip +1.83), outseam 102.51 against the printed 99, inseam 73.59, holdout IoU 0.970; but in the viewer the
seat and leg tubes (separate, not stitched) part in the drape and **our grey thighs show between them at every size**, grey
shin slivers show through slits low in the legs (three-quarter and side, every size), 1 vertex inside the mannequin, and
the baked print is a patchwork (holdout MAE 29.1, worse than one colour, 27.6). Verdict: **faulty**; next on CPU: stitch or
pin the leg tubes, re-bake, check the thigh band and the lower-leg slits. GPU 1,568 s ($1.61-1.63) + 1,469 s ($1.56-1.58). Panel still on hold (1 of 5 bundles, azure, pending
founder review).

**Run 17d on CPU (8 Nov, no GPU; `phase0-written.md`, "Run 17d on CPU").** **Palazzo:** stage 4t **0.4.0** sews the
trousers into one piece: the legs start at the join (`trouserJoinHeight`, 69.94 cm, the highest level below the crotch
where the mannequin's thighs are apart; 0.3.0 started them 2 cm above the crotch, 36 rays blocked by the other thigh, a
hole at each inseam top and 1 vertex inside) and `stitchTrousers` zips the seat's last ring to the legs' outer arcs and the
inner arcs to each other (the crotch), from fitted vertices only: 1 component, 3 boundary loops, Euler −1, 0 vertices
inside (closest 4.39 mm). The patchwork's cause was a chart overlap (the seat used the dress's body chart, over the top two
thirds of both leg charts); trousers now have their own seat, join and leg charts. The viewer pins the top 3 cm of any loose
piece of a bottom (`LOOSE_TOP_PIN_CM`, both viewer copies, parity test). Every render: no grey thighs and no shin slivers at
any size or body. Still **faulty**: holdout texture MAE 29.72 against one colour's 27.97 (worst at the side views; more
blending only ties it, a blur: the frames disagree on the print), a light hard-edged triangle at the crotch from the front
and a V fold between the legs. What the join costs: the garment's crotch is 6.5 cm below the body's (a deeper rise than the
product; the seat is one tube round both thighs from 69.94 to 76.44 cm), closed by a flat floor of band triangles that no
mask saw (the light triangle; 31 band triangles have an edge over 8 cm, up to 19.4 cm); the leg tubes cross each other
from 69.4 down to 64.9 cm (`fit.join.legOverlap`, not repaired); the inseam 73.53 cm includes a 6.96 cm straight bridge
up to the crotch point, the cloth inner leg alone is 66.57 cm. The thigh ring now lies above the join (the seat round both thighs): reported as the seat,
not calibrated, graded or used by the drape log. Azure and the skirt re-run with 0.4.0: identical texture, IoU, clearance
and mesh. **Skirt:** the chart's waist is our AU *body* chart's natural waist (the shop prints no garment chart). Option a,
"low-rise", exists behind a founder switch that is **not set** (`review.json` `waistReading`, `src/lowRise.ts`): the band
read where it sits (4.76 cm below the waist ring) against chart + ease + the mannequin's own widening there (+5.08 cm):
88.07 against 85.58: it still misses the chart by +2.49 cm before calibration (outside ±2); the pass after calibration
(global scale 0.972) is automatic, because the waist is the skirt's only critical point; written into `qa.json`
(`chartAgreement.waistReading`), and the import gate accepts it only with a recorded decision and flags it
`low_rise_waist` (`qaFlags`, returned in the merchant asset API; no admin screen shows it yet). Option b: new stills with the band at the waist (GPU). The
hem over the feet is in the stills (the front still's hem reaches the bottom of the feet), not the fit. The skirt stays
**faulty**. Panel still on hold (1 of 5 bundles).

**Skirt: the founder chose option A, low-rise (8 Nov, CPU; `phase0-written.md`, "The founder's decision on the skirt").**
`review.json` now records `"waistReading": { "kind": "low-rise", "decision": "founder Elmer Emanuels, 2026-11-08, option A (chat)" }`
and `report:bohohippychic -- --renders` was re-run. The report, `qa.json` and the eval warning show the reading: band 4.76 cm
below our waist ring, chart waist 80.5 cm + body offset +5.08 cm = 85.58 cm, band 88.07 cm: **still +2.49 cm off before
calibration (outside ±2)**; the pass after calibration (+0.01) is **automatic** (the waist is the only critical point) and
makes the skirt **2.8 % narrower** (global scale 0.972, hip +1.35 → −1.77). The import gate accepts the real bundle with
`qaFlags: ["low_rise_waist", "precalibration_outside_tolerance"]` (the second flag added after review, below). **Verdict: accepted pending founder review, as azure**; the decision covers the waist reading
only, so these stay flagged, not repaired: the hem drawn over the feet (from the stills: foot lobes and grey toes below
the hem), short stage 2 hem flaps and panels (turntable_b 81-94, turntable_a 1-14; hem girth unconfirmed), the smeared
print, and AU 8 / 12 / 16 barely differing in the viewer (the weakest point for a size panel; the founder may still
downgrade it). **Panel still on hold: 2 of 5 bundles** (azure, skirt), 4 needed. **Demo shop:** the skirt is a second 3D
product on the Dawn page (`/products/crimson-wildflower-maxi-skirt`; local gitignored bundle, `DEMO_SKIRT_BUNDLE`, skipped
when absent; its texture is shop-derived and stays local). The demo seed approves a bundle only when the import gate passes
it with exactly the expected QA flags (`low_rise_waist` and `precalibration_outside_tolerance` for the skirt, none for the others); a refused or differently
flagged bundle leaves the product without 3D and the demo starts anyway (the earlier attempt crashed on `qa_failed`; test
in `apps/api/src/demoSeed.test.ts`). `pnpm demo:e2e` checks the skirt's flags in demo.json and its estimate label.
After review (8 Nov): the import gate also flags `precalibration_outside_tolerance` whenever `qa.json` has
`beforeCalibrationMaxAbsCm` above `toleranceCm` (so a single-anchor automatic pass never looks clean, and the skirt with its
`waistReading` stripped would still import flagged); the merchant asset API now returns a plain sentence per flag
(`qaNotes`, `garmentQaFlagNote`). Still open: no approval screen shows the flags (the demo seed approves for the merchant),
the shopper's 3D view shows only the general estimate label, and the gate cannot yet refuse a bottom whose band sits below
the waist ring without a `waistReading` (that needs the band height in every bottom's `qa.json`). The founder has still to
confirm "accepted pending founder review" and the skirt's place on the blind page and in the panel after viewing the renders.

**Stage 2 faster (branch `claude/stage2-fast`, 8 Nov, code only, not run on a GPU; `modal/README.md`, "Stage 2 in
parallel, motion opt-in").** Founder-approved: the motion clip is now opt-in (`--motion`; stage 4 and stage 4t never used
it) and the two turntable clips run in two H100 containers at once (`stage2_video.generate_clip`, then `assemble` on CPU;
`stage2-parallel-0.1.0`). Same seeds per clip (43 / 44, motion 45), same stills, prompts and control; the input hash and
the job ids do not change, so `--recompose-dress` / `--dress-expect` and the jobs Volume are reused as before. A failed clip
stops the run before stage 4 (`complete: false`, `stopped_after_stage2`; no half turntable; stale `stage2/frames` and
`garment_mask` removed); the clip that finished stays in the Volume. Cost rows per container (each pays its own model
load). **Estimate from run 17d's timings:** stage 2 about 930–960 GPU s, **$1.02–1.05** (was 1,375–1,382 s, $1.51–1.52)
and about **8–8.5 min wall** (was 23 min); a whole product about 15 min faster. Bit-identical frames to run 17d are not
promised (fresh pipeline per clip; Modal may hand out an H200, as for 17d's skirt). Tests: `modal/tests/test_stage2_parallel.py`
(mocked Modal calls), `evalReport.test.ts` (report without motion, per-container costs, incomplete stage 2). After review: a failed `assemble` writes this run's record over the
Volume's older one locally and removes the stale frames (the report also reads `stopped_after_stage2`); a failed `--motion`
clip no longer discards a good turntable (stage 4 runs, the record says `complete: false`); the clip containers get a
40-minute timeout (`CURTAIN_MODAL_TIMEOUT_CLIP`, was 3 h); clips on different GPU types are recorded (`gpu_mismatch`) and
flagged in the report (`H100!` pins the type). The $1.02–1.05 estimate is GPU only: memory reservations (128 GiB per
container, about $0.3 per product, was about $0.43) come on top, and running in parallel costs one extra cold start
plus model load (about 30 s, $0.03).

**Stage 4t** (`spikes/garment-engine/src/templateFit.ts`, `bake.ts`, `stage4t.ts`;
`pnpm --filter @curtain/garment-spike stage4t -- <job dir> [--source stage2|synthetic]`): the
control proxy remeshed into a body tube and two sleeve tubes (each starting with a shoulder cap of
rays fanned from the shoulder joint), each vertex moved along a fixed ray to the visual hull of 128
of the 160 stage 2 garment masks (32 held out), kept at least 4 mm outside `mannequin.glb` (signed
distance, then checked by the exact distance), hem and cuffs found on the masks, the bodice stopped at
the fitted sleeves, then the print projected from the same frames into a 2048² atlas, JPEG, in a
textured `garment.glb`. About 86 s per product on a 4-core CPU. Version 0.3.0 since 7 Nov (below); 0.4.0 since 8 Nov (trousers sewn into one piece, above).

The synthetic dress's template is built from the same spec as its truth (0.57 cm Chamfer before
any fit), so its 0.443 cm alone does not show that the fit survives a wrong template.
`stage4t:perturbed` fits the same masks from a template 8 % wider with the hem 8 cm higher, one 6 %
narrower with the hem 8 cm lower, and another product's proxy: every start lands at 0.442–0.443 cm
(shoulders 0.82, bodice 0.44, skirt 0.34, sleeves 0.57 cm; 0.2.0 without shoulder caps: 0.437,
0.81, 0.42, 0.33, 0.58). The shoulders and sleeves end further
from the truth than the correct template was (0.60 and 0.29 cm): that is the visual hull's limit
(the underarm and the shoulder slope are not visible in any silhouette), not the template.

| What | 2DGS (stage 4) | Template fit (stage 4t 0.3.0; 0.2.0 in brackets) |
| --- | --- | --- |
| Synthetic dress, Chamfer to the truth | 1.45 cm | 0.443 cm (F-score 0.956 at 1 cm), 0 vertices inside; 0.442–0.443 cm from templates 1.55–3.11 cm off the truth (0.437) |
| Cloth inside the mannequin (run 14) | 21.9 % more than 3 mm inside (analytic test); 26.2 % inside by the SDF sign | 0 of 5,778; closest vertex 4.0 mm from `mannequin.glb` (exact distance) (3.7 mm) |
| Turntable IoU visible / silhouette at 0° / 90° / 180° | 0.65 / 0.93, 0.76 / 0.83, 0.67 / 0.93 | 0.90 / 0.90, 0.92 / 0.86, 0.93 / 0.93 |
| All 160 frames, holdout IoU visible / silhouette (32 frames never used) | 0.697 / 0.900 | 0.901 / 0.884 (0.906 / 0.887): the outline fits slightly worse, the visible garment much better |
| View agreement vs the pinned stills, visible front / back | 0.71 / 0.75 | 0.90 / 0.93 (0.91 / 0.94; initial bar 0.85) |
| Chest (chart 102 cm), before calibration / after | 99.0 cm: −2.98 / −0.71 cm, scale 1.030 | 101.1 cm: −0.86 / 0.00 cm, scale 1.009 (101.5 cm, −0.50) |
| Shoulder to hem, vertical drop / flat-lay (printed 91 cm) | 83.3 / 86.6 cm | 84.4 / 92.7 cm |
| Mesh | 11,999 triangles, ragged hem | 11,216 triangles, 3 open tubes (sleeves with shoulder caps), 0 non-manifold edges, not watertight by design |
| Colour, size | one mean colour, bundle 255 KB | baked texture (holdout MAE 21.0 vs 24.3 for one colour; the shoulder caps' print 48.8 % sampled, the rest fill, not covered by that check), `garment.glb` 724 KB, bundle 765 KB |

The length: a shop's "Length" is read as flat-lay (along the garment from the high point
shoulder); only that reading comes near 91 cm. Proxy 0.1.0 dropped 91 cm vertically and put run
14's control hem at the knee, about 8 cm below the generated dress; proxy 0.2.0 fixes it (hem
57.3 cm above the floor, prompt "above-knee"). In the viewer the dress is now closed in every size
and view, carries the print, and 8 / 12 / 16 differ visibly.

Shoulders and sleeves (stage 4t 0.3.0 + viewer, 7 Nov): 0.2.0 left the shoulder tops bare and the
sleeves drooped in the drape. Causes: run 14's control proxy is sleeveless (the product gives no
sleeve length), so the generated video shows the v0 arm cap bare and the masks carved it; body
rays (horizontal) and sleeve rays (square to the arm) run parallel to the cloth over the cap; and
only the sleeve particles above the yoke height were pinned, so each sleeve pivoted down (not the
material: bend, stretch and solver iterations change it by at most 0.2 cm). Fixes: shoulder-cap
rows fanned from the shoulder joint; on the sleeve head, a frame's non-garment pixels are left out
only where its control render shows the bare arm cap (grown by clearance + 0.3 cm; elsewhere, and
on frames without a control, they carve as everywhere, so a cold-shoulder garment stays open when
its control covers the cap); exact 4 mm clearance, inside vertices included; in the viewer every
sleeve pinned all round its head, a gathered cuff on a 0.5 cm leash, and a capped sleeve lifted
out of the arm cap after grading. Now the shoulders are closed in AU 12 and 16 in every view and
in AU 8 from the front and three-quarter; from the side AU 8 still shows the torso at the back
shoulder. Drape, M mannequin, free sleeve particles, AU 12: centroid drop 1.14 / 0.88 cm (old pins
1.44 / 1.15), cuff band drop 0.27 / 0.42 cm (1.57 / 2.04); p99 / max edge strain AU 8 11.7 / 42.0 %
(old pins 10.7 / 28.2; the maximum on pinned edges at the lifted size-8 cap), AU 12 7.8 / 26.0 %
(8.0 / 26.0), AU 16 8.4 / 28.3 % (8.3 / 24.9). The cap's print is mostly fill: 48.8 % of its texels
are sampled from a frame, 68 % of its vertices are seen bare by most frames. Checks: spike `vitest`
271 + viewer 51 passed, both typechecks and lint clean. The five-person panel stays on hold (1 of 5 products has a
bundle). Cost of run 14 (estimate, list price × GPU s): 1,493 GPU s, $1.57–1.63; runs 10–14
6,648 GPU s, $6.89–7.52; stage 4t adds CPU time only.

Fixed failures from the interrupted work: the bake test's expected seen share (the test was
wrong: five views at ±50° see 70 % of a cylinder, not < 60 %; it now computes the share from the
geometry), the synthetic-dress length test (the test: the spike's synthetic garment is a vertical
drop, the default is now flat-lay), the length-definition test (the test: a front/back symmetric
cone cannot tell the front from the back length), the shop prompt (expectation and code updated
together for proxy 0.2.0: the generated hem is above the knee, so "knee-length" became
"above-knee" in both), the template fit's sleeve scan (the code: it stopped at the wrist, the
synthetic cuff ends 1.5 cm past it) and its hole test.

Review round (7 Nov): mask clean-up now in garment units (holes up to 12 cm² filled; the earlier
600 px threshold erased a 10 × 5 cm keyhole at 480 × 832 too, not only at half resolution; the hole
test is back at 10 × 4.7 cm with its original bounds, plus a mask test at 480 × 832); a fit from
perturbed templates and another product's proxy (above); clearance reported by the exact distance
to the mannequin's triangles; the 2DGS holdout IoU measured with the same projection; a bake test
with the default edge margin on masks that overshoot the cloth; stage 4t 0.2.0. Run 14's fit is
unchanged by the new clean-up. Checks: spike `vitest` 267 + viewer 47 passed, typecheck and lint
clean, Modal pytest 169 passed (1 skipped), root `pnpm check` passed. Under the root check the
spike's shop-export tests had hit vitest's 5 s default and the new perturbed-template test tripped
vitest's 60 s worker RPC timer; the spike's `testTimeout` is now 60 s and that test yields between
its steps.

## Garment engine — Phase 0 preparation (Nov 2026)

Branch `claude/garment-engine`, against `docs/ENGINE-HANDOFF.md`. This is the work that can be
done **without** a GPU service, video models or pilot photos: the carry-over findings, the shared
vocabulary and fabric library, the canonical mannequin, the model-free pipeline stages and a spike
viewer. *This section predates run 14 and is superseded by the run 14 section above for the
Phase 0 state:* Phase 0 has now started on one shop product; cost is measured there and chart
agreement exists for 1 of 5 products. None of its six acceptance items (size test, fabric test,
chart agreement on real products, view agreement, measured cost, write-up) is met yet.

### Round of 6 Nov 2026: carry-over leftovers, Modal pipeline, viewer speed

**Verification run (6 Nov 2026, repo root, demo stopped, `.demo-db` removed first)**

| Command | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` | pass, lockfile up to date |
| `pnpm check` | pass (secret scan clean, SDK 7,802 B gzip of 8,192) |
| `pnpm demo:e2e` | pass, both flows (WooCommerce and Shopify Dawn) |
| `pnpm --filter @curtain/garment-spike build:bundle` | pass: aalter-studio-2 14,720 triangles, 296 KB, IoU 0.9955, 3.9 s; monochrome-03 7,808 triangles, 165 KB, IoU 0.9912, 3.2 s |
| `pnpm --filter @curtain/garment-spike export:phase0 -- --product all --synthetic-photos` | pass: 160 turntable + 81 motion frames at 480×832 per product, 1,052 files, 17.6 / 14.7 MB, 13–14 s each |
| `pnpm --filter @curtain/garment-spike viewer:smoke` | pass, 14 screenshots, 67 s total |
| `python -m pytest -q tests` in `spikes/garment-engine/modal` (Python 3.11, Open3D 0.19.0) | 33 passed |

Tests: schema 319, fit-engine 111, anchors 53, mannequin 38, taste-engine 95, sdk 90,
tryon-providers 70, shopify-app 104, woocommerce-plugin 66 (PHP), api 146, web 261,
garment spike 91 + viewer 43. Web: 31 precache entries.
Not run here: the Playwright privacy e2e, the api Docker image build, real phones, any `modal run`
from this container.

**Carry-over findings closed this round** (numbers as in the list below): #16 head top without
hair (`headTopWithoutHair`, web `headTop.test.ts`), #20 neutral fit term for items without fit
points (taste-engine `carryover.test.ts`), #22 seen memory, wardrobe and outbox keyed by shop and
item with a Dexie migration (taste-engine, web `shopKeys.test.ts`), #23 `/v1/swipes` accepts the
valid events of a batch and reports the rejected ones (api `swipes.test.ts`), #24 an explicit
`unknown` wardrobe size instead of `"ONE"` (`WARDROBE_SIZE_UNKNOWN`). Also this round: the fabric
library wired into the Woo meta box and Shopify metafield mappings (schema `fabricWiring.test.ts`,
plugin `fabric-text.test.php`), `billing_anomalies` in the drizzle schema and snapshots, merchant
views moved to `routes/merchant.ts`, and the Caddy CSP `img-src` narrowed to our own origins.
#17 has only been made one named constant; the prior share itself is unchanged.

**Review findings fixed at the end of this round**

| Id | Fix | Test |
|---|---|---|
| cohort-unknown-bucket-server (low) | `fitCohort` no longer counts `unknown` rows as a size bucket; they still count towards `n` and the kept rate. The web client's filter stays as a fallback for older servers. | api `analytics.test.ts` |
| R-yoke-not-from-width (medium) | D15 in `DECISIONS.md`, `ENGINE-HANDOFF.md`, the viewer README and the code comments now say what the code does: `shoulder_width` drives only the size-to-size ratio of the shoulder ring. The synthetic yoke's absolute width is the mannequin torso's (about 21.6 cm half-width on the ring, about 26 cm just around it), and the `anchors.json` seams at ±width/2 are notional chart points, not on the mesh. Not fixed in geometry. | spike `grading.test.ts` pins the gap |
| R-readme-p99-inconsistent (low) | The viewer README gives the strain per product: dress p99 9–11.5 %, tee p99 11–24 % (XS–L). | viewer `engine.test.ts`: tee XS–L p99 < 25 %, max < 45 % |
| R-node-bench-removed (low) | New `spikes/garment-engine/viewer/scripts/bench-drape.ts` reproduces the node "after" numbers. The "before" numbers came from a deleted scratch script of the old engine and are labelled as a one-off. | — (script, not a test) |

**Modal pipeline.** The code is in `spikes/garment-engine/modal/` (stage 2 video with
Wan2.2-Fun-A14B-Control, stage 4 gsplat 2DGS reconstruction + TSDF mesh, `run_phase0.py`, cost
records). This cloud session cannot reach Modal (the network proxy blocks gRPC), so nothing was run
from here. Runs go through `.github/workflows/modal.yml` on GitHub runners, triggered by
`.github/modal/run.txt`, or from the founder's computer (`modal/README.md`). Recorded on GitHub
Actions so far (branch `claude/garment-engine`, 6 Nov 2026; checked with `gh run list`/`gh run view`):

- `smoke.py`: passed on an L4 (CUDA, 20 × 4096² matmul in 0.43 s, 15.6 s wall with cold start). Five earlier runs failed on secret formatting and GPU selection.
- `stage4_recon.py --source synthetic` on aalter-studio-2 (L40S): the first attempt failed; after the per-camera colour fix it passed. 10k iterations in 64.6 s train + 8.0 s fuse + 2.9 s mesh, 79 GPU s. Masked PSNR 31.3 train / 31.1 holdout, mask IoU 0.993 / 0.992, mesh 12,000 triangles (in budget, edge-manifold, not watertight), against the synthetic truth: Chamfer mean 1.45 cm, F-score 0.41 at 1 cm and 0.79 at 2 cm, max error 9.8 cm. Cost **estimate** $0.04–0.05 (list price × seconds; the Modal invoice is the measurement and was not read).
- Stage 2 (Wan2.2 video) has **not** produced a result yet: run 10 (`run_phase0.py`, stage 2 then stage 4) was queued in `run.txt` while this was written; its outcome is not recorded here. So no generated video, no seam drift, no stage 4 on generated frames, and no real GPU cost per product exist yet. The founder's computer remains the fallback if the Actions route stops working.

**Spike viewer, measured before and after** (4-core build container, headless Chromium with
SwiftShader, so rendering also runs on the CPU; numbers from `viewer:smoke`):

| | Before (5 Nov) | After (6 Nov, this run) |
|---|---|---|
| Dress, one size | 6.2–7.6 s | 1.2–1.4 s per size (3 workers), first drape after page load 2.61 s (worker start in the Vite dev server) |
| Dress, three sizes side by side | 20–24 s | 2.2–2.3 s wall (sizes in parallel) |
| Tee, three sizes | 13.6 s | 2.4 s wall, 0.93–0.96 s per size |
| Node CPU, one size (`viewer/scripts/bench-drape.ts`) | dress 3.0 s, tee 1.45 s (one-off, script gone) | dress 1.0–1.07 s, tee 0.32–0.47 s |
| Edge strain after the drape (node) | — | dress p99 9–11.5 %, tee p99 11–24 % (XS–L), max 18–39 % |
| Production build, largest chunk | 199 KB gzip | 208 KB gzip (`scene`, three.js not split; budget 400 KB) |

1 of 16 fresh drapes in the smoke run is over the 2 s budget (the first one). Phone: not measured.

**Remaining gaps after this round**

- Stage 2 on a GPU without a recorded result; stages 3 and 4 never run on generated video.
- The synthetic yoke is the mannequin's width, not the chart's; real seams need a reconstruction with seams or a tailored synthetic yoke.
- Tee strain is high on small sizes (p99 up to 24 %), and the body-104/90/112 smoke case shows 53.5 % neck strain (body wider at the shoulders than the garment, not checked). The v0 mannequin's arms overlap the torso.
- Drape on a mid-range phone, the hero-render flow, the blind tests with five people and pilot data: all still open (see "What Phase 0 still needs").
- Carry-over #14 (SDK licence, founder) and #17 (population prior share, needs tape-measured volunteers) stay open.

### Verification run (5 Nov 2026, repo root, fresh `.demo-db`)

| Command | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` | pass, lockfile up to date |
| `pnpm check` (build packages, typecheck, lint, test, build apps, bundle secret scan) | pass |
| `pnpm demo:e2e` | pass, both flows (WooCommerce and Shopify Dawn): overlay, About you, result, "Choose size L", returning shopper |
| `pnpm --filter @curtain/garment-spike build:bundle` | pass, 2 products (numbers below) |
| `pnpm --filter @curtain/garment-spike viewer:smoke` | pass, 11 screenshots in `spikes/garment-engine/out/screens/` |

Tests: schema 298, fit-engine 111, anchors 53, mannequin 38, taste-engine 84, sdk 90,
tryon-providers 70, shopify-app 104, woocommerce-plugin 53 (PHP), api 135, web 241, demo-shop 8,
garment spike 70 + viewer 28. SDK bundle 7,802 B gzip (budget 8,192). Web: 31 precache entries.
Not run here: the Playwright privacy e2e, the api Docker image build, real phones.

### Review findings fixed in this pass

| Id | Fix | Test |
|---|---|---|
| SEC-1 (high) | Woo `/woo/complete` now checks the domain proof on **every** path, not only manual-key. `/woo/connect` returns `verification.nonce` in Stripe mode too (the plugin already publishes whatever nonce it gets). A paid Stripe trial is no longer proof of a domain. | api `stripe.test.ts`: Stripe flow without the proof → 403 `domain_unverified`, no key issued |
| SEC-2 (medium) | The proof is fetched only from the root of the claimed host (`https://<host>/wp-json/curtain/v1/verify`, then `/?rest_route=`); the path of `siteUrl` is ignored. The HTML meta-tag fallback is gone (api and plugin), so a string reflected on a page cannot pass. Consequence: WordPress must answer at the host root. | api `media-proof.test.ts`: `/~attacker/` path refused, reflected meta tag refused; plugin `connect-proof.test.php` |
| AVAIL-1 (medium) | `DEVICE_CREATE_RATE_LIMIT_PER_HOUR` default 30 → 300 per IP (shoppers share carrier NAT / shop Wi-Fi; the embed without storage mints a device per open). A 429 from `/v1/devices` or `/v1/try` now shows a retryable "Busy right now" screen in the embed instead of "Something went wrong". Documented in `docs/STANDALONE.md` and `infra/.env.example`. | web `flow.test.ts` |
| PRIV-1 (medium) | "Delete my scan" drops the pending signature PUT first, then queues a durable `signature_delete` outbox row. The syncer sends signature rows one at a time in queue order, so an in-flight PUT lands before the DELETE; the DELETE retries past `MAX_ATTEMPTS` until a 2xx (only a permanent 4xx ends it). `signatureSyncedAt` is cleared only when the server confirms. | web `outbox.test.ts` (+2), `store.test.ts` (+1) |
| AUTH-1 (medium) | Device rotation and registration run under one Web Lock across tabs and re-read the stored credentials first. A `token_rotated` 401 (from rotate or from any request) reloads the stored token and retries with it instead of clearing it and registering. `updateSettings` no longer writes a stale tab's device token over a newer one. A new device is registered only on `invalid_token`, on first run, or when a rotated token was kept by no context at all (see open gaps). | web `client.test.ts` (+4), `store.test.ts` (+1) |
| R1 (medium) | New D15 breadth anchor `shoulder_width` (`ANCHOR_BREADTHS`, `BREADTH_RING`). The fit point `shoulder` (a width) maps to it in `@curtain/anchors` and in the fit engine's `FIT_POINT_ANCHORS`/`FitAnchorId`, so `anchorGaps` never keys a width under the `shoulder` ring (a girth). D15 amended in `docs/DECISIONS.md`. | anchors `vocabulary.test.ts`, fit-engine `anchors.test.ts` |
| R2 (medium) | The spike viewer no longer decides "does not close" from the display preset's stretch. A loop is `open` only when the fit engine bands that anchor `tight` (its stretch-adjusted limit, from the product's own fabric); `placeGarment` no longer takes a stretch. | viewer `fitting.test.ts` (both repros) |
| R3 (medium) | `resolveFabric` keeps a construction named in the composition as the construction, also when it has a base fibre ("100% cashmere" → wool + cashmere, like `parseFabricText`). The spike's `materialJson` passes a construction `primary` ("denim" with a cotton/elastane blend → denim, twill). | schema `fabrics.test.ts`, spike `garment.test.ts` |

### Carry-over findings (ENGINE-HANDOFF §Carry-over)

Closed (code and tests in this branch):

1. SSRF guard pins DNS: `lib/safeFetch.ts` resolves once, validates, and connects to that address; the media proxy, the hero render and the Woo proof use it. Stage 1 ingest does not exist yet and must go through it.
2. Duplicate size labels are rejected in schema `garment.ts` (`duplicateSizeLabels`); `fitSummary` never summarises an ambiguous row; grading throws on them.
3. "Boot cut jeans" is a bottom: bottoms phrases with "boot" come first in `mappings/common.ts`; "Chelsea boot" stays a shoe.
4. Shopify API version `2026-10`, one constant in `@curtain/shopify-app` (`DEFAULT_API_VERSION`), mirrored in api env and `infra/.env.example`. Not re-validated in GraphiQL on a real store.
5. The api's Shopify client is a thin wrapper over `@curtain/shopify-app`.
6. Shopify billing uses the shop's billing currency (`shopBillingPreferences`), stored per shop and reused for usage records.
7. Standalone billing: per-plan daily cap (`BILLED_DAILY_CAP_*`) next to the global anomaly cap, and billing anomalies recorded and shown to the merchant.
8. Deck swipes bill only for a paired device under the per-plan daily cap (`billFitSession`, shared with fit-shown).
9. `DELETE /v1/me/signature` exists, and "Delete my scan" now reaches it durably (PRIV-1).
10. Expired tokens rotate within `DEVICE_TOKEN_ROTATE_GRACE_DAYS` (180), and the cross-tab race no longer re-registers (AUTH-1). One residual case, below.
11. Shop logo and overlay product photo load through `GET /v1/sdk/media` on our origin (allowlisted per shop, sniffed type, size cap, cache).
12. Woo domain proof on every Connect path, from the host root (SEC-1, SEC-2).
13. The Woo signed backfill endpoint was removed from the plugin.
15. Plugin "Tested up to" headers updated; the Connect redirect is restricted to `https://checkout.stripe.com/`.
18. The console shows the size distribution of standalone sessions (`analytics/fit-sizes`, k-floored).
19. The abandoned-opens k floor counts distinct devices, not sessions.

Still open as of 5 Nov (16, 20, 22, 23 and 24 were closed on 6 Nov, see the round above):

14. SDK is `UNLICENSED` but ships in a GPL plugin: founder decision, before WordPress.org.
17. About 58 % population prior in the girth means: needs the tape-measured volunteers.
21. Superseded by the Phase 5 photo finish.

### What was built for the engine, and what each proves

| Part | Where | What it proves | What it does not |
|---|---|---|---|
| Anchor vocabulary (D12–D16 recorded, D15 amended) | `packages/anchors` | One set of ids for scan, fit engine, asset and renderer: 12 rings, 6 lengths, 1 breadth; mappings from fit points, scan levels and `lengthCm` keys, tested against `@curtain/schema`; ring geometry (Ramanujan II, exact inverse) and the grading morph (monotone cubic, never overshoots). Zero runtime dependencies. | Nothing about real garments. |
| Fit engine re-keyed by anchor | `packages/fit-engine` `anchorGaps` | The viewer can read per-anchor gaps with no maths of its own (rule 4); a test compares every gap with `fitGapsForRender` over 200+ cases. | — |
| Scan → anchors | `apps/web/src/features/capture/anchors.ts` | The scan's 12 levels map to the 12 rings. | The hair bias (#16) is still in the rings. |
| Fabric library v1 | `packages/schema` `fabrics.ts`, `mappings/fabricText.ts`, `docs/research/fabrics.md` | 12 fibres and the constructions of the handoff with sources; blend → parameters, construction overrides, elastane share, Dutch/English text parsing. | The numbers are trade ranges and estimates (listed per entry); not calibrated against real drape. |
| Canonical mannequin v0 | `packages/mannequin` | Deterministic procedural body in 3 shapes (XS/M/XXL), 14.8–15.2k triangles each, girth on the mesh equal to the table at every ring, length lines, turntable camera paths (72 frames at three heights), a 6 s motion clip with a 10-joint rig, a glTF writer. | Not anthropometric; limbs overlap the torso; Phase 1 replaces the shape table. |
| Spike stage 3 (separation) | `spikes/garment-engine/src/separation.ts` | Difference mask vs the bare mannequin works on our own synthetic renders: IoU 0.9955 / 0.9912 over 72 frames. | Untested on generated video; fails for a garment the colour of the mannequin (IoU < 0.5); no SAM 2 / motion signal yet. |
| Spike stage 5 (anchoring, calibration) | `src/anchoring.ts` | Plane slicing measures any mesh in mannequin space; least-squares global scale then per-ring correction removes a simulated reconstruction error (6.3–6.6 cm max before, 1.65 / 0.00 cm residual after the global scale, 0.00 cm after calibration). | Chart agreement is ~0 by construction on synthetic data; the real tolerance needs Phase 0 data. |
| Spike stage 6 (grading) and bundle | `src/grading.ts`, `src/bundle.ts` | Per-size targets from the chart, standard increments where it has no column (logged), and the bundle format (base.glb, anchors.json, grading.json, material.json, qa.json) with an input hash, deterministic. | No Draco, no KTX2, no textures or UVs; `shoulder_width` in grading.json drives only the size ratio of the yoke, not its absolute width. |
| Spike viewer | `spikes/garment-engine/viewer` | The device half end to end on synthetic data: avatar from typed measurements, per-anchor placement from fit-engine slack, PBD drape with collision, S/M/L side by side, fit map, linen/silk presets, and `blind.html` for the size and fabric tests with CSV export. | Not the product viewer (`packages/garment-viewer`, Phase 2); no WebGPU, no fallback, no textures; drape per size about 1.2–1.4 s in software rendering since 6 Nov, the first drape after page load over 2 s; not measured on a phone. |
| Research | `docs/research/garment-engine.md`, `fabrics.md`; banned-model lint extended (`tryon-providers` `bannedModels.ts`) | Shortlist with licences: Wan2.2-Fun Control (Apache-2.0) vs Kling 3.0 Pro (hosted); gsplat 2DGS vs NeuS-style SDF; Anny body model (Apache-2.0); Modal EU / Koyeb. Two plan risks found: no hosted video API with verified camera-trajectory control, and none with an EU region. | Cost per product is an **estimate** ($1.3–5.6 per attempt, $250 Phase 0 budget), not a measurement. |

### What Phase 0 still needs

- **Accounts:** a GPU service account (Modal EU and/or Koyeb) and API access to the candidate video models. Founder call on US/Asia processing of merchant product photos for a hosted video model (no EU region found).
- **Stages 2 and 4 on a GPU:** image → video (two models, ~3 seeds each) and reconstruction (two methods), plugged in where `generateGarment` + `distortGarment` sit in `buildBundle`. Stage 3 also needs the segmentation refinement and the motion signal.
- **Pilot data:** 5 real products from the pilot shop (dresses and tops) with merchant front and back photos, size chart and base size.
- **The tests:** five people who did not build it, on `blind.html`: size test (≥ 4 of 5 products), fabric test (linen vs silk), plus merchant view agreement.
- **Measurements:** GPU seconds, wall time and cost per product; drape settle and frame rate on a mid-range phone; the Phase 0 write-up with chosen models and tolerances.

### Measured numbers (synthetic data, this sandbox)

| What | Value |
|---|---|
| Spike bundle `aalter-studio-2` (shirt dress) | 14,720 triangles, 295 KB (base.glb 269 KB), built in 4.7 s |
| Spike bundle `monochrome-03` (tee) | 7,808 triangles (below the 8–15k guidance), 165 KB (base.glb 145 KB), built in 4.1 s |
| Chart agreement after calibration | 0.00 cm on both (by construction); residual after global scale 1.65 / 0.00 cm |
| Separation IoU, 72 frames | 0.9955 (lowest frame 0.988) / 0.9912 (lowest 0.982) |
| Mannequin v0 | 14.8–15.2k triangles per shape |
| Spike viewer production build | largest chunk 758 KB raw, 199 KB gzip (three.js included); handoff budget 400 KB gzip |
| Drape settle, 1.5 s of cloth | 5 Nov figures, superseded: see "Spike viewer, measured before and after" in the 6 Nov round. Phone budget ≤ 2 s per size: not measured |
| Asset budget ≤ 3 MB per product | 165–295 KB without textures |

## Verification run before the engine branch (repo root, Node 22, pnpm 10.28.0)

| Command | Result |
|---|---|
| `flock /tmp/curtain-pnpm.lock pnpm install` (and `--frozen-lockfile`) | pass, lockfile up to date |
| `pnpm build` (packages, then apps) | pass (web: 27 precache entries; zod's "annotation Rollup cannot interpret" warnings only) |
| `pnpm -r typecheck` | pass, 10/10 projects (woocommerce-plugin: 27/27 PHP files pass `php -l`) |
| `pnpm -r lint` | pass, including the banned-model check in tryon-providers |
| `pnpm -r test` | pass, **769 tests** (see the per-package table) |
| `node scripts/check-bundle-secrets.mjs` | pass: no secret-looking strings in client bundles |
| `pnpm --filter @curtain/woocommerce-plugin build` | pass: `dist/curtain-woocommerce.zip` (72,737 B, 31 entries, bundles `assets/sdk.v1.js` and both JSON Schemas) |

Not run here: the Playwright privacy e2e (`pnpm --filter @curtain/web e2e`, no Chromium in this
sandbox, and CI does not run it yet), and the api Docker image build (no Docker daemon in this
sandbox; CI's `api-image` job builds it).

| Package | Tests |
|---|---|
| `@curtain/schema` | 115 |
| `@curtain/fit-engine` | 102 (spec vectors T1–T16, 1,000-body purity fuzz) |
| `@curtain/taste-engine` | 84 (spec vectors 1–16, colour harmony) |
| `@curtain/sdk` | 54 |
| `@curtain/tryon-providers` | 65 |
| `@curtain/shopify-app` | 86 |
| `@curtain/woocommerce-plugin` | 41 (PHP runner with WP shims) |
| `@curtain/api` | 76 (PGlite + in-memory queue + mock provider) |
| `@curtain/web` | 146 (node + jsdom, fake-indexeddb) |

## Standalone mode (D11)

Founder decision D11: the merchant plugin works **without** the Curtain consumer app. The contract is
`docs/STANDALONE.md`; this section is its build status.

### What is implemented

- **SDK (`@curtain/sdk`)**: `data-mode="embed"` (default), `app` and `auto`. Clicking "Try it on" opens a
  full-screen overlay on the merchant page holding an iframe to `/embed/<token>`. There is no QR code
  and no deep link. The overlay has a focus trap (with a sentinel after the iframe, so Tab out of the
  iframe wraps to the close button), Escape, `aria-modal`, scroll lock, a loading state and reduced
  motion. The postMessage protocol checks the exact origin and source. Variant selection runs in this
  order: merchant hook, Shopify cart form, WooCommerce `variations_form`, then a toast. It is scoped
  to the product section of the button that was clicked, and it understands Dawn 15 dropdowns (numeric
  id values, "XS - Unavailable" labels). Bundle: 7.8 KB gzip (budget 8 KB).
- **Fitting room (`apps/web`, `/embed/:token`)**: product header, About you (height, weight, fit
  preference, optional age range and body type, "I know my measurements"; shoes always ask for the EU
  shoe size), an optional camera scan, and the result. The result shows the fit-engine size, the
  per-point fit, the avatar with the garment overlay, the confidence and the estimate disclaimer,
  plus size comparison and "Choose size X". The footer has "Remember me" (IndexedDB partitioned per
  shop; turning it off is remembered as a non-personal flag), "Forget me" (local wipe plus
  `DELETE /v1/me`) and "Get the Curtain app". Measurements and photos never leave the iframe (D3).
- **api**: `surface: 'embed'` sessions with `embedUrl`, `embed.allowedOrigins` on `GET /v1/try/:token`,
  and `POST /v1/try/:token/fit-shown` as the billing event (one per intent token, paused shop → 402).
- **Plugins**: the Shopify theme block and WooCommerce settings for "Experience" (`data-mode`) and
  "Size option name" (`data-size-option`), in en and nl.
- **Framing**: `/embed/*` is the only framable route (`frame-ancestors https:` in Caddy, and in Vite
  dev for the demo).

### Fixed in the standalone review pass

| Finding | Fix |
|---|---|
| SEC-1 fit-shown billable by script | fit-shown bills only when all of these hold: `surface === 'embed'`; the session's `pageOrigin` belongs to the shop (in `embedAllowedOrigins`); there is one billed fit per device, product and UTC day; and the shop is under the per-shop daily anomaly cap `EMBED_BILLED_SESSIONS_PER_DAY` (default 5000, logs a warning). If any check fails, the request is still recorded on the try session and returns `billed: false`. `GET /v1/try/:token` and fit-shown are rate-limited per IP (`TRY_RATE_LIMIT_PER_MIN`, default 60). |
| SEC-2 archived products billed | fit-shown reloads the product; a missing or archived product is not billed. |
| UX-1 / F2 / SEC-3 "Remember me" off not remembered | `pref:remember=false` is stored (no personal data) and read by `init()` before the device or profile. "Forget me" keeps the opt-out, and turning the switch back on removes it. |
| UX-2 "No size fits well" with a coral "Choose size L" | Primary action is now "Edit my measurements"; "Select size L anyway" is secondary. No fit-shown call (nothing was recommended). |
| A11Y-1 focus lost on step changes | Each step change scrolls to the top and focuses the new screen's heading (not on first load). |
| COPY-1 app copy in the scan | `CaptureStep variant="embed"`: no face photo or identity tile, no "syncs", "this device", "About 30 seconds". |
| COPY-2 developer jargon in the result | The embed builds its own notes for the shown size. There is no "tie broken by …", and hints appear only for measurements the form can collect ("Add your bust … under Edit my measurements"). |
| A11Y-2 brand colour as text | The shop name uses the brand colour only when it reaches 4.5:1; otherwise it uses ink-mute. The colour stays on the top border. |
| A11Y-3 Tab leaks to the merchant page | A focus sentinel after the iframe wraps to the close button. |
| SEC-5 `mock:` tokens in production | They resolve only in a dev build or with `VITE_DEMO=1`; otherwise the "expired" screen shows. |
| UX-3 placeholder product photo | The demo seed points photos at the demo storefront's own `/img/<id>.svg`. |
| F1 shoes / no fit point → "We recommend 38" | When no size can be scored, the result says "We can't recommend a size yet" and asks for the missing measurement, with no fit-shown call. Shoes require the EU shoe size. |
| F3 notes and confidence of the wrong size after a preference change | The shown confidence, notes and "fits" come from the advised size, and fit-shown sends that confidence. |
| F4 variant selection on the wrong form / Dawn 15 | Scoped to the button's product section; matches labels with a " - Unavailable" suffix and numeric id values. |
| F5 scan drops the typed inseam | About-you entries the scan's form does not cover are merged into the scan profile. |

Tests were added for each fix: api `embed.test.ts` (+5), web `storage`, `aboutYou`, `EmbedApp` and
`lib/contrast` tests, sdk `embed.test.ts` (+3), demo-shop server test (+1), and the demo seed test.

### How to run the demo

```bash
pnpm demo        # no Docker, no keys; Ctrl-C stops everything it started
pnpm demo:e2e    # Playwright: storefront → overlay → About you → result → size selected on the page
```

| URL | What |
|---|---|
| `http://localhost:5180/` | Demo storefront "Aalter Studio" (WooCommerce look; `?theme=dawn` for the Shopify shop) |
| `http://localhost:5180/product/aalter-studio-1` | WooCommerce-style product page with the "Try it on" button |
| `http://localhost:5180/products/aalter-studio-1` | Shopify Dawn-style product page |
| `http://localhost:3000/embed/<token>` | The fitting room (opened by the button in the overlay) |
| `http://localhost:8787` | Demo api (PGlite in `.demo-db`, seeded shops, mock try-on), serves `/sdk/v1.js` |

`pnpm demo` reuses a service that is already answering on its port. After pulling these changes,
stop any old demo first, or the api will still serve the old seed and billing rules.

### What is verified

- `pnpm check` passes: build, typecheck, lint, the tests (api 97, web 219, sdk 90, schema 119,
  fit-engine 102, taste-engine 84, tryon-providers 65, shopify-app 89, demo-shop 8, woocommerce
  plugin 48) and the bundle secret scan.
- `pnpm demo:e2e` passes for both page styles (WooCommerce and Dawn). Each flow runs: overlay, About
  you, result, "Choose size L", the size selected on the page, and a returning shopper going straight
  to the result. Rerun on 5 Nov 2026 against a freshly started demo (api, web and storefront all
  new): both flows pass.

### What remains

- Fit-shown rate limiting is per IP only. Per device, the defence is the one-bill-per-device,
  product and day rule, plus the per-plan and global daily caps and the merchant's anomaly view
  (carry-over #7). A rotating IP pool can still mint new devices (300 per IP per hour since AVAIL-1)
  and bill up to the cap.
- Real devices: the camera scan inside a cross-origin iframe (`allow="camera"`) on iOS Safari and
  Android Chrome, and IndexedDB partitioning (Safari ITP, Firefox) for "Remember me".
- Live Shopify (Dawn 15) and WooCommerce themes: variant selection beyond the demo markup and the
  scoped selection with real quick-add sections.
- The "See it on me" hero render UI inside the embed is wired to the existing API but not
  exercised end to end without provider keys.

## Fixed in this integration pass

1. **The Shopify app could not open in the admin** (high). `shopify.app.toml` points
   `application_url` at `/shopify/admin` and `redirect_urls` at `/shopify/auth/callback`, but the api
   served neither. `apps/api` now depends on `@curtain/shopify-app` and serves:
   - `GET /shopify/admin`: `renderAdminPage()` with `Content-Security-Policy:
     frame-ancestors https://<shop> https://admin.shopify.com;` (the shop comes only from a validated
     `?shop=`), helmet's `X-Frame-Options` removed, and `no-store`.
   - `GET /shopify/auth/callback`: 302 to `adminAppUrl(shop, SHOPIFY_APP_HANDLE)`, or 400 for a
     domain that is not `*.myshopify.com`.
   - New non-secret env `SHOPIFY_APP_HANDLE` (default `curtain`) in `apps/api/src/env.ts` and
     `infra/.env.example`. It must equal `handle` in the rendered toml.
2. **The theme block did nothing on a fresh install** (high). `POST /shopify/token-exchange` now
   writes the app-data metafields (`curtain.public_key`, `api_url`, `app_url` on the
   `AppInstallation`) through `setAppDataMetafields()`. It does this on every exchange, because the
   public prefix stays the same across key rotations. A failure is logged and does not stop the
   install. The test checks the exact metafields and that no `sk_` value goes out.
3. **`POST /v1/swipes` left half a batch behind on 422** (high). Every `shopId` is now checked before
   any write. The inserts, the usage events, the `try_sessions.billed_at` updates and the ledger
   entry share one transaction. A regression test covers a mixed known/unknown batch: nothing is
   written, and the retry of the known event is accepted.
4. **The api Docker image** now installs and builds `packages/shopify-app` (its `dist` plus
   `admin/index.html` ship with `pnpm deploy`). This is unverified locally (see above).
5. **Token-format literals in tests** (AGENTS.md rule: GitHub push protection). `sk_live_…`,
   `sk_test_…`, `pk_live_…`, `shpat_…`, `shpss_…`, `whsec_…` and `xai-…` string literals in 10 test
   files are now built by concatenation. The values and assertions are unchanged.

## What is implemented, per package

**`packages/schema`**: zod GarmentPayload v1 (handoff §3.1, extended), FitSignature v1 (80 floats,
no face/skin/hair values), swipe events, every route DTO, `completenessScore` with per-field reasons,
Shopify metafield and Woo meta mappings, mock garments, and JSON Schema export for PHP. Verified by
tests: round-trips, completeness weights, mappings, the JSON Schema matching zod.

**`packages/fit-engine`**: pure `computeFit` / `recommendSize` with sigma-aware confidence, fit
summary and render gaps. It has zero runtime dependencies, a build guard against runtime imports,
and frozen inputs in tests. Verified by tests: the spec vectors and the purity fuzz.

**`packages/taste-engine`**: `applySwipe`, penalty memory, `rankDeck`, Style DNA and colour harmony.
It is pure, and its state is plain JSON. Verified by tests: spec vectors 1–16.

**`packages/tryon-providers`**: a server-only `TryOnRouter` plus FASHN (implemented against the
documented API), Vertex VTO and Grok video (stubs that are wired but not live-tested), and Mock.
`PersonInput.kind` is the only `'avatarRender'` value, and banned models fail lint. Verified by
tests: undici-mocked HTTP, router fallback, cost policy, and the browser guard.

**`packages/sdk`**: a vanilla IIFE under 6 KB that handles the button scan, the
`POST /v1/sdk/sessions` handshake, the deep link on mobile, and an accessible QR modal on desktop.
It never breaks the merchant page. Verified by tests: jsdom, auto-init, a11y, failure paths, and the
secret scan.

**`packages/shopify-app`**: the `shopify.app.toml` template and `configure` script, the "Try in
Curtain" theme app extension (bundles `sdk.v1.js`), the embedded admin page, and helpers for the
Admin GraphQL client, token exchange, session token, metafield definitions, app-data metafields,
bulk backfill, billing, webhook HMAC and product sync. Verified by tests: mocked fetch and
fixtures. `apps/api` uses only the admin page, the deep links and the app-data metafields; its own
`shopify/client.ts` still duplicates the GraphQL, token exchange and billing code.

**`packages/woocommerce-plugin`**: a PHP 8.2+ plugin with a meta box for every §3.1 field, push on
save with PK-HMAC (Action Scheduler retries), the bundled SDK button and shortcode, Connect (Stripe
or manual key), a signed backfill REST route, local JSON-Schema validation plus the backend dry-run,
HPOS, `uninstall.php`, `readme.txt` and nl_NL. Verified by tests: HMAC vectors shared with the api,
payload builder, sanitizer, schema validator, secret store and sync.

**`apps/api`**: a Fastify 5 server with Drizzle/Postgres and in-process pg-boss. It covers devices
and token rotation, the signature PUT, ledger, export, `DELETE /v1/me`, shop catalogues, swipes
(billing unit D7), wardrobe, cohort, SDK sessions with QR, try tokens, the merchant API
(HMAC/Bearer/session token, upsert, validate, usage, ledger, analytics with a k floor, key
rotation, Woo connect), Shopify (admin page, callback, token exchange, webhooks including GDPR
topics, billing), Stripe Checkout, webhook and meter, hero render jobs, and the usage rollup.
Verified by tests: every route group on PGlite, plus a security-review suite (16 tests).

**`apps/web`**: a React 19 PWA covering onboarding, the on-device capture (MediaPipe in a worker,
cross-sections, a population prior, fusion, the face/skin estimate, and an encrypted base frame),
try-from-shop, the deck, wardrobe, profile and privacy ledger, pairing, the outbox sync, and the
merchant console at `/merchant`. Verified by tests: capture geometry, measurement and fusion,
storage crypto, the outbox, the store, the API client, the env guard, the token contrast checks and
the review components.

## Needs manual verification (cannot be done offline)

- **Live Shopify dev store** (follow `packages/shopify-app/README.md` §"Must be verified"):
  - install, then App Bridge `idToken()`, then `/shopify/token-exchange`
  - the admin page loads inside the admin iframe (the new route and CSP)
  - `/shopify/auth/callback` lands on the app home
  - metafield definitions are created on `$app:curtain`
  - `app.metafields.curtain.public_key` resolves in the theme block's Liquid
  - webhooks fire, including the GDPR topics
  - `appSubscriptionCreate` works with `test: true` and the confirmation URL
  - the usage records work
  - the theme-editor deep link works
  - the API version is valid (see the gaps below)
- **WooCommerce site** (follow `packages/woocommerce-plugin/README.md` §"Manual verification" 1–11):
  - activation guards
  - Connect in Stripe mode and in manual mode
  - push on save, plus retry and backoff
  - clock skew
  - the storefront button
  - the backfill endpoint
  - uninstall
  - translations (`.mo` compilation)
- **FASHN key**: the hero render end to end, checking the `return_base64` format, the processing
  region and DPA, and the error names. Vertex and xAI need the same (`packages/tryon-providers`
  README). Only `mock` has run here.
- **VPS**:
  - `docker build -f apps/api/Dockerfile .` (now includes shopify-app)
  - `infra/docker-compose.yml` up with Caddy TLS
  - migrations run on start
  - pg-boss jobs, and a `JOBS=1` replica
  - the nightly encrypted `pg_dump` and a restore drill
  - an rsync deploy of `apps/web/dist`
- **Stripe**: Checkout, the webhook endpoint, and the `curtain_fit_sessions` meter with the overage
  price.
- **Devices**:
  - the capture pipeline on real iOS Safari and Android Chrome (fetch the models first with
    `pnpm --filter @curtain/web models`)
  - universal links from the SDK
  - the Playwright privacy e2e in a browser-capable CI job
- **Accuracy**: calibrate the scan against a tape-measured pilot set (D5 target: 3–4 cm with the
  scan only, about 1.5–2 cm when fused).

## Known gaps (open findings, by severity)

Updated for the engine branch (5 Nov 2026). Closed since the November handoff: Woo domain proof
(#12, SEC-1, SEC-2), deck billing (#8), expired-token rotation (#10, AUTH-1), `DELETE
/v1/me/signature` (#9, PRIV-1), the Shopify API version (#4) and currency (#6), duplicate size
labels (#2), "Boot cut jeans" (#3), the abandoned-opens k floor (#19), DNS pinning (#1), the shop
logo proxy (#11), the Woo backfill endpoint (#13) and the readme headers and Connect redirect (#15).

**High**
- `@curtain/sdk` is `UNLICENSED`, but it ships inside a WP.org plugin, which must be
  GPL-compatible. This is a founder/legal call, needed before WP.org submission (#14).

**Medium**
- Capture: `headTopRow` includes hair, which biases girths low by about 1–3 %; the avatar and the
  anchors inherit it. `FaceStep` shows "models not available" while the models are still loading (#16).
- The scan prior blend puts about 58 % of the population prior into the girth means (#17);
  revisit with the tape-measured volunteers.
- `TasteState.seen`, the penalty memory and the local wardrobe key are keyed by `itemId` without
  the shop (#22; the server side is fixed).
- Items without fit points (accessories) never earn the 0.15 fit term in `rankDeck` (#20).
- Woo Connect needs WordPress to answer at the root of the host (SEC-2). A shop installed in a
  subdirectory (`example.com/shop/`) cannot connect; binding the shop to host plus path would be
  the fix if a pilot merchant needs it.
- Device minting: 300 per IP per hour, no per-shop or global mint budget (AVAIL-1). A global budget
  was left out on purpose because it would let a flood lock every shopper out; billing has its own
  per-device, per-plan and global caps.
- A device whose rotated token was lost by every context (the rotate response never stored, e.g.
  the tab closed mid-request) still registers a new device, which orphans the old device's server
  rows out of reach of `DELETE /v1/me` (AUTH-1 residual). A refresh credential would close it.
- Browsers without the Web Locks API fall back to the `token_rotated` reload path (AUTH-1); two
  tabs can then still both send a rotation, but the loser picks up the winner's token.

**Low**
- `/v1/swipes` is atomic but all-or-nothing per batch (#23). The client batches per shop, so a
  redacted shop drops only its own swipes.
- `SaveOutboxEntry.size` can be null, but `WardrobePutRequestSchema.size` cannot (#24).
- `grading.json` carries `shoulder_width`, but it only drives the size-to-size ratio of the yoke;
  the synthetic yoke's absolute width is the mannequin torso's, and the `anchors.json` seams are
  notional chart points (R1 follow-up, D15).
- Spike viewer: largest chunk 208 KB gzip (under the 400 KB budget, but three.js is not split);
  drape settle not measured on a phone; no textures, no WebGPU, no drawn-overlay fallback.

**Product scope not built yet** (handoff §8):
- the hero-render UI flow (the API and consent exist)
- Path B as a true mesh warp of the flat-lay (v0 is a parametric SVG overlay)
- Wardrobe "Rooms" and shopping with friends
- the merchant console's abandoned-opens metric (no DTO field yet)
- order attribution (off by design, D7)
- ads toggle targeting
- merchant buying advice

## Recommended next steps, in order

1. **Start Phase 0 proper.** Open the GPU service account and the video-model access, get the 5
   pilot products with front and back photos, run stages 2 and 4 into `buildBundle`, then the
   five-person size and fabric tests on `blind.html`. Stop if the size test fails.
2. **Get Shopify end to end on a dev store.** Re-validate the `2026-10` queries in GraphiQL, then
   install, admin page, theme block, product sync and a try-on from a phone (D10).
3. **Finish the app-side privacy items before any pilot user:** item ids by shop in the taste engine
   and the web store (#22), and decide on a refresh credential for the AUTH-1 residual.
4. **Run the WooCommerce smoke test** on current WordPress and WooCommerce, including Connect with
   the host-root domain proof, and make the SDK licence decision before WP.org.
5. **Calibrate capture on a tape-measured pilot set** (hair offset #16, prior weight #17), and add
   the Playwright privacy e2e to CI.
6. **VPS go-live**: compose, TLS, backups with a restore drill (now including the asset volume),
   and the CI image push.
