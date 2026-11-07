/**
 * The stage 4t texture bake on a known cylinder: a checkerboard painted on the cylinder in 3D,
 * rendered from cameras round it, baked back into the cylinder's UV atlas; then the same with half
 * the views, so the back is never seen and must be filled by diffusion. Also the JPEG encoder and
 * the textured .glb round trip.
 */
import { describe, expect, it } from 'vitest';
import { bakeTexture, pullPush } from './bake';
import type { Mask } from './evalPng';
import { readTexturedGlb, writeTexturedGlb } from './glbTextured';
import { encodeJpeg } from './jpeg';
import { cameraFromFrame, rasterize, type PinholeCamera } from './views';

const R = 10, Y0 = 80, Y1 = 120, COLS = 64, ROWS = 21;
const A: [number, number, number] = [220, 40, 40];
const B: [number, number, number] = [30, 60, 200];
/** 8 cells round, 4 cm high. */
const checker = (theta: number, y: number): [number, number, number] => {
  const i = Math.floor(((theta / (2 * Math.PI)) * 8 + 8) % 8);
  const j = Math.floor((Y1 - y) / 4);
  return (i + j) % 2 === 0 ? A : B;
};
/** θ measured like the template fit's body tube: 0 at +z (front), increasing towards +x. */
const thetaOf = (x: number, z: number): number => (Math.atan2(x, z) + 2 * Math.PI) % (2 * Math.PI);

/** A cylinder grid (welded) and its render copy with a UV seam (column COLS duplicates column 0 at u = 1). */
function cylinder() {
  const pos: number[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = (2 * Math.PI * c) / COLS, y = Y1 - ((Y1 - Y0) * r) / (ROWS - 1);
    pos.push(R * Math.sin(t), y, R * Math.cos(t));
  }
  const idx: number[] = [];
  const ridx: number[] = [];
  const rpos: number[] = [], uvs: number[] = [], remap: number[] = [];
  const rv = (r: number, c: number): number => {
    const wi = r * COLS + (c % COLS);
    rpos.push(pos[3 * wi]!, pos[3 * wi + 1]!, pos[3 * wi + 2]!);
    uvs.push(c / COLS, r / (ROWS - 1));
    remap.push(wi);
    return rpos.length / 3 - 1;
  };
  const rgrid: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    rgrid.push([]);
    for (let c = 0; c <= COLS; c++) rgrid[r]!.push(rv(r, c));
  }
  for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) {
    const a = r * COLS + c, b = r * COLS + ((c + 1) % COLS), cc = (r + 1) * COLS + ((c + 1) % COLS), d = (r + 1) * COLS + c;
    // Outward: (a, b, cc) with θ increasing towards +x and y decreasing downwards.
    idx.push(a, cc, b, a, d, cc);
    const ra = rgrid[r]![c]!, rb = rgrid[r]![c + 1]!, rc = rgrid[r + 1]![c + 1]!, rd = rgrid[r + 1]![c]!;
    ridx.push(ra, rc, rb, ra, rd, rc);
  }
  return {
    welded: { positions: Float64Array.from(pos), indices: Uint32Array.from(idx) },
    render: { positions: Float64Array.from(rpos), uvs: Float32Array.from(uvs), indices: Uint32Array.from(ridx), remap: Uint32Array.from(remap) },
  };
}

function views(azimuths: number[]): { cams: PinholeCamera[]; frames: Uint8Array[]; masks: Mask[] } {
  const W = 160, H = 160;
  const cams = azimuths.map((az, k) => {
    const rad = (az * Math.PI) / 180;
    return cameraFromFrame({ index: k, azimuthDeg: az, position: [140 * Math.sin(rad), 100, 140 * Math.cos(rad)], lookAt: [0, 100, 0], up: [0, 1, 0], fovYDeg: 24 }, W, H);
  });
  const cyl = cylinder();
  const frames: Uint8Array[] = [];
  const masks: Mask[] = [];
  for (const cam of cams) {
    const r = rasterize(cam, [{ positions: cyl.welded.positions, indices: cyl.welded.indices, id: 2 }]);
    const rgb = new Uint8Array(W * H * 3).fill(235);
    const mask = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) {
      if (r.ids[p] !== 2) continue;
      // Back-project the pixel centre at its depth into the world (camera axes: OpenCV).
      const z = r.depth[p]!, u = (p % W) + 0.5, v = Math.floor(p / W) + 0.5;
      const xc = ((u - cam.cx) / cam.fx) * z, yc = ((v - cam.cy) / cam.fy) * z;
      const w = [0, 1, 2].map((c) => cam.R[c]! * (xc - cam.t[0]!) + cam.R[3 + c]! * (yc - cam.t[1]!) + cam.R[6 + c]! * (z - cam.t[2]!));
      rgb.set(checker(thetaOf(w[0]!, w[2]!), w[1]!), 3 * p);
      mask[p] = 1;
    }
    frames.push(rgb);
    masks.push({ width: W, height: H, data: mask });
  }
  return { cams, frames, masks };
}

const near = (a: ArrayLike<number>, b: readonly number[], tol: number): boolean => Math.abs(a[0]! - b[0]!) <= tol && Math.abs(a[1]! - b[1]!) <= tol && Math.abs(a[2]! - b[2]!) <= tol;

describe('texture bake: checkerboard on a known cylinder', () => {
  const S = 256;
  const cyl = cylinder();

  it('puts every seen texel at its checker colour, away from the cell borders', () => {
    const v = views(Array.from({ length: 24 }, (_, k) => k * 15));
    const bake = bakeTexture({ render: cyl.render, welded: cyl.welded, body: null, cameras: v.cams, frames: v.frames, masks: v.masks, views: v.cams.map((_, k) => k), options: { size: S, edgePx: 2, minEdgePx: 0 } }); // exact masks: no overshoot to keep away from
    expect(bake.report.seenShare).toBeGreaterThan(0.98);
    let checked = 0, right = 0;
    for (let ty = 0; ty < S; ty++) for (let tx = 0; tx < S; tx++) {
      const u = (tx + 0.5) / S, vv = (ty + 0.5) / S;
      const theta = 2 * Math.PI * u, y = Y1 - (Y1 - Y0) * vv;
      // Skip texels within 1.5 texel-widths (in cm) of a cell border.
      const fu = ((u * 8) % 1), fy = (((Y1 - y) / 4) % 1);
      if (Math.min(fu, 1 - fu) < 0.06 || Math.min(fy, 1 - fy) < 0.06) continue;
      checked++;
      const k = ty * S + tx;
      if (near(bake.atlas.data.subarray(3 * k, 3 * k + 3), checker(theta, y), 40)) right++;
    }
    expect(checked).toBeGreaterThan(40000);
    expect(right / checked).toBeGreaterThan(0.97);
  });

  it('fills the side no view sees by diffusion: no hole, colours within the seen ones', () => {
    const v = views([-50, -25, 0, 25, 50]);
    const bake = bakeTexture({ render: cyl.render, welded: cyl.welded, body: null, cameras: v.cams, frames: v.frames, masks: v.masks, views: v.cams.map((_, k) => k), options: { size: S, edgePx: 2, minEdgePx: 0 } }); // exact masks: no overshoot to keep away from
    // Expected seen share from the geometry alone: a point at θ on the cylinder is seen when some camera
    // is in front of it with cos(normal, direction to camera) ≥ minCos (0.15). Five cameras at ±50°
    // 140 cm away see about 255° of the 360° round; the back ≈ 105° is never seen.
    let seenCols = 0;
    const steps = 3600;
    for (let k = 0; k < steps; k++) {
      const t = (2 * Math.PI * k) / steps;
      const p = [R * Math.sin(t), R * Math.cos(t)], nrm = [Math.sin(t), Math.cos(t)];
      if ([-50, -25, 0, 25, 50].some((az) => {
        const c = [140 * Math.sin((az * Math.PI) / 180) - p[0]!, 140 * Math.cos((az * Math.PI) / 180) - p[1]!];
        return (c[0]! * nrm[0]! + c[1]! * nrm[1]!) / Math.hypot(c[0]!, c[1]!) >= 0.15;
      })) seenCols++;
    }
    const expectedSeen = seenCols / steps;
    expect(expectedSeen).toBeGreaterThan(0.6);
    expect(expectedSeen).toBeLessThan(0.8);
    // The camera ray is not horizontal off the centre row and the mask edge ramp drops a texel or two: within 3 points of the geometry.
    expect(Math.abs(bake.report.seenShare - expectedSeen)).toBeLessThan(0.03);
    expect(bake.report.filledTexels).toBeGreaterThan(0.2 * bake.report.chartTexels);
    // The back (θ = 180°) is filled with colours between the two checker colours, never the black of an empty texel.
    for (let ty = 8; ty < S; ty += 16) {
      const k = ty * S + Math.floor(S / 2);
      const c = bake.atlas.data.subarray(3 * k, 3 * k + 3);
      expect(bake.seenWeight[k]).toBe(0);
      for (let ch = 0; ch < 3; ch++) {
        expect(c[ch]).toBeGreaterThanOrEqual(Math.min(A[ch]!, B[ch]!) - 2);
        expect(c[ch]).toBeLessThanOrEqual(Math.max(A[ch]!, B[ch]!) + 2);
      }
    }
  });

  it('with the default options (3 px off the mask edge, outlier pass) bakes through masks that overshoot the cloth by 2 px', () => {
    // The generated frames' masks overshoot the cloth by a pixel or two: in every frame the outer 2 px
    // of the cylinder's silhouette show the studio grey (235) while the mask still says garment there.
    const v = views(Array.from({ length: 24 }, (_, k) => k * 15));
    const W = 160, H = 160;
    let fringe = 0;
    const frames = v.frames.map((f, k) => {
      const mk = v.masks[k]!.data;
      const out = Uint8Array.from(f);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!mk[y * W + x]) continue;
        let edge = false;
        for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= H || xx < 0 || xx >= W || !mk[yy * W + xx]) { edge = true; break; }
        }
        if (edge) { out.set([235, 235, 235], 3 * (y * W + x)); fringe++; }
      }
      return out;
    });
    expect(fringe).toBeGreaterThan(24 * 100);
    const bake = bakeTexture({ render: cyl.render, welded: cyl.welded, body: null, cameras: v.cams, frames, masks: v.masks, views: v.cams.map((_, k) => k), options: { size: S } });
    expect(bake.report.options.minEdgePx).toBe(3);
    expect(bake.report.options.outlierL1).toBe(90);
    expect(bake.report.seenShare).toBeGreaterThan(0.95);
    // With the edge margin no grey sample is taken, so the outlier pass has little to drop.
    expect(bake.report.outlierShare).toBeLessThan(0.02);
    let checked = 0, right = 0, grey = 0;
    for (let ty = 0; ty < S; ty++) for (let tx = 0; tx < S; tx++) {
      const u = (tx + 0.5) / S, vv = (ty + 0.5) / S;
      const theta = 2 * Math.PI * u, y = Y1 - (Y1 - Y0) * vv;
      const fu = ((u * 8) % 1), fy = (((Y1 - y) / 4) % 1);
      const k = ty * S + tx;
      const c = bake.atlas.data.subarray(3 * k, 3 * k + 3);
      if (near(c, [235, 235, 235], 40)) grey++;
      if (Math.min(fu, 1 - fu) < 0.06 || Math.min(fy, 1 - fy) < 0.06) continue;
      checked++;
      if (near(c, checker(theta, y), 40)) right++;
    }
    expect(checked).toBeGreaterThan(40000);
    expect(right / checked).toBeGreaterThan(0.97);
    expect(grey).toBe(0);
  });

  it('pull-push fills every empty pixel from the weighted ones', () => {
    const n = 8;
    const rgb = new Float32Array(n * n * 3);
    const w = new Float32Array(n * n);
    rgb.set([100, 150, 200], 0);
    w[0] = 1;
    pullPush(rgb, w, n);
    for (let i = 0; i < n * n; i++) expect(near(rgb.subarray(3 * i, 3 * i + 3), [100, 150, 200], 0.01)).toBe(true);
  });
});

describe('JPEG encoder and textured glb', () => {
  it('writes a baseline JFIF stream (markers, sizes, 4:2:0) deterministically, smaller for a flat image', () => {
    const W = 37, H = 21;
    const data = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) data.set([(i * 7) % 256, (i * 3) % 256, 128], 3 * i);
    const a = encodeJpeg({ width: W, height: H, data }, 85);
    const b = encodeJpeg({ width: W, height: H, data }, 85);
    expect(a).toEqual(b);
    expect([a[0], a[1]]).toEqual([0xff, 0xd8]);
    expect([a[a.length - 2], a[a.length - 1]]).toEqual([0xff, 0xd9]);
    const sof = a.findIndex((x, i) => x === 0xff && a[i + 1] === 0xc0);
    expect(sof).toBeGreaterThan(0);
    expect((a[sof + 5]! << 8) | a[sof + 6]!).toBe(H);
    expect((a[sof + 7]! << 8) | a[sof + 8]!).toBe(W);
    expect(a[sof + 11]).toBe(0x22); // Y sampled 2×2: 4:2:0
    const flat = encodeJpeg({ width: W, height: H, data: new Uint8Array(W * H * 3).fill(200) }, 85);
    expect(flat.length).toBeLessThan(a.length);
  });

  it('round-trips positions, UVs, indices and the image through the glb', () => {
    const cyl = cylinder();
    const image = encodeJpeg({ width: 8, height: 8, data: new Uint8Array(192).fill(90) });
    const glb = writeTexturedGlb({ name: 'c', positions: cyl.render.positions, uvs: cyl.render.uvs, indices: cyl.render.indices, image, mimeType: 'image/jpeg' }, { scale: 0.01, extras: { unit: 'm' } });
    const back = readTexturedGlb(glb);
    expect(back.indices).toEqual(cyl.render.indices);
    expect(back.image?.mimeType).toBe('image/jpeg');
    expect(back.image?.bytes).toEqual(image);
    for (let i = 0; i < back.positions.length; i++) expect(Math.abs(back.positions[i]! - cyl.render.positions[i]!)).toBeLessThan(1e-3);
    for (let i = 0; i < back.uvs!.length; i++) expect(back.uvs![i]).toBeCloseTo(cyl.render.uvs[i]!, 6);
  });
});
