/**
 * Render path B v0 — geometry helpers for the mirror (SVG viewBox 0 0 200 500).
 *
 * The body silhouette is parametric in the user's measurements; the garment outline is derived
 * from the fit engine's `fitGapsForRender` (slack per point in cm) so S/M/L on the same body read
 * as tight / fits / loose without labels (handoff §9 size test). Lengths come from
 * `lengthCm` scaled by the user's height; fabric look from `fabric` (sheen/opacity/weight/drape).
 * When a captured base frame exists it replaces the SVG body (the garment overlay stays).
 * Full mesh warp of the flat-lay photo onto the silhouette atlas is the next step (D4).
 */
import type { FitPoint, GarmentPayload, UserBody } from '@curtain/schema';
import type { RenderGaps } from '@curtain/fit-engine';
import { MALE_FIGURE_ASSUMPTIONS, MALE_FIGURE_TABLE, maleLevelsFromTop, maleRowAt, maleV2RowAt, type MaleShape } from './maleBody';

export type { MaleShape } from './maleBody';

export const VIEW_W = 200;
export const VIEW_H = 500;
export const HEAD_TOP_Y = 20;
export const FEET_Y = 480;
export const CENTER_X = 100;
/** The figure's colour when no skin colour was chosen. */
export const STANDARD_SKIN_HEX = '#DFC3A8';

/** Vertical landmarks of the silhouette, as fractions of the stature (head top → sole). */
export const LEVEL_Y = {
  headTop: 0,
  chin: 0.13,
  shoulder: 0.19,
  bust: 0.28,
  underbust: 0.33,
  waist: 0.4,
  hip: 0.52,
  crotch: 0.56,
  thigh: 0.62,
  knee: 0.73,
  calf: 0.83,
  ankle: 0.95,
  sole: 1,
} as const;

export type LevelKey = keyof typeof LEVEL_Y;

export function levelY(level: LevelKey): number {
  return HEAD_TOP_Y + LEVEL_Y[level] * (FEET_Y - HEAD_TOP_Y);
}

/** Which body the 2D figure draws. `male` only next to a required 3D view on the male body (D20 point 3). */
export type FigureFamily = 'female' | 'male';

/** The male figure's levels (head top → sole), from the mannequin package's male family (`maleBody.ts`). */
export const MALE_LEVEL_Y: Readonly<Record<LevelKey, number>> = { headTop: 0, ...maleLevelsFromTop(), sole: 1 };

/** A level of this figure: the male levels for a male figure, `levelY` (unchanged) for the female one. */
export function figureY(g: Pick<BodyGeometry, 'levels'>, level: LevelKey): number {
  return g.levels ? HEAD_TOP_Y + g.levels[level] * (FEET_Y - HEAD_TOP_Y) : levelY(level);
}

/** px per cm of stature (height). */
export function pxPerCm(heightCm: number): number {
  return (FEET_Y - HEAD_TOP_Y) / Math.max(120, Math.min(230, heightCm));
}

/**
 * Girth (cm) → front-view half-width (px). The cross-section is an ellipse with depth/width
 * ratio `r` (ribcage ≈ 0.7, waist ≈ 0.75, thigh ≈ 0.95); its perimeter ≈ π(a + b) = π·a·(1 + r),
 * so the half-width a = girth / (π(1 + r)). Scaled by px-per-cm of the stature so widths and
 * lengths share one scale (an 88 cm bust ≈ 33 cm across ≈ 45 px on a 168 cm body).
 */
export function halfWidthFromGirth(girthCm: number, ppc: number, r = 0.7): number {
  return (Math.max(0, girthCm) / (Math.PI * (1 + r))) * ppc;
}

/** Depth / width of a hanging hem's cross-section (the hem ring and a skirt's drawn hem share it). */
export const HEM_DEPTH = 0.95;
/** Size rings and a drawn hem never run off the 200 px viewBox. */
export const MAX_RING_RX = 97;

/** Real-world proportions (cm) the silhouette uses where no measurement exists. */
const HEAD_HALF_WIDTH_CM = 7.4;
const NECK_HALF_WIDTH_CM = 5.8;
const ARM_HALF_WIDTH_CM = 4.6;

export interface BodyGeometry {
  heightCm: number;
  pxPerCm: number;
  shoulderHalf: number;
  bustHalf: number;
  waistHalf: number;
  hipHalf: number;
  thighHalf: number;
  kneeHalf: number;
  ankleHalf: number;
  neckHalf: number;
  armHalf: number;
  /** Head half-width (rx) and half-height (ry), px. */
  headR: number;
  headRy: number;
  footLength: number;
  /**
   * Male figure only (absent on the female figure, so its geometry is what it was): the family,
   * its levels, the depth / width of the chest, waist and hip used to turn girths into widths (the
   * size rings use the same), and the arm: half-width over the deltoids, the arm's centre at the
   * shoulder and its outward drift at the wrist (px), the wrist and calf half-widths.
   */
  family?: 'male';
  levels?: Readonly<Record<LevelKey, number>>;
  aspects?: { bust: number; waist: number; hip: number };
  deltoidHalf?: number;
  armX?: number;
  armDrift?: number;
  wristHalf?: number;
  calfHalf?: number;
  /**
   * Male shape v2 only (absent on the v1 male and the female figure, so their geometry is what it
   * was): the figure follows the 3D male body v2 (`maleBody.ts`, `MALE_V2_FIGURE_TABLE`).
   */
  maleShape?: 'v2';
  /** v2: the centre of each leg from the middle, px (v1 and female: half the seat half-width). */
  legX?: number;
  /** v2: the outline's extra stations (px): underbust and armpit half-widths, the armpit, neck ring and thigh ring heights, the shoulder ring half-width and the trapezius slope. */
  v2?: { underbustHalf: number; armpitHalf: number; armpitY: number; neckY: number; shoulderRingHalf: number; trapezius: readonly [number, number]; thighRingY: number };
}

/** Options of the 2D figure. */
export interface FigureOptions {
  /** The male figure's shape: `v1` (default) or `v2` (the 3D male body v2). The female figure ignores it. */
  maleShape?: MaleShape;
}

export const REFERENCE_BODY: Required<Pick<UserBody['measurements'], 'bust' | 'waist' | 'hip' | 'shoulder' | 'thigh'>> & { height: number } = {
  bust: 88,
  waist: 70,
  hip: 96,
  shoulder: 38,
  thigh: 56,
  height: 168,
};

export function bodyGeometry(measurements: UserBody['measurements'] | null | undefined, heightCm?: number, family: FigureFamily = 'female', options: FigureOptions = {}): BodyGeometry {
  if (family === 'male') return options.maleShape === 'v2' ? maleV2BodyGeometry(measurements, heightCm) : maleBodyGeometry(measurements, heightCm);
  const m = measurements ?? {};
  const bust = m.bust ?? REFERENCE_BODY.bust;
  const waist = m.waist ?? REFERENCE_BODY.waist;
  const hip = m.hip ?? REFERENCE_BODY.hip;
  const shoulder = m.shoulder ?? Math.max(34, Math.min(50, bust * 0.43));
  const thigh = m.thigh ?? Math.max(44, hip * 0.58);
  const height = heightCm ?? REFERENCE_BODY.height;
  const ppc = pxPerCm(height);
  const bustHalf = halfWidthFromGirth(bust, ppc, 0.7);
  return {
    heightCm: height,
    pxPerCm: ppc,
    // `shoulder` is the seam-to-seam shoulder width; shoulders sit a little outside the bust line
    shoulderHalf: Math.max(bustHalf * 1.05, (shoulder / 2) * ppc),
    bustHalf,
    waistHalf: halfWidthFromGirth(waist, ppc, 0.75),
    hipHalf: halfWidthFromGirth(hip, ppc, 0.7),
    thighHalf: halfWidthFromGirth(thigh, ppc, 0.95),
    kneeHalf: halfWidthFromGirth(thigh * 0.72, ppc, 0.95),
    ankleHalf: halfWidthFromGirth(thigh * 0.45, ppc, 0.95),
    neckHalf: NECK_HALF_WIDTH_CM * ppc,
    armHalf: ARM_HALF_WIDTH_CM * ppc,
    headR: HEAD_HALF_WIDTH_CM * ppc,
    headRy: (levelY('chin') - HEAD_TOP_Y) / 2,
    footLength: (m.footLengthCm ?? 25) * ppc * 0.6,
  };
}

/** The male reference body: the male family's M (chest 98, waist 86, seat 96, shoulder 40.5, 174 cm). */
export const MALE_REFERENCE_BODY = {
  bust: MALE_FIGURE_TABLE.M.chest,
  waist: MALE_FIGURE_TABLE.M.waist,
  hip: MALE_FIGURE_TABLE.M.hip,
  shoulder: MALE_FIGURE_TABLE.M.shoulderWidth,
  thigh: MALE_FIGURE_TABLE.M.thigh,
  height: MALE_FIGURE_TABLE.M.stature,
} as const;

/**
 * The male figure from the shopper's chest (`bust` on the wire), waist, seat (`hip`), shoulder
 * width and height; whatever is missing comes from the male table at the chest girth (`maleRowAt`).
 * Widths use the male family's own depth / width ratios (a man's chest is deeper than a woman's
 * ribcage at the same girth), the shoulder line is the biacromial breadth and the arms hang from
 * the deltoids (bideltoid breadth, scaled by a typed shoulder width). No bust: the chest is one
 * smooth line from the armpit to the waist.
 */
function maleBodyGeometry(measurements: UserBody['measurements'] | null | undefined, heightCm?: number): BodyGeometry {
  const A = MALE_FIGURE_ASSUMPTIONS;
  const m = measurements ?? {};
  const chest = m.bust ?? MALE_REFERENCE_BODY.bust;
  const row = maleRowAt(chest);
  const waist = m.waist ?? row.waist;
  const hip = m.hip ?? row.hip;
  const shoulderRatio = Math.min(A.shoulderRatio[1], Math.max(A.shoulderRatio[0], (m.shoulder ?? row.shoulderWidth) / row.shoulderWidth));
  const shoulder = row.shoulderWidth * shoulderRatio;
  const legScale = hip / row.hip;
  const thigh = m.thigh ?? row.thigh * legScale;
  const height = heightCm ?? row.stature;
  const ppc = pxPerCm(height);
  const levels = MALE_LEVEL_Y;
  const chin = HEAD_TOP_Y + levels.chin * (FEET_Y - HEAD_TOP_Y);
  const bustHalf = halfWidthFromGirth(chest, ppc, row.chestAspect);
  const shoulderHalf = Math.max(bustHalf * 1.05, (shoulder / 2) * ppc);
  const armHalf = ((row.bicepsFlexed * A.relaxedOverFlexedBiceps) / (2 * Math.PI)) * ppc * A.deltoidOverArm;
  const deltoidHalf = Math.max(shoulderHalf + armHalf * 0.6, (row.bideltoid * shoulderRatio * ppc) / 2);
  const armX = deltoidHalf - armHalf;
  const hipHalf = halfWidthFromGirth(hip, ppc, row.hipAspect);
  const wristHalf = (row.wrist / (2 * Math.PI)) * ppc;
  return {
    heightCm: height,
    pxPerCm: ppc,
    shoulderHalf,
    bustHalf,
    waistHalf: halfWidthFromGirth(waist, ppc, row.waistAspect),
    hipHalf,
    thighHalf: halfWidthFromGirth(thigh, ppc, A.thighAspect),
    kneeHalf: halfWidthFromGirth(row.lowerThigh * legScale, ppc, A.limbAspect),
    ankleHalf: halfWidthFromGirth(row.ankle, ppc, A.limbAspect),
    neckHalf: halfWidthFromGirth(row.neck, ppc, A.neckAspect),
    armHalf,
    headR: A.headHalfWidthCm * ppc,
    headRy: (chin - HEAD_TOP_Y) / 2,
    footLength: (m.footLengthCm ?? 27) * ppc * 0.6,
    family: 'male',
    levels,
    aspects: { bust: row.chestAspect, waist: row.waistAspect, hip: row.hipAspect },
    deltoidHalf,
    armX,
    // the wrist clears the seat by 3 px (the female arm's drift where that is wider)
    armDrift: Math.max(bustHalf * 0.22 + 6, hipHalf + wristHalf + 3 - armX),
    wristHalf,
    calfHalf: halfWidthFromGirth(row.calf * legScale, ppc, A.limbAspect),
  };
}

/**
 * The male figure v2: the front view of the 3D male body v2 (`buildMannequin(shape, { maleShape:
 * 'v2' })`). The same inputs and table as v1 (`maleRowAt`), but the widths at the chest, waist and
 * seat are the v2 torso's (narrower seat, a V from the lats at the armpit to the waist), the
 * trapezius is the v2 straight slope to the neck ring, the deltoids carry the v2 cap's 0.1 cm and
 * the legs sit in under the seat, touching below the crotch. Ratios from `MALE_V2_FIGURE_TABLE`.
 */
function maleV2BodyGeometry(measurements: UserBody['measurements'] | null | undefined, heightCm?: number): BodyGeometry {
  const A = MALE_FIGURE_ASSUMPTIONS;
  const m = measurements ?? {};
  const chest = m.bust ?? MALE_REFERENCE_BODY.bust;
  const row = maleRowAt(chest);
  const v = maleV2RowAt(chest);
  const waist = m.waist ?? row.waist;
  const hip = m.hip ?? row.hip;
  const shoulderRatio = Math.min(A.shoulderRatio[1], Math.max(A.shoulderRatio[0], (m.shoulder ?? row.shoulderWidth) / row.shoulderWidth));
  const shoulder = row.shoulderWidth * shoulderRatio;
  const legScale = hip / row.hip;
  const thigh = m.thigh ?? row.thigh * legScale;
  const height = heightCm ?? row.stature;
  const ppc = pxPerCm(height);
  const levels = MALE_LEVEL_Y;
  const span = FEET_Y - HEAD_TOP_Y;
  const atLevel = (fromFloor: number): number => HEAD_TOP_Y + (1 - fromFloor) * span;
  const chin = HEAD_TOP_Y + levels.chin * span;
  const shoulderY = HEAD_TOP_Y + levels.shoulder * span;
  const bustHalf = halfWidthFromGirth(chest, ppc, v.chestAspect);
  const waistHalf = halfWidthFromGirth(waist, ppc, v.waistAspect);
  const hipHalf = halfWidthFromGirth(hip, ppc, v.hipAspect);
  const shoulderHalf = Math.max(bustHalf * 1.05, (shoulder / 2) * ppc);
  const armHalf = ((row.bicepsFlexed * A.relaxedOverFlexedBiceps) / (2 * Math.PI)) * ppc * A.deltoidOverArm;
  const deltoidHalf = Math.max(shoulderHalf + armHalf * 0.6, (row.bideltoid * v.deltoid * shoulderRatio * ppc) / 2);
  const armX = deltoidHalf - armHalf;
  const wristHalf = (row.wrist / (2 * Math.PI)) * ppc;
  return {
    heightCm: height,
    pxPerCm: ppc,
    shoulderHalf,
    bustHalf,
    waistHalf,
    hipHalf,
    thighHalf: halfWidthFromGirth(thigh, ppc, A.thighAspect),
    kneeHalf: halfWidthFromGirth(row.lowerThigh * legScale, ppc, A.limbAspect),
    ankleHalf: halfWidthFromGirth(row.ankle, ppc, A.limbAspect),
    neckHalf: halfWidthFromGirth(row.neck, ppc, A.neckAspect),
    armHalf,
    headR: A.headHalfWidthCm * ppc,
    headRy: (chin - HEAD_TOP_Y) / 2,
    footLength: (m.footLengthCm ?? 27) * ppc * 0.6,
    family: 'male',
    levels,
    aspects: { bust: v.chestAspect, waist: v.waistAspect, hip: v.hipAspect },
    deltoidHalf,
    armX,
    armDrift: Math.max(bustHalf * 0.22 + 6, hipHalf + wristHalf + 3 - armX),
    wristHalf,
    calfHalf: halfWidthFromGirth(row.calf * legScale, ppc, A.limbAspect),
    maleShape: 'v2',
    legX: v.legX * hipHalf,
    v2: {
      underbustHalf: waistHalf + v.underbustShare * (bustHalf - waistHalf),
      armpitHalf: v.lats * bustHalf,
      armpitY: atLevel(v.axillaLevel),
      neckY: shoulderY - v.neckAboveShoulder * span,
      shoulderRingHalf: v.shoulderRing * (shoulder / 2) * ppc,
      trapezius: v.trapezius,
      thighRingY: atLevel(v.thighLevel),
    },
  };
}

/** Right half of a symmetric outline → closed path (mirrored on x = 100). */
export function mirroredPath(points: { x: number; y: number }[], smooth = true): string {
  if (points.length === 0) return '';
  const right = points.map((p) => ({ x: CENTER_X + p.x, y: p.y }));
  const left = [...points].reverse().map((p) => ({ x: CENTER_X - p.x, y: p.y }));
  const all = [...right, ...left];
  if (!smooth) return `M ${all.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} Z`;
  // Catmull-Rom → cubic Bézier for a soft outline
  const n = all.length;
  let d = `M ${all[0]!.x.toFixed(1)},${all[0]!.y.toFixed(1)}`;
  for (let i = 0; i < n; i++) {
    const p0 = all[(i - 1 + n) % n]!;
    const p1 = all[i]!;
    const p2 = all[(i + 1) % n]!;
    const p3 = all[(i + 2) % n]!;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

/** Torso + legs as separate subpaths (no self-intersection at the crotch; audit 'crotch vertex'). */
export function bodyPath(g: BodyGeometry): string {
  if (g.family === 'male') return g.v2 ? maleV2BodyPath(g, g.v2) : maleBodyPath(g);
  const torso = mirroredPath([
    { x: g.neckHalf, y: levelY('chin') + 2 },
    { x: g.neckHalf + 1, y: levelY('shoulder') - 6 },
    { x: g.shoulderHalf, y: levelY('shoulder') },
    { x: g.bustHalf + 2, y: levelY('bust') },
    { x: g.waistHalf, y: levelY('waist') },
    { x: g.hipHalf, y: levelY('hip') },
    { x: g.hipHalf - 2, y: levelY('crotch') + 6 },
    { x: 1, y: levelY('crotch') + 10 },
  ]);
  const legX = (half: number): number => Math.max(4, half);
  const leg = (side: 1 | -1): string => {
    const cx = CENTER_X + side * (g.hipHalf * 0.5);
    const pts = [
      { x: legX(g.thighHalf), y: levelY('crotch') + 4 },
      { x: legX(g.thighHalf * 0.95), y: levelY('thigh') },
      { x: legX(g.kneeHalf), y: levelY('knee') },
      { x: legX(g.kneeHalf * 0.95), y: levelY('calf') },
      { x: legX(g.ankleHalf), y: levelY('ankle') },
      { x: legX(g.ankleHalf + 2), y: FEET_Y },
    ];
    const r = pts.map((p) => `${(cx + p.x).toFixed(1)},${p.y.toFixed(1)}`);
    const l = [...pts].reverse().map((p) => `${(cx - p.x).toFixed(1)},${p.y.toFixed(1)}`);
    return `M ${[...r, ...l].join(' L ')} Z`;
  };
  const arm = (side: 1 | -1): string => {
    const sx = CENTER_X + side * (g.shoulderHalf - 2);
    const top = levelY('shoulder') + 2;
    const wrist = levelY('hip') + 12;
    const w = g.armHalf;
    const drift = side * (g.bustHalf * 0.22 + 6);
    return `M ${sx - side * w},${top} L ${sx + side * w},${top + 4} L ${sx + drift + side * (w - 1)},${wrist} L ${sx + drift - side * (w - 1)},${wrist} Z`;
  };
  const head = `M ${CENTER_X},${HEAD_TOP_Y} a ${g.headR.toFixed(1)},${g.headRy.toFixed(1)} 0 1,0 0.01,0 Z`;
  return [head, torso, leg(1), leg(-1), arm(1), arm(-1)].join(' ');
}

/**
 * The male outline: a thicker neck, a sloping trapezius to the shoulder point, a rounded deltoid,
 * then one straight line from the armpit over the chest and waist to the seat (no bust, little
 * waist), legs with a calf, and arms that hang from the deltoids, taper to the wrist and clear the
 * seat. Same subpaths as the female figure: head, torso, two legs, two arms.
 */
function maleBodyPath(g: BodyGeometry): string {
  const y = (k: LevelKey): number => figureY(g, k);
  const shoulderY = y('shoulder');
  const armpitY = maleArmpitY(g);
  const torso = mirroredPath([
    { x: g.neckHalf, y: y('chin') + 3 },
    { x: g.neckHalf + 0.5, y: shoulderY - 9 },
    { x: g.neckHalf + (g.shoulderHalf - g.neckHalf) * 0.55, y: shoulderY - 4.5 },
    // the shoulder point sits under the deltoid cap (the arm's centre), so no corner shows above it
    { x: Math.min(g.shoulderHalf, g.armX ?? g.shoulderHalf), y: shoulderY },
    { x: g.bustHalf + 1.5, y: armpitY },
    { x: g.bustHalf, y: y('bust') + 4 },
    { x: g.waistHalf, y: y('waist') },
    { x: g.hipHalf, y: y('hip') },
    { x: g.hipHalf - 2, y: y('crotch') + 6 },
    { x: 1, y: y('crotch') + 10 },
  ]);
  const legX = (half: number): number => Math.max(4, half);
  const leg = (side: 1 | -1): string => {
    const cx = CENTER_X + side * (g.hipHalf * 0.5);
    const pts = [
      { x: legX(g.thighHalf), y: y('crotch') + 4 },
      { x: legX(g.thighHalf * 0.95), y: y('thigh') },
      { x: legX(g.kneeHalf), y: y('knee') },
      { x: legX(g.calfHalf ?? g.kneeHalf * 0.95), y: y('calf') },
      { x: legX(g.ankleHalf), y: y('ankle') },
      { x: legX(g.ankleHalf + 2), y: FEET_Y },
    ];
    const r = pts.map((p) => `${(cx + p.x).toFixed(1)},${p.y.toFixed(1)}`);
    const l = [...pts].reverse().map((p) => `${(cx - p.x).toFixed(1)},${p.y.toFixed(1)}`);
    return `M ${[...r, ...l].join(' L ')} Z`;
  };
  const arm = (side: 1 | -1): string => maleArmOutline(g, side, 0, y('hip') + 12);
  const head = `M ${CENTER_X},${HEAD_TOP_Y} a ${g.headR.toFixed(1)},${g.headRy.toFixed(1)} 0 1,0 0.01,0 Z`;
  return [head, torso, leg(1), leg(-1), arm(1), arm(-1)].join(' ');
}

/**
 * The male figure v2 (`maleV2BodyGeometry`): the neck to the neck ring, a straight trapezius slope
 * to the shoulder point under the deltoid, the lats at the armpit, then the chest, underbust, waist
 * and the narrower v2 seat, falling straight to the thighs. The legs sit in under the seat and
 * touch below the crotch, so their top edges meet in the middle as one crotch line (a shallow V
 * from the hip down to the crotch). Same subpaths as v1: head, torso, two legs, two arms.
 */
function maleV2BodyPath(g: BodyGeometry, v: NonNullable<BodyGeometry['v2']>): string {
  const y = (k: LevelKey): number => figureY(g, k);
  const shoulderY = y('shoulder');
  const rise = shoulderY - v.neckY;
  const trap = (t: number, k: number): { x: number; y: number } => ({ x: g.neckHalf + k * (v.shoulderRingHalf - g.neckHalf), y: shoulderY - t * rise });
  const legX = g.legX ?? g.hipHalf * 0.5;
  const topHalf = g.thighHalf * 0.97;
  const crotchY = y('crotch');
  const torso = mirroredPath([
    { x: g.neckHalf, y: y('chin') + 3 },
    { x: g.neckHalf, y: v.neckY },
    trap(0.75, v.trapezius[1]),
    trap(0.5, v.trapezius[0]),
    // the shoulder point sits under the deltoid cap (the arm's centre), so no corner shows above it
    { x: Math.min(v.shoulderRingHalf, g.armX ?? v.shoulderRingHalf), y: shoulderY },
    { x: v.armpitHalf, y: v.armpitY },
    { x: g.bustHalf, y: y('bust') },
    { x: v.underbustHalf, y: y('underbust') },
    { x: g.waistHalf, y: y('waist') },
    { x: g.hipHalf, y: y('hip') },
    // under the legs from here: the seat falls straight to the thigh tops
    { x: legX + topHalf - 0.5, y: crotchY + 5 },
    { x: 1, y: crotchY + 10 },
  ]);
  // the thighs touch: an inner edge never crosses the middle (0.4 px off it, so the two strokes meet)
  const inner = (half: number): number => Math.max(0.4, legX - Math.max(4, half));
  const leg = (side: 1 | -1): string => {
    const halves: { h: number; y: number }[] = [
      { h: topHalf, y: crotchY + 4 },
      { h: g.thighHalf, y: v.thighRingY },
      { h: g.thighHalf * 0.95, y: y('thigh') },
      { h: g.kneeHalf, y: y('knee') },
      { h: g.calfHalf ?? g.kneeHalf * 0.95, y: y('calf') },
      { h: g.ankleHalf, y: y('ankle') },
      { h: g.ankleHalf + 2, y: FEET_Y },
    ];
    // the outer edge starts on the seat's side, so the leg's top edge runs from the hip down to the crotch
    const top = { x: legX + topHalf, y: y('hip') + 0.4 * (crotchY - y('hip')) };
    const outer = [top, ...halves.map((p) => ({ x: legX + Math.max(4, p.h), y: p.y }))];
    const innerPts = [...halves].reverse().map((p) => ({ x: inner(p.h), y: p.y }));
    const pts = [...outer, ...innerPts];
    return `M ${pts.map((p) => `${(CENTER_X + side * p.x).toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} Z`;
  };
  const arm = (side: 1 | -1): string => maleArmOutline(g, side, 0, y('hip') + 12);
  const head = `M ${CENTER_X},${HEAD_TOP_Y} a ${g.headR.toFixed(1)},${g.headRy.toFixed(1)} 0 1,0 0.01,0 Z`;
  return [head, torso, leg(1), leg(-1), arm(1), arm(-1)].join(' ');
}

/** Where the male arm leaves the torso: a little over half-way from the shoulder line to the chest line (v2: the axilla). */
function maleArmpitY(g: BodyGeometry): number {
  if (g.v2) return g.v2.armpitY;
  const shoulderY = figureY(g, 'shoulder');
  return shoulderY + (figureY(g, 'bust') - shoulderY) * 0.55 + 4;
}

/**
 * The male arm from the deltoid down to `endY` (the wrist, or a sleeve's hem): a round cap over
 * the deltoid (its outer edge at the breadth over the deltoids), tapering past the elbow to the
 * wrist, its inner edge back up to the armpit. `grow` widens it all round (a sleeve over the arm)
 * and `outX` moves it out (shoulder slack of a garment). Points are joined by straight lines
 * except the cap, which is an arc of eight segments.
 */
export function maleArmOutline(g: BodyGeometry, side: 1 | -1, grow: number, endY: number, outX = 0): string {
  const shoulderY = figureY(g, 'shoulder');
  const ax = (g.armX ?? g.shoulderHalf - 2) + outX;
  const r = g.armHalf + grow;
  const drift = g.armDrift ?? g.bustHalf * 0.22 + 6;
  const wristY = figureY(g, 'hip') + 12;
  const elbowY = figureY(g, 'waist');
  const along = (yy: number): number => Math.max(0, Math.min(1, (yy - shoulderY) / (wristY - shoulderY)));
  const wrist = (g.wristHalf ?? g.armHalf * 0.6) + grow;
  // half-width of the arm at a height: the deltoid's radius at the top, 0.82 of it at the elbow, the wrist at the wrist
  const halfAt = (yy: number): number => {
    const tE = along(elbowY);
    const t = along(yy);
    return t <= tE ? r + (r * 0.82 - r) * (t / tE) : r * 0.82 + (wrist - r * 0.82) * ((t - tE) / (1 - tE));
  };
  const cy = shoulderY + r * 0.9 - grow * 0.6;
  const cap: { x: number; y: number }[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (Math.PI * i) / 8; // inner (180°) over the top (270°) to the outer side (360°)
    cap.push({ x: ax + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  const end = Math.min(endY, wristY);
  const mids = end > elbowY ? [elbowY, end] : [end];
  const outer = mids.map((yy) => ({ x: ax + drift * along(yy) + halfAt(yy), y: yy }));
  const inner = [...mids].reverse().map((yy) => ({ x: ax + drift * along(yy) - halfAt(yy), y: yy }));
  const armpit = { x: Math.min((g.v2 ? g.v2.armpitHalf : g.bustHalf + 1.5) + grow, ax + drift * along(maleArmpitY(g)) - halfAt(maleArmpitY(g))), y: maleArmpitY(g) + grow * 0.5 };
  const pts = [...cap, ...outer, ...inner, ...(end > armpit.y + 4 ? [armpit] : [])];
  // Mirroring flips the winding; the left arm is reversed so both arms wind like the torso and
  // their overlap stays filled under the nonzero rule (a mirrored arm cut a hole at the shoulder).
  if (side === -1) pts.reverse();
  return `M ${pts.map((p) => `${(CENTER_X + side * p.x).toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} Z`;
}

// ---------------------------------------------------------------------------
// Garment outlines
// ---------------------------------------------------------------------------

export interface GarmentGeometry {
  path: string;
  /** Secondary paths (sleeves, second shoe, strap) drawn with the same fill. */
  extra: string[];
  /** Fold / strain lines: 'strain' at negative slack, 'fold' at loose points. */
  strain: { x: number; y: number; intensity: number }[];
  folds: { x1: number; y1: number; x2: number; y2: number }[];
  hemY: number;
  /** Max negative slack (cm) across used points — drives the pull highlight. */
  tightestCm: number;
  loosestCm: number;
  /** Garment half-widths (px) at the body levels — what makes S / M / L read differently. */
  widths: { shoulderHalf: number; bustHalf: number; waistHalf: number; hipHalf: number; thighHalf: number };
}

/**
 * Slack (garment − body, cm of girth) → garment half-width in px at that level. Positive slack
 * widens the outline by the same ellipse rule as the body; negative slack cannot shrink the body,
 * so the garment clings to the body outline and the strain creases show the pull.
 */
function widthFromSlack(bodyHalf: number, slackCm: number | undefined, ppc: number, defaultEase = 4): number {
  const slack = slackCm ?? defaultEase;
  if (slack <= 0) return bodyHalf;
  return bodyHalf + halfWidthFromGirth(slack, ppc, 0.7);
}

function slackAt(gaps: RenderGaps | null, point: FitPoint): number | undefined {
  return gaps?.slackCm[point];
}

function hemFromLength(lengthCm: GarmentPayload['lengthCm'], key: string, fromY: number, ppc: number, fallbackY: number): number {
  const v = lengthCm?.[key];
  if (v && v > 0) return Math.min(FEET_Y + 6, fromY + v * ppc);
  return fallbackY;
}

/** A bottom that is a skirt (one tube from the waist), by subcategory or block. */
export function isSkirt(garment: Pick<GarmentPayload, 'category' | 'patternBlock'> & Partial<Pick<GarmentPayload, 'subcategory'>>): boolean {
  return garment.category === 'bottom' && /skirt/.test(`${garment.subcategory ?? ''} ${garment.patternBlock}`);
}

export interface GarmentRenderInput {
  garment: Pick<GarmentPayload, 'category' | 'patternBlock' | 'lengthCm' | 'fabric'> & Partial<Pick<GarmentPayload, 'subcategory'>>;
  gaps: RenderGaps | null;
  /**
   * Hem sweep of a skirt for this size, cm (ring input, assumed or measured). When given, the
   * skirt's hem is drawn at that girth, the same rule as the hem ring, so the two agree.
   */
  hemSweepCm?: number | null;
  body: BodyGeometry;
}

export function garmentGeometry({ garment, gaps, body: g, hemSweepCm = null }: GarmentRenderInput): GarmentGeometry {
  const drape = garment.fabric.drape;
  const strain: GarmentGeometry['strain'] = [];
  const folds: GarmentGeometry['folds'] = [];
  const used = gaps ? Object.values(gaps.slackCm).filter((v): v is number => typeof v === 'number') : [];
  const tightestCm = used.length ? Math.min(...used) : 0;
  const loosestCm = used.length ? Math.max(...used) : 0;

  const bustSlack = slackAt(gaps, 'bust');
  const waistSlack = slackAt(gaps, 'waist');
  const hipSlack = slackAt(gaps, 'hip');
  const thighSlack = slackAt(gaps, 'thigh');
  const shoulderSlack = slackAt(gaps, 'shoulder');

  const ppc = g.pxPerCm;
  // the female figure's bust stands 2 px proud of the ribcage line; the male chest does not
  const bustHalf = widthFromSlack(g.bustHalf + (g.family === 'male' ? 0 : 2), bustSlack, ppc);
  const waistHalf = widthFromSlack(g.waistHalf, waistSlack, ppc, 3);
  const hipHalf = widthFromSlack(g.hipHalf, hipSlack, ppc, 5);
  const thighHalf = widthFromSlack(g.thighHalf, thighSlack, ppc, 3);
  // shoulder slack is a width, not a girth: half of it per side
  const shoulderHalf = g.shoulderHalf + Math.max(0, shoulderSlack ?? 1) * 0.5 * ppc;

  const addStrain = (point: FitPoint, slack: number | undefined, x: number, y: number): void => {
    if (slack !== undefined && slack < 0) strain.push({ x, y, intensity: Math.min(1, -slack / 6) });
    void point;
  };
  addStrain('bust', bustSlack, CENTER_X, figureY(g, 'bust'));
  addStrain('waist', waistSlack, CENTER_X, figureY(g, 'waist'));
  addStrain('hip', hipSlack, CENTER_X, figureY(g, 'hip'));
  addStrain('thigh', thighSlack, CENTER_X, figureY(g, 'thigh'));

  const addFolds = (slack: number | undefined, yTop: number, yBottom: number, half: number): void => {
    const extra = slack !== undefined ? slack - 6 : 0;
    if (extra <= 0) return;
    const n = Math.min(4, Math.round(extra / 3));
    for (let i = 1; i <= n; i++) {
      const x = CENTER_X - half + (half * 2 * i) / (n + 1);
      const sway = (i % 2 === 0 ? 1 : -1) * (2 + drape * 5);
      folds.push({ x1: x, y1: yTop, x2: x + sway, y2: yBottom });
    }
  };

  const shoulderY = figureY(g, 'shoulder');
  const sag = 4 + drape * 10;
  let path = '';
  const extra: string[] = [];
  let hemY = figureY(g, 'knee');

  const sleeve = (side: 1 | -1, length: number, width: number): string => {
    // a male sleeve is the male arm's own outline, grown by the sleeve's ease and cut at its length
    if (g.family === 'male') return maleArmOutline(g, side, width - g.armHalf, shoulderY + 1 + length, shoulderHalf - g.shoulderHalf);
    const sx = CENTER_X + side * (shoulderHalf - 1);
    const top = shoulderY + 1;
    const end = top + length;
    const drift = side * (g.armDrift ?? g.bustHalf * 0.22 + 6) * (length / (figureY(g, 'hip') + 12 - top));
    return `M ${sx - side * width},${top} L ${sx + side * width},${top + 3} L ${sx + drift + side * width},${end} L ${sx + drift - side * width},${end} Z`;
  };

  switch (garment.category) {
    case 'dress': {
      hemY = hemFromLength(garment.lengthCm, 'shoulder_to_hem', shoulderY, g.pxPerCm, figureY(g, 'knee') + 20);
      const flare = /a-line|skater|fit-and-flare|tent|trapeze|wrap/.test(garment.patternBlock) ? 10 + drape * 8 : 2 + drape * 4;
      const hemHalf = Math.max(hipHalf + flare, waistHalf + 6);
      path = mirroredPath([
        { x: g.neckHalf + 6, y: shoulderY - 2 },
        { x: shoulderHalf, y: shoulderY + 1 },
        { x: bustHalf, y: figureY(g, 'bust') },
        { x: waistHalf, y: figureY(g, 'waist') },
        { x: hipHalf, y: figureY(g, 'hip') },
        { x: hemHalf, y: hemY - sag },
        { x: hemHalf * 0.5, y: hemY + sag * 0.6 },
        { x: 0, y: hemY },
      ]);
      const sl = garment.lengthCm?.sleeve_length;
      if (sl && sl > 0) extra.push(sleeve(1, sl * g.pxPerCm, g.armHalf + 2), sleeve(-1, sl * g.pxPerCm, g.armHalf + 2));
      addFolds(hipSlack, figureY(g, 'hip') + 10, hemY - 8, hemHalf * 0.8);
      break;
    }
    case 'top': {
      hemY = hemFromLength(garment.lengthCm, 'shoulder_to_hem', shoulderY, g.pxPerCm, figureY(g, 'hip') - 4);
      const hemHalf = hemY > figureY(g, 'hip') - 10 ? hipHalf : waistHalf + 4;
      const strappy = /slip|bias|cami/.test(garment.patternBlock);
      path = mirroredPath([
        { x: strappy ? g.neckHalf + 10 : g.neckHalf + 5, y: strappy ? shoulderY + 10 : shoulderY - 2 },
        { x: strappy ? g.bustHalf - 2 : shoulderHalf, y: strappy ? shoulderY + 12 : shoulderY + 1 },
        { x: bustHalf, y: figureY(g, 'bust') },
        { x: waistHalf, y: figureY(g, 'waist') },
        { x: hemHalf, y: hemY - sag * 0.4 },
        { x: hemHalf * 0.5, y: hemY + sag * 0.3 },
        { x: 0, y: hemY },
      ]);
      if (strappy) {
        extra.push(`M ${CENTER_X - g.bustHalf + 4},${shoulderY + 12} L ${CENTER_X - g.neckHalf - 2},${shoulderY - 4} L ${CENTER_X - g.neckHalf},${shoulderY - 4} L ${CENTER_X - g.bustHalf + 7},${shoulderY + 12} Z`);
        extra.push(`M ${CENTER_X + g.bustHalf - 4},${shoulderY + 12} L ${CENTER_X + g.neckHalf + 2},${shoulderY - 4} L ${CENTER_X + g.neckHalf},${shoulderY - 4} L ${CENTER_X + g.bustHalf - 7},${shoulderY + 12} Z`);
      } else {
        const sl = garment.lengthCm?.sleeve_length ?? (/t-shirt|shirt/.test(garment.patternBlock) ? 20 : 12);
        extra.push(sleeve(1, sl * g.pxPerCm, g.armHalf + 2), sleeve(-1, sl * g.pxPerCm, g.armHalf + 2));
      }
      addFolds(waistSlack, figureY(g, 'bust') + 10, hemY - 6, waistHalf);
      break;
    }
    case 'bottom': {
      const waistY = figureY(g, 'waist') + (garment.lengthCm?.rise ? Math.max(-10, 8 - garment.lengthCm.rise * g.pxPerCm * 0.4) : 2);
      if (isSkirt(garment)) {
        // A skirt is one tube from the waist, not two legs (step 3 rings mock: the maxi skirt was drawn as trousers).
        const sub = garment.subcategory ?? '';
        const fallback = /maxi/.test(sub) ? figureY(g, 'ankle') - 4 : /midi/.test(sub) ? figureY(g, 'calf') : /mini/.test(sub) ? figureY(g, 'thigh') + 8 : figureY(g, 'knee') + 6;
        // a skirt's own length key is waist_to_hem (band to hem, flat); outseam is kept for older payloads
        hemY = hemFromLength(garment.lengthCm, garment.lengthCm?.waist_to_hem ? 'waist_to_hem' : 'outseam', waistY, g.pxPerCm, fallback);
        const flared = /a-line|flare|skater|circle|tier|wrap/.test(`${garment.patternBlock} ${sub}`);
        const hemHalf =
          hemSweepCm != null && hemSweepCm > 0
            ? Math.max(hipHalf, Math.min(MAX_RING_RX, halfWidthFromGirth(hemSweepCm, ppc, HEM_DEPTH)))
            : flared ? hipHalf + 10 + drape * 12 : /pencil|bodycon|straight/.test(garment.patternBlock) ? hipHalf - 2 : hipHalf + 4;
        path = mirroredPath([
          { x: waistHalf + 1, y: waistY },
          { x: hipHalf + (flared ? 2 : 0), y: figureY(g, 'hip') },
          { x: hemHalf, y: hemY - sag * 0.5 },
          { x: hemHalf * 0.5, y: hemY + sag * 0.4 },
          { x: 0, y: hemY },
        ]);
        addFolds(hipSlack ?? 8 + drape * 6, figureY(g, 'hip') + 12, hemY - 8, hemHalf * 0.7);
        break;
      }
      const inseam = garment.lengthCm?.inseam;
      const outseam = garment.lengthCm?.outseam;
      hemY = outseam ? hemFromLength(garment.lengthCm, 'outseam', waistY, g.pxPerCm, figureY(g, 'ankle')) : inseam ? Math.min(FEET_Y, figureY(g, 'crotch') + inseam * g.pxPerCm) : figureY(g, 'ankle');
      const wide = /wide-leg|bootcut|flare/.test(garment.patternBlock);
      const skinny = /skinny|slim/.test(garment.patternBlock);
      const legHem = wide ? thighHalf + 8 + drape * 6 : skinny ? g.ankleHalf + 2 : Math.max(g.ankleHalf + 4, thighHalf * 0.8);
      const leg = (side: 1 | -1): string => {
        const cx = CENTER_X + side * (g.legX ?? g.hipHalf * 0.5);
        const outer = [
          { x: thighHalf, y: figureY(g, 'crotch') + 4 },
          { x: thighHalf * 0.97, y: figureY(g, 'thigh') },
          { x: legHem, y: hemY },
        ];
        const inner = [
          { x: -(legHem - 1), y: hemY },
          { x: -(thighHalf * 0.9), y: figureY(g, 'thigh') },
          { x: -(thighHalf - 2), y: figureY(g, 'crotch') + 4 },
        ];
        const pts = [...outer, ...inner].map((p) => `${(cx + side * p.x).toFixed(1)},${p.y.toFixed(1)}`);
        return `M ${pts.join(' L ')} Z`;
      };
      path = mirroredPath(
        [
          { x: waistHalf + 1, y: waistY },
          { x: hipHalf, y: figureY(g, 'hip') },
          { x: hipHalf - 1, y: figureY(g, 'crotch') + 6 },
          { x: 0, y: figureY(g, 'crotch') + 8 },
        ],
        false,
      );
      extra.push(leg(1), leg(-1));
      addFolds(thighSlack, figureY(g, 'thigh'), hemY - 10, thighHalf * 0.6);
      break;
    }
    case 'outerwear': {
      hemY = hemFromLength(garment.lengthCm, 'shoulder_to_hem', shoulderY, g.pxPerCm, figureY(g, 'hip') + 12);
      const jacketBust = bustHalf + 4;
      const jacketHip = Math.max(hipHalf + 2, waistHalf + 8);
      const openGap = 7;
      const panel = (side: 1 | -1): string => {
        const pts = [
          { x: side * (g.neckHalf + 4), y: shoulderY - 3 },
          { x: side * (shoulderHalf + 2), y: shoulderY + 1 },
          { x: side * jacketBust, y: figureY(g, 'bust') },
          { x: side * (waistHalf + 5), y: figureY(g, 'waist') },
          { x: side * jacketHip, y: hemY - sag * 0.3 },
          { x: side * openGap, y: hemY + 2 },
          { x: side * openGap, y: figureY(g, 'bust') - 6 },
        ];
        return `M ${pts.map((p) => `${(CENTER_X + p.x).toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} Z`;
      };
      path = panel(1);
      extra.push(panel(-1));
      const sl = garment.lengthCm?.sleeve_length ?? 58;
      extra.push(sleeve(1, sl * g.pxPerCm, g.armHalf + 4), sleeve(-1, sl * g.pxPerCm, g.armHalf + 4));
      // collar
      extra.push(`M ${CENTER_X - g.neckHalf - 6},${shoulderY - 6} L ${CENTER_X},${shoulderY + 14} L ${CENTER_X + g.neckHalf + 6},${shoulderY - 6} L ${CENTER_X + g.neckHalf + 2},${shoulderY - 10} L ${CENTER_X - g.neckHalf - 2},${shoulderY - 10} Z`);
      addFolds(hipSlack, figureY(g, 'waist'), hemY - 6, jacketHip * 0.7);
      break;
    }
    case 'shoes': {
      const footSlack = slackAt(gaps, 'foot');
      const len = g.footLength + (footSlack ?? 0.7) * g.pxPerCm * 0.6;
      const heel = (garment.lengthCm?.heel_height ?? 0) * g.pxPerCm * 0.6;
      const shoe = (side: 1 | -1): string => {
        const cx = CENTER_X + side * (g.legX ?? g.hipHalf * 0.5);
        const w = g.ankleHalf + 4;
        const top = FEET_Y - 12 - heel;
        return `M ${cx - w},${top} C ${cx - w - 2},${FEET_Y - 4} ${cx - w + 2},${FEET_Y + 2} ${cx - w + len * 0.25},${FEET_Y + 2} L ${cx + w + len * 0.35},${FEET_Y + 2} C ${cx + w + len * 0.5},${FEET_Y - 2} ${cx + w + len * 0.4},${FEET_Y - 8} ${cx + w},${top - 2} Z`;
      };
      path = shoe(1);
      extra.push(shoe(-1));
      hemY = FEET_Y;
      if (footSlack !== undefined && footSlack < 0.2) strain.push({ x: CENTER_X, y: FEET_Y - 6, intensity: Math.min(1, (0.2 - footSlack) / 1.5) });
      break;
    }
    case 'accessory': {
      const kind = accessoryKind(`${garment.subcategory ?? ''} ${garment.patternBlock}`);
      const pt = (x: number, y: number): string => `${x.toFixed(1)},${y.toFixed(1)}`;
      if (kind === 'belt') {
        // A band at the waist. Belt sizes are waist sizes, so the band follows the waist slack.
        const y = figureY(g, 'waist') + 2;
        const half = waistHalf + 1;
        path = `M ${pt(CENTER_X - half, y - 4)} L ${pt(CENTER_X + half, y - 4)} L ${pt(CENTER_X + half, y + 4)} L ${pt(CENTER_X - half, y + 4)} Z`;
        extra.push(`M ${pt(CENTER_X - 6, y - 6)} L ${pt(CENTER_X + 6, y - 6)} L ${pt(CENTER_X + 6, y + 6)} L ${pt(CENTER_X - 6, y + 6)} Z`);
        const tail = Math.max(0, (waistSlack ?? 0) - 2) * g.pxPerCm * 0.5; // a loose belt shows a longer free end
        if (tail > 0) extra.push(`M ${pt(CENTER_X + 6, y - 3)} L ${pt(CENTER_X + 6 + tail, y - 2)} L ${pt(CENTER_X + 6 + tail, y + 2)} L ${pt(CENTER_X + 6, y + 3)} Z`);
        hemY = y + 4;
        break;
      }
      if (kind === 'hat') {
        // A beanie/cap over the crown of the head.
        const top = HEAD_TOP_Y - 4;
        const brim = HEAD_TOP_Y + g.headRy * 0.75;
        const half = g.headR + 3;
        path = `M ${pt(CENTER_X - half, brim)} C ${pt(CENTER_X - half, top)} ${pt(CENTER_X + half, top)} ${pt(CENTER_X + half, brim)} L ${pt(CENTER_X + half, brim + 5)} L ${pt(CENTER_X - half, brim + 5)} Z`;
        hemY = brim + 5;
        break;
      }
      if (kind === 'scarf') {
        // Wrapped at the neck with two tails over the chest; longer scarves hang lower.
        const neckY = figureY(g, 'shoulder') - 6;
        const tailLen = Math.min(figureY(g, 'waist') + 10 - neckY, Math.max(30, (garment.lengthCm?.total_length ?? 90) * g.pxPerCm * 0.3));
        const half = g.neckHalf + 5;
        path = `M ${pt(CENTER_X - half, neckY - 4)} L ${pt(CENTER_X + half, neckY - 4)} L ${pt(CENTER_X + half + 2, neckY + 6)} L ${pt(CENTER_X - half - 2, neckY + 6)} Z`;
        extra.push(`M ${pt(CENTER_X - 10, neckY + 4)} L ${pt(CENTER_X - 1, neckY + 4)} L ${pt(CENTER_X - 3, neckY + tailLen)} L ${pt(CENTER_X - 12, neckY + tailLen - 2)} Z`);
        extra.push(`M ${pt(CENTER_X + 1, neckY + 4)} L ${pt(CENTER_X + 9, neckY + 4)} L ${pt(CENTER_X + 12, neckY + tailLen * 0.85)} L ${pt(CENTER_X + 3, neckY + tailLen * 0.85 + 2)} Z`);
        hemY = neckY + tailLen;
        break;
      }
      if (kind === 'socks') {
        const top = figureY(g, 'calf') + 8;
        const sock = (side: 1 | -1): string => {
          const cx = CENTER_X + side * (g.legX ?? g.hipHalf * 0.5);
          const w = g.ankleHalf + 2;
          return `M ${pt(cx - w, top)} L ${pt(cx + w, top)} L ${pt(cx + w, FEET_Y)} L ${pt(cx - w, FEET_Y)} Z`;
        };
        path = sock(1);
        extra.push(sock(-1));
        hemY = FEET_Y;
        break;
      }
      // A bag at the hip — size from the garment's own length when given.
      const w = Math.max(14, (garment.lengthCm?.chest_width ?? 30) * g.pxPerCm * 0.5);
      const h = w * 0.8;
      const x = CENTER_X + g.hipHalf + 10;
      const y = figureY(g, 'hip') - 6;
      path = `M ${x},${y} h ${w} a 4,4 0 0 1 4,4 v ${h} a 4,4 0 0 1 -4,4 h ${-w} a 4,4 0 0 1 -4,-4 v ${-h} a 4,4 0 0 1 4,-4 Z`;
      extra.push(`M ${x + w * 0.3},${y} C ${x + w * 0.3},${shoulderY + 6} ${x + w * 0.7},${shoulderY + 6} ${x + w * 0.7},${y} l -3,0 C ${x + w * 0.7 - 3},${shoulderY + 12} ${x + w * 0.3 + 3},${shoulderY + 12} ${x + w * 0.3 + 3},${y} Z`);
      hemY = y + h;
      break;
    }
  }

  return { path, extra, strain, folds, hemY, tightestCm, loosestCm, widths: { shoulderHalf, bustHalf, waistHalf, hipHalf, thighHalf } };
}

// ---------------------------------------------------------------------------
// Fabric look (handoff §9 fabric test: linen vs wool vs silk must read differently)
// ---------------------------------------------------------------------------

export interface FabricLook {
  /** feTurbulence baseFrequency along x: light and fine fibres are finer. */
  baseFrequency: number;
  /** y/x frequency ratio of the weave texture: < 1 horizontal slubs (linen), > 1 vertical wales (knit). */
  grain: number;
  numOctaves: number;
  /** Specular highlight strength 0..1 (sheen). */
  specular: number;
  /** Fill opacity (sheer fabrics show the body). */
  opacity: number;
  /** Surface relief for the lighting filter. */
  surfaceScale: number;
  /** Softness of the outline (fluid fabrics have softer edges). */
  blur: number;
  label: string;
}

/**
 * Per-fibre surface character, so the fibre alone changes the look even when a merchant sends the
 * same weight and drape for linen and wool (handoff §9 fabric test). `freq` scales the texture
 * frequency, `grain` is its y/x ratio, `relief` adds to the lighting surface scale.
 */
const FIBRE: Record<string, { freq: number; grain: number; relief: number }> = {
  linen: { freq: 1, grain: 0.3, relief: 0.5 }, // slubby, crisp, creases
  wool: { freq: 0.75, grain: 1, relief: 0.9 }, // fuzzy, matte
  cashmere: { freq: 0.85, grain: 1, relief: 0.5 },
  silk: { freq: 1.25, grain: 1, relief: -0.35 }, // smooth, fine
  viscose: { freq: 1.15, grain: 1, relief: -0.2 },
  modal: { freq: 1.15, grain: 1.1, relief: -0.2 },
  tencel: { freq: 1.15, grain: 1, relief: -0.25 },
  denim: { freq: 0.9, grain: 0.55, relief: 0.6 }, // twill ridges
  cotton: { freq: 1, grain: 0.8, relief: 0.2 },
  leather: { freq: 0.55, grain: 1, relief: 0.3 },
  knit: { freq: 0.9, grain: 2.2, relief: 0.7 }, // vertical wales
  jersey: { freq: 1.1, grain: 1.8, relief: 0.1 },
  technical: { freq: 1.2, grain: 1, relief: -0.25 },
  nylon: { freq: 1.2, grain: 1, relief: -0.3 },
  polyester: { freq: 1.15, grain: 1, relief: -0.2 },
};
const ANY_FIBRE = { freq: 1, grain: 1, relief: 0 };

export function fabricLook(fabric: GarmentPayload['fabric']): FabricLook {
  const weight = fabric.weightGsm ?? 200;
  const w = Math.max(0, Math.min(1, (weight - 80) / 420)); // 0 = featherlight, 1 = heavy
  const sheen = fabric.sheen ?? defaultSheen(fabric.primary);
  const opacity = fabric.opacity ?? (weight < 110 ? 0.82 : 1);
  const fibre = FIBRE[fabric.primary] ?? ANY_FIBRE;
  return {
    baseFrequency: Math.round((0.95 - w * 0.55) * fibre.freq * 100) / 100,
    grain: fibre.grain,
    numOctaves: w > 0.6 ? 3 : 4,
    specular: sheen,
    opacity: Math.max(0.55, Math.min(1, opacity)),
    surfaceScale: Math.max(0.25, 0.6 + w * 2.2 + fibre.relief),
    blur: fabric.drape * 0.35,
    label: `${fabric.primary} · ${weight} gsm${fabric.stretchPct ? ` · ${fabric.stretchPct}% stretch` : ''}`,
  };
}

export type AccessoryKind = 'bag' | 'belt' | 'hat' | 'scarf' | 'socks';

/** Which accessory outline to draw, from the subcategory / pattern block words. Unknown → bag. */
export function accessoryKind(words: string): AccessoryKind {
  const w = words.toLowerCase();
  if (/\bbelt/.test(w)) return 'belt';
  if (/\b(hat|beanie|cap|beret|bucket|fedora)/.test(w)) return 'hat';
  if (/\b(scarf|shawl|stole|snood)/.test(w)) return 'scarf';
  if (/\bsocks?\b|\btights\b/.test(w)) return 'socks';
  return 'bag';
}

function defaultSheen(primary: string): number {
  switch (primary) {
    case 'silk':
      return 0.8;
    case 'leather':
      return 0.6;
    case 'technical':
    case 'nylon':
    case 'polyester':
      return 0.45;
    case 'denim':
      return 0.12;
    case 'wool':
    case 'cashmere':
    case 'linen':
      return 0.05;
    default:
      return 0.2;
  }
}

/** #RGB / #RRGGBB → lightened/darkened hex; invalid input falls back to `fallback`. */
export function adjustColor(hex: string | null | undefined, amt: number, fallback = '#DFC3A8'): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? '').trim());
  const raw = m ? m[1]! : fallback.slice(1);
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const n = parseInt(full, 16);
  const clamp = (v: number): number => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function isHex(hex: string | null | undefined): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test((hex ?? '').trim());
}
