// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOCK_GARMENTS_BY_ID, type GarmentPayload } from '@curtain/schema';
import { adviseSize, EMPTY_ABOUT, fitForProfile, profileFromAbout } from '../aboutYou';
import { ResultScreen } from '../ResultScreen';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
afterEach(cleanup);

const SKIRT = {
  ...MOCK_GARMENTS_BY_ID['noord-bottom-01']!,
  id: 'crimson-wildflower-maxi-skirt',
  subcategory: 'maxi-skirt',
  patternBlock: 'a-line',
  lengthCm: {},
  sizeChartType: 'body',
  criticalFitPoints: [],
  stretchZones: ['waistband'],
  sizingNotes: '',
  sizeChart: [
    { size: '8', waist: 67.5, hip: 94 },
    { size: '10', waist: 72.5, hip: 99 },
    { size: '12', waist: 77.5, hip: 104 },
    { size: '14', waist: 82.5, hip: 109 },
    { size: '16', waist: 87.5, hip: 114 },
  ],
} as GarmentPayload;

function Screen({ garment = SKIRT }: { garment?: GarmentPayload }) {
  const profile = profileFromAbout({ ...EMPTY_ABOUT, height: '167', weight: '66', bust: '93', waist: '76', hip: '102', knowsMeasurements: true, tape: true }, garment.category);
  const embedFit = fitForProfile(garment, profile);
  const advice = adviseSize(embedFit.fit, 'regular');
  const [selected, setSelected] = useState(advice.size!);
  return (
    <ResultScreen garment={garment} profile={profile} embedFit={embedFit} advice={advice} preference="regular" selected={selected} onSelect={setSelected} onChoose={() => {}} onEdit={() => {}} returning={false} chooseFallback={null} chosen={null} currentVariantSize={null} units="metric" onUnits={() => {}} />
  );
}

describe('size rings on the result (route R5 mock)', () => {
  it('shows the recommended size’s rings with neighbour ghosts, text labels and an estimate note', () => {
    const { container } = render(<Screen />);
    const layer = container.querySelector('[data-testid="size-rings"]')!;
    expect(layer).toHaveAttribute('data-size', '12');
    expect([...container.querySelectorAll('[data-testid="size-ring-ghost"]')].map((g) => g.getAttribute('data-size'))).toEqual(['10', '14']);
    expect(container.querySelector('[data-testid="size-ring-waist"]')).toHaveAttribute('data-band', 'good');
    // colour is never alone: the chip says it in words
    expect(screen.getByTestId('size-ring-chip-waist')).toHaveTextContent(/Good fit.*cm room/);
    expect(screen.getByTestId('size-ring-chip-hem')).toHaveTextContent(/assumed/);
    expect(screen.getByTestId('size-ring-text')).toHaveTextContent(/Waist: good fit/);
    const legend = screen.getByTestId('size-rings-legend');
    expect(legend).toHaveTextContent(/estimate/i);
    expect(legend).toHaveTextContent(/girth assumed, not measured yet/);
  });

  it('switching size redraws the rings for that size', async () => {
    const user = userEvent.setup();
    const { container } = render(<Screen />);
    const rx = () => Number(container.querySelector('[data-testid="size-ring-waist"]')!.getAttribute('data-rx'));
    const before = rx();
    await user.click(within(screen.getByRole('radiogroup', { name: /compare sizes/i })).getByRole('radio', { name: /^10/ }));
    expect(container.querySelector('[data-testid="size-rings"]')).toHaveAttribute('data-size', '10');
    expect(rx()).toBeLessThan(before);
    expect(screen.getByTestId('size-ring-chip-waist')).toHaveTextContent(/Snug|Tight/);
  });

  it('can be hidden, and a product without ring inputs still gets chart rings without a hem', async () => {
    const user = userEvent.setup();
    const { container } = render(<Screen garment={{ ...SKIRT, id: 'some-other-skirt' }} />);
    expect(container.querySelector('[data-testid="size-ring-hem"]')).toBeNull();
    expect(screen.getByTestId('size-ring-text')).toHaveTextContent(/elastic band, its girth is not measured/);
    await user.click(screen.getByTestId('size-rings-toggle'));
    expect(container.querySelector('[data-testid="size-rings"]')).toBeNull();
    expect(screen.getByTestId('size-rings-toggle')).toHaveAttribute('aria-pressed', 'false');
    // the tight / loose look of the figure stays
    expect(screen.getByTestId('garment-layer')).toBeInTheDocument();
  });
});
