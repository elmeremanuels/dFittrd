/**
 * Renders the male body v1 (ellipse sections) and v2 (`maleShape: 'v2'`) of every male size from
 * four sides (front, side, back, three-quarter) to PNG panels, with the tiny software rasteriser of
 * `preview.ts` (orthographic, z-buffer, two lights, 2× supersampled). No GPU, no dependency.
 *
 * Run: pnpm --filter @curtain/mannequin exec tsx scripts/render-male-v2.ts <out dir> [--head]
 * Writes <out dir>/<size>-<version>-<view>.png (one body, 5 px per cm) and panels.json.
 * `scripts/compose-male-v2.mjs` (repo root of this package) lays them out at phone size.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { buildMannequin, buildMannequinMesh, familyShape, MALE_BODY_SHAPE_IDS, type Mesh } from '../src/index';

const args = process.argv.slice(2).filter((a) => a !== '--');
const out = resolve(args.find((a) => !a.startsWith('--')) ?? 'out/male-v2');
const head = args.includes('--head') ? ('neutral-v2' as const) : undefined;
mkdirSync(out, { recursive: true });

const PX = 5; // px per cm in the written image
const SS = 2; // supersampling
const P = PX * SS;
const W_CM = 110;
const H_CM = 190;

type View = 'front' | 'side' | 'back' | 'three-quarter';
const VIEWS: Record<View, (x: number, y: number, z: number) => [number, number, number]> = {
  front: (x, y, z) => [x, y, z],
  side: (x, y, z) => [z, y, -x], // the viewer at the body's right (−X), front to the right
  back: (x, y, z) => [-x, y, -z],
  'three-quarter': (x, y, z) => {
    const a = (35 * Math.PI) / 180; // turned 35° to show the body's right side
    return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
  },
};
const norm = (v: number[]): number[] => v.map((x) => x / Math.hypot(...v));
const KEY = norm([-0.45, 0.5, 0.75]);
const FILL = norm([0.6, 0.1, 0.5]);

function render(mesh: Mesh, view: View): Buffer {
  const w = W_CM * P;
  const h = H_CM * P;
  const floor = h - 4 * P;
  const rgb = new Float32Array(w * h * 3).fill(1);
  for (let i = 0; i < w * h; i++) rgb.set([0.961, 0.937, 0.906], i * 3); // cream
  const depth = new Float32Array(w * h).fill(-Infinity);
  const f = VIEWS[view];
  const Pp = mesh.positions;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [0, 1, 2].map((k) => {
      const i = mesh.indices[t + k]! * 3;
      return f(Pp[i]!, Pp[i + 1]!, Pp[i + 2]!);
    }) as [number, number, number][];
    const [a, b, c] = v as [[number, number, number], [number, number, number], [number, number, number]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const len = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (len === 0 || n[2]! <= 0) continue;
    const nn = n.map((x) => x / len);
    const dot = (l: number[]) => Math.max(0, nn[0]! * l[0]! + nn[1]! * l[1]! + nn[2]! * l[2]!);
    const rim = Math.pow(1 - nn[2]!, 3) * 0.25;
    const shade = 0.28 + 0.6 * dot(KEY) + 0.18 * dot(FILL) + rim;
    const s = v.map((p) => [w / 2 + p[0] * P, floor - p[1] * P, p[2]] as const);
    const minX = Math.max(0, Math.floor(Math.min(s[0]![0], s[1]![0], s[2]![0])));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(s[0]![0], s[1]![0], s[2]![0])));
    const minY = Math.max(0, Math.floor(Math.min(s[0]![1], s[1]![1], s[2]![1])));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(s[0]![1], s[1]![1], s[2]![1])));
    const area = (s[1]![0] - s[0]![0]) * (s[2]![1] - s[0]![1]) - (s[2]![0] - s[0]![0]) * (s[1]![1] - s[0]![1]);
    if (area === 0) continue;
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((s[1]![0] - px) * (s[2]![1] - py) - (s[2]![0] - px) * (s[1]![1] - py)) / area;
        const w1 = ((s[2]![0] - px) * (s[0]![1] - py) - (s[0]![0] - px) * (s[2]![1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * s[0]![2] + w1 * s[1]![2] + w2 * s[2]![2];
        const o = y * w + x;
        if (z <= depth[o]!) continue;
        depth[o] = z;
        // A warm neutral grey, so that the form reads, not a skin tone.
        rgb[o * 3] = Math.min(1, 0.8 * shade);
        rgb[o * 3 + 1] = Math.min(1, 0.77 * shade);
        rgb[o * 3 + 2] = Math.min(1, 0.74 * shade);
      }
  }
  // Floor line, 10 cm grid ticks at the left edge.
  for (let x = 0; x < w; x++) for (let k = 0; k < SS; k++) rgb.set([0.6, 0.57, 0.54], ((floor + k) * w + x) * 3);
  // Downsample.
  const ow = W_CM * PX;
  const oh = H_CM * PX;
  const px8 = new Uint8Array(ow * oh * 3);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) sum += rgb[((y * SS + dy) * w + x * SS + dx) * 3 + c]!;
        px8[(y * ow + x) * 3 + c] = Math.round((255 * sum) / (SS * SS));
      }
  return png(ow, oh, px8);
}

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
function png(w: number, h: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const o = Buffer.alloc(body.length + 8);
    o.writeUInt32BE(data.length, 0);
    body.copy(o, 4);
    o.writeUInt32BE(crc(body), body.length + 4);
    return o;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

const only = args.find((a) => a.startsWith('--sizes='))?.slice(8).split(',');
const views = (args.find((a) => a.startsWith('--views='))?.slice(8).split(',') ?? Object.keys(VIEWS)) as View[];
const panels: { size: string; version: string; view: View; file: string }[] = [];
for (const id of MALE_BODY_SHAPE_IDS.filter((s) => !only || only.includes(s))) {
  for (const version of ['v1', 'v2'] as const) {
    const m = buildMannequin(familyShape('male', id)!, { maleShape: version });
    const mesh = buildMannequinMesh(m, head ? { head } : {});
    for (const view of views) {
      const file = `${id}-${version}-${view}.png`;
      writeFileSync(join(out, file), render(mesh, view));
      panels.push({ size: id, version, view, file });
    }
  }
}
writeFileSync(join(out, 'panels.json'), JSON.stringify({ pxPerCm: PX, widthCm: W_CM, heightCm: H_CM, panels }, null, 2));
console.log(`[mannequin] ${panels.length} panels → ${out}`);
