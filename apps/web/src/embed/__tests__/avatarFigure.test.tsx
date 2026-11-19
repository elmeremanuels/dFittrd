// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MOCK_GARMENTS_BY_ID, type GarmentAssetRef } from '@curtain/schema';
import { AvatarView } from '@/components/AvatarView';
import { ESTIMATE_LABEL, ESTIMATE_LABEL_LINES } from '@/components/EstimateBadge';
import { bodyGeometry } from '@/render/body';
import { contrastRatio, drawnHeadColour, faceInk, figureOutline, neutralFace, SKIN_SHADE } from '@/render/face';
import { adjustColor } from '@/render/body';
import { bodyFamilyFor, Garment3D, viewerHeadFlag, viewerLightingFlag, type Garment3DProps } from '../Garment3D';
import { assertNeutralPerson } from '../HeroRender';
import { lookForMonk, MONK_CLASSES, STANDARD_SKIN_HEX } from '../look';
import { embedStrings } from '../strings';

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

  it('the face ink reaches 3:1 against the skin AS DRAWN (shaded, not the flat swatch), on all ten swatches', () => {
    // The figure is drawn between the gradient's light and dark stop, darkened a little more by the
    // side shading and the grain. The ink must hold over that whole range, not on the swatch only.
    for (const hex of [...MONK_CLASSES.map((n) => lookForMonk(n)!.hex), STANDARD_SKIN_HEX]) {
      const ink = faceInk(hex);
      expect(contrastRatio(ink, drawnHeadColour(hex)), `${hex} head`).toBeGreaterThanOrEqual(3.8);
      for (let amt = SKIN_SHADE.darkest; amt <= SKIN_SHADE.light; amt += 2) expect(contrastRatio(ink, adjustColor(hex, amt)), `${hex} shaded ${amt}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('every line of the face is drawn in that ink at full opacity (a faint line would not reach 3:1)', () => {
    for (const n of MONK_CLASSES) {
      const hex = lookForMonk(n)!.hex;
      const r = render(<AvatarView garment={null} fit={null} measurements={measurements} skinHex={hex} />);
      const face = r.getByTestId('neutral-face');
      expect(face).toHaveAttribute('stroke', faceInk(hex));
      expect(face).not.toHaveAttribute('opacity', expect.stringMatching(/^0\./));
      for (const el of Array.from(face.querySelectorAll('*'))) {
        for (const a of ['opacity', 'stroke-opacity', 'fill-opacity']) expect(el.getAttribute(a), `Monk ${n} ${el.tagName} ${a}`).toBeNull();
      }
      // The gradient the test above assumes is the one that is drawn.
      const stops = Array.from(r.container.querySelectorAll('[id$="skingrad"] stop')).map((s) => s.getAttribute('stop-color'));
      expect(stops).toEqual([adjustColor(hex, SKIN_SHADE.light), adjustColor(hex, SKIN_SHADE.dark)]);
      r.unmount();
    }
  });

  it('the figure has an outline that stands out 3:1 from the light backdrop, so a light skin does not vanish', () => {
    const BACKDROP = '#F1ECE6';
    for (const hex of [...MONK_CLASSES.map((n) => lookForMonk(n)!.hex), STANDARD_SKIN_HEX]) {
      expect(contrastRatio(figureOutline(hex), BACKDROP), hex).toBeGreaterThanOrEqual(3);
      const r = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} skinHex={hex} />);
      const body = r.getByTestId('figure-body');
      expect(body).toHaveAttribute('stroke', figureOutline(hex));
      expect(Number(body.getAttribute('stroke-width'))).toBeGreaterThan(1);
      r.unmount();
    }
    // Without it the lightest swatch is 1.1:1 on that backdrop: the reason the outline exists.
    expect(contrastRatio(lookForMonk(1)!.hex, BACKDROP)).toBeLessThan(1.3);
  });

  it('D21: the estimate label has one wording; the app\'s lines are cut from it and the embed catalogue\'s lines say the same', () => {
    expect(ESTIMATE_LABEL_LINES.join(' ')).toBe(ESTIMATE_LABEL);
    expect(ESTIMATE_LABEL_LINES.every((l) => l.length > 0 && l === l.trim())).toBe(true);
    expect(embedStrings().result.estimateLines.join(' ')).toBe(ESTIMATE_LABEL);
    // The app's figure (no lines passed) and the embed's (the catalogue's lines) read the same.
    const app = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} />);
    expect(app.getByTestId('estimate-label')).toHaveTextContent(ESTIMATE_LABEL);
    app.unmount();
    const embed = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} labelsAt="bottom" estimateLines={embedStrings().result.estimateLines} />);
    expect(embed.getByTestId('estimate-label')).toHaveTextContent(ESTIMATE_LABEL);
    embed.unmount();
  });

  it('labels under the figure (the embed): the figure is drawn above the label strip, and the estimate badge can ride up the frame', () => {
    const below = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} labelsAt="bottom" estimateLines={embedStrings().result.estimateLines} />);
    expect(below.getByTestId('mirror').className).toMatch(/\bpb-16\b/);
    // The track runs the height of the frame and ends where the strip does.
    expect(below.getByTestId('avatar-labels').className).toMatch(/\btop-3\b.*\bbottom-4\b.*\bitems-end\b/);
    expect(below.getByTestId('avatar-labels')).toHaveTextContent('Estimate · not measured');
    const badge = below.getByTestId('estimate-label');
    expect(badge).toHaveTextContent('Estimate · not measured');
    expect(badge.className).toMatch(/\bsticky\b/);
    // It stays clear of a bar at the bottom of the host's screen, whose height the host names.
    expect(badge.style.bottom).toContain('--estimate-clear');
    expect(badge).toHaveAttribute('title', expect.stringContaining('Estimate'));
    below.unmount();
  });

  it('labels at the top (the app): a strip above the head, so no label lies across the face', () => {
    const top = render(<AvatarView garment={garment} fit={fit} size="M" measurements={measurements} />);
    expect(top.getByTestId('mirror').className).toMatch(/\bpt-11\b/);
    expect(top.getByTestId('avatar-labels').className).toMatch(/\btop-3\b/);
    expect(top.getByTestId('estimate-label')).toHaveTextContent('Estimate · not measured');
    expect(top.getByTestId('estimate-label').className).not.toMatch(/\bsticky\b/);
  });

  it('a thumbnail and a bare figure keep their own labelling', () => {
    const compact = render(<AvatarView compact garment={garment} fit={fit} size="M" measurements={measurements} />);
    expect(compact.getByTestId('estimate-badge')).toHaveTextContent('Estimate');
    expect(compact.queryByTestId('avatar-labels')).toBeNull();
    compact.unmount();
    const bare = render(<AvatarView bare garment={garment} fit={fit} size="M" measurements={measurements} />);
    expect(bare.queryByTestId('avatar-labels')).toBeNull();
    expect(bare.getByTestId('mirror').className).toMatch(/\bp-3\b/);
  });
});

describe('hero render input: only the neutral figure (plan §3, consent copy C29)', () => {
  const figure = (props: Partial<Parameters<typeof AvatarView>[0]> = {}): SVGSVGElement => svgOf(render(<AvatarView bare garment={garment} fit={fit} size="M" measurements={measurements} {...props} />).container);

  it('accepts the figure in the standard colour, with the standard face or plain', () => {
    expect(() => assertNeutralPerson(figure())).not.toThrow();
    expect(() => assertNeutralPerson(figure({ plain: true }))).not.toThrow();
  });

  it('the plain figure (what the render is made from) has no drawn face and no outline', () => {
    const svg = figure({ plain: true });
    expect(svg.querySelector('[data-testid="neutral-face"]')).toBeNull();
    expect(svg.querySelector('[data-testid="figure-body"]')).not.toHaveAttribute('stroke');
    expect(svg).toHaveAttribute('data-skin', STANDARD_SKIN_HEX);
  });

  it('a product name that looks like a reference does not fail the guard (labels are text, not links)', () => {
    const named = { ...garment, name: 'Big data: tee https://x' };
    expect(() => assertNeutralPerson(figure({ garment: named, plain: true }))).not.toThrow();
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
    // A women's garment: the body option is the three girths, exactly as before the avatar slices.
    expect(mountOptions(a.mountGarmentView).body).toEqual({ bust: 90, waist: 72, hip: 98 });
    expect(a.setLook).not.toHaveBeenCalled();
    cleanup();

    const b = setup({ heightCm: undefined });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(b.mountGarmentView).toHaveBeenCalledTimes(1));
    expect('look' in mountOptions(b.mountGarmentView)).toBe(false);
    expect(mountOptions(b.mountGarmentView).body).toEqual({ bust: 90, waist: 72, hip: 98 });
    b.unmount();

    // Only a men's garment asks for the male family and passes the height.
    const men = setup({ garment: { ...garment, audience: 'men' } });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(men.mountGarmentView).toHaveBeenCalledTimes(1));
    expect(mountOptions(men.mountGarmentView).body).toEqual({ bust: 90, waist: 72, hip: 98, family: 'male', heightCm: 171 });
  });

  it('lighting and head: nothing is sent for today\'s look; the look review\'s options only when asked', async () => {
    const a = setup({ skinHex: null });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(a.mountGarmentView).toHaveBeenCalledTimes(1));
    expect('lighting' in mountOptions(a.mountGarmentView)).toBe(false);
    expect('look' in mountOptions(a.mountGarmentView)).toBe(false);
    cleanup();
    const hex = lookForMonk(1)!.hex;
    const b = setup({ skinHex: hex, lighting: 'neutral-v2', head: 'neutral-v2' });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(b.mountGarmentView).toHaveBeenCalledTimes(1));
    expect(mountOptions(b.mountGarmentView).lighting).toBe('neutral-v2');
    expect(mountOptions(b.mountGarmentView).look).toEqual({ skinHex: hex, head: 'neutral-v2' });
    cleanup();
    const c = setup({ skinHex: null, lighting: 'classic', head: 'neutral-v2' });
    fireEvent.click(screen.getByTestId('garment3d-open'));
    await waitFor(() => expect(c.mountGarmentView).toHaveBeenCalledTimes(1));
    expect('lighting' in mountOptions(c.mountGarmentView)).toBe(false);
    expect(mountOptions(c.mountGarmentView).look).toEqual({ head: 'neutral-v2' });
  });

  it('the build flags: classic and today\'s head unless set to a known value', () => {
    expect(viewerLightingFlag({})).toBe('classic');
    for (const v of ['', 'Neutral', 'v2', 'neutral-v3', 'classic']) expect(viewerLightingFlag({ VITE_VIEWER_LIGHTING: v })).toBe('classic');
    expect(viewerLightingFlag({ VITE_VIEWER_LIGHTING: 'neutral' })).toBe('neutral');
    expect(viewerLightingFlag({ VITE_VIEWER_LIGHTING: 'neutral-v2' })).toBe('neutral-v2');
    expect(viewerHeadFlag({})).toBeNull();
    for (const v of ['', 'neutral', 'egg', 'v2', 'v3', 'neutral-v4']) expect(viewerHeadFlag({ VITE_VIEWER_HEAD: v })).toBeNull();
    expect(viewerHeadFlag({ VITE_VIEWER_HEAD: 'neutral-v2' })).toBe('neutral-v2');
    expect(viewerHeadFlag({ VITE_VIEWER_HEAD: 'neutral-v3' })).toBe('neutral-v3');
    // The flags of this test run are not set: the app gets today's look.
    expect(viewerLightingFlag()).toBe('classic');
    expect(viewerHeadFlag()).toBeNull();
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
