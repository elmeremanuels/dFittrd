// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MOCK_GARMENTS_BY_ID, type TryResolveResponse } from '@curtain/schema';
import type { EmbedApi, EmbedDeps, FaceLookResultLike } from '../deps';
import { EmbedApp } from '../EmbedApp';
import { createEmbedStore, EmbedDb } from '../storage';
import { embedStrings } from '../strings';

/**
 * Slices 4 and 5 in the embed, live flag (`facePhotoLive`), with the on-device face step stubbed
 * (the real worker runs in `e2e/facePhoto2d.spec.ts`). Over the WHOLE flow (open the prompt, the
 * face yes, the photo, the tile on the figure, the skin tone suggestion, the confirmed swatch,
 * "Remember my photo", "Delete my photo", the face off) fetch, XMLHttpRequest, WebSocket,
 * navigator.sendBeacon and postMessage to the parent are trapped: none is called, and the api
 * client is not called either.
 */
vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const SHOP_ORIGIN = 'https://aalter-studio.example';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';
const garment = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
const resolved = (): TryResolveResponse => ({
  shop: { id: SHOP_ID, name: 'Aalter Studio', platform: 'woocommerce', paused: false },
  garment,
  trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'intent-token-0123456789' },
  pairing: { created: true, pairedAt: new Date().toISOString() },
  embed: { allowedOrigins: [SHOP_ORIGIN] },
});

const TILE = { width: 20, height: 23, rgba: new Uint8ClampedArray(20 * 23 * 4).fill(200), skinLab: { L: 40, a: 12, b: 20 } };
const fp = embedStrings().avatar.facePhoto;

let dbN = 0;
function setup(over: Partial<EmbedDeps> = {}, faceLook?: EmbedDeps['faceLook']) {
  const api = {
    resolveTry: vi.fn(async () => resolved()),
    fitShown: vi.fn(async () => ({ billed: true })),
    deleteMe: vi.fn(async () => ({ deleted: true, deviceId: 'd' })),
    requestHeroRender: vi.fn(),
    heroRenderStatus: vi.fn(),
  };
  const parent = { postMessage: vi.fn() };
  const dbName = `curtain-embed-face-${++dbN}`;
  const store = createEmbedStore({ openDb: () => new EmbedDb(dbName) });
  const look = (faceLook as ReturnType<typeof vi.fn> | undefined) ?? vi.fn(async (_photo: Blob, opts: { tile: boolean; skin: boolean }): Promise<FaceLookResultLike> => ({ faceFound: true, tile: opts.tile ? TILE : null, suggestion: opts.skin ? { monk: 7 } : null, notices: opts.skin ? ['side'] : [] }));
  let urls = 0;
  const deps: EmbedDeps = {
    store,
    makeApi: () => api as unknown as EmbedApi,
    parent,
    referrer: `${SHOP_ORIGIN}/product/linen-wrap-dress/`,
    ancestorOrigins: null,
    appUrl: 'https://app.curtain.example/',
    canScan: false,
    locale: 'en-AU',
    facePhotoLive: true,
    faceLook: look,
    tileUrl: async () => `blob:test/${++urls}`,
    ...over,
  };
  const utils = render(
    <MemoryRouter>
      <EmbedApp token="try-token-0123456789abcdef" deps={deps} />
    </MemoryRouter>,
  );
  return { api, parent, store, deps, look, dbName, ...utils };
}

async function toResult(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText(/^Height/), '168');
  await user.type(screen.getByLabelText(/^Weight/), '62');
  await user.click(screen.getByTestId('see-my-size'));
  await screen.findByTestId('embed-result');
}

/** Trap every way out of the page; returns what was caught. */
function trapNetwork(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const trap = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push(`${name} ${String(args[0]).slice(0, 80)}`);
      throw new Error(`${name} during the face flow`);
    });
  vi.stubGlobal('fetch', trap('fetch'));
  vi.stubGlobal('XMLHttpRequest', trap('xhr'));
  vi.stubGlobal('WebSocket', trap('websocket'));
  vi.stubGlobal('EventSource', trap('eventsource'));
  const beacon = navigator.sendBeacon;
  Object.defineProperty(navigator, 'sendBeacon', { value: trap('sendBeacon'), configurable: true });
  return {
    calls,
    restore: () => {
      vi.unstubAllGlobals();
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
      Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    },
  };
}

const photo = (): File => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'me.jpg', { type: 'image/jpeg' });

/** Press a photo button and hand the file input that press created a file. */
async function givePhoto(user: ReturnType<typeof userEvent.setup>, purpose: 'face' | 'skin'): Promise<void> {
  // No input that can read a file exists before this press.
  expect(document.querySelector('input[type=file]')).toBeNull();
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  await user.click(screen.getByTestId(`${purpose}-photo-choose`));
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  expect(input).not.toBeNull();
  expect(input.hasAttribute('capture')).toBe(false);
  click.mockRestore();
  await user.upload(input, photo());
  // ...and it is gone again.
  expect(document.querySelector('input[type=file]')).toBeNull();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('face photo in the embed (slices 4 and 5, live flag)', () => {
  it('runs the whole flow on the device: no fetch, XHR, WebSocket, beacon or postMessage, and no api call', async () => {
    const user = userEvent.setup();
    const { api, parent, look, store } = setup();
    await toResult(user);
    await waitFor(() => expect(api.fitShown).toHaveBeenCalled());
    const apiCalls = Object.values(api).reduce((n, f) => n + f.mock.calls.length, 0);
    const posts = parent.postMessage.mock.calls.length;
    const net = trapNetwork();
    try {
      // Open the prompt: live face row, C11 both sentences and C12.
      await user.click(screen.getByTestId('avatar-open'));
      const dialog = screen.getByTestId('avatar-prompt');
      expect(within(dialog).getByTestId('avatar-item-face')).toHaveAttribute('data-live', '1');
      expect(within(dialog).getByText(fp.claims.c6)).toBeInTheDocument();
      expect(within(dialog).getByText(fp.claims.c7)).toBeInTheDocument();
      expect(within(dialog).getByText(fp.claims.c11)).toBeInTheDocument();
      expect(within(dialog).getByText(fp.claims.c12)).toBeInTheDocument();
      expect(within(dialog).getByText(embedStrings().avatar.claims.c4)).toBeInTheDocument();

      // "No" first: nothing happens (the "On no" line), nothing is read.
      await user.click(screen.getByTestId('avatar-face-switch'));
      await user.click(screen.getByTestId('face-photo-no'));
      expect(screen.getByTestId('face-moment')).toHaveTextContent(fp.claims.faceOnNo);
      expect(look).not.toHaveBeenCalled();

      // The yes waits for the age box; then the photo buttons; only then a file input.
      await user.click(screen.getByTestId('avatar-face-switch'));
      expect(screen.getByTestId('face-photo-c5')).toHaveTextContent('The photo and the scan are for people aged 16 or older.');
      await user.click(screen.getByTestId('face-photo-yes'));
      expect(screen.queryByTestId('face-photo-choose')).toBeNull();
      await user.click(screen.getByTestId('face-photo-age'));
      await user.click(screen.getByTestId('face-photo-yes'));
      expect(screen.getByText(fp.claims.faceOnYes)).toBeInTheDocument();
      await givePhoto(user, 'face');
      await screen.findByTestId('face-photo-on');
      expect(look).toHaveBeenCalledTimes(1);
      expect(look.mock.calls[0]![1]).toMatchObject({ tile: true, skin: false });
      expect(screen.getByTestId('face-photo-preview')).toHaveAttribute('src', expect.stringMatching(/^blob:/));
      expect(screen.getByTestId('face-photo-match-hint')).toBeInTheDocument();

      // On the figure: the tile on the head, the chip, C27, the estimate label; the hero figure has no face.
      await user.click(screen.getByTestId('avatar-prompt-done'));
      const result = screen.getByTestId('embed-result');
      expect(within(result).getByTestId('face-tile')).toBeInTheDocument();
      expect(within(result).getByTestId('face-chip')).toBeInTheDocument();
      expect(within(result).getByTestId('face-label')).toHaveTextContent(fp.claims.c27);
      expect(within(result).getAllByTestId('estimate-label').length).toBeGreaterThan(0);
      expect(within(result).queryByTestId('neutral-face')).toBeNull();
      const hero = screen.queryByTestId('hero-avatar');
      if (hero) expect(hero.querySelector('image')).toBeNull();

      // Skin tone from a photo: the suggestion does not change the colour (G4); the tap does.
      await user.click(screen.getByTestId('avatar-open'));
      await user.click(screen.getByTestId('avatar-skin-switch'));
      expect(screen.getByTestId('skin-photo-c26')).toHaveTextContent(fp.claims.c26);
      await user.click(screen.getByTestId('skin-photo-read'));
      await user.click(screen.getByTestId('skin-photo-age'));
      await user.click(screen.getByTestId('skin-photo-yes'));
      await givePhoto(user, 'skin');
      expect(await screen.findByTestId('skin-photo-suggestion')).toHaveTextContent('colour 7 of 10');
      expect(screen.getByTestId('skin-photo-notice')).toHaveTextContent(fp.ui.notices.side);
      expect(screen.getByTestId('skin-swatch-suggested')).toBeInTheDocument();
      expect(look.mock.calls[1]![1]).toMatchObject({ tile: false, skin: true });
      const figureSkin = (): string | null | undefined => screen.getByTestId('embed-result').querySelector('svg[data-skin]')?.getAttribute('data-skin');
      expect(figureSkin()).toBe('#DFC3A8');
      expect(screen.getByTestId('skin-swatch-7')).not.toBeChecked();
      await user.click(screen.getByTestId('skin-swatch-8'));
      expect(figureSkin()).toBe('#604134');

      // Remember my photo (C19): off at first, on stores the face on this device for this shop.
      const remember = screen.getByTestId('face-photo-remember');
      expect(remember).toHaveAttribute('aria-checked', 'false');
      await user.click(remember);
      expect(remember).toHaveAttribute('aria-checked', 'true');
      await waitFor(async () => expect(await store.persistedKeys()).toContain(`face:${SHOP_ID}`));

      // Delete my photo (C20): the face and the colour read from the photo go, from memory and the device.
      await user.click(screen.getByTestId('face-photo-delete'));
      expect(screen.getByTestId('face-moment')).toHaveTextContent(fp.claims.c9);
      expect(screen.queryByTestId('face-photo-on')).toBeNull();
      expect(figureSkin()).toBe('#DFC3A8');
      await waitFor(async () => expect((await store.persistedKeys()).some((k) => k.startsWith('face'))).toBe(false));
      await user.click(screen.getByTestId('avatar-prompt-done'));
      expect(screen.queryByTestId('face-tile')).toBeNull();
      expect(screen.getByTestId('embed-result').querySelector('[data-testid="neutral-face"]')).not.toBeNull();
    } finally {
      net.restore();
    }
    expect(net.calls).toEqual([]);
    expect(parent.postMessage.mock.calls.length, 'postMessage to the parent during the face flow').toBe(posts);
    expect(Object.values(api).reduce((n, f) => n + f.mock.calls.length, 0), 'api calls during the face flow').toBe(apiCalls);
  });

  it('a photo without a face, or a failure, says so and puts nothing on the avatar', async () => {
    const user = userEvent.setup();
    let n = 0;
    setup({}, async () => {
      n++;
      if (n === 1) return { faceFound: false, tile: null, suggestion: null, notices: [] };
      throw new Error('worker crashed');
    });
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    for (const text of [fp.ui.notFound, fp.ui.failed]) {
      await user.click(screen.getByTestId('avatar-face-switch'));
      await user.click(screen.getByTestId('face-photo-age'));
      await user.click(screen.getByTestId('face-photo-yes'));
      await givePhoto(user, 'face');
      expect(await screen.findByTestId('face-photo-notice')).toHaveTextContent(text);
      expect(screen.queryByTestId('face-photo-on')).toBeNull();
      expect(screen.getByTestId('avatar-face-switch')).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('a returning shopper who said "Remember my photo" sees their face at once; "Forget me" removes it', async () => {
    const user = userEvent.setup();
    const first = setup();
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    await user.click(screen.getByTestId('avatar-face-switch'));
    await user.click(screen.getByTestId('face-photo-age'));
    await user.click(screen.getByTestId('face-photo-yes'));
    await givePhoto(user, 'face');
    await user.click(await screen.findByTestId('face-photo-remember'));
    await waitFor(async () => expect(await first.store.persistedKeys()).toContain(`face:${SHOP_ID}`));
    cleanup();

    // A new window on the same device (same database).
    const store = createEmbedStore({ openDb: () => new EmbedDb(first.dbName) });
    const second = setup({ store });
    // The profile is remembered too: straight to the result.
    await screen.findByTestId('embed-result');
    expect(await screen.findByTestId('face-chip')).toBeInTheDocument();
    expect(second.look).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: embedStrings().footer.forget }));
    await waitFor(() => expect(screen.queryByTestId('face-chip')).toBeNull());
    await waitFor(async () => expect(await store.persistedKeys()).toEqual([]));
  });

  it('without the live flag the prompt has no live face row and reads no photo', async () => {
    const user = userEvent.setup();
    const { look } = setup({ facePhotoLive: false });
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    expect(screen.queryByTestId('avatar-item-face')).toBeNull();
    await user.click(screen.getByTestId('avatar-skin-switch'));
    expect(screen.queryByTestId('skin-photo-read')).toBeNull();
    expect(screen.getByText(embedStrings().avatar.claims.c11Pick)).toBeInTheDocument();
    expect(look).not.toHaveBeenCalled();
  });
});
