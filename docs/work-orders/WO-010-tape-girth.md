# WO-010: Tape girth at chest and hip (D30, OI-141)

**Tier** full · **Builder** Claude · **Linear** CUR-23 · **Branch** `claude/realistic-body`. Do it after the hip-seam fix (CUR-21), because both touch `realisticBody.ts`.

## Goal

At chest and hip, the realistic body's fit matches the typed girth as a tape measure would read it: the convex hull of the section. At the other levels it keeps using the loop girth.

## Done when

- The independent slicer `test/independentSlice.ts` reports the tape girth at chest and hip, and the girth tests compare tape at those two levels.
- A test fails on the old fit, where the loop matched but the tape was larger.
- The worst girth error stays below 0.5 % on the five test bodies.
- There are before and after pictures, OI-141 is updated, and the gates are green.
