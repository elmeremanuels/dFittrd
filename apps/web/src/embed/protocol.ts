/**
 * postMessage protocol between the embed iframe and the SDK overlay on the merchant page
 * (docs/STANDALONE.md §2). Every message is `{ source: 'curtain', v: 1, type, ...payload }`.
 *
 * Origin rules (the iframe side):
 *  - We post only to ONE target origin, and only when it is in `embed.allowedOrigins` from
 *    `GET /v1/try/:token`. Never to `*`.
 *  - The target is the parent page's origin as the browser reports it (`document.referrer`, else
 *    `location.ancestorOrigins[0]`). If that origin is not allowed (or we are not framed), we post
 *    nothing and the UI says "choose size X on the shop page" instead.
 *  - We accept `curtain:context` only from `window.parent` AND from that same target origin.
 */

export const PROTOCOL_SOURCE = 'curtain' as const;
export const PROTOCOL_VERSION = 1 as const;

export interface Envelope {
  source: typeof PROTOCOL_SOURCE;
  v: typeof PROTOCOL_VERSION;
  type: string;
}

export type OutboundMessage =
  | { type: 'curtain:ready' }
  | { type: 'curtain:resize'; height: number }
  | { type: 'curtain:size-selected'; productExternalId: string; size: string }
  | { type: 'curtain:close' }
  // The size peek (`/embed/peek`, a small iframe next to the button). Neither message carries a
  // size, a measurement or anything else about the shopper: only the frame height, and a request
  // to open the full overlay after the shopper pressed the peek's own button (D3).
  | { type: 'curtain:peek-size'; height: number }
  | { type: 'curtain:peek-open' };

export interface ParentContext {
  locale: string | null;
  currentVariantSize: string | null;
}

export function envelope<M extends OutboundMessage>(msg: M): { source: typeof PROTOCOL_SOURCE; v: typeof PROTOCOL_VERSION } & M {
  return { source: PROTOCOL_SOURCE, v: PROTOCOL_VERSION, ...msg };
}

/** `https://shop.example/path?q` → `https://shop.example`; anything unparsable or opaque → null. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export interface TargetOriginInput {
  allowedOrigins: readonly string[];
  /** `document.referrer` of the iframe document. */
  referrer: string | null | undefined;
  /** `location.ancestorOrigins` (Chromium, Safari) — the parent's origin first. */
  ancestorOrigins?: ArrayLike<string> | null | undefined;
  /** `window.parent !== window`. */
  framed: boolean;
}

/**
 * The one origin we may post to, or null. Both candidate origins come from the browser, not from
 * the page, and must match an allowed origin exactly.
 */
export function resolveTargetOrigin({ allowedOrigins, referrer, ancestorOrigins, framed }: TargetOriginInput): string | null {
  if (!framed) return null;
  const allowed = new Set(allowedOrigins.map((o) => originOf(o)).filter((o): o is string => o !== null));
  if (allowed.size === 0) return null;
  const parent = ancestorOrigins && ancestorOrigins.length > 0 ? originOf(ancestorOrigins[0]) : null;
  // The direct parent wins when the browser tells us; the referrer is the fallback (Firefox).
  const candidate = parent ?? originOf(referrer);
  return candidate && allowed.has(candidate) ? candidate : null;
}

function isEnvelope(data: unknown): data is Envelope & Record<string, unknown> {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return d.source === PROTOCOL_SOURCE && d.v === PROTOCOL_VERSION && typeof d.type === 'string';
}

const cleanString = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null);

/**
 * Parse a message from the parent. Returns null unless it is a well-formed `curtain:context` from
 * the expected window and origin.
 */
export function parseParentMessage(
  event: Pick<MessageEvent, 'data' | 'origin' | 'source'>,
  expected: { targetOrigin: string | null; parent: unknown },
): ParentContext | null {
  if (!expected.targetOrigin || event.origin !== expected.targetOrigin) return null;
  if (!expected.parent || event.source !== expected.parent) return null;
  if (!isEnvelope(event.data) || event.data.type !== 'curtain:context') return null;
  return {
    locale: cleanString(event.data.locale, 35),
    currentVariantSize: cleanString(event.data.currentVariantSize, 64),
  };
}

export interface ParentWindowLike {
  postMessage: (message: unknown, targetOrigin: string) => void;
}

/**
 * A channel to the parent page. `post` is a no-op returning false when there is no allowed target
 * origin, so callers can show the "choose it on the shop page" fallback.
 */
export function createParentChannel(parent: ParentWindowLike | null, targetOrigin: string | null) {
  return {
    canPost: !!parent && !!targetOrigin,
    targetOrigin,
    post(msg: OutboundMessage): boolean {
      if (!parent || !targetOrigin) return false;
      parent.postMessage(envelope(msg), targetOrigin);
      return true;
    },
  };
}

export type ParentChannel = ReturnType<typeof createParentChannel>;
