/**
 * Measurements of the realistic body spike (docs/reports/claude/realistic-body-spike.md): per test body the ring errors
 * (loop and tape), the drawn mesh against the collision outline the cloth meets (the ring table's ellipses), closedness
 * and self-crossing, the fit time in Node, and the asset's size.
 *
 *   pnpm --filter @curtain/garment-viewer exec tsx scripts/realistic-body-report.ts [--json <file>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { buildBody, topology, type Mannequin, type Mesh } from '@curtain/mannequin';
import { decodeRealisticBody, fitRealisticBody, fitTargetOf, sectionAt } from '../src/realisticBody';

type V3 = [number, number, number];

/** The five test bodies of the spike, then the two corners of the input box (route doc §7). Female, cm. */
export const TEST_BODIES: Record<string, { heightCm: number; bust: number; waist: number; hip: number }> = {
  slim: { heightCm: 164, bust: 80, waist: 62, hip: 88 },
  mid: { heightCm: 168, bust: 92, waist: 74, hip: 100 },
  full: { heightCm: 170, bust: 116, waist: 98, hip: 122 },
  tall: { heightCm: 182, bust: 92, waist: 74, hip: 100 },
  petite: { heightCm: 152, bust: 84, waist: 66, hip: 92 },
  'corner-small': { heightCm: 130, bust: 60, waist: 45, hip: 65 },
  'corner-large': { heightCm: 220, bust: 160, waist: 150, hip: 170 },
};

const N = 96;

/** Per angle, the farthest crossing of the ray from the origin with the closed polygon q (plane coordinates). */
function polar(q: readonly [number, number][]): Float64Array {
  const r = new Float64Array(N);
  for (let j = 0; j < N; j++) {
    const phi = (2 * Math.PI * j) / N;
    const dx = Math.cos(phi), dz = Math.sin(phi);
    let best = 0;
    for (let k = 0; k < q.length; k++) {
      const [x0, z0] = q[k]!;
      const [x1, z1] = q[(k + 1) % q.length]!;
      const ex = x1 - x0, ez = z1 - z0;
      const det = ex * dz - ez * dx;
      if (Math.abs(det) < 1e-12) continue;
      const t = (ex * z0 - ez * x0) / det;
      const w = (dx * z0 - dz * x0) / det;
      if (w >= -1e-9 && w <= 1 + 1e-9 && t > best) best = t;
    }
    r[j] = best;
  }
  return r;
}

const ellipseR = (a: number, b: number, phi: number): number => (a * b) / Math.hypot(b * Math.cos(phi), a * Math.sin(phi));

interface OutlineStat { outsideCm: number; outsideAt: string; insideCm: number; insideAt: string; meanAbsCm: number }

/** The drawn mesh against the collision ellipses, along a chain: per station, 96 directions. */
function outline(mesh: Mesh, stations: { label: string; origin: V3; normal: V3; u: V3; v: V3; a: number; b: number }[]): OutlineStat {
  let outsideCm = 0, insideCm = 0, sum = 0, count = 0;
  let outsideAt = '', insideAt = '';
  for (const s of stations) {
    const sec = sectionAt(mesh.positions, mesh.indices, s.origin, s.normal, s.u, s.v);
    if (!sec) continue;
    const r = polar(sec.q);
    for (let j = 0; j < N; j++) {
      const d = r[j]! - ellipseR(s.a, s.b, (2 * Math.PI * j) / N);
      if (d > outsideCm) {
        outsideCm = d;
        outsideAt = `${s.label} at ${Math.round((360 * j) / N)}°`;
      }
      if (-d > insideCm) {
        insideCm = -d;
        insideAt = `${s.label} at ${Math.round((360 * j) / N)}°`;
      }
      sum += Math.abs(d);
      count++;
    }
  }
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  return { outsideCm: r2(outsideCm), outsideAt, insideCm: r2(insideCm), insideAt, meanAbsCm: r2(sum / Math.max(1, count)) };
}

/** Torso from the seat (hip ring) up to 2 cm over the chest ring (under the armpit), every 0.5 cm. */
function torsoStations(m: Mannequin): Parameters<typeof outline>[1] {
  const out: Parameters<typeof outline>[1] = [];
  for (let y = m.morphHeights.hip; y <= m.morphHeights.chest + 2; y += 0.5) {
    const e = m.torsoAt(y);
    if (e) out.push({ label: `torso y ${y.toFixed(1)}`, origin: [e.cx, y, e.cz], normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], a: e.a, b: e.b });
  }
  return out;
}

/** The left arm from the upper-arm ring to the wrist ring, every 0.5 cm along the axis. */
function armStations(m: Mannequin): Parameters<typeof outline>[1] {
  const f = m.arms.left;
  const out: Parameters<typeof outline>[1] = [];
  for (let s = m.morphHeights.upper_arm; s <= m.morphHeights.wrist; s += 0.5) {
    const e = m.armAt(s, 1);
    if (e) out.push({ label: `arm s ${s.toFixed(1)}`, origin: [f.joint[0] + f.axis[0] * s, f.joint[1] + f.axis[1] * s, f.joint[2] + f.axis[2] * s], normal: f.axis as V3, u: f.u as V3, v: f.v as V3, a: e.a, b: e.b });
  }
  return out;
}

/** The left leg from the thigh ring to the ankle ring. */
function legStations(m: Mannequin): Parameters<typeof outline>[1] {
  const out: Parameters<typeof outline>[1] = [];
  for (let y = m.morphHeights.ankle; y <= m.morphHeights.thigh; y += 0.5) {
    const e = m.legAt(y, 1);
    if (e) out.push({ label: `leg y ${y.toFixed(1)}`, origin: [e.cx, y, e.cz], normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], a: e.a, b: e.b });
  }
  return out;
}

/**
 * Pairs of triangles that cross each other (sharing no vertex): every edge of one tested against the other. Only
 * triangles whose vertices are all under `below` (the body surface, without the eye spheres) when given.
 */
export function selfCrossings(mesh: Pick<Mesh, 'positions' | 'indices'>, below = Infinity, cell = 2): { count: number; ys: number[] } {
  const p = mesh.positions, idx = mesh.indices;
  const nt = idx.length / 3;
  const grid = new Map<string, number[]>();
  const v = (i: number): V3 => [p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!];
  for (let t = 0; t < nt; t++) {
    if (idx[3 * t]! >= below || idx[3 * t + 1]! >= below || idx[3 * t + 2]! >= below) continue;
    const a = v(idx[3 * t]!), b = v(idx[3 * t + 1]!), c = v(idx[3 * t + 2]!);
    const lo = [0, 1, 2].map((k) => Math.floor(Math.min(a[k]!, b[k]!, c[k]!) / cell));
    const hi = [0, 1, 2].map((k) => Math.floor(Math.max(a[k]!, b[k]!, c[k]!) / cell));
    for (let x = lo[0]!; x <= hi[0]!; x++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let z = lo[2]!; z <= hi[2]!; z++) {
      const key = `${x},${y},${z}`;
      const list = grid.get(key);
      if (list) list.push(t);
      else grid.set(key, [t]);
    }
  }
  const seen = new Set<number>();
  let crossings = 0;
  const ys: number[] = [];
  const segHits = (o: V3, e: V3, a: V3, b: V3, c: V3): boolean => {
    // Möller–Trumbore with the segment o → e, strictly inside the segment and the triangle.
    const d: V3 = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const h: V3 = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(det) < 1e-12) return false;
    const f = 1 / det;
    const s: V3 = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
    const u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
    if (u <= 1e-9 || u >= 1 - 1e-9) return false;
    const q: V3 = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const w = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]);
    if (w <= 1e-9 || u + w >= 1 - 1e-9) return false;
    const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
    return t > 1e-9 && t < 1 - 1e-9;
  };
  for (const list of grid.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const s = list[i]!, t = list[j]!;
      const key = s < t ? s * nt + t : t * nt + s;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = [idx[3 * s]!, idx[3 * s + 1]!, idx[3 * s + 2]!], B = [idx[3 * t]!, idx[3 * t + 1]!, idx[3 * t + 2]!];
      if (A.some((x) => B.includes(x))) continue;
      const [a0, a1, a2] = A.map(v) as [V3, V3, V3];
      const [b0, b1, b2] = B.map(v) as [V3, V3, V3];
      if (segHits(a0, a1, b0, b1, b2) || segHits(a1, a2, b0, b1, b2) || segHits(a2, a0, b0, b1, b2) || segHits(b0, b1, a0, a1, a2) || segHits(b1, b2, a0, a1, a2) || segHits(b2, b0, a0, a1, a2)) {
        crossings++;
        ys.push(Math.round(a0[1] * 10) / 10);
      }
    }
  }
  return { count: crossings, ys };
}

function main(): void {
  const file = new URL('../assets/realistic-body/female-v1.crb', import.meta.url);
  const bytes = readFileSync(file);
  const asset = decodeRealisticBody(bytes);
  const base: Mesh = { positions: Float64Array.from(asset.positions), indices: asset.indices, vertexPart: new Uint8Array(asset.meta.vertexCount), partNames: ['body'] };
  const out: Record<string, unknown> = {
    asset: { bytes: bytes.length, gzipBytes: gzipSync(bytes).length, vertices: asset.meta.vertexCount, triangles: asset.meta.triangleCount, baseSelfCrossings: selfCrossings(base, asset.meta.bodyVertexCount), baseSelfCrossingsWithEyes: selfCrossings(base).count },
    bodies: {},
  };
  for (const [name, b] of Object.entries(TEST_BODIES)) {
    const m = buildBody({ family: 'female', ...b });
    const t0 = performance.now();
    const fit = fitRealisticBody(asset, fitTargetOf(m));
    const ms = performance.now() - t0;
    const topo = topology(fit.mesh);
    (out.bodies as Record<string, unknown>)[name] = {
      input: b,
      shape: fit.shape,
      fitMs: Math.round(ms),
      rings: fit.rings.map((r) => ({ id: r.id, targetCm: r.targetCm, loopCm: r.loopCm === null ? null : Math.round(r.loopCm * 100) / 100, tapeCm: r.tapeCm === null ? null : Math.round(r.tapeCm * 100) / 100, errorPct: r.errorPct === null ? null : Math.round(r.errorPct * 1e4) / 1e4, tapeMinusLoopCm: r.loopCm === null || r.tapeCm === null ? null : Math.round((r.tapeCm - r.loopCm) * 100) / 100 })),
      maxAbsErrorPct: Math.round(Math.max(...fit.rings.map((r) => Math.abs(r.errorPct ?? Infinity))) * 1e4) / 1e4,
      watertight: topo.watertight,
      components: topo.components,
      selfCrossings: selfCrossings(fit.mesh, asset.meta.bodyVertexCount),
      outline: { torso: outline(fit.mesh, torsoStations(m)), arm: outline(fit.mesh, armStations(m)), leg: outline(fit.mesh, legStations(m)) },
    };
    console.error(`${name}: done (${Math.round(ms)} ms fit)`);
  }
  const json = JSON.stringify(out, null, 1);
  const at = process.argv.indexOf('--json');
  if (at >= 0 && process.argv[at + 1]) writeFileSync(process.argv[at + 1]!, json);
  console.log(json);
}

main();
