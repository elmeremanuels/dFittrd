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

/**
 * The scan worker is a MODULE worker (`new Worker(url, { type: 'module' })`), where `importScripts`
 * does not exist. MediaPipe then falls back to `import()` of the WASM loader, and only the ES-module
 * build (`vision_wasm_module_internal.js`) publishes `globalThis.ModuleFactory`; the classic loader
 * keeps it module-scoped and every task fails with "ModuleFactory not set". So the worker must ask
 * `FilesetResolver.forVisionTasks(base, true)`.
 */
export const VISION_WASM_ES_MODULE = true;

/**
 * Resolve the model base path against the page/worker URL and refuse anything that is not the app's
 * own origin (DECISIONS.md D3: onboarding makes zero third-party requests). Returns an absolute URL
 * without a trailing slash.
 */
export function resolveModelBase(base: string | undefined, appHref: string): string {
  const app = new URL(appHref);
  const url = new URL(base ?? MODEL_BASE, app);
  if (url.origin !== app.origin) throw new Error(`model assets must be served from ${app.origin}, not ${url.origin}`);
  if (url.search || url.hash) throw new Error('model base must be a plain path');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export type PoseVariant = 'full' | 'lite';

/** Lite on low-end devices: ≤ 4 logical cores or ≤ 4 GB reported memory. */
export function choosePoseVariant(nav: { hardwareConcurrency?: number; deviceMemory?: number } = navigator as never): PoseVariant {
  const cores = nav.hardwareConcurrency ?? 4;
  const mem = nav.deviceMemory ?? 4;
  return cores <= 4 || mem <= 4 ? 'lite' : 'full';
}
