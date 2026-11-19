// @vitest-environment jsdom
/**
 * Skin shading `skin-v2` (D22 point 3, branch claude/skin-v2): the 2D figure's shades
 * (`render/skin2d.ts`), the opt-in prop on `AvatarView`, and the build flag that sends `shading`
 * to the 3D viewer. The default stays the flat figure (pinned byte for byte by
 * femaleFigureGolden.test.tsx) and no `shading` reaches the viewer.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MOCK_GARMENTS_BY_ID, type GarmentAssetRef } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { contrastRatio, faceInk } from '@/render/face';
import { lightness, linearRgb, skin2d, skin2dShadingOf } from '@/render/skin2d';
import { Garment3D, type Garment3DProps } from '../Garment3D';
import { avatarSkinFlag, lookForMonk, MONK_CLASSES } from '../look';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
afterEach(cleanup);

const garment = MOCK_GARMENTS_BY_ID['aalter-studio-2']!;
const measurements = { bust: 90, waist: 72, hip: 98 };
const fit = computeFit(garment, { measurements });
const swatches = MONK_CLASSES.map((n) => lookForMonk(n)!.hex);
/** Chromaticity of a colour in linear light (r, g over the sum): the hue that shading must keep. */
const chroma = (hex: string): [number, number] => {
  const [r, g, b] = linearRgb(hex);
  const s = r + g + b || 1;
  return [r / s, g / s];
};

describe('2D skin-v2 shades', () => {
  it('every shade is the swatch multiplied in linear light: the lit stop is the swatch, the others darker, never clipped or greyed', () => {
    for (const hex of swatches) {
      const v = skin2d(hex);
      expect(v.lit.toUpperCase(), hex).toBe(hex.toUpperCase());
      expect(lightness(v.mid)).toBeLessThan(lightness(v.lit));
      expect(lightness(v.shadow)).toBeLessThan(lightness(v.mid));
      expect(lightness(v.side)).toBeLessThan(lightness(v.shadow));
      // The flat figure's lightest stop clipped a channel of Monk 1 to 3 at 255; no skin-v2 stop does.
      for (const c of [v.lit, v.mid, v.shadow, v.side]) expect(Math.max(...linearRgb(c)), `${hex} ${c}`).toBeLessThanOrEqual(linearRgb(hex).reduce((a, b) => Math.max(a, b)) + 1e-9);
    }
  });

  it('the shadow is warmer than the swatch (red kept more): the warm terminator, on every tone', () => {
    for (const hex of swatches) {
      const v = skin2d(hex);
      // Monk 10's 8-bit channels are close to the floor, so its shadow's chromaticity moves least.
      expect(chroma(v.shadow)[0], hex).toBeGreaterThan(chroma(hex)[0] + 0.004);
      // The middle shade keeps the hue within a small warm step (it is a little redder than the swatch, never greener).
      expect(chroma(v.mid)[0] - chroma(hex)[0], hex).toBeGreaterThanOrEqual(0);
      expect(chroma(v.mid)[0] - chroma(hex)[0], hex).toBeLessThan(0.02);
    }
  });

  it('the outline stands out 3.2:1 from the mirror backdrop on every tone and is never lighter than the figure edge', () => {
    for (const hex of swatches) {
      const v = skin2d(hex);
      expect(contrastRatio(v.outline, '#F1ECE6'), hex).toBeGreaterThanOrEqual(3.2);
      expect(lightness(v.outline), hex).toBeLessThan(lightness(v.shadow));
    }
  });

  it('the face ink still reaches 3:1 over the skin-v2 head (lit to shadow) on all ten swatches', () => {
    for (const hex of swatches) {
      const v = skin2d(hex);
      const ink = faceInk(hex, v.head);
      for (const c of [v.lit, v.mid, v.head, v.shadow]) expect(contrastRatio(ink, c), `${hex} on ${c}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the sheen is faint on light tones and stronger on deep ones', () => {
    expect(skin2d(swatches[0]!).sheen).toBeLessThanOrEqual(0.06);
    expect(skin2d(swatches[9]!).sheen).toBeGreaterThan(skin2d(swatches[0]!).sheen);
    expect(skin2d(swatches[9]!).sheen).toBeLessThanOrEqual(0.15 + 1e-9);
  });

  it('only the name skin-v2 switches it on', () => {
    expect(skin2dShadingOf('skin-v2')).toBe('skin-v2');
    for (const v of [undefined, null, '', 'v2', 'SKIN-V2', 'flat']) expect(skin2dShadingOf(v)).toBe('flat');
  });
});

describe('AvatarView skinShading', () => {
  it('default: the flat figure (two gradient stops, no skin-v2 mark)', () => {
    const r = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} heightCm={168} skinHex={swatches[5]!} />);
    expect(r.container.querySelector('svg')).not.toHaveAttribute('data-skin-shading');
    expect(r.container.querySelectorAll('[id$="skingrad"] stop')).toHaveLength(2);
  });

  it('skin-v2: three stops in the skin-v2 shades, its outline, and the face ink for its head', () => {
    for (const hex of swatches) {
      const v = skin2d(hex);
      const r = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} heightCm={168} skinHex={hex} skinShading="skin-v2" />);
      expect(r.container.querySelector('svg')).toHaveAttribute('data-skin-shading', 'skin-v2');
      expect(Array.from(r.container.querySelectorAll('[id$="skingrad"] stop')).map((s) => s.getAttribute('stop-color'))).toEqual([v.lit, v.mid, v.shadow]);
      expect(r.getByTestId('figure-body')).toHaveAttribute('data-outline', v.outline.toUpperCase());
      expect(r.getByTestId('neutral-face')).toHaveAttribute('stroke', faceInk(hex, v.head));
      r.unmount();
    }
  });

  it('the hero render person stays plain (no outline) with skin-v2 too', () => {
    const r = render(<AvatarView bare plain garment={garment} fit={fit} size="M" measurements={measurements} skinShading="skin-v2" />);
    expect(r.getByTestId('figure-body')).not.toHaveAttribute('stroke');
    expect(r.queryByTestId('neutral-face')).toBeNull();
  });
});

describe('the build flag VITE_AVATAR_SKIN and the 3D view', () => {
  it('is flat unless set to skin-v2 (and not set in this test run)', () => {
    expect(avatarSkinFlag({})).toBe('flat');
    for (const v of ['', 'v2', 'Skin-v2', 'flat']) expect(avatarSkinFlag({ VITE_AVATAR_SKIN: v })).toBe('flat');
    expect(avatarSkinFlag({ VITE_AVATAR_SKIN: 'skin-v2' })).toBe('skin-v2');
    expect(avatarSkinFlag()).toBe('flat');
  });

  const asset: GarmentAssetRef = { version: '0123456789abcdef', baseUrl: 'https://api.curtain.test/assets/s/p/0123456789abcdef', baseSize: 'M', sizes: garment.sizeChart.map((r) => r.size), label: 'estimate' };
  function setup(over: Partial<Garment3DProps> = {}) {
    const view = { setSize: vi.fn(() => true), dispose: vi.fn(), sizes: asset.sizes, setLook: vi.fn() };
    const mountGarmentView = vi.fn(async (_canvas: HTMLCanvasElement, opts: { onState?: (s: string) => void }) => {
      opts.onState?.('settled');
      return view;
    });
    const loadViewer = vi.fn(async () => ({ mountGarmentView }) as never);
    const props: Garment3DProps = { asset, paused: false, garment, fit, size: 'M', recommended: 'M', measurements, heightCm: 171, onSelect: vi.fn(), loadViewer, webgl2: () => true, ...over };
    render(<Garment3D {...props} />);
    return { mountGarmentView };
  }
  const lookOf = (m: ReturnType<typeof vi.fn>): unknown => (m.mock.calls[0]![1] as Record<string, unknown>).look;

  it('sends shading skin-v2 only when asked; by default the look has no shading', async () => {
    const hex = swatches[8]!;
    const a = setup({ skinHex: hex });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(a.mountGarmentView).toHaveBeenCalledTimes(1));
    expect(lookOf(a.mountGarmentView)).toEqual({ skinHex: hex, head: 'neutral-v3' });
    cleanup();
    const b = setup({ skinHex: hex, skinShading: 'skin-v2' });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(b.mountGarmentView).toHaveBeenCalledTimes(1));
    expect(lookOf(b.mountGarmentView)).toEqual({ skinHex: hex, head: 'neutral-v3', shading: 'skin-v2' });
  });
});
