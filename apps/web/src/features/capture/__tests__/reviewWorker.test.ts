/**
 * Review regressions for the scan worker (driven in node with MediaPipe mocked) and the main-thread
 * ScanSession: same-origin model loading, the module-worker WASM loader, frames never leaving the
 * worker and always being closed, and sessions that fail to load never hanging their callers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveModelBase } from '../models';
import { ScanSession } from '../scanSession';
import type { WorkerInbound, WorkerOutbound } from '../workerProtocol';
import { FRAME, FRONT_WIDTHS_CM, SIDE_DEPTHS_CM, figure, paintMask } from './fixtures';

const APP = 'https://app.curtain.test';

// ---------------------------------------------------------------------------------------------
// MediaPipe mock
// ---------------------------------------------------------------------------------------------
const mp = vi.hoisted(() => {
  const created: { task: string; options: { baseOptions?: { modelAssetPath?: string } } }[] = [];
  return {
    created,
    forVisionTasks: vi.fn(async (base: string, useModule?: boolean) => ({
      wasmLoaderPath: `${base}/vision_wasm${useModule ? '_module' : ''}_internal.js`,
      wasmBinaryPath: `${base}/vision_wasm${useModule ? '_module' : ''}_internal.wasm`,
    })),
  };
});

interface FakeBitmap {
  width: number;
  height: number;
  kind: 'front' | 'side';
  closed: boolean;
  close: () => void;
}

vi.mock('@mediapipe/tasks-vision', () => {
  const pose = {
    detectForVideo: (b: FakeBitmap) => ({ landmarks: [figure({ view: b.kind })] }),
    close: () => undefined,
  };
  const segmenter = {
    segment: (b: FakeBitmap) => {
      const m = b.kind === 'front' ? paintMask(FRONT_WIDTHS_CM, 'front') : paintMask(SIDE_DEPTHS_CM, 'side');
      return { categoryMask: { width: m.width, height: m.height, getAsUint8Array: () => m.data }, close: () => undefined };
    },
    close: () => undefined,
  };
  const face = { detect: () => ({ faceLandmarks: [] }), close: () => undefined };
  const factory = (task: string, instance: unknown) => ({
    createFromOptions: vi.fn(async (_fs: unknown, options: { baseOptions?: { modelAssetPath?: string } }) => {
      mp.created.push({ task, options });
      return instance;
    }),
  });
  return {
    FilesetResolver: { forVisionTasks: mp.forVisionTasks },
    PoseLandmarker: factory('pose', pose),
    ImageSegmenter: factory('segmenter', segmenter),
    FaceLandmarker: factory('face', face),
  };
});

// ---------------------------------------------------------------------------------------------
// Fake DedicatedWorkerGlobalScope
// ---------------------------------------------------------------------------------------------
const posted: { msg: WorkerOutbound; transfer: unknown[] }[] = [];
const ctx = {
  location: { href: `${APP}/assets/scan.worker-1a2b.js` },
  postMessage: (msg: WorkerOutbound, transfer: unknown[] = []) => posted.push({ msg, transfer }),
  close: vi.fn(),
  onmessage: null as null | ((ev: { data: WorkerInbound }) => void),
};
const send = (data: WorkerInbound): void => ctx.onmessage!({ data });
const bitmaps: FakeBitmap[] = [];
const bitmap = (kind: 'front' | 'side'): FakeBitmap => {
  const b: FakeBitmap = { width: FRAME.width, height: FRAME.height, kind, closed: false, close: () => (b.closed = true) };
  bitmaps.push(b);
  return b;
};

beforeAll(async () => {
  vi.stubGlobal('self', ctx);
  await import('../scan.worker');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('resolveModelBase', () => {
  it('accepts same-origin paths and refuses other origins', () => {
    expect(resolveModelBase(undefined, `${APP}/onboarding`)).toBe(`${APP}/models`);
    expect(resolveModelBase('/static/models/', `${APP}/x`)).toBe(`${APP}/static/models`);
    expect(resolveModelBase(`${APP}/m`, `${APP}/x`)).toBe(`${APP}/m`);
    expect(() => resolveModelBase('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm', `${APP}/x`)).toThrow(/served from/);
    expect(() => resolveModelBase('//storage.googleapis.com/mediapipe-models', `${APP}/x`)).toThrow(/served from/);
    expect(() => resolveModelBase('data:text/javascript,1', `${APP}/x`)).toThrow();
    expect(() => resolveModelBase('/models?x=1', `${APP}/x`)).toThrow(/plain path/);
  });
});

describe('scan.worker', () => {
  it('loads the ES-module WASM runtime and every model from the app origin', async () => {
    send({ type: 'init', variant: 'lite', needFace: true, needPose: true });
    await vi.waitFor(() => expect(posted.some((p) => p.msg.type === 'ready')).toBe(true));
    expect(mp.forVisionTasks).toHaveBeenCalledWith(`${APP}/models/wasm`, true);
    expect(mp.created.map((c) => c.task).sort()).toEqual(['face', 'pose', 'segmenter']);
    for (const c of mp.created) expect(c.options.baseOptions?.modelAssetPath?.startsWith(`${APP}/models/`)).toBe(true);
  });

  it('refuses a third-party model base without fetching anything', async () => {
    const calls = mp.forVisionTasks.mock.calls.length;
    const created = mp.created.length;
    send({ type: 'init', variant: 'lite', needFace: true, needPose: true, modelBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision' });
    await vi.waitFor(() => expect(posted.some((p) => p.msg.type === 'error' && p.msg.stage === 'init')).toBe(true));
    expect(mp.forVisionTasks.mock.calls.length).toBe(calls);
    expect(mp.created.length).toBe(created);
  });

  it('never posts a frame, keeps at most a handful in memory and closes every one', async () => {
    posted.length = 0;
    send({ type: 'reset' });
    let maxOpen = 0;
    for (let i = 0; i < 40; i++) {
      send({ type: 'frame', bitmap: bitmap(i < 20 ? 'front' : 'side') as unknown as ImageBitmap, timestamp: i * 66 });
      maxOpen = Math.max(maxOpen, bitmaps.filter((b) => !b.closed).length);
    }
    // best front ±1, best side ±1, two latest
    expect(maxOpen).toBeLessThanOrEqual(8);
    const gates = posted.filter((p) => p.msg.type === 'gate');
    expect(gates).toHaveLength(40);
    expect(gates.some((g) => g.msg.type === 'gate' && g.msg.haveFront && g.msg.haveSide)).toBe(true);

    send({ type: 'finish', heightCm: 170, weightKg: 62, sex: 'female' });
    await vi.waitFor(() => expect(posted.some((p) => p.msg.type === 'result' || p.msg.type === 'error')).toBe(true));
    const result = posted.find((p) => p.msg.type === 'result');
    expect(result, JSON.stringify(posted.filter((p) => p.msg.type === 'error'))).toBeDefined();
    // every frame is closed once the recording is measured
    expect(bitmaps.every((b) => b.closed)).toBe(true);

    // nothing that leaves the worker is (or contains) a frame; transfers are mask buffers only
    const seen = new Set<unknown>();
    const walk = (v: unknown): void => {
      if (!v || typeof v !== 'object' || seen.has(v)) return;
      seen.add(v);
      expect(bitmaps.includes(v as FakeBitmap)).toBe(false);
      if (ArrayBuffer.isView(v)) return;
      for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k]);
    };
    for (const p of posted) {
      walk(p.msg);
      for (const t of p.transfer) expect(t).toBeInstanceOf(ArrayBuffer);
    }
    if (result?.msg.type === 'result') {
      expect(result.msg.baseFrame).toBeNull(); // no OffscreenCanvas in node; the frame itself is never posted
      expect(result.msg.stats.sideIndex).toBeGreaterThanOrEqual(20);
      const g = result.msg.scan.girths;
      expect(g.neck!.mean).toBeLessThan(45);
      expect(g.upperArm!.mean).toBeLessThan(35);
      expect(result.msg.scan.posture.shoulderSlopeDeg).toBeLessThan(5); // flat painted shoulders
    }
  });
});

// ---------------------------------------------------------------------------------------------
// ScanSession
// ---------------------------------------------------------------------------------------------
function fakeWorker() {
  return {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null as null | ((ev: { data: WorkerOutbound }) => void),
    onerror: null as null | ((ev: { message: string }) => void),
  };
}

describe('ScanSession', () => {
  it('terminates the worker when the models time out, and later calls reject instead of hanging', async () => {
    vi.useFakeTimers();
    try {
      const w = fakeWorker();
      const s = new ScanSession({ variant: 'lite', initTimeoutMs: 1000, createWorker: () => w as unknown as Worker });
      const ready = s.init();
      vi.advanceTimersByTime(1001);
      await expect(ready).rejects.toThrow(/timed out/);
      expect(w.terminate).toHaveBeenCalled();
      expect(s.disposed).toBe(true);
      await expect(s.finish({ heightCm: 170 })).rejects.toThrow(/not running/);
      const bmp = { close: vi.fn() };
      await expect(s.analyseFace(bmp as unknown as ImageBitmap)).rejects.toThrow(/not running/);
      expect(bmp.close).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('terminates the worker when model loading fails', async () => {
    const w = fakeWorker();
    const s = new ScanSession({ variant: 'lite', createWorker: () => w as unknown as Worker });
    const ready = s.init();
    w.onmessage!({ data: { type: 'error', stage: 'init', message: 'ModuleFactory not set.' } });
    await expect(ready).rejects.toThrow(/ModuleFactory/);
    expect(w.terminate).toHaveBeenCalled();
    await expect(s.finish({ heightCm: 170 })).rejects.toThrow(/not running/);
  });

  it('still resolves a normal init → finish round trip', async () => {
    const w = fakeWorker();
    const s = new ScanSession({ variant: 'lite', createWorker: () => w as unknown as Worker });
    const ready = s.init();
    w.onmessage!({ data: { type: 'ready', variant: 'lite', delegate: 'CPU', loadMs: 1 } });
    await expect(ready).resolves.toMatchObject({ type: 'ready' });
    const done = s.finish({ heightCm: 170 });
    expect(w.postMessage).toHaveBeenLastCalledWith({ type: 'finish', heightCm: 170 }, []);
    w.onmessage!({ data: { type: 'error', stage: 'finish', message: 'no usable front frame' } });
    await expect(done).rejects.toThrow(/front frame/);
    expect(w.terminate).not.toHaveBeenCalled();
  });
});
