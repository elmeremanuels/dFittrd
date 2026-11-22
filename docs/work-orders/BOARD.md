# Work order board

**The live board is Linear, team Curtain (`CUR`). Linear is the source of truth for status, questions and answers.** This file lists the work orders and their Linear issues. Work order texts stay in this folder.

Statuses: `open` → `building` → `review` → `done`, or `blocked`. See `docs/COORDINATION.md` for the process.
Branch names: Claude builders use `claude/wo-NNN-<slug>`, Google builders `google/wo-NNN-<slug>` and Qwen `qwen/wo-NNN-<slug>`. All branches
are cut from `claude/garment-engine`.

| WO | Linear | Title | Tier | Builder | Status | Depends on |
|---|---|---|---|---|---|---|
| 001 | CUR-5 | [001](WO-001-body-merge-arms.md) | Merge hair into the realistic body; shorten the arms | full | Claude | open | — |
| 002 | CUR-6 | [002](WO-002-skin-v3.md) | Better skin, measured frame time | full | Google | open | 001 |
| 003 | CUR-7 | [003](WO-003-hair-cost.md) | Long and shoulder hair within the body's frame cost | full | Google | open | 001 |
| 004 | CUR-8 | [004](WO-004-review-skin-hair.md) | Independent review of skin and hair | full | Claude | open | 002, 003 |
| 005 | CUR-11 | [005](WO-005-privacy-compression.md) | Privacy e2e with the realistic body on; body file compressed | full | Qwen | open | 001 (branch from claude/realistic-body) |
| 006 | CUR-19 | [006](WO-006-usage-401.md) | Merchant routes answer 401 without a key | light | Qwen | open | — |
| 007 | CUR-20 | [007](WO-007-woo-chart-rows.md) | WooCommerce chart: no silent cut, same rule as TypeScript | light | Qwen | open | — |

General discussion: Linear issue CUR-17 (Overleg). Questions for the founder carry the label `Wacht op founder`.
