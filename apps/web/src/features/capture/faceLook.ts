/**
 * Face photo → skin tone suggestion and stylised 2D face tile, on the device (photo-avatar plan
 * slices 4 and 5, consent copy variant A; behind `VITE_AVATAR_FACE_PHOTO=live`, off by default).
 *
 *   decode (main thread, createImageBitmap, scaled to at most `maxSide`)
 *   → scan worker with the Face Landmarker only (no pose model, no 16 MB segmenter)
 *   → detect (478 landmarks, kept in the worker) → tile and/or suggestion (`faceTile.ts`)
 *   → the worker is disposed before the result is shown.
 *
 * This module makes no request of its own and stores nothing: the photo is a Blob in (the caller
 * drops it), the tile an array of pixels out. The only requests of the flow are the worker's GETs
 * of its same-origin model files (`resolveModelBase` refuses any other origin, and
 * `sameOriginOnly.ts` refuses anything else the model runtime tries).
 */
import { ScanSession } from './scanSession';
import type { PhotoNotice, SkinSuggestion } from './faceTile';

export interface FaceLookTile {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  skinLab: { L: number; a: number; b: number };
}

export interface FaceLookResult {
  faceFound: boolean;
  tile: FaceLookTile | null;
  suggestion: SkinSuggestion | null;
  notices: PhotoNotice[];
  timings: { decodeMs: number; startMs: number; detectMs: number; tileMs: number; skinMs: number; totalMs: number };
}

export interface FaceLookOptions {
  /** Make the face tile ("Use my face" said yes). */
  tile: boolean;
  /** Make the skin tone suggestion ("read it from my photo" said yes). */
  skin: boolean;
  /** Height over width of the tile (the 2D head). */
  aspect?: number;
  modelBase?: string;
  /** Longest side the picture is scaled down to before detection (default 1280 px). */
  maxSide?: number;
  /** Test seam. */
  createSession?: () => ScanSession;
}

const now = (): number => performance.now();

export async function faceLookFromPhoto(photo: Blob, opts: FaceLookOptions): Promise<FaceLookResult> {
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
  const session = opts.createSession?.() ?? new ScanSession({ needPose: false, needFace: true, needSegmenter: false, modelBase: opts.modelBase });
  try {
    await session.init();
    const t2 = now();
    const res = await session.faceLook(bitmap, { tile: opts.tile, skin: opts.skin, ...(opts.aspect ? { aspect: opts.aspect } : {}) });
    const t3 = now();
    return {
      faceFound: res.faceFound,
      tile: res.tile ? { width: res.tile.width, height: res.tile.height, rgba: new Uint8ClampedArray(res.tile.rgba), skinLab: res.tile.skinLab } : null,
      suggestion: res.suggestion,
      notices: res.notices,
      timings: { decodeMs: Math.round(t1 - t0), startMs: Math.round(t2 - t1), detectMs: res.timings.detectMs, tileMs: res.timings.tileMs, skinMs: res.timings.skinMs, totalMs: Math.round(t3 - t0) },
    };
  } finally {
    session.dispose();
  }
}

/**
 * A tile's pixels as a `blob:` URL for the 2D figure (an object URL of this page: it is not a
 * request and cannot be read by another site). The caller revokes it when the face goes.
 */
export async function tileObjectUrl(tile: { width: number; height: number; rgba: Uint8ClampedArray }): Promise<string> {
  const data = new ImageData(new Uint8ClampedArray(tile.rgba), tile.width, tile.height);
  let blob: Blob;
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(tile.width, tile.height);
    c.getContext('2d')!.putImageData(data, 0, 0);
    blob = await c.convertToBlob({ type: 'image/png' });
  } else {
    const c = document.createElement('canvas');
    c.width = tile.width;
    c.height = tile.height;
    c.getContext('2d')!.putImageData(data, 0, 0);
    blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('no blob'))), 'image/png'));
  }
  return URL.createObjectURL(blob);
}
