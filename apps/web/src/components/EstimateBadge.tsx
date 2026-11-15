import { ESTIMATE_DISCLAIMER } from '@curtain/schema';
import type { CSSProperties, ReactNode } from 'react';

/**
 * AGENTS.md rule 3 / handoff §7: every generated render is labelled an estimate.
 * The badge is persistent (never hidden by state) and the disclaimer text is always rendered.
 */
export function EstimateBadge({ className = '', lines, style }: { className?: string; /** The label on two short lines (a narrow badge); default: the one-line label. */ lines?: readonly [string, string] | undefined; style?: CSSProperties }): ReactNode {
  if (lines)
    return (
      <span className={`chip rounded-xl bg-ink/85 text-cream shadow ${className}`} title={ESTIMATE_DISCLAIMER} style={style} data-testid="estimate-label">
        {/* One element with plain spaces, so the label reads and is found as one sentence; it breaks between the lines only. */}
        <span className="whitespace-nowrap">
          {lines[0]} <br />
          {lines[1]}
        </span>
      </span>
    );
  return (
    <span className={`chip bg-ink/85 text-cream shadow ${className}`} title={ESTIMATE_DISCLAIMER} style={style} data-testid="estimate-label">
      Estimate · not measured
    </span>
  );
}

export function EstimateDisclaimer({ className = '' }: { className?: string }): ReactNode {
  return (
    <p className={`text-xs leading-snug text-ink-mute ${className}`} data-testid="estimate-disclaimer">
      {ESTIMATE_DISCLAIMER}
    </p>
  );
}
