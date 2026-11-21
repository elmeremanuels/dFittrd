/**
 * Loader of the realistic body spike (`realisticBody.ts`): one GET of a static asset, then the fit on the device. Kept
 * apart and loaded with `import()` only when a host asks for `bodyShape: 'realistic-spike'`, so the default viewer
 * neither carries nor fetches it. No shopper data is in the request: it is the same file for everyone, fetched without
 * credentials or referrer; the measurements stay in memory (D3).
 */
import { decodeRealisticBody, fitRealisticBody, fitTargetOf, type FitResult, type RealisticBodyAsset } from './realisticBody';
import type { Mannequin } from '@curtain/mannequin';
import type { AnchorRing } from '@curtain/anchors';

/** The baked female body shipped with the package (`assets/realistic-body/`, CC0, PROVENANCE.md next to it). */
export const REALISTIC_BODY_URL = new URL('../assets/realistic-body/female-v1.crb', import.meta.url).href;

export type FetchBytes = (url: string) => Promise<{ ok: boolean; arrayBuffer(): Promise<ArrayBuffer> }>;

let cached: { url: string; asset: Promise<RealisticBodyAsset> } | null = null;

/** Fetch and decode the asset once per page (GET, no credentials, no referrer). */
export function loadRealisticBody(fetchFn: FetchBytes, url = REALISTIC_BODY_URL): Promise<RealisticBodyAsset> {
  if (cached && cached.url === url) return cached.asset;
  const asset = (async () => {
    const res = await fetchFn(url);
    if (!res.ok) throw new Error('realistic body: fetch failed');
    return decodeRealisticBody(new Uint8Array(await res.arrayBuffer()));
  })();
  cached = { url, asset };
  asset.catch(() => {
    if (cached?.asset === asset) cached = null;
  });
  return asset;
}

/**
 * The realistic mesh for a drawn body: `drawn` is the mannequin the viewer draws (its ring heights, centres and arm
 * frames), `rings` the girths of the drawn body (the avatar's, which the collision field has too), `scaleAt` the
 * avatar's body girth scale (identity for a typed body).
 */
export async function realisticBodyFor(fetchFn: FetchBytes, drawn: Mannequin, rings: Record<AnchorRing, number>, scaleAt: (y: number) => number, url?: string): Promise<FitResult> {
  const asset = await loadRealisticBody(fetchFn, url);
  return fitRealisticBody(asset, fitTargetOf(drawn, rings, scaleAt));
}
