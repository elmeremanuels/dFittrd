import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildBody, type Mannequin } from '@curtain/mannequin';
import type { AnchorRing } from '@curtain/anchors';
import { decodeRealisticBody, fitRealisticBody, fitTargetOf, type FitResult, type RealisticBodyAsset } from './realisticBody';
import {
  attachBaseLayer,
  BASE_LAYER_COLOUR,
  BASE_LAYER_GROUP,
  baseLayerRingsOf,
  baseLayerVisibility,
  buildBaseLayer,
  createBaseLayer,
} from './realisticBodyLoad';

const CRB_URL = new URL('../assets/realistic-body/female-v1.crb', import.meta.url);
const TEST_BODIES = [
  { id: 'slim', heightCm: 164, bust: 80, waist: 62, hip: 88 },
  { id: 'mid', heightCm: 168, bust: 92, waist: 74, hip: 100 },
  { id: 'full', heightCm: 170, bust: 116, waist: 98, hip: 122 },
  { id: 'tall', heightCm: 182, bust: 92, waist: 74, hip: 100 },
  { id: 'petite', heightCm: 152, bust: 84, waist: 66, hip: 92 },
] as const;

let cachedAsset: RealisticBodyAsset | null = null;
const fittedCache = new Map<string, { drawn: Mannequin; fit: FitResult }>();

function getAsset(): RealisticBodyAsset {
  if (!cachedAsset) cachedAsset = decodeRealisticBody(new Uint8Array(readFileSync(CRB_URL)));
  return cachedAsset;
}

function getFitted(spec: (typeof TEST_BODIES)[number]): { drawn: Mannequin; fit: FitResult } {
  const existing = fittedCache.get(spec.id);
  if (existing) return existing;
  const drawn = buildBody({ family: 'female', heightCm: spec.heightCm, bust: spec.bust, waist: spec.waist, hip: spec.hip });
  const rings = Object.fromEntries(drawn.rings.map((r) => [r.id, r.circumferenceCm])) as Record<AnchorRing, number>;
  const fit = fitRealisticBody(getAsset(), fitTargetOf(drawn, rings, () => 1));
  const out = { drawn, fit };
  fittedCache.set(spec.id, out);
  return out;
}

describe('D30 garment replacement rules (baseLayerVisibility)', () => {
  it('shows both vest and briefs when no garment is mounted or when garmentShown is false', () => {
    expect(baseLayerVisibility()).toEqual({ vest: true, briefs: true });
    expect(baseLayerVisibility({})).toEqual({ vest: true, briefs: true });
    expect(baseLayerVisibility({ category: null })).toEqual({ vest: true, briefs: true });
    expect(baseLayerVisibility({ category: 'dress', garmentShown: false })).toEqual({ vest: true, briefs: true });
    expect(baseLayerVisibility({ category: 'top', garmentShown: false })).toEqual({ vest: true, briefs: true });
    expect(baseLayerVisibility({ category: 'bottom', garmentShown: false })).toEqual({ vest: true, briefs: true });
  });

  it('hides the vest and keeps the briefs when a top or outerwear is shown', () => {
    for (const category of ['top', 'outerwear', 'shirt', 'tee', 't-shirt', 'blouse', 'sweater', 'jacket', 'coat']) {
      expect(baseLayerVisibility({ category, garmentShown: true }), category).toEqual({ vest: false, briefs: true });
    }
  });

  it('hides the briefs and keeps the vest when a skirt or trousers (bottom) is shown', () => {
    for (const category of ['bottom', 'skirt', 'trousers', 'pants', 'shorts', 'jeans']) {
      expect(baseLayerVisibility({ category, garmentShown: true }), category).toEqual({ vest: true, briefs: false });
    }
  });

  it('hides both vest and briefs when a dress or full-body garment is shown', () => {
    for (const category of ['dress', 'jumpsuit', 'playsuit', 'overall']) {
      expect(baseLayerVisibility({ category, garmentShown: true }), category).toEqual({ vest: false, briefs: false });
    }
  });

  it('keeps both vest and briefs for footwear and accessories', () => {
    expect(baseLayerVisibility({ category: 'shoes', garmentShown: true })).toEqual({ vest: true, briefs: true });
    expect(baseLayerVisibility({ category: 'accessory', garmentShown: true })).toEqual({ vest: true, briefs: true });
  });
});

describe('base layer coverage and geometry across the five test bodies', () => {
  it('never leaves nipples or the pubic/crotch/gluteal area bare on slim, mid, full, tall, or petite', () => {
    const asset = getAsset();
    const nb = asset.meta.bodyVertexCount;

    for (const spec of TEST_BODIES) {
      const { drawn, fit } = getFitted(spec);
      const rings = baseLayerRingsOf(drawn);
      const build = buildBaseLayer(fit.mesh, asset, rings);
      const P = fit.mesh.positions;

      // Locate left and right front bust peaks (nipple apices).
      let leftIdx = -1,
        leftZ = -1e9;
      let rightIdx = -1,
        rightZ = -1e9;
      for (let i = 0; i < nb; i++) {
        const x = P[3 * i]!,
          y = P[3 * i + 1]!,
          z = P[3 * i + 2]!;
        if (Math.abs(x) < 2.5 || y < rings.underbust - 1 || y > rings.chest + 6) continue;
        if (x < 0 && z > leftZ) {
          leftZ = z;
          leftIdx = i;
        } else if (x > 0 && z > rightZ) {
          rightZ = z;
          rightIdx = i;
        }
      }
      expect(leftIdx, `${spec.id}: left bust peak`).toBeGreaterThanOrEqual(0);
      expect(rightIdx, `${spec.id}: right bust peak`).toBeGreaterThanOrEqual(0);

      // Both nipple peaks and their 1.5 cm areola neighbourhoods are strictly inside the vest.
      for (const apexIdx of [leftIdx, rightIdx]) {
        const ax = P[3 * apexIdx]!,
          ay = P[3 * apexIdx + 1]!,
          az = P[3 * apexIdx + 2]!;
        expect(build.vestField[apexIdx]!, `${spec.id}: nipple apex covered`).toBeGreaterThan(1.5);
        for (let i = 0; i < nb; i++) {
          const d = Math.hypot(P[3 * i]! - ax, P[3 * i + 1]! - ay, P[3 * i + 2]! - az);
          if (d < 1.5) expect(build.vestField[i]!, `${spec.id}: areola neighbourhood covered`).toBeGreaterThan(0.5);
        }
      }

      // Pubic midline, crotch floor, and gluteal cleft are strictly inside the briefs.
      let pubicChecked = 0;
      let crotchChecked = 0;
      let glutealChecked = 0;
      for (let i = 0; i < nb; i++) {
        const ax = Math.abs(P[3 * i]!),
          y = P[3 * i + 1]!,
          z = P[3 * i + 2]!;
        if (ax < 3.5 && y >= rings.crotch && y <= rings.hip && z > 2) {
          pubicChecked++;
          expect(build.briefsField[i]!, `${spec.id}: pubic vertex ${i}`).toBeGreaterThan(0.5);
        }
        if (ax < 2.5 && Math.abs(y - rings.crotch) < 1.5) {
          crotchChecked++;
          expect(build.briefsField[i]!, `${spec.id}: crotch vertex ${i}`).toBeGreaterThan(0.5);
        }
        if (ax < 3.5 && y >= rings.crotch + 1 && y <= rings.hip && z < -2) {
          glutealChecked++;
          expect(build.briefsField[i]!, `${spec.id}: gluteal cleft vertex ${i}`).toBeGreaterThan(0.5);
        }
        // Neither garment bleeds onto the arms or head.
        if (asset.armWeight[i]! > 0.65) {
          expect(build.vestField[i]!, `${spec.id}: no vest on arms`).toBeLessThan(0);
          expect(build.briefsField[i]!, `${spec.id}: no briefs on arms`).toBeLessThan(0);
        }
        if (asset.headWeight[i]! > 0.5) {
          expect(build.vestField[i]!, `${spec.id}: no vest on head`).toBeLessThan(0);
          expect(build.briefsField[i]!, `${spec.id}: no briefs on head`).toBeLessThan(0);
        }
      }
      expect(pubicChecked, `${spec.id}: pubic vertices tested`).toBeGreaterThan(10);
      expect(crotchChecked, `${spec.id}: crotch vertices tested`).toBeGreaterThan(5);
      expect(glutealChecked, `${spec.id}: gluteal vertices tested`).toBeGreaterThan(10);

      // Finite, lightweight sub-meshes.
      expect(build.vest.triangleCount, `${spec.id}: vest triangles`).toBeGreaterThan(500);
      expect(build.vest.triangleCount, `${spec.id}: vest lightweight`).toBeLessThan(5000);
      expect(build.briefs.triangleCount, `${spec.id}: briefs triangles`).toBeGreaterThan(300);
      expect(build.briefs.triangleCount, `${spec.id}: briefs lightweight`).toBeLessThan(2500);
      for (const piece of [build.vest, build.briefs]) {
        for (let k = 0; k < piece.positions.length; k++) expect(Number.isFinite(piece.positions[k]!)).toBe(true);
        for (let k = 0; k < piece.normals.length; k += 3) {
          const len = Math.hypot(piece.normals[k]!, piece.normals[k + 1]!, piece.normals[k + 2]!);
          expect(len).toBeCloseTo(1, 3);
        }
      }
    }
  });
});

describe('Three.js view, live coverage switching, and realisticBodyLoad attachment', () => {
  it('uses one plain neutral matte material (no external textures) and switches visibility live for dress, skirt, top, and none', () => {
    const asset = getAsset();
    const { drawn, fit } = getFitted(TEST_BODIES[1]); // mid
    const view = createBaseLayer(fit.mesh, asset, baseLayerRingsOf(drawn));

    expect(view.group.name).toBe(BASE_LAYER_GROUP);
    expect(view.vest.material).toBe(view.briefs.material);
    expect(view.material.map).toBeNull();
    expect(view.material.metalness).toBe(0);
    expect(view.material.roughness).toBeGreaterThanOrEqual(0.85);
    expect(`#${view.material.color.getHexString()}`).toBe(BASE_LAYER_COLOUR);

    // No garment: both shown.
    expect(view.vest.visible).toBe(true);
    expect(view.briefs.visible).toBe(true);

    // Dress: both hidden.
    view.setCoverage({ category: 'dress', garmentShown: true });
    expect(view.vest.visible).toBe(false);
    expect(view.briefs.visible).toBe(false);

    // Skirt / bottom: vest stays, briefs hidden.
    view.setCoverage({ category: 'skirt', garmentShown: true });
    expect(view.vest.visible).toBe(true);
    expect(view.briefs.visible).toBe(false);

    // Top: vest hidden, briefs stay.
    view.setCoverage({ category: 'top', garmentShown: true });
    expect(view.vest.visible).toBe(false);
    expect(view.briefs.visible).toBe(true);

    // Garment turned off (e.g. blocked/refused size): both return.
    view.setCoverage({ category: 'dress', garmentShown: false });
    expect(view.vest.visible).toBe(true);
    expect(view.briefs.visible).toBe(true);

    view.dispose();
  });

  it('attaches to figure.group via attachBaseLayer without duplicating on re-attach and removes cleanly on dispose', () => {
    const asset = getAsset();
    const { drawn, fit } = getFitted(TEST_BODIES[1]);
    const figure = { group: new THREE.Group() };

    const v1 = attachBaseLayer(figure, fit.mesh, asset, drawn, { coverage: { category: 'bottom', garmentShown: true } });
    expect(figure.group.getObjectByName(BASE_LAYER_GROUP)).toBe(v1.group);
    expect(v1.vest.visible).toBe(true);
    expect(v1.briefs.visible).toBe(false);

    const v2 = attachBaseLayer(figure, fit.mesh, asset, drawn);
    expect(figure.group.children.filter((c) => c.name === BASE_LAYER_GROUP)).toHaveLength(1);
    expect(figure.group.getObjectByName(BASE_LAYER_GROUP)).toBe(v2.group);

    v1.dispose();
    v2.dispose();
    expect(figure.group.getObjectByName(BASE_LAYER_GROUP)).toBeUndefined();
  });

  it('switches to conformedMesh geometry while a garment is shown and reverts to the plain body when hidden', () => {
    const asset = getAsset();
    const { drawn, fit } = getFitted(TEST_BODIES[1]);
    // Slightly inset proxy for a conformed body mesh.
    const conformedPos = Float64Array.from(fit.mesh.positions, (v, idx) => (idx % 3 === 1 ? v : v * 0.96));
    const view = createBaseLayer(fit.mesh, asset, baseLayerRingsOf(drawn), {
      conformedMesh: { positions: conformedPos, indices: fit.mesh.indices },
      coverage: { category: 'top', garmentShown: true },
    });
    const conformedBriefsGeom = view.briefs.geometry;
    expect(view.vest.visible).toBe(false);
    expect(view.briefs.visible).toBe(true);

    view.setCoverage({ category: 'top', garmentShown: false });
    expect(view.vest.visible).toBe(true);
    expect(view.briefs.visible).toBe(true);
    expect(view.briefs.geometry).not.toBe(conformedBriefsGeom);

    view.dispose();
  });

  it('keeps baseLayer.ts isolated inside realisticBodyLoad.ts so zero bytes enter the main viewer chunk', () => {
    const dir = new URL('.', import.meta.url);
    const importers = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /from '\.\/baseLayer'/.test(readFileSync(new URL(f, dir), 'utf8')));
    expect(importers).toEqual(['realisticBodyLoad.ts']);
  });
});
