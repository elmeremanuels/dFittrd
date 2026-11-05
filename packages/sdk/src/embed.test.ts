/**
 * Standalone mode (docs/STANDALONE.md §2): the overlay, the postMessage protocol and variant
 * selection on the merchant page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from './i18n';
import { closeModal, currentModal } from './modal';
import { configFromScript, destroy, init, open } from './sdk';
import { CSS } from './styles';
import type { SizeSelectedDetail } from './types';
import { currentSize, selectSize } from './variant';

const SHOP = 'pk_test_abcdef123456';
const API = 'https://api.curtain.test';
const EMBED_ORIGIN = 'https://app.curtain.test';
const session = {
  tryUrl: `${EMBED_ORIGIN}/try/eyJ.token`,
  embedUrl: `${EMBED_ORIGIN}/embed/eyJ.token`,
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  shopPaused: false,
};

function mockFetch(body: unknown = session, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

function button(id = 'p1'): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute('data-curtain-product', id);
  document.body.append(b);
  return b;
}

const frame = (): HTMLIFrameElement => document.querySelector<HTMLIFrameElement>('[data-curtain-modal] iframe')!;

/** Deliver a message to the parent window as if posted by `source` from `origin`. */
function post(data: unknown, opts: { origin?: string; source?: Window | null } = {}): void {
  const source = opts.source === undefined ? frame().contentWindow : opts.source;
  window.dispatchEvent(new MessageEvent('message', { data, origin: opts.origin ?? EMBED_ORIGIN, source }));
}

const msg = (type: string, extra: Record<string, unknown> = {}) => ({ source: 'curtain', v: 1, type, ...extra });

/** Dawn (Online Store 2.0): radios live outside the form and point at it with the `form` attribute. */
function dawnRadios(sizes = ['S', 'M', 'L'], checked = 'S'): HTMLInputElement[] {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<form id="product-form-main" action="/cart/add" method="post"><input type="hidden" name="id" value="1"></form>
     <variant-selects>
       <fieldset><legend>Color</legend>
         <input type="radio" name="Color-1" value="Red" form="product-form-main" checked>
         <input type="radio" name="Color-1" value="M" form="product-form-main">
       </fieldset>
       <fieldset><legend>Size</legend>
         ${sizes.map((s, i) => `<input type="radio" id="sz-${i}" name="Size-2" value="${s}" form="product-form-main"${s === checked ? ' checked' : ''}><label for="sz-${i}">${s}</label>`).join('')}
       </fieldset>
     </variant-selects>`,
  );
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="Size-2"]'));
}

function dawnSelect(option = 'Size'): HTMLSelectElement {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<form action="/cart/add" method="post">
       <label for="opt-color">Color</label>
       <select id="opt-color" name="options[Color]"><option value="M">M</option><option value="Blue">Blue</option></select>
       <label for="opt-size">${option}</label>
       <select id="opt-size" name="options[${option}]"><option value="S">S</option><option value="M">M</option><option value="L">L</option></select>
     </form>`,
  );
  return document.getElementById('opt-size') as HTMLSelectElement;
}

function wooSelect(): HTMLSelectElement {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<form class="variations_form cart" action="/product/dress/" method="post">
       <table class="variations"><tr>
         <th class="label"><label for="pa_size">Size</label></th>
         <td class="value"><select id="pa_size" name="attribute_pa_size">
           <option value="">Choose an option</option>
           <option value="s">S</option><option value="m">M</option><option value="one-size">One size</option>
         </select></td>
       </tr></table>
     </form>`,
  );
  return document.getElementById('pa_size') as HTMLSelectElement;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function openOverlay(config: Record<string, unknown> = {}, id = 'p1'): Promise<HTMLButtonElement> {
  const b = button(id);
  init({ shop: SHOP, api: API, ...config });
  b.focus();
  b.click();
  await flush();
  await flush();
  return b;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = '';
});

afterEach(() => {
  destroy();
  closeModal();
  delete window.CurtainHooks;
  delete (window as { jQuery?: unknown }).jQuery;
  delete (navigator as unknown as Record<string, unknown>)['userAgent'];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('mode', () => {
  it('defaults to embed: POSTs surface=embed and opens the overlay, never the QR', async () => {
    const fetchMock = mockFetch();
    const b = await openOverlay();
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ shopKeyPrefix: SHOP, productExternalId: 'p1', pageUrl: location.href, surface: 'embed' });
    expect(frame().getAttribute('src')).toBe(session.embedUrl);
    expect(document.querySelector('.pk-qr')).toBeNull();
    expect(document.querySelector('.pk-app')).toBeNull();
    expect(b.getAttribute('aria-busy')).toBeNull();
  });

  it('opens the overlay on mobile too (no deep link, no QR)', async () => {
    mockFetch();
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', configurable: true });
    const navigate = vi.fn();
    init({ shop: SHOP, api: API, navigate });
    const r = await open('p1');
    expect(r.kind).toBe('embed');
    expect(navigate).not.toHaveBeenCalled();
    expect(frame()).not.toBeNull();
  });

  it('auto = embed plus an "Open in the Curtain app" link to tryUrl', async () => {
    mockFetch();
    await openOverlay({ mode: 'auto' });
    const a = document.querySelector<HTMLAnchorElement>('.pk-app')!;
    expect(a.textContent).toBe('Open in the Curtain app');
    expect(a.getAttribute('href')).toBe(session.tryUrl);
    expect(a.target).toBe('_blank');
    expect(a.rel).toBe('noopener');
    expect(frame()).not.toBeNull();
  });

  it('app keeps the old flow: surface=button, QR modal on desktop, deep link on mobile', async () => {
    const fetchMock = mockFetch({ ...session, qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    await openOverlay({ mode: 'app' });
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).surface).toBe('button');
    expect(document.querySelector('.pk-qr img')).not.toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    closeModal();
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14) Mobile', configurable: true });
    const navigate = vi.fn();
    init({ shop: SHOP, api: API, mode: 'app', navigate });
    expect((await open('p1')).kind).toBe('redirect');
    expect(navigate).toHaveBeenCalledWith(session.tryUrl);
  });

  it('data-mode: embed / app / auto / legacy values are kept, unknown values fall back to embed', () => {
    const tag = (mode: string): HTMLScriptElement => {
      const s = document.createElement('script');
      s.setAttribute('data-shop', SHOP);
      s.setAttribute('data-api', API);
      s.setAttribute('data-mode', mode);
      s.setAttribute('data-size-option', 'Maat');
      return s;
    };
    for (const m of ['embed', 'app', 'auto', 'redirect', 'modal']) expect(configFromScript(tag(m)).mode).toBe(m);
    for (const m of ['qr', 'APP ', 'standalone', '']) expect(configFromScript(tag(m)).mode).toBeUndefined();
    expect(configFromScript(tag('embed')).sizeOption).toBe('Maat');
  });

  it('an unknown programmatic mode also means embed', async () => {
    mockFetch();
    init({ shop: SHOP, api: API });
    expect((await open('p1', { mode: 'nonsense' as never })).kind).toBe('embed');
  });

  it('falls back to app mode when the API has no (valid) embedUrl', async () => {
    mockFetch({ ...session, embedUrl: undefined, qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    init({ shop: SHOP, api: API });
    expect((await open('p1')).kind).toBe('modal');
    closeModal();
    mockFetch({ ...session, embedUrl: 'javascript:alert(1)' });
    expect((await open('p1')).kind).toBe('modal');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('a paused shop with a session still opens the overlay (the embed shows the paused screen)', async () => {
    mockFetch({ ...session, shopPaused: true }, 402);
    init({ shop: SHOP, api: API });
    expect((await open('p1')).kind).toBe('embed');
  });
});

describe('overlay accessibility', () => {
  it('is a labelled modal dialog with an iframe (allow, title) and a loading state', async () => {
    mockFetch();
    await openOverlay();
    const dialog = currentModal()!.dialog;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(STRINGS.en.title);
    expect(dialog.classList.contains('pk-full')).toBe(true);
    expect(frame().getAttribute('allow')).toBe('camera; fullscreen');
    expect(frame().title).toBe(STRINGS.en.title);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    const status = dialog.querySelector('[role="status"]')!;
    expect(status.textContent).toBe('Loading…');
    expect(document.body.style.overflow).toBe('hidden');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('clears the loading state when the iframe loads', async () => {
    mockFetch();
    await openOverlay();
    frame().dispatchEvent(new Event('load'));
    expect(currentModal()!.dialog.getAttribute('aria-busy')).toBeNull();
    expect(currentModal()!.dialog.querySelector('.pk-load')).toBeNull();
  });

  it('Escape closes, unlocks scrolling and returns focus to the button', async () => {
    mockFetch();
    const b = await openOverlay();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(currentModal()).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(b);
  });

  it('traps focus: Tab cycles close → iframe, and focus that escapes (out of the iframe) comes back', async () => {
    mockFetch();
    const b = await openOverlay({ mode: 'auto' });
    const dialog = currentModal()!.dialog;
    const close = dialog.querySelector<HTMLElement>('.pk-close')!;
    frame().focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
    b.focus(); // e.g. Tab from the last control inside the iframe wraps to the page
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('a sentinel after the iframe sends Tab-out-of-the-iframe back to the close button (A11Y-3)', async () => {
    mockFetch();
    await openOverlay();
    const dialog = currentModal()!.dialog;
    const sentinel = dialog.querySelector<HTMLElement>('[data-pk-sentinel]')!;
    expect(sentinel.previousElementSibling).toBe(frame());
    expect(sentinel.tabIndex).toBe(0);
    sentinel.focus(); // where the browser puts focus after the iframe's last control
    expect(document.activeElement).toBe(dialog.querySelector('.pk-close'));
    // The sentinel is never a stop of its own in the trap.
    frame().focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(e);
    expect(document.activeElement).toBe(dialog.querySelector('.pk-close'));
  });

  it('uses full-screen layout on small screens and honours reduced motion', () => {
    expect(CSS).toMatch(/@media \(max-width:767px\)\{\.pk-fs\{padding:0\}\.pk-full\{border-radius:0/);
    expect(CSS).toMatch(/prefers-reduced-motion:reduce\)\{[^}]*\.pk-toast\{animation:none\}/);
  });
});

describe('postMessage protocol', () => {
  it('answers curtain:ready with curtain:context (locale + current size) to the embed origin only', async () => {
    mockFetch();
    document.documentElement.lang = 'nl-BE';
    dawnRadios(['S', 'M', 'L'], 'L');
    await openOverlay();
    const spy = vi.spyOn(frame().contentWindow!, 'postMessage');
    post(msg('curtain:ready'));
    expect(spy).toHaveBeenCalledWith({ source: 'curtain', v: 1, type: 'curtain:context', locale: 'nl-BE', currentVariantSize: 'L' }, EMBED_ORIGIN);
    expect(currentModal()!.dialog.getAttribute('aria-busy')).toBeNull();
  });

  it('omits currentVariantSize when no size control is found', async () => {
    mockFetch();
    await openOverlay({ locale: 'en' });
    const spy = vi.spyOn(frame().contentWindow!, 'postMessage');
    post(msg('curtain:ready'));
    expect(spy).toHaveBeenCalledWith({ source: 'curtain', v: 1, type: 'curtain:context', locale: 'en' }, EMBED_ORIGIN);
  });

  it('rejects a spoofed origin', async () => {
    mockFetch();
    const radios = dawnRadios();
    await openOverlay();
    const spy = vi.spyOn(frame().contentWindow!, 'postMessage');
    for (const origin of ['https://evil.example', 'http://app.curtain.test', 'https://app.curtain.test.evil.example', 'null']) {
      post(msg('curtain:ready'), { origin });
      post(msg('curtain:size-selected', { productExternalId: 'p1', size: 'M' }), { origin });
      post(msg('curtain:close'), { origin });
    }
    expect(spy).not.toHaveBeenCalled();
    expect(radios[1]!.checked).toBe(false);
    expect(currentModal()).not.toBeNull();
  });

  it('rejects the right origin from the wrong source (another frame, the page itself, none)', async () => {
    mockFetch();
    const other = document.createElement('iframe');
    document.body.append(other);
    await openOverlay();
    for (const source of [other.contentWindow, window, null]) post(msg('curtain:close'), { source });
    expect(currentModal()).not.toBeNull();
  });

  it('ignores messages without the curtain v1 envelope, and messages after close', async () => {
    mockFetch();
    await openOverlay();
    const win = frame().contentWindow!;
    post({ type: 'curtain:close' });
    post({ source: 'curtain', v: 2, type: 'curtain:close' });
    post('curtain:close');
    post(null);
    expect(currentModal()).not.toBeNull();
    post(msg('curtain:close'));
    expect(currentModal()).toBeNull();
    const radios = dawnRadios();
    post(msg('curtain:size-selected', { productExternalId: 'p1', size: 'M' }), { source: win });
    expect(radios[1]!.checked).toBe(false);
  });

  it('size-selected: closes, selects the variant and fires a bubbling curtain:size-selected on the button', async () => {
    mockFetch();
    const radios = dawnRadios();
    const b = await openOverlay();
    const seen: SizeSelectedDetail[] = [];
    document.addEventListener('curtain:size-selected', (e) => {
      expect(e.target).toBe(b);
      seen.push((e as CustomEvent<SizeSelectedDetail>).detail);
    }, { once: true });
    post(msg('curtain:size-selected', { productExternalId: 'p1', size: ' M ' }));
    expect(currentModal()).toBeNull();
    expect(document.activeElement).toBe(b);
    expect(radios[1]!.checked).toBe(true);
    expect(seen).toEqual([{ size: 'M', productExternalId: 'p1', via: 'shopify' }]);
  });

  it('size-selected: ignores a different product, an empty size or an absurdly long one', async () => {
    mockFetch();
    const radios = dawnRadios();
    await openOverlay();
    post(msg('curtain:size-selected', { productExternalId: 'other', size: 'M' }));
    post(msg('curtain:size-selected', { productExternalId: 'p1', size: '  ' }));
    post(msg('curtain:size-selected', { productExternalId: 'p1', size: 42 }));
    post(msg('curtain:size-selected', { productExternalId: 'p1', size: 'M'.repeat(65) }));
    expect(currentModal()).not.toBeNull();
    expect(radios[1]!.checked).toBe(false);
  });

  it('programmatic open without a trigger fires the event on document; toast fallback when nothing matches', async () => {
    mockFetch();
    init({ shop: SHOP, api: API });
    await open('p1');
    const detail = vi.fn();
    document.addEventListener('curtain:size-selected', (e) => detail((e as CustomEvent).detail), { once: true });
    post(msg('curtain:size-selected', { productExternalId: 'p1', size: 'M' }));
    expect(detail).toHaveBeenCalledWith({ size: 'M', productExternalId: 'p1', via: 'toast' });
    const t = document.querySelector('.pk-toast')!;
    expect(t.getAttribute('role')).toBe('status');
    expect(t.textContent).toBe('Your size: M');
  });

  it('a new overlay replaces the previous one and its listener', async () => {
    mockFetch();
    init({ shop: SHOP, api: API });
    await open('p1');
    const first = frame().contentWindow!;
    await open('p1');
    expect(document.querySelectorAll('[data-curtain-modal]').length).toBe(1);
    post(msg('curtain:close'), { source: first });
    expect(currentModal()).not.toBeNull();
  });
});

describe('variant selection', () => {
  it('Shopify Dawn radios: checks the matching value in the Size fieldset and fires input + change (bubbling)', () => {
    const radios = dawnRadios();
    const events: string[] = [];
    document.addEventListener('change', (e) => events.push(`change:${(e.target as HTMLInputElement).value}`), { once: true });
    document.addEventListener('input', (e) => events.push(`input:${(e.target as HTMLInputElement).value}`), { once: true });
    expect(selectSize('m', 'p1')).toBe('shopify');
    expect(radios[1]!.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="Color-1"][value="Red"]')!.checked).toBe(true);
    expect(events).toEqual(['input:M', 'change:M']);
  });

  it('Shopify radios outside any picker element are found through their form attribute', () => {
    document.body.innerHTML =
      '<form id="pf" action="/cart/add"></form><fieldset><legend>Size</legend><input type="radio" name="Size" value="S" form="pf"><input type="radio" name="Size" value="M" form="pf"></fieldset>' +
      '<fieldset><legend>Size</legend><input type="radio" name="Size-x" value="M"></fieldset>';
    expect(selectSize('M', 'p1')).toBe('shopify');
    expect(document.querySelector<HTMLInputElement>('input[form="pf"][value="M"]')!.checked).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[name="Size-x"]')!.checked).toBe(false);
  });

  it('Shopify selects inside form[action*="/cart/add"]: the Size select only, never Color', () => {
    const sel = dawnSelect();
    const color = document.getElementById('opt-color') as HTMLSelectElement;
    const change = vi.fn();
    sel.addEventListener('change', change);
    expect(currentSize()).toBe('S');
    expect(selectSize('L', 'p1')).toBe('shopify');
    expect(sel.value).toBe('L');
    expect(color.value).toBe('M');
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('matches Maat / Taille / Größe by default and a custom data-size-option', () => {
    for (const name of ['Maat', 'taille', 'Größe']) {
      document.body.innerHTML = '';
      const sel = dawnSelect(name);
      expect(selectSize('M', 'p1')).toBe('shopify');
      expect(sel.value).toBe('M');
    }
    document.body.innerHTML = '';
    const sel = dawnSelect('Shoe length');
    expect(selectSize('M', 'p1')).toBe('toast');
    expect(selectSize('M', 'p1', 'Shoe length')).toBe('shopify');
    expect(sel.value).toBe('M');
  });

  it('ignores selects outside a cart form and skips disabled radios', () => {
    document.body.innerHTML = '<form action="/search"><select name="options[Size]"><option>M</option></select></form>';
    expect(selectSize('M', 'p1')).toBe('toast');
    document.body.innerHTML = '';
    const radios = dawnRadios();
    radios[1]!.disabled = true;
    expect(selectSize('M', 'p1')).toBe('toast');
  });

  it('WooCommerce: matches the option by text or slug and triggers jQuery change when jQuery exists', () => {
    const sel = wooSelect();
    const trigger = vi.fn();
    const jq = vi.fn(() => ({ trigger }));
    (window as { jQuery?: unknown }).jQuery = jq;
    const native = vi.fn();
    sel.addEventListener('change', native);
    expect(selectSize('M', 'p1')).toBe('woo');
    expect(sel.value).toBe('m');
    expect(jq).toHaveBeenCalledWith(sel);
    expect(trigger).toHaveBeenCalledWith('change');
    expect(native).not.toHaveBeenCalled();
    expect(selectSize('One size', 'p1')).toBe('woo');
    expect(sel.value).toBe('one-size');
    expect(currentSize()).toBe('One size');
  });

  it('WooCommerce without jQuery dispatches a native bubbling change', () => {
    const sel = wooSelect();
    const native = vi.fn();
    document.addEventListener('change', native, { once: true });
    expect(selectSize('s', 'p1')).toBe('woo');
    expect(sel.value).toBe('s');
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('CurtainHooks.onSizeSelected returning true short-circuits everything', () => {
    const radios = dawnRadios();
    const hook = vi.fn(() => true);
    window.CurtainHooks = { onSizeSelected: hook };
    expect(selectSize('M', 'p9')).toBe('hook');
    expect(hook).toHaveBeenCalledWith({ size: 'M', productExternalId: 'p9' });
    expect(radios[1]!.checked).toBe(false);
  });

  it('a hook returning anything else, or throwing, does not stop the built-in selection', () => {
    const radios = dawnRadios();
    window.CurtainHooks = { onSizeSelected: () => undefined };
    expect(selectSize('M', 'p1')).toBe('shopify');
    radios[0]!.checked = true;
    window.CurtainHooks = {
      onSizeSelected: () => {
        throw new Error('theme bug');
      },
    };
    expect(selectSize('L', 'p1')).toBe('shopify');
    expect(radios[2]!.checked).toBe(true);
  });

  it('falls back to the toast (in Dutch on a Dutch page) when no size control matches', async () => {
    mockFetch();
    document.documentElement.lang = 'nl';
    document.body.insertAdjacentHTML('beforeend', '<form action="/cart/add"><select name="options[Color]"><option>M</option></select></form>');
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    init({ shop: SHOP, api: API });
    const p = open('p1');
    await vi.advanceTimersByTimeAsync(0);
    await p;
    post(msg('curtain:size-selected', { productExternalId: 'p1', size: 'M' }));
    expect(document.querySelector('.pk-toast')?.textContent).toBe('Jouw maat: M');
    await vi.advanceTimersByTimeAsync(6000);
    expect(document.querySelector('.pk-toast')).toBeNull();
  });
});

describe('variant selection on real Dawn markup (F4)', () => {
  const section = (id: string, sizes: string, button = true) =>
    `<section id="${id}"><form action="/cart/add" id="form-${id}"></form><variant-selects><label for="sel-${id}">Size</label><select id="sel-${id}" name="options[Size]" form="form-${id}">${sizes}</select></variant-selects>${button ? `<button id="btn-${id}">Try it on</button>` : ''}</section>`;

  it('only touches the product form of the button, not a quick-add / complete-the-look form earlier on the page', () => {
    document.body.innerHTML =
      section('look', '<option value="S">S</option><option value="M">M</option>', false) + section('main', '<option value="S">S</option><option value="M">M</option>');
    const look = document.getElementById('sel-look') as HTMLSelectElement;
    const main = document.getElementById('sel-main') as HTMLSelectElement;
    expect(selectSize('M', 'p1', undefined, document.getElementById('btn-main'))).toBe('shopify');
    expect(main.value).toBe('M');
    expect(look.value).toBe('S');
    expect(currentSize(undefined, document.getElementById('btn-main'))).toBe('M');
    // Without a trigger the page-wide fallback stays.
    expect(selectSize('M', 'p1')).toBe('shopify');
    expect(look.value).toBe('M');
  });

  it('Dawn 15 dropdowns: numeric id values and "XS - Unavailable" labels', () => {
    document.body.innerHTML = section(
      'main',
      '<option value="1001" data-option-value-id="1001">XS - Unavailable</option><option value="1002" selected>S</option><option value="1003">XS/S</option><option value="1004">M - Sold out</option>',
    );
    const sel = document.getElementById('sel-main') as HTMLSelectElement;
    const btn = document.getElementById('btn-main');
    expect(currentSize(undefined, btn)).toBe('S');
    expect(selectSize('XS', 'p1', undefined, btn)).toBe('shopify');
    expect(sel.value).toBe('1001');
    expect(currentSize(undefined, btn)).toBe('XS');
    expect(selectSize('XS/S', 'p1', undefined, btn)).toBe('shopify');
    expect(sel.value).toBe('1003');
    expect(selectSize('M', 'p1', undefined, btn)).toBe('shopify');
    expect(sel.value).toBe('1004');
  });
});
