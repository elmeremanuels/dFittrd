import type { ReactNode } from 'react';
import { colourMatch, type Season, type Undertone } from '@curtain/taste-engine';

/** Colour-match chip (founder note: colour matching with skin). Copy is fixed by the taste engine. */
export function ColourChip({ hex, target }: { hex: string; target: Season | Undertone | null }): ReactNode {
  if (!target) return null;
  const m = colourMatch(hex, target);
  const tone = m.label === 'Great with your undertone' ? 'border-ok/30 bg-ok/10 text-ok' : m.label === 'Clashes' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-ink/10 bg-white/70 text-ink-soft';
  return (
    <span className={`chip ${tone}`} title={`Colour match ${Math.round(m.score * 100)}% against your ${m.target} (estimate)`}>
      <span className="h-3 w-3 rounded-full border border-ink/10" style={{ backgroundColor: hex }} aria-hidden />
      {m.label}
    </span>
  );
}
