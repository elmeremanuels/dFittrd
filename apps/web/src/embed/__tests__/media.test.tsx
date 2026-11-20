// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { MOCK_EMBED_SHOP } from '../deps';
import { ProductHeader } from '../EmbedScreens';
import { mediaProxyUrl } from '../media';

afterEach(cleanup);

const SHOP = '3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192';

describe('mediaProxyUrl (carry-over #11)', () => {
  it('points merchant images at our api, never at the merchant host', () => {
    const u = 'https://cdn.shop.example/logo.png?v=2&x=a b';
    const proxied = mediaProxyUrl(SHOP, u, 'https://api.curtain.test');
    expect(proxied).toBe(`https://api.curtain.test/v1/sdk/media?shop=${SHOP}&u=${encodeURIComponent(u)}`);
    const parsed = new URL(proxied!);
    expect(parsed.origin).toBe('https://api.curtain.test');
    expect(parsed.searchParams.get('u')).toBe(u);
  });

  it('nothing to load for missing images, non-http URLs and the mock shop', () => {
    expect(mediaProxyUrl(SHOP, undefined, 'https://api')).toBeNull();
    expect(mediaProxyUrl(null, 'https://cdn.shop.example/a.png', 'https://api')).toBeNull();
    expect(mediaProxyUrl(SHOP, 'javascript:alert(1)', 'https://api')).toBeNull();
    expect(mediaProxyUrl(SHOP, 'data:image/png;base64,AAAA', 'https://api')).toBeNull();
    expect(mediaProxyUrl(SHOP, 'not a url', 'https://api')).toBeNull();
    expect(mediaProxyUrl(MOCK_EMBED_SHOP.id, 'https://cdn.shop.example/a.png', 'https://api')).toBeNull();
  });
});

describe('ProductHeader product photo', () => {
  const garment = { ...MOCK_GARMENTS_BY_ID['aalter-studio-1']!, productPhotos: ['https://cdn.aalter.example/p1.jpg'] };
  const shop = { id: SHOP, name: 'Aalter Studio', platform: 'woocommerce' as const, paused: false };

  it('loads through /v1/sdk/media and falls back to the initial when the proxy fails', () => {
    render(<ProductHeader shop={shop} garment={garment} />);
    const img = screen.getByTestId('embed-product-photo');
    const src = new URL(img.getAttribute('src')!);
    expect(src.pathname).toBe('/v1/sdk/media');
    expect(src.searchParams.get('u')).toBe('https://cdn.aalter.example/p1.jpg');
    expect(src.host).not.toBe('cdn.aalter.example');
    fireEvent.error(img);
    expect(screen.queryByTestId('embed-product-photo')).toBeNull();
  });

  it('the mock shop shows no remote photo at all', () => {
    render(<ProductHeader shop={{ ...shop, id: MOCK_EMBED_SHOP.id }} garment={garment} />);
    expect(screen.queryByTestId('embed-product-photo')).toBeNull();
  });
});
