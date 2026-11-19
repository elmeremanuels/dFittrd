/**
 * Review regression: the scan worker is a MODULE worker, where MediaPipe loads the WASM loader with
 * `import()`. Only the ES-module loader publishes `globalThis.ModuleFactory`; with the classic loader
 * every task fails with "ModuleFactory not set" and the camera stages are always skipped.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FilesetResolver } from '@mediapipe/tasks-vision';
import { MODEL_FILES, VISION_WASM_ES_MODULE, moduleFactoryRearmer } from '../models';

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

  it('a cached ES-module import does not set ModuleFactory again; the rearmer puts it back for every task', async () => {
    // @ts-expect-error untyped Emscripten loader
    const mod = (await import('@mediapipe/tasks-vision/vision_wasm_module_internal.js')) as { default: unknown };
    // what MediaPipe does after creating a task
    g.ModuleFactory = undefined;
    // @ts-expect-error untyped Emscripten loader
    await import('@mediapipe/tasks-vision/vision_wasm_module_internal.js');
    expect(g.ModuleFactory).toBeUndefined();

    let loads = 0;
    const rearm = moduleFactoryRearmer('/models/wasm/vision_wasm_module_internal.js', g, async () => (loads++, mod));
    for (let task = 0; task < 3; task++) {
      await rearm();
      expect(g.ModuleFactory).toBe(mod.default);
      g.ModuleFactory = undefined;
    }
    expect(loads).toBe(1);
  });

  it('the rearmer refuses a loader without a factory', async () => {
    const rearm = moduleFactoryRearmer('/x.js', {}, async () => ({}));
    await expect(rearm()).rejects.toThrow(/no ModuleFactory/);
  });
});
