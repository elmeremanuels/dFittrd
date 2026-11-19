import { useState, type ReactNode } from 'react';
import { ChevronRight, Ruler } from 'lucide-react';
import type { ManualMethod } from '@curtain/schema';
import { appStrings } from '../../../strings';
import { MANUAL_FIELDS, MANUAL_RANGES, MEASUREMENT_LABELS, MEASUREMENT_UNITS, METHOD_LABELS, TAPE_INSTRUCTIONS, validateManual, type ManualField, type ManualForm } from '../captureMachine';
import type { Sex } from '../types';
import { Panel, PrimaryButton, StepHeader } from './ui';

interface Props {
  form: ManualForm;
  hasScan: boolean;
  onChange: (form: ManualForm) => void;
  onDone: () => void;
}

const SEX_OPTIONS: readonly Sex[] = ['female', 'male', 'unspecified'];

export function ManualStep({ form, hasScan, onChange, onDone }: Props): ReactNode {
  const [touched, setTouched] = useState<Partial<Record<ManualField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const errors = validateManual(form);
  const t = appStrings().capture.manual;
  const set = (k: keyof ManualForm, v: string): void => onChange({ ...form, [k]: v });

  const submit = (): void => {
    setSubmitted(true);
    if (Object.keys(errors).length === 0) onDone();
  };

  return (
    <Panel className="space-y-5">
      <StepHeader
        eyebrow={t.eyebrow}
        title={t.title}
        subtitle={hasScan ? t.subtitleScan : t.subtitleNoScan}
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
          <legend className="text-xs uppercase tracking-wider text-ink/40">{t.methodLegend}</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t.methodGroup}>
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
                    {MEASUREMENT_LABELS[f]} {f === 'height' ? '' : <span className="normal-case tracking-normal">{t.optional}</span>}
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
          <legend className="text-xs uppercase tracking-wider text-ink/40">{t.chartsLegend}</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t.chartsGroup}>
            {SEX_OPTIONS.map((value) => {
              const on = form.sex === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => onChange({ ...form, sex: value })}
                  className={`rounded-2xl border px-2 py-2 text-xs font-medium transition-colors ${on ? 'border-coral bg-coral/10 text-ink' : 'border-ink/10 bg-white/40 text-ink/70'}`}
                >
                  {t.charts[value]}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-ink/40">{t.chartsNote}</p>
        </fieldset>

        <PrimaryButton type="submit">
          <Ruler className="h-5 w-5" aria-hidden /> {t.submit} <ChevronRight className="h-4 w-4" aria-hidden />
        </PrimaryButton>
      </form>
    </Panel>
  );
}
