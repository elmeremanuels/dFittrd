// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MOCK_GARMENTS_BY_ID, type TryResolveResponse } from '@curtain/schema';
import { ApiError } from '@/api/client';
import { mockTokensEnabled, type EmbedApi, type EmbedDeps } from '../deps';
import { EmbedApp } from '../EmbedApp';
import { createEmbedStore, EmbedDb, type EmbedStore } from '../storage';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const SHOP_ORIGIN = 'https://aalter-studio.example';
const TOKEN = 'try-token-0123456789abcdef';
const garment = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;

function resolved(over: Partial<TryResolveResponse['shop']> = {}): TryResolveResponse {
  return {
    shop: { id: '00000000-0000-4000-8000-0000000000e1', name: 'Aalter Studio', platform: 'woocommerce', paused: false, ...over },
    garment,
    trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'intent-token-0123456789' },
    pairing: { created: true, pairedAt: new Date().toISOString() },
    embed: { allowedOrigins: [SHOP_ORIGIN] },
  };
}

function fakeApi(over: Partial<{ [K in keyof EmbedApi]: EmbedApi[K] }> = {}) {
  return {
    resolveTry: vi.fn(async () => resolved()),
    fitShown: vi.fn(async () => ({ billed: true })),
    deleteMe: vi.fn(async () => ({ deleted: true, deviceId: 'd' }) as never),
    requestHeroRender: vi.fn(),
    heroRenderStatus: vi.fn(),
    ...over,
  } as unknown as { [K in keyof EmbedApi]: ReturnType<typeof vi.fn> & EmbedApi[K] };
}

let dbN = 0;
function setup(opts: { api?: ReturnType<typeof fakeApi>; referrer?: string; store?: EmbedStore; token?: string; allowMock?: boolean } = {}) {
  const api = opts.api ?? fakeApi();
  const parent = { postMessage: vi.fn() };
  const store = opts.store ?? createEmbedStore({ openDb: () => new EmbedDb(`curtain-embed-ui-${++dbN}`) });
  const deps: EmbedDeps = {
    store,
    makeApi: () => api,
    parent,
    referrer: opts.referrer ?? `${SHOP_ORIGIN}/product/linen-wrap-dress/`,
    ancestorOrigins: null,
    appUrl: 'https://app.curtain.example/',
    canScan: false,
    ...(opts.allowMock !== undefined ? { allowMock: opts.allowMock } : {}),
  };
  const utils = render(
    <MemoryRouter>
      <EmbedApp token={opts.token ?? TOKEN} deps={deps} />
    </MemoryRouter>,
  );
  return { api, parent, store, deps, ...utils };
}

async function fillAbout(user: ReturnType<typeof userEvent.setup>, height = '168', weight = '62'): Promise<void> {
  await user.type(await screen.findByLabelText(/^Height/), height);
  await user.type(screen.getByLabelText(/^Weight/), weight);
  await user.click(screen.getByTestId('see-my-size'));
}

const sentTypes = (parent: { postMessage: ReturnType<typeof vi.fn> }) => parent.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe('EmbedApp', () => {
  it('product header → About you → result, with curtain:ready posted to the shop origin only', async () => {
    const user = userEvent.setup();
    const { parent, api } = setup();
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByTestId('embed-header')).toHaveTextContent('Linen Wrap Dress');
    expect(screen.getByTestId('embed-header')).toHaveTextContent('Your measurements stay on this device');
    await waitFor(() => expect(sentTypes(parent)).toContain('curtain:ready'));
    for (const call of parent.postMessage.mock.calls) expect(call[1]).toBe(SHOP_ORIGIN);
    expect(api.resolveTry).toHaveBeenCalledWith(TOKEN);

    await fillAbout(user);
    expect(await screen.findByTestId('embed-result')).toBeInTheDocument();
    expect(screen.getByTestId('recommended-size')).toBeInTheDocument();
    expect(screen.getByTestId('estimate-disclaimer')).toBeInTheDocument();
    expect(screen.getByTestId('garment-layer')).toBeInTheDocument();
    expect(screen.getByTestId('fit-points')).toBeInTheDocument();
  });

  it('shows validation errors and stays on About you', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(await screen.findByLabelText(/^Height/), 'abc');
    await user.click(screen.getByTestId('see-my-size'));
    expect(await screen.findByText('Enter a number')).toBeInTheDocument();
    expect(screen.getByText('Enter your weight in kg')).toBeInTheDocument();
    expect(screen.queryByTestId('embed-result')).not.toBeInTheDocument();
  });

  it('calls fit-shown exactly once, with the size and confidence only', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await fillAbout(user);
    await screen.findByTestId('embed-result');
    await waitFor(() => expect(api.fitShown).toHaveBeenCalledTimes(1));
    const [token, body] = api.fitShown.mock.calls[0]! as [string, Record<string, unknown>];
    expect(token).toBe(TOKEN);
    expect(Object.keys(body).sort()).toEqual(['confidence', 'intentToken', 'recommendedSize']);
    expect(body.intentToken).toBe('intent-token-0123456789');
    // switching sizes, editing and resubmitting do not bill again
    const radios = screen.getAllByRole('radio', { name: /^[A-Z0-9]/ });
    await user.click(radios[radios.length - 1]!);
    await user.click(screen.getByTestId('edit-measurements'));
    await user.click(await screen.findByTestId('see-my-size'));
    await screen.findByTestId('embed-result');
    expect(api.fitShown).toHaveBeenCalledTimes(1);
  });

  it('Choose size posts curtain:size-selected to the allowed origin', async () => {
    const user = userEvent.setup();
    const { parent } = setup();
    await fillAbout(user);
    const button = await screen.findByTestId('choose-size');
    const size = button.textContent!.replace('Choose size ', '');
    await user.click(button);
    const msg = parent.postMessage.mock.calls.find((c) => (c[0] as { type: string }).type === 'curtain:size-selected');
    expect(msg).toEqual([{ source: 'curtain', v: 1, type: 'curtain:size-selected', productExternalId: garment.id, size }, SHOP_ORIGIN]);
    expect(screen.getByText(`Size ${size} selected on the shop page`)).toBeInTheDocument();
  });

  it('a page outside the allowed origins gets nothing posted and a "choose it on the shop page" hint', async () => {
    const user = userEvent.setup();
    const { parent } = setup({ referrer: 'https://evil.example/page' });
    await fillAbout(user);
    await user.click(await screen.findByTestId('choose-size'));
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('choose-fallback')).toHaveTextContent(/Choose size .+ on the shop page/);
  });

  it('handles curtain:context from the parent only', async () => {
    const user = userEvent.setup();
    const { deps } = setup();
    await fillAbout(user);
    await screen.findByTestId('embed-result');
    const send = (origin: string, source: unknown, size: string) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: { source: 'curtain', v: 1, type: 'curtain:context', locale: 'en', currentVariantSize: size }, origin, source: source as MessageEventSource }));
      });
    const chart = garment.sizeChart.map((r) => r.size);
    const recommended = screen.getByTestId('recommended-size').textContent;
    const other = chart.find((s) => s !== recommended)!;
    send('https://evil.example', deps.parent, other);
    expect(screen.queryByText(`Selected on the shop page: ${other}`)).not.toBeInTheDocument();
    send(SHOP_ORIGIN, deps.parent, other);
    expect(await screen.findByText(`Selected on the shop page: ${other}`)).toBeInTheDocument();
  });

  it('Escape asks the overlay to close', async () => {
    const user = userEvent.setup();
    const { parent } = setup();
    await screen.findByRole('heading', { name: 'About you' });
    await user.keyboard('{Escape}');
    expect(sentTypes(parent)).toContain('curtain:close');
  });

  it('remembers the profile on this shop and a returning shopper goes straight to the result', async () => {
    const user = userEvent.setup();
    const name = `curtain-embed-remember-${++dbN}`;
    const first = setup({ store: createEmbedStore({ openDb: () => new EmbedDb(name) }) });
    await fillAbout(user);
    await screen.findByTestId('embed-result');
    await waitFor(async () => expect(await first.store.persistedKeys()).toContain('profile:00000000-0000-4000-8000-0000000000e1'));
    cleanup();

    const again = setup({ store: createEmbedStore({ openDb: () => new EmbedDb(name) }) });
    expect(await screen.findByTestId('embed-result')).toBeInTheDocument();
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    await user.click(screen.getByTestId('edit-measurements'));
    expect(await screen.findByLabelText(/^Height/)).toHaveValue('168');
    expect(again.api.resolveTry).toHaveBeenCalledTimes(1);
  });

  it('Remember me off keeps nothing on disk', async () => {
    const user = userEvent.setup();
    const { store } = setup();
    await user.click(await screen.findByRole('switch', { name: 'Remember me on this shop' }));
    await fillAbout(user);
    await screen.findByTestId('embed-result');
    expect(store.remember).toBe(false);
    expect(await store.persistedKeys()).toEqual([]);
  });

  it('Forget me deletes on the server, wipes local data and returns to About you', async () => {
    const user = userEvent.setup();
    const { api, store } = setup();
    await store.init();
    await store.setDevice({ deviceId: '11111111-1111-4111-8111-111111111111', token: 'device-token', expiresAt: '2099-01-01T00:00:00.000Z' });
    await fillAbout(user);
    await screen.findByTestId('embed-result');
    await user.click(screen.getByRole('button', { name: 'Forget me' }));
    await waitFor(() => expect(api.deleteMe).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Height/)).toHaveValue('');
    expect(await store.persistedKeys()).toEqual([]);
    expect(store.getDevice().token).toBeNull();
    expect(screen.getByText(/Forgotten/)).toBeInTheDocument();
  });

  it('a paused shop shows the paused screen and is never billed', async () => {
    const api = fakeApi({ resolveTry: vi.fn(async () => resolved({ paused: true })) as never });
    setup({ api });
    expect(await screen.findByTestId('blocked-paused')).toBeInTheDocument();
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it('fit-shown 402 switches to the paused screen', async () => {
    const user = userEvent.setup();
    const api = fakeApi({ fitShown: vi.fn(async () => Promise.reject(new ApiError(402, 'shop_paused', 'paused'))) as never });
    setup({ api });
    await fillAbout(user);
    expect(await screen.findByTestId('blocked-paused')).toBeInTheDocument();
  });

  it.each([
    [new ApiError(410, 'gone', 'expired'), 'blocked-expired'],
    [new ApiError(422, 'product_incomplete', 'todo'), 'blocked-incomplete'],
  ])('shows the right screen for %s', async (err, testId) => {
    setup({ api: fakeApi({ resolveTry: vi.fn(async () => Promise.reject(err)) as never }) });
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offline: retry resolves again', async () => {
    const user = userEvent.setup();
    const { NetworkError } = await import('@/api/client');
    const resolveTry = vi.fn().mockRejectedValueOnce(new NetworkError('offline')).mockResolvedValueOnce(resolved());
    setup({ api: fakeApi({ resolveTry: resolveTry as never }) });
    expect(await screen.findByTestId('blocked-offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(resolveTry).toHaveBeenCalledTimes(2);
  });

  it('mock tokens resolve without any network call', async () => {
    const { api } = setup({ token: 'mock:aalter-studio-1' });
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(api.resolveTry).not.toHaveBeenCalled();
  });

  it('mock tokens show the expired screen when mocks are off (production builds, SEC-5)', async () => {
    const { api } = setup({ token: 'mock:aalter-studio-1', allowMock: false });
    expect(await screen.findByTestId('blocked-expired')).toBeInTheDocument();
    expect(api.resolveTry).not.toHaveBeenCalled();
    expect(mockTokensEnabled({ DEV: false })).toBe(false);
    expect(mockTokensEnabled({ DEV: false, VITE_DEMO: '1' })).toBe(true);
    expect(mockTokensEnabled({ DEV: true })).toBe(true);
  });

  it('turning Remember me off is remembered on the next visit (UX-1, F2, SEC-3)', async () => {
    const user = userEvent.setup();
    const name = `curtain-embed-optout-${++dbN}`;
    setup({ store: createEmbedStore({ openDb: () => new EmbedDb(name) }) });
    await user.click(await screen.findByRole('switch', { name: 'Remember me on this shop' }));
    cleanup();

    const again = setup({ store: createEmbedStore({ openDb: () => new EmbedDb(name) }) });
    await screen.findByRole('heading', { name: 'About you' });
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Remember me on this shop' })).not.toBeChecked());
    await fillAbout(user);
    await screen.findByTestId('embed-result');
    expect(again.store.remember).toBe(false);
    expect(await again.store.persistedKeys()).toEqual([]);
  });

  it('no size fits: the closest size is a secondary choice, and nothing is reported as recommended (UX-2)', async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await fillAbout(user, '150', '160');
    expect(await screen.findByRole('heading', { name: 'No size fits well' })).toBeInTheDocument();
    const choose = screen.getByTestId('choose-size');
    expect(choose).toHaveTextContent(/^Select size .+ anyway$/);
    expect(choose).toHaveClass('btn-ghost');
    expect(screen.getByRole('button', { name: 'Edit my measurements' })).toHaveClass('btn-coral');
    await new Promise((r) => setTimeout(r, 20));
    expect(api.fitShown).not.toHaveBeenCalled();
  });

  it('moves focus to the new screen heading on each step change (A11Y-1)', async () => {
    const user = userEvent.setup();
    setup();
    await fillAbout(user);
    const heading = await screen.findByRole('heading', { level: 2, name: /We recommend|No size fits well/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await user.click(screen.getByTestId('edit-measurements'));
    const about = await screen.findByRole('heading', { name: 'About you' });
    await waitFor(() => expect(document.activeElement).toBe(about));
  });

  it('a brand colour that fails contrast is not used for the shop name (A11Y-2)', async () => {
    const coral = setup({ api: fakeApi({ resolveTry: vi.fn(async () => resolved({ brandColor: '#FF5A3C' })) as never }) });
    await screen.findByRole('heading', { name: 'About you' });
    expect(screen.getByTestId('embed-shop-name').style.color).toBe('');
    coral.unmount();
    setup({ api: fakeApi({ resolveTry: vi.fn(async () => resolved({ brandColor: '#2F4F3A' })) as never }) });
    await screen.findByRole('heading', { name: 'About you' });
    expect(screen.getByTestId('embed-shop-name').style.color).toBe('rgb(47, 79, 58)');
  });
});
