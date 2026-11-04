/**
 * `sizingNotes` → size bias (fit-engine-spec.md §Step 6.1).
 * +1 = the item runs small, prefer the larger tied candidate; −1 = runs large, prefer the smaller.
 */
export type SizingBias = -1 | 0 | 1;

export const SIZE_UP_PATTERN = /runs? small|size up|order (a size )?up|small fit|tight fit|snug fit/i;
export const SIZE_DOWN_PATTERN = /runs? (large|big)|size down|order (a size )?down|generous|oversized fit|roomy fit/i;

/**
 * Parse free-text sizing notes. Contradictory notes (both patterns match, e.g. "runs small in the
 * bust, generous in the hips") give 0. Non-strings give 0.
 */
export function parseSizingNotes(notes: string | null | undefined): SizingBias {
  if (typeof notes !== 'string' || notes.length === 0) return 0;
  const up = SIZE_UP_PATTERN.test(notes);
  const down = SIZE_DOWN_PATTERN.test(notes);
  if (up && !down) return 1;
  if (down && !up) return -1;
  return 0;
}
