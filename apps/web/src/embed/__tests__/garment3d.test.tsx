// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MOCK_GARMENTS_BY_ID, type GarmentAssetRef } from '@curtain/schema';
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
    expect(opts.body).toEqual(measurements);
    expect(Object.keys(opts).sort()).toEqual(['baseUrl', 'body', 'fit', 'garment', 'onState', 'size']);
  });

  it('is labelled an estimate and names the size the advice picked', async () => {
    setup({ size: 'L', recommended: 'M' });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    const label = await screen.findByTestId('garment3d-label');
    expect(label).toHaveTextContent(/estimate/i);
    expect(label).toHaveTextContent('Size M was picked by the size advice.');
    expect(label).toHaveTextContent('You are looking at size L.');
    expect(screen.getByText(/Estimate · not measured/)).toBeInTheDocument();
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
  });
});
