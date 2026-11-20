/**
 * On-device fit (AGENTS.md rule 4): `computeFit` from @curtain/fit-engine, memoised per
 * (user body, garment object). Not per garment id: `GarmentPayload.id` is the shop-scoped external
 * id, so two paired shops can share one, and a refreshed catalogue replaces the object. The result never leaves the device; only `sizeAtSwipe`/`fitScore`
 * travel inside a SwipeEvent (D7 allows that) and an intent token when a fit was written.
 */
import { computeFit, sigmaFromBodyProfile, type FitResult, type PointSigma } from '@curtain/fit-engine';
import { toUserBody, type BodyMeasurementKey, type BodyProfile, type GarmentPayload, type UserBody } from '@curtain/schema';
import { fuseProfile } from '@/features/capture/fuse';

export interface FitContext {
  userBody: UserBody;
  sigma: PointSigma | undefined;
}

const cache = new WeakMap<UserBody, WeakMap<GarmentPayload, FitResult>>();

export function fitContextFromProfile(profile: BodyProfile | null): FitContext | null {
  if (!profile) return null;
  const filled = withPriorFill(profile);
  return { userBody: toUserBody(filled), sigma: sigmaFromBodyProfile(filled) };
}

/**
 * Same rule as the standalone embed (docs/STANDALONE.md §1): with height and weight known, the
 * girths the user did not give come from the population prior, marked source 'prior' with its
 * wider sigma, so confidence stays honest. Values the user typed or scanned are never replaced.
 */
export function withPriorFill(profile: BodyProfile): BodyProfile {
  const m = profile.measurements;
  const height = m.height?.mean;
  const weight = m.weight?.mean;
  if (!height || !weight) return profile;
  const fused = fuseProfile({ manual: { height, weight }, manualMethod: 'memory' }).profile.measurements;
  const out = { ...m };
  let added = false;
  for (const [k, v] of Object.entries(fused) as [BodyMeasurementKey, (typeof m)[BodyMeasurementKey]][]) {
    if (v && v.source === 'prior' && !out[k]) {
      out[k] = v;
      added = true;
    }
  }
  return added ? { ...profile, measurements: out } : profile;
}

export function fitFor(ctx: FitContext | null, garment: GarmentPayload): FitResult | null {
  if (!ctx) return null;
  let m = cache.get(ctx.userBody);
  if (!m) {
    m = new WeakMap();
    cache.set(ctx.userBody, m);
  }
  const hit = m.get(garment);
  if (hit) return hit;
  const result = computeFit(garment, ctx.userBody, ctx.sigma ? { sigma: ctx.sigma } : undefined);
  m.set(garment, result);
  return result;
}

/** Does the user have at least one usable measurement? */
export function hasMeasurements(ctx: FitContext | null): boolean {
  return !!ctx && Object.keys(ctx.userBody.measurements).length > 0;
}
