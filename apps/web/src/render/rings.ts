/**
 * Size rings (route R5 mock, docs/research/shortcut-to-step3.md §4): for the size on screen, the
 * garment's graded girths at bust (tops and dresses), waist, hip and hem drawn as rings around the
 * 2D figure, plus faint "ghost" rings of the neighbouring sizes. Pure geometry over the fit
 * engine's own per-point output (`chartCm`, `bodyCm`, `band`): this file never decides a size or a
 * band. The waistband and hem come from `ringInputs.ts` and carry their source (assumed /
 * measured) into the label.
 *
 * A ring is the front view of a horizontal ellipse at its body level: half-width from the girth by
 * the same rule the body outline uses (`halfWidthFromGirth`), so a ring smaller than the body sits
 * inside the outline (it cuts in) and a roomy one stands off it.
 */
import { CATEGORY_EASE, fitGapsForRender, isPointFit, type Band, type FitResult, type Point, type PointFit, type SizeFit } from '@curtain/fit-engine';
import type { GarmentPayload, UserBody } from '@curtain/schema';
import { cmToIn, type Units } from '@/embed/units';
import { bodyGeometry, garmentGeometry, halfWidthFromGirth, levelY, type BodyGeometry } from './body';
import type { GarmentRingInputs, RingSource } from './ringInputs';

export type RingKey = 'bust' | 'waist' | 'hip' | 'hem';

export interface Ring {
  key: RingKey;
  size: string;
  /** Ring centre line, viewBox px. */
  y: number;
  /** Half-width and half-depth of the drawn ellipse, viewBox px. */
  rx: number;
  ry: number;
  /** Body half-width at that level, viewBox px (null for the hem). */
  bodyRx: number | null;
  /** Garment girth drawn, cm. */
  garmentCm: number;
  /** Body girth at that level, cm (null for the hem). */
  bodyCm: number | null;
  /** Garment minus body, cm (null for the hem). */
  roomCm: number | null;
  /** The fit engine's band for this point and size; null when the engine did not score it. */
  band: Band | null;
  /** Where the garment girth comes from. */
  source: 'chart' | RingSource;
  /** Short text for the on-figure chip, e.g. ["Good fit", "4 cm room"]. */
  chip: [string, string];
  /** One sentence for the list and screen readers. */
  text: string;
  /** Elastic band range (assumed / measured), when known. */
  stretch?: { relaxedCm: number; stretchedCm: number; relaxedRx: number; stretchedRx: number; source: RingSource };
}

export interface SizeRings {
  size: string;
  rings: Ring[];
}

export interface GhostRings extends SizeRings {
  /** Chart order relative to the size on screen. */
  side: 'smaller' | 'larger';
}

export interface RingOverlay {
  size: string;
  selected: SizeRings;
  /** The neighbouring sizes in chart order (smaller first), drawn as ghosts. */
  ghosts: GhostRings[];
  /** Estimate notes (band and hem sources); always at least the chart note. */
  notes: string[];
}

export interface RingOverlayInput {
  garment: Pick<GarmentPayload, 'category' | 'sizeChart' | 'sizeChartType' | 'stretchZones'> & Partial<Pick<GarmentPayload, 'ease' | 'patternBlock'>>;
  fit: FitResult;
  size: string;
  body: BodyGeometry;
  measurements: UserBody['measurements'] | null;
  inputs?: GarmentRingInputs | null;
  /** y of the drawn garment's hem (garmentGeometry().hemY); the hem ring sits there. */
  hemY?: number | null;
  units?: Units;
}

const BAND_WORD: Record<Band, string> = { tight: 'Tight', snug: 'Snug', good: 'Good fit', roomy: 'Roomy', loose: 'Loose' };

/** Cross-section depth / width per level (body.ts uses the same ratios); the hem hangs rounder. */
const DEPTH: Record<RingKey, number> = { bust: 0.7, waist: 0.75, hip: 0.7, hem: 0.95 };
/** Rings never run off the 200 px viewBox. */
const MAX_RX = 97;
/** Ellipse depth on screen: the rings are seen slightly from above. */
const TILT = 0.16;

const POINTS_FOR: Partial<Record<GarmentPayload['category'], RingKey[]>> = {
  top: ['bust', 'waist', 'hip'],
  dress: ['bust', 'waist', 'hip'],
  outerwear: ['bust', 'waist', 'hip'],
  bottom: ['waist', 'hip'],
};

/** A girth difference for a chip: whole cm, or inches to one decimal. */
export function roomLength(cm: number, units: Units = 'metric'): string {
  return units === 'imperial' ? `${cmToIn(cm).toFixed(1)} in` : `${Math.round(cm)} cm`;
}

/** "4 cm room" / "8 cm short" / "no room" (garment minus body girth). */
export function roomText(roomCm: number, units: Units = 'metric'): string {
  if (Math.abs(roomCm) < 0.5) return 'no room';
  return roomCm > 0 ? `${roomLength(roomCm, units)} room` : `${roomLength(-roomCm, units)} short`;
}

function ringY(key: RingKey, category: GarmentPayload['category'], hemY: number | null | undefined): number | null {
  if (key === 'hem') return hemY ?? null;
  if (key === 'waist') return levelY('waist') + (category === 'bottom' ? 2 : 0);
  return levelY(key);
}

function bodyHalf(key: Exclude<RingKey, 'hem'>, g: BodyGeometry): number {
  return key === 'bust' ? g.bustHalf : key === 'waist' ? g.waistHalf : g.hipHalf;
}

const sourceText: Record<RingSource, string> = { measured: 'measured', assumed: 'assumed, not measured' };

function ringsFor(input: RingOverlayInput, sizeFit: SizeFit): Ring[] {
  const { garment, fit, body, measurements, inputs, hemY, units = 'metric' } = input;
  const keys = POINTS_FOR[garment.category] ?? [];
  const row = garment.sizeChart.find((r) => r.size === sizeFit.size);
  const out: Ring[] = [];
  const ppc = body.pxPerCm;
  const elastic = (garment.stretchZones ?? []).includes('waistband');
  for (const key of keys) {
    if (key === 'hem') continue;
    const y = ringY(key, garment.category, hemY);
    if (y === null) continue;
    const pf = sizeFit.points.find((p): p is PointFit => isPointFit(p) && p.point === key);
    const skipped = fit.skippedPoints.find((s) => s.point === key);
    const bodyRx = bodyHalf(key, body);
    let ring: Ring | null = null;
    if (pf) {
      const room = Math.round((pf.chartCm - pf.bodyCm) * 10) / 10;
      const rx = Math.min(MAX_RX, halfWidthFromGirth(pf.chartCm, ppc, DEPTH[key]));
      ring = {
        key, size: sizeFit.size, y, rx, ry: Math.max(2.5, rx * TILT), bodyRx,
        garmentCm: pf.chartCm, bodyCm: pf.bodyCm, roomCm: room, band: pf.band, source: 'chart',
        chip: [BAND_WORD[pf.band], roomText(room, units)],
        text: `${label(key)}: ${BAND_WORD[pf.band].toLowerCase()}, ${roomText(room, units)} (garment ${roomLength(pf.chartCm, units)} from the size chart, you ${roomLength(pf.bodyCm, units)})`,
      };
    } else if (skipped && row) {
      // The engine does not score this point for the cut (e.g. an A-line hip): draw the chart girth,
      // say why it is not checked, and give no tight / loose word.
      const raw = row[key as Point & keyof typeof row] as number | undefined;
      const bodyCm = measurements?.[key];
      if (raw !== undefined) {
        const ease = garment.sizeChartType === 'body' ? (garment.ease?.[key] ?? CATEGORY_EASE[garment.category]?.[key] ?? 0) : 0;
        const garmentCm = Math.round((raw + ease) * 10) / 10;
        const rx = Math.min(MAX_RX, halfWidthFromGirth(garmentCm, ppc, DEPTH[key]));
        const room = bodyCm !== undefined ? Math.round((garmentCm - bodyCm) * 10) / 10 : null;
        ring = {
          key, size: sizeFit.size, y, rx, ry: Math.max(2.5, rx * TILT), bodyRx,
          garmentCm, bodyCm: bodyCm ?? null, roomCm: room, band: null, source: 'chart',
          chip: ['Not checked', room !== null ? roomText(room, units) : skipped.label],
          text: `${label(key)}: not checked, ${skipped.label}${room !== null ? ` (${roomText(room, units)} by the size chart)` : ''}`,
        };
      }
    }
    if (!ring) continue;
    if (key === 'waist' && elastic) {
      const relaxed = inputs?.band?.relaxedCm[sizeFit.size];
      const stretched = inputs?.band?.stretchedCm[sizeFit.size];
      if (inputs?.band && relaxed !== undefined && stretched !== undefined) {
        ring.stretch = {
          relaxedCm: relaxed,
          stretchedCm: stretched,
          relaxedRx: Math.min(MAX_RX, halfWidthFromGirth(relaxed, ppc, DEPTH.waist)),
          stretchedRx: Math.min(MAX_RX, halfWidthFromGirth(stretched, ppc, DEPTH.waist)),
          source: inputs.band.source,
        };
        ring.text += `; elastic band ${roomLength(relaxed, units)} relaxed to ${roomLength(stretched, units)} stretched (${sourceText[inputs.band.source]})`;
      } else {
        ring.text += '; elastic band, its girth is not measured';
      }
    }
    out.push(ring);
  }
  const sweep = inputs?.hem?.sweepCm[sizeFit.size];
  const y = ringY('hem', garment.category, hemY);
  if (inputs?.hem && sweep !== undefined && y !== null) {
    const rx = Math.min(MAX_RX, halfWidthFromGirth(sweep, ppc, DEPTH.hem));
    out.push({
      key: 'hem', size: sizeFit.size, y, rx, ry: Math.max(2.5, rx * TILT), bodyRx: null,
      garmentCm: sweep, bodyCm: null, roomCm: null, band: null, source: inputs.hem.source,
      chip: ['Hem', `${roomLength(sweep, units)}${inputs.hem.source === 'measured' ? '' : ' assumed'}`],
      text: `Hem: ${roomLength(sweep, units)} around (${sourceText[inputs.hem.source]})`,
    });
  }
  return out;
}

function label(key: RingKey): string {
  return key === 'bust' ? 'Bust' : key === 'waist' ? 'Waist' : key === 'hip' ? 'Hips' : 'Hem';
}

/**
 * The rings of `size` and the ghosts of the sizes on either side of it in the chart. `null` when
 * the size is not in the result or the category has no rings (shoes, accessories).
 */
export function ringOverlay(input: RingOverlayInput): RingOverlay | null {
  const { fit, size, garment, inputs } = input;
  const idx = fit.perSize.findIndex((s) => s.size === size);
  const at = fit.perSize[idx];
  if (!at || !POINTS_FOR[garment.category]) return null;
  const selected = { size, rings: ringsFor(input, at) };
  if (selected.rings.length === 0) return null;
  const ghosts: GhostRings[] = [];
  const before = fit.perSize[idx - 1];
  const after = fit.perSize[idx + 1];
  if (before) ghosts.push({ size: before.size, side: 'smaller', rings: ringsFor(input, before) });
  if (after) ghosts.push({ size: after.size, side: 'larger', rings: ringsFor(input, after) });
  const notes = ['Rings show the garment’s size-chart girths around a figure drawn from your answers: an estimate, not a measured garment.'];
  const band = inputs?.band;
  if ((garment.stretchZones ?? []).includes('waistband'))
    notes.push(band ? `Elastic waistband: ${band.source === 'measured' ? 'measured' : 'girth assumed, not measured yet'}.` : 'Elastic waistband: its girth is not measured.');
  if (inputs?.hem) notes.push(`Hem: ${sourceText[inputs.hem.source]}.`);
  return { size, selected, ghosts, notes };
}

/** Front arc (lower half) and back arc (upper half) of a ring as SVG paths, centred on x = 100. */
export function ringArcs(rx: number, ry: number, y: number, cx = 100): { front: string; back: string } {
  const l = (cx - rx).toFixed(1);
  const r = (cx + rx).toFixed(1);
  const a = `${rx.toFixed(1)},${ry.toFixed(1)} 0 0`;
  return { front: `M ${l},${y.toFixed(1)} A ${a},0 ${r},${y.toFixed(1)}`, back: `M ${l},${y.toFixed(1)} A ${a},1 ${r},${y.toFixed(1)}` };
}

export interface RingOverlayForInput {
  garment: GarmentPayload;
  fit: FitResult;
  size: string;
  measurements: UserBody['measurements'] | null;
  heightCm?: number | undefined;
  inputs?: GarmentRingInputs | null;
  units?: Units;
}

/**
 * `ringOverlay` on the same figure AvatarView draws: the body from the shopper's measurements and
 * the hem where the 2D garment's hem is drawn for that size.
 */
export function ringOverlayFor({ garment, fit, size, measurements, heightCm, inputs = null, units = 'metric' }: RingOverlayForInput): RingOverlay | null {
  const body = bodyGeometry(measurements, heightCm);
  const hemY = garmentGeometry({ garment, gaps: fitGapsForRender(fit, size), body }).hemY;
  return ringOverlay({ garment, fit, size, body, measurements, inputs, hemY, units });
}
