/**
 * Scan-line geometry on a segmentation category mask (Uint8Array, row-major, one class id per
 * pixel; see `SEG` in landmarks.ts). Pure, so it is unit-tested with synthetic masks.
 */
import { SEG } from './landmarks';
import type { LevelPlacement, LevelSample } from './types';

export interface CategoryMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export const isPerson = (c: number): boolean => c !== SEG.BACKGROUND;

/** Contiguous foreground run on row `y` containing (or nearest to) column `x`. */
export function runAt(mask: CategoryMask, x: number, y: number): { start: number; end: number } | null {
  const { width, height, data } = mask;
  if (y < 0 || y >= height) return null;
  const row = y * width;
  const fg = (col: number): boolean => col >= 0 && col < width && isPerson(data[row + col] ?? 0);
  let cx = Math.max(0, Math.min(width - 1, Math.round(x)));
  if (!fg(cx)) {
    // look for the nearest foreground pixel within 12 % of the width
    const maxD = Math.max(2, Math.round(width * 0.12));
    let found = -1;
    for (let d = 1; d <= maxD; d++) {
      if (fg(cx - d)) {
        found = cx - d;
        break;
      }
      if (fg(cx + d)) {
        found = cx + d;
        break;
      }
    }
    if (found < 0) return null;
    cx = found;
  }
  let s = cx;
  let e = cx;
  while (fg(s - 1)) s--;
  while (fg(e + 1)) e++;
  return { start: s, end: e };
}

/** clothes / (clothes + skin) over a run; accessories count as clothes. 0 when nothing is classified. */
export function coverageOnRun(mask: CategoryMask, y: number, start: number, end: number): number {
  let clothes = 0;
  let skin = 0;
  const row = y * mask.width;
  for (let x = start; x <= end; x++) {
    const c = mask.data[row + x] ?? 0;
    if (c === SEG.CLOTHES || c === SEG.ACCESSORIES) clothes++;
    else if (c === SEG.BODY_SKIN || c === SEG.FACE_SKIN) skin++;
  }
  const n = clothes + skin;
  return n === 0 ? 0 : clothes / n;
}

/**
 * Width (pixels) of the blob at each placement. Slanted limbs are corrected by cos(axis angle) so a
 * horizontal scan across a 30° thigh does not inflate the width. Uses the median of 3 rows
 * (y−1, y, y+1) for robustness against mask noise.
 */
export function sampleLevels(mask: CategoryMask, placements: readonly LevelPlacement[]): LevelSample[] {
  return placements.map((p) => {
    const yc = Math.round(p.y * mask.height);
    const xc = p.x * mask.width;
    const widths: number[] = [];
    const covs: number[] = [];
    for (const dy of [-1, 0, 1]) {
      const y = yc + dy;
      const run = runAt(mask, xc, y);
      if (!run) continue;
      widths.push(run.end - run.start + 1);
      covs.push(coverageOnRun(mask, y, run.start, run.end));
    }
    if (widths.length === 0) return { level: p.level, px: Number.NaN, coverage: 0 };
    const cos = Math.cos((p.axisDeg * Math.PI) / 180);
    return { level: p.level, px: median(widths) * Math.max(0.5, cos), coverage: median(covs) };
  });
}

/** First foreground row scanning down the columns around `xNorm` (head top). -1 when none. */
export function headTopRow(mask: CategoryMask, xNorm: number, bandFrac = 0.08): number {
  const cx = Math.round(xNorm * mask.width);
  const half = Math.max(1, Math.round(mask.width * bandFrac));
  for (let y = 0; y < mask.height; y++) {
    const row = y * mask.width;
    for (let x = Math.max(0, cx - half); x <= Math.min(mask.width - 1, cx + half); x++) {
      if (isPerson(mask.data[row + x] ?? 0)) return y;
    }
  }
  return -1;
}

export function median(values: readonly number[]): number {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return Number.NaN;
  const m = v.length >> 1;
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

/** Element-wise median of several masks (same size): robust to a single bad segmentation. */
export function medianMask(masks: readonly CategoryMask[]): CategoryMask {
  const first = masks[0];
  if (!first) throw new RangeError('no masks');
  if (masks.length === 1) return first;
  const n = first.width * first.height;
  const out = new Uint8Array(n);
  const tmp = new Array<number>(masks.length);
  for (let i = 0; i < n; i++) {
    for (let m = 0; m < masks.length; m++) tmp[m] = masks[m]?.data[i] ?? 0;
    // median over class ids is meaningless; take the majority class instead (person vs bg first)
    const fgVotes = tmp.filter(isPerson).length;
    if (fgVotes * 2 < masks.length) {
      out[i] = SEG.BACKGROUND;
      continue;
    }
    const counts = new Map<number, number>();
    for (const c of tmp) if (isPerson(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
    let best = SEG.CLOTHES as number;
    let bestN = -1;
    for (const [c, k] of counts) {
      if (k > bestN) {
        best = c;
        bestN = k;
      }
    }
    out[i] = best;
  }
  return { width: first.width, height: first.height, data: out };
}
