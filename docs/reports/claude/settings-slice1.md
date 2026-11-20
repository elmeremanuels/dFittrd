# Settings slice 1 — incomplete fabric, shop settings, D25 items

Branch `claude/settings-slice1`, merged into `claude/garment-engine` on 20 Nov 2026. Built by three builders in sequence, reviewed through three lenses (correctness, rules, merchant's eyes), fixed, then gated by the orchestrating session. The builder of the last step stopped on the usage limit before it wrote this report, so the orchestrator wrote it from the builders' own notes and ran the gates itself.

## What was built

- **Incomplete fabric (D25 point 1).** A fabric with only a name, or with a value the schema refuses (stretch 150), no longer gets the product refused. Only the missing or invalid part is left out; the rest of the fabric and the chart are kept. Same rule in the plain api, the Shopify mapping and the WooCommerce builder (PHP twin, 13 shared fixtures).
- **Shop setting "Products with incomplete fabric details" (D24, D25 point 2).** Two choices: show size advice anyway (default) or hold the product back. Stored per shop (migration 0008), `GET/PUT /v1/merchant/settings`. A held-back product is stored as not ready with its reason and answers success, so a chart fix in the same save is kept; it is served on no shopper route.
- **Settings page** in the web console (`/merchant/settings`): the setting above, the switch "Show 'Fit by Curtain'" (D25 point 7; the Estimate labels always stay), shop name, brand colour, logo address. Not a step in "Get set up".
- **Notices.** The product list says which fabric value was left out and why, and shows "Held back" with what to add (migration 0009 stores the left-out values). The WooCommerce product box shows the same. The popup says in one line when fabric stretch was not taken into account.
- **Paused plan (D25 point 5).** The button is hidden; it is printed hidden and shown by the SDK once the shop's status is known.
- **Age range (D25 point 6).** Removed from the shopper form.
- **Repairs from the inventory.** One bad Shopify product no longer stops a sync or backfill page (R1); the stars on stretch and drape in WooCommerce are gone and the help line is true (R2 in part, R3); the Shopify description import no longer pre-ticks an estimated stretch (D18, F20).

## Measured

- Before the change, a name-only fabric failed on all three paths (HTTP 400 on the merchant PUT, a ZodError on the Shopify sync path). The tests were written first and seen to fail.
- Advice for complete products is byte-identical: a hash over `computeFit` and `recommendSize` for every mock garment on four bodies, pinned before the change, still matches.
- `npm_config_workspace_concurrency=1 pnpm check`: exit 0. `pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e`: 3 flows passed each. Run on `claude/garment-engine` after the merge.

## Found, and needs a decision

- **A missing stretch read as 0 % does not always err on the safe side.** The inventory said it could never recommend a tighter size. Run on the mock garments, for one very stretchy bottom (35 % stretch, body chart) it recommended a smaller size for 3 of 4 test bodies; in 8 other cases a larger size, 120 unchanged. The engine was not changed. The popup line tells the shopper; whether "show anyway" is the right default for very stretchy garments is the founder's call.
- **Shopify merchants cannot reach the settings page yet.** It lives in the web console; the Shopify admin has no Settings section and Shopify merchants are told they do not need the console. For the pilot shop this is the next thing to build.
- **The legal texts were edited** to follow D25 points 5 and 6 (`docs/legal/terms.md`, `docs/legal/privacy.md`); counsel has not seen the new wording (OI-111).

## Not done

- The one-time sign-in link from the plugins into the console (inventory S2, founder decision 11).
- Nothing ran in a real WordPress, a real Shopify theme or a real browser on a shop page; the hidden button is tested in jsdom and by reading the markup. Migrations 0008 and 0009 ran on PGlite only.
- The size peek next to the button does not say that stretch was assumed (OI-112). The builders' warnings are English sentences in the mapping code, in no catalogue (OI-113). The SDK is 5 bytes under its budget (OI-114). The logo address is stored but not drawn (OI-117).
- Other stars in the WooCommerce box and the "required before active" lines are no longer true and were left (R2, rest).
- A tape row for a size that is not in the chart still answers 422; only fabric data follows the new setting.

## Screenshots (`docs/screens/claude/settings-slice1/`)

Console pictures show the console's demo data (banner "API unreachable"), not a live api.

- `01-settings-page.png`, `02-settings-hold-back-wordmark-off.png`: the Settings page with each choice.
- `03-products-notices.png`, `03b-…`, `03c-…`: the product list with a left-out value and a held-back product. On a phone the "Held back" chip is cut off to the right; the wide picture shows it.
- `04-popup-stretch-line.png`: the shopper line. The demo garment also has a stretch zone, so a line below it speaks of stretch fabric; that is the mock.
- `05` to `08`: the popup with and without "Fit by Curtain".

## Reproduce

```
pnpm install --frozen-lockfile
npm_config_workspace_concurrency=1 pnpm check
pnpm demo:e2e && DEMO_SKIRT=pom pnpm demo:e2e
pnpm --filter @curtain/schema test -- incompleteFabric
pnpm --filter @curtain/api test -- incomplete-fabric
```
