// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
// jsdom has no matchMedia; report reduced motion so motion exit animations are instant.
vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));


const { useApp } = await import('@/store');
const { Onboarding, manualProfile } = await import('@/components/Onboarding');
const { EMPTY_MANUAL_FORM } = await import('@/features/capture');

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  useApp.setState({ hydrated: true, settings: { ...useApp.getState().settings, onboarded: false }, profile: null, fitCtx: null, pendingIntent: null });
});

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={['/onboarding']}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/deck" element={<p>DECK</p>} />
        <Route path="/try/:token" element={<p>TRY</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Onboarding', () => {
  it('follows welcome → measurements → vibes → capture → done and gates each step', async () => {
    const user = userEvent.setup();
    renderOnboarding();
    const root = screen.getByTestId('onboarding');
    expect(root).toHaveAttribute('data-step', 'welcome');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(root).toHaveAttribute('data-step', 'measurements');
    const height = await screen.findByRole('spinbutton', { name: /^Height/ });

    // height is required: Next must not advance without it
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(root).toHaveAttribute('data-step', 'measurements');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(height).toHaveAttribute('type', 'number');
    expect(screen.getByRole('slider', { name: /Height slider/ })).toHaveAttribute('type', 'range');
    expect(screen.getByRole('spinbutton', { name: /Shoe|Foot/i })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: /How did you measure/ })).toBeInTheDocument();
    await user.type(height, '168');
    await user.type(screen.getByRole('spinbutton', { name: /^Bust/ }), '88');
    await user.click(screen.getByRole('radio', { name: /tape/i }));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(root).toHaveAttribute('data-step', 'vibes');

    const minimal = await screen.findByRole('button', { name: 'Minimal' });
    expect(minimal).toHaveAttribute('aria-pressed', 'false');
    await user.click(minimal);
    expect(minimal).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(root).toHaveAttribute('data-step', 'capture');

    // the capture step owns Next: only completion or an explicit skip advance
    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull();
    await screen.findByRole('button', { name: /Skip for now/ });
    await user.click(screen.getByRole('button', { name: /Skip for now/ }));
    await waitFor(() => expect(root).toHaveAttribute('data-step', 'done'));
    // the typed measurements became a manual-only profile
    await waitFor(() => expect(useApp.getState().profile?.measurements.height?.mean).toBe(168));
    expect(useApp.getState().profile?.measurements.bust).toMatchObject({ mean: 88, sigma: 1.5, source: 'manual' });

    await user.click(screen.getByRole('button', { name: /Enter the fitting room/ }));
    await waitFor(() => expect(useApp.getState().settings.onboarded).toBe(true));
    expect(useApp.getState().settings.vibes).toEqual(['Minimal']);
    expect(useApp.getState().taste.profile.axes.minimal).toBeCloseTo(0.75, 4);
    expect(await screen.findByText('DECK')).toBeInTheDocument();
  });

  it('resumes a pending try intent after onboarding', async () => {
    const user = userEvent.setup();
    useApp.setState({ pendingIntent: { id: 'current', token: 'mock:aalter-studio-1', createdAt: 1 } });
    renderOnboarding();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.type(await screen.findByRole('spinbutton', { name: /^Height/ }), '170');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByRole('button', { name: 'Minimal' });
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await user.click(await screen.findByRole('button', { name: /Skip for now/ }));
    await user.click(await screen.findByRole('button', { name: /Enter the fitting room/ }));
    expect(await screen.findByText('TRY')).toBeInTheDocument();
  });

  it('manualProfile needs a height and uses the method sigma', () => {
    expect(manualProfile({ ...EMPTY_MANUAL_FORM, bust: '90' }, null)).toBeNull();
    const p = manualProfile({ ...EMPTY_MANUAL_FORM, height: '170', waist: '72', footEu: '39', method: 'guess' }, null)!;
    expect(p.measurements.waist).toEqual({ mean: 72, sigma: 4, source: 'manual' });
    expect(p.measurements.footEu).toEqual({ mean: 39, sigma: 0.5, source: 'manual' });
    expect(p.manualMethod).toBe('guess');
  });
});
