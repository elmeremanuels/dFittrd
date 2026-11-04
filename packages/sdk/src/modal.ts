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
}

export interface ModalHandle {
  root: HTMLElement;
  dialog: HTMLElement;
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

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

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

/** Open the accessible dialog (role=dialog, aria-modal, focus trap, Esc, backdrop click). One at a time. */
export function openModal(opts: ModalOptions): ModalHandle {
  const doc = opts.doc ?? document;
  const { strings: s, content } = opts;
  current?.close();
  const id = `pk-${++seq}`;

  const root = el(doc, 'div', 'pk-root');
  root.setAttribute('data-paskamer-modal', '');
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

  if (content.message) {
    const desc = el(doc, 'p', 'pk-desc', content.message);
    desc.id = `${id}-desc`;
    dialog.append(desc);
  } else {
    const qr = el(doc, 'div', 'pk-qr');
    const img = doc.createElement('img');
    img.alt = s.qrAlt;
    img.decoding = 'async';
    if (content.qrSvg) img.src = svgToDataUrl(content.qrSvg);
    qr.append(img);
    const desc = el(doc, 'p', 'pk-desc', s.scan);
    desc.id = `${id}-desc`;
    dialog.append(qr, desc);
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
  dialog.append(el(doc, 'p', 'pk-disclaimer', s.disclaimer));
  root.append(overlay, dialog);

  const previouslyFocused = doc.activeElement;
  const prevOverflow = doc.body.style.overflow;
  let open = true;

  const close = (): void => {
    if (!open) return;
    open = false;
    doc.removeEventListener('keydown', onKey, true);
    root.remove();
    doc.body.style.overflow = prevOverflow;
    if (current === handle) current = null;
    const back =
      opts.trigger && opts.trigger.isConnected ? opts.trigger : previouslyFocused;
    if (back instanceof HTMLElement && back.isConnected) back.focus({ preventScroll: true });
    opts.onClose?.();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => !n.hasAttribute('hidden'),
    );
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

  const handle: ModalHandle = { root, dialog, close };
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
