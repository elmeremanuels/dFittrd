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

/** The male body shape the figure follows: `v1` (default, M1b) or `v2` (the 3D body of `buildMannequin(shape, { maleShape: 'v2' })`). */
export type MaleShape = 'v1' | 'v2';

/**
 * Male shape v2 (branch `claude/male-2d-v2`): the front view of the 3D male body v2 of
 * `@curtain/mannequin` (`src/maleV2.ts`), measured on its mesh per size by
 * `packages/mannequin/scripts/measure-male-v2-front.ts` and copied here (the embed does not load
 * the mesh generator). Ratios, so a typed body scales them the way the 3D body scales its rings.
 * `__tests__/maleFigureV2.test.tsx` rebuilds the v2 meshes and checks the drawn figure against
 * them, so the copy cannot drift.
 *
 * - `chestAspect`, `waistAspect`, `hipAspect`: the width rule of the 2D figure, girth / (π(1 + r)),
 *   solved for the front-view half-width of the v2 torso at the chest, waist and seat rings. Not
 *   the depth / width of the v2 section (a superellipse is longer round than an ellipse of the same
 *   breadth and depth); used so the body, its garments and its size rings share one rule.
 * - `underbustShare`: the underbust half-width between the waist (0) and chest (1) half-widths.
 * - `lats`: half-width at the armpit (the lats) over the chest half-width; `axillaLevel`: the
 *   armpit's height, of stature from the floor (ANSUR's axilla height, as the 3D body).
 * - `neckAboveShoulder`: the neck ring over the shoulder ring, of stature; `shoulderRing`: the
 *   torso's half-width at the shoulder ring over half the shoulder width; `trapezius`: the torso
 *   at 50 % and 75 % of the way up from the shoulder ring to the neck ring, between the neck (0)
 *   and the shoulder ring (1) half-widths: a straight slope.
 * - `legX`: the leg's centre over the seat half-width (the legs moved in under the seat);
 *   `thighLevel`: the thigh ring's height, of stature from the floor.
 * - `deltoid`: the breadth over the deltoids over ANSUR's bideltoid breadth (the v2 cap adds 0.1 cm).
 */
/**
 * Under the crotch the thighs of the 3D male body v2 part: each inner side stays this far off the centre plane, reached
 * this far under the crotch (`MALE_V2_ASSUMPTIONS.thighGapCm` / `thighPartOverCm` of `@curtain/mannequin`, mirrored here
 * and held equal by `maleFigureV2.test.tsx`), cm.
 */
export const MALE_V2_THIGH_GAP_CM = 0.6;
export const MALE_V2_THIGH_PART_OVER_CM = 0.8;

export interface MaleV2FigureRow {
  chestAspect: number;
  waistAspect: number;
  hipAspect: number;
  underbustShare: number;
  lats: number;
  axillaLevel: number;
  neckAboveShoulder: number;
  shoulderRing: number;
  trapezius: readonly [number, number];
  legX: number;
  thighLevel: number;
  deltoid: number;
}

export const MALE_V2_FIGURE_TABLE: Readonly<Record<MaleFigureSize, MaleV2FigureRow>> = {
  S: { chestAspect: 0.8103, waistAspect: 0.7835, hipAspect: 0.8777, underbustShare: 0.4777, lats: 1.0766, axillaLevel: 0.756, neckAboveShoulder: 0.0378, shoulderRing: 0.9463, trapezius: [0.5211, 0.2516], legX: 0.5098, thighLevel: 0.4546, deltoid: 1.0017 },
  M: { chestAspect: 0.8262, waistAspect: 0.8037, hipAspect: 0.9046, underbustShare: 0.4685, lats: 1.0765, axillaLevel: 0.757, neckAboveShoulder: 0.0378, shoulderRing: 0.9826, trapezius: [0.521, 0.2522], legX: 0.4938, thighLevel: 0.4535, deltoid: 1.0018 },
  L: { chestAspect: 0.8401, waistAspect: 0.8187, hipAspect: 0.9214, underbustShare: 0.4597, lats: 1.0758, axillaLevel: 0.757, neckAboveShoulder: 0.0378, shoulderRing: 1.0023, trapezius: [0.5209, 0.2528], legX: 0.488, thighLevel: 0.4524, deltoid: 1.0018 },
  XL: { chestAspect: 0.8523, waistAspect: 0.8348, hipAspect: 0.9384, underbustShare: 0.4535, lats: 1.0753, axillaLevel: 0.757, neckAboveShoulder: 0.0378, shoulderRing: 1.0211, trapezius: [0.5209, 0.2534], legX: 0.4909, thighLevel: 0.4513, deltoid: 1.0019 },
  XXL: { chestAspect: 0.8655, waistAspect: 0.846, hipAspect: 0.9608, underbustShare: 0.4431, lats: 1.0753, axillaLevel: 0.757, neckAboveShoulder: 0.0378, shoulderRing: 1.0538, trapezius: [0.5208, 0.2538], legX: 0.4999, thighLevel: 0.4491, deltoid: 1.0019 },
};

/** The v2 row at a chest girth: piecewise linear between the sizes, held at the ends (as the package's ring fits). */
export function maleV2RowAt(chestCm: number): MaleV2FigureRow {
  const c = Math.min(CHESTS[CHESTS.length - 1]!, Math.max(CHESTS[0]!, chestCm));
  let i = 1;
  while (i < CHESTS.length - 1 && c > CHESTS[i]!) i++;
  const t = (c - CHESTS[i - 1]!) / (CHESTS[i]! - CHESTS[i - 1]!);
  const a = MALE_V2_FIGURE_TABLE[MALE_FIGURE_SIZES[i - 1]!];
  const b = MALE_V2_FIGURE_TABLE[MALE_FIGURE_SIZES[i]!];
  const l = (x: number, y: number): number => x + (y - x) * t;
  return {
    chestAspect: l(a.chestAspect, b.chestAspect),
    waistAspect: l(a.waistAspect, b.waistAspect),
    hipAspect: l(a.hipAspect, b.hipAspect),
    underbustShare: l(a.underbustShare, b.underbustShare),
    lats: l(a.lats, b.lats),
    axillaLevel: l(a.axillaLevel, b.axillaLevel),
    neckAboveShoulder: l(a.neckAboveShoulder, b.neckAboveShoulder),
    shoulderRing: l(a.shoulderRing, b.shoulderRing),
    trapezius: [l(a.trapezius[0], b.trapezius[0]), l(a.trapezius[1], b.trapezius[1])],
    legX: l(a.legX, b.legX),
    thighLevel: l(a.thighLevel, b.thighLevel),
    deltoid: l(a.deltoid, b.deltoid),
  };
}
