/**
 * Two men's fixture products and three male test bodies (photo-avatar plan, slice 3 "Men v1").
 *
 * Kept OUT of `MOCK_GARMENTS`: the demo deck, the seeded demo shop and many tests count that list,
 * and every 3D bundle today is built on the women's mannequin. Import these by name.
 *
 * The products are invented (brand "Noordman" does not exist). Their size charts are the generic
 * men's templates of `chartTemplatesMen.ts`, so they show what a shop gets when it assigns a
 * template and enters nothing else. The bodies are invented round numbers for tests, not survey
 * data: a slim, a medium and a broad man.
 */
import type { UserBody } from '../body';
import { chartFromBodyTemplate } from '../chartTemplates';
import { MENS_JEANS_WL_BODY_TEMPLATE, MENS_LETTER_BODY_TEMPLATE } from '../chartTemplatesMen';
import type { GarmentPayload } from '../garment';
import { garment } from './helpers';

export const MENS_OXFORD_SHIRT: GarmentPayload = garment({
  id: 'noordman-shirt-01',
  brand: 'Noordman',
  name: "Men's Oxford Button-Down Shirt",
  category: 'top',
  subcategory: 'shirt',
  audience: 'men',
  priceEur: 79,
  primaryColorHex: '#DCE6F2',
  colorways: [
    { name: 'Light blue', hex: '#DCE6F2', sku: 'NM-OX-LBL' },
    { name: 'White', hex: '#FAFAF7', sku: 'NM-OX-WHT' },
  ],
  fabric: { primary: 'cotton', blend: [['cotton', 100]], weightGsm: 140, stretchPct: 0, drape: 0.35, opacity: 0.95, sheen: 0.05 },
  patternBlock: 'shirt',
  lengthCm: { back_length: 76, sleeve_length: 65 },
  ...chartFromBodyTemplate(MENS_LETTER_BODY_TEMPLATE, MENS_LETTER_BODY_TEMPLATE.sizes),
  sizingNotes: 'true to size',
  trueToSizeScore: 0.8,
  criticalFitPoints: ['bust'],
  styleTags: { classic: 0.8, minimal: 0.4 },
});

export const MENS_STRAIGHT_JEANS: GarmentPayload = garment({
  id: 'noordman-jeans-01',
  brand: 'Noordman',
  name: "Men's Straight Jeans",
  category: 'bottom',
  subcategory: 'straight',
  audience: 'men',
  priceEur: 119,
  primaryColorHex: '#2B3A55',
  colorways: [{ name: 'Indigo', hex: '#2B3A55', sku: 'NM-JN-IND' }],
  fabric: { primary: 'denim', blend: [['cotton', 98], ['elastane', 2]], weightGsm: 400, stretchPct: 2, drape: 0.2, opacity: 1, sheen: 0.05 },
  patternBlock: 'straight',
  lengthCm: { rise: 27 },
  ...chartFromBodyTemplate(MENS_JEANS_WL_BODY_TEMPLATE),
  sizingNotes: 'true to size',
  trueToSizeScore: 0.8,
  criticalFitPoints: ['waist'],
  styleTags: { classic: 0.6, minimal: 0.5 },
});

/**
 * SYNTHETIC test garment, not a product (men-3d-plan slice M1): a plain short-sleeved tee whose only
 * job is to prove the male path end to end (spike bundle on the male mannequin → api import → the
 * men's gate → the embed's 3D view). Its 3D bundle is generated geometry
 * (`pnpm --filter @curtain/garment-spike build:bundle`, `out/synthetic-men-tee/`), not a
 * reconstruction of any garment, and it must never be sold, seeded in a live shop or shown as fit
 * evidence.
 *
 * The chart is a GARMENT chart in cm, made up for the test: the male family's size table of
 * `@curtain/mannequin` (`MALE_REFERENCE`, chest 90/98/106/114/123) plus the men's tee eases the plan
 * proposes in section 4 (chest and waist +8 cm, [A]); seat +6 cm and the shoulder seam to seam at
 * biacromial + 3.5 cm are equally assumed. None of it is measured.
 */
export const SYNTHETIC_MENS_TEE: GarmentPayload = garment({
  id: 'synthetic-men-tee',
  brand: 'Curtain test fixture',
  name: 'SYNTHETIC men’s test tee (not a product)',
  category: 'top',
  subcategory: 't-shirt',
  audience: 'men',
  // A price is required by the schema; this is not for sale.
  priceEur: 1,
  primaryColorHex: '#3E6E8E',
  colorways: [{ name: 'Test blue', hex: '#3E6E8E' }],
  fabric: { primary: 'cotton', blend: [['cotton', 100]], weightGsm: 180, stretchPct: 8, drape: 0.35, opacity: 1, sheen: 0 },
  patternBlock: 't-shirt',
  lengthCm: { shoulder_to_hem: 70, sleeve_length: 22 },
  sizeChartType: 'garment',
  sizeChart: [
    { size: 'S', bust: 98, waist: 86, hip: 96.5, shoulder: 43.5 },
    { size: 'M', bust: 106, waist: 94, hip: 102, shoulder: 44 },
    { size: 'L', bust: 114, waist: 102, hip: 108, shoulder: 45 },
    { size: 'XL', bust: 122, waist: 110, hip: 114, shoulder: 46 },
    { size: 'XXL', bust: 131, waist: 119, hip: 120.5, shoulder: 47 },
  ],
  sizingNotes: 'synthetic test fixture: not a product, not fit evidence',
  criticalFitPoints: ['bust'],
});

const CHINO_WAISTS: readonly (readonly [w: string, waistband: number, seat: number, thigh: number, rise: number])[] = [
  ['30', 78.5, 99, 59.5, 26],
  ['32', 83.5, 104, 62, 26.5],
  ['34', 88.5, 109, 64.5, 27],
  ['36', 93.5, 114, 67, 27.5],
  ['38', 98.5, 119, 69.5, 28],
];
const CHINO_LEGS: readonly (readonly [l: string, inseam: number])[] = [
  ['30', 76],
  ['32', 81],
  ['34', 86],
];

/**
 * SYNTHETIC test garment, not a product (men-3d-plan slice M2b): regular chinos on a two-dimensional
 * W/L GARMENT chart, 5 waists × 3 lengths, every row with `axes`. All numbers are made up for the
 * test vectors MT6–MT9 and MT13 [A]: waistband 78.5 at W30 stepping 5 cm per W (about the W label in
 * cm plus 2), seat = waistband + 20.5, thigh steps 2.5, front rise 26–28; inseams 76 / 81 / 86 (the
 * plan's MT9 values, equal to the OTTO and Rab inside legs of L30 / L32 / L34 in
 * `chartTemplatesMen.ts`). Never sold, never fit evidence.
 */
export const SYNTHETIC_MENS_CHINO_WL: GarmentPayload = garment({
  id: 'synthetic-men-chino-wl',
  brand: 'Curtain test fixture',
  name: 'SYNTHETIC men’s test chino W/L (not a product)',
  category: 'bottom',
  subcategory: 'chino',
  audience: 'men',
  priceEur: 1,
  primaryColorHex: '#B89F7A',
  colorways: [{ name: 'Test stone', hex: '#B89F7A' }],
  fabric: { primary: 'cotton', blend: [['cotton', 98], ['elastane', 2]], weightGsm: 260, stretchPct: 2, drape: 0.3, opacity: 1, sheen: 0 },
  patternBlock: 'straight',
  sizeChartType: 'garment',
  sizeChart: CHINO_WAISTS.flatMap(([w, waist, hip, thigh, rise]) =>
    CHINO_LEGS.map(([l, inseam]) => ({ size: `${w}/${l}`, waist, hip, thigh, rise, inseam, axes: { waist: w, leg: l } })),
  ),
  sizingNotes: 'synthetic test fixture: not a product, not fit evidence',
  criticalFitPoints: ['waist'],
});

/**
 * Men's reference body MREF (men-3d-plan §4 "New test vectors"): the male family's M row of
 * `@curtain/mannequin` (chest 98, natural waist 86, seat 96 [M], thigh 58.5, neck 39.5, biacromial
 * 40.5, stature 174, inside leg 84) and EN arm length 64.5 [A, interpolated between 64 at 172 cm and
 * 65 at 176 cm]. Chest in `bust`, seat in `hip`, arm length in `sleeve`, biacromial in `shoulder`.
 */
export const MENS_REFERENCE_BODY: UserBody = Object.freeze({
  measurements: Object.freeze({ bust: 98, waist: 86, hip: 96, thigh: 58.5, neck: 39.5, shoulder: 40.5, inseam: 84, sleeve: 64.5 }),
  heightCm: 174,
}) as UserBody;

/** The real-looking men's fixtures (the synthetic test tee is not one of them; import it by name). */
export const MENS_FIXTURE_GARMENTS: readonly GarmentPayload[] = Object.freeze([MENS_OXFORD_SHIRT, MENS_STRAIGHT_JEANS]);

export interface MensTestBody {
  id: 'slim' | 'medium' | 'broad';
  description: string;
  body: UserBody;
}

/** Chest goes in `bust` and seat in `hip`, as everywhere else. Invented test values, in cm. */
export const MENS_TEST_BODIES: readonly MensTestBody[] = Object.freeze([
  {
    id: 'slim',
    description: 'Slim: chest 92, waist 78, seat 94, shoulder 44, thigh 54, inside leg 84',
    body: { measurements: { bust: 92, waist: 78, hip: 94, shoulder: 44, thigh: 54, inseam: 84 } },
  },
  {
    id: 'medium',
    description: 'Medium: chest 102, waist 90, seat 102, shoulder 46.5, thigh 59, inside leg 81',
    body: { measurements: { bust: 102, waist: 90, hip: 102, shoulder: 46.5, thigh: 59, inseam: 81 } },
  },
  {
    id: 'broad',
    description: 'Broad: chest 118, waist 112, seat 116, shoulder 50, thigh 66, inside leg 78',
    body: { measurements: { bust: 118, waist: 112, hip: 116, shoulder: 50, thigh: 66, inseam: 78 } },
  },
]);
