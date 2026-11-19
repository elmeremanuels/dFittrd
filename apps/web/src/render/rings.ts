/**
 * Size rings (route R5 mock, docs/research/shortcut-to-step3.md §4): for the size on screen, the
 * garment's graded girths at bust (tops and dresses), waist, hip and hem drawn as rings around the
 * 2D figure, plus faint "ghost" rings of the neighbouring sizes. Pure geometry over the fit
 * engine's own per-point output (`chartCm`, `bodyCm`, `band`): this file never decides a size or a
 * band. The waistband, the garment's own hip girth and the hem come from `ringInputs.ts` and carry
 * their source for the size on screen (measured / interpolated / extrapolated / assumed) into the
 * label. The waist ring of an elastic band stays the engine's chart girth (the tape has no single
 * waist girth, only a relaxed-to-stretched range), so its chip says "by the size chart" instead of a
 * room figure that the band range printed under it would contradict. A hip the engine does not score (an A-line) is drawn at the garment's tape-measured hip
 * girth when there is one, with the room as plain arithmetic and still without a tight / loose word.
 *
 * A ring is the front view of a horizontal ellipse at its body level: half-width from the girth by
 * the same rule the body outline uses (`halfWidthFromGirth`), so a ring smaller than the body sits
 * inside the outline (it cuts in) and a roomy one stands off it.
 */
import { easeTargetFor, fitGapsForRender, isPointFit, type Band, type FitResult, type Point, type PointFit, type SizeFit } from '@curtain/fit-engine';
import type { GarmentPayload, UserBody } from '@curtain/schema';
import { stepSize } from '@/embed/aboutYou';
import { embedStrings } from '@/embed/strings';
import { appStrings, type AppCatalogue } from '@/strings';
import { cmToIn, type Units } from '@/embed/units';
import { bodyGeometry, figureY, garmentGeometry, halfWidthFromGirth, HEM_DEPTH, MAX_RING_RX, type BodyGeometry, type FigureFamily, type MaleShape } from './body';
import { bandSweep, sourceAt, sourceSentence, sourceWord, type GarmentRingInputs, type RingSource } from './ringInputs';

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
  /**
   * What the drawn girth is: a garment girth (garment chart, tape, assumed input) or, for a BODY
   * size chart, the chart's body girth plus the fit engine's designed ease (not a garment girth).
   */
  basis: 'garment' | 'body-chart+ease';
  /** The shopper's girth here is an estimate (from height and weight), not typed in. */
  bodyEstimated: boolean;
  /**
   * The pull-on check of this size's waistband when it is not a plain pass (`SizeFit.pullOn`): the waist chip then
   * names the check and takes its tone, not the engine's chart word.
   */
  pullOn?: 'marginal' | 'blocked';
  /** Short text for the on-figure chip, e.g. ["Good fit", "4 cm room"]. */
  chip: [string, string];
  /** Optional third chip line (e.g. the assumed elastic band range). */
  chipNote?: string;
  /** One sentence for the list and screen readers. */
  text: string;
  /** The ring is drawn narrower than its girth, because the full girth does not fit the picture. */
  clamped?: boolean;
  /** Elastic band range and its source for this size, when known. */
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
  garment: Pick<GarmentPayload, 'category' | 'sizeChart' | 'sizeChartType' | 'stretchZones' | 'patternBlock'> & Partial<Pick<GarmentPayload, 'ease' | 'subcategory'>>;
  fit: FitResult;
  size: string;
  body: BodyGeometry;
  measurements: UserBody['measurements'] | null;
  inputs?: GarmentRingInputs | null;
  /** y of the drawn garment's hem (garmentGeometry().hemY); the hem ring sits there. */
  hemY?: number | null;
  units?: Units;
  /** Body girths that are estimates (from height and weight), not the shopper's own numbers. */
  estimated?: readonly string[];
}

/** Band words come from the English catalogue (D21), the same ones the result list prints. */
const bandWord = (band: Band): string => embedStrings().fit.bands[band];
/** Every other word of a ring comes from the catalogue of the shared components (`rings`). */
const words = (): AppCatalogue['shared']['rings'] => appStrings().shared.rings;

/** Cross-section depth / width per level (body.ts uses the same ratios); the hem hangs rounder. */
const DEPTH: Record<RingKey, number> = { bust: 0.7, waist: 0.75, hip: 0.7, hem: HEM_DEPTH };
/** Rings never run off the 200 px viewBox. */
const MAX_RX = MAX_RING_RX;
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
  return units === 'imperial' ? words().inches(cmToIn(cm).toFixed(1)) : words().cm(String(Math.round(cm)));
}

/**
 * "4 cm room" / "8 cm short" / "no room" (garment minus body girth). `approx` (the body girth is an
 * estimate): rounded to 2 cm (1 in) and prefixed "about", so it does not look measured.
 */
export function roomText(roomCm: number, units: Units = 'metric', approx = false): string {
  const w = words();
  if (approx) {
    const step = units === 'imperial' ? 2.54 : 2;
    const r = Math.round(roomCm / step) * step;
    if (Math.abs(r) < 0.5) return w.about(w.noRoom);
    return w.about(r > 0 ? w.room(roomLength(r, units)) : w.short(roomLength(-r, units)));
  }
  if (Math.abs(roomCm) < 0.5) return w.noRoom;
  return roomCm > 0 ? w.room(roomLength(roomCm, units)) : w.short(roomLength(-roomCm, units));
}

/**
 * A tape girth for a label: like `roomLength`, but a half centimetre is kept ("75.5 cm"), so an
 * interpolated band of 75.5 cm is not printed as the shopper's own 76 cm waist.
 */
export function tapeLength(cm: number, units: Units = 'metric'): string {
  return units === 'imperial' ? words().inches(tapeNumber(cm, units)) : words().cm(tapeNumber(cm, units));
}

/** The number of `tapeLength` without its unit (the low end of a range: "67-94 cm"). */
function tapeNumber(cm: number, units: Units): string {
  if (units === 'imperial') return cmToIn(cm).toFixed(1);
  const half = Math.round(cm * 2) / 2;
  return String(Number.isInteger(half) ? half : half.toFixed(1));
}

/** "you 76 cm" / "you about 76 cm (estimated from your height and weight)". */
function youText(bodyCm: number, units: Units, estimated: boolean): string {
  return estimated ? words().youEstimated(roomLength(bodyCm, units)) : words().you(roomLength(bodyCm, units));
}

function ringY(key: RingKey, category: GarmentPayload['category'], hemY: number | null | undefined, body: BodyGeometry): number | null {
  if (key === 'hem') return hemY ?? null;
  if (key === 'waist') return figureY(body, 'waist') + (category === 'bottom' ? 2 : 0);
  return figureY(body, key);
}

/** Depth / width of a ring: the male figure's own ratios at the chest, waist and seat (the body is drawn with them). */
function depthOf(key: RingKey, body: BodyGeometry): number {
  return key !== 'hem' && body.aspects ? body.aspects[key] : DEPTH[key];
}

function bodyHalf(key: Exclude<RingKey, 'hem'>, g: BodyGeometry): number {
  return key === 'bust' ? g.bustHalf : key === 'waist' ? g.waistHalf : g.hipHalf;
}


function ringsFor(input: RingOverlayInput, sizeFit: SizeFit): Ring[] {
  const { garment, fit, body, measurements, inputs, hemY, units = 'metric', estimated = [] } = input;
  const bodyChart = garment.sizeChartType === 'body';
  const keys = POINTS_FOR[garment.category] ?? [];
  const row = garment.sizeChart.find((r) => r.size === sizeFit.size);
  const out: Ring[] = [];
  const ppc = body.pxPerCm;
  const elastic = (garment.stretchZones ?? []).includes('waistband');
  const w = words();
  for (const key of keys) {
    if (key === 'hem') continue;
    const y = ringY(key, garment.category, hemY, body);
    if (y === null) continue;
    const pf = sizeFit.points.find((p): p is PointFit => isPointFit(p) && p.point === key);
    const skipped = fit.skippedPoints.find((s) => s.point === key);
    const bodyRx = bodyHalf(key, body);
    let ring: Ring | null = null;
    /** The chart sentence of a scored point, without its label. */
    let scored: string | null = null;
    const est = estimated.includes(key);
    if (pf) {
      const room = Math.round((pf.chartCm - pf.bodyCm) * 10) / 10;
      const rx = Math.min(MAX_RX, halfWidthFromGirth(pf.chartCm, ppc, depthOf(key, body)));
      scored = w.scored(bandWord(pf.band), roomText(room, units, est), girthText(pf.chartCm, bodyChart, units), youText(pf.bodyCm, units, est));
      ring = {
        key, size: sizeFit.size, y, rx, ry: Math.max(2.5, rx * TILT), bodyRx,
        garmentCm: pf.chartCm, bodyCm: pf.bodyCm, roomCm: room, band: pf.band, source: 'chart',
        basis: bodyChart ? 'body-chart+ease' : 'garment', bodyEstimated: est,
        chip: [bandWord(pf.band), roomText(room, units, est)],
        text: w.labelled(label(key, body), scored),
      };
    } else if (skipped && row) {
      // The engine does not score this point for the cut (e.g. an A-line hip): no tight / loose word.
      const raw = row[key as Point & keyof typeof row] as number | undefined;
      const bodyCm = measurements?.[key];
      const tapeCm = key === 'hip' ? inputs?.hip?.girthCm[sizeFit.size] : undefined;
      if (tapeCm !== undefined && inputs?.hip) {
        // The garment's own hip girth from the tape: drawn as it is, room is plain arithmetic.
        const src = sourceAt(inputs.hip, sizeFit.size);
        const rx = Math.min(MAX_RX, halfWidthFromGirth(tapeCm, ppc, depthOf(key, body)));
        const room = bodyCm !== undefined ? Math.round((tapeCm - bodyCm) * 10) / 10 : null;
        const where = inputs.hip.belowBandCm != null ? w.belowBand(roomLength(inputs.hip.belowBandCm, units)) : w.atHipLine;
        ring = {
          key, size: sizeFit.size, y, rx, ry: Math.max(2.5, rx * TILT), bodyRx,
          garmentCm: tapeCm, bodyCm: bodyCm ?? null, roomCm: room, band: null, source: src, basis: 'garment', bodyEstimated: est,
          chip: [w.labels.hip, room !== null ? roomText(room, units, est) : w.around(tapeLength(tapeCm, units))],
          chipNote: w.tapeChipNote({ skirt: /skirt/.test(garment.subcategory ?? ''), length: tapeLength(tapeCm, units), source: sourceWord(src) }),
          text: w.labelled(
            label(key, body),
            w.tapeHip({
              length: tapeLength(tapeCm, units),
              where,
              source: sourceSentence(src, inputs.measuredSizes),
              body: room !== null ? { you: youText(bodyCm!, units, est), room: roomText(room, units, est) } : null,
              why: skipped.label,
            }),
          ),
        };
      } else if (raw !== undefined) {
        // No tape: draw the chart girth and say why it is not checked.
        // The engine's own designed-ease rule (garment ease, then block, then category), not a copy.
        const ease = bodyChart ? (easeTargetFor({ ...garment, id: '', brand: '', fabric: { stretchPct: 0 } }, key as Point) ?? 0) : 0;
        const garmentCm = Math.round((raw + ease) * 10) / 10;
        const rx = Math.min(MAX_RX, halfWidthFromGirth(garmentCm, ppc, depthOf(key, body)));
        const room = bodyCm !== undefined ? Math.round((garmentCm - bodyCm) * 10) / 10 : null;
        ring = {
          key, size: sizeFit.size, y, rx, ry: Math.max(2.5, rx * TILT), bodyRx,
          garmentCm, bodyCm: bodyCm ?? null, roomCm: room, band: null, source: 'chart',
          basis: bodyChart ? 'body-chart+ease' : 'garment', bodyEstimated: est,
          chip: [w.notChecked, room !== null ? roomText(room, units, est) : skipped.label],
          text: w.labelled(
            label(key, body),
            w.notCheckedText(skipped.label, room !== null ? { room: roomText(room, units, est), girth: girthText(garmentCm, bodyChart, units), you: youText(bodyCm!, units, est) } : null),
          ),
        };
      }
    }
    if (!ring) continue;
    if (pf && key === 'hip' && inputs?.hip?.girthCm[sizeFit.size] !== undefined) {
      // The engine scored the hip from the chart; the tape girth is added as information only.
      const src = sourceAt(inputs.hip, sizeFit.size);
      ring.text += w.alsoTapeHip(tapeLength(inputs.hip.girthCm[sizeFit.size]!, units), sourceSentence(src, inputs.measuredSizes));
    }
    if (key === 'waist' && elastic) {
      const relaxed = inputs?.band?.relaxedCm[sizeFit.size];
      const stretched = inputs?.band?.stretchedCm[sizeFit.size];
      if (inputs?.band && relaxed !== undefined && stretched !== undefined) {
        const bandSource = sourceAt(inputs.band, sizeFit.size);
        ring.stretch = {
          relaxedCm: relaxed,
          stretchedCm: stretched,
          relaxedRx: Math.min(MAX_RX, halfWidthFromGirth(relaxed, ppc, depthOf('waist', body))),
          stretchedRx: Math.min(MAX_RX, halfWidthFromGirth(stretched, ppc, depthOf('waist', body))),
          source: bandSource,
        };
        // The engine's word stays; the room figure (chart + designed ease minus body) would sit right above a
        // band range that contradicts it, so the chip names its basis instead. The sentence keeps the number.
        // A pull-on size whose stretched band only just passes (or does not pass) the hips: the chip says that, never
        // "Good fit" next to "Only just pulls on" (the engine's waist word scores the chart, not the band over the hips).
        const pullOn = inputs.band.closure === 'pull-on' ? sizeFit.pullOn?.status : undefined;
        if (scored !== null && (pullOn === 'marginal' || pullOn === 'blocked')) {
          ring.chip = [w.waistband, pullOn === 'blocked' ? w.tooSmallToPullOn : w.onlyJustPullsOn];
          ring.pullOn = pullOn;
          // The waist sentence so far is its label and the chart sentence: the band's verdict goes in front of the latter.
          ring.text = w.labelled(label(key, body), pullOn === 'blocked' ? w.bandBlocked(scored) : w.bandMarginal(scored));
        } else if (pf) ring.chip = [ring.chip[0], w.byTheSizeChart];
        ring.chipNote = w.bandChipNote(tapeNumber(relaxed, units), tapeLength(stretched, units), sourceWord(bandSource));
        ring.text += w.bandRange(tapeLength(relaxed, units), tapeLength(stretched, units), sourceSentence(bandSource, inputs.measuredSizes));
        const hip = measurements?.hip;
        const waist = measurements?.waist;
        const sweep = hip !== undefined && waist !== undefined ? bandSweep(inputs.band, sizeFit.size, { waist, hip }) : null;
        if (sweep && inputs.band.closure === 'pull-on') {
          const c = sweep.hipClearanceCm;
          const hipCm = hip as number;
          const closureMeasured = inputs.band.closureSource === 'measured';
          const bandHow = bandSource === 'measured' ? w.bandHow.measured : bandSource === 'assumed' ? w.bandHow.assumed : w.bandHow.estimated;
          const how =
            bandSource === 'measured' && closureMeasured
              ? w.pullOnMeasured
              : bandSource === 'assumed' && !closureMeasured
                ? w.pullOnAllAssumed
                : closureMeasured
                  ? bandHow
                  : w.closureAssumed(bandHow);
          ring.text += c >= 0 ? w.passesHips(roomLength(hipCm, units), roomLength(c, units), how) : w.smallerThanHips(roomLength(-c, units), roomLength(hipCm, units), how);
        }
      } else {
        ring.text += w.bandNotMeasured;
      }
    }
    out.push(ring);
  }
  const sweep = inputs?.hem?.sweepCm[sizeFit.size];
  const y = ringY('hem', garment.category, hemY, body);
  if (inputs?.hem && sweep !== undefined && y !== null) {
    const full = halfWidthFromGirth(sweep, ppc, DEPTH.hem);
    const rx = Math.min(MAX_RX, full);
    const clamped = full > MAX_RX;
    const src = sourceAt(inputs.hem, sizeFit.size);
    out.push({
      key: 'hem', size: sizeFit.size, y, rx, ry: Math.max(2.5, rx * TILT), bodyRx: null,
      garmentCm: sweep, bodyCm: null, roomCm: null, band: null, source: src, basis: 'garment', bodyEstimated: false,
      chip: [w.labels.hem, w.hemChip(tapeLength(sweep, units), sourceWord(src))],
      ...(clamped ? { clamped, chipNote: w.widerThanDrawn } : {}),
      text: w.labelled(w.labels.hem, w.hemText(tapeLength(sweep, units), sourceSentence(src, inputs.measuredSizes), clamped)),
    });
  }
  return out;
}

/** What a scored or chart girth is: the garment's, or (body chart) the body girth plus designed ease. */
function girthText(cm: number, bodyChart: boolean, units: Units): string {
  return bodyChart ? words().girthBodyChart(roomLength(cm, units)) : words().girthGarment(roomLength(cm, units));
}

/** One legend phrase for a tape value of the size on screen: measured, estimated (how), or assumed. */
function sourceNote(source: RingSource, size: string, measuredSizes: readonly string[] = []): string {
  return words().sourceNote[source](size, measuredSizes);
}

function label(key: RingKey, body?: Pick<BodyGeometry, 'family'>): string {
  const labels = words().labels;
  if (key === 'bust' && body?.family === 'male') return labels.chest;
  return labels[key];
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
  // On a men's W/L chart the neighbours are the waists either side at the same leg (slice M2b).
  const before = stepSize(fit, idx, -1);
  const after = stepSize(fit, idx, 1);
  if (before) ghosts.push({ size: before.size, side: 'smaller', rings: ringsFor(input, before) });
  if (after) ghosts.push({ size: after.size, side: 'larger', rings: ringsFor(input, after) });
  const bodyChart = garment.sizeChartType === 'body';
  // Which rings are size-chart girths: all of them without garment inputs; with a tape or an assumed
  // input the hip and hem rings are the garment's own girths, and the first sentence must not cover them.
  const chartRings = selected.rings.filter((r) => r.source === 'chart').map((r) => label(r.key, input.body));
  const w = words().notes;
  const notes = [chartRings.length === 0 ? w.garmentOnly : w.chart({ labels: chartRings, all: chartRings.length === selected.rings.length, bodyChart })];
  if ((input.estimated ?? []).some((k) => (POINTS_FOR[garment.category] ?? []).includes(k as RingKey))) notes.push(w.bodyEstimated);
  // The first tape note says in full where the numbers come from; the next ones use one word.
  let explained = false;
  const how = (source: RingSource): string => {
    if (explained || source === 'assumed') return source === 'assumed' ? w.assumed : sourceWord(source);
    explained = true;
    return sourceNote(source, size, inputs?.measuredSizes);
  };
  const band = inputs?.band;
  if ((garment.stretchZones ?? []).includes('waistband')) notes.push(band ? w.band(sourceAt(band, size) === 'assumed' ? w.bandAssumed : how(sourceAt(band, size))) : w.bandNotMeasured);
  if (inputs?.hip?.girthCm[size] !== undefined && selected.rings.some((r) => r.key === 'hip' && r.source !== 'chart')) notes.push(w.hip(how(sourceAt(inputs.hip, size)), inputs.hip.belowBandCm == null));
  if (inputs?.hem?.sweepCm[size] !== undefined)
    notes.push(w.hem(how(sourceAt(inputs.hem, size)), selected.rings.some((r) => r.key === 'hem' && r.clamped)));
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
  estimated?: readonly string[];
  /** The figure the rings are drawn on (AvatarView's `family`). */
  family?: FigureFamily;
  /** The male figure's shape (AvatarView's `maleShape`). */
  maleShape?: MaleShape;
}

/**
 * `ringOverlay` on the same figure AvatarView draws: the body from the shopper's measurements and
 * the hem where the 2D garment's hem is drawn for that size.
 */
export function ringOverlayFor({ garment, fit, size, measurements, heightCm, inputs = null, units = 'metric', estimated = [], family = 'female', maleShape = 'v1' }: RingOverlayForInput): RingOverlay | null {
  const body = bodyGeometry(measurements, heightCm, family, maleShape === 'v2' ? { maleShape } : {});
  const hemY = garmentGeometry({ garment, gaps: fitGapsForRender(fit, size), body, hemSweepCm: inputs?.hem?.sweepCm[size] ?? null }).hemY;
  return ringOverlay({ garment, fit, size, body, measurements, inputs, hemY, units, estimated });
}
