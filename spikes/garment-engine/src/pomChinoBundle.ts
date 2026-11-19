/**
 * The POM chino as a device bundle (men-3d-plan slices M3/M4): the five files of `bundle.ts` (base.glb, anchors.json,
 * grading.json, material.json, qa.json) from a chino's flat measurements, so the existing viewer loads it as any bottom:
 * it grades it, hangs it from its waistband and drapes it on the device.
 *
 * - **Base mesh**: `buildPomChino` of the base size on the canonical body of the product's family (the male M).
 * - **Grading**: the device grades the base mesh with `gradingMorph` (radial about the body axis, lengths stretched below
 *   the hip ring). The targets per size are solved against that morph so that the graded mesh's own tape is the size's
 *   tape: `waist` carries the waistband's girth (the band lies under the waist ring; the ring's value is the knot that
 *   puts the band's girth right), `hip` the seat, `thigh`, `knee`, `ankle` (the leg opening: the hem is below the ankle
 *   ring and takes its scale), `shoulder_to_hem` the hem's height (solved for the inseam). **The rises are not graded**:
 *   the morph has no vertical stretch above the hip ring, so every size keeps the base size's band height and crotch
 *   depth, off by what `gradingCheck` reports.
 * - **QA**: nothing was reconstructed; `chartAgreement.kind` is `tape-built` (the import flags the asset
 *   `tape_built_no_chart_check`). qa.json reports the builder's own tape against every input measurement, per size, on the
 *   male table body that waist belongs to (`pomTape`, the 0.5 cm gate; the outseam is checked, not gated), what the
 *   device's grading misses (`gradingCheck`), where each size sits on its body (`levels`) and the assumptions.
 */
import { createHash } from 'node:crypto';
import type { AnchorId, AnchorRing, AnchorValues } from '@curtain/anchors';
import type { GarmentPayload } from '@curtain/schema';
import { MALE_REFERENCE, MANNEQUIN_VERSION, buildBody, round, roundVec, topology, vertexNormals, writeGlb, type Mannequin, type Mesh, type Vec3 } from '@curtain/mannequin';
import { bundleMannequin, mannequinFor, PIPELINE_VERSION, type Bundle } from './bundle';
import { encodePng } from './exportPng';
import { writeTexturedGlb } from './glbTextured';
import { applyGrading, encodeBuiltOffsets, type GradingJson, type SizeGrading } from './grading';
import { POM_CHINO_ASSUMPTIONS, buildPomChino, measurePomChino, sliceChinoGirths, type PomChinoBuild, type PomChinoLevels, type PomChinoRow } from './pomChino';
import { CHINO_DETAILS, CHINO_PRINT_LICENCE, CHINO_PRINT_SOURCE, chinoPainter, chinoUvLayout, paintChinoAtlas, type ChinoUvLayout } from './pomChinoUv';
import { materialJson } from './product';
import { hexToRgb } from './raster';

export const POM_CHINO_BUILDER_VERSION = 'pom-chino-0.2.0';
/** Resolution of a built size's offsets from the base mesh, cm. */
const BUILT_QUANTUM_CM = 0.01;
export const POM_CHINO_ATLAS_PX = 1024;
/** The gate: every input measurement but the outseam on the built mesh within this of the tape, cm. */
export const POM_CHINO_TAPE_TOLERANCE_CM = 0.5;

/** The measurements the builder builds to (gated), and the one it only checks. */
export const CHINO_GATED_KEYS = ['waistWidthCm', 'frontRiseCm', 'backRiseCm', 'seatWidthCm', 'thighWidthCm', 'kneeWidthCm', 'legOpeningWidthCm', 'inseamCm'] as const;
export const CHINO_KEYS = [...CHINO_GATED_KEYS, 'outseamCm'] as const;
export type ChinoKey = (typeof CHINO_KEYS)[number];

export interface PomChinoBundleOptions {
  /** `synthetic-detail`: UVs per panel and the painted atlas (`pomChinoUv.ts`); `plain`: one colour, no UVs. */
  texture?: 'synthetic-detail' | 'plain';
  /** The male table body each waist label is taped on (`SYNTHETIC_CHINO_BODY`); a waist without one is taped on the base body. */
  bodyOfWaist?: Readonly<Record<string, string>>;
  /** The male body shape the chino is built, taped and graded on: `v1` (default) or `v2`. The bundle states it (`mannequin.maleShape`). */
  maleShape?: 'v1' | 'v2';
  /**
   * `built` (default): every size is the builder's own mesh of that size on its table body, shipped as offsets from the
   * base mesh (`GradingJson.built`), so the rises and the crotch depth are the size's. `morph`: the device's morph only
   * (girths and inseam; the rises stay the base size's).
   */
  grading?: 'built' | 'morph';
}

const json = (x: unknown): string => `${JSON.stringify(x, null, 2)}\n`;
const r2 = (x: number): number => Math.round(x * 100) / 100;

export function chinoErrors(asked: PomChinoRow, got: PomChinoRow): Record<ChinoKey, number> {
  const out = {} as Record<ChinoKey, number>;
  for (const k of CHINO_KEYS) out[k] = got[k] - asked[k];
  return out;
}

export interface ChinoSizeCheck {
  size: string;
  body: string;
  /** Built minus asked, cm; the three level girths are the plane cut's (`sliceChinoGirths`), the rest the seams' and edges'. */
  errorCm: Record<ChinoKey, number>;
  /** Largest error among the gated measurements. */
  maxAbsCm: number;
  levels: PomChinoLevels;
  tight: PomChinoBuild['tight'];
}

export interface ChinoGradingCheck {
  size: string;
  /** Device grading of the base mesh, taped along its own rows and seams, minus the tape's value, cm. */
  errorCm: Record<ChinoKey, number>;
}

export interface PomChinoBundle extends Omit<Bundle, 'calibration' | 'agreement' | 'separation' | 'measurements'> {
  base: PomChinoBuild;
  tape: ChinoSizeCheck[];
  gradingCheck: ChinoGradingCheck[];
  layout: ChinoUvLayout | null;
}

const MALE_TABLE = MALE_REFERENCE as Readonly<Record<string, { chest: number; waist: number; hip: number; stature: number; shoulderWidth: number }>>;
function tableBody(id: string | undefined, maleShape: 'v1' | 'v2'): Mannequin | null {
  const t = id === undefined ? undefined : MALE_TABLE[id];
  return t ? buildBody({ family: 'male', bust: t.chest, waist: t.waist, hip: t.hip, heightCm: t.stature, shoulderCm: t.shoulderWidth }, maleShape === 'v2' ? { maleShape: 'v2' } : {}) : null;
}
const waistOf = (size: string): string => size.split('/')[0]!;

export function buildPomChinoBundle(productId: string, payload: GarmentPayload, rows: readonly PomChinoRow[], baseSize: string, options: PomChinoBundleOptions = {}): PomChinoBundle {
  const texture = options.texture ?? 'synthetic-detail';
  const maleShape = options.maleShape === 'v2' ? 'v2' : 'v1';
  const builtSizes = (options.grading ?? 'built') === 'built';
  const m = mannequinFor(payload, { maleShape });
  const meta = bundleMannequin(m);
  if (m.shape.family !== 'male') throw new Error('the POM chino is built on the male mannequin only');
  const baseIdx = rows.findIndex((r) => r.size === baseSize);
  if (baseIdx < 0) throw new Error(`base size ${baseSize} not in the measurements`);
  const baseRow = rows[baseIdx]!;
  const base = buildPomChino(m, baseRow);
  const chains = new Uint8Array(base.mesh.positions.length / 3);

  // The tape on every size, built directly on the table body its waist belongs to, with the base mesh's rows.
  const builds: { body: Mannequin; build: PomChinoBuild }[] = [];
  const tape: ChinoSizeCheck[] = rows.map((row) => {
    const id = options.bodyOfWaist?.[waistOf(row.size)];
    const body = tableBody(id, maleShape);
    const b = row.size === baseSize && !body ? base : buildPomChino(body ?? m, row, { counts: base.counts });
    builds.push({ body: body ?? m, build: b });
    const measured = { ...measurePomChino(b, b.mesh.positions, row.size), ...sliceChinoGirths(b) };
    const errorCm = chinoErrors(row, measured);
    return { size: row.size, body: `male ${body ? id : m.shape.id}${meta.maleShape ? ` (shape ${meta.maleShape})` : ''}`, errorCm, maxAbsCm: Math.max(...CHINO_GATED_KEYS.map((k) => Math.abs(errorCm[k]))), levels: b.levels, tight: b.tight };
  });

  const grading = gradeChino(m, productId, rows, baseIdx, base, chains, !builtSizes);
  if (builtSizes) {
    // Every size as built on its own table body, in the base body's space: moved down by the difference of the waist
    // ring's height, the lift the viewer adds back for a bottom on a body of that height (`buildTypedAvatar`).
    const offsets: Record<string, string> = {};
    const bodies: Record<string, string> = {};
    rows.forEach((row, i) => {
      if (i === baseIdx) return;
      const { body, build } = builds[i]!;
      if (build.mesh.positions.length !== base.mesh.positions.length) throw new Error(`size ${row.size}: not the base mesh's vertices`);
      const lift = body.morphHeights.waist - m.morphHeights.waist;
      const moved = Float64Array.from(build.mesh.positions);
      for (let k = 1; k < moved.length; k += 3) moved[k] = moved[k]! - lift;
      offsets[row.size] = encodeBuiltOffsets(base.mesh.positions, moved, BUILT_QUANTUM_CM);
      bodies[row.size] = tape[i]!.body;
    });
    grading.built = { encoding: 'int16le-base64', quantumCm: BUILT_QUANTUM_CM, vertices: base.mesh.positions.length / 3, bodies, offsets };
  }
  // What the device shows for a size (the built size decoded from grading.json, or the morph), taped along its own rows and seams.
  const gradingCheck: ChinoGradingCheck[] = rows.map((row) => {
    const graded = applyGrading(m, base.mesh, chains, grading, row.size);
    return { size: row.size, errorCm: chinoErrors(row, measurePomChino(base, graded.positions, row.size)) };
  });

  const material = materialJson(payload);
  const health = topology(base.mesh);
  const inputHash = createHash('sha256').update(JSON.stringify({ payload, rows, baseSize, texture, builder: POM_CHINO_BUILDER_VERSION, assumptions: POM_CHINO_ASSUMPTIONS, details: CHINO_DETAILS, mannequin: MANNEQUIN_VERSION, pipeline: PIPELINE_VERSION, family: meta.family, grading: builtSizes ? 'built' : 'morph', ...(meta.maleShape ? { maleShape: meta.maleShape } : {}) })).digest('hex');
  const P = (i: number): Vec3 => [base.mesh.positions[3 * i]!, base.mesh.positions[3 * i + 1]!, base.mesh.positions[3 * i + 2]!];
  const chartRow = payload.sizeChart.find((r) => r.size === baseSize);
  const ringOf = (ids: readonly number[], girth: number, chart: number | undefined, y: number, both: boolean) => ({
    circumferenceCm: round(girth, 2),
    chartCm: chart ?? null,
    offsetCm: null,
    spansBothLegs: both,
    plane: { centre: roundVec([0, y, 0], 3), normal: [0, 1, 0] },
    loop: ids.filter((_, i) => i % Math.max(1, Math.floor(ids.length / 32)) === 0).slice(0, 32).map((i) => roundVec(P(i), 2)),
  });
  const top = base.torsoRows[base.torsoRows.length - 1]!;
  const leg = base.legRows[0];
  const anchors = {
    format: 'curtain.garment.anchors',
    formatVersion: 1,
    productId,
    baseSize,
    category: 'bottom',
    unit: 'cm',
    mannequin: meta,
    pipelineVersion: PIPELINE_VERSION,
    builder: POM_CHINO_BUILDER_VERSION,
    inputHash,
    synthetic: true,
    // `waist` is the waistband (its top edge), below the waist ring: the fit engine reads a men's trouser waist there too.
    rings: {
      waist: ringOf(top, 2 * baseRow.waistWidthCm, chartRow?.waist, base.levels.bandCentreY, true),
      hip: ringOf(base.torsoRows[base.seatRow]!, 2 * baseRow.seatWidthCm, chartRow?.hip, base.levels.seatY, true),
      thigh: ringOf(leg[base.thighRow]!, 2 * baseRow.thighWidthCm, chartRow?.thigh, base.levels.thighY, false),
      knee: ringOf(leg[base.kneeRow]!, 2 * baseRow.kneeWidthCm, undefined, base.levels.kneeY, false),
      ankle: ringOf(leg[0]!, 2 * baseRow.legOpeningWidthCm, undefined, base.levels.hemY, false),
    },
    breadths: {},
    lengths: {
      inseam: { lengthCm: round(baseRow.inseamCm, 2), start: roundVec(P(base.crotchPoint), 2), end: roundVec(P(base.inseam[base.inseam.length - 1]!), 2), fromMannequin: false },
      rise: { lengthCm: round(baseRow.frontRiseCm, 2), start: roundVec(P(base.crotchPoint), 2), end: roundVec(P(base.frontRise[base.frontRise.length - 1]!), 2), fromMannequin: false },
    },
    worn: base.levels,
    seams: { stretchPct: POM_CHINO_ASSUMPTIONS.seamStretchPct, paths: base.seams.map((x) => x.path), grain: { stretchPct: POM_CHINO_ASSUMPTIONS.grainStretchPct, shortenPct: POM_CHINO_ASSUMPTIONS.grainShortenPct, paths: base.grain } },
    calibration: { globalScale: 1, ringCorrections: {}, sources: {}, residualAfterGlobalCm: { rms: 0, maxAbs: 0 } },
  };

  const worst = Math.max(...tape.map((t) => t.maxAbsCm));
  const roundErr = (e: Record<ChinoKey, number>): Record<string, number> => Object.fromEntries(CHINO_KEYS.map((k) => [k, r2(e[k])]));
  const layout = texture === 'synthetic-detail' ? chinoUvLayout(base, POM_CHINO_ATLAS_PX) : null;
  const qa: Record<string, unknown> = {
    format: 'curtain.garment.qa',
    formatVersion: 1,
    productId,
    synthetic: true,
    inputHash,
    mannequin: meta,
    chartAgreement: {
      kind: 'tape-built',
      pass: true,
      basis: `Built from the flat garment measurements (${POM_CHINO_BUILDER_VERSION}); nothing was reconstructed, so there is no chart to calibrate against. pomTape below is the builder's own tape of every input measurement on every size, built on the male table body that waist belongs to.`,
      maxAbsCm: null,
      perRingCm: {},
    },
    pomTape: {
      toleranceCm: POM_CHINO_TAPE_TOLERANCE_CM,
      gated: CHINO_GATED_KEYS,
      checkedOnly: ['outseamCm'],
      pass: worst <= POM_CHINO_TAPE_TOLERANCE_CM,
      maxAbsCm: r2(worst),
      sizes: tape.map((t) => ({ size: t.size, body: t.body, maxAbsCm: r2(t.maxAbsCm), errorCm: roundErr(t.errorCm), levels: t.levels, ...(t.tight.length ? { tighterThanBody: t.tight } : {}) })),
    },
    gradingCheck: { note: builtSizes ? 'Every size is the builder\'s own mesh of that size on its table body, decoded from grading.json (built): rises and crotch depth are the size\'s.' : 'The device morph does not grade the rises (no vertical stretch above the hip ring): every size keeps the base size band height and crotch depth.', sizes: gradingCheck.map((g) => ({ size: g.size, errorCm: roundErr(g.errorCm) })) },
    assumptions: POM_CHINO_ASSUMPTIONS,
    calibration: { globalScale: 1, residualBeforeCm: { rms: 0, maxAbs: 0 }, residualAfterGlobalCm: { rms: 0, maxAbs: 0 } },
    meshHealth: { triangles: health.triangles, vertices: health.vertices, boundaryEdges: health.boundaryEdges, nonManifoldEdges: health.nonManifoldEdges, inconsistentEdges: health.inconsistentEdges, pieces: health.components, triangleBudget: [8000, 15000], withinBudget: health.triangles <= 15000 },
    separation: null,
    gradingEstimates: grading.estimates,
  };
  if (layout) {
    qa.texture = {
      kind: 'synthetic-detail',
      source: CHINO_PRINT_SOURCE,
      licence: CHINO_PRINT_LICENCE,
      details: CHINO_DETAILS,
      atlasPx: layout.sizePx,
      pxPerCm: round(layout.pxPerCm, 3),
      flatten: 'row by row from the side seam, no relaxation',
      renderVertices: layout.remap.length,
      islands: layout.islands.map((i) => ({ panel: i.panel, widthCm: round(i.max[0] - i.min[0], 1), heightCm: round(i.max[1] - i.min[1], 1) })),
      edgeRatioFlatToGarment: layout.distortion,
    };
  }
  const extras = { productId, baseSize, inputHash, unit: 'm', synthetic: true };
  const generator = `@curtain/garment-spike ${PIPELINE_VERSION} ${POM_CHINO_BUILDER_VERSION}`;
  const color = hexToRgb(payload.primaryColorHex ?? '#888888');
  let glb: Uint8Array;
  if (layout) {
    const R = layout.remap.length;
    const welded = vertexNormals(base.mesh);
    const positions = new Float64Array(3 * R), normals = new Float32Array(3 * R);
    for (let r = 0; r < R; r++) for (let d = 0; d < 3; d++) {
      positions[3 * r + d] = base.mesh.positions[3 * layout.remap[r]! + d]!;
      normals[3 * r + d] = welded[3 * layout.remap[r]! + d]!;
    }
    const rgb: [number, number, number] = [Math.round(color[0] * 255), Math.round(color[1] * 255), Math.round(color[2] * 255)];
    const atlas = paintChinoAtlas(layout, chinoPainter(layout, rgb, 1 / layout.pxPerCm), rgb);
    const image = encodePng({ width: layout.sizePx, height: layout.sizePx, channels: 3, bitDepth: 8, data: atlas });
    glb = writeTexturedGlb({ name: productId, positions, normals, uvs: layout.uvs, indices: layout.indices, image, mimeType: 'image/png', roughness: 0.9, doubleSided: true }, { scale: 0.01, generator, extras });
  } else {
    glb = writeGlb([{ name: productId, positions: base.mesh.positions, normals: vertexNormals(base.mesh), indices: base.mesh.indices, baseColor: [color[0], color[1], color[2], 1], roughness: 0.9, doubleSided: true }], { scale: 0.01, generator, extras });
  }

  return {
    productId,
    files: { 'base.glb': glb, 'anchors.json': json(anchors), 'grading.json': json(grading), 'material.json': json(material), 'qa.json': json(qa) },
    mannequin: m,
    baseMesh: base.mesh,
    material,
    base,
    tape,
    grading,
    gradingCheck,
    layout,
  };
}

/** The ring each girth measurement is graded through, and the length the inseam is. */
const RING_OF: readonly (readonly [AnchorRing, 'waistWidthCm' | 'seatWidthCm' | 'thighWidthCm' | 'kneeWidthCm' | 'legOpeningWidthCm'])[] = [['waist', 'waistWidthCm'], ['hip', 'seatWidthCm'], ['thigh', 'thighWidthCm'], ['knee', 'kneeWidthCm'], ['ankle', 'legOpeningWidthCm']];

function gradeChino(m: Mannequin, productId: string, rows: readonly PomChinoRow[], baseIdx: number, base: PomChinoBuild, chains: Uint8Array, solveMorph: boolean): GradingJson {
  const baseRow = rows[baseIdx]!;
  const baseValues: AnchorValues = {};
  for (const [ring, key] of RING_OF) baseValues[ring] = r2(2 * baseRow[key]);
  // The hem's height as a drop from the high point shoulder: the length the device's morph stretches the legs by.
  baseValues.shoulder_to_hem = r2(m.landmarks.hps[1] - base.levels.hemY);
  const heights = {} as Record<AnchorRing, number>;
  for (const [k, v] of Object.entries(m.morphHeights) as [AnchorRing, number][]) heights[k] = r2(v);
  const sources: SizeGrading['sources'] = {};
  for (const id of Object.keys(baseValues) as AnchorId[]) sources[id] = 'chart';
  const grading: GradingJson = {
    format: 'curtain.garment.grading',
    formatVersion: 1,
    productId,
    baseSize: baseRow.size,
    unit: 'cm',
    morph: { method: 'anchors.gradingMorph', chains: { body: 'radial about +Y', arm: 'radial about the arm axis' }, heights },
    base: baseValues,
    sizes: rows.map((row, i) => {
      const targets: AnchorValues = {};
      for (const [ring, key] of RING_OF) targets[ring] = r2(2 * row[key]);
      targets.shoulder_to_hem = r2(baseValues.shoulder_to_hem! + row.inseamCm - baseRow.inseamCm);
      return { size: row.size, step: i - baseIdx, targets, sources: { ...sources } };
    }),
    estimates: {},
  };
  // Solve each size's targets against the device's own morph: the graded mesh's tape is then the size's tape.
  for (const [i, row] of rows.entries()) {
    if (i === baseIdx || !solveMorph) continue;
    const t = grading.sizes[i]!.targets;
    for (let it = 0; it < 8; it++) {
      const got = measurePomChino(base, applyGrading(m, base.mesh, chains, grading, row.size).positions);
      let worst = Math.abs(row.inseamCm - got.inseamCm);
      for (const [ring, key] of RING_OF) {
        worst = Math.max(worst, Math.abs(row[key] - got[key]));
        t[ring] = r2(t[ring]! * (row[key] / got[key]));
      }
      t.shoulder_to_hem = r2(t.shoulder_to_hem! + row.inseamCm - got.inseamCm);
      if (worst < 0.01) break;
    }
  }
  return grading;
}

export type { Mesh };
