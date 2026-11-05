import type { ReactNode } from 'react';
import type { FitCohortResponse } from '@curtain/schema';

/**
 * Cohort bars (handoff §7): aggregated wardrobe outcomes per size for one product. The API applies
 * a k-anonymity floor; below it the histogram is empty and we say so instead of showing fake bars.
 */
export function CohortBars({ cohort, highlight }: { cohort: FitCohortResponse | null; highlight?: string | null }): ReactNode {
  if (!cohort) return null;
  const sizes = Object.entries(cohort.sizeHistogram);
  const max = Math.max(1, ...sizes.map(([, n]) => n));
  return (
    <section className="card space-y-2" aria-label="What others kept">
      <header className="flex items-baseline justify-between">
        <h3 className="eyebrow">What others kept</h3>
        <span className="text-xs text-ink-mute">{cohort.n} people</span>
      </header>
      {sizes.length === 0 ? (
        <p className="text-sm text-ink-mute">Shown once at least {cohort.kAnonymityFloor} people have tried this item.</p>
      ) : (
        <ul className="space-y-1.5">
          {sizes.map(([size, n]) => (
            <li key={size} className="flex items-center gap-2 text-sm">
              <span className={`w-10 font-medium ${size === highlight ? 'text-coral-ink' : 'text-ink'}`}>{size}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={n} aria-label={`Size ${size}: ${n}`}>
                <div className={`h-full rounded-full ${size === highlight ? 'bg-coral' : 'bg-ink'}`} style={{ width: `${(n / max) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-xs tabular-nums text-ink-mute">{n}</span>
            </li>
          ))}
        </ul>
      )}
      {cohort.keptRate !== null ? <p className="text-xs text-ink-mute">{Math.round(cohort.keptRate * 100)}% kept what they bought.</p> : null}
    </section>
  );
}
