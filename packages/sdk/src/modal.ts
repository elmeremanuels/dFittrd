import type { Strings } from './i18n';

export interface ModalContent {
  /** Inline SVG markup for the QR (from the API, or the built-in encoder). Omit for a message-only dialog. */
  qrSvg?: string;
  tryUrl?: string;
  expiresAt?: string;
  /** Shop below plan: the code still works, the app shows the paused screen (D7). */
  paused?: boolean;
  /** Message-only mode (polite error / paused without a link). */
  message?: string;
  /** Standalone mode: a full-screen overlay holding an iframe to this URL instead of the QR. */
  embedUrl?: string;
  /** With `embedUrl`: an optional "Open in the Curtain app" link (`data-mode="auto"`). */
  appUrl?: string;
}

export interface ModalHandle {
  root: HTMLElement;
  dialog: HTMLElement;
  /** The embed iframe (standalone overlay only). */
  frame?: HTMLIFrameElement;
  /** Clear the loading state (standalone overlay only; also runs on the iframe's `load`). */
  ready(): void;
  close(): void;
}

export interface ModalOptions {
  strings: Strings;
  content: ModalContent;
  /** Element to return focus to on close. */
  trigger?: Element | null;
  onClose?: () => void;
  doc?: Document;
}

const FOCUSABLE = 'iframe,a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let current: ModalHandle | null = null;
let seq = 0;

/** Minutes until `iso` (at least 1); null if unparseable or already past. */
export function minutesLeft(iso: string | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= now) return null;
  return Math.max(1, Math.round((t - now) / 60000));
}

/** Render SVG markup through an <img data: URL>: images never run scripts, so untrusted SVG is inert. */
export function svgToDataUrl(svg: string): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Open the accessible dialog (role=dialog, aria-modal, focus trap, Esc, backdrop click, scroll lock).
 * One at a time. With `content.embedUrl` it is the full-screen standalone overlay with the iframe.
 */
export function openModal(opts: ModalOptions): ModalHandle {
  const doc = opts.doc ?? document;
  const { strings: s, content } = opts;
  current?.close();
  const id = `pk-${++seq}`;

  const root = el(doc, 'div', 'pk-root');
  root.setAttribute('data-curtain-modal', '');
  const overlay = el(doc, 'div', 'pk-overlay');
  const dialog = el(doc, 'div', 'pk-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  dialog.setAttribute('aria-describedby', `${id}-desc`);
  dialog.tabIndex = -1;

  const closeBtn = el(doc, 'button', 'pk-close', '×');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', s.close);
  const title = el(doc, 'h2', 'pk-title', s.title);
  title.id = `${id}-title`;
  dialog.append(closeBtn, title);
  let frame: HTMLIFrameElement | undefined;
  let ready = (): void => {};

  if (content.embedUrl) {
    root.className += ' pk-fs';
    dialog.className += ' pk-full';
    dialog.removeAttribute('aria-describedby');
    dialog.setAttribute('aria-busy', 'true');
    if (content.appUrl) {
      const a = el(doc, 'a', 'pk-app', s.openApp);
      a.href = content.appUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      dialog.append(a);
    }
    const load = el(doc, 'p', 'pk-load', s.loading);
    load.setAttribute('role', 'status');
    frame = el(doc, 'iframe', 'pk-frame');
    frame.title = s.title;
    frame.setAttribute('allow', 'camera; fullscreen');
    ready = () => {
      load.remove();
      dialog.removeAttribute('aria-busy');
    };
    frame.addEventListener('load', ready);
    frame.src = content.embedUrl;
    // Tabbing out of the iframe's last element lands on this sentinel (the page's own focusin never
    // fires for it otherwise), which wraps focus back to the close button (A11Y-3).
    const end = el(doc, 'span', 'pk-sentinel');
    end.tabIndex = 0;
    end.setAttribute('data-pk-sentinel', '');
    end.addEventListener('focus', () => closeBtn.focus());
    dialog.append(load, frame, end);
  } else if (content.message) {
    const desc = el(doc, 'p', 'pk-desc', content.message);
    desc.id = `${id}-desc`;
    dialog.append(desc);
  } else {
    if (content.qrSvg) {
      const qr = el(doc, 'div', 'pk-qr');
      const img = doc.createElement('img');
      img.alt = s.qrAlt;
      img.decoding = 'async';
      img.src = svgToDataUrl(content.qrSvg);
      qr.append(img);
      dialog.append(qr);
    }
    const desc = el(doc, 'p', 'pk-desc', s.scan);
    desc.id = `${id}-desc`;
    dialog.append(desc);
    if (content.paused) dialog.append(el(doc, 'p', 'pk-note', s.pausedShort));
    const meta = el(doc, 'p', 'pk-meta');
    if (content.tryUrl) {
      const a = doc.createElement('a');
      a.href = content.tryUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = s.openLink;
      meta.append(a);
    }
    const mins = minutesLeft(content.expiresAt);
    if (mins !== null) meta.append(doc.createTextNode(`${content.tryUrl ? ' · ' : ''}${s.expires(mins)}`));
    if (meta.childNodes.length) dialog.append(meta);
  }
  if (!frame) dialog.append(el(doc, 'p', 'pk-disclaimer', s.disclaimer));
  root.append(overlay, dialog);

  const previouslyFocused = doc.activeElement;
  const prevOverflow = doc.body.style.overflow;
  let open = true;

  const close = (): void => {
    if (!open) return;
    open = false;
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusin', onFocus, true);
    root.remove();
    doc.body.style.overflow = prevOverflow;
    if (current === handle) current = null;
    const back =
      opts.trigger && opts.trigger.isConnected ? opts.trigger : previouslyFocused;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    opts.onClose?.();
  };

  const focusables = (): HTMLElement[] =>
    Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => !n.hasAttribute('hidden') && !n.hasAttribute('data-pk-sentinel'));

  // Tab out of the iframe (whose key events never reach this document) lands back in the dialog.
  const onFocus = (e: FocusEvent): void => {
    if (!root.contains(e.target as Node)) (focusables()[0] || dialog).focus();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = doc.activeElement;
    const inside = dialog.contains(active);
    if (e.shiftKey && (active === first || active === dialog || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  };

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocus, true);

  const handle: ModalHandle = { root, dialog, frame, ready, close };
  current = handle;
  doc.body.append(root);
  doc.body.style.overflow = 'hidden';
  dialog.focus({ preventScroll: true });
  return handle;
}

export function closeModal(): void {
  current?.close();
}

export function currentModal(): ModalHandle | null {
  return current;
}
