/**
 * D25 point 5 (changes D7): a shop whose plan is paused shows no button. The SDK asks
 * GET /v1/sdk/shop before a button shows; the buttons wait hidden for the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destroy, init } from './sdk';

const SHOP = 'pk_' + 'test_abcdef123456';
const API = 'https://api.curtain.test';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  await flush();
  await flush();
};

function button(id = 'p1', parent: HTMLElement = document.body): HTMLButtonElement {
  const b = document.createElement('button');
  b.setAttribute('data-curtain-product', id);
  parent.append(b);
  return b;
}

/** The plugins' markup: wrapper, button, hint. */
function pluginButton(): { wrap: HTMLElement; b: HTMLButtonElement; hint: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = 'curtain-try curtain-try--left';
  document.body.append(wrap);
  const b = button('p1', wrap);
  const hint = document.createElement('p');
  hint.textContent = 'Find your size on this page.';
  wrap.append(hint);
  return { wrap, b, hint };
}

function status(answer: () => Promise<Response> | Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (..._args: unknown[]) => answer());
  vi.stubGlobal('fetch', fn);
  return fn;
}
const json = (body: unknown, code = 200): Response => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
const hidden = (el: HTMLElement): boolean => el.style.display === 'none' && el.style.getPropertyPriority('display') === 'important';

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => {
  destroy();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a paused shop shows no button', () => {
  it('asks once per page, with the public key only and no cookies', async () => {
    const fetch = status(() => json({ paused: false }));
    button('a');
    button('b');
    init({ shop: SHOP, api: `${API}/` });
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, req] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/sdk/shop?shop=${SHOP}`);
    expect(req.method).toBeUndefined();
    expect(req.credentials).toBe('omit');
    expect(req.body).toBeUndefined();
  });

  it('paused: the button, its wrapper, hint and every later button stay hidden', async () => {
    status(() => json({ paused: true }));
    const { wrap, b, hint } = pluginButton();
    const bare = button('bare');
    init({ shop: SHOP, api: API });
    await settle();
    expect(hidden(wrap)).toBe(true);
    // The button and hint are inside the hidden wrapper; they are not touched themselves.
    expect(b.style.display).toBe('');
    expect(wrap.contains(hint)).toBe(true);
    expect(hidden(bare)).toBe(true);
    // A button added later (variant switch, quick view) is hidden too.
    const later = button('later');
    window.Curtain!.scan();
    expect(hidden(later)).toBe(true);
  });

  it('wins over a theme rule that sets display on the button', async () => {
    status(() => json({ paused: true }));
    const b = button();
    b.style.setProperty('display', 'inline-flex');
    init({ shop: SHOP, api: API });
    await settle();
    expect(hidden(b)).toBe(true);
    // destroy() gives the element back as it was.
    destroy();
    expect(b.style.display).toBe('inline-flex');
  });

  it('not paused: the button waits hidden for the answer, then shows', async () => {
    let answer!: (r: Response) => void;
    status(() => new Promise<Response>((r) => (answer = r)));
    const { wrap } = pluginButton();
    init({ shop: SHOP, api: API });
    await flush();
    expect(hidden(wrap)).toBe(true);
    answer(json({ paused: false }));
    await settle();
    expect(wrap.style.display).toBe('');
  });

  it('an outage, an older api without the route, or a strange answer never removes the button', async () => {
    for (const answer of [() => Promise.reject(new TypeError('Failed to fetch')), () => json({ error: 'not found' }, 404), () => json({ paused: 'yes' }), () => new Response('<html>', { status: 200 }), () => json({ paused: true }, 500)]) {
      status(answer);
      const b = button();
      init({ shop: SHOP, api: API });
      await settle();
      expect(b.style.display, String(answer)).toBe('');
      destroy();
      b.remove();
    }
  });

  it('gives up waiting after four seconds and shows the button; a late "paused" answer still hides it', async () => {
    vi.useFakeTimers();
    try {
      let answer!: (r: Response) => void;
      status(() => new Promise<Response>((r) => (answer = r)));
      const b = button();
      init({ shop: SHOP, api: API });
      expect(hidden(b)).toBe(true);
      await vi.advanceTimersByTimeAsync(3999);
      expect(hidden(b)).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(b.style.display).toBe('');
      answer(json({ paused: true }));
      await vi.advanceTimersByTimeAsync(10);
      expect(hidden(b)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('after the four seconds a late "not paused" answer or a late failure changes nothing', async () => {
    vi.useFakeTimers();
    try {
      for (const late of [() => json({ paused: false }), () => json({ error: 'x' }, 500)]) {
        let answer!: (r: Response) => void;
        status(() => new Promise<Response>((r) => (answer = r)));
        const b = button();
        init({ shop: SHOP, api: API });
        await vi.advanceTimersByTimeAsync(4000);
        answer(late());
        await vi.advanceTimersByTimeAsync(10);
        expect(b.style.display).toBe('');
        destroy();
        b.remove();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('without a shop key or an api there is nothing to ask and the button is left alone', async () => {
    const fetch = status(() => json({ paused: true }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = button();
    init({});
    await settle();
    expect(fetch).not.toHaveBeenCalled();
    expect(b.style.display).toBe('');
  });

  it('a new key is asked again, and an answer for the old key is ignored', async () => {
    const answers: Array<(r: Response) => void> = [];
    const fetch = status(() => new Promise<Response>((r) => answers.push(r)));
    const b = button();
    init({ shop: SHOP, api: API });
    window.Curtain!.configure({ shop: 'pk_' + 'test_otherkey12345' });
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    answers[0]!(json({ paused: true }));
    await settle();
    // Still waiting for the second key's answer.
    expect(hidden(b)).toBe(true);
    answers[1]!(json({ paused: false }));
    await settle();
    expect(b.style.display).toBe('');
  });

  describe('the plugins print the wrapper hidden (first paint)', () => {
    /** As try-it-on.liquid and Frontend::button_html print it. */
    function waiting(): { wrap: HTMLElement; b: HTMLButtonElement } {
      const { wrap, b } = pluginButton();
      wrap.setAttribute('hidden', '');
      return { wrap, b };
    }
    const shown = (el: HTMLElement): boolean => !el.hasAttribute('hidden') && el.style.display === '';

    it('not paused: hidden until the answer, never shown in between, then shown', async () => {
      let answer!: (r: Response) => void;
      status(() => new Promise<Response>((r) => (answer = r)));
      const { wrap } = waiting();
      init({ shop: SHOP, api: API });
      await flush();
      // The plugin's own hiding is taken off; the SDK's is on.
      expect(wrap.hasAttribute('hidden')).toBe(false);
      expect(hidden(wrap)).toBe(true);
      answer(json({ paused: false }));
      await settle();
      expect(shown(wrap)).toBe(true);
    });

    it('paused: it never shows', async () => {
      status(() => json({ paused: true }));
      const { wrap } = waiting();
      init({ shop: SHOP, api: API });
      await settle();
      expect(hidden(wrap)).toBe(true);
    });

    it('the script did not run: it stays hidden', () => {
      const { wrap } = waiting();
      expect(wrap.hasAttribute('hidden')).toBe(true);
    });

    it('no shop key (nothing to ask): the button is shown', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { wrap } = waiting();
      init({});
      await settle();
      expect(shown(wrap)).toBe(true);
    });

    it('two buttons in one wrapper, and a wrapper added later', async () => {
      status(() => json({ paused: false }));
      const { wrap } = waiting();
      button('second', wrap);
      init({ shop: SHOP, api: API });
      await settle();
      expect(shown(wrap)).toBe(true);
      const later = waiting();
      window.Curtain!.scan();
      expect(shown(later.wrap)).toBe(true);
    });
  });
});
