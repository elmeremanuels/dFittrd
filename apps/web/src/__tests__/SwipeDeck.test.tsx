// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { MOCK_GARMENTS, MOCK_GARMENTS_BY_ID } from '@paskamer/schema';
import * as taste from '@paskamer/taste-engine';
import { computeFit } from '@paskamer/fit-engine';

vi.mock('@paskamer/taste-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@paskamer/taste-engine')>();
  return { ...actual, applySwipe: vi.fn(actual.applySwipe) };
});

// motion's drag + animate need layout APIs jsdom lacks; the buttons are the accessible path under test.
vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
// jsdom has no matchMedia; report reduced motion so motion exit animations are instant.
vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));


const { useApp, MOCK_SHOP_ID } = await import('@/store');
const { SwipeDeck } = await import('@/components/SwipeDeck');
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

function seed(profile = PROFILE): void {
  useApp.setState({
    hydrated: true,
    catalog: MOCK_GARMENTS.map((garment) => ({ garment, shopId: MOCK_SHOP_ID })),
    catalogSource: 'mock',
    settings: { ...useApp.getState().settings, onboarded: true },
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

describe('SwipeDeck', () => {
  it('deals a card from the taste engine and shows the on-device fit (size, score, notes) in a live region', async () => {
    renderDeck();
    const panel = await screen.findByTestId('fit-panel');
    expect(panel).toHaveAttribute('aria-live', 'polite');
    const current = useApp.getState().deck.current!;
    const fit = computeFit(current.garment, useApp.getState().fitCtx!.userBody, { sigma: useApp.getState().fitCtx!.sigma });
    expect(within(panel).getByTestId('recommended-size')).toHaveTextContent(fit.recommendedSize!);
    expect(within(panel).getByTestId('fit-score')).toHaveTextContent(`${Math.round(fit.score! * 100)}%`);
    if (fit.notes.length > 0) expect(within(panel).getByTestId('fit-notes')).toHaveTextContent(fit.notes[0]!);
    expect(screen.getByText(/Estimate · not measured/)).toBeInTheDocument();
    expect(screen.getByTestId('estimate-disclaimer')).toBeInTheDocument();
    expect(screen.getByText(current.garment.name)).toBeInTheDocument();
  });

  it('routes all four actions through applySwipe with the size and score at swipe time', async () => {
    const user = userEvent.setup();
    renderDeck();
    await screen.findByTestId('fit-panel');
    const labels = ['Pass', 'Less like this', 'Love', 'Save to wardrobe'] as const;
    const expected = ['pass', 'less', 'love', 'save'] as const;
    for (let i = 0; i < labels.length; i++) {
      const before = useApp.getState().deck.current!;
      const fit = useApp.getState().fit(before.garment)!;
      const button = screen.getByRole('button', { name: labels[i] });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);
      await waitFor(() => expect(vi.mocked(taste.applySwipe)).toHaveBeenCalledTimes(i + 1));
      const call = vi.mocked(taste.applySwipe).mock.calls[i]!;
      expect(call[1].id).toBe(before.garment.id);
      expect(call[2]).toMatchObject({ recommendedSize: fit.recommendedSize, score: fit.score });
      expect(call[3]).toBe(expected[i]);
      await waitFor(() => expect(useApp.getState().deck.current?.garment.id).not.toBe(before.garment.id));
    }
    const state = useApp.getState();
    expect(state.taste.profile.swipeCount).toBe(4);
    expect(state.taste.events.map((e) => e.action)).toEqual([...expected]);
    expect(state.taste.events.every((e) => typeof e.sizeAtSwipe === 'string' && typeof e.fitScore === 'number')).toBe(true);
    // save → wardrobe with the recommended size; love → not in the wardrobe (handoff §5)
    expect(state.wardrobe).toHaveLength(1);
    expect(state.wardrobe[0]?.productId).toBe(state.taste.events[3]?.itemId);
    expect(state.wardrobe.some((w) => w.productId === state.taste.events[2]?.itemId)).toBe(false);
    expect(screen.getAllByRole('button', { name: /Open your Style DNA/ })).toHaveLength(1);
  });

  it('renders the "no size fits" state instead of recommending the first chart row', async () => {
    const profile = { ...PROFILE, measurements: { ...PROFILE.measurements, bust: { mean: 150, sigma: 1.5, source: 'manual' as const }, waist: { mean: 140, sigma: 1.5, source: 'manual' as const }, hip: { mean: 160, sigma: 1.5, source: 'manual' as const } } };
    seed(profile);
    const garment = MOCK_GARMENTS_BY_ID['aalter-studio-1']!;
    const fit = useApp.getState().fit(garment)!;
    expect(fit.recommendedSize).toBeNull();
    const state = useApp.getState().taste;
    useApp.setState({ deck: { current: taste.scoreItem(state, garment, fit, 0), notInYourSize: 1, exhausted: false } });
    renderDeck();
    const panel = await screen.findByTestId('fit-panel');
    expect(within(panel).getByText('No size fits')).toBeInTheDocument();
    expect(within(panel).getByText(new RegExp(`Closest is`))).toHaveTextContent(fit.closestSize!);
    expect(within(panel).queryByTestId('recommended-size')).toBeNull();
  });

  it('shows the end-of-deck state when nothing can be dealt', async () => {
    useApp.setState({ catalog: [], deck: { current: null, notInYourSize: 0, exhausted: false } });
    renderDeck();
    expect(await screen.findByTestId('deck-empty')).toHaveTextContent(/seen the whole rail/);
    expect(screen.getByRole('button', { name: 'Love' })).toBeDisabled();
  });

  it('asks for measurements when the profile is empty', async () => {
    useApp.setState({ profile: null, fitCtx: null });
    renderDeck();
    const panel = await screen.findByTestId('fit-panel');
    expect(within(panel).getByRole('link', { name: /Add your measurements/ })).toHaveAttribute('href', '/onboarding');
  });
});
