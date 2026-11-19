/**
 * The bundle check on the device, after download: the same rules the api applies on import and
 * before it hands out an asset ref (`checkGarmentBundle` in @curtain/schema), the body family
 * included (a men's garment takes a male-built bundle only, every other garment a female-built one),
 * and for a male bundle the male body shape it was built on.
 * `null` means fall back to today's flow.
 */
import { garmentBundleFor, sizeLabelKey, type GarmentBundleInfo, type GarmentBundleMeta, type GarmentMaleShape, type GarmentPayload } from '@curtain/schema';

/**
 * With `maleShape` (the male body shape the viewer draws, `MountOptions.maleShape`), a male bundle built on the other
 * shape is refused too (`bundleMaleShape`): a tee built on v1 strains at the armholes of the v2 body, and the reverse.
 */
export function checkBundle(meta: GarmentBundleMeta, garment: Pick<GarmentPayload, 'sizeChart' | 'audience'>, maleShape?: GarmentMaleShape): GarmentBundleInfo | null {
  return garmentBundleFor(meta, garment, maleShape);
}

/** The grading label for a shop size label (same `sizeLabelKey`), or `null`. */
export function gradingLabel(sizes: readonly string[], size: string): string | null {
  const key = sizeLabelKey(size);
  return sizes.find((s) => sizeLabelKey(s) === key) ?? null;
}
