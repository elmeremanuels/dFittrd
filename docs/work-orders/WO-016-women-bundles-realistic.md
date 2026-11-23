# WO-016: Women's garments on the realistic body (CUR-9, OI-143)

**Tier** full · **Linear** CUR-9 · Three iterations, as the founder decided on 23 Nov:
1. **Qwen** does the first build, the heavy work.
2. **Google** does the visual iteration.
3. **Claude** does the review, the hardening and the merge.

**Each iteration ends with a full handoff** in `docs/handoffs/WO-016-iterN-<builder>.md`, following `docs/handoffs/TEMPLATE.md`. The next iteration starts only from that handoff and the branch.

## Goal

Garments drape on the realistic body itself, not on the old ring-table ellipses. Skin never shows through a garment, and the fit and the sizes stay exactly as they are.

## Background (OI-143)

- Today the cloth collides with the ring table's ellipses.
- The realistic body's sections lie up to 1.5 to 2.4 cm outside them on the torso, and 1.3 to 1.8 cm on the arm. The spike hides that with `conformToField`, which pulls the skin inside the field under a garment, so under the garment the body is not the realistic one.
- Small patches of skin still show through the azure dress from behind.
- The real fix is a **collider sliced from the realistic mesh**: polar outlines per level, as male shape v2 already does. Every women's bundle and server bake must then be rebuilt and re-gated on that shape.

## Iteration 1: Qwen, the first build (`qwen/wo-016-women-bundles-realistic`, from the latest `claude/garment-engine`)

1. Build the collision field for the female realistic body from polar outlines sliced from the fitted mesh. Follow the male shape v2 code path: look for "polar" and "maleShape" in `packages/garment-viewer/src` and `packages/mannequin`.
2. Use it for the device drape when `bodyShape: 'realistic-spike'`. With the procedural body nothing changes.
3. Rebuild the women's bundles: `spikes/garment-engine/scripts/build-bundle.ts`, `build-dress-bundle.ts`, and the server bakes in `spikes/garment-engine/serverdrape`, all against the realistic shape. Keep the old bundles next to them until iteration 3.
4. Add tests that fail on the old field:
   - no skin vertex outside the cloth by more than 0.2 cm on the five test bodies, for the azure dress and the skirt;
   - the fit-engine output is unchanged, as a golden test.
5. All three gates must be green.
6. Write the handoff (iteration 1) with pictures: five bodies, front, three-quarter and back, with the dress and the skirt.

## Iteration 2: Google, the visual iteration (same branch, or `google/wo-016-…` from Qwen's head)

1. Start from Qwen's handoff.
2. Fix what looks wrong: the drape on the bust, waist and seat, the hem line, the clipping, the folds.
3. Remove `conformToField` under garments wherever it is no longer needed.
4. Make before and after sheets, and write the handoff (iteration 2).

## Iteration 3: Claude, review, hardening and merge

1. Run an independent review. Try to break the tests, check for D19 and D20 violations, and measure the performance.
2. Fix what the review finds.
3. Remove the old bundles, update OI-143 and `OPEN-ISSUES.md`, and merge into `claude/garment-engine`.
4. Write the final handoff and send the founder the pictures.

## Never
- Change the fit or the sizes. Sizing comes only from `@curtain/fit-engine`.
- Push to `main` or `claude/garment-engine` during iterations 1 and 2.
