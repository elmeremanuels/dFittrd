/**
 * The POM tee as a device bundle (men-3d-plan slice M3): the five files of `bundle.ts` (base.glb,
 * anchors.json, grading.json, material.json, qa.json) from a tee's flat measurements, so the
 * existing viewer loads it, grades it and drapes it on the device exactly as it does any bundle.
 *
 * - **Base mesh**: `buildPomTee` of the base size on the canonical body of the product's family (the
 *   male M for a men's tee). Nothing is reconstructed, calibrated or distorted.
 * - **Grading**: the device grades the base mesh with `gradingMorph` (radial about the body axis and
 *   the arm axes, lengths stretched below the hip and along the sleeve). The targets per size are the
 *   tape's differences, not the chart's: torso rings take the base girth plus the difference of the two
 *   sizes' POM girth profiles at the ring's height; the shoulder ring scales by the shoulder ratio
 *   (the shoulder points then land at ±shoulder / 2); the upper-arm ring and both lengths are measured
 *   on every size built on the same body. `compareGrading` measures what the device's morph misses
 *   against each size built directly.
 * - **QA**: no chart agreement was measured (nothing to calibrate); `chartAgreement.kind` is
 *   `tape-built`, so the import flags the asset `tape_built_no_chart_check` and the merchant is told.
 *   What qa.json does report is the builder's own tape against every input measurement, per size
 *   (`pomTape`), the M3 gate (within 0.5 cm).
 */
import { createHash } from 'node:crypto';
import type { AnchorId, AnchorRing, AnchorValues } from '@curtain/anchors';
import type { GarmentPayload } from '@curtain/schema';
import { MALE_REFERENCE, MANNEQUIN_VERSION, buildBody, loopAround, round, roundVec, slice, topology, vertexNormals, writeGlb, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';
import { measureGarment, ringGirths, type AnchorMeasurements } from './anchoring';
import { bundleMannequin, mannequinFor, PIPELINE_VERSION, type Bundle } from './bundle';
import { assignChains } from './garment';
import { applyGrading, encodeBuiltOffsets, type GradingJson, type SizeGrading } from './grading';
import { materialJson } from './product';
import { POM_TEE_ASSUMPTIONS, buildPomTee, measurePomTee, type PomTeeBuild, type PomTeeRow } from './pomTee';
import { writeTexturedGlb } from './glbTextured';
import { encodePng } from './exportPng';
import { PRINT_BACKGROUND, PRINT_LICENCE, PRINT_SOURCE, STRIPE_PERIOD_CM, STRIPE_WIDTH_CM, stripePrint, syntheticFlatLay } from './pomPrint';
import { FLATTEN_ITERATIONS, flatLayPainter, paintAtlas, teeUvLayout, type TeeUvLayout } from './pomUv';
import { hexToRgb } from './raster';
import { densifyLoop, tapeGirth } from './tape';

export const POM_BUILDER_VERSION = 'pom-tee-0.2.0';
/** Atlas size of a printed POM tee, px (square). */
export const POM_ATLAS_PX = 1024;

export interface PomBundleOptions {
  /**
   * `synthetic-print`: base.glb carries UVs per panel (`pomUv.ts`) and an atlas painted with the SYNTHETIC print
   * (`pomPrint.ts`, CC0; front and back through the flat-lay photo projection, sleeves by the repeating print).
   * `plain`: one colour, no UVs (the M3 tee).
   */
  texture?: 'synthetic-print' | 'plain';
  /**
   * The male body shape the tee is built on: `v1` (default) or `v2`. With `v2` the base, every size's tape check and the
   * grading are built on the male shape v2 bodies (their drawn outlines, `pomBody.ts`), and the bundle says so in
   * anchors.json and qa.json (`mannequin.maleShape`): the viewer and the import show it on a v2 body only.
   */
  maleShape?: 'v1' | 'v2';
  /**
   * How the device gets the other sizes. `morph`: `gradingMorph` of the base mesh (radial about the body axis and the arm
   * axes), as every bundle before. `built`: every size is built on its own table body with the base mesh's vertices and
   * shipped as offsets (`GradingJson.built`), so the device shows the size as built. The morph scales the armhole with
   * the shoulders (+7 % at XXL) where the size built on its body has it 40 % deeper front to back and 22 % longer: on its
   * own body the morphed XL and XXL sat 1.2 and 1.6 cm inside the shoulder caps and were lifted 1.25 and 2 cm to clear
   * them. Default: `built` on the male shape v2, `morph` otherwise (the v1 bundle stays byte for byte what it was).
   */
  grading?: 'morph' | 'built';
}
/** Vertex offsets of a built size are stored in units of this, cm. */
export const BUILT_QUANTUM_CM = 0.01;
/** The M3 gate: every input measurement on the built mesh within this of the tape, cm. */
export const POM_TAPE_TOLERANCE_CM = 0.5;

const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
const r2 = (x: number): number => Math.round(x * 100) / 100;

/** Tape girth of the torso where a level plane at height y cuts it (the loop round the body axis; sleeves are other loops). */
export function torsoTapeAt(mesh: Pick<Mesh, 'positions' | 'indices'>, y: number): number | null {
  const loops = slice(mesh.positions, mesh.indices, { origin: [0, y, 0], normal: [0, 1, 0] });
  const l = loopAround(loops, [0, y, 0], [1, 0, 0], [0, 0, 1]);
  if (!l) return null;
  return tapeGirth(densifyLoop(l).points, [0, y, 0], [1, 0, 0], [0, 0, 1])?.girthCm ?? null;
}

export const POM_KEYS = ['chestWidthCm', 'waistWidthCm', 'hemWidthCm', 'shoulderCm', 'lengthCm', 'sleeveLengthCm', 'sleeveOpeningCm'] as const;
export type PomKey = (typeof POM_KEYS)[number];

/** Built minus asked, per input measurement given, cm. */
export function pomErrors(asked: PomTeeRow, got: PomTeeRow): Partial<Record<PomKey, number>> {
  const out: Partial<Record<PomKey, number>> = {};
  for (const k of POM_KEYS) {
    const a = asked[k], g = got[k];
    if (typeof a === 'number' && typeof g === 'number') out[k] = g - a;
  }
  return out;
}

export interface PomSizeCheck {
  size: string;
  /** The body the size was built on for this check: the family's table body of the same label when there is one, else the base. */
  body: string;
  measured: PomTeeRow;
  errorCm: Partial<Record<PomKey, number>>;
  maxAbsCm: number;
  tight: PomTeeBuild['tight'];
}

/** The table body of a family size (male S…XXL), or null. */
function tableBody(family: 'male' | 'female', size: string, maleShape: 'v1' | 'v2'): Mannequin | null {
  if (family !== 'male') return null;
  const t = MALE_TABLE[size];
  return t ? buildBody({ family: 'male', bust: t.chest, waist: t.waist, hip: t.hip, heightCm: t.stature, shoulderCm: t.shoulderWidth }, maleShape === 'v2' ? { maleShape: 'v2' } : {}) : null;
}
const MALE_TABLE = MALE_REFERENCE as Readonly<Record<string, { chest: number; waist: number; hip: number; stature: number; shoulderWidth: number }>>;

export interface PomBundle extends Omit<Bundle, 'calibration' | 'agreement' | 'separation'> {
  base: PomTeeBuild;
  /** Every size built on its own table body and taped (the M3 gate). */
  tape: PomSizeCheck[];
  /** Every size built on the base body, the device's grading of the base against it. */
  grading: GradingJson;
  gradingCheck: GradingCheck[];
}

export interface GradingCheck {
  size: string;
  /** Device grading of the base mesh, taped, minus the tape's value, cm. */
  errorCm: Partial<Record<PomKey, number>>;
}

export function buildPomBundle(productId: string, payload: GarmentPayload, rows: readonly PomTeeRow[], baseSize = 'M', options: PomBundleOptions = {}): PomBundle {
  const texture = options.texture ?? 'plain';
  const maleShape = options.maleShape === 'v2' ? 'v2' : 'v1';
  const m = mannequinFor(payload, { maleShape });
  const meta = bundleMannequin(m);
  const family = m.shape.family === 'male' ? 'male' : 'female';
  const baseIdx = rows.findIndex((r) => r.size === baseSize);
  if (baseIdx < 0) throw new Error(`base size ${baseSize} not in the measurements`);
  const step = (i: number): number => i - baseIdx;

  const builtSizes = (options.grading ?? (maleShape === 'v2' ? 'built' : 'morph')) === 'built' && family === 'male';
  const base = buildPomTee(m, rows[baseIdx]!, { sizeStep: 0, ...(builtSizes ? { uniformRows: true } : {}) });
  const chains = assignChains(m, base.mesh);
  const measurements = pomMeasurements(m, base);

  // The tape on every size, on its own table body (a small size cannot be built on a bigger body: it is tighter than the body).
  const builds: { body: Mannequin; build: PomTeeBuild }[] = [];
  const tape: PomSizeCheck[] = rows.map((row, i) => {
    const body = tableBody(family, row.size, maleShape);
    const b = body ? buildPomTee(body, row, { sizeStep: step(i), ...(builtSizes ? { counts: base.counts } : {}) }) : i === baseIdx ? base : buildPomTee(m, row, { sizeStep: step(i) });
    builds.push({ body: body ?? m, build: b });
    const measured = { ...measurePomTee(body ?? m, b, torsoTapeAt), size: row.size };
    const errorCm = pomErrors(row, measured);
    return { size: row.size, body: `${family} ${body ? row.size : baseSize}${meta.maleShape ? ` (shape ${meta.maleShape})` : ''}`, measured, errorCm, maxAbsCm: Math.max(...Object.values(errorCm).map(Math.abs)), tight: b.tight };
  });

  const grading = gradePom(m, productId, rows, baseIdx, base, measurements);
  // The two length targets are solved against the device's own morph (it stretches the body only
  // below the hip and the sleeve only past the upper-arm ring), so the graded mesh's tape is the tape.
  if (builtSizes) {
    // Every size as built on its own table body, in the base body's space: moved down by the difference of the shoulder
    // ring's height (the lift the viewer adds back on a body of that height, `buildTypedAvatar`).
    const offsets: Record<string, string> = {};
    const bodies: Record<string, string> = {};
    rows.forEach((row, i) => {
      if (i === baseIdx) return;
      const { body, build } = builds[i]!;
      if (body === m || build.mesh.positions.length !== base.mesh.positions.length) throw new Error(`size ${row.size}: no table body, or not the base mesh's vertices`);
      const lift = body.morphHeights.shoulder - m.morphHeights.shoulder;
      const moved = Float64Array.from(build.mesh.positions);
      for (let k = 1; k < moved.length; k += 3) moved[k] = moved[k]! - lift;
      offsets[row.size] = encodeBuiltOffsets(base.mesh.positions, moved, BUILT_QUANTUM_CM);
      bodies[row.size] = tape[i]!.body;
    });
    grading.built = { encoding: 'int16le-base64', quantumCm: BUILT_QUANTUM_CM, vertices: base.mesh.positions.length / 3, bodies, offsets };
  }
  for (const [i, row] of rows.entries()) {
    if (i === baseIdx || builtSizes) continue;
    const entry = grading.sizes[i]!;
    for (let it = 0; it < 4; it++) {
      const got = measurePomTee(m, { ...base, mesh: applyGrading(m, base.mesh, chains, grading, row.size) }, torsoTapeAt);
      const dL = row.lengthCm - got.lengthCm, dS = row.sleeveLengthCm - got.sleeveLengthCm;
      if (Math.abs(dL) < 0.02 && Math.abs(dS) < 0.02) break;
      if (entry.targets.shoulder_to_hem !== undefined) entry.targets.shoulder_to_hem = r2(entry.targets.shoulder_to_hem + dL);
      if (entry.targets.sleeve !== undefined) entry.targets.sleeve = r2(entry.targets.sleeve + dS);
    }
  }
  const gradingCheck: GradingCheck[] = rows.map((row, i) => {
    const graded = applyGrading(m, base.mesh, chains, grading, row.size);
    if (builtSizes && i !== baseIdx) {
      // What the device shows is the built size (decoded from grading.json): taped on its own body, where it was built.
      const { body, build } = builds[i]!;
      const lift = body.morphHeights.shoulder - m.morphHeights.shoulder;
      const back = Float64Array.from(graded.positions);
      for (let k = 1; k < back.length; k += 3) back[k] = back[k]! + lift;
      return { size: row.size, errorCm: pomErrors(row, measurePomTee(body, { ...build, mesh: { ...build.mesh, positions: back } }, torsoTapeAt)) };
    }
    const viaGrading = measurePomTee(m, { ...base, mesh: graded }, torsoTapeAt);
    const errorCm = pomErrors(row, viaGrading);
    return { size: row.size, errorCm };
  });

  const material = materialJson(payload);
  const health = topology(base.mesh);
  const inputHash = createHash('sha256').update(JSON.stringify({ payload, rows, baseSize, texture, builder: POM_BUILDER_VERSION, assumptions: POM_TEE_ASSUMPTIONS, mannequin: MANNEQUIN_VERSION, pipeline: PIPELINE_VERSION, ...(meta.family ? { family: meta.family } : {}), ...(meta.maleShape ? { maleShape: meta.maleShape } : {}) })).digest('hex');
  const chartBase: Partial<Record<AnchorRing, number>> = {};
  const chartRow = payload.sizeChart.find((r) => r.size === baseSize);
  if (chartRow?.bust !== undefined) chartBase.chest = chartRow.bust;
  if (chartRow?.waist !== undefined) chartBase.waist = chartRow.waist;
  if (chartRow?.hip !== undefined) chartBase.hip = chartRow.hip;
  const P = (i: number): Vec3 => [base.mesh.positions[3 * i]!, base.mesh.positions[3 * i + 1]!, base.mesh.positions[3 * i + 2]!];

  const anchors = {
    format: 'curtain.garment.anchors',
    formatVersion: 1,
    productId,
    baseSize,
    category: 'top',
    unit: 'cm',
    mannequin: meta,
    pipelineVersion: PIPELINE_VERSION,
    builder: POM_BUILDER_VERSION,
    inputHash,
    synthetic: true,
    rings: Object.fromEntries(
      Object.entries(measurements.rings).map(([id, r]) => {
        const frame = m.rings.find((x) => x.id === id)!;
        return [id, {
          circumferenceCm: round(r!.circumferenceCm, 2),
          chartCm: chartBase[id as AnchorRing] ?? null,
          offsetCm: r!.offsetCm ? { mean: round(r!.offsetCm.mean, 2), min: round(r!.offsetCm.min, 2), max: round(r!.offsetCm.max, 2) } : null,
          spansBothLegs: r!.spansBothLegs,
          plane: { centre: roundVec(frame.centre, 3), normal: roundVec(frame.normal, 6) },
          loop: r!.loop.map((p) => roundVec(p, 2)),
        }];
      }),
    ),
    // The shoulder points are mesh vertices here (the builder sews the sleeve to them), not notional chart points.
    breadths: { shoulder_width: { widthCm: round(rows[baseIdx]!.shoulderCm, 2), source: 'pom', ring: 'shoulder', seams: base.shoulderPoint.map((i) => roundVec(P(i), 2)) } },
    lengths: Object.fromEntries(Object.entries(measurements.lengths).map(([id, l]) => [id, { lengthCm: round(l!.lengthCm, 2), start: roundVec(l!.start, 2), end: roundVec(l!.end, 2), fromMannequin: l!.fromMannequin }])),
    calibration: { globalScale: 1, ringCorrections: {}, sources: {}, residualAfterGlobalCm: { rms: 0, maxAbs: 0 } },
  };

  const worst = Math.max(...tape.map((t) => t.maxAbsCm));
  const qa: Record<string, unknown> = {
    format: 'curtain.garment.qa',
    formatVersion: 1,
    productId,
    synthetic: true,
    inputHash,
    ...(meta.family ? { mannequin: meta } : {}),
    chartAgreement: {
      kind: 'tape-built',
      pass: true,
      basis: `Built from the flat garment measurements (${POM_BUILDER_VERSION}); nothing was reconstructed, so there is no chart to calibrate against. pomTape below is the builder's own tape of every input measurement on every size, built on the family's table body of that size.`,
      maxAbsCm: null,
      perRingCm: {},
    },
    pomTape: {
      toleranceCm: POM_TAPE_TOLERANCE_CM,
      pass: worst <= POM_TAPE_TOLERANCE_CM,
      maxAbsCm: r2(worst),
      sizes: tape.map((t) => ({ size: t.size, body: t.body, maxAbsCm: r2(t.maxAbsCm), errorCm: Object.fromEntries(Object.entries(t.errorCm).map(([k, v]) => [k, r2(v!)])), ...(t.tight.length ? { tighterThanBody: t.tight } : {}) })),
    },
    gradingCheck: gradingCheck.map((g) => ({ size: g.size, errorCm: Object.fromEntries(Object.entries(g.errorCm).map(([k, v]) => [k, r2(v!)]))})),
    assumptions: POM_TEE_ASSUMPTIONS,
    calibration: { globalScale: 1, residualBeforeCm: { rms: 0, maxAbs: 0 }, residualAfterGlobalCm: { rms: 0, maxAbs: 0 } },
    meshHealth: { triangles: health.triangles, vertices: health.vertices, boundaryEdges: health.boundaryEdges, nonManifoldEdges: health.nonManifoldEdges, inconsistentEdges: health.inconsistentEdges, pieces: 1, triangleBudget: [8000, 15000], withinBudget: health.triangles <= 15000 },
    separation: null,
    gradingEstimates: grading.estimates,
  };

  const layout = texture === 'synthetic-print' ? teeUvLayout(base, POM_ATLAS_PX) : null;
  const glb = layout ? printedGlb(productId, base, layout, { baseSize, inputHash }) : plainGlb(productId, base, payload, { baseSize, inputHash });
  if (layout) qa.texture = textureQa(layout);

  return {
    productId,
    files: { 'base.glb': glb, 'anchors.json': json(anchors), 'grading.json': json(grading), 'material.json': json(material), 'qa.json': json(qa) },
    mannequin: m,
    baseMesh: base.mesh,
    measurements,
    material,
    base,
    tape,
    grading,
    gradingCheck,
  };
}

function plainGlb(productId: string, base: PomTeeBuild, payload: GarmentPayload, extras: { baseSize: string; inputHash: string }): Uint8Array {
  const color = hexToRgb(payload.primaryColorHex ?? '#888888');
  return writeGlb([{ name: productId, positions: base.mesh.positions, normals: vertexNormals(base.mesh), indices: base.mesh.indices, baseColor: [color[0], color[1], color[2], 1], roughness: 0.85, doubleSided: true }], {
    scale: 0.01,
    generator: `@curtain/garment-spike ${PIPELINE_VERSION} ${POM_BUILDER_VERSION}`,
    extras: { productId, ...extras, unit: 'm', synthetic: true },
  });
}

/**
 * base.glb with the UV layout: one render vertex per (welded vertex, panel) so the seams cut the atlas, the welded
 * vertices first in their own order (the viewer welds by position and gets the base mesh back unchanged), normals of the
 * welded mesh (no shading seam at a UV seam), and the atlas as an embedded PNG.
 */
function printedGlb(productId: string, base: PomTeeBuild, layout: TeeUvLayout, extras: { baseSize: string; inputHash: string }): Uint8Array {
  const R = layout.remap.length;
  const welded = vertexNormals(base.mesh);
  const positions = new Float64Array(3 * R), normals = new Float32Array(3 * R);
  for (let r = 0; r < R; r++) for (let d = 0; d < 3; d++) {
    positions[3 * r + d] = base.mesh.positions[3 * layout.remap[r]! + d]!;
    normals[3 * r + d] = welded[3 * layout.remap[r]! + d]!;
  }
  const flat = syntheticFlatLay();
  const atlas = paintAtlas(layout, flatLayPainter(flat.front, flat.back, stripePrint(1 / layout.pxPerCm)), PRINT_BACKGROUND);
  const image = encodePng({ width: layout.sizePx, height: layout.sizePx, channels: 3, bitDepth: 8, data: atlas });
  return writeTexturedGlb({ name: productId, positions, normals, uvs: layout.uvs, indices: layout.indices, image, mimeType: 'image/png', roughness: 0.85, doubleSided: true }, {
    scale: 0.01,
    generator: `@curtain/garment-spike ${PIPELINE_VERSION} ${POM_BUILDER_VERSION}`,
    extras: { productId, ...extras, unit: 'm', synthetic: true },
  });
}

/** What qa.json says about the texture: where it comes from, its licence, the layout and how much the flattening stretches. */
function textureQa(layout: TeeUvLayout): Record<string, unknown> {
  return {
    kind: 'synthetic-print',
    source: PRINT_SOURCE,
    licence: PRINT_LICENCE,
    print: { stripePeriodCm: STRIPE_PERIOD_CM, stripeWidthCm: STRIPE_WIDTH_CM, front: 'flat-lay projection (synthetic photo)', back: 'flat-lay projection (synthetic photo)', sleeves: 'repeating print' },
    atlasPx: layout.sizePx,
    pxPerCm: round(layout.pxPerCm, 3),
    flattenIterations: FLATTEN_ITERATIONS,
    renderVertices: layout.remap.length,
    islands: layout.islands.map((i) => ({ panel: i.panel, widthCm: round(i.max[0] - i.min[0], 1), heightCm: round(i.max[1] - i.min[1], 1) })),
    edgeRatioFlatToGarment: layout.distortion,
  };
}

/**
 * The anchor measurements of a POM tee (`measureGarment`), with the two rings its welded sleeves
 * confuse taken on the right part: the shoulder ring as a tape round everything at its height
 * (torso and both sleeve caps: one loop over the shoulders), the upper-arm ring on the sleeve alone
 * (the plane across the arm also cuts the torso's side under the armhole, and on a large size the two
 * loops merge).
 */
export function pomMeasurements(m: Mannequin, b: PomTeeBuild): AnchorMeasurements {
  const out = measureGarment(m, b.mesh, 'top', assignChains(m, b.mesh));
  const mesh = b.mesh;
  const shoulder = m.rings.find((r) => r.id === 'shoulder')!;
  const all = slice(mesh.positions, mesh.indices, { origin: shoulder.centre, normal: shoulder.normal }).flatMap((l) => densifyLoop(l).points);
  const t = tapeGirth(all, shoulder.centre, shoulder.u, shoulder.v, { maxGapCm: 40, maxGapDeg: 120, minCoverage: 0.3 });
  if (t) out.rings.shoulder = { id: 'shoulder', circumferenceCm: t.girthCm, loop: t.loop.points.filter((_, i) => i % Math.max(1, Math.floor(t.loop.points.length / 32)) === 0).slice(0, 32), offsetCm: null, spansBothLegs: false };
  const ua = m.rings.find((r) => r.id === 'upper_arm' && r.side === 'left')!;
  const sleeveOnly = (tri: number): boolean => mesh.vertexPart[mesh.indices[3 * tri]!]! === 1 && mesh.vertexPart[mesh.indices[3 * tri + 1]!]! === 1 && mesh.vertexPart[mesh.indices[3 * tri + 2]!]! === 1;
  const loop = loopAround(slice(mesh.positions, mesh.indices, { origin: ua.centre, normal: ua.normal }, sleeveOnly), ua.centre, ua.u, ua.v);
  if (loop) {
    const t2 = tapeGirth(densifyLoop(loop).points, ua.centre, ua.u, ua.v);
    if (t2) out.rings.upper_arm = { id: 'upper_arm', circumferenceCm: t2.girthCm, loop: t2.loop.points.slice(0, 32), offsetCm: null, spansBothLegs: false };
  } else delete out.rings.upper_arm;
  return out;
}

/** The POM girth profile of a size at height y (what `buildPomTee` asks of the tube), cm. */
function pomGirthAt(m: Mannequin, row: PomTeeRow, chestLineY: number, hemY: number, y: number): number {
  const gC = 2 * row.chestWidthCm, gH = 2 * row.hemWidthCm, gW = row.waistWidthCm === undefined ? undefined : 2 * row.waistWidthCm;
  const yC = chestLineY, yW = m.morphHeights.waist, yH = hemY;
  if (y >= yC) return gC;
  if (gW !== undefined && y >= yW) return gW + ((gC - gW) * (y - yW)) / (yC - yW);
  if (gW !== undefined) return gH + ((gW - gH) * (y - yH)) / (yW - yH);
  return gH + ((gC - gH) * (y - yH)) / (yC - yH);
}

function gradePom(m: Mannequin, productId: string, rows: readonly PomTeeRow[], baseIdx: number, baseBuild: PomTeeBuild, base: AnchorMeasurements): GradingJson {
  const baseValues: AnchorValues = {};
  for (const [id, g] of Object.entries(ringGirths(base)) as [AnchorRing, number][]) baseValues[id] = g;
  for (const id of ['shoulder_to_hem', 'sleeve'] as const) {
    const l = base.lengths[id];
    if (l && !l.fromMannequin) baseValues[id] = l.lengthCm;
  }
  baseValues.shoulder_width = rows[baseIdx]!.shoulderCm;
  const baseRow = rows[baseIdx]!;
  const sources: SizeGrading['sources'] = {};
  const sizes: SizeGrading[] = rows.map((row, i) => {
    const targets: AnchorValues = {};
    for (const [id, b] of Object.entries(baseValues) as [AnchorId, number][]) {
      let v: number;
      if (id === 'shoulder_width') v = row.shoulderCm;
      else if (id === 'shoulder') v = b * (row.shoulderCm / baseRow.shoulderCm);
      // The sleeve grades with its opening (the morph holds the upper arm's scale down to the hem), its length with the tape's.
      else if (id === 'upper_arm') v = b * (row.sleeveOpeningCm / baseRow.sleeveOpeningCm);
      else if (id === 'sleeve') v = b + row.sleeveLengthCm - baseRow.sleeveLengthCm;
      // The hem moves with the tape's length (the front's path and the vertical line differ by the same amount in every size).
      else if (id === 'shoulder_to_hem') v = b + row.lengthCm - baseRow.lengthCm;
      else v = b + pomGirthAt(m, row, baseBuild.levels.chestLineY, baseBuild.levels.hemY - (row.lengthCm - baseRow.lengthCm), m.morphHeights[id as AnchorRing]) - pomGirthAt(m, baseRow, baseBuild.levels.chestLineY, baseBuild.levels.hemY, m.morphHeights[id as AnchorRing]);
      targets[id] = r2(v);
      sources[id] = 'chart';
    }
    return { size: row.size, step: i - baseIdx, targets, sources: { ...sources } };
  });
  const heights = {} as Record<AnchorRing, number>;
  for (const [k, v] of Object.entries(m.morphHeights) as [AnchorRing, number][]) heights[k] = r2(v);
  const roundedBase: AnchorValues = {};
  for (const [k, v] of Object.entries(baseValues) as [AnchorId, number][]) roundedBase[k] = r2(v);
  return {
    format: 'curtain.garment.grading',
    formatVersion: 1,
    productId,
    baseSize: rows[baseIdx]!.size,
    unit: 'cm',
    morph: { method: 'anchors.gradingMorph', chains: { body: 'radial about +Y', arm: 'radial about the arm axis' }, heights, breadths: { shoulder_width: { ring: 'shoulder', height: heights.shoulder } } },
    base: roundedBase,
    sizes,
    estimates: {},
  };
}
