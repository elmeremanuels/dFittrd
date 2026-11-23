/**
 * Preserved v1 strand-card procedural hair (branch `claude/hair-strand-cards-v1`, b80a9d2), kept available behind
 * `style: 'strand-cards'` so it can sit alongside the sculpted v2 locks (and later power CUR-31 loose accent strands).
 * Pure (no WebGL, no I/O).
 */
import type { HairChoice, HairLength, HairType } from './hairOptions';
import {
  HAIR_TRIANGLE_BUDGET,
  HairSpace,
  PartWriter,
  add,
  azElOf,
  clamp,
  cross,
  dot,
  hairlineEl,
  headModel,
  headRadius,
  len,
  norm,
  resample,
  rng,
  scalpDirections,
  scalpGrid,
  seedOf,
  smooth,
  sub,
  torsoModel,
  withMips,
  type HairBodyInput,
  type HairBuild,
  type HairLook,
  type HairPart,
  type HairTexture,
  type HeadModel,
  type V3,
} from './realisticHair';

const DEG = Math.PI / 180;

interface CardTypeParams {
  kind: 'straight' | 'wave' | 'curl' | 'coil';
  amp: number;
  period: number;
  zig: number;
  width: number;
  push: number;
  gravity: number;
  lift: number;
  shrink: number;
  thickness: number;
  volume: Record<HairLength, number>;
  count: number;
  look: HairLook;
}

const NO_VOLUME = { short: 0, chin: 0, shoulder: 0, long: 0 };

const CARD_TYPE_PARAMS: Readonly<Record<HairType, CardTypeParams>> = {
  '1': { kind: 'straight', amp: 0, period: 1, zig: 0, width: 2.25, push: 0, gravity: 0.38, lift: 0.08, shrink: 1, thickness: 0.8, volume: NO_VOLUME, count: 128, look: { roughness: 0.34, anisotropy: 0.9, specular: 0.75, coilTileCm: 3 } },
  '2A': { kind: 'wave', amp: 0.6, period: 10, zig: 0, width: 2.25, push: 0.01, gravity: 0.34, lift: 0.12, shrink: 0.97, thickness: 1.0, volume: NO_VOLUME, count: 125, look: { roughness: 0.4, anisotropy: 0.85, specular: 0.65, coilTileCm: 3 } },
  '2B': { kind: 'wave', amp: 1.0, period: 7.5, zig: 0, width: 2.25, push: 0.025, gravity: 0.31, lift: 0.18, shrink: 0.93, thickness: 1.3, volume: NO_VOLUME, count: 122, look: { roughness: 0.44, anisotropy: 0.8, specular: 0.6, coilTileCm: 3 } },
  '2C': { kind: 'wave', amp: 1.35, period: 5.6, zig: 0, width: 2.35, push: 0.04, gravity: 0.28, lift: 0.24, shrink: 0.9, thickness: 1.7, volume: NO_VOLUME, count: 118, look: { roughness: 0.48, anisotropy: 0.75, specular: 0.55, coilTileCm: 3 } },
  '3A': { kind: 'curl', amp: 1.15, period: 4, zig: 0, width: 2.3, push: 0.03, gravity: 0.28, lift: 0.15, shrink: 0.85, thickness: 2.2, volume: NO_VOLUME, count: 105, look: { roughness: 0.5, anisotropy: 0.7, specular: 0.5, coilTileCm: 3 } },
  '3B': { kind: 'curl', amp: 0.9, period: 2.6, zig: 0, width: 2.05, push: 0.045, gravity: 0.26, lift: 0.2, shrink: 0.78, thickness: 2.8, volume: NO_VOLUME, count: 102, look: { roughness: 0.55, anisotropy: 0.6, specular: 0.45, coilTileCm: 3 } },
  '3C': { kind: 'curl', amp: 0.6, period: 1.6, zig: 0, width: 1.6, push: 0.06, gravity: 0.24, lift: 0.25, shrink: 0.7, thickness: 3.2, volume: { short: 1.2, chin: 2.4, shoulder: 3.4, long: 4.4 }, count: 100, look: { roughness: 0.6, anisotropy: 0.5, specular: 0.4, coilTileCm: 5 } },
  '4A': { kind: 'coil', amp: 0.45, period: 1.1, zig: 0.15, width: 1.05, push: 0, gravity: 0, lift: 1, shrink: 0.55, thickness: 0, volume: { short: 2.2, chin: 4.4, shoulder: 7.2, long: 10.5 }, count: 145, look: { roughness: 0.66, anisotropy: 0.4, specular: 0.35, coilTileCm: 4.5 } },
  '4B': { kind: 'coil', amp: 0.4, period: 0.8, zig: 0.7, width: 0.95, push: 0, gravity: 0, lift: 1, shrink: 0.5, thickness: 0, volume: { short: 2.5, chin: 5, shoulder: 8.2, long: 12 }, count: 155, look: { roughness: 0.72, anisotropy: 0.3, specular: 0.3, coilTileCm: 4 } },
  '4C': { kind: 'coil', amp: 0.32, period: 0.55, zig: 1, width: 0.85, push: 0, gravity: 0, lift: 1, shrink: 0.45, thickness: 0, volume: { short: 2.8, chin: 5.6, shoulder: 9.2, long: 13.5 }, count: 165, look: { roughness: 0.78, anisotropy: 0.22, specular: 0.25, coilTileCm: 3.5 } },
};

interface CardGuide {
  pts: V3[];
  layer: number;
  phase: number;
  root: V3;
}

function cutYCards(length: HairLength, p: CardTypeParams, head: HeadModel, ring: HairBodyInput['ringY']): number {
  const y = length === 'short' ? head.chin + 5 : length === 'chin' ? head.chin + 1.5 : length === 'shoulder' ? ring.shoulder + 0.5 : (ring.chest + ring.underbust) / 2 - 2;
  return head.top - (head.top - y) * p.shrink;
}

function growCardGuide(space: HairSpace, root: V3, p: CardTypeParams, length: HairLength, yEnd: number, layer: number, rand: () => number, vol: number): CardGuide {
  const head = space.head;
  const hs = head.scale;
  const reach = p.kind === 'wave' ? 0.4 * p.amp : p.amp;
  const ch = 0.35 + reach + layer * p.thickness;
  const ct = 0.9 + reach + layer * p.thickness * 0.6;
  const n = norm(sub(root, head.c));
  const [az] = azElOf(n);
  const front = clamp(Math.cos(az), 0, 1);
  const sx = Math.abs(root[0] - head.c[0]) > 0.3 ? Math.sign(root[0] - head.c[0]) : rand() < 0.5 ? -1 : 1;
  const want: V3 = [sx * (0.35 + 1.3 * front), -1, -0.35 * front];
  const comb = norm(sub(want, [n[0] * dot(want, n), n[1] * dot(want, n), n[2] * dot(want, n)]));
  let d = norm(add(comb, n, p.lift / Math.max(0.05, 1 - p.lift)));
  let q = space.push(add(root, n, ch), ch, ct);
  const pts: V3[] = [q];
  const ds = 1;
  const maxLen = length === 'short' ? (p.kind === 'curl' ? 4.5 : 6.5) * hs : 95;
  for (let s = 0; s < maxLen; s += ds) {
    const out = space.outward(q);
    d = norm(add(add(d, [0, -p.gravity, 0]), out, p.push * (1 + 0.15 * vol)));
    const next = space.push(add(q, d, ds), ch, ct);
    const step = sub(next, q);
    if (len(step) > 1e-4) d = norm(step);
    q = next;
    pts.push(q);
    if (q[1] < yEnd) break;
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
      pts[i] = space.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4], ch, ct);
    }
  }
  return { pts, layer, phase: rand() * 2 * Math.PI, root };
}

function ribbon(w: PartWriter, centre: V3[], side: V3[], face: V3[], width: number[], ao: (i: number) => number): void {
  const n = centre.length;
  if (n < 2) return;
  const base = w.vertices;
  for (let i = 0; i < n; i++) {
    const t = norm(sub(centre[Math.min(n - 1, i + 1)]!, centre[Math.max(0, i - 1)]!));
    const h = width[i]! / 2;
    const v = i / (n - 1);
    w.vertex(add(centre[i]!, side[i]!, -h), face[i]!, t, 0, v, ao(i), 1);
    w.vertex(add(centre[i]!, side[i]!, h), face[i]!, t, 1, v, ao(i), 1);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + 2 * i;
    w.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

function clumpOf(w: PartWriter, space: HairSpace, g: CardGuide, p: CardTypeParams, widthScale: number): void {
  const curly = p.kind === 'curl' || p.kind === 'coil';
  const step = p.kind === 'straight' ? 2.0 : p.kind === 'wave' ? p.period / 5.5 : p.kind === 'curl' ? p.period / (p.period < 2 ? 4.0 : 4.8) : p.period / 4.0;
  const P = resample(g.pts, step);
  const n = P.length;
  if (n < 2) return;
  const total = (n - 1) * step;
  const centre: V3[] = [], side: V3[] = [], face: V3[] = [], width: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = i * step;
    const T = norm(sub(P[Math.min(n - 1, i + 1)]!, P[Math.max(0, i - 1)]!));
    let out = space.outward(P[i]!);
    out = norm(sub(out, [T[0] * dot(out, T), T[1] * dot(out, T), T[2] * dot(out, T)]));
    const round = norm(cross([0, 1, 0], out));
    const rb = sub(round, [T[0] * dot(round, T), T[1] * dot(round, T), T[2] * dot(round, T)]);
    const B = len(rb) > 0.3 ? norm(rb) : norm(cross(T, out));
    out = norm(cross(B, T));
    const ramp = smooth(0, curly ? 2.5 : 6, s) * (p.kind === 'wave' ? 0.6 + 0.4 * smooth(0, 25, s) : 1);
    const th = (2 * Math.PI * s) / p.period + g.phase;
    if (p.kind === 'straight') {
      centre.push(P[i]!);
      side.push(B);
      face.push(out);
      width.push(p.width * widthScale * (1 + 0.25 * (s / Math.max(1, total))));
    } else if (p.kind === 'wave') {
      const a = p.amp * ramp;
      centre.push(add(add(P[i]!, B, a * Math.sin(th)), out, 0.35 * a * Math.cos(th)));
      side.push(B);
      face.push(norm(add(out, T, -0.35 * Math.cos(th) * (a / p.amp || 0))));
      width.push(p.width * widthScale);
    } else {
      const zz = (x: number): number => (2 / Math.PI) * Math.asin(Math.sin(x));
      const cx = (1 - p.zig) * Math.cos(th) + p.zig * zz(th + Math.PI / 2);
      const cy = (1 - p.zig) * Math.sin(th) + p.zig * zz(th);
      const r = p.amp * ramp;
      const radial = norm(add([B[0] * cx, B[1] * cx, B[2] * cx], out, cy));
      centre.push(add(add(P[i]!, B, r * cx), out, r * cy));
      side.push(T);
      face.push(radial);
      width.push(p.width * widthScale * (0.7 + 0.3 * ramp));
    }
  }
  const layerAo = 0.62 + 0.38 * g.layer;
  ribbon(w, centre, side, face, width, (i) => layerAo * (0.55 + 0.45 * smooth(0, 5, i * step)));
}

/** Build the preserved v1 strand-card hair (`style: 'strand-cards'`). */
export function buildStrandCardsHair(input: HairBodyInput, choice: HairChoice, options: { countScale?: number } = {}): HairBuild {
  const head = headModel(input);
  const torso = torsoModel(input, head);
  const space = new HairSpace(head, torso);
  const p = CARD_TYPE_PARAMS[choice.type];
  const hs = head.scale;
  const vol = p.volume[choice.length] * hs;
  const coily = p.kind === 'coil';
  const rand = rng(seedOf(`${choice.type}/${choice.length}`));

  const build = (countScale: number): { parts: HairPart[]; clumps: number } => {
    const parts: HairPart[] = [];
    const cap = new PartWriter();
    const capRand = rng(seedOf(`cap/${choice.type}`));
    scalpGrid(cap, space, 40, 10, () => 1.5, (az, el) => headRadius(head, az, el) + 0.25, (_az, _el, edge) => (edge < 1 ? 0.25 + 0.5 * capRand() : 1), coily ? 0.55 : 0.5, 3);
    parts.push(cap.part('cap'));

    if (vol > 0) {
      const shells = new PartWriter();
      const k = Math.max(4, Math.min(coily ? 6 : 4, Math.round(2.5 + vol * 0.35)));
      const droop = coily ? 1 : 0.6;
      for (let s = k; s >= 1; s--) {
        const t = s / k;
        const env = (az: number, el: number): number => {
          const hl = hairlineEl(az / DEG) * DEG;
          const f = 0.3 + 0.7 * smooth(hl - 10 * DEG, hl + 32 * DEG, el);
          return headRadius(head, az, el) + 0.4 + t * vol * f;
        };
        const below = (azDeg: number): number => t * droop * Math.min(22, 2.2 * vol) * smooth(35, 110, Math.abs(azDeg));
        scalpGrid(shells, space, 42, 9, below, env, (_az, _el, edge) => (2.5 - 1.8 * Math.pow(t, 0.85)) * (0.4 + 0.6 * edge), 0.5 + 0.5 * t, p.look.coilTileCm, true);
      }
      parts.push(shells.part('shells'));
    }

    const strands = new PartWriter();
    const n = Math.round(p.count * countScale * (choice.length === 'short' ? 0.85 : 1));
    const dirs = scalpDirections(n, rand, coily ? (a) => 1.5 - 9.5 * smooth(35, 110, Math.abs(a)) : undefined);
    const yEnd = cutYCards(choice.length, p, head, input.ringY);
    const guides: CardGuide[] = [];
    for (const d of dirs) {
      const [az, el] = azElOf(d);
      if (coily) {
        const hl = hairlineEl(az / DEG) * DEG;
        const f = 0.3 + 0.7 * smooth(hl - 10 * DEG, hl + 32 * DEG, el);
        const r0 = headRadius(head, az, el) + 0.4 + Math.max(0.2, vol * f - 0.6 - 0.9 * rand());
        const root = add(head.c, d, r0);
        const L = 0.85 + 0.06 * vol + rand() * 0.55;
        const tang = norm(cross(d, norm([rand() - 0.5, rand() - 0.5, rand() - 0.5])));
        const out = norm(add(tang, d, 0.35 + 0.25 * rand()));
        const pts: V3[] = [];
        for (let s = 0; s <= L + 1e-9; s += 0.3) pts.push(space.push(add(root, out, s), 0.3, 0.9));
        guides.push({ pts, layer: 0.6 + 0.4 * rand(), phase: rand() * 6.28, root });
      } else {
        const layer = rand();
        guides.push(growCardGuide(space, add(head.c, d, headRadius(head, az, el)), p, choice.length, yEnd, layer, rand, vol));
      }
    }
    guides.sort((a, b) => b.layer - a.layer);
    for (const g of guides) clumpOf(strands, space, g, p, 1);
    const clumps = guides.length;
    parts.push(strands.part('strands'));
    return { parts, clumps };
  };

  const scale0 = options.countScale ?? 1;
  let built = build(scale0);
  let triangles = built.parts.reduce((s, q) => s + q.indices.length / 3, 0);
  let simpler: string | null = null;
  if (triangles > HAIR_TRIANGLE_BUDGET) {
    const before = built.clumps;
    let scale = scale0;
    for (let it = 0; it < 6 && triangles > HAIR_TRIANGLE_BUDGET; it++) {
      const strandTris = built.parts.find((q) => q.kind === 'strands')!.indices.length / 3;
      const fixed = triangles - strandTris;
      scale = Math.max(0.15, (scale * (HAIR_TRIANGLE_BUDGET - fixed)) / strandTris) * 0.98;
      built = build(scale);
      triangles = built.parts.reduce((s, q) => s + q.indices.length / 3, 0);
    }
    simpler = `${before} clumps drawn as ${built.clumps} to stay within ${HAIR_TRIANGLE_BUDGET} triangles`;
  }
  return { choice, style: 'strand-cards', parts: built.parts, triangles, clumps: built.clumps, look: p.look, simpler, head: { centre: head.c, top: head.top, chin: head.chin, scale: hs } };
}

/**
 * The v1 strand card texture: 64 × 256, u across the card, v from root to tip.
 */
export function strandTexture(seed = 7): HairTexture {
  const W = 64, H = 256;
  const r = rng(seed);
  const lum = new Float32Array(W * H), alpha = new Float32Array(W * H), wsum = new Float32Array(W * H);
  for (let s = 0; s < 70; s++) {
    const u0 = 3 + r() * (W - 6);
    const width = 0.8 + r() * 1.4;
    const b = 0.6 + r() * 0.55;
    const end = H * (0.8 + r() * 0.2);
    const sway = 0.6 + r() * 1.2, ph = r() * 6.28, freq = 1 + r() * 2;
    for (let y = 0; y < H; y++) {
      const taper = 1 - smooth(end - 0.1 * H, end, y);
      if (taper <= 0) continue;
      const uc = u0 + sway * Math.sin((y / H) * 2 * Math.PI * freq + ph);
      for (let x = Math.max(0, Math.floor(uc - 3 * width)); x <= Math.min(W - 1, Math.ceil(uc + 3 * width)); x++) {
        const a = Math.exp(-(((x + 0.5 - uc) / width) ** 2)) * taper;
        const i = y * W + x;
        alpha[i] = Math.max(alpha[i]!, a);
        lum[i] = lum[i]! + a * b;
        wsum[i] = wsum[i]! + a;
      }
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = (x + 0.5) / W;
      alpha[i] = Math.min(1, alpha[i]! * 1.3) * smooth(0, 0.14, u) * smooth(1, 0.86, u);
      lum[i] = wsum[i]! > 1e-4 ? lum[i]! / wsum[i]! : 0.5;
    }
  }
  return withMips(W, H, lum, alpha);
}

/**
 * The v1 coil shell texture: 128 × 128 tileable.
 */
export function coilTexture(type: HairType, seed = 11): HairTexture {
  const W = 128, H = 128;
  const r = rng(seed + seedOf(type));
  const lum = new Float32Array(W * H), alpha = new Float32Array(W * H);
  const G = 8, cell = W / G;
  const lattice = Array.from({ length: G * G }, () => r());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fx = x / cell, fy = y / cell;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const sx = smooth(0, 1, fx - x0), sy = smooth(0, 1, fy - y0);
      const at = (i: number, j: number): number => lattice[((j + G) % G) * G + ((i + G) % G)]!;
      const v = (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
      alpha[y * W + x] = 0.32 + 0.3 * v;
      lum[y * W + x] = 0.42 + 0.2 * v;
    }
  }
  const spec = type === '3C' ? { n: 60, r0: 10, r1: 15, kink: 0 } : type === '4A' ? { n: 90, r0: 7, r1: 10, kink: 0.1 } : type === '4B' ? { n: 140, r0: 5, r1: 7.5, kink: 0.35 } : { n: 220, r0: 3.5, r1: 5.5, kink: 0.55 };
  for (let k = 0; k < spec.n; k++) {
    const cx = r() * W, cy = r() * H;
    const rad = spec.r0 + r() * (spec.r1 - spec.r0);
    const weight = 0.55 + 0.45 * r();
    const b = 0.65 + 0.5 * r();
    const lobes = 3 + Math.floor(r() * 3), ph = r() * 6.28;
    const thick = 1.1 + 0.6 * r();
    const ext = Math.ceil(rad * 1.6 + 3);
    for (let dy = -ext; dy <= ext; dy++) {
      for (let dx = -ext; dx <= ext; dx++) {
        const x = (Math.floor(cx) + dx + W) % W, y = (Math.floor(cy) + dy + H) % H;
        const ex = Math.floor(cx) + dx + 0.5 - cx, ey = Math.floor(cy) + dy + 0.5 - cy;
        const d = Math.hypot(ex, ey);
        const ang = Math.atan2(ey, ex);
        const rr = rad * (1 + spec.kink * Math.sin(lobes * ang + ph));
        const a = Math.exp(-(((d - rr) / thick) ** 2)) * weight;
        const i = y * W + x;
        if (a > alpha[i]!) {
          alpha[i] = a;
          lum[i] = b * (0.8 + 0.25 * Math.sin(ang + 1.2));
        }
      }
    }
  }
  return withMips(W, H, lum, alpha);
}
