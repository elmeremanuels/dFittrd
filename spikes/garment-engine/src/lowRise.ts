/**
 * The low-rise waist reading (option a of the run 17d skirt decision): an explicit, recorded founder choice, never a default.
 *
 * The shop prints no garment chart for its skirts: their size option is mapped onto our AU women's BODY chart (`AU_WOMENS_BODY_CHART`,
 * median of Country Road, Seed Heritage and Blue Illusion), whose "waist" is the body's natural waist, the narrowest girth, our
 * waist ring. The chart's waist plus ease is what the waistband must measure IF the band is worn at the waist. Run 17d's maxi
 * skirt band sits lower (its top edge 4.0 cm under our waist ring in both stills and every frame), where the body is wider, so
 * nothing in the chart says what that band should measure. Two honest readings:
 *
 *  - natural (the default): the chart's waist is read at the waist ring; a band that does not reach it has no girth there and
 *    chart agreement fails (what the import gate refuses);
 *  - low-rise (this file, only when the founder records the choice): the skirt is accepted as worn low. The band girth is taken
 *    where the band is (`waistbandGirth`, 1.5 cm under its top edge) and compared with the chart's waist plus ease PLUS a stated
 *    offset: how much wider the mannequin's own torso is at the band's height than at the waist ring (its ellipse, the body the
 *    chart describes), i.e. the same ease over a lower ring. The offset, both heights and the decision are written into the
 *    report and qa.json (`chartAgreement.waistReading`), and the import gate surfaces it (`checkGarmentBundle` qaFlags).
 *
 * What it does not do: move the band to the waist, invent a girth at the waist ring, or loosen the tolerance.
 */
import { ellipseCircumference } from '@curtain/anchors';
import type { Mannequin } from '@curtain/mannequin';
import { WAISTBAND, type WaistbandGirth } from './waistband';

/** A founder's recorded choice to read a bottom's chart waist at its own (lower) band. */
export interface WaistReadingChoice {
  kind: 'low-rise';
  /** Who decided and when, as recorded (data/bohohippychic/review.json `waistReading.decision`). Required: no anonymous switch. */
  decision: string;
}

export interface LowRiseWaist {
  kind: 'low-rise';
  decision: string;
  /** Height of the band's tape (the plane 1.5 cm under the top edge, at its centre) and of our waist ring, cm above the floor. */
  bandYCm: number;
  waistRingYCm: number;
  /** How far below the waist ring the band is measured, cm. */
  dropCm: number;
  /** The mannequin's torso girth at the waist ring and at the band's height (its ellipse), cm. */
  bodyAtWaistCm: number;
  bodyAtBandCm: number;
  /** bodyAtBand − bodyAtWaist: added to the chart's waist (with ease) for the band's target, cm. Stated, never hidden. */
  offsetCm: number;
  /** The chart's waist with ease, and the target at the band (chart + offset), cm. */
  chartWaistCm: number;
  targetCm: number;
  note: string;
}

const r2 = (x: number): number => Math.round(x * 100) / 100 + 0;

/** The stated offset and target for a band measured below the waist ring, or null without a band girth (an open band is never read low-rise). */
export function lowRiseWaist(m: Mannequin, band: WaistbandGirth, chartWaistCm: number, choice: WaistReadingChoice): LowRiseWaist | null {
  if (choice.kind !== 'low-rise' || !choice.decision.trim() || band.girthCm === null) return null;
  const bandY = band.centreY - WAISTBAND.belowCm;
  const waistY = m.morphHeights.waist;
  const at = (y: number): number | null => {
    const t = m.torsoAt(y);
    return t ? ellipseCircumference(t.a, t.b) : null;
  };
  const bw = at(waistY), bb = at(bandY);
  if (bw === null || bb === null) return null;
  const offset = bb - bw;
  return {
    kind: 'low-rise',
    decision: choice.decision,
    bandYCm: r2(bandY),
    waistRingYCm: r2(waistY),
    dropCm: r2(waistY - bandY),
    bodyAtWaistCm: r2(bw),
    bodyAtBandCm: r2(bb),
    offsetCm: r2(offset),
    chartWaistCm: r2(chartWaistCm),
    targetCm: r2(chartWaistCm + offset),
    note: `LOW-RISE READING (founder decision: ${choice.decision}): the chart's waist (${r2(chartWaistCm)} cm with ease, the body's natural waist at our waist ring, ${r2(waistY)} cm) is compared at the band, ${r2(waistY - bandY)} cm lower (${r2(bandY)} cm), with the body's own widening there added: mannequin torso ${r2(bb)} cm at the band against ${r2(bw)} cm at the waist ring, offset ${offset >= 0 ? '+' : ''}${r2(offset)} cm, target ${r2(chartWaistCm + offset)} cm. Not the shop's number: the shop prints no garment chart and its size maps onto our AU body chart`,
  };
}
