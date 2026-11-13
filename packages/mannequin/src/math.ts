/**
 * Small vector and 4×4 matrix helpers. Units are cm unless a function says otherwise.
 * Coordinate frame (glTF): +Y up, +Z front (the mannequin faces +Z), +X the mannequin's left.
 * Matrices are column-major `Float64Array(16)`, as in glTF and WebGL.
 */

export type Vec3 = [number, number, number];
export type Mat4 = Float64Array;

export const add = (p: Vec3, q: Vec3): Vec3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
export const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
export const scale = (p: Vec3, s: number): Vec3 => [p[0] * s, p[1] * s, p[2] * s];
export const dot = (p: Vec3, q: Vec3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
export const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
export const length = (p: Vec3): number => Math.hypot(p[0], p[1], p[2]);
export const distance = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** `p + d · s`. */
export const along = (p: Vec3, d: Vec3, s: number): Vec3 => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];

export function normalize(p: Vec3): Vec3 {
  const l = length(p);
  return l > 0 ? [p[0] / l, p[1] / l, p[2] / l] : [0, 0, 0];
}

/** Round to `digits` decimals (for stable JSON output). */
export function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export const roundVec = (p: Vec3, digits = 4): Vec3 => [round(p[0], digits), round(p[1], digits), round(p[2], digits)];

// ---------------------------------------------------------------------------
// 4×4 matrices (column-major)
// ---------------------------------------------------------------------------

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** `a · b` (apply `b` first). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function translation(t: Vec3): Mat4 {
  const m = identity();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

/**
 * Rotation from Euler angles in degrees, `R = Rx(x) · Ry(y) · Rz(z)` (Z applied first). Positive
 * angles turn counter-clockwise looking down the axis towards the origin (right-hand rule).
 */
export function rotationEulerDeg(angles: Vec3): Mat4 {
  const [x, y, z] = angles.map((d) => (d * Math.PI) / 180) as Vec3;
  const cx = Math.cos(x), sx = Math.sin(x);
  const cy = Math.cos(y), sy = Math.sin(y);
  const cz = Math.cos(z), sz = Math.sin(z);
  const rx = identity();
  rx[5] = cx; rx[6] = sx; rx[9] = -sx; rx[10] = cx;
  const ry = identity();
  ry[0] = cy; ry[2] = -sy; ry[8] = sy; ry[10] = cy;
  const rz = identity();
  rz[0] = cz; rz[1] = sz; rz[4] = -sz; rz[5] = cz;
  return multiply(rx, multiply(ry, rz));
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p[0], y = p[1], z = p[2];
  return [m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!];
}

/** Homogeneous transform: `[x, y, z, w]`. */
export function transformPoint4(m: Mat4, p: Vec3): [number, number, number, number] {
  const x = p[0], y = p[1], z = p[2];
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]!,
  ];
}

/** View matrix of a camera at `eye` looking at `target` (right-handed, camera looks down −Z). */
export function lookAt(eye: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): Mat4 {
  const f = normalize(sub(target, eye));
  const s = normalize(cross(f, up));
  const u = cross(s, f);
  const m = identity();
  m[0] = s[0]; m[4] = s[1]; m[8] = s[2];
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
  m[12] = -dot(s, eye);
  m[13] = -dot(u, eye);
  m[14] = dot(f, eye);
  return m;
}

/** OpenGL-style perspective projection (clip z in −w…w). `fovYDeg` is the full vertical field of view. */
export function perspective(fovYDeg: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan((fovYDeg * Math.PI) / 360);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
