/**
 * SYNTHETIC babydoll dress, AU 8 to 16: invented for the second garment of the tape route
 * (docs/reports/claude/dress-from-tape.md). NOT a product and not measured on any garment: nobody
 * laid a tape on anything. The numbers are of the kind a shop would write for a woven strap dress
 * with an underbust seam and a gathered skirt (the pilot shop sells one, the Azure Palm Baby Doll
 * Dress; none of its numbers are used here, and none are known).
 *
 * Three sizes play the part of "measured" (AU 8, 12, 16). AU 10 and AU 14 are filled by the labelled
 * rule of the skirt's tape (`fillGarmentTape` of @curtain/schema, spike §8): a size between two
 * measured sizes is the straight line between them on the AU size number, and is labelled
 * `interpolated`. No size lies outside the measured ones, so nothing is extrapolated.
 *
 * How the numbers were chosen [A]: bust = the AU body chart's bust + 7 cm of ease; seam = the
 * mannequin's underbust at that size + about 4.5 cm; skirt panel = 1.5 times the seam; hem sweep 168
 * to 192 cm; length 70 to 74 cm (above the knee on a 168 cm body); strap and bodice length so that on
 * the size's own chart body the top edge lies about 1.7 cm above the mannequin's bust line and the
 * seam on its underbust. That last choice is forced by the body, not free: the v0 female mannequin's
 * armpit is 3.8 cm above its bust line and its torso widens again right above the bust, so there is a
 * band of about 2 cm in which a level top edge can lie at all.
 */
import { GARMENT_SCHEMA_VERSION, type GarmentPayload } from '@curtain/schema';
import type { PomDressKey, PomDressRow } from './pomDress';

export type DressTapeProvenance = 'measured' | 'interpolated';

/** The rows that play "measured" (SYNTHETIC: invented, see above). */
export const SYNTHETIC_DRESS_MEASURED: readonly PomDressRow[] = Object.freeze([
  { size: '8', bustWidthCm: 46, seamWidthCm: 38.5, skirtTopWidthCm: 57.5, hemWidthCm: 84, lengthCm: 70, bodiceLengthCm: 8.5, strapLengthCm: 45, necklineWidthCm: 15 },
  { size: '12', bustWidthCm: 51, seamWidthCm: 43, skirtTopWidthCm: 64.5, hemWidthCm: 90, lengthCm: 72, bodiceLengthCm: 9, strapLengthCm: 47, necklineWidthCm: 16 },
  { size: '16', bustWidthCm: 56, seamWidthCm: 47.5, skirtTopWidthCm: 71, hemWidthCm: 96, lengthCm: 74, bodiceLengthCm: 9.5, strapLengthCm: 49, necklineWidthCm: 17 },
]);

export const SYNTHETIC_DRESS_SIZES = ['8', '10', '12', '14', '16'] as const;

const KEYS: readonly PomDressKey[] = ['bustWidthCm', 'seamWidthCm', 'skirtTopWidthCm', 'hemWidthCm', 'lengthCm', 'bodiceLengthCm', 'strapLengthCm', 'necklineWidthCm'];

/**
 * Every size of `sizes` (AU size numbers) from the measured rows: a measured size as it is; a size between two measured
 * ones on the straight line between them, rounded to 0.25 cm (flat widths) and labelled `interpolated`. A size outside
 * the measured ones is refused: this rule does not extrapolate.
 */
export function fillDressTape(sizes: readonly string[], measured: readonly PomDressRow[]): { rows: PomDressRow[]; provenance: Record<string, DressTapeProvenance> } {
  const known = [...measured].sort((a, b) => Number(a.size) - Number(b.size));
  const provenance: Record<string, DressTapeProvenance> = {};
  const rows = sizes.map((size) => {
    const own = known.find((r) => r.size === size);
    if (own) {
      provenance[size] = 'measured';
      return { ...own };
    }
    const n = Number(size);
    const hi = known.findIndex((r) => Number(r.size) > n);
    if (!Number.isFinite(n) || hi <= 0) throw new Error(`dress tape: size ${size} lies outside the measured sizes; measure it`);
    const a = known[hi - 1]!, b = known[hi]!;
    const t = (n - Number(a.size)) / (Number(b.size) - Number(a.size));
    const row: PomDressRow = { ...a, size };
    for (const k of KEYS) {
      const x = a[k], y = b[k];
      if (typeof x === 'number' && typeof y === 'number') row[k] = Math.round((x + (y - x) * t) * 4) / 4;
    }
    provenance[size] = 'interpolated';
    return row;
  });
  return { rows, provenance };
}

export const SYNTHETIC_DRESS_TAPE = fillDressTape(SYNTHETIC_DRESS_SIZES, SYNTHETIC_DRESS_MEASURED);
export const SYNTHETIC_DRESS_POM: readonly PomDressRow[] = Object.freeze(SYNTHETIC_DRESS_TAPE.rows);

export const SYNTHETIC_DRESS_ID = 'synthetic-tape-babydoll-dress';
export const SYNTHETIC_DRESS_COLOR = '#2F7F86';

/**
 * The product the dress is seeded as: a GARMENT chart whose only column is the bust girth of the tape (2 × the flat
 * width), so the fit engine's bust slack is the tape's and the 3D view places the bodice where it was built. Waist and hip
 * are left out on purpose: the skirt is loose there and the tape has no number at those levels.
 */
export const SYNTHETIC_TAPE_DRESS: GarmentPayload = {
  schemaVersion: GARMENT_SCHEMA_VERSION,
  id: SYNTHETIC_DRESS_ID,
  brand: 'Curtain test fixture',
  name: 'SYNTHETIC babydoll dress from tape (not a product)',
  category: 'dress',
  subcategory: 'babydoll',
  audience: 'women',
  // A price is required by the schema; this is not for sale.
  priceEur: 1,
  primaryColorHex: SYNTHETIC_DRESS_COLOR,
  colorways: [{ name: 'Test teal', hex: SYNTHETIC_DRESS_COLOR }],
  fabric: { primary: 'viscose', blend: [['viscose', 100]], weightGsm: 140, stretchPct: 1.5, drape: 0.8, opacity: 0.9, sheen: 0.2 },
  patternBlock: 'empire',
  closure: 'zip',
  lengthCm: { shoulder_to_hem: 86 },
  sizeChartType: 'garment',
  sizeChart: SYNTHETIC_DRESS_POM.map((r) => ({ size: r.size, bust: 2 * r.bustWidthCm })),
  sizingNotes: 'synthetic test fixture: not a product, not fit evidence',
  criticalFitPoints: ['bust'],
  productPhotos: ['https://placehold.co/800x1000/F5EFE7/1A1612.png?text=SYNTHETIC'],
  flatLayPhoto: 'https://placehold.co/1000x1000/FFFFFF/1A1612.png?text=SYNTHETIC',
};
