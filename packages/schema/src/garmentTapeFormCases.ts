/**
 * Shared cases of the "Garment measurements" form check (`checkGarmentTapeInput`). The WooCommerce
 * plugin's export script writes them, with what the TypeScript check answers, to
 * `packages/woocommerce-plugin/tests/fixtures/garment-tape.json`, and the PHP twin
 * (`Curtain\Garment_Tape::check`) must give the same errors, warnings, measured sizes and filled tape.
 *
 * Every issue code appears at least once. The chart is the pilot skirt's AU body chart.
 */
import type { GarmentTapeFormInput } from './garmentTapeForm';
import type { TapeChartRow } from './garmentTape';

const AU_CHART: readonly TapeChartRow[] = Object.freeze([
  { size: '8', waist: 67.5, hip: 94 },
  { size: '10', waist: 72.5, hip: 99 },
  { size: '12', waist: 77.5, hip: 104 },
  { size: '14', waist: 82.5, hip: 109 },
  { size: '16', waist: 87.5, hip: 114 },
]);
const LETTER_CHART: readonly TapeChartRow[] = Object.freeze([{ size: 'S' }, { size: 'M' }, { size: 'L' }]);

const AU8 = { size: '8', waistRelaxedCm: 67, waistStretchedCm: 94, hipCm: 112, hemSweepCm: 230, lengthCm: 103 };
const AU10 = { size: '10', waistRelaxedCm: 71, waistStretchedCm: 100, hipCm: 122, hemSweepCm: 248, lengthCm: 103 };
const AU14 = { size: '14', waistRelaxedCm: 80, waistStretchedCm: 110, hipCm: 126, hemSweepCm: 260, lengthCm: 104 };

export interface GarmentTapeFormCase {
  name: string;
  input: GarmentTapeFormInput;
}

export const GARMENT_TAPE_FORM_CASES: readonly GarmentTapeFormCase[] = Object.freeze([
  { name: 'nothing entered', input: { category: 'bottom', chart: AU_CHART, closure: null, measured: [] } },
  { name: 'the pilot skirt as the shop sent it (no hip depth)', input: { category: 'bottom', chart: AU_CHART, closure: 'pull-on', measured: [AU8, AU10, AU14] } },
  {
    name: 'the pilot skirt with the hip at 20 cm',
    input: { category: 'bottom', chart: AU_CHART, closure: 'pull-on', measured: [AU8, AU10, AU14].map((r) => ({ ...r, hipDepthBelowBandCm: 20 })) },
  },
  {
    name: 'every size measured, zip',
    input: {
      category: 'bottom',
      chart: AU_CHART,
      closure: 'zip',
      measured: [
        { ...AU8, hipDepthBelowBandCm: 20 },
        { ...AU10, hipDepthBelowBandCm: 20 },
        { size: '12', waistRelaxedCm: 75.5, waistStretchedCm: 105, hipCm: 124, hipDepthBelowBandCm: 20, hemSweepCm: 254, lengthCm: 103.5 },
        { ...AU14, hipDepthBelowBandCm: 20 },
        { size: '16', waistRelaxedCm: 85, waistStretchedCm: 115, hipCm: 130, hipDepthBelowBandCm: 20, hemSweepCm: 266, lengthCm: 104.5 },
      ],
    },
  },
  { name: 'one size measured: only the band is stepped', input: { category: 'bottom', chart: AU_CHART, closure: 'pull-on', measured: [{ ...AU10, hipDepthBelowBandCm: 20 }] } },
  { name: 'pull-on without a stretched band', input: { category: 'bottom', chart: AU_CHART, closure: 'pull-on', measured: [{ size: '8', waistRelaxedCm: 67, lengthCm: 103 }, { size: '14', waistRelaxedCm: 80, lengthCm: 104 }] } },
  {
    name: 'flat widths that were not doubled, and a hip at mixed depths',
    input: {
      category: 'bottom',
      chart: AU_CHART,
      closure: 'drawstring',
      measured: [
        { size: '8', waistRelaxedCm: 33.5, waistStretchedCm: 47, hipCm: 56, hipDepthBelowBandCm: 18, hemSweepCm: 115 },
        { size: '16', waistRelaxedCm: 84, waistStretchedCm: 115, hipCm: 128, hipDepthBelowBandCm: 20, hemSweepCm: 262 },
      ],
    },
  },
  {
    name: 'a larger size smaller than a smaller one',
    input: { category: 'bottom', chart: AU_CHART, closure: 'button', measured: [{ ...AU8, hipDepthBelowBandCm: 20 }, { ...AU10, hipCm: 108, hipDepthBelowBandCm: 20 }, { ...AU14, hipDepthBelowBandCm: 20 }] },
  },
  {
    name: 'mistakes that stop a save',
    input: {
      category: 'bottom',
      chart: AU_CHART,
      closure: 'velcro',
      measured: [
        { size: '18', waistRelaxedCm: 90 },
        { size: '8', waistRelaxedCm: 67 },
        { size: ' 8 ', waistRelaxedCm: 68 },
        { size: '10' },
        { size: '12', waistRelaxedCm: -3, hipCm: 700 },
        { size: '14', waistRelaxedCm: 80, waistStretchedCm: 78 },
        { size: '16', waistRelaxedCm: 85, hipCm: 130, hipDepthBelowBandCm: 95 },
      ],
    },
  },
  { name: 'text where a number belongs', input: { category: 'bottom', chart: AU_CHART, closure: 'pull-on', measured: [{ size: '8', waistRelaxedCm: 'about 67' as unknown as number, hipCm: 112, hipDepthBelowBandCm: 'twenty' as unknown as number }] } },
  { name: 'no size chart yet', input: { category: 'bottom', chart: [], closure: 'pull-on', measured: [AU8] } },
  { name: 'a dress (not a bottom), letter sizes by row', input: { category: 'dress', chart: LETTER_CHART, closure: 'zip', measured: [{ size: 's', waistRelaxedCm: 70, hipCm: 96, hipDepthBelowBandCm: 20 }, { size: 'L', waistRelaxedCm: 82, hipCm: 108, hipDepthBelowBandCm: 20 }] } },
  { name: 'measured but no closure', input: { category: 'bottom', chart: AU_CHART, measured: [AU8, AU14] } },
  { name: 'a closure only', input: { category: 'bottom', chart: AU_CHART, closure: 'wrap', measured: [] } },
]);
