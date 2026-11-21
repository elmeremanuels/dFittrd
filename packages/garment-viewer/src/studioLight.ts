/**
 * Studio light for the realistic body spike (`MountOptions.realisticSkin`, with `bodyShape: 'realistic-spike'`; off by
 * default, and the lighting rigs of `scene.ts` are not changed). An environment made in code, nothing downloaded: a
 * small scene (an inside-out sphere whose vertex colours are `studioRadiance`: a soft sky-to-floor gradient, a large
 * softbox up front on the key side, a weaker fill on the other side and a strip of light behind) turned into an
 * environment map by three's `PMREMGenerator`, plus one soft key light from the rigs' key direction. The tone stage
 * is the `neutral` rig's true-tone curve (`installTrueTone`), which keeps a skin colour's hue and chroma (the classic
 * rig's ACES made light tones grey and deep tones near black: README, "Neutral lighting, measured").
 *
 * Calibrated like the `neutral` rig: a matt surface facing the camera's rest position gets irradiance π (rendered as
 * its own colour) from the environment and the key together (`studioFrontIrradiance`; the environment part integrated
 * from `studioRadiance` here, not read back from the GPU's prefiltered map, which blurs it a little).
 */
import * as THREE from 'three';
import { KEY_POSITION, installTrueTone } from './scene';

type V3 = [number, number, number];
type RGB = [number, number, number];

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};
const norm = (v: readonly number[]): V3 => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** The studio: soft panels (direction, angular radius in degrees, linear radiance) and the background gradient. */
export const STUDIO = {
  /** Radiance of the sky (straight up), the horizon and the floor (straight down); a neutral white, the floor a little warm. */
  sky: [0.7, 0.7, 0.71] as RGB,
  horizon: [0.3, 0.3, 0.3] as RGB,
  floor: [0.16, 0.152, 0.14] as RGB,
  panels: [
    // The key softbox: the rigs' key direction, wide.
    { dir: norm(KEY_POSITION), radiusDeg: 28, radiance: [3.2, 3.15, 3.05] as RGB },
    // Fill on the other side, lower and weaker.
    { dir: norm([-0.85, 0.15, 0.5]), radiusDeg: 30, radiance: [0.45, 0.45, 0.46] as RGB },
    // A strip behind: edges and the light through the ears and fingers.
    { dir: norm([0.2, 0.35, -1]), radiusDeg: 26, radiance: [2.2, 2.2, 2.2] as RGB },
  ],
  /** The soft key light (directional, white), from the rigs' key direction. */
  key: 2.4,
  /** Front irradiance the calibration aims at (π: a matt surface facing the camera is its own colour). */
  frontTarget: Math.PI,
} as const;

/** Radiance of the studio environment in direction `d` (unit, y up, +z towards the camera's rest position), linear RGB. */
export function studioRadiance(d: readonly number[]): RGB {
  const y = d[1]!;
  const up = smoothstep(0, 1, y), down = smoothstep(0, -1, y);
  const out = [0, 1, 2].map((c) => STUDIO.horizon[c]! + (STUDIO.sky[c]! - STUDIO.horizon[c]!) * up + (STUDIO.floor[c]! - STUDIO.horizon[c]!) * down) as RGB;
  for (const p of STUDIO.panels) {
    const angle = (Math.acos(Math.min(1, Math.max(-1, dot(d, p.dir)))) * 180) / Math.PI;
    const k = 1 - smoothstep(p.radiusDeg * 0.6, p.radiusDeg, angle);
    for (let c = 0; c < 3; c++) out[c] = out[c]! + k * p.radiance[c]!;
  }
  return out;
}

/** Irradiance of the environment alone (scale 1) on a surface with normal `n`: ∫ radiance · cos over the hemisphere, numerically. */
export function studioEnvIrradiance(n: readonly number[], steps = 96): RGB {
  const nn = norm(n);
  // A frame round n; the hemisphere in (θ, φ).
  const t = norm(Math.abs(nn[1]) < 0.9 ? [nn[2], 0, -nn[0]] : [1, 0, 0]);
  const b: V3 = [nn[1] * t[2] - nn[2] * t[1], nn[2] * t[0] - nn[0] * t[2], nn[0] * t[1] - nn[1] * t[0]];
  const out: RGB = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const theta = ((i + 0.5) / steps) * (Math.PI / 2);
    const st = Math.sin(theta), ct = Math.cos(theta);
    const ring = 2 * steps;
    for (let j = 0; j < ring; j++) {
      const phi = ((j + 0.5) / ring) * 2 * Math.PI;
      const d = [0, 1, 2].map((c) => st * Math.cos(phi) * t[c]! + st * Math.sin(phi) * b[c]! + ct * nn[c]!);
      const L = studioRadiance(d);
      const w = ct * st * (Math.PI / 2 / steps) * ((2 * Math.PI) / ring);
      for (let c = 0; c < 3; c++) out[c] = out[c]! + L[c]! * w;
    }
  }
  return out;
}

/** The key light's share on a surface facing +z. */
const KEY_COS = norm(KEY_POSITION)[2];

/**
 * The environment's intensity (`scene.environmentIntensity`) that, with the key light, puts `STUDIO.frontTarget` on a
 * surface facing +z (green channel; the environment is neutral within 2 %).
 */
export function studioEnvironmentIntensity(): number {
  const e = studioEnvIrradiance([0, 0, 1], 48);
  return Math.max(0, (STUDIO.frontTarget - STUDIO.key * KEY_COS) / e[1]);
}

/** What a surface facing +z gets from the studio (environment at its intensity plus the key), linear RGB. */
export function studioFrontIrradiance(): RGB {
  const k = studioEnvironmentIntensity();
  const e = studioEnvIrradiance([0, 0, 1], 48);
  return e.map((v) => v * k + STUDIO.key * KEY_COS) as RGB;
}

/** The environment as a scene: an inside-out sphere coloured by `studioRadiance` per vertex. */
export function studioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const g = new THREE.SphereGeometry(100, 96, 48);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const L = studioRadiance(norm([pos.getX(i), pos.getY(i), pos.getZ(i)]));
    col.set(L, 3 * i);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, toneMapped: false })));
  return scene;
}

/** A stage the studio can be put on (the viewer's `Stage`: its scene and renderer). */
export interface StudioTarget {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
}

/**
 * Put the studio light on a stage: the rig's lights are switched off (kept, and switched back on by `dispose`), the
 * environment and the key go in, and the tone stage becomes the true-tone curve. The backdrop and floor stay.
 */
export function useStudioLight(stage: StudioTarget): { dispose(): void; environmentIntensity: number } {
  const off = stage.scene.children.filter((o) => (o as THREE.Light).isLight && o.visible);
  for (const o of off) o.visible = false;
  const pmrem = new THREE.PMREMGenerator(stage.renderer);
  const envScene = studioScene();
  const target = pmrem.fromScene(envScene, 0.02);
  for (const o of envScene.children) {
    const m = o as THREE.Mesh;
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  pmrem.dispose();
  const environmentIntensity = studioEnvironmentIntensity();
  const environment = stage.scene.environment;
  const intensity = stage.scene.environmentIntensity;
  stage.scene.environment = target.texture;
  stage.scene.environmentIntensity = environmentIntensity;
  const key = new THREE.DirectionalLight(0xffffff, STUDIO.key);
  key.position.set(...KEY_POSITION);
  stage.scene.add(key);
  const toneMapping = stage.renderer.toneMapping;
  stage.renderer.toneMapping = installTrueTone() ? THREE.CustomToneMapping : THREE.NeutralToneMapping;
  return {
    environmentIntensity,
    dispose() {
      stage.scene.remove(key);
      key.dispose();
      for (const o of off) o.visible = true;
      stage.scene.environment = environment;
      stage.scene.environmentIntensity = intensity;
      stage.renderer.toneMapping = toneMapping;
      target.dispose();
    },
  };
}
