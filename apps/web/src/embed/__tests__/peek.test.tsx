// @vitest-environment jsdom
/**
 * The size peek (`/embed/peek`): no remembered profile → nothing rendered, no network, a collapse
 * message with the height only; a remembered profile → "Your size: X", a fit note and the
 * shopper's figure (labelled an estimate), never billed, and no size in any message to the page.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_GARMENTS_BY_ID, SdkSessionRequestSchema, type SdkSessionRequest, type TryResolveResponse } from '@curtain/schema';
import { EMPTY_ABOUT, profileFromAbout } from '../aboutYou';
import { loadPeek, mintPeekToken, parsePeekParams, peekNote, PEEK_SURFACE, type PeekDeps } from '../peek';
import { PeekApp } from '../PeekApp';
import { createEmbedStore, EmbedDb, type EmbedStore } from '../storage';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const SHOP_ORIGIN = 'https://aalter-studio.example';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const SHOP_KEY = 'pk_' + 'test_abcdef123456';
const garment = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
const PARAMS = { shop: SHOP_KEY, product: garment.id };
const device = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'device-token-abc', expiresAt: '2099-01-01T00:00:00.000Z' };

function resolved(over: { paused?: boolean; allowedOrigins?: string[] } = {}): TryResolveResponse {
  return {
    shop: { id: SHOP_ID, name: 'Aalter Studio', platform: 'woocommerce', paused: over.paused ?? false },
    garment,
    trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'intent-token-0123456789' },
    pairing: { created: false, pairedAt: new Date().toISOString() },
    embed: { allowedOrigins: over.allowedOrigins ?? [SHOP_ORIGIN] },
  };
}

let dbN = 0;
async function store(opts: { profile?: boolean; device?: boolean; remember?: boolean } = {}): Promise<EmbedStore> {
  const name = `curtain-embed-peek-${++dbN}`;
  const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
  await s.init();
  if (opts.device ?? true) await s.setDevice(device);
  if (opts.profile ?? true) {
    const about = { ...EMPTY_ABOUT, height: '168', weight: '62' };
    await s.saveProfile({ shopId: SHOP_ID, profile: profileFromAbout(about, garment.category, 1), about, savedAt: 1 });
  }
  if (opts.remember === false) await s.setRemember(false);
  // A fresh store on the same database, as a new page load sees it.
  return createEmbedStore({ openDb: () => new EmbedDb(name) });
}

function makeDeps(s: EmbedStore, over: { resolve?: TryResolveResponse; token?: string | null; ancestor?: string | null; referrer?: string } = {}) {
  const parent = { postMessage: vi.fn() };
  const api = { resolveTry: vi.fn(async () => over.resolve ?? resolved()), fitShown: vi.fn() };
  const mintToken = vi.fn(async (_req: SdkSessionRequest) => (over.token === undefined ? 'try-token-0123456789abcdef' : over.token));
  const deps: PeekDeps = {
    store: s,
    makeApi: () => api,
    mintToken,
    parent,
    referrer: over.referrer ?? `${SHOP_ORIGIN}/`,
    ancestorOrigins: over.ancestor === undefined ? null : over.ancestor === null ? null : [over.ancestor],
  };
  return { deps, parent, api, mintToken };
}

/** Every message the peek posted to the merchant page, with its target origin. */
const posted = (parent: { postMessage: ReturnType<typeof vi.fn> }) => parent.postMessage.mock.calls.map(([data, origin]) => ({ data: data as Record<string, unknown>, origin: origin as string }));

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 117.4, width: 320, top: 0, left: 0, right: 320, bottom: 117.4, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('parsePeekParams', () => {
  it('needs a public shop key and a product id', () => {
    expect(parsePeekParams(`?shop=${SHOP_KEY}&product=linen-1`)).toEqual({ shop: SHOP_KEY, product: 'linen-1' });
    expect(parsePeekParams('?product=linen-1')).toBeNull();
    expect(parsePeekParams(`?shop=${'sk_' + 'test_abcdef123456'}&product=linen-1`)).toBeNull();
    expect(parsePeekParams(`?shop=${SHOP_KEY}`)).toBeNull();
    expect(parsePeekParams(`?shop=${SHOP_KEY}&product=${'x'.repeat(129)}`)).toBeNull();
  });
});

describe('peekNote', () => {
  it('a band note without the size-up/down advice, never the "Edit my measurements" hint', () => {
    expect(peekNote(['Tight at the hip — consider a size up', 'Snug at the waist'], 'M')).toBe('Tight at the hip');
    expect(peekNote(['Add your bust measurement under Edit my measurements for a more confident result'], 'M')).toBe('Size M fits you well');
    expect(peekNote([], 'L')).toBe('Size L fits you well');
  });
});

describe('loadPeek', () => {
  it('no remembered profile: null, and no request at all (no session, no device, no try lookup)', async () => {
    const { deps, mintToken, api } = makeDeps(await store({ profile: false }));
    expect(await loadPeek(PARAMS, deps)).toBeNull();
    expect(mintToken).not.toHaveBeenCalled();
    expect(api.resolveTry).not.toHaveBeenCalled();
  });

  it('"Remember me" off, or no remembered device: null without a request (the peek never registers a device)', async () => {
    for (const s of [await store({ remember: false }), await store({ device: false })]) {
      const { deps, mintToken } = makeDeps(s);
      expect(await loadPeek(PARAMS, deps)).toBeNull();
      expect(mintToken).not.toHaveBeenCalled();
    }
  });

  it('a remembered profile: mints an unbillable session for the page origin, resolves it, fits on the device', async () => {
    const { deps, mintToken, api } = makeDeps(await store(), { ancestor: SHOP_ORIGIN });
    const r = await loadPeek(PARAMS, deps);
    expect(r).not.toBeNull();
    expect(r!.advice.size).toMatch(/^(XS|S|M|L|XL)$/);
    expect(r!.targetOrigin).toBe(SHOP_ORIGIN);
    expect(mintToken).toHaveBeenCalledTimes(1);
    const req = mintToken.mock.calls[0]![0];
    expect(req).toEqual({ shopKeyPrefix: SHOP_KEY, productExternalId: garment.id, pageUrl: `${SHOP_ORIGIN}/`, surface: 'api' });
    // The wire shape is the SDK's own handshake; `api` sessions are never billed by fit-shown.
    expect(SdkSessionRequestSchema.parse(req).surface).toBe(PEEK_SURFACE);
    expect(PEEK_SURFACE).not.toBe('embed');
    expect(api.resolveTry).toHaveBeenCalledWith('try-token-0123456789abcdef');
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it('shows nothing for a paused shop, a profile of another shop, or a page origin the shop does not own', async () => {
    const paused = makeDeps(await store(), { resolve: resolved({ paused: true }) });
    expect(await loadPeek(PARAMS, paused.deps)).toBeNull();
    const elsewhere = makeDeps(await store(), { resolve: { ...resolved(), shop: { ...resolved().shop, id: '00000000-0000-4000-8000-0000000000ff' } } });
    expect(await loadPeek(PARAMS, elsewhere.deps)).toBeNull();
    const foreign = makeDeps(await store(), { referrer: 'https://evil.example/', ancestor: 'https://evil.example' });
    expect(await loadPeek(PARAMS, foreign.deps)).toBeNull();
    const noSession = makeDeps(await store(), { token: null });
    expect(await loadPeek(PARAMS, noSession.deps)).toBeNull();
  });
});

describe('mintPeekToken', () => {
  it('posts the public handshake without cookies and returns the token from embedUrl; null on 402', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tryUrl: 'https://app.curtain.test/try/tok.en', embedUrl: 'https://app.curtain.test/embed/tok.en', expiresAt: 'x', shopPaused: false }), { status: 200 }));
    const req: SdkSessionRequest = { shopKeyPrefix: SHOP_KEY, productExternalId: 'p', pageUrl: `${SHOP_ORIGIN}/`, surface: 'api' };
    expect(await mintPeekToken(req, 'https://api.curtain.test', fetchImpl as unknown as typeof fetch)).toBe('tok.en');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.curtain.test/v1/sdk/sessions');
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(String(init.body))).toEqual(req);
    const paused = vi.fn(async () => new Response(JSON.stringify({ embedUrl: 'https://app.curtain.test/embed/t' }), { status: 402 }));
    expect(await mintPeekToken(req, 'https://api.curtain.test', paused as unknown as typeof fetch)).toBeNull();
  });
});

describe('PeekApp', () => {
  it('no profile: renders nothing and asks the page to collapse with the height only', async () => {
    const { deps, parent, mintToken } = makeDeps(await store({ profile: false }));
    const { container } = render(<PeekApp params={PARAMS} deps={deps} />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(posted(parent)).toEqual([{ data: { source: 'curtain', v: 1, type: 'curtain:peek-size', height: 0 }, origin: SHOP_ORIGIN }]);
    expect(mintToken).not.toHaveBeenCalled();
  });

  it('bad parameters: collapses without touching storage or the network', async () => {
    const { deps, parent, mintToken } = makeDeps(await store());
    render(<PeekApp params={null} deps={deps} />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalled());
    expect(posted(parent)[0]!.data).toEqual({ source: 'curtain', v: 1, type: 'curtain:peek-size', height: 0 });
    expect(mintToken).not.toHaveBeenCalled();
  });

  it('a profile: "Your size: X", a note, the figure with the estimate label, and a height for the page', async () => {
    const { deps, parent, api } = makeDeps(await store());
    render(<PeekApp params={PARAMS} deps={deps} />);
    const size = await screen.findByTestId('peek-size');
    expect(size).toHaveTextContent(/^Your size: (XS|S|M|L|XL)$/);
    const avatar = screen.getByTestId('peek-avatar');
    expect(avatar.querySelector('svg[role="img"]')).toHaveAttribute('aria-label', expect.stringMatching(/^Estimated look of .* not measured$/));
    expect(avatar.querySelector('[data-testid="garment-layer"]')).not.toBeNull();
    expect(screen.getByTestId('estimate-badge')).toHaveTextContent('Estimate');
    expect(screen.getByRole('button', { name: /^See how size \S+ fits you$/ })).toBeInTheDocument();
    await waitFor(() => expect(posted(parent).some((m) => m.data.height === 118)).toBe(true));
    expect(posted(parent).every((m) => m.origin === SHOP_ORIGIN)).toBe(true);
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it('mints one session per page, also under StrictMode (effects run twice in development)', async () => {
    const { deps, mintToken } = makeDeps(await store());
    render(
      <StrictMode>
        <PeekApp params={PARAMS} deps={deps} />
      </StrictMode>,
    );
    await screen.findByTestId('peek-size');
    expect(mintToken).toHaveBeenCalledTimes(1);
  });

  it('privacy: no message to the page carries the size, a measurement or anything but the height', async () => {
    const user = userEvent.setup();
    const { deps, parent } = makeDeps(await store());
    render(<PeekApp params={PARAMS} deps={deps} />);
    const shown = (await screen.findByTestId('peek-size')).textContent!.replace('Your size: ', '');
    await act(async () => {
      await user.click(screen.getByTestId('peek-open'));
    });
    const msgs = posted(parent);
    expect(msgs.at(-1)).toEqual({ data: { source: 'curtain', v: 1, type: 'curtain:peek-open' }, origin: SHOP_ORIGIN });
    for (const { data } of msgs) {
      expect(Object.keys(data).every((k) => ['source', 'v', 'type', 'height'].includes(k))).toBe(true);
      expect(['curtain:peek-size', 'curtain:peek-open']).toContain(data.type);
      expect(JSON.stringify(data)).not.toContain(`"${shown}"`);
    }
  });
});
