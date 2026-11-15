import { ESTIMATE_DISCLAIMER } from '@curtain/schema';
import type { CSSProperties, ReactNode } from 'react';

/** The estimate label of the app's figures: the one English wording, on one line. */
export const ESTIMATE_LABEL = 'Estimate · not measured';
/**
 * The same label on two short lines (a narrow badge), cut from the one above at its dot, so the
 * shared component carries no second copy of the text. The embed passes its catalogue's lines
 * (`result.estimateLines`); a unit test holds the two wordings together.
 */
export const ESTIMATE_LABEL_LINES: readonly [string, string] = (() => {
  const at = ESTIMATE_LABEL.indexOf('·');
  return [ESTIMATE_LABEL.slice(0, at + 1), ESTIMATE_LABEL.slice(at + 1).trim()] as const;
})();

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
      {ESTIMATE_LABEL}
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
