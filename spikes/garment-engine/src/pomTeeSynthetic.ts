/**
 * SYNTHETIC tee measurements, S to XXL: invented for the M3 tee proof (men-3d-plan), NOT a product
 * and not measured on any garment. They are the flat garment measurements of the SYNTHETIC men's
 * test tee (`SYNTHETIC_MENS_TEE` of @curtain/schema): chest, waist and hem widths are half its chart's
 * `bust`, `waist` and `hip` girths, `shoulder` its shoulder column; length (HPS to hem) and sleeve
 * length step from its 70 / 22 cm at M by typical amounts; the sleeve opening is made up (34 to 42
 * cm round, about 3 to 4 cm of ease over the mannequin's arm at the hem).
 */
import type { PomTeeRow } from './pomTee';

export const SYNTHETIC_TEE_POM: readonly PomTeeRow[] = Object.freeze([
  { size: 'S', chestWidthCm: 49, waistWidthCm: 43, hemWidthCm: 48.25, shoulderCm: 43.5, lengthCm: 68, sleeveLengthCm: 21, sleeveOpeningCm: 17 },
  { size: 'M', chestWidthCm: 53, waistWidthCm: 47, hemWidthCm: 51, shoulderCm: 44, lengthCm: 70, sleeveLengthCm: 22, sleeveOpeningCm: 18 },
  { size: 'L', chestWidthCm: 57, waistWidthCm: 51, hemWidthCm: 54, shoulderCm: 45, lengthCm: 72, sleeveLengthCm: 23, sleeveOpeningCm: 19 },
  { size: 'XL', chestWidthCm: 61, waistWidthCm: 55, hemWidthCm: 57, shoulderCm: 46, lengthCm: 74, sleeveLengthCm: 23.5, sleeveOpeningCm: 20 },
  { size: 'XXL', chestWidthCm: 65.5, waistWidthCm: 59.5, hemWidthCm: 60.25, shoulderCm: 47, lengthCm: 76, sleeveLengthCm: 24, sleeveOpeningCm: 21 },
]);
