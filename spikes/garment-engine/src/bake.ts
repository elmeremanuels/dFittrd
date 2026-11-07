/**
 * Stage 4t texture bake: the turntable's RGB frames projected onto the fitted mesh into its UV atlas
 * (`templateFit.ts` charts: body on top, sleeves below). Per texel: its 3D point and normal from the
 * render mesh; per training view a sample when the point is the visible garment surface there (depth
 * test against the fitted garment and the mannequin), it faces the camera and it projects inside the
 * garment mask. Each sample is weighted by the view angle (cos^anglePower of the normal to the camera)
 * and by its distance to the mask's edge (a ramp over `edgePx`, where segmentation and geometry
 * disagree most); only views with at least `keepRatio` of the texel's best weight are blended, so the
 * print is taken from the few views that see it best instead of averaged blurry over all of them.
 * Unseen texels and the gutters between charts are filled by diffusion (pull-push over a mip pyramid,
 * then Jacobi smoothing of the unseen texels).
 *
 * The frames carry the generated video's studio light; the bake keeps it (no de-lighting).
 */
import type { Mesh } from '@curtain/mannequin';
import { vertexNormals } from '@curtain/mannequin';
import type { Mask } from './evalPng';
import type { RgbImage } from './jpeg';
import type { RenderMesh } from './templateFit';
import { insideDistance, project, rasterize, type PinholeCamera } from './views';

export interface BakeOptions {
  size: number;
  anglePower: number;
  edgePx: number;
  /** Visible when the point is within this of the rendered garment depth, cm. */
  depthTolCm: number;
  keepRatio: number;
  /** Minimum cosine between the normal and the direction to the camera. */
  minCos: number;
  /** Jacobi iterations over the unseen texels after pull-push. */
  smoothIterations: number;
}

export const DEFAULT_BAKE: BakeOptions = { size: 2048, anglePower: 4, edgePx: 6, depthTolCm: 1, keepRatio: 0.95, minCos: 0.15, smoothIterations: 30 };

export interface BakeInputs {
  render: Pick<RenderMesh, 'positions' | 'uvs' | 'indices' | 'remap'>;
  /** Welded mesh (the render mesh's vertices map onto it by `remap`): normals and the visibility raster. */
  welded: Pick<Mesh, 'positions' | 'indices'>;
  /** Occluder (the mannequin), or null. */
  body: Pick<Mesh, 'positions' | 'indices'> | null;
  cameras: PinholeCamera[];
  frames: (Uint8Array | null)[];
  masks: (Mask | null)[];
  /** Views to bake from (indices into `cameras`). */
  views: number[];
  options?: Partial<BakeOptions>;
}

export interface BakeReport {
  size: number;
  views: number;
  /** Texels inside a chart, texels seen by at least one view, and the unseen ones filled by diffusion. */
  chartTexels: number;
  seenTexels: number;
  filledTexels: number;
  seenShare: number;
  /** Mean number of views blended per seen texel. */
  meanViewsPerTexel: number;
  timingsMs: Record<string, number>;
  options: BakeOptions;
}

export interface Texels {
  /** Atlas pixel index per texel inside a chart. */
  index: Int32Array;
  pos: Float32Array;
  nrm: Float32Array;
}

/** Texels covered by the render mesh's UV triangles, with their 3D point and normal (barycentric). */
export function texelsOf(render: BakeInputs['render'], welded: BakeInputs['welded'], size: number): Texels {
  const normals = vertexNormals({ positions: Float64Array.from(welded.positions), indices: Uint32Array.from(welded.indices), vertexPart: new Uint8Array(0), partNames: [] });
  const owner = new Int32Array(size * size).fill(-1);
  const idx: number[] = [];
  const pos: number[] = [];
  const nrm: number[] = [];
  const { uvs, indices: I, positions: P, remap } = render;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
    const x0 = uvs[2 * a]! * size, y0 = uvs[2 * a + 1]! * size;
    const x1 = uvs[2 * b]! * size, y1 = uvs[2 * b + 1]! * size;
    const x2 = uvs[2 * c]! * size, y2 = uvs[2 * c + 1]! * size;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(area) < 1e-12) continue;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(size - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(size - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) / area;
        const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const k = py * size + px;
        if (owner[k]! >= 0) continue;
        owner[k] = idx.length;
        idx.push(k);
        for (let d = 0; d < 3; d++) pos.push(w0 * P[3 * a + d]! + w1 * P[3 * b + d]! + w2 * P[3 * c + d]!);
        const na = remap[a]!, nb = remap[b]!, nc = remap[c]!;
        let nx = w0 * normals[3 * na]! + w1 * normals[3 * nb]! + w2 * normals[3 * nc]!;
        let ny = w0 * normals[3 * na + 1]! + w1 * normals[3 * nb + 1]! + w2 * normals[3 * nc + 1]!;
        let nz = w0 * normals[3 * na + 2]! + w1 * normals[3 * nb + 2]! + w2 * normals[3 * nc + 2]!;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        nrm.push(nx, ny, nz);
      }
    }
  }
  return { index: Int32Array.from(idx), pos: Float32Array.from(pos), nrm: Float32Array.from(nrm) };
}

/** One view prepared for sampling texel points: camera, garment+mannequin depth, mask, edge distance, frame. */
interface PreparedView {
  W: number;
  H: number;
  R: Float64Array;
  t: Float64Array;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  C: readonly [number, number, number];
  ids: Uint8Array;
  depth: Float32Array;
  mask: Uint8Array;
  edge: Float32Array;
  frame: Uint8Array;
}

function prepareView(inp: BakeInputs, v: number): PreparedView | null {
  const cam = inp.cameras[v]!;
  const frame = inp.frames[v];
  const mask = inp.masks[v];
  if (!frame || !mask) return null;
  const r = rasterize(cam, [...(inp.body ? [{ positions: inp.body.positions, indices: inp.body.indices, id: 1 }] : []), { positions: inp.welded.positions, indices: inp.welded.indices, id: 2 }]);
  return { W: cam.width, H: cam.height, R: cam.R, t: cam.t, fx: cam.fx, fy: cam.fy, cx: cam.cx, cy: cam.cy, C: cam.centre, ids: r.ids, depth: r.depth, mask: mask.data, edge: insideDistance(mask), frame };
}

/**
 * Weight (0 = not seen) of every texel in one view, and with `rgbOut` its bilinear colour. The hot
 * loop of the bake: no closures, early outs before the projection.
 */
function sampleView(pv: PreparedView, tx: Texels, opt: BakeOptions, wOut: Float32Array, rgbOut: Float32Array | null, only: Uint8Array | null): void {
  const { W, H, R, t, fx, fy, cx, cy, ids, depth, mask, edge, frame } = pv;
  const [Cx, Cy, Cz] = pv.C;
  const n = tx.index.length;
  const P = tx.pos, N = tx.nrm;
  const r0 = R[0]!, r1 = R[1]!, r2 = R[2]!, r3 = R[3]!, r4 = R[4]!, r5 = R[5]!, r6 = R[6]!, r7 = R[7]!, r8 = R[8]!;
  const t0 = t[0]!, t1 = t[1]!, t2 = t[2]!;
  const minCos = opt.minCos, tol = opt.depthTolCm, invEdge = 1 / opt.edgePx, pw = opt.anglePower;
  for (let i = 0; i < n; i++) {
    wOut[i] = 0;
    if (only && !only[i]) continue;
    const x = P[3 * i]!, y = P[3 * i + 1]!, z = P[3 * i + 2]!;
    const dx = Cx - x, dy = Cy - y, dz = Cz - z;
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cos = (N[3 * i]! * dx + N[3 * i + 1]! * dy + N[3 * i + 2]! * dz) / dl;
    if (cos < minCos) continue;
    const zc = r6 * x + r7 * y + r8 * z + t2;
    if (zc <= 0) continue;
    const u = (fx * (r0 * x + r1 * y + r2 * z + t0)) / zc + cx;
    const v = (fy * (r3 * x + r4 * y + r5 * z + t1)) / zc + cy;
    if (u < 0.5 || v < 0.5 || u >= W - 1.5 || v >= H - 1.5) continue;
    const p = (v | 0) * W + (u | 0);
    if (ids[p] !== 2 || !mask[p]) continue;
    const dd = depth[p]! - zc;
    if (dd > tol || dd < -tol) continue;
    const e = edge[p]! * invEdge;
    if (e <= 0) continue;
    const c2 = cos * cos;
    wOut[i] = (pw === 4 ? c2 * c2 : Math.pow(cos, pw)) * (e < 1 ? e : 1);
    if (rgbOut) {
      const fxp = u - 0.5, fyp = v - 0.5;
      const x0 = fxp | 0, y0 = fyp | 0;
      const ax = fxp - x0, ay = fyp - y0;
      const k00 = 3 * (y0 * W + x0), k10 = k00 + 3, k01 = k00 + 3 * W, k11 = k01 + 3;
      for (let ch = 0; ch < 3; ch++) {
        rgbOut[3 * i + ch] = (frame[k00 + ch]! * (1 - ax) + frame[k10 + ch]! * ax) * (1 - ay) + (frame[k01 + ch]! * (1 - ax) + frame[k11 + ch]! * ax) * ay;
      }
    }
  }
}

/** Pull-push fill of every pixel with weight 0 from the weighted ones (a multigrid diffusion). */
export function pullPush(rgb: Float32Array, weight: Float32Array, size: number): void {
  if (size <= 1) return;
  const half = size >> 1;
  const crgb = new Float32Array(half * half * 3);
  const cw = new Float32Array(half * half);
  for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
    let ws = 0, r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const k = (2 * y + dy) * size + 2 * x + dx;
      const w = Math.min(1, weight[k]!);
      ws += w;
      r += rgb[3 * k]! * w;
      g += rgb[3 * k + 1]! * w;
      b += rgb[3 * k + 2]! * w;
    }
    const c = y * half + x;
    cw[c] = ws / 4;
    if (ws > 0) {
      crgb[3 * c] = r / ws;
      crgb[3 * c + 1] = g / ws;
      crgb[3 * c + 2] = b / ws;
    }
  }
  pullPush(crgb, cw, half);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = y * size + x;
    const w = Math.min(1, weight[k]!);
    if (w >= 1) continue;
    // Bilinear from the coarser level.
    const fx = Math.min(half - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(half - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(half - 1, x0 + 1), y1 = Math.min(half - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    for (let ch = 0; ch < 3; ch++) {
      const c = (crgb[3 * (y0 * half + x0) + ch]! * (1 - tx) + crgb[3 * (y0 * half + x1) + ch]! * tx) * (1 - ty) + (crgb[3 * (y1 * half + x0) + ch]! * (1 - tx) + crgb[3 * (y1 * half + x1) + ch]! * tx) * ty;
      rgb[3 * k + ch] = rgb[3 * k + ch]! * w + c * (1 - w);
    }
    weight[k] = Math.max(weight[k]!, 1e-6);
  }
}

export interface BakeResult {
  atlas: RgbImage;
  /** Per atlas pixel: summed weight (0 = not seen by any view). */
  seenWeight: Float32Array;
  texels: Texels;
  report: BakeReport;
}

export function bakeTexture(inp: BakeInputs): BakeResult {
  const opt: BakeOptions = { ...DEFAULT_BAKE, ...inp.options };
  const S = opt.size;
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  const lap = (k: string): void => {
    const t = performance.now();
    timings[k] = Math.round(t - t0);
    t0 = t;
  };
  const tx = texelsOf(inp.render, inp.welded, S);
  const n = tx.index.length;
  lap('texels');
  // Views are prepared one at a time (a prepared view holds full-frame buffers).
  const views = inp.views.filter((v) => inp.frames[v] && inp.masks[v]);
  lap('views');
  // Pass 1: best weight per texel.
  const best = new Float32Array(n);
  const w = new Float32Array(n);
  const col = new Float32Array(n * 3);
  for (const v of views) {
    const pv = prepareView(inp, v)!;
    sampleView(pv, tx, opt, w, null, null);
    for (let i = 0; i < n; i++) if (w[i]! > best[i]!) best[i] = w[i]!;
  }
  lap('pass1');
  // Pass 2: blend the views within keepRatio of the best.
  const acc = new Float32Array(n * 3);
  const wsum = new Float32Array(n);
  const count = new Uint16Array(n);
  const seenMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) seenMask[i] = best[i]! > 0 ? 1 : 0;
  for (const v of views) {
    const pv = prepareView(inp, v)!;
    sampleView(pv, tx, opt, w, col, seenMask);
    for (let i = 0; i < n; i++) {
      const wi = w[i]!;
      if (wi <= 0 || wi < opt.keepRatio * best[i]!) continue;
      acc[3 * i] = acc[3 * i]! + wi * col[3 * i]!;
      acc[3 * i + 1] = acc[3 * i + 1]! + wi * col[3 * i + 1]!;
      acc[3 * i + 2] = acc[3 * i + 2]! + wi * col[3 * i + 2]!;
      wsum[i] = wsum[i]! + wi;
      count[i] = count[i]! + 1;
    }
  }
  lap('pass2');
  const rgb = new Float32Array(S * S * 3);
  const weight = new Float32Array(S * S);
  let seen = 0, viewsSum = 0;
  for (let i = 0; i < n; i++) {
    if (wsum[i]! <= 0) continue;
    const k = tx.index[i]!;
    rgb[3 * k] = acc[3 * i]! / wsum[i]!;
    rgb[3 * k + 1] = acc[3 * i + 1]! / wsum[i]!;
    rgb[3 * k + 2] = acc[3 * i + 2]! / wsum[i]!;
    weight[k] = 1;
    seen++;
    viewsSum += count[i]!;
  }
  const seenWeight = Float32Array.from(weight);
  pullPush(rgb, weight, S);
  // Diffusion over the unseen chart texels (pull-push leaves block structure at coarse levels).
  const unseen: number[] = [];
  for (let i = 0; i < n; i++) if (wsum[i]! <= 0) unseen.push(tx.index[i]!);
  for (let it = 0; it < opt.smoothIterations; it++) {
    for (const k of unseen) {
      const x = k % S, y = (k - x) / S;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0, cnt = 0;
        if (x > 0) { sum += rgb[3 * (k - 1) + ch]!; cnt++; }
        if (x < S - 1) { sum += rgb[3 * (k + 1) + ch]!; cnt++; }
        if (y > 0) { sum += rgb[3 * (k - S) + ch]!; cnt++; }
        if (y < S - 1) { sum += rgb[3 * (k + S) + ch]!; cnt++; }
        rgb[3 * k + ch] = sum / cnt;
      }
    }
  }
  lap('fill');
  const data = new Uint8Array(S * S * 3);
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, Math.round(rgb[i]!)));
  return {
    atlas: { width: S, height: S, data },
    seenWeight,
    texels: tx,
    report: { size: S, views: views.length, chartTexels: n, seenTexels: seen, filledTexels: n - seen, seenShare: n ? Math.round((seen / n) * 10000) / 10000 : 0, meanViewsPerTexel: seen ? Math.round((viewsSum / seen) * 100) / 100 : 0, timingsMs: timings, options: opt },
  };
}

export interface PhotometricCheck {
  view: number;
  /** Pixels compared (garment visible in the render and in the mask). */
  pixels: number;
  /** Mean absolute error per channel, 0–255, of the baked texture and of one mean colour (what the old bundle showed). */
  maeTexture: number;
  maeMeanColour: number;
  psnrTexture: number;
  psnrMeanColour: number;
  /** The same MAE on 8 × 8 pixel blocks (about 2.3 cm on the dress): colour layout, insensitive to the few-pixel shifts between generated frames. */
  maeTextureBlock8: number;
  maeMeanColourBlock8: number;
}

/**
 * The baked atlas seen from a (held-out) view, by splatting every visible texel into its pixel, against
 * the frame inside the garment mask. Also scores one mean garment colour the same way, the baseline
 * the old bundle had.
 */
export function photometricCheck(inp: BakeInputs, bake: BakeResult, v: number, meanColour: [number, number, number]): PhotometricCheck | null {
  const opt: BakeOptions = { ...DEFAULT_BAKE, ...inp.options, edgePx: 1e-9, minCos: 0.05, anglePower: 1 };
  const pv = prepareView(inp, v);
  if (!pv) return null;
  const tx = bake.texels;
  const n = tx.index.length;
  const w = new Float32Array(n);
  sampleView(pv, tx, opt, w, null, null);
  const cam = inp.cameras[v]!;
  const W = cam.width;
  const sum = new Float64Array(cam.width * cam.height * 3);
  const cnt = new Uint32Array(cam.width * cam.height);
  const q = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    if (w[i]! <= 0) continue;
    project(cam, tx.pos[3 * i]!, tx.pos[3 * i + 1]!, tx.pos[3 * i + 2]!, q);
    const p = (q[1]! | 0) * W + (q[0]! | 0);
    const k = tx.index[i]!;
    for (let ch = 0; ch < 3; ch++) sum[3 * p + ch] = sum[3 * p + ch]! + bake.atlas.data[3 * k + ch]!;
    cnt[p] = cnt[p]! + 1;
  }
  const frame = pv.frame;
  let px = 0, aeT = 0, aeM = 0, seT = 0, seM = 0;
  for (let p = 0; p < cnt.length; p++) {
    if (!cnt[p]) continue;
    px++;
    for (let ch = 0; ch < 3; ch++) {
      const truth = frame[3 * p + ch]!;
      const t = sum[3 * p + ch]! / cnt[p]!;
      aeT += Math.abs(t - truth);
      aeM += Math.abs(meanColour[ch]! - truth);
      seT += (t - truth) ** 2;
      seM += (meanColour[ch]! - truth) ** 2;
    }
  }
  if (!px) return null;
  // Blocks: mean of the compared pixels per 8 × 8 block, texture and frame alike.
  const B = 8;
  const bw = Math.ceil(W / B), bh = Math.ceil(cam.height / B);
  const bt = new Float64Array(bw * bh * 3), bf = new Float64Array(bw * bh * 3), bn = new Uint32Array(bw * bh);
  for (let p = 0; p < cnt.length; p++) {
    if (!cnt[p]) continue;
    const x = p % W, y = (p - x) / W;
    const b = Math.floor(y / B) * bw + Math.floor(x / B);
    bn[b] = bn[b]! + 1;
    for (let ch = 0; ch < 3; ch++) {
      bt[3 * b + ch] = bt[3 * b + ch]! + sum[3 * p + ch]! / cnt[p]!;
      bf[3 * b + ch] = bf[3 * b + ch]! + frame[3 * p + ch]!;
    }
  }
  let nb = 0, beT = 0, beM = 0;
  for (let b = 0; b < bn.length; b++) {
    if (bn[b]! < (B * B) / 2) continue;
    nb++;
    for (let ch = 0; ch < 3; ch++) {
      const f = bf[3 * b + ch]! / bn[b]!;
      beT += Math.abs(bt[3 * b + ch]! / bn[b]! - f);
      beM += Math.abs(meanColour[ch]! - f);
    }
  }
  const psnr = (se: number): number => Math.round(10 * Math.log10((255 * 255) / (se / (3 * px))) * 100) / 100;
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  return { view: v, pixels: px, maeTexture: r2(aeT / (3 * px)), maeMeanColour: r2(aeM / (3 * px)), psnrTexture: psnr(seT), psnrMeanColour: psnr(seM), maeTextureBlock8: nb ? r2(beT / (3 * nb)) : NaN, maeMeanColourBlock8: nb ? r2(beM / (3 * nb)) : NaN };
}
