# WO-013: Hair picker in the embed (OI-170, D28)

**Tier** full · **Builder** Qwen · **Linear** CUR-10 · **Branch** `qwen/wo-013-hair-picker`, cut from `claude/garment-engine` once the realistic body is merged there. Until then, cut it from `claude/realistic-body`.

## Goal

The shopper picks the hair type (10), the length (4) and the colour (10) next to the skin tone in the embed. The choice is stored on the device only and passed to `Garment3D`'s `hair` prop. It is never sent anywhere and never inferred from a photo (D28).

## Files

- `apps/web/src/embed/`: the picker component and its use next to the skin-tone choice.
- The device-store helper the skin tone already uses.
- `apps/web/src/strings` (English only, D21).
- The tests next to them.

Do not touch `packages/garment-viewer`.

## Done when

- The picker shows all options in English, is keyboard accessible, and works at a phone width of 360 px.
- The choice survives a reload, via the same device storage as the skin tone. Clearing data forgets it.
- A test proves that no request carries the hair choice: extend the privacy test.
- `pnpm check`, `pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e` are green.
- There are screenshots at 360, 390 and 430 px. The report is `docs/reports/qwen/hair-picker.md`.
