import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoInit, configFromScript, destroy, findScriptTag, getConfig } from './sdk';

function scriptTag(attrs: Record<string, string>): HTMLScriptElement {
  const s = document.createElement('script');
  for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
  document.head.append(s);
  return s;
}

afterEach(() => {
  destroy();
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('autoInit from the <script> tag', () => {
  it('reads data-shop and data-api and installs window.Paskamer', () => {
    scriptTag({ src: 'https://cdn.example.com/sdk.v1.js', 'data-shop': ('pk_' + 'live_shopkey01'), 'data-api': 'https://api.paskamer.app/' });
    const b = document.createElement('button');
    b.setAttribute('data-paskamer-product', 'p');
    document.body.append(b);
    const api = autoInit();
    expect(api).not.toBeNull();
    expect(window.Paskamer).toBe(api);
    expect(getConfig()).toMatchObject({ shop: ('pk_' + 'live_shopkey01'), api: 'https://api.paskamer.app' });
    expect(b.hasAttribute('data-paskamer-bound')).toBe(true);
  });

  it('derives the api origin from the script src when data-api is absent', () => {
    const s = scriptTag({ src: 'https://api.paskamer.app/sdk.v1.js?v=1', 'data-shop': 'pk_test_shopkey01' });
    expect(configFromScript(s).api).toBe('https://api.paskamer.app');
    autoInit();
    expect(getConfig().api).toBe('https://api.paskamer.app');
  });

  it('maps data-mode, data-locale, data-label and data-paskamer-unstyled', () => {
    const s = scriptTag({
      src: 'https://api.paskamer.app/sdk.v1.js',
      'data-shop': 'pk_test_shopkey01',
      'data-mode': 'modal',
      'data-locale': 'nl',
      'data-label': 'Pas mij',
      'data-paskamer-unstyled': '',
    });
    expect(configFromScript(s)).toEqual({
      shop: 'pk_test_shopkey01',
      api: 'https://api.paskamer.app',
      mode: 'modal',
      locale: 'nl',
      label: 'Pas mij',
      unstyled: true,
    });
  });

  it('prefers the last script[data-shop] when currentScript is unavailable, and is a no-op without one', () => {
    expect(findScriptTag()).toBeNull();
    expect(autoInit()).toBeNull();
    scriptTag({ src: 'https://a.example/sdk.v1.js', 'data-shop': 'pk_test_first0001' });
    const last = scriptTag({ src: 'https://b.example/sdk.v1.js', 'data-shop': 'pk_test_second001' });
    expect(findScriptTag()).toBe(last);
  });

  it('warns but still installs the API when data-shop is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scriptTag({ src: 'https://api.paskamer.app/sdk.v1.js', 'data-shop': '' });
    expect(autoInit()).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('data-shop missing'));
    expect(window.Paskamer?.version).toBeDefined();
  });
});
