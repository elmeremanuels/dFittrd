# WO-001: Merge hair into the realistic body and shorten the arms

**Tier** full · **Builder** Claude · **Branch** `claude/realistic-body`. This is an exception to the usual rule: the
work continues on the spike branch.

## Goal

Get one branch with body, skin and hair together, whose arms end where a real arm ends.

## Files

- `packages/garment-viewer/src/` (realisticBody*, realisticHair*, mount.ts)
- `scripts/bake-realistic-body.ts`
- `assets/realistic-body/`
- `spikes/garment-engine/viewer/`
- `docs/OPEN-ISSUES.md`
- the reports named below

## Steps

1. Merge `claude/realistic-hair` into `claude/realistic-body`. Expect conflicts in `mount.ts`, `avatarMain.ts` and
   OPEN-ISSUES.
2. Arms (founder, 21 Nov: "the arms are a bit too long"). Compare the drawn shoulder-to-wrist length and the hand
   length with the ring table's arm, and with ordinary human proportions. With the arms hanging, the fingertips should
   end at about mid-thigh. Fix this in the fit or the bake.

## Done when

- A test fails on the current arm length and passes after the fix.
- All five test bodies are checked.
- The girth tests stay green.
- With hair and skin on, the pictures show the hair still sits on the skinned body.
- New sheets are in `docs/screens/claude/realistic-body/`, before and after.
- `pnpm check`, `pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e` are green.
- A section on the arms is added to `docs/reports/claude/realistic-body-spike.md`.
