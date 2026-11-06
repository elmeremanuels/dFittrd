/**
 * Wiring of the embed: its own ApiClient (device token from the embed store, never the app's
 * store or database), the parent window, and the `mock:` tokens used in development and tests.
 */
import { MOCK_GARMENTS_BY_ID, type TryResolveResponse } from '@curtain/schema';
import { ApiClient, ApiError, NetworkError, apiBaseUrl } from '@/api/client';
import type { ClientLedgerEntry } from '@/db/db';
import { originOf, type ParentWindowLike } from './protocol';
import { createEmbedStore, type EmbedStore } from './storage';

export type EmbedApi = Pick<ApiClient, 'resolveTry' | 'resolvePeek' | 'fitShown' | 'deleteMe' | 'requestHeroRender' | 'heroRenderStatus'>;

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
    store: createEmbedStore(),
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
 * screenshots, tests). `mock:paused:<id>`, `mock:expired`, `mock:incomplete` and `mock:offline`
 * show the blocked screens. The allowed origin of a mock is the framing page's own origin in a
 * dev build only, so the size-selected message can be tried locally.
 */
export function resolveMock(token: string, referrer: string): TryResolveResponse {
  const parts = token.split(':');
  const variant = parts[1] ?? '';
  if (variant === 'expired') throw new ApiError(410, 'gone', 'try link expired');
  if (variant === 'incomplete') throw new ApiError(422, 'product_incomplete', 'the shop has not finished this product');
  if (variant === 'offline') throw new NetworkError('offline (mock)');
  const paused = variant === 'paused';
  const id = paused ? (parts[2] ?? '') : variant;
  const garment = MOCK_GARMENTS_BY_ID[id];
  if (!garment) throw new ApiError(404, 'not_found', `Unknown demo garment ${id}`);
  const now = Date.now();
  const ref = originOf(referrer);
  return {
    shop: { ...MOCK_EMBED_SHOP, paused },
    garment,
    trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(now + 10 * 60_000).toISOString(), intentToken: `mock-intent-${id}-000000` },
    pairing: { created: false, pairedAt: new Date(now).toISOString() },
    embed: { allowedOrigins: import.meta.env.DEV && ref ? [ref] : [] },
  };
}
