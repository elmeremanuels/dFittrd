/**
 * Ring geometry: a body ring or a garment loop is modelled as an ellipse in the horizontal plane,
 * `a` the half-width (left–right) and `b` the half-depth (front–back), in cm. The scan measures a
 * width and a depth per level and turns them into a girth with the same formula (D5).
 *
 * Every function is total: invalid input (negative, non-finite, zero where a positive is needed)
 * yields `NaN` instead of throwing, like `ellipsePerimeter` in the capture feature.
 */

export interface Ellipse {
  /** Semi-axis along the width (left–right), cm. */
  a: number;
  /** Semi-axis along the depth (front–back), cm. */
  b: number;
}

export interface RingPoint {
  /** Left–right offset from the ring centre, cm. */
  x: number;
  /** Front–back offset from the ring centre, cm (positive = front). */
  z: number;
}

const finiteNonNegative = (x: number): boolean => Number.isFinite(x) && x >= 0;
const finitePositive = (x: number): boolean => Number.isFinite(x) && x > 0;

/**
 * Ellipse circumference by Ramanujan's second approximation,
 * `π (3(a + b) − √((3a + b)(a + 3b)))`. Exact for a circle (`2πr`); the relative error stays below
 * 1e-5 for aspects `b / a` from 0.5 to 2 (every ring of a body), below 1e-4 at 0.3 and grows to
 * about 0.4 % in the flat limit (`b = 0`).
 */
export function ellipseCircumference(a: number, b: number): number {
  if (!finiteNonNegative(a) || !finiteNonNegative(b)) return Number.NaN;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/** Girth of a ring from its full width and depth (cm), i.e. `ellipseCircumference(w / 2, d / 2)`. */
export function girthFromWidthDepth(widthCm: number, depthCm: number): number {
  return ellipseCircumference(widthCm / 2, depthCm / 2);
}

/**
 * The ellipse with circumference `circumferenceCm` and aspect `b / a` (depth over width).
 * Circumference is homogeneous of degree one in the axes, so `a = C / circumference(1, aspect)`
 * is the exact inverse of `ellipseCircumference`. Returns `{ a: NaN, b: NaN }` for invalid input.
 */
export function ellipseFromCircumference(circumferenceCm: number, aspect: number): Ellipse {
  if (!finiteNonNegative(circumferenceCm) || !finitePositive(aspect)) return { a: Number.NaN, b: Number.NaN };
  const a = circumferenceCm / ellipseCircumference(1, aspect);
  return { a, b: a * aspect };
}

/** The same ellipse scaled uniformly so that its circumference is `circumferenceCm` (aspect kept). */
export function scaleEllipseToCircumference(ellipse: Ellipse, circumferenceCm: number): Ellipse {
  if (!finitePositive(ellipse.a) || !finiteNonNegative(ellipse.b)) return { a: Number.NaN, b: Number.NaN };
  return ellipseFromCircumference(circumferenceCm, ellipse.b / ellipse.a);
}

/**
 * `n` points on the ellipse, evenly spaced in the parametric angle, starting at the front centre
 * (`x = 0, z = b`) and going round towards +x. Handy for drawing a ring or seeding a loop.
 */
export function ellipseRingPoints(ellipse: Ellipse, n: number): RingPoint[] {
  if (!Number.isInteger(n) || n < 1 || !finiteNonNegative(ellipse.a) || !finiteNonNegative(ellipse.b)) return [];
  const out: RingPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    out.push({ x: ellipse.a * Math.sin(t), z: ellipse.b * Math.cos(t) });
  }
  return out;
}
