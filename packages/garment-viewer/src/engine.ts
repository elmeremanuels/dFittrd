/**
 * The device side of the spike, without rendering (docs/ENGINE-HANDOFF.md §On-device fitting):
 * bundle + avatar + fit-engine result + size + fabric → graded mesh, placed mesh, cloth to relax,
 * heat colours and the text under the viewer. Pure: runs in node for tests and in the browser.
 */
import { resolveFabric, mockGarment, type GarmentPayload } from '@curtain/schema';
import type { FitResult, AnchorGaps } from '@curtain/fit-engine';
import type { Mannequin, Mesh } from '@curtain/mannequin';
import { armpitDistance, assignChains, radialMorph, type ChainAssignment } from './core/garment';
import { applyGrading } from './core/grading';
import { topEdgePlane } from './core/waistband';
import type { MaterialJson } from './core/types';
import { insideCanonical, makeCollider, type Avatar, type BodyField } from './body';
import type { SpikeBundle } from './bundle';
import type { DrapeJob } from './drapeJob';
import { clothParams, createCloth, isSettled, settlePins, stepCloth, type Cloth, type ClothMaterial, type ClothParams } from './cloth';
import { fitLines, gapsForSize, heatColors, heatField, placeGarment, placementMorph, sizeEntry, type FitLine, type HeatField, type Placement } from './fitting';

// ---------------------------------------------------------------------------
// Fabric presets for the Phase 0 fabric test
// ---------------------------------------------------------------------------

export const FABRIC_PRESETS = ['product', 'linen', 'silk'] as const;
export type FabricPreset = (typeof FABRIC_PRESETS)[number];

export interface ViewerMaterial extends ClothMaterial {
  preset: FabricPreset;
  label: string;
  baseColorHex: string;
  sheen: number;
  opacity: number;
  texture: string;
  weightGsm: number;
}

/**
 * The product's own material.json, or the same garment with 100 % linen or 100 % silk resolved
 * through the `@curtain/schema` fabric library (colour kept, so only the fabric differs).
 */
export function viewerMaterial(preset: FabricPreset, material: MaterialJson): ViewerMaterial {
  if (preset === 'product') {
    const fibres = material.fibres.map((f) => `${f.pct}% ${f.id}`).join(', ');
    return { preset, label: `Product (${fibres}${material.construction ? `, ${material.construction}` : ''})`, baseColorHex: material.baseColorHex, drape: material.drape, bendStiffness: material.bendStiffness, stretchPct: material.stretchPct, sheen: material.sheen, opacity: material.opacity, texture: material.texture, weightGsm: material.weightGsm, simulation: { damping: material.simulation.damping ?? 0.1 } };
  }
  const r = resolveFabric({ composition: [{ fibre: preset, pct: 100 }] });
  return { preset, label: preset === 'linen' ? '100% linen (fabric library)' : '100% silk (fabric library)', baseColorHex: material.baseColorHex, drape: r.drape, bendStiffness: r.bendStiffness, stretchPct: r.stretchPct, sheen: r.sheen, opacity: r.opacity, texture: r.texture, weightGsm: r.weightGsm, simulation: { damping: r.simulation.damping } };
}

// ---------------------------------------------------------------------------
// Session: one product on the canonical mannequin
// ---------------------------------------------------------------------------

export interface GarmentSession {
  m: Mannequin;
  bundle: SpikeBundle;
  payload: GarmentPayload;
  /** Grading chain per garment vertex, from geometry (stage 4 meshes carry no labels). */
  chains: ChainAssignment;
  /** Particles exempt from collision (`insideCanonical` of the base mesh). */
  noCollide: Uint8Array;
  /** Particles never lifted out of an arm's cap (`armCapLifter`): all but the sleeve pieces that carry a shoulder cap (`shoulderCapPieces`), and those the base mesh already has inside the cap. */
  noLift: Uint8Array;
  /** Graded meshes per size label (the size switch is instant after the first time). */
  graded: Map<string, Mesh>;
}

export function openSession(m: Mannequin, bundle: SpikeBundle, payload: GarmentPayload = bundle.payload ?? mockGarment(bundle.productId)): GarmentSession {
  // A bottom has no sleeves: all of it follows the body (the A-pose elbows hang at waist height).
  const chains = bundle.anchors.category === 'bottom' ? new Uint8Array(bundle.baseMesh.positions.length / 3) : assignChains(m, bundle.baseMesh);
  const probe = Float32Array.from(bundle.baseMesh.positions);
  const lift = armCapLifter(m, 0);
  const capped = shoulderCapPieces(m, bundle.baseMesh.positions, bundle.baseMesh.indices, chains.length);
  const noLift = new Uint8Array(chains.length);
  for (let i = 0; i < noLift.length; i++) noLift[i] = !capped[i] || lift(probe, i) ? 1 : 0;
  return { m, bundle, payload, chains, noCollide: insideCanonical(m, bundle.baseMesh.positions, chains), noLift, graded: new Map() };
}

export function sizeLabels(session: GarmentSession): string[] {
  return session.bundle.grading.sizes.map((s) => s.size);
}

/** S, M and L when the chart has them, else the base size and its neighbours. */
export function defaultTrio(labels: readonly string[], baseSize: string): string[] {
  const want = ['S', 'M', 'L'].filter((s) => labels.includes(s));
  if (want.length === 3) return want;
  const i = Math.max(0, labels.indexOf(baseSize));
  const lo = Math.max(0, Math.min(i - 1, labels.length - 3));
  return labels.slice(lo, lo + 3);
}

export function gradedMesh(session: GarmentSession, size: string): Mesh {
  let g = session.graded.get(size);
  if (!g) {
    g = applyGrading(session.m, session.bundle.baseMesh, session.chains, session.bundle.grading, size);
    session.graded.set(size, g);
  }
  return g;
}

export interface FitInstance {
  size: string;
  gaps: AnchorGaps | null;
  placement: Placement;
  lines: FitLine[];
  heat: HeatField;
  material: ViewerMaterial;
  params: ClothParams;
  cloth: Cloth;
  collide: (pos: Float32Array, i: number) => boolean;
  /** Particles that never collide (see `insideCanonical`). */
  noCollide: Uint8Array;
  indices: Uint32Array;
  /** Pinned particles (the yoke), 1 = pinned. */
  pinned: Uint8Array;
  /** Grading chain per particle (the session's). */
  chains: ChainAssignment;
  /** The avatar's collision tables (what a drape worker needs to rebuild `collide`). */
  field: BodyField;
  /** Garment shoulder width of this size (grading.json `shoulder_width`), cm, when the chart has one. */
  shoulderWidthCm: number | undefined;
}

/**
 * Height from which body-chain vertices are pinned: the shoulder yoke down to the armpit. The
 * shoulders carry the garment; pinning the armhole also keeps the cloth out of the zone where the
 * v0 mannequin's arms overlap its torso (no boolean union yet), where collision would fight itself.
 */
export function yokeHeight(m: Mannequin): number {
  const arm = m.arms.left;
  return Math.min(m.morphHeights.shoulder - 3, arm.joint[1] + arm.axis[1] * armpitDistance(m));
}

/** A bottom (trousers, skirt) hangs from its waistband: the top this many cm of the garment is pinned. */
export const WAISTBAND_CM = 4;

/**
 * Height from which body-chain particles are pinned: the shoulder yoke (`yokeHeight`) for garments
 * that reach the shoulders, the waistband for a bottom (it has nothing above the waist, so a
 * shoulder yoke would pin nothing and the cloth would fall).
 */
export function pinHeight(m: Mannequin, category: string, positions: ArrayLike<number>, chains: ChainAssignment): number {
  if (category !== 'bottom') return yokeHeight(m);
  let top = -Infinity;
  for (let i = 0; i < chains.length; i++) if (chains[i] === 0 && positions[3 * i + 1]! > top) top = positions[3 * i + 1]!;
  return top - WAISTBAND_CM;
}

/**
 * Bottoms: the particles of the waistband, the top `WAISTBAND_CM` under the garment's own top edge (`topEdgePlane`: a plane
 * through the highest cloth per 10° sector, sectors of an opening that reaches the edge dropped). A level line through the
 * highest point (`pinHeight`) pinned only the back of run 15's maxi skirt, whose generated waistband is 8–10 cm lower at the
 * front: the front hung free and slid down the legs. On a level waistband both give the same particles.
 */
export function waistbandPins(positions: ArrayLike<number>, indices: ArrayLike<number>, chains: ChainAssignment): Uint8Array {
  const n = chains.length;
  const pinned = new Uint8Array(n);
  const plane = topEdgePlane({ positions, indices } as Pick<Mesh, 'positions' | 'indices'>);
  if (!plane) return pinned;
  for (let i = 0; i < n; i++) {
    if (chains[i] !== 0) continue;
    const x = positions[3 * i]!, y = positions[3 * i + 1]!, z = positions[3 * i + 2]!;
    if (y >= plane.a + plane.b * x + plane.c * z - WAISTBAND_CM) pinned[i] = 1;
  }
  return pinned;
}

/** Collision clearance between cloth and avatar, cm. */
export const CLEARANCE_CM = 0.35;

/** Steps 1–3 of §Fitting, and the cloth ready for step 4. */
export function prepareFit(session: GarmentSession, avatar: Avatar, field: BodyField, fit: FitResult, size: string, material: ViewerMaterial, durationS = 1.5): FitInstance {
  const { m, chains } = session;
  const graded = gradedMesh(session, size);
  const gaps = gapsForSize(fit, size);
  // The loop states come from the fit engine's bands (product fabric), never from the display preset (R2).
  const placement = placeGarment(session.bundle.grading, size, gaps, avatar.rings);
  const placed = radialMorph(m, graded, chains, placementMorph(placement, m.morphHeights));
  // Above the chest the v0 mannequin's torso widens into the arm junction, and a smaller size can
  // sit inside it there; those particles are exempt too (the shoulders carry that part anyway).
  const noCollide = Uint8Array.from(session.noCollide);
  const inside = insideCanonical(m, graded.positions, chains);
  for (let i = 0; i < noCollide.length; i++) if (inside[i] === 1 && graded.positions[3 * i + 1]! > m.morphHeights.chest) noCollide[i] = 1;
  const start = Float32Array.from(placed.positions);
  const yoke = pinHeight(m, session.bundle.anchors.category, start, chains);
  // The yoke is where grading put it: the shoulder ring grades by the `shoulder_width` ratio between
  // sizes (D15 breadth); its base width is the mesh's (on the synthetic garment, the mannequin torso's). Pinning only out to the seams or the body's shoulder
  // points was measured and rejected: on the v0 mannequin the freed cloth lands in the arm junction
  // and sags (p99 strain 26–35 % instead of 11–24 % on the tee).
  const pinned = session.bundle.anchors.category === 'bottom' ? waistbandPins(start, graded.indices, chains) : new Uint8Array(chains.length);
  if (session.bundle.anchors.category !== 'bottom') for (let i = 0; i < chains.length; i++) if (chains[i] === 0 && start[3 * i + 1]! >= yoke) pinned[i] = 1;
  const cuff = new Uint8Array(chains.length);
  pinLoosePieces(m, start, graded.indices, pinned, session.bundle.baseMesh.positions, cuff, session.bundle.anchors.category === 'bottom');
  const lift = armCapLifter(m, CLEARANCE_CM, session.noLift);
  for (let i = 0; i < chains.length; i++) lift(start, i);
  const cloth = createCloth(start, graded.positions, graded.indices, (i) => pinned[i] === 1, (i) => chains[i] === 0);
  for (let i = 0; i < chains.length; i++) if (cuff[i] && !pinned[i]) cloth.leash[i] = CUFF_LEASH_CM;
  const collide = makeCollider(field, CLEARANCE_CM, chains, noCollide);
  // Settle the yoke onto the avatar before pinning it: a small size sits a few mm inside the neck
  // and shoulders, and a stretched edge between two pins never relaxes (the neckline tears).
  // Known gap: on a body much wider at the shoulders than the garment, the particles exempt from
  // collision stay inside and the loop's stretch concentrates next to them (33–53 % on the
  // 104/90/112 body in S–L, from 124–287 % before). Letting them collide here was measured worse.
  settlePins(cloth, (p, i) => {
    const a = collide(p, i);
    return lift(p, i) || a;
  });
  return {
    size: placement.size,
    gaps,
    placement,
    lines: fitLines(gaps, placement, session.bundle.qa.chartAgreement.missing ?? []),
    heat: heatField(gaps, m.morphHeights),
    material,
    params: clothParams(material, durationS),
    cloth,
    collide,
    noCollide,
    indices: graded.indices,
    pinned,
    chains,
    field,
    shoulderWidthCm: sizeEntry(session.bundle.grading, size).targets.shoulder_width,
  };
}

/** A sleeve piece's head: at least this many cm along the arm from its point nearest the shoulder joint is pinned. */
export const SLEEVE_CAP_CM = 4;

/**
 * Stage 4t's sleeves are tubes of their own that overlap the bodice at the armhole, not sewn to it.
 * A sewn sleeve hangs from its whole armhole seam; pinning only the particles that happen to lie
 * above the yoke height (the top of the sleeve head) let each sleeve pivot down round those pins in
 * the drape (run 14: the sleeve's centroid dropped 1.7–2.4 cm towards the underarm and the puff
 * collapsed onto the arm). So every piece other than the largest (the bodice) is pinned all round
 * its head: the particles up to the armpit along the arm (`armpitDistance`, where the arm's inner
 * side leaves the torso: the armhole seam line), and at least `SLEEVE_CAP_CM` from the piece's point
 * nearest the shoulder joint (on the side of the body it lies on). A gathered cuff is marked in
 * `cuff` (`gatheredCuff`, decided on `base`, the base-size positions, so every size marks the same
 * particles): `prepareFit` holds it on a leash (`CUFF_LEASH_CM`), not a pin. Mutates `pinned` (and
 * `cuff`); returns the number of particles it pinned.
 */
export function pinLoosePieces(m: Mannequin, pos: ArrayLike<number>, indices: ArrayLike<number>, pinned: Uint8Array, base: ArrayLike<number> = pos, cuff?: Uint8Array, bottom = false): number {
  const all = meshPieces(indices, pinned.length);
  if (all.length < 2) return 0;
  const largest = all.reduce((a, b) => (b.length > a.length ? b : a));
  const head = armpitDistance(m);
  let added = 0;
  for (const members of all) {
    if (members === largest) continue;
    if (bottom) {
      added += pinPieceTop(pos, members, pinned);
      continue;
    }
    let sx = 0;
    for (const i of members) sx += pos[3 * i]!;
    const arm = sx >= 0 ? m.arms.left : m.arms.right;
    const along = (i: number): number => (pos[3 * i]! - arm.joint[0]) * arm.axis[0] + (pos[3 * i + 1]! - arm.joint[1]) * arm.axis[1] + (pos[3 * i + 2]! - arm.joint[2]) * arm.axis[2];
    const s0 = Math.min(...members.map(along));
    const limit = Math.max(s0 + SLEEVE_CAP_CM, head);
    for (const i of members) if (!pinned[i] && along(i) <= limit) {
      pinned[i] = 1;
      added++;
    }
    // Whether the cuff is gathered is the product's: decided on the base-size garment, the same particles in every size.
    const alongBase = (i: number): number => (base[3 * i]! - arm.joint[0]) * arm.axis[0] + (base[3 * i + 1]! - arm.joint[1]) * arm.axis[1] + (base[3 * i + 2]! - arm.joint[2]) * arm.axis[2];
    if (cuff) for (const i of gatheredCuff(m, arm, members, alongBase, base)) if (!pinned[i]) cuff[i] = 1;
  }
  return added;
}

/**
 * A bottom's pieces other than the largest are pinned along their top `LOOSE_TOP_PIN_CM`: trousers from stage 4t before
 * template fit 0.4.0 are a seat tube and two leg tubes that overlap the seat by 3 cm but are not sewn to it. The sleeve
 * rule (`pinLoosePieces`, along the arm) pinned nothing sensible on a leg, and run 17d's leg tubes fell away from the
 * seat in the drape (our grey thighs showed between them at every size). Stage 4t 0.4.0 sews the legs to the seat
 * (`stitchTrousers`, one piece), which this leaves alone.
 */
export const LOOSE_TOP_PIN_CM = 3;

function pinPieceTop(pos: ArrayLike<number>, members: readonly number[], pinned: Uint8Array): number {
  let top = -Infinity;
  for (const i of members) top = Math.max(top, pos[3 * i + 1]!);
  let added = 0;
  for (const i of members) if (!pinned[i] && pos[3 * i + 1]! >= top - LOOSE_TOP_PIN_CM) {
    pinned[i] = 1;
    added++;
  }
  return added;
}

/** Connected pieces of a mesh (particle lists, pieces of fewer than 3 particles left out). */
export function meshPieces(indices: ArrayLike<number>, n: number): number[][] {
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]!);
    parent[find(indices[t + 1]!)] = a;
    parent[find(indices[t + 2]!)] = a;
  }
  const pieces = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    (pieces.get(r) ?? pieces.set(r, []).get(r)!).push(i);
  }
  return [...pieces.values()].filter((p) => p.length >= 3);
}

/** A sleeve piece carries a shoulder cap when it reaches at least this far above the shoulder joint along the arm (cm). */
export const SHOULDER_CAP_REACH_CM = 2;

/**
 * 1 for particles of the pieces other than the largest (the bodice) that reach over the shoulder
 * joint: stage 4t's sleeves with their shoulder cap (run 14: 7–8 cm above the joint). A set-in sleeve
 * that starts at the joint (the synthetic garments: −0.3 cm) is not one; the bodice covers its cap.
 */
export function shoulderCapPieces(m: Mannequin, pos: ArrayLike<number>, indices: ArrayLike<number>, n: number): Uint8Array {
  const out = new Uint8Array(n);
  const all = meshPieces(indices, n);
  if (all.length < 2) return out;
  const largest = all.reduce((a, b) => (b.length > a.length ? b : a));
  for (const p of all) {
    if (p === largest) continue;
    let sx = 0;
    for (const i of p) sx += pos[3 * i]!;
    const f = sx >= 0 ? m.arms.left : m.arms.right;
    let s0 = Infinity;
    for (const i of p) s0 = Math.min(s0, (pos[3 * i]! - f.joint[0]) * f.axis[0] + (pos[3 * i + 1]! - f.joint[1]) * f.axis[1] + (pos[3 * i + 2]! - f.joint[2]) * f.axis[2]);
    if (s0 <= -SHOULDER_CAP_REACH_CM) for (const i of p) out[i] = 1;
  }
  return out;
}

/** The cuff band: the last this many cm of a sleeve along the arm. */
export const CUFF_BAND_CM = 2;
/** A cuff counts as gathered onto the arm when its mean radius is at most this far outside the arm's surface (cm) … */
export const GATHERED_CUFF_GAP_CM = 2;
/** … and at most this share of the sleeve's widest mean radius (a puff narrowing to an elastic cuff). */
export const GATHERED_CUFF_RATIO = 0.8;

/**
 * A gathered cuff (an elastic or a band narrower than the sleeve, sitting close to the arm) grips the
 * forearm: it holds the far end of the sleeve where the frames show it, and the puff between head and
 * cuff keeps its volume instead of sliding down the A-pose arm and the cuff opening up. Returns the
 * cuff band of such a sleeve; a wide or open cuff (a bell sleeve) gives none.
 *
 * The band is held on a leash of `CUFF_LEASH_CM` round its placed position, not pinned: a hard pin
 * (measured on run 14, M mannequin) kept it exactly in place but raised the sleeve's own p99 edge
 * strain in AU 12 from 5.8 % (cuff free) to 16.7 %, the stretch landing just above the cuff where the
 * puff settles against a fixed ring. Free, the band fell 1.6–1.9 cm and the right cuff opened from
 * 5.5 to 7.2 cm radius.
 */
export const CUFF_LEASH_CM = 0.5;

export function gatheredCuff(m: Mannequin, arm: Mannequin['arms']['left'], members: readonly number[], along: (i: number) => number, pos: ArrayLike<number>): number[] {
  const sMax = Math.max(...members.map(along));
  const radius = (i: number, s: number): number => {
    const x = pos[3 * i]! - (arm.joint[0] + arm.axis[0] * s), y = pos[3 * i + 1]! - (arm.joint[1] + arm.axis[1] * s), z = pos[3 * i + 2]! - (arm.joint[2] + arm.axis[2] * s);
    return Math.hypot(x, y, z);
  };
  // Mean radius per 2 cm band along the arm.
  const bands = new Map<number, { r: number; n: number }>();
  for (const i of members) {
    const s = along(i);
    const b = Math.floor(s / CUFF_BAND_CM);
    const e = bands.get(b) ?? { r: 0, n: 0 };
    e.r += radius(i, s);
    e.n++;
    bands.set(b, e);
  }
  const widest = Math.max(...[...bands.values()].filter((e) => e.n >= 4).map((e) => e.r / e.n));
  const cuff = members.filter((i) => along(i) >= sMax - CUFF_BAND_CM);
  if (cuff.length < 4) return [];
  let cuffR = 0, armR = 0;
  for (const i of cuff) {
    const s = along(i);
    cuffR += radius(i, s);
    const e = m.armAt(Math.max(0, s), arm.side);
    armR += e ? (e.a + e.b) / 2 : 0;
  }
  cuffR /= cuff.length;
  armR /= cuff.length;
  return cuffR - armR <= GATHERED_CUFF_GAP_CM && cuffR <= GATHERED_CUFF_RATIO * widest ? cuff : [];
}

/**
 * Pushes a particle out of the upper half of an arm's cap: the cone above the shoulder joint and the
 * arm down to the armpit, on the side away from the underarm. The collider leaves that zone out
 * (body-chain particles meet the torso only, sleeve particles the arm below the armpit only, because
 * the v0 arm overlaps the torso there), and a smaller size grades the shoulder cloth inwards about
 * the body axis, into the cap (run 14, AU 8: a grey patch on the shoulder once stage 4t had closed
 * it). Applied to the placed garment and inside the pin settle, whether or not the particle is
 * exempt from collision (the exemption is for the torso junction, not the cap). Particles in `skip`
 * are never moved: the session passes those the base garment already has inside the cap (the
 * synthetic garments lie inside the v0 arm where it overlaps the torso; lifting them tore the
 * neckline), so only cloth that grading pushed in is lifted. The cap is the canonical one: the
 * avatar's arms are not morphed. Returns a function (pos, i) → moved.
 */
export function armCapLifter(m: Mannequin, clearanceCm: number, skip?: Uint8Array): (pos: Float32Array, i: number) => boolean {
  const head = armpitDistance(m);
  const arms = [m.arms.left, m.arms.right].map((f) => {
    const a0 = m.armAt(0, f.side)!;
    // The mannequin closes the arm above the joint with a cone to its start pole, 0.9 upper-arm radii
    // above the joint (`@curtain/mannequin` model.ts; the section at the joint is 1.18 upper-arm radii).
    return { f, a0, pole: (0.9 / 1.18) * a0.a };
  });
  return (pos, i) => {
    if (skip && skip[i] === 1) return false;
    let moved = false;
    for (const { f, a0, pole } of arms) {
      const rx = pos[3 * i]! - f.joint[0], ry = pos[3 * i + 1]! - f.joint[1], rz = pos[3 * i + 2]! - f.joint[2];
      const s = rx * f.axis[0] + ry * f.axis[1] + rz * f.axis[2];
      if (s > (head) || s <= -pole) continue;
      const ru = rx * f.u[0] + ry * f.u[1] + rz * f.u[2], rv = rx * f.v[0] + ry * f.v[1] + rz * f.v[2];
      // The underarm (below the arm axis) stays out: there the arm runs into the torso.
      if (s >= 0 && ru * f.u[1] + rv * f.v[1] <= 0) continue;
      const e = s >= 0 ? m.armAt(s, f.side)! : a0;
      const t = s >= 0 ? 1 : 1 + s / pole;
      const A = e.a * t + clearanceCm, B = e.b * t + clearanceCm;
      const q = (ru / A) ** 2 + (rv / B) ** 2;
      // On the surface within float32 rounding (positions are Float32Array) counts as outside.
      if (q >= 1 - 1e-4 || q < 1e-9) continue;
      const k = 1 / Math.sqrt(q) - 1;
      for (let d = 0; d < 3; d++) pos[3 * i + d] = pos[3 * i + d]! + k * (ru * f.u[d]! + rv * f.v[d]!);
      moved = true;
    }
    return moved;
  };
}

/** Run the whole relaxation at once, up to the duration cap or until calm (tests, the blind page's pre-render). */
export function relax(fit: FitInstance): Float32Array {
  while (!isSettled(fit.cloth, fit.params)) stepCloth(fit.cloth, fit.params, fit.collide, 1);
  return fit.cloth.pos;
}

/** The drape of a fit as a job for a Web Worker (`drapeJob.ts`); the worker rebuilds the collider. */
export function drapeJobOf(fit: FitInstance): Omit<DrapeJob, 'id'> {
  return { cloth: fit.cloth, params: fit.params, field: fit.field, chains: fit.chains, noCollide: fit.noCollide, clearanceCm: CLEARANCE_CM };
}

/**
 * Largest edge strain at the neckline: edges of the body chain with both ends above the shoulder
 * ring less 1 cm (0.05 = 5 % longer than at rest). Regression check for the neckline tears that
 * small sizes showed before the yoke was settled onto the body (21–33 % on XS and S).
 */
export function necklineStrain(fit: Pick<FitInstance, 'cloth' | 'chains'>, m: Mannequin): number {
  const { cloth, chains } = fit;
  const y0 = m.morphHeights.shoulder - 1;
  let worst = 0;
  for (let e = 0; e < cloth.edgeRest.length; e++) {
    const a = cloth.edges[2 * e]!;
    const b = cloth.edges[2 * e + 1]!;
    const r = cloth.edgeRest[e]!;
    if (chains[a] !== 0 || chains[b] !== 0 || r <= 0 || cloth.pos[3 * a + 1]! < y0 || cloth.pos[3 * b + 1]! < y0) continue;
    const dx = cloth.pos[3 * a]! - cloth.pos[3 * b]!;
    const dy = cloth.pos[3 * a + 1]! - cloth.pos[3 * b + 1]!;
    const dz = cloth.pos[3 * a + 2]! - cloth.pos[3 * b + 2]!;
    worst = Math.max(worst, Math.sqrt(dx * dx + dy * dy + dz * dz) / r - 1);
  }
  return worst;
}

export function heatFor(fit: FitInstance, chains: ChainAssignment, out?: Float32Array): Float32Array {
  return heatColors(fit.cloth.pos, chains, fit.heat, out);
}
