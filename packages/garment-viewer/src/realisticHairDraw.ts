/**
 * The realistic body spike's hair (D28) as three.js meshes: `buildHair` of `realisticHair.ts` with its generated
 * textures, in one group named `HAIR_OBJECT_NAME` that the mount adds to the figure. Loaded with `import()` only when a
 * host passes `MountOptions.hair` with `bodyShape: 'realistic-spike'`, so the default viewer neither carries nor runs
 * it. No I/O at all: the geometry and the textures are computed here, on the device.
 *
 * Shading: three's physical material with an anisotropic highlight stretched along the fibre (the `tangent`
 * attribute is the strand direction), alpha-tested cards with alpha-to-coverage (soft edges without sorting),
 * occlusion in the vertex colours (darker at the roots and in the inner layers).
 */
import * as THREE from 'three';
import type { HairChoice } from './hairOptions';
import { buildHair, coilTexture, strandTexture, textureBytes, type HairBodyInput, type HairBuild, type HairPart, type HairTexture } from './realisticHair';

export const HAIR_OBJECT_NAME = 'curtain-hair';

export interface HairView {
  group: THREE.Group;
  build: HairBuild;
  /** Bytes of the generated textures on the GPU (RGBA8 with mips). */
  textureBytes: number;
  /** Time to build the geometry and textures, ms. */
  buildMs: number;
  dispose(): void;
}

function dataTexture(t: HairTexture, wrap: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(t.levels[0]!, t.width, t.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  let w = t.width, h = t.height;
  tex.mipmaps = t.levels.map((data) => {
    const m = { data, width: w, height: h };
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    return m;
  }) as unknown as typeof tex.mipmaps;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function geometryOf(part: HairPart): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(part.tangents, 4));
  g.setAttribute('uv', new THREE.BufferAttribute(part.uvs, 2));
  g.setAttribute('color', new THREE.BufferAttribute(part.colors, 4));
  g.setIndex(new THREE.BufferAttribute(part.indices, 1));
  g.computeBoundingSphere();
  return g;
}

/** Build the hair for `choice` on the drawn body `input` (body space, cm: the group goes into the figure's group). */
export function createHair(input: HairBodyInput, choice: HairChoice): HairView {
  const t0 = performance.now();
  const build = buildHair(input, choice);
  const strandTex = strandTexture();
  const coily = build.parts.some((p) => p.kind === 'shells');
  const coilTex = coily ? coilTexture(choice.type) : null;
  const strandMap = dataTexture(strandTex, false);
  const coilMap = coilTex ? dataTexture(coilTex, true) : null;
  const colour = new THREE.Color(choice.hex);
  const { roughness, anisotropy, specular } = build.look;
  const common = { color: colour, roughness, metalness: 0, vertexColors: true, alphaTest: 0.5, alphaToCoverage: true, specularIntensity: specular } as const;
  const materials: Record<HairPart['kind'], THREE.MeshPhysicalMaterial> = {
    cap: new THREE.MeshPhysicalMaterial({ ...common, roughness: Math.min(1, roughness + 0.15), side: THREE.FrontSide }),
    strands: new THREE.MeshPhysicalMaterial({ ...common, map: strandMap, anisotropy, side: THREE.DoubleSide }),
    shells: new THREE.MeshPhysicalMaterial({ ...common, map: coilMap, anisotropy: anisotropy * 0.5, side: THREE.DoubleSide }),
  };
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
    textureBytes: textureBytes(strandTex) + (coilTex ? textureBytes(coilTex) : 0),
    buildMs,
    dispose() {
      group.removeFromParent();
      for (const g of geometries) g.dispose();
      for (const m of Object.values(materials)) m.dispose();
      strandMap.dispose();
      coilMap?.dispose();
    },
  };
}
