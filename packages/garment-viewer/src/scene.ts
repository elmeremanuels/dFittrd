/**
 * three.js side of the spike viewer: one stage (renderer, camera, orbit controls, light) and one
 * figure per shown size (avatar + garment). Units are cm, +Y up, +Z front, like the mannequin.
 * Forked from spikes/garment-engine/viewer/src/scene.ts without the outline comparison (no Line2).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HAIR_SHADE, type Mesh } from '@curtain/mannequin';
import type { ViewerMaterial } from './engine';
import { faceOverlayGeometry, faceTextureOf, isFaceTexture, type FaceTexture } from './faceOverlay';
import { binarise, cleanDepth, cleanNormals, flipRows, hexOf, rowOf, type ViewerPasses } from './passes';

/**
 * `classic`: the look every garment has had so far (ACES tone mapping, a warm ground bounce).
 * `neutral`: white lights, a grey ground bounce and a tone curve that leaves colours alone below
 * the highlights (`TRUE_TONE_GLSL`), set so that a matt surface facing the camera is rendered in
 * its own colour (`frontIrradiance` = π), for skin and garment colours that are not shifted. It
 * changes how every garment looks, so it is opt-in.
 * `neutral-v2`: the `neutral` lights and tone curve, plus what keeps a light skin from vanishing
 * against the cream backdrop (`LOOK_EXTRAS`): a thin outline where bare skin meets the backdrop or
 * the floor, in the skin colour darkened until it stands out `outlineContrast` (4.5:1) from the
 * backdrop and the floor (the rule of the 2D figure's `figureOutline`, with more margin), a soft
 * contact shadow under the feet, and a weak light from the floor (`bounce`) that reaches only
 * surfaces facing down (under the jaw, the chin, the arms). Pixels of skin and garment that face the
 * camera are the `neutral` ones. Opt-in, like `neutral`.
 */
export type Lighting = 'classic' | 'neutral' | 'neutral-v2';

/** The lighting a host asked for: anything that is not one of the three is `classic`. */
export function lightingOf(value: unknown): Lighting {
  return value === 'neutral' || value === 'neutral-v2' ? value : 'classic';
}

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
  'neutral-v2': { toneMapping: 'true-tone', sky: 0xffffff, ground: 0x9a9a9a, hemisphere: 1.5, key: 2.9, rim: 1.1, floor: '#CEC7BC' },
};

/** The backdrop of every stage (handoff §7 cream). */
export const BACKDROP_HEX = '#F5EFE7';

/**
 * What a lighting adds to the lights, for the contrast of the figure against the backdrop.
 * - `outline`: width in CSS px of a line drawn where bare skin meets the backdrop or the floor
 *   (not where it meets the garment), in `outlineColour(skin, …, outlineContrast)`; 0 = none.
 * - `contactShadow`: opacity of a soft shadow on the floor under the feet; 0 = none.
 * - `backdrop`: `cream`, or `adaptive`: a soft panel behind the figure, darkened from the cream until
 *   it stands out `CONTRAST_TARGET` from the skin colour (only for skins that need it).
 * - `rim`: intensity of an extra light from behind each side, which lights the edges of the figure.
 * - `bounce`: intensity of a light straight up from the floor, the cream floor's bounce. It adds
 *   nothing to a surface facing the camera (its normal is level), so the colour patches stay the
 *   `neutral` ones; it lifts the underside of the jaw, which under the lights alone read as a dark
 *   band, a chin strap, at phone size (review of 18 Nov 2026).
 * `outline`, `contactShadow` and `bounce` are on in `neutral-v2`; the other two were tried for the look
 * review (spikes/garment-engine/viewer/look-v2-renders.mjs) and are kept for that comparison.
 */
export interface LookExtras {
  outline: number;
  /** The contrast the outline colour is chosen for, against the cream and the floor. */
  outlineContrast: number;
  contactShadow: number;
  backdrop: 'cream' | 'adaptive';
  rim: number;
  bounce: number;
}
/** `neutral-v2`'s floor bounce (see `LookExtras.bounce`; measured in look-v2-renders.mjs, section neck). */
const BOUNCE_V2 = 1.0;
const NONE: LookExtras = { outline: 0, outlineContrast: 3.2, contactShadow: 0, backdrop: 'cream', rim: 0, bounce: 0 };
export const LOOK_EXTRAS: Readonly<Record<Lighting, LookExtras>> = {
  classic: NONE,
  neutral: NONE,
  // 4.5, not 3.2: the line is anti-aliased and the skin at the silhouette is shaded darker than its swatch, so a line
  // chosen for 3.2 left 28 to 36 % of the edge under 3:1 (measured, look-v2-renders.mjs); at 4.5, 3 to 5 % (with the
  // multisampled mask; 5 to 7 % before it).
  'neutral-v2': { outline: 1.25, outlineContrast: 4.5, contactShadow: 0.32, backdrop: 'cream', rim: 0, bounce: BOUNCE_V2 },
};

/** The contrast the outline (and the adaptive backdrop) is chosen for: 3:1 and a little margin, as the 2D figure. */
export const CONTRAST_TARGET = 3.2;

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
/** WCAG relative luminance of `#rrggbb`. */
export function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastOf(a: string, b: string): number {
  const la = relativeLuminance(a), lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** `#rrggbb` with every channel scaled by `k` (0..1). */
export function scaleHex(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return `#${((c(n >> 16) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, '0')}`;
}

/**
 * The floor of the `neutral` rigs as it comes out on screen (measured in headless Chromium: the
 * floor colour `#CEC7BC` lit from above). The outline must stand out from it as well as from the
 * cream, since the legs and feet are seen against the floor.
 */
export const FLOOR_SEEN_HEX = '#DDD6CA';

/**
 * The outline colour on a skin colour: null (no outline) when the skin colour already stands out
 * `CONTRAST_TARGET` from the backdrop and the floor (Monk 7 to 10), else the skin colour darkened,
 * keeping its hue, until it does. On the lightest swatches that is a mid brown-grey: the line, not
 * the skin, stands out from the cream, and the skin stands out from the line.
 */
export function outlineColour(skinHex: string, backdrops: readonly string[] = [BACKDROP_HEX, FLOOR_SEEN_HEX], target: number = CONTRAST_TARGET): string | null {
  const enough = (c: string): boolean => backdrops.every((b) => contrastOf(c, b) >= target);
  if (enough(skinHex)) return null;
  for (let k = 0.99; k > 0.02; k -= 0.01) {
    const c = scaleHex(skinHex, k);
    if (enough(c)) return c;
  }
  return '#1a1612';
}

/** The adaptive backdrop behind a skin colour: the cream, darkened until it stands out `CONTRAST_TARGET` from the skin (the cream itself when it already does). */
export function adaptiveBackdrop(skinHex: string, backdrop: string = BACKDROP_HEX): string {
  for (let k = 1; k > 0.02; k -= 0.01) {
    const c = scaleHex(backdrop, k);
    if (contrastOf(c, skinHex) >= CONTRAST_TARGET) return c;
  }
  return '#1a1612';
}

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

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
/** `#rrggbb` as 0..1 channels, not converted (for a shader that writes sRGB as it is). */
const hexRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

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
  /** Override the lighting's `LOOK_EXTRAS` (the look comparison only; hosts use `lighting`). */
  extras?: Partial<LookExtras>;
}

/** Roles of the objects in a scene for the outline's mask: bare skin, the stage's own (floor, shadow, backdrop), anything else. */
const ROLE = 'curtainRole';

const OUTLINE_VERTEX = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// The mask, drawn with the same multisampling as the frame: red = how much of the pixel is bare skin, green = how much is
// something else of the figure (the garment), the rest is backdrop and floor. A pixel within `radius` px of skin gets the
// outline colour over the part of it that is not skin or garment, its alpha falling off over the last pixel (no hard
// steps). The skin's own edge pixels, which the frame blends with the cream, are covered too: with a mask drawn without
// multisampling they counted as skin and showed a light, dotted gap between the skin and the line (review, 18 Nov 2026).
const OUTLINE_FRAGMENT = `uniform sampler2D mask;
uniform vec2 texel;
uniform float radius;
uniform vec3 colour;
varying vec2 vUv;
float skinAt(vec2 o) { return step(0.5, texture2D(mask, vUv + o * texel).r); }
void main() {
  vec4 here = texture2D(mask, vUv);
  float open = clamp(1.0 - here.r - here.g, 0.0, 1.0);
  if (open < 0.02) discard;
  float near = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    near = max(near, skinAt(vec2(cos(a), sin(a)) * radius));
  }
  if (near < 0.5 && here.r < 0.02) discard;
  float d = here.r >= 0.02 ? 0.0 : radius + 1.0;
  for (int i = 0; i < 16; i++) {
    float a = float(i) * 0.392699;
    vec2 dir = vec2(cos(a), sin(a));
    for (int k = 1; k <= 4; k++) {
      float r = radius * float(k) / 4.0;
      if (skinAt(dir * r) > 0.5) { d = min(d, r); break; }
    }
  }
  // Over a pixel that is partly skin the line takes four times the open share: the cream the frame blended in is
  // covered (what is left of it is at most a sixteenth of the pixel) at the cost of a sliver of the skin's edge.
  float alpha = (1.0 - smoothstep(radius - 0.75, radius + 0.5, d)) * min(1.0, 4.0 * open);
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(colour, alpha);
}`;

/** A soft round spot for the contact shadow and the adaptive backdrop, as an `alphaMap` (three reads its green channel). */
function radialTexture(size: number, falloff: (r: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
      const i = 4 * (y * size + x);
      data[i] = data[i + 1] = data[i + 2] = Math.round(255 * Math.max(0, Math.min(1, falloff(r))));
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 5, 5000);
  readonly controls: OrbitControls;
  readonly lighting: Lighting;
  readonly extras: LookExtras;
  private readonly canvas: HTMLCanvasElement;
  private skinHex: string = DEFAULT_BODY_HEX;
  /** The outline drawn now (null: none, because the lighting has none or the skin needs none). */
  private outlineHex: string | null = null;
  private outlinePass: { target: THREE.WebGLRenderTarget; quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; camera: THREE.OrthographicCamera; skin: THREE.MeshBasicMaterial; other: THREE.MeshBasicMaterial; otherDouble: THREE.MeshBasicMaterial } | null = null;
  private backdropPanel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;

  constructor(canvas: HTMLCanvasElement, options: StageOptions = {}) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.lighting = lightingOf(options.lighting);
    const rig = LIGHTING_RIGS[this.lighting];
    this.extras = { ...LOOK_EXTRAS[this.lighting], ...options.extras };
    this.renderer.toneMapping = rig.toneMapping !== 'true-tone' ? THREE.ACESFilmicToneMapping : installTrueTone() ? THREE.CustomToneMapping : THREE.NeutralToneMapping;
    this.scene.background = new THREE.Color(BACKDROP_HEX);
    this.scene.add(new THREE.HemisphereLight(rig.sky, rig.ground, rig.hemisphere));
    const key = new THREE.DirectionalLight(0xffffff, rig.key);
    key.position.set(...KEY_POSITION);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, rig.rim);
    rim.position.set(...RIM_POSITION);
    this.scene.add(rim);
    if (this.extras.rim > 0) {
      for (const side of [-1, 1]) {
        const edge = new THREE.DirectionalLight(0xffffff, this.extras.rim);
        edge.position.set(side * 300, 160, -120);
        this.scene.add(edge);
      }
    }
    if (this.extras.bounce > 0) {
      // Straight up: a level normal (a surface facing the camera) gets none of it.
      const bounce = new THREE.DirectionalLight(0xffffff, this.extras.bounce);
      bounce.position.set(0, -100, 0);
      this.scene.add(bounce);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(400, 64), new THREE.MeshStandardMaterial({ color: rig.floor, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.userData[ROLE] = 'stage';
    this.scene.add(floor);
    if (this.extras.contactShadow > 0) {
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(70, 46),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: this.extras.contactShadow, depthWrite: false, alphaMap: radialTexture(64, (r) => Math.max(0, 1 - (r / 0.9) ** 2) ** 2), toneMapped: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.05;
      shadow.renderOrder = 1;
      shadow.userData[ROLE] = 'stage';
      this.scene.add(shadow);
    }
    if (this.extras.backdrop === 'adaptive') {
      const panel = new THREE.Mesh(
        new THREE.PlaneGeometry(260, 300),
        new THREE.MeshBasicMaterial({ color: BACKDROP_HEX, transparent: true, depthWrite: false, alphaMap: radialTexture(128, (r) => 1 - smoothstep(0.55, 1, r)), toneMapped: false, fog: false }),
      );
      panel.position.set(0, 100, -90);
      panel.userData[ROLE] = 'stage';
      this.backdropPanel = panel;
      this.scene.add(panel);
    }
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = options.controls !== false;
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 80;
    this.controls.maxDistance = 1400;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.autoRotate = options.autoRotate === true;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener('start', () => {
      this.dragging = true;
    });
    this.controls.addEventListener('end', () => {
      this.dragging = false;
    });
    this.frame(60);
    this.setSkinTone(null);
  }

  /** Mark a mesh as bare skin (the outline is drawn where it meets the backdrop). */
  markSkin(mesh: THREE.Object3D): void {
    mesh.userData[ROLE] = 'skin';
  }

  /** The skin colour on the figure (null: the default grey), for the outline and the adaptive backdrop. */
  setSkinTone(hex: string | null): void {
    this.skinHex = parseSkinHex(hex) ?? DEFAULT_BODY_HEX.toLowerCase();
    if (this.backdropPanel) {
      const c = adaptiveBackdrop(this.skinHex);
      this.backdropPanel.material.color.set(c);
      this.backdropPanel.visible = c.toLowerCase() !== BACKDROP_HEX.toLowerCase();
    }
    this.outlineHex = this.extras.outline > 0 ? outlineColour(this.skinHex, undefined, this.extras.outlineContrast) : null;
    if (this.outlinePass && this.outlineHex) this.outlinePass.quad.material.uniforms.colour!.value = new THREE.Color().setRGB(...hexRgb(this.outlineHex));
  }

  /** What the extras draw now: the outline colour (null: no outline) and the backdrop behind the figure. */
  lookNow(): { lighting: Lighting; extras: LookExtras; outline: string | null; backdrop: string } {
    return {
      lighting: this.lighting,
      extras: { ...this.extras },
      outline: this.outlineHex,
      backdrop: this.backdropPanel?.visible ? `#${this.backdropPanel.material.color.getHexString()}` : BACKDROP_HEX,
    };
  }

  private ensureOutline(): NonNullable<Stage['outlinePass']> {
    if (this.outlinePass) return this.outlinePass;
    // Multisampled as the frame (`antialias: true`), so the mask's edge pixels carry the share of skin the frame blended.
    const target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, samples: 4, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { mask: { value: target.texture }, texel: { value: new THREE.Vector2(1, 1) }, radius: { value: 2 }, colour: { value: new THREE.Color().setRGB(...hexRgb(this.outlineHex ?? '#000000')) } },
        vertexShader: OUTLINE_VERTEX,
        fragmentShader: OUTLINE_FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    quad.frustumCulled = false;
    const flat = (r: number, g: number, side: THREE.Side = THREE.FrontSide): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({ toneMapped: false, side });
      m.color.setRGB(r, g, 0, THREE.LinearSRGBColorSpace);
      return m;
    };
    this.outlinePass = { target, quad, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), skin: flat(1, 0), other: flat(0, 1), otherDouble: flat(0, 1, THREE.DoubleSide) };
    return this.outlinePass;
  }

  /** The outline: a mask of skin / other / backdrop, then the line over the frame just drawn. */
  private drawOutline(): void {
    const o = this.ensureOutline();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (o.target.width !== size.x || o.target.height !== size.y) o.target.setSize(size.x, size.y);
    // Both passes only cover the screen box of the bare skin (and the line's width round it): on a software renderer
    // the full-screen pass made a frame about five times as slow.
    const box = this.skinBox(size, this.extras.outline * this.renderer.getPixelRatio() + 3);
    if (!box) return;
    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[], boolean][] = [];
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const role = mesh.userData[ROLE] as string | undefined;
      const mat = mesh.material as THREE.Material;
      swapped.push([mesh, mesh.material, mesh.visible]);
      if (role === 'stage') mesh.visible = false;
      else mesh.material = role === 'skin' ? o.skin : mat.side === THREE.DoubleSide ? o.otherDouble : o.other;
    });
    const background = this.scene.background;
    this.scene.background = null;
    const toneMapping = this.renderer.toneMapping;
    this.renderer.toneMapping = THREE.NoToneMapping;
    o.target.scissor.set(box.x, box.y, box.w, box.h);
    o.target.scissorTest = true;
    o.target.viewport.set(0, 0, size.x, size.y);
    this.renderer.setRenderTarget(o.target);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.toneMapping = toneMapping;
    this.scene.background = background;
    for (const [mesh, material, visible] of swapped) {
      mesh.material = material;
      mesh.visible = visible;
    }
    const u = o.quad.material.uniforms;
    (u.texel!.value as THREE.Vector2).set(1 / size.x, 1 / size.y);
    u.radius!.value = this.extras.outline * this.renderer.getPixelRatio();
    const autoClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    const pr = this.renderer.getPixelRatio();
    this.renderer.setScissor(box.x / pr, box.y / pr, box.w / pr, box.h / pr);
    this.renderer.setScissorTest(true);
    this.renderer.render(o.quad, o.camera);
    this.renderer.setScissorTest(false);
    this.renderer.autoClear = autoClear;
  }

  /** The bare skin's box on the drawing buffer (device px, origin bottom left), grown by `pad`; null when none is in view. */
  private skinBox(size: THREE.Vector2, pad: number): { x: number; y: number; w: number; h: number } | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const v = new THREE.Vector3();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData[ROLE] !== 'skin' || !mesh.visible) return;
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox!;
      mesh.updateWorldMatrix(true, false);
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).applyMatrix4(mesh.matrixWorld).project(this.camera);
        const px = ((v.x + 1) / 2) * size.x, py = ((v.y + 1) / 2) * size.y;
        x0 = Math.min(x0, px);
        x1 = Math.max(x1, px);
        y0 = Math.min(y0, py);
        y1 = Math.max(y1, py);
      }
    });
    const x = Math.max(0, Math.floor(x0 - pad)), y = Math.max(0, Math.floor(y0 - pad));
    const w = Math.min(size.x, Math.ceil(x1 + pad)) - x, h = Math.min(size.y, Math.ceil(y1 + pad)) - y;
    return w > 0 && h > 0 ? { x, y, w, h } : null;
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

  /** Draw a frame. `final`: the last frame before the view goes still, always with the outline. */
  render(final = false): void {
    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    // The outline is left out while the view turns: while the shopper's finger or mouse drags it and while it damps
    // out after the release (on a software renderer such a frame was four to five times as slow). It is drawn on every
    // frame the camera is still (a drape settling, a size switch) and always on the frame a view stops on.
    const e = this.camera.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) if (Math.abs(e[i]! - this.lastView[i]!) > 1e-6) moved = true;
    this.lastView.splice(0, 16, ...e);
    if (this.outlineHex && (final || (!this.dragging && !moved))) this.drawOutline();
  }

  /** Between the orbit controls' `start` and `end`: the shopper is turning the view. */
  private dragging = false;
  /** The camera of the last frame drawn (its world matrix), to tell a turning view from a still one. */
  private readonly lastView: number[] = new Array<number>(16).fill(Number.NaN);

  /** Screen position (CSS px within the canvas) of a world point, for labels. */
  toScreen(p: THREE.Vector3): { x: number; y: number } {
    return projectToCanvas(this.camera, p, this.canvas.clientWidth, this.canvas.clientHeight);
  }
}

/**
 * The hair colour of head v3 for a skin colour: a dark brown (`HAIR_HEX`), never lighter than the
 * skin's own hair shade (the skin times the mesh's hair shade), so on a deep skin tone the hair is
 * that darker skin colour, as without this. Linear channels 0..1. Display only, like the skin.
 */
export const HAIR_HEX = '#3f3027';
export function hairLinear(skinHex: string, hairShade = HAIR_SHADE): [number, number, number] {
  const skin = hexRgb(skinHex).map(srgbToLinear);
  const base = hexRgb(HAIR_HEX).map(srgbToLinear);
  const k = srgbToLinear(hairShade);
  return [0, 1, 2].map((c) => Math.min(base[c]!, k * skin[c]!)) as [number, number, number];
}

/**
 * Give the hair of a head v3 geometry its colour for this skin (`#rrggbb`), or none (null: the grey
 * mannequin keeps grey hair, the skin times its shade). The vertex colour multiplies the material's
 * skin colour, so on the hair it becomes hair colour / skin colour, mixed in by the hair's cover and
 * keeping the mesh's shade within the hair (its locks). A geometry without hair is left alone.
 */
export function tintHair(g: THREE.BufferGeometry, skinHex: string | null, hairShade = HAIR_SHADE): void {
  const hair = g.getAttribute('hair') as THREE.BufferAttribute | undefined;
  const base = g.userData.shadeLinear as Float32Array | undefined;
  const colour = g.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!hair || !base || !colour) return;
  const c = colour.array as Float32Array;
  const h = hair.array as Float32Array;
  const ratio = [1, 1, 1];
  if (skinHex) {
    const skin = hexRgb(skinHex).map(srgbToLinear);
    const want = hairLinear(skinHex, hairShade);
    const k = srgbToLinear(hairShade);
    for (let ch = 0; ch < 3; ch++) ratio[ch] = want[ch]! / Math.max(1e-6, k * skin[ch]!);
  }
  for (let i = 0; i < h.length; i++) {
    for (let ch = 0; ch < 3; ch++) c[3 * i + ch] = base[i]! * (1 + h[i]! * (ratio[ch]! - 1));
  }
  colour.needsUpdate = true;
}

export function meshGeometry(mesh: Pick<Mesh, 'positions' | 'indices'> & { shade?: Float32Array | undefined; hair?: Float32Array | undefined }): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3));
  // The v2 head's shade (brows, lash line, iris) as a vertex colour that multiplies the skin colour.
  if (mesh.shade) {
    const c = new Float32Array(mesh.shade.length * 3);
    for (let i = 0; i < mesh.shade.length; i++) {
      // Linear, as three reads vertex colours: the sRGB shade s is s^2.2-ish in linear light.
      const v = srgbToLinear(mesh.shade[i]!);
      c[3 * i] = c[3 * i + 1] = c[3 * i + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    if (mesh.hair) {
      // Head v3: the hair's cover per vertex, and the shade it is mixed into (`tintHair`).
      g.setAttribute('hair', new THREE.BufferAttribute(Float32Array.from(mesh.hair), 1));
      g.userData.shadeLinear = Float32Array.from(mesh.shade, srgbToLinear);
    }
  }
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.computeVertexNormals();
  return g;
}

/** The mannequin's colour when no skin tone is chosen: the mid-grey every figure has had. */
export const DEFAULT_BODY_HEX = '#8C8C8C';
const BODY_MATERIAL = new THREE.MeshStandardMaterial({ color: DEFAULT_BODY_HEX, roughness: 0.75, metalness: 0 });
/** The same grey for a body with a shade per vertex (the v2 head). */
const BODY_MATERIAL_SHADED = new THREE.MeshStandardMaterial({ color: DEFAULT_BODY_HEX, roughness: 0.75, metalness: 0, vertexColors: true });
const shaded = (g: THREE.BufferGeometry): boolean => g.getAttribute('color') !== undefined;

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
    this.body = new THREE.Mesh(bodyGeometry, shaded(bodyGeometry) ? BODY_MATERIAL_SHADED : BODY_MATERIAL);
    this.body.userData[ROLE] = 'skin';
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
    tintHair(geometry, this.skin ? this.skinColour : null);
    if (this.skin && this.skin.vertexColors !== shaded(geometry)) {
      // A material's shader is built for vertex colours or without: switching needs a rebuild.
      this.skin.vertexColors = shaded(geometry);
      this.skin.needsUpdate = true;
    }
    else this.body.material = shaded(geometry) ? BODY_MATERIAL_SHADED : BODY_MATERIAL;
  }

  private skin: THREE.MeshPhysicalMaterial | null = null;
  /** The skin colour of `skin`, `#rrggbb` (for the hair of head v3). */
  private skinColour: string | null = null;

  /**
   * The skin colour of this figure's body (`#rrggbb`), or null (or anything that is not such a
   * colour) for the default grey. A figure with a skin colour has a material of its own; the
   * grey one is shared and never changed, so no other figure is affected.
   */
  setSkin(hex: string | null): void {
    const colour = parseSkinHex(hex);
    tintHair(this.body.geometry, colour);
    this.skinColour = colour;
    if (!colour) {
      this.body.material = shaded(this.body.geometry) ? BODY_MATERIAL_SHADED : BODY_MATERIAL;
      this.skin?.dispose();
      this.skin = null;
      return;
    }
    // A skin colour gets less white reflection than the grey mannequin (`SKIN_SPECULAR`): on a deep tone the grey
    // material's reflection alone lifted the colour by 4 to 9 L* (measured, avatar-renders.mjs).
    if (!this.skin) this.skin = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.75, metalness: 0, specularIntensity: SKIN_SPECULAR, vertexColors: shaded(this.body.geometry) });
    else this.skin.color.set(colour);
    this.body.material = this.skin;
  }

  /** The shopper's face over the v2 head (slice 6 spike), or null. */
  face: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> | null = null;

  /**
   * Lay a face texture (baked on the device, `faceOverlay.ts`) over the front of the head, or take
   * it off (null). `faceUv` is `faceUvOf` of the body's mesh (null for a head without the face frame:
   * then nothing is shown). The body and its material are not changed.
   */
  setFace(face: FaceTexture | null | undefined, faceUv: Float32Array | null): void {
    if (this.face) {
      this.group.remove(this.face);
      this.face.geometry.dispose();
      this.face.material.map?.dispose();
      this.face.material.dispose();
      this.face = null;
    }
    if (!isFaceTexture(face) || !faceUv) return;
    const g = faceOverlayGeometry(this.body.geometry, faceUv);
    if (!g) return;
    const material = new THREE.MeshPhysicalMaterial({
      map: faceTextureOf(face),
      roughness: 0.75,
      metalness: 0,
      specularIntensity: SKIN_SPECULAR,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      // Drawn on the head's own surface: pulled towards the camera so the head never shows through.
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(g, material);
    mesh.userData[ROLE] = 'skin';
    mesh.renderOrder = 1;
    this.face = mesh;
    this.group.add(mesh);
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
    this.setFace(null, null);
    this.garment.geometry.dispose();
    this.garment.material.dispose();
    this.skin?.dispose();
    this.skin = null;
  }
}

/** What `renderPasses` needs besides the stage and the figure. */
export interface PassRequest {
  width: number;
  height: number;
  statureCm: number;
  /** World y of the waist and hip rings (cm). */
  waistY: number;
  hipY: number;
  /** Neighbouring size's garment positions (per particle), or null. */
  neighbour: { size: string; pos: Float32Array } | null;
  /** The garment's positions on screen now, to restore after the neighbour mask. */
  current: Float32Array | null;
  size: string;
  garmentHex: string;
}

const DEPTH_VERTEX = /* glsl */ `varying float vViewZ;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vViewZ = -mv.z; gl_Position = projectionMatrix * mv; }`;
const DEPTH_FRAGMENT = /* glsl */ `uniform float uNear; uniform float uFar; varying float vViewZ;
void main() { float t = clamp((uFar - vViewZ) / max(1e-3, uFar - uNear), 0.0, 1.0); gl_FragColor = vec4(vec3(mix(1.0 / 255.0, 1.0, t)), 1.0); }`;

/**
 * Draw the render passes of the AI realism layer (passes.ts) from the front camera, then put the
 * view back as it was. The colour pass is the screen's own drawing (same tone mapping); the other
 * passes go to a render target without multisampling, so masks come out exactly black and white.
 * The face texture and the picked skin colour are taken off for the colour pass (standard head and
 * body colour) and put back after.
 */
export function renderPasses(stage: Stage, figure: Figure, req: PassRequest): ViewerPasses {
  const { renderer, scene, camera, controls } = stage;
  const { width: w, height: h } = req;
  // Save the view.
  const saved = {
    pos: camera.position.clone(),
    target: controls.target.clone(),
    aspect: camera.aspect,
    ratio: renderer.getPixelRatio(),
    size: renderer.getSize(new THREE.Vector2()),
    background: scene.background,
    bodyMaterial: figure.body.material,
    garmentMaterial: figure.garment.material,
    faceVisible: figure.face?.visible ?? false,
  };
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData[ROLE] === 'stage' && o.visible) {
      o.visible = false;
      hidden.push(o);
    }
  });
  if (figure.face) figure.face.visible = false;
  figure.body.material = shaded(figure.body.geometry) ? BODY_MATERIAL_SHADED : BODY_MATERIAL;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    stage.frame(60, req.statureCm);
    camera.updateMatrixWorld();
    scene.background = new THREE.Color(BACKDROP_HEX);

    // Colour: the screen drawing, read from the drawing buffer (preserveDrawingBuffer is on).
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const colourRaw = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, colourRaw);
    const colour = flipRows(colourRaw, w, h);

    const target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, samples: 0, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const read = (): Uint8Array => {
      const buf = new Uint8Array(w * h * 4);
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, w, h, buf);
      renderer.setRenderTarget(null);
      return flipRows(buf, w, h);
    };
    scene.background = new THREE.Color(0x000000);
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, toneMapped: false });
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, toneMapped: false });
    const normalMat = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    const box = new THREE.Box3().setFromObject(figure.group);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = camera.position.distanceTo(sphere.center);
    const depthMat = new THREE.ShaderMaterial({ uniforms: { uNear: { value: dist - sphere.radius }, uFar: { value: dist + sphere.radius } }, vertexShader: DEPTH_VERTEX, fragmentShader: DEPTH_FRAGMENT, side: THREE.DoubleSide });
    try {
      figure.body.material = white;
      figure.garment.material = white as unknown as THREE.MeshPhysicalMaterial;
      const figureMask = binarise(read());
      figure.body.material = black;
      const garmentMask = binarise(read());
      figure.body.material = depthMat;
      figure.garment.material = depthMat as unknown as THREE.MeshPhysicalMaterial;
      const depth = cleanDepth(read(), figureMask);
      figure.body.material = normalMat;
      figure.garment.material = normalMat as unknown as THREE.MeshPhysicalMaterial;
      const normal = cleanNormals(read(), figureMask);
      let neighbour: ViewerPasses['neighbour'] = null;
      if (req.neighbour) {
        figure.setPositions(req.neighbour.pos);
        figure.body.material = black;
        figure.garment.material = white as unknown as THREE.MeshPhysicalMaterial;
        neighbour = { size: req.neighbour.size, garmentMask: { width: w, height: h, data: binarise(read()) } };
        if (req.current) figure.setPositions(req.current);
      }
      const project = (y: number): number => rowOf(projectToCanvas(camera, new THREE.Vector3(0, y, 0), w, h).y, h);
      return {
        kind: 'renderPasses',
        width: w,
        height: h,
        size: req.size,
        colour: { width: w, height: h, data: colour },
        depth: { width: w, height: h, data: depth },
        normal: { width: w, height: h, data: normal },
        garmentMask: { width: w, height: h, data: garmentMask },
        figureMask: { width: w, height: h, data: figureMask },
        neighbour,
        meta: { statureCm: req.statureCm, waistRow: project(req.waistY), hipRow: project(req.hipY), backdropHex: hexOf(colour[0]!, colour[1]!, colour[2]!), garmentHex: req.garmentHex },
      };
    } finally {
      target.dispose();
      white.dispose();
      black.dispose();
      normalMat.dispose();
      depthMat.dispose();
    }
  } finally {
    // Put the view back.
    scene.background = saved.background;
    for (const o of hidden) o.visible = true;
    if (figure.face) figure.face.visible = saved.faceVisible;
    figure.body.material = saved.bodyMaterial;
    figure.garment.material = saved.garmentMaterial;
    renderer.setPixelRatio(saved.ratio);
    renderer.setSize(saved.size.x, saved.size.y, false);
    camera.aspect = saved.aspect;
    camera.updateProjectionMatrix();
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    controls.update();
    stage.render(true);
  }
}
