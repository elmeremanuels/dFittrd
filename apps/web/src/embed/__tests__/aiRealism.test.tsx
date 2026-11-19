// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { AI_ENHANCED_LABEL, ESTIMATE_DISCLAIMER, MOCK_GARMENTS_BY_ID, RealismRequestSchema, type GarmentAssetRef, type RealismRequest, type RealismResponse } from '@curtain/schema';
import { AiRealismPanel } from '../AiRealism';
import { Garment3D } from '../Garment3D';
import { realismRequest, type ExportedPasses } from '../realism';

afterEach(cleanup);

const img = (w = 256, h = 384) => ({ width: w, height: h, data: new Uint8Array(w * h * 4) });
const passes: ExportedPasses = {
  kind: 'renderPasses',
  width: 256,
  height: 384,
  size: 'M',
  colour: img(),
  depth: img(),
  normal: img(),
  garmentMask: img(),
  figureMask: img(),
  neighbour: { size: 'L', garmentMask: img() },
  meta: { statureCm: 168, waistRow: 140, hipRow: 190, backdropHex: '#f5efe7', garmentHex: '#1f4e79' },
};
const encode = () => 'iVBORw0KGgoAAAANSUhEUg==';
const ids = { productId: 'p1', shopId: '00000000-0000-4000-8000-000000000001' };
const metrics = { silhouetteIoU: 0.97, garmentIoU: 0.93, colourDeltaE00: 1.2, hemShiftCm: 0.3, waistShiftCm: 0.4, waistWidthDeltaCm: 0.2, hipWidthDeltaCm: 0.3, sizeSeparation: { neighbour: 'L', visible: true, ok: true } };
const ok: RealismResponse = { status: 'ok', mimeType: 'image/png', imageBase64: 'iVBORw0KGgoAAAANSUhEUg==', width: 256, height: 384, label: AI_ENHANCED_LABEL, disclaimer: ESTIMATE_DISCLAIMER, provider: 'fake-realism', model: 'fake-realism-v0', metrics };

describe('the realism request carries the render passes only', () => {
  it('matches the strict wire schema and has no photo, face or measurement field', () => {
    const req = realismRequest(passes, ids, encode);
    expect(RealismRequestSchema.safeParse(req).success).toBe(true);
    const keys = JSON.stringify(Object.keys(req)) + JSON.stringify(Object.keys(req.passes));
    expect(keys).not.toMatch(/photo|face|person|measure|bust|waistCm|hipCm|image/i);
    expect(req.passes.kind).toBe('renderPasses');
  });
});

describe('AiRealismPanel: always labelled an AI-enhanced estimate', () => {
  it('shows the label before, during and after, and the picture only after consent', async () => {
    const request = vi.fn(async () => ok);
    render(<AiRealismPanel garmentName="Wrap dress" size="M" ids={ids} exportPasses={() => passes} request={request} encode={encode} />);
    expect(screen.getAllByTestId('ai-estimate-label')[0]).toHaveTextContent('AI-enhanced estimate');
    expect(screen.getByTestId('ai-realism-start')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ai-realism-consent'));
    fireEvent.click(screen.getByTestId('ai-realism-start'));
    const pic = await screen.findByTestId('ai-realism-image');
    expect(pic).toHaveAttribute('alt', expect.stringMatching(/AI-enhanced estimate/));
    // One label in the header, one on the picture; the caption carries the estimate disclaimer.
    expect(screen.getAllByTestId('ai-estimate-label')).toHaveLength(2);
    expect(screen.getByTestId('ai-realism')).toHaveTextContent(ESTIMATE_DISCLAIMER);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('says why a picture was refused, still labelled, and shows no picture', async () => {
    const request = vi.fn(async (): Promise<RealismResponse> => ({ status: 'refused', reasons: ['hem', 'colour'], label: AI_ENHANCED_LABEL, disclaimer: ESTIMATE_DISCLAIMER, metrics }));
    render(<AiRealismPanel garmentName="Wrap dress" size="M" ids={ids} exportPasses={() => passes} request={request} encode={encode} />);
    fireEvent.click(screen.getByTestId('ai-realism-consent'));
    fireEvent.click(screen.getByTestId('ai-realism-start'));
    const refused = await screen.findByTestId('ai-realism-refused');
    expect(refused).toHaveTextContent('The length moved. The colour changed.');
    expect(screen.queryByTestId('ai-realism-image')).toBeNull();
    expect(screen.getByTestId('ai-estimate-label')).toBeInTheDocument();
  });
});

describe('Garment3D shows the panel only with the flag', () => {
  const garment = MOCK_GARMENTS_BY_ID['aalter-studio-2']!;
  const measurements = { bust: 90, waist: 72, hip: 98 };
  const fit = computeFit(garment, { measurements });
  const asset: GarmentAssetRef = { version: '0123456789abcdef', baseUrl: 'https://api.curtain.test/assets/s/p/0123456789abcdef', baseSize: 'M', sizes: garment.sizeChart.map((r) => r.size), label: 'estimate' };
  const viewer = (exportPasses = vi.fn(() => passes)) => ({
    exportPasses,
    loadViewer: vi.fn(async () => ({ mountGarmentView: async (_c: HTMLCanvasElement, o: { onState?: (s: string) => void }) => (o.onState?.('settled'), { setSize: () => true, dispose: () => {}, sizes: asset.sizes, exportPasses }) }) as never),
  });

  it('off (no aiRealism): no panel', async () => {
    const v = viewer();
    render(<Garment3D asset={asset} paused={false} garment={garment} fit={fit} size="M" recommended="M" measurements={measurements} onSelect={() => {}} loadViewer={v.loadViewer} webgl2={() => true} />);
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await screen.findByTestId('garment3d-label');
    await waitFor(() => expect(v.loadViewer).toHaveBeenCalled());
    expect(screen.queryByTestId('ai-realism')).toBeNull();
    expect(v.exportPasses).not.toHaveBeenCalled();
  });

  it('on: the panel sits with the 3D view and sends the exported passes', async () => {
    const v = viewer();
    const request = vi.fn(async (_req: RealismRequest) => ok);
    render(<Garment3D asset={asset} paused={false} garment={garment} fit={fit} size="M" recommended="M" measurements={measurements} onSelect={() => {}} loadViewer={v.loadViewer} webgl2={() => true} aiRealism={{ garmentName: garment.name, ids, request, encode }} />);
    fireEvent.click(screen.getByTestId('garment3d-open'));
    const panel = await screen.findByTestId('ai-realism');
    expect(screen.getByTestId('garment3d')).toContainElement(panel);
    fireEvent.click(screen.getByTestId('ai-realism-consent'));
    fireEvent.click(screen.getByTestId('ai-realism-start'));
    await screen.findByTestId('ai-realism-image');
    expect(v.exportPasses).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0]).toMatchObject({ size: 'M', passes: { kind: 'renderPasses' } });
  });
});
