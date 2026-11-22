# WO-007: WooCommerce size chart: no silent cut at 60 rows, and the same rule as TypeScript for a row without a label

**Tier** light · **Builder** Qwen · **Branch** `qwen/wo-007-woo-chart-rows`, cut from `claude/garment-engine`.

## Goal

The WooCommerce plugin treats a size chart the way the TypeScript side does, and tells the merchant when it cannot
keep a chart (OI-87, OI-89).

## Background

- **OI-87.** The meta box sanitizer cuts a chart to 60 rows without a word
  (`array_slice( $rows, 0, Vocab::SIZE_CHART_MAX_ROWS )` in `includes/class-sanitizer.php`). The 61st row is never
  checked and the merchant never hears about it.
- **OI-89.** `Payload_Builder` skips a chart row that has no size label (`includes/class-payload-builder.php`, the
  `continue` after `coerce_string`), while TypeScript's `SizeChartSchema` refuses the whole chart. So the two sides send
  different charts for the same input.
- Empty rows of the meta box form (every field blank) are not rows and may still be skipped. A row with numbers but no
  label is the case above.

## Files

You may change only these:

- `packages/woocommerce-plugin/includes/class-sanitizer.php`
- `packages/woocommerce-plugin/includes/class-payload-builder.php`
- `packages/woocommerce-plugin/tests/` (new or extended `*.test.php` files and fixtures)
- the English string catalogue the plugin's notices already use, only to add one notice (D21: English only)
- Not `docs/OPEN-ISSUES.md`: three open orders would share it. Put the new state of each open issue (fixed, and how) in your report's *Open issues* section; Claude updates `OPEN-ISSUES.md` at the merge.
- `docs/reports/qwen/woo-chart-rows.md` (new)

## Done when

- **61 rows:** saving a chart of 61 rows keeps the chart as it was before, or keeps none, and shows the merchant a
  notice that a chart has at most 60 rows. It is never cut silently. A test fails on the old code.
- **No label:** a chart with one row that has numbers but no size label is refused as a whole by `Payload_Builder`,
  with a warning whose text matches what the TypeScript side reports for the same chart. A test fails on the old code.
  If the shared fixtures (`scripts/export-fixtures.mjs`) hold a parity case for this, add one.
- A row with every field blank is still ignored, with a test.
- `pnpm --filter @curtain/woocommerce-plugin test`, `pnpm install --frozen-lockfile` and `pnpm check` are green.
- The report has the sections *Done*, *Measured*, *Not verified* and *Open issues*, and names the model.
