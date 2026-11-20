// @vitest-environment jsdom
/**
 * The one not-drawn rule in the embed: a size the size advice says cannot be worn on the shopper's body is not drawn,
 * in the 3D view and on the 2D figure, and one sentence says where and that the size advice decided. Per garment
 * category; a size that fits, or is only snug, tight with room left, or loose, is drawn exactly as before.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit, wearBlock } from '@curtain/fit-engine';
import { PILOT_PULL_ON_SKIRT, SYNTHETIC_MENS_CHINO_WL, SYNTHETIC_MENS_TEE, type GarmentAssetRef, type GarmentPayload } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { adviseSize, EMPTY_ABOUT, fitForProfile, profileFromAbout } from '../aboutYou';
import { Garment3D } from '../Garment3D';
import { notDrawnFromViewer, notDrawnNote, notDrawnSentence } from '../notDrawn';
import { ResultScreen } from '../ResultScreen';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
afterEach(cleanup);

/** A woven strap dress on a garment chart with the bust only, as the tape-built babydoll is seeded (spikes `pomDressSynthetic.ts`). */
const DRESS: GarmentPayload = {
  schemaVersion: 1,
  id: 'woven-babydoll',
  brand: 'Curtain test fixture',
  name: 'Woven babydoll dress',
  category: 'dress',
  subcategory: 'babydoll',
  audience: 'women',
  priceEur: 1,
  primaryColorHex: '#2F7F86',
  colorways: [{ name: 'Test teal', hex: '#2F7F86' }],
  fabric: { primary: 'viscose', blend: [['viscose', 100]], weightGsm: 140, stretchPct: 1.5, drape: 0.8, opacity: 0.9, sheen: 0.2 },
  patternBlock: 'empire',
  closure: 'zip',
  lengthCm: { shoulder_to_hem: 86 },
  sizeChartType: 'garment',
  sizeChart: [
    { size: '8', bust: 92 },
    { size: '10', bust: 97 },
    { size: '12', bust: 102 },
    { size: '14', bust: 107 },
    { size: '16', bust: 112 },
  ],
  criticalFitPoints: ['bust'],
  productPhotos: ['https://placehold.co/800x1000/F5EFE7/1A1612.png?text=TEST'],
  flatLayPhoto: 'https://placehold.co/1000x1000/FFFFFF/1A1612.png?text=TEST',
};
/** AU 16 chart body: two sizes larger than the AU 12 dress. */
const AU16 = { bust: 105, waist: 87.5, hip: 114 };

describe('the sentence, per garment', () => {
  it('a woven dress two sizes too small: the bust, the shortfall, the size advice', () => {
    const fit = computeFit(DRESS, { measurements: AU16 });
    expect(fit.recommendedSize).toBe('16');
    const note = notDrawnNote(fit, '12')!;
    expect(note).toEqual({ reason: 'tight', point: 'bust', anchor: 'chest', shortCm: 3 });
    expect(notDrawnSentence(note, '12', DRESS.audience, 'metric')).toBe('Size 12 is not drawn: the size advice says it does not close at the bust, where your body is 3.0 cm larger than the garment, more than its fabric gives, so the body is shown without it.');
    expect(notDrawnSentence(note, '12', DRESS.audience, 'imperial')).toContain('where your body is 1.2 in larger than the garment');
    // One size down is tight with 2 cm left, the own size fits: both are drawn, nothing is said.
    expect(notDrawnNote(fit, '14')).toBeNull();
    expect(notDrawnNote(fit, '16')).toBeNull();
  });
  it('a pull-on skirt: the waistband over the hips', () => {
    const fit = computeFit(PILOT_PULL_ON_SKIRT, { measurements: { bust: 89, waist: 71.5, hip: 98 } });
    const note = notDrawnNote(fit, '8')!;
    expect(note).toMatchObject({ reason: 'pull-on', point: 'hip', anchor: 'hip', shortCm: 4 });
    expect(notDrawnSentence(note, '8', PILOT_PULL_ON_SKIRT.audience, 'metric')).toBe('Size 8 is not drawn: the size advice says its waistband does not stretch over your hips, which are 4.0 cm larger than the band at full stretch, so the body is shown without it.');
    expect(notDrawnNote(fit, '10')).toBeNull();
  });
  it('a men’s tee: the chest; a men’s chino: the waist', () => {
    const tee = computeFit(SYNTHETIC_MENS_TEE, { measurements: { bust: 123, waist: 111, hip: 114.5 } });
    expect(notDrawnSentence(notDrawnNote(tee, 'S')!, 'S', 'men', 'metric')).toBe('Size S is not drawn: the size advice says it does not close at the chest, where your body is 25.0 cm larger than the garment, more than its fabric gives, so the body is shown without it.');
    const chino = computeFit(SYNTHETIC_MENS_CHINO_WL, { measurements: { bust: 123, waist: 111, hip: 114.5, thigh: 68, inseam: 81 }, heightCm: 179 });
    const row = chino.perSize.find((s) => wearBlock(chino, s.size))!;
    expect(notDrawnSentence(notDrawnNote(chino, row.size)!, row.size, 'men', 'metric')).toMatch(new RegExp(`^Size ${row.size} is not drawn: the size advice says it does not close at the waist, where your body is [\\d.]+ cm larger than the garment`));
  });
  it('a viewer that states only the anchor still gets a sentence (no number is invented)', () => {
    expect(notDrawnSentence(notDrawnFromViewer({ anchor: 'hip', reason: 'pull-on' })!, 'XL', undefined, 'metric')).toBe('Size XL is not drawn: the size advice says its waistband does not stretch over your hips, so the body is shown without it.');
    expect(notDrawnSentence(notDrawnFromViewer({ anchor: 'chest', bodyLargerCm: 25 })!, 'S', 'men', 'metric')).toContain('does not close at the chest, where your body is 25.0 cm larger');
    expect(notDrawnFromViewer(null)).toBeNull();
  });
});

describe('the 2D figure follows the same rule', () => {
  const fit = computeFit(DRESS, { measurements: AU16 });
  it('draws the body alone for a size the size advice blocks, and says so in its name', () => {
    const r = render(<AvatarView garment={DRESS} fit={fit} size="12" measurements={AU16} />);
    const svg = r.container.querySelector('svg[role="img"]')!;
    expect(r.queryByTestId('garment-layer')).toBeNull();
    expect(r.queryByTestId('strain')).toBeNull();
    expect(svg).toHaveAttribute('data-garment', 'not-drawn');
    expect(svg).toHaveAttribute('data-not-drawn-at', 'bust');
    expect(svg.getAttribute('aria-label')).toBe('The body alone, a body drawn from your measurements: Woven babydoll dress in size 12 is not drawn, because the size advice says it does not go on at the bust (estimate)');
  });
  it('draws the garment for the size that fits, for one that is tight with room left and for one that is loose (as before)', () => {
    for (const size of ['14', '16']) {
      const r = render(<AvatarView garment={DRESS} fit={fit} size={size} measurements={AU16} />);
      expect(r.getByTestId('garment-layer')).toBeInTheDocument();
      expect(r.container.querySelector('svg[role="img"]')).not.toHaveAttribute('data-garment');
      expect(r.container.querySelector('svg[role="img"]')!.getAttribute('aria-label')).toContain(`Estimated look of Woven babydoll dress in size ${size}`);
      cleanup();
    }
    const small = computeFit(DRESS, { measurements: { bust: 85, waist: 67.5, hip: 94 } });
    expect(render(<AvatarView garment={DRESS} fit={small} size="16" measurements={{ bust: 85, waist: 67.5, hip: 94 }} />).getByTestId('garment-layer')).toBeInTheDocument();
  });
  it('without a fit result the garment is drawn (the figure never decides a fit)', () => {
    expect(render(<AvatarView garment={DRESS} fit={null} size="8" measurements={AU16} />).getByTestId('garment-layer')).toBeInTheDocument();
  });

  it('the result screen: the figure, the sentence under it and the size rings agree, and picking a size that fits brings the dress back', () => {
    const profile = profileFromAbout({ ...EMPTY_ABOUT, height: '168', weight: '80', bust: '105', waist: '87.5', hip: '114', knowsMeasurements: true }, 'dress');
    const embedFit = fitForProfile(DRESS, profile);
    const advice = adviseSize(embedFit.fit, 'regular');
    expect(advice.size).toBe('16');
    const base = { garment: DRESS, profile, embedFit, advice, preference: 'regular' as const, onSelect: () => {}, onChoose: () => {}, onEdit: () => {}, returning: false, chooseFallback: null, chosen: null, currentVariantSize: null, units: 'metric' as const, onUnits: () => {}, onPreference: () => {}, privacyPolicyUrl: '/privacy' };
    const r = render(<ResultScreen {...base} selected="12" />);
    const note = screen.getByTestId('figure-not-drawn');
    expect(note).toHaveAttribute('data-anchor', 'chest');
    expect(note).toHaveTextContent('Size 12 is not drawn: the size advice says it does not close at the bust, where your body is 3.0 cm larger than the garment, more than its fabric gives, so the body is shown without it.');
    expect(screen.queryByTestId('garment-layer')).toBeNull();
    // The rings of the size are still there, with the engine's own word at the bust.
    expect(screen.getByTestId('size-rings-legend')).toBeInTheDocument();
    expect(document.body).toHaveTextContent(/Tight/);
    r.rerender(<ResultScreen {...base} selected="16" />);
    expect(screen.queryByTestId('figure-not-drawn')).toBeNull();
    expect(screen.getByTestId('garment-layer')).toBeInTheDocument();
  });

  it('on a phone the sentence rides above the "Choose size" bar, and the figure\'s estimate label above the sentence (OI-105)', () => {
    // jsdom lays nothing out: the heights are given, the real thing is e2e/phoneResult.spec.ts.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const height = this.dataset.testid === 'choose-bar' ? 91.2 : this.dataset.testid === 'figure-not-drawn' ? 74.5 : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height, toJSON: () => ({}) };
    });
    try {
      const profile = profileFromAbout({ ...EMPTY_ABOUT, height: '168', weight: '80', bust: '105', waist: '87.5', hip: '114', knowsMeasurements: true }, 'dress');
      const embedFit = fitForProfile(DRESS, profile);
      const base = { garment: DRESS, profile, embedFit, advice: adviseSize(embedFit.fit, 'regular'), preference: 'regular' as const, onSelect: () => {}, onChoose: () => {}, onEdit: () => {}, returning: false, chooseFallback: null, chosen: null, currentVariantSize: null, units: 'metric' as const, onUnits: () => {}, onPreference: () => {}, privacyPolicyUrl: '/privacy' };
      const r = render(<ResultScreen {...base} selected="12" />);
      const result = screen.getByTestId('embed-result');
      const note = screen.getByTestId('figure-not-drawn');
      // the bar's height is on the result for the sentence, which sticks just above it, under the bar and the label in the stack
      expect(result.style.getPropertyValue('--bar-clear')).toBe('92px');
      expect(note.className).toMatch(/\bsticky\b/);
      expect(note.style.bottom).toBe('calc(var(--bar-clear, 0px) + 4px)');
      expect(note.className).toMatch(/\bz-\[5\]/);
      expect(note.className).toMatch(/\bbg-cream\b/); // it lies over the picture while it rides
      // the label's clearance round this figure is the bar, the sentence and the gap between them
      const frame = result.querySelector('.mirror-frame')!;
      expect((frame.parentElement as HTMLElement).style.getPropertyValue('--estimate-clear')).toBe('171px');
      expect(result.style.getPropertyValue('--estimate-clear')).toBe('92px');
      // a size that is drawn: no sentence, the label clears the bar alone
      r.rerender(<ResultScreen {...base} selected="16" />);
      expect((result.querySelector('.mirror-frame')!.parentElement as HTMLElement).style.getPropertyValue('--estimate-clear')).toBe('');
    } finally {
      rect.mockRestore();
    }
  });
});

describe('the 3D view says it from the embed’s own fit result, whatever the viewer reports', () => {
  const fit = computeFit(DRESS, { measurements: AU16 });
  const asset: GarmentAssetRef = { version: '0123456789abcdef', baseUrl: 'https://api.curtain.test/assets/s/p/0123456789abcdef', baseSize: '12', sizes: DRESS.sizeChart.map((r) => r.size), label: 'estimate' };
  it('a dress draped on the device, two sizes too small: the sentence under the view; the size that fits says nothing', async () => {
    const mountGarmentView = vi.fn(async (_c: HTMLCanvasElement, opts: { onState?: (s: string) => void }) => {
      opts.onState?.('settled');
      return { setSize: () => true, dispose: () => {}, sizes: asset.sizes, source: { kind: 'device', notDrawn: {} } };
    });
    const props = { asset, paused: false, garment: DRESS, fit, recommended: '16', measurements: AU16, onSelect: () => {}, loadViewer: vi.fn(async () => ({ mountGarmentView }) as never), webgl2: () => true };
    const r = render(<Garment3D {...props} size="12" />);
    fireEvent.click(screen.getByTestId('garment3d-open'));
    const note = await screen.findByTestId('garment3d-not-drawn');
    expect(note).toHaveAttribute('data-anchor', 'chest');
    expect(note).toHaveAttribute('data-reason', 'tight');
    expect(note).toHaveTextContent('Size 12 is not drawn: the size advice says it does not close at the bust, where your body is 3.0 cm larger than the garment, more than its fabric gives, so the body is shown without it.');
    // The viewer got the embed's own fit result: it hides the size by the same reading.
    expect((mountGarmentView.mock.calls[0]![1] as unknown as { fit: unknown }).fit).toBe(fit);
    // OI-105: it rides above the "Choose size" bar while its place under the view is out of sight
    expect(note.className).toMatch(/\bsticky\b/);
    expect(note.style.bottom).toContain('var(--bar-clear');
    r.rerender(<Garment3D {...props} size="14" />);
    expect(screen.queryByTestId('garment3d-not-drawn')).toBeNull();
    r.rerender(<Garment3D {...props} size="16" />);
    expect(screen.queryByTestId('garment3d-not-drawn')).toBeNull();
  });
});
