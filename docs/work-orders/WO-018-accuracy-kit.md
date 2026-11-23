# WO-018: Accuracy kit: tape measure against scan (phase C)

**Tier** light · **Builder** Qwen · **Branch** `qwen/wo-018-accuracy-kit`, from the latest `claude/garment-engine`.

## Goal

We need to prove that the scan measures what a tape measure measures, on real people. Build the kit for that. Collect no data yet.

## What to build

- `docs/ACCURACY-PROTOCOL.md`, in English:
  - how to tape-measure a volunteer: which points, how tight, standing how;
  - how to run the scan on a phone;
  - consent wording for the volunteer.
  - Only measurements are recorded, never a photo (D19). The founder reviews the consent wording with Naomi.
- `scripts/accuracy-report.ts`: reads a CSV of anonymous rows (volunteer id, tape values, scan values per point) and prints per point the mean error, the spread and the share within 1, 2 and 3 cm. It also writes a markdown table.
  - Add tests with a synthetic CSV.
  - Do not commit any real data. The CSV path is gitignored.

## Done when

The script and its tests pass, the protocol is written, `pnpm check` is green, and the report is `docs/reports/qwen/accuracy-kit.md`.
