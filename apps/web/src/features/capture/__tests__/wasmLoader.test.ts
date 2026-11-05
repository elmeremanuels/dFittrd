/**
 * Review regression: the scan worker is a MODULE worker, where MediaPipe loads the WASM loader with
 * `import()`. Only the ES-module loader publishes `globalThis.ModuleFactory`; with the classic loader
 * every task fails with "ModuleFactory not set" and the camera stages are always skipped.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FilesetResolver } from '@mediapipe/tasks-vision';
import { MODEL_FILES, VISION_WASM_ES_MODULE } from '../models';

const g = globalThis as { ModuleFactory?: unknown; custom_dbg?: unknown };

afterEach(() => {
  delete g.ModuleFactory;
  delete g.custom_dbg;
});

describe('MediaPipe WASM loader in a module worker', () => {
  it('the classic loader does not expose ModuleFactory when imported as a module', async () => {
    delete g.ModuleFactory;
    // @ts-expect-error untyped Emscripten loader
    await import('@mediapipe/tasks-vision/vision_wasm_internal.js');
    expect(g.ModuleFactory).toBeUndefined();
  });

  it('the ES-module loader does, and the worker asks for it', async () => {
    delete g.ModuleFactory;
    // @ts-expect-error untyped Emscripten loader
    await import('@mediapipe/tasks-vision/vision_wasm_module_internal.js');
    expect(typeof g.ModuleFactory).toBe('function');
    expect(VISION_WASM_ES_MODULE).toBe(true);
    const fileset = await FilesetResolver.forVisionTasks(MODEL_FILES.wasmDir, VISION_WASM_ES_MODULE);
    expect(fileset.wasmLoaderPath).toBe('/models/wasm/vision_wasm_module_internal.js');
    expect(fileset.wasmBinaryPath).toBe('/models/wasm/vision_wasm_module_internal.wasm');
  });
});
