/**
 * Face on the 3D head, on the device (slice 6 spike of docs/research/photo-avatar-plan.md; behind
 * `VITE_AVATAR_FACE_ON_HEAD`, off by default). One picture the shopper chose → a face texture for
 * the v2 head of the 3D viewer. Everything runs here and in the scan worker:
 *
 *   decode (main thread, createImageBitmap, scaled to at most `maxSide`)
 *   → worker start: the Face Landmarker only (3.7 MB model + the WASM runtime, same origin, cached
 *     by the service worker after the first time); no pose model, no segmenter
 *   → detect (478 landmarks, kept in the worker) → pixels → bake (`faceBake.ts`)
 *   → the worker is disposed before the texture is shown (plan: release the scan worker before the
 *     viewer draws).
 *
 * This module makes no request of its own and stores nothing: the photo is a Blob in, the texture
 * an array of pixels out, both in memory. The only requests of the flow are the worker's GETs of its
 * same-origin model files (`resolveModelBase` refuses any other origin).
 */
import { ScanSession } from './scanSession';
import type { FaceBakeStats } from './faceBake';

export interface FaceOnHeadTimings {
  /** Picture → ImageBitmap (main thread). */
  decodeMs: number;
  /** Worker start and model load (WASM + face model). */
  startMs: number;
  detectMs: number;
  pixelsMs: number;
  bakeMs: number;
  /** From the call to the texture in hand. */
  totalMs: number;
}

export interface FaceOnHeadResult {
  faceFound: boolean;
  texture: { size: number; rgba: Uint8ClampedArray } | null;
  stats: FaceBakeStats | null;
  warnings: ('turned' | 'small')[];
  timings: FaceOnHeadTimings;
  /** Which compute the worker got for the landmarker. */
  delegate: 'GPU' | 'CPU' | null;
}

export interface FaceOnHeadOptions {
  /** The skin colour on the body (`#rrggbb`) the face is matched to (the shopper's confirmed swatch); null: not matched. */
  targetSkinHex: string | null;
  modelBase?: string;
  /** Longest side the picture is scaled down to before detection (default 1280 px). */
  maxSide?: number;
  /** Force the landmarker's delegate (measurement only). */
  delegate?: 'GPU' | 'CPU';
  /** Test seam. */
  createSession?: () => ScanSession;
}

const now = (): number => performance.now();

export async function faceTextureFromPhoto(photo: Blob, opts: FaceOnHeadOptions): Promise<FaceOnHeadResult> {
  const t0 = now();
  const probe = await createImageBitmap(photo, { imageOrientation: 'from-image' });
  const maxSide = opts.maxSide ?? 1280;
  const scale = Math.min(1, maxSide / Math.max(probe.width, probe.height));
  let bitmap = probe;
  if (scale < 1) {
    bitmap = await createImageBitmap(probe, { resizeWidth: Math.round(probe.width * scale), resizeHeight: Math.round(probe.height * scale), resizeQuality: 'high' });
    probe.close();
  }
  const t1 = now();
  const session = opts.createSession?.() ?? new ScanSession({ needPose: false, needFace: true, needSegmenter: false, modelBase: opts.modelBase, delegate: opts.delegate });
  try {
    const ready = await session.init();
    const t2 = now();
    const res = await session.bakeFaceTexture(bitmap, opts.targetSkinHex);
    const t3 = now();
    return {
      faceFound: res.faceFound,
      texture: res.texture ? { size: res.texture.size, rgba: new Uint8ClampedArray(res.texture.rgba) } : null,
      stats: res.stats,
      warnings: res.warnings,
      delegate: ready.delegate,
      timings: { decodeMs: Math.round(t1 - t0), startMs: Math.round(t2 - t1), detectMs: res.timings.detectMs, pixelsMs: res.timings.pixelsMs, bakeMs: res.timings.bakeMs, totalMs: Math.round(t3 - t0) },
    };
  } finally {
    session.dispose();
  }
}
