# WO-009: Base layer on the realistic body (D30)

**Tier** full · **Builder** Google · **Linear** CUR-22 · **Branch** `google/wo-009-base-layer`, cut from the latest `claude/realistic-body`.

## Goal

The realistic body always wears a plain fitted vest and briefs in the live 3D view (D30). A garment being tried on replaces the part of the base layer it covers.

## Files

- New: `packages/garment-viewer/src/baseLayer.ts` and `baseLayer.test.ts`.
- `realisticBodyLoad.ts`: only to attach the layer.
- Pictures go in `docs/screens/google/base-layer/`. The report is `docs/reports/google/base-layer.md`.

Do not touch `realisticBody.ts` (Claude's fit work), `realisticSkin.ts`/`studioLight.ts` (CUR-6) or the hair files.

## Done when

- The vest and briefs are generated in code from the fitted body. That is either a thin offset of the body surface by region (chest to hip for the vest, hip to upper thigh for the briefs), or a material mask, whichever looks better and stays within the frame budget.
- One neutral colour, no third-party asset (D25, D26).
- Nipples and the genital area are never drawn bare, on all five test bodies, front, three-quarter and back.
- With a dress, skirt or top mounted, the covered part of the base layer is hidden. There is a test for each case.
- It stays within the viewer chunk limit. Frame time is measured.
- `pnpm check` is green, the sheets show five bodies with and without a garment, and the report names the model.
