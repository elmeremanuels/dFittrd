/**
 * The waistband girth of a bottom whose top edge does not reach the mannequin's waist ring.
 *
 * The chart's waist of a skirt or trousers is its waistband. The evaluation measures girths on the mannequin's horizontal
 * ring planes; a bottom that is worn lower than our waist ring, or tilted (lower at the front, as a drawstring skirt is
 * often drawn), has no cloth at the waist ring at all, and the ring reports "no girth". Run 15's maxi skirt: its top edge
 * is 101–103 cm above the floor at the back and 93–97 cm at the front, the waist ring is at 104.2 cm.
 *
 * Here the waistband is found where it is: the highest cloth per 10° sector round the vertical axis (the top edge), a
 * plane fitted through those points by least squares with outliers (sectors more than `outlierCm` below the plane: a slit
 * or an opening that reaches the top edge) dropped and the plane refitted, and the tape (`src/tape.ts`, same rules as the
 * rings: holes up to 4 cm bridged, a wider opening refused) taken on that plane `belowCm` under the edge. When the tape
 * refuses, the same section is also measured with any gap bridged, as an indicative number with the gap's size, so the
 * report can say what an opening costs. Report only: the evaluation does not calibrate on it (a tilted band is not the
 * ring the calibration morphs).
 */
import { slice, type Mesh, type Vec3 } from '@curtain/mannequin';
import { densifyLoop, tapeGirth } from './tape';

export const WAISTBAND = { sectors: 36, belowCm: 1.5, outlierCm: 3 } as const;

export interface WaistbandGirth {
  /** Tape girth on the waistband plane, cm; null when the tape refuses (an opening wider than it bridges). */
  girthCm: number | null;
  /** The same section with every gap bridged, cm (indicative when `girthCm` is null). */
  bridgedCm: number | null;
  /** Widest gap in the section: degrees round its centre and chord, cm. */
  maxGapDeg: number | null;
  maxGapCm: number | null;
  coverage: number | null;
  /** Top edge at the centre front (+z) and centre back (−z) (median of the sectors within 30°), and the plane at the centre, cm above the floor. */
  frontY: number;
  backY: number;
  centreY: number;
  /** Tilt of the plane from horizontal, degrees. */
  tiltDeg: number;
  /** Top-edge sectors used for the plane / dropped as outliers. */
  sectorsUsed: number;
  sectorsDropped: number;
}

interface Plane {
  a: number;
  b: number;
  c: number;
}

/** Least-squares plane y = a + b x + c z through the points. */
function fitPlane(pts: readonly Vec3[]): Plane | null {
  let n = 0, sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
  for (const [x, y, z] of pts) {
    n++; sx += x; sz += z; sy += y; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * y; szy += z * y;
  }
  const A = [[n, sx, sz], [sx, sxx, sxz], [sz, sxz, szz]];
  const B = [sy, sxy, szy];
  const det = (m: number[][]): number =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const D = det(A);
  if (Math.abs(D) < 1e-9) return null;
  const col = (j: number): number[][] => A.map((r, i) => r.map((v, k) => (k === j ? B[i]! : v)));
  return { a: det(col(0)) / D, b: det(col(1)) / D, c: det(col(2)) / D };
}

/** The top edge of the cloth: the highest vertex of a triangle per sector round the vertical axis through the cloth's centre. */
function topEdge(mesh: Pick<Mesh, 'positions' | 'indices'>, sectors: number): { pts: Vec3[]; cx: number; cz: number } {
  const P = mesh.positions;
  const n = P.length / 3;
  const used = new Uint8Array(n);
  for (let k = 0; k < mesh.indices.length; k++) used[mesh.indices[k]!] = 1;
  let cx = 0, cz = 0, m = 0;
  for (let i = 0; i < n; i++) if (used[i]) { cx += P[3 * i]!; cz += P[3 * i + 2]!; m++; }
  cx /= m || 1; cz /= m || 1;
  const top: (Vec3 | null)[] = new Array(sectors).fill(null);
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue;
    const x = P[3 * i]!, y = P[3 * i + 1]!, z = P[3 * i + 2]!;
    const k = Math.min(sectors - 1, Math.floor(((Math.atan2(x - cx, z - cz) + Math.PI) / (2 * Math.PI)) * sectors));
    if (!top[k] || y > top[k]![1]) top[k] = [x, y, z];
  }
  return { pts: top.filter((p): p is Vec3 => p !== null), cx, cz };
}

/** The plane of a bottom's top edge: y = a + b·x + c·z through the highest cloth per sector, outlying sectors dropped. */
export interface TopEdgePlane extends Plane {
  /** Centre of the cloth (mean x, z of its vertices). */
  cx: number;
  cz: number;
  /** Top-edge points kept for the plane, and how many sectors were dropped as outliers. */
  used: Vec3[];
  dropped: number;
}

/**
 * The top-edge plane of a bottom (also the viewer's waistband: it pins the cloth within a band under this plane, so a
 * skirt worn lower at the front hangs from its own waistband, not from a level line through its highest point).
 */
export function topEdgePlane(mesh: Pick<Mesh, 'positions' | 'indices'>, o: { outlierCm?: number; sectors?: number } = {}): TopEdgePlane | null {
  const outlier = o.outlierCm ?? WAISTBAND.outlierCm;
  const { pts, cx, cz } = topEdge(mesh, o.sectors ?? WAISTBAND.sectors);
  if (pts.length < 6) return null;
  let used = pts;
  let plane = fitPlane(used);
  for (let round = 0; round < 3 && plane; round++) {
    const p = plane;
    const keep = pts.filter(([x, y, z]) => y >= p.a + p.b * x + p.c * z - outlier);
    if (keep.length === used.length || keep.length < 6) break;
    used = keep;
    plane = fitPlane(used);
  }
  return plane ? { ...plane, cx, cz, used, dropped: pts.length - used.length } : null;
}

export function waistbandGirth(mesh: Pick<Mesh, 'positions' | 'indices'>, o: { belowCm?: number; outlierCm?: number; sectors?: number } = {}): WaistbandGirth | null {
  const below = o.belowCm ?? WAISTBAND.belowCm;
  const tp = topEdgePlane(mesh, o);
  if (!tp) return null;
  const { a, b, c, cx, cz, used } = tp;
  const yAt = (x: number, z: number): number => a + b * x + c * z;
  // The plane's normal (−b, 1, −c), an in-plane basis with u along +x and v along +z (projected).
  const nl = Math.hypot(b, 1, c);
  const normal: Vec3 = [-b / nl, 1 / nl, -c / nl];
  const proj = (d: Vec3): Vec3 => {
    const k = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2];
    const q: Vec3 = [d[0] - k * normal[0], d[1] - k * normal[1], d[2] - k * normal[2]];
    const l = Math.hypot(...q);
    return [q[0] / l, q[1] / l, q[2] / l];
  };
  const u = proj([1, 0, 0]);
  const v = proj([0, 0, 1]);
  const centre: Vec3 = [cx, yAt(cx, cz) - below / normal[1], cz];
  const loops = slice(mesh.positions, mesh.indices, { origin: centre, normal });
  const sec = loops.map((l) => densifyLoop(l)).flatMap((l) => l.points);
  const strict = tapeGirth(sec, centre, u, v);
  const loose = tapeGirth(sec, centre, u, v, { maxGapCm: 1e6, maxGapDeg: 360, minCoverage: 0 });
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  // Front and back of the band: the median top edge of the sectors within 30° of the centre front (+z) and centre back.
  const edgeNear = (front: boolean): number => {
    const ys = used.filter(([x, , z]) => {
      const a = Math.atan2(x - cx, front ? z - cz : cz - z);
      return Math.abs(a) <= Math.PI / 6;
    }).map((p) => p[1]).sort((p, q) => p - q);
    return ys.length ? ys[ys.length >> 1]! : NaN;
  };
  return {
    girthCm: strict ? r2(strict.girthCm) : null,
    bridgedCm: loose ? r2(loose.girthCm) : null,
    maxGapDeg: loose ? r2(loose.maxGapDeg) : null,
    maxGapCm: loose ? r2(loose.maxGapCm) : null,
    coverage: loose ? r2(loose.coverage) : null,
    frontY: r2(edgeNear(true)),
    backY: r2(edgeNear(false)),
    centreY: r2(yAt(cx, cz)),
    tiltDeg: r2((Math.acos(Math.min(1, normal[1])) * 180) / Math.PI),
    sectorsUsed: used.length,
    sectorsDropped: tp.dropped,
  };
}
