/**
 * The 3D-readiness check of a validated shop product (D13 photo contract): a front and a back photo
 * without a model, on a plain background, garment fully visible, long edge at least `minLongEdge`;
 * a base size; a fabric. Shared by `shopCli.ts` (bohohippychic) and `shopImportCli.ts` (adapters).
 * Pure, no I/O.
 */
import type { ImageClassification } from './shopSelection';

export interface ImageRecord extends ImageClassification {
  url: string;
  width: number;
  height: number;
  file: string | null;
  sha256: string | null;
  bytes: number | null;
}

export function threeDReadiness(
  images: readonly ImageRecord[],
  baseSize: string | undefined,
  baseSizeFromShop: boolean,
  hasFabric: boolean,
  minLongEdge: number,
): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const usable = (role: string) =>
    images.filter((i) => i.role === role && !i.onModel && i.background === 'plain' && i.garmentFullyVisible && Math.max(i.width, i.height) >= minLongEdge);
  for (const role of ['front', 'back'] as const) {
    if (usable(role).length) continue;
    const any = images.filter((i) => i.role === role);
    if (!any.length) reasons.push(`add a ${role} photo`);
    else {
      const why = new Set<string>();
      for (const i of any) {
        if (i.onModel) why.add('worn by a model');
        if (i.background !== 'plain') why.add('busy background');
        if (!i.garmentFullyVisible) why.add('garment partly hidden');
        if (Math.max(i.width, i.height) < minLongEdge) why.add(`long edge ${Math.max(i.width, i.height)} px < ${minLongEdge}`);
      }
      reasons.push(`${role} photo does not meet the contract (${[...why].join(', ')}); add one on a hanger, flat-lay or ghost mannequin`);
    }
  }
  let soft = 0;
  if (!baseSize) reasons.push('set the base size');
  else if (!baseSizeFromShop) {
    reasons.push(`base size ${baseSize} is our default, not confirmed by the shop`);
    soft = 1;
  }
  if (!hasFabric) reasons.push('add the fabric');
  return { ready: reasons.length === soft, reasons };
}
