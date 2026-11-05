/**
 * On-device fit (AGENTS.md rule 4): `computeFit` from @paskamer/fit-engine, memoised per
 * (user body, garment object). Not per garment id: `GarmentPayload.id` is the shop-scoped external
 * id, so two paired shops can share one, and a refreshed catalogue replaces the object. The result never leaves the device; only `sizeAtSwipe`/`fitScore`
 * travel inside a SwipeEvent (D7 allows that) and an intent token when a fit was written.
 */
import { computeFit, sigmaFromBodyProfile, type FitResult, type PointSigma } from '@paskamer/fit-engine';
import { toUserBody, type BodyProfile, type GarmentPayload, type UserBody } from '@paskamer/schema';

export interface FitContext {
  userBody: UserBody;
  sigma: PointSigma | undefined;
}

const cache = new WeakMap<UserBody, WeakMap<GarmentPayload, FitResult>>();

export function fitContextFromProfile(profile: BodyProfile | null): FitContext | null {
  if (!profile) return null;
  return { userBody: toUserBody(profile), sigma: sigmaFromBodyProfile(profile) };
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
