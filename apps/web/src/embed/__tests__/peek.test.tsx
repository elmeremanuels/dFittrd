// @vitest-environment jsdom
/**
 * The size peek (`/embed/peek`): no remembered profile → nothing rendered, no network, a collapse
 * message with the height only; a remembered profile → "Your size: X", a fit note and the
 * shopper's figure (labelled an estimate), never billed, and no size in any message to the page.
 * P1/P2: the height the page sees is PEEK_HEIGHT or 0 and never depends on the fit outcome, the
 * size label or the note; the lookup is read-only (no try session, C1/C2).
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_GARMENTS_BY_ID, PeekQuerySchema, type GarmentPayload, type PeekResponse } from '@curtain/schema';
import { EMPTY_ABOUT, profileFromAbout, type SizeAdvice } from '../aboutYou';
import { loadPeek, parsePeekParams, PEEK_HEIGHT, peekNote, peekOutcome, type PeekDeps } from '../peek';
import { PeekApp } from '../PeekApp';
import { createEmbedStore, EmbedDb, type EmbedStore } from '../storage';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const SHOP_ORIGIN = 'https://aalter-studio.example';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const SHOP_KEY = 'pk_' + 'test_abcdef123456';
const garment = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
const PARAMS = { shop: SHOP_KEY, product: garment.id };
const device = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'device-token-abc', expiresAt: '2099-01-01T00:00:00.000Z' };

function resolved(over: { paused?: boolean; allowedOrigins?: string[]; garment?: GarmentPayload } = {}): PeekResponse {
  return {
    shop: { id: SHOP_ID, name: 'Aalter Studio', platform: 'woocommerce', paused: over.paused ?? false },
    garment: over.garment ?? garment,
    embed: { allowedOrigins: over.allowedOrigins ?? [SHOP_ORIGIN] },
  };
}

/** The same product with a one-size chart far from the stored profile: no size fits. */
const tinyOnly: GarmentPayload = { ...garment, sizeChart: [{ ...garment.sizeChart[0]!, size: 'XXS-PETITE-LONG-LABEL', bust: 60, waist: 45, hip: 65 }] };

let dbN = 0;
async function store(opts: { profile?: boolean; device?: boolean; remember?: boolean; height?: string; weight?: string } = {}): Promise<EmbedStore> {
  const name = `curtain-embed-peek-${++dbN}`;
  const s = createEmbedStore({ openDb: () => new EmbedDb(name) });
  await s.init();
  if (opts.device ?? true) await s.setDevice(device);
  if (opts.profile ?? true) {
    const about = { ...EMPTY_ABOUT, height: opts.height ?? '168', weight: opts.weight ?? '62' };
    await s.saveProfile({ shopId: SHOP_ID, profile: profileFromAbout(about, garment.category, 1), about, savedAt: 1 });
  }
  if (opts.remember === false) await s.setRemember(false);
  // A fresh store on the same database, as a new page load sees it.
  return createEmbedStore({ openDb: () => new EmbedDb(name) });
}

function makeDeps(s: EmbedStore, over: { resolve?: PeekResponse; fail?: boolean; ancestor?: string | null; referrer?: string } = {}) {
  const parent = { postMessage: vi.fn() };
  const api = {
    resolvePeek: vi.fn(async (_q: { shop: string; product: string; page: string }) => {
      if (over.fail) throw new Error('404 pairing');
      return over.resolve ?? resolved();
    }),
    resolveTry: vi.fn(),
    fitShown: vi.fn(),
  };
  const deps: PeekDeps = {
    store: s,
    makeApi: () => api,
    parent,
    referrer: over.referrer ?? `${SHOP_ORIGIN}/`,
    ancestorOrigins: over.ancestor === undefined ? null : over.ancestor === null ? null : [over.ancestor],
  };
  return { deps, parent, api };
}

/** Every message the peek posted to the merchant page, with its target origin. */
const posted = (parent: { postMessage: ReturnType<typeof vi.fn> }) => parent.postMessage.mock.calls.map(([data, origin]) => ({ data: data as Record<string, unknown>, origin: origin as string }));

beforeEach(() => {
  // A measured height that is not PEEK_HEIGHT: the peek must never report what it measures.
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
  it('no remembered profile: null, and no request at all (no lookup, no device)', async () => {
    const { deps, api } = makeDeps(await store({ profile: false }));
    expect(await loadPeek(PARAMS, deps)).toBeNull();
    expect(api.resolvePeek).not.toHaveBeenCalled();
    expect(api.resolveTry).not.toHaveBeenCalled();
  });

  it('"Remember me" off, or no remembered device: null without a request (the peek never registers a device)', async () => {
    for (const s of [await store({ remember: false }), await store({ device: false })]) {
      const { deps, api } = makeDeps(s);
      expect(await loadPeek(PARAMS, deps)).toBeNull();
      expect(api.resolvePeek).not.toHaveBeenCalled();
    }
  });

  it('a remembered profile: one read-only lookup for the page origin (no try session), the fit on the device', async () => {
    const { deps, api } = makeDeps(await store(), { ancestor: SHOP_ORIGIN });
    const r = await loadPeek(PARAMS, deps);
    expect(r).not.toBeNull();
    expect(r!.outcome).toMatchObject({ kind: 'size', size: expect.stringMatching(/^(XS|S|M|L|XL)$/) });
    expect(r!.targetOrigin).toBe(SHOP_ORIGIN);
    expect(api.resolvePeek).toHaveBeenCalledTimes(1);
    const q = api.resolvePeek.mock.calls[0]![0];
    expect(q).toEqual({ shop: SHOP_KEY, product: garment.id, page: `${SHOP_ORIGIN}/` });
    expect(PeekQuerySchema.parse(q)).toEqual(q);
    // C1/C2: no session is minted or resolved, nothing is billed
    expect(api.resolveTry).not.toHaveBeenCalled();
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it('P1: with a remembered profile the peek is shown whether a size fits or not (the page cannot probe the body)', async () => {
    const none = await loadPeek(PARAMS, makeDeps(await store(), { resolve: resolved({ garment: tinyOnly }) }).deps);
    expect(none).not.toBeNull();
    expect(none!.outcome.kind).toBe('none');
    // nothing the profile can score, or a fit that throws: "can't recommend yet", still shown
    const r = (await loadPeek(PARAMS, makeDeps(await store()).deps))!;
    expect(peekOutcome(garment, r.embedFit, { size: null, closest: null, engineSize: null, adjusted: null, noPoints: true } as SizeAdvice, r.remembered).kind).toBe('unknown');
    expect(peekOutcome(garment, null, null, r.remembered).kind).toBe('unknown');
  });

  it('a failed lookup (no pairing, unknown or incomplete product) shows nothing', async () => {
    const { deps } = makeDeps(await store(), { fail: true });
    await expect(loadPeek(PARAMS, deps)).rejects.toThrow();
  });

  it('shows nothing for a paused shop, a profile of another shop, or a page origin the shop does not own', async () => {
    const paused = makeDeps(await store(), { resolve: resolved({ paused: true }) });
    expect(await loadPeek(PARAMS, paused.deps)).toBeNull();
    const elsewhere = makeDeps(await store(), { resolve: { ...resolved(), shop: { ...resolved().shop, id: '00000000-0000-4000-8000-0000000000ff' } } });
    expect(await loadPeek(PARAMS, elsewhere.deps)).toBeNull();
    const foreign = makeDeps(await store(), { referrer: 'https://evil.example/', ancestor: 'https://evil.example' });
    expect(await loadPeek(PARAMS, foreign.deps)).toBeNull();
  });
});

describe('PeekApp', () => {
  it('no profile: renders nothing and asks the page to collapse with the height only', async () => {
    const { deps, parent, api } = makeDeps(await store({ profile: false }));
    const { container } = render(<PeekApp params={PARAMS} deps={deps} />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(posted(parent)).toEqual([{ data: { source: 'curtain', v: 1, type: 'curtain:peek-size', height: 0 }, origin: SHOP_ORIGIN }]);
    expect(api.resolvePeek).not.toHaveBeenCalled();
  });

  it('bad parameters: collapses without touching storage or the network', async () => {
    const { deps, parent, api } = makeDeps(await store());
    render(<PeekApp params={null} deps={deps} />);
    await waitFor(() => expect(parent.postMessage).toHaveBeenCalled());
    expect(posted(parent)[0]!.data).toEqual({ source: 'curtain', v: 1, type: 'curtain:peek-size', height: 0 });
    expect(api.resolvePeek).not.toHaveBeenCalled();
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
    await waitFor(() => expect(posted(parent)).toHaveLength(1));
    expect(posted(parent)).toEqual([{ data: { source: 'curtain', v: 1, type: 'curtain:peek-size', height: PEEK_HEIGHT }, origin: SHOP_ORIGIN }]);
    expect(PEEK_HEIGHT).toBe(112); // packages/sdk PEEK_HEIGHT
    expect(screen.getByTestId('peek')).toHaveStyle({ height: `${PEEK_HEIGHT}px` });
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it('P1/P2: "no size fits" posts the very same single height as a size, never a measured one, and re-posts nothing', async () => {
    const heights: unknown[][] = [];
    for (const resolve of [resolved(), resolved({ garment: tinyOnly })]) {
      cleanup();
      const { deps, parent } = makeDeps(await store(), { resolve });
      render(<PeekApp params={PARAMS} deps={deps} />);
      await screen.findByTestId('peek');
      await waitFor(() => expect(posted(parent).length).toBeGreaterThan(0));
      // a layout change (the page resizes the frame) must not produce another message
      window.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 20));
      heights.push(posted(parent).map((m) => m.data.height));
    }
    expect(heights).toEqual([[PEEK_HEIGHT], [PEEK_HEIGHT]]);
    expect(screen.getByTestId('peek')).toHaveAttribute('data-outcome', 'none');
    expect(screen.getByTestId('peek-size')).toHaveTextContent('No size fits well');
    expect(screen.getByTestId('peek-open')).toHaveTextContent('Open the fitting room');
  });

  it('P2: every text line is clamped to one line inside a box that clips', async () => {
    const { deps } = makeDeps(await store());
    render(<PeekApp params={PARAMS} deps={deps} />);
    const box = await screen.findByTestId('peek');
    expect(box.className).toContain('overflow-hidden');
    for (const id of ['peek-size', 'peek-note', 'peek-open']) expect(screen.getByTestId(id).className).toContain('truncate');
  });

  it('looks up once per page, also under StrictMode (effects run twice in development)', async () => {
    const { deps, api } = makeDeps(await store());
    render(
      <StrictMode>
        <PeekApp params={PARAMS} deps={deps} />
      </StrictMode>,
    );
    await screen.findByTestId('peek-size');
    expect(api.resolvePeek).toHaveBeenCalledTimes(1);
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
