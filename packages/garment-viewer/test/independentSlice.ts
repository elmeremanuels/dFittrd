/**
 * An independent plane slicer for the realistic body's tests (review of 21 Nov, finding 1). It shares no code with
 * the fit: not `sectionAt`, `sectionOf`, `ringReport` or `fitTargetOf` of `src/realisticBody.ts`, and not the
 * mannequin's `slice`. It cuts the mesh with the plane, chains the crossings into closed loops, and returns the
 * smallest closed loop that CONTAINS the plane origin: no nearest-loop fallback, so a ring centre outside the drawn
 * section reads as no section. The convex hull is a gift wrap (the fit's is a monotone chain).
 *
 * Adapted from the reviewer's measuring scripts (measure.ts, measlib.ts).
 */
export type V3 = [number, number, number];

export interface IndependentSection {
  /** Length of the closed loop, cm (the loop girth). */
  loopCm: number;
  /** Perimeter of its convex hull in the plane, cm (the tape girth). */
  tapeCm: number;
  /** Centre of the enclosed area, in plane coordinates (u, v) about the origin, cm. */
  centre: [number, number];
  /** Distance from the origin to the nearest point of the loop, cm (how far inside the ring centre is). */
  inset: number;
}

interface Chain {
  pts: V3[];
  closed: boolean;
}

function chains(P: ArrayLike<number>, I: ArrayLike<number>, o: V3, n: V3): Chain[] {
  const nv = P.length / 3;
  const d = new Float64Array(nv);
  for (let i = 0; i < nv; i++) {
    const s = (P[3 * i]! - o[0]) * n[0] + (P[3 * i + 1]! - o[1]) * n[1] + (P[3 * i + 2]! - o[2]) * n[2];
    d[i] = s === 0 ? 1e-9 : s;
  }
  const key = (a: number, b: number): number => (a < b ? a * nv + b : b * nv + a);
  const at = (a: number, b: number): V3 => {
    const t = d[a]! / (d[a]! - d[b]!);
    return [P[3 * a]! + t * (P[3 * b]! - P[3 * a]!), P[3 * a + 1]! + t * (P[3 * b + 1]! - P[3 * a + 1]!), P[3 * a + 2]! + t * (P[3 * b + 2]! - P[3 * a + 2]!)];
  };
  const adj = new Map<number, number[]>();
  const pos = new Map<number, V3>();
  for (let f = 0; f < I.length; f += 3) {
    const v = [I[f]!, I[f + 1]!, I[f + 2]!];
    const ks: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = v[e]!, b = v[(e + 1) % 3]!;
      if (d[a]! > 0 !== d[b]! > 0) {
        const k = key(a, b);
        if (!pos.has(k)) pos.set(k, at(a, b));
        ks.push(k);
      }
    }
    if (ks.length === 2) {
      for (const [x, y] of [[ks[0]!, ks[1]!], [ks[1]!, ks[0]!]] as const) {
        const list = adj.get(x);
        if (list) list.push(y);
        else adj.set(x, [y]);
      }
    }
  }
  const seen = new Set<number>();
  const out: Chain[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const chain = [start];
    seen.add(start);
    let prev = -1, cur = start, closed = false;
    for (;;) {
      const nb = (adj.get(cur) ?? []).filter((x) => x !== prev);
      const next = nb.find((x) => !seen.has(x));
      if (next === undefined) {
        closed = chain.length > 2 && (adj.get(cur) ?? []).includes(start);
        break;
      }
      prev = cur;
      cur = next;
      seen.add(cur);
      chain.push(cur);
    }
    out.push({ pts: chain.map((k) => pos.get(k)!), closed });
  }
  return out;
}

function giftWrap(s: readonly [number, number][]): number {
  if (s.length < 3) return 0;
  const start = s.reduce((a, b) => (b[0] < a[0] ? b : a));
  const hull: [number, number][] = [];
  let p = start;
  do {
    hull.push(p);
    let c = s[0]!;
    for (const r of s) {
      if (c === p) {
        c = r;
        continue;
      }
      const cr = (c[0] - p[0]) * (r[1] - p[1]) - (c[1] - p[1]) * (r[0] - p[0]);
      if (cr < 0 || (cr === 0 && Math.hypot(r[0] - p[0], r[1] - p[1]) > Math.hypot(c[0] - p[0], c[1] - p[1]))) c = r;
    }
    p = c;
  } while (p !== start && hull.length <= s.length);
  let l = 0;
  for (let i = 0; i < hull.length; i++) l += Math.hypot(hull[(i + 1) % hull.length]![0] - hull[i]![0], hull[(i + 1) % hull.length]![1] - hull[i]![1]);
  return l;
}

/** The smallest closed section round the plane origin `o` (normal `n`, in-plane axes `u`, `v`), or null when none contains it. */
export function sectionRound(P: ArrayLike<number>, I: ArrayLike<number>, o: V3, n: V3, u: V3, v: V3): IndependentSection | null {
  let best: (IndependentSection & { area: number }) | null = null;
  for (const c of chains(P, I, o, n)) {
    if (!c.closed) continue;
    const q = c.pts.map((p): [number, number] => {
      const r = [p[0] - o[0], p[1] - o[1], p[2] - o[2]] as const;
      return [r[0] * u[0] + r[1] * u[1] + r[2] * u[2], r[0] * v[0] + r[1] * v[1] + r[2] * v[2]];
    });
    let inside = false, a = 0, cx = 0, cy = 0, len = 0, inset = Infinity;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const [xi, yi] = q[i]!;
      const [xj, yj] = q[j]!;
      if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
      const k = xj * yi - xi * yj;
      a += k;
      cx += (xi + xj) * k;
      cy += (yi + yj) * k;
      len += Math.hypot(c.pts[i]![0] - c.pts[j]![0], c.pts[i]![1] - c.pts[j]![1], c.pts[i]![2] - c.pts[j]![2]);
      inset = Math.min(inset, Math.hypot(xi, yi));
    }
    if (!inside) continue;
    if (!best || Math.abs(a) < best.area) best = { loopCm: len, tapeCm: giftWrap(q), centre: [cx / (3 * a), cy / (3 * a)], inset, area: Math.abs(a) };
  }
  return best ? { loopCm: best.loopCm, tapeCm: best.tapeCm, centre: best.centre, inset: best.inset } : null;
}

/** A ring frame mirrored to the body's right side (x → −x). */
export function mirrored<T extends { centre: V3; normal: V3; u: V3; v: V3 }>(r: T): T {
  const m = (x: V3): V3 => [-x[0], x[1], x[2]];
  return { ...r, centre: m(r.centre), normal: m(r.normal), u: m(r.u), v: m(r.v) };
}
