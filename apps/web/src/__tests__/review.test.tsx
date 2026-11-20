// @vitest-environment jsdom
/**
 * Reviewer tests (skeptical pass over apps/web): each `it` reproduced a real defect before the
 * matching fix landed. Kept as regression guards.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { MOCK_GARMENTS, MOCK_GARMENTS_BY_ID } from '@curtain/schema';
import * as taste from '@curtain/taste-engine';
type TasteEngine = typeof taste;

vi.mock('@curtain/taste-engine', async (importOriginal) => {
  const actual = await importOriginal<TasteEngine>();
  return { ...actual, applySwipe: vi.fn(actual.applySwipe) };
});

vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));

const { useApp, MOCK_SHOP_ID } = await import('@/store');
const { SwipeDeck } = await import('@/components/SwipeDeck');
const { Onboarding } = await import('@/components/Onboarding');
const { fitContextFromProfile } = await import('@/store/fit');

const PROFILE = {
  version: 1 as const,
  measurements: {
    height: { mean: 168, sigma: 1, source: 'manual' as const },
    bust: { mean: 88, sigma: 1.5, source: 'manual' as const },
    waist: { mean: 70, sigma: 1.5, source: 'manual' as const },
    hip: { mean: 96, sigma: 1.5, source: 'manual' as const },
  },
  updatedAt: 1,
};

function seed(profile: typeof PROFILE | null = PROFILE): void {
  useApp.setState({
    hydrated: true,
    catalog: MOCK_GARMENTS.map((garment) => ({ garment, shopId: MOCK_SHOP_ID })),
    catalogSource: 'mock',
    settings: { ...useApp.getState().settings, onboarded: true, vibes: [] },
    profile,
    fitCtx: fitContextFromProfile(profile),
    taste: taste.emptyState(),
    deck: { current: null, notInYourSize: 0, exhausted: false },
    wardrobe: [],
  });
}

beforeEach(() => {
  vi.mocked(taste.applySwipe).mockClear();
  seed();
});

afterEach(() => {
  cleanup();
});

function renderDeck() {
  return render(
    <MemoryRouter>
      <SwipeDeck />
    </MemoryRouter>,
  );
}

/** A pointer gesture the way motion's PanSession sees it (pointerdown on the card, move + up on the window). */
function pointer(type: string, target: EventTarget, x: number, y: number): void {
  const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
  const ev = new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 });
  Object.defineProperty(ev, 'pageX', { value: x });
  Object.defineProperty(ev, 'pageY', { value: y });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  Object.defineProperty(ev, 'isPrimary', { value: true });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  target.dispatchEvent(ev);
}

const frame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/** motion processes moves on its frame loop, so each move is followed by a frame before the pointer lifts. */
async function drag(card: HTMLElement, dx: number, dy: number): Promise<void> {
  await act(async () => {
    pointer('pointerdown', card, 10, 10);
    await frame();
    for (const f of [0.25, 0.5, 0.75, 1]) {
      pointer('pointermove', window, 10 + dx * f, 10 + dy * f);
      await frame();
    }
    pointer('pointerup', window, 10 + dx, 10 + dy);
    await frame();
  });
}

describe('deck card gestures', () => {
  it('a second drag-swipe still works after the first one (card state is keyed by garment)', async () => {
    renderDeck();
    await screen.findByTestId('fit-panel');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Love' })).toBeEnabled());
    const first = useApp.getState().deck.current!;
    await drag(screen.getByTestId('deck-card'), 200, 0);
    await waitFor(() => expect(vi.mocked(taste.applySwipe)).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taste.applySwipe).mock.calls[0]![3]).toBe('love');
    await waitFor(() => expect(useApp.getState().deck.current?.garment.id).not.toBe(first.garment.id));

    const second = useApp.getState().deck.current!;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Love' })).toBeEnabled());
    const card = screen.getByTestId('deck-card');
    expect(card.style.transform === '' || card.style.transform === 'none').toBe(true); // new card starts at the origin
    await drag(card, -200, 0);
    await waitFor(() => expect(vi.mocked(taste.applySwipe)).toHaveBeenCalledTimes(2));
    expect(vi.mocked(taste.applySwipe).mock.calls[1]![1].id).toBe(second.garment.id);
    expect(vi.mocked(taste.applySwipe).mock.calls[1]![3]).toBe('pass');
    // let the swipe finish persisting before the next test reseeds the shared store
    await waitFor(() => expect(screen.getByRole('button', { name: 'Love' })).toBeEnabled());
  });
});

describe('deck re-deals when the store resets it', () => {
  it('deals a new card after the catalogue / profile reset the deck (hydrate with paired shops, re-measure)', async () => {
    renderDeck();
    await screen.findByTestId('fit-panel');
    const before = useApp.getState().deck.current!;
    // what `hydrate` (paired catalogue arriving) and `setProfile` do
    act(() => {
      useApp.setState({ catalog: [{ garment: MOCK_GARMENTS_BY_ID['aalter-studio-1']!, shopId: '11111111-1111-4111-8111-111111111111' }], catalogSource: 'paired', deck: { current: null, notInYourSize: 0, exhausted: false } });
    });
    await waitFor(() => expect(useApp.getState().deck.current).not.toBeNull());
    expect(useApp.getState().deck.current!.garment.id).toBe('aalter-studio-1');
    expect(useApp.getState().deck.current).not.toBe(before);
    expect(screen.queryByTestId('deck-empty')).toBeNull();
    expect(await screen.findByTestId('fit-panel')).toBeInTheDocument();
  });
});

describe('estimate labelling without measurements', () => {
  it('does not claim the body comes from the user when there are no measurements', async () => {
    seed(null);
    renderDeck();
    await screen.findByTestId('fit-panel');
    const mirror = screen.getByTestId('mirror');
    expect(within(mirror).queryByText(/Body from your measurements/)).toBeNull();
    expect(within(mirror).getByText(/Reference body/)).toBeInTheDocument();
    expect(within(mirror).getByText(/Estimate · not measured/)).toBeInTheDocument();
    // the accessible name says the same thing as the visible chips
    const img = within(mirror).getByRole('img');
    expect(img).toHaveAccessibleName(/reference body/);
    expect(img).toHaveAccessibleName(/not measured/);
    expect(img.getAttribute('aria-label')).not.toMatch(/your body/);
  });
});

describe('re-entering onboarding', () => {
  it('starts the vibes step from the saved vibes instead of an empty selection', async () => {
    useApp.setState({ settings: { ...useApp.getState().settings, onboarded: true, vibes: ['Minimal', 'Sporty'] } });
    render(
      <MemoryRouter initialEntries={['/onboarding?step=vibes']}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding initialStep="vibes" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: 'Minimal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Sporty' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Classic' })).toHaveAttribute('aria-pressed', 'false');
  });
});
