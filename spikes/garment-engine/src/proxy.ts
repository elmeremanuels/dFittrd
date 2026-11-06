/**
 * Control proxy for stage 2 (Wan2.2-Fun-A14B-Control): a coarse, closed garment volume worn by our
 * mannequin, derived only from the product's category, size chart and lengths. The exporter renders
 * the control depth and silhouette of the mannequin WEARING this proxy, so the control video already
 * has the garment's outline: one closed volume between the legs for a dress or a skirt, two legs for
 * trousers, a torso shell with sleeves for a top. The first GPU run (GitHub Actions run 10) drove the
 * model with the bare mannequin's depth, two separate legs, and the dress turned into trousers
 * between the pinned frames.
 *
 * The proxy is a control signal only. It is never an output, never a reconstruction and never a
 * measurement: no anchor, grading or fit step reads it.
 *
 *   dress       one closed volume from just below the neck to the hem (chart girths at chest, waist,
 *               hip; flare below the hip, always clearing both legs), plus sleeves when the product
 *               has a sleeve length
 *   skirt       one closed volume from the waist to the hem
 *   trousers    a seat from the waist to the crotch, then two closed legs to the hem, with a gap
 *               between them
 *   top         torso shell to the hem (default just below the hip ring), sleeves to the sleeve length
 *   outerwear   as top; sleeves to the wrist when the product gives no sleeve length
 *
 * Girths: the chart row of the base size through `evalChart` (garment chart as printed, e.g. one-size
 * flat measurements doubled by the shop parser; body chart + product ease, else the fit engine's
 * category default ease). A ring the chart does not give is the mannequin's girth + `PROXY_DEFAULT_EASE`.
 * A girth below the mannequin's body + `MIN_CLEARANCE_CM` is raised to it and the spec says so.
 */
import { CATEGORY_ANCHORS, FIT_POINT_TO_ANCHOR, ellipseCircumference, ellipseFromCircumference, monotoneProfile, type AnchorRing } from '@curtain/anchors';
import { CATEGORY_EASE } from '@curtain/fit-engine';
import { along, loftSections, mergeParts, polygonCompensation, signedVolume, stations, type Mannequin, type Mesh, type Section, type Side, type Vec3 } from '@curtain/mannequin';
import type { GarmentPayload } from '@curtain/schema';
import { evalChart, evalChartRow, isEvalCategory, type EvalCategory } from './evalChart';

export const PROXY_VERSION = 'control-proxy-0.1.0';
export const CONTROL_MODES = ['proxy', 'bare'] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

export const PROXY_KINDS = ['dress', 'skirt', 'trousers', 'top', 'outerwear'] as const;
export type ProxyKind = (typeof PROXY_KINDS)[number];

/** A girth never sits closer to the mannequin than this (cm of girth), so the proxy always covers the body. */
export const MIN_CLEARANCE_CM = 1;
/** Clearance (cm, radial) of a dress or skirt below the hip around both legs, as the synthetic garment. */
const LEG_CLEARANCE_CM = 1.5;
/** Half the gap between the two trouser legs (cm): the legs stay visibly apart in the depth frames. */
const TROUSER_HALF_GAP_CM = 1;
const BODY_SEGMENTS = 64;
const LIMB_SEGMENTS = 32;
const STEP_CM = 1.5;

/** Ease (cm of girth) over the mannequin where the chart gives no value for a ring. A control choice, not chart data. */
export const PROXY_DEFAULT_EASE: Readonly<Record<ProxyKind, Partial<Record<AnchorRing, number>>>> = {
  dress: { chest: 6, underbust: 6, waist: 4, hip: 6, upper_arm: 6, wrist: 4 },
  skirt: { waist: 2, hip: 5 },
  trousers: { waist: 2, hip: 5, thigh: 3, knee: 6 },
  top: { chest: 8, underbust: 8, waist: 8, hip: 6, upper_arm: 6, wrist: 4 },
  outerwear: { chest: 12, underbust: 12, waist: 12, hip: 10, upper_arm: 8, wrist: 6 },
};

/** The rings the proxy body passes through, top to bottom, per kind (trouser legs add the thigh). */
const BODY_RINGS: Readonly<Record<ProxyKind, readonly AnchorRing[]>> = {
  dress: ['chest', 'underbust', 'waist', 'hip'],
  skirt: ['waist', 'hip'],
  trousers: ['waist', 'hip', 'thigh'],
  top: ['chest', 'underbust', 'waist', 'hip'],
  outerwear: ['chest', 'underbust', 'waist', 'hip'],
};

/** Hem girth over hip girth for a dress or skirt, by pattern block or subcategory word (first match wins). */
const FLARE_RULES: readonly [RegExp, number][] = [
  [/pencil|bodycon|sheath|column|slip|tube/i, 1.0],
  [/tier|full|circle|fit-and-flare|skater|babydoll|baby-doll|empire|peasant/i, 1.35],
  [/a-line|aline|trapeze|swing|maxi/i, 1.25],
];
const DEFAULT_FLARE = 1.1;

/** Trouser leg shape by pattern block or subcategory word: thigh girth floor (share of the hip girth) and hem/thigh ratio. */
const LEG_RULES: readonly [RegExp, { thighOfHip: number; hemOfThigh: number | 'ankle' }][] = [
  [/palazzo|wide|culotte|flare|bootcut|boot-cut|barrel/i, { thighOfHip: 0.6, hemOfThigh: 1.1 }],
  [/skinny|slim|tapered|legging|jogger|cigarette/i, { thighOfHip: 0, hemOfThigh: 'ankle' }],
];
const DEFAULT_LEG = { thighOfHip: 0, hemOfThigh: 0.85 } as const;

export type GirthSource = 'garment chart' | 'body chart + product ease' | 'body chart + category default ease' | 'mannequin + proxy default ease' | 'raised to clear the mannequin' | 'pattern block: wide leg';

export interface ProxySpec {
  version: typeof PROXY_VERSION;
  kind: ProxyKind;
  category: EvalCategory;
  baseSize: string;
  chartType: 'body' | 'garment';
  /** Garment girths (cm) the proxy has at the anchor rings it passes through. */
  girths: Partial<Record<AnchorRing, number>>;
  girthSource: Partial<Record<AnchorRing, GirthSource>>;
  /** Anchor rings that lie on the proxy (between its top and its hem); the girths there are exact. */
  anchors: AnchorRing[];
  /** Top and hem height above the floor, cm. */
  topY: number;
  hemY: number;
  /** Length the hem comes from, and where it was read. */
  lengthCm: number;
  lengthSource: string;
  /** Dress/skirt: hem girth over hip girth before leg clearance. Trousers: hem girth over thigh girth (null: tapered to the ankle). */
  hemFlare: number | null;
  /** Sleeve length from the shoulder joint along the arm, cm (0 = no sleeve shell). */
  sleeveCm: number;
  sleeveSource: string;
  notes: string[];
}

/** Overrides for a job whose pinned stills show a known garment (the synthetic stills): the proxy's hem must be that garment's, or the control video and the stills disagree on the length. */
export interface ProxyOptions {
  /** High point shoulder to hem, cm (dress, top, outerwear; `buildProxy` throws when given for a skirt or trousers). */
  shoulderToHemCm?: number;
  /** Where that length comes from, recorded as `length_source`. */
  lengthSource?: string;
}

export interface Proxy {
  spec: ProxySpec;
  /** Closed parts in cm, mannequin space: `body` (+ `leg_l`/`leg_r` for trousers, `sleeve_l`/`sleeve_r`), named so `skinWeights` poses them. */
  mesh: Mesh;
}

/** The proxy kind of a product: the category, and for bottoms the word "skirt" in subcategory or pattern block. */
export function proxyKind(p: Pick<GarmentPayload, 'category' | 'subcategory' | 'patternBlock'>): ProxyKind {
  switch (p.category) {
    case 'dress':
    case 'top':
    case 'outerwear':
      return p.category;
    case 'bottom':
      return /skirt|skort/i.test(`${p.subcategory ?? ''} ${p.patternBlock ?? ''}`) ? 'skirt' : 'trousers';
    default:
      throw new Error(`no control proxy for category ${p.category}`);
  }
}

const styleWords = (p: Pick<GarmentPayload, 'subcategory' | 'patternBlock'>): string => `${p.patternBlock ?? ''} ${p.subcategory ?? ''}`;

/** Category default ease of the fit engine re-keyed by ring (bust → chest). */
function categoryEase(category: EvalCategory, ring: AnchorRing): number | undefined {
  for (const [point, v] of Object.entries(CATEGORY_EASE[category])) {
    if ((FIT_POINT_TO_ANCHOR as Partial<Record<string, string>>)[point] === ring) return v;
  }
  return undefined;
}

function ringGirths(m: Mannequin, p: GarmentPayload, kind: ProxyKind, baseSize: string): Pick<ProxySpec, 'girths' | 'girthSource' | 'chartType' | 'notes'> {
  if (!isEvalCategory(p.category)) throw new Error(`no control proxy for category ${p.category}`);
  const chart = evalChart(p);
  const row = evalChartRow(chart, baseSize);
  const girths: ProxySpec['girths'] = {};
  const girthSource: ProxySpec['girthSource'] = {};
  const notes: string[] = [];
  const subset = new Set<AnchorRing>(CATEGORY_ANCHORS[p.category].rings);
  for (const id of [...BODY_RINGS[kind], 'upper_arm', 'wrist'] as const) {
    const body = m.shape.rings[id].circumferenceCm;
    const fromChart = subset.has(id) ? row.rings[id] : undefined;
    let g: number;
    let src: GirthSource;
    if (fromChart !== undefined) {
      g = fromChart;
      src = chart.type === 'garment' ? 'garment chart' : row.defaultEase.includes(id) ? 'body chart + category default ease' : 'body chart + product ease';
    } else {
      g = body + (PROXY_DEFAULT_EASE[kind][id] ?? categoryEase(chart.category, id) ?? 4);
      src = 'mannequin + proxy default ease';
    }
    if (g < body + MIN_CLEARANCE_CM) {
      notes.push(`${id}: ${round1(g)} cm (${src}) is below the mannequin's ${body} cm + ${MIN_CLEARANCE_CM}; raised to clear the body`);
      g = body + MIN_CLEARANCE_CM;
      src = 'raised to clear the mannequin';
    }
    girths[id] = g;
    girthSource[id] = src;
  }
  return { girths, girthSource, chartType: chart.type, notes };
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

function hemFor(m: Mannequin, p: GarmentPayload, kind: ProxyKind, topY: number, opts: ProxyOptions = {}): { hemY: number; lengthCm: number; lengthSource: string } {
  const len = (p.lengthCm ?? {}) as Partial<Record<string, number>>;
  const hps = m.landmarks.hps[1];
  const waistY = m.morphHeights.waist;
  const crotchY = m.landmarks.crotch[1];
  const h = m.morphHeights;
  const words = styleWords(p);
  const byWord = (fallback: [number, string]): [number, string] => {
    if (/maxi|floor|full-length/i.test(words)) return [h.ankle + 3, 'subcategory/pattern "maxi": just above the ankle'];
    if (/midi|tea/i.test(words)) return [(h.knee + h.calf) / 2, 'subcategory/pattern "midi": between knee and calf'];
    if (/mini|short/i.test(words)) return [(h.thigh + h.knee) / 2 + 4, 'subcategory/pattern "mini": above the knee'];
    return fallback;
  };
  // The override is a shoulder-to-hem length: it has no meaning for a waist-down kind, so refuse it rather than drop it.
  if (opts.shoulderToHemCm !== undefined && (kind === 'skirt' || kind === 'trousers')) {
    throw new Error(`proxy: shoulderToHemCm override given for a ${kind} proxy; it applies to dress, top and outerwear only`);
  }
  let hemY: number;
  let source: string;
  if (kind === 'trousers') {
    if (len.outseam !== undefined) [hemY, source] = [waistY - len.outseam, `outseam ${len.outseam} cm from the waist`];
    else if (len.inseam !== undefined) [hemY, source] = [crotchY - len.inseam, `inseam ${len.inseam} cm from the crotch`];
    else if (len.waist_to_hem !== undefined) [hemY, source] = [waistY - len.waist_to_hem, `waist_to_hem ${len.waist_to_hem} cm`];
    else if (/short/i.test(words)) [hemY, source] = [h.thigh - 4, 'subcategory/pattern "short": mid thigh'];
    else [hemY, source] = [h.ankle + 1, 'no length given: full length to the ankle'];
  } else if (kind === 'skirt') {
    if (len.waist_to_hem !== undefined) [hemY, source] = [waistY - len.waist_to_hem, `waist_to_hem ${len.waist_to_hem} cm`];
    else if (len.outseam !== undefined) [hemY, source] = [waistY - len.outseam, `outseam ${len.outseam} cm from the waist`];
    else [hemY, source] = byWord([h.knee, 'no length given: to the knee']);
  } else if (opts.shoulderToHemCm !== undefined) {
    [hemY, source] = [hps - opts.shoulderToHemCm, opts.lengthSource ?? `shoulder_to_hem ${opts.shoulderToHemCm} cm (override)`];
  } else {
    if (len.shoulder_to_hem !== undefined) [hemY, source] = [hps - len.shoulder_to_hem, `shoulder_to_hem ${len.shoulder_to_hem} cm`];
    else if (len.waist_to_hem !== undefined) [hemY, source] = [waistY - len.waist_to_hem, `waist_to_hem ${len.waist_to_hem} cm`];
    else if (kind === 'dress') [hemY, source] = byWord([h.knee, 'no length given: to the knee']);
    else [hemY, source] = [h.hip - 3, 'no length given: just below the hip ring'];
  }
  const clamped = Math.min(topY - 10, Math.max(1, hemY));
  if (clamped !== hemY) source += `; clamped to ${round1(clamped)} cm above the floor`;
  return { hemY: clamped, lengthCm: round1((kind === 'skirt' || kind === 'trousers' ? waistY : hps) - clamped), lengthSource: source };
}

function sleeveFor(m: Mannequin, p: GarmentPayload, kind: ProxyKind): { sleeveCm: number; sleeveSource: string } {
  const given = (p.lengthCm as Partial<Record<string, number>> | undefined)?.sleeve_length;
  const wrist = m.morphHeights.wrist;
  if (kind === 'skirt' || kind === 'trousers') return { sleeveCm: 0, sleeveSource: 'no sleeves for this kind' };
  if (given !== undefined) return { sleeveCm: Math.min(given, wrist + 1.5), sleeveSource: `sleeve_length ${given} cm` };
  if (kind === 'outerwear') return { sleeveCm: wrist + 1.5, sleeveSource: 'no sleeve length given: outerwear default, to the wrist' };
  return { sleeveCm: 0, sleeveSource: 'no sleeve length given: no sleeve shell (the bare arm stays in the control)' };
}

/** The proxy's spec for a product at its base size on our mannequin. */
export function proxySpec(m: Mannequin, p: GarmentPayload, baseSize: string, opts: ProxyOptions = {}): ProxySpec {
  const kind = proxyKind(p);
  const { girths, girthSource, chartType, notes } = ringGirths(m, p, kind, baseSize);
  const shoulderY = m.morphHeights.shoulder;
  // Lower body: 2 cm above the waist ring, so the ring lies on the shell's side, not on its cap.
  const topY = kind === 'skirt' || kind === 'trousers' ? m.morphHeights.waist + 2 : shoulderY + 0.35 * (m.morphHeights.neck - shoulderY);
  const { hemY, lengthCm, lengthSource } = hemFor(m, p, kind, topY, opts);
  const { sleeveCm, sleeveSource } = sleeveFor(m, p, kind);
  let hemFlare: number | null = null;
  if (kind === 'trousers') {
    const rule = LEG_RULES.find(([re]) => re.test(styleWords(p)))?.[1] ?? DEFAULT_LEG;
    hemFlare = rule.hemOfThigh === 'ankle' ? null : rule.hemOfThigh;
    const floor = rule.thighOfHip * (girths.hip ?? 0);
    if (girths.thigh !== undefined && floor > girths.thigh) {
      notes.push(`thigh: ${round1(girths.thigh)} cm (${girthSource.thigh}) raised to ${round1(floor)} cm, ${rule.thighOfHip} × the hip girth, for a wide leg ("${styleWords(p).trim()}")`);
      girths.thigh = floor;
      girthSource.thigh = 'pattern block: wide leg';
    }
  } else if (kind === 'dress' || kind === 'skirt') hemFlare = FLARE_RULES.find(([re]) => re.test(styleWords(p)))?.[1] ?? DEFAULT_FLARE;
  else hemFlare = 1.05;
  const legTop = m.landmarks.crotch[1];
  const anchors = [...BODY_RINGS[kind], ...(sleeveCm > m.morphHeights.upper_arm ? (['upper_arm'] as const) : []), ...(sleeveCm >= m.morphHeights.wrist ? (['wrist'] as const) : [])].filter((id) => {
    if (id === 'upper_arm' || id === 'wrist') return true;
    const y = m.morphHeights[id];
    if (kind === 'trousers' && id === 'thigh') return y < legTop && y > hemY;
    return y <= topY && y >= hemY;
  });
  for (const id of Object.keys(girths) as AnchorRing[]) {
    if (!anchors.includes(id)) {
      delete girths[id];
      delete girthSource[id];
    }
  }
  if (p.sizeChartType === 'garment' && p.sizeChart.length === 1) notes.push('one size: girths from the flat measurements (garment chart, as parsed)');
  return { version: PROXY_VERSION, kind, category: p.category as EvalCategory, baseSize, chartType, girths, girthSource, anchors, topY, hemY, lengthCm, lengthSource, hemFlare, sleeveCm, sleeveSource, notes };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Part = { name: string; positions: number[]; indices: number[] };

/** A closed tube: the sections lofted and capped with a fan at both ends, faces outwards. */
function closedTube(name: string, sections: Section[], segments: number): Part {
  const first = sections[0]!;
  const last = sections[sections.length - 1]!;
  const tube = loftSections(sections, segments, { start: first.centre, end: last.centre });
  if (signedVolume(tube.positions, tube.indices) < 0) {
    for (let t = 0; t < tube.indices.length; t += 3) {
      const tmp = tube.indices[t + 1]!;
      tube.indices[t + 1] = tube.indices[t + 2]!;
      tube.indices[t + 2] = tmp;
    }
  }
  return { name, ...tube };
}

function section(centre: Vec3, a: number, b: number, segments: number): Section {
  const k = polygonCompensation(a, b, segments);
  return { centre, u: [1, 0, 0], v: [0, 0, 1], a: a * k, b: b * k };
}

/** Torso ellipse at `y`, or the hip ring's below the torso. */
function torsoEllipse(m: Mannequin, y: number) {
  return m.torsoAt(y) ?? m.torsoAt(m.morphHeights.hip)!;
}

interface ShellOptions {
  /** One closed volume around both legs below the hip (dress, skirt). */
  coverLegs: boolean;
  /** Below the hip, the half-width (x) the shell must reach at height y (the trouser seat holds both leg tops). */
  minHalfWidth?: (y: number) => number;
}

/** Body shell from the spec's top down to `bottomY` (dress, skirt, top, outerwear, and the trouser seat). */
function bodyShell(m: Mannequin, spec: ProxySpec, bottomY: number, opts: ShellOptions): Part {
  const yHip = m.morphHeights.hip;
  const lowerBody = spec.kind === 'skirt' || spec.kind === 'trousers';
  const knots = [{ x: spec.topY, y: lowerBody ? (spec.girths.waist ?? m.shape.rings.waist.circumferenceCm + 2) - m.shape.rings.waist.circumferenceCm : 3 }];
  for (const id of BODY_RINGS[spec.kind]) {
    const g = spec.girths[id];
    if (g === undefined || id === 'thigh') continue;
    knots.push({ x: m.morphHeights[id], y: g - m.shape.rings[id].circumferenceCm });
  }
  const ease = monotoneProfile(knots);
  const hipGirth = spec.girths.hip ?? m.shape.rings.hip.circumferenceCm + (PROXY_DEFAULT_EASE[spec.kind].hip ?? 6);
  const hipAspect = m.shape.rings.hip.aspect;
  const flare = spec.kind === 'trousers' ? 1 : (spec.hemFlare ?? 1);
  const required = (['shoulder', 'chest', 'underbust', 'waist', 'hip', 'thigh', 'knee'] as const).map((id) => m.morphHeights[id]).filter((y) => y > bottomY && y < spec.topY);
  const sections = stations(spec.topY, bottomY, STEP_CM, required).map((y): Section => {
    let a: number, b: number, cz = 0;
    if (y >= yHip) {
      const e = torsoEllipse(m, y);
      const cb = ellipseCircumference(e.a, e.b);
      const s = (cb + ease(y)) / cb;
      a = e.a * s;
      b = e.b * s;
      cz = e.cz;
    } else {
      const t = (yHip - y) / Math.max(1e-9, yHip - spec.hemY);
      ({ a, b } = ellipseFromCircumference(hipGirth * (1 + (flare - 1) * t), hipAspect));
      const leg = m.legAt(y, 1);
      if (opts.coverLegs && leg) {
        // One closed volume around both legs, with clearance: no gap between the legs.
        a = Math.max(a, m.landmarks.legX + leg.a + LEG_CLEARANCE_CM);
        b = Math.max(b, Math.abs(leg.cz) + leg.b + LEG_CLEARANCE_CM);
      }
      if (opts.minHalfWidth) a = Math.max(a, opts.minHalfWidth(y));
      const torso = m.torsoAt(y);
      if (torso) {
        a = Math.max(a, torso.a + LEG_CLEARANCE_CM);
        b = Math.max(b, torso.b + LEG_CLEARANCE_CM);
      }
    }
    return section([0, y, cz], a, b, BODY_SEGMENTS);
  });
  return closedTube('body', sections, BODY_SEGMENTS);
}

/** One trouser leg section at height y: girth from thigh to hem, covering the mannequin leg, centre moved out for wide legs. */
function legSection(m: Mannequin, spec: ProxySpec, y: number, side: Side): { centre: Vec3; a: number; b: number } {
  const thighY = m.morphHeights.thigh;
  const thigh = spec.girths.thigh ?? m.shape.rings.thigh.circumferenceCm + 3;
  const hemGirth = spec.hemFlare === null ? m.shape.rings.ankle.circumferenceCm + 8 : thigh * spec.hemFlare;
  const t = y >= thighY ? 0 : (thighY - y) / Math.max(1e-9, thighY - spec.hemY);
  let { a, b } = ellipseFromCircumference(thigh + (hemGirth - thigh) * t, m.shape.rings.thigh.aspect);
  const leg = m.legAt(y, side);
  if (leg) {
    a = Math.max(a, leg.a + 0.5);
    b = Math.max(b, leg.b + 0.5);
  }
  const cx = Math.max(m.landmarks.legX, a + TROUSER_HALF_GAP_CM);
  return { centre: [side * cx, y, leg?.cz ?? 0], a, b };
}

/** Trousers: the seat (waist to just below the crotch) and two closed legs to the hem, 2 × `TROUSER_HALF_GAP_CM` apart. */
function trouserParts(m: Mannequin, spec: ProxySpec): Part[] {
  const crotchY = m.landmarks.crotch[1];
  const legTop = crotchY + 2; // inside the seat, so seat and legs overlap
  const required = [m.morphHeights.thigh, m.morphHeights.knee].filter((y) => y < legTop && y > spec.hemY);
  const ys = stations(legTop, spec.hemY, STEP_CM, required);
  const legs = ([1, -1] as Side[]).map((side): Part => {
    const sections = ys.map((y): Section => {
      const s = legSection(m, spec, y, side);
      return section(s.centre, s.a, s.b, LIMB_SEGMENTS);
    });
    return closedTube(side === 1 ? 'leg_l' : 'leg_r', sections, LIMB_SEGMENTS);
  });
  const seatBottom = crotchY - 1;
  const seat = bodyShell(m, spec, seatBottom, {
    coverLegs: false,
    minHalfWidth: (y) => {
      const s = legSection(m, spec, Math.max(y, seatBottom), 1);
      return s.centre[0] + s.a + 0.5;
    },
  });
  return [seat, ...legs];
}

function sleeves(m: Mannequin, spec: ProxySpec): Part[] {
  if (spec.sleeveCm <= 0) return [];
  const ua = m.morphHeights.upper_arm;
  const wr = m.morphHeights.wrist;
  const end = spec.sleeveCm;
  const uaEase = (spec.girths.upper_arm ?? m.shape.rings.upper_arm.circumferenceCm + 6) - m.shape.rings.upper_arm.circumferenceCm;
  const wrEase = Math.min(uaEase, (spec.girths.wrist ?? m.shape.rings.wrist.circumferenceCm + 4) - m.shape.rings.wrist.circumferenceCm);
  const ease = monotoneProfile([{ x: ua, y: uaEase }, { x: wr, y: wrEase }]);
  return ([1, -1] as Side[]).map((side) => {
    const frame = side === 1 ? m.arms.left : m.arms.right;
    const sections = stations(0, end, STEP_CM, [ua, wr].filter((s) => s < end)).map((s): Section => {
      const e = m.armAt(s, side)!;
      const cb = ellipseCircumference(e.a, e.b);
      const f = (cb + ease(s)) / cb;
      const k = polygonCompensation(e.a * f, e.b * f, LIMB_SEGMENTS);
      return { centre: along(frame.joint, frame.axis, s), u: frame.u, v: frame.v, a: e.a * f * k, b: e.b * f * k };
    });
    return closedTube(side === 1 ? 'sleeve_l' : 'sleeve_r', sections, LIMB_SEGMENTS);
  });
}

/** The proxy volume for a product at its base size on our mannequin (closed parts, cm). Deterministic. */
export function buildProxy(m: Mannequin, p: GarmentPayload, baseSize: string, opts: ProxyOptions = {}): Proxy {
  const spec = proxySpec(m, p, baseSize, opts);
  const parts = spec.kind === 'trousers' ? trouserParts(m, spec) : [bodyShell(m, spec, spec.hemY, { coverLegs: true })];
  parts.push(...sleeves(m, spec));
  return { spec, mesh: mergeParts(parts) };
}

/** The spec as recorded in the manifest and hashed (rounded to 0.1 mm so the hash never depends on float noise). */
export function proxyRecord(spec: ProxySpec): Record<string, unknown> {
  const r = (x: number): number => Math.round(x * 100) / 100;
  return {
    version: spec.version,
    kind: spec.kind,
    category: spec.category,
    base_size: spec.baseSize,
    chart_type: spec.chartType,
    girths_cm: Object.fromEntries(Object.entries(spec.girths).map(([k, v]) => [k, r(v)])),
    girth_source: spec.girthSource,
    anchors: spec.anchors,
    top_y_cm: r(spec.topY),
    hem_y_cm: r(spec.hemY),
    length_cm: r(spec.lengthCm),
    length_source: spec.lengthSource,
    hem_flare: spec.hemFlare,
    sleeve_cm: r(spec.sleeveCm),
    sleeve_source: spec.sleeveSource,
    notes: spec.notes,
  };
}
