/**
 * Collision of cloth particles against the avatar's analytic cross-sections (the solver's hot loop).
 * No imports, so the drape Web Worker loads only this and `cloth.ts`; `body.ts` builds the tables.
 */

/** Ellipses tabulated every `stepCm`: 5 floats per sample (valid, cx, cz, a, b). */
export interface Table {
  lo: number;
  stepCm: number;
  data: Float32Array;
  /**
   * The drawn outline where the body's sections are not ellipses (the male shape v2, `Mannequin.outlines`): when present
   * the collider pushes out of it and the ellipses above only say where the table is valid. Absent on every other body.
   */
  polar?: PolarTable;
}

/**
 * Polar outlines tabulated every `stepCm` from `lo`: `n + 3` floats per sample (valid, centre x, centre z, then the
 * radius at the angles 2πj / n, the angle being atan2(z, x) about the centre; in an arm's (u, v) frame for an arm).
 */
export interface PolarTable {
  lo: number;
  stepCm: number;
  n: number;
  data: Float32Array;
}

const TWO_PI = 2 * Math.PI;

/**
 * The polar outline at coordinate `x` towards the point (px, pz): its centre into `out[0..1]` and the radius along that
 * direction into `out[2]`. False outside the table.
 */
export function samplePolar(t: PolarTable, x: number, px: number, pz: number, out: Float32Array): boolean {
  const stride = t.n + 3;
  const f = (x - t.lo) / t.stepCm;
  const k = Math.floor(f);
  const rows = t.data.length / stride;
  if (k < 0 || k >= rows - 1) return false;
  const i0 = k * stride;
  const i1 = i0 + stride;
  if (t.data[i0] === 0 || t.data[i1] === 0) return false;
  const w = f - k;
  const cx = t.data[i0 + 1]! * (1 - w) + t.data[i1 + 1]! * w;
  const cz = t.data[i0 + 2]! * (1 - w) + t.data[i1 + 2]! * w;
  let a = (Math.atan2(pz - cz, px - cx) / TWO_PI) * t.n;
  if (a < 0) a += t.n;
  const j = Math.floor(a) % t.n;
  const j1 = (j + 1) % t.n;
  const wa = a - Math.floor(a);
  const r0 = t.data[i0 + 3 + j]! * (1 - wa) + t.data[i0 + 3 + j1]! * wa;
  const r1 = t.data[i1 + 3 + j]! * (1 - wa) + t.data[i1 + 3 + j1]! * wa;
  out[0] = cx;
  out[1] = cz;
  out[2] = r0 * (1 - w) + r1 * w;
  return true;
}

/**
 * Push the point (px, pz) out of the polar outline at coordinate `x`, grown by `clearance` and scaled by `scale` about
 * its centre: the centre into `out[0..1]` and the new offset from it returned, or null when the point is outside (or the
 * table has no outline there).
 */
export function pushOutOfPolar(t: PolarTable, x: number, px: number, pz: number, clearance: number, out: Float32Array, scale = 1): [number, number] | null {
  if (!samplePolar(t, x, px, pz, out)) return null;
  const R = out[2]! * scale + clearance;
  const dx = px - out[0]!;
  const dz = pz - out[1]!;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return null;
  if (d2 < 1e-12) return [R, 0];
  const k = R / Math.sqrt(d2);
  return [dx * k, dz * k];
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

/** Length round the polar outline at coordinate `x`, grown by `clearance`, cm; NaN outside the table. */
export function polarGirth(t: PolarTable, x: number, clearance = 0): number {
  const stride = t.n + 3;
  const f = (x - t.lo) / t.stepCm;
  const k = Math.floor(f);
  if (k < 0 || k >= t.data.length / stride - 1) return NaN;
  const i0 = k * stride, i1 = i0 + stride;
  if (t.data[i0] === 0 || t.data[i1] === 0) return NaN;
  const w = f - k;
  const r = (j: number): number => t.data[i0 + 3 + (j % t.n)]! * (1 - w) + t.data[i1 + 3 + (j % t.n)]! * w + clearance;
  const c = Math.cos(TWO_PI / t.n);
  let len = 0;
  for (let j = 0; j < t.n; j++) {
    const a = r(j), b = r(j + 1);
    len += Math.sqrt(Math.max(0, a * a + b * b - 2 * a * b * c));
  }
  return len;
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
      let p: [number, number] | null;
      // A body with drawn outlines (male shape v2): out of the outline itself; its legs have no ledge to round off.
      if (t.polar) p = pushOutOfPolar(t.polar, y, x, z, clearanceCm, e);
      else {
        if (!(sewn && t !== field.torso ? legSection(t, y, e) : sample(t, y, e))) continue;
        p = pushOutOfEllipse(x - e[0]!, z - e[1]!, e[2]!, e[3]!, clearanceCm);
      }
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
        if (!hit) break;
        const p = outOfTorso(field.torso, pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!, clearanceCm, e);
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
      const ru = rx * f.u[0] + ry * f.u[1] + rz * f.u[2];
      const rv = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
      const polar = field.arms[side]!.polar;
      let p: [number, number] | null;
      if (polar) {
        // The drawn arm (male shape v2), its cap above the joint included for a sewn sleeve.
        if (s >= f.s1 || (!sewn && s <= f.s0)) continue;
        p = pushOutOfPolar(polar, s, ru, rv, clearanceCm + (sewn ? SEWN_SLEEVE_EXTRA_CM : 0), e);
        if (p) {
          p[0] += e[0]!;
          p[1] += e[1]!;
        }
      } else {
        if (sewn) {
          if (s >= f.s1 || !armSection(field, side, s, e)) continue;
        } else if (s <= f.s0 || s >= f.s1 || !sample(field.arms[side]!, s, e)) continue;
        p = pushOutOfEllipse(ru, rv, e[2]!, e[3]!, clearanceCm);
      }
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
    if (sewn && chain > 0) {
      const p = outOfTorso(field.torso, pos[3 * i]!, pos[3 * i + 1]!, pos[3 * i + 2]!, clearanceCm, e);
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

/**
 * Extra clearance of a sewn sleeve over a drawn arm (male shape v2), cm: the armhole of a size built on a large body is
 * deep front to back, so the sleeve's top has its particles 3 to 4 cm apart round the arm, and a flat facet between two
 * of them at the plain clearance dips 0.3 cm towards a 6 cm arm: facets of the arm showed above the sleeve hem (110 pixels
 * on the XXL body in XXL).
 */
export const SEWN_SLEEVE_EXTRA_CM = 0.25;

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

/** The offset from the torso's centre (into `e[0..1]`) a point inside the torso at its height is pushed to, or null when it is outside. */
function outOfTorso(t: Table, x: number, y: number, z: number, clearanceCm: number, e: Float32Array): [number, number] | null {
  if (t.polar) return pushOutOfPolar(t.polar, y, x, z, clearanceCm, e);
  if (!sample(t, y, e)) return null;
  return pushOutOfEllipse(x - e[0]!, z - e[1]!, e[2]!, e[3]!, clearanceCm);
}

/** Where a point inside arm `side` (grown by the clearance) is pushed to across the arm's axis, or null when it is outside. */
function outOfArm(field: BodyField, side: number, x: number, y: number, z: number, clearanceCm: number, e: Float32Array): [number, number, number] | null {
  const f = field.armFrames[side]!;
  const rx = x - f.joint[0], ry = y - f.joint[1], rz = z - f.joint[2];
  const s = rx * f.axis[0] + ry * f.axis[1] + rz * f.axis[2];
  const ru = rx * f.u[0] + ry * f.u[1] + rz * f.u[2];
  const rv = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
  const polar = field.arms[side]!.polar;
  let p: [number, number] | null;
  if (polar) {
    if (s >= f.s1) return null;
    p = pushOutOfPolar(polar, s, ru, rv, clearanceCm, e);
    if (p) {
      p[0] += e[0]!;
      p[1] += e[1]!;
    }
  } else {
    if (s >= f.s1 || !armSection(field, side, s, e)) return null;
    p = pushOutOfEllipse(ru, rv, e[2]!, e[3]!, clearanceCm);
  }
  if (!p) return null;
  const du = p[0] - ru, dv = p[1] - rv;
  return [x + f.u[0] * du + f.v[0] * dv, y + f.u[1] * du + f.v[1] * dv, z + f.u[2] * du + f.v[2] * dv];
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
  if (t.polar) {
    // The centre is the same at both heights within half a centimetre: the direction is taken from the lower one.
    if (!samplePolar(t.polar, y - 0.5, 0, 0, lo)) return 0;
    const cx = lo[0]!, cz = lo[1]!;
    if (!samplePolar(t.polar, y - 0.5, cx + dx, cz + dz, lo) || !samplePolar(t.polar, y + 0.5, cx + dx, cz + dz, hi)) return 0;
    return hi[2]! - lo[2]!;
  }
  if (!sample(t, y - 0.5, lo) || !sample(t, y + 0.5, hi)) return 0;
  const r = Math.hypot(dx, dz);
  if (r < 1e-9) return 0;
  const c = dx / r, s = dz / r;
  const rad = (e: Float32Array): number => (e[2]! * e[3]!) / Math.hypot(e[3]! * c, e[2]! * s);
  return rad(hi) - rad(lo);
}
