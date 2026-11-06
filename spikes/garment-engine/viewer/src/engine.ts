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
import { clothParams, createCloth, settlePins, stepCloth, type Cloth, type ClothMaterial, type ClothParams } from './cloth';
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

export function openSession(m: Mannequin, bundle: SpikeBundle, payload: GarmentPayload = mockGarment(bundle.productId)): GarmentSession {
  const chains = assignChains(m, bundle.baseMesh);
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
  const yoke = yokeHeight(m);
  const start = Float32Array.from(placed.positions);
  // The yoke is where grading put it: the shoulder ring grades with `shoulder_width` (D15 breadth),
  // so its seams sit at ±width/2 of this size. Pinning only out to the seams or the body's shoulder
  // points was measured and rejected: on the v0 mannequin the freed cloth lands in the arm junction
  // and sags (p99 strain 26–35 % instead of 11–24 % on the tee).
  const pinned = new Uint8Array(chains.length);
  for (let i = 0; i < chains.length; i++) if (chains[i] === 0 && start[3 * i + 1]! >= yoke) pinned[i] = 1;
  const cloth = createCloth(start, graded.positions, graded.indices, (i) => pinned[i] === 1, (i) => chains[i] === 0);
  const collide = makeCollider(field, CLEARANCE_CM, chains, noCollide);
  // Settle the yoke onto the avatar before pinning it: a small size sits a few mm inside the neck
  // and shoulders, and a stretched edge between two pins never relaxes (the neckline tears).
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
    shoulderWidthCm: sizeEntry(session.bundle.grading, size).targets.shoulder_width,
  };
}

/** Run the whole relaxation at once (tests, the blind page's pre-render). */
export function relax(fit: FitInstance): Float32Array {
  const frames = Math.round(fit.params.durationS / fit.params.dt);
  stepCloth(fit.cloth, fit.params, fit.collide, frames);
  return fit.cloth.pos;
}

export function heatFor(fit: FitInstance, chains: ChainAssignment, out?: Float32Array): Float32Array {
  return heatColors(fit.cloth.pos, chains, fit.heat, out);
}
