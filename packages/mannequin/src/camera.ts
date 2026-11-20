/**
 * Fixed camera paths (handoff: "turntable at three heights"). The camera orbits the mannequin's
 * vertical axis at a fixed radius; frame 0 looks at the front (camera on +Z) and frame N/2 at the
 * back, which is where stage 2 pins the merchant's front and back photos. Turning the camera around
 * a still mannequin and turning the mannequin in front of a still camera give the same images.
 */
import { lookAt, perspective, type Mat4, type Vec3 } from './math';
import type { Mannequin } from './model';

export const CAMERA_PATH_IDS = ['turntable_low', 'turntable_mid', 'turntable_high'] as const;
export type CameraPathId = (typeof CAMERA_PATH_IDS)[number];

export interface CameraFrame {
  index: number;
  /** Camera azimuth around +Y, degrees: 0 = front (+Z), 90 = the mannequin's left (+X), 180 = back. */
  azimuthDeg: number;
  position: Vec3;
  lookAt: Vec3;
  up: Vec3;
  /** Full vertical field of view, degrees. */
  fovYDeg: number;
}

export interface CameraPath {
  id: CameraPathId;
  /** Camera height above the floor, cm. */
  heightCm: number;
  /** Orbit radius, cm. */
  radiusCm: number;
  frames: CameraFrame[];
}

export interface CameraPathOptions {
  /** Frames per full turn (default 72, one every 5°). */
  frames?: number;
  /** Orbit radius, cm (default 320). */
  radiusCm?: number;
  /** Vertical field of view, degrees (default 40: the whole body fits at every height). */
  fovYDeg?: number;
}

/** Camera heights as fractions of stature: knee, chest/waist, above the head. */
export const TURNTABLE_HEIGHTS: Readonly<Record<CameraPathId, number>> = {
  turntable_low: 0.3,
  turntable_mid: 0.6,
  turntable_high: 1.1,
};

/** Look-at point (fraction of stature): the middle of the body. */
export const TURNTABLE_TARGET = 0.52;

export function turntablePath(mannequin: Mannequin, id: CameraPathId, options: CameraPathOptions = {}): CameraPath {
  const n = options.frames ?? 72;
  const r = options.radiusCm ?? 320;
  const fov = options.fovYDeg ?? 40;
  const h = TURNTABLE_HEIGHTS[id] * mannequin.statureCm;
  const target: Vec3 = [0, TURNTABLE_TARGET * mannequin.statureCm, 0];
  const frames: CameraFrame[] = [];
  for (let i = 0; i < n; i++) {
    const az = (360 * i) / n;
    const rad = (az * Math.PI) / 180;
    frames.push({ index: i, azimuthDeg: az, position: [r * Math.sin(rad), h, r * Math.cos(rad)], lookAt: target, up: [0, 1, 0], fovYDeg: fov });
  }
  return { id, heightCm: h, radiusCm: r, frames };
}

export function turntablePaths(mannequin: Mannequin, options: CameraPathOptions = {}): CameraPath[] {
  return CAMERA_PATH_IDS.map((id) => turntablePath(mannequin, id, options));
}

/** The fixed front camera of the motion clip (mid height, azimuth 0). */
export function motionCamera(mannequin: Mannequin, options: CameraPathOptions = {}): CameraFrame {
  return turntablePath(mannequin, 'turntable_mid', { ...options, frames: 1 }).frames[0]!;
}

export interface CameraMatrices {
  view: Mat4;
  projection: Mat4;
  /** `projection · view`. */
  viewProjection: Mat4;
}

export function cameraMatrices(frame: CameraFrame, aspect: number, near = 10, far = 2000): CameraMatrices {
  const view = lookAt(frame.position, frame.lookAt, frame.up);
  const projection = perspective(frame.fovYDeg, aspect, near, far);
  const viewProjection = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += projection[k * 4 + r]! * view[c * 4 + k]!;
      viewProjection[c * 4 + r] = s;
    }
  }
  return { view, projection, viewProjection };
}
