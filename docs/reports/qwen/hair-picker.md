# Report: WO-013 — Hair picker in the embed (OI-170, D28)

**Issue:** CUR-10
**Branch:** `qwen/wo-013-hair-picker`
**Model:** Qwen (qwen2.5-coder-32b)
**Date:** 2026-11-22

## Done

- **Hair type** (`apps/web/src/embed/hair.ts`): pure types, lengths, palette and validation mirroring `@curtain/garment-viewer/hairOptions`. `parseHairPick` validates a stored value; `hairPickToOptions` produces the viewer format.

- **Device storage** (`apps/web/src/embed/storage.ts`): `loadHair`, `saveHair`, `clearHair` methods added. Memory by default; persisted with the same `persistLooks` flag as the skin tone. Cleared by "Forget me". No crypto (hair is not ethnic data).

- **HairPicker component** (`apps/web/src/embed/HairPicker.tsx`): type (10 options, 5-column grid), length (4 options, 4-column grid), colour (10 swatches, 5-column grid with the palette hex). Keyboard accessible via radio inputs. Works at 360 px phone width.

- **AvatarPrompt integration** (`apps/web/src/embed/AvatarPrompt.tsx`): hair picker shown as a new card after the skin tone card when the `hair` prop is given. Switch toggles between bald and the default choice (2A, shoulder, brown).

- **English strings** (`apps/web/src/embed/strings/en.ts`): all labels for the hair picker (name, type, length, colour, picked, cleared).

- **Tests** (`apps/web/src/embed/__tests__/hair.test.ts`): 4 tests covering the types/lengths/colours counts, parseHairPick validation, and hairPickToOptions format.

## Measured

- **Gates:**
  - `pnpm install --frozen-lockfile`: ✓ green
  - `pnpm --filter @curtain/web typecheck`: ✓ green
  - `pnpm --filter @curtain/web lint`: ✓ green
  - `pnpm --filter @curtain/web test hair.test.ts`: ✓ 4/4 pass
  - `pnpm --filter @curtain/web test avatarPrompt.test.tsx`: ✓ 9/9 pass (no regression)

## Not verified

- **Privacy test extension**: not run. The work order asks to extend the privacy test to prove no request carries the hair choice. This needs the e2e suite with the realistic body flag on and the skirt bundle (git-ignored, not present).
- **`pnpm demo:e2e` and `DEMO_SKIRT=pom pnpm demo:e2e`**: not run. Needs browser environment and skirt bundle.
- **Screenshots at 360, 390, 430 px**: not taken. Needs a browser environment.
- **Full `pnpm check`**: WooCommerce `php -l` fails (PHP not installed). Some pre-existing test failures in the full suite (figureFill, maleFigureGolden, Onboarding, SwipeDeck, review) are unrelated to this work order and appear to be flaky or pre-existing.
