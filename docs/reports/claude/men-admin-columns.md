# Men's chart columns in the merchant builders (branch `claude/men-admin-columns`)

Men's plan slice M2 put the men's columns into `@curtain/schema` and the fit engine. Its "Not done" list said the Shopify admin and WooCommerce surfaces could not enter them yet. They can now. A merchant can enter:

- **a men's tee chart** with chest, waist, shoulder, body length, sleeve and neck, and must say where the sleeve is measured from;
- **a men's chino chart in W/L** (one row per waist/leg size, e.g. 32/34) with waist, seat, thigh, rise and inseam.

Both surfaces check these charts in plain English. The PHP and TypeScript checks give the same answers, word for word, on shared cases. Women's charts and their screens are unchanged, shown pixel by pixel below. `packages/fit-engine` was not touched.

## What was built

### `@curtain/schema` (the one source both surfaces read)

- **`src/chartColumns.ts`** (new)
  - `wlAxesFromLabel` reads "32/34", "W32/L34", "w30 / l32" and "32x34".
  - `withWlAxes` adds axes to the rows of a W/L chart.
  - `checkChartColumns` is the plain-English check:
    - **Errors (blocking):**
      - in W/L mode, a label that is not waist/leg;
      - some rows with axes and some without;
      - the same waist × leg pair twice;
      - a garment chart with a sleeve column but no measuring point, or an unknown one.
    - **Warnings:** a value outside the usual range for its column.
  - `CHART_COLUMN_TEXT` holds the English text for these columns (D21).
  - `CHART_COLUMN_CASES` are the shared cases.
- **`chartTemplates.ts`**
  - `CHART_POINTS` gains `neck`, `sleeve`, `length` and `rise`. The women's six come first, unchanged, and inch conversion now covers the new columns.
  - `checkChart` runs `checkChartColumns`.
  - `ChartSpec` (typed rows) gains `sizeAxes: 'wl'` and `sleeveConvention`; `resolveChartSpec` reads the axes from the labels.
  - The builder caps go from 30 rows and 16-character labels to the schema's 60 and 24.
  - `chartPayload` writes `sleeveConvention`, but only when the chart has a sleeve column.
  - **Two new garment templates:**
    - `garment-mens-tee`: S–XXL preselected; columns chest, waist, shoulder, length, sleeve, neck.
    - `garment-mens-chino-wl`: 15 W/L sizes preselected, 40 available; columns waist, seat, thigh, rise, inseam; `axes: 'wl'`.
    - Both are blank forms: no numbers, no sources. So they are offered.
  - **The men's body templates are still held back** (`legalReview: 'pending'`, not offered). The test that pinned "no men's template offered" now pins "no men's body template offered". It also checks that the two garment templates carry no rows or sources.
- **Mappings**
  - New `coerceSleeveConvention`. It accepts "Centre back", "center-back" and "shoulder seam"; anything else gets a warning and is left out.
  - WooCommerce meta `_curtain_sleeve_convention`.
  - Shopify metafield `sleeve_convention`: a new definition, with Shopify `choices` validation.

### Shopify admin (`packages/shopify-app`)

- **Column headers:** a men's template shows Chest, Seat, Neck, Sleeve, Length and Rise.
- **Help line:** the men's templates have their own help line (top or bottom).
- **W/L hint:** shown under a W/L template.
- **"The sleeve is measured …" question:** two radios, shown only when the template has a sleeve column. The request sends `sleeveConvention` and `sizeAxes: 'wl'`.
- **Refusals:** when the API refuses a chart (`invalid_chart`) before writing anything, its plain-English reasons now appear next to the chart instead of under "Assign".
- **Women's templates render exactly as before:** the new elements are hidden for them, and the women's header labels are unchanged.
- The page config carries `chartColumns: CHART_COLUMN_TEXT`.
- API (`apps/api/src/shopify/charts.ts`): no change needed. It already runs `resolveChartSpec`, `checkChart` and `chartPayload`, so `sleeve_convention` is written with the chart.

### WooCommerce (`packages/woocommerce-plugin`)

- **`Chart_Columns`** (new) is the PHP twin of `chartColumns.ts`, with the same English strings through `__()`.
- **`Vocab`**
  - `FIT_POINTS` gains `neck` and `sleeve`, as in TypeScript.
  - New constants: `FORM_FIT_POINTS`, `MENS_FIT_POINTS`, `MENS_SIZE_COLUMNS`, `SLEEVE_CONVENTIONS`, `SIZE_LABEL_MAX = 24`, `SIZE_CHART_MAX_ROWS = 60`.
  - `SIZE_ROW_COLUMNS` gains the four men's columns.
  - `META_KEYS` gains `_curtain_sleeve_convention`.
  - The `hip` column is headed "seat" on a men's product.
- **`Payload_Builder`** (twin of `fromWooMeta`)
  - Reads neck, sleeve, length, rise and axes, plus `seat` and `collar` as names for hip and neck.
  - Reads the sleeve measuring point.
  - Drops a chart that `SizeChartSchema` would refuse, with zod's first issue as the warning, as the TS mapping does: an axis without a label, more than 60 rows, mixed axes, a W/L pair twice, a label twice.
- **`Schema_Validator`**: now also checks the two W/L rules (axes on every row or none; each pair once), with zod's words and paths. `size_chart_rule_issues` is shared with the builder.
- **`Sanitizer`** (the meta box POST)
  - The "Sizes are waist/leg (W/L)" box writes axes from the labels.
  - The cap goes from 30 to 60 rows, and labels can be 24 characters.
  - `sleeve_convention` is stored only with a sleeve column.
  - **On a blocking error, nothing of the chart is saved** (chart, type and measuring point are left as stored). What was typed comes back with the messages, as the Garment measurements table already did.
- **Meta box** (`Product_Meta`, `meta-box.js`, CSS)
  - The men's columns, the W/L box, the sleeve select and the neck/sleeve fit-point boxes have the class `curtain-mens-col`.
  - They are hidden unless the product is a men's product, or the chart already has those columns, axes or a measuring point.
  - Picking "Made for: men" or a men's template shows them, and picking the chino template ticks W/L.
  - The chart's messages (`_curtain_chart_issues`) are shown under the chart, and are only shown while the stored chart is still the one they were written against.
- **Templates asset:** `chart-templates.json` now carries `audience` and `axes` for the garment templates.
- **Translation template:** `.pot` regenerated.

### Shared fixtures (PHP ↔ TypeScript)

`scripts/export-fixtures.mjs` now also writes `tests/fixtures/mens-charts.json`. `tests/chart-columns.test.php` replays it:

| What | Cases | Compared |
|---|---|---|
| `checkChartColumns` ↔ `Chart_Columns::check` | 11 | errors and warnings, word for word |
| `wlAxesFromLabel` ↔ `wl_axes_from_label` | 11 labels | the axes |
| `SizeChartSchema` ↔ `Schema_Validator` | 10 charts (incl. 31, 61 rows; 24 and 25-character labels) | accept or refuse, plus the W/L and duplicate-label messages and paths |
| `fromWooMeta` ↔ `Payload_Builder` | 12 men's products | the whole payload and the warnings |

The 12 products cover: the tee with neck, sleeve and length; measuring-point aliases and an unknown one; the W/L chino; seat and collar names; axes written as numbers; mixed axes; a pair twice; an axis without a leg; a label twice.

## Women's charts unchanged: the proof

- **Tests:** every existing test passes, with three exceptions that were changed on purpose because they pinned behaviour from before M2. In each case TypeScript already behaved the new way since M2:
  - `neck` is now kept as an ease and critical fit point (PHP builder and sanitizer tests);
  - the "no men's template is offered" tests now say "no men's *body* template is offered" (schema, Shopify admin, WooCommerce asset).
- **Pixels:** each women's screen was captured on the code before this branch (`docs/screens/claude/men-admin-columns/before/`) and again after, at deviceScaleFactor 2. Every file below is pixel-identical (no pixel differs):

| Surface | State | Phone | Desktop |
|---|---|---|---|
| Shopify chart editor | AU body template (as the page opens) | identical | identical |
| Shopify chart editor | dresses & tops garment template | identical | identical |
| WooCommerce meta box, whole box | AU 8–16 body chart | identical | identical |
| WooCommerce meta box, whole box | dress measured flat (garment) | identical | identical |

The Shopify comparison is of the editor ("Check the numbers" down to the check message), with the template list above it hidden for that one shot. The list itself does change: it gains the two men's garment templates. Compare `shopify-*-women-*.png` (full section, after) with `before/` to see that.

## Screenshots (`docs/screens/claude/men-admin-columns/`)

All at deviceScaleFactor 2: phone 390 px, desktop 1280 px.

- **Shopify** (`shopify-{phone,desktop}-…`):
  - `women-body`, `women-garment`, and their `-editor` crops;
  - `men-tee-1-convention-missing`: the plain-English error;
  - `men-tee-2-assigned`: after picking the shoulder seam;
  - `men-chino-1-not-wl`: a size "33" in the W/L chart;
  - `men-chino-2-assigned`.
  - `assigned-desktop-men-chino.json` is the chart the harness API received: 15 rows, each with axes, rise and inseam.
- **WooCommerce** (`woo-{phone,desktop}-…`):
  - `women-body` and `women-garment`, as `-box` and `-chart`;
  - `men-tee-chart`;
  - `men-tee-error-chart`: "These size chart changes were not saved: … say where the sleeve is measured from …";
  - `men-chino-chart` (seat, rise, inseam, W/L ticked);
  - `men-chino-error-chart` ("Size 33 is not a waist/leg size …").
- PNGs are palette-quantized (128 colours) to keep the folder at 6 MB. The before and after files went through the same step, so the comparison holds.

## Measured vs assumed

- **Measured:** the pixel comparisons above; the test suites (schema 553, shopify-app 174, PHP 111, API shopify routes 84); `pnpm check` green.
- **Assumed [A]:** the plausible ranges for the new columns.
  - neck 30–55 cm, body length 45–100 cm, rise 15–45 cm;
  - sleeve 10–75 cm from the shoulder seam and 35–100 cm from the centre back, 10–100 cm when the point is unknown or the chart is a body chart.
  - These are trade knowledge, not read from charts, and only give warnings.
- **Not proven in real WordPress or Shopify:** the screenshots come from harnesses.
  - The Shopify page is real `renderAdminPage()` output, with a stub App Bridge and an in-process API running the real schema code.
  - The WooCommerce box is real PHP rendered with the test shims and the plugin CSS. Its jQuery behaviour (showing the men's columns when "men" or a men's template is picked) is not run there.
  - The Docker WordPress e2e (`e2e/run.mjs`) was not run.

## Open issues

- **Shopify: a stale measuring point.** Re-assigning a chart without a sleeve column does not delete an older `sleeve_convention` metafield, because `metafieldsSet` cannot delete. The engine only reads the point when the chart has a sleeve column, so the fit is not affected, but the stale value stays in the shop.
- **Shopify: existing shops.** The `critical_fit_points` metafield's Shopify `choices` validation still lists the 7 women's points. The new `sleeve_convention` definition is only created by the install or definition-sync path; existing shops need that path run again.
- **WooCommerce: a 61st row is silently cut.** The cap was 30 before and is 60 now, but any row past the cap is dropped without a message, so it is never checked.
- **WooCommerce: showing the men's columns.** The meta box only shows them on a men's product, a chart that has them, or after picking a men's template. A merchant typing a men's chart into a product whose audience is "infer" and empty must first pick "Made for: men" or a template.
- **Gates unchanged.** The men's body templates are still held back (legal review). Men's products still show "coming soon" in the shopper flow (D20, M0). These columns only make the data ready.
- **PHP rows without a size label.** `Payload_Builder` still skips a row without a size label, while TypeScript refuses the whole chart. This predates the branch; the shared fixtures avoid that case.

## Commands

```sh
pnpm install --frozen-lockfile
npm_config_workspace_concurrency=1 pnpm check            # all green
pnpm --filter @curtain/schema test                       # chartColumns.test.ts
pnpm --filter @curtain/shopify-app test                  # adminCharts.test.ts (men's garment templates)
pnpm --filter @curtain/woocommerce-plugin test           # exports fixtures, then tests/chart-columns.test.php
node packages/shopify-app/scripts/chart-builder-shots.mjs <outDir> [women-body,women-garment,men-tee,men-chino]
node packages/woocommerce-plugin/e2e/chart-meta-box-shots.mjs <outDir> [women-body,…,men-chino-error]
```
