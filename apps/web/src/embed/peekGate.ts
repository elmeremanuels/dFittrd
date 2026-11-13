/**
 * The size peek's first step, before React or the fit engine load (`/embed/peek`, see peek.ts).
 * The peek iframe sits on every product page the button is on, so for the shopper who never
 * entered measurements on this shop it must cost next to nothing: one raw IndexedDB look-up
 * (no Dexie), then the collapse message, and no further download and no api request.
 *
 * Kept free of heavy imports on purpose: only protocol.ts (pure). The database and key names
 * mirror storage.ts (asserted in tests).
 */
import { envelope, originOf } from './protocol';

export const PEEK_DB_NAME = 'curtain-embed';
const STORE = 'kv';
const PROFILE_PREFIX = 'profile:';

export function isPeekPath(pathname: string): boolean {
  return pathname === '/embed/peek' || pathname === '/embed/peek/';
}

/**
 * Is a profile remembered in this browser partition? `false` = certainly not (show nothing);
 * `true` = yes; `null` = cannot tell cheaply (old browser without `indexedDB.databases()`, an
 * error): the full peek loads and decides with the real store.
 */
export async function quickHasProfile(idb: IDBFactory | null = typeof indexedDB === 'undefined' ? null : indexedDB): Promise<boolean | null> {
  try {
    if (!idb) return false; // no IndexedDB: the embed store is memory-only, nothing is remembered
    if (typeof idb.databases !== 'function') return null;
    const dbs = await idb.databases();
    // Never open a database that does not exist: open() would create it.
    if (!dbs.some((d) => d.name === PEEK_DB_NAME)) return false;
    return await new Promise<boolean | null>((resolve) => {
      const req = idb.open(PEEK_DB_NAME);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      req.onupgradeneeded = () => {
        // Deleted in between: leave it to the real store.
        req.transaction?.abort();
        resolve(null);
      };
      req.onsuccess = () => {
        const db = req.result;
        const done = (v: boolean | null): void => {
          db.close();
          resolve(v);
        };
        try {
          if (!db.objectStoreNames.contains(STORE)) return done(false);
          const count = db.transaction(STORE, 'readonly').objectStore(STORE).count(IDBKeyRange.bound(PROFILE_PREFIX, `${PROFILE_PREFIX}￿`));
          count.onsuccess = () => done(count.result > 0);
          count.onerror = () => done(null);
        } catch {
          done(null);
        }
      };
    });
  } catch {
    return null;
  }
}

export interface FrameLike {
  parent: { postMessage: (message: unknown, targetOrigin: string) => void } | null;
  referrer: string;
  ancestorOrigins: ArrayLike<string> | null;
}

/** The parent page's origin as the browser reports it (never from the URL the page gave us). */
export function browserParentOrigin(f: FrameLike): string | null {
  if (!f.parent) return null;
  const ancestor = f.ancestorOrigins && f.ancestorOrigins.length > 0 ? originOf(f.ancestorOrigins[0]) : null;
  return ancestor ?? originOf(f.referrer);
}

/**
 * Tell the SDK to keep the peek at zero height. The message carries the height only, so it may go
 * to the parent origin the browser reports without checking the shop's allowed origins.
 */
export function postCollapse(f: FrameLike): void {
  const origin = browserParentOrigin(f);
  if (origin && f.parent) f.parent.postMessage(envelope({ type: 'curtain:peek-size', height: 0 }), origin);
}

/** This window as a FrameLike. */
export function currentFrame(): FrameLike {
  const framed = typeof window !== 'undefined' && window.parent !== window;
  let ancestorOrigins: ArrayLike<string> | null = null;
  try {
    ancestorOrigins = 'ancestorOrigins' in location ? (location.ancestorOrigins as ArrayLike<string>) : null;
  } catch {
    ancestorOrigins = null;
  }
  return { parent: framed ? window.parent : null, referrer: document.referrer, ancestorOrigins };
}
