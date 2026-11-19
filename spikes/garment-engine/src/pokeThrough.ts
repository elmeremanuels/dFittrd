/**
 * Pictures and a pixel measure of body showing through cloth, without a browser (spike tooling for
 * the M3 tee proof; not shipped). `render` draws meshes with a z-buffer and Lambert shading to a PNG
 * (orthographic, turned by `yaw` about the vertical axis). `pokes` counts the pixels, in one such
 * view at 3 px per cm, where the drawn body is in front of the cloth by less than `within` cm: skin
 * coming through the cloth, not an arm held in front of it. Both are proxies for the WebGL view.
 */
import { writeFileSync } from 'node:fs';
import type { Mesh } from '@curtain/mannequin';
import { encodePng } from './exportPng';

/** A shaded PNG of the meshes seen from `yaw` (0 = front), scaled so `box.half` cm is a third of the height. */
export function render(meshes: { mesh: Pick<Mesh, 'positions' | 'indices'>; color: [number, number, number] }[], yaw: number, path: string, W = 400, H = 600, box = { cx: 0, cy: 115, half: 50 }) {
  const img = new Uint8Array(W * H * 3).fill(235);
  const zb = new Float32Array(W * H).fill(-Infinity);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const sc = H / (2 * box.half * 1.5);
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    const xr = c * x + s * z, zr = -s * x + c * z;
    return [W / 2 + (xr - box.cx) * sc, H / 2 - (y - box.cy) * sc, zr];
  };
  const light = [0.3, 0.5, 0.8];
  const ln = Math.hypot(...light);
  for (const { mesh, color } of meshes) {
    const p = mesh.positions, ix = mesh.indices;
    for (let t = 0; t < ix.length; t += 3) {
      const a = proj(p[3 * ix[t]!]!, p[3 * ix[t]! + 1]!, p[3 * ix[t]! + 2]!);
      const b = proj(p[3 * ix[t + 1]!]!, p[3 * ix[t + 1]! + 1]!, p[3 * ix[t + 1]! + 2]!);
      const d = proj(p[3 * ix[t + 2]!]!, p[3 * ix[t + 2]! + 1]!, p[3 * ix[t + 2]! + 2]!);
      // normal in view space (x right, y up, z towards viewer)
      const ux = b[0] - a[0], uy = -(b[1] - a[1]), uz = b[2] - a[2];
      const vx = d[0] - a[0], vy = -(d[1] - a[1]), vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; } // two-sided
      const sh = 0.35 + 0.65 * Math.max(0, (nx * light[0]! + ny * light[1]! + nz * light[2]!) / ln);
      const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], d[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], d[0])));
      const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], d[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], d[1])));
      const area = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((b[0] - px) * (d[1] - py) - (b[1] - py) * (d[0] - px)) / area;
        const w1 = ((d[0] - px) * (a[1] - py) - (d[1] - py) * (a[0] - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * a[2] + w1 * b[2] + w2 * d[2];
        if (z <= zb[y * W + x]!) continue;
        zb[y * W + x] = z;
        for (let k = 0; k < 3; k++) img[3 * (y * W + x) + k] = Math.min(255, color[k]! * sh);
      }
    }
  }
  writeFileSync(path, encodePng({ width: W, height: H, channels: 3, bitDepth: 8, data: img }));
}


/** Pixels where the drawn body is in front of the cloth by less than `within` cm, grouped by body part and region. */
export function pokes(body: Mesh, cloth: Pick<Mesh, 'positions' | 'indices'>, yaw: number, regions: (y: number) => string, W = 300, H = 600, within = 2, samples?: number[][]): Record<string, number> {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const sc = 3; // px per cm, box centred on x=0,y=110
  const raster = (mesh: Pick<Mesh, 'positions' | 'indices'>, id?: Uint8Array) => {
    const zb = new Float32Array(W * H).fill(-Infinity), yb = new Float32Array(W * H), pb = new Int16Array(W * H).fill(-1), tb = new Int32Array(W * H).fill(-1), wb = new Float32Array(W * H * 3);
    const p = mesh.positions, ix = mesh.indices;
    const proj = (i: number): [number, number, number, number] => { const x = p[3*i]!, y = p[3*i+1]!, z = p[3*i+2]!; return [W/2 + (c*x + s*z)*sc, H/2 - (y - 110)*sc, -s*x + c*z, y]; };
    for (let t = 0; t < ix.length; t += 3) {
      const a = proj(ix[t]!), b = proj(ix[t+1]!), d = proj(ix[t+2]!);
      const area = (b[0]-a[0])*(d[1]-a[1]) - (b[1]-a[1])*(d[0]-a[0]); if (Math.abs(area) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(a[0],b[0],d[0]))), x1 = Math.min(W-1, Math.ceil(Math.max(a[0],b[0],d[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1],b[1],d[1]))), y1 = Math.min(H-1, Math.ceil(Math.max(a[1],b[1],d[1])));
      for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
        const qx = px + 0.5, qy = py + 0.5;
        const w0 = ((b[0]-qx)*(d[1]-qy) - (b[1]-qy)*(d[0]-qx))/area, w1 = ((d[0]-qx)*(a[1]-qy) - (d[1]-qy)*(a[0]-qx))/area, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0*a[2] + w1*b[2] + w2*d[2]; const k = py*W + px;
        if (z > zb[k]!) { zb[k] = z; yb[k] = w0*a[3] + w1*b[3] + w2*d[3]; tb[k] = t; wb[3*k] = w0; wb[3*k+1] = w1; wb[3*k+2] = w2; if (id) pb[k] = id[ix[t]!]!; }
      }
    }
    return { zb, yb, pb, tb, wb };
  };
  const B = raster(body, (body as Mesh).vertexPart), C = raster(cloth);
  const out: Record<string, number> = {};
  for (let k = 0; k < W * H; k++) {
    if (C.zb[k] === -Infinity || B.zb[k] === -Infinity) continue;
    const dz = B.zb[k]! - C.zb[k]!;
    if (dz > 0 && dz < within && samples && samples.length < 6 && (k % 7 === 0)) { const t = B.tb[k]!; const P = (j: number, d: number) => body.positions[3*body.indices[t+j]!+d]!; samples.push([0,1,2].map((d) => B.wb[3*k]!*P(0,d) + B.wb[3*k+1]!*P(1,d) + B.wb[3*k+2]!*P(2,d))); }
    if (dz > 0 && dz < within) { const key = `${(body as Mesh).partNames[B.pb[k]!]} ${regions(B.yb[k]!)}`; out[key] = (out[key] ?? 0) + 1; }
  }
  return out;
}
