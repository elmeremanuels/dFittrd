import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { AlertTriangle, SkipForward, Video } from 'lucide-react';
import { MANUAL_RANGES, SCAN_PROTOCOL, parseNumber, protocolPhase } from '../captureMachine';
import { gateHint } from '../poseGate';
import { attachStream, openCamera, startFramePump, type CameraHandle } from '../platform/camera';
import type { ScanSession } from '../scanSession';
import type { GateReason, Sex } from '../types';
import type { ScanResultMessage } from '../workerProtocol';
import { GhostButton, Panel, PrimaryButton, PrivacyNote, StepHeader, useCaptureVariant } from './ui';

interface Props {
  session: ScanSession | null;
  modelsReady: boolean;
  modelsFailed: boolean;
  initialHeight: string;
  initialWeight: string;
  sex: Sex;
  onHeightChange: (height: string, weight: string) => void;
  onDone: (result: ScanResultMessage) => void;
  onSkip: () => void;
}

type Phase = 'setup' | 'countdown' | 'recording' | 'processing' | 'error';

export function BodyStep({ session, modelsReady, modelsFailed, initialHeight, initialWeight, sex, onHeightChange, onDone, onSkip }: Props): ReactNode {
  const reduce = useReducedMotion();
  const embed = useCaptureVariant() === 'embed';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const camRef = useRef<CameraHandle | null>(null);
  const stopPumpRef = useRef<(() => void) | null>(null);
  const timersRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const mountedRef = useRef(true);
  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    attachStream(el, camRef.current?.stream);
  }, []);
  const [phase, setPhase] = useState<Phase>('setup');
  const [height, setHeight] = useState(initialHeight);
  const [weight, setWeight] = useState(initialWeight);
  const [hint, setHint] = useState('Step into the frame');
  const [gateOk, setGateOk] = useState(false);
  const [reasons, setReasons] = useState<GateReason[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [haveSide, setHaveSide] = useState(false);

  const h = parseNumber(height);
  const heightValid = h !== null && h >= MANUAL_RANGES.height[0] && h <= MANUAL_RANGES.height[1];
  const w = parseNumber(weight);
  const weightValid = w === null || (w >= MANUAL_RANGES.weight[0] && w <= MANUAL_RANGES.weight[1]);

  // Camera lifecycle
  useEffect(() => {
    let cancelled = false;
    mountedRef.current = true;
    const timers = timersRef.current;
    openCamera('user')
      .then((cam) => {
        if (cancelled) {
          cam.stop();
          return;
        }
        camRef.current = cam;
        attachStream(videoRef.current, cam.stream);
      })
      .catch((e: unknown) => setCameraError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Camera access was declined.' : 'Could not open the camera.'));
    return () => {
      cancelled = true;
      mountedRef.current = false;
      for (const t of timers) clearInterval(t);
      timers.clear();
      stopPumpRef.current?.();
      stopPumpRef.current = null;
      camRef.current?.stop();
      camRef.current = null;
    };
  }, []);

  // Gate feedback from the worker
  useEffect(() => {
    if (!session) return;
    const off = session.onGate((m) => {
      setGateOk(m.gate.ok);
      setReasons(m.gate.reasons);
      setHaveSide(m.haveSide);
    });
    const offP = session.onProgress((m) => setProgress(m.pct));
    return () => {
      off();
      offP();
    };
  }, [session]);

  // Hint text: throttled so the aria-live region is not spammed every frame. The latest reasons and
  // elapsed time are read from refs: with them as effect dependencies the interval was re-created
  // every 100 ms during recording and never fired, so the spoken "turn 90°" cue never came.
  const reasonsRef = useRef(reasons);
  const elapsedRef = useRef(elapsed);
  useEffect(() => {
    reasonsRef.current = reasons;
    elapsedRef.current = elapsed;
  }, [reasons, elapsed]);
  useEffect(() => {
    const id = setInterval(() => {
      const rs = reasonsRef.current;
      const ph = protocolPhase(elapsedRef.current);
      if (phase === 'recording' && ph === 'side') {
        setHint(rs.includes('tilted') || rs.includes('not_full_body') ? gateHint(rs.filter((r) => r !== 'arms_not_in_a_pose')) : 'Now turn 90° to your left and hold still');
      } else {
        setHint(gateHint(rs));
      }
    }, 600);
    return () => clearInterval(id);
  }, [phase]);

  const start = (): void => {
    if (!session || !heightValid || !videoRef.current) return;
    onHeightChange(height, weight);
    setError(null);
    setPhase('countdown');
    setCountdown(3);
    let c = 3;
    const id = setInterval(() => {
      c -= 1;
      setCountdown(c);
      if (c <= 0) {
        clearInterval(id);
        timersRef.current.delete(id);
        record();
      }
    }, 1000);
    timersRef.current.add(id);
  };

  const record = (): void => {
    const v = videoRef.current;
    if (!v || !session) return;
    session.reset();
    setPhase('recording');
    const t0 = performance.now();
    stopPumpRef.current = startFramePump(v, {
      fps: 15,
      resizeWidth: 480,
      onFrame: (bmp, ts) => session.pushFrame(bmp, ts),
    });
    const tick = setInterval(() => {
      const e = performance.now() - t0;
      setElapsed(e);
      if (e >= SCAN_PROTOCOL.totalMs) {
        clearInterval(tick);
        timersRef.current.delete(tick);
        stopPumpRef.current?.();
        stopPumpRef.current = null;
        finish();
      }
    }, 100);
    timersRef.current.add(tick);
  };

  const finish = (): void => {
    if (!session || h === null || !mountedRef.current) return;
    setPhase('processing');
    setProgress(0);
    session
      .finish({ heightCm: h, weightKg: w ?? undefined, sex })
      .then((res) => {
        camRef.current?.stop();
        if (mountedRef.current) onDone(res);
      })
      .catch((e: unknown) => {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : 'The scan could not be measured.');
        setPhase('error');
      });
  };

  const pct = Math.min(100, Math.round((elapsed / SCAN_PROTOCOL.totalMs) * 100));
  const ring = 2 * Math.PI * 46;

  return (
    <Panel className="space-y-5">
      <StepHeader
        eyebrow={embed ? 'Step 1 of 2' : 'Step 2 of 3'}
        title="Body scan"
        subtitle={`8 seconds. Stand 2–3 m away in fitted clothing, ${embed ? 'camera' : 'phone'} upright.`}
      />

      {/* The preview is mounted in every phase: start() needs the <video> (it used to exist only after
          setup, so the scan could never start), and the user frames themselves before starting. */}
      <div className="mirror-frame mx-auto aspect-[9/16] w-full max-w-xs bg-ink/5">
        <video ref={setVideo} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Camera preview" />
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className={`absolute inset-3 rounded-[2rem] border-2 transition-colors ${gateOk ? 'border-emerald-400' : 'border-white/60'}`} />
          {phase === 'countdown' ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-display text-7xl text-white drop-shadow">{countdown}</span>
            </div>
          ) : null}
          {phase === 'recording' ? (
            <svg className="absolute right-4 top-4 h-14 w-14" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="6" />
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="#FF5A3C"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={ring}
                strokeDashoffset={ring * (1 - pct / 100)}
                transform="rotate(-90 50 50)"
                style={{ transition: reduce ? 'none' : 'stroke-dashoffset 120ms linear' }}
              />
            </svg>
          ) : null}
          {phase === 'processing' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/40 text-white">
              <span className="text-sm">Measuring on device…</span>
              <span className="font-display text-3xl">{progress}%</span>
            </div>
          ) : null}
        </div>
      </div>

      {phase === 'setup' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs uppercase tracking-wider text-ink/40">Height (cm)</span>
              <input
                type="number"
                inputMode="decimal"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                min={MANUAL_RANGES.height[0]}
                max={MANUAL_RANGES.height[1]}
                required
                aria-invalid={!heightValid}
                aria-describedby="height-help"
                className="w-full rounded-2xl border border-ink/10 bg-white/60 px-3 py-2 font-serif text-lg focus:border-coral focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs uppercase tracking-wider text-ink/40">Weight (kg, optional)</span>
              <input
                type="number"
                inputMode="decimal"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                min={MANUAL_RANGES.weight[0]}
                max={MANUAL_RANGES.weight[1]}
                aria-invalid={!weightValid}
                className="w-full rounded-2xl border border-ink/10 bg-white/60 px-3 py-2 font-serif text-lg focus:border-coral focus:outline-none"
              />
            </label>
          </div>
          <p id="height-help" className="text-xs text-ink/50">
            Your height sets the scale of the scan; weight improves the estimate. Neither is ever uploaded.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink/70">
            <li>{embed ? 'Place your phone or laptop so the camera is at hip height, 2–3 m away.' : 'Prop the phone upright at hip height, 2–3 m away.'}</li>
            <li>Face the camera, arms slightly away from your body (A-pose), feet together.</li>
            <li>Halfway through, turn 90° to your left and hold still.</li>
          </ol>
          {modelsFailed || cameraError ? (
            <p role="alert" className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {cameraError ?? 'The scan models could not be loaded. You can still enter measurements by hand.'}
            </p>
          ) : null}
          <PrimaryButton onClick={start} disabled={!session || !modelsReady || !heightValid || !weightValid || !!cameraError}>
            <Video className="h-5 w-5" aria-hidden /> {modelsReady ? 'Start 8-second scan' : 'Loading scan models…'}
          </PrimaryButton>
          <GhostButton onClick={onSkip}>
            <SkipForward className="h-4 w-4" aria-hidden /> Skip, enter measurements manually
          </GhostButton>
          <PrivacyNote />
        </div>
      ) : null}

      {phase !== 'setup' ? (
        <div className="space-y-4">
          <p role="status" aria-live="polite" aria-atomic className="min-h-6 text-center text-sm font-medium text-ink/80">
            {phase === 'countdown' ? `Get ready… ${countdown}` : phase === 'processing' ? 'Measuring on device' : phase === 'error' ? (error ?? 'Scan failed') : hint}
          </p>
          {phase === 'recording' ? (
            <p className="text-center text-xs text-ink/50">
              {protocolPhase(elapsed) === 'front' ? 'Facing the camera' : haveSide ? 'Side view captured' : 'Turn to your side'} · {Math.ceil((SCAN_PROTOCOL.totalMs - elapsed) / 1000)} s
            </p>
          ) : null}
          {phase === 'error' ? (
            <div className="space-y-2">
              <PrimaryButton onClick={() => setPhase('setup')}>Try again</PrimaryButton>
              <GhostButton onClick={onSkip}>Enter measurements manually instead</GhostButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
