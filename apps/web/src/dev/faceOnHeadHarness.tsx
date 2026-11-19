/**
 * Dev-only harness of the slice 6 spike (never bundled: only `dev/face-on-head.html` loads it,
 * under `vite` dev). The embed's real avatar prompt with the live "Use my face" row, the capture
 * worker's on-device face bake, and the shipped viewer's figure with head v2, at phone size.
 *
 * The row is live only when the dev server runs with `VITE_AVATAR_FACE_ON_HEAD=1`; without it the
 * harness shows the prompt as a normal build has it (the face row hidden) and says so. Nothing is
 * sent anywhere: the picture is read on the device, the texture stays in memory, and the page makes
 * no request beyond the dev server's module files and the worker's same-origin model files
 * (`e2e/faceOnHead.spec.ts` traps fetch, XHR, WebSocket and sendBeacon over the whole flow).
 *
 * Query: `frame=face|head|body` (default head), `family=female|male`, `skin=<1..10>` (a swatch picked
 * at start), `prompt=1` (open the prompt at start), `delegate=cpu|gpu` (force the landmarker's delegate, for timing).
 * `window.faceSpike` exposes the last bake's timings and numbers, and `setYaw` / `setFrame` /
 * `closePrompt` for the screenshot script (`scripts/face-on-head-shots.mjs`).
 */
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '@/index.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { FigureFrame, FigureView } from '@curtain/garment-viewer';
import { EstimateBadge } from '@/components/EstimateBadge';
import { AvatarPrompt, type FaceOnHeadRow } from '@/embed/AvatarPrompt';
import { faceOnHeadEnabled, lookForMonk, type SkinLook } from '@/embed/look';
import { embedStrings } from '@/embed/strings';
import { faceTextureFromPhoto, rematchFaceTexture, type FaceOnHeadResult } from '@/features/capture';

interface FaceSpikeApi {
  ready: boolean;
  last: Omit<FaceOnHeadResult, 'texture'> | null;
  textureBytes: number;
  viewHasFace: () => boolean;
  setYaw: (deg: number) => void;
  setFrame: (f: FigureFrame) => void;
  closePrompt: () => void;
  openPrompt: () => void;
  /** The baked texture as a PNG data URL (in the page only; for the report's picture of the texture). */
  textureDataUrl: () => string | null;
  error: string | null;
}

declare global {
  interface Window {
    faceSpike: FaceSpikeApi;
  }
}

const q = new URLSearchParams(location.search);
const FLAG = faceOnHeadEnabled();
const startSkin = lookForMonk(Number(q.get('skin')));
const frameParam = q.get('frame');
const delegate = q.get('delegate') === 'cpu' ? 'CPU' : q.get('delegate') === 'gpu' ? 'GPU' : undefined;
const startFrame: FigureFrame = frameParam === 'face' || frameParam === 'body' ? frameParam : 'head';
window.faceSpike = { ready: false, last: null, textureBytes: 0, viewHasFace: () => false, setYaw: () => {}, setFrame: () => {}, closePrompt: () => {}, openPrompt: () => {}, textureDataUrl: () => null, error: null };

function Harness(): ReactNode {
  const { ui, faceSpike: fs } = embedStrings().avatar;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<FigureView | null>(null);
  const [look, setLook] = useState<SkinLook | null>(startSkin);
  const [face, setFace] = useState<{ size: number; rgba: Uint8ClampedArray; matchedTo: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<FaceOnHeadRow['notice']>(null);
  const [open, setOpen] = useState(q.get('prompt') === '1');

  useEffect(() => {
    let disposed = false;
    // The viewer is a separate chunk, loaded on demand as in the embed.
    void import('@curtain/garment-viewer').then(({ mountFigureView }) => {
      if (disposed || !canvasRef.current) return;
      const view = mountFigureView(canvasRef.current, { family: q.get('family') === 'male' ? 'male' : 'female', look: { skinHex: look?.hex ?? null }, frame: startFrame, lighting: 'neutral-v2' });
      viewRef.current = view;
      window.faceSpike.viewHasFace = view.hasFace;
      window.faceSpike.setYaw = view.setYaw;
      window.faceSpike.setFrame = view.setFrame;
      window.faceSpike.ready = true;
    });
    return () => {
      disposed = true;
      viewRef.current?.dispose();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    window.faceSpike.closePrompt = () => setOpen(false);
    window.faceSpike.openPrompt = () => setOpen(true);
  }, []);

  useEffect(() => {
    window.faceSpike.textureDataUrl = () => {
      if (!face) return null;
      const c = document.createElement('canvas');
      c.width = c.height = face.size;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(face.rgba), face.size, face.size), 0, 0);
      return c.toDataURL('image/png');
    };
  }, [face]);

  useEffect(() => {
    viewRef.current?.setLook({ skinHex: look?.hex ?? null, face: face ? { size: face.size, rgba: face.rgba } : null });
  }, [look, face]);

  // A swatch picked after the bake recolours the face to match (the photo is not kept, so no re-bake).
  const pick = (next: SkinLook): void => {
    setLook(next);
    if (face?.matchedTo && face.matchedTo.toLowerCase() !== next.hex.toLowerCase()) setFace({ size: face.size, rgba: rematchFaceTexture(face.rgba, face.matchedTo, next.hex), matchedTo: next.hex });
  };

  const onPhoto = (file: File): void => {
    setBusy(true);
    setNotice(null);
    const target = look?.hex ?? null;
    faceTextureFromPhoto(file, { targetSkinHex: target, ...(delegate ? { delegate } : {}) })
      .then((res) => {
        const { texture, ...rest } = res;
        window.faceSpike.last = rest;
        window.faceSpike.textureBytes = texture ? texture.rgba.byteLength : 0;
        if (!res.faceFound || !texture) {
          setNotice('notFound');
          return;
        }
        setNotice(res.warnings.includes('turned') ? 'turned' : res.warnings.includes('small') ? 'small' : null);
        setFace({ size: texture.size, rgba: texture.rgba, matchedTo: target });
      })
      .catch((e: unknown) => {
        window.faceSpike.error = e instanceof Error ? e.message : String(e);
        setNotice('failed');
      })
      .finally(() => setBusy(false));
  };

  const faceRow: FaceOnHeadRow | undefined = FLAG ? { on: face !== null, busy, notice, onPhoto, onOff: () => setFace(null) } : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col px-4 pt-3 pb-4" data-testid="harness" data-flag={FLAG ? 'on' : 'off'}>
      <p className="mb-2 text-[11px] leading-snug text-ink-mute">
        Dev harness · slice 6 spike · face on the 3D head, on the device · flag {FLAG ? 'on' : 'off (the face row is hidden, as in a normal build)'}
      </p>
      <div className="relative flex-1 overflow-hidden rounded-3xl bg-white/60">
        <canvas ref={canvasRef} className="block h-[62dvh] w-full touch-none" data-testid="figure-canvas" />
        <EstimateBadge className="absolute top-3 left-3" lines={embedStrings().result.estimateLines} />
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost absolute right-3 bottom-3 min-h-11 bg-white/85 px-3 text-sm" data-testid="avatar-open">
          {ui.open}
        </button>
      </div>
      <p className="mt-2 min-h-5 text-center text-sm font-medium" data-testid="face-label">
        {face ? fs.c27 : ''}
      </p>
      {open ? (
        <AvatarPrompt
          look={look}
          onPick={pick}
          onClear={() => setLook(null)}
          onMeasurements={() => setOpen(false)}
          onClose={() => setOpen(false)}
          termsUrl="/privacy"
          {...(faceRow ? { faceOnHead: faceRow } : {})}
        />
      ) : null}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
