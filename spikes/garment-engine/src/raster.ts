/**
 * A small software rasterizer for the synthetic renders of stage 3: z-buffered triangles,
 * perspective camera from a mannequin camera frame, flat Lambert shading with a head light, a
 * chroma-green studio background. Outputs colour, depth and the id of the visible object (ground
 * truth for separation). Deterministic and dependency-free; not fast, not pretty.
 */
import { cameraMatrices, normalize, sub, transformPoint4, cross, dot, type CameraFrame, type Vec3 } from '@curtain/mannequin';

export interface DrawItem {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Albedo, 0…1. */
  color: Vec3;
  /** Object id written to the id buffer (0 is the background). */
  id: number;
}

export interface Render {
  width: number;
  height: number;
  /** RGB, 0…255. */
  rgb: Uint8ClampedArray;
  /** View-space depth (cm), Infinity for background. */
  depth: Float32Array;
  /** Visible object id per pixel. */
  ids: Uint8Array;
}

/** Studio background: chroma green, far from every garment colour in the fixtures. */
export const BACKGROUND_RGB: Vec3 = [0, 177, 64];
export const AMBIENT = 0.3;

/** `#RRGGBB` (or `#RGB`) → sRGB components 0…1. */
export function hexToRgb(hex: string): Vec3 {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16) / 255, parseInt(full.slice(2, 4), 16) / 255, parseInt(full.slice(4, 6), 16) / 255];
}

export function render(items: readonly DrawItem[], camera: CameraFrame, width: number, height: number): Render {
  const { viewProjection } = cameraMatrices(camera, width / height);
  const rgb = new Uint8ClampedArray(width * height * 3);
  const depth = new Float32Array(width * height).fill(Infinity);
  const ids = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    rgb[3 * i] = BACKGROUND_RGB[0];
    rgb[3 * i + 1] = BACKGROUND_RGB[1];
    rgb[3 * i + 2] = BACKGROUND_RGB[2];
  }
  for (const item of items) {
    const nv = item.positions.length / 3;
    const sx = new Float64Array(nv);
    const sy = new Float64Array(nv);
    const sw = new Float64Array(nv);
    for (let v = 0; v < nv; v++) {
      const [x, y, , w] = transformPoint4(viewProjection, [item.positions[3 * v]!, item.positions[3 * v + 1]!, item.positions[3 * v + 2]!]);
      sx[v] = ((x / w + 1) / 2) * width;
      sy[v] = ((1 - y / w) / 2) * height;
      sw[v] = w; // view-space depth for a perspective camera
    }
    for (let t = 0; t < item.indices.length; t += 3) {
      const a = item.indices[t]!, b = item.indices[t + 1]!, c = item.indices[t + 2]!;
      if (sw[a]! <= 0 || sw[b]! <= 0 || sw[c]! <= 0) continue;
      const P = (k: number): Vec3 => [item.positions[3 * k]!, item.positions[3 * k + 1]!, item.positions[3 * k + 2]!];
      const pa = P(a);
      const n = normalize(cross(sub(P(b), pa), sub(P(c), pa)));
      const centroid: Vec3 = [(pa[0] + P(b)[0] + P(c)[0]) / 3, (pa[1] + P(b)[1] + P(c)[1]) / 3, (pa[2] + P(b)[2] + P(c)[2]) / 3];
      const light = normalize(sub(camera.position, centroid));
      const shade = AMBIENT + (1 - AMBIENT) * Math.abs(dot(n, light)); // two-sided: cloth is seen from inside too
      const r = Math.round(item.color[0] * shade * 255), g = Math.round(item.color[1] * shade * 255), bl = Math.round(item.color[2] * shade * 255);
      const x0 = sx[a]!, y0 = sy[a]!, x1 = sx[b]!, y1 = sy[b]!, x2 = sx[c]!, y2 = sy[c]!;
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (area === 0) continue;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
      // Perspective-correct depth: interpolate 1/w linearly in screen space.
      const iw0 = 1 / sw[a]!, iw1 = 1 / sw[b]!, iw2 = 1 / sw[c]!;
      for (let py = minY; py <= maxY; py++) {
        const cy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const cx = px + 0.5;
          const w0 = ((x1 - cx) * (y2 - cy) - (x2 - cx) * (y1 - cy)) / area;
          const w1 = ((x2 - cx) * (y0 - cy) - (x0 - cx) * (y2 - cy)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = 1 / (w0 * iw0 + w1 * iw1 + w2 * iw2);
          const k = py * width + px;
          if (z >= depth[k]!) continue;
          depth[k] = z;
          ids[k] = item.id;
          rgb[3 * k] = r;
          rgb[3 * k + 1] = g;
          rgb[3 * k + 2] = bl;
        }
      }
    }
  }
  return { width, height, rgb, depth, ids };
}
