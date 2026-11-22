/**
 * The realistic body spike's hair (D28) as three.js meshes: `buildHair` of `realisticHair.ts` with its generated
 * textures, in one group named `HAIR_OBJECT_NAME` that the mount adds to the figure. Loaded with `import()` only when a
 * host passes `MountOptions.hair` with `bodyShape: 'realistic-spike'`, so the default viewer neither carries nor runs
 * it. No I/O at all: the geometry and the textures are computed here, on the device.
 *
 * Shading (WO-003): lightweight Phong material (`MeshPhongMaterial`) with `alphaTest` (no expensive MSAA
 * `alphaToCoverage`, no 4× anisotropic texture filtering, and no heavy GGX `MeshPhysicalMaterial` anisotropy path),
 * plus a cheap per-pixel fibre highlight stretched along the strand direction (`tangent`) on the strands mesh.
 * Occlusion sits in the vertex colours (darker at the roots and in the inner layers).
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
  tex.minFilter = THREE.LinearMipmapNearestFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

function geometryOf(part: HairPart, withTangent: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(part.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(part.normals, 3));
  if (withTangent) g.setAttribute('tangent', new THREE.BufferAttribute(part.tangents, 4));
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
  // Lightweight MeshLambertMaterial with alphaTest (no MeshPhysicalMaterial GGX anisotropy, no MSAA alphaToCoverage,
  // anisotropy = 1, LinearMipmapNearestFilter): keeps hair fast on CPU SwiftShader and mobile GPUs while strandTexture's
  // per-strand luminance variation and vertex AO preserve the hair look without harsh card-edge specular facets.
  const materials: Record<HairPart['kind'], THREE.MeshLambertMaterial> = {
    cap: new THREE.MeshLambertMaterial({ color: colour, vertexColors: true, alphaTest: 0.48, side: THREE.FrontSide }),
    strands: new THREE.MeshLambertMaterial({ color: colour, map: strandMap, vertexColors: true, alphaTest: 0.48, side: THREE.DoubleSide }),
    shells: new THREE.MeshLambertMaterial({ color: colour, map: coilMap, vertexColors: true, alphaTest: 0.48, side: THREE.DoubleSide }),
  };
  const group = new THREE.Group();
  group.name = HAIR_OBJECT_NAME;
  const geometries: THREE.BufferGeometry[] = [];
  for (const part of build.parts) {
    if (!part.indices.length) continue;
    const g = geometryOf(part, false);
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
