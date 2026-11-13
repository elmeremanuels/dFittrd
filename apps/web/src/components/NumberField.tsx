import { useId, type ReactNode } from 'react';

/** Number input + slider pair sharing one label (audit: htmlFor/id, per-field ranges, half-centimetres). */
export function NumberField({
  label,
  unit,
  value,
  min,
  max,
  step = 0.5,
  optional = false,
  hint,
  error,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  optional?: boolean;
  hint?: string;
  error?: string;
  onChange: (v: string) => void;
}): ReactNode {
  const id = useId();
  const num = Number.parseFloat(value);
  const sliderValue = Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : (min + max) / 2;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="eyebrow">
          {label} {optional ? <span className="font-normal normal-case tracking-normal text-ink-mute">(optional)</span> : null}
        </label>
        <span className="text-xs text-ink-mute">
          {min}–{max} {unit}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-err` : hint ? `${id}-hint` : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`field-input w-28 ${error ? 'border-coral' : ''}`}
        />
        <input
          type="range"
          aria-label={`${label} slider`}
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onChange={(e) => onChange(e.target.value)}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-lg bg-ink/10"
        />
        <span className="w-8 text-xs text-ink-mute">{unit}</span>
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-xs text-coral-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-mute">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
