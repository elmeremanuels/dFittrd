/**
 * The widest girth of the drawn body below the waist: what a pull-on band has to pass over on the body the phone draws
 * (docs/research/step3-serverdrape-spike.md §10.9). The tape-measure girth (convex hull perimeter) of horizontal
 * sections of the avatar mesh, arms left out, from the waist ring down to the crotch, every 0.5 cm: the same measure as
 * `BodySections.widest` of the drape pipeline (serverdrape/wear_rule.py), which goes from the band's seam down to the
 * crotch (above the seam the body only narrows towards the waist). Below the crotch the legs' stance sets the hull, not
 * the body. The drawn avatar is wider there than its chart hip (2.5-3 cm on the POM bodies: its hip ring is not at its
 * widest section). Pure; server and test side (`bakeGate.ts`, the bake scripts).
 */
import type { Mannequin, Mesh } from '@curtain/mannequin';

const STEP_CM = 0.5;

/** Convex hull perimeter of 2D points, cm. */
function hullPerimeter(pts: [number, number][]): number {
  if (pts.length < 3) return NaN;
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cr = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]!; while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, p) <= 0) up.pop(); up.push(p); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i]!, b = h[(i + 1) % h.length]!; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return per;
}

/** Tape girth of the mesh's section at height y, arm triangles left out, cm. */
export function sectionGirthCm(mesh: Mesh, y: number, skip: (v: number) => boolean = () => false): number {
  const { positions: p, indices: idx } = mesh;
  const yy = y + 1e-7; // never exactly on a row of vertices
  const pts: [number, number][] = [];
  for (let t = 0; t < idx.length; t += 3) {
    if (skip(idx[t]!) || skip(idx[t + 1]!) || skip(idx[t + 2]!)) continue;
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k]!, b = idx[t + ((k + 1) % 3)]!;
      const ya = p[3 * a + 1]! - yy, yb = p[3 * b + 1]! - yy;
      if (ya * yb < 0) {
        const s = ya / (ya - yb);
        pts.push([p[3 * a]! + s * (p[3 * b]! - p[3 * a]!), p[3 * a + 2]! + s * (p[3 * b + 2]! - p[3 * a + 2]!)]);
      }
    }
  }
  return hullPerimeter(pts);
}

/** The widest section of the drawn body from its waist ring down to the crotch: girth (cm, 0.1) and height. */
export function widestBelowWaistCm(m: Pick<Mannequin, 'rings'>, mesh: Mesh): { girthCm: number; atY: number } {
  const armL = mesh.partNames.indexOf('arm_l'), armR = mesh.partNames.indexOf('arm_r'), torso = mesh.partNames.indexOf('torso');
  const arm = (v: number): boolean => mesh.vertexPart[v] === armL || mesh.vertexPart[v] === armR;
  // Crotch: the lowest torso vertex near the midline (avatar-bodies.ts, anny_bodies.py).
  let crotchY = Infinity;
  for (let i = 0; i < mesh.vertexPart.length; i++) if (mesh.vertexPart[i] === torso && Math.abs(mesh.positions[3 * i]!) < 2) crotchY = Math.min(crotchY, mesh.positions[3 * i + 1]!);
  const waist = m.rings.find((r) => r.id === 'waist');
  if (!Number.isFinite(crotchY) || !waist) throw new Error('body girth: the mesh has no crotch or the mannequin no waist ring');
  let best = { girthCm: -Infinity, atY: crotchY };
  for (let y = crotchY; y <= waist.centre[1] + 1e-9; y += STEP_CM) {
    const g = sectionGirthCm(mesh, y, arm);
    if (g > best.girthCm) best = { girthCm: g, atY: y };
  }
  return { girthCm: Math.round(best.girthCm * 10) / 10, atY: Math.round(best.atY * 10) / 10 };
}
