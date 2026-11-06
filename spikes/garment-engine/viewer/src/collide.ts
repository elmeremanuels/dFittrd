/**
 * Collision of cloth particles against the avatar's analytic cross-sections (the solver's hot loop).
 * No imports, so the drape Web Worker loads only this and `cloth.ts`; `body.ts` builds the tables.
 */

/** Ellipses tabulated every `stepCm`: 5 floats per sample (valid, cx, cz, a, b). */
export interface Table {
  lo: number;
  stepCm: number;
  data: Float32Array;
}

export interface BodyField {
  torso: Table;
  legs: [Table, Table];
  arms: [Table, Table];
  armFrames: { joint: [number, number, number]; axis: [number, number, number]; u: [number, number, number]; v: [number, number, number]; s0: number; s1: number }[];
}

export const sample = (t: Table, x: number, out: Float32Array): boolean => {
  const f = (x - t.lo) / t.stepCm;
  const k = Math.floor(f);
  const n = t.data.length / 5;
  if (k < 0 || k >= n - 1) return false;
  const i0 = k * 5;
  const i1 = i0 + 5;
  if (t.data[i0] === 0 || t.data[i1] === 0) return false;
  const w = f - k;
  for (let j = 1; j < 5; j++) out[j - 1] = t.data[i0 + j]! * (1 - w) + t.data[i1 + j]! * w;
  return true;
};

/** Push the 2D offset (dx, dz) from an ellipse centre out to the ellipse grown by `clearance`; returns the new offset or null when outside. */
export function pushOutOfEllipse(dx: number, dz: number, a: number, b: number, clearance: number): [number, number] | null {
  const A = a + clearance;
  const B = b + clearance;
  if (dx * dx + dz * dz < 1e-12) return [A, 0];
  // (dx, dz) = r·û and the ellipse's polar radius along û is 1/√(ûx²/A² + ûz²/B²), so the radial
  // scale onto the ellipse is 1/√q with q = (dx/A)² + (dz/B)² (no trigonometry in the hot loop).
  const q = (dx * dx) / (A * A) + (dz * dz) / (B * B);
  if (q >= 1) return null;
  const k = 1 / Math.sqrt(q);
  return [dx * k, dz * k];
}

/**
 * Collision of one particle (index `i` in `pos`) against the avatar: torso and legs as horizontal
 * ellipses at the particle's height, arms as ellipses across the arm axis below the armpit. Returns
 * true when the particle was moved.
 *
 * With `chains`, a body-chain particle collides with torso and legs only and a sleeve particle with
 * the arms only: the v0 mannequin's limbs overlap its torso, so at the armpit a particle would
 * otherwise be pushed out of two shapes at once. Particles flagged in `skip` never collide.
 */
export function makeCollider(field: BodyField, clearanceCm = 0.35, chains?: Uint8Array, skip?: Uint8Array): (pos: Float32Array, i: number) => boolean {
  const e = new Float32Array(4);
  const vertical = [field.torso, field.legs[0], field.legs[1]];
  return (pos, i) => {
    if (skip && skip[i] === 1) return false;
    let x = pos[3 * i]!;
    const y = pos[3 * i + 1]!;
    let z = pos[3 * i + 2]!;
    let moved = false;
    const chain = chains ? chains[i]! : -1;
    if (chain <= 0) for (const t of vertical) {
      if (!sample(t, y, e)) continue;
      const p = pushOutOfEllipse(x - e[0]!, z - e[1]!, e[2]!, e[3]!, clearanceCm);
      if (p) {
        x = e[0]! + p[0];
        z = e[1]! + p[1];
        moved = true;
      }
    }
    if (moved) {
      pos[3 * i] = x;
      pos[3 * i + 2] = z;
    }
    let yy = y;
    if (chain !== 0) for (let side = 0; side < 2; side++) {
      const f = field.armFrames[side]!;
      const rx = x - f.joint[0];
      const ry = yy - f.joint[1];
      const rz = z - f.joint[2];
      const s = rx * f.axis[0] + ry * f.axis[1] + rz * f.axis[2];
      if (s <= f.s0 || s >= f.s1 || !sample(field.arms[side]!, s, e)) continue;
      const ru = rx * f.u[0] + ry * f.u[1] + rz * f.u[2];
      const rv = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
      const p = pushOutOfEllipse(ru, rv, e[2]!, e[3]!, clearanceCm);
      if (!p) continue;
      const du = p[0] - ru;
      const dv = p[1] - rv;
      x += f.u[0] * du + f.v[0] * dv;
      yy += f.u[1] * du + f.v[1] * dv;
      z += f.u[2] * du + f.v[2] * dv;
      pos[3 * i] = x;
      pos[3 * i + 1] = yy;
      pos[3 * i + 2] = z;
      moved = true;
    }
    return moved;
  };
}
