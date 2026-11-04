import { useState, type ReactNode } from 'react';
import { ChevronRight, Ruler } from 'lucide-react';
import type { ManualMethod } from '@paskamer/schema';
import { MANUAL_FIELDS, MANUAL_RANGES, MEASUREMENT_LABELS, MEASUREMENT_UNITS, METHOD_LABELS, TAPE_INSTRUCTIONS, validateManual, type ManualField, type ManualForm } from '../captureMachine';
import type { Sex } from '../types';
import { Panel, PrimaryButton, StepHeader } from './ui';

interface Props {
  form: ManualForm;
  hasScan: boolean;
  onChange: (form: ManualForm) => void;
  onDone: () => void;
}

const SEX_OPTIONS: { value: Sex; label: string }[] = [
  { value: 'female', label: "Women's charts" },
  { value: 'male', label: "Men's charts" },
  { value: 'unspecified', label: 'Prefer not to say' },
];

export function ManualStep({ form, hasScan, onChange, onDone }: Props): ReactNode {
  const [touched, setTouched] = useState<Partial<Record<ManualField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const errors = validateManual(form);
  const set = (k: keyof ManualForm, v: string): void => onChange({ ...form, [k]: v });

  const submit = (): void => {
    setSubmitted(true);
    if (Object.keys(errors).length === 0) onDone();
  };

  return (
    <Panel className="space-y-5">
      <StepHeader
        eyebrow="Step 3 of 3"
        title="Your measurements"
        subtitle={hasScan ? 'The scan keeps these honest; they sharpen the scan. Leave blank what you do not know.' : 'No scan this time — these drive the fit directly.'}
      />
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        noValidate
      >
        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wider text-ink/40">How did you measure?</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="How did you measure">
            {(Object.keys(METHOD_LABELS) as ManualMethod[]).map((m) => {
              const on = form.method === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ ...form, method: m })}
                  className={`rounded-2xl border px-2 py-2 text-left text-xs transition-colors ${on ? 'border-coral bg-coral/10' : 'border-ink/10 bg-white/40'}`}
                >
                  <span className="block font-medium text-ink">{METHOD_LABELS[m].label}</span>
                  <span className="text-ink/50">{METHOD_LABELS[m].hint}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="space-y-3">
          {MANUAL_FIELDS.map((f) => {
            const err = errors[f];
            const show = err && (touched[f] || submitted);
            const [lo, hi] = MANUAL_RANGES[f];
            return (
              <div key={f} className="space-y-1">
                <label htmlFor={`manual-${f}`} className="flex items-center justify-between text-sm">
                  <span className="text-xs uppercase tracking-wider text-ink/40">
                    {MEASUREMENT_LABELS[f]} {f === 'height' ? '' : <span className="normal-case tracking-normal">(optional)</span>}
                  </span>
                  <span className="text-xs text-ink/40">{MEASUREMENT_UNITS[f]}</span>
                </label>
                <input
                  id={`manual-${f}`}
                  type="number"
                  inputMode="decimal"
                  step={f === 'footEu' ? 0.5 : 0.5}
                  min={lo}
                  max={hi}
                  value={form[f]}
                  required={f === 'height'}
                  aria-invalid={!!show}
                  aria-describedby={show ? `manual-${f}-err` : TAPE_INSTRUCTIONS[f] ? `manual-${f}-help` : undefined}
                  onBlur={() => setTouched((t) => ({ ...t, [f]: true }))}
                  onChange={(e) => set(f, e.target.value)}
                  className={`w-full rounded-2xl border bg-white/60 px-3 py-2 font-serif text-lg focus:outline-none ${show ? 'border-coral' : 'border-ink/10 focus:border-coral'}`}
                />
                {show ? (
                  <p id={`manual-${f}-err`} role="alert" className="text-xs text-coral">
                    {err}
                  </p>
                ) : TAPE_INSTRUCTIONS[f] ? (
                  <p id={`manual-${f}-help`} className="text-xs text-ink/40">
                    {TAPE_INSTRUCTIONS[f]}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-wider text-ink/40">Which size charts do you usually use?</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Size chart type">
            {SEX_OPTIONS.map((o) => {
              const on = form.sex === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ ...form, sex: o.value })}
                  className={`rounded-2xl border px-2 py-2 text-xs font-medium transition-colors ${on ? 'border-coral bg-coral/10 text-ink' : 'border-ink/10 bg-white/40 text-ink/70'}`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink/40">Only used to pick the population prior for missing measurements. Stays on this device.</p>
        </fieldset>

        <PrimaryButton type="submit">
          <Ruler className="h-5 w-5" aria-hidden /> Combine with the scan <ChevronRight className="h-4 w-4" aria-hidden />
        </PrimaryButton>
      </form>
    </Panel>
  );
}
