/**
 * MOCK_GARMENTS — 41 realistic GarmentPayload v1 fixtures across all six categories and twelve
 * brands. Used by the web app's dev deck, the fit/taste engine tests and the plugin examples.
 * Photo URLs are placehold.co placeholders.
 */
import type { GarmentCategory, GarmentPayload } from '../garment';
import { ACCESSORIES } from './accessories';
import { BOTTOMS } from './bottoms';
import { DRESSES } from './dresses';
import { OUTERWEAR } from './outerwear';
import { SHOES } from './shoes';
import { TOPS } from './tops';

export { DRESSES, TOPS, BOTTOMS, OUTERWEAR, SHOES, ACCESSORIES };
export { grade, garment, productPhoto, flatLay } from './helpers';
export * from './charts';
export type { GarmentSeed } from './helpers';

export const MOCK_GARMENTS: readonly GarmentPayload[] = Object.freeze([
  ...DRESSES,
  ...TOPS,
  ...BOTTOMS,
  ...OUTERWEAR,
  ...SHOES,
  ...ACCESSORIES,
]);

export const MOCK_GARMENTS_BY_ID: Readonly<Record<string, GarmentPayload>> = Object.freeze(
  Object.fromEntries(MOCK_GARMENTS.map((g) => [g.id, g])),
);

export const MOCK_GARMENTS_BY_CATEGORY: Readonly<Record<GarmentCategory, readonly GarmentPayload[]>> = Object.freeze({
  dress: DRESSES,
  top: TOPS,
  bottom: BOTTOMS,
  outerwear: OUTERWEAR,
  shoes: SHOES,
  accessory: ACCESSORIES,
});

/** The three prototype items (apps/web constants.ts), in prototype order. */
export const PROTOTYPE_GARMENT_IDS = ['aalter-studio-1', 'monochrome-02', 'raw-denim-01'] as const;

export function mockGarment(id: string): GarmentPayload {
  const g = MOCK_GARMENTS_BY_ID[id];
  if (!g) throw new Error(`unknown mock garment '${id}'`);
  return g;
}
