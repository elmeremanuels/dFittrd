/**
 * The shopper's face on the 3D head (slice 6 spike of docs/research/photo-avatar-plan.md): a thin
 * copy of the front of the v2 head that carries a face texture baked on the device (the capture
 * worker's `bakeFaceTexture`) and fades into the skin. The head itself is not changed: the copy is
 * drawn on top of it (polygon offset), so taking the face off is removing one mesh.
 *
 * The texture is in the head v2 face frame of `@curtain/mannequin` (`faceUvOf`). Where the head
 * turns away from the front the face fades out (`FACE_FADE_DEG`): a single front photo has nothing
 * true to say about the side of the head.
 *
 * Like the skin colour, a face is a display value only: this package never fetches, stores or sends
 * it, and it is not part of the fit.
 */
import * as THREE from 'three';

/** Pixels of a face texture: square RGBA, sRGB, row 0 = the top of the face frame. */
export interface FaceTexture {
  size: number;
  rgba: Uint8ClampedArray | Uint8Array;
}

/** The face is fully shown up to the first angle of the head's surface away from the front (degrees, about the vertical) and gone at the second. */
export const FACE_FADE_DEG = [38, 58] as const;

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/**
 * The overlay geometry: the triangles of `body` whose three vertices are in the face frame
 * (`faceUv` ≥ 0) and face forward enough to be seen. Positions and normals are copied from the
 * body, `uv` is the face frame and `color` (RGBA) carries the fade by angle in its alpha. Null when
 * no triangle qualifies (a head without the frame).
 */
export function faceOverlayGeometry(body: THREE.BufferGeometry, faceUv: Float32Array): THREE.BufferGeometry | null {
  const pos = body.getAttribute('position') as THREE.BufferAttribute;
  let nrm = body.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!nrm) {
    body.computeVertexNormals();
    nrm = body.getAttribute('normal') as THREE.BufferAttribute;
  }
  const index = body.getIndex();
  if (!index || faceUv.length !== 2 * pos.count) return null;
  const [lo, hi] = FACE_FADE_DEG;
  const fade = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    if (faceUv[2 * i]! < 0) continue;
    const yaw = (Math.atan2(Math.abs(nrm.getX(i)), nrm.getZ(i)) * 180) / Math.PI;
    fade[i] = 1 - smooth(lo, hi, yaw);
  }
  const map = new Int32Array(pos.count).fill(-1);
  const kept: number[] = [];
  const idx: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (faceUv[2 * a]! < 0 || faceUv[2 * b]! < 0 || faceUv[2 * c]! < 0) continue;
    if (fade[a] === 0 && fade[b] === 0 && fade[c] === 0) continue;
    for (const v of [a, b, c]) {
      if (map[v]! < 0) {
        map[v] = kept.length;
        kept.push(v);
      }
      idx.push(map[v]!);
    }
  }
  if (idx.length === 0) return null;
  const n = kept.length;
  const p = new Float32Array(3 * n), q = new Float32Array(3 * n), uv = new Float32Array(2 * n), col = new Float32Array(4 * n);
  kept.forEach((v, i) => {
    p.set([pos.getX(v), pos.getY(v), pos.getZ(v)], 3 * i);
    q.set([nrm.getX(v), nrm.getY(v), nrm.getZ(v)], 3 * i);
    uv.set([faceUv[2 * v]!, faceUv[2 * v + 1]!], 2 * i);
    col.set([1, 1, 1, fade[v]!], 4 * i);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(q, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(n > 65535 ? new THREE.BufferAttribute(new Uint32Array(idx), 1) : new THREE.BufferAttribute(new Uint16Array(idx), 1));
  return g;
}

/** The face texture as a three.js texture (no flip: row 0 is v = 0, as the frame's v runs down). */
export function faceTextureOf(face: FaceTexture): THREE.DataTexture {
  const data = face.rgba instanceof Uint8Array ? face.rgba : new Uint8Array(face.rgba.buffer, face.rgba.byteOffset, face.rgba.byteLength);
  const t = new THREE.DataTexture(data, face.size, face.size, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Is this a usable face texture (square, RGBA, the size it says)? */
export function isFaceTexture(value: unknown): value is FaceTexture {
  if (!value || typeof value !== 'object') return false;
  const f = value as Partial<FaceTexture>;
  return typeof f.size === 'number' && f.size >= 16 && f.size <= 2048 && (f.rgba instanceof Uint8Array || f.rgba instanceof Uint8ClampedArray) && f.rgba.length === 4 * f.size * f.size;
}
