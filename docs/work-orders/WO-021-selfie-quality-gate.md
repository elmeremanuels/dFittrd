# WO-021: Selfie quality check for the face shape (phase C)

**Tier** full · **Builder** Qwen · **Linear** CUR-35 · **Branch** `qwen/wo-021-selfie-quality-gate`, from the latest `claude/garment-engine`.

## Goal

Before the face shape (WO-020) is fitted, check on the device that the selfie is usable. If it is not, tell the shopper in plain English what to change.

## Rules, all computed from the Face Landmarker result and the image, on the device

- Exactly one face.
- Facing the camera: yaw, pitch and roll each within ±12°.
- A neutral expression: no open mouth and no broad smile (use the blendshapes if the model gives them).
- Enough light and no strong side light: mean luminance and left-right balance on the face region.
- Sharp enough: the variance of the Laplacian on the face region.
- The face large enough: the eye distance is at least 12 % of the image width.
- Nothing covering the face: glasses are allowed, but a hand or a mask is not.

## Files

- A new `apps/web/src/features/capture/selfieGate.ts`, pure, with its tests. Reuse the style and thresholds of the body's `poseGate.ts`.
- The strings in `apps/web/src/strings/en/capture.ts` (English, D21).
- The call site in `FaceStep.tsx`, which shows the message and lets the shopper retake the photo.

## Done when

- Every rule has tests with synthetic landmark sets and synthetic images. There are no real photos in the repo (D19).
- A good selfie passes. Each bad case gives its own message.
- `pnpm check` and both demo e2e runs are green. You ran them yourself, and the real output is in `docs/reports/qwen/selfie-quality-gate.md`.
