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
function Screen({ garment, onPage = null, waist = '73.5', hip = '100' }: { garment: GarmentPayload; onPage?: string | null; waist?: string; hip?: string }) {
  const profile = profileFromAbout({ ...EMPTY_ABOUT, height: '170', weight: '64', waist, hip, knowsMeasurements: true }, 'bottom');
  const embedFit = fitForProfile(garment, profile);
  const advice = adviseSize(embedFit.fit, 'regular');
  const [selected, setSelected] = useState(advice.size ?? advice.closest!);
  return (
    <ResultScreen garment={garment} profile={profile} embedFit={embedFit} advice={advice} preference="regular" selected={selected} onSelect={setSelected} onChoose={() => {}} onEdit={() => {}} returning={false} chooseFallback={null} chosen={null} currentVariantSize={onPage} units="metric" onUnits={() => {}} />
  );
}

describe('pull-on skirt with the shop tape: the result the shopper sees', () => {
  it('recommends 10 with the warning, and the size whose band does not pass the hips shows no fit score', () => {
    render(<Screen garment={PILOT_PULL_ON_SKIRT} />);
    expect(screen.getByText('To pull it on, the waistband only just stretches over your hips', { exact: false })).toBeInTheDocument();
    const chips = within(screen.getByRole('radiogroup', { name: /compare sizes/i }));
    expect(chips.getByRole('radio', { name: /^8/ })).toHaveTextContent(/^8too small to pull on$/);
    expect(chips.getByRole('radio', { name: /^8/ })).not.toHaveTextContent(/%/);
    expect(chips.getByRole('radio', { name: /^10/ })).toHaveTextContent(/^10only just pulls on/);
    expect(chips.getByRole('radio', { name: /^12/ })).toHaveTextContent(/%/);
  });

  it('the recommended size whose band only just passes shows that in place of a fit score', () => {
    render(<Screen garment={PILOT_PULL_ON_SKIRT} />);
    expect(screen.getByTestId('fit-score-note')).toHaveTextContent('Only just pulls on');
    expect(screen.queryByTestId('fit-score')).toBeNull();
  });

  it('a size picked on the shop page that cannot be pulled on is said so', () => {
    render(<Screen garment={PILOT_PULL_ON_SKIRT} onPage="8" />);
    expect(screen.getByTestId('on-page-no-pull-on')).toHaveTextContent('Selected on the shop page: 8. Its waistband does not stretch over your hips.');
  });

  it('without the tape (chart only) nothing changes: every chip has its score', () => {
    render(<Screen garment={PILOT_SKIRT_CHART_ONLY} />);
    expect(screen.queryByTestId(/compare-no-pull-on-/)).toBeNull();
    expect(screen.queryByText(/pull it on/)).toBeNull();
    expect(screen.queryByTestId('fit-score-note')).toBeNull();
    expect(screen.getByTestId('fit-score')).toHaveTextContent('%');
  });

  it('without the tape a size picked on the shop page reads as before', () => {
    render(<Screen garment={PILOT_SKIRT_CHART_ONLY} onPage="8" />);
    expect(screen.queryByTestId('on-page-no-pull-on')).toBeNull();
  });
});

describe('pull-on skirt: the waist never reads "Good fit" next to "Only just pulls on", and a blocked size has no score', () => {
  it('hip 100 (AU 10 only just pulls on): the figure chip and the fit-points row name the pull-on check', () => {
    render(<Screen garment={PILOT_PULL_ON_SKIRT} />);
    const chip = screen.getByTestId('size-ring-chip-waist');
    expect(chip).toHaveTextContent(/^Waistband\s*only just pulls on/);
    expect(chip).not.toHaveTextContent(/Good fit|by the size chart/);
    const row = screen.getByTestId('fit-point-waist');
    expect(row).toHaveTextContent('Only just pulls on');
    expect(row).toHaveTextContent(/By the size chart: good fit, .*designed/);
    expect(screen.getByTestId('size-ring-text')).toHaveTextContent(/Waist: the band only just stretches over your hips; by the size chart alone: good fit/);
  });

  it('hip 120 (every size blocked): no percentage anywhere on the result, and the closest size says why', () => {
    render(<Screen garment={PILOT_PULL_ON_SKIRT} waist="95" hip="120" />);
    const panel = screen.getByTestId('fit-panel');
    expect(panel).toHaveTextContent('Closest is 16, but its waistband does not stretch over your hips');
    expect(panel).not.toHaveTextContent(/\d%/);
    const chips = within(screen.getByRole('radiogroup', { name: /compare sizes/i }));
    for (const r of chips.getAllByRole('radio')) expect(r).not.toHaveTextContent(/%/);
    expect(screen.getByTestId('size-ring-chip-waist')).toHaveTextContent(/^Waistband\s*too small to pull on/);
    expect(screen.getByTestId('fit-point-waist')).toHaveTextContent('Too small to pull on');
    // the engine does score the blocked size highly from the chart: that number must not reach the screen
    expect(screen.getByTestId('embed-result')).not.toHaveTextContent(/9\d%/);
  });

  it('a size that pulls on with room keeps the engine word on the waist', () => {
    render(<Screen garment={PILOT_PULL_ON_SKIRT} waist="70" hip="92" />);
    expect(screen.getByTestId('size-ring-chip-waist')).not.toHaveTextContent(/pulls on|pull on/);
    expect(screen.getByTestId('fit-point-waist')).not.toHaveTextContent(/pulls on|pull on/);
  });
});
