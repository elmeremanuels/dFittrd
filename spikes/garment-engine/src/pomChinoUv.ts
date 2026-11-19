/**
 * UVs per panel for the POM chino (`pomChino.ts`), and the SYNTHETIC chino atlas painted on them.
 *
 * The chino's mesh is rows of cloth, so each pattern piece is unrolled row by row (no relaxation): a row is a level line
 * of the piece, `v` is the distance down the side seam from the piece's top row and `u` the distance along the row from
 * the side seam (negative towards the centre front on a front piece, positive towards the centre back on a back piece;
 * the fork is the part of the crotch row that runs on past the centre seam, as on a paper pattern). The waistband is two
 * strips, cut at the centre front and the centre back: `u` runs from the centre front, `v` down from its top edge.
 * How much that stretches or squeezes the cloth is measured (`distortion`, flat ÷ on the garment per edge), not assumed.
 *
 * Seams cut the atlas: a welded vertex gets one render vertex per piece it lies on. Render vertices 0…n−1 are the welded
 * vertices in their own order, the copies come after, so the viewer's weld by position gives the base mesh back unchanged.
 *
 * The atlas is painted from pattern cm by code only: the product's own colour, topstitching along the seams and the hem,
 * a fly, two slanted front pockets, two back welt pockets, belt loops and a button. No photo, no product, no third-party
 * artwork (CC0-1.0); it exists so the UVs can be seen to carry detail at its real size on the right piece.
 */
import { CHINO_PANELS, type ChinoPanel, type PomChinoBuild } from './pomChino';

export const CHINO_ATLAS_GAP_CM = 3;
export const CHINO_ATLAS_BLEED_CM = 1.5;
export const CHINO_PRINT_LICENCE = 'CC0-1.0';
export const CHINO_PRINT_SOURCE = 'synthetic: painted by spikes/garment-engine/src/pomChinoUv.ts from the pattern coordinates (no photo, no product, no third-party artwork)';

export interface ChinoIsland {
  panel: ChinoPanel;
  min: [number, number];
  max: [number, number];
  originPx: [number, number];
}

export interface ChinoUvLayout {
  sizePx: number;
  pxPerCm: number;
  islands: ChinoIsland[];
  /** Render vertex → welded vertex. */
  remap: Uint32Array;
  /** Render vertex → panel index (`CHINO_PANELS`). */
  panelOf: Uint8Array;
  /** Pattern coordinates per render vertex, cm. */
  patternCm: Float64Array;
  /** Atlas UVs per render vertex (0..1, v down). */
  uvs: Float32Array;
  indices: Uint32Array;
  /** Per leg piece: `u` of its centre seam (centre front or back) by `v`, from the top row down to the crotch row; and `v` of the crotch row and of the hem. */
  centreSeam: Record<string, { v: number; u: number }[]>;
  crotchV: number;
  hemV: number;
  /** Edge length flat ÷ on the garment, per piece: median and the 1st / 99th percentile. */
  distortion: Record<ChinoPanel, { median: number; p01: number; p99: number }>;
}

type Strip = { ids: number[]; ref: number }[];

export function chinoUvLayout(b: Pick<PomChinoBuild, 'mesh' | 'triPanel' | 'legRows' | 'torsoRows' | 'bandRow' | 'inseamColumn'>, sizePx = 1024): ChinoUvLayout {
  const P = b.mesh.positions;
  const n = P.length / 3;
  const N = b.legRows[0][0]!.length;
  const T = b.torsoRows[1]!.length;
  const half = T / 2;
  const dist = (i: number, j: number): number => Math.hypot(P[3 * i]! - P[3 * j]!, P[3 * i + 1]! - P[3 * j + 1]!, P[3 * i + 2]! - P[3 * j + 2]!);
  const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);

  // The rows of every piece, top to bottom; `ref` is the index in the row of the vertex on the reference line.
  const strips: Strip[] = CHINO_PANELS.map(() => []);
  // Every front piece is listed centre seam → side seam, every back piece side seam → centre seam (the right-hand
  // pieces run the other way round the ring, so the mirror image has the same pattern coordinates).
  const torsoCols: Record<number, number[]> = { 0: range(0, half / 2), 2: range(half / 2, half), 1: [0, ...range(half + half / 2, T - 1).reverse()], 3: range(half, half + half / 2).reverse() };
  const JC = b.inseamColumn;
  const front = range(JC, N / 2), back = [...range(N / 2, N - 1), ...range(0, JC)];
  const legCols: Record<number, number[]> = { 0: front, 1: front, 2: back, 3: back };
  for (const panel of [0, 1, 2, 3]) {
    // The reference line is always the side seam.
    const tc = torsoCols[panel]!;
    const tRef = panel < 2 ? tc.length - 1 : 0;
    for (let r = b.bandRow; r >= 1; r--) strips[panel]!.push({ ids: tc.map((c) => b.torsoRows[r]![c]!), ref: tRef });
    const side = panel === 0 || panel === 2 ? 0 : 1;
    const lc = legCols[panel]!;
    const lRef = panel < 2 ? lc.length - 1 : 0;
    for (let r = b.legRows[side].length - 1; r >= 0; r--) strips[panel]!.push({ ids: lc.map((j) => b.legRows[side][r]![j]!), ref: lRef });
  }
  for (let r = b.torsoRows.length - 1; r >= b.bandRow; r--) {
    strips[4]!.push({ ids: range(0, half).map((c) => b.torsoRows[r]![c]!), ref: 0 });
    strips[5]!.push({ ids: [0, ...range(half, T - 1).reverse()].map((c) => b.torsoRows[r]![c]!), ref: 0 });
  }

  // Unroll: v down the reference line, u along each row from it.
  const flatOf: Map<number, [number, number]>[] = CHINO_PANELS.map(() => new Map());
  const centreSeam: ChinoUvLayout['centreSeam'] = {};
  let crotchV = 0, hemV = 0;
  strips.forEach((rows, panel) => {
    let v = 0;
    const seam: { v: number; u: number }[] = [];
    rows.forEach((row, k) => {
      if (k > 0) v += dist(rows[k - 1]!.ids[rows[k - 1]!.ref]!, row.ids[row.ref]!);
      const us = new Array<number>(row.ids.length).fill(0);
      for (let i = row.ref + 1; i < row.ids.length; i++) us[i] = us[i - 1]! + dist(row.ids[i - 1]!, row.ids[i]!);
      for (let i = row.ref - 1; i >= 0; i--) us[i] = us[i + 1]! - dist(row.ids[i + 1]!, row.ids[i]!);
      row.ids.forEach((id, i) => flatOf[panel]!.set(id, [us[i]!, v]));
      if (panel < 4 && k < b.bandRow) seam.push({ v, u: us[row.ref === 0 ? row.ids.length - 1 : 0]! });
      if (panel === 0 && k === b.bandRow) crotchV = v;
      if (panel === 0 && k === rows.length - 1) hemV = v;
    });
    if (panel < 4) centreSeam[CHINO_PANELS[panel]!] = seam;
  });

  // Render vertices: the welded ones first (each on the first piece that uses it), then one more per further piece.
  const first = new Int16Array(n).fill(-1);
  for (let t = 0; t < b.triPanel.length; t++) for (let e = 0; e < 3; e++) {
    const v = b.mesh.indices[3 * t + e]!;
    if (first[v] === -1) first[v] = b.triPanel[t]!;
  }
  const remap: number[] = [], panelOf: number[] = [];
  const key = new Map<number, number>();
  for (let v = 0; v < n; v++) {
    remap.push(v);
    panelOf.push(Math.max(0, first[v]!));
    key.set(v * 8 + Math.max(0, first[v]!), v);
  }
  const indices = new Uint32Array(b.mesh.indices.length);
  for (let t = 0; t < b.triPanel.length; t++) for (let e = 0; e < 3; e++) {
    const v = b.mesh.indices[3 * t + e]!, p = b.triPanel[t]!;
    let r = key.get(v * 8 + p);
    if (r === undefined) {
      r = remap.length;
      remap.push(v);
      panelOf.push(p);
      key.set(v * 8 + p, r);
    }
    indices[3 * t + e] = r;
  }
  const R = remap.length;
  const flat = new Float64Array(2 * R);
  for (let r = 0; r < R; r++) {
    const f = flatOf[panelOf[r]!]!.get(remap[r]!);
    if (!f) throw new Error(`vertex ${remap[r]} has no place on piece ${CHINO_PANELS[panelOf[r]!]}`);
    flat[2 * r] = f[0];
    flat[2 * r + 1] = f[1];
  }

  // Atlas: the four leg pieces side by side, the two band strips under them.
  const islands: ChinoIsland[] = CHINO_PANELS.map((panel, k) => {
    const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
    for (let r = 0; r < R; r++) if (panelOf[r] === k) {
      min[0] = Math.min(min[0], flat[2 * r]!); min[1] = Math.min(min[1], flat[2 * r + 1]!);
      max[0] = Math.max(max[0], flat[2 * r]!); max[1] = Math.max(max[1], flat[2 * r + 1]!);
    }
    return { panel, min, max, originPx: [0, 0] };
  });
  const w = (k: number): number => islands[k]!.max[0] - islands[k]!.min[0];
  const h = (k: number): number => islands[k]!.max[1] - islands[k]!.min[1];
  const g = CHINO_ATLAS_GAP_CM;
  const legsW = g + w(0) + g + w(1) + g + w(2) + g + w(3) + g;
  const legsH = Math.max(h(0), h(1), h(2), h(3));
  const widthCm = Math.max(legsW, g + w(4) + g + w(5) + g);
  const heightCm = g + legsH + g + Math.max(h(4), h(5)) + g;
  const pxPerCm = sizePx / Math.max(widthCm, heightCm);
  let x = g;
  for (const k of [0, 1, 2, 3]) {
    islands[k]!.originPx = [x * pxPerCm, g * pxPerCm];
    x += w(k) + g;
  }
  islands[4]!.originPx = [g * pxPerCm, (g + legsH + g) * pxPerCm];
  islands[5]!.originPx = [(g + w(4) + g) * pxPerCm, (g + legsH + g) * pxPerCm];
  const uvs = new Float32Array(2 * R);
  for (let r = 0; r < R; r++) {
    const isl = islands[panelOf[r]!]!;
    uvs[2 * r] = (isl.originPx[0] + (flat[2 * r]! - isl.min[0]) * pxPerCm) / sizePx;
    uvs[2 * r + 1] = (isl.originPx[1] + (flat[2 * r + 1]! - isl.min[1]) * pxPerCm) / sizePx;
  }

  const distortion = {} as ChinoUvLayout['distortion'];
  CHINO_PANELS.forEach((panel, k) => {
    const ratio: number[] = [];
    for (let t = 0; t < b.triPanel.length; t++) {
      if (b.triPanel[t] !== k) continue;
      for (let e = 0; e < 3; e++) {
        const ra = indices[3 * t + e]!, rc = indices[3 * t + ((e + 1) % 3)]!;
        const L = dist(remap[ra]!, remap[rc]!);
        if (L > 1e-6) ratio.push(Math.hypot(flat[2 * ra]! - flat[2 * rc]!, flat[2 * ra + 1]! - flat[2 * rc + 1]!) / L);
      }
    }
    ratio.sort((p, q) => p - q);
    const q = (f: number): number => Math.round((ratio[Math.min(ratio.length - 1, Math.floor(f * ratio.length))] ?? NaN) * 1000) / 1000;
    distortion[panel] = { median: q(0.5), p01: q(0.01), p99: q(0.99) };
  });
  return { sizePx, pxPerCm, islands, remap: Uint32Array.from(remap), panelOf: Uint8Array.from(panelOf), patternCm: flat, uvs, indices, centreSeam, crotchV, hemV, distortion };
}

export type ChinoPainter = (panel: ChinoPanel, uCm: number, vCm: number) => [number, number, number];

export function paintChinoAtlas(layout: ChinoUvLayout, painter: ChinoPainter, background: [number, number, number]): Uint8Array {
  const S = layout.sizePx;
  const out = new Uint8Array(S * S * 3);
  for (let i = 0; i < S * S; i++) out.set(background, 3 * i);
  const bleed = CHINO_ATLAS_BLEED_CM * layout.pxPerCm;
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

/** Sizes of the painted details, cm (all made up: a chino as people know it, not a product's). */
export const CHINO_DETAILS = { stitchFromSeamCm: 0.6, stitchWidthCm: 0.22, hemStitchCm: 2, flyWidthCm: 3.6, flyLengthCm: 15, pocketTopFromSideCm: 5, pocketLengthCm: 15, weltFromBandCm: 6.5, weltWidthCm: 13, weltHeightCm: 1, loopWidthCm: 1, buttonRadiusCm: 0.85 } as const;

/**
 * The SYNTHETIC chino: `base` (the product's colour) with darker topstitching and details, from pattern cm. `aa` is the
 * antialiasing width, cm (about one texel).
 */
export function chinoPainter(layout: ChinoUvLayout, base: [number, number, number], aa = 0.18): ChinoPainter {
  const D = CHINO_DETAILS;
  const dark: [number, number, number] = [Math.round(base[0] * 0.66), Math.round(base[1] * 0.64), Math.round(base[2] * 0.6)];
  const shade: [number, number, number] = [Math.round(base[0] * 0.86), Math.round(base[1] * 0.85), Math.round(base[2] * 0.83)];
  const mix = (a: [number, number, number], c: [number, number, number], t: number): [number, number, number] => [Math.round(a[0] + (c[0] - a[0]) * t), Math.round(a[1] + (c[1] - a[1]) * t), Math.round(a[2] + (c[2] - a[2]) * t)];
  const cover = (d: number): number => Math.min(1, Math.max(0, 0.5 + d / aa));
  /** A line of the stitch's width whose centre is `d` cm away. */
  const line = (d: number, width: number = D.stitchWidthCm): number => cover(width / 2 - Math.abs(d));
  const seamU = (panel: string, v: number): number => {
    const s = layout.centreSeam[panel];
    if (!s || s.length === 0) return NaN;
    if (v <= s[0]!.v) return s[0]!.u;
    for (let i = 1; i < s.length; i++) if (v <= s[i]!.v) return s[i - 1]!.u + ((s[i]!.u - s[i - 1]!.u) * (v - s[i - 1]!.v)) / (s[i]!.v - s[i - 1]!.v);
    return s[s.length - 1]!.u;
  };
  const band = Math.max(...layout.islands.filter((i) => i.panel.startsWith('waistband')).map((i) => i.max[1] - i.min[1]));
  return (panel, u, v) => {
    let ink = 0, soft = 0;
    if (panel === 'waistband_l' || panel === 'waistband_r') {
      // Topstitching along both edges, belt loops, and the button on the wearer's left end at the centre front.
      ink = Math.max(line(v - 0.45), line(v - (band - 0.45)));
      const a = Math.abs(u);
      for (const at of [9, 22, 36]) soft = Math.max(soft, cover(D.loopWidthCm / 2 - Math.abs(a - at)));
      ink = Math.max(ink, ...[9, 22, 36].map((at) => line(Math.abs(a - at) - D.loopWidthCm / 2, 0.16)));
      if (panel === 'waistband_l') ink = Math.max(ink, cover(D.buttonRadiusCm - Math.hypot(u - 2, v - band / 2)));
      return mix(mix(base, shade, soft), dark, ink);
    }
    const front = panel === 'front_l' || panel === 'front_r';
    // Side seam (u = 0) and hem.
    ink = Math.max(ink, line(Math.abs(u) - D.stitchFromSeamCm), line(v - (layout.hemV - D.hemStitchCm)));
    const cu = seamU(panel, v);
    const fromCentre = Number.isFinite(cu) ? Math.abs(u - cu) : Infinity;
    if (v < layout.crotchV - 1) ink = Math.max(ink, line(fromCentre - D.stitchFromSeamCm));
    if (front) {
      // Slanted pocket: from the side seam `pocketLengthCm` down, to `pocketTopFromSideCm` in at the band.
      if (v >= 0 && v <= D.pocketLengthCm) ink = Math.max(ink, line((Math.abs(u) - D.pocketTopFromSideCm * (1 - v / D.pocketLengthCm)) * 0.95, 0.3));
      // Fly on the wearer's left: a line `flyWidthCm` from the centre front, turning in to it at the bottom.
      if (panel === 'front_l' && v <= D.flyLengthCm + D.flyWidthCm) {
        const d = v <= D.flyLengthCm ? fromCentre - D.flyWidthCm : Math.hypot(fromCentre, v - D.flyLengthCm) - D.flyWidthCm;
        ink = Math.max(ink, line(d));
      }
    } else {
      // Welt pocket: a box across the middle of the piece, under the band.
      const mid = Number.isFinite(cu) ? cu / 2 : 0;
      const dx = Math.abs(u - mid) - D.weltWidthCm / 2, dy = Math.abs(v - D.weltFromBandCm) - D.weltHeightCm / 2;
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0);
      ink = Math.max(ink, line(outside, 0.26));
      soft = Math.max(soft, cover(-outside));
    }
    return mix(mix(base, shade, soft), dark, ink);
  };
}
