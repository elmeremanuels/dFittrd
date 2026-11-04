import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, Check, ImagePlus, RefreshCw, SkipForward } from 'lucide-react';
import { MONK_SWATCHES } from '../faceSkin';
import { bitmapFromFile, captureStill, openCamera, type CameraHandle } from '../platform/camera';
import type { ScanSession } from '../scanSession';
import type { SkinEstimate } from '../types';
import { EstimateBadge, GhostButton, Panel, PrimaryButton, PrivacyNote, StepHeader } from './ui';

export interface FaceStepResult {
  skin: SkinEstimate | null;
  tile: { blob: Blob; width: number; height: number } | null;
}

interface Props {
  session: ScanSession | null;
  cameraAllowed: boolean;
  onDone: (result: FaceStepResult) => void;
  onSkip: () => void;
}

type Phase = 'preview' | 'analysing' | 'review';

export function FaceStep({ session, cameraAllowed, onDone, onSkip }: Props): ReactNode {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camRef = useRef<CameraHandle | null>(null);
  const [phase, setPhase] = useState<Phase>('preview');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<FaceStepResult | null>(null);
  const [tileUrl, setTileUrl] = useState<string | null>(null);
  const [monk, setMonk] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cameraAllowed) return;
    let cancelled = false;
    openCamera('user')
      .then((cam) => {
        if (cancelled) {
          cam.stop();
          return;
        }
        camRef.current = cam;
        if (videoRef.current) {
          videoRef.current.srcObject = cam.stream;
          void videoRef.current.play().catch(() => undefined);
        }
      })
      .catch((e: unknown) => setCameraError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Camera access was declined.' : 'Could not open the camera.'));
    return () => {
      cancelled = true;
      camRef.current?.stop();
      camRef.current = null;
    };
  }, [cameraAllowed]);

  useEffect(() => {
    return () => {
      if (tileUrl) URL.revokeObjectURL(tileUrl);
    };
  }, [tileUrl]);

  const analyse = async (bitmap: ImageBitmap): Promise<void> => {
    if (!session) {
      bitmap.close();
      setError('The scan models are not available on this device; you can skip this step.');
      return;
    }
    setPhase('analysing');
    setError(null);
    try {
      const r = await session.analyseFace(bitmap);
      if (!r.faceFound) {
        setError('No face found. Face the camera in good light and try again.');
        setPhase('preview');
        return;
      }
      const res: FaceStepResult = { skin: r.skin, tile: r.faceTile };
      setResult(res);
      setMonk(r.skin?.monk ?? null);
      if (r.faceTile) setTileUrl(URL.createObjectURL(r.faceTile.blob));
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Face analysis failed.');
      setPhase('preview');
    }
  };

  const takePhoto = async (): Promise<void> => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    await analyse(await captureStill(v));
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      await analyse(await bitmapFromFile(file));
    } catch {
      setError('That image could not be read.');
    }
  };

  const confirm = (): void => {
    if (!result) return;
    const skin = result.skin && monk !== null && monk !== result.skin.monk ? { ...result.skin, monk } : result.skin;
    camRef.current?.stop();
    onDone({ ...result, skin });
  };

  return (
    <Panel className="space-y-5">
      <StepHeader eyebrow="Step 1 of 3" title="Face & colour" subtitle="One front-lit photo. Hair away from the face helps." />
      {phase !== 'review' ? (
        <div className="space-y-4">
          <div className="mirror-frame mx-auto aspect-[3/4] w-full max-w-xs bg-ink/5">
            {cameraAllowed && !cameraError ? (
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Camera preview" />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-ink/50">{cameraError ?? 'No camera on this device. Choose a photo instead.'}</div>
            )}
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[62%] w-[58%] rounded-[50%] border-2 border-dashed border-white/70" />
            </div>
          </div>
          <p role="status" aria-live="polite" className="min-h-5 text-center text-sm text-ink/60">
            {phase === 'analysing' ? 'Reading skin tone…' : (error ?? 'Centre your face in the oval, neutral expression.')}
          </p>
          {cameraAllowed && !cameraError ? (
            <PrimaryButton onClick={() => void takePhoto()} disabled={phase === 'analysing'}>
              <Camera className="h-5 w-5" aria-hidden /> Take photo
            </PrimaryButton>
          ) : null}
          <label className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-ink/10 bg-white/40 px-5 text-sm font-medium text-ink/80 hover:bg-white/70">
            <ImagePlus className="h-4 w-4" aria-hidden /> Choose a photo
            <input type="file" accept="image/*" capture="user" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} disabled={phase === 'analysing'} />
          </label>
          <GhostButton onClick={onSkip}>
            <SkipForward className="h-4 w-4" aria-hidden /> Skip this step
          </GhostButton>
          <PrivacyNote />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            {tileUrl ? (
              <img src={tileUrl} alt="Your identity tile (background removed)" className="h-24 w-24 rounded-3xl border border-ink/10 object-cover" />
            ) : null}
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">Skin tone</span>
                <EstimateBadge />
              </div>
              {result?.skin ? (
                <p className="text-ink/60">
                  Monk {monk ?? result.skin.monk} · {result.skin.undertone} undertone · {result.skin.season.season}
                </p>
              ) : (
                <p className="text-ink/60">Could not sample enough skin pixels.</p>
              )}
            </div>
          </div>
          {result?.skin ? (
            <fieldset className="space-y-2">
              <legend className="text-xs uppercase tracking-wider text-ink/40">Confirm or adjust your swatch</legend>
              <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Monk skin tone swatch">
                {MONK_SWATCHES.map((hex, i) => {
                  const n = i + 1;
                  const selected = monk === n;
                  return (
                    <button
                      key={hex}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={`Monk tone ${n}`}
                      onClick={() => setMonk(n)}
                      className={`aspect-square rounded-lg border-2 ${selected ? 'border-coral ring-2 ring-coral/30' : 'border-white/60'}`}
                      style={{ backgroundColor: hex }}
                    />
                  );
                })}
              </div>
              <p className="text-xs text-ink/50">
                Colour season <em>{result.skin.season.season}</em> is a rule-based estimate from skin, hair and contrast — you can change it later in your profile.
              </p>
            </fieldset>
          ) : null}
          <PrimaryButton onClick={confirm}>
            <Check className="h-5 w-5" aria-hidden /> Looks right
          </PrimaryButton>
          <GhostButton
            onClick={() => {
              setResult(null);
              setPhase('preview');
            }}
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Retake
          </GhostButton>
        </div>
      )}
    </Panel>
  );
}
