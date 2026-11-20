/**
 * Decides which recorded frames the worker keeps in memory: the best front and side candidates
 * with one neighbour on each side (for the 3-frame median), plus the two most recent frames (they
 * may become neighbours of a future best). Pure, so the policy is unit-tested without bitmaps.
 */
export interface RetainInput {
  frontIndex: number;
  sideIndex: number;
  latestIndex: number;
}

export function retainedIndices({ frontIndex, sideIndex, latestIndex }: RetainInput): Set<number> {
  const keep = new Set<number>();
  for (const b of [frontIndex, sideIndex]) {
    if (b < 0) continue;
    keep.add(b - 1);
    keep.add(b);
    keep.add(b + 1);
  }
  keep.add(latestIndex);
  keep.add(latestIndex - 1);
  for (const i of [...keep]) if (i < 0) keep.delete(i);
  return keep;
}

/** Neighbour window [i−1, i, i+1] restricted to indices that exist. */
export function neighbourhood(i: number, exists: (idx: number) => boolean): number[] {
  return [i - 1, i, i + 1].filter((j) => j >= 0 && exists(j));
}
