# WO-003: Shoulder and long hair within the body's frame cost

**Tier** full · **Builder** Google · **Branch** `google/wo-003-hair-cost`, cut from
`claude/realistic-body` once WO-001 is done.

## Goal

Under D28, hair may cost no more than the body itself. Today shoulder hair adds 38 to 51 ms and long hair adds 51 to
63 ms, against 33 ms for the body (OI-171, `docs/reports/claude/realistic-hair.md`). Bring shoulder and long hair
within that bound without losing the look of the type.

## Files

- `packages/garment-viewer/src/realisticHair.ts`
- `packages/garment-viewer/src/realisticHairDraw.ts`
- `packages/garment-viewer/src/realisticHair.test.ts`
- `spikes/garment-engine/viewer/realistic-hair-*.mjs`
- `docs/screens/google/hair-cost/`
- `docs/reports/google/hair-cost.md`

Do not touch `realisticSkin.ts` or `studioLight.ts`. WO-002 owns them.

## Done when

- Frame time is measured for all 40 combinations with the same method as the hair report, and shoulder and long hair
  are within the body's own cost.
- If that is not possible, the report says by how much it misses and why.
- New sheets of the 40 combinations sit next to the old ones, so the look can be compared.
- `pnpm check` is green.
- The report names the model or models used.
