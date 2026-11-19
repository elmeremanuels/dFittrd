/**
 * The body as the POM chino builder reads it (`pomChino.ts`), the same for both male shapes: at one height the
 * outline a tape or a ring of cloth lies on, as radii about a centre (`POLAR_N` angles, φ = atan2(z, x)).
 *
 * - On the male shape v2 the outlines are the drawn body's (`Mannequin.outlines`). `torsoAt` / `legAt` of that body
 *   return an ellipse that CONTAINS the section, 4 to 13 cm longer round than the body that is drawn; a chino built
 *   on those ellipses read its waistband 6.9 cm tighter than the body and sat 5.1 cm under the worn waist (men-chino
 *   report). On v1 the sections are ellipses and the outlines are those ellipses, sampled.
 * - A ring of cloth does not follow a hollow: every outline handed out is the convex hull of the section (`round`:
 *   the torso and both legs together, what a tape round the seat lies on; `leg`: one leg).
 * - `centre(y)`: the drawn body on the centre plane x = 0 (front and back z of the torso there), which the crotch seam
 *   has to pass under and round. Only from the body's crotch up: below it the thighs of a v2 body touch at the centre,
 *   and the cloth of the two legs passes between them.
 */
import { POLAR_N, type Mannequin, type PolarSection } from '@curtain/mannequin';

export type Outline = PolarSection;
type P2 = [number, number];

const TWO_PI = 2 * Math.PI;

function ellipseOutline(e: { cx: number; cz: number; a: number; b: number }): Outline {
  const r = new Float64Array(POLAR_N);
  for (let j = 0; j < POLAR_N; j++) {
    const c = Math.cos((TWO_PI * j) / POLAR_N), s = Math.sin((TWO_PI * j) / POLAR_N);
    r[j] = (e.a * e.b) / Math.hypot(e.b * c, e.a * s);
  }
  return { cx: e.cx, cz: e.cz, r };
}

function outlinePoints(o: Outline, into: P2[], mirror = false): void {
  for (let j = 0; j < POLAR_N; j++) {
    const a = (TWO_PI * j) / POLAR_N;
    const x = o.cx + o.r[j]! * Math.cos(a);
    into.push([mirror ? -x : x, o.cz + o.r[j]! * Math.sin(a)]);
  }
}

/** Convex hull (counter-clockwise) of 2D points. */
function hull(pts: readonly P2[]): P2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: P2, a: P2, b: P2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], up: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let k = p.length - 1; k >= 0; k--) {
    const q = p[k]!;
    while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/** A convex polygon as radii about a point inside it. */
function polygonOutline(poly: readonly P2[], cx: number, cz: number): Outline {
  const r = new Float64Array(POLAR_N);
  const n = poly.length;
  for (let j = 0; j < POLAR_N; j++) {
    const dx = Math.cos((TWO_PI * j) / POLAR_N), dz = Math.sin((TWO_PI * j) / POLAR_N);
    let best = 0;
    for (let k = 0; k < n; k++) {
      const p = poly[k]!, q = poly[(k + 1) % n]!;
      const x0 = p[0] - cx, z0 = p[1] - cz, ex = q[0] - p[0], ez = q[1] - p[1];
      const det = ex * dz - ez * dx;
      if (Math.abs(det) < 1e-12) continue;
      const t = (ex * z0 - ez * x0) / det, w = (dx * z0 - dz * x0) / det;
      if (w >= -1e-9 && w <= 1 + 1e-9 && t > best) best = t;
    }
    r[j] = best;
  }
  return { cx, cz, r };
}

function hullOutline(pts: readonly P2[], cx?: number): Outline {
  const h = hull(pts);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of h) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[1]);
    z1 = Math.max(z1, p[1]);
  }
  return polygonOutline(h, cx ?? (x0 + x1) / 2, (z0 + z1) / 2);
}

/** Radius of an outline along the angle φ, linear between its samples. */
export function outlineRadius(o: Outline, phi: number): number {
  let f = (phi / TWO_PI) * POLAR_N;
  f -= Math.floor(f / POLAR_N) * POLAR_N;
  const j = Math.floor(f), w = f - j;
  return o.r[j % POLAR_N]! * (1 - w) + o.r[(j + 1) % POLAR_N]! * w;
}

/** Length round an outline (its polygon of `POLAR_N` points), cm. */
export function outlineGirth(o: Outline): number {
  let L = 0;
  for (let j = 0; j < POLAR_N; j++) {
    const a = (TWO_PI * j) / POLAR_N, b = (TWO_PI * (j + 1)) / POLAR_N;
    const r0 = o.r[j]!, r1 = o.r[(j + 1) % POLAR_N]!;
    L += Math.hypot(r0 * Math.cos(a) - r1 * Math.cos(b), r0 * Math.sin(a) - r1 * Math.sin(b));
  }
  return L;
}

export interface ChinoBody {
  /** `drawn outlines` on a body that has them (male shape v2), else `ellipses`. */
  source: 'drawn outlines' | 'ellipses';
  /** Heights between which the body has a leg section. */
  legLo: number;
  legHi: number;
  /** The left leg (+x) at height y, as its hull; the height is clamped to the leg, and below the ankle ring to the ankle (the foot is not a leg section). */
  leg(y: number): Outline;
  /** The drawn section of the left leg and of the torso at exactly y (not a hull), or null where there is none. */
  legDrawn(y: number): Outline | null;
  torsoDrawn(y: number): Outline | null;
  /** Round the whole body at y (torso and both legs): what a tape round the waist or the seat lies on. Null below the legs' top where there is no torso. */
  round(y: number): Outline | null;
  /** The torso on the centre plane at y (front and back z), or null below the body's crotch and where there is no torso. */
  centre(y: number): { front: number; back: number } | null;
  /** The lowest height `centre` answers at. */
  centreLo: number;
}

const cache = new WeakMap<Mannequin, ChinoBody>();

export function chinoBody(m: Mannequin): ChinoBody {
  let hit = cache.get(m);
  if (!hit) cache.set(m, (hit = read(m)));
  return hit;
}

function read(m: Mannequin): ChinoBody {
  const o = m.outlines;
  const key = (y: number): number => Math.round(y * 1e4);
  const memo = <T>(make: (y: number) => T): ((y: number) => T) => {
    const map = new Map<number, T>();
    return (y) => {
      const k = key(y);
      if (!map.has(k)) {
        if (map.size > 4000) map.clear();
        map.set(k, make(y));
      }
      return map.get(k)!;
    };
  };
  const legRaw = memo((y: number): Outline | null => {
    if (o) return o.leg(y, 1);
    const e = m.legAt(y, 1);
    return e ? ellipseOutline(e) : null;
  });
  const torsoRaw = memo((y: number): Outline | null => {
    if (o) return o.torso(y);
    const e = m.torsoAt(y);
    return e ? ellipseOutline(e) : null;
  });
  let legHi = m.morphHeights.hip + 4, legLo = 0;
  while (!legRaw(legHi) && legHi > 0) legHi -= 0.05;
  while (!legRaw(legLo) && legLo < legHi) legLo += 0.05;
  const leg = memo((y: number): Outline => {
    const at = Math.min(legHi, Math.max(legLo, Math.max(y, Math.min(m.morphHeights.ankle, legHi))));
    const raw = legRaw(at)!;
    const pts: P2[] = [];
    outlinePoints(raw, pts);
    return hullOutline(pts);
  });
  const round = memo((y: number): Outline | null => {
    const t = torsoRaw(y), l = y <= legHi && y >= legLo ? legRaw(y) : null;
    if (!t && !l) return null;
    const pts: P2[] = [];
    if (t) outlinePoints(t, pts);
    if (l) {
      outlinePoints(l, pts);
      outlinePoints(l, pts, true);
    }
    return hullOutline(pts, 0);
  });
  const crotch = m.landmarks.crotch[1];
  let centreLo = crotch;
  while (!torsoRaw(centreLo) && centreLo < crotch + 10) centreLo += 0.05;
  const centre = (y: number): { front: number; back: number } | null => (y < centreLo - 1e-9 ? null : centreDrawn(y));
  const centreDrawn = (y: number): { front: number; back: number } | null => {
    const t = torsoRaw(y);
    if (!t) return null;
    // The torso's centre is on the centre plane (the body is symmetric); the rays along ±z from it.
    return { front: t.cz + outlineRadius(t, Math.PI / 2), back: t.cz - outlineRadius(t, (3 * Math.PI) / 2) };
  };
  return { source: o ? 'drawn outlines' : 'ellipses', legLo, legHi, leg, legDrawn: legRaw, torsoDrawn: torsoRaw, round, centre, centreLo };
}
