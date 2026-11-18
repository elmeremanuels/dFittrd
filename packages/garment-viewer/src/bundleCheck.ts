/**
 * The bundle check on the device, after download: the same rules the api applies on import and
 * before it hands out an asset ref (`checkGarmentBundle` in @curtain/schema), the body family
 * included (a men's garment takes a male-built bundle only, every other garment a female-built one).
 * `null` means fall back to today's flow.
 */
import { garmentBundleFor, sizeLabelKey, type GarmentBundleInfo, type GarmentBundleMeta, type GarmentPayload } from '@curtain/schema';

export function checkBundle(meta: GarmentBundleMeta, garment: Pick<GarmentPayload, 'sizeChart' | 'audience'>): GarmentBundleInfo | null {
  return garmentBundleFor(meta, garment);
}

/** The grading label for a shop size label (same `sizeLabelKey`), or `null`. */
export function gradingLabel(sizes: readonly string[], size: string): string | null {
  const key = sizeLabelKey(size);
  return sizes.find((s) => sizeLabelKey(s) === key) ?? null;
}
