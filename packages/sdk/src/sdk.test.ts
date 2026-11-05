import { ESTIMATE_DISCLAIMER as SCHEMA_DISCLAIMER } from '@curtain/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESTIMATE_DISCLAIMER, pickStrings, STRINGS } from './i18n';
import { closeModal } from './modal';
import { configure, destroy, getConfig, init, isMobile, open, scan } from './sdk';
import { VERSION } from './version';

const UA_DESKTOP = navigator.userAgent;

const SHOP = 'pk_test_abcdef123456';
const API = 'https://api.curtain.test';
const session = {
  tryUrl: 'https://app.curtain.test/try/eyJ.token',
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  shopPaused: false,
};

function mockFetch(status: number, body: unknown = session): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

function button(id = 'aalter-studio-1', html = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute('data-curtain-product', id);
  b.innerHTML = html;
  document.body.append(b);
  return b;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = '';
});

afterEach(() => {
  destroy();
  closeModal();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Undo any per-test navigator.userAgent override (own property shadowing the prototype getter).
  delete (navigator as unknown as Record<string, unknown>)['userAgent'];
  expect(navigator.userAgent).toBe(UA_DESKTOP);
});

describe('button discovery', () => {
  it('binds <button data-curtain-product>, fills an empty label, sets type=button and styles it', () => {
    const b = button();
    init({ shop: SHOP, api: API });
    expect(b.hasAttribute('data-curtain-bound')).toBe(true);
    expect(b.type).toBe('button');
    expect(b.textContent).toBe('Try it on');
    expect(b.classList.contains('pk-btn')).toBe(true);
    expect(document.getElementById('curtain-sdk-style')).not.toBeNull();
  });

  it('keeps the merchant label, respects data-curtain-unstyled, and binds non-button elements accessibly', () => {
    const b = button('x', 'Try this');
    b.setAttribute('data-curtain-unstyled', '');
    const div = document.createElement('div');
    div.setAttribute('data-curtain-product', 'y');
    document.body.append(div);
    init({ shop: SHOP, api: API });
    expect(b.textContent).toBe('Try this');
    expect(b.classList.contains('pk-btn')).toBe(false);
    expect(div.getAttribute('role')).toBe('button');
    expect(div.getAttribute('tabindex')).toBe('0');
    expect(div.textContent).toBe('Try it on');
  });

  it('uses Dutch labels from <html lang="nl"> and a custom label from config', () => {
    document.documentElement.lang = 'nl-BE';
    const b = button();
    init({ shop: SHOP, api: API });
    expect(b.textContent).toBe('Try it on');
    destroy();
    const c = button();
    init({ shop: SHOP, api: API, label: 'Give it a go' });
    expect(c.textContent).toBe('Give it a go');
  });

  it('follows the shop page language, never the browser language, and never says "paskamer"', () => {
    const lang = Object.getOwnPropertyDescriptor(navigator, 'language');
    Object.defineProperty(navigator, 'language', { value: 'nl-NL', configurable: true });
    try {
      document.documentElement.lang = '';
      expect(pickStrings().close).toBe('Close');
      document.documentElement.lang = 'en';
      expect(pickStrings().yourSize('M')).toBe('Your size: M');
      document.documentElement.lang = 'nl';
      expect(pickStrings().close).toBe('Sluiten');
      expect(pickStrings('en-GB').close).toBe('Close');
    } finally {
      if (lang) Object.defineProperty(navigator, 'language', lang);
      else delete (navigator as unknown as Record<string, unknown>).language;
    }
    for (const table of Object.values(STRINGS)) {
      expect(JSON.stringify({ ...table, expires: table.expires(1), yourSize: table.yourSize('M') })).not.toMatch(/paskamer/i);
    }
  });

  it('skips the stylesheet entirely when configured unstyled', () => {
    button();
    init({ shop: SHOP, api: API, unstyled: true });
    expect(document.getElementById('curtain-sdk-style')).toBeNull();
  });

  it('picks up buttons added later (SPA storefronts) via MutationObserver', async () => {
    init({ shop: SHOP, api: API });
    const b = button('late');
    await flush();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(b.hasAttribute('data-curtain-bound')).toBe(true);
    expect(scan()).toBe(1);
  });

  it('exposes window.Curtain = { open, configure, version } and destroy() removes it', () => {
    init({ shop: SHOP, api: API });
    expect(typeof window.Curtain?.open).toBe('function');
    expect(typeof window.Curtain?.configure).toBe('function');
    expect(window.Curtain?.version).toBe(VERSION);
    destroy();
    expect(window.Curtain).toBeUndefined();
  });
});

describe('configure', () => {
  it('rejects anything that is not a public key prefix (never a secret key)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    configure({ shop: ('sk_' + 'live_abcdefgh12345678'), api: API });
    expect(getConfig().shop).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    configure({ shop: SHOP });
    expect(getConfig().shop).toBe(SHOP);
  });

  it('strips trailing slashes from the api origin', () => {
    configure({ shop: SHOP, api: 'https://api.curtain.test///' });
    expect(getConfig().api).toBe('https://api.curtain.test');
  });
});

describe('click → handshake', () => {
  it('app mode: POSTs exactly {shopKeyPrefix, productExternalId, pageUrl, surface} without credentials, then opens the QR modal on desktop', async () => {
    const fetchMock = mockFetch(200);
    const b = button('aalter-studio-1');
    init({ shop: SHOP, api: API, mode: 'app' });
    b.click();
    expect(b.getAttribute('aria-busy')).toBe('true');
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, reqInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/sdk/sessions`);
    expect(reqInit.method).toBe('POST');
    expect(reqInit.credentials).toBe('omit');
    expect(JSON.parse(reqInit.body as string)).toEqual({
      shopKeyPrefix: SHOP,
      productExternalId: 'aalter-studio-1',
      pageUrl: location.href,
      surface: 'button',
    });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('img')!.src).toContain('data:image/svg+xml');
    expect(dialog.querySelector('.pk-meta a')!.getAttribute('href')).toBe(session.tryUrl);
    expect(b.getAttribute('aria-busy')).toBeNull();
    expect(dialog.textContent).toContain('Scan with your phone to try it on in Curtain');
  });

  it('app mode without qrSvg still offers the link (the encoder is not bundled); programmatic calls report surface=api', async () => {
    const fetchMock = mockFetch(200, { ...session, qrSvg: undefined });
    init({ shop: SHOP, api: API });
    const r = await open('p1', { mode: 'modal' });
    expect(r.kind).toBe('modal');
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).surface).toBe('api');
    expect(document.querySelector('[role="dialog"] img')).toBeNull();
    expect(document.querySelector('[role="dialog"] .pk-meta a')?.getAttribute('href')).toBe(session.tryUrl);
  });

  it('redirects to tryUrl on a mobile user agent (universal link)', async () => {
    mockFetch(200);
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      configurable: true,
    });
    const navigate = vi.fn();
    init({ shop: SHOP, api: API, navigate });
    const r = await open('p1');
    expect(r.kind).toBe('redirect');
    expect(navigate).toHaveBeenCalledWith(session.tryUrl);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('isMobile recognises phones, tablets and iPadOS-as-Mac', () => {
    expect(isMobile('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari', 5)).toBe(true);
    expect(isMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 5)).toBe(true);
    expect(isMobile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', 0)).toBe(false);
    expect(isMobile('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome', 0)).toBe(false);
  });

  it('still opens the link when the backend says the shop is paused but returns a tryUrl (402/423)', async () => {
    mockFetch(402, { ...session, shopPaused: true });
    const navigate = vi.fn();
    init({ shop: SHOP, api: API, navigate });
    const r = await open('p1', { mode: 'redirect' });
    expect(r.kind).toBe('redirect');
    expect(navigate).toHaveBeenCalledWith(session.tryUrl);
    mockFetch(423, { ...session, shopPaused: true });
    const r2 = await open('p1', { mode: 'modal' });
    expect(r2.kind).toBe('modal');
    expect(document.querySelector('[role="dialog"] .pk-note')?.textContent).toBe(STRINGS.en.pausedShort);
  });

  it('shows a polite message when paused without a link, and on server/network errors — never throws', async () => {
    mockFetch(402, { error: 'shop paused' });
    init({ shop: SHOP, api: API });
    const r = await open('p1');
    expect(r).toEqual({ kind: 'paused', status: 402 });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(STRINGS.en.paused);
    closeModal();

    mockFetch(500, undefined);
    const r2 = await open('p1');
    expect(r2.kind).toBe('error');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(STRINGS.en.error);
    closeModal();

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const r3 = await open('p1');
    expect(r3.kind).toBe('error');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(STRINGS.en.error);
  });

  it('ignores clicks while a handshake is in flight and when unconfigured', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolve = r))));
    init({ shop: SHOP, api: API });
    const p1 = open('p1', { mode: 'modal' });
    const r2 = await open('p2');
    expect(r2).toEqual({ kind: 'ignored', reason: 'busy' });
    resolve(new Response(JSON.stringify(session), { status: 200 }));
    expect((await p1).kind).toBe('modal');
    destroy();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await open('p1')).toEqual({ kind: 'ignored', reason: 'unconfigured' });
    expect(await open('')).toEqual({ kind: 'ignored', reason: 'no-product' });
  });

  it('returns focus to the button when the modal closes', async () => {
    mockFetch(200);
    const b = button();
    init({ shop: SHOP, api: API });
    b.focus();
    await open('p1', { trigger: b, mode: 'modal' });
    expect(document.activeElement).not.toBe(b);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(b);
  });

  it('a keyboard activation on a non-button element also opens', async () => {
    const fetchMock = mockFetch(200);
    const div = document.createElement('div');
    div.setAttribute('data-curtain-product', 'kb');
    document.body.append(div);
    init({ shop: SHOP, api: API });
    div.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('contracts', () => {
  it('shows the same estimate disclaimer as @curtain/schema', () => {
    expect(ESTIMATE_DISCLAIMER).toBe(SCHEMA_DISCLAIMER);
    expect(STRINGS.en.disclaimer).toBe(SCHEMA_DISCLAIMER);
  });

  it('window.Curtain.version is the package version', () => {
    init({ shop: SHOP, api: API });
    expect(window.Curtain?.version).toBe(VERSION);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
