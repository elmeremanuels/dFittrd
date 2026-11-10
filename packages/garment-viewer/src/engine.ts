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
import { sample } from './collide';
import type { SpikeBundle } from './bundle';
import type { DrapeJob } from './drapeJob';
import { clothParams, createCloth, isSettled, loopGirth, setLoops, settlePins, stepCloth, type Cloth, type ClothMaterial, type ClothParams, type GirthLoop } from './cloth';
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
  /** Bottoms: where the waistband rests (`slideWaistband`, or `fitElasticBand` with a band spec); null for other garments. */
  band: BandSlide | null;
  /** The drape options this fit was made with. */
  options: DrapeOptions;
  /** Girth loops installed on the cloth (`anchorLoops`): ring name and its minimum girth, cm. */
  loops: { ring: string; minGirthCm: number; particles: number }[];
}

// ---------------------------------------------------------------------------
// Step-3 control (docs/research/shortcut-to-step3.md §4, days 1-2)
// ---------------------------------------------------------------------------

/**
 * A stretch waistband as measured on the garment: relaxed girth (lying flat, doubled) and the girth
 * it stretches to at most, both of `measuredSize`. Other sizes are graded from it by
 * `gradeCmPerSize` per chart step (relaxed), keeping the measured stretch ratio.
 */
export interface WaistbandSpec {
  relaxedCm: number;
  stretchedCm: number;
  /** The size that was measured (default: the grading's base size). */
  measuredSize?: string;
  /** Relaxed-girth step per size, cm (default: the chart's hip step, else 5). */
  gradeCmPerSize?: number;
  /** True while the numbers are assumptions, not a tape measurement: the fit line says so. */
  assumed: boolean;
}

export interface DrapeOptions {
  /** The cling pull towards the body axis (`clothParams`). */
  cling: boolean;
  /** Girth loops at the hip, waist and hem rings (`anchorLoops`): the share of the graded girth a loop may not fold below; 0 = off. */
  loopRetain: number;
  /** Bottoms with a stretch waistband: the band model (`fitElasticBand`); null = not modelled. */
  waistband: WaistbandSpec | null;
  /** Rings that get a girth loop (default all of `LOOP_RINGS`). */
  loopRings?: readonly LoopRing[];
}

export const LOOP_RINGS = ['waist', 'hip', 'hem'] as const;
export type LoopRing = (typeof LOOP_RINGS)[number];

/**
 * Drape options from URL-style parameters (the spike page, the sizes-drape script): `cling=0`,
 * `loops=<retain>` (cling stays as set), `rings=hip,waist`, `band=<relaxed>:<stretched>` in cm of the
 * base size (always an assumption: a measured band comes only from the data file, waistbands.json, never from a
 * URL). Anything missing keeps `DEFAULT_DRAPE`.
 */
export function drapeOptionsFrom(get: (key: string) => string | null): DrapeOptions {
  const o: DrapeOptions = { ...DEFAULT_DRAPE };
  if (get('cling') === '0') o.cling = false;
  const retain = Number(get('loops'));
  if (Number.isFinite(retain) && retain > 0 && retain <= 1.2) o.loopRetain = retain;
  const rings = (get('rings') ?? '').split(',').filter((r): r is LoopRing => (LOOP_RINGS as readonly string[]).includes(r));
  if (rings.length) o.loopRings = rings;
  const [r, st] = (get('band') ?? '').split(':').map(Number);
  if (r !== undefined && st !== undefined && Number.isFinite(r) && Number.isFinite(st) && r > 20 && st >= r) o.waistband = { relaxedCm: r, stretchedCm: st, assumed: true };
  return o;
}

/** What the viewer ships with: the drape as it was before the step-3 control (cling on, no loops, no band model). */
export const DEFAULT_DRAPE: DrapeOptions = { cling: true, loopRetain: 0, waistband: null };

/** Half-height of the slice of particles that forms a girth loop, cm. */
export const LOOP_SLICE_CM = 1.5;
/** A loop component needs at least this many particles. */
export const LOOP_MIN_PARTICLES = 12;

/**
 * Girth loops of a fit: at the hip and waist rings (the mannequin's morph heights) and 2 cm above
 * the hem, the free body-chain particles whose graded (rest) height is within `LOOP_SLICE_CM`, split
 * into connected pieces along the mesh edges (the two leg tubes of a trouser are two loops). Each
 * loop may not fold below `retain` × its graded girth (convex hull in x–z of the graded mesh: the
 * per-size cut from grading.json). Rings with pinned particles are skipped (the pins hold them).
 */
export function anchorLoops(m: Mannequin, rest: ArrayLike<number>, indices: ArrayLike<number>, chains: ChainAssignment, pinned: Uint8Array, retain: number, only: readonly LoopRing[] = LOOP_RINGS): (GirthLoop & { ring: string })[] {
  const n = chains.length;
  let hemY = Infinity;
  for (let i = 0; i < n; i++) if (chains[i] === 0) hemY = Math.min(hemY, rest[3 * i + 1]!);
  const rings = ([['waist', m.morphHeights.waist], ['hip', m.morphHeights.hip], ['hem', hemY + 2]] as [LoopRing, number][]).filter(([r]) => only.includes(r));
  const out: (GirthLoop & { ring: string })[] = [];
  const adj = new Map<number, number[]>();
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = indices[t + k]!, b = indices[t + ((k + 1) % 3)]!;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
    (adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
  }
  const scratch: number[] = [];
  for (const [ring, y] of rings) {
    const sel = new Uint8Array(n);
    let pinnedHere = false;
    for (let i = 0; i < n; i++) {
      if (chains[i] !== 0 || Math.abs(rest[3 * i + 1]! - y) > LOOP_SLICE_CM) continue;
      if (pinned[i]) pinnedHere = true;
      else sel[i] = 1;
    }
    if (pinnedHere) continue;
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!sel[i] || seen[i]) continue;
      const comp: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const v = stack.pop()!;
        comp.push(v);
        for (const u of adj.get(v) ?? []) if (sel[u] && !seen[u]) { seen[u] = 1; stack.push(u); }
      }
      if (comp.length < LOOP_MIN_PARTICLES) continue;
      const g = loopGirth(rest, comp, 0, comp.length, scratch, new Int32Array(comp.length + 1));
      if (g > 0) out.push({ ring, particles: comp, minGirthCm: retain * g });
    }
  }
  return out;
}

/** Relaxed and stretched girth of the band in `size`, cm (`WaistbandSpec`). */
export function bandFor(spec: WaistbandSpec, grading: SpikeBundle['grading'], size: string): { relaxedCm: number; stretchedCm: number } {
  const step = sizeEntry(grading, size).step;
  const step0 = sizeEntry(grading, spec.measuredSize ?? grading.baseSize).step;
  let grade = spec.gradeCmPerSize;
  if (grade === undefined) {
    const hips = grading.sizes.filter((s) => s.targets.hip !== undefined).sort((a, b) => a.step - b.step);
    const lo = hips[0], hi = hips[hips.length - 1];
    grade = lo && hi && hi.step > lo.step ? (hi.targets.hip! - lo.targets.hip!) / (hi.step - lo.step) : 5;
  }
  const relaxedCm = spec.relaxedCm + (step - step0) * grade;
  return { relaxedCm, stretchedCm: relaxedCm * (spec.stretchedCm / spec.relaxedCm) };
}

/** Extra particles under the band whose girth is blended from the band's to their own, cm. */
export const BAND_BLEND_CM = 8;

export interface ElasticBand extends BandSlide {
  relaxedCm: number;
  stretchedCm: number;
  /** Girth the band takes on this body, cm: the body's (plus the clearance) where it rests, at least the relaxed girth, at most the stretched. */
  onBodyCm: number;
  /** The body is larger than the band stretches to where it was made to sit: it would not go on (shown at its stretch limit, flagged). */
  overstretched: boolean;
  assumed: boolean;
}

/**
 * A stretch waistband with a known relaxed girth `R` and stretch limit `S`: it stays where the
 * garment was made to sit when the body (plus the clearance) there is at least `R`, stretched to
 * the body's girth (at most `S`); a band looser than the body slides down to where the body fills
 * it (as `slideWaistband` does with the sewn girth). Then the top `WAISTBAND_CM` of the body chain is
 * scaled about its centre to the band's girth on the body, blended back to the cut over
 * `BAND_BLEND_CM` below: the fabric is gathered (or stretched) by the band. Mutates `start`.
 */
export function fitElasticBand(field: BodyField, start: Float32Array, chains: ChainAssignment, clearanceCm: number, band: { relaxedCm: number; stretchedCm: number }, assumed: boolean): ElasticBand {
  let top = -Infinity;
  for (let i = 0; i < chains.length; i++) if (chains[i] === 0) top = Math.max(top, start[3 * i + 1]!);
  const yb = top - 2;
  const e = new Float32Array(4);
  const body = (y: number): number => (sample(field.torso, y, e) ? ellipsePerimeter(e[2]! + clearanceCm, e[3]! + clearanceCm) : NaN);
  const R = band.relaxedCm, S = band.stretchedCm;
  const at = body(yb);
  let drop = 0, rest = at, pastHips = false;
  if (Number.isFinite(at) && R > at + BAND_HOLD_CM) {
    let best = -Infinity, bestY = yb, found = false;
    for (let y = yb; y >= yb - BAND_SEARCH_CM; y -= 0.25) {
      const g = body(y);
      if (!Number.isFinite(g)) break;
      if (g > best) { best = g; bestY = y; }
      if (g + BAND_HOLD_CM >= R) { drop = yb - y; rest = g; found = true; break; }
    }
    if (!found) { drop = yb - bestY; rest = best; pastHips = true; }
    for (let i = 0; i < chains.length; i++) start[3 * i + 1] = start[3 * i + 1]! - drop;
  }
  const onBody = Number.isFinite(rest) ? Math.min(S, Math.max(R, rest)) : R;
  const overstretched = Number.isFinite(rest) && rest > S;
  // Scale the band about its centre to the girth on the body.
  const yTop = top - drop;
  const pts: [number, number][] = [];
  let cx = 0, cz = 0, k = 0;
  for (let i = 0; i < chains.length; i++) if (chains[i] === 0 && start[3 * i + 1]! >= yTop - 2) { pts.push([start[3 * i]!, start[3 * i + 2]!]); cx += start[3 * i]!; cz += start[3 * i + 2]!; k++; }
  const sewn = hullPerimeter(pts);
  if (k > 0 && sewn > 0) {
    cx /= k; cz /= k;
    const s = onBody / sewn;
    for (let i = 0; i < chains.length; i++) {
      if (chains[i] !== 0) continue;
      const d = yTop - WAISTBAND_CM - start[3 * i + 1]!; // > 0 below the band
      const t = d <= 0 ? 1 : Math.max(0, 1 - d / BAND_BLEND_CM);
      if (t === 0) continue;
      const f = 1 + (s - 1) * t;
      start[3 * i] = cx + (start[3 * i]! - cx) * f;
      start[3 * i + 2] = cz + (start[3 * i + 2]! - cz) * f;
    }
  }
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  return { bandGirthCm: r1(sewn), bodyAtBandCm: r1(at), bodyAtRestCm: r1(rest), dropCm: r1(drop), pastHips, relaxedCm: r1(R), stretchedCm: r1(S), onBodyCm: r1(onBody), overstretched, assumed };
}

/** The text line for a modelled stretch waistband. */
export function elasticBandLine(b: ElasticBand): FitLine {
  const src = b.assumed ? 'assumed band (not measured yet)' : 'measured band';
  const where = b.pastHips ? `slides ${b.dropCm} cm down past the hips and would not stay up` : b.dropCm > 0 ? `is looser than the body where it was made to sit and slides ${b.dropCm} cm down` : b.overstretched ? 'would have to stretch past its limit: too small for this body' : `stretches to ${b.onBodyCm} cm`;
  return { anchor: 'waist', band: undefined, tone: b.overstretched ? 'strain' : b.dropCm > 0 ? 'room' : 'even', text: `Stretch waistband (${src}: relaxed ${b.relaxedCm} cm, stretches to ${b.stretchedCm} cm): ${where}.` };
}

/**
 * A bottom with a stretch waistband: shown at the height the garment was reconstructed at, every size. Its elastic holds it,
 * and how much a larger size gathers (or a smaller one stretches) depends on the band's relaxed girth, which the bundle does
 * not measure; so the sizes differ in the viewer only by their graded girths below the band (folded by the drape).
 */
export const STRETCH_BAND_LINE: FitLine = { anchor: 'waist', band: undefined, tone: 'even', text: 'Stretch waistband: shown where it was made to sit in every size; how much it gathers or stretches on this body is not modelled (the relaxed band is not measured).' };

/** The text line for a waistband that slid (`slideWaistband`), else none. */
export function bandLines(band: BandSlide | null): FitLine[] {
  if (!band || band.dropCm <= 0) return [];
  const loose = Math.round((band.bandGirthCm - band.bodyAtBandCm) * 10) / 10;
  const text = band.pastHips
    ? `The waistband is ${loose} cm larger than the body where it was made to sit and larger than the hips: it slides ${band.dropCm} cm down to the hips and would not stay up.`
    : `The waistband is ${loose} cm larger than the body where it was made to sit: it slides ${band.dropCm} cm down, to where the body fills it.`;
  return [{ anchor: 'waist', band: undefined, tone: 'room', text }];
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

/** A waistband counts as held where the body's girth (plus the clearance) is within this of the band's girth, cm. */
export const BAND_HOLD_CM = 1;
/** How far down a loose waistband is followed at most, cm. */
export const BAND_SEARCH_CM = 30;

export interface BandSlide {
  /** Girth of the band (convex hull of the top 2 cm of the garment's body chain as placed), cm. */
  bandGirthCm: number;
  /** The avatar's torso girth (plus the clearance) where the band was placed, and where it rests, cm. */
  bodyAtBandCm: number;
  bodyAtRestCm: number;
  /** How far the garment was lowered, cm (0 when the body fills the band where it is). */
  dropCm: number;
  /** No height down to `BAND_SEARCH_CM` fills the band: lowered to the widest torso girth found (the hips), and it would slide further. */
  pastHips: boolean;
}

const ellipsePerimeter = (a: number, b: number): number => Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));

/**
 * A bottom without a stretch waistband hangs from its band, and the band is graded with the chart (`hip-delta` for a skirt worn below the waist
 * ring): a band larger than the body where the garment was reconstructed cannot stay there, it slides down until the body
 * fills it. Before this the band was pinned where the base size sat on the canonical mannequin, so every size hung from the
 * same height and the drape folded the extra girth of the larger sizes away (run 17d skirt on M: graded hip 97.6 to 117.7 cm
 * across AU 8 to 16, draped 102 to 107.4). Here: the band's girth against the avatar's torso girth (`BodyField` ellipses,
 * plus the clearance) from the band down: the garment is lowered to the first height where the body's girth reaches the
 * band's less `BAND_HOLD_CM`. A band smaller than the body stays (stretched over it: the fit lines and the map say tight).
 * Mutates `start` (all particles move down together); returns what it did.
 */
export function slideWaistband(field: BodyField, start: Float32Array, chains: ChainAssignment, clearanceCm: number): BandSlide {
  let top = -Infinity;
  for (let i = 0; i < chains.length; i++) if (chains[i] === 0) top = Math.max(top, start[3 * i + 1]!);
  const yb = top - 2;
  const pts: [number, number][] = [];
  for (let i = 0; i < chains.length; i++) if (chains[i] === 0 && start[3 * i + 1]! >= yb) pts.push([start[3 * i]!, start[3 * i + 2]!]);
  const band = hullPerimeter(pts);
  const e = new Float32Array(4);
  const body = (y: number): number => (sample(field.torso, y, e) ? ellipsePerimeter(e[2]! + clearanceCm, e[3]! + clearanceCm) : NaN);
  const at = body(yb);
  let drop = 0, rest = at, pastHips = false;
  if (Number.isFinite(at) && band > at + BAND_HOLD_CM) {
    let best = -Infinity, bestY = yb;
    let found = false;
    for (let y = yb; y >= yb - BAND_SEARCH_CM; y -= 0.25) {
      const g = body(y);
      if (!Number.isFinite(g)) break;
      if (g > best) { best = g; bestY = y; }
      if (g + BAND_HOLD_CM >= band) { drop = yb - y; rest = g; found = true; break; }
    }
    if (!found) { drop = yb - bestY; rest = best; pastHips = true; }
    for (let i = 0; i < chains.length; i++) start[3 * i + 1] = start[3 * i + 1]! - drop;
  }
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  return { bandGirthCm: r1(band), bodyAtBandCm: r1(at), bodyAtRestCm: r1(rest), dropCm: r1(drop), pastHips };
}

/** Perimeter of the convex hull of 2D points. */
export function hullPerimeter(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: [number, number], a: [number, number], b: [number, number]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2]!, lo[lo.length - 1]!, q) <= 0) lo.pop(); lo.push(q); }
  for (let k = p.length - 1; k >= 0; k--) { const q = p[k]!; while (up.length >= 2 && cr(up[up.length - 2]!, up[up.length - 1]!, q) <= 0) up.pop(); up.push(q); }
  const h = [...lo.slice(0, -1), ...up.slice(0, -1)];
  let per = 0;
  for (let i = 0; i < h.length; i++) { const a = h[i]!, b = h[(i + 1) % h.length]!; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return per;
}

/** Collision clearance between cloth and avatar, cm. */
export const CLEARANCE_CM = 0.35;

/** Steps 1–3 of §Fitting, and the cloth ready for step 4. */
export function prepareFit(session: GarmentSession, avatar: Avatar, field: BodyField, fit: FitResult, size: string, material: ViewerMaterial, durationS = 1.5, options: DrapeOptions = DEFAULT_DRAPE): FitInstance {
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
  const bottom = session.bundle.anchors.category === 'bottom';
  // A stretch waistband (the payload's stretch zones) is held by its elastic: how far it gathers depends on its relaxed
  // girth, which no bundle measures, so it is not slid (the fit lines say so). Only a band without stretch slides.
  const stretchBand = (session.payload.stretchZones ?? []).includes('waistband');
  // With a band spec (`WaistbandSpec`), every bottom's band is modelled from it instead.
  const elastic = bottom && options.waistband ? fitElasticBand(field, start, chains, CLEARANCE_CM, bandFor(options.waistband, session.bundle.grading, size), options.waistband.assumed) : null;
  const band = elastic ?? (bottom && !stretchBand ? slideWaistband(field, start, chains, CLEARANCE_CM) : null);
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
  const loops = options.loopRetain > 0 ? anchorLoops(m, graded.positions, graded.indices, chains, pinned, options.loopRetain, options.loopRings) : [];
  setLoops(cloth, loops);
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
    lines: [...fitLines(gaps, placement, session.bundle.qa.chartAgreement.missing ?? []), ...(elastic ? [elasticBandLine(elastic)] : [...bandLines(band), ...(bottom && stretchBand ? [STRETCH_BAND_LINE] : [])])],
    band,
    options,
    loops: loops.map((l) => ({ ring: l.ring, minGirthCm: Math.round(l.minGirthCm * 10) / 10, particles: l.particles.length })),
    heat: heatField(gaps, m.morphHeights),
    material,
    params: clothParams(material, durationS, { cling: options.cling }),
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
