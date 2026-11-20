/**
 * Scan-line geometry on a segmentation category mask (Uint8Array, row-major, one class id per
 * pixel; see `SEG` in landmarks.ts). Pure, so it is unit-tested with synthetic masks.
 */
import { POSE, SEG } from './landmarks';
import type { Landmark, LevelPlacement, LevelSample } from './types';

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

/** One row's run at a placement after its contact limits; `reject` = merged with a neighbouring blob. */
function limitedRun(mask: CategoryMask, p: LevelPlacement, x: number, y: number): { start: number; end: number } | 'reject' | null {
  const run = runAt(mask, x, y);
  if (!run || !p.limits) return run;
  const lo = p.limits.min * mask.width;
  const hi = p.limits.max * mask.width;
  if (p.limits.mode === 'reject') {
    // one pixel of slack for rounding of the landmark-derived limit
    return run.start < lo - 1 || run.end > hi + 1 ? 'reject' : run;
  }
  const start = Math.max(run.start, Math.ceil(lo));
  const end = Math.min(run.end, Math.floor(hi));
  return end >= start ? { start, end } : null;
}

/**
 * Width (pixels) of the blob at each placement. Slanted limbs are corrected by cos(axis angle) so a
 * horizontal scan across a 30° thigh does not inflate the width. Uses the median of 3 rows
 * (y−1, y, y+1) for robustness against mask noise. Placements with `limits` are split (legs) or
 * rejected (`contact: true`, arm against torso); placements with `search` take the narrowest run of
 * their row band (neck: in a front or side view nothing between nose and shoulders is narrower).
 */
export function sampleLevels(mask: CategoryMask, placements: readonly LevelPlacement[]): LevelSample[] {
  return placements.map((p) => {
    const xc = p.x * mask.width;
    const widths: number[] = [];
    const covs: number[] = [];
    let rejected = 0;
    if (p.search) {
      const y0 = Math.max(0, Math.round(p.search.y0 * mask.height));
      const y1 = Math.min(mask.height - 1, Math.round(p.search.y1 * mask.height));
      const rows: { w: number; cov: number }[] = [];
      for (let y = y0; y <= y1; y++) {
        const run = limitedRun(mask, p, xc, y);
        if (run === 'reject') {
          rejected++;
          continue;
        }
        if (run) rows.push({ w: run.end - run.start + 1, cov: coverageOnRun(mask, y, run.start, run.end) });
      }
      // the 3 narrowest rows (median of them) — robust to a single noisy row
      rows.sort((a, b) => a.w - b.w);
      for (const r of rows.slice(0, 3)) {
        widths.push(r.w);
        covs.push(r.cov);
      }
    } else {
      const yc = Math.round(p.y * mask.height);
      for (const dy of [-1, 0, 1]) {
        const y = yc + dy;
        const run = limitedRun(mask, p, xc, y);
        if (run === 'reject') {
          rejected++;
          continue;
        }
        if (!run) continue;
        widths.push(run.end - run.start + 1);
        covs.push(coverageOnRun(mask, y, run.start, run.end));
      }
    }
    if (widths.length === 0) return rejected > 0 ? { level: p.level, px: Number.NaN, coverage: 0, contact: true } : { level: p.level, px: Number.NaN, coverage: 0 };
    const cos = Math.cos((p.axisDeg * Math.PI) / 180);
    return { level: p.level, px: median(widths) * Math.max(0.5, cos), coverage: median(covs) };
  });
}

/**
 * Convert level widths measured on a mask to pixels of the frame it was computed from. MediaPipe
 * returns category masks at the input size, but when it does not (other model/delegate), widths in
 * mask pixels would otherwise be multiplied by a frame-pixel scale.
 */
export function samplesToFramePx(samples: readonly LevelSample[], maskWidth: number, frameWidth: number): LevelSample[] {
  if (!(maskWidth > 0) || !(frameWidth > 0) || maskWidth === frameWidth) return samples.map((s) => ({ ...s }));
  const k = frameWidth / maskWidth;
  return samples.map((s) => ({ ...s, px: s.px * k }));
}

const notBackgroundOrHair = (c: number): boolean => c !== SEG.BACKGROUND && c !== SEG.HAIR;

/**
 * Shoulder slope (degrees below horizontal) from the top contour of the person mask, front view:
 * for each shoulder, the first non-hair foreground row (scanning down from below the jaw to the
 * shoulder line) is found at 45 % and 85 % of the way from the
 * shoulder midline to the shoulder landmark (on the trapezius, inside the deltoid) and the angle of
 * the line through both points is taken in frame pixels. Mean of both sides, clamped to 0..45.
 * NaN when no contour could be traced.
 */
export function shoulderSlopeFromMask(mask: CategoryMask, lm: readonly Landmark[], frame: { width: number; height: number }): number {
  const ls = lm[POSE.LEFT_SHOULDER];
  const rs = lm[POSE.RIGHT_SHOULDER];
  const nose = lm[POSE.NOSE];
  if (!ls || !rs || !nose) return Number.NaN;
  const smx = (ls.x + rs.x) / 2;
  const smy = (ls.y + rs.y) / 2;
  // start below the ears/jaw (≈ 45 % of nose → shoulder line) so the head is never taken for a shoulder
  const yStart = Math.max(0, Math.floor((nose.y + 0.45 * (smy - nose.y)) * mask.height));
  const yEnd = Math.min(mask.height - 1, Math.ceil(smy * mask.height));
  const topAt = (xNorm: number): number => {
    const x = Math.round(xNorm * mask.width);
    if (x < 0 || x >= mask.width) return -1;
    for (let y = yStart; y <= yEnd; y++) if (notBackgroundOrHair(mask.data[y * mask.width + x] ?? 0)) return y;
    return -1;
  };
  const angles: number[] = [];
  for (const s of [ls, rs]) {
    const xi = smx + 0.45 * (s.x - smx);
    const xo = smx + 0.85 * (s.x - smx);
    const yi = topAt(xi);
    const yo = topAt(xo);
    if (yi < 0 || yo < 0) continue;
    const dx = Math.abs(xo - xi) * frame.width;
    const dy = ((yo - yi) / mask.height) * frame.height;
    if (!(dx > 0)) continue;
    angles.push((Math.atan2(dy, dx) * 180) / Math.PI);
  }
  if (angles.length === 0) return Number.NaN;
  const mean = angles.reduce((a, b) => a + b, 0) / angles.length;
  return Math.max(0, Math.min(45, mean));
}

/**
 * First foreground row scanning down the columns around `xNorm`. This is the top of the person
 * INCLUDING hair; the scale uses `headTopWithoutHair` instead (carry-over #16). -1 when none.
 */
export function headTopRow(mask: CategoryMask, xNorm: number, bandFrac = 0.08): number {
  return firstRowInBand(mask, xNorm, bandFrac, isPerson);
}

/**
 * Height of the skull vertex above the hairline as a fraction of the hairline → chin distance.
 * Approximate adult proportions, not a measurement: hairline (trichion) → chin ≈ 18 cm (forehead
 * ≈ 6 cm + nasion → menton ≈ 12 cm) and vertex → chin ≈ 23 cm, so the vertex sits ≈ 5 cm, or
 * ≈ 0.28 of the face height, above the hairline. To be calibrated with the tape-measured pilot
 * volunteers (docs/ENGINE-HANDOFF.md §Pilot, carry-over #16), together with SCAN_PRIOR_SIGMA_CM.
 */
export const VERTEX_ABOVE_HAIRLINE_RATIO = 0.28;

export interface HeadTop {
  /** Mask row of the head top without hair (may be fractional); -1 when there is no person. */
  row: number;
  /** First person row, hair included (the old head top). */
  personTop: number;
  /** How the row was found. */
  method: 'face-proportion' | 'no-hair' | 'person-top';
}

/**
 * Head top without hair (carry-over #16). The user's stature is measured to the skull, but the
 * segmenter's person mask includes the hair, so the first person row overstates the head-top →
 * heel span and every girth comes out 1–3 % low. With the multiclass segmenter's classes, around
 * the nose column:
 * - no hair above the face (bald, hair tied back below the crown): the first person row is the skull;
 * - hair on top: the vertex is estimated from the face itself, `VERTEX_ABOVE_HAIRLINE_RATIO` of the
 *   hairline → chin distance above the hairline (first → last face-skin row), and clamped between the
 *   top of the hair and the hairline. Hair volume (a bun, curls) then no longer moves the scale.
 * - no face skin in the band (back view, face covered): the first person row, as before.
 */
export function headTopWithoutHair(mask: CategoryMask, xNorm: number, bandFrac = 0.08): HeadTop {
  const personTop = firstRowInBand(mask, xNorm, bandFrac, isPerson);
  if (personTop < 0) return { row: -1, personTop, method: 'person-top' };
  const hairline = firstRowInBand(mask, xNorm, bandFrac, (c) => c === SEG.FACE_SKIN);
  if (hairline < 0) return { row: personTop, personTop, method: 'person-top' };
  let hairAbove = false;
  for (let y = personTop; y < hairline && !hairAbove; y++) hairAbove = rowInBandHas(mask, y, xNorm, bandFrac, (c) => c === SEG.HAIR);
  if (!hairAbove) return { row: personTop, personTop, method: 'no-hair' };
  let chin = hairline;
  for (let y = hairline; y < mask.height; y++) if (rowInBandHas(mask, y, xNorm, bandFrac, (c) => c === SEG.FACE_SKIN)) chin = y;
  const vertex = hairline - VERTEX_ABOVE_HAIRLINE_RATIO * (chin - hairline);
  return { row: Math.min(hairline, Math.max(personTop, vertex)), personTop, method: 'face-proportion' };
}

function bandOf(mask: CategoryMask, xNorm: number, bandFrac: number): [number, number] {
  const cx = Math.round(xNorm * mask.width);
  const half = Math.max(1, Math.round(mask.width * bandFrac));
  return [Math.max(0, cx - half), Math.min(mask.width - 1, cx + half)];
}

function rowInBandHas(mask: CategoryMask, y: number, xNorm: number, bandFrac: number, test: (c: number) => boolean): boolean {
  const [x0, x1] = bandOf(mask, xNorm, bandFrac);
  const row = y * mask.width;
  for (let x = x0; x <= x1; x++) if (test(mask.data[row + x] ?? 0)) return true;
  return false;
}

function firstRowInBand(mask: CategoryMask, xNorm: number, bandFrac: number, test: (c: number) => boolean): number {
  for (let y = 0; y < mask.height; y++) if (rowInBandHas(mask, y, xNorm, bandFrac, test)) return y;
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
