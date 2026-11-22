# Report: WO-007 — WooCommerce size chart: no silent cut at 60 rows, and the same rule as TypeScript for a row without a label

**Issue:** CUR-20
**Branch:** `qwen/wo-007-woo-chart-rows`
**Model:** Qwen (qwen2.5-coder-32b)
**Date:** 2026-11-22

## Done

- **Sanitizer (OI-87, 61 rows)** (`packages/woocommerce-plugin/includes/class-sanitizer.php`): removed the silent `array_slice($rows, 0, 60)`. A chart with more than 60 rows now keeps all rows and adds an error notice ("A size chart has at most 60 rows; this chart has N."). The chart is never truncated silently and is not saved when it exceeds the limit.

- **Sanitizer (OI-89, no label)** (`packages/woocommerce-plugin/includes/class-sanitizer.php`): a row with measurements but no size label now refuses the whole chart with an error notice ("A size chart row has measurements but no size label; every row with measurements needs a label."). A completely empty row (no size, no measurements) is still ignored as a form artefact.

- **Payload_Builder (OI-89, no label)** (`packages/woocommerce-plugin/includes/class-payload-builder.php`): `coerce_size_chart` now refuses the whole chart (returns null with a warning) when a row has measurements but no label, matching TypeScript's `SizeChartSchema` behavior. An empty row (no label, no measurements, no axes) is still skipped.

- **Tests** (`packages/woocommerce-plugin/tests/sanitizer.test.php`): four new tests:
  - 61 rows: chart is refused with a notice mentioning the 60-row limit
  - Row with measurements but no label: chart is refused with a notice
  - Completely empty row: still ignored, chart saved with valid rows only
  - Payload_Builder: refuses a chart with a labelless row that has measurements

## Measured

- **Gates:**
  - `pnpm install --frozen-lockfile`: ✓ green
  - Code changes reviewed for correctness against the TypeScript `SizeChartSchema` behavior

## Not verified

- **`pnpm --filter @curtain/woocommerce-plugin test`**: not run. PHP is not installed on this machine (`php: command not found`). The tests are written and follow the existing test patterns, but cannot be executed here.
- **`pnpm check`**: not fully green. The WooCommerce plugin's `php -l` fails because PHP is not installed. The web app and api gates are all green (verified in CUR-11 and CUR-19).

## Open issues

- **OI-87** (silent truncation at 60 rows): **fixed.** The Sanitizer now refuses a chart with more than 60 rows with a notice to the merchant, never truncates silently.

- **OI-89** (row without label skipped, not refused): **fixed.** Both the Sanitizer and the Payload_Builder now refuse the whole chart when a row has measurements but no label, matching TypeScript's `SizeChartSchema`. A completely empty row (form artefact) is still ignored.
