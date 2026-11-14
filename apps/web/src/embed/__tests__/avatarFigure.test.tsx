// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MOCK_GARMENTS_BY_ID, type GarmentAssetRef } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { bodyGeometry } from '@/render/body';
import { contrastRatio, faceInk, neutralFace } from '@/render/face';
import { bodyFamilyFor, Garment3D, type Garment3DProps } from '../Garment3D';
import { assertNeutralPerson } from '../HeroRender';
import { lookForMonk, MONK_CLASSES, STANDARD_SKIN_HEX } from '../look';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
afterEach(cleanup);

const garment = MOCK_GARMENTS_BY_ID['aalter-studio-2']!;
const measurements = { bust: 90, waist: 72, hip: 98 };
const fit = computeFit(garment, { measurements });
const svgOf = (c: HTMLElement): SVGSVGElement => c.querySelector('svg')!;
const faceOf = (c: HTMLElement): string => c.querySelector('[data-testid="neutral-face"]')!.innerHTML;

describe('2D figure: skin colour and the neutral standard face (D19)', () => {
  it('takes the picked colour, and the standard colour without one or with a broken value', () => {
    const a = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} heightCm={168} />);
    expect(svgOf(a.container)).toHaveAttribute('data-skin', STANDARD_SKIN_HEX);
    a.unmount();
    for (const n of [1, 5, 10]) {
      const look = lookForMonk(n)!;
      const r = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} heightCm={168} skinHex={look.hex} />);
      expect(svgOf(r.container)).toHaveAttribute('data-skin', look.hex);
      // The body's gradient is built from that colour and nothing else.
      const stops = Array.from(r.container.querySelectorAll('[id$="skingrad"] stop')).map((s) => s.getAttribute('stop-color'));
      expect(stops).toHaveLength(2);
      for (const s of stops) expect(s).toMatch(/^#[0-9a-f]{6}$/);
      r.unmount();
    }
    const bad = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} skinHex="url(blob:x)" />);
    expect(svgOf(bad.container)).toHaveAttribute('data-skin', STANDARD_SKIN_HEX);
  });

  it('every figure has the neutral face: full size, without a garment, and the peek thumbnail', () => {
    const full = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} />);
    expect(full.getByTestId('neutral-face')).toBeInTheDocument();
    full.unmount();
    const bare = render(<AvatarView garment={null} fit={null} measurements={null} />);
    expect(bare.getByTestId('neutral-face')).toBeInTheDocument();
    bare.unmount();
    const peek = render(<AvatarView compact garment={garment} fit={fit} size="M" measurements={measurements} />);
    expect(peek.getByTestId('neutral-face')).toBeInTheDocument();
    expect(peek.getByTestId('estimate-badge')).toHaveTextContent('Estimate');
  });

  it('the face is one generic drawing: the same lines for every body shape and every colour, and no picture', () => {
    const slim = render(<AvatarView garment={null} fit={null} measurements={{ bust: 80, waist: 60, hip: 86 }} heightCm={168} />);
    const slimFace = faceOf(slim.container);
    expect(slim.container.querySelector('image')).toBeNull();
    slim.unmount();
    const curvy = render(<AvatarView garment={null} fit={null} measurements={{ bust: 120, waist: 105, hip: 128 }} heightCm={168} skinHex={lookForMonk(4)!.hex} />);
    expect(faceOf(curvy.container)).toBe(slimFace);
    expect(curvy.getByTestId('neutral-face')).toHaveAttribute('aria-hidden', 'true');
    // 2 eyes, 2 brows, a nose and a mouth: nothing else.
    expect(curvy.getByTestId('neutral-face').querySelectorAll('ellipse')).toHaveLength(2);
    expect(curvy.getByTestId('neutral-face').querySelectorAll('path')).toHaveLength(4);
  });

  it('the face stays inside the head and is left-right symmetric', () => {
    const body = bodyGeometry(null, 168);
    const face = neutralFace(body);
    const [l, r] = face.eyes;
    expect(l!.cx + r!.cx).toBeCloseTo(200, 5);
    expect(l!.cy).toBe(r!.cy);
    for (const e of face.eyes) expect(Math.abs(e.cx - 100) + e.rx).toBeLessThan(body.headR);
    const ys = [...face.brows, face.nose, face.mouth].flatMap((d) => Array.from(d.matchAll(/,(-?[\d.]+)/g)).map((m) => Number(m[1])));
    for (const y of ys) {
      expect(y).toBeGreaterThan(20);
      expect(y).toBeLessThan(20 + body.headRy * 2);
    }
  });

  it('the face ink is readable on all ten swatches (contrast of the lines against the skin at least 3:1)', () => {
    const contrast = contrastRatio;
    for (const n of MONK_CLASSES) {
      const hex = lookForMonk(n)!.hex;
      expect(contrast(faceInk(hex), hex), `Monk ${n}`).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(faceInk(STANDARD_SKIN_HEX), STANDARD_SKIN_HEX)).toBeGreaterThanOrEqual(3);
  });
});

describe('hero render input: only the neutral figure (plan §3, consent copy C29)', () => {
  const figure = (props: Partial<Parameters<typeof AvatarView>[0]> = {}): SVGSVGElement => svgOf(render(<AvatarView bare garment={garment} fit={fit} size="M" measurements={measurements} {...props} />).container);

  it('accepts the figure in the standard colour with the standard face', () => {
    expect(() => assertNeutralPerson(figure())).not.toThrow();
  });

  it('refuses a picked skin colour', () => {
    expect(() => assertNeutralPerson(figure({ skinHex: lookForMonk(8)!.hex }))).toThrow(/standard colour/);
  });

  it('refuses a face tile, a captured frame and any blob or data reference', () => {
    expect(() => assertNeutralPerson(figure({ media: { faceUrl: 'blob:https://app/1', baseFrame: null } }))).toThrow(/neutral figure/);
    expect(() => assertNeutralPerson(figure({ media: { faceUrl: null, baseFrame: { url: 'blob:https://app/2', width: 10, height: 10 } } }))).toThrow(/neutral figure/);
    const svg = figure();
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('fill', 'url(data:image/png;base64,AAAA)');
    svg.appendChild(rect);
    expect(() => assertNeutralPerson(svg)).toThrow(/neutral figure/);
  });
});

describe('3D view: the look and the body go to the viewer as in-memory options', () => {
  const asset: GarmentAssetRef = { version: '0123456789abcdef', baseUrl: 'https://api.curtain.test/assets/s/p/0123456789abcdef', baseSize: 'M', sizes: garment.sizeChart.map((r) => r.size), label: 'estimate' };

  function setup(over: Partial<Garment3DProps> = {}, withSetLook = true) {
    const setLook = vi.fn();
    const view = { setSize: vi.fn(() => true), dispose: vi.fn(), sizes: asset.sizes, ...(withSetLook ? { setLook } : {}) };
    const mountGarmentView = vi.fn(async (_canvas: HTMLCanvasElement, opts: { onState?: (s: string) => void }) => {
      opts.onState?.('settled');
      return view;
    });
    const loadViewer = vi.fn(async () => ({ mountGarmentView }) as never);
    const props: Garment3DProps = { asset, paused: false, garment, fit, size: 'M', recommended: 'M', measurements, heightCm: 171, onSelect: vi.fn(), loadViewer, webgl2: () => true, ...over };
    const r = render(<Garment3D {...props} />);
    return { ...r, props, mountGarmentView, setLook, view };
  }
  const mountOptions = (m: ReturnType<typeof vi.fn>): Record<string, unknown> => m.mock.calls[0]![1] as Record<string, unknown>;

  it('mounts with the picked colour, the body family and the height; no colour → no look option', async () => {
    const hex = lookForMonk(7)!.hex;
    const a = setup({ skinHex: hex });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(a.mountGarmentView).toHaveBeenCalledTimes(1));
    expect(mountOptions(a.mountGarmentView).look).toEqual({ skinHex: hex });
    expect(mountOptions(a.mountGarmentView).body).toEqual({ bust: 90, waist: 72, hip: 98, family: 'female', heightCm: 171 });
    expect(a.setLook).not.toHaveBeenCalled();
    cleanup();

    const b = setup({ heightCm: undefined });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(b.mountGarmentView).toHaveBeenCalledTimes(1));
    expect('look' in mountOptions(b.mountGarmentView)).toBe(false);
    expect(mountOptions(b.mountGarmentView).body).toEqual({ bust: 90, waist: 72, hip: 98, family: 'female' });
  });

  it('a new colour reaches the mounted view through setLook, without a remount', async () => {
    const a = setup({ skinHex: null });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(screen.getByTestId('garment3d-canvas')).toBeInTheDocument());
    await waitFor(() => expect(a.mountGarmentView).toHaveBeenCalledTimes(1));
    await act(async () => {});
    const hex = lookForMonk(3)!.hex;
    a.rerender(<Garment3D {...a.props} skinHex={hex} />);
    await waitFor(() => expect(a.setLook).toHaveBeenLastCalledWith({ skinHex: hex }));
    a.rerender(<Garment3D {...a.props} skinHex={null} />);
    await waitFor(() => expect(a.setLook).toHaveBeenLastCalledWith({ skinHex: undefined }));
    expect(a.mountGarmentView).toHaveBeenCalledTimes(1);
    expect(a.view.dispose).not.toHaveBeenCalled();
  });

  it('a viewer without setLook keeps working (the option is simply not used)', async () => {
    const a = setup({ skinHex: null }, false);
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(a.mountGarmentView).toHaveBeenCalledTimes(1));
    await act(async () => {});
    a.rerender(<Garment3D {...a.props} skinHex={lookForMonk(3)!.hex} />);
    await act(async () => {});
    expect(screen.queryByTestId('garment3d-failed')).toBeNull();
    expect(screen.getByTestId('garment3d-canvas')).toBeInTheDocument();
  });

  it('the body family follows the garment audience: men → male, everything else today\'s figure', () => {
    expect(bodyFamilyFor({ audience: 'men' })).toBe('male');
    expect(bodyFamilyFor({ audience: 'women' })).toBe('female');
    expect(bodyFamilyFor({ audience: 'unisex' })).toBe('female');
    expect(bodyFamilyFor({})).toBe('female');
  });
});
