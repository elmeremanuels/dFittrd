/**
 * Labels that depend on a garment's audience (photo-avatar plan, slice 3 "Men v1").
 *
 * The stored fit point stays `bust` for every garment: charts, ease tables, the fit engine and the
 * fit signature all keep that key. Only the word shown to a person changes: "Chest" for men's and
 * unisex garments, "Bust" for women's garments and for garments with no audience (the behaviour
 * from before the field existed). Pure: no DOM, no i18n runtime. A UI with its own translations
 * uses the key (`fitPointLabelKey`) and looks the word up itself.
 */
import type { FitPoint, GarmentAudience } from './garment';

/** A fit point as it is named for a person: the stored points plus `chest`. */
export type FitPointLabelKey = FitPoint | 'chest';

/** `'chest'` for men's and unisex garments, `'bust'` otherwise (women's, absent, unknown values). */
export function bustLabelKey(audience: GarmentAudience | null | undefined): 'bust' | 'chest' {
  return audience === 'men' || audience === 'unisex' ? 'chest' : 'bust';
}

/** The label key of any fit point: `bust` follows the audience, every other point is itself. */
export function fitPointLabelKey(point: FitPoint, audience?: GarmentAudience | null): FitPointLabelKey {
  return point === 'bust' ? bustLabelKey(audience) : point;
}

/** English labels, capitalised as a table header prints them. */
export const FIT_POINT_LABELS_EN: Readonly<Record<FitPointLabelKey, string>> = Object.freeze({
  bust: 'Bust',
  chest: 'Chest',
  waist: 'Waist',
  hip: 'Hip',
  shoulder: 'Shoulder',
  thigh: 'Thigh',
  inseam: 'Inseam',
  foot: 'Foot',
});

/** English label of a fit point for a garment's audience: `fitPointLabel('bust', 'men')` → "Chest". */
export function fitPointLabel(point: FitPoint, audience?: GarmentAudience | null): string {
  return FIT_POINT_LABELS_EN[fitPointLabelKey(point, audience)];
}
