import { ESTIMATE_DISCLAIMER } from '@curtain/schema';
import type { CSSProperties, ReactNode } from 'react';
import { appStrings } from '@/strings';
import { EN } from '@/strings/en';

/**
 * The estimate label of the app's figures in English, on one line: the catalogue's default
 * (`shared.estimate.label`). What is drawn is read from the catalogue at render (`estimateLabel()`),
 * so a pack reaches it; this constant is for code that has to name the English wording, such as tests.
 */
export const ESTIMATE_LABEL: string = EN.shared.estimate.label;
/**
 * The same label on two short lines (a narrow badge), `shared.estimate.lines`. The embed passes its
 * own catalogue's lines (`result.estimateLines`); a unit test holds the wordings together.
 */
export const ESTIMATE_LABEL_LINES: readonly [string, string] = EN.shared.estimate.lines;

/** The estimate label in the interface language, on one line. */
export const estimateLabel = (): string => appStrings().shared.estimate.label;
/** The estimate label in the interface language, on two short lines. */
export const estimateLabelLines = (): readonly [string, string] => appStrings().shared.estimate.lines;

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
      {estimateLabel()}
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
