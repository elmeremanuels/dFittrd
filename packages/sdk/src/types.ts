// Wire types: copies of the @curtain/schema DTOs (docs/STANDALONE.md §2). The SDK stays
// dependency-free, so they are mirrored here instead of imported. Keep them in sync with
// `SdkSessionRequestSchema` / `SdkSessionResponseSchema` and the embed message types in schema.

/** POST /v1/sdk/sessions request. `embed` = standalone overlay; `button` / `api` = app mode. */
export interface SdkSessionRequest {
  shopKeyPrefix: string;
  productExternalId: string;
  pageUrl: string;
  surface: 'button' | 'api' | 'embed';
}

/** POST /v1/sdk/sessions response. */
export interface SdkSessionResponse {
  /** App mode deep link (`https://app.<domain>/try/<token>`). */
  tryUrl: string;
  /** Standalone overlay URL (`https://app.<domain>/embed/<token>`). Optional here only so an older API still works (the SDK then falls back to app mode). */
  embedUrl?: string;
  /** Inline SVG for the desktop QR modal. Optional when `surface` is `embed`. */
  qrSvg?: string;
  expiresAt: string;
  /** Below plan: the button still renders; the embed / app shows "shop paused" (D7). */
  shopPaused: boolean;
}

interface Envelope {
  source: 'curtain';
  v: 1;
}

/** iframe → parent messages (`postMessage` protocol, STANDALONE.md §2). */
export type EmbedMessage = Envelope &
  (
    | { type: 'curtain:ready' }
    | { type: 'curtain:resize'; height: number }
    | { type: 'curtain:size-selected'; productExternalId: string; size: string }
    | { type: 'curtain:close' }
  );

/** parent → iframe, sent after `curtain:ready`. */
export interface EmbedContextMessage extends Envelope {
  type: 'curtain:context';
  locale: string;
  currentVariantSize?: string;
}

/**
 * The experience (`data-mode`): `embed` (default, standalone overlay on the shop page), `app` (the
 * QR / deep-link flow into the Curtain app) or `auto` (embed plus an "Open in the Curtain app" link).
 * The pre-standalone values `redirect` and `modal` still work: app mode, forced to the deep link or
 * to the QR modal. Anything else falls back to `embed`.
 */
export type OpenMode = 'embed' | 'app' | 'auto' | 'redirect' | 'modal';

export interface CurtainConfig {
  /** Public shop key prefix, `pk_live_…` or `pk_test_…` (never the `sk_` secret). */
  shop?: string;
  /** API origin, e.g. `https://api.curtain.fit`. Defaults to the origin the SDK script was loaded from. */
  api?: string;
  mode?: OpenMode;
  /** Name of the product option that holds the size (default `Size`; `Maat`, `Taille`, `Größe` also match). */
  sizeOption?: string;
  /** Skip the built-in button styling (same as `data-curtain-unstyled`). */
  unstyled?: boolean;
  /** Text used for empty buttons. Defaults to "Try it on". */
  label?: string;
  /** `en` | `nl`; defaults to `<html lang>`. */
  locale?: string;
  /** Request timeout in ms (default 8000). */
  timeoutMs?: number;
  /** Advanced: how a mobile redirect is performed (default `location.href = url`). Used by tests and the Capacitor shell. */
  navigate?: (url: string) => void;
}

export interface OpenOptions {
  /** The element that was activated; receives a loading state, focus back on close and the `curtain:size-selected` event. */
  trigger?: Element | null;
  mode?: OpenMode;
  /** Defaults to `location.href`. */
  pageUrl?: string;
  /** App mode only: button clicks send `button`, programmatic calls default to `api`. Embed always sends `embed`. */
  surface?: 'button' | 'api';
}

export type OpenResult =
  | { kind: 'embed'; session: SdkSessionResponse }
  | { kind: 'redirect'; session: SdkSessionResponse }
  | { kind: 'modal'; session: SdkSessionResponse }
  /** 402/423 without a session body: a polite message was shown instead. */
  | { kind: 'paused'; status: number }
  | { kind: 'error'; status?: number; error?: unknown }
  | { kind: 'ignored'; reason: 'busy' | 'unconfigured' | 'no-product' };

/** How the chosen size reached the page. */
export type SizeSelectedVia = 'hook' | 'shopify' | 'woo' | 'toast';

/** `detail` of the bubbling `curtain:size-selected` DOM event fired on the button. */
export interface SizeSelectedDetail {
  size: string;
  productExternalId: string;
  via: SizeSelectedVia;
}

/** Merchant hooks: `window.CurtainHooks = { onSizeSelected({ size }) { …; return true } }`. */
export interface CurtainHooks {
  /** Return `true` when you selected the variant yourself; the SDK then does nothing else. */
  onSizeSelected?(e: { size: string; productExternalId: string }): boolean | void;
}

export interface CurtainApi {
  /** Start a try-on for a product (the same thing a button click does). Never rejects. */
  open(productId: string, opts?: OpenOptions): Promise<OpenResult>;
  /** Merge config; returns the effective config. Re-scans buttons. */
  configure(cfg: Partial<CurtainConfig>): Readonly<CurtainConfig>;
  /** Bind any new `[data-curtain-product]` elements; returns how many are bound in total. */
  scan(): number;
  /** Remove listeners, observer, styles and any open modal or overlay. */
  destroy(): void;
  readonly version: string;
}

declare global {
  interface Window {
    Curtain?: CurtainApi;
    CurtainHooks?: CurtainHooks;
  }
}
