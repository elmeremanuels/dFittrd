# WO-021: Selfie Quality Gate — Report

**Builder:** Qwen · **Linear:** CUR-35 · **Branch:** `qwen/wo-021-selfie-quality-gate`
**Model:** Claude Sonnet 4.5 (Qwen Code)

## Done

- New `apps/web/src/features/capture/selfieGate.ts` — pure selfie quality gate with seven checks:
  - Exactly one face (faceCount)
  - Facing the camera: yaw, pitch, roll each within ±12°
  - Neutral expression: jaw-open, mouth-open, and smile-sum blendshapes checked
  - Enough light and no strong side light: mean luminance (60–230) and left-right balance (< 0.45)
  - Sharp enough: Laplacian variance on the face region (> 80)
  - Face large enough: inter-eye distance ≥ 12 % of image width
  - Nothing covering the face: reserved reason `face_occluded` for future use
- 24 unit tests in `selfieGate.test.ts` with synthetic 478-point face landmarks and synthetic RGBA images (no real photos, D19)
- Integrated into the worker pipeline (`scan.worker.ts`):
  - Enabled `outputFaceBlendshapes: true` in the Face Landmarker
  - Selfie gate runs after face detection, on the raw landmarks and pixels
  - Result included in `FaceResultMessage` as `selfieGate: SelfieGateResult | null`
- `FaceStep.tsx` shows the specific selfie gate hint (from `selfieHint()`) when the gate fails, before proceeding to face analysis
- English strings added in `capture.ts` (D21): 10 hint keys (`noFace`, `multipleFaces`, `faceTheCamera`, `neutralExpression`, `moreLight`, `lessSideLight`, `holdSteady`, `moveCloser`, `clearFace`, `perfect`)
- `SelfieGateResult` type added to `workerProtocol.ts`
- Test mock in `reviewComponents.test.tsx` updated to include `selfieGate: null`

## Measured

```
✓ src/features/capture/__tests__/selfieGate.test.ts (24 tests) 275ms
✓ src/features/capture/__tests__/reviewComponents.test.tsx (6 tests) 1949ms

Test Files  2 passed (2)
     Tests  30 passed (30)
```

```
$ npx tsc --noEmit -p tsconfig.json
(clean — no errors)
```

```
$ npx eslint src/features/capture/selfieGate.ts src/features/capture/__tests__/selfieGate.test.ts ...
(clean — no warnings)
```

```
$ node scripts/check-language-packs.mjs
language packs: en on all 5 surfaces
```

## Not verified

- `pnpm demo:e2e` — Playwright browsers are not installed on this machine (`Executable doesn't exist at …/chrome-headless-shell`). The reviewer should run `npx playwright install chromium` then `pnpm demo:e2e` before merging.
- `pnpm check` full pipeline — blocked by PHP not being installed (WooCommerce plugin build fails). All TypeScript gates (typecheck, lint, unit tests, language packs) pass.
- The `face_occluded` reason is defined but the gate does not yet detect hands or masks covering the face (this would require an additional model or heuristic on the segmenter output). The reason is reserved for a future iteration.
- Integration with the live Face Landmarker: the gate is wired into the worker but not tested with a real camera. The unit tests cover the pure logic with synthetic data.
- Pre-existing test failures in the full suite (10 files, 17 tests) are all timeouts in unrelated tests (golden tests, embed tests, onboarding). They also fail on `claude/garment-engine` and are not caused by this change.

## Open issues

- OI-XX: The selfie gate currently blocks the face step when quality is insufficient. Consider whether to offer a "Skip quality check" option for accessibility (e.g., users who cannot position their face precisely).
