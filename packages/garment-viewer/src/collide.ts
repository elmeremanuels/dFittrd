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

/** Height of the floor, cm: no particle goes below it. */
export const FLOOR_CM = 0;

/**
 * Collision of one particle (index `i` in `pos`) against the avatar: torso and legs as horizontal
 * ellipses at the particle's height, arms as ellipses across the arm axis below the armpit. Returns
 * true when the particle was moved.
 *
 * With `chains`, a body-chain particle collides with torso and legs only and a sleeve particle with
 * the arms only: the v0 mannequin's limbs overlap its torso, so at the armpit a particle would
 * otherwise be pushed out of two shapes at once. Particles flagged in `skip` never collide.
 *
 * `sewn` (a one-piece top whose sleeves are sewn into the armholes, the POM tee of slice M3): each
 * chain also meets the other body part, where that does not push it into its own: a body-chain
 * particle is pushed out of an arm (its cap above the shoulder joint included, so the shoulder cloth
 * covers the drawn arm) unless that lands it inside the torso, a sleeve particle out of the torso
 * unless that lands it inside the arm; and a sleeve particle meets its arm from the shoulder joint's
 * cap down, not only below the armpit. Without it (every bundle before M3) nothing changes.
 */
export function makeCollider(field: BodyField, clearanceCm = 0.35, chains?: Uint8Array, skip?: Uint8Array, sewn = false): (pos: Float32Array, i: number) => boolean {
  const e = new Float32Array(4);
  const vertical = [field.torso, field.legs[0], field.legs[1]];
  return (pos, i) => {
    // The floor (the canonical mannequin stands on y = 0): a maxi hem rests on it instead of passing through. Before
    // the skip: a particle exempt from the body still stands on the floor.
    let floored = false;
    if (pos[3 * i + 1]! < FLOOR_CM) {
      pos[3 * i + 1] = FLOOR_CM;
      floored = true;
    }
    if (skip && skip[i] === 1) return floored;
    let x = pos[3 * i]!;
    const y = pos[3 * i + 1]!;
    let z = pos[3 * i + 2]!;
    let moved = floored;
    const chain = chains ? chains[i]! : -1;
    if (chain <= 0) for (const t of vertical) {
      if (!(sewn && t !== field.torso ? legSection(t, y, e) : sample(t, y, e))) continue;
      const p = pushOutOfEllipse(x - e[0]!, z - e[1]!, e[2]!, e[3]!, clearanceCm);
      if (p && sewn && t === field.torso) {
        // Along the slanted surface: where the torso narrows steeply (the top of the shoulders) a level
        // push slides the cloth sideways under its neighbours; this lifts it off the slope instead.
        const g = torsoSlope(field.torso, x - e[0]!, z - e[1]!, y);
        const k = 1 / (1 + g * g);
        const nx = e[0]! + (x - e[0]!) + (p[0] - (x - e[0]!)) * k;
        const nz = e[1]! + (z - e[1]!) + (p[1] - (z - e[1]!)) * k;
        const dr = Math.hypot(p[0] - (x - e[0]!), p[1] - (z - e[1]!));
        x = nx;
        z = nz;
        pos[3 * i + 1] = pos[3 * i + 1]! - g * dr * k;
        moved = true;
        continue;
      }
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
    if (sewn && chain === 0) {
      // Out of the arms too; where that lands in the torso (the crease over the shoulder), out of the
      // torso again, until neither moves it (at most 8 times): the cloth ends outside the union of the two.
      for (let pass = 0; pass < 8; pass++) {
        let hit = false;
        for (let side = 0; side < 2; side++) {
          const q = outOfArm(field, side, pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!, clearanceCm + SEWN_CAP_EXTRA_CM, e);
          if (!q) continue;
          pos[3 * i] = q[0];
          pos[3 * i + 1] = q[1];
          pos[3 * i + 2] = q[2];
          moved = hit = true;
        }
        if (!hit || !sample(field.torso, pos[3 * i + 1]!, e)) break;
        const p = pushOutOfEllipse(pos[3 * i]! - e[0]!, pos[3 * i + 2]! - e[1]!, e[2]!, e[3]!, clearanceCm);
        if (!p) break;
        pos[3 * i] = e[0]! + p[0];
        pos[3 * i + 2] = e[1]! + p[1];
      }
      return moved;
    }
    let yy = y;
    if (chain !== 0) for (let side = 0; side < 2; side++) {
      const f = field.armFrames[side]!;
      const rx = x - f.joint[0];
      const ry = yy - f.joint[1];
      const rz = z - f.joint[2];
      const s = rx * f.axis[0] + ry * f.axis[1] + rz * f.axis[2];
      if (sewn) {
        if (s >= f.s1 || !armSection(field, side, s, e)) continue;
      } else if (s <= f.s0 || s >= f.s1 || !sample(field.arms[side]!, s, e)) continue;
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
    if (sewn && chain > 0 && sample(field.torso, pos[3 * i + 1]!, e)) {
      const p = pushOutOfEllipse(pos[3 * i]! - e[0]!, pos[3 * i + 2]! - e[1]!, e[2]!, e[3]!, clearanceCm);
      if (p) {
        const nx = e[0]! + p[0], nz = e[1]! + p[1], ny = pos[3 * i + 1]!;
        if (!outOfArm(field, 0, nx, ny, nz, 0, e) && !outOfArm(field, 1, nx, ny, nz, 0, e)) {
          pos[3 * i] = nx;
          pos[3 * i + 2] = nz;
          moved = true;
        }
      }
    }
    return moved;
  };
}

/**
 * Extra clearance of torso cloth over the arm in `sewn` mode, cm: over the cone that closes the arm
 * above the shoulder joint the cloth particles are up to 2.5 cm apart on a large body, and with the
 * plain clearance the cone showed between them (XL, XXL).
 */
export const SEWN_CAP_EXTRA_CM = 0.5;

/** The arm's cross-section at distance s along its axis (cm), into `out` as (_, _, a, b): the tabulated arm, and above the joint the cone the mannequin closes it with (to a pole 0.9/1.18 of the joint's radius above it). */
function armSection(field: BodyField, side: number, s: number, out: Float32Array): boolean {
  const t = field.arms[side]!;
  if (s >= 0) return sample(t, Math.max(s, t.lo), out);
  if (t.data[0] === 0) return false;
  const a0 = t.data[3]!, b0 = t.data[4]!;
  const pole = (0.9 / 1.18) * a0;
  if (s <= -pole) return false;
  const k = 1 + s / pole;
  out[0] = 0;
  out[1] = 0;
  out[2] = a0 * k;
  out[3] = b0 * k;
  return true;
}

/** Where a point inside arm `side` (grown by the clearance) is pushed to across the arm's axis, or null when it is outside. */
function outOfArm(field: BodyField, side: number, x: number, y: number, z: number, clearanceCm: number, e: Float32Array): [number, number, number] | null {
  const f = field.armFrames[side]!;
  const rx = x - f.joint[0], ry = y - f.joint[1], rz = z - f.joint[2];
  const s = rx * f.axis[0] + ry * f.axis[1] + rz * f.axis[2];
  if (s >= f.s1 || !armSection(field, side, s, e)) return null;
  const ru = rx * f.u[0] + ry * f.u[1] + rz * f.u[2];
  const rv = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
  const p = pushOutOfEllipse(ru, rv, e[2]!, e[3]!, clearanceCm);
  if (!p) return null;
  const du = p[0] - ru, dv = p[1] - rv;
  return [x + f.u[0] * du + f.v[0] * dv, y + f.u[1] * du + f.v[1] * dv, z + f.u[2] * du + f.v[2] * dv];
}

function insideTorso(field: BodyField, x: number, y: number, z: number, e: Float32Array): boolean {
  if (!sample(field.torso, y, e)) return false;
  return pushOutOfEllipse(x - e[0]!, z - e[1]!, e[2]!, e[3]!, 0) !== null;
}

/**
 * How far above a leg's last section the collider keeps a leg, cm. The mesh closes each leg with a
 * cone 0.8 cm high (measured on the male XXL), and on large male bodies that top ring stands up to
 * 1.4 cm out of the hips: cloth rows 1.6 cm apart then straddle the ledge and the rim shows through.
 * The collider keeps the full section for the first 1.5 cm above the last sample it can use (the
 * table's samples are 0.5 cm apart, so that is at least a centimetre above the top ring), then
 * narrows it to nothing by `LEG_DOME_CM`, so the cloth bridges the ledge as cloth would.
 */
export const LEG_DOME_CM = 2.5;

const LEG_PROBE = new Float32Array(4);

/** A leg's section at y, and above its last section the rounded top of `LEG_DOME_CM`. */
function legSection(t: Table, y: number, out: Float32Array): boolean {
  if (sample(t, y, out)) {
    // The top 2.5 cm of a leg (the ledge): grown by `SEWN_CAP_EXTRA_CM`, as the cloth rows straddle its rim.
    if (!sample(t, y + 2.5, LEG_PROBE)) {
      out[2] = out[2]! + SEWN_CAP_EXTRA_CM;
      out[3] = out[3]! + SEWN_CAP_EXTRA_CM;
    }
    return true;
  }
  for (let d = 0.25; d < LEG_DOME_CM; d += 0.25) {
    if (!sample(t, y - d, out)) continue;
    const k = d <= 1.5 ? 1 : Math.max(0, 1 - (d - 1.5) / (LEG_DOME_CM - 1.5));
    out[2] = (out[2]! + SEWN_CAP_EXTRA_CM) * k;
    out[3] = (out[3]! + SEWN_CAP_EXTRA_CM) * k;
    return k > 0;
  }
  return false;
}

/** d(radius)/d(height) of the torso along the horizontal direction (dx, dz) from its centre at height y (0 where it cannot tell). */
function torsoSlope(t: Table, dx: number, dz: number, y: number): number {
  const lo = new Float32Array(4), hi = new Float32Array(4);
  if (!sample(t, y - 0.5, lo) || !sample(t, y + 0.5, hi)) return 0;
  const r = Math.hypot(dx, dz);
  if (r < 1e-9) return 0;
  const c = dx / r, s = dz / r;
  const rad = (e: Float32Array): number => (e[2]! * e[3]!) / Math.hypot(e[3]! * c, e[2]! * s);
  return rad(hi) - rad(lo);
}
