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
