import type { SdkSessionRequest, SdkSessionResponse } from '@curtain/schema';

// Wire types come from @curtain/schema only (type-only import: nothing is bundled).
export type { SdkSessionRequest, SdkSessionResponse };

/** How a click resolves: `auto` = mobile UA → redirect, desktop → QR modal. */
export type OpenMode = 'auto' | 'redirect' | 'modal';

export interface CurtainConfig {
  /** Public shop key prefix, `pk_live_…` or `pk_test_…` (never the `sk_` secret). */
  shop?: string;
  /** API origin, e.g. `https://api.curtain.fit`. Defaults to the origin the SDK script was loaded from. */
  api?: string;
  mode?: OpenMode;
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
  /** The element that was activated; receives a loading state and gets focus back when the modal closes. */
  trigger?: Element | null;
  mode?: OpenMode;
  /** Defaults to `location.href`. */
  pageUrl?: string;
  /** Where the call came from; button clicks send `button`, programmatic calls default to `api`. */
  surface?: SdkSessionRequest['surface'];
}

export type OpenResult =
  | { kind: 'redirect'; session: SdkSessionResponse }
  | { kind: 'modal'; session: SdkSessionResponse }
  /** 402/423 without a tryUrl: a polite message was shown instead. */
  | { kind: 'paused'; status: number }
  | { kind: 'error'; status?: number; error?: unknown }
  | { kind: 'ignored'; reason: 'busy' | 'unconfigured' | 'no-product' };

export interface CurtainApi {
  /** Start a try-on handshake for a product (the same thing a button click does). Never rejects. */
  open(productId: string, opts?: OpenOptions): Promise<OpenResult>;
  /** Merge config; returns the effective config. Re-scans buttons. */
  configure(cfg: Partial<CurtainConfig>): Readonly<CurtainConfig>;
  /** Bind any new `[data-curtain-product]` elements; returns how many are bound in total. */
  scan(): number;
  /** Remove listeners, observer, styles and any open modal. */
  destroy(): void;
  readonly version: string;
}

declare global {
  interface Window {
    Curtain?: CurtainApi;
  }
}
