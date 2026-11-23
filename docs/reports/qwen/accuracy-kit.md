# Accuracy kit (CUR-32, WO-018) — Report v2

**Builder:** Qwen · **Linear:** CUR-32 · **Branch:** `qwen/wo-018-accuracy-kit`
**Model:** Claude Sonnet 4.5 (Qwen Code) — fixing review by Claude

## Done

- `docs/ACCURACY-PROTOCOL.md` — the protocol (six measurement points, tape procedure, scan procedure, consent wording, privacy rules, D19 no photo ever taken)
- `scripts/accuracy-report.ts` — the report script (CSV → per-point stats → console table + markdown report)
- `scripts/accuracy-report.test.ts` — **10 tests** (moved out of `packages/fit-engine` per Claude's review: engine must stay pure, AGENTS.md rule 5)
- `scripts/package.json`, `scripts/vitest.config.ts`, `scripts/tsconfig.json` — new workspace package for scripts with its own vitest config
- `scripts/data/accuracy-sample.csv` — synthetic 4-row fixture (committed)
- `scripts/data/.gitignore` — keeps real volunteer CSVs out of git
- `docs/reports/qwen/accuracy-report-accuracy-sample.md` — generated output on sample CSV
- `pnpm-workspace.yaml` — added `scripts` as a workspace package
- Fixed lines 74-75 of `accuracy-report.ts`: `ACCURACY_POINTS[i]!` (non-null assertion for `noUncheckedIndexedAccess`)

## Measured (real output)

```
$ pnpm --filter @curtain/scripts test
 ✓ accuracy-report.test.ts (10 tests) 11ms
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ pnpm --filter @curtain/fit-engine test
 Test Files  10 passed (10)
      Tests  258 passed (258)
(accuracy-report test no longer in fit-engine — engine stays pure)

$ pnpm -r --filter '!@curtain/woocommerce-plugin' ... typecheck
(exit 0 — all TypeScript packages clean)

$ pnpm -r --filter '!@curtain/woocommerce-plugin' ... lint
(exit 0 — no warnings)

$ node scripts/check-bundle-secrets.mjs
✓ no secret-looking strings in client bundles

$ node scripts/check-language-packs.mjs
language packs: en on all 5 surfaces
```

Script output on sample CSV:
```
Point       n   mean  median  p90   max   ≤1cm  ≤2cm  ≤3cm
height        4   +0.02   0.35  0.47  0.50 100 % 100 % 100 %
shoulder      4   +0.45   0.45  0.50  0.50 100 % 100 % 100 %
bust          4   +0.15   0.55  1.02  1.20  75 % 100 % 100 %
waist         4   -0.13   0.75  0.94  1.00 100 % 100 % 100 %
hip           4   +0.75   0.70  1.01  1.10  75 % 100 % 100 %
inseam        4   +0.10   0.40  0.54  0.60 100 % 100 % 100 %
```

## Not verified

- `pnpm check` full pipeline: `@curtain/woocommerce-plugin` build fails because PHP is not installed on this machine (`php: command not found`). All TypeScript gates (typecheck, lint, unit tests, bundle secrets, language packs) pass.
- `pnpm demo:e2e`: Playwright browsers are not installed on this machine.

## Open issues

None specific to this work order.

— Qwen (Claude Sonnet 4.5)
