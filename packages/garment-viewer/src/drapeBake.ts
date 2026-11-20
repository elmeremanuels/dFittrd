/**
 * A drape bake (docs/research/step3-serverdrape-spike.md §10, route R2): the garment draped on the SERVER, per size, on
 * a few chart bodies along one axis of the size chart, packed into base.glb. The device does not drape: it blends the
 * drapes of the selected size to the shopper's place on the axis (piecewise linear between the two nearest chart
 * bodies, held at the ends) and pushes the few particles the blend leaves inside the drawn body back out.
 *
 * File: base.glb is a glTF 2.0 with one mesh per size. Its POSITION is the drape on the size's base body (t = 0) and
 * its morph targets are the drapes on the other chart bodies minus that base, all int16 on a `quantStepCm` grid through
 * the node's scale and translation (KHR_mesh_quantization), every buffer view compressed with EXT_meshopt_compression.
 * `asset.extras.curtainBake` (`DrapeBakeMeta`) names the bodies, the axis, the colour and what each size rests on.
 * There are no normals (the figure computes them) and no texture: the garment is drawn in one plain colour.
 *
 * Everything here runs on the device; nothing is sent (D3). Pure: the file reader, with the meshopt decoder
 * (WebAssembly, about 17 KB gzip), is `drapeBakeRead.ts`, which `bundle.ts` loads by `import()` only for a bake.
 */

export const DRAPE_BAKE_FORMAT = 'curtain.garment.drapeBake';

/** Where a size's garment measurements come from: the shop's tape, or interpolated / extrapolated from it. */
export type SizeProvenance = 'measured' | 'interpolated' | 'extrapolated';

export interface DrapeBakeSizeMeta {
  size: string;
  /** Axis value of the base body (the mesh's own POSITION). */
  baseT: number;
  /** Axis values of the morph targets, in target order. */
  targetT: number[];
  provenance: SizeProvenance;
  /**
   * Chart bodies this size was not draped on, and why, in plain words. `rule: 'pull-on'`: the band, at its full stretch
   * on the tape, cannot be pulled over the widest part of that drawn body below the waist (the fit engine's
   * `pullOnCheck` against `widestBelowWaistCm` of `bodyGirth.ts`); the import's bake check recomputes it and refuses a
   * pull-on refusal that does not hold. Absent: another reason (for example the wear rule cannot hold the band at the
   * assumed level), which the check can only require to be stated.
   */
  notDraped?: DrapeBakeRefusal[];
  /**
   * Whether each drape of this size came to rest, one per body (`baseT` and `targetT`), from the simulation's own
   * movement trace. Read by the import's bake check (`bakeGate.ts`), not by the viewer.
   */
  drapes?: { t: number; atRest: boolean; maxMoveCmPerFrame: number; meanMoveCmPerFrame: number }[];
}

/** One body a size was not draped on (`DrapeBakeSizeMeta.notDraped`). */
export interface DrapeBakeRefusal {
  t: number;
  reason: string;
  rule?: 'pull-on';
}

/** The drawn body (`buildAvatar` girths, cm) a set of drapes was made on, at axis value `t`. */
export interface DrapeBakeBody {
  t: number;
  bust: number;
  waist: number;
  hip: number;
}

/** A ring of particles of the shared garment mesh: `count` vertices from `start`, in order around the garment. */
export interface DrapeBakeRing {
  start: number;
  count: number;
}

export interface DrapeBakeMeta {
  format: typeof DRAPE_BAKE_FORMAT;
  formatVersion: 1;
  /** The shopper's axis value: t = (hip − hipAtZero) / hipPerUnit (the chart's hip line). */
  axis: { measure: 'hip'; hipAtZero: number; hipPerUnit: number; label: string };
  quantStepCm: number;
  /** The garment is drawn in this one colour; the product's print is not shown. */
  plainColourHex: string;
  plainColourSource: string;
  sizes: DrapeBakeSizeMeta[];
  /** Free text: how the drapes were made (shown to developers, not to shoppers). */
  source: string;
  /** The drawn bodies of the axis (read by the import's bake check: it rebuilds them to look for fabric inside). */
  bodies?: DrapeBakeBody[];
  /** The garment's hip-line ring (the tape's hip, C) and its hem ring (D), for the bake check's ring lengths. */
  tapeRings?: { hip: DrapeBakeRing; hem: DrapeBakeRing };
}

export interface BakedSize extends DrapeBakeSizeMeta {
  /** Base drape, cm, mannequin frame. */
  base: Float32Array;
  /** Morph targets (drape − base), cm, in `targetT` order. */
  targets: Float32Array[];
}

export interface DrapeBake {
  meta: DrapeBakeMeta;
  indices: Uint32Array;
  vertexCount: number;
  sizes: Map<string, BakedSize>;
}

/** The bake's metadata, or null when base.glb is an ordinary garment file. Throws on a bake it cannot read. */
export function drapeBakeMetaOf(json: { asset?: { extras?: { curtainBake?: unknown } } }): DrapeBakeMeta | null {
  const m = json.asset?.extras?.curtainBake as Partial<DrapeBakeMeta> | undefined;
  if (!m) return null;
  if (m.format !== DRAPE_BAKE_FORMAT || m.formatVersion !== 1) throw new Error(`drape bake: unsupported format ${String(m.format)} ${String(m.formatVersion)}`);
  if (!Array.isArray(m.sizes) || m.sizes.length === 0 || !m.axis || !(Number(m.quantStepCm) > 0) || typeof m.plainColourHex !== 'string') throw new Error('drape bake: incomplete metadata');
  // A zero or non-finite axis would put every shopper at t = NaN: no weights, and the base drape shown as if it were theirs.
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (m.axis.measure !== 'hip' || !finite(m.axis.hipAtZero) || !finite(m.axis.hipPerUnit) || m.axis.hipPerUnit === 0) throw new Error('drape bake: the axis must be hip with a finite, non-zero step');
  for (const s of m.sizes as unknown[]) {
    const z = (s ?? {}) as Partial<DrapeBakeSizeMeta>;
    if (typeof z.size !== 'string' || !finite(z.baseT) || !Array.isArray(z.targetT) || !z.targetT.every(finite)) throw new Error('drape bake: a size has no finite body axis values');
    if (new Set([z.baseT, ...z.targetT]).size !== z.targetT.length + 1) throw new Error(`drape bake: size ${z.size} lists a body twice`);
    if (z.provenance !== 'measured' && z.provenance !== 'interpolated' && z.provenance !== 'extrapolated') throw new Error(`drape bake: size ${z.size} has no provenance`);
    if (z.notDraped !== undefined && (!Array.isArray(z.notDraped) || !z.notDraped.every((n) => !!n && finite(n.t) && typeof n.reason === 'string' && (n.rule === undefined || n.rule === 'pull-on')))) throw new Error(`drape bake: size ${z.size} has a malformed notDraped`);
  }
  return m as DrapeBakeMeta;
}

/** The shopper's axis value from the hip girth (cm), not clamped. */
export function bakeAxis(meta: Pick<DrapeBakeMeta, 'axis'>, hipCm: number): number {
  return (hipCm - meta.axis.hipAtZero) / meta.axis.hipPerUnit;
}

/**
 * Morph weights of a size at axis value t: piecewise linear between the two nearest chart bodies (base and targets
 * together), held at the outermost body beyond the ends (no extrapolation). Returned in target order; the base body
 * gets 1 − Σ.
 */
export function bakeWeights(size: Pick<DrapeBakeSizeMeta, 'baseT' | 'targetT'>, t: number): { weights: number[]; clamped: boolean } {
  if (!Number.isFinite(t)) throw new RangeError('drape bake: the axis value is not a number');
  const nodes = [size.baseT, ...size.targetT];
  const order = nodes.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const lo = order[0]![0], hi = order[order.length - 1]![0];
  const c = Math.min(hi, Math.max(lo, t));
  const w = new Array<number>(nodes.length).fill(0);
  if (order.length === 1) w[0] = 1;
  else
    for (let k = 0; k + 1 < order.length; k++) {
      const [a, ia] = order[k]!, [b, ib] = order[k + 1]!;
      if (c >= a && c <= b) {
        const f = b > a ? (c - a) / (b - a) : 0;
        w[ia] = 1 - f;
        w[ib] = f;
        break;
      }
    }
  return { weights: w.slice(1), clamped: t < lo - 1e-9 || t > hi + 1e-9 };
}

/**
 * Where the shopper lies for one size, against the bodies it was draped on and the ones it was not (`notDraped`):
 * - `within`: between two draped bodies (blended);
 * - `held`: beyond the outermost draped body, with no refused body further out (shown on the outermost one);
 * - `between`: beyond the outermost draped body but short of a body the size was not draped on (shown on the
 *   outermost one; the bake declares the next body out `notDraped`, with its reason);
 * - `refused`: at or beyond a body the size was not draped on. The bake's verdict is that it cannot be worn there (on
 *   the POM bake: its band cannot be pulled over that body), so the device does not draw it on the shopper
 *   (`refusedT`: that body; `refusedRule`: that body's `notDraped` rule, null when it has none).
 */
export type BakePlace = 'within' | 'held' | 'between' | 'refused';

export function bakePlace(size: Pick<DrapeBakeSizeMeta, 'baseT' | 'targetT' | 'notDraped'>, t: number): { weights: number[]; place: BakePlace; refusedT: number | null; refusedRule: 'pull-on' | null } {
  const { weights, clamped } = bakeWeights(size, t);
  if (!clamped) return { weights, place: 'within', refusedT: null, refusedRule: null };
  const nodes = [size.baseT, ...size.targetT];
  const above = t > Math.max(...nodes);
  const edge = above ? Math.max(...nodes) : Math.min(...nodes);
  const out = (size.notDraped ?? []).map((n) => n.t).filter((nt) => (above ? nt > edge : nt < edge));
  if (out.length === 0) return { weights, place: 'held', refusedT: null, refusedRule: null };
  const nearest = above ? Math.min(...out) : Math.max(...out);
  const reached = above ? t >= nearest - 1e-9 : t <= nearest + 1e-9;
  const rule = (size.notDraped ?? []).find((n) => n.t === nearest)?.rule ?? null;
  return { weights, place: reached ? 'refused' : 'between', refusedT: nearest, refusedRule: rule };
}

/** base + Σ w_k · target_k: the blended drape, cm. */
export function blendBakedSize(size: Pick<BakedSize, 'base' | 'targets'>, weights: readonly number[]): Float32Array {
  const out = Float32Array.from(size.base);
  if (size.targets.some((tg) => tg.length !== out.length)) throw new Error('drape bake: a morph target differs in vertex count from its base');
  size.targets.forEach((tg, k) => {
    const w = weights[k] ?? 0;
    if (w === 0) return;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + w * tg[i]!;
  });
  return out;
}

/**
 * The device's last step: particles of a blended drape that lie inside the drawn body (`collide`, the drape's collider
 * with its clearance) are moved out, and a hem below the soles is laid on the floor, as the collider does in an
 * on-device drape. Projection only: nothing else moves. Counts are what the estimate rests on (reported, not shown).
 */
export function settleOnBody(pos: Float32Array, collide: (pos: Float32Array, i: number) => boolean, floorCm = 0): { body: number; floor: number; maxBodyCm: number } {
  let body = 0, floor = 0, maxBodyCm = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[3 * i]!, y = pos[3 * i + 1]!, z = pos[3 * i + 2]!;
    if (!collide(pos, i)) continue;
    if (y < floorCm) floor++;
    const dh = Math.hypot(pos[3 * i]! - x, pos[3 * i + 2]! - z);
    if (dh > 1e-6) {
      body++;
      maxBodyCm = Math.max(maxBodyCm, dh);
    }
  }
  return { body, floor, maxBodyCm };
}
