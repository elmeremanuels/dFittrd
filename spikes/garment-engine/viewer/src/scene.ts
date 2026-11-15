/**
 * three.js side of the spike viewer: one stage (renderer, camera, orbit controls, light) and one
 * figure per shown size (avatar + garment). Units are cm, +Y up, +Z front, like the mannequin.
 * WebGL2 only in the spike; WebGPU and the drawn-overlay fallback belong to packages/garment-viewer.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Mesh } from '@curtain/mannequin';
import type { ViewerMaterial } from './engine';

/**
 * `classic`: the look every garment has had so far (ACES tone mapping, a warm ground bounce).
 * `neutral`: white lights, a grey ground bounce and a tone curve that leaves colours alone below
 * the highlights (`TRUE_TONE_GLSL`), set so that a matt surface facing the camera is rendered in
 * its own colour (`frontIrradiance` = π), for skin and garment colours that are not shifted. It
 * changes how every garment looks, so it is opt-in.
 */
export type Lighting = 'classic' | 'neutral';

export interface LightingRig {
  toneMapping: 'aces' | 'true-tone';
  /** Hemisphere light: sky and ground colour (sRGB hex) and intensity. */
  sky: number;
  ground: number;
  hemisphere: number;
  /** Key light from the front, above and to the viewer's right; rim light from behind. */
  key: number;
  rim: number;
  /** Colour of the floor disc (sRGB). */
  floor: string;
}

export const KEY_POSITION = [150, 260, 320] as const;
export const RIM_POSITION = [-220, 180, -260] as const;

// The neutral floor is darker than the classic one: lit from above it gets more than π and is no longer greyed by
// ACES, so the classic colour came out almost the background's and the figure lost its ground.
export const LIGHTING_RIGS: Readonly<Record<Lighting, LightingRig>> = {
  classic: { toneMapping: 'aces', sky: 0xffffff, ground: 0x8a8076, hemisphere: 1.4, key: 2.2, rim: 1.1, floor: '#E9E1D6' },
  neutral: { toneMapping: 'true-tone', sky: 0xffffff, ground: 0x9a9a9a, hemisphere: 1.5, key: 2.9, rim: 1.1, floor: '#CEC7BC' },
};

/** Linear value where the `neutral` tone curve starts to compress highlights; below it a colour passes unchanged. */
export const TRUE_TONE_START = 0.9;

/**
 * The tone curve of the `neutral` lighting, in the slot three.js keeps for a custom one: the
 * highlight roll-off of the Khronos PBR Neutral curve (three's `NeutralToneMapping`) without its
 * offset in the darks. That offset makes up for the reflection of a bright surround, which this
 * scene does not have; with it, dark colours came out darker and more saturated than asked for
 * (measured on the deep skin tone). `trueTone` below is the same function for the tests.
 */
export const TRUE_TONE_GLSL = `vec3 CustomToneMapping( vec3 color ) {
	const float StartCompression = ${TRUE_TONE_START.toFixed(2)};
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}`;

/** `TRUE_TONE_GLSL` on linear RGB. */
export function trueTone(color: readonly [number, number, number]): [number, number, number] {
  const peak = Math.max(...color);
  if (peak < TRUE_TONE_START) return [color[0], color[1], color[2]];
  const d = 1 - TRUE_TONE_START;
  const newPeak = 1 - (d * d) / (peak + d - TRUE_TONE_START);
  const g = 1 - 1 / (0.15 * (peak - newPeak) + 1);
  return color.map((c) => (c * newPeak) / peak + (newPeak - (c * newPeak) / peak) * g) as [number, number, number];
}

const CUSTOM_SLOT = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
/**
 * Put `TRUE_TONE_GLSL` in three's custom tone-mapping slot (once). The slot is global to the page's
 * copy of three.js: any other renderer there that asks for `CustomToneMapping` gets this curve too
 * (renderers with another tone mapping are not affected). False when the slot is not there (a
 * three.js that renamed it) or holds someone else's curve: the stage then falls back to three's
 * own `NeutralToneMapping`, which also rolls highlights off, with slightly darker darks.
 */
export function installTrueTone(): boolean {
  const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  if (chunk.includes(TRUE_TONE_GLSL)) return true;
  if (!chunk.includes(CUSTOM_SLOT)) return false;
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.replace(CUSTOM_SLOT, TRUE_TONE_GLSL);
  return true;
}

/** Where `Stage.frame` puts the camera and its target (cm) for a canvas of the given aspect and vertical field of view. */
export function cameraFrame(widthCm: number, statureCm: number, aspect: number, fovDeg: number): { position: [number, number, number]; target: [number, number, number] } {
  // Up to 175 cm the frame is the one every figure has had; a taller typed body moves the camera back and up with it.
  const k = Math.max(1, statureCm / 175);
  const vfov = (fovDeg * Math.PI) / 180;
  const fitH = (205 * k) / 2 / Math.tan(vfov / 2);
  const fitW = (widthCm + 20) / 2 / Math.tan(vfov / 2) / Math.max(0.3, aspect);
  return { position: [0, 112 * k, Math.max(fitH, fitW)], target: [0, 98 * k, 0] };
}

/** Canvas position (CSS px from the top left of a `width` × `height` canvas) of a world point seen by `camera`. */
export function projectToCanvas(camera: THREE.Camera, p: THREE.Vector3, width: number, height: number): { x: number; y: number } {
  const v = p.clone().project(camera);
  return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * Irradiance (linear RGB) a rig puts on a surface that faces the camera's rest position (+Z).
 * three.js renders a matt surface as colour × irradiance / π before tone mapping, so π in every
 * channel means "its own colour".
 */
export function frontIrradiance(rig: LightingRig): [number, number, number] {
  const len = Math.hypot(...KEY_POSITION);
  const keyCos = KEY_POSITION[2] / len;
  return [16, 8, 0].map((shift) => {
    const sky = srgbToLinear(((rig.sky >> shift) & 255) / 255);
    const ground = srgbToLinear(((rig.ground >> shift) & 255) / 255);
    // A hemisphere light on a vertical surface: half sky, half ground. The rim light is behind it.
    return rig.hemisphere * 0.5 * (sky + ground) + rig.key * keyCos;
  }) as [number, number, number];
}

export interface StageOptions {
  /** Drag to rotate and wheel or pinch to zoom. */
  controls?: boolean;
  /** Turn the camera slowly around the figures (blind test). */
  autoRotate?: boolean;
  /** Lights and tone mapping; default `classic`, the look as before. */
  lighting?: Lighting;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 5, 5000);
  readonly controls: OrbitControls;
  readonly lighting: Lighting;
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, options: StageOptions = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const rig = LIGHTING_RIGS[options.lighting === 'neutral' ? 'neutral' : 'classic'];
    this.lighting = options.lighting === 'neutral' ? 'neutral' : 'classic';
    this.renderer.toneMapping = rig.toneMapping !== 'true-tone' ? THREE.ACESFilmicToneMapping : installTrueTone() ? THREE.CustomToneMapping : THREE.NeutralToneMapping;
    this.scene.background = new THREE.Color('#F5EFE7');
    this.scene.add(new THREE.HemisphereLight(rig.sky, rig.ground, rig.hemisphere));
    const key = new THREE.DirectionalLight(0xffffff, rig.key);
    key.position.set(...KEY_POSITION);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, rig.rim);
    rim.position.set(...RIM_POSITION);
    this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: rig.floor, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = options.controls !== false;
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 80;
    this.controls.maxDistance = 1400;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.autoRotate = options.autoRotate === true;
    this.controls.autoRotateSpeed = 1.2;
    this.frame(60);
  }

  /** Point the camera at figures spread over `widthCm` (front view). `statureCm` only matters for a body taller than the canonical ones. */
  frame(widthCm: number, statureCm = 0): void {
    const f = cameraFrame(widthCm, statureCm, this.camera.aspect, this.camera.fov);
    this.camera.position.set(...f.position);
    this.controls.target.set(...f.target);
    this.controls.update();
  }

  resize(): boolean {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return false;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x === w && size.y === h) return false;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    return true;
  }

  render(): void {
    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen position (CSS px within the canvas) of a world point, for labels. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    return projectToCanvas(this.camera, p, this.canvas.clientWidth, this.canvas.clientHeight);
  }
}

export function meshGeometry(mesh: Pick<Mesh, 'positions' | 'indices'>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeVertexNormals();
  return g;
}

/** The mannequin's colour when no skin tone is chosen: the mid-grey every figure has had. */
export const DEFAULT_BODY_HEX = '#8C8C8C';
const BODY_MATERIAL = new THREE.MeshStandardMaterial({ color: DEFAULT_BODY_HEX, roughness: 0.75, metalness: 0 });

/** Strength of the white reflection on a skin-coloured body (1 = the grey mannequin's). */
export const SKIN_SPECULAR = 0.3;

/** A `#rrggbb` colour, lower-cased, or null for anything else (the figure then keeps the default grey). */
export function parseSkinHex(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
}

/** A baked texture for a figure: render-mesh UVs and triangles, render vertex → particle, and the decoded image. */
export interface FigureTexture {
  uvs: Float32Array;
  indices: Uint32Array;
  remap: Uint32Array;
  image: ImageBitmap;
}

/** One THREE texture per decoded image, shared by every figure of the product. */
const TEXTURES = new WeakMap<ImageBitmap, THREE.Texture>();
function textureOf(image: ImageBitmap): THREE.Texture {
  let t = TEXTURES.get(image);
  if (!t) {
    t = new THREE.Texture(image);
    t.flipY = false; // glTF UVs: v down
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    TEXTURES.set(image, t);
  }
  return t;
}

export class Figure {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly garment: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private heatOn = false;
  /** Render vertex → particle when textured (UV seams duplicate particles), else null (one vertex per particle). */
  private readonly remap: Uint32Array | null;
  private readonly map: THREE.Texture | null;
  private readonly scratch: Float32Array | null;

  constructor(bodyGeometry: THREE.BufferGeometry, garmentIndices: Uint32Array, vertexCount: number, texture?: FigureTexture | null) {
    this.body = new THREE.Mesh(bodyGeometry, BODY_MATERIAL);
    const g = new THREE.BufferGeometry();
    const n = texture ? texture.remap.length : vertexCount;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    if (texture) g.setAttribute('uv', new THREE.BufferAttribute(texture.uvs, 2));
    g.setIndex(new THREE.BufferAttribute(texture ? texture.indices : garmentIndices, 1));
    this.remap = texture ? texture.remap : null;
    this.map = texture ? textureOf(texture.image) : null;
    this.scratch = texture ? new Float32Array(n * 3) : null;
    this.garment = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide }));
    this.garment.frustumCulled = false;
    this.group.add(this.body, this.garment);
  }

  /** Per-particle values (xyz or rgb) onto the render vertices. */
  private expand(perParticle: Float32Array): Float32Array {
    if (!this.remap || !this.scratch) return perParticle;
    const r = this.remap, out = this.scratch;
    for (let v = 0; v < r.length; v++) {
      const p = 3 * r[v]!;
      out[3 * v] = perParticle[p]!;
      out[3 * v + 1] = perParticle[p + 1]!;
      out[3 * v + 2] = perParticle[p + 2]!;
    }
    return out;
  }

  setBody(geometry: THREE.BufferGeometry): void {
    this.body.geometry = geometry;
  }

  private skin: THREE.MeshPhysicalMaterial | null = null;

  /**
   * The skin colour of this figure's body (`#rrggbb`), or null (or anything that is not such a
   * colour) for the default grey. A figure with a skin colour has a material of its own; the
   * grey one is shared and never changed, so no other figure is affected.
   */
  setSkin(hex: string | null): void {
    const colour = parseSkinHex(hex);
    if (!colour) {
      this.body.material = BODY_MATERIAL;
      this.skin?.dispose();
      this.skin = null;
      return;
    }
    // A skin colour gets less white reflection than the grey mannequin (`SKIN_SPECULAR`): on a deep tone the grey
    // material's reflection alone lifted the colour by 4 to 9 L* (measured, avatar-renders.mjs).
    if (!this.skin) this.skin = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.75, metalness: 0, specularIntensity: SKIN_SPECULAR });
    else this.skin.color.set(colour);
    this.body.material = this.skin;
  }

  /** The body colour shown now, `#rrggbb`. */
  get skinHex(): string {
    return `#${(this.body.material as THREE.MeshStandardMaterial).color.getHexString()}`;
  }

  setPositions(pos: Float32Array): void {
    const attr = this.garment.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(this.expand(pos));
    attr.needsUpdate = true;
    this.garment.geometry.computeVertexNormals();
    if (this.remap) {
      // Average the normals of the seam duplicates, or the UV seams show as a crease.
      const nAttr = this.garment.geometry.getAttribute('normal') as THREE.BufferAttribute;
      const nrm = nAttr.array as Float32Array;
      const r = this.remap;
      let particles = 0;
      for (let v = 0; v < r.length; v++) particles = Math.max(particles, r[v]! + 1);
      const acc = new Float32Array(particles * 3);
      for (let v = 0; v < r.length; v++) for (let c = 0; c < 3; c++) acc[3 * r[v]! + c] = acc[3 * r[v]! + c]! + nrm[3 * v + c]!;
      for (let v = 0; v < r.length; v++) {
        const p = 3 * r[v]!;
        const l = Math.hypot(acc[p]!, acc[p + 1]!, acc[p + 2]!) || 1;
        for (let c = 0; c < 3; c++) nrm[3 * v + c] = acc[p + c]! / l;
      }
      nAttr.needsUpdate = true;
    }
  }

  /** See-through garment, so outlines drawn over it stay readable (the silhouette comparison). */
  setFaded(faded: boolean): void {
    if (faded === this.faded) return;
    this.faded = faded;
    this.applyColour();
  }

  private faded = false;
  private baseOpacity = 1;

  /** Vertex colours of the heat map, or `null` for the fabric colour. */
  setHeat(colors: Float32Array | null): void {
    const on = colors !== null;
    if (colors) {
      const attr = this.garment.geometry.getAttribute('color') as THREE.BufferAttribute;
      (attr.array as Float32Array).set(this.expand(colors));
      attr.needsUpdate = true;
    }
    if (on !== this.heatOn) {
      this.heatOn = on;
      this.applyColour();
    }
  }

  private fabricColour = new THREE.Color('#cccccc');

  /**
   * PBR look from material.json or a preset: sheen and roughness from `sheen`, translucency from
   * `opacity` (kept ≥ 0.85 so the avatar does not show through as a spike artefact).
   */
  setMaterial(vm: ViewerMaterial): void {
    const m = this.garment.material;
    this.fabricColour = new THREE.Color(vm.baseColorHex);
    m.roughness = Math.min(1, Math.max(0.25, 0.95 - 0.8 * vm.sheen));
    m.sheen = Math.min(1, vm.sheen * 1.4);
    m.sheenRoughness = 0.25 + 0.5 * (1 - vm.sheen);
    m.sheenColor = new THREE.Color(0xffffff);
    this.baseOpacity = Math.max(0.85, Math.min(1, vm.opacity));
    this.applyColour();
  }

  private applyColour(): void {
    const m = this.garment.material;
    m.vertexColors = this.heatOn;
    // The baked texture is the garment's colour; the fit map replaces it while it is on.
    m.map = this.heatOn ? null : this.map;
    m.color = this.heatOn || this.map ? new THREE.Color(0xffffff) : this.fabricColour.clone();
    m.opacity = this.faded ? 0.3 : this.baseOpacity;
    m.transparent = m.opacity < 1;
    m.depthWrite = !this.faded;
    m.needsUpdate = true;
  }

  dispose(): void {
    this.garment.geometry.dispose();
    this.garment.material.dispose();
    this.skin?.dispose();
    this.skin = null;
  }
}

/** One silhouette outline per size, drawn on top of everything (no depth test) in the frontal plane. */
export interface OutlineSpec {
  size: string;
  points: readonly (readonly [number, number])[];
  color: string;
  dashed: boolean;
}

/**
 * Overlaid front silhouettes (the S/M/L comparison). Fat lines (`Line2`), since WebGL draws plain
 * lines one pixel wide; positioned like a figure (`group.position.x`), slightly in front of it.
 */
export class Outlines {
  readonly group = new THREE.Group();
  private lines: Line2[] = [];

  constructor(private readonly stage: Stage) {
    this.group.renderOrder = 10;
    stage.scene.add(this.group);
  }

  set(specs: readonly OutlineSpec[], x: number): void {
    this.clear();
    this.group.position.set(x, 0, 30);
    const size = this.stage.renderer.getSize(new THREE.Vector2());
    for (const spec of specs) {
      if (spec.points.length < 2) continue;
      const geometry = new LineGeometry();
      geometry.setPositions(spec.points.flatMap(([px, py]) => [px, py, 0]));
      const material = new LineMaterial({ color: spec.color, linewidth: 2.5, depthTest: false, transparent: true, dashed: spec.dashed, dashSize: 2.5, gapSize: 1.5 });
      material.resolution.set(size.x, size.y);
      const line = new Line2(geometry, material);
      if (spec.dashed) line.computeLineDistances();
      line.renderOrder = 10;
      this.lines.push(line);
      this.group.add(line);
    }
  }

  /** Keep the line width in pixels after a resize. */
  resize(): void {
    const size = this.stage.renderer.getSize(new THREE.Vector2());
    for (const l of this.lines) l.material.resolution.set(size.x, size.y);
  }

  clear(): void {
    for (const l of this.lines) {
      this.group.remove(l);
      l.geometry.dispose();
      l.material.dispose();
    }
    this.lines = [];
  }
}
