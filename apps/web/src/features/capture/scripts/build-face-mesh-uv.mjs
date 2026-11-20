#!/usr/bin/env node
/**
 * Build `faceMeshUv.json` (slice 6 spike, docs/research/photo-avatar-plan.md) from MediaPipe's
 * canonical face model: its 898 triangles over the 468 face landmarks, and for each landmark the
 * point of the head v2 face frame (`@curtain/mannequin` FACE_UV_FRAME) it is baked to.
 *
 *   node apps/web/src/features/capture/scripts/build-face-mesh-uv.mjs [--obj <canonical_face_model.obj>]
 *
 * Without --obj the file is downloaded from the pinned MediaPipe release tag (v0.10.21; curl, so
 * HTTPS_PROXY is honoured). The source file is Apache-2.0 (MediaPipe's LICENSE); the JSON keeps the
 * source URL, its sha256 and the licence, and docs/LICENSES.md has the row. The landmarks are
 * aligned to head v2 by a scale and an offset per axis (least squares: eye centres across; eye
 * centres, nose tip and mouth line up and down), so a shopper's eyes, nose and mouth land on the
 * mannequin's own sculpted ones. The numbers of the head are copied here from `faceUv.ts`, and
 * `packages/mannequin/src/faceUv.test.ts` fails when they drift.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', 'faceMeshUv.json');
const SOURCE = 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/mediapipe/modules/face_geometry/data/canonical_face_model.obj';
const SOURCE_SHA256 = '8bac80443397e113f41a8b565ea72c59390bc031d9defab289dba7bc0c54e618';

/** Copies of `FACE_UV_FRAME` and `FACE_UV_LANDMARKS` (packages/mannequin/src/faceUv.ts). */
const FRAME = { x0: -9, x1: 9, y0: -2, y1: 16 };
const HEAD = { eyeX: 3.15, eyeY: 11, noseTipY: 8.15, mouthY: 5.25 };
/** Canonical landmark ids: outer and inner corners of each eye, the nose tip, the inner lips. */
const LM = { rightEye: [33, 133], leftEye: [362, 263], noseTip: 1, mouth: [13, 14] };

const args = process.argv.slice(2);
const objAt = args.indexOf('--obj');
let text;
if (objAt >= 0 && args[objAt + 1]) text = readFileSync(args[objAt + 1]);
else {
  const r = spawnSync('curl', ['-fsSL', SOURCE], { maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`download failed: ${r.stderr?.toString()}`);
  text = r.stdout;
}
const sha = createHash('sha256').update(text).digest('hex');
if (sha !== SOURCE_SHA256) throw new Error(`canonical_face_model.obj sha256 ${sha} is not the pinned ${SOURCE_SHA256}`);

const lines = text.toString('utf8').split('\n');
const v = lines.filter((l) => l.startsWith('v ')).map((l) => l.trim().split(/\s+/).slice(1).map(Number));
const tris = lines
  .filter((l) => l.startsWith('f '))
  .flatMap((l) => l.trim().split(/\s+/).slice(1).map((t) => Number(t.split('/')[0]) - 1));
if (v.length !== 468 || tris.length !== 898 * 3) throw new Error(`unexpected mesh: ${v.length} vertices, ${tris.length / 3} triangles`);

const mid = (ids) => ids.reduce((a, i) => [a[0] + v[i][0] / ids.length, a[1] + v[i][1] / ids.length], [0, 0]);
const re = mid(LM.rightEye), le = mid(LM.leftEye), mo = mid(LM.mouth), nt = v[LM.noseTip];
// Across: the eyes are symmetric about x = 0 in both, so a scale alone.
const sx = (2 * HEAD.eyeX) / (le[0] - re[0]);
// Up and down: least squares over the eyes, the nose tip and the mouth line.
const ys = [[re[1], HEAD.eyeY], [le[1], HEAD.eyeY], [nt[1], HEAD.noseTipY], [mo[1], HEAD.mouthY]];
const n = ys.length;
const mx = ys.reduce((a, [x]) => a + x, 0) / n, my = ys.reduce((a, [, y]) => a + y, 0) / n;
const sy = ys.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / ys.reduce((a, [x]) => a + (x - mx) ** 2, 0);
const ty = my - sy * mx;
const round = (x) => Math.round(x * 1e5) / 1e5;
const uv = v.flatMap(([x, y]) => {
  const hx = sx * x, hy = sy * y + ty;
  return [round((hx - FRAME.x0) / (FRAME.x1 - FRAME.x0)), round((FRAME.y1 - hy) / (FRAME.y1 - FRAME.y0))];
});

// The boundary of the mesh (edges of one triangle only), as one ordered loop: the face oval.
const edges = new Map();
for (let t = 0; t < tris.length; t += 3) {
  for (let e = 0; e < 3; e++) {
    const a = tris[t + e], b = tris[t + ((e + 1) % 3)];
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    edges.set(k, (edges.get(k) ?? 0) + 1);
  }
}
const next = new Map();
for (const [k, c] of edges) {
  if (c !== 1) continue;
  const [a, b] = k.split(',').map(Number);
  next.set(a, [...(next.get(a) ?? []), b]);
  next.set(b, [...(next.get(b) ?? []), a]);
}
const oval = [10];
for (let prev = -1, cur = 10; ;) {
  const nb = next.get(cur).find((x) => x !== prev);
  if (nb === 10) break;
  oval.push(nb);
  prev = cur;
  cur = nb;
}

const residual = ys.map(([x, y]) => round(sy * x + ty - y));
const out = {
  about: 'Slice 6 spike: MediaPipe canonical face mesh triangles, and per landmark its point in the head v2 face frame (u, v; v down). Built by scripts/build-face-mesh-uv.mjs.',
  source: SOURCE,
  sourceSha256: SOURCE_SHA256,
  licence: 'Apache-2.0 (Copyright Google LLC, MediaPipe; https://github.com/google-ai-edge/mediapipe/blob/v0.10.21/LICENSE). Triangles copied; positions changed to texture coordinates of the head v2 face frame.',
  frame: FRAME,
  head: HEAD,
  align: { sx: round(sx), sy: round(sy), ty: round(ty), residualY: residual, chinY: round(sy * v[152][1] + ty), foreheadY: round(sy * v[10][1] + ty) },
  landmarks: { rightEye: LM.rightEye, leftEye: LM.leftEye, noseTip: LM.noseTip, mouth: LM.mouth, rightCheek: 234, leftCheek: 454, chin: 152, forehead: 10 },
  vertexCount: 468,
  triangles: tris,
  uv,
  oval,
};
writeFileSync(OUT, `${JSON.stringify(out)}\n`);
console.log(`wrote ${OUT}: ${tris.length / 3} triangles, ${oval.length} oval points, sx ${out.align.sx}, sy ${out.align.sy}, chin y ${out.align.chinY}, forehead y ${out.align.foreheadY}, ${(JSON.stringify(out).length / 1024).toFixed(1)} KB`);
