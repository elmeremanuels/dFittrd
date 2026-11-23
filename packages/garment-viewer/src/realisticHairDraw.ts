/**
 * The realistic body spike's hair (D28) as three.js meshes: `buildHair` of `realisticHair.ts` with its generated
 * textures, in one group named `HAIR_OBJECT_NAME` that the mount adds to the figure. Loaded with `import()` only when a
 * host passes `MountOptions.hair` with `bodyShape: 'realistic-spike'`, so the default viewer neither carries nor runs
 * it. No I/O at all: the geometry and the textures are computed here, on the device.
 *
 * v2 shading (WO-012): closed, opaque, `FrontSide` sculpted meshes with procedural groove/coil albedo + normal maps
 * and a soft matte-satin `MeshPhongMaterial` (broad low specular + vertex AO in roots, parting and crevices). Zero
 * `alphaTest`, zero `DoubleSide`, zero `alphaToCoverage` — enabling full Early-Z depth rejection on CPU SwiftShader
 * and mobile GPUs. The preserved v1 strand-card renderer remains available via `options.style = 'strand-cards'`.
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

function dataTexture(t: HairTexture, wrapS: boolean, wrapT: boolean, linear = false): THREE.DataTexture {
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
  tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
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

/** Soft, matte-velvet specular tint derived from hair colour (floored gently so black hair shows sculpted 3D form). */
function matteSpecularOf(colour: THREE.Color, strength: number): THREE.Color {
  const s = new THREE.Color().copy(colour).lerp(new THREE.Color(0x6b6058), 0.42).multiplyScalar(strength);
  s.r = Math.max(s.r, 0.055);
  s.g = Math.max(s.g, 0.05);
  s.b = Math.max(s.b, 0.046);
  return s;
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
    const albedoMap = dataTexture(pair.albedo, true, useCoilMaps, false);
    const normalMap = dataTexture(pair.normal, true, useCoilMaps, true);
    disposables.push(albedoMap, normalMap);
    texBytes = textureBytes(pair.albedo) + textureBytes(pair.normal);

    const specStrength = useCoilMaps ? 0.14 : 0.16;
    const shininess = useCoilMaps ? 7 : 10;
    const nScale = useCoilMaps ? 0.30 : 0.38;
    const specCol = matteSpecularOf(colour, specStrength);

    const makeSculpted = (scaleMul: number): THREE.MeshPhongMaterial =>
      new THREE.MeshPhongMaterial({
        color: colour,
        map: albedoMap,
        normalMap,
        normalScale: new THREE.Vector2(nScale * scaleMul, nScale * scaleMul),
        specular: specCol,
        shininess,
        vertexColors: true,
        side: THREE.FrontSide,
      });

    materials = {
      cap: makeSculpted(0.65),
      strands: makeSculpted(1.0),
      shells: makeSculpted(0.85),
    };
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
      for (const m of Object.values(materials)) m.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}
