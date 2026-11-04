import { pickStrings } from './i18n';
import { closeModal, openModal } from './modal';
import { qrToSvg } from './qr';
import { injectStyles, STYLE_ID } from './styles';
import type { OpenOptions, OpenResult, PaskamerApi, PaskamerConfig, SdkSessionRequest, SdkSessionResponse } from './types';
import { VERSION } from './version';

export const PRODUCT_ATTR = 'data-paskamer-product';
const BOUND_ATTR = 'data-paskamer-bound';
const STATE_ATTR = 'data-paskamer-state';
const SELECTOR = `[${PRODUCT_ATTR}]`;
const SHOP_KEY_RE = /^pk_(live|test)_[A-Za-z0-9]{6,32}$/;
const DEFAULT_TIMEOUT = 8000;

let cfg: PaskamerConfig = {};
let observer: MutationObserver | null = null;
let inFlight = false;
let scanQueued = false;
const bound = new Set<Element>();
const handlers = new WeakMap<Element, { click: (e: Event) => void; key?: (e: Event) => void }>();

const warn = (msg: string): void => {
  try {
    console.warn(`[Paskamer SDK] ${msg}`);
  } catch {
    /* ignore */
  }
};

/** Mobile = phone/tablet UA, or iPadOS (reports as Macintosh with touch). */
export function isMobile(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  touchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
): boolean {
  return /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua) || (/Mac/.test(ua) && touchPoints > 1);
}

function navigate(url: string): void {
  if (cfg.navigate) cfg.navigate(url);
  else location.href = url;
}

function apiBase(): string {
  return (cfg.api || '').replace(/\/+$/, '');
}

interface SessionOutcome {
  status: number;
  session?: SdkSessionResponse;
}

/** POST /v1/sdk/sessions. No cookies (`credentials: 'omit'`), no tracking, nothing but the three documented fields. */
async function requestSession(
  productExternalId: string,
  pageUrl: string,
  surface: SdkSessionRequest['surface'],
): Promise<SessionOutcome> {
  const body: SdkSessionRequest = { shopKeyPrefix: cfg.shop!, productExternalId, pageUrl, surface };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? DEFAULT_TIMEOUT) : null;
  try {
    const res = await fetch(`${apiBase()}/v1/sdk/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      signal: ctrl?.signal ?? null,
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const session = isSession(json) ? json : undefined;
    return { status: res.status, session };
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function isSession(v: unknown): v is SdkSessionResponse {
  return !!v && typeof v === 'object' && typeof (v as { tryUrl?: unknown }).tryUrl === 'string';
}

function setState(elm: Element | null | undefined, loading: boolean): void {
  if (!elm) return;
  if (loading) {
    elm.setAttribute(STATE_ATTR, 'loading');
    elm.setAttribute('aria-busy', 'true');
  } else {
    elm.removeAttribute(STATE_ATTR);
    elm.removeAttribute('aria-busy');
  }
}

function showMessage(message: string, trigger?: Element | null): void {
  injectStyles();
  openModal({ strings: pickStrings(cfg.locale), content: { message }, trigger });
}

/** Resolve one product: handshake, then redirect (mobile) or QR modal (desktop). Never throws. */
export async function open(productId: string, opts: OpenOptions = {}): Promise<OpenResult> {
  const trigger = opts.trigger ?? null;
  try {
    if (!productId) return { kind: 'ignored', reason: 'no-product' };
    if (!cfg.shop || !cfg.api) {
      warn('not configured: set data-shop (pk_live_… / pk_test_…) and data-api on the script tag, or call Paskamer.configure()');
      return { kind: 'ignored', reason: 'unconfigured' };
    }
    if (inFlight) return { kind: 'ignored', reason: 'busy' };
    inFlight = true;
    setState(trigger, true);
    const strings = pickStrings(cfg.locale);

    let outcome: SessionOutcome;
    try {
      outcome = await requestSession(productId, opts.pageUrl ?? location.href, opts.surface ?? 'api');
    } catch (error) {
      showMessage(strings.error, trigger);
      return { kind: 'error', error };
    }
    const { status, session } = outcome;
    const pausedStatus = status === 402 || status === 423;
    if (!session) {
      if (pausedStatus) {
        showMessage(strings.paused, trigger);
        return { kind: 'paused', status };
      }
      showMessage(strings.error, trigger);
      return { kind: 'error', status };
    }
    if (status >= 400 && !pausedStatus) {
      showMessage(strings.error, trigger);
      return { kind: 'error', status };
    }
    const paused = session.shopPaused || pausedStatus;
    const mode = opts.mode ?? cfg.mode ?? 'auto';
    if (mode === 'redirect' || (mode === 'auto' && isMobile())) {
      navigate(session.tryUrl);
      return { kind: 'redirect', session };
    }
    injectStyles();
    let qrSvg = session.qrSvg;
    if (!qrSvg) {
      try {
        qrSvg = qrToSvg(session.tryUrl);
      } catch {
        qrSvg = '';
      }
    }
    openModal({
      strings,
      trigger,
      content: { qrSvg, tryUrl: session.tryUrl, expiresAt: session.expiresAt, paused },
    });
    return { kind: 'modal', session };
  } catch (error) {
    warn(`open() failed: ${String(error)}`);
    return { kind: 'error', error };
  } finally {
    inFlight = false;
    setState(trigger, false);
  }
}

function bind(elm: Element): void {
  if (bound.has(elm)) return;
  bound.add(elm);
  elm.setAttribute(BOUND_ATTR, '');
  const tag = elm.tagName;
  const isButton = tag === 'BUTTON';
  if (isButton && !elm.hasAttribute('type')) elm.setAttribute('type', 'button');
  if (!isButton && tag !== 'A') {
    if (!elm.hasAttribute('role')) elm.setAttribute('role', 'button');
    if (!elm.hasAttribute('tabindex')) elm.setAttribute('tabindex', '0');
  }
  if (!elm.childNodes.length || !(elm.textContent || '').trim()) {
    if (!elm.children.length) elm.textContent = cfg.label || pickStrings(cfg.locale).button;
  }
  if (!cfg.unstyled && !elm.hasAttribute('data-paskamer-unstyled')) elm.classList.add('pk-btn');

  const click = (e: Event): void => {
    e.preventDefault();
    void open(elm.getAttribute(PRODUCT_ATTR) || '', { trigger: elm, surface: 'button' });
  };
  const h: { click: (e: Event) => void; key?: (e: Event) => void } = { click };
  elm.addEventListener('click', click);
  if (!isButton && tag !== 'A') {
    h.key = (e: Event): void => {
      const key = (e as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') click(e);
    };
    elm.addEventListener('keydown', h.key);
  }
  handlers.set(elm, h);
}

function unbind(elm: Element): void {
  const h = handlers.get(elm);
  if (h) {
    elm.removeEventListener('click', h.click);
    if (h.key) elm.removeEventListener('keydown', h.key);
  }
  handlers.delete(elm);
  bound.delete(elm);
  elm.removeAttribute(BOUND_ATTR);
  elm.classList.remove('pk-btn');
  setState(elm, false);
}

/** Bind every `[data-paskamer-product]` on the page. Returns the number of bound elements. */
export function scan(root: ParentNode = document): number {
  try {
    if (!cfg.unstyled) injectStyles();
    root.querySelectorAll(SELECTOR).forEach(bind);
    for (const elm of Array.from(bound)) if (!elm.isConnected) unbind(elm);
  } catch (error) {
    warn(`scan failed: ${String(error)}`);
  }
  return bound.size;
}

function queueScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  const run = (): void => {
    scanQueued = false;
    scan();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function observe(): void {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' || r.addedNodes.length || r.removedNodes.length) {
        queueScan();
        return;
      }
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [PRODUCT_ATTR],
  });
}

/** Merge config (validating the shop key shape) and re-scan. */
export function configure(next: Partial<PaskamerConfig>): Readonly<PaskamerConfig> {
  const merged: PaskamerConfig = { ...cfg, ...next };
  if (merged.shop && !SHOP_KEY_RE.test(merged.shop)) {
    warn(`ignoring shop key "${merged.shop}": expected pk_live_… or pk_test_… (never use your secret key)`);
    delete merged.shop;
  }
  if (merged.api) merged.api = merged.api.replace(/\/+$/, '');
  cfg = merged;
  if (typeof document !== 'undefined' && document.body) scan();
  return Object.freeze({ ...cfg });
}

export function getConfig(): Readonly<PaskamerConfig> {
  return Object.freeze({ ...cfg });
}

/** Tear everything down (listeners, observer, styles, modal). Mostly for tests and SPA unmounts. */
export function destroy(): void {
  observer?.disconnect();
  observer = null;
  closeModal();
  for (const elm of Array.from(bound)) unbind(elm);
  document.getElementById(STYLE_ID)?.remove();
  if (window.Paskamer === api) delete window.Paskamer;
  cfg = {};
  inFlight = false;
}

export const api: PaskamerApi = Object.freeze({
  open,
  configure,
  scan: () => scan(),
  destroy,
  version: VERSION,
});

/** Programmatic init (ESM consumers). Installs `window.Paskamer`, scans now and keeps scanning (MutationObserver). */
export function init(config: Partial<PaskamerConfig> = {}): PaskamerApi {
  configure(config);
  window.Paskamer = api;
  const start = (): void => {
    scan();
    observe();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
    observe();
  } else start();
  return api;
}

/** Find the SDK `<script>` tag: `document.currentScript`, else the last `script[data-shop]`. */
export function findScriptTag(doc: Document = document): HTMLScriptElement | null {
  const cur = doc.currentScript;
  if (cur instanceof HTMLScriptElement && cur.hasAttribute('data-shop')) return cur;
  const all = doc.querySelectorAll<HTMLScriptElement>('script[data-shop]');
  return all.length ? all[all.length - 1]! : cur instanceof HTMLScriptElement ? cur : null;
}

/** Read `data-*` config from a script tag. `api` defaults to the script's origin. */
export function configFromScript(script: HTMLScriptElement): PaskamerConfig {
  const d = script.dataset;
  const out: PaskamerConfig = {};
  if (d.shop) out.shop = d.shop;
  if (d.api) out.api = d.api;
  else if (script.src) {
    try {
      out.api = new URL(script.src, location.href).origin;
    } catch {
      /* relative/invalid src: leave api unset */
    }
  }
  if (d.mode === 'redirect' || d.mode === 'modal' || d.mode === 'auto') out.mode = d.mode;
  if (d.paskamerUnstyled !== undefined || d.unstyled !== undefined) out.unstyled = true;
  if (d.label) out.label = d.label;
  if (d.locale) out.locale = d.locale;
  return out;
}

/** IIFE entry: `<script src=".../sdk.v1.js" data-shop="pk_live_…" data-api="https://api.paskamer.app">`. */
export function autoInit(): PaskamerApi | null {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    const script = findScriptTag();
    if (!script) return null;
    const config = configFromScript(script);
    if (!config.shop) warn('data-shop missing on the script tag; buttons will not open until Paskamer.configure({ shop }) is called');
    return init(config);
  } catch (error) {
    warn(`init failed: ${String(error)}`);
    return null;
  }
}
