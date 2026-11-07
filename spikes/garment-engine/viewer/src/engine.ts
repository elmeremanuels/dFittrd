/**
 * The device side of the spike, without rendering (docs/ENGINE-HANDOFF.md §On-device fitting):
 * bundle + avatar + fit-engine result + size + fabric → graded mesh, placed mesh, cloth to relax,
 * heat colours and the text under the viewer. Pure: runs in node for tests and in the browser.
 */
import { resolveFabric, mockGarment, type GarmentPayload } from '@curtain/schema';
import type { FitResult, AnchorGaps } from '@curtain/fit-engine';
import type { Mannequin, Mesh } from '@curtain/mannequin';
import { armpitDistance, assignChains, radialMorph, type ChainAssignment } from '../../src/garment';
import { applyGrading } from '../../src/grading';
import type { MaterialJson } from '../../src/product';
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
  /** Graded meshes per size label (the size switch is instant after the first time). */
  graded: Map<string, Mesh>;
}

export function openSession(m: Mannequin, bundle: SpikeBundle, payload: GarmentPayload = bundle.payload ?? mockGarment(bundle.productId)): GarmentSession {
  // A bottom has no sleeves: all of it follows the body (the A-pose elbows hang at waist height).
  const chains = bundle.anchors.category === 'bottom' ? new Uint8Array(bundle.baseMesh.positions.length / 3) : assignChains(m, bundle.baseMesh);
  return { m, bundle, payload, chains, noCollide: insideCanonical(m, bundle.baseMesh.positions, chains), graded: new Map() };
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
  const pinned = new Uint8Array(chains.length);
  for (let i = 0; i < chains.length; i++) if (chains[i] === 0 && start[3 * i + 1]! >= yoke) pinned[i] = 1;
  pinLoosePieces(m, start, graded.indices, pinned);
  const cloth = createCloth(start, graded.positions, graded.indices, (i) => pinned[i] === 1, (i) => chains[i] === 0);
  const collide = makeCollider(field, CLEARANCE_CM, chains, noCollide);
  // Settle the yoke onto the avatar before pinning it: a small size sits a few mm inside the neck
  // and shoulders, and a stretched edge between two pins never relaxes (the neckline tears).
  // Known gap: on a body much wider at the shoulders than the garment, the particles exempt from
  // collision stay inside and the loop's stretch concentrates next to them (33–53 % on the
  // 104/90/112 body in S–L, from 124–287 % before). Letting them collide here was measured worse.
  settlePins(cloth, collide);
  return {
    size: placement.size,
    gaps,
    placement,
    lines: fitLines(gaps, placement),
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

/** A loose piece's shoulder end: this many cm along the arm from its point nearest the shoulder joint is pinned. */
export const SLEEVE_CAP_CM = 4;

/**
 * Pieces of the garment with no pinned particle (stage 4t's sleeves are tubes of their own that
 * overlap the bodice at the armhole, not sewn to it) would slide down the A-pose arm or fall: pin
 * each such piece's shoulder end, the particles within `SLEEVE_CAP_CM` along the arm of its point
 * nearest the shoulder joint (on the side of the body it lies on). Mutates `pinned`.
 */
export function pinLoosePieces(m: Mannequin, pos: ArrayLike<number>, indices: ArrayLike<number>, pinned: Uint8Array): number {
  const n = pinned.length;
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
  let added = 0;
  for (const members of pieces.values()) {
    if (members.length < 3 || members.some((i) => pinned[i])) continue;
    let sx = 0;
    for (const i of members) sx += pos[3 * i]!;
    const arm = sx >= 0 ? m.arms.left : m.arms.right;
    const along = (i: number): number => (pos[3 * i]! - arm.joint[0]) * arm.axis[0] + (pos[3 * i + 1]! - arm.joint[1]) * arm.axis[1] + (pos[3 * i + 2]! - arm.joint[2]) * arm.axis[2];
    const s0 = Math.min(...members.map(along));
    for (const i of members) if (along(i) <= s0 + SLEEVE_CAP_CM) {
      pinned[i] = 1;
      added++;
    }
  }
  return added;
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
