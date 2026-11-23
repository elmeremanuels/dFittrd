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
| 006 | CUR-19 | [006](WO-006-usage-401.md) | Merchant routes answer 401 without a key | light | Qwen | done | — |
| 007 | CUR-20 | [007](WO-007-woo-chart-rows.md) | WooCommerce chart: no silent cut, same rule as TypeScript | light | Qwen | done | — |
| 008 | CUR-21 | [008](WO-008-hip-seam.md) | Seam at the hip line of the realistic body | full | Google (Claude if shape) | open | 001 (branch from claude/realistic-body) |
| 009 | CUR-22 | [009](WO-009-base-layer.md) | Base layer (vest and briefs) on the realistic body (D30) | full | Google | open | — |
| 010 | CUR-23 | [010](WO-010-tape-girth.md) | Tape girth at chest and hip (D30, OI-141) | full | Claude | open | 014 (same file: realisticBody.ts) |
| 011 | CUR-24 | [011](WO-011-view-per-garment.md) | Starting view per garment type (D30) | full | Qwen | done | — |
| 012 | CUR-26 | [012](WO-012-hair-look-v2.md) | Hair look v2: no ribbons, last 10 combinations within budget | full | Google | open | 003 |
| 013 | CUR-10 | [013](WO-013-hair-picker.md) | Hair picker in the embed (OI-170, D28) | full | Qwen | open | realistic body on garment-engine |
| 014 | CUR-27 | Linear only | Body iteration 2: hip seam, shoulder and upper arm, knees | full | Google | building | 008 |
| 015 | CUR-28 | Linear only | Skin tone as a slider from light to deep | full | Qwen | open | — |

Not a work order: CUR-25 (AI render, nipples faintly visible through thin fabric, D30) is in the backlog.

General discussion: Linear issue CUR-17 (Overleg). Questions for the founder carry the label `Wacht op founder`.
