# Work order board

Statuses: `open` → `building` → `review` → `done`, or `blocked`. See `docs/COORDINATION.md` for the process.
Branch names: Claude builders use `claude/wo-NNN-<slug>` and Google builders use `google/wo-NNN-<slug>`. All branches
are cut from `claude/garment-engine`.

| WO | Title | Tier | Builder | Status | Depends on |
|---|---|---|---|---|---|
| [001](WO-001-body-merge-arms.md) | Merge hair into the realistic body; shorten the arms | full | Claude | open | — |
| [002](WO-002-skin-v3.md) | Better skin, measured frame time | full | Google | open | 001 |
| [003](WO-003-hair-cost.md) | Long and shoulder hair within the body's frame cost | full | Google | open | 001 |
| [004](WO-004-review-skin-hair.md) | Independent review of skin and hair | full | Claude | open | 002, 003 |

Waiting on the founder: see the "Founder decisions" list in
`docs/reports/claude/coordinator-handoff-2026-11-21.md`.
