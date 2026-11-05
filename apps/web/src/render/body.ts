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
import type { FitPoint, GarmentPayload, UserBody } from '@paskamer/schema';
import type { RenderGaps } from '@paskamer/fit-engine';

export const VIEW_W = 200;
export const VIEW_H = 500;
export const HEAD_TOP_Y = 20;
export const FEET_Y = 480;
export const CENTER_X = 100;

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
}

export const REFERENCE_BODY: Required<Pick<UserBody['measurements'], 'bust' | 'waist' | 'hip' | 'shoulder' | 'thigh'>> & { height: number } = {
  bust: 88,
  waist: 70,
  hip: 96,
  shoulder: 38,
  thigh: 56,
  height: 168,
};

export function bodyGeometry(measurements: UserBody['measurements'] | null | undefined, heightCm?: number): BodyGeometry {
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

export interface GarmentRenderInput {
  garment: Pick<GarmentPayload, 'category' | 'patternBlock' | 'lengthCm' | 'fabric'> & Partial<Pick<GarmentPayload, 'subcategory'>>;
  gaps: RenderGaps | null;
  body: BodyGeometry;
}

export function garmentGeometry({ garment, gaps, body: g }: GarmentRenderInput): GarmentGeometry {
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
  const bustHalf = widthFromSlack(g.bustHalf + 2, bustSlack, ppc);
  const waistHalf = widthFromSlack(g.waistHalf, waistSlack, ppc, 3);
  const hipHalf = widthFromSlack(g.hipHalf, hipSlack, ppc, 5);
  const thighHalf = widthFromSlack(g.thighHalf, thighSlack, ppc, 3);
  // shoulder slack is a width, not a girth: half of it per side
  const shoulderHalf = g.shoulderHalf + Math.max(0, shoulderSlack ?? 1) * 0.5 * ppc;

  const addStrain = (point: FitPoint, slack: number | undefined, x: number, y: number): void => {
    if (slack !== undefined && slack < 0) strain.push({ x, y, intensity: Math.min(1, -slack / 6) });
    void point;
  };
  addStrain('bust', bustSlack, CENTER_X, levelY('bust'));
  addStrain('waist', waistSlack, CENTER_X, levelY('waist'));
  addStrain('hip', hipSlack, CENTER_X, levelY('hip'));
  addStrain('thigh', thighSlack, CENTER_X, levelY('thigh'));

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

  const shoulderY = levelY('shoulder');
  const sag = 4 + drape * 10;
  let path = '';
  const extra: string[] = [];
  let hemY = levelY('knee');

  const sleeve = (side: 1 | -1, length: number, width: number): string => {
    const sx = CENTER_X + side * (shoulderHalf - 1);
    const top = shoulderY + 1;
    const end = top + length;
    const drift = side * (g.bustHalf * 0.22 + 6) * (length / (levelY('hip') + 12 - top));
    return `M ${sx - side * width},${top} L ${sx + side * width},${top + 3} L ${sx + drift + side * width},${end} L ${sx + drift - side * width},${end} Z`;
  };

  switch (garment.category) {
    case 'dress': {
      hemY = hemFromLength(garment.lengthCm, 'shoulder_to_hem', shoulderY, g.pxPerCm, levelY('knee') + 20);
      const flare = /a-line|skater|fit-and-flare|tent|trapeze|wrap/.test(garment.patternBlock) ? 10 + drape * 8 : 2 + drape * 4;
      const hemHalf = Math.max(hipHalf + flare, waistHalf + 6);
      path = mirroredPath([
        { x: g.neckHalf + 6, y: shoulderY - 2 },
        { x: shoulderHalf, y: shoulderY + 1 },
        { x: bustHalf, y: levelY('bust') },
        { x: waistHalf, y: levelY('waist') },
        { x: hipHalf, y: levelY('hip') },
        { x: hemHalf, y: hemY - sag },
        { x: hemHalf * 0.5, y: hemY + sag * 0.6 },
        { x: 0, y: hemY },
      ]);
      const sl = garment.lengthCm?.sleeve_length;
      if (sl && sl > 0) extra.push(sleeve(1, sl * g.pxPerCm, g.armHalf + 2), sleeve(-1, sl * g.pxPerCm, g.armHalf + 2));
      addFolds(hipSlack, levelY('hip') + 10, hemY - 8, hemHalf * 0.8);
      break;
    }
    case 'top': {
      hemY = hemFromLength(garment.lengthCm, 'shoulder_to_hem', shoulderY, g.pxPerCm, levelY('hip') - 4);
      const hemHalf = hemY > levelY('hip') - 10 ? hipHalf : waistHalf + 4;
      const strappy = /slip|bias|cami/.test(garment.patternBlock);
      path = mirroredPath([
        { x: strappy ? g.neckHalf + 10 : g.neckHalf + 5, y: strappy ? shoulderY + 10 : shoulderY - 2 },
        { x: strappy ? g.bustHalf - 2 : shoulderHalf, y: strappy ? shoulderY + 12 : shoulderY + 1 },
        { x: bustHalf, y: levelY('bust') },
        { x: waistHalf, y: levelY('waist') },
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
      addFolds(waistSlack, levelY('bust') + 10, hemY - 6, waistHalf);
      break;
    }
    case 'bottom': {
      const waistY = levelY('waist') + (garment.lengthCm?.rise ? Math.max(-10, 8 - garment.lengthCm.rise * g.pxPerCm * 0.4) : 2);
      const inseam = garment.lengthCm?.inseam;
      const outseam = garment.lengthCm?.outseam;
      hemY = outseam ? hemFromLength(garment.lengthCm, 'outseam', waistY, g.pxPerCm, levelY('ankle')) : inseam ? Math.min(FEET_Y, levelY('crotch') + inseam * g.pxPerCm) : levelY('ankle');
      const wide = /wide-leg|bootcut|flare/.test(garment.patternBlock);
      const skinny = /skinny|slim/.test(garment.patternBlock);
      const legHem = wide ? thighHalf + 8 + drape * 6 : skinny ? g.ankleHalf + 2 : Math.max(g.ankleHalf + 4, thighHalf * 0.8);
      const leg = (side: 1 | -1): string => {
        const cx = CENTER_X + side * (g.hipHalf * 0.5);
        const outer = [
          { x: thighHalf, y: levelY('crotch') + 4 },
          { x: thighHalf * 0.97, y: levelY('thigh') },
          { x: legHem, y: hemY },
        ];
        const inner = [
          { x: -(legHem - 1), y: hemY },
          { x: -(thighHalf * 0.9), y: levelY('thigh') },
          { x: -(thighHalf - 2), y: levelY('crotch') + 4 },
        ];
        const pts = [...outer, ...inner].map((p) => `${(cx + side * p.x).toFixed(1)},${p.y.toFixed(1)}`);
        return `M ${pts.join(' L ')} Z`;
      };
      path = mirroredPath(
        [
          { x: waistHalf + 1, y: waistY },
          { x: hipHalf, y: levelY('hip') },
          { x: hipHalf - 1, y: levelY('crotch') + 6 },
          { x: 0, y: levelY('crotch') + 8 },
        ],
        false,
      );
      extra.push(leg(1), leg(-1));
      addFolds(thighSlack, levelY('thigh'), hemY - 10, thighHalf * 0.6);
      break;
    }
    case 'outerwear': {
      hemY = hemFromLength(garment.lengthCm, 'shoulder_to_hem', shoulderY, g.pxPerCm, levelY('hip') + 12);
      const jacketBust = bustHalf + 4;
      const jacketHip = Math.max(hipHalf + 2, waistHalf + 8);
      const openGap = 7;
      const panel = (side: 1 | -1): string => {
        const pts = [
          { x: side * (g.neckHalf + 4), y: shoulderY - 3 },
          { x: side * (shoulderHalf + 2), y: shoulderY + 1 },
          { x: side * jacketBust, y: levelY('bust') },
          { x: side * (waistHalf + 5), y: levelY('waist') },
          { x: side * jacketHip, y: hemY - sag * 0.3 },
          { x: side * openGap, y: hemY + 2 },
          { x: side * openGap, y: levelY('bust') - 6 },
        ];
        return `M ${pts.map((p) => `${(CENTER_X + p.x).toFixed(1)},${p.y.toFixed(1)}`).join(' L ')} Z`;
      };
      path = panel(1);
      extra.push(panel(-1));
      const sl = garment.lengthCm?.sleeve_length ?? 58;
      extra.push(sleeve(1, sl * g.pxPerCm, g.armHalf + 4), sleeve(-1, sl * g.pxPerCm, g.armHalf + 4));
      // collar
      extra.push(`M ${CENTER_X - g.neckHalf - 6},${shoulderY - 6} L ${CENTER_X},${shoulderY + 14} L ${CENTER_X + g.neckHalf + 6},${shoulderY - 6} L ${CENTER_X + g.neckHalf + 2},${shoulderY - 10} L ${CENTER_X - g.neckHalf - 2},${shoulderY - 10} Z`);
      addFolds(hipSlack, levelY('waist'), hemY - 6, jacketHip * 0.7);
      break;
    }
    case 'shoes': {
      const footSlack = slackAt(gaps, 'foot');
      const len = g.footLength + (footSlack ?? 0.7) * g.pxPerCm * 0.6;
      const heel = (garment.lengthCm?.heel_height ?? 0) * g.pxPerCm * 0.6;
      const shoe = (side: 1 | -1): string => {
        const cx = CENTER_X + side * (g.hipHalf * 0.5);
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
        const y = levelY('waist') + 2;
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
        const neckY = levelY('shoulder') - 6;
        const tailLen = Math.min(levelY('waist') + 10 - neckY, Math.max(30, (garment.lengthCm?.total_length ?? 90) * g.pxPerCm * 0.3));
        const half = g.neckHalf + 5;
        path = `M ${pt(CENTER_X - half, neckY - 4)} L ${pt(CENTER_X + half, neckY - 4)} L ${pt(CENTER_X + half + 2, neckY + 6)} L ${pt(CENTER_X - half - 2, neckY + 6)} Z`;
        extra.push(`M ${pt(CENTER_X - 10, neckY + 4)} L ${pt(CENTER_X - 1, neckY + 4)} L ${pt(CENTER_X - 3, neckY + tailLen)} L ${pt(CENTER_X - 12, neckY + tailLen - 2)} Z`);
        extra.push(`M ${pt(CENTER_X + 1, neckY + 4)} L ${pt(CENTER_X + 9, neckY + 4)} L ${pt(CENTER_X + 12, neckY + tailLen * 0.85)} L ${pt(CENTER_X + 3, neckY + tailLen * 0.85 + 2)} Z`);
        hemY = neckY + tailLen;
        break;
      }
      if (kind === 'socks') {
        const top = levelY('calf') + 8;
        const sock = (side: 1 | -1): string => {
          const cx = CENTER_X + side * (g.hipHalf * 0.5);
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
      const y = levelY('hip') - 6;
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
