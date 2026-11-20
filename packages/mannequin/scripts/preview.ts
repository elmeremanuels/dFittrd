/**
 * Renders a front and a side view of bodies of both families to a PNG, with a tiny software
 * rasteriser (orthographic, z-buffer, one light): a quick look at the shapes, no GPU, no
 * dependency. All bodies share one scale and stand on one floor line; the grid lines are 20 cm apart.
 *
 * Run: pnpm --filter @curtain/mannequin preview [-- out.png [female:M male:M …]]
 * Default: out/preview/families-M.png with female M and male M.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { buildMannequin, buildMannequinMesh, familyShape, type BodyFamily, type Mesh } from '../src/index';

const args = process.argv.slice(2).filter((a) => a !== '--');
const outPath = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'preview', 'families-M.png'));
const wanted = (args.length > 1 ? args.slice(1) : ['female:M', 'male:M']).map((a) => {
  const [family, id] = a.split(':') as [BodyFamily, string];
  const shape = familyShape(family, id);
  if (!shape) throw new Error(`no shape ${a}`);
  return { label: a, mesh: buildMannequinMesh(buildMannequin(shape)) };
});

const PX_PER_CM = 3;
const CELL_W = 130 * PX_PER_CM;
const H = 200 * PX_PER_CM;
const FLOOR = H - 6 * PX_PER_CM;
const W = CELL_W * wanted.length * 2;
const rgb = new Uint8Array(W * H * 3).fill(245);
const depth = new Float32Array(W * H).fill(-Infinity);

// 20 cm grid, floor line darker.
for (let cm = 0; cm <= 180; cm += 20) {
  const y = FLOOR - cm * PX_PER_CM;
  for (let x = 0; x < W; x++) rgb.fill(cm === 0 ? 120 : 215, (y * W + x) * 3, (y * W + x) * 3 + 3);
}
for (let c = 1; c < wanted.length * 2; c++) for (let y = 0; y < H; y++) rgb.fill(c % 2 === 0 ? 150 : 225, (y * W + c * CELL_W) * 3, (y * W + c * CELL_W) * 3 + 3);

const LIGHT = ((v: [number, number, number]) => v.map((x) => x / Math.hypot(...v)) as [number, number, number])([-0.35, 0.45, 0.82]);

/** Draws one view: `view` maps a mesh point to (screen right, up, towards the viewer), cm. */
function draw(mesh: Mesh, cell: number, view: (x: number, y: number, z: number) => [number, number, number], tint: [number, number, number]): void {
  const cx = cell * CELL_W + CELL_W / 2;
  const P = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [0, 1, 2].map((k) => {
      const i = mesh.indices[t + k]! * 3;
      return view(P[i]!, P[i + 1]!, P[i + 2]!);
    }) as [[number, number, number], [number, number, number], [number, number, number]];
    const [a, b, c] = v;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (len === 0 || n[2]! <= 0) continue; // back face
    const shade = 0.35 + 0.65 * Math.max(0, (n[0]! * LIGHT[0] + n[1]! * LIGHT[1] + n[2]! * LIGHT[2]) / len);
    const s = v.map((p) => [cx + p[0] * PX_PER_CM, FLOOR - p[1] * PX_PER_CM, p[2]] as const);
    const minX = Math.max(cell * CELL_W, Math.floor(Math.min(s[0]![0], s[1]![0], s[2]![0])));
    const maxX = Math.min((cell + 1) * CELL_W - 1, Math.ceil(Math.max(s[0]![0], s[1]![0], s[2]![0])));
    const minY = Math.max(0, Math.floor(Math.min(s[0]![1], s[1]![1], s[2]![1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(s[0]![1], s[1]![1], s[2]![1])));
    const area = (s[1]![0] - s[0]![0]) * (s[2]![1] - s[0]![1]) - (s[2]![0] - s[0]![0]) * (s[1]![1] - s[0]![1]);
    if (area === 0) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((s[1]![0] - px) * (s[2]![1] - py) - (s[2]![0] - px) * (s[1]![1] - py)) / area;
        const w1 = ((s[2]![0] - px) * (s[0]![1] - py) - (s[0]![0] - px) * (s[2]![1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * s[0]![2] + w1 * s[1]![2] + w2 * s[2]![2];
        const o = y * W + x;
        if (z <= depth[o]!) continue;
        depth[o] = z;
        rgb[o * 3] = tint[0] * shade;
        rgb[o * 3 + 1] = tint[1] * shade;
        rgb[o * 3 + 2] = tint[2] * shade;
      }
    }
  }
}

wanted.forEach(({ mesh }, i) => {
  const tint: [number, number, number] = [205, 205, 210];
  draw(mesh, 2 * i, (x, y, z) => [x, y, z], tint); // front: the viewer stands at +Z
  draw(mesh, 2 * i + 1, (x, y, z) => [z, y, -x], tint); // side: the viewer stands at −X (the body's right), the front points right
});

// PNG (8-bit RGB, one IDAT).
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr.set([8, 2, 0, 0, 0], 8);
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (W * 3 + 1) + 1);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]));
console.log(`[mannequin] preview ${W}×${H} px (${PX_PER_CM} px per cm, grid 20 cm): ${wanted.map((w) => `${w.label} front, side`).join('; ')} → ${outPath}`);
