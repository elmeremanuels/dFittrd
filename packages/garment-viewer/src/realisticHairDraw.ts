/**
 * The realistic body spike's hair (D28) as three.js meshes: `buildHair` of `realisticHair.ts` with its generated
 * textures, in one group named `HAIR_OBJECT_NAME` that the mount adds to the figure. Loaded with `import()` only when a
 * host passes `MountOptions.hair` with `bodyShape: 'realistic-spike'`, so the default viewer neither carries nor runs
 * it. No I/O at all: the geometry and the textures are computed here, on the device.
 *
 * v2 shading (WO-012): closed, opaque, `FrontSide` sculpted meshes with procedural groove/coil albedo maps and matte
 * `MeshLambertMaterial` (soft vertex AO in roots, parting and crevices; sculpted 3D bevel/puff normals carry form
 * without expensive per-pixel `normalMap` screen-space derivatives or `alphaTest` overdraw — enabling full Early-Z
 * rejection on CPU SwiftShader and mobile GPUs). Preserved v1 strand-cards remain available via `style: 'strand-cards'`.
 */
import * as THREE from 'three';
import type { HairChoice } from './hairOptions';
import {
  buildHair,
  coilTexture,
  sculptedCoilTextures,
  sculptedLockTextures,
  strandTexture,
  textureBytes,
  type HairBodyInput,
  type HairBuild,
  type HairPart,
  type HairStyle,
  type HairTexture,
} from './realisticHair';

export const HAIR_OBJECT_NAME = 'curtain-hair';

export interface CreateHairOptions {
  style?: HairStyle;
}

export interface HairView {
  group: THREE.Group;
  build: HairBuild;
  /** Bytes of the generated textures on the GPU (RGBA8 with mips). */
  textureBytes: number;
  /** Time to build the geometry and textures, ms. */
  buildMs: number;
  dispose(): void;
}

function dataTexture(t: HairTexture, wrapS: boolean, wrapT: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(t.levels[0]!, t.width, t.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  let w = t.width, h = t.height;
  tex.mipmaps = t.levels.map((data) => {
    const m = { data, width: w, height: h };
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    return m;
  }) as unknown as typeof tex.mipmaps;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapNearestFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = wrapS ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = wrapT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

function geometryOf(part: HairPart): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(part.colors, 4));
  g.setIndex(new THREE.BufferAttribute(part.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Build the hair for `choice` on the drawn body `input` (body space, cm: the group goes into the figure's group). */
export function createHair(input: HairBodyInput, choice: HairChoice, options: CreateHairOptions = {}): HairView {
  const t0 = performance.now();
  const style: HairStyle = options.style === 'strand-cards' ? 'strand-cards' : 'sculpted';
  const build = buildHair(input, choice, { style });
  const colour = new THREE.Color(choice.hex);
  const disposables: { dispose(): void }[] = [];
  let texBytes = 0;

  let materials: Record<HairPart['kind'], THREE.Material>;
  if (style === 'strand-cards') {
    const strandTex = strandTexture();
    const coily = build.parts.some((p) => p.kind === 'shells');
    const coilTex = coily ? coilTexture(choice.type) : null;
    const strandMap = dataTexture(strandTex, false, false);
    const coilMap = coilTex ? dataTexture(coilTex, true, true) : null;
    disposables.push(strandMap);
    if (coilMap) disposables.push(coilMap);
    texBytes = textureBytes(strandTex) + (coilTex ? textureBytes(coilTex) : 0);
    materials = {
      cap: new THREE.MeshLambertMaterial({ color: colour, vertexColors: true, alphaTest: 0.48, side: THREE.FrontSide }),
      strands: new THREE.MeshLambertMaterial({ color: colour, map: strandMap, vertexColors: true, alphaTest: 0.48, side: THREE.DoubleSide }),
      shells: new THREE.MeshLambertMaterial({ color: colour, map: coilMap, vertexColors: true, alphaTest: 0.48, side: THREE.DoubleSide }),
    };
  } else {
    const useCoilMaps = choice.type === '3C' || choice.type === '4A' || choice.type === '4B' || choice.type === '4C';
    const pair = useCoilMaps ? sculptedCoilTextures(choice.type) : sculptedLockTextures();
    const albedoMap = dataTexture(pair.albedo, true, useCoilMaps);
    disposables.push(albedoMap);
    texBytes = textureBytes(pair.albedo);

    // Pure matte, opaque, FrontSide MeshLambertMaterial: zero alphaTest discard, zero DoubleSide overdraw, zero
    // per-pixel normalMap tangent-derivative overhead; a gentle floor lift on very dark hues keeps black sculpted
    // puff/lock forms readable under classic ACES lighting.
    const lum = 0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b;
    const drawColour = lum < 0.03 ? colour.clone().lerp(new THREE.Color(0x3a322d), 0.22) : colour;
    const mat = new THREE.MeshLambertMaterial({
      color: drawColour,
      map: albedoMap,
      vertexColors: true,
      side: THREE.FrontSide,
    });
    materials = { cap: mat, strands: mat, shells: mat };
  }

  const group = new THREE.Group();
  group.name = HAIR_OBJECT_NAME;
  const geometries: THREE.BufferGeometry[] = [];
  for (const part of build.parts) {
    if (!part.indices.length) continue;
    const g = geometryOf(part);
    geometries.push(g);
    const mesh = new THREE.Mesh(g, materials[part.kind]);
    mesh.name = `${HAIR_OBJECT_NAME}-${part.kind}`;
    group.add(mesh);
  }
  const buildMs = performance.now() - t0;
  return {
    group,
    build,
    textureBytes: texBytes,
    buildMs,
    dispose() {
      group.removeFromParent();
      for (const g of geometries) g.dispose();
      for (const m of new Set(Object.values(materials))) m.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
