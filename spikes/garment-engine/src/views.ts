/**
 * Stage 4t inputs (template fit, `templateFit.ts`): calibrated pinhole cameras, garment masks and
 * RGB frames of a turntable, and a z-buffer rasteriser that works in those cameras.
 *
 * The cameras are the exporter's `cameras_opencv.json` (OpenCV axes: x right, y down, z forward;
 * world = mannequin space in metres; pixel origin at the corner of the top-left pixel). Points in
 * this module are in cm, mannequin space, as everywhere in the spike. For synthetic tests a camera
 * is built from a `@curtain/mannequin` `CameraFrame` with the same conventions, so both give the
 * same pixels (checked in `templateFit.test.ts`).
 *
 * Everything read from a job dir is data written by our own GPU stages: sizes are checked before use.
 */
import { cross, normalize, sub, type CameraFrame, type Vec3 } from '@curtain/mannequin';
import type { Mask } from './evalPng';

export interface PinholeCamera {
  /** Turntable frame index. */
  index: number;
  azimuthDeg: number;
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  /** World → camera rotation, row-major 3×3. */
  R: Float64Array;
  /** World → camera translation, cm. */
  t: Float64Array;
  /** Camera centre in world space, cm. */
  centre: Vec3;
}

/** Camera from a mannequin `CameraFrame` (OpenCV axes; square pixels; principal point at the image centre). */
export function cameraFromFrame(frame: CameraFrame, width: number, height: number): PinholeCamera {
  const f = normalize(sub(frame.lookAt, frame.position));
  const r = normalize(cross(f, frame.up));
  const d = cross(f, r);
  const R = Float64Array.from([...r, ...d, ...f]);
  const C = frame.position;
  const t = Float64Array.from([0, 1, 2].map((k) => -(R[3 * k]! * C[0] + R[3 * k + 1]! * C[1] + R[3 * k + 2]! * C[2])));
  const fy = height / 2 / Math.tan(((frame.fovYDeg * Math.PI) / 180) / 2);
  return { index: frame.index, azimuthDeg: frame.azimuthDeg, width, height, fx: fy, fy, cx: width / 2, cy: height / 2, R, t, centre: [...C] as Vec3 };
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Cameras from `cameras_opencv.json` (metres → cm). Throws on anything malformed. */
export function camerasFromOpencvJson(json: unknown): PinholeCamera[] {
  const o = json as { width?: unknown; height?: unknown; K?: unknown; unit?: unknown; frames?: unknown };
  if (!o || typeof o !== 'object') throw new Error('cameras_opencv.json: not an object');
  const width = o.width, height = o.height;
  if (!isNum(width) || !isNum(height) || width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error('cameras_opencv.json: bad width/height');
  const K = o.K as unknown[][] | undefined;
  if (!Array.isArray(K) || K.length !== 3 || !K.every((r) => Array.isArray(r) && r.length === 3 && r.every(isNum))) throw new Error('cameras_opencv.json: bad K');
  const k = K as number[][];
  const scale = o.unit === 'cm' ? 1 : 100;
  if (!Array.isArray(o.frames) || o.frames.length === 0 || o.frames.length > 10000) throw new Error('cameras_opencv.json: no frames');
  return o.frames.map((fr: unknown, i: number) => {
    const f = fr as { index?: unknown; azimuthDeg?: unknown; w2c?: unknown };
    const w2c = f.w2c as unknown[][] | undefined;
    if (!Array.isArray(w2c) || w2c.length < 3 || !w2c.slice(0, 3).every((r) => Array.isArray(r) && r.length === 4 && r.every(isNum))) throw new Error(`cameras_opencv.json: frame ${i}: bad w2c`);
    const m = w2c as number[][];
    const R = Float64Array.from([m[0]![0]!, m[0]![1]!, m[0]![2]!, m[1]![0]!, m[1]![1]!, m[1]![2]!, m[2]![0]!, m[2]![1]!, m[2]![2]!]);
    const t = Float64Array.from([m[0]![3]! * scale, m[1]![3]! * scale, m[2]![3]! * scale]);
    // C = −Rᵀ t
    const centre: Vec3 = [0, 1, 2].map((c) => -(R[c]! * t[0]! + R[3 + c]! * t[1]! + R[6 + c]! * t[2]!)) as Vec3;
    return { index: isNum(f.index) ? f.index : i, azimuthDeg: isNum(f.azimuthDeg) ? f.azimuthDeg : (360 * i) / (o.frames as unknown[]).length, width, height, fx: k[0]![0]!, fy: k[1]![1]!, cx: k[0]![2]!, cy: k[1]![2]!, R, t, centre };
  });
}

/** Projects a point (cm) into the camera: pixel coordinates (corner origin) and depth along the optical axis (cm). `z ≤ 0` = behind. */
export function project(cam: PinholeCamera, x: number, y: number, z: number, out: Float64Array = new Float64Array(3)): Float64Array {
  const R = cam.R, t = cam.t;
  const xc = R[0]! * x + R[1]! * y + R[2]! * z + t[0]!;
  const yc = R[3]! * x + R[4]! * y + R[5]! * z + t[1]!;
  const zc = R[6]! * x + R[7]! * y + R[8]! * z + t[2]!;
  out[0] = (cam.fx * xc) / zc + cam.cx;
  out[1] = (cam.fy * yc) / zc + cam.cy;
  out[2] = zc;
  return out;
}

export interface RasterItem {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Written to the id buffer (0 = background). */
  id: number;
}

export interface DepthRaster {
  width: number;
  height: number;
  /** Depth along the optical axis, cm; Infinity = background. */
  depth: Float32Array;
  /** Visible item id per pixel. */
  ids: Uint8Array;
  /** Visible triangle (index into that item's triangles) per pixel, −1 = none. */
  tri: Int32Array;
}

/** Z-buffered triangles in a pinhole camera; pixel centres at +0.5; perspective-correct depth. */
export function rasterize(cam: PinholeCamera, items: readonly RasterItem[]): DepthRaster {
  const { width, height } = cam;
  const depth = new Float32Array(width * height).fill(Infinity);
  const ids = new Uint8Array(width * height);
  const tri = new Int32Array(width * height).fill(-1);
  const p = new Float64Array(3);
  for (const item of items) {
    const nv = item.positions.length / 3;
    const sx = new Float64Array(nv), sy = new Float64Array(nv), sz = new Float64Array(nv);
    for (let v = 0; v < nv; v++) {
      project(cam, item.positions[3 * v]!, item.positions[3 * v + 1]!, item.positions[3 * v + 2]!, p);
      sx[v] = p[0]!;
      sy[v] = p[1]!;
      sz[v] = p[2]!;
    }
    for (let t = 0; t < item.indices.length; t += 3) {
      const a = item.indices[t]!, b = item.indices[t + 1]!, c = item.indices[t + 2]!;
      if (sz[a]! <= 1 || sz[b]! <= 1 || sz[c]! <= 1) continue;
      const x0 = sx[a]!, y0 = sy[a]!, x1 = sx[b]!, y1 = sy[b]!, x2 = sx[c]!, y2 = sy[c]!;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (area === 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minX > maxX || minY > maxY) continue;
      const iw0 = 1 / sz[a]!, iw1 = 1 / sz[b]!, iw2 = 1 / sz[c]!;
      const inv = 1 / area;
      for (let py = minY; py <= maxY; py++) {
        const cy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const cx = px + 0.5;
          const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) * inv;
          const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = 1 / (w0 * iw0 + w1 * iw1 + w2 * iw2);
          const k = py * width + px;
          if (z >= depth[k]!) continue;
          depth[k] = z;
          ids[k] = item.id;
          tri[k] = t / 3;
        }
      }
    }
  }
  return { width, height, depth, ids, tri };
}

/** Pixels whose visible id is `id`. */
export function idMask(r: DepthRaster, id: number): Mask {
  const data = new Uint8Array(r.width * r.height);
  for (let i = 0; i < data.length; i++) data[i] = r.ids[i] === id ? 1 : 0;
  return { width: r.width, height: r.height, data };
}

// ---------------------------------------------------------------------------
// Mask clean-up (segmentation masks of generated frames have speckle and small holes)
// ---------------------------------------------------------------------------

/** Square dilation (`grow` = true) or erosion by `radius` pixels, separable. */
export function morph(mask: Mask, radius: number, grow: boolean): Mask {
  if (radius <= 0) return mask;
  const { width: w, height: h } = mask;
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  const hit = grow ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - hit;
      for (let d = -radius; d <= radius && v !== hit; d++) {
        const xx = x + d;
        const s = xx < 0 || xx >= w ? 0 : mask.data[y * w + xx]!;
        if (s === hit) v = hit;
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 1 - hit;
      for (let d = -radius; d <= radius && v !== hit; d++) {
        const yy = y + d;
        const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x]!;
        if (s === hit) v = hit;
      }
      out[y * w + x] = v;
    }
  }
  return { width: w, height: h, data: out };
}

/** Fills background regions that do not touch the image border and are at most `maxArea` pixels (holes in the garment). */
export function fillHoles(mask: Mask, maxArea: number): Mask {
  const { width: w, height: h } = mask;
  const data = Uint8Array.from(mask.data);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const region: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (data[s] || seen[s]) continue;
    region.length = 0;
    let border = false;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || data[j] || seen[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (!border && region.length <= maxArea) for (const i of region) data[i] = 1;
  }
  return { width: w, height: h, data };
}

/** Removes foreground components smaller than `minArea` pixels (specks). */
export function removeSpecks(mask: Mask, minArea: number): Mask {
  const { width: w, height: h } = mask;
  const data = Uint8Array.from(mask.data);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const region: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (!data[s] || seen[s]) continue;
    region.length = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      region.push(i);
      const x = i % w, y = (i - x) / w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || !data[j] || seen[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (region.length < minArea) for (const i of region) data[i] = 0;
  }
  return { width: w, height: h, data };
}

export interface MaskCleanup {
  /** Closing radius, px (fills cracks). */
  closeRadius: number;
  /** Interior holes up to this many pixels are filled. */
  maxHoleArea: number;
  /** Foreground specks below this many pixels are removed. */
  minSpeckArea: number;
}

export const DEFAULT_CLEANUP: MaskCleanup = { closeRadius: 2, maxHoleArea: 600, minSpeckArea: 80 };

export function cleanMask(mask: Mask, c: MaskCleanup = DEFAULT_CLEANUP): Mask {
  const closed = morph(morph(mask, c.closeRadius, true), c.closeRadius, false);
  return removeSpecks(fillHoles(closed, c.maxHoleArea), c.minSpeckArea);
}

/**
 * Distance (px, city-block approximation refined by two passes of the 3-4 chamfer) from every
 * foreground pixel to the nearest background pixel; 0 on background. Used as the "far from the
 * silhouette edge" weight of the texture bake.
 */
export function insideDistance(mask: Mask): Float32Array {
  const { width: w, height: h } = mask;
  const d = new Float32Array(w * h);
  const INF = 1e9;
  for (let i = 0; i < w * h; i++) d[i] = mask.data[i] ? INF : 0;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < w * h; i++) d[i] = d[i]! / 3;
  return d;
}

/** Train/holdout split of turntable frames: every `every`-th frame (starting at `offset`) is held out. */
export function splitFrames(n: number, every = 5, offset = 2): { train: number[]; holdout: number[] } {
  const train: number[] = [];
  const holdout: number[] = [];
  for (let i = 0; i < n; i++) (i % every === offset ? holdout : train).push(i);
  return { train, holdout };
}
