// @vitest-environment jsdom
/**
 * The men's gate in the overlay (decision D20 point 3, docs/research/men-3d-plan.md slice M0):
 * "Men's clothing: coming soon" in English and Dutch with no figure and no size, and no 2D
 * fallback when the 3D view of a men's product cannot be shown.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MEN_COMING_SOON_CODE, MENS_OXFORD_SHIRT, MOCK_GARMENTS_BY_ID, type GarmentAssetRef, type TryResolveResponse } from '@curtain/schema';
import { ApiError } from '@/api/client';
import type { EmbedApi, EmbedDeps } from '../deps';
import { EmbedApp } from '../EmbedApp';
import { BlockedScreen } from '../EmbedScreens';
import { classifyError, flowReducer, INITIAL_FLOW } from '../flow';
import { createEmbedStore, EmbedDb } from '../storage';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const SHOP_ORIGIN = 'https://noordman.example';
const TOKEN = 'try-token-0123456789abcdef';
const asset: GarmentAssetRef = { version: '0123456789abcdef', baseUrl: 'https://api.curtain.test/assets/s/p/0123456789abcdef', baseSize: 'M', sizes: MENS_OXFORD_SHIRT.sizeChart.map((r) => r.size), label: 'estimate' };

function resolved(over: Partial<TryResolveResponse> = {}): TryResolveResponse {
  return {
    shop: { id: '00000000-0000-4000-8000-0000000000e2', name: 'Noordman', platform: 'shopify', paused: false },
    garment: MENS_OXFORD_SHIRT,
    trySession: { id: '00000000-0000-4000-8000-0000000000ac', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'intent-token-men-0123456789' },
    pairing: { created: true, pairedAt: new Date().toISOString() },
    embed: { allowedOrigins: [SHOP_ORIGIN] },
    ...over,
  };
}

const comingSoonError = () => new ApiError(422, MEN_COMING_SOON_CODE, 'Men’s clothing: coming soon');

let dbN = 0;
function setup(opts: { resolveTry: () => Promise<TryResolveResponse>; locale?: string | null; webgl2?: () => boolean; loadViewer?: EmbedDeps['loadViewer']; token?: string; allowMock?: boolean }) {
  const api = {
    resolveTry: vi.fn(opts.resolveTry),
    fitShown: vi.fn(async () => ({ billed: true })),
    deleteMe: vi.fn(),
    requestHeroRender: vi.fn(),
    heroRenderStatus: vi.fn(),
  } as unknown as { [K in keyof EmbedApi]: ReturnType<typeof vi.fn> & EmbedApi[K] };
  const parent = { postMessage: vi.fn() };
  const deps: EmbedDeps = {
    store: createEmbedStore({ openDb: () => new EmbedDb(`curtain-embed-men-${++dbN}`) }),
    makeApi: () => api,
    parent,
    referrer: `${SHOP_ORIGIN}/products/oxford`,
    ancestorOrigins: null,
    appUrl: 'https://app.curtain.example/',
    canScan: false,
    locale: opts.locale === undefined ? 'en-AU' : opts.locale,
    ...(opts.webgl2 ? { webgl2: opts.webgl2 } : {}),
    ...(opts.loadViewer ? { loadViewer: opts.loadViewer } : {}),
    ...(opts.allowMock !== undefined ? { allowMock: opts.allowMock } : {}),
  };
  render(
    <MemoryRouter>
      <EmbedApp token={opts.token ?? TOKEN} deps={deps} />
    </MemoryRouter>,
  );
  return { api, parent };
}

/** Nothing that draws a body or names a size is in the document. */
function expectNoFigureAndNoSize(): void {
  for (const id of ['embed-result', 'recommended-size', 'garment-layer', 'fit-points', 'garment3d', 'garment3d-open', 'see-my-size', 'choose-size', 'requires3d-pending', 'requires3d-shown']) {
    expect(screen.queryByTestId(id)).not.toBeInTheDocument();
  }
  expect(document.querySelector('svg[data-testid="avatar"], canvas, [data-testid="mirror"], [data-figure]')).toBeNull();
  expect(screen.queryByLabelText(/^Height/)).not.toBeInTheDocument();
}

async function fillAbout(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText(/^Height/), '182');
  await user.type(screen.getByLabelText(/^Weight/), '80');
  await user.click(screen.getByTestId('see-my-size'));
}

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe("men's gate in the overlay", () => {
  it('classifies men_coming_soon before the generic 422 rule, and comingSoon is reachable from any step', () => {
    expect(classifyError(comingSoonError())).toBe('comingSoon');
    expect(classifyError(new ApiError(422, 'product_incomplete', 'todo'))).toBe('incomplete');
    const result = flowReducer(flowReducer(INITIAL_FLOW, { type: 'resolved', paused: false, remembered: true }), { type: 'comingSoon' });
    expect(result).toEqual({ step: 'blocked', blocked: 'comingSoon', returning: false, editing: false });
    // not retryable, and "Forget me" does not reopen the form
    expect(flowReducer(result, { type: 'retry' })).toBe(result);
    expect(flowReducer(result, { type: 'forgotten' })).toBe(result);
  });

  it('English: "Men’s clothing: coming soon", no figure, no size, no retry, nothing billed', async () => {
    const { api } = setup({ resolveTry: async () => Promise.reject(comingSoonError()) });
    const screenEl = await screen.findByTestId('blocked-comingSoon');
    expect(screen.getByRole('heading', { name: 'Men’s clothing: coming soon' })).toBeInTheDocument();
    expect(screenEl).toHaveTextContent('use the shop’s own size chart');
    expect(screenEl).not.toHaveAttribute('lang');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expectNoFigureAndNoSize();
    expect(screen.getByTestId('embed-header')).not.toHaveTextContent(MENS_OXFORD_SHIRT.name);
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it.each(['nl', 'nl-NL', 'nl-BE'])('D21: English for a %s browser too', async (locale) => {
    setup({ resolveTry: async () => Promise.reject(comingSoonError()), locale });
    const screenEl = await screen.findByTestId('blocked-comingSoon');
    expect(screen.getByRole('heading', { name: 'Men’s clothing: coming soon' })).toBeInTheDocument();
    expect(screenEl).not.toHaveAttribute('lang');
    expect(screenEl).toHaveTextContent('use the shop’s own size chart');
    expect(screenEl).not.toHaveTextContent(/Herenkleding|binnenkort|maattabel/);
    expectNoFigureAndNoSize();
  });

  it('the blocked screens read their text from the catalogue', () => {
    render(<BlockedScreen kind="expired" onRetry={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'This try-on has expired' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to the shop' })).toBeInTheDocument();
  });

  it('the demo token mock:comingsoon shows the same screen', async () => {
    setup({ resolveTry: async () => resolved(), token: 'mock:comingsoon', allowMock: true });
    expect(await screen.findByTestId('blocked-comingSoon')).toBeInTheDocument();
  });

  it('the embed tells the server it enforces "3D or nothing" (the server sends a requires3d product to no other client)', async () => {
    const { api } = setup({ resolveTry: async () => Promise.reject(comingSoonError()) });
    await screen.findByTestId('blocked-comingSoon');
    expect(api.resolveTry).toHaveBeenCalledWith(TOKEN, { enforces3dRule: true });
  });

  it('a ready men’s product on a device without WebGL2 is coming soon before any form or figure', async () => {
    const { api } = setup({ resolveTry: async () => resolved({ requires3d: true, asset }), webgl2: () => false });
    expect(await screen.findByTestId('blocked-comingSoon')).toBeInTheDocument();
    expectNoFigureAndNoSize();
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it('a ready men’s product without an asset ref is coming soon', async () => {
    setup({ resolveTry: async () => resolved({ requires3d: true, asset: null }), webgl2: () => true });
    expect(await screen.findByTestId('blocked-comingSoon')).toBeInTheDocument();
    expectNoFigureAndNoSize();
  });

  it('3D forced to fail: no 2D fallback, no size, nothing billed; the shopper lands on coming soon', async () => {
    const user = userEvent.setup();
    const loadViewer = vi.fn(async () => ({ mountGarmentView: async () => Promise.reject(new Error('incompatible')) }) as never);
    const { api } = setup({ resolveTry: async () => resolved({ requires3d: true, asset }), webgl2: () => true, loadViewer });
    await fillAbout(user);
    expect(await screen.findByTestId('blocked-comingSoon')).toBeInTheDocument();
    expect(loadViewer).toHaveBeenCalledTimes(1); // opened by itself, not by a click
    expectNoFigureAndNoSize();
    expect(screen.queryByTestId('garment3d-failed')).not.toBeInTheDocument();
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it('while the 3D view is loading the 2D figure and the size are hidden and nothing is billed; once it settles they show', async () => {
    const user = userEvent.setup();
    let settle: () => void = () => {};
    const mountGarmentView = vi.fn(async (_canvas: HTMLCanvasElement, opts: { onState?: (s: string) => void }) => {
      settle = () => opts.onState?.('settled');
      return { setSize: vi.fn(() => true), dispose: vi.fn(), sizes: asset.sizes };
    });
    const { api } = setup({ resolveTry: async () => resolved({ requires3d: true, asset }), webgl2: () => true, loadViewer: async () => ({ mountGarmentView }) as never });
    await fillAbout(user);
    const pending = await screen.findByTestId('requires3d-pending');
    await waitFor(() => expect(mountGarmentView).toHaveBeenCalledTimes(1));
    const hidden = pending.firstElementChild!;
    expect(hidden).toHaveClass('invisible');
    expect(hidden).toHaveAttribute('aria-hidden', 'true');
    expect(hidden.contains(screen.getByTestId('embed-result'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Close the 3D view' })).not.toBeInTheDocument();
    expect(api.fitShown).not.toHaveBeenCalled();

    settle();
    const shown = await screen.findByTestId('requires3d-shown');
    expect(shown.firstElementChild).not.toHaveClass('invisible');
    expect(screen.getByTestId('garment3d-canvas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close the 3D view' })).not.toBeInTheDocument(); // cannot fall back to the 2D figure alone
    // Slice M1b: the 2D figure beside the male 3D body is the male figure, with its estimate label.
    const figure = screen.getByTestId('mirror');
    expect(figure.querySelector('svg')).toHaveAttribute('data-figure', 'male');
    expect(figure.querySelector('[data-testid="neutral-face"]')).toBeInTheDocument();
    expect(figure.querySelector('[data-testid="estimate-label"]')).toBeInTheDocument();
    await waitFor(() => expect(api.fitShown).toHaveBeenCalledTimes(1));
    expect(mountGarmentView).toHaveBeenCalledTimes(1);
  });

  it('a men’s product without requires3d (gate off) and a women’s product behave as before', async () => {
    const user = userEvent.setup();
    const men = setup({ resolveTry: async () => resolved() });
    await fillAbout(user);
    expect(await screen.findByTestId('embed-result')).toBeInTheDocument();
    expect(screen.getByTestId('garment-layer')).toBeInTheDocument();
    // Slice M1b: without a required 3D view the male figure is never drawn (D20 point 3).
    expect(document.querySelector('[data-figure]')).toBeNull();
    expect(screen.queryByTestId('requires3d-pending')).not.toBeInTheDocument();
    expect(screen.queryByTestId('requires3d-shown')).not.toBeInTheDocument();
    await waitFor(() => expect(men.api.fitShown).toHaveBeenCalledTimes(1));
    cleanup();

    const women = setup({ resolveTry: async () => resolved({ garment: MOCK_GARMENTS_BY_ID['aalter-studio-1']!, asset }), webgl2: () => true });
    await user.type(await screen.findByLabelText(/^Height/), '168');
    await user.type(screen.getByLabelText(/^Weight/), '62');
    await user.click(screen.getByTestId('see-my-size'));
    expect(await screen.findByTestId('embed-result')).toBeInTheDocument();
    expect(screen.getByTestId('garment3d-open')).toHaveTextContent('See it in 3D (estimate)'); // still opt-in
    expect(document.querySelector('[data-figure]')).toBeNull();
    expect(screen.queryByTestId('blocked-comingSoon')).not.toBeInTheDocument();
    await waitFor(() => expect(women.api.fitShown).toHaveBeenCalledTimes(1));
  });
});
