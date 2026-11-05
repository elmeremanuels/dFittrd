import { ESTIMATE_DISCLAIMER } from '@curtain/schema';
import type { ReactNode } from 'react';

/**
 * AGENTS.md rule 3 / handoff §7: every generated render is labelled an estimate.
 * The badge is persistent (never hidden by state) and the disclaimer text is always rendered.
 */
export function EstimateBadge({ className = '' }: { className?: string }): ReactNode {
  return (
    <span className={`chip bg-ink/85 text-cream shadow ${className}`} title={ESTIMATE_DISCLAIMER}>
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
