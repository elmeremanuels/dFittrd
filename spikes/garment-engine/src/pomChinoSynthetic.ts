/**
 * SYNTHETIC chino measurements, W30 to W44 in three leg lengths: invented for the men's chino proof
 * (men-3d-plan slices M3/M4), NOT a product and not measured on any garment.
 *
 * - **The product** (`SYNTHETIC_CHINO_PAYLOAD`) is the SYNTHETIC men's test chino W/L of `@curtain/schema`
 *   (`SYNTHETIC_MENS_CHINO_WL`: W30 to W38 × L30/32/34, every row unchanged), with three more waists
 *   (W40, W42, W44) made by the fixture's own steps (waistband +5 cm per W, seat = waistband + 20.5,
 *   thigh +2.5, front rise +0.5). The fixture stops at W38, whose waistband (98.5 cm) is tight on the
 *   male table's XL and XXL bodies; without the extra waists those two bodies have no size to drape.
 * - **The flat measurements** (`SYNTHETIC_CHINO_POM`) take waist, seat, thigh (girths, halved: laid flat),
 *   front rise and inseam from that chart. Everything a W/L chart does not carry is made up here [A]:
 *   back rise = front rise + 9 cm (36 cm at W34, in the range men's chinos are sold with; chosen so that
 *   the base size reaches the fit engine's worn waist on the male M body with the crotch seam under the
 *   body); knee girth 47 cm at W34, +1.5 per W; leg opening 38 cm at W34, +1 per W; outseam = inseam +
 *   22 cm at W34, +0.5 per W (the builder does not build to it, see `pomChino.ts`).
 */
import { SYNTHETIC_MENS_CHINO_WL, type GarmentPayload, type SizeRow } from '@curtain/schema';
import type { PomChinoRow } from './pomChino';

export const SYNTHETIC_CHINO_LEGS: readonly (readonly [l: string, inseam: number])[] = [['30', 76], ['32', 81], ['34', 86]];
/** The waists added to the fixture's chart (its own steps continued). */
const EXTRA_WAISTS: readonly (readonly [w: string, waistband: number, seat: number, thigh: number, rise: number])[] = [
  ['40', 103.5, 124, 72, 28.5],
  ['42', 108.5, 129, 74.5, 29],
  ['44', 113.5, 134, 77, 29.5],
];

export const SYNTHETIC_CHINO_PAYLOAD: GarmentPayload = Object.freeze({
  ...SYNTHETIC_MENS_CHINO_WL,
  name: 'SYNTHETIC men’s test chino W/L, W30 to W44 (not a product)',
  sizeChart: [
    ...SYNTHETIC_MENS_CHINO_WL.sizeChart,
    ...EXTRA_WAISTS.flatMap(([w, waist, hip, thigh, rise]) => SYNTHETIC_CHINO_LEGS.map(([l, inseam]): SizeRow => ({ size: `${w}/${l}`, waist, hip, thigh, rise, inseam, axes: { waist: w, leg: l } }))),
  ],
}) as GarmentPayload;

/** Assumed [A] measurements a W/L chart does not carry, by waist step from W34. */
export const SYNTHETIC_CHINO_EXTRAS = { backRiseOverFrontCm: 9, kneeGirthCm: 47, kneeGirthPerWaistCm: 1.5, openingGirthCm: 38, openingGirthPerWaistCm: 1, outseamOverInseamCm: 22, outseamPerWaistCm: 0.5, baseWaist: '34' } as const;

export const SYNTHETIC_CHINO_BASE_SIZE = '34/32';

export const SYNTHETIC_CHINO_POM: readonly PomChinoRow[] = Object.freeze(
  SYNTHETIC_CHINO_PAYLOAD.sizeChart.map((r): PomChinoRow => {
    const X = SYNTHETIC_CHINO_EXTRAS;
    const step = (Number(r.axes!.waist) - Number(X.baseWaist)) / 2;
    return {
      size: r.size,
      waistWidthCm: r.waist! / 2,
      frontRiseCm: r.rise!,
      backRiseCm: r.rise! + X.backRiseOverFrontCm,
      seatWidthCm: r.hip! / 2,
      thighWidthCm: r.thigh! / 2,
      kneeWidthCm: (X.kneeGirthCm + X.kneeGirthPerWaistCm * step) / 2,
      legOpeningWidthCm: (X.openingGirthCm + X.openingGirthPerWaistCm * step) / 2,
      inseamCm: r.inseam!,
      outseamCm: r.inseam! + X.outseamOverInseamCm + X.outseamPerWaistCm * step,
    };
  }),
);

/** The male table body each waist is taped on (the body the fit engine gives that waist to, or the nearest). */
export const SYNTHETIC_CHINO_BODY: Readonly<Record<string, 'S' | 'M' | 'L' | 'XL' | 'XXL'>> = { '30': 'S', '32': 'S', '34': 'M', '36': 'L', '38': 'L', '40': 'XL', '42': 'XXL', '44': 'XXL' };
