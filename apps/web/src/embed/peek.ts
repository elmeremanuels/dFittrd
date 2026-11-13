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
 * a shopper with a remembered profile and device makes one request, `GET /v1/peek`, from inside the
 * iframe. That lookup is read-only: it mints no try session, creates no pairing and bills nothing,
 * so peek views never show up in the merchant's session counts or the k-anonymity floor, and never
 * use the shop's SDK rate limit that real button clicks need. Before any of this, peekGate.ts checks
 * IndexedDB without React or Dexie, so a first-time visitor's peek downloads only the page shell.
 *
 * Privacy (D3, D7): what the merchant page can observe is the frame's height. It is exactly one bit,
 * "this shopper has a remembered profile on this shop and the product is try-able": `PEEK_HEIGHT`
 * or 0, never anything that depends on the fit. Once a profile exists the peek always expands to
 * the same fixed height, also when no size fits or none can be recommended yet (a neutral line in
 * the same box), and it is never re-measured, so neither the outcome nor the length of the size
 * label or the note can be read from the page by probing products or resizing the frame.
 *  - The fit runs here with @curtain/fit-engine. No measurement leaves the iframe; nothing goes to
 *    the parent page except `curtain:peek-size { height }` and, after the shopper presses the
 *    peek's own button, `curtain:peek-open {}`.
 *  - A non-zero height is posted only to an origin in the shop's `embed.allowedOrigins`. The zero
 *    height (collapse) carries nothing and goes to the parent origin the browser reports.
 *  - Never billed: the peek never calls `fit-shown` and has no try session. The billable session
 *    starts when the shopper opens the overlay (SDK click → `surface: 'embed'`).
 *  - It never registers a device: without a remembered device token it shows nothing.
 */
import type { PeekResponse } from '@curtain/schema';
import type { ApiClient } from '@/api/client';
import { adviseSize, embedNotes, fitForProfile, normalizeAbout, type EmbedFit, type SizeAdvice } from './aboutYou';
import { browserParentOrigin } from './peekGate';
import { resolveTargetOrigin, type ParentWindowLike } from './protocol';
import type { EmbedStore, RememberedProfile } from './storage';

/**
 * The one height the shown peek ever reports, in px. The SDK (`packages/sdk/src/peek.ts`,
 * `PEEK_HEIGHT`) accepts this value or 0 and nothing else; keep the two equal.
 */
export const PEEK_HEIGHT = 112;

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

export type PeekApi = Pick<ApiClient, 'resolvePeek'>;

export interface PeekDeps {
  store: EmbedStore;
  makeApi: (store: EmbedStore) => PeekApi;
  parent: ParentWindowLike | null;
  referrer: string;
  ancestorOrigins: ArrayLike<string> | null;
}

/** What the shown peek says. `size`: a recommendation; `none`: no size fits well; `unknown`: we cannot recommend one yet. */
export type PeekOutcome = { kind: 'size'; size: string; note: string } | { kind: 'none'; note: string } | { kind: 'unknown'; note: string };

export interface PeekResult {
  garment: PeekResponse['garment'];
  remembered: RememberedProfile;
  embedFit: EmbedFit | null;
  outcome: PeekOutcome;
  /** The one origin the non-zero height and the open request may go to. */
  targetOrigin: string;
}

/** One short fit note for the peek: a band note when there is one, never the "Edit my measurements" hint (that screen is not here). */
export function peekNote(notes: readonly string[], size: string): string {
  const note = notes.find((n) => !n.startsWith('Add your'));
  return (note ?? `Size ${size} fits you well`).replace(/ — consider a size (up|down)$/, '');
}

/** The peek's text for a fit. Every outcome is shown in the same fixed box (see the file header). */
export function peekOutcome(garment: PeekResponse['garment'], embedFit: EmbedFit | null, advice: SizeAdvice | null, remembered: RememberedProfile): PeekOutcome {
  if (!embedFit || !advice || advice.noPoints) return { kind: 'unknown', note: 'Open the fitting room to add what this item needs.' };
  if (!advice.size) return { kind: 'none', note: 'None of the sizes fits you well. Open the fitting room to compare.' };
  return { kind: 'size', size: advice.size, note: peekNote(embedNotes(embedFit.fit, advice, garment.category, remembered.profile), advice.size) };
}

/**
 * Everything the peek needs, or null when it must show nothing. The order matters for privacy and
 * load: local checks first, the network only for a shopper who has a remembered profile here. A
 * null never depends on the fit: only on the profile, the device, the shop and the product.
 */
export async function loadPeek(params: PeekParams, deps: PeekDeps): Promise<PeekResult | null> {
  const { store } = deps;
  await store.init();
  if (!store.remember) return null;
  if (!(await store.hasProfiles())) return null;
  if (!store.getDevice().token) return null;
  const parentOrigin = browserParentOrigin(deps);
  if (!parentOrigin) return null;

  const resolved = await deps.makeApi(store).resolvePeek({ shop: params.shop, product: params.product, page: `${parentOrigin}/` });
  if (resolved.shop.paused) return null;
  const targetOrigin = resolveTargetOrigin({ allowedOrigins: resolved.embed.allowedOrigins, referrer: deps.referrer, ancestorOrigins: deps.ancestorOrigins, framed: !!deps.parent });
  if (!targetOrigin) return null;
  const remembered = await store.loadProfile(resolved.shop.id);
  if (!remembered) return null;

  // From here on the peek is shown, whatever the fit says.
  let embedFit: EmbedFit | null = null;
  let advice: SizeAdvice | null = null;
  try {
    embedFit = fitForProfile(resolved.garment, remembered.profile);
    advice = adviseSize(embedFit.fit, normalizeAbout(remembered.about).preference);
  } catch {
    embedFit = null;
    advice = null;
  }
  return { garment: resolved.garment, remembered, embedFit, outcome: peekOutcome(resolved.garment, embedFit, advice, remembered), targetOrigin };
}
