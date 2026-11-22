# WO-004: Independent review of skin and hair

**Tier** full · **Builder** Claude (Google built WO-002 and WO-003) · **Branch** none (reading only).

## Goal

Find what is wrong with the skin (WO-002 and the commits before it) and the hair (claude/realistic-hair and WO-003)
before they are merged.

## How

- Try to break the tests. Change the code on purpose, for example by removing a step or swapping a value, and see
  whether a test fails. A test that stays green when the code is broken is a finding.
- Read for violations of D19, D20, D27 and D28. Hair or skin data must never leave the device, and the export passes
  must leave the hair out.
- Check the licences.
- Check that the numbers in the reports can be reproduced.

## Output

`docs/reports/claude/review-skin-hair.md`, with one table: finding, severity, how it was checked, where in the code.
Fix nothing.
