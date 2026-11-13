/**
 * Regression tests from the platform review (Nov 2026): the SDK runs on a merchant's page, so it
 * must never execute a script URL, never double-bind, and send the API as little as possible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeModal, currentModal } from './modal';
import { autoInit, destroy, init, open } from './sdk';

const SHOP = 'pk_test_abcdef123456';
const API = 'https://api.curtain.test';

function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const session = (tryUrl: string) => ({
  tryUrl,
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  shopPaused: false,
});

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  destroy();
  closeModal();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  delete (window as { Curtain?: unknown }).Curtain;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('tryUrl is never a script URL', () => {
  it('refuses to navigate to a javascript: tryUrl on mobile and shows the polite error instead', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch(session('javascript:alert(document.cookie)'));
    const navigate = vi.fn();
    init({ shop: SHOP, api: API, navigate, mode: 'redirect' });
    const r = await open('p1');
    expect(navigate).not.toHaveBeenCalled();
    expect(r.kind).toBe('error');
    expect(currentModal()?.dialog.querySelector('a')).toBeNull();
  });

  it('never renders a javascript:/data: tryUrl as the modal link', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.example/x']) {
      stubFetch(session(bad));
      init({ shop: SHOP, api: API, mode: 'modal' });
      const r = await open('p1');
      expect(r.kind).toBe('error');
      const links = Array.from(document.querySelectorAll('[data-curtain-modal] a'));
      expect(links.map((a) => a.getAttribute('href'))).toEqual([]);
      closeModal();
      destroy();
    }
  });

  it('still accepts an https tryUrl', async () => {
    stubFetch(session('https://app.curtain.test/try/abc'));
    const navigate = vi.fn();
    init({ shop: SHOP, api: API, navigate, mode: 'redirect' });
    expect((await open('p1')).kind).toBe('redirect');
    expect(navigate).toHaveBeenCalledWith('https://app.curtain.test/try/abc');
  });
});

describe('pageUrl data minimisation', () => {
  it('sends the product page without its query string or fragment (may carry e-mail/UTM/tokens)', async () => {
    const fetchFn = stubFetch(session('https://app.curtain.test/try/abc'));
    init({ shop: SHOP, api: API, mode: 'modal' });
    await open('p1', { pageUrl: 'https://shop.example/products/dress?utm_source=mail&email=a%40b.nl#reviews' });
    const body = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.pageUrl).toBe('https://shop.example/products/dress');
  });
});

describe('loaded twice on one page', () => {
  it('a second auto-init defers to the instance already on window.Curtain and does not double-bind', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const other = { open: vi.fn(), configure: vi.fn(), scan: vi.fn(() => 1), destroy: vi.fn(), version: '0.0.9' };
    (window as { Curtain?: unknown }).Curtain = other;
    const s = document.createElement('script');
    s.setAttribute('data-shop', SHOP);
    s.setAttribute('data-api', API);
    document.head.append(s);
    const b = document.createElement('button');
    b.setAttribute('data-curtain-product', 'p1');
    document.body.append(b);
    const fetchFn = stubFetch(session('https://app.curtain.test/try/abc'));

    const api = autoInit();
    expect(api).toBe(other);
    expect(window.Curtain).toBe(other);
    expect(b.hasAttribute('data-curtain-bound')).toBe(false);
    b.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchFn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('already loaded'));
  });
});
