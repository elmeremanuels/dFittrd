/**
 * Garment-relative girth measures for the R2 spike (review of the first run: the fixed heights of
 * viewer/scripts/sizes-drape.ts, y = body hip and y = 22, move along the garment when the band makes a skirt ride
 * higher or lower, so the hem number at y = 22 swung 45-114 % with the ASSUMED band alone).
 *
 * - hipRel: the girth at the same distance below the garment's top edge as the mannequin hip line is in the rest
 *   geometry (14.2 cm below the top). On a drape the top edge is the settled mean height of the top-ring particles.
 * - hemRel: the girth HEM_ABOVE_CM above the garment's bottom edge (settled mean height of the bottom-ring particles).
 * - hipRing: the hull perimeter of the very particles that lie on the rest hip line (|y - hip| < 0.75 cm): the same
 *   piece of fabric in every size and on every body.
 * The graded reference is the same measure on the rest geometry (`restRef`). Pure; grading moves vertices
 * horizontally only, so the rings are the same particles in every size.
 */
import { girthAt } from './girth';

export const MANNEQUIN_HIP_Y = 87.36;
export const HEM_ABOVE_CM = 15;

export interface Rings { top: number[]; bottom: number[]; hip: number[]; restTop: number; restHem: number }

export function rings(rest: ArrayLike<number>): Rings {
  let restTop = -Infinity, restHem = Infinity;
  for (let i = 1; i < rest.length; i += 3) { restTop = Math.max(restTop, rest[i]!); restHem = Math.min(restHem, rest[i]!); }
  const top: number[] = [], bottom: number[] = [], hip: number[] = [];
  for (let i = 0; i < rest.length / 3; i++) {
    const y = rest[3 * i + 1]!;
    if (y > restTop - 0.5) top.push(i);
    if (y < restHem + 0.5) bottom.push(i);
    if (Math.abs(y - MANNEQUIN_HIP_Y) < 0.75) hip.push(i);
  }
  return { top, bottom, hip, restTop, restHem };
}

const meanY = (pos: ArrayLike<number>, ids: number[]): number => ids.reduce((s, i) => s + pos[3 * i + 1]!, 0) / ids.length;

function hull(pts: [number, number][]): number {
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o: number[], a: number[], b: number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...pts].reverse()) { while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop(); up.push(p); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i]!, b = h[(i + 1) % h.length]!; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return Math.round(per * 10) / 10;
}

export interface RelGirths { hipRel: number; hemRel: number; hipRing: number; topY: number; hemY: number }

export function relGirths(pos: ArrayLike<number>, idx: ArrayLike<number>, r: Rings): RelGirths {
  const topY = meanY(pos, r.top), hemY = meanY(pos, r.bottom);
  return {
    hipRel: girthAt(pos, idx, topY - (r.restTop - MANNEQUIN_HIP_Y)),
    hemRel: girthAt(pos, idx, hemY + HEM_ABOVE_CM),
    hipRing: hull(r.hip.map((i) => [pos[3 * i]!, pos[3 * i + 2]!])),
    topY: Math.round(topY * 100) / 100,
    hemY: Math.round(hemY * 100) / 100,
  };
}
