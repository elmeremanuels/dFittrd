// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MOCK_GARMENTS_BY_ID, SYNTHETIC_MENS_TEE, type GarmentAssetRef } from '@curtain/schema';
import { Garment3D, type Garment3DProps } from '../Garment3D';

afterEach(cleanup);

const garment = MOCK_GARMENTS_BY_ID['aalter-studio-2']!;
const measurements = { bust: 90, waist: 72, hip: 98 };
const fit = computeFit(garment, { measurements });
const asset: GarmentAssetRef = { version: '0123456789abcdef', baseUrl: 'https://api.curtain.test/assets/s/p/0123456789abcdef', baseSize: 'M', sizes: garment.sizeChart.map((r) => r.size), label: 'estimate' };

function setup(over: Partial<Garment3DProps> = {}) {
  const setSize = vi.fn(() => true);
  const dispose = vi.fn();
  const mountGarmentView = vi.fn(async (_canvas: HTMLCanvasElement, opts: { onState?: (s: string) => void }) => {
    opts.onState?.('settled');
    return { setSize, dispose, sizes: asset.sizes };
  });
  const loadViewer = vi.fn(async () => ({ mountGarmentView }) as never);
  const onSelect = vi.fn();
  const props: Garment3DProps = { asset, paused: false, garment, fit, size: 'M', recommended: 'M', measurements, onSelect, loadViewer, webgl2: () => true, ...over };
  const r = render(<Garment3D {...props} />);
  return { ...r, props, loadViewer, mountGarmentView, setSize, dispose, onSelect };
}

describe('Garment3D (opt-in 3D estimate, D16)', () => {
  it('the ring summary follows the shopper\'s units and marks estimated girths', async () => {
    setup({ units: 'imperial', estimated: ['bust'] });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    const rings = await screen.findByTestId('garment3d-rings');
    expect(rings).toHaveTextContent(/about [\d.]+ in (room|short)/);
    expect(rings).not.toHaveTextContent(/ cm /);
    expect(screen.queryByTestId('garment3d-hem-note')).toBeNull(); // no hem input for this product
  });

  it('a W/L result whose leg was not checked names the waist under the 3D view, never "No size fits well"', async () => {
    setup({ recommended: null, waistOnly: '34' });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    expect(await screen.findByTestId('garment3d-label')).toHaveTextContent('The size advice picked waist 34; the leg length was not checked. You are looking at size');
    expect(screen.getByTestId('garment3d-label')).not.toHaveTextContent('No size fits well');
    cleanup();
    setup({ recommended: null });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    expect(await screen.findByTestId('garment3d-label')).toHaveTextContent('No size fits well; the size advice decides, not this picture.');
  });

  it('a server drape bake says where the shopper lies, and names the band when that is why a size is not drawn', async () => {
    const source = {
      kind: 'bake',
      plainColour: true,
      sizes: {
        S: { provenance: 'measured', place: 'refused', refusedHipCm: 114, refusedRule: 'pull-on', adviceBlocked: false },
        M: { provenance: 'interpolated', place: 'between', refusedHipCm: 114, refusedRule: null, adviceBlocked: false },
        L: { provenance: 'extrapolated', place: 'held', refusedHipCm: null, refusedRule: null, adviceBlocked: false },
        XL: { provenance: 'measured', place: 'between', refusedHipCm: 114, refusedRule: 'pull-on', adviceBlocked: true },
      },
    };
    const mountGarmentView = vi.fn(async (_c: HTMLCanvasElement, opts: { onState?: (s: string) => void }) => {
      opts.onState?.('settled');
      return { setSize: () => true, dispose: () => {}, sizes: asset.sizes, source };
    });
    const loadViewer = vi.fn(async () => ({ mountGarmentView }) as never);
    const r = setup({ loadViewer, size: 'S' });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    const note = await screen.findByTestId('garment3d-bake-note');
    expect(note).toHaveAttribute('data-place', 'refused');
    expect(note).toHaveTextContent('Shown in one plain colour; the print is not drawn. Size S is built from the shop’s tape. Size S is not drawn: its band does not stretch over the model with 114.0 cm hips, and yours are at least that.');
    expect(note).not.toHaveTextContent('simulation');
    r.rerender(<Garment3D {...r.props} size="M" />);
    expect(screen.getByTestId('garment3d-bake-note')).toHaveTextContent('Size M is not on the shop’s tape; it is interpolated from the sizes that are. Your hips are past the largest body size M was draped on, so it is shown on that body; size M was not draped on a body with 114.0 cm hips.');
    r.rerender(<Garment3D {...r.props} size="L" units="imperial" />);
    expect(screen.getByTestId('garment3d-bake-note')).toHaveTextContent('Your hips are outside the bodies size L was draped on, so it is shown on the nearest one.');
    expect(screen.getByTestId('garment3d-bake-note')).toHaveTextContent('In 3D the sizes look much alike');
    // The size advice blocks XL at the shopper's hip: not drawn, whatever its place against the bake's bodies.
    r.rerender(<Garment3D {...r.props} size="XL" />);
    const xl = screen.getByTestId('garment3d-bake-note');
    expect(xl).toHaveAttribute('data-advice-blocked', 'true');
    expect(xl).toHaveAttribute('data-reason', 'pull-on');
    expect(xl).toHaveTextContent('Size XL is not drawn: the size advice says its waistband does not stretch over your hips, so the body is shown without it.');
    expect(xl).not.toHaveTextContent('shown on that body');
    // The sentence is a line of its own in the note, so it can ride above the "Choose size" bar on a phone (OI-105).
    const line = within(xl).getByTestId('garment3d-bake-not-drawn');
    expect(line).toHaveTextContent(/^Size XL is not drawn: .* so the body is shown without it\.$/);
    expect(line.className).toMatch(/\bsticky\b/);
    // The note makes no box of its own, or the sticky line could not leave it (seen in e2e/phoneResult.spec.ts).
    expect(xl.className).toMatch(/\bcontents\b/);
    expect(xl).toHaveTextContent('In 3D the sizes look much alike');
  });

  it('a size too small for the body (a sewn tee on the device) says it is not drawn and why; a size that fits says nothing', async () => {
    const source = { kind: 'device', notDrawn: { S: { anchor: 'chest', bodyLargerCm: 25 } } };
    const mountGarmentView = vi.fn(async (_c: HTMLCanvasElement, opts: { onState?: (s: string) => void }) => {
      opts.onState?.('settled');
      return { setSize: () => true, dispose: () => {}, sizes: asset.sizes, source };
    });
    const r = setup({ loadViewer: vi.fn(async () => ({ mountGarmentView }) as never), size: 'S' });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    const note = await screen.findByTestId('garment3d-not-drawn');
    expect(note).toHaveAttribute('data-anchor', 'chest');
    expect(note).toHaveTextContent('Size S is not drawn: the size advice says it does not close at the bust, where your body is 25.0 cm larger than the garment, more than its fabric gives, so the body is shown without it.');
    r.rerender(<Garment3D {...r.props} size="M" />);
    expect(screen.queryByTestId('garment3d-not-drawn')).toBeNull();
    expect(screen.queryByTestId('garment3d-bake-note')).toBeNull();
  });

  it('renders nothing without an asset (a product without a bundle behaves exactly as today)', () => {
    const { container, loadViewer } = setup({ asset: null });
    expect(container).toBeEmptyDOMElement();
    expect(loadViewer).not.toHaveBeenCalled();
  });

  it('is hidden without WebGL2 and for a paused shop', () => {
    expect(setup({ webgl2: () => false }).container).toBeEmptyDOMElement();
    cleanup();
    expect(setup({ paused: true }).container).toBeEmptyDOMElement();
  });

  it('imports and fetches nothing before the click', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { loadViewer } = setup();
    expect(screen.getByTestId('garment3d-open')).toHaveTextContent('See it in 3D (estimate)');
    expect(loadViewer).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('after the click mounts the viewer with the embed fit and size (never a fit of its own) and only the asset URL', async () => {
    const { loadViewer, mountGarmentView } = setup();
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(mountGarmentView).toHaveBeenCalledTimes(1));
    expect(loadViewer).toHaveBeenCalledTimes(1);
    const opts = mountGarmentView.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(opts.fit).toBe(fit);
    expect(opts.size).toBe('M');
    expect(opts.baseUrl).toBe(asset.baseUrl);
    // The three girths and nothing else, as before the avatar slices (this is a women's garment).
    expect(opts.body).toEqual(measurements);
    expect(Object.keys(opts).sort()).toEqual(['baseUrl', 'body', 'fit', 'garment', 'look', 'onState', 'size']);
  });

  it('a men’s garment (the SYNTHETIC test tee, slice M1) mounts on the male body with the typed height; women’s and unisex do not', async () => {
    const menFit = computeFit(SYNTHETIC_MENS_TEE, { measurements: { bust: 98, waist: 86, hip: 96 } });
    const { mountGarmentView } = setup({ garment: SYNTHETIC_MENS_TEE, fit: menFit, measurements: { bust: 98, waist: 86, hip: 96 }, heightCm: 174, asset: { ...asset, sizes: ['S', 'M', 'L', 'XL', 'XXL'] } });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(mountGarmentView).toHaveBeenCalledTimes(1));
    expect((mountGarmentView.mock.calls[0]![1] as unknown as { body: unknown }).body).toEqual({ bust: 98, waist: 86, hip: 96, family: 'male', heightCm: 174 });
    cleanup();
    const unisex = setup({ garment: { ...garment, audience: 'unisex' }, heightCm: 168 });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(unisex.mountGarmentView).toHaveBeenCalledTimes(1));
    expect((unisex.mountGarmentView.mock.calls[0]![1] as unknown as { body: unknown }).body).toEqual(measurements);
  });

  it('is labelled an estimate and names the size the advice picked', async () => {
    setup({ size: 'L', recommended: 'M' });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    const label = await screen.findByTestId('garment3d-label');
    expect(label).toHaveTextContent(/estimate/i);
    expect(label).toHaveTextContent('Size M was picked by the size advice.');
    expect(label).toHaveTextContent('You are looking at size L.');
    // the same size-ring numbers as the 2D figure, as text (route R5)
    expect(screen.getByTestId('garment3d-rings')).toHaveAccessibleName('Size rings of size L (estimate)');
    expect(screen.getByTestId('garment3d-rings')).toHaveTextContent(/Bust/);
    expect(screen.getByTestId('garment3d-rings')).toHaveTextContent(/\d cm (room|short)/);
    expect(screen.getByText(/Estimate · not measured/)).toBeInTheDocument();
  });

  it('names the rings of a men\'s garment as menswear does: "Chest", never "Bust" (OI-104)', async () => {
    const tee = SYNTHETIC_MENS_TEE;
    const body = { bust: 98, waist: 86, hip: 96 };
    setup({ garment: tee, fit: computeFit(tee, { measurements: body }), measurements: body, size: 'M', recommended: 'M', asset: { ...asset, sizes: tee.sizeChart.map((r) => r.size) } });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    const rings = await screen.findByTestId('garment3d-rings');
    const names = within(rings).getAllByRole('listitem').map((li) => li.querySelector('span')?.textContent);
    expect(names).toContain('Chest');
    expect(names).not.toContain('Bust');
    expect(names).not.toContain('Hips');
    expect(rings).not.toHaveTextContent(/bust/i);
  });

  it('keeps the size switcher in sync with the result screen', async () => {
    const { rerender, props, setSize, onSelect, mountGarmentView } = setup();
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(mountGarmentView).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('radio', { name: 'L' }));
    expect(onSelect).toHaveBeenCalledWith('L');
    await act(async () => rerender(<Garment3D {...props} size="L" />));
    expect(setSize).toHaveBeenCalledWith('L');
  });

  it('falls back to a note when the viewer fails (the 2D figure stays)', async () => {
    setup({ loadViewer: async () => ({ mountGarmentView: async () => Promise.reject(new Error('unsupported')) }) as never });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    expect(await screen.findByTestId('garment3d-failed')).toHaveTextContent('isn’t available on this device');
    expect(screen.queryByRole('radiogroup', { name: 'Size in 3D' })).toBeNull();
  });

  describe('required view (men\'s gate, D20 point 3): a view that never settles counts as failed', () => {
    it('the viewer chunk never arrives: failed after the time limit', async () => {
      const onRequiredState = vi.fn();
      setup({ required: true, onRequiredState, requiredTimeoutMs: 30, loadViewer: vi.fn(() => new Promise<never>(() => {})) });
      expect(onRequiredState).not.toHaveBeenCalled();
      await waitFor(() => expect(onRequiredState).toHaveBeenCalledWith('failed'));
      expect(onRequiredState).not.toHaveBeenCalledWith('settled');
    });

    it('the viewer never reports settled, then reports it too late: failed, and it stays failed', async () => {
      const onRequiredState = vi.fn();
      let late: (s: string) => void = () => {};
      const mountGarmentView = vi.fn(async (_canvas: HTMLCanvasElement, opts: { onState?: (s: string) => void }) => {
        opts.onState?.('draping');
        late = (s) => opts.onState?.(s);
        return { setSize: vi.fn(() => true), dispose: vi.fn(), sizes: asset.sizes };
      });
      setup({ required: true, onRequiredState, requiredTimeoutMs: 30, loadViewer: vi.fn(async () => ({ mountGarmentView }) as never) });
      await waitFor(() => expect(onRequiredState).toHaveBeenCalledWith('failed'));
      act(() => late('settled'));
      expect(onRequiredState).not.toHaveBeenCalledWith('settled');
    });

    it('a view that settles in time is not failed by the timer afterwards', async () => {
      const onRequiredState = vi.fn();
      setup({ required: true, onRequiredState, requiredTimeoutMs: 30 });
      await waitFor(() => expect(onRequiredState).toHaveBeenCalledWith('settled'));
      await new Promise((r) => setTimeout(r, 60));
      expect(onRequiredState).not.toHaveBeenCalledWith('failed');
    });

    it('an opt-in view (not required) has no time limit', async () => {
      setup({ requiredTimeoutMs: 20, loadViewer: vi.fn(() => new Promise<never>(() => {})) });
      fireEvent.click(screen.getByTestId('garment3d-open'));
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByTestId('garment3d-failed')).toBeNull();
      expect(screen.getByTestId('garment3d-canvas')).toBeInTheDocument();
    });
  });
});
