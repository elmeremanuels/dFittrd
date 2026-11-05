/**
 * The onboarding capture step (handoff §2.1): face photo → 8 s body video → manual measurements →
 * fusion result. Everything runs on device; see ../README.md for the pipeline and guarantees.
 *
 * Works without a camera (skips straight to manual entry) and degrades when MediaPipe fails to
 * load (camera stages are skipped, manual entry + population prior remain).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import { Camera, Ruler, ShieldCheck, Sparkles } from 'lucide-react';
import type { BodyMeasurementKey, BodyProfile } from '@curtain/schema';
import { EMPTY_MANUAL_FORM, manualEntries, nextStage, type FlowCaps, type ManualForm, type Stage } from '../captureMachine';
import { fuseProfile, type FuseResult } from '../fuse';
import { hasCamera } from '../platform/camera';
import { ScanSession } from '../scanSession';
import { buildFitSignature, type BuiltSignature } from '../signature';
import { saveCapture, storageAvailable, type SilhouetteMask } from '../storage';
import type { ScanMeasurements, SkinEstimate } from '../types';
import type { ScanResultMessage } from '../workerProtocol';
import { BodyStep } from './BodyStep';
import { FaceStep, type FaceStepResult } from './FaceStep';
import { FusionStep } from './FusionStep';
import { ManualStep } from './ManualStep';
import { CaptureVariantContext, GhostButton, Panel, PrimaryButton, PrivacyNote, StepHeader, type CaptureVariant } from './ui';

export interface CaptureExtras {
  faceTileBlob: Blob | null;
  skin: SkinEstimate | null;
  scan: ScanMeasurements | null;
  baseFrame: { blob: Blob; width: number; height: number } | null;
  silhouette: { front: SilhouetteMask; side: SilhouetteMask | null } | null;
  /** FitSignature v1 built from the profile — the only thing the app may sync (PUT /v1/me/signature). */
  signature: BuiltSignature;
}

export interface CaptureStepProps {
  onComplete: (profile: BodyProfile, extras: CaptureExtras) => void;
  onSkip: () => void;
  /** Persist to IndexedDB (Dexie db `curtain`) before calling onComplete. Default true. */
  persist?: boolean;
  /** Same-origin base path of the MediaPipe assets. Default `/models`. */
  modelBase?: string;
  /** Previous profile (keeps createdAt/history when re-capturing). */
  initialProfile?: BodyProfile | null;
  /** Prefill for the manual form (e.g. from the previous profile). */
  initialForm?: Partial<ManualForm>;
  /**
   * `embed` (COPY-1): the standalone fitting room on a shop's page. Skips the face photo (the
   * identity tile is an app feature), and its copy says "this device" and never mentions syncing.
   */
  variant?: CaptureVariant;
}

export function CaptureStep({ onComplete, onSkip, persist = true, modelBase, initialProfile = null, initialForm, variant = 'app' }: CaptureStepProps): ReactNode {
  const embed = variant === 'embed';
  const [stage, setStage] = useState<Stage>('intro');
  const [caps, setCaps] = useState<FlowCaps>({ camera: null, models: 'idle' });
  const sessionRef = useRef<ScanSession | null>(null);
  const [session, setSession] = useState<ScanSession | null>(null);
  const [face, setFace] = useState<FaceStepResult | null>(null);
  const [body, setBody] = useState<ScanResultMessage | null>(null);
  const [form, setForm] = useState<ManualForm>({ ...EMPTY_MANUAL_FORM, ...initialForm });
  const [remeasures, setRemeasures] = useState<Partial<Record<BodyMeasurementKey, number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Probe capabilities and warm the worker once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cam = (await hasCamera()) && ScanSession.isSupported();
      if (cancelled) return;
      setCaps((c) => ({ ...c, camera: cam }));
      if (!cam) return;
      const s = new ScanSession({ modelBase });
      sessionRef.current = s;
      setSession(s);
      setCaps((c) => ({ ...c, models: 'loading' }));
      try {
        await s.init();
        if (!cancelled) setCaps((c) => ({ ...c, models: 'ready' }));
      } catch {
        if (!cancelled) setCaps((c) => ({ ...c, models: 'failed' }));
      }
    })().catch(() => setCaps({ camera: false, models: 'failed' }));
    return () => {
      cancelled = true;
      sessionRef.current?.dispose();
      sessionRef.current = null;
    };
  }, [modelBase]);

  const advance = useCallback(
    () =>
      setStage((s) => {
        const next = nextStage(s, caps);
        // The embed has no identity tile: go straight from the intro to the body scan.
        return embed && next === 'face' ? nextStage('face', caps) : next;
      }),
    [caps, embed],
  );

  const fused: FuseResult | null = useMemo(() => {
    if (stage !== 'fusion') return null;
    return fuseProfile({
      scan: body?.scan ?? null,
      manual: manualEntries(form, remeasures),
      manualMethod: form.method,
      sex: form.sex,
      remeasured: Object.keys(remeasures) as BodyMeasurementKey[],
      previous: initialProfile,
    });
  }, [stage, body, form, remeasures, initialProfile]);

  const confirm = async (): Promise<void> => {
    if (!fused) return;
    setBusy(true);
    setError(null);
    try {
      const signature = buildFitSignature(fused.profile, body?.scan ?? null, { sex: form.sex });
      const extras: CaptureExtras = {
        faceTileBlob: face?.tile?.blob ?? null,
        skin: face?.skin ?? null,
        scan: body?.scan ?? null,
        baseFrame: body?.baseFrame ?? null,
        silhouette: body?.silhouette ?? null,
        signature,
      };
      if (persist && storageAvailable()) {
        await saveCapture({
          profile: fused.profile,
          baseFrame: extras.baseFrame,
          faceTile: face?.tile ? { blob: face.tile.blob, skin: face.skin } : null,
          silhouette: extras.silhouette,
        });
      }
      onComplete(fused.profile, extras);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your profile on this device.');
    } finally {
      setBusy(false);
    }
  };

  const modelsReady = caps.models === 'ready';
  const cameraStagesPossible = caps.camera === true && caps.models !== 'failed';

  return (
    <CaptureVariantContext.Provider value={variant}>
    <div className="mx-auto w-full max-w-md space-y-4 px-4 py-6" aria-live="off">
      <AnimatePresence mode="wait">
        {stage === 'intro' ? (
          <Panel key="intro" className="space-y-6">
            {embed ? (
              <>
                <StepHeader eyebrow="More accurate fit" title="Quick body scan" subtitle="About 30 seconds. Nothing leaves this device." />
                <ul className="space-y-3 text-sm text-ink/70">
                  <li className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-coral" aria-hidden />
                    An 8-second body video, measured in this browser.
                  </li>
                  <li className="flex items-start gap-3">
                    <Ruler className="mt-0.5 h-5 w-5 shrink-0 text-coral" aria-hidden />
                    Check or add a few measurements.
                  </li>
                  <li className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-coral" aria-hidden />
                    Every result is an estimate and says how sure it is.
                  </li>
                </ul>
              </>
            ) : (
              <>
                <StepHeader eyebrow="Your private fitting room" title="Let’s measure you" subtitle="About two minutes. Nothing leaves your phone." />
                <ul className="space-y-3 text-sm text-ink/70">
                  <li className="flex items-start gap-3">
                    <Camera className="mt-0.5 h-5 w-5 shrink-0 text-coral" aria-hidden />
                    One face photo for your skin tone and identity tile.
                  </li>
                  <li className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-coral" aria-hidden />
                    An 8-second body video, measured by a model running on this device.
                  </li>
                  <li className="flex items-start gap-3">
                    <Ruler className="mt-0.5 h-5 w-5 shrink-0 text-coral" aria-hidden />
                    A few tape measurements to keep the scan honest.
                  </li>
                  <li className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-coral" aria-hidden />
                    Every result is an estimate and says how sure it is.
                  </li>
                </ul>
              </>
            )}
            {caps.camera === false ? <p className="text-xs text-ink/50">No camera detected — we will go straight to manual measurements.</p> : null}
            {caps.models === 'failed' ? <p className="text-xs text-ink/50">The scan models could not be loaded; manual measurements still work.</p> : null}
            <PrimaryButton onClick={advance} disabled={caps.camera === null}>
              {caps.camera === null ? 'Checking your device…' : cameraStagesPossible ? (embed ? 'Start the scan' : 'Start with a photo') : 'Enter measurements'}
            </PrimaryButton>
            <GhostButton onClick={onSkip}>Skip for now</GhostButton>
            <PrivacyNote />
          </Panel>
        ) : null}

        {stage === 'face' ? (
          <FaceStep
            key="face"
            session={modelsReady ? session : null}
            cameraAllowed={caps.camera === true}
            onDone={(r) => {
              setFace(r);
              advance();
            }}
            onSkip={advance}
          />
        ) : null}

        {stage === 'body' ? (
          <BodyStep
            key="body"
            session={session}
            modelsReady={modelsReady}
            modelsFailed={caps.models === 'failed'}
            initialHeight={form.height}
            initialWeight={form.weight}
            sex={form.sex}
            onHeightChange={(height, weight) => setForm((f) => ({ ...f, height, weight }))}
            onDone={(r) => {
              setBody(r);
              setStage('manual');
            }}
            onSkip={() => setStage('manual')}
          />
        ) : null}

        {stage === 'manual' ? <ManualStep key="manual" form={form} hasScan={!!body} onChange={setForm} onDone={() => setStage('fusion')} /> : null}

        {stage === 'fusion' && fused ? (
          <FusionStep
            key="fusion"
            result={fused}
            busy={busy}
            error={error}
            onRemeasure={(key, value) => setRemeasures((r) => ({ ...r, [key]: value }))}
            onRescan={
              cameraStagesPossible
                ? () => {
                    setBody(null);
                    setRemeasures({});
                    setStage('body');
                  }
                : null
            }
            onConfirm={() => void confirm()}
          />
        ) : null}
      </AnimatePresence>
    </div>
    </CaptureVariantContext.Provider>
  );
}

export default CaptureStep;
