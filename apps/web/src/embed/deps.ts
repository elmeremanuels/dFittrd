/**
 * Wiring of the embed: its own ApiClient (device token from the embed store, never the app's
 * store or database), the parent window, and the `mock:` tokens used in development and tests.
 */
import type * as GarmentViewer from '@curtain/garment-viewer';
import { MEN_COMING_SOON_CODE, MOCK_GARMENTS_BY_ID, SYNTHETIC_MENS_CHINO_WL, SYNTHETIC_MENS_TEE, type GarmentPayload, type TryResolveResponse } from '@curtain/schema';
import { ApiClient, ApiError, NetworkError, apiBaseUrl } from '@/api/client';
import type { ClientLedgerEntry } from '@/db/db';
import { originOf, type ParentWindowLike } from './protocol';
import { createEmbedStore, lookStorageEnabled, type EmbedStore } from './storage';

export type EmbedApi = Pick<ApiClient, 'resolveTry' | 'resolvePeek' | 'fitShown' | 'deleteMe' | 'requestHeroRender' | 'heroRenderStatus'> & Partial<Pick<ApiClient, 'requestRealism'>>;

/** What the on-device face step returns (the type of `faceLookFromPhoto`, without importing the worker code). */
export interface FaceLookResultLike {
  faceFound: boolean;
  tile: { width: number; height: number; rgba: Uint8ClampedArray; skinLab: { L: number; a: number; b: number } } | null;
  suggestion: { monk: number } | null;
  notices: ('turned' | 'small' | 'bright' | 'dark' | 'side' | 'cast')[];
}

export interface EmbedDeps {
  store: EmbedStore;
  /** A fresh client bound to the store (recreated after "Forget me" so no cached token survives). */
  makeApi: (store: EmbedStore) => EmbedApi;
  parent: ParentWindowLike | null;
  referrer: string;
  ancestorOrigins: ArrayLike<string> | null;
  /** The app's origin, for the "Get the Curtain app" link. */
  appUrl: string;
  /** Camera scan offered at all (`navigator.mediaDevices` exists). */
  canScan: boolean;
  /** The shopper's locale for the default units (default: `navigator.language`; null: none). */
  locale?: string | null;
  /** WebGL2 check and viewer chunk for the 3D view (tests inject these; default: the real ones). */
  webgl2?: () => boolean;
  loadViewer?: () => Promise<typeof GarmentViewer>;
  /** The photo-based face row of the avatar prompt (default: the build flag, which is off). */
  facePhoto?: boolean;
  /** The live face photo rows, slices 4 and 5 (default: `VITE_AVATAR_FACE_PHOTO=live`, off). */
  facePhotoLive?: boolean;
  /** Reads one face photo on the device (default: the scan worker, loaded on first use). Tests inject it. */
  faceLook?: (photo: Blob, opts: { tile: boolean; skin: boolean; aspect?: number }) => Promise<FaceLookResultLike>;
  /** A tile's pixels as a `blob:` URL of this page (default: canvas → PNG). Tests inject it. */
  tileUrl?: (tile: { width: number; height: number; rgba: Uint8ClampedArray }) => Promise<string>;
  /** Resolve `mock:` tokens (default: `mockTokensEnabled()`, i.e. dev builds or VITE_DEMO=1 only). */
  allowMock?: boolean;
}

/** Ledger of what this embed sent, in memory only (field names, never values). */
export const embedLedger: ClientLedgerEntry[] = [];

export function makeEmbedApi(store: EmbedStore): EmbedApi {
  return new ApiClient({
    baseUrl: apiBaseUrl(),
    appVersion: '0.1.0',
    getDevice: () => store.getDevice(),
    setDevice: (d) => store.setDevice(d),
    reloadDevice: () => store.reloadDevice(),
    onLedger: (entry) => {
      embedLedger.push(entry);
      if (embedLedger.length > 50) embedLedger.shift();
    },
  });
}

export function defaultDeps(): EmbedDeps {
  const framed = typeof window !== 'undefined' && window.parent !== window;
  let ancestorOrigins: ArrayLike<string> | null = null;
  try {
    ancestorOrigins = typeof location !== 'undefined' && 'ancestorOrigins' in location ? (location.ancestorOrigins as ArrayLike<string>) : null;
  } catch {
    ancestorOrigins = null;
  }
  return {
    // The picked skin colour is saved on the device only with the build flag (default: memory only).
    store: createEmbedStore({ persistLooks: lookStorageEnabled() }),
    makeApi: makeEmbedApi,
    parent: framed ? window.parent : null,
    referrer: typeof document !== 'undefined' ? document.referrer : '',
    ancestorOrigins,
    appUrl: typeof location !== 'undefined' ? `${location.origin}/` : '/',
    canScan: typeof navigator !== 'undefined' && !!navigator.mediaDevices,
  };
}

export const MOCK_EMBED_SHOP = { id: '00000000-0000-4000-8000-0000000000e1', name: 'Aalter Studio', platform: 'woocommerce' as const, paused: false, brandColor: '#2F4F3A' };

export const isMockToken = (token: string): boolean => token.startsWith('mock:');

/**
 * SEC-5: `mock:` tokens render a fabricated shop on our real origin, so they only resolve in a
 * development build or a build made with `VITE_DEMO=1`. A production build shows "expired".
 */
export function mockTokensEnabled(env: { DEV?: boolean; VITE_DEMO?: string } = import.meta.env): boolean {
  return env.DEV === true || env.VITE_DEMO === '1';
}

/**
 * `mock:<garment id>` resolves to a bundled fixture without any network call (dev, demo
 * screenshots, tests). `mock:paused:<id>`, `mock:expired`, `mock:incomplete`, `mock:comingsoon`
 * and `mock:offline` show the blocked screens. `mock:nostretch:<id>` is a product whose shop gave
 * no fabric stretch and marked no stretchy part: the garment arrives with stretch 0 and no stretch
 * zones, as the api sends it, and the result says stretch was not used. `mock:nomark:<id>` is a
 * shop that switched "Fit by Curtain" off. The allowed origin of a mock is the framing page's own origin in a
 * dev build only, so the size-selected message can be tried locally.
 */
const SYNTHETIC_MOCKS: Readonly<Record<string, GarmentPayload>> = { [SYNTHETIC_MENS_TEE.id]: SYNTHETIC_MENS_TEE, [SYNTHETIC_MENS_CHINO_WL.id]: SYNTHETIC_MENS_CHINO_WL };

export function resolveMock(token: string, referrer: string): TryResolveResponse {
  const parts = token.split(':');
  const variant = parts[1] ?? '';
  if (variant === 'expired') throw new ApiError(410, 'gone', 'try link expired');
  if (variant === 'incomplete') throw new ApiError(422, 'product_incomplete', 'the shop has not finished this product');
  if (variant === 'comingsoon') throw new ApiError(422, MEN_COMING_SOON_CODE, 'Men’s clothing: coming soon');
  if (variant === 'offline') throw new NetworkError('offline (mock)');
  const paused = variant === 'paused';
  const noStretch = variant === 'nostretch';
  const noMark = variant === 'nomark';
  const id = paused || noStretch || noMark ? (parts[2] ?? '') : variant;
  // The SYNTHETIC men's test garments (not products; slices M1 and M2) also resolve, for dev screenshots.
  const fixture = MOCK_GARMENTS_BY_ID[id] ?? SYNTHETIC_MOCKS[id];
  if (!fixture) throw new ApiError(404, 'not_found', `Unknown demo garment ${id}`);
  const garment: GarmentPayload = noStretch ? { ...fixture, fabric: { ...fixture.fabric, stretchPct: 0 }, stretchZones: [] } : fixture;
  const now = Date.now();
  const ref = originOf(referrer);
  return {
    shop: { ...MOCK_EMBED_SHOP, paused, ...(noMark ? { hideWordmark: true as const } : {}) },
    garment,
    ...(noStretch ? { stretchAssumed: true as const } : {}),
    trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(now + 10 * 60_000).toISOString(), intentToken: `mock-intent-${id}-000000` },
    pairing: { created: false, pairedAt: new Date(now).toISOString() },
    embed: { allowedOrigins: import.meta.env.DEV && ref ? [ref] : [] },
  };
}
