/**
 * The import's automatic check of a server drape bake (docs/research/step3-serverdrape-spike.md §10; the
 * `tape_built_no_chart_check` flag it replaces). A bake is built from the shop's tape, so there is no size chart to
 * compare it with; what can be tested, without a person, is whether the bake agrees with its own stated tape and with
 * the body the phone draws. Every check reads only the bundle's files and the bodies the bake names:
 *
 *   readable            base.glb decodes as a bake, and the bundle states its tape (qa.json `tape`), its hip-line and
 *                       hem rings and its drawn bodies (base.glb `curtainBake.tapeRings` / `bodies`);
 *   file_size           the five files fit the phone download budget (`MAX_GARMENT_BUNDLE_BYTES`);
 *   sizes_have_geometry the graded sizes, the bake's sizes and the tape's sizes are the same list, and every drape is
 *                       finite and as long as its tape length says (at least half of it hangs below the band);
 *   refusals_declared   every drawn body beyond a size's draped range is declared not draped, with a reason, and no
 *                       declared refusal sits between two drapes of the same size (the blend would draw through it);
 *   provenance          per size, measured / interpolated / extrapolated is the same in the tape, grading.json and the
 *                       bake, agrees with where each tape number came from, and an interpolated size lies between two
 *                       measured ones (extrapolated: outside them);
 *   at_rest             every drape carries its at-rest flag and movement, and both are within `BAKE_CHECK_LIMITS`;
 *   tape_rings          on every drape, the path length of the hip-line ring and of the hem ring is the tape's hip
 *                       (C) and hem (D) of that size within `bakeRingToleranceCm`;
 *   inside_body         no particle of any drape lies deeper than `insideToleranceCm` inside the drawn body it was
 *                       draped on (the device's own avatar and collider, rebuilt from the bake's stated girths);
 *   size_order          where the tape grows from one size to the next, the draped ring does not shrink by more than
 *                       `orderNoiseCm` on any body both sizes were draped on.
 *
 * What it does not test: the look of the drape, folds, the floor, the band level (an assumption of the builder, stated
 * in the bake's `source`), or how good the device's blend between bodies is (§10.3). Those still want a person, and the
 * merchant still approves every asset (D13). Server and test side only: not exported from the package index, so the
 * embed's viewer chunk never carries it. Pure apart from the meshopt decoder's WebAssembly; no network, no shopper data.
 */
import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, familyShape } from '@curtain/mannequin';
import { BAKE_CHECK_IDS, BAKE_CHECK_LIMITS, bakeRingToleranceCm, MAX_GARMENT_BUNDLE_BYTES, type BakeCheckId, type BakeCheckReport, type BakeCheckResult, type BakeDrapeReading, type BakeTapeSize, type TapeProvenance } from '@curtain/schema';
import { bodyField, buildAvatar, mannequinMeasurements, sanitiseMeasurements } from './body';
import { makeCollider } from './collide';
import { type DrapeBake, type DrapeBakeBody, type DrapeBakeRing } from './drapeBake';
import { readDrapeBake } from './drapeBakeRead';

export interface BakeGateInput {
  /** base.glb bytes. */
  glb: Uint8Array;
  anchors: { mannequin?: { family?: unknown } } & Record<string, unknown>;
  grading: { sizes?: unknown } & Record<string, unknown>;
  qa: { tape?: unknown } & Record<string, unknown>;
  /** Total bytes of the five bundle files. */
  bytes: number;
  now?: Date;
}

/** One tape number as the bundle states it (rest.json of `pom_rest.py`). */
interface TapeValue { cm: number; source: TapeProvenance }
interface TapeSize { size: string; provenance: TapeProvenance; tape: Record<'relaxedGirthCm' | 'stretchedGirthCm' | 'hipCm' | 'hemSweepCm' | 'lengthCm', TapeValue> }
interface Tape { hipBelowBandCm: number | null; sizes: TapeSize[] }

const TAPE_KEYS = ['relaxedGirthCm', 'stretchedGirthCm', 'hipCm', 'hemSweepCm', 'lengthCm'] as const;
const PROVENANCES: readonly TapeProvenance[] = ['measured', 'interpolated', 'extrapolated'];
const MAX_REASONS = 12;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (x: number): number => Math.round(x * 10) / 10;
const cm = (x: number): string => `${r1(x)} cm`;

/** qa.json `tape`, or a reason it cannot be used. */
function tapeOf(raw: unknown): Tape | string {
  if (!raw || typeof raw !== 'object') return 'qa.json states no tape (`tape`): a tape-built bake must carry the tape it was built from';
  const t = raw as { hipBelowBandCm?: unknown; sizes?: unknown };
  if (t.hipBelowBandCm !== null && t.hipBelowBandCm !== undefined && !(finite(t.hipBelowBandCm) && t.hipBelowBandCm > 0)) return 'the tape’s hip distance below the band is not a positive number';
  if (!Array.isArray(t.sizes) || t.sizes.length === 0) return 'the tape lists no sizes';
  const sizes: TapeSize[] = [];
  for (const s of t.sizes as unknown[]) {
    const z = (s ?? {}) as { size?: unknown; provenance?: unknown; tape?: Record<string, unknown> };
    if (typeof z.size !== 'string' || z.size === '') return 'a tape size has no label';
    if (!PROVENANCES.includes(z.provenance as TapeProvenance)) return `size ${z.size} of the tape has no provenance (measured, interpolated or extrapolated)`;
    const tape = {} as TapeSize['tape'];
    for (const k of TAPE_KEYS) {
      const v = (z.tape?.[k] ?? null) as { cm?: unknown; source?: unknown } | null;
      if (!v || !finite(v.cm) || v.cm <= 0 || !PROVENANCES.includes(v.source as TapeProvenance)) return `size ${z.size} of the tape has no usable ${k} (a positive number with its source)`;
      tape[k] = { cm: v.cm, source: v.source as TapeProvenance };
    }
    sizes.push({ size: z.size, provenance: z.provenance as TapeProvenance, tape });
  }
  return { hipBelowBandCm: finite(t.hipBelowBandCm) ? t.hipBelowBandCm : null, sizes };
}

/** Path length of a closed ring of particles (3D). */
export function ringLength(pos: Float32Array, ring: DrapeBakeRing): number {
  let s = 0;
  for (let k = 0; k < ring.count; k++) {
    const a = 3 * (ring.start + k), b = 3 * (ring.start + ((k + 1) % ring.count));
    s += Math.hypot(pos[a]! - pos[b]!, pos[a + 1]! - pos[b + 1]!, pos[a + 2]! - pos[b + 2]!);
  }
  return s;
}

/** The drawn body's collision field, as the embed builds it for an untyped body (mount.ts `planAvatar`). */
function bodyFieldFor(family: 'female' | 'male', body: DrapeBakeBody) {
  const m = buildMannequin(family === 'male' ? familyShape('male')! : bodyShape(BASE_SHAPE_ID));
  const meas = sanitiseMeasurements({ bust: body.bust, waist: body.waist, hip: body.hip }, mannequinMeasurements(m));
  const avatar = buildAvatar(m, buildMannequinMesh(m, { head: 'neutral' }), meas);
  return { field: bodyField(m, avatar), meas };
}

/** Particles deeper than `tolCm` inside the body (moved out by the collider with no clearance), and the deepest, cm. */
function insideBody(pos: Float32Array, collide: (pos: Float32Array, i: number) => boolean, tolCm: number): { count: number; maxCm: number } {
  const copy = Float32Array.from(pos);
  let count = 0, maxCm = 0;
  for (let i = 0; i < copy.length / 3; i++) {
    const x = copy[3 * i]!, z = copy[3 * i + 2]!;
    if (!collide(copy, i)) continue;
    const d = Math.hypot(copy[3 * i]! - x, copy[3 * i + 2]! - z);
    if (d > tolCm) count++;
    maxCm = Math.max(maxCm, d);
  }
  return { count, maxCm };
}

/**
 * The bake check: every check of the module comment, in order, with English reasons. `pass` only when every check ran
 * and passed. A check that needs an earlier one that failed is reported as not run (`pass: null`).
 */
export async function checkDrapeBake(input: BakeGateInput): Promise<BakeCheckReport> {
  const results = new Map<BakeCheckId, BakeCheckResult>();
  const put = (id: BakeCheckId, reasons: string[]): void => {
    results.set(id, { id, pass: reasons.length === 0, reasons: reasons.slice(0, MAX_REASONS) });
  };
  const report = (tapeSummary: BakeCheckReport['tape'], drapes: BakeDrapeReading[]): BakeCheckReport => {
    const checks = BAKE_CHECK_IDS.map((id) => results.get(id) ?? { id, pass: null, reasons: ['not run: an earlier check failed'] });
    return { format: 'curtain.garment.bakeCheck', version: 1, pass: checks.every((c) => c.pass === true), checks, tape: tapeSummary, drapes, checkedAt: (input.now ?? new Date()).toISOString() };
  };

  // ---- file_size: needs nothing else. ----
  put('file_size', !finite(input.bytes) || input.bytes > MAX_GARMENT_BUNDLE_BYTES ? [`the bundle is ${finite(input.bytes) ? `${(input.bytes / 1048576).toFixed(2)} MB` : 'of unknown size'}; a phone downloads at most ${MAX_GARMENT_BUNDLE_BYTES / 1048576} MB`] : []);

  // ---- readable ----
  const readable: string[] = [];
  let bake: DrapeBake | null = null;
  try {
    bake = await readDrapeBake(input.glb);
  } catch (e) {
    readable.push(`base.glb is not a readable drape bake (${e instanceof Error ? e.message : String(e)})`);
  }
  const tape = tapeOf(input.qa.tape);
  if (typeof tape === 'string') readable.push(tape);
  const meta = bake?.meta;
  const rings = meta?.tapeRings;
  const bodies = meta?.bodies;
  if (bake && meta) {
    const ringOk = (r: DrapeBakeRing | undefined): boolean => !!r && Number.isInteger(r.start) && Number.isInteger(r.count) && r.start >= 0 && r.count >= 3 && r.start + r.count <= bake!.vertexCount;
    if (!rings || !ringOk(rings.hip) || !ringOk(rings.hem)) readable.push('the bake does not name its hip-line and hem rings (`tapeRings`) inside its mesh');
    if (!Array.isArray(bodies) || bodies.length === 0 || !bodies.every((b) => b && finite(b.t) && finite(b.bust) && finite(b.waist) && finite(b.hip))) readable.push('the bake does not name the drawn bodies it was draped on (`bodies`: axis value, bust, waist, hip)');
    else {
      if (new Set(bodies.map((b) => b.t)).size !== bodies.length) readable.push('the bake names one body twice');
      for (const b of bodies) {
        const want = meta.axis.hipAtZero + meta.axis.hipPerUnit * b.t;
        if (Math.abs(b.hip - want) > BAKE_CHECK_LIMITS.bodyAxisCm) readable.push(`the body at axis value ${b.t} has ${cm(b.hip)} hips, but the bake’s axis puts ${cm(want)} there`);
      }
    }
  }
  put('readable', readable);
  if (readable.length > 0 || !bake || !meta || !rings || !bodies || typeof tape === 'string') {
    return report(typeof tape === 'string' ? null : { hipBelowBandCm: tape.hipBelowBandCm, sizes: tape.sizes.map((s) => tapeSummary(s, null, null)) }, []);
  }
  const bodyAt = new Map(bodies.map((b) => [b.t, b]));
  const hipOf = (t: number): number => bodyAt.get(t)?.hip ?? meta.axis.hipAtZero + meta.axis.hipPerUnit * t;
  const tapeSizes = tape.sizes;

  // ---- sizes_have_geometry ----
  const geometry: string[] = [];
  const graded = Array.isArray(input.grading.sizes) ? (input.grading.sizes as { size?: unknown; provenance?: unknown }[]) : [];
  const gradedSizes = graded.map((g) => String(g?.size ?? ''));
  const bakeSizes = meta.sizes.map((s) => s.size);
  const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
  if (!same(gradedSizes, bakeSizes)) geometry.push(`grading.json grades ${gradedSizes.join(', ') || 'no size'}, the bake draped ${bakeSizes.join(', ')}`);
  if (!same(tapeSizes.map((s) => s.size), bakeSizes)) geometry.push(`the tape lists ${tapeSizes.map((s) => s.size).join(', ')}, the bake draped ${bakeSizes.join(', ')}`);
  const drapesOf = (size: string): { t: number; pos: Float32Array }[] => {
    const b = bake!.sizes.get(size);
    if (!b) return [];
    return [{ t: b.baseT, pos: b.base }, ...b.targetT.map((t, k) => {
      const pos = Float32Array.from(b.base);
      const d = b.targets[k]!;
      for (let i = 0; i < pos.length; i++) pos[i]! += d[i]!;
      return { t, pos };
    })];
  };
  for (const s of meta.sizes) {
    const ts = tapeSizes.find((x) => x.size === s.size);
    for (const d of drapesOf(s.size)) {
      let lo = Infinity, hi = -Infinity, bad = false;
      for (let i = 0; i < d.pos.length; i++) {
        if (!Number.isFinite(d.pos[i]!)) bad = true;
        if (i % 3 === 1) { lo = Math.min(lo, d.pos[i]!); hi = Math.max(hi, d.pos[i]!); }
      }
      if (bad) geometry.push(`size ${s.size} on the body with ${cm(hipOf(d.t))} hips has positions that are not numbers`);
      else if (ts && hi - lo < 0.5 * ts.tape.lengthCm.cm) geometry.push(`size ${s.size} on the body with ${cm(hipOf(d.t))} hips is ${cm(hi - lo)} tall; the tape says the garment is ${cm(ts.tape.lengthCm.cm)} long`);
    }
  }
  put('sizes_have_geometry', geometry);

  // ---- refusals_declared ----
  const refusals: string[] = [];
  const allT = [...bodyAt.keys()].sort((a, b) => a - b);
  for (const s of meta.sizes) {
    const draped = [s.baseT, ...s.targetT];
    const refused = s.notDraped ?? [];
    for (const t of draped) if (!bodyAt.has(t)) refusals.push(`size ${s.size} is draped on axis value ${t}, which is not one of the bake’s bodies`);
    for (const n of refused) {
      if (!bodyAt.has(n.t)) refusals.push(`size ${s.size} declares a refusal on axis value ${n.t}, which is not one of the bake’s bodies`);
      if (draped.includes(n.t)) refusals.push(`size ${s.size} is both draped and refused on the body with ${cm(hipOf(n.t))} hips`);
      if (n.reason.trim() === '') refusals.push(`size ${s.size} is refused on the body with ${cm(hipOf(n.t))} hips without a reason`);
      if (n.t > Math.min(...draped) && n.t < Math.max(...draped)) refusals.push(`size ${s.size} is refused on the body with ${cm(hipOf(n.t))} hips but drawn on bodies either side of it, so the phone would blend through the refusal`);
    }
    // A body inside the size's draped range needs no drape (the phone blends across it); one outside it must be
    // declared, or a shopper there would see the outermost drape with no word on why the size stops.
    const missing = allT.filter((t) => (t < Math.min(...draped) || t > Math.max(...draped)) && !refused.some((n) => n.t === t));
    for (const t of missing) refusals.push(`size ${s.size} has no drape on the body with ${cm(hipOf(t))} hips and does not say why`);
  }
  put('refusals_declared', refusals);

  // ---- provenance ----
  const prov: string[] = [];
  const rank = (p: TapeProvenance): number => PROVENANCES.indexOf(p);
  const measuredIdx = tapeSizes.map((s, i) => (s.provenance === 'measured' ? i : -1)).filter((i) => i >= 0);
  if (measuredIdx.length < 2 && tapeSizes.some((s) => s.provenance !== 'measured')) prov.push(`only ${measuredIdx.length} size${measuredIdx.length === 1 ? ' is' : 's are'} measured; at least two are needed to estimate the others`);
  tapeSizes.forEach((s, i) => {
    const worst = PROVENANCES[Math.max(...TAPE_KEYS.map((k) => rank(s.tape[k].source)))]!;
    if (worst !== s.provenance) prov.push(`size ${s.size} is called ${s.provenance} but its tape numbers are ${worst}`);
    if (s.provenance === 'interpolated' && !(measuredIdx.some((m) => m < i) && measuredIdx.some((m) => m > i))) prov.push(`size ${s.size} is called interpolated but does not lie between two measured sizes`);
    if (s.provenance === 'extrapolated' && measuredIdx.some((m) => m < i) && measuredIdx.some((m) => m > i)) prov.push(`size ${s.size} is called extrapolated but lies between two measured sizes (it is interpolated)`);
    const b = meta.sizes.find((x) => x.size === s.size);
    if (b && b.provenance !== s.provenance) prov.push(`size ${s.size} is ${s.provenance} on the tape but ${b.provenance} in the bake`);
    const g = graded.find((x) => String(x?.size) === s.size);
    if (g && g.provenance !== s.provenance) prov.push(`size ${s.size} is ${s.provenance} on the tape but ${g.provenance === undefined ? 'has no provenance' : String(g.provenance)} in grading.json`);
  });
  put('provenance', prov);

  // ---- at_rest ----
  const rest: string[] = [];
  const restOf = (size: string, t: number) => meta.sizes.find((x) => x.size === size)?.drapes?.find((d) => d.t === t) ?? null;
  for (const s of meta.sizes) {
    for (const t of [s.baseT, ...s.targetT]) {
      const r = restOf(s.size, t);
      if (!r || typeof r.atRest !== 'boolean' || !finite(r.maxMoveCmPerFrame) || !finite(r.meanMoveCmPerFrame)) rest.push(`size ${s.size} on the body with ${cm(hipOf(t))} hips does not say whether it came to rest`);
      else if (!r.atRest) rest.push(`size ${s.size} on the body with ${cm(hipOf(t))} hips says it did not come to rest`);
      else if (r.maxMoveCmPerFrame > BAKE_CHECK_LIMITS.restMaxCmPerFrame || r.meanMoveCmPerFrame > BAKE_CHECK_LIMITS.restMeanCmPerFrame)
        rest.push(`size ${s.size} on the body with ${cm(hipOf(t))} hips was still moving (${r.maxMoveCmPerFrame} cm per frame at most, ${r.meanMoveCmPerFrame} on average; the limits are ${BAKE_CHECK_LIMITS.restMaxCmPerFrame} and ${BAKE_CHECK_LIMITS.restMeanCmPerFrame})`);
    }
  }
  put('at_rest', rest);

  // ---- tape_rings and inside_body: measured on every drape ----
  const ringMisses: { size: string; name: string; t: number; got: number; want: number }[] = [];
  const insideReasons: string[] = [];
  const readings: BakeDrapeReading[] = [];
  const family = input.anchors.mannequin?.family === 'male' ? 'male' : 'female';
  const colliders = new Map<number, (pos: Float32Array, i: number) => boolean>();
  for (const b of bodies) {
    const { field, meas } = bodyFieldFor(family, b);
    if (Math.abs(meas.hip - b.hip) > 0.01 || Math.abs(meas.waist - b.waist) > 0.01 || Math.abs(meas.bust - b.bust) > 0.01) insideReasons.push(`the body with ${cm(b.hip)} hips is outside the girths the phone can draw`);
    colliders.set(b.t, makeCollider(field, 0));
  }
  for (const s of meta.sizes) {
    const ts = tapeSizes.find((x) => x.size === s.size);
    for (const d of drapesOf(s.size)) {
      const hip = ringLength(d.pos, rings.hip), hem = ringLength(d.pos, rings.hem);
      const collide = colliders.get(d.t);
      const inside = collide ? insideBody(d.pos, collide, BAKE_CHECK_LIMITS.insideToleranceCm) : { count: 0, maxCm: 0 };
      const r = restOf(s.size, d.t);
      readings.push({ size: s.size, t: d.t, bodyHipCm: r1(hipOf(d.t)), hipRingCm: r1(hip), hemRingCm: r1(hem), insideParticles: inside.count, insideMaxCm: Math.round(inside.maxCm * 100) / 100, atRest: r ? r.atRest : null, maxMoveCmPerFrame: r ? r.maxMoveCmPerFrame : null });
      if (ts) {
        for (const [name, got, want] of [['hip-line ring', hip, ts.tape.hipCm.cm], ['hem', hem, ts.tape.hemSweepCm.cm]] as const) {
          if (Math.abs(got - want) > bakeRingToleranceCm(want)) ringMisses.push({ size: s.size, name, t: d.t, got, want });
        }
      }
      if (inside.count > 0) insideReasons.push(`size ${s.size} on the body with ${cm(hipOf(d.t))} hips: ${inside.count} particle${inside.count === 1 ? '' : 's'} inside the drawn body, up to ${cm(inside.maxCm)} deep`);
    }
  }
  const notRun = (id: BakeCheckId): void => void results.set(id, { id, pass: null, reasons: ['not run: a size has no usable geometry'] });
  if (!results.get('sizes_have_geometry')!.pass) {
    notRun('tape_rings');
    notRun('inside_body');
  } else {
    put('tape_rings', ringReasonsOf(ringMisses, meta.sizes, hipOf));
    put('inside_body', insideReasons);
  }

  // ---- size_order: where the tape grows, the drape must not shrink, on every body two neighbouring sizes share ----
  const order: string[] = [];
  for (let i = 0; i + 1 < tapeSizes.length; i++) {
    const a = tapeSizes[i]!, b = tapeSizes[i + 1]!;
    for (const [name, key, ring] of [['hip-line ring', 'hipCm', 'hipRingCm'], ['hem', 'hemSweepCm', 'hemRingCm']] as const) {
      if (!(b.tape[key].cm > a.tape[key].cm)) continue;
      for (const ra of readings.filter((r) => r.size === a.size)) {
        const rb = readings.find((r) => r.size === b.size && r.t === ra.t);
        if (rb && rb[ring] < ra[ring] - BAKE_CHECK_LIMITS.orderNoiseCm)
          order.push(`on the body with ${cm(ra.bodyHipCm)} hips the ${name} of size ${b.size} (${cm(rb[ring])}) is smaller than that of size ${a.size} (${cm(ra[ring])}), but the tape grows from ${cm(a.tape[key].cm)} to ${cm(b.tape[key].cm)}`);
      }
    }
  }
  if (results.get('tape_rings')!.pass === null) notRun('size_order');
  else put('size_order', order);

  return report({ hipBelowBandCm: tape.hipBelowBandCm, sizes: tapeSizes.map((s) => tapeSummary(s, meta.sizes.find((x) => x.size === s.size)?.notDraped ?? null, hipOf)) }, readings);
}

/**
 * One reason per size and ring: a miss on one body names that body; the same miss on every body of the size says so
 * once, with the range of the draped lengths (a wrong tape number or a wrong ring, not a bad drape).
 */
function ringReasonsOf(misses: { size: string; name: string; t: number; got: number; want: number }[], sizes: { size: string; baseT: number; targetT: number[] }[], hipOf: (t: number) => number): string[] {
  const out: string[] = [];
  for (const s of sizes) {
    for (const name of ['hip-line ring', 'hem']) {
      const m = misses.filter((x) => x.size === s.size && x.name === name);
      if (m.length === 0) continue;
      const want = m[0]!.want;
      const tol = `allowed ±${cm(bakeRingToleranceCm(want))}`;
      if (m.length > 1 && m.length === 1 + s.targetT.length) {
        const lo = Math.min(...m.map((x) => x.got)), hi = Math.max(...m.map((x) => x.got));
        out.push(`size ${s.size}: the draped ${name} is ${Math.abs(hi - lo) < 0.05 ? cm(lo) : `${r1(lo)}-${cm(hi)}`} around on every body it was draped on, the tape says ${cm(want)} (${tol})`);
      } else for (const x of m) out.push(`size ${s.size} on the body with ${cm(hipOf(x.t))} hips: the draped ${name} is ${cm(x.got)} around, the tape says ${cm(want)} (${tol})`);
    }
  }
  return out;
}

function tapeSummary(s: TapeSize, notDraped: { t: number; reason: string }[] | null, hipOf: ((t: number) => number) | null): BakeTapeSize {
  return {
    size: s.size,
    provenance: s.provenance,
    hipCm: s.tape.hipCm.cm,
    hemSweepCm: s.tape.hemSweepCm.cm,
    stretchedGirthCm: s.tape.stretchedGirthCm.cm,
    notDraped: (notDraped ?? []).map((n) => ({ bodyHipCm: r1(hipOf ? hipOf(n.t) : n.t), reason: n.reason.slice(0, 200) })),
  };
}
