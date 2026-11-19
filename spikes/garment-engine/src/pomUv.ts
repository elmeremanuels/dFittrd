/**
 * UVs for the POM tee (men-3d-plan slice M3, defect 5 of the M3 report): every panel of the tee (front, back, the two
 * sleeves, `POM_PANELS`) becomes a flat pattern piece in cm, laid into one texture atlas at one scale, so a print or a shop's
 * flat-lay photo lands on the garment at its real size.
 *
 * - **Cuts.** A vertex used by two panels (side seams, shoulder seams, armholes) gets one render vertex per panel; each
 *   sleeve is also cut along its underarm (column 0 of its rings). Render vertices 0 … n−1 are the welded mesh's own
 *   vertices in order, the seam copies come after, so the viewer's weld by position (`weldWithRemap`) gives back exactly
 *   the welded mesh the bundle grades and drapes.
 * - **Flattening.** Each piece starts from an unrolled guess (body panels: arc length round the body axis from the centre
 *   line, and height; sleeves: arc length round each ring from the underarm, and length down each column) and is relaxed
 *   in 2D until its edges have their 3D lengths (Gauss–Seidel, `FLATTEN_ITERATIONS`). The result is the piece as it would
 *   lie flat: what a flat-lay photo of the garment shows. Its distortion (edge length in the plane against on the garment)
 *   is reported (`TeeUvLayout.distortion`).
 * - **Pattern coordinates.** Body panels: `u` cm across, 0 on the centre line, positive to the right of a picture of that
 *   side (front: the wearer's left; back, seen from behind: the wearer's right); `v` cm down from the high point shoulder.
 *   Sleeves: `u` cm round from the underarm, `v` cm down from the armhole along the sleeve.
 * - **Atlas.** Front and back side by side on top, the sleeves below, `ATLAS_GAP_CM` apart, one scale (px per cm) for all,
 *   glTF convention (v down, origin top left).
 *
 * `paintAtlas` fills the atlas from a painter evaluated per texel in pattern cm (a repeating print is a function of cm;
 * `flatLayPainter` projects a flat-lay photo of the front or back by the photo's scale and the centre of its neckline at
 * the high point shoulder). Pure, deterministic, no I/O.
 */
import type { Vec3 } from '@curtain/mannequin';
import { POM_PANELS, type PomTeeBuild } from './pomTee';

export const FLATTEN_ITERATIONS = 600;
/** Space between pieces in the atlas, and round its border, cm. */
export const ATLAS_GAP_CM = 3;
/** Colour bleed round each piece, cm (so texture filtering at a seam never reads the background). */
export const ATLAS_BLEED_CM = 1.5;

export interface UvIsland {
  panel: (typeof POM_PANELS)[number];
  /** The piece's extent in pattern cm. */
  min: [number, number];
  max: [number, number];
  /** Where the piece's `min` corner lies in the atlas, px. */
  originPx: [number, number];
}

export interface TeeUvLayout {
  /** Atlas size, px (square). */
  sizePx: number;
  pxPerCm: number;
  islands: UvIsland[];
  /** Render vertex → welded vertex. */
  remap: Uint32Array;
  /** Render vertex → panel index (`POM_PANELS`). */
  panelOf: Uint8Array;
  /** Pattern coordinates per render vertex, cm (`u`, `v`). */
  patternCm: Float64Array;
  /** Atlas UVs per render vertex (0..1, v down). */
  uvs: Float32Array;
  /** Triangles over the render vertices. */
  indices: Uint32Array;
  /** Edge length flat ÷ on the garment, per panel: median and the 1st / 99th percentile. */
  distortion: Record<(typeof POM_PANELS)[number], { median: number; p01: number; p99: number }>;
}

export function teeUvLayout(b: Pick<PomTeeBuild, 'mesh' | 'triPanel' | 'sleeveRings' | 'hps'>, sizePx = 1024): TeeUvLayout {
  const { mesh } = b;
  const n = mesh.positions.length / 3;
  const T = mesh.indices.length / 3;
  const P = (i: number): Vec3 => [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
  // Sleeve columns: vertex → column per sleeve (ring 0, the armhole, included), and the ring count of each column.
  const colOf: Map<number, number>[] = [new Map(), new Map()];
  const K: number[] = [0, 0];
  for (const k of [0, 1]) {
    const rings = b.sleeveRings[k as 0 | 1];
    K[k] = rings[0]!.length;
    for (const ring of rings) ring.forEach((id, j) => colOf[k]!.set(id, j));
  }
  // Render vertices: key (welded vertex, panel, wrap) → id. The first use of each welded vertex keeps its own id.
  const remap: number[] = [];
  const panelOf: number[] = [];
  const wrapOf: number[] = [];
  const firstPanel = new Int16Array(n).fill(-1);
  const firstWrap = new Uint8Array(n);
  const extra = new Map<string, number>();
  const corner = (t: number, i: number): { panel: number; wrap: number } => {
    const p = b.triPanel[t]!;
    if (p < 2) return { panel: p, wrap: 0 };
    const k = p - 2;
    const j = colOf[k]!.get(i);
    if (j !== 0) return { panel: p, wrap: 0 };
    // Column 0 of a triangle that also touches the last column is the cut's other side.
    let touchesLast = false;
    for (let e = 0; e < 3; e++) if (colOf[k]!.get(mesh.indices[3 * t + e]!) === K[k]! - 1) touchesLast = true;
    return { panel: p, wrap: touchesLast ? 1 : 0 };
  };
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const i = mesh.indices[3 * t + e]!;
    if (firstPanel[i] !== -1) continue;
    const c = corner(t, i);
    firstPanel[i] = c.panel;
    firstWrap[i] = c.wrap;
  }
  for (let i = 0; i < n; i++) {
    remap.push(i);
    panelOf.push(Math.max(0, firstPanel[i]!));
    wrapOf.push(firstWrap[i]!);
  }
  const indices = new Uint32Array(mesh.indices.length);
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const i = mesh.indices[3 * t + e]!;
    const c = corner(t, i);
    let r = i;
    if (c.panel !== firstPanel[i] || c.wrap !== firstWrap[i]) {
      const key = `${i},${c.panel},${c.wrap}`;
      let id = extra.get(key);
      if (id === undefined) {
        id = remap.length;
        extra.set(key, id);
        remap.push(i);
        panelOf.push(c.panel);
        wrapOf.push(c.wrap);
      }
      r = id;
    }
    indices[3 * t + e] = r;
  }
  const R = remap.length;
  const flat = new Float64Array(2 * R);

  // Initial guess per piece.
  const hpsY = mesh.positions[3 * b.hps[0] + 1]!;
  for (let r = 0; r < R; r++) {
    const p = P(remap[r]!);
    const panel = panelOf[r]!;
    if (panel < 2) {
      let th = Math.atan2(p[2], p[0]);
      // The front's θ runs 0 … π; a vertex on the seam at θ = −π (z = −0) is its left edge.
      if (panel === 0 && th < -Math.PI / 2) th += 2 * Math.PI;
      const rho = Math.hypot(p[0], p[2]);
      flat[2 * r] = panel === 0 ? rho * (Math.PI / 2 - th) : rho * (-Math.PI / 2 - th);
      // The back's θ runs −π … 0; a vertex on the seam at θ ≈ +π belongs to the right of the back seen from behind.
      if (panel === 1 && th > Math.PI / 2) flat[2 * r] = rho * (Math.PI * 1.5 - th);
      flat[2 * r + 1] = hpsY - p[1];
    }
  }
  for (const k of [0, 1]) {
    const rings = b.sleeveRings[k as 0 | 1];
    const Kk = K[k]!;
    // U: arc length round ring 0 from the underarm; V: length down each column. Both per column, from ring 0.
    const ringLen = (ring: number[], upTo: number): number => {
      let s = 0;
      for (let j = 1; j <= upTo; j++) {
        const a = P(ring[j - 1]!), c = P(ring[j % Kk]!);
        s += Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
      }
      return s;
    };
    const colV = new Map<number, number>();
    for (let j = 0; j < Kk; j++) {
      let v = 0;
      colV.set(rings[0]![j]!, 0);
      for (let q = 1; q < rings.length; q++) {
        const a = P(rings[q - 1]![j]!), c = P(rings[q]![j]!);
        v += Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
        colV.set(rings[q]![j]!, v);
      }
    }
    const colU = new Map<number, number>();
    for (const ring of rings) for (let j = 0; j < Kk; j++) colU.set(ring[j]!, ringLen(ring, j));
    for (let r = 0; r < R; r++) {
      if (panelOf[r] !== 2 + k) continue;
      const i = remap[r]!;
      const wrapped = wrapOf[r] === 1;
      const ring = rings.find((rg) => rg.includes(i))!;
      const U = wrapped ? ringLen(ring, Kk) : colU.get(i)!;
      // The right sleeve's rings run the other way round its arm: mirrored, so both sleeves read the same way.
      flat[2 * r] = k === 1 ? -U : U;
      flat[2 * r + 1] = colV.get(i)!;
    }
  }

  // Relax every piece towards its triangles' own shapes (as rigid as possible, by shape matching: each triangle's best
  // rotation of its 3D shape onto the plane, averaged per vertex). Rotations only, so a triangle cannot flip over.
  const rest: number[] = [];
  for (let t = 0; t < T; t++) {
    const a = P(remap[indices[3 * t]!]!), c = P(remap[indices[3 * t + 1]!]!), d = P(remap[indices[3 * t + 2]!]!);
    const e1: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], e2: Vec3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1e-9;
    const x2 = (e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2]) / l1;
    const y2 = Math.sqrt(Math.max(0, e2[0] ** 2 + e2[1] ** 2 + e2[2] ** 2 - x2 * x2));
    // The triangle in its own plane, its centroid at the origin; winding as in the atlas (negative area, v down).
    const q = [[0, 0], [l1, 0], [x2, -y2]];
    const gx = (q[0]![0]! + q[1]![0]! + q[2]![0]!) / 3, gy = (q[0]![1]! + q[1]![1]! + q[2]![1]!) / 3;
    for (const k of q) rest.push(k[0]! - gx, k[1]! - gy);
  }
  const acc = new Float64Array(2 * R), cnt = new Float64Array(R);
  for (const r of indices) cnt[r] = cnt[r]! + 1;
  for (let it = 0; it < FLATTEN_ITERATIONS; it++) {
    acc.fill(0);
    for (let t = 0; t < T; t++) {
      const ids = [indices[3 * t]!, indices[3 * t + 1]!, indices[3 * t + 2]!];
      const cx = (flat[2 * ids[0]!]! + flat[2 * ids[1]!]! + flat[2 * ids[2]!]!) / 3, cy = (flat[2 * ids[0]! + 1]! + flat[2 * ids[1]! + 1]! + flat[2 * ids[2]! + 1]!) / 3;
      let sd = 0, sc = 0;
      for (let k = 0; k < 3; k++) {
        const qx = rest[6 * t + 2 * k]!, qy = rest[6 * t + 2 * k + 1]!;
        const px = flat[2 * ids[k]!]! - cx, py = flat[2 * ids[k]! + 1]! - cy;
        sd += qx * px + qy * py;
        sc += qx * py - qy * px;
      }
      const ang = Math.atan2(sc, sd);
      const co = Math.cos(ang), si = Math.sin(ang);
      for (let k = 0; k < 3; k++) {
        const qx = rest[6 * t + 2 * k]!, qy = rest[6 * t + 2 * k + 1]!;
        acc[2 * ids[k]!] = acc[2 * ids[k]!]! + cx + co * qx - si * qy;
        acc[2 * ids[k]! + 1] = acc[2 * ids[k]! + 1]! + cy + si * qx + co * qy;
      }
    }
    for (let r = 0; r < R; r++) if (cnt[r]! > 0) {
      flat[2 * r] = acc[2 * r]! / cnt[r]!;
      flat[2 * r + 1] = acc[2 * r + 1]! / cnt[r]!;
    }
  }
  const edges: [number, number, number][] = [];
  const seen = new Set<string>();
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const a = indices[3 * t + e]!, c = indices[3 * t + ((e + 1) % 3)]!;
    const key = a < c ? `${a},${c}` : `${c},${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pa = P(remap[a]!), pc = P(remap[c]!);
    edges.push([a, c, Math.hypot(pa[0] - pc[0], pa[1] - pc[1], pa[2] - pc[2])]);
  }
  // Body panels: the centre line (x = 0 on the garment) vertical at u = 0, v = 0 at the high point shoulder.
  for (const panel of [0, 1]) {
    const line: number[] = [];
    for (let r = 0; r < R; r++) if (panelOf[r] === panel && Math.abs(mesh.positions[3 * remap[r]!]!) < 1e-6) line.push(r);
    if (line.length >= 2) {
      // Least-squares direction of the centre line (u against v), turned to vertical.
      let mu = 0, mv = 0;
      for (const r of line) { mu += flat[2 * r]!; mv += flat[2 * r + 1]!; }
      mu /= line.length; mv /= line.length;
      let suv = 0, svv = 0;
      for (const r of line) { const du = flat[2 * r]! - mu, dv = flat[2 * r + 1]! - mv; suv += du * dv; svv += dv * dv; }
      const ang = Math.atan2(suv, svv);
      const c = Math.cos(ang), s = Math.sin(ang);
      for (let r = 0; r < R; r++) {
        if (panelOf[r] !== panel) continue;
        const du = flat[2 * r]! - mu, dv = flat[2 * r + 1]! - mv;
        flat[2 * r] = c * du - s * dv;
        flat[2 * r + 1] = s * du + c * dv + mv;
      }
    }
    // v = 0 at the high point shoulder (the HPS vertex's copy on this panel, else its welded id).
    let hv = NaN;
    for (let r = 0; r < R; r++) if (panelOf[r] === panel && remap[r] === b.hps[0]) hv = flat[2 * r + 1]!;
    if (Number.isFinite(hv)) for (let r = 0; r < R; r++) if (panelOf[r] === panel) flat[2 * r + 1] = flat[2 * r + 1]! - hv;
  }

  // Atlas.
  const islands: UvIsland[] = POM_PANELS.map((panel, k) => {
    const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
    for (let r = 0; r < R; r++) if (panelOf[r] === k) {
      min[0] = Math.min(min[0], flat[2 * r]!); min[1] = Math.min(min[1], flat[2 * r + 1]!);
      max[0] = Math.max(max[0], flat[2 * r]!); max[1] = Math.max(max[1], flat[2 * r + 1]!);
    }
    return { panel, min, max, originPx: [0, 0] };
  });
  const w = (k: number): number => islands[k]!.max[0] - islands[k]!.min[0];
  const h = (k: number): number => islands[k]!.max[1] - islands[k]!.min[1];
  const g = ATLAS_GAP_CM;
  const topH = Math.max(h(0), h(1)), lowH = Math.max(h(2), h(3));
  const widthCm = g + Math.max(w(0) + g + w(1), w(2) + g + w(3)) + g;
  const heightCm = g + topH + g + lowH + g;
  const pxPerCm = sizePx / Math.max(widthCm, heightCm);
  const place = (k: number, xCm: number, yCm: number): void => { islands[k]!.originPx = [xCm * pxPerCm, yCm * pxPerCm]; };
  place(0, g, g);
  place(1, g + w(0) + g, g);
  place(2, g, g + topH + g);
  place(3, g + w(2) + g, g + topH + g);
  const uvs = new Float32Array(2 * R);
  for (let r = 0; r < R; r++) {
    const isl = islands[panelOf[r]!]!;
    uvs[2 * r] = (isl.originPx[0] + (flat[2 * r]! - isl.min[0]) * pxPerCm) / sizePx;
    uvs[2 * r + 1] = (isl.originPx[1] + (flat[2 * r + 1]! - isl.min[1]) * pxPerCm) / sizePx;
  }

  const distortion = {} as TeeUvLayout['distortion'];
  POM_PANELS.forEach((panel, k) => {
    const ratio: number[] = [];
    for (const [a, c, L] of edges) {
      if (panelOf[a] !== k || L < 1e-6) continue;
      ratio.push(Math.hypot(flat[2 * a]! - flat[2 * c]!, flat[2 * a + 1]! - flat[2 * c + 1]!) / L);
    }
    ratio.sort((x, y) => x - y);
    const q = (f: number): number => Math.round((ratio[Math.min(ratio.length - 1, Math.floor(f * ratio.length))] ?? NaN) * 1000) / 1000;
    distortion[panel] = { median: q(0.5), p01: q(0.01), p99: q(0.99) };
  });
  return { sizePx, pxPerCm, islands, remap: Uint32Array.from(remap), panelOf: Uint8Array.from(panelOf), patternCm: flat, uvs, indices, distortion };
}

/** A colour from pattern coordinates: `panel` (`POM_PANELS`), `u` and `v` in cm (see the file header). RGB 0..255. */
export type Painter = (panel: (typeof POM_PANELS)[number], uCm: number, vCm: number) => [number, number, number];

/**
 * The atlas as RGB bytes: every texel inside a piece's box (plus `ATLAS_BLEED_CM`) painted from its pattern coordinates,
 * the rest `background`.
 */
export function paintAtlas(layout: TeeUvLayout, painter: Painter, background: [number, number, number]): Uint8Array {
  const S = layout.sizePx;
  const out = new Uint8Array(S * S * 3);
  for (let i = 0; i < S * S; i++) out.set(background, 3 * i);
  const bleed = ATLAS_BLEED_CM * layout.pxPerCm;
  for (const isl of layout.islands) {
    const x0 = Math.max(0, Math.floor(isl.originPx[0] - bleed)), y0 = Math.max(0, Math.floor(isl.originPx[1] - bleed));
    const x1 = Math.min(S - 1, Math.ceil(isl.originPx[0] + (isl.max[0] - isl.min[0]) * layout.pxPerCm + bleed));
    const y1 = Math.min(S - 1, Math.ceil(isl.originPx[1] + (isl.max[1] - isl.min[1]) * layout.pxPerCm + bleed));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const u = isl.min[0] + (x + 0.5 - isl.originPx[0]) / layout.pxPerCm;
      const v = isl.min[1] + (y + 0.5 - isl.originPx[1]) / layout.pxPerCm;
      out.set(painter(isl.panel, u, v), 3 * (y * S + x));
    }
  }
  return out;
}

/** An RGB raster (8 bit, row-major, top row first). */
export interface Rgb {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * How a flat-lay photo of one side of the tee sits on the pattern: `pxPerCm` (the photo's chest line in px ÷ the chest
 * width on the tape) and `hpsCentrePx`, the point in the photo on the centre line at the height of the high point shoulder.
 */
export interface FlatLayCalibration {
  pxPerCm: number;
  hpsCentrePx: [number, number];
}

/** Samples a flat-lay photo (bilinear) at pattern coordinates of one body panel; outside the photo, the nearest edge pixel. */
export function sampleFlatLay(photo: Rgb, cal: FlatLayCalibration, uCm: number, vCm: number): [number, number, number] {
  const x = cal.hpsCentrePx[0] + uCm * cal.pxPerCm - 0.5;
  const y = cal.hpsCentrePx[1] + vCm * cal.pxPerCm - 0.5;
  const cx = Math.min(photo.width - 1, Math.max(0, x)), cy = Math.min(photo.height - 1, Math.max(0, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy);
  const x1 = Math.min(photo.width - 1, x0 + 1), y1 = Math.min(photo.height - 1, y0 + 1);
  const fx = cx - x0, fy = cy - y0;
  const at = (xx: number, yy: number, c: number): number => photo.data[3 * (yy * photo.width + xx) + c]!;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = Math.round((at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) + (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy);
  return out;
}

/**
 * A painter for a shop's flat-lay photos: the front and back panels from the photo of that side, the sleeves from
 * `sleeves` (a flat-lay photo does not show a sleeve flat; a repeating print or a plain colour fills them).
 */
export function flatLayPainter(front: { photo: Rgb; cal: FlatLayCalibration }, back: { photo: Rgb; cal: FlatLayCalibration }, sleeves: Painter): Painter {
  return (panel, u, v) => (panel === 'front' ? sampleFlatLay(front.photo, front.cal, u, v) : panel === 'back' ? sampleFlatLay(back.photo, back.cal, u, v) : sleeves(panel, u, v));
}
