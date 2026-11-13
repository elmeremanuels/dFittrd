import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { FitResult } from '@curtain/fit-engine';
import { pct } from '@/lib/format';

/**
 * Fit indicator: recommended size (or the 'no size fits' state with the closest size), score,
 * confidence and the engine's per-point notes. Lives in an aria-live region so a new card's result
 * is announced. Keyed by garment id by the parent so stale values never show on a new garment.
 */
export function FitPanel({ fit, hasMeasurements, compact = false }: { fit: FitResult | null; hasMeasurements: boolean; compact?: boolean }): ReactNode {
  return (
    <div className={`glass-panel rounded-2xl text-ink ${compact ? 'px-3 py-2' : 'p-3'}`} aria-live="polite" aria-atomic="true" data-testid="fit-panel">
      {!hasMeasurements ? (
        <p className="text-sm">
          <Link to="/onboarding" className="font-medium text-coral-ink underline-offset-2 hover:underline">
            Add your measurements
          </Link>{' '}
          to see how this fits.
        </p>
      ) : !fit ? (
        <p className="text-sm text-ink-soft">Working out the fit…</p>
      ) : fit.recommendedSize === null ? (
        <div className="space-y-1">
          <p className="eyebrow text-bad">No size fits</p>
          <p className="text-sm">
            Closest is <span className="font-display text-lg">{fit.closestSize ?? '—'}</span> at {pct(fit.score)} — we would not recommend it.
          </p>
          {!compact ? <Notes notes={fit.notes} /> : null}
        </div>
      ) : compact ? (
        <div>
          <p className="flex items-baseline gap-1.5">
            <span className="eyebrow">Size</span>
            <span className="font-display text-xl leading-none text-coral-ink" data-testid="recommended-size">
              {fit.recommendedSize}
            </span>
          </p>
          <p className="text-[11px] leading-tight text-ink-mute">
            fit <span className="font-semibold text-ink" data-testid="fit-score">{pct(fit.score)}</span> · {pct(fit.confidence)} sure
          </p>
          {fit.notes.length > 0 ? (
            <ul className="mt-0.5 text-[11px] leading-tight text-ink-soft" aria-label="Fit notes" data-testid="fit-notes">
              {fit.notes.slice(0, 4).map((n, i) => (
                <li key={n} className={i > 0 ? 'sr-only' : 'truncate'}>
                  • {n}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Recommended size</p>
              <p className="font-display text-2xl leading-none text-coral-ink" data-testid="recommended-size">
                {fit.recommendedSize}
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow">Fit score</p>
              <p className="font-display text-2xl leading-none" data-testid="fit-score">
                {pct(fit.score)}
              </p>
            </div>
          </div>
          <p className="text-xs text-ink-mute">
            Confidence {pct(fit.confidence)} · estimate{fit.tieBreak ? ` · tie broken by ${fit.tieBreak.replace('-', ' ')}` : ''}
          </p>
          {!compact ? <Notes notes={fit.notes} /> : null}
        </div>
      )}
    </div>
  );
}

function Notes({ notes }: { notes: string[] }): ReactNode {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-ink-soft" aria-label="Fit notes" data-testid="fit-notes">
      {notes.slice(0, 4).map((n, i) => (
        // short viewports: only the first note is drawn over the mirror; the rest stay for screen readers
        <li key={n} className={i > 0 ? '[@media(max-height:740px)]:sr-only' : undefined}>
          • {n}
        </li>
      ))}
    </ul>
  );
}
