/**
 * Per-point sigma from the on-device BodyProfile (decision D5) for `computeFit(..., { sigma })`.
 * Type-only dependency on @paskamer/schema; the profile never leaves the device.
 */
import type { BodyProfile } from '@paskamer/schema';
import { POINTS } from './constants';
import { positive, round3 } from './math';
import type { PointSigma } from './types';

/**
 * Extract a sigma (cm) per fit point. Foot: sigma of `footLengthCm` (or legacy `foot`), else
 * the `footEu` sigma converted to cm (× 2/3, 3 dp). Points with sigma 0 ("exact") or missing are left
 * out, so the engine treats them deterministically.
 */
export function sigmaFromBodyProfile(profile: BodyProfile): PointSigma {
  const out: PointSigma = {};
  const m = profile?.measurements ?? {};
  for (const point of POINTS) {
    if (point === 'foot') {
      const s = positive(m.footLengthCm?.sigma) ?? positive(m.foot?.sigma);
      if (s !== undefined) out.foot = s;
      else {
        const eu = positive(m.footEu?.sigma);
        if (eu !== undefined) out.foot = round3((eu * 2) / 3);
      }
      continue;
    }
    const s = positive(m[point]?.sigma);
    if (s !== undefined) out[point] = s;
  }
  return out;
}
