# WO-012: Hair look v2: no ribbons, and the last 10 combinations within budget

**Tier** full · **Builder** Google · **Linear** CUR-26 · **Branch** `google/wo-012-hair-look-v2`, cut from `google/wo-003-hair-cost`, or from `claude/realistic-body` once CUR-7 is merged.

## Goal

The hair reads as hair, not as ribbons or cards, up close (OI-172) and at the three-quarter view the founder prefers. The ten combinations that still miss the frame budget after WO-003 fit within it: 3A and 3C shoulder, 1, 2A to 2C, 3A to 3C and 4C long.

## Files

- `realisticHair.ts`, `realisticHairDraw.ts`, `realisticHair.test.ts` and the hair render scripts.
- Pictures go in `docs/screens/google/hair-look-v2/`. The report is `docs/reports/google/hair-look-v2.md`.

## Done when

- The sheets show all 40 combinations (front and back three-quarter), plus close-ups of 1 long, 3B long and 4C long, before and after.
- Each type still reads as its own type (D28).
- The frame time of all 40 is measured. Each combination that still misses has its overshoot stated.
- No third-party hair asset is used and nothing is traced from the founder's reference photos (D28).
- `pnpm check` is green, and the report names the model.
