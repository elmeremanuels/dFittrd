# Curtain plugin v1 — operator guide

What ships: size advice in an overlay on the merchant's product page ("Try it on"), for Shopify
(theme app block, `packages/shopify-app`) and WooCommerce (`packages/woocommerce-plugin`), served by
one backend (`apps/api`) and one web origin (`apps/web`, the `/embed` iframe). New on branch
`claude/plugin-v1`: an optional **3D estimate** in the same overlay for products with an approved
garment bundle (`packages/garment-viewer`, D16). Everything about the shopper stays on the device
(D3); every picture is labelled an estimate (rule 3); the size always comes from
`@curtain/fit-engine` on the device (rule 4).

## 1. Run the demo (no keys, no Docker)

```bash
flock /tmp/curtain-pnpm.lock pnpm install
pnpm demo            # api :8787 (PGlite in .demo-db), web :3000, demo storefront :5180
pnpm demo:e2e        # Playwright: both page styles, size peek, returning shopper, 3D estimate
pnpm check           # the root gate: build, typecheck, lint, tests, app builds, secret scan
```

| Page | What to try |
|---|---|
| http://localhost:5180/product/aalter-studio-1 | WooCommerce-style page, size advice only (no 3D bundle: today's flow) |
| http://localhost:5180/products/aalter-studio-1 | Shopify Dawn-style page, the same |
| http://localhost:5180/product/aalter-studio-2 | 3D estimate on a synthetic dress bundle (built by `pnpm demo`, about 8 s, CPU only) |
| http://localhost:5180/products/azure-palm-baby-doll-dress | 3D estimate on the evaluated azure babydoll bundle, when present |

Press "Try it on", fill in height and weight, then on the result press **See it in 3D (estimate)**.

**The azure bundle is not in git** (shop-derived: texture from the shop's photos). The demo reads it
from `spikes/garment-engine/out/eval/azure-palm-baby-doll-dress/` (where the report tooling writes
it) or from `DEMO_AZURE_BUNDLE=<folder>`. Without it the product is left out and the e2e 3D step on
the Dawn page says `SKIPPED`. The demo copies only the five bundle files (`base.glb`,
`anchors.json`, `grading.json`, `material.json`, `qa.json`) into `.demo-db/assets/`; the product's
`payload.json` gives the size chart, its photos are replaced by the storefront's own drawing.

The storefront uses no shop photos, but **the azure bundle's texture (`base.glb`) is baked from the
shop's product photos**, so the 3D view shows the shop's print. Keep that bundle local: do not host,
record or share a demo with it until the pilot merchant has approved it (D13). The synthetic
aalter-studio-2 bundle has no shop-derived content and can be shown anywhere.

Screenshots: `test-results/demo-e2e/` (or `DEMO_E2E_SHOTS=<folder>`).

## 2. Install on Shopify (custom app for the pilot)

Prerequisites are founder-owned (section 4): Partner account, the app, the VPS and domain, secrets.
Then, step by step (details in `docs/STATUS.md` "Install unlisted at the pilot shop" and `docs/DEPLOY.md`):

1. Deploy the backend to the VPS (`release` branch, `deploy` workflow) and check `https://api.<domain>/healthz`.
2. Run the `shopify-deploy` workflow: it renders `shopify.app.prod.toml`, bundles the SDK into the
   theme block and publishes the block, webhooks and GDPR topics.
3. Partner Dashboard → the app → Distribution → **Custom distribution** → the shop's
   `*.myshopify.com` domain → install link.
4. The merchant opens the link in their admin and approves `read_products`, `write_products`. The
   catalogue backfill starts by itself.
5. In the Curtain admin (about 10 minutes): pick the AU (or UK/EU/US) template, assign it to the
   Dresses collection, press "Add the block" and place it under the size picker, save the theme.
6. Test on a live product: Try it on → size → Choose size → the size is selected on the page.

**3D estimate for the pilot (optional, off by default).** Until D17 prices 3D:

```bash
# on the VPS, inside the api container (paths are the container's)
node dist/scripts/import-asset.js --shop <pilot>.myshopify.com --product <product external id> --dir /data/import/<bundle>
# locally against a dev database:
pnpm --filter @curtain/api asset:import --shop <shop> --product <id> --dir <bundle folder>
```

The import checks the bundle (format, at most 3 MB, QA `chartAgreement.pass`, every size of the
live chart graded) and stores it as `awaiting_approval`. It goes live only when **the merchant
approves it** (`POST /v1/merchant/assets/:id/approve`, D13) and the shop's switch is on
(`UPDATE shops SET settings = settings || '{"garment3d": true}' WHERE domain = '<shop>'`). If the
merchant later changes the size chart so a size is no longer graded, the 3D button disappears by
itself.
A rejected version cannot be approved; importing the same bundle again puts it back up for review.
Because there is no merchant approval UI yet (section 5), 3D at a real shop is **demo-only** for now:
do not switch it on for the pilot until the approval UI and the preview exist.

## 3. Install on WooCommerce

1. Build the plugin zip: `pnpm --filter @curtain/woocommerce-plugin build` (`packages/woocommerce-plugin/dist/`).
2. WordPress → Plugins → Add New → Upload → activate **Curtain**.
3. WooCommerce → **Curtain** → **Connect now**: proves the domain, creates the shop and, for a
   paid plan, opens Stripe Checkout (USD 8.99 per month, trial).
4. Per product: the **Curtain — fit data** meta box (size chart from a template or by hand). Saving
   pushes the product (HMAC-signed). The button appears under the variation form.
5. 3D: the same import and approval as Shopify; the plugin needs no change (the SDK opens the same overlay).

## 4. Founder-blocked (do not work around)

| Area | What is needed |
|---|---|
| Shopify | Partner account; the app named `Curtain: Fit & Size Finder` (trademark, checklist E1); a development store; `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (secret only in `/etc/curtain/curtain.env`), `SHOPIFY_CLI_PARTNERS_TOKEN`; custom distribution to the pilot's myshopify domain |
| Server | VPS, domain with `app.` and `api.` DNS, `DOMAIN` variable, `VPS_*` environment secrets, `ACME_EMAIL`, `BACKUP_AGE_RECIPIENT`, environment protection for `production` and `shopify` |
| Commercial | trial length (`BILLING_TRIAL_DAYS`, default 7); whether the pilot pays; whether 3D is in the USD 8.99 plan or extra (D17) |
| Legal | privacy and terms review (entity, retention, region, subprocessors); for 3D: "computed on the device, the garment file comes from our server", and the merchant's responsibility for approved assets (D13) |
| Live store | the "Must be verified against a live store" list in `packages/shopify-app/README.md` (needs Shopify + server first) |
| Garment engine | founder review of the azure bundle (run 17b against 16b; `data/bohohippychic/review.json`); the pilot merchant's approval of it; GPU credentials before new products can be processed (until then bundles are imported by hand) |
| WooCommerce | a real WordPress test site; Stripe keys and webhook secret |
| Listing | support e-mail, help page, trademark clearance, listing assets |

## 5. What is not covered yet

- A merchant approval **UI** (Shopify checklist row, Woo console row) and the approval preview page:
  the api routes exist (`GET /v1/merchant/products/:id/assets`, `POST /v1/merchant/assets/:id/approve|reject`), the buttons do not.
- No e2e against a real Shopify or WordPress install, billing or webhooks (unit tests only).
- The Caddy `/assets` block is pinned by a unit test, not yet run through a real Caddy: run
  `infra/scripts/caddy-validate.sh` before the first deploy that carries it.
- The 3D view is WebGL2 only and drapes in Web Workers; on devices without WebGL2 the button is hidden.
