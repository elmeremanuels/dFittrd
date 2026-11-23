# Handoff: WO-NNN iteration N (<builder>, <model>), <date>

Write this file at the end of every iteration of a multi-builder work order. Save it as `docs/handoffs/WO-NNN-iterN-<builder>.md` on your branch. The next builder starts from it, so make it complete enough that they need nothing else.

## 1. Where it stands
- Branch, last commit, base branch and base commit.
- The gates you ran yourself, with the last 20 lines of the real output of each: `pnpm check`, `pnpm demo:e2e`, `DEMO_SKIRT=pom pnpm demo:e2e`.

## 2. What was built
- Per file: what changed and why. Keep it to one or two lines each.
- The design choices you made, and the alternatives you rejected.

## 3. What works, as measured
- Numbers: girths, clearances, frame times, test counts.
- Pictures: paths under `docs/screens/<builder>/<slug>/`, and the key ones embedded in the Linear issue.

## 4. What does not work yet
- Known defects, each with a picture or a failing case.
- Anything you skipped, and why.

## 5. Not verified
- What you could not run or check, for example no GPU, no PHP or no real phone.

## 6. Advice for the next iteration
- The concrete next steps, in order, with the files involved.
- Traps you hit, and how to avoid them.

## 7. Open issues
- New or changed OI rows. Claude adds them to `OPEN-ISSUES.md` at the merge.
