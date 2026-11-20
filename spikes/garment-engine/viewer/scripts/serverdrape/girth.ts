/**
 * The girth measure of viewer/scripts/sizes-drape.ts (REFINEMENT R3's 20 cm → 5.4 cm), shared by the R2 spike scripts:
 * perimeter of the convex hull of the mesh's slice at height y (x–z plane), cm, one decimal. Pure; also used by the
 * morph page (viewer/src/morphMain.ts) on the blended positions.
 */
export function girthAt(pos: ArrayLike<number>, idx: ArrayLike<number>, y: number): number {
  const pts: [number, number][] = [];
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k]!, b = idx[t + ((k + 1) % 3)]!;
      const ya = pos[3 * a + 1]! - y, yb = pos[3 * b + 1]! - y;
      if ((ya < 0) !== (yb < 0)) {
        const s = ya / (ya - yb);
        pts.push([pos[3 * a]! + s * (pos[3 * b]! - pos[3 * a]!), pos[3 * a + 2]! + s * (pos[3 * b + 2]! - pos[3 * a + 2]!)]);
      }
    }
  }
  if (pts.length < 3) return NaN;
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
