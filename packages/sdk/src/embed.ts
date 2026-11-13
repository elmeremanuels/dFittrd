import type { Strings } from './i18n';
import { openModal } from './modal';
import type { ModalHandle } from './modal';
import type { EmbedContextMessage, SizeSelectedDetail } from './types';
import { currentSize, selectSize } from './variant';

export interface EmbedOptions {
  embedUrl: string;
  /** Shown as "Open in the Curtain app" (`data-mode="auto"`). */
  appUrl?: string;
  productExternalId: string;
  /** The button: gets focus back and the bubbling `curtain:size-selected` event. */
  trigger?: Element | null;
  strings: Strings;
  /** Sent to the iframe in `curtain:context`. */
  locale: string;
  sizeOption?: string;
}

/** A short-lived polite status message on the merchant page ("Your size: M"). */
export function toast(text: string): HTMLElement {
  document.querySelector('.pk-toast')?.remove();
  const t = document.createElement('div');
  t.className = 'pk-toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 6000);
  return t;
}

/**
 * Open the standalone overlay and speak the postMessage protocol with it. Messages are accepted only
 * from the iframe itself (`event.source`) on the embed's origin (`event.origin`); replies go to that
 * origin only, never `*`.
 */
export function openEmbed(o: EmbedOptions): ModalHandle {
  const origin = new URL(o.embedUrl).origin;
  const onMessage = (e: MessageEvent): void => {
    const win = handle.frame?.contentWindow;
    const d = e.data as Record<string, unknown> | null;
    if (!win || e.source !== win || e.origin !== origin || !d || d.source !== 'curtain' || d.v !== 1) return;
    if (d.type === 'curtain:ready') {
      handle.ready();
      const ctx: EmbedContextMessage = { source: 'curtain', v: 1, type: 'curtain:context', locale: o.locale };
      const current = currentSize(o.sizeOption, o.trigger);
      if (current) ctx.currentVariantSize = current;
      win.postMessage(ctx, origin);
    } else if (d.type === 'curtain:close') handle.close();
    else if (d.type === 'curtain:size-selected') {
      const size = typeof d.size === 'string' ? d.size.trim() : '';
      if (!size || size.length > 64) return;
      if (d.productExternalId != null && String(d.productExternalId) !== o.productExternalId) return;
      handle.close();
      const via = selectSize(size, o.productExternalId, o.sizeOption, o.trigger);
      if (via === 'toast') toast(o.strings.yourSize(size));
      const detail: SizeSelectedDetail = { size, productExternalId: o.productExternalId, via };
      (o.trigger || document).dispatchEvent(new CustomEvent('curtain:size-selected', { bubbles: true, detail }));
    }
  };
  addEventListener('message', onMessage);
  const handle = openModal({
    strings: o.strings,
    trigger: o.trigger,
    content: { embedUrl: o.embedUrl, appUrl: o.appUrl },
    onClose: () => removeEventListener('message', onMessage),
  });
  return handle;
}
