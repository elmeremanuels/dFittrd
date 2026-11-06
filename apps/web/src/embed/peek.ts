/**
 * The size peek (`/embed/peek?shop=<pk_…>&product=<external id>`): a small iframe the SDK puts next
 * to the "Try it on" button. For a shopper who already found their size on this shop it shows
 * "Your size: M", one short fit note and a thumbnail of their own figure in that size, without a
 * click. Everything here runs inside the iframe, on our origin.
 *
 * Why tokenless (keyed by the public shop key and the product id) instead of `/embed/peek/:token`:
 * a token would have to be minted by the SDK on every product page view, for every visitor, before
 * we know whether they have a profile at all. Tokenless, the peek first looks in its own partitioned
 * storage (no network). With no remembered profile it collapses and has made no api request. Only
 * a shopper with a remembered profile and device causes a session to be minted, from inside the
 * iframe, so the merchant page never sees a token, a size or a measurement. Before any of this,
 * peekGate.ts checks IndexedDB without React or Dexie, so a first-time visitor's peek downloads
 * only the page shell.
 *
 * Privacy (D3, D7):
 *  - The fit runs here with @curtain/fit-engine. No measurement leaves the iframe; nothing goes to
 *    the parent page except `curtain:peek-size { height }` and, after the shopper presses the
 *    peek's own button, `curtain:peek-open {}`.
 *  - A non-zero height is posted only to an origin in the shop's `embed.allowedOrigins`. The zero
 *    height (collapse) carries nothing and goes to the parent origin the browser reports.
 *  - Never billed: the peek never calls `fit-shown`, and its session is minted with
 *    `surface: 'api'`, which the api never bills (fit-shown bills only `surface: 'embed'`). The
 *    billable session starts when the shopper opens the overlay (SDK click → `surface: 'embed'`).
 *  - It never registers a device: without a remembered device token it shows nothing.
 */
import type { SdkSessionRequest, TryResolveResponse } from '@curtain/schema';
import type { ApiClient } from '@/api/client';
import { apiBaseUrl } from '@/api/client';
import { adviseSize, embedNotes, fitForProfile, normalizeAbout, type EmbedFit, type SizeAdvice } from './aboutYou';
import { browserParentOrigin } from './peekGate';
import { resolveTargetOrigin, type ParentWindowLike } from './protocol';
import type { EmbedStore, RememberedProfile } from './storage';

/** The api never bills `api` sessions (see the file header). */
export const PEEK_SURFACE: SdkSessionRequest['surface'] = 'api';

const SHOP_KEY_RE = /^pk_(live|test)_[A-Za-z0-9]{6,32}$/;

export interface PeekParams {
  shop: string;
  product: string;
}

/** `?shop=pk_…&product=…` → params, or null when either is missing or malformed. */
export function parsePeekParams(search: string): PeekParams | null {
  const q = new URLSearchParams(search);
  const shop = (q.get('shop') ?? '').trim();
  const product = (q.get('product') ?? '').trim();
  if (!SHOP_KEY_RE.test(shop) || product.length === 0 || product.length > 128) return null;
  return { shop, product };
}

export type PeekApi = Pick<ApiClient, 'resolveTry'>;

export interface PeekDeps {
  store: EmbedStore;
  makeApi: (store: EmbedStore) => PeekApi;
  /** `POST /v1/sdk/sessions` → the try token, or null (paused shop, unknown product, error). */
  mintToken: (req: SdkSessionRequest) => Promise<string | null>;
  parent: ParentWindowLike | null;
  referrer: string;
  ancestorOrigins: ArrayLike<string> | null;
}

export interface PeekResult {
  garment: TryResolveResponse['garment'];
  remembered: RememberedProfile;
  embedFit: EmbedFit;
  advice: SizeAdvice & { size: string };
  note: string;
  /** The one origin the non-zero height and the open request may go to. */
  targetOrigin: string;
}

/** One short fit note for the peek: a band note when there is one, never the "Edit my measurements" hint (that screen is not here). */
export function peekNote(notes: readonly string[], size: string): string {
  const note = notes.find((n) => !n.startsWith('Add your'));
  return (note ?? `Size ${size} fits you well`).replace(/ — consider a size (up|down)$/, '');
}

/**
 * Everything the peek needs, or null when it must show nothing. The order matters for privacy and
 * load: local checks first, the network only for a shopper who has a remembered profile here.
 */
export async function loadPeek(params: PeekParams, deps: PeekDeps): Promise<PeekResult | null> {
  const { store } = deps;
  await store.init();
  if (!store.remember) return null;
  if (!(await store.hasProfiles())) return null;
  if (!store.getDevice().token) return null;
  const parentOrigin = browserParentOrigin(deps);
  if (!parentOrigin) return null;

  const token = await deps.mintToken({ shopKeyPrefix: params.shop, productExternalId: params.product, pageUrl: `${parentOrigin}/`, surface: PEEK_SURFACE });
  if (!token) return null;
  const resolved = await deps.makeApi(store).resolveTry(token);
  if (resolved.shop.paused) return null;
  const targetOrigin = resolveTargetOrigin({ allowedOrigins: resolved.embed.allowedOrigins, referrer: deps.referrer, ancestorOrigins: deps.ancestorOrigins, framed: !!deps.parent });
  if (!targetOrigin) return null;
  const remembered = await store.loadProfile(resolved.shop.id);
  if (!remembered) return null;

  const embedFit = fitForProfile(resolved.garment, remembered.profile);
  const advice = adviseSize(embedFit.fit, normalizeAbout(remembered.about).preference);
  // Only a real recommendation: nothing for "no size fits well" or "we can't recommend a size yet".
  if (advice.noPoints || !advice.size) return null;
  const size = advice.size;
  const note = peekNote(embedNotes(embedFit.fit, advice, resolved.garment.category, remembered.profile), size);
  return { garment: resolved.garment, remembered, embedFit, advice: { ...advice, size }, note, targetOrigin };
}

/** The default `mintToken`: the SDK's own public handshake, without cookies or a device token. */
export async function mintPeekToken(req: SdkSessionRequest, base: string = apiBaseUrl(), fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchImpl(`${base}/v1/sdk/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(req),
    credentials: 'omit',
    cache: 'no-store',
  });
  // 402 = the shop is paused: the peek shows nothing (the button still opens the paused screen).
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { embedUrl?: unknown } | null;
  if (typeof body?.embedUrl !== 'string') return null;
  try {
    const last = new URL(body.embedUrl).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}
