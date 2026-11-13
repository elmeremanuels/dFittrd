/**
 * Shape families: the female v0 family of `shapes.ts` and a male family next to it, behind one
 * API (`family: 'female' | 'male'`), plus `shapeForBody`, which turns typed measurements into a
 * shape of either family for the same generator (`buildMannequin`).
 *
 * Source of the male numbers (read on 13 Nov 2026; nothing here is SMPL, Anny or another body model):
 *
 * - Chest, waist and neck girth per size: EN 13402-3 men's values (chest and waist in 4 cm steps
 *   at drop −12 cm, the neck girth the standard associates with each chest girth, and the letter
 *   codes S 86–94, M 94–102, L 102–110, XL 110–118, XXL 118–129). The standard itself is sold by
 *   CEN members and was not read; the values were read from the tables of the Wikipedia article
 *   "Joint European standard for size labelling of clothes" (text under CC BY-SA 4.0; the numbers
 *   are facts of the standard). Each letter size takes the midpoint of the two steps it combines.
 * - Everything else (stature, seat girth, shoulder breadths, inseam, limb girths, depth / breadth
 *   of the chest, waist and hip, and the levels): ANSUR II, the 2012 Anthropometric Survey of U.S.
 *   Army Personnel (NATICK/TR-15/007, "Approved for public release; distribution is unlimited"; a
 *   U.S. Government work, public domain in the United States). The value per size is the
 *   least-squares line of the measure on chest girth over the 4082 men, at the size's chest girth,
 *   rounded to 0.5 cm. `scripts/derive-male-table.ts` reproduces the table from the public file.
 *
 * ANSUR II is a military sample (young, fit, U.S.), not the civilian or the European population:
 * the male family is a referenced geometry fixture, like the female v0, not a fit standard.
 *
 * Four male rings have no direct measurement and are marked `proportion`:
 * - `shoulder`: the torso ring at the shoulder line without the arms. Its width is set so that the
 *   breadth over the deltoids of the mesh (see `deltoidBreadthCm`) equals ANSUR's bideltoid
 *   breadth; its depth is an assumed 0.55 of the width.
 * - `underbust`: 40 % of the way from the chest girth to the waist girth (its level sits 40 % of
 *   the way down from the chest level to the waist level).
 * - `knee`: ANSUR has no knee girth; the lower-thigh girth (just above the kneecap) stands in.
 * - `upper_arm`: ANSUR measures the biceps flexed; the relaxed girth is an assumed 0.93 of it.
 */
import { ellipseCircumference, ellipseFromCircumference, type AnchorRing } from '@curtain/anchors';
import { buildMannequin, type BuildOptions, type Mannequin } from './model';
import { BODY_SHAPES, BODY_SHAPE_IDS, FEMALE_ASPECT, type BodyFamily, type BodyLevels, type BodyShape, type BodyShapeId, type RingSpec } from './shapes';

export const MALE_BODY_SHAPE_IDS = ['S', 'M', 'L', 'XL', 'XXL'] as const;
export type MaleBodyShapeId = (typeof MALE_BODY_SHAPE_IDS)[number];

/** One row of the male reference table, cm. `en` = EN 13402-3, `ansur` = ANSUR II line at this chest girth. */
export interface MaleReferenceRow {
  /** Chest girth: midpoint of the size's two EN 13402-3 steps. */
  chest: number;
  /** Waist girth, EN 13402-3 at drop −12 cm. */
  waist: number;
  /** Neck girth EN 13402-3 associates with the chest girth. */
  neck: number;
  /** Seat (hip) girth: ANSUR buttock circumference. */
  hip: number;
  /** Stature, ANSUR. */
  stature: number;
  /** Shoulder width: ANSUR biacromial breadth (straight line between the shoulder points). */
  shoulderWidth: number;
  /** ANSUR bideltoid breadth (over the upper arms, arms hanging). */
  bideltoid: number;
  /** Inseam: ANSUR crotch height (crotch to floor), the EN 13402 inside-leg length. */
  inseam: number;
  thigh: number;
  /** ANSUR lower-thigh girth, used for the knee ring. */
  lowerThigh: number;
  calf: number;
  ankle: number;
  /** ANSUR biceps girth, flexed. */
  bicepsFlexed: number;
  wrist: number;
  /** Depth / breadth of the chest, waist and hip (ANSUR chest, waist, buttock depth over chest, waist, hip breadth). */
  chestAspect: number;
  waistAspect: number;
  hipAspect: number;
}

export const MALE_REFERENCE: Readonly<Record<MaleBodyShapeId, MaleReferenceRow>> = {
  S: { chest: 90, waist: 78, neck: 37.5, hip: 90.5, stature: 172.5, shoulderWidth: 40, bideltoid: 46, inseam: 83.5, thigh: 54, lowerThigh: 36.5, calf: 35.5, ankle: 21.5, bicepsFlexed: 31, wrist: 16.5, chestAspect: 0.79, waistAspect: 0.68, hipAspect: 0.66 },
  M: { chest: 98, waist: 86, neck: 39.5, hip: 96, stature: 174, shoulderWidth: 40.5, bideltoid: 48.5, inseam: 84, thigh: 58.5, lowerThigh: 39, calf: 37.5, ankle: 22, bicepsFlexed: 33.5, wrist: 17, chestAspect: 0.84, waistAspect: 0.71, hipAspect: 0.69 },
  L: { chest: 106, waist: 94, neck: 41.5, hip: 102, stature: 175.5, shoulderWidth: 41.5, bideltoid: 51, inseam: 84.5, thigh: 62.5, lowerThigh: 41, calf: 39.5, ankle: 23, bicepsFlexed: 36, wrist: 17.5, chestAspect: 0.88, waistAspect: 0.73, hipAspect: 0.71 },
  XL: { chest: 114, waist: 102, neck: 43.5, hip: 108, stature: 177, shoulderWidth: 42.5, bideltoid: 53.5, inseam: 85, thigh: 67, lowerThigh: 43, calf: 41, ankle: 23.5, bicepsFlexed: 38.5, wrist: 18, chestAspect: 0.91, waistAspect: 0.75, hipAspect: 0.73 },
  XXL: { chest: 123, waist: 111, neck: 45.75, hip: 114.5, stature: 179, shoulderWidth: 43.5, bideltoid: 56.5, inseam: 85.5, thigh: 71.5, lowerThigh: 45.5, calf: 43.5, ankle: 24.5, bicepsFlexed: 41, wrist: 18.5, chestAspect: 0.95, waistAspect: 0.76, hipAspect: 0.76 },
};

/**
 * Male levels as fractions of stature. ANSUR means over stature: the kneecap (0.278), buttock
 * height (0.506), the waist midway between the iliac crest and the tenth rib (0.621) and chest
 * height (0.735). The shoulder ring is at 0.811, which is where an even stretch between the chest
 * level and the top of the head puts it: 1.6 cm under ANSUR's acromial height (0.820), and far
 * enough above the chest ring that the A-pose arms clear the torso there in every size. The crotch
 * level is the row's inseam / stature.
 */
export const MALE_LEVELS: Readonly<Required<Omit<BodyLevels, 'crotch'>>> = { knee: 0.278, hip: 0.506, waist: 0.621, chest: 0.735, shoulder: 0.811 };

/** Assumed ratios of the male family (not measured). */
export const MALE_ASSUMPTIONS = {
  /** Relaxed upper-arm girth / flexed biceps girth. */
  relaxedOverFlexedBiceps: 0.93,
  /** Depth / width of the torso ring at the shoulder line. */
  shoulderAspect: 0.55,
  /** Depth / width of the thigh (deeper than wide, so that two thighs fit the hip breadth). */
  thighAspect: 1.2,
  /** Where the underbust girth sits between chest (0) and waist (1). */
  underbustTowardsWaist: 0.4,
} as const;

/**
 * Half-width of the arm tube at the shoulder joint and the joint's inset from the edge of the
 * shoulder ring, both in upper-arm half-widths (the generator's constants in `model.ts`).
 */
const ARM_ROOT = 1.18;
const JOINT_INSET = 0.3;
const half = (x: number): number => Math.round(x * 2) / 2;

const MALE_PROVENANCE: Readonly<Record<AnchorRing, 'table' | 'proportion'>> = {
  neck: 'table',
  shoulder: 'proportion',
  chest: 'table',
  underbust: 'proportion',
  waist: 'table',
  hip: 'table',
  thigh: 'table',
  knee: 'proportion',
  calf: 'table',
  ankle: 'table',
  upper_arm: 'proportion',
  wrist: 'table',
};

function ringOfWidth(widthCm: number, aspect: number): RingSpec {
  return { circumferenceCm: ellipseCircumference(widthCm / 2, (widthCm / 2) * aspect), aspect };
}

/** Width of the shoulder ring that puts the mesh's breadth over the deltoids at `bideltoidCm`. */
function shoulderRingWidth(bideltoidCm: number, upperArm: RingSpec): number {
  const armHalfWidth = ellipseFromCircumference(upperArm.circumferenceCm, upperArm.aspect).a;
  return bideltoidCm - 2 * (ARM_ROOT - JOINT_INSET) * armHalfWidth;
}

function maleShape(id: MaleBodyShapeId): BodyShape {
  const r = MALE_REFERENCE[id];
  const A = MALE_ASSUMPTIONS;
  const upperArm: RingSpec = { circumferenceCm: half(r.bicepsFlexed * A.relaxedOverFlexedBiceps), aspect: FEMALE_ASPECT.upper_arm };
  const ring = (circumferenceCm: number, aspect: number): RingSpec => ({ circumferenceCm, aspect });
  const rings: Record<AnchorRing, RingSpec> = {
    neck: ring(r.neck, FEMALE_ASPECT.neck),
    shoulder: ringOfWidth(shoulderRingWidth(r.bideltoid, upperArm), A.shoulderAspect),
    chest: ring(r.chest, r.chestAspect),
    underbust: ring(half(r.chest + (r.waist - r.chest) * A.underbustTowardsWaist), (r.chestAspect + r.waistAspect) / 2),
    waist: ring(r.waist, r.waistAspect),
    hip: ring(r.hip, r.hipAspect),
    thigh: ring(r.thigh, A.thighAspect),
    knee: ring(r.lowerThigh, FEMALE_ASPECT.knee),
    calf: ring(r.calf, FEMALE_ASPECT.calf),
    ankle: ring(r.ankle, FEMALE_ASPECT.ankle),
    upper_arm: upperArm,
    wrist: ring(r.wrist, FEMALE_ASPECT.wrist),
  };
  return { id, family: 'male', statureCm: r.stature, rings, provenance: MALE_PROVENANCE, levels: { ...MALE_LEVELS, crotch: r.inseam / r.stature } };
}

export const MALE_BODY_SHAPES: Readonly<Record<MaleBodyShapeId, BodyShape>> = {
  S: maleShape('S'),
  M: maleShape('M'),
  L: maleShape('L'),
  XL: maleShape('XL'),
  XXL: maleShape('XXL'),
};

/** The base shape of each family (the size a canonical body, and later a garment bundle, is built on). */
export const FAMILY_BASE_SHAPE_ID = { female: 'M', male: 'M' } as const satisfies Record<BodyFamily, string>;

export type FamilyShapeId<F extends BodyFamily = BodyFamily> = F extends 'male' ? MaleBodyShapeId : BodyShapeId;

/** The sizes of a family, smallest first. */
export function familyShapeIds(family: BodyFamily): readonly string[] {
  return family === 'male' ? MALE_BODY_SHAPE_IDS : BODY_SHAPE_IDS;
}

/** A size of a family, or `undefined` when the family has no such size (the female family has no `L`, the male no `XS`). */
export function familyShape(family: BodyFamily, id: string = FAMILY_BASE_SHAPE_ID[family]): BodyShape | undefined {
  const table: Readonly<Record<string, BodyShape>> = family === 'male' ? MALE_BODY_SHAPES : BODY_SHAPES;
  return Object.hasOwn(table, id) ? table[id] : undefined;
}

/** Width (left–right) of a shape's torso ring, cm. */
function ringWidth(shape: BodyShape, ring: AnchorRing): number {
  return 2 * ellipseFromCircumference(shape.rings[ring].circumferenceCm, shape.rings[ring].aspect).a;
}

/** The measurements a shopper would type for a shape, cm: the contract of `BodyInput`. */
export interface ReferenceMeasurements {
  family: BodyFamily;
  heightCm: number;
  /** Chest girth; the fit point is called `bust` on the wire for both families. */
  chestCm: number;
  waistCm: number;
  hipCm: number;
  /**
   * Shoulder width. Male: biacromial breadth (ANSUR). Female: the width of the v0 shoulder ring,
   * a representative proportion, not a measured table value.
   */
  shoulderCm: number;
  /** Crotch to floor. */
  inseamCm: number;
  neckCm: number;
}

function inseamOf(shape: BodyShape): number {
  // 0.455 is the generator's nominal crotch level (`NOMINAL_LEVELS.crotch` in model.ts).
  return (shape.levels?.crotch ?? 0.455) * shape.statureCm;
}

function shoulderOf(shape: BodyShape): number {
  if (shape.family === 'male' && Object.hasOwn(MALE_REFERENCE, shape.id)) return MALE_REFERENCE[shape.id as MaleBodyShapeId].shoulderWidth;
  return ringWidth(shape, 'shoulder');
}

/** Reference measurements of a table shape (`familyShape`). */
export function referenceMeasurements(shape: BodyShape): ReferenceMeasurements {
  const g = (ring: AnchorRing): number => shape.rings[ring].circumferenceCm;
  return { family: shape.family, heightCm: shape.statureCm, chestCm: g('chest'), waistCm: g('waist'), hipCm: g('hip'), shoulderCm: shoulderOf(shape), inseamCm: inseamOf(shape), neckCm: g('neck') };
}

/**
 * What a shopper types, cm. Everything but `family` is optional: a value that is missing, not
 * finite or not positive is filled from the family's table at the given chest girth (or, without a
 * chest girth, from the family's base size). `bust` and `chest` are the same measurement (the wire
 * calls the fit point `bust` for everyone); `chest` wins when both are given.
 */
export interface BodyInput {
  family: BodyFamily;
  heightCm?: number;
  /** Shoulder width as in `ReferenceMeasurements.shoulderCm`. */
  shoulderCm?: number;
  bust?: number;
  chest?: number;
  waist?: number;
  hip?: number;
}

const positive = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);

/** Piecewise linear through (xs[i], ys[i]) with xs rising; the end segments continue beyond the table. */
function interpolate(xs: readonly number[], ys: readonly number[], x: number): number {
  let i = 1;
  while (i < xs.length - 1 && x > xs[i]!) i++;
  const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
  return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t;
}

const UPPER_RINGS = ['neck', 'upper_arm', 'wrist'] as const;
const LEG_RINGS = ['thigh', 'knee', 'calf', 'ankle'] as const;
/** A typed shoulder width may move the shoulder ring this far from the table's, as a ratio. */
const SHOULDER_RATIO_LIMITS = [0.75, 1.35] as const;
/** No secondary girth is extrapolated below this share of the family's smallest size. */
const MIN_RATIO = 0.6;

/**
 * The shape of a family for typed measurements. The control girths (chest, waist, hip) are the
 * typed ones. The upper rings (neck, upper arm, wrist) follow the family's table by chest girth and
 * the leg rings by hip girth; the underbust keeps its place between chest and waist; the shoulder
 * ring moves by the difference between the typed shoulder width and the table's at that chest
 * girth; the levels scale with the height. With no measurement given it is exactly the family's
 * base shape; with the measurements of a table size it is exactly that size (id `custom`).
 */
export function shapeForBody(input: BodyInput): BodyShape {
  const family = input.family === 'male' ? 'male' : 'female';
  const rows = familyShapeIds(family).map((id) => familyShape(family, id)!);
  const base = familyShape(family)!;
  const girths = (ring: AnchorRing): number[] => rows.map((s) => s.rings[ring].circumferenceCm);
  const chests = girths('chest');
  const hips = girths('hip');
  const chest = positive(input.chest) ?? positive(input.bust) ?? base.rings.chest.circumferenceCm;
  const byChest = (ys: readonly number[]): number => interpolate(chests, ys, chest);
  const waist = positive(input.waist) ?? byChest(girths('waist'));
  const hip = positive(input.hip) ?? byChest(hips);
  const floor = (ring: AnchorRing, v: number): number => Math.max(v, MIN_RATIO * rows[0]!.rings[ring].circumferenceCm);
  const aspect = (ring: AnchorRing): number => byChest(rows.map((s) => s.rings[ring].aspect));

  const rings = {} as Record<AnchorRing, RingSpec>;
  rings.chest = { circumferenceCm: chest, aspect: aspect('chest') };
  rings.waist = { circumferenceCm: waist, aspect: aspect('waist') };
  rings.hip = { circumferenceCm: hip, aspect: aspect('hip') };
  for (const id of UPPER_RINGS) rings[id] = { circumferenceCm: floor(id, byChest(girths(id))), aspect: aspect(id) };
  for (const id of LEG_RINGS) rings[id] = { circumferenceCm: floor(id, interpolate(hips, girths(id), hip)), aspect: aspect(id) };
  // Underbust: the table's value at this chest girth, moved with the waist by the table's own share.
  const share = byChest(rows.map((s) => (s.rings.chest.circumferenceCm - s.rings.underbust.circumferenceCm) / (s.rings.chest.circumferenceCm - s.rings.waist.circumferenceCm)));
  rings.underbust = { circumferenceCm: floor('underbust', byChest(girths('underbust')) + share * (waist - byChest(girths('waist')))), aspect: aspect('underbust') };
  // Shoulder: the table's ring at this chest girth, widened by what the typed width adds to the table's width.
  const tableGirth = byChest(girths('shoulder'));
  const shoulderAspect = aspect('shoulder');
  const tableWidth = 2 * ellipseFromCircumference(tableGirth, shoulderAspect).a;
  const typed = positive(input.shoulderCm);
  if (typed === undefined) rings.shoulder = { circumferenceCm: tableGirth, aspect: shoulderAspect };
  else {
    const width = tableWidth + (typed - byChest(rows.map(shoulderOf)));
    rings.shoulder = ringOfWidth(Math.min(SHOULDER_RATIO_LIMITS[1] * tableWidth, Math.max(SHOULDER_RATIO_LIMITS[0] * tableWidth, width)), shoulderAspect);
  }

  const statureCm = positive(input.heightCm) ?? byChest(rows.map((s) => s.statureCm));
  const levels: BodyLevels | undefined = base.levels && { ...base.levels, crotch: byChest(rows.map((s) => s.levels?.crotch ?? 0.455)) };
  return { id: 'custom', family, statureCm, rings, provenance: base.provenance, ...(levels ? { levels } : {}) };
}

/** The mannequin for typed measurements: `buildMannequin(shapeForBody(input))`. */
export function buildBody(input: BodyInput, options?: BuildOptions): Mannequin {
  return buildMannequin(shapeForBody(input), options);
}

/**
 * Breadth of the mannequin over the deltoids with the arms brought down to the sides, cm: twice
 * the shoulder joint's offset plus the arm's half-width at the joint. Comparable to ANSUR's
 * bideltoid breadth (the mannequin itself stands in an A-pose, so its outline is wider).
 */
export function deltoidBreadthCm(m: Mannequin): number {
  const root = m.armAt(0, 1);
  return 2 * (m.arms.left.joint[0] + (root ? root.a : 0));
}
