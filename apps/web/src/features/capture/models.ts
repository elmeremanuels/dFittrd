/**
 * Self-hosted MediaPipe asset locations (AGENTS.md: "Fonts and ML model files are self-hosted";
 * DECISIONS.md D3: onboarding makes zero third-party requests). Populate `apps/web/public/models`
 * with `node src/features/capture/scripts/fetch-models.mjs` (see README).
 */
export const MODEL_BASE = '/models';

export const MODEL_FILES = {
  wasmDir: `${MODEL_BASE}/wasm`,
  poseFull: `${MODEL_BASE}/pose_landmarker_full.task`,
  poseLite: `${MODEL_BASE}/pose_landmarker_lite.task`,
  segmenter: `${MODEL_BASE}/selfie_multiclass_256x256.tflite`,
  face: `${MODEL_BASE}/face_landmarker.task`,
} as const;

export type PoseVariant = 'full' | 'lite';

/** Lite on low-end devices: ≤ 4 logical cores or ≤ 4 GB reported memory. */
export function choosePoseVariant(nav: { hardwareConcurrency?: number; deviceMemory?: number } = navigator as never): PoseVariant {
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  return cores <= 4 || mem <= 4 ? 'lite' : 'full';
}
