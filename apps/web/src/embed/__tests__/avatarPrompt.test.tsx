// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import { AVATAR_CLAIMS, c30Text } from '../avatarCopy';
import type { EmbedApi, EmbedDeps } from '../deps';
import { EmbedApp } from '../EmbedApp';
import { assertNeutralPerson } from '../HeroRender';
import { lookForMonk, STANDARD_SKIN_HEX } from '../look';
import { createEmbedStore, EmbedDb, type EmbedStore } from '../storage';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const SHOP_ORIGIN = 'https://aalter-studio.example';
const SHOP_ID = '00000000-0000-4000-8000-0000000000e1';

/** Every way a page can talk to a server, replaced by a spy that fails the test when used. */
function trapNetwork() {
  const calls: string[] = [];
  const trap = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push(`${name} ${String(args[0])}`);
      throw new Error(`network use in the avatar flow: ${name}`);
    });
  vi.stubGlobal('fetch', trap('fetch'));
  vi.stubGlobal('XMLHttpRequest', trap('XMLHttpRequest'));
  vi.stubGlobal('WebSocket', trap('WebSocket'));
  vi.stubGlobal('EventSource', trap('EventSource'));
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: trap('sendBeacon') });
  return calls;
}

/** An api whose every method fails the test: a `mock:` token needs none of them. */
function forbiddenApi(calls: string[]): EmbedApi {
  return new Proxy({} as EmbedApi, {
    get: (_t, prop) => () => {
      calls.push(`api.${String(prop)}`);
      throw new Error(`api call in the avatar flow: ${String(prop)}`);
    },
  });
}

let dbN = 0;
function setup(opts: { locale?: string | null; facePhoto?: boolean; store?: EmbedStore; calls?: string[]; canScan?: boolean } = {}) {
  const calls = opts.calls ?? [];
  const parent = { postMessage: vi.fn() };
  const store = opts.store ?? createEmbedStore({ openDb: () => new EmbedDb(`curtain-embed-avatar-${++dbN}`) });
  const deps: EmbedDeps = {
    store,
    makeApi: () => forbiddenApi(calls),
    parent,
    referrer: `${SHOP_ORIGIN}/product/linen-wrap-dress/`,
    ancestorOrigins: null,
    appUrl: 'https://app.curtain.example/',
    canScan: opts.canScan ?? false,
    locale: opts.locale === undefined ? 'en-AU' : opts.locale,
    allowMock: true,
    ...(opts.facePhoto !== undefined ? { facePhoto: opts.facePhoto } : {}),
  };
  const utils = render(
    <MemoryRouter>
      <EmbedApp token="mock:aalter-studio-1" deps={deps} />
    </MemoryRouter>,
  );
  return { calls, parent, store, deps, ...utils };
}

async function toResult(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText(/^Height/), '168');
  await user.type(screen.getByLabelText(/^Weight/), '62');
  await user.click(screen.getByTestId('see-my-size'));
  await screen.findByTestId('embed-result');
}

const figureSkin = (): string | null => screen.getByTestId('embed-result').querySelector('svg[data-skin]')!.getAttribute('data-skin');
const hasInput = (selector: string): boolean => document.querySelector(selector) !== null;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
});
beforeEach(() => vi.clearAllMocks());

describe('avatar prompt (D19)', () => {
  it('the whole flow makes no network request, opens no camera or file picker and tells the shop page nothing', async () => {
    const calls = trapNetwork();
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
    const user = userEvent.setup();
    const { parent, store } = setup({ calls, canScan: true });
    await toResult(user);
    expect(figureSkin()).toBe(STANDARD_SKIN_HEX);

    // tap the avatar → the prompt
    await user.click(screen.getByTestId('avatar-open'));
    const dialog = await screen.findByRole('dialog', { name: 'Make the avatar look like you' });
    expect(within(dialog).queryByTestId('skin-swatches')).toBeNull();

    // switch the colour on: the row opens, nothing is on the avatar or in the store yet
    await user.click(within(dialog).getByTestId('avatar-skin-switch'));
    expect(figureSkin()).toBe(STANDARD_SKIN_HEX);
    expect(await store.loadLook(SHOP_ID)).toBeNull();

    // pick two swatches, switch it off again, pick once more, close
    await user.click(within(dialog).getByTestId('skin-swatch-4'));
    expect(figureSkin()).toBe(lookForMonk(4)!.hex);
    await user.click(within(dialog).getByTestId('skin-swatch-9'));
    expect(figureSkin()).toBe(lookForMonk(9)!.hex);
    await user.click(within(dialog).getByTestId('avatar-skin-switch'));
    expect(figureSkin()).toBe(STANDARD_SKIN_HEX);
    await user.click(within(dialog).getByTestId('avatar-skin-switch'));
    await user.click(within(dialog).getByTestId('skin-swatch-6'));
    await user.click(within(dialog).getByTestId('avatar-prompt-done'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(figureSkin()).toBe(lookForMonk(6)!.hex);
    await waitFor(async () => expect(await store.loadLook(SHOP_ID)).toEqual(lookForMonk(6)));

    // reopen, go to the measurements from the prompt, come back, forget
    await user.click(screen.getByTestId('avatar-open'));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('avatar-type-measurements'));
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument();
    await user.click(screen.getByTestId('see-my-size'));
    await screen.findByTestId('embed-result');
    expect(figureSkin()).toBe(lookForMonk(6)!.hex);
    await user.click(screen.getByRole('button', { name: 'Forget me' }));
    await screen.findByRole('heading', { name: 'About you' });
    expect(await store.loadLook(SHOP_ID)).toBeNull();
    expect(await store.persistedKeys()).toEqual([]);

    // nothing went anywhere
    expect(calls).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(hasInput('input[type="file"]')).toBe(false);
    expect(hasInput('video, input[capture]')).toBe(false);
    // The shop page hears nothing about the avatar: no message mentions a colour, a tone or a look.
    const sent = JSON.stringify(parent.postMessage.mock.calls.map((c) => c[0]));
    expect(sent).not.toMatch(/skin|look|monk|tone|colou?r|#[0-9a-f]{6}/i);
    for (const n of [4, 6, 9]) expect(sent.toUpperCase()).not.toContain(lookForMonk(n)!.hex);
  });

  it('shows the plain text of the consent copy, with the legal text behind a link', async () => {
    const user = userEvent.setup();
    setup();
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    const dialog = await screen.findByRole('dialog');
    const t = AVATAR_CLAIMS.en;
    for (const text of [t.c1, t.c2, t.c3, t.c11Pick, t.skinOff, t.bodyOff]) expect(within(dialog).getByText(text)).toBeInTheDocument();
    expect(dialog).toHaveAttribute('lang', 'en');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const link = within(dialog).getByRole('link', { name: t.termsLink });
    expect(link).toHaveAttribute('href', 'https://app.curtain.example/privacy');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    const sw = within(dialog).getByRole('switch', { name: t.skinName });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByText(t.skinOnYes)).toBeInTheDocument();
    // Memory only by default: no sentence about saving the colour is shown.
    expect(within(dialog).queryByTestId('avatar-c30')).toBeNull();
    expect(dialog).not.toHaveTextContent(/saved on this device/);
    // The swatches are the Monk Skin Tone Scale (CC BY 4.0): credited where they are shown.
    expect(within(dialog).getByTestId('avatar-swatch-credit')).toHaveTextContent('Monk Skin Tone Scale by Dr. Ellis Monk, CC BY 4.0');
    expect(within(dialog).getAllByRole('radio')).toHaveLength(10);
    // no swatch is chosen for the shopper
    expect(within(dialog).queryByRole('radio', { checked: true })).toBeNull();
    await user.click(within(dialog).getByRole('radio', { name: 'Colour 5 of 10' }));
    expect(within(dialog).getByTestId('avatar-skin-status')).toHaveTextContent('Colour 5 of 10 is on the avatar.');
    await user.click(sw);
    expect(within(dialog).getByTestId('avatar-skin-state')).toHaveTextContent(t.c14);
  });

  it('the photo-based face is not drawn by default, and is a disabled "coming soon" row with the flag on', async () => {
    const user = userEvent.setup();
    setup();
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('avatar-item-face')).toBeNull();
    expect(dialog).not.toHaveTextContent(/Use my face|Coming soon|camera/i);
    expect(dialog).not.toHaveTextContent(AVATAR_CLAIMS.en.c4);
    cleanup();

    setup({ facePhoto: true });
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByTestId('avatar-item-face');
    expect(row).toHaveTextContent('Use my face');
    expect(row).toHaveTextContent('Coming soon');
    expect(row).toHaveTextContent(AVATAR_CLAIMS.en.faceOff);
    const sw = within(row).getByRole('switch', { name: 'Use my face' });
    // Not `disabled`: it stays in the Tab order so a keyboard user reaches it and hears "Coming soon".
    expect(sw).not.toBeDisabled();
    expect(sw).toHaveAttribute('aria-disabled', 'true');
    expect(sw).toHaveAccessibleDescription(/Coming soon/);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await user.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'false');
    sw.focus();
    expect(sw).toHaveFocus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(hasInput('input[type="file"]')).toBe(false);
    expect(within(dialog).getByTestId('avatar-c4')).toHaveTextContent(AVATAR_CLAIMS.en.c4);
  });

  it('speaks Dutch to a Dutch shopper', async () => {
    const user = userEvent.setup();
    setup({ locale: 'nl-NL' });
    await toResult(user);
    const open = screen.getByTestId('avatar-open');
    expect(open).toHaveTextContent('Laat de avatar op jou lijken');
    await user.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Laat de avatar op jou lijken' });
    expect(dialog).toHaveAttribute('lang', 'nl');
    const t = AVATAR_CLAIMS.nl;
    for (const text of [t.c1, t.c2, t.c3, t.c11Pick, t.skinOff, t.bodyOff]) expect(within(dialog).getByText(text)).toBeInTheDocument();
    // The published privacy page is English: the link says so, to people and to the browser.
    const link = within(dialog).getByRole('link', { name: t.termsLink });
    expect(link).toHaveAttribute('hreflang', 'en');
    expect(within(dialog).getByTestId('avatar-terms-lang')).toHaveTextContent('(in het Engels)');
    await user.click(within(dialog).getByRole('switch', { name: t.skinName }));
    expect(within(dialog).getByText(t.skinOnYes)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Kleur 10 van 10, donkerste' })).toBeInTheDocument();
  });

  it('keyboard: Enter opens it, focus moves in and stays in, arrows pick, Escape closes the prompt only and focus returns', async () => {
    const user = userEvent.setup();
    const { parent } = setup();
    await toResult(user);
    const open = screen.getByTestId('avatar-open');
    expect(open).toHaveAttribute('aria-haspopup', 'dialog');
    open.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Make the avatar look like you' })).toHaveFocus();

    // Tab order: close, switch, type my measurements, link, done, and round again.
    await user.tab();
    expect(within(dialog).getByTestId('avatar-prompt-close')).toHaveFocus();
    await user.tab();
    const sw = within(dialog).getByTestId('avatar-skin-switch');
    expect(sw).toHaveFocus();
    await user.keyboard(' ');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await user.tab();
    expect(within(dialog).getByTestId('skin-swatch-1')).toHaveFocus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(within(dialog).getByTestId('skin-swatch-3')).toBeChecked();
    expect(figureSkin()).toBe(lookForMonk(3)!.hex);
    await user.tab();
    await user.tab();
    await user.tab();
    expect(within(dialog).getByTestId('avatar-prompt-done')).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByTestId('avatar-prompt-close')).toHaveFocus();
    await user.tab({ shift: true });
    expect(within(dialog).getByTestId('avatar-prompt-done')).toHaveFocus();

    parent.postMessage.mockClear();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(parent.postMessage).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('avatar-open')).toHaveFocus());
    // With the prompt closed, Escape closes the overlay as before.
    await user.keyboard('{Escape}');
    expect(parent.postMessage.mock.calls.map((c) => (c[0] as { type: string }).type)).toContain('curtain:close');
  });

  it('by default the colour is in memory only: nothing about it is stored, and a new visit starts with the standard colour', async () => {
    const user = userEvent.setup();
    const name = `curtain-embed-avatar-${++dbN}`;
    const { store } = setup({ store: createEmbedStore({ openDb: () => new EmbedDb(name) }) });
    expect(store.persistsLooks).toBe(false);
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('avatar-skin-switch'));
    await user.click(screen.getByTestId('skin-swatch-8'));
    await user.click(screen.getByTestId('avatar-prompt-done'));
    expect(figureSkin()).toBe(lookForMonk(8)!.hex);
    // "Remember me" is on and the profile is stored, but no row holds the colour.
    await waitFor(async () => expect(await store.persistedKeys()).toContain(`profile:${SHOP_ID}`));
    expect((await store.persistedKeys()).filter((k) => /look/.test(k))).toEqual([]);
    cleanup();

    // The next visit: a new store on the same database.
    setup({ store: createEmbedStore({ openDb: () => new EmbedDb(name) }) });
    await screen.findByTestId('embed-result');
    expect(figureSkin()).toBe(STANDARD_SKIN_HEX);
    await user.click(screen.getByTestId('avatar-open'));
    expect(within(await screen.findByRole('dialog')).getByTestId('avatar-skin-switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('with the storage flag on: C30 is shown as written, and a returning shopper sees the colour they picked', async () => {
    const user = userEvent.setup();
    const name = `curtain-embed-avatar-${++dbN}`;
    setup({ locale: 'nl-NL', store: createEmbedStore({ persistLooks: true, openDb: () => new EmbedDb(name) }) });
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('avatar-skin-switch'));
    // The sentence as the shopper sees it, with the footer's English label tagged as English.
    const c30 = screen.getByTestId('avatar-c30');
    expect(c30).toHaveTextContent(c30Text('nl'));
    expect(c30.querySelector('span[lang="en"]')).toHaveTextContent(/^Remember me on this shop$/);
    await user.click(screen.getByTestId('skin-swatch-8'));
    cleanup();

    setup({ store: createEmbedStore({ persistLooks: true, openDb: () => new EmbedDb(name) }) });
    await screen.findByTestId('embed-result');
    await waitFor(() => expect(figureSkin()).toBe(lookForMonk(8)!.hex), { timeout: 8000 });
    await user.click(screen.getByTestId('avatar-open'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('avatar-skin-switch')).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByTestId('skin-swatch-8')).toBeChecked();
  });

  it('the hero render is drawn from a separate figure in the standard colour, not from the coloured one on screen', async () => {
    const store = createEmbedStore({ openDb: () => new EmbedDb(`curtain-embed-avatar-${++dbN}`) });
    await store.saveLook(SHOP_ID, lookForMonk(9)!);
    const api = {
      resolveTry: vi.fn(async () => ({
        shop: { id: SHOP_ID, name: 'Aalter Studio', platform: 'woocommerce', paused: false, heroRenders: true },
        garment: MOCK_GARMENTS_BY_ID['aalter-studio-1']!,
        trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'intent-token-0123456789' },
        pairing: { created: true, pairedAt: new Date().toISOString() },
        embed: { allowedOrigins: [SHOP_ORIGIN] },
      })),
      fitShown: vi.fn(async () => ({ billed: true })),
      deleteMe: vi.fn(),
      requestHeroRender: vi.fn(),
      heroRenderStatus: vi.fn(),
    } as unknown as EmbedApi;
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <EmbedApp token="try-token-0123456789abcdef" deps={{ store, makeApi: () => api, parent: { postMessage: vi.fn() }, referrer: `${SHOP_ORIGIN}/p/`, ancestorOrigins: null, appUrl: 'https://app.curtain.example/', canScan: false, locale: 'en-AU' }} />
      </MemoryRouter>,
    );
    await toResult(user);
    expect(screen.getByRole('heading', { name: 'See it on me' })).toBeInTheDocument();
    const onScreen = screen.getByTestId('avatar-open').parentElement!.querySelector('svg[data-skin]')!;
    expect(onScreen).toHaveAttribute('data-skin', lookForMonk(9)!.hex);
    const hero = screen.getByTestId('hero-avatar').querySelector('svg')! as SVGSVGElement;
    expect(hero).toHaveAttribute('data-skin', STANDARD_SKIN_HEX);
    expect(hero.querySelector('[data-testid="size-rings"]')).toBeNull();
    expect(() => assertNeutralPerson(hero)).not.toThrow();
    // That figure is what the render got before the avatar prompt: no drawn face, no outline, and
    // the same garment outline (hem width included) as the figure on screen.
    expect(hero.querySelector('[data-testid="neutral-face"]')).toBeNull();
    expect(hero.querySelector('[data-testid="figure-body"]')).not.toHaveAttribute('stroke');
    expect(onScreen.querySelector('[data-testid="neutral-face"]')).not.toBeNull();
    const garmentPath = (svg: Element): string | null => svg.querySelector('[data-testid="garment-layer"] path')!.getAttribute('d');
    expect(garmentPath(hero)).toBe(garmentPath(onScreen));
    expect(() => assertNeutralPerson(onScreen as SVGSVGElement)).toThrow(/standard colour/);
    // The fit-shown event carries the size and the confidence, nothing of the look.
    expect(JSON.stringify((api.fitShown as ReturnType<typeof vi.fn>).mock.calls)).not.toMatch(/skin|look|monk|#[0-9a-f]{6}/i);
  });

  it('the figure keeps its estimate label and gets no photo with a colour on it', async () => {
    const user = userEvent.setup();
    setup();
    await toResult(user);
    await user.click(screen.getByTestId('avatar-open'));
    await user.click(within(await screen.findByRole('dialog')).getByTestId('avatar-skin-switch'));
    await user.click(screen.getByTestId('skin-swatch-10'));
    await user.click(screen.getByTestId('avatar-prompt-done'));
    const result = screen.getByTestId('embed-result');
    expect(result).toHaveTextContent('Estimate · not measured');
    expect(within(result).getByTestId('estimate-disclaimer')).toBeInTheDocument();
    expect(result.querySelector('svg image')).toBeNull();
    expect(within(result).getByTestId('neutral-face')).toBeInTheDocument();
  });
});
