/**
 * Drawing of the size rings (render/rings.ts) over the 2D figure: `SizeRingsLayer` goes inside the
 * mirror's <svg>, `SizeRingsChips` is the HTML layer of short labels next to the figure. Colour is
 * never the only signal: every ring has a text chip ("Tight · 8 cm short"), estimates are dashed,
 * and the full sentence of every ring is in a screen-reader list.
 */
import type { ReactNode } from 'react';
import type { Band } from '@curtain/fit-engine';
import { VIEW_H } from '@/render/body';
import { ringArcs, type Ring, type RingOverlay } from '@/render/rings';

/** Theme tokens (index.css --color-ok / warn / bad / ink-soft). */
const BAND_STROKE: Record<Band, string> = { tight: '#b3261e', snug: '#9a5b00', good: '#1f7a4d', roomy: '#4a423b', loose: '#9a5b00' };
const NEUTRAL = '#4a423b';
const GHOST = '#1a1612';

export function ringStroke(ring: Pick<Ring, 'band'>): string {
  return ring.band ? BAND_STROKE[ring.band] : NEUTRAL;
}

/** Estimates (assumed girths, unscored points) are dashed; scored chart rings are solid. */
function dashed(ring: Ring): boolean {
  return ring.band === null || (ring.source !== 'chart' && ring.source !== 'measured') || (ring.stretch !== undefined && ring.stretch.source !== 'measured');
}

export function SizeRingsLayer({ overlay }: { overlay: RingOverlay }): ReactNode {
  return (
    <g data-testid="size-rings" data-size={overlay.size} aria-hidden pointerEvents="none">
      {/* ghosts of the neighbouring sizes: thin dashed front arcs, labelled with their size */}
      {overlay.ghosts.map((g) => (
        <g key={g.size} data-testid="size-ring-ghost" data-size={g.size} opacity="0.8">
          {g.rings.map((r, i) => {
            const { front } = ringArcs(r.rx, r.ry, r.y);
            const smaller = g.side === 'smaller';
            return (
              <g key={r.key}>
                <path d={front} fill="none" stroke="#ffffff" strokeOpacity="0.7" strokeWidth="2.2" />
                <path d={front} fill="none" stroke={GHOST} strokeWidth="1.1" strokeDasharray="2 1.6" />
                {i === 0 ? (
                  <text x={100 - r.rx - 2} y={smaller ? r.y + r.ry + 7 : r.y - 2} textAnchor="end" fontSize="8" fontWeight="600" fill={GHOST} stroke="#ffffff" strokeWidth="2.2" paintOrder="stroke">
                    {g.size}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      ))}
      {/* the size on screen: back arc faint, front arc in the band colour over a white halo */}
      {overlay.selected.rings.map((r) => {
        const { front, back } = ringArcs(r.rx, r.ry, r.y);
        const stroke = ringStroke(r);
        const dash = dashed(r) ? '4 2.5' : undefined;
        return (
          <g key={r.key} data-testid={`size-ring-${r.key}`} data-band={r.band ?? 'none'} data-rx={r.rx.toFixed(1)} data-girth={r.garmentCm}>
            <path d={back} fill="none" stroke={stroke} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="2 2" />
            <path d={front} fill="none" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="3.4" strokeLinecap="round" />
            <path d={front} fill="none" stroke={stroke} strokeWidth="1.7" strokeDasharray={dash} strokeLinecap="round" />
            {r.stretch ? (
              // elastic band: relaxed → stretched range as a bracket under the right side of the ring
              <g stroke={stroke} strokeWidth="1" strokeDasharray={r.stretch.source === 'measured' ? undefined : '1.5 1.5'} data-testid="size-ring-stretch">
                <line x1={100 + r.stretch.relaxedRx} x2={100 + r.stretch.stretchedRx} y1={r.y + r.ry + 3} y2={r.y + r.ry + 3} />
                <line x1={100 + r.stretch.relaxedRx} x2={100 + r.stretch.relaxedRx} y1={r.y + r.ry + 1} y2={r.y + r.ry + 5} strokeDasharray={undefined} />
                <line x1={100 + r.stretch.stretchedRx} x2={100 + r.stretch.stretchedRx} y1={r.y + r.ry + 1} y2={r.y + r.ry + 5} strokeDasharray={undefined} />
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

const CHIP_CLASS: Record<Band | 'none', string> = {
  tight: 'border-bad/40 text-bad',
  snug: 'border-warn/40 text-warn',
  good: 'border-ok/40 text-ok',
  roomy: 'border-ink/20 text-ink-soft',
  loose: 'border-warn/40 text-warn',
  none: 'border-ink/20 text-ink-soft',
};

/** Short labels next to each ring, plus the full sentences for screen readers. */
export function SizeRingsChips({ overlay }: { overlay: RingOverlay }): ReactNode {
  return (
    <>
      <div className="pointer-events-none absolute inset-0" aria-hidden data-testid="size-ring-chips">
        {overlay.selected.rings.map((r) => (
          <span
            key={r.key}
            className={`absolute flex -translate-y-1/2 flex-col rounded-md border bg-white/90 px-1 py-px text-[9px] leading-[1.15] shadow-sm ${r.key === 'hem' ? 'left-1 items-start text-left' : 'right-1 items-end text-right'} ${CHIP_CLASS[r.band ?? 'none']}`}
            // the hem chip sits on the left, above the ring, so it never hides the ring's right end
            style={{ top: `calc(0.75rem + (100% - 1.5rem) * ${((r.key === 'hem' ? r.y - r.ry - 14 : r.y) / VIEW_H).toFixed(4)})` }}
            data-testid={`size-ring-chip-${r.key}`}
          >
            <span className="font-semibold">{r.chip[0]}</span>
            <span className="text-ink-soft">{r.chip[1]}</span>
          </span>
        ))}
      </div>
      <ul className="sr-only" data-testid="size-ring-text">
        {overlay.selected.rings.map((r) => (
          <li key={r.key}>
            Size {overlay.size}. {r.text}.
          </li>
        ))}
      </ul>
    </>
  );
}
