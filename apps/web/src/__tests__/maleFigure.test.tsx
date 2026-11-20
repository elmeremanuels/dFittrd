// @vitest-environment jsdom
/**
 * The male 2D figure (slice M1b, docs/research/men-3d-plan.md): drawn from the male body family's
 * measurements, it reads as a man (broader shoulders over the deltoids, straighter torso, no
 * bust), keeps the neutral face and the picked skin colour, and keeps every estimate label. The
 * female figure is pinned separately (`femaleFigureGolden.test.tsx`).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit, fitGapsForRender } from '@curtain/fit-engine';
import { SYNTHETIC_MENS_TEE } from '@curtain/schema';
// The package's own source: the 2D figure's copy of the table must equal it (apps/web does not
// depend on @curtain/mannequin at run time, so the embed's main chunk stays without the mesh generator).
import { MALE_ASSUMPTIONS, MALE_LEVELS, MALE_REFERENCE } from '../../../../packages/mannequin/src/families';
import { AvatarView } from '@/components/AvatarView';
import { ESTIMATE_LABEL_LINES } from '@/components/EstimateBadge';
import { bodyGeometry, bodyPath, figureY, garmentGeometry, levelY, MALE_LEVEL_Y, MALE_REFERENCE_BODY, type BodyGeometry } from '@/render/body';
import { neutralFace } from '@/render/face';
import { MALE_FIGURE_ASSUMPTIONS, MALE_FIGURE_LEVELS_FROM_FLOOR, MALE_FIGURE_SIZES, MALE_FIGURE_TABLE, maleRowAt } from '@/render/maleBody';
import { ringOverlayFor } from '@/render/rings';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
afterEach(cleanup);

const rowBody = (id: (typeof MALE_FIGURE_SIZES)[number]) => {
  const r = MALE_FIGURE_TABLE[id];
  return { m: { bust: r.chest, waist: r.waist, hip: r.hip, shoulder: r.shoulderWidth }, h: r.stature };
};
const male = (id: (typeof MALE_FIGURE_SIZES)[number]): BodyGeometry => bodyGeometry(rowBody(id).m, rowBody(id).h, 'male');
const FEMALE_REF = { bust: 88, waist: 70, hip: 96, shoulder: 38 };

describe('male 2D figure: the numbers come from the male body family', () => {
  it('the table, the levels and the shared assumptions equal @curtain/mannequin', () => {
    for (const id of MALE_FIGURE_SIZES) {
      const pkg = MALE_REFERENCE[id];
      for (const [k, v] of Object.entries(MALE_FIGURE_TABLE[id])) expect(v, `${id}.${k}`).toBe(pkg[k as keyof typeof pkg]);
    }
    expect(MALE_FIGURE_LEVELS_FROM_FLOOR).toEqual(MALE_LEVELS);
    expect(MALE_FIGURE_ASSUMPTIONS.relaxedOverFlexedBiceps).toBe(MALE_ASSUMPTIONS.relaxedOverFlexedBiceps);
    expect(MALE_FIGURE_ASSUMPTIONS.thighAspect).toBe(MALE_ASSUMPTIONS.thighAspect);
  });

  it('levels: from the package (head top 0, sole 1), crotch from the M row inseam', () => {
    expect(MALE_LEVEL_Y.shoulder).toBeCloseTo(1 - MALE_LEVELS.shoulder, 3);
    expect(MALE_LEVEL_Y.bust).toBeCloseTo(1 - MALE_LEVELS.chest, 3);
    expect(MALE_LEVEL_Y.waist).toBeCloseTo(1 - MALE_LEVELS.waist, 3);
    expect(MALE_LEVEL_Y.hip).toBeCloseTo(1 - MALE_LEVELS.hip, 3);
    expect(MALE_LEVEL_Y.knee).toBeCloseTo(1 - MALE_LEVELS.knee, 3);
    expect(MALE_LEVEL_Y.crotch).toBeCloseTo(1 - MALE_REFERENCE.M.inseam / MALE_REFERENCE.M.stature, 3);
    const keys = ['headTop', 'chin', 'shoulder', 'bust', 'underbust', 'waist', 'hip', 'crotch', 'thigh', 'knee', 'calf', 'ankle', 'sole'] as const;
    for (let i = 1; i < keys.length; i++) expect(MALE_LEVEL_Y[keys[i]!], keys[i]).toBeGreaterThan(MALE_LEVEL_Y[keys[i - 1]!]);
  });

  it('maleRowAt: the table at its rows, linear between, ratios and stature held outside', () => {
    for (const id of MALE_FIGURE_SIZES) expect(maleRowAt(MALE_FIGURE_TABLE[id].chest)).toEqual(MALE_FIGURE_TABLE[id]);
    const mid = maleRowAt(102);
    expect(mid.waist).toBeCloseTo(90, 6);
    expect(mid.bideltoid).toBeCloseTo((48.5 + 51) / 2, 6);
    const big = maleRowAt(140);
    expect(big.chestAspect).toBe(MALE_FIGURE_TABLE.XXL.chestAspect);
    expect(big.stature).toBe(MALE_FIGURE_TABLE.XXL.stature);
    expect(big.bideltoid).toBeGreaterThan(MALE_FIGURE_TABLE.XXL.bideltoid);
    expect(maleRowAt(60).neck).toBeGreaterThanOrEqual(MALE_FIGURE_TABLE.S.neck * 0.6);
  });

  it('missing measurements come from the table at the chest; the reference body is the male M', () => {
    const ref = bodyGeometry(null, undefined, 'male');
    const m = male('M');
    expect(ref).toEqual(m);
    expect(MALE_REFERENCE_BODY).toMatchObject({ bust: 98, waist: 86, hip: 96, shoulder: 40.5, height: 174 });
    const onlyChest = bodyGeometry({ bust: 114 }, 177, 'male');
    expect(onlyChest).toEqual(male('XL'));
  });
});

describe('male 2D figure: reads as a man', () => {
  const female = bodyGeometry(FEMALE_REF, 168);

  it('shoulders: the breadth over the deltoids is the ANSUR bideltoid breadth (S: +0.06 cm) and clearly broader than the seat', () => {
    for (const id of MALE_FIGURE_SIZES) {
      const g = male(id);
      const cm = (px: number): number => (2 * px) / g.pxPerCm;
      // the bideltoid breadth, or a hair more where the deltoid must stand at least 0.6 arm outside the shoulder point (S)
      expect(cm(g.deltoidHalf!), id).toBeGreaterThanOrEqual(MALE_FIGURE_TABLE[id].bideltoid - 1e-9);
      expect(cm(g.deltoidHalf!) - MALE_FIGURE_TABLE[id].bideltoid, id).toBeLessThan(0.5);
      expect(cm(g.shoulderHalf), id).toBeCloseTo(MALE_FIGURE_TABLE[id].shoulderWidth, 1);
      expect(g.deltoidHalf! / g.hipHalf, id).toBeGreaterThan(1.25);
    }
    // the female figure's outer breadth (shoulder plus the arm) over its hip: the man's is larger
    const femaleOuter = female.shoulderHalf - 2 + female.armHalf;
    expect(male('M').deltoidHalf! / male('M').hipHalf).toBeGreaterThan(femaleOuter / female.hipHalf);
  });

  it('a straighter torso: the waist is almost as wide as the chest (the female figure pinches)', () => {
    for (const id of MALE_FIGURE_SIZES) {
      const g = male(id);
      expect(g.waistHalf / g.bustHalf, id).toBeGreaterThan(0.9);
      expect(g.hipHalf / g.waistHalf, id).toBeLessThan(1.2);
    }
    expect(female.waistHalf / female.bustHalf).toBeLessThan(0.85);
  });

  it('no bust: the chest point of the outline is the chest width, and a top on him gets no bust allowance', () => {
    const g = male('M');
    const tee = garmentGeometry({ garment: SYNTHETIC_MENS_TEE, gaps: null, body: g });
    const teeF = garmentGeometry({ garment: SYNTHETIC_MENS_TEE, gaps: null, body: { ...g, family: undefined } as BodyGeometry });
    expect(teeF.widths.bustHalf - tee.widths.bustHalf).toBeCloseTo(2, 6);
  });

  it('thicker neck and arms, a wider head, longer legs than the female figure (all in cm)', () => {
    const g = male('M');
    const cm = (b: BodyGeometry, px: number): number => px / b.pxPerCm;
    expect(cm(g, g.neckHalf)).toBeGreaterThan(cm(female, female.neckHalf));
    expect(cm(g, g.armHalf)).toBeGreaterThan(cm(female, female.armHalf));
    expect(cm(g, g.headR)).toBeGreaterThan(cm(female, female.headR));
    expect(figureY(g, 'crotch')).toBeLessThan(levelY('crotch'));
  });

  it('S to XXL: every width grows with the size, and the arms clear the seat', () => {
    const gs = MALE_FIGURE_SIZES.map((id) => male(id));
    for (const k of ['shoulderHalf', 'bustHalf', 'waistHalf', 'hipHalf', 'thighHalf', 'neckHalf', 'armHalf'] as const) {
      for (let i = 1; i < gs.length; i++) expect(gs[i]![k] / gs[i]!.pxPerCm, `${k} ${MALE_FIGURE_SIZES[i]}`).toBeGreaterThan(gs[i - 1]![k] / gs[i - 1]!.pxPerCm);
    }
    for (const g of gs) expect(g.armX! + g.armDrift! - g.wristHalf!).toBeGreaterThan(g.hipHalf + 2);
  });

  it('the path has the same parts as the female figure: head, torso, two legs, two arms; inside the viewBox', () => {
    for (const id of MALE_FIGURE_SIZES) {
      const d = bodyPath(male(id));
      expect(d.match(/M /g)).toHaveLength(6);
      const xs = [...d.matchAll(/(-?\d+\.\d),(-?\d+\.\d)/g)].map((m) => Number(m[1]));
      expect(Math.min(...xs)).toBeGreaterThan(0);
      expect(Math.max(...xs)).toBeLessThan(200);
    }
  });
});

describe('male 2D figure in AvatarView', () => {
  const tee = SYNTHETIC_MENS_TEE;
  const { m, h } = rowBody('L');
  const fit = computeFit(tee, { measurements: m });
  const size = fit.perSize[1]!.size;

  it('is marked male, keeps the neutral face (the same drawing, sized by the head), and every estimate label', () => {
    const r = render(<AvatarView garment={tee} fit={fit} size={size} measurements={m} heightCm={h} family="male" labelsAt="bottom" estimateLines={ESTIMATE_LABEL_LINES} />);
    const svg = r.container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-figure', 'male');
    expect(svg.getAttribute('aria-label')).toMatch(/^Estimated look of .* — not measured$/);
    const face = r.getByTestId('neutral-face');
    const expected = neutralFace(male('L'));
    expect(face.querySelectorAll('ellipse')).toHaveLength(2);
    expect(face.querySelector('ellipse')!.getAttribute('cx')).toBe(String(expected.eyes[0]!.cx));
    expect(face.innerHTML).toContain(expected.mouth);
    expect(r.container.querySelector('image')).toBeNull();
    expect(r.getByTestId('estimate-label')).toHaveTextContent(ESTIMATE_LABEL_LINES[0]);
    expect(r.getByTestId('garment-layer')).toBeInTheDocument();
    r.unmount();
    const peek = render(<AvatarView compact garment={tee} fit={fit} size={size} measurements={m} heightCm={h} family="male" />);
    expect(peek.getByTestId('estimate-badge')).toHaveTextContent('Estimate');
  });

  it('takes the picked skin colour: three tones, the standard colour without one', () => {
    for (const hex of ['#F6EDE4', '#A56F4B', '#3A2A22']) {
      const r = render(<AvatarView garment={null} fit={null} measurements={m} heightCm={h} family="male" skinHex={hex} />);
      expect(r.container.querySelector('svg')).toHaveAttribute('data-skin', hex);
      r.unmount();
    }
    const std = render(<AvatarView garment={null} fit={null} measurements={m} heightCm={h} family="male" />);
    expect(std.container.querySelector('svg')).toHaveAttribute('data-skin', '#DFC3A8');
  });

  it('the male figure differs from the female figure drawn from the same numbers', () => {
    const a = render(<AvatarView garment={null} fit={null} measurements={m} heightCm={h} family="male" />);
    const maleD = a.getByTestId('figure-body').getAttribute('d');
    a.unmount();
    const b = render(<AvatarView garment={null} fit={null} measurements={m} heightCm={h} />);
    expect(b.getByTestId('figure-body').getAttribute('d')).not.toBe(maleD);
    expect(b.container.querySelector('[data-figure]')).toBeNull();
  });

  it('size rings sit at the male levels, use his chest depth, and name the chest "Chest"', () => {
    const rings = ringOverlayFor({ garment: tee, fit, size, measurements: m, heightCm: h, family: 'male' })!;
    const g = male('L');
    const chest = rings.selected.rings.find((r) => r.key === 'bust')!;
    expect(chest.y).toBeCloseTo(figureY(g, 'bust'), 6);
    expect(chest.bodyRx).toBeCloseTo(g.bustHalf, 6);
    expect(chest.text).toMatch(/^Chest: /);
    expect(rings.selected.rings.find((r) => r.key === 'waist')!.y).toBeCloseTo(figureY(g, 'waist'), 6);
    const female = ringOverlayFor({ garment: tee, fit, size, measurements: m, heightCm: h })!;
    expect(female.selected.rings.find((r) => r.key === 'bust')!.text).toMatch(/^Bust: /);
  });

  it('a tighter size draws a narrower tee on the same man (S / M / L read differently)', () => {
    const g = male('L');
    const widths = fit.perSize.map((s) => garmentGeometry({ garment: tee, gaps: fitGapsForRender(fit, s.size), body: g }).widths.bustHalf);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]!);
    expect(widths[widths.length - 1]!).toBeGreaterThan(widths[0]!);
  });
});
