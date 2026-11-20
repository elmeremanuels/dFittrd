// @vitest-environment jsdom
/**
 * Slice 1 in the popup: the stretch line (D25 point 1), the wordmark switch (D25 point 7) and the
 * removed age-range question (D25 point 6).
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MOCK_GARMENTS_BY_ID, type TryResolveResponse } from '@curtain/schema';
import { EMPTY_ABOUT, normalizeAbout } from '../aboutYou';
import { resolveMock, type EmbedApi, type EmbedDeps } from '../deps';
import { EmbedApp } from '../EmbedApp';
import { createEmbedStore, EmbedDb } from '../storage';
import { embedStrings } from '../strings';
import { EN } from '../strings/en';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const SHOP_ORIGIN = 'https://aalter-studio.example';
const garment = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;

function resolved(over: Partial<TryResolveResponse> = {}, shop: Partial<TryResolveResponse['shop']> = {}): TryResolveResponse {
  return {
    shop: { id: '00000000-0000-4000-8000-0000000000e1', name: 'Aalter Studio', platform: 'woocommerce', paused: false, ...shop },
    garment,
    trySession: { id: '00000000-0000-4000-8000-0000000000ab', expiresAt: new Date(Date.now() + 600_000).toISOString(), intentToken: 'intent-token-0123456789' },
    pairing: { created: true, pairedAt: new Date().toISOString() },
    embed: { allowedOrigins: [SHOP_ORIGIN] },
    ...over,
  };
}

let dbN = 0;
function setup(answer: TryResolveResponse) {
  const api = { resolveTry: vi.fn(async () => answer), fitShown: vi.fn(async () => ({ billed: true })), deleteMe: vi.fn(), requestHeroRender: vi.fn(), heroRenderStatus: vi.fn() } as unknown as EmbedApi;
  const deps: EmbedDeps = {
    store: createEmbedStore({ openDb: () => new EmbedDb(`curtain-embed-slice1-${++dbN}`) }),
    makeApi: () => api,
    parent: { postMessage: vi.fn() },
    referrer: `${SHOP_ORIGIN}/product/linen-wrap-dress/`,
    ancestorOrigins: null,
    appUrl: 'https://app.curtain.example/',
    canScan: false,
    locale: 'en-AU',
  };
  return render(
    <MemoryRouter>
      <EmbedApp token="try-token-0123456789abcdef" deps={deps} />
    </MemoryRouter>,
  );
}

async function toResult(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText(/^Height/), '168');
  await user.type(screen.getByLabelText(/^Weight/), '62');
  await user.click(screen.getByTestId('see-my-size'));
  await screen.findByTestId('embed-result');
}

afterEach(() => cleanup());

describe('the stretch line', () => {
  it('says once, under the size, that stretch was not taken into account when the shop gave none', async () => {
    const user = userEvent.setup();
    setup(resolved({ stretchAssumed: true }));
    await toResult(user);
    const lines = screen.getAllByTestId('stretch-not-used');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent(embedStrings().result.stretchNotUsed);
    // It states what was not done; it does not promise the advice errs on the roomy side.
    expect(EN.result.stretchNotUsed).toMatch(/does not take stretch into account/);
    expect(EN.result.stretchNotUsed).not.toMatch(/safe|roomier|larger|never/i);
  });

  it('is absent when the stretch comes from the shop', async () => {
    const user = userEvent.setup();
    setup(resolved());
    await toResult(user);
    expect(screen.queryByTestId('stretch-not-used')).toBeNull();
  });
});

describe('"Fit by Curtain"', () => {
  it('is shown by default', async () => {
    setup(resolved());
    expect(await screen.findByTestId('embed-wordmark')).toHaveTextContent('Fit by Curtain');
  });

  it('is left out when the shop switched it off; the estimate label and the privacy lines stay', async () => {
    const user = userEvent.setup();
    setup(resolved({}, { hideWordmark: true }));
    await screen.findByLabelText(/^Height/);
    expect(screen.queryByTestId('embed-wordmark')).toBeNull();
    expect(screen.getByTestId('embed-footer')).not.toHaveTextContent('Fit by');
    // The footer keeps what it is for: remember me, forget me, where it is saved.
    expect(screen.getByTestId('embed-footer')).toHaveTextContent(embedStrings().footer.forget);
    expect(screen.getByTestId('embed-header')).toHaveTextContent(embedStrings().header.privacy);
    await toResult(user);
    // Rule 3: the figure is still labelled an estimate.
    const [a, b] = embedStrings().result.estimateLines;
    expect(screen.getByTestId('embed-result').textContent).toContain(a);
    expect(screen.getByTestId('embed-result').textContent).toContain(b);
  });
});

describe('the age-range question is gone', () => {
  it('the form does not ask it and the catalogue has no text for it', async () => {
    setup(resolved());
    await screen.findByLabelText(/^Height/);
    expect(screen.queryByLabelText(/age/i)).toBeNull();
    expect(screen.queryByText(/age range/i)).toBeNull();
    expect(JSON.stringify(EN.about)).not.toMatch(/age range|prefer not to say/i);
    expect('ageRange' in EMPTY_ABOUT).toBe(false);
  });

  it('a form stored while the question existed still opens, and its age range is dropped', () => {
    const stored = { ...EMPTY_ABOUT, height: '170', weight: '64', ageRange: '25-34' };
    const opened = normalizeAbout(stored);
    expect(opened.height).toBe('170');
    expect(opened.weight).toBe('64');
    expect('ageRange' in opened).toBe(false);
  });
});

describe('mock tokens for screenshots', () => {
  it('mock:nostretch and mock:nomark carry the flags; a plain mock carries neither', () => {
    expect(resolveMock('mock:nostretch:aalter-studio-1', '').stretchAssumed).toBe(true);
    expect(resolveMock('mock:nomark:aalter-studio-1', '').shop.hideWordmark).toBe(true);
    const plain = resolveMock('mock:aalter-studio-1', '');
    expect('stretchAssumed' in plain).toBe(false);
    expect('hideWordmark' in plain.shop).toBe(false);
  });
});
