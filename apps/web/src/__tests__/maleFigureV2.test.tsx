// @vitest-environment jsdom
/**
 * The male 2D figure v2 (branch `claude/male-2d-v2`): with `maleShape: 'v2'` the figure follows
 * the 3D male body v2 (`buildMannequin(shape, { maleShape: 'v2' })`). This test rebuilds the v2
 * meshes of S…XXL from the package's source and measures the drawn outline (the SVG path, its
 * Bézier curves flattened) against the mesh's front view at the same heights: every width within
 * 0.5 cm. With v2 off the male figure is pinned by `maleFigureGolden.test.tsx`, the female figure by
 * `femaleFigureGolden.test.tsx`.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFit } from '@curtain/fit-engine';
import { MOCK_GARMENTS, SYNTHETIC_MENS_CHINO_WL, SYNTHETIC_MENS_TEE } from '@curtain/schema';
// The package's own source (apps/web does not depend on @curtain/mannequin at run time).
import { buildMannequin, buildMannequinMesh, deltoidBreadthCm, familyShape, MALE_BODY_SHAPE_IDS, slice, type Mesh } from '../../../../packages/mannequin/src/index';
import { AvatarView } from '@/components/AvatarView';
import { bodyGeometry, bodyPath, CENTER_X, FEET_Y, garmentGeometry, HEAD_TOP_Y, type BodyGeometry } from '@/render/body';
import { MALE_FIGURE_SIZES, MALE_FIGURE_TABLE, MALE_V2_FIGURE_TABLE, maleV2RowAt } from '@/render/maleBody';
import { ringOverlayFor } from '@/render/rings';
import { maleShapeFlag } from '@/embed/look';

vi.stubGlobal('matchMedia', (q: string) => ({ matches: /prefers-reduced-motion/.test(q), media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }));
afterEach(cleanup);

const TOLERANCE_CM = 0.5;

type Pt = { x: number; y: number };

/** The subpaths of an SVG path of M / L / C / Z commands (and the head's arc, skipped), curves flattened. */
function subpaths(d: string): Pt[][] {
  const out: Pt[][] = [];
  const tokens = d.match(/[MLCZa]|-?\d+(?:\.\d+)?/g)!;
  let cur: Pt[] = [];
  let cmd = '';
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[MLCZa]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'Z') {
        out.push(cur);
        cur = [];
      }
      if (cmd === 'a') i += 7;
      continue;
    }
    if (cmd === 'M') {
      cur = [{ x: num(), y: num() }];
      cmd = 'L';
    } else if (cmd === 'L') cur.push({ x: num(), y: num() });
    else if (cmd === 'C') {
      const p0 = cur[cur.length - 1]!;
      const c1 = { x: num(), y: num() };
      const c2 = { x: num(), y: num() };
      const p3 = { x: num(), y: num() };
      for (let k = 1; k <= 16; k++) {
        const s = k / 16;
        const u = 1 - s;
        cur.push({ x: u * u * u * p0.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s * s * s * p3.x, y: u * u * u * p0.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s * s * s * p3.y });
      }
    } else i++;
  }
  return out;
}

/** The largest x (right of the middle) where a closed polygon crosses the horizontal line at y. */
function rightAt(poly: Pt[], y: number): number {
  let best = -Infinity;
  for (let j = 0; j < poly.length; j++) {
    const a = poly[j]!;
    const b = poly[(j + 1) % poly.length]!;
    if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue;
    best = Math.max(best, a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  return best;
}

/** The mesh's front view: largest |x| of a part's loops in the horizontal plane at height y (cm). */
function meshHalf(mesh: Mesh, part: string, y: number, side: 'max' | 'min' = 'max'): number {
  const k = mesh.partNames.indexOf(part);
  const xs = slice(mesh.positions, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] }, (t) => mesh.vertexPart[mesh.indices[3 * t]!] === k).flatMap((l) => l.points.map((p) => p[0]));
  return side === 'max' ? Math.max(...xs.map(Math.abs)) : Math.min(...xs);
}

const rowBody = (id: (typeof MALE_FIGURE_SIZES)[number]) => {
  const r = MALE_FIGURE_TABLE[id];
  return { m: { bust: r.chest, waist: r.waist, hip: r.hip, shoulder: r.shoulderWidth }, h: r.stature };
};
const v2Figure = (id: (typeof MALE_FIGURE_SIZES)[number]): BodyGeometry => bodyGeometry(rowBody(id).m, rowBody(id).h, 'male', { maleShape: 'v2' });

const SIZES = MALE_BODY_SHAPE_IDS.map((id) => {
  const mannequin = buildMannequin(familyShape('male', id)!, { maleShape: 'v2' });
  return { id, mannequin, mesh: buildMannequinMesh(mannequin) };
});

/** Every comparison of one size: name → [2D cm, 3D cm]. */
function compare(id: (typeof MALE_FIGURE_SIZES)[number]): Record<string, [number, number]> {
  const { mannequin: m, mesh } = SIZES.find((s) => s.id === id)!;
  const g = v2Figure(id);
  const S = m.statureCm;
  const toY = (yCm: number): number => HEAD_TOP_Y + (1 - yCm / S) * (FEET_Y - HEAD_TOP_Y);
  const cm = (px: number): number => px / g.pxPerCm;
  const parts = subpaths(bodyPath(g));
  const torso = parts[1]!;
  const leg = parts[2]!;
  const Y = m.morphHeights;
  const torso2d = (yCm: number): number => cm(rightAt(torso, toY(yCm)) - CENTER_X);
  const leg2d = (yCm: number): number => cm(rightAt(leg, toY(yCm)) - CENTER_X);
  const axilla = S * MALE_V2_FIGURE_TABLE[id].axillaLevel;
  const out: Record<string, [number, number]> = {
    trapezius: [torso2d(Y.shoulder + 0.5 * (Y.neck - Y.shoulder)), meshHalf(mesh, 'torso', Y.shoulder + 0.5 * (Y.neck - Y.shoulder))],
    armpit: [torso2d(axilla), meshHalf(mesh, 'torso', axilla)],
    chest: [torso2d(Y.chest), meshHalf(mesh, 'torso', Y.chest)],
    underbust: [torso2d(Y.underbust), meshHalf(mesh, 'torso', Y.underbust)],
    waist: [torso2d(Y.waist), meshHalf(mesh, 'torso', Y.waist)],
    seat: [torso2d(Y.hip), meshHalf(mesh, 'torso', Y.hip)],
    thighRing: [leg2d(Y.thigh), meshHalf(mesh, 'leg_l', Y.thigh)],
    knee: [leg2d(Y.knee), meshHalf(mesh, 'leg_l', Y.knee)],
    legCentre: [cm(g.legX!), m.landmarks.legX],
    deltoids: [(2 * g.deltoidHalf!) / g.pxPerCm, deltoidBreadthCm(m)],
  };
  // halves to full breadths (the legs' outer edge and the centre stay as they are)
  for (const k of ['trapezius', 'armpit', 'chest', 'underbust', 'waist', 'seat'] as const) out[k] = [2 * out[k]![0], 2 * out[k]![1]];
  return out;
}

describe('male 2D figure v2 follows the 3D male body v2', () => {
  it.each(MALE_FIGURE_SIZES)('%s: every width of the drawn figure is within 0.5 cm of the v2 mesh', (id) => {
    const c = compare(id);
    if (process.env.MALE_V2_TABLE) console.log(JSON.stringify({ id, c }));
    for (const [k, [a, b]] of Object.entries(c)) expect(Math.abs(a - b), `${id} ${k}: 2D ${a.toFixed(2)} vs 3D ${b.toFixed(2)}`).toBeLessThan(TOLERANCE_CM);
  });

  it('the seat is the v2 seat (narrower than v1), the V runs from the lats to the waist, the deltoids over the seat 1.5', () => {
    for (const id of MALE_FIGURE_SIZES) {
      const v1 = bodyGeometry(rowBody(id).m, rowBody(id).h, 'male');
      const g = v2Figure(id);
      expect(v1.hipHalf - g.hipHalf, id).toBeGreaterThan(1.5 * g.pxPerCm);
      expect(g.v2!.armpitHalf, id).toBeGreaterThan(g.bustHalf);
      expect(g.bustHalf, id).toBeGreaterThan(g.v2!.underbustHalf);
      expect(g.v2!.underbustHalf, id).toBeGreaterThan(g.waistHalf);
      expect(g.deltoidHalf! / g.hipHalf, id).toBeGreaterThan(1.45);
      // the legs sit in under the seat and touch below the crotch
      expect(g.legX!, id).toBeLessThan(g.hipHalf * 0.52);
      expect(g.legX! - g.thighHalf, id).toBeLessThan(0.5 * g.pxPerCm);
    }
  });

  it('maleV2RowAt: the table at its rows, held at the ends', () => {
    for (const id of MALE_FIGURE_SIZES) expect(maleV2RowAt(MALE_FIGURE_TABLE[id].chest)).toEqual(MALE_V2_FIGURE_TABLE[id]);
    expect(maleV2RowAt(60)).toEqual(MALE_V2_FIGURE_TABLE.S);
    expect(maleV2RowAt(160)).toEqual(MALE_V2_FIGURE_TABLE.XXL);
  });

  it('a typed body scales like the 3D body: seat and chest from its own girths, inside the viewBox', () => {
    const typed = { bust: 104, waist: 97, hip: 99, shoulder: 47, thigh: 60 };
    const g = bodyGeometry(typed, 186, 'male', { maleShape: 'v2' });
    const v = maleV2RowAt(104);
    expect(g.hipHalf / g.pxPerCm).toBeCloseTo(99 / (Math.PI * (1 + v.hipAspect)), 6);
    const d = bodyPath(g);
    expect(d.match(/M /g)).toHaveLength(6);
    const xs = [...d.matchAll(/(-?\d+\.\d),(-?\d+\.\d)/g)].map((x) => Number(x[1]));
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(200);
  });
});

describe('the v2 option leaves everything else alone', () => {
  const bodies = [null, ...MALE_FIGURE_SIZES.map((id) => rowBody(id).m)];
  it('maleShape v1 is the default male figure; the female figure ignores v2', () => {
    for (const m of bodies) {
      expect(bodyGeometry(m, undefined, 'male', { maleShape: 'v1' })).toEqual(bodyGeometry(m, undefined, 'male'));
      expect(bodyGeometry(m, 168, 'female', { maleShape: 'v2' })).toEqual(bodyGeometry(m, 168));
    }
    for (const garment of MOCK_GARMENTS) {
      const f = bodyGeometry(null, 168, 'female', { maleShape: 'v2' });
      expect(garmentGeometry({ garment, gaps: null, body: f })).toEqual(garmentGeometry({ garment, gaps: null, body: bodyGeometry(null, 168) }));
    }
  });

  it('one switch: VITE_MALE_SHAPE=v2 only, default v1', () => {
    expect(maleShapeFlag({})).toBe('v1');
    for (const v of ['', 'V2', 'v1', '2', 'true']) expect(maleShapeFlag({ VITE_MALE_SHAPE: v })).toBe('v1');
    expect(maleShapeFlag({ VITE_MALE_SHAPE: 'v2' })).toBe('v2');
    expect(maleShapeFlag()).toBe('v1');
  });
});

describe('male 2D figure v2 in AvatarView and the size rings', () => {
  const { m, h } = rowBody('L');
  const tee = SYNTHETIC_MENS_TEE;
  const fit = computeFit(tee, { measurements: m });
  const size = fit.perSize[1]!.size;

  it('is marked v2 only when on, keeps every estimate label and the skin colour', () => {
    const on = render(<AvatarView garment={tee} fit={fit} size={size} measurements={m} heightCm={h} family="male" maleShape="v2" skinHex="#A56F4B" labelsAt="bottom" />);
    const svg = on.container.querySelector('svg')!;
    expect(svg.getAttribute('data-male-shape')).toBe('v2');
    expect(svg.getAttribute('data-figure')).toBe('male');
    expect(svg.getAttribute('data-skin')).toBe('#A56F4B');
    expect(svg.getAttribute('aria-label')).toMatch(/— not measured$/);
    expect(on.getByTestId('estimate-label')).toBeTruthy();
    on.unmount();
    const off = render(<AvatarView garment={tee} fit={fit} size={size} measurements={m} heightCm={h} family="male" />);
    expect(off.container.querySelector('svg')!.hasAttribute('data-male-shape')).toBe(false);
    off.unmount();
    const female = render(<AvatarView garment={tee} fit={fit} size={size} measurements={m} heightCm={h} maleShape="v2" />);
    expect(female.container.querySelector('svg')!.hasAttribute('data-male-shape')).toBe(false);
  });

  it('rings sit on the v2 body: a ring of the body girth has the body half-width', () => {
    const rings = ringOverlayFor({ garment: tee, fit, size, measurements: m, heightCm: h, family: 'male', maleShape: 'v2' })!;
    const g = bodyGeometry(m, h, 'male', { maleShape: 'v2' });
    for (const r of rings.selected.rings) {
      if (r.key === 'bust') expect(r.bodyRx).toBeCloseTo(g.bustHalf, 6);
      if (r.key === 'waist') expect(r.bodyRx).toBeCloseTo(g.waistHalf, 6);
      if (r.key === 'hip') expect(r.bodyRx).toBeCloseTo(g.hipHalf, 6);
    }
  });

  it('trousers and the tee follow the v2 body: legs on the v2 leg centres', () => {
    const g = bodyGeometry(m, h, 'male', { maleShape: 'v2' });
    const chino = garmentGeometry({ garment: SYNTHETIC_MENS_CHINO_WL, gaps: null, body: g });
    const xs = [...chino.extra[0]!.matchAll(/(-?\d+\.\d),(-?\d+\.\d)/g)].map((x) => Number(x[1]));
    // the trouser leg's own outline is a little lopsided (inner edge 2 px in), so its middle sits within 1.5 px of the leg centre
    expect(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - (CENTER_X + g.legX!))).toBeLessThan(1.5);
    expect(garmentGeometry({ garment: tee, gaps: null, body: g }).widths.hipHalf).toBeLessThan(garmentGeometry({ garment: tee, gaps: null, body: bodyGeometry(m, h, 'male') }).widths.hipHalf);
  });
});
