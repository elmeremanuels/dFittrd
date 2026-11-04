import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import type { BodyMeasurementKey } from '@paskamer/schema';
import { MEASUREMENT_LABELS, MEASUREMENT_UNITS, TAPE_INSTRUCTIONS, confidencePercent, parseNumber } from '../captureMachine';
import type { FuseResult } from '../fuse';
import { ConfidenceBar, EstimateBadge, GhostButton, Panel, PrimaryButton, StepHeader } from './ui';

interface Props {
  result: FuseResult;
  busy: boolean;
  error: string | null;
  onRemeasure: (key: BodyMeasurementKey, value: number) => void;
  onRescan: (() => void) | null;
  onConfirm: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  scan: 'scan',
  manual: 'you',
  fused: 'scan + you',
  prior: 'estimate',
};

export function FusionStep({ result, busy, error, onRemeasure, onRescan, onConfirm }: Props): ReactNode {
  const [editing, setEditing] = useState<BodyMeasurementKey | null>(null);
  const [draft, setDraft] = useState('');
  const conflicts = result.conflicts;

  const submitRemeasure = (): void => {
    const v = parseNumber(draft);
    if (editing && v !== null && v > 0) {
      onRemeasure(editing, v);
      setEditing(null);
      setDraft('');
    }
  };

  return (
    <Panel className="space-y-5">
      <StepHeader eyebrow="Result" title="Your fit profile" subtitle="Each value shows how sure we are. Higher is better; sizes change every 4–6 cm." />

      {conflicts.length > 0 ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          The scan and your entry disagree on {conflicts.map((c) => MEASUREMENT_LABELS[c].toLowerCase()).join(', ')}. Remeasure with a tape to settle it.
        </p>
      ) : null}

      <ul className="space-y-3" aria-label="Measurements">
        {result.points.map((p) => {
          const unit = MEASUREMENT_UNITS[p.key];
          const isEditing = editing === p.key;
          return (
            <li key={p.key} className={`rounded-2xl border p-3 ${p.conflict ? 'border-amber-300 bg-amber-50/60' : 'border-ink/10 bg-white/40'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{MEASUREMENT_LABELS[p.key]}</span>
                <span className="font-serif text-lg tabular-nums">
                  {p.measurement.mean.toFixed(p.key === 'footEu' ? 1 : 0)} {unit}
                  <span className="ml-1 text-xs text-ink/40">±{p.measurement.sigma.toFixed(1)}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1">
                  <ConfidenceBar value={p.confidence} label={`${MEASUREMENT_LABELS[p.key]} confidence ${confidencePercent(p.confidence)} percent`} />
                </div>
                <EstimateBadge>{SOURCE_LABEL[p.measurement.source] ?? p.measurement.source}</EstimateBadge>
              </div>
              {p.conflict && p.scan && p.manual ? (
                <div className="mt-2 space-y-2 text-xs text-ink/70">
                  <p>
                    Scan says <strong>{p.scan.mean.toFixed(0)} {unit}</strong>, you said <strong>{p.manual.mean.toFixed(0)} {unit}</strong> ({p.disagreementCm} cm apart).
                  </p>
                  {isEditing ? (
                    <form
                      className="space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitRemeasure();
                      }}
                    >
                      <p id={`remeasure-${p.key}-help`}>{TAPE_INSTRUCTIONS[p.key] ?? 'Measure with a tape, snug but not tight.'}</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={0.5}
                          autoFocus
                          aria-label={`Remeasured ${MEASUREMENT_LABELS[p.key]} in ${unit}`}
                          aria-describedby={`remeasure-${p.key}-help`}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 font-serif text-base focus:border-coral focus:outline-none"
                        />
                        <button type="submit" className="rounded-xl bg-coral px-3 text-sm font-medium text-white">
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(p.key);
                        setDraft('');
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-900"
                    >
                      <RefreshCw className="h-3 w-3" aria-hidden /> Remeasure this one
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {error ? (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      ) : null}

      <PrimaryButton onClick={onConfirm} disabled={busy}>
        <Check className="h-5 w-5" aria-hidden /> {busy ? 'Saving on device…' : 'Use these measurements'}
      </PrimaryButton>
      {onRescan ? (
        <GhostButton onClick={onRescan} disabled={busy}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Redo the body scan
        </GhostButton>
      ) : null}
      <p className="flex items-start gap-2 text-xs text-ink/50">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Stored encrypted on this device. Only an 80-number fit signature (no photo, no face or skin data) can sync, and you can delete everything in one tap.
      </p>
    </Panel>
  );
}
