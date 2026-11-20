import { useEffect, useState, type ReactNode } from 'react';
import type { GarmentPayload } from '@curtain/schema';
import { notDrawnSentence, type NotDrawnNote } from './notDrawn';
import type { Units } from './units';

/**
 * The height of an element, kept up to date (whole px, 0 until it is on the page). Returns the ref to put on the
 * element and its height.
 */
export function useElementHeight<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (!el) return;
    const measure = (): void => setHeight(Math.ceil(el.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, el ? height : 0];
}

/** Space between the riding sentence and the bar under it, px. */
export const NOT_DRAWN_GAP_PX = 4;

interface NotDrawnLineProps {
  block: NotDrawnNote;
  size: string;
  audience: GarmentPayload['audience'] | undefined;
  units: Units;
  testId: string;
  /** `status` where the sentence appears after a tap and nothing else announces it. */
  role?: 'status';
  className?: string;
  lineRef?: (el: HTMLParagraphElement | null) => void;
}

/**
 * The one sentence that says why the size on screen is not drawn (`notDrawn.ts`), under its picture. On a phone the
 * picture is about as tall as the screen and the sticky "Choose size" bar lies over the bottom of it, so written under
 * the picture the sentence was under the bar or below the screen while the shopper looked at a body without a garment
 * (OI-105). It is `sticky` now: while its place under the picture is out of sight it rides just above the bar
 * (`--bar-clear`, the bar's height, set by the result screen), over the foot of the picture, on its own background.
 * Without a bar the variable is unset and it rides at the bottom of the screen.
 */
export function NotDrawnLine({ block, size, audience, units, testId, role, className = '', lineRef }: NotDrawnLineProps): ReactNode {
  return (
    <p
      ref={lineRef}
      role={role}
      className={`sticky z-[5] rounded-lg bg-cream px-2 py-1.5 text-[11px] leading-snug text-ink-soft ring-1 ring-ink/10 ${className}`}
      style={{ bottom: `calc(var(--bar-clear, 0px) + ${NOT_DRAWN_GAP_PX}px)` }}
      data-testid={testId}
      data-anchor={block.anchor}
      data-reason={block.reason}
    >
      {notDrawnSentence(block, size, audience, units)}
    </p>
  );
}
