/**
 * No hole in a 2D figure (docs/OPEN-ISSUES.md OI-83). The body is one path of six parts (head, torso, two legs, two
 * arms) filled under the nonzero rule: where two parts overlap and wind opposite ways, the overlap is NOT filled. The
 * female figure's left arm did that at the armpit. Here every point of a grid that lies inside one of the parts must be
 * filled by the whole path, for every figure family and a wide range of bodies. The path is read as the browser reads
 * it (curves flattened, winding numbers summed); `e2e/phoneResult.spec.ts` asks Chromium's own `isPointInFill` the same.
 */
import { describe, expect, it } from 'vitest';
import type { UserBody } from '@curtain/schema';
import { bodyGeometry, bodyPath, type FigureFamily, type FigureOptions } from '@/render/body';

type Pt = [number, number];

/** One closed polygon per subpath. Knows the commands the figures use: M, L, C, Z and the head's one `a` (a full ellipse). */
export function subpathPolygons(d: string): Pt[][] {
  return d
    .split(/(?=M)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((sub) => {
      const tokens = sub.match(/[MLCZa]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
      const pts: Pt[] = [];
      let cmd = '';
      let i = 0;
      const num = (): number => Number(tokens[i++]);
      while (i < tokens.length) {
        if (/^[MLCZa]$/.test(tokens[i]!)) cmd = tokens[i++]!;
        if (cmd === 'Z') continue;
        if (cmd === 'M' || cmd === 'L') {
          pts.push([num(), num()]);
          if (cmd === 'M') cmd = 'L';
        } else if (cmd === 'C') {
          const p0 = pts[pts.length - 1]!;
          const c1: Pt = [num(), num()];
          const c2: Pt = [num(), num()];
          const p3: Pt = [num(), num()];
          for (let k = 1; k <= 12; k++) {
            const t = k / 12;
            const u = 1 - t;
            pts.push([u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]]);
          }
        } else if (cmd === 'a') {
          // `a rx,ry 0 1,sweep 0.01,0`: the whole ellipse hanging from the start point; sweep 1 runs clockwise on screen.
          const [x0, y0] = pts[pts.length - 1]!;
          const rx = num();
          const ry = num();
          num();
          num();
          const sweep = num();
          num();
          num();
          for (let k = 1; k < 48; k++) {
            const a = ((sweep ? 1 : -1) * k * 2 * Math.PI) / 48;
            pts.push([x0 + rx * Math.sin(a), y0 + ry - ry * Math.cos(a)]);
          }
        } else throw new Error(`a path command this test does not know: ${cmd}`);
      }
      return pts;
    });
}

/** Where the polygon's edges cross the row `y`: the x of each crossing and its direction (+1 down, -1 up). */
function crossings(poly: Pt[], y: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % poly.length]!;
    if (y1 <= y === y2 <= y) continue;
    out.push([x1 + ((y - y1) / (y2 - y1)) * (x2 - x1), y2 > y1 ? 1 : -1]);
  }
  return out;
}

/** Grid points (1 px apart, in the figure's own units) inside at least one part that the whole path leaves unfilled (winding numbers sum to zero). */
export function unfilledPoints(d: string): number {
  const polys = subpathPolygons(d);
  const all = polys.flat();
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const [x, y] of all) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  let holes = 0;
  for (let y = Math.floor(minY) + 0.5; y < maxY; y += 1) {
    const rows = polys.map((p) => crossings(p, y));
    for (let x = Math.floor(minX) + 0.5; x < maxX; x += 1) {
      // the winding number of each part round (x, y): the crossings to the right of the point, signed
      let inside = false;
      let sum = 0;
      for (const row of rows) {
        let w = 0;
        for (const c of row) if (c[0] > x) w += c[1];
        if (w !== 0) inside = true;
        sum += w;
      }
      if (inside && sum === 0) holes++;
    }
  }
  return holes;
}

const FAMILIES: { name: string; family: FigureFamily; options: FigureOptions }[] = [
  { name: 'female', family: 'female', options: {} },
  { name: 'male v1', family: 'male', options: {} },
  { name: 'male v2', family: 'male', options: { maleShape: 'v2' } },
];

/** No answers at all, then a grid from very slim to very full, short to tall, with and without a typed shoulder and thigh. */
function bodies(): { name: string; m: UserBody['measurements'] | null; h?: number }[] {
  const out: { name: string; m: UserBody['measurements'] | null; h?: number }[] = [{ name: 'reference', m: null }];
  for (const h of [150, 170, 190]) {
    for (const bust of [72, 90, 108, 132]) {
      for (const [dw, dh] of [[-22, 4], [-14, 10], [-4, 0], [6, 16]] as const) {
        out.push({ name: `h${h} b${bust} w${bust + dw} hip${bust + dh}`, m: { bust, waist: bust + dw, hip: bust + dh }, h });
      }
      out.push({ name: `h${h} b${bust} wide shoulders`, m: { bust, waist: bust - 12, hip: bust + 6, shoulder: 48, thigh: 70 }, h });
      out.push({ name: `h${h} b${bust} narrow shoulders`, m: { bust, waist: bust - 12, hip: bust + 6, shoulder: 33, thigh: 44 }, h });
    }
  }
  return out;
}

describe('2D figure: every part is filled, no hole where two parts overlap (OI-83)', () => {
  it('the test sees a hole when there is one: two overlapping squares wound opposite ways', () => {
    const cw = 'M 0,0 L 10,0 L 10,10 L 0,10 Z';
    expect(unfilledPoints(`${cw} M 5,0 L 15,0 L 15,10 L 5,10 Z`)).toBe(0);
    expect(unfilledPoints(`${cw} M 5,10 L 15,10 L 15,0 L 5,0 Z`)).toBe(50); // the 5 x 10 overlap
  });

  for (const f of FAMILIES) {
    it(`${f.name}: no unfilled point inside a part, for ${bodies().length} bodies`, () => {
      const holes: Record<string, number> = {};
      for (const b of bodies()) {
        const d = bodyPath(bodyGeometry(b.m, b.h, f.family, f.options));
        expect(subpathPolygons(d)).toHaveLength(6);
        const n = unfilledPoints(d);
        if (n > 0) holes[b.name] = n;
      }
      expect(holes).toEqual({});
    });
  }

  it('female: the left arm is the right arm mirrored, corner for corner (the outline did not move)', () => {
    for (const b of bodies()) {
      const [, , , , right, left] = subpathPolygons(bodyPath(bodyGeometry(b.m, b.h)));
      const key = (p: Pt): string => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
      expect(left!.map(([x, y]) => key([200 - x, y])).sort(), b.name).toEqual(right!.map(key).sort());
      // and they wind the same way now (signed area of the same sign)
      const area = (poly: Pt[]): number => poly.reduce((a, [x, y], i) => a + x * poly[(i + 1) % poly.length]![1] - poly[(i + 1) % poly.length]![0] * y, 0);
      expect(Math.sign(area(left!))).toBe(Math.sign(area(right!)));
    }
  });
});
