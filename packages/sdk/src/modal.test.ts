import { afterEach, describe, expect, it } from 'vitest';
import { STRINGS } from './i18n';
import { closeModal, currentModal, minutesLeft, openModal, svgToDataUrl } from './modal';
import { CSS } from './styles';

const strings = STRINGS.en;
const content = {
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
  tryUrl: 'https://app.paskamer.app/try/abc',
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
};

function key(target: EventTarget, key: string, shiftKey = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  closeModal();
  document.body.innerHTML = '';
});

describe('openModal — accessibility', () => {
  it('renders role=dialog with aria-modal, a resolvable label and description, and the disclaimer', () => {
    const { dialog } = openModal({ strings, content });
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!);
    const desc = document.getElementById(dialog.getAttribute('aria-describedby')!);
    expect(title?.textContent).toBe(strings.title);
    expect(desc?.textContent).toBe('Scan with your phone to try it on in Paskamer');
    expect(dialog.querySelector('.pk-disclaimer')?.textContent).toBe(strings.disclaimer);
    expect(dialog.querySelector('.pk-close')?.getAttribute('aria-label')).toBe('Close');
  });

  it('renders the QR as an inert <img data: URL> with alt text and an "open the link" fallback', () => {
    const { dialog } = openModal({ strings, content });
    const img = dialog.querySelector<HTMLImageElement>('.pk-qr img')!;
    expect(img.alt).toBe(strings.qrAlt);
    expect(img.src).toBe(svgToDataUrl(content.qrSvg));
    expect(dialog.querySelector('script')).toBeNull();
    const link = dialog.querySelector<HTMLAnchorElement>('.pk-meta a')!;
    expect(link.href).toBe(content.tryUrl);
    expect(link.rel).toBe('noopener');
    expect(dialog.querySelector('.pk-meta')?.textContent).toContain('expires in 10 min');
  });

  it('moves focus into the dialog and traps Tab / Shift+Tab', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const { dialog } = openModal({ strings, content, trigger });
    expect(dialog.contains(document.activeElement)).toBe(true);
    const focusables = dialog.querySelectorAll<HTMLElement>('button,a[href]');
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    last.focus();
    const e1 = key(document, 'Tab');
    expect(e1.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const e2 = key(document, 'Tab', true);
    expect(e2.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    // Focus outside the dialog is pulled back in.
    trigger.focus();
    key(document, 'Tab');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    let closed = 0;
    openModal({ strings, content, trigger, onClose: () => closed++ });
    expect(document.body.style.overflow).toBe('hidden');
    key(document, 'Escape');
    expect(document.querySelector('[data-paskamer-modal]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('');
    expect(closed).toBe(1);
    expect(currentModal()).toBeNull();
  });

  it('closes on the close button and on backdrop click; only one dialog at a time', () => {
    const a = openModal({ strings, content });
    const b = openModal({ strings, content });
    expect(a.root.isConnected).toBe(false);
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    b.root.querySelector<HTMLElement>('.pk-overlay')!.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const c = openModal({ strings, content });
    c.root.querySelector<HTMLElement>('.pk-close')!.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows a paused note when the shop is below plan, and a message-only dialog on errors', () => {
    const { dialog } = openModal({ strings, content: { ...content, paused: true } });
    expect(dialog.querySelector('.pk-note')?.textContent).toBe(strings.pausedShort);
    closeModal();
    const m = openModal({ strings, content: { message: strings.error } });
    expect(m.dialog.querySelector('img')).toBeNull();
    expect(m.dialog.querySelector('.pk-desc')?.textContent).toBe(strings.error);
    expect(m.dialog.querySelector('.pk-disclaimer')).not.toBeNull();
  });

  it('speaks Dutch when given the nl table', () => {
    const { dialog } = openModal({ strings: STRINGS.nl, content });
    expect(dialog.querySelector('.pk-title')?.textContent).toBe('Pas het in Paskamer');
    expect(dialog.querySelector('.pk-close')?.getAttribute('aria-label')).toBe('Sluiten');
  });
});

describe('styles', () => {
  it('is reduced-motion aware and uses the brand tokens', () => {
    expect(CSS).toMatch(/@media \(prefers-reduced-motion:reduce\)\{[^}]*animation:none/);
    for (const token of ['#FF5A3C', '#F5EFE7', '#1A1612']) expect(CSS).toContain(token);
    expect(CSS).not.toMatch(/@import|url\(/);
  });
});

describe('minutesLeft', () => {
  it('rounds up to at least one minute and rejects past or invalid dates', () => {
    const now = Date.parse('2026-11-04T10:00:00Z');
    expect(minutesLeft('2026-11-04T10:10:00Z', now)).toBe(10);
    expect(minutesLeft('2026-11-04T10:00:20Z', now)).toBe(1);
    expect(minutesLeft('2026-11-04T09:00:00Z', now)).toBeNull();
    expect(minutesLeft('nope', now)).toBeNull();
    expect(minutesLeft(undefined, now)).toBeNull();
  });
});
