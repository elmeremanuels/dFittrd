/**
 * Camera glue for the capture step (browser; a Capacitor shell swaps this file behind the same
 * interface). Frames are grabbed as ImageBitmaps and transferred to the worker — they are never
 * drawn to a visible canvas other than the live preview <video>, never encoded, never uploaded.
 */

export type Facing = 'user' | 'environment';

export interface CameraHandle {
  stream: MediaStream;
  facing: Facing;
  width: number;
  height: number;
  stop: () => void;
}

export function hasMediaDevices(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
}

export async function hasCamera(): Promise<boolean> {
  if (!hasMediaDevices() || typeof navigator.mediaDevices.enumerateDevices !== 'function') return hasMediaDevices();
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === 'videoinput');
  } catch {
    return false;
  }
}

/** Open the camera (portrait-friendly 720p). Throws a DOMException (NotAllowedError, NotFoundError…) on failure. */
export async function openCamera(facing: Facing = 'user'): Promise<CameraHandle> {
  if (!hasMediaDevices()) throw new DOMException('camera API unavailable', 'NotSupportedError');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } },
  });
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings() ?? {};
  return {
    stream,
    facing,
    width: settings.width ?? 720,
    height: settings.height ?? 1280,
    stop: () => stream.getTracks().forEach((t) => t.stop()),
  };
}

export interface FramePumpOptions {
  /** Target analysis fps; the worker is the bottleneck, so 12–15 is plenty for gating. */
  fps?: number;
  /** Frames are downscaled to this width before transfer (keeps the worker at ~10–20 ms/frame). */
  resizeWidth?: number;
  onFrame: (bitmap: ImageBitmap, timestamp: number) => void;
  onError?: ((e: unknown) => void) | undefined;
}

/**
 * Pull frames from a <video> at a bounded rate and hand them to `onFrame` as transferable bitmaps.
 * Back-pressure: a new frame is only grabbed once the previous `createImageBitmap` resolved.
 */
export function startFramePump(video: HTMLVideoElement, opts: FramePumpOptions): () => void {
  const fps = opts.fps ?? 15;
  const interval = 1000 / fps;
  let stopped = false;
  let last = 0;
  let busy = false;
  let raf = 0;

  const tick = (): void => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    if (busy || now - last < interval || video.readyState < 2 || video.videoWidth === 0) return;
    last = now;
    busy = true;
    const opt: ImageBitmapOptions = { resizeWidth: opts.resizeWidth ?? 480, resizeQuality: 'low' };
    createImageBitmap(video, opt)
      .then((bmp) => {
        if (stopped) {
          bmp.close();
          return;
        }
        opts.onFrame(bmp, now);
      })
      .catch((e: unknown) => opts.onError?.(e))
      .finally(() => {
        busy = false;
      });
  };
  raf = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

/** Grab one still (full resolution, capped at `maxWidth`) for the face step. */
export function captureStill(video: HTMLVideoElement, maxWidth = 1280): Promise<ImageBitmap> {
  const w = Math.min(maxWidth, video.videoWidth || maxWidth);
  return createImageBitmap(video, { resizeWidth: w, resizeQuality: 'high' });
}

/** Load a user-picked photo (no-camera fallback for the face step). */
export function bitmapFromFile(file: Blob, maxWidth = 1280): Promise<ImageBitmap> {
  return createImageBitmap(file, { resizeWidth: maxWidth, resizeQuality: 'high' });
}

/** Device orientation gate: phone upright within `maxDeg` of vertical (portrait). Null when no sensor. */
export function phoneUprightFromOrientation(beta: number | null | undefined, maxDeg = 10): boolean | null {
  if (beta === null || beta === undefined || !Number.isFinite(beta)) return null;
  return Math.abs(beta - 90) <= maxDeg;
}
