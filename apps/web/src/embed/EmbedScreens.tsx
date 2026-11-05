/**
 * Presentational pieces of the standalone embed (docs/STANDALONE.md §1.3). No state lives here
 * beyond local UI toggles; EmbedApp owns the flow.
 */
import { AlertTriangle, Camera, Clock, PackageX, PauseCircle, Ruler, ShieldCheck, WifiOff } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import type { GarmentPayload, ShopBranding } from '@curtain/schema';
import { readableTextColor } from '@/lib/contrast';
import { ABOUT_LABELS, ABOUT_RANGES, ABOUT_UNITS, AGE_RANGES, FIT_PREFERENCES, measurementFieldsFor, requiredFieldsFor, type AboutField, type AboutForm, type FitPreference } from './aboutYou';
import type { BlockedKind } from './flow';
import { mediaProxyUrl } from './media';

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export function EmbedFrame({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="min-h-dvh w-full bg-cream text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col">{children}</div>
    </div>
  );
}

/** The header's background: bg-white/60 over cream, flattened (for the brand colour contrast check). */
const HEADER_BG = '#FBF9F5';

export function ProductHeader({ shop, garment }: { shop: ShopBranding | null; garment: GarmentPayload | null }): ReactNode {
  // Carry-over #11: the photo loads through our api, never from the merchant's server.
  const photo = mediaProxyUrl(shop?.id, garment?.productPhotos?.[0] ?? garment?.flatLayPhoto);
  const [photoFailed, setPhotoFailed] = useState<string | null>(null);
  // A11Y-2: the brand colour is decoration (top border); as text only when it reaches 4.5:1.
  const nameColor = readableTextColor(shop?.brandColor, HEADER_BG);
  return (
    <header className="border-b border-ink/10 bg-white/60 px-4 pt-4 pb-3" style={shop?.brandColor ? { borderTop: `4px solid ${shop.brandColor}` } : undefined} data-testid="embed-header">
      <div className="flex items-center gap-3">
        {photo && photoFailed !== photo ? (
          <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setPhotoFailed(photo)} className="h-16 w-14 shrink-0 rounded-xl bg-cream-deep object-cover" data-testid="embed-product-photo" />
        ) : (
          <span className="flex h-16 w-14 shrink-0 items-center justify-center rounded-xl text-lg font-semibold text-white" style={{ background: garment?.primaryColorHex ?? shop?.brandColor ?? '#1A1612' }} aria-hidden>
            {(garment?.name ?? shop?.name ?? 'C').slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate" style={nameColor ? { color: nameColor } : undefined} data-testid="embed-shop-name">
            {shop?.name ?? 'Curtain'}
          </p>
          <h1 className="truncate font-display text-xl leading-tight">{garment?.name ?? 'Find your size'}</h1>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-mute">
            <ShieldCheck className="h-3.5 w-3.5 text-ok" aria-hidden /> Your measurements stay on this device
          </p>
        </div>
      </div>
    </header>
  );
}

export function EmbedFooter({
  remember,
  onRemember,
  onForget,
  forgetStatus,
  appUrl,
}: {
  remember: boolean;
  onRemember: (on: boolean) => void;
  onForget: () => void;
  forgetStatus: string | null;
  appUrl: string;
}): ReactNode {
  const id = useId();
  return (
    <footer className="mt-auto space-y-2 border-t border-ink/10 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs text-ink-soft" data-testid="embed-footer">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="flex cursor-pointer items-center gap-2">
          <input id={id} type="checkbox" role="switch" aria-checked={remember} checked={remember} onChange={(e) => onRemember(e.target.checked)} className="h-4 w-4" />
          <span>Remember me on this shop</span>
        </label>
        <button type="button" onClick={onForget} className="font-medium text-coral-ink underline-offset-2 hover:underline">
          Forget me
        </button>
      </div>
      {forgetStatus ? (
        <p role="status" className="text-ink-mute">
          {forgetStatus}
        </p>
      ) : (
        <p className="text-ink-mute">{remember ? 'Saved only in this browser, for this shop.' : 'Nothing is saved; closing this window clears it.'}</p>
      )}
      <p className="flex items-center justify-between gap-2 text-ink-mute">
        <span>
          Fit by <span className="font-display text-sm text-ink">Curtain</span>
        </span>
        <a href={appUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
          Get the Curtain app
        </a>
      </p>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// About you
// ---------------------------------------------------------------------------

function TextNumber({ field, value, error, optional, onChange }: { field: AboutField; value: string; error?: string | undefined; optional?: boolean; onChange: (v: string) => void }): ReactNode {
  const id = useId();
  const [lo, hi] = ABOUT_RANGES[field];
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={id} className="eyebrow block">
        {ABOUT_LABELS[field]} {optional ? <span className="font-normal normal-case tracking-normal">(optional)</span> : null}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={`${lo}–${hi}`}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`field-input pr-12 ${error ? 'border-coral' : ''}`}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-ink-mute">{ABOUT_UNITS[field]}</span>
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-xs text-coral-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const PREF_TEXT: Record<FitPreference, string> = { snug: 'Snug', regular: 'Regular', relaxed: 'Relaxed' };

export function AboutScreen({
  form,
  errors,
  category,
  editing,
  canScan,
  onChange,
  onSubmit,
}: {
  form: AboutForm;
  errors: Partial<Record<AboutField, string>>;
  category: GarmentPayload['category'];
  editing: boolean;
  canScan: boolean;
  onChange: (f: AboutForm) => void;
  onSubmit: (scan: boolean) => void;
}): ReactNode {
  const set = <K extends keyof AboutForm>(k: K, v: AboutForm[K]): void => onChange({ ...form, [k]: v });
  const fields = measurementFieldsFor(category);
  const required = requiredFieldsFor(category);
  const ageId = useId();
  const sexId = useId();
  return (
    <form
      className="space-y-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(false);
      }}
      aria-labelledby="about-title"
    >
      <div>
        <p className="eyebrow text-coral-ink">{editing ? 'Edit my measurements' : 'Step 1 of 2'}</p>
        <h2 id="about-title" className="font-display text-3xl leading-tight" tabIndex={-1} data-step-heading>
          About you
        </h2>
        <p className="text-sm text-ink-soft">{required.length > 0 ? 'Three numbers' : 'Two numbers'} and you’ll see your size. Metric, takes under 30 seconds.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextNumber field="height" value={form.height} error={errors.height} onChange={(v) => set('height', v)} />
        <TextNumber field="weight" value={form.weight} error={errors.weight} onChange={(v) => set('weight', v)} />
        {required.map((f) => (
          <TextNumber key={f} field={f} value={form[f]} error={errors[f]} onChange={(v) => set(f, v)} />
        ))}
      </div>

      <fieldset className="space-y-1.5">
        <legend className="eyebrow">How do you like it to fit?</legend>
        <div className="grid grid-cols-3 gap-1 rounded-full border border-ink/10 bg-white/60 p-1">
          {FIT_PREFERENCES.map((p) => (
            <label key={p} className={`flex min-h-10 cursor-pointer items-center justify-center rounded-full text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-coral ${form.preference === p ? 'bg-ink text-white' : 'text-ink-soft hover:bg-white'}`}>
              <input type="radio" name="preference" value={p} checked={form.preference === p} onChange={() => set('preference', p)} className="sr-only" />
              {PREF_TEXT[p]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={ageId} className="eyebrow block">
            Age range <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <select id={ageId} className="field-input text-base" value={form.ageRange} onChange={(e) => set('ageRange', e.target.value as AboutForm['ageRange'])}>
            {AGE_RANGES.map((a) => (
              <option key={a} value={a}>
                {a === '' ? 'Prefer not to say' : a}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={sexId} className="eyebrow block">
            Body type <span className="font-normal normal-case tracking-normal">(optional)</span>
          </label>
          <select id={sexId} className="field-input text-base" value={form.sex} onChange={(e) => set('sex', e.target.value as AboutForm['sex'])}>
            <option value="unspecified">Not specified</option>
            <option value="female">Women’s sizing</option>
            <option value="male">Men’s sizing</option>
          </select>
        </div>
      </div>

      {fields.length > 0 ? (
      <div className="card space-y-3 p-3">
        <button type="button" className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium" aria-expanded={form.knowsMeasurements} aria-controls="known-measurements" onClick={() => set('knowsMeasurements', !form.knowsMeasurements)}>
          <span className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-coral" aria-hidden /> I know my measurements
          </span>
          <span aria-hidden className="text-ink-mute">
            {form.knowsMeasurements ? '−' : '+'}
          </span>
        </button>
        {form.knowsMeasurements ? (
          <div id="known-measurements" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {fields.map((f) => (
                <TextNumber key={f} field={f} value={form[f]} error={errors[f]} optional onChange={(v) => set(f, v)} />
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" role="switch" aria-checked={form.tape} checked={form.tape} onChange={(e) => set('tape', e.target.checked)} className="h-4 w-4" />
              Measured with a tape
            </label>
            <p className="text-xs text-ink-mute">Anything you leave empty is estimated from your height and weight, with a lower confidence.</p>
          </div>
        ) : (
          <p className="text-xs text-ink-mute">Optional. Without them we estimate {category === 'bottom' ? 'waist and hip' : 'bust, waist and hip'} from your height and weight.</p>
        )}
      </div>
      ) : null}

      <div className="space-y-2">
        <button type="submit" className="btn-coral w-full" data-testid="see-my-size">
          See my size
        </button>
        {canScan ? (
          <button type="button" className="btn-ghost w-full" onClick={() => onSubmit(true)}>
            <Camera className="h-4 w-4" aria-hidden /> More accurate: 30-second scan
          </button>
        ) : null}
        {canScan ? <p className="text-center text-xs text-ink-mute">The scan runs in this browser. No photo or video leaves your device.</p> : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Blocked screens
// ---------------------------------------------------------------------------

const BLOCKED: Record<BlockedKind, { icon: ReactNode; title: string; text: string }> = {
  paused: {
    icon: <PauseCircle className="h-8 w-8" aria-hidden />,
    title: 'Try-on is paused',
    text: 'This shop has paused Curtain for now. You can still use the shop’s own size chart on the product page.',
  },
  expired: {
    icon: <Clock className="h-8 w-8" aria-hidden />,
    title: 'This try-on has expired',
    text: 'For your privacy, a try-on link only works for a few minutes and in one window. Close this and tap “Try it on” again.',
  },
  incomplete: {
    icon: <PackageX className="h-8 w-8" aria-hidden />,
    title: 'Not ready for this product yet',
    text: 'The shop has not finished the size data for this item, so we can’t give an honest recommendation.',
  },
  offline: {
    icon: <WifiOff className="h-8 w-8" aria-hidden />,
    title: 'You seem to be offline',
    text: 'We couldn’t reach Curtain. Check your connection and try again.',
  },
  busy: {
    icon: <Clock className="h-8 w-8" aria-hidden />,
    title: 'Busy right now',
    text: 'A lot of people on your network are using fitting rooms at the moment. Wait a minute and try again.',
  },
  error: {
    icon: <AlertTriangle className="h-8 w-8" aria-hidden />,
    title: 'Something went wrong',
    text: 'We couldn’t open the fitting room. Please try again.',
  },
};

export function BlockedScreen({ kind, onRetry, onClose }: { kind: BlockedKind; onRetry: (() => void) | null; onClose: (() => void) | null }): ReactNode {
  const b = BLOCKED[kind];
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center" aria-labelledby="blocked-title" data-testid={`blocked-${kind}`}>
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/80 text-coral-ink shadow">{b.icon}</span>
      <h2 id="blocked-title" className="font-display text-2xl" tabIndex={-1} data-step-heading>
        {b.title}
      </h2>
      <p className="max-w-sm text-sm text-ink-soft">{b.text}</p>
      <div className="flex w-full max-w-xs flex-col gap-2 pt-2">
        {onRetry ? (
          <button type="button" className="btn-primary" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className="btn-ghost" onClick={onClose}>
            Back to the shop
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function LoadingScreen(): ReactNode {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16" role="status" aria-live="polite">
      <div className="h-10 w-10 rounded-full border-2 border-coral border-t-transparent motion-safe:animate-spin" aria-hidden />
      <p className="text-sm text-ink-soft">Opening your fitting room…</p>
    </div>
  );
}
