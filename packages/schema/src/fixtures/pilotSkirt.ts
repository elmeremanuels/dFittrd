/**
 * The pilot pull-on skirt: Crimson Wildflower Maxi Skirt (Boho Hippy Chic), with the shop's tape
 * measurements of 13 Nov 2026 (spikes/garment-engine/data/bohohippychic/tape/). NOT part of
 * MOCK_GARMENTS: it exists for the fit engine's pull-on test vectors and as the worked example of
 * `garmentTape`.
 *
 * Measured: AU 8, 10 and 14. AU 12 is interpolated and AU 16 extrapolated by `fillGarmentTape`.
 * The depth at which the shop measured the hip is not known, so no depth is stored.
 * Closure: pull-on elastic band, no zip, no drawstring (the founder's answer of 15 Nov 2026, not
 * yet confirmed with the shop). Price and colour are placeholders; the chart is the shop's AU body
 * chart as imported (spikes/garment-engine/data/bohohippychic/products.json).
 */
import type { GarmentPayload } from '../garment';
import { fillGarmentTape, type MeasuredTapeRow } from '../garmentTape';
import { garment } from './helpers';

export const PILOT_SKIRT_TAPE_MEASURED: readonly MeasuredTapeRow[] = Object.freeze([
  { size: '8', waistRelaxedCm: 67, waistStretchedCm: 94, hipCm: 112, hemSweepCm: 230, lengthCm: 103 },
  { size: '10', waistRelaxedCm: 71, waistStretchedCm: 100, hipCm: 122, hemSweepCm: 248, lengthCm: 103 },
  { size: '14', waistRelaxedCm: 80, waistStretchedCm: 110, hipCm: 126, hemSweepCm: 260, lengthCm: 104 },
]);

/** The skirt as the engine saw it before the tape fields existed: body chart only. */
export const PILOT_SKIRT_CHART_ONLY: GarmentPayload = garment({
  id: '10894387020081',
  brand: 'Boho Hippy Chic',
  name: 'Crimson Wildflower Maxi Skirt',
  category: 'bottom',
  subcategory: 'maxi-skirt',
  priceEur: 0,
  primaryColorHex: '#A8323E',
  fabric: { primary: 'viscose', weightGsm: 165, stretchPct: 1.5, drape: 0.85, opacity: 0.8, sheen: 0.3 },
  patternBlock: 'a-line',
  lengthCm: { waist_to_hem: 103.3 },
  sizeChartType: 'body',
  sizeChart: [
    { size: '8', bust: 85, waist: 67.5, hip: 94 },
    { size: '10', bust: 90, waist: 72.5, hip: 99 },
    { size: '12', bust: 95, waist: 77.5, hip: 104 },
    { size: '14', bust: 100, waist: 82.5, hip: 109 },
    { size: '16', bust: 105, waist: 87.5, hip: 114 },
  ],
  sizingNotes: 'Available in Australian sizes 8 to 16 True to size with comfortable stretch at the waist.',
  stretchZones: ['waistband'],
});

/** The same skirt with its closure and the tape measurements of all five sizes (two of them filled in). */
export const PILOT_PULL_ON_SKIRT: GarmentPayload = {
  ...PILOT_SKIRT_CHART_ONLY,
  closure: 'pull-on',
  garmentTape: fillGarmentTape(PILOT_SKIRT_CHART_ONLY.sizeChart, PILOT_SKIRT_TAPE_MEASURED),
};
