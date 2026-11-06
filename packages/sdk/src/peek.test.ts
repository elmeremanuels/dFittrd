/**
 * The size peek (packages/sdk/README.md, "Size peek"): a lazy iframe next to each button that takes
 * no space until it reports a height, and the only two messages the page accepts from it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRINGS } from './i18n';
import { PEEK_MAX_HEIGHT } from './peek';
import { configFromScript, destroy, init } from './sdk';

const SHOP = 'pk_' + 'test_abcdef123456';
const API = 'https://api.curtain.test';
const APP = 'https://app.curtain.test';

/** A controllable IntersectionObserver: `intersect()` makes every observed element visible. */
class FakeIO {
  static all: FakeIO[] = [];
  targets: Element[] = [];
  constructor(
    private readonly cb: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIO.all.push(this);
  }
  observe(el: Element): void {
    this.targets.push(el);
  }
  unobserve(el: Element): void {
    this.targets = this.targets.filter((t) => t !== el);
  }
  disconnect(): void {
    this.targets = [];
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  static intersect(): void {
    for (const io of [...FakeIO.all]) {
      if (io.targets.length === 0) continue;
      io.cb(io.targets.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), io as unknown as IntersectionObserver);
    }
  }
}

function button(id = 'p1', attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute('data-curtain-product', id);
  for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
  document.body.append(b);
  return b;
}

const peeks = (): HTMLIFrameElement[] => Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src*="/embed/peek"]'));
const msg = (type: string, extra: Record<string, unknown> = {}) => ({ source: 'curtain', v: 1, type, ...extra });
function post(frame: HTMLIFrameElement, data: unknown, origin = APP): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source: frame.contentWindow }));
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.lang = '';
  FakeIO.all = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
});

afterEach(() => {
  destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('size peek: insertion', () => {
  it('data-peek and data-app are read from the script tag (default on)', () => {
    const s = document.createElement('script');
    s.dataset.shop = SHOP;
    s.dataset.api = API;
    s.dataset.app = APP;
    expect(configFromScript(s).app).toBe(APP);
    expect(configFromScript(s).peek).toBeUndefined();
    s.dataset.peek = 'off';
    expect(configFromScript(s).peek).toBe(false);
    s.dataset.peek = 'on';
    expect(configFromScript(s).peek).toBeUndefined();
  });

  it('is lazy: nothing until the button nears the viewport, then one iframe right after it', () => {
    const b = button('linen-1');
    init({ shop: SHOP, api: API, app: `${APP}/` });
    expect(peeks()).toHaveLength(0);
    expect(FakeIO.all[0]!.options?.rootMargin).toBe('300px');
    FakeIO.intersect();
    const [f] = peeks();
    expect(f).toBeDefined();
    expect(b.nextElementSibling).toBe(f);
    const url = new URL(f!.src);
    expect(url.origin).toBe(APP);
    expect(url.pathname).toBe('/embed/peek');
    expect(Object.fromEntries(url.searchParams)).toEqual({ shop: SHOP, product: 'linen-1' });
    expect(f!.title).toBe(STRINGS.en.peek);
    expect(f!.referrerPolicy).toBe('origin');
    // A second visibility change does not add a second frame.
    FakeIO.intersect();
    expect(peeks()).toHaveLength(1);
  });

  it('reserves no space and is out of the tab order until a height arrives (no layout shift)', () => {
    button();
    init({ shop: SHOP, api: API, app: APP });
    FakeIO.intersect();
    const f = peeks()[0]!;
    expect(f.style.height).toBe('0px');
    expect(f.style.visibility).toBe('hidden');
    expect(f.style.display).toBe('block');
    expect(f.style.borderStyle === '' || f.style.border.startsWith('0')).toBe(true);
  });

  it('is off with data-peek="off", data-curtain-peek="off" on the button, or without data-app', () => {
    button('a');
    init({ shop: SHOP, api: API, app: APP, peek: false });
    FakeIO.intersect();
    expect(peeks()).toHaveLength(0);
    destroy();

    document.body.innerHTML = '';
    button('b', { 'data-curtain-peek': 'off' });
    button('c');
    init({ shop: SHOP, api: API, app: APP });
    FakeIO.intersect();
    expect(peeks().map((f) => new URL(f.src).searchParams.get('product'))).toEqual(['c']);
    destroy();

    document.body.innerHTML = '';
    button('d');
    init({ shop: SHOP, api: API });
    FakeIO.intersect();
    expect(peeks()).toHaveLength(0);
  });

  it('makes no request to the api: the peek page decides on its own whether there is anything to show', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    button();
    init({ shop: SHOP, api: API, app: APP });
    FakeIO.intersect();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('without IntersectionObserver there is no peek (and the button still binds)', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const b = button();
    init({ shop: SHOP, api: API, app: APP });
    expect(b.hasAttribute('data-curtain-bound')).toBe(true);
    expect(peeks()).toHaveLength(0);
  });

  it('destroy() removes the frames', () => {
    button();
    init({ shop: SHOP, api: API, app: APP });
    FakeIO.intersect();
    expect(peeks()).toHaveLength(1);
    destroy();
    expect(peeks()).toHaveLength(0);
  });
});

describe('size peek: messages', () => {
  function setup() {
    const b = button('linen-1');
    init({ shop: SHOP, api: API, app: APP });
    FakeIO.intersect();
    return { b, f: peeks()[0]! };
  }

  it('curtain:peek-size grows the frame (capped) and a zero height collapses it again', () => {
    const { f } = setup();
    post(f, msg('curtain:peek-size', { height: 118.2 }));
    expect(f.style.height).toBe('119px');
    expect(f.style.visibility).toBe('');
    post(f, msg('curtain:peek-size', { height: 5000 }));
    expect(f.style.height).toBe(`${PEEK_MAX_HEIGHT}px`);
    post(f, msg('curtain:peek-size', { height: 0 }));
    expect(f.style.height).toBe('0px');
    expect(f.style.visibility).toBe('hidden');
    for (const bad of [-20, 'tall', null, NaN]) {
      post(f, msg('curtain:peek-size', { height: 50 }));
      post(f, msg('curtain:peek-size', { height: bad }));
      expect(f.style.height, String(bad)).toBe('0px');
    }
  });

  it('ignores messages from another origin, another window, or without the envelope', () => {
    const { f } = setup();
    post(f, msg('curtain:peek-size', { height: 100 }), 'https://evil.example');
    post(f, { type: 'curtain:peek-size', height: 100 });
    post(f, { ...msg('curtain:peek-size', { height: 100 }), v: 2 });
    window.dispatchEvent(new MessageEvent('message', { data: msg('curtain:peek-size', { height: 100 }), origin: APP, source: window }));
    expect(f.style.height).toBe('0px');
  });

  it('curtain:peek-open clicks the button, so the normal overlay flow starts (a shopper action inside the peek)', () => {
    const { b, f } = setup();
    const clicked = vi.fn();
    b.addEventListener('click', clicked);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    post(f, msg('curtain:peek-open'));
    expect(clicked).toHaveBeenCalledTimes(1);
    // Anything else from the peek does nothing.
    post(f, msg('curtain:size-selected', { size: 'M', productExternalId: 'linen-1' }));
    post(f, msg('curtain:close'));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('privacy: nothing a peek sends ever puts a size on the merchant page', () => {
    const { f } = setup();
    const events: Event[] = [];
    document.addEventListener('curtain:size-selected', (e) => events.push(e));
    post(f, msg('curtain:peek-size', { height: 100, size: 'M', recommendedSize: 'M' }));
    post(f, msg('curtain:size-selected', { size: 'M', productExternalId: 'linen-1' }));
    expect(events).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/\bM\b/);
    expect(document.querySelector('.pk-toast')).toBeNull();
    // Only the frame's style changed; no data-* about the shopper was written on the page.
    expect(Array.from(f.attributes).map((a) => a.name).filter((n) => n !== 'referrerpolicy').sort()).toEqual(['src', 'style', 'title']);
  });
});
