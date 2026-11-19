import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import type { BodyMeasurementKey } from '@curtain/schema';
import { appStrings } from '../../../strings';
import { MEASUREMENT_LABELS, MEASUREMENT_UNITS, TAPE_INSTRUCTIONS, confidencePercent, parseNumber } from '../captureMachine';
import type { FuseResult } from '../fuse';
import { fill } from './text';
import { ConfidenceBar, EstimateBadge, GhostButton, Panel, PrimaryButton, StepHeader } from './ui';

interface Props {
  result: FuseResult;
  busy: boolean;
  error: string | null;
  onRemeasure: (key: BodyMeasurementKey, value: number) => void;
  onRescan: (() => void) | null;
  onConfirm: () => void;
}

export function FusionStep({ result, busy, error, onRemeasure, onRescan, onConfirm }: Props): ReactNode {
  const [editing, setEditing] = useState<BodyMeasurementKey | null>(null);
  const [draft, setDraft] = useState('');
  const conflicts = result.conflicts;
  const t = appStrings().capture.fusion;
  const sources: Record<string, string> = t.sources;
  const tapeFallback = appStrings().capture.measurements.tapeFallback;

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
      <StepHeader eyebrow={t.header.eyebrow} title={t.header.title} subtitle={t.header.subtitle} />

      {conflicts.length > 0 ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {t.conflict(conflicts.map((c) => MEASUREMENT_LABELS[c]))}
        </p>
      ) : null}

      <ul className="space-y-3" aria-label={t.list}>
        {result.points.map((p) => {
          const unit = MEASUREMENT_UNITS[p.key];
          const isEditing = editing === p.key;
          return (
            <li key={p.key} className={`rounded-2xl border p-3 ${p.conflict ? 'border-amber-300 bg-amber-50/60' : 'border-ink/10 bg-white/40'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{MEASUREMENT_LABELS[p.key]}</span>
                <span className="font-serif text-lg tabular-nums">
                  {t.value(p.measurement.mean.toFixed(p.key === 'footEu' ? 1 : 0), unit)}
                  <span className="ml-1 text-xs text-ink/40">±{p.measurement.sigma.toFixed(1)}</span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex-1">
                  <ConfidenceBar value={p.confidence} label={t.confidence(MEASUREMENT_LABELS[p.key], confidencePercent(p.confidence))} />
                </div>
                <EstimateBadge>{sources[p.measurement.source] ?? p.measurement.source}</EstimateBadge>
              </div>
              {p.conflict && p.scan && p.manual ? (
                <div className="mt-2 space-y-2 text-xs text-ink/70">
                  <p>
                    {fill(t.disagree, {
                      scan: <strong>{t.value(p.scan.mean.toFixed(0), unit)}</strong>,
                      you: <strong>{t.value(p.manual.mean.toFixed(0), unit)}</strong>,
                      cm: p.disagreementCm,
                    })}
                  </p>
                  {isEditing ? (
                    <form
                      className="space-y-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submitRemeasure();
                      }}
                    >
                      <p id={`remeasure-${p.key}-help`}>{TAPE_INSTRUCTIONS[p.key] ?? tapeFallback}</p>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={0.5}
                          autoFocus
                          aria-label={t.remeasured(MEASUREMENT_LABELS[p.key], unit)}
                          aria-describedby={`remeasure-${p.key}-help`}
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          className="w-full rounded-xl border border-ink/10 bg-white px-3 py-2 font-serif text-base focus:border-coral focus:outline-none"
                        />
                        <button type="submit" className="rounded-xl bg-coral px-3 text-sm font-medium text-white">
                          {t.save}
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
                      <RefreshCw className="h-3 w-3" aria-hidden /> {t.remeasure}
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
        <Check className="h-5 w-5" aria-hidden /> {busy ? t.saving : t.use}
      </PrimaryButton>
      {onRescan ? (
        <GhostButton onClick={onRescan} disabled={busy}>
          <RefreshCw className="h-4 w-4" aria-hidden /> {t.rescan}
        </GhostButton>
      ) : null}
      <p className="flex items-start gap-2 text-xs text-ink/50">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {t.stored}
      </p>
    </Panel>
  );
}
