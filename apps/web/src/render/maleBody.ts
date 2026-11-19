/**
 * The male body family for the 2D figure (slice M1b, docs/research/men-3d-plan.md): the numbers
 * the 2D figure needs from the male family of `@curtain/mannequin` (`MALE_REFERENCE`,
 * `MALE_LEVELS`), copied here so the embed's main chunk does not pull in the mesh generator.
 * `__tests__/maleFigure.test.tsx` checks every value against the package, so the two cannot drift.
 *
 * Sources, as in `packages/mannequin/src/families.ts`: chest, waist and neck from EN 13402-3 as
 * reproduced on Wikipedia; everything else ANSUR II least-squares lines on chest girth, at the
 * size's chest girth. Nothing here is SMPL or another body model.
 *
 * Only for a men's product that passed the men's gate (D20 point 3): AvatarView draws it next to a
 * required 3D view on the male body, never alone.
 */

export const MALE_FIGURE_SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;
export type MaleFigureSize = (typeof MALE_FIGURE_SIZES)[number];

/** One row, cm (`MaleReferenceRow` of the mannequin package, the columns the figure draws). */
export interface MaleFigureRow {
  chest: number;
  waist: number;
  neck: number;
  hip: number;
  stature: number;
  shoulderWidth: number;
  bideltoid: number;
  inseam: number;
  thigh: number;
  lowerThigh: number;
  calf: number;
  ankle: number;
  bicepsFlexed: number;
  wrist: number;
  chestAspect: number;
  waistAspect: number;
  hipAspect: number;
}

export const MALE_FIGURE_TABLE: Readonly<Record<MaleFigureSize, MaleFigureRow>> = {
  S: { chest: 90, waist: 78, neck: 37.5, hip: 90.5, stature: 172.5, shoulderWidth: 40, bideltoid: 46, inseam: 83.5, thigh: 54, lowerThigh: 36.5, calf: 35.5, ankle: 21.5, bicepsFlexed: 31, wrist: 16.5, chestAspect: 0.79, waistAspect: 0.68, hipAspect: 0.66 },
  M: { chest: 98, waist: 86, neck: 39.5, hip: 96, stature: 174, shoulderWidth: 40.5, bideltoid: 48.5, inseam: 84, thigh: 58.5, lowerThigh: 39, calf: 37.5, ankle: 22, bicepsFlexed: 33.5, wrist: 17, chestAspect: 0.84, waistAspect: 0.71, hipAspect: 0.69 },
  L: { chest: 106, waist: 94, neck: 41.5, hip: 102, stature: 175.5, shoulderWidth: 41.5, bideltoid: 51, inseam: 84.5, thigh: 62.5, lowerThigh: 41, calf: 39.5, ankle: 23, bicepsFlexed: 36, wrist: 17.5, chestAspect: 0.88, waistAspect: 0.73, hipAspect: 0.71 },
  XL: { chest: 114, waist: 102, neck: 43.5, hip: 108, stature: 177, shoulderWidth: 42.5, bideltoid: 53.5, inseam: 85, thigh: 67, lowerThigh: 43, calf: 41, ankle: 23.5, bicepsFlexed: 38.5, wrist: 18, chestAspect: 0.91, waistAspect: 0.75, hipAspect: 0.73 },
  XXL: { chest: 123, waist: 111, neck: 45.75, hip: 114.5, stature: 179, shoulderWidth: 43.5, bideltoid: 56.5, inseam: 85.5, thigh: 71.5, lowerThigh: 45.5, calf: 43.5, ankle: 24.5, bicepsFlexed: 41, wrist: 18.5, chestAspect: 0.95, waistAspect: 0.76, hipAspect: 0.76 },
};

/** `MALE_LEVELS` of the mannequin package: heights above the floor as fractions of stature. */
export const MALE_FIGURE_LEVELS_FROM_FLOOR = { knee: 0.278, hip: 0.506, waist: 0.621, chest: 0.735, shoulder: 0.811 } as const;

/** Assumed ratios (as `MALE_ASSUMPTIONS` of the package, plus what only the 2D figure needs). */
export const MALE_FIGURE_ASSUMPTIONS = {
  /** Relaxed upper-arm girth / flexed biceps girth (package). */
  relaxedOverFlexedBiceps: 0.93,
  /** Depth / width of the thigh (package: deeper than wide, so two thighs fit the hip breadth). */
  thighAspect: 1.2,
  /** 2D figure only: depth / width of the neck, knee, calf and ankle (the female figure's 0.95 for the leg). */
  neckAspect: 0.9,
  limbAspect: 0.95,
  /** 2D figure only: head half-width, cm (the female figure draws 7.4). Not measured. */
  headHalfWidthCm: 7.7,
  /** 2D figure only: the deltoid stands this much proud of the relaxed upper arm (width ratio). */
  deltoidOverArm: 1.1,
  /** A typed shoulder width moves the shoulders at most this far from the table's (ratio, as the package). */
  shoulderRatio: [0.75, 1.35] as const,
} as const;

const ROWS = MALE_FIGURE_SIZES.map((s) => MALE_FIGURE_TABLE[s]);
const CHESTS = ROWS.map((r) => r.chest);
const ASPECT_KEYS = new Set<keyof MaleFigureRow>(['chestAspect', 'waistAspect', 'hipAspect', 'stature', 'inseam']);

/**
 * The table at a chest girth: piecewise linear between the sizes. Girths and breadths continue
 * the end segments beyond the table (held at 0.6 of the smallest size at least); the depth / width
 * ratios, the stature and the inseam stay at the nearest size (not extrapolated), as in the package.
 */
export function maleRowAt(chestCm: number): MaleFigureRow {
  const lo = CHESTS[0]!;
  const hi = CHESTS[CHESTS.length - 1]!;
  let i = 1;
  while (i < CHESTS.length - 1 && chestCm > CHESTS[i]!) i++;
  const t = (chestCm - CHESTS[i - 1]!) / (CHESTS[i]! - CHESTS[i - 1]!);
  const tc = (Math.min(hi, Math.max(lo, chestCm)) - CHESTS[i - 1]!) / (CHESTS[i]! - CHESTS[i - 1]!);
  const a = ROWS[i - 1]!;
  const b = ROWS[i]!;
  const out = {} as MaleFigureRow;
  for (const k of Object.keys(a) as (keyof MaleFigureRow)[]) {
    const tt = ASPECT_KEYS.has(k) ? tc : t;
    out[k] = Math.max(ROWS[0]![k] * 0.6, a[k] + (b[k] - a[k]) * tt);
  }
  return out;
}

/** The male levels from the head top (0) to the sole (1), as the 2D figure's `LEVEL_Y`. */
export function maleLevelsFromTop(): Record<'chin' | 'shoulder' | 'bust' | 'underbust' | 'waist' | 'hip' | 'crotch' | 'thigh' | 'knee' | 'calf' | 'ankle', number> {
  const f = MALE_FIGURE_LEVELS_FROM_FLOOR;
  const m = MALE_FIGURE_TABLE.M;
  const r3 = (v: number): number => Math.round(v * 1000) / 1000;
  const chest = r3(1 - f.chest);
  const waist = r3(1 - f.waist);
  const crotch = r3(1 - m.inseam / m.stature);
  return {
    chin: 0.13,
    shoulder: r3(1 - f.shoulder),
    bust: chest,
    // as the package's underbust ring: 40 % of the way from the chest level to the waist level
    underbust: r3(chest + (waist - chest) * 0.4),
    waist,
    hip: r3(1 - f.hip),
    crotch,
    // the 2D figure's own steps below the crotch (female: thigh 0.06 under the crotch)
    thigh: r3(crotch + 0.06),
    knee: r3(1 - f.knee),
    calf: 0.81,
    ankle: 0.95,
  };
}
