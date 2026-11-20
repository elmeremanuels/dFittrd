/**
 * Short position-based cloth relaxation (docs/ENGINE-HANDOFF.md §Fitting step 4): about 1–2 s of
 * simulated time with gravity, edge (stretch) and cross-edge (bend) distance constraints, the
 * shoulder yoke pinned, and collision against the avatar after every substep. Deterministic: same
 * input, same output. No DOM, no three.js, so it is unit-tested in node.
 *
 * Spike simplifications: fixed iteration PBD (not XPBD), bending as distance constraints across
 * each interior edge, and a small "cling" pull towards the body axis that grows with the fabric's
 * drape so a fluid fabric settles closer to the body than a crisp one. Stage 7 replaces the cling
 * heuristic with the calibrated drape simulation.
 *
 * Step-3 control (docs/research/shortcut-to-step3.md, days 1-2): the cling pull can be switched off
 * (`clothParams(…, { cling: false })`), and girth loops (`setLoops`) can hold a ring of particles
 * (hip, hem) at no less than a share of its graded girth, so the drape cannot fold a larger size's
 * extra girth away. Both are off unless asked for.
 */

export interface ClothParams {
  /** cm/s², along −Y. */
  gravity: number;
  /** Frame time step, s. */
  dt: number;
  substeps: number;
  iterations: number;
  /** 0..1 PBD stiffness of the edges (1 = inextensible). */
  stretchStiffness: number;
  /** 0..1 PBD stiffness of the cross-edge bend constraints. */
  bendStiffness: number;
  /** Velocity decay per second. */
  damping: number;
  /** Horizontal pull towards the body axis on free body-chain particles, cm/s² (0 = off). */
  clingAccel: number;
  /** 0..1 share of a girth loop's shortfall corrected per projection (`setLoops`; no loops, no effect). */
  loopStiffness: number;
  /** Simulated duration of one relaxation, s (the cap). */
  durationS: number;
  /** Early exit: the drape counts as settled once no particle moves more than `calmCm` per substep for `calmFrames` frames in a row, after at least `minDurationS`. */
  calmCm: number;
  calmFrames: number;
  minDurationS: number;
}

/** What the solver reads from material.json or a fabric preset (`@curtain/schema` fabric library values). */
export interface ClothMaterial {
  drape: number;
  /** KES-F B, gf·cm²/cm (silk ≈ 0.03, linen ≈ 0.2, denim ≈ 0.8). */
  bendStiffness: number;
  stretchPct: number;
  simulation: { damping?: number };
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Cling pull of a fabric, cm/s²: grows with drape (the heuristic the step-3 control switches off). */
export const clingAccelOf = (drape: number): number => 90 * drape * drape;

/** Default `ClothParams.loopStiffness`. */
export const LOOP_STIFFNESS = 0.5;

/**
 * Map fabric data to solver settings. Bend stiffness is log-mapped (the library spans two decades);
 * stretch fabrics get softer edges; drape drives the cling pull and lowers damping. `opts.cling`
 * false switches the cling pull off (default on).
 */
export function clothParams(mat: ClothMaterial, durationS = 1.5, opts: { cling?: boolean } = {}): ClothParams {
  const bendT = clamp((Math.log10(Math.max(mat.bendStiffness, 0.005)) + 2) / 2.2, 0, 1); // 0.01 → 0, ~1.6 → 1
  return {
    gravity: 981,
    dt: 1 / 60,
    substeps: 2,
    iterations: 6,
    stretchStiffness: clamp(1 - mat.stretchPct / 100, 0.6, 1),
    bendStiffness: 0.02 + 0.9 * bendT * bendT,
    damping: 2.5 + 6 * (mat.simulation.damping ?? 0.1) + 3 * (1 - mat.drape),
    clingAccel: opts.cling === false ? 0 : clingAccelOf(mat.drape),
    loopStiffness: LOOP_STIFFNESS,
    durationS,
    calmCm: 0.02,
    calmFrames: 6,
    minDurationS: Math.min(durationS, 0.5),
  };
}

export interface Cloth {
  pos: Float32Array;
  prev: Float32Array;
  /** 0 = pinned. */
  invMass: Float32Array;
  /** Pin targets (the placed positions). */
  anchor: Float32Array;
  /** Body-chain particles get the cling pull; sleeves do not. */
  cling: Uint8Array;
  edges: Uint32Array;
  edgeRest: Float32Array;
  bends: Uint32Array;
  bendRest: Float32Array;
  /** Long-range attachment per particle: nearest pinned particle (−1: none) and the geodesic rest distance to it. */
  tether: Int32Array;
  tetherRest: Float32Array;
  /** Soft hold per particle: a free particle stays within this many cm of its anchor (0 = none; a gathered cuff, `engine.CUFF_LEASH_CM`). */
  leash: Float32Array;
  /** Girth loops (`setLoops`): particles of loop k are `loops[loopStart[k]..loopStart[k+1]]`; its convex hull in x–z is held at no less than `loopMin[k]` cm. */
  loops: Int32Array;
  loopStart: Int32Array;
  loopMin: Float32Array;
  /** Simulated time so far, s. */
  time: number;
  /** Frames in a row whose largest particle move stayed under `ClothParams.calmCm`. */
  calmFrames: number;
}

/** Unique undirected edges and, per interior edge, the two opposite vertices. */
export function meshEdges(indices: ArrayLike<number>): { edges: Uint32Array; bends: Uint32Array } {
  const map = new Map<number, number>(); // key → opposite vertex of the first triangle, or −1 once paired
  const edges: number[] = [];
  const bends: number[] = [];
  let n = 1;
  for (let t = 0; t < indices.length; t++) n = Math.max(n, indices[t]! + 1);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k]!;
      const b = indices[t + ((k + 1) % 3)]!;
      const c = indices[t + ((k + 2) % 3)]!;
      const key = a < b ? a * n + b : b * n + a;
      const seen = map.get(key);
      if (seen === undefined) {
        map.set(key, c);
        edges.push(a, b);
      } else if (seen >= 0) {
        if (seen !== c) bends.push(seen, c);
        map.set(key, -1);
      }
    }
  }
  return { edges: Uint32Array.from(edges), bends: Uint32Array.from(bends) };
}

/**
 * Geodesic rest distance from every particle to its nearest pinned particle along the edges
 * (multi-source Dijkstra). Used as long-range attachments (Kim, Chentanez and Müller 2012): a
 * particle may never be farther from its pin than this, which stops the sag that few PBD iterations
 * leave in a long hanging garment.
 */
export function tethers(n: number, edges: Uint32Array, edgeRest: Float32Array, isPinned: (i: number) => boolean): { tether: Int32Array; tetherRest: Float32Array } {
  const adjStart = new Int32Array(n + 1);
  for (let e = 0; e < edges.length; e++) adjStart[edges[e]! + 1]!++;
  for (let i = 0; i < n; i++) adjStart[i + 1]! += adjStart[i]!;
  const fill = adjStart.slice(0, n);
  const adj = new Int32Array(edges.length);
  const adjW = new Float32Array(edges.length);
  for (let e = 0; e < edges.length / 2; e++) {
    const a = edges[2 * e]!;
    const b = edges[2 * e + 1]!;
    adj[fill[a]!] = b;
    adjW[fill[a]!++] = edgeRest[e]!;
    adj[fill[b]!] = a;
    adjW[fill[b]!++] = edgeRest[e]!;
  }
  const d = new Float64Array(n).fill(Infinity);
  const src = new Int32Array(n).fill(-1);
  // Binary heap of (distance, particle).
  const heapD: number[] = [];
  const heapI: number[] = [];
  const push = (dd: number, i: number): void => {
    let k = heapD.length;
    heapD.push(dd);
    heapI.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p]! <= dd) break;
      heapD[k] = heapD[p]!;
      heapI[k] = heapI[p]!;
      k = p;
    }
    heapD[k] = dd;
    heapI[k] = i;
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heapD[0]!, heapI[0]!];
    const lastD = heapD.pop()!;
    const lastI = heapI.pop()!;
    const len = heapD.length;
    if (len > 0) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= len) break;
        if (c + 1 < len && heapD[c + 1]! < heapD[c]!) c++;
        if (heapD[c]! >= lastD) break;
        heapD[k] = heapD[c]!;
        heapI[k] = heapI[c]!;
        k = c;
      }
      heapD[k] = lastD;
      heapI[k] = lastI;
    }
    return top;
  };
  for (let i = 0; i < n; i++) {
    if (!isPinned(i)) continue;
    d[i] = 0;
    src[i] = i;
    push(0, i);
  }
  while (heapD.length > 0) {
    const [dd, i] = pop();
    if (dd > d[i]!) continue;
    for (let k = adjStart[i]!; k < adjStart[i + 1]!; k++) {
      const j = adj[k]!;
      const nd = dd + adjW[k]!;
      if (nd < d[j]!) {
        d[j] = nd;
        src[j] = src[i]!;
        push(nd, j);
      }
    }
  }
  const tetherRest = new Float32Array(n);
  for (let i = 0; i < n; i++) tetherRest[i] = Number.isFinite(d[i]!) ? d[i]! : 0;
  return { tether: src, tetherRest };
}

const dist = (p: ArrayLike<number>, a: number, b: number): number => Math.hypot(p[3 * a]! - p[3 * b]!, p[3 * a + 1]! - p[3 * b + 1]!, p[3 * a + 2]! - p[3 * b + 2]!);

/**
 * @param start  placed positions (the solver starts here and pins to them)
 * @param rest   positions whose edge lengths are the cloth's rest lengths (the graded, unstretched garment)
 * @param pinned particles held at `start` (the shoulder yoke)
 * @param cling  particles that get the cling pull (body chain)
 */
export function createCloth(start: ArrayLike<number>, rest: ArrayLike<number>, indices: ArrayLike<number>, pinned: (i: number) => boolean, cling: (i: number) => boolean): Cloth {
  const n = start.length / 3;
  const pos = Float32Array.from(start);
  const { edges, bends } = meshEdges(indices);
  const edgeRest = new Float32Array(edges.length / 2);
  for (let e = 0; e < edgeRest.length; e++) edgeRest[e] = dist(rest, edges[2 * e]!, edges[2 * e + 1]!);
  const bendRest = new Float32Array(bends.length / 2);
  for (let e = 0; e < bendRest.length; e++) bendRest[e] = dist(rest, bends[2 * e]!, bends[2 * e + 1]!);
  const invMass = new Float32Array(n);
  const cl = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    invMass[i] = pinned(i) ? 0 : 1;
    cl[i] = cling(i) ? 1 : 0;
  }
  const { tether, tetherRest } = tethers(n, edges, edgeRest, (i) => invMass[i] === 0);
  return { pos, prev: Float32Array.from(pos), invMass, anchor: Float32Array.from(pos), cling: cl, edges, edgeRest, bends, bendRest, tether, tetherRest, leash: new Float32Array(n), loops: new Int32Array(0), loopStart: new Int32Array(1), loopMin: new Float32Array(0), time: 0, calmFrames: 0 };
}

export interface GirthLoop {
  particles: readonly number[];
  /** Smallest girth (convex hull perimeter in x–z) the loop may fold to, cm. */
  minGirthCm: number;
}

/** Install girth loops on a cloth (replaces any it had). */
export function setLoops(cloth: Cloth, loops: readonly GirthLoop[]): void {
  const start = new Int32Array(loops.length + 1);
  for (let k = 0; k < loops.length; k++) start[k + 1] = start[k]! + loops[k]!.particles.length;
  const flat = new Int32Array(start[loops.length]!);
  for (let k = 0; k < loops.length; k++) flat.set(loops[k]!.particles, start[k]!);
  cloth.loops = flat;
  cloth.loopStart = start;
  cloth.loopMin = Float32Array.from(loops, (l) => l.minGirthCm);
}

/**
 * Perimeter of the convex hull in x–z of particles `ids[from..to)` (Andrew's monotone chain). `order`
 * and `hull` are scratch of at least `to − from` entries.
 */
export function loopGirth(pos: ArrayLike<number>, ids: ArrayLike<number>, from: number, to: number, order: number[], hull: Int32Array): number {
  const m = to - from;
  if (m < 3) return 0;
  order.length = m;
  for (let k = 0; k < m; k++) order[k] = ids[from + k]!;
  order.sort((a, b) => pos[3 * a]! - pos[3 * b]! || pos[3 * a + 2]! - pos[3 * b + 2]!);
  const cross = (o: number, a: number, b: number): number => (pos[3 * a]! - pos[3 * o]!) * (pos[3 * b + 2]! - pos[3 * o + 2]!) - (pos[3 * a + 2]! - pos[3 * o + 2]!) * (pos[3 * b]! - pos[3 * o]!);
  let h = 0;
  for (let k = 0; k < m; k++) {
    while (h >= 2 && cross(hull[h - 2]!, hull[h - 1]!, order[k]!) <= 0) h--;
    hull[h++] = order[k]!;
  }
  const lower = h + 1;
  for (let k = m - 2; k >= 0; k--) {
    while (h >= lower && cross(hull[h - 2]!, hull[h - 1]!, order[k]!) <= 0) h--;
    hull[h++] = order[k]!;
  }
  let per = 0;
  for (let k = 0; k < h - 1; k++) per += Math.hypot(pos[3 * hull[k + 1]!]! - pos[3 * hull[k]!]!, pos[3 * hull[k + 1]! + 2]! - pos[3 * hull[k]! + 2]!);
  return per;
}

const loopScratch: { order: number[]; hull: Int32Array } = { order: [], hull: new Int32Array(0) };

/**
 * Girth loops: a loop whose hull girth fell below its minimum is widened about its own centre (x–z
 * only) by `k` of the shortfall. One-sided, like a hoop: it never pulls a loop in, so it cannot
 * fight collision, which runs after it.
 */
function projectLoops(pos: Float32Array, w: Float32Array, cloth: Cloth, k: number): void {
  const { loops, loopStart, loopMin } = cloth;
  for (let l = 0; l < loopMin.length; l++) {
    const a = loopStart[l]!;
    const b = loopStart[l + 1]!;
    if (loopScratch.hull.length < b - a + 1) loopScratch.hull = new Int32Array(2 * (b - a + 1));
    const g = loopGirth(pos, loops, a, b, loopScratch.order, loopScratch.hull);
    if (g <= 1e-6 || g >= loopMin[l]!) continue;
    let cx = 0;
    let cz = 0;
    for (let j = a; j < b; j++) {
      cx += pos[3 * loops[j]!]!;
      cz += pos[3 * loops[j]! + 2]!;
    }
    cx /= b - a;
    cz /= b - a;
    const s = 1 + k * (loopMin[l]! / g - 1);
    for (let j = a; j < b; j++) {
      const i = loops[j]!;
      if (w[i] === 0) continue;
      pos[3 * i] = cx + (pos[3 * i]! - cx) * s;
      pos[3 * i + 2] = cz + (pos[3 * i + 2]! - cz) * s;
    }
  }
}

function project(pos: Float32Array, w: Float32Array, pairs: Uint32Array, restLen: Float32Array, k: number): void {
  for (let e = 0; e < restLen.length; e++) {
    const a = pairs[2 * e]!;
    const b = pairs[2 * e + 1]!;
    const wa = w[a]!;
    const wb = w[b]!;
    const ws = wa + wb;
    if (ws === 0) continue;
    const dx = pos[3 * b]! - pos[3 * a]!;
    const dy = pos[3 * b + 1]! - pos[3 * a + 1]!;
    const dz = pos[3 * b + 2]! - pos[3 * a + 2]!;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-9) continue;
    const c = ((d - restLen[e]!) / (d * ws)) * k;
    pos[3 * a] = pos[3 * a]! + wa * c * dx;
    pos[3 * a + 1] = pos[3 * a + 1]! + wa * c * dy;
    pos[3 * a + 2] = pos[3 * a + 2]! + wa * c * dz;
    pos[3 * b] = pos[3 * b]! - wb * c * dx;
    pos[3 * b + 1] = pos[3 * b + 1]! - wb * c * dy;
    pos[3 * b + 2] = pos[3 * b + 2]! - wb * c * dz;
  }
}

/** Pull every free particle back inside the sphere of its tether's rest length around its pin. */
function projectTethers(pos: Float32Array, w: Float32Array, tether: Int32Array, rest: Float32Array): void {
  for (let i = 0; i < tether.length; i++) {
    const p = tether[i]!;
    if (p < 0 || w[i] === 0) continue;
    const dx = pos[3 * i]! - pos[3 * p]!;
    const dy = pos[3 * i + 1]! - pos[3 * p + 1]!;
    const dz = pos[3 * i + 2]! - pos[3 * p + 2]!;
    const r = rest[i]!;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= r * r || d2 < 1e-18) continue;
    const d = Math.sqrt(d2);
    const k = r / d;
    pos[3 * i] = pos[3 * p]! + dx * k;
    pos[3 * i + 1] = pos[3 * p + 1]! + dy * k;
    pos[3 * i + 2] = pos[3 * p + 2]! + dz * k;
  }
}

/** Pull every leashed free particle back inside the sphere of its leash round its anchor. */
function projectLeashes(pos: Float32Array, w: Float32Array, anchor: Float32Array, leash: Float32Array): void {
  for (let i = 0; i < leash.length; i++) {
    const r = leash[i]!;
    if (r <= 0 || w[i] === 0) continue;
    const dx = pos[3 * i]! - anchor[3 * i]!;
    const dy = pos[3 * i + 1]! - anchor[3 * i + 1]!;
    const dz = pos[3 * i + 2]! - anchor[3 * i + 2]!;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= r * r) continue;
    const k = r / Math.sqrt(d2);
    pos[3 * i] = anchor[3 * i]! + dx * k;
    pos[3 * i + 1] = anchor[3 * i + 1]! + dy * k;
    pos[3 * i + 2] = anchor[3 * i + 2]! + dz * k;
  }
}

export type Collide = (pos: Float32Array, i: number) => boolean;

/**
 * Static pre-solve of the pinned particles (no gravity, no time): they move under the edge
 * constraints and collision while every free particle is held, then they are pinned where they
 * ended up. Pins are never projected by the solver, so an edge between two pins that starts
 * stretched stays stretched (the neckline tear on small sizes); this settles the pinned set onto
 * the body first. Returns the largest edge strain between two pinned particles afterwards.
 */
export function settlePins(cloth: Cloth, collide: Collide | null, iterations = 40): number {
  const { pos, invMass } = cloth;
  const n = invMass.length;
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = invMass[i] === 0 ? 1 : 0;
  for (let it = 0; it < iterations; it++) {
    project(pos, w, cloth.edges, cloth.edgeRest, 1);
    if (collide) for (let i = 0; i < n; i++) if (w[i] !== 0) collide(pos, i);
  }
  cloth.prev.set(pos);
  cloth.anchor.set(pos);
  let worst = 0;
  for (let e = 0; e < cloth.edgeRest.length; e++) {
    const a = cloth.edges[2 * e]!;
    const b = cloth.edges[2 * e + 1]!;
    if (invMass[a] !== 0 || invMass[b] !== 0 || cloth.edgeRest[e]! <= 0) continue;
    worst = Math.max(worst, dist(pos, a, b) / cloth.edgeRest[e]! - 1);
  }
  return worst;
}

/** Advance by `frames` frames of `params.dt`. Returns the largest particle displacement of the last substep (cm), a settle signal. */
export function stepCloth(cloth: Cloth, params: ClothParams, collide: Collide | null, frames = 1): number {
  const { pos, prev, invMass, cling } = cloth;
  const n = invMass.length;
  const h = params.dt / params.substeps;
  // Per-iteration stiffness so the result does not depend on the iteration count (Müller et al. 2007).
  const kS = 1 - Math.pow(1 - params.stretchStiffness, 1 / params.iterations);
  const kB = 1 - Math.pow(1 - params.bendStiffness, 1 / params.iterations);
  const keep = Math.exp(-params.damping * h);
  let maxMove = 0;
  for (let f = 0; f < frames; f++) {
    for (let s = 0; s < params.substeps; s++) {
      maxMove = 0;
      for (let i = 0; i < n; i++) {
        if (invMass[i] === 0) continue;
        const x = pos[3 * i]!;
        const y = pos[3 * i + 1]!;
        const z = pos[3 * i + 2]!;
        let ax = 0;
        let az = 0;
        if (cling[i] === 1 && params.clingAccel > 0) {
          const r = Math.sqrt(x * x + z * z) || 1;
          ax = (-x / r) * params.clingAccel;
          az = (-z / r) * params.clingAccel;
        }
        pos[3 * i] = x + (x - prev[3 * i]!) * keep + ax * h * h;
        pos[3 * i + 1] = y + (y - prev[3 * i + 1]!) * keep - params.gravity * h * h;
        pos[3 * i + 2] = z + (z - prev[3 * i + 2]!) * keep + az * h * h;
        prev[3 * i] = x;
        prev[3 * i + 1] = y;
        prev[3 * i + 2] = z;
      }
      for (let it = 0; it < params.iterations; it++) {
        projectTethers(pos, invMass, cloth.tether, cloth.tetherRest);
        project(pos, invMass, cloth.edges, cloth.edgeRest, kS);
        project(pos, invMass, cloth.bends, cloth.bendRest, kB);
        // After the edges, so a leash holds as a constraint and not only as a start point (collision still wins).
        projectLeashes(pos, invMass, cloth.anchor, cloth.leash);
        const mid = it === params.iterations - 1 || it === params.iterations >> 1;
        // Girth loops at the collision points (twice a substep): the hull sort is the costly part.
        if (mid && cloth.loopMin.length > 0 && params.loopStiffness > 0) projectLoops(pos, invMass, cloth, params.loopStiffness);
        // Collide halfway and after the last iteration: enough to keep the cloth out, at a third of the cost.
        if (collide && mid) for (let i = 0; i < n; i++) if (invMass[i] !== 0) collide(pos, i);
      }
      for (let i = 0; i < n; i++) {
        if (invMass[i] === 0) continue;
        const mx = pos[3 * i]! - prev[3 * i]!;
        const my = pos[3 * i + 1]! - prev[3 * i + 1]!;
        const mz = pos[3 * i + 2]! - prev[3 * i + 2]!;
        const m2 = mx * mx + my * my + mz * mz;
        if (m2 > maxMove) maxMove = m2;
      }
    }
    cloth.time += params.dt;
    cloth.calmFrames = maxMove < params.calmCm * params.calmCm ? cloth.calmFrames + 1 : 0;
  }
  return Math.sqrt(maxMove);
}

/** At the duration cap, or calm (see `ClothParams.calmCm`) after the minimum duration. */
export function isSettled(cloth: Cloth, params: ClothParams): boolean {
  if (cloth.time >= params.durationS - 1e-9) return true;
  return cloth.time >= params.minDurationS - 1e-9 && params.calmFrames > 0 && cloth.calmFrames >= params.calmFrames;
}

/** Relative stretch of every edge against its rest length (0.05 = 5 % longer), sorted ascending. */
export function edgeStrains(cloth: Cloth): Float32Array {
  const out = new Float32Array(cloth.edgeRest.length);
  for (let e = 0; e < out.length; e++) {
    const r = cloth.edgeRest[e]!;
    out[e] = r > 0 ? dist(cloth.pos, cloth.edges[2 * e]!, cloth.edges[2 * e + 1]!) / r - 1 : 0;
  }
  return out.sort();
}

/** Strain at quantile `q` (1 = the largest). */
export function strainQuantile(cloth: Cloth, q: number): number {
  const s = edgeStrains(cloth);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]! : 0;
}
