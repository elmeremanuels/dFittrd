// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PILOT_PULL_ON_SKIRT, PILOT_SKIRT_CHART_ONLY, type GarmentPayload } from '@curtain/schema';
import { adviseSize, EMPTY_ABOUT, fitForProfile, profileFromAbout } from '../aboutYou';
import { ResultScreen } from '../ResultScreen';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
afterEach(cleanup);

/** The held-out body of the fit-engine README: waist 73.5, hip 100, typed in. */
function Screen({ garment }: { garment: GarmentPayload }) {
  const profile = profileFromAbout({ ...EMPTY_ABOUT, height: '170', weight: '64', waist: '73.5', hip: '100', knowsMeasurements: true }, 'bottom');
  const embedFit = fitForProfile(garment, profile);
  const advice = adviseSize(embedFit.fit, 'regular');
  const [selected, setSelected] = useState(advice.size!);
  return (
    <ResultScreen garment={garment} profile={profile} embedFit={embedFit} advice={advice} preference="regular" selected={selected} onSelect={setSelected} onChoose={() => {}} onEdit={() => {}} returning={false} chooseFallback={null} chosen={null} currentVariantSize={null} units="metric" onUnits={() => {}} />
  );
}

describe('pull-on skirt with the shop tape: the result the shopper sees', () => {
  it('recommends 10 with the warning, and the size whose band does not pass the hips shows no fit score', () => {
    render(<Screen garment={PILOT_PULL_ON_SKIRT} />);
    expect(screen.getByText('To pull it on, the waistband only just stretches over your hips', { exact: false })).toBeInTheDocument();
    const chips = within(screen.getByRole('radiogroup', { name: /compare sizes/i }));
    expect(chips.getByRole('radio', { name: /^8/ })).toHaveTextContent(/^8too small to pull on$/);
    expect(chips.getByRole('radio', { name: /^8/ })).not.toHaveTextContent(/%/);
    expect(chips.getByRole('radio', { name: /^10/ })).toHaveTextContent(/%/);
  });

  it('without the tape (chart only) nothing changes: every chip has its score', () => {
    render(<Screen garment={PILOT_SKIRT_CHART_ONLY} />);
    expect(screen.queryByTestId(/compare-no-pull-on-/)).toBeNull();
    expect(screen.queryByText(/pull it on/)).toBeNull();
  });
});
