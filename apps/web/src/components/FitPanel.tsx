import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { FitResult } from '@curtain/fit-engine';
import { shownFitScore, scoredSizeBlocked } from '@/lib/fitScore';
import { pct } from '@/lib/format';
import { appStrings } from '@/strings';

/**
 * Fit indicator: recommended size (or the 'no size fits' state with the closest size), score,
 * confidence and the engine's per-point notes. Lives in an aria-live region so a new card's result
 * is announced. Keyed by garment id by the parent so stale values never show on a new garment.
 */
export function FitPanel({
  fit,
  hasMeasurements,
  compact = false,
  scoreNote,
  waistOnly = null,
}: {
  fit: FitResult | null;
  hasMeasurements: boolean;
  compact?: boolean;
  /** Shown in place of the fit score when a percentage would mislead (the embed: a pull-on band that only just passes the hips). */
  scoreNote?: string | undefined;
  /** The embed: the waist of a W/L chart whose leg could not be checked. Named in place of "No size fits". */
  waistOnly?: string | null;
}): ReactNode {
  const shared = appStrings().shared;
  const t = shared.fitPanel;
  return (
    <div className={`glass-panel rounded-2xl text-ink ${compact ? 'px-3 py-2' : 'p-3'}`} aria-live="polite" aria-atomic="true" data-testid="fit-panel">
      {!hasMeasurements ? (
        <p className="text-sm">
          <Link to="/onboarding" className="font-medium text-coral-ink underline-offset-2 hover:underline">
            {t.addMeasurementsLink}
          </Link>
          {t.addMeasurementsAfter}
        </p>
      ) : !fit ? (
        <p className="text-sm text-ink-soft">{t.working}</p>
      ) : fit.recommendedSize === null && waistOnly !== null ? (
        <div className="space-y-1" data-testid="fit-panel-waist-only">
          <p className="eyebrow">{t.waistOnly(waistOnly)}</p>
          <p className="text-sm">{t.waistOnlyText(fit.closestSize ?? shared.format.none)}</p>
          {!compact ? <Notes notes={fit.notes} label={t.notesLabel} /> : null}
        </div>
      ) : fit.recommendedSize === null ? (
        <div className="space-y-1">
          <p className="eyebrow text-bad">{t.noSizeFits}</p>
          <p className="text-sm">
            {/* A size whose waistband does not pull on over the hips gets no percentage (its chart score can be 99%). */}
            {scoredSizeBlocked(fit) ? (
              <>
                {t.closestBefore}
                <span className="font-display text-lg">{fit.closestSize ?? shared.format.none}</span>
                {t.closestBlockedAfter}
              </>
            ) : (
              <>
                {t.closestBefore}
                <span className="font-display text-lg">{fit.closestSize ?? shared.format.none}</span>
                {t.closestScoredAfter(pct(fit.score))}
              </>
            )}
          </p>
          {!compact ? <Notes notes={fit.notes} label={t.notesLabel} /> : null}
        </div>
      ) : compact ? (
        <div>
          <p className="flex items-baseline gap-1.5">
            <span className="eyebrow">{t.size}</span>
            <span className="font-display text-xl leading-none text-coral-ink" data-testid="recommended-size">
              {fit.recommendedSize}
            </span>
          </p>
          <p className="text-[11px] leading-tight text-ink-mute">
            {t.compactFitBefore}
            <span className="font-semibold text-ink" data-testid="fit-score">{pct(shownFitScore(fit))}</span>
            {t.compactFitAfter(pct(fit.confidence))}
          </p>
          {fit.notes.length > 0 ? (
            <ul className="mt-0.5 text-[11px] leading-tight text-ink-soft" aria-label={t.notesLabel} data-testid="fit-notes">
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
              <p className="eyebrow">{t.recommendedSize}</p>
              <p className="font-display text-2xl leading-none text-coral-ink" data-testid="recommended-size">
                {fit.recommendedSize}
              </p>
            </div>
            <div className="text-right">
              <p className="eyebrow">{t.fitScore}</p>
              {scoreNote ? (
                <p className="text-sm leading-tight font-semibold text-warn" data-testid="fit-score-note">
                  {scoreNote}
                </p>
              ) : (
                <p className="font-display text-2xl leading-none" data-testid="fit-score">
                  {pct(shownFitScore(fit))}
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-mute">{t.confidenceLine(pct(fit.confidence), fit.tieBreak ? fit.tieBreak.replace('-', ' ') : null)}</p>
          {!compact ? <Notes notes={fit.notes} label={t.notesLabel} /> : null}
        </div>
      )}
    </div>
  );
}

function Notes({ notes, label }: { notes: string[]; label: string }): ReactNode {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-ink-soft" aria-label={label} data-testid="fit-notes">
      {notes.slice(0, 4).map((n, i) => (
        // short viewports: only the first note is drawn over the mirror; the rest stay for screen readers
        <li key={n} className={i > 0 ? '[@media(max-height:740px)]:sr-only' : undefined}>
          • {n}
        </li>
      ))}
    </ul>
  );
}
