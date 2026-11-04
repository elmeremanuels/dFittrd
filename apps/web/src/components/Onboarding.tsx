import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Camera, ChevronRight, Sparkles } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { BodyProfile } from '@paskamer/schema';
import { ONBOARDING_VIBES } from '@paskamer/taste-engine';
import { CaptureStep, MANUAL_RANGES, MEASUREMENT_LABELS, validateManual, type CaptureExtras, type ManualForm, EMPTY_MANUAL_FORM } from '@/features/capture';
import { METHOD_LABELS } from '@/features/capture/captureMachine';
import type { ManualMethod } from '@paskamer/schema';
import { useApp } from '@/store';
import { NumberField } from './NumberField';

/**
 * Handoff §2 order: welcome → measurements → style vibes → capture → done.
 * Next is gated per step; the capture step completes only via CaptureStep.onComplete or an
 * explicit skip. Measurements entered here prefill the capture step's manual stage.
 */
export type OnboardingStep = 'welcome' | 'measurements' | 'vibes' | 'capture' | 'done';
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['welcome', 'measurements', 'vibes', 'capture', 'done'];

const FIELDS: { key: keyof typeof MANUAL_RANGES; unit: string; optional: boolean; hint?: string }[] = [
  { key: 'height', unit: 'cm', optional: false },
  { key: 'weight', unit: 'kg', optional: true },
  { key: 'bust', unit: 'cm', optional: true, hint: 'Around the fullest part, tape level.' },
  { key: 'waist', unit: 'cm', optional: true, hint: 'Narrowest point, relaxed.' },
  { key: 'hip', unit: 'cm', optional: true, hint: 'Fullest part of the hips.' },
  { key: 'footEu', unit: 'EU', optional: true, hint: 'Your usual EU shoe size.' },
];

export function Onboarding({ initialStep = 'welcome', onFinished }: { initialStep?: OnboardingStep; onFinished?: () => void }): ReactNode {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const existing = useApp((s) => s.profile);
  const setProfile = useApp((s) => s.setProfile);
  const completeOnboarding = useApp((s) => s.completeOnboarding);
  const pendingIntent = useApp((s) => s.pendingIntent);
  const [step, setStep] = useState<OnboardingStep>(initialStep);
  const [form, setForm] = useState<ManualForm>(() => ({ ...EMPTY_MANUAL_FORM, ...prefill(existing) }));
  const [vibes, setVibes] = useState<string[]>([]);
  const [captured, setCaptured] = useState<'none' | 'done' | 'skipped'>('none');
  const [submitted, setSubmitted] = useState(false);
  const errors = useMemo(() => validateManual(form), [form]);
  const measurementsValid = Object.keys(errors).length === 0;
  const idx = ONBOARDING_STEPS.indexOf(step);

  const next = (): void => {
    const n = ONBOARDING_STEPS[idx + 1];
    if (n) setStep(n);
  };

  const finish = async (): Promise<void> => {
    await completeOnboarding(vibes);
    onFinished?.();
    if (pendingIntent) navigate(`/try/${encodeURIComponent(pendingIntent.token)}`, { replace: true });
    else navigate('/deck', { replace: true });
  };

  const onCaptureComplete = async (profile: BodyProfile, extras: CaptureExtras): Promise<void> => {
    await setProfile(profile, { skin: extras.skin, signature: extras.signature.wire });
    setCaptured('done');
    setStep('done');
  };

  const onCaptureSkip = async (): Promise<void> => {
    // Keep what was typed: a manual-only profile still drives the fit engine.
    const manualOnly = manualProfile(form, existing);
    if (manualOnly) await setProfile(manualOnly);
    setCaptured('skipped');
    setStep('done');
  };

  const titles: Record<OnboardingStep, { title: string; subtitle: string }> = {
    welcome: { title: 'Welcome to Paskamer', subtitle: 'Your private fitting room. Realistic fit, your taste, nothing leaves your phone.' },
    measurements: { title: 'Your measurements', subtitle: 'They drive the fit directly, and keep the scan honest.' },
    vibes: { title: 'Your style vibe', subtitle: 'Pick what resonates. The deck learns the rest from your swipes.' },
    capture: { title: 'Capture', subtitle: 'A face photo and an 8-second video, measured on this device.' },
    done: { title: 'You are set', subtitle: captured === 'done' ? 'Your capture is stored encrypted on this phone.' : 'You can add a scan later from your profile.' },
  };

  return (
    <div className="safe-top safe-bottom flex min-h-dvh flex-col bg-cream px-5 pb-4" data-testid="onboarding" data-step={step}>
      <div className="mt-6 text-center">
        <motion.div key={step} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="min-h-10 font-display text-3xl font-medium tracking-tight text-balance">{titles[step].title}</h1>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-soft">{titles[step].subtitle}</p>
        </motion.div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col justify-center py-4">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={reduce ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={reduce ? undefined : { opacity: 0, x: -16 }} transition={{ duration: reduce ? 0 : 0.2 }} className="w-full">
            {step === 'welcome' ? (
              <div className="flex flex-col items-center gap-6 py-8">
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-coral shadow-lg shadow-coral/25 motion-safe:animate-float">
                  <Sparkles className="h-10 w-10 text-white" aria-hidden />
                </div>
                <ul className="max-w-xs space-y-2 text-center text-sm text-ink-soft">
                  <li>See how a size M really fits <em>you</em>.</li>
                  <li>Swipe a rail that learns your taste.</li>
                  <li>Photos and video never leave this device.</li>
                </ul>
              </div>
            ) : null}

            {step === 'measurements' ? (
              <form
                className="mx-auto max-w-md space-y-4 overflow-y-auto px-1"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  setSubmitted(true);
                  if (measurementsValid) next();
                }}
              >
                {FIELDS.map((f) => (
                  <NumberField
                    key={f.key}
                    label={MEASUREMENT_LABELS[f.key]}
                    unit={f.unit}
                    value={form[f.key]}
                    min={MANUAL_RANGES[f.key][0]}
                    max={MANUAL_RANGES[f.key][1]}
                    step={f.key === 'footEu' ? 0.5 : 0.5}
                    optional={f.optional}
                    hint={f.hint}
                    error={submitted ? errors[f.key] : undefined}
                    onChange={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
                  />
                ))}
                <fieldset className="space-y-2">
                  <legend className="eyebrow">How did you measure?</legend>
                  <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How did you measure">
                    {(Object.keys(METHOD_LABELS) as ManualMethod[]).map((m) => {
                      const on = form.method === m;
                      return (
                        <button key={m} type="button" role="radio" aria-checked={on} onClick={() => setForm((p) => ({ ...p, method: m }))} className={`rounded-2xl border px-2 py-2 text-left text-xs ${on ? 'border-coral bg-coral/10' : 'border-ink/10 bg-white/50'}`}>
                          <span className="block font-medium text-ink">{METHOD_LABELS[m].label}</span>
                          <span className="text-ink-mute">{METHOD_LABELS[m].hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              </form>
            ) : null}

            {step === 'vibes' ? (
              <div className="mx-auto grid max-w-md grid-cols-2 gap-3 py-2" role="group" aria-label="Style vibes">
                {ONBOARDING_VIBES.map((v) => {
                  const on = vibes.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setVibes((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]))}
                      className={`rounded-2xl border p-4 text-sm font-medium transition-colors ${on ? 'border-coral bg-coral text-white' : 'border-ink/10 bg-white/60 text-ink hover:bg-coral/10'}`}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {step === 'capture' ? (
              <div className="-mx-5">
                <CaptureStep onComplete={(p, extras) => void onCaptureComplete(p, extras)} onSkip={() => void onCaptureSkip()} initialProfile={existing} initialForm={form} />
              </div>
            ) : null}

            {step === 'done' ? (
              <div className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-ink text-cream">
                  <Camera className="h-8 w-8" aria-hidden />
                </div>
                <p className="max-w-xs text-sm text-ink-soft">
                  {captured === 'done' ? 'Only an 80-number fit signature can sync — no photo, no face or skin data. You will see it in your privacy ledger.' : 'Your typed measurements are stored on this device only.'}
                </p>
              </div>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="space-y-4">
        <ol className="flex justify-center gap-2" aria-label="Progress">
          {ONBOARDING_STEPS.map((s, i) => (
            <li key={s} aria-current={i === idx ? 'step' : undefined} className={`h-1 rounded-full transition-all ${i === idx ? 'w-8 bg-coral' : 'w-2 bg-ink/15'}`} />
          ))}
        </ol>
        {step === 'capture' ? null : (
          <button
            type="button"
            onClick={() => {
              if (step === 'measurements') {
                setSubmitted(true);
                if (measurementsValid) next();
                return;
              }
              if (step === 'done') void finish();
              else next();
            }}
            disabled={step === 'measurements' && submitted && !measurementsValid}
            className="btn-primary w-full"
          >
            <span>{step === 'done' ? 'Enter the fitting room' : 'Next'}</span>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        )}
        {step === 'measurements' ? (
          <p className="text-center text-xs text-ink-mute">Stored on this device only. Height is required; everything else is optional.</p>
        ) : null}
      </div>
    </div>
  );
}

function prefill(profile: BodyProfile | null): Partial<ManualForm> {
  if (!profile) return {};
  const m = profile.measurements;
  const s = (k: keyof typeof m): string => (m[k] ? String(Math.round(m[k]!.mean * 2) / 2) : '');
  return { height: s('height'), weight: s('weight'), bust: s('bust'), waist: s('waist'), hip: s('hip'), footEu: s('footEu'), method: profile.manualMethod ?? 'memory' };
}

/** A schema-valid manual-only profile from the typed form (sigma from the method), or null without a height. */
export function manualProfile(form: ManualForm, previous: BodyProfile | null): BodyProfile | null {
  const sigma = { tape: 1.5, memory: 2.5, guess: 4 }[form.method];
  const measurements: BodyProfile['measurements'] = {};
  const put = (key: keyof BodyProfile['measurements'], raw: string, s: number): void => {
    const v = Number.parseFloat(raw);
    if (Number.isFinite(v) && v > 0) measurements[key] = { mean: v, sigma: s, source: 'manual' };
  };
  put('height', form.height, 1);
  put('weight', form.weight, 1);
  put('bust', form.bust, sigma);
  put('waist', form.waist, sigma);
  put('hip', form.hip, sigma);
  put('footEu', form.footEu, 0.5);
  if (!measurements.height) return null;
  return {
    version: 1,
    measurements,
    manualMethod: form.method,
    ...(previous?.history ? { history: previous.history } : {}),
    createdAt: previous?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

export default Onboarding;
