/**
 * Camera poses of the fixed turntable in the two conventions the GPU stages read
 * (docs/research/garment-engine.md, shortlist A):
 *
 * - **OpenCV** (`cameras_opencv.json`): world-to-camera [R|t], camera x right, y down, z forward.
 *   This is what gsplat's `rasterization_2dgs` takes as `viewmats` and what Open3D's TSDF takes as
 *   `extrinsic`.
 * - **Nerfstudio** (`transforms.json`): camera-to-world `transform_matrix`, OpenGL camera axes
 *   (x right, y up, z backward), `camera_model: OPENCV` with zero distortion.
 *
 * World space is mannequin space in **metres** (the mannequin package works in cm; ×0.01, the same
 * scale as base.glb): +Y up, +Z the mannequin's front, +X the mannequin's left.
 *
 * Intrinsics use the pixel-corner origin (the centre of pixel (0,0) is at (0.5, 0.5)), which is the
 * convention of COLMAP, Nerfstudio and gsplat and of the spike's rasterizer: cx = W/2, cy = H/2.
 * Open3D and plain OpenCV put the centre of pixel (0,0) at (0,0): subtract 0.5 from cx and cy there.
 *
 * Matrices are row-major `number[][]` so they serialise to JSON in the order people read them.
 */
import { cross, normalize, sub, type CameraFrame, type Vec3 } from '@curtain/mannequin';

export type Mat3Rows = number[][];
export type Mat4Rows = number[][];

/** cm → m. */
export const WORLD_SCALE = 0.01;

export interface Intrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/** Pinhole intrinsics of a frame rendered at `width`×`height` (square pixels, vertical FOV from the frame). */
export function intrinsics(frame: Pick<CameraFrame, 'fovYDeg'>, width: number, height: number): Intrinsics {
  const fy = height / 2 / Math.tan((frame.fovYDeg * Math.PI) / 360);
  return { width, height, fx: fy, fy, cx: width / 2, cy: height / 2 };
}

export function kMatrix(k: Intrinsics): Mat3Rows {
  return [
    [k.fx, 0, k.cx],
    [0, k.fy, k.cy],
    [0, 0, 1],
  ];
}

/** Camera basis of a frame: right, up and forward (towards the look-at point), unit vectors in world space. */
export function cameraBasis(frame: Pick<CameraFrame, 'position' | 'lookAt' | 'up'>): { right: Vec3; up: Vec3; forward: Vec3 } {
  const forward = normalize(sub(frame.lookAt, frame.position));
  const right = normalize(cross(forward, frame.up));
  const up = cross(right, forward);
  return { right, up, forward };
}

/** OpenCV world-to-camera of a frame, world in metres. */
export function opencvWorldToCamera(frame: Pick<CameraFrame, 'position' | 'lookAt' | 'up'>, scale = WORLD_SCALE): Mat4Rows {
  const { right, up, forward } = cameraBasis(frame);
  const R: Vec3[] = [right, [-up[0], -up[1], -up[2]], forward];
  const eye: Vec3 = [frame.position[0] * scale, frame.position[1] * scale, frame.position[2] * scale];
  return R.map((row) => [row[0], row[1], row[2], -(row[0] * eye[0] + row[1] * eye[1] + row[2] * eye[2])]).concat([[0, 0, 0, 1]]);
}

/** Nerfstudio / OpenGL camera-to-world of a frame, world in metres. */
export function openglCameraToWorld(frame: Pick<CameraFrame, 'position' | 'lookAt' | 'up'>, scale = WORLD_SCALE): Mat4Rows {
  const { right, up, forward } = cameraBasis(frame);
  const back: Vec3 = [-forward[0], -forward[1], -forward[2]];
  const p = frame.position;
  return [
    [right[0], up[0], back[0], p[0] * scale],
    [right[1], up[1], back[1], p[1] * scale],
    [right[2], up[2], back[2], p[2] * scale],
    [0, 0, 0, 1],
  ];
}

export function multiply4(a: Mat4Rows, b: Mat4Rows): Mat4Rows {
  return a.map((row) => [0, 1, 2, 3].map((c) => row[0]! * b[0]![c]! + row[1]! * b[1]![c]! + row[2]! * b[2]![c]! + row[3]! * b[3]![c]!));
}

/** Inverse of a rigid transform [R|t] (R orthonormal). */
export function invertRigid(m: Mat4Rows): Mat4Rows {
  const R = [0, 1, 2].map((r) => [0, 1, 2].map((c) => m[c]![r]!)); // Rᵀ
  const t = [m[0]![3]!, m[1]![3]!, m[2]![3]!];
  return [0, 1, 2].map((r) => [R[r]![0]!, R[r]![1]!, R[r]![2]!, -(R[r]![0]! * t[0]! + R[r]![1]! * t[1]! + R[r]![2]! * t[2]!)]).concat([[0, 0, 0, 1]]);
}

/** Flip between OpenGL and OpenCV camera axes on the camera side: c2w · diag(1, −1, −1, 1). */
export function flipCameraAxes(c2w: Mat4Rows): Mat4Rows {
  return c2w.map((row) => [row[0]!, -row[1]!, -row[2]!, row[3]!]);
}

/** Nerfstudio camera-to-world → OpenCV world-to-camera. */
export function openglC2wToOpencvW2c(c2w: Mat4Rows): Mat4Rows {
  return invertRigid(flipCameraAxes(c2w));
}

/** OpenCV world-to-camera → Nerfstudio camera-to-world. */
export function opencvW2cToOpenglC2w(w2c: Mat4Rows): Mat4Rows {
  return flipCameraAxes(invertRigid(w2c));
}

/** Projects a world point (metres) with K and an OpenCV world-to-camera: pixel (corner origin) and depth along the optical axis (m). */
export function projectOpencv(k: Intrinsics, w2c: Mat4Rows, p: Vec3): { u: number; v: number; z: number } {
  const x = w2c[0]![0]! * p[0] + w2c[0]![1]! * p[1] + w2c[0]![2]! * p[2] + w2c[0]![3]!;
  const y = w2c[1]![0]! * p[0] + w2c[1]![1]! * p[1] + w2c[1]![2]! * p[2] + w2c[1]![3]!;
  const z = w2c[2]![0]! * p[0] + w2c[2]![1]! * p[1] + w2c[2]![2]! * p[2] + w2c[2]![3]!;
  return { u: k.fx * (x / z) + k.cx, v: k.fy * (y / z) + k.cy, z };
}

const r6 = (x: number): number => Math.round(x * 1e6) / 1e6 + 0; // + 0 turns −0 into 0
const rows6 = (m: number[][]): number[][] => m.map((row) => row.map(r6));

export interface FramePaths {
  /** Image the frame's pose belongs to, relative to the json file. */
  image: (index: number) => string;
  /** Optional mask image (Nerfstudio: pixels to train on). */
  mask?: (index: number) => string;
  /** Optional metric depth (16-bit PNG, mm). */
  depth?: (index: number) => string;
}

export interface NerfstudioTransforms {
  camera_model: 'OPENCV';
  fl_x: number;
  fl_y: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  k1: 0;
  k2: 0;
  p1: 0;
  p2: 0;
  /** Depth PNG value × this = metres (Nerfstudio's `depth_unit_scale_factor`). */
  depth_unit_scale_factor?: number;
  curtain: { world: string; unit: 'm'; camera_axes: 'opengl'; pixel_origin: 'corner'; path_id: string; frames_per_turn: number };
  frames: { file_path: string; mask_path?: string; depth_file_path?: string; transform_matrix: Mat4Rows; colmap_im_id: number; curtain_frame: number; curtain_azimuth_deg: number }[];
}

export const WORLD_DESCRIPTION = 'mannequin space, metres: +Y up, +Z mannequin front, +X mannequin left';

export function transformsJson(path: { id: string; frames: readonly CameraFrame[] }, width: number, height: number, files: FramePaths): NerfstudioTransforms {
  const k = intrinsics(path.frames[0]!, width, height);
  return {
    camera_model: 'OPENCV',
    fl_x: r6(k.fx),
    fl_y: r6(k.fy),
    cx: k.cx,
    cy: k.cy,
    w: width,
    h: height,
    k1: 0,
    k2: 0,
    p1: 0,
    p2: 0,
    ...(files.depth ? { depth_unit_scale_factor: 0.001 } : {}),
    curtain: { world: WORLD_DESCRIPTION, unit: 'm', camera_axes: 'opengl', pixel_origin: 'corner', path_id: path.id, frames_per_turn: path.frames.length },
    frames: path.frames.map((f) => ({
      file_path: files.image(f.index),
      ...(files.mask ? { mask_path: files.mask(f.index) } : {}),
      ...(files.depth ? { depth_file_path: files.depth(f.index) } : {}),
      transform_matrix: rows6(openglCameraToWorld(f)),
      colmap_im_id: f.index + 1,
      curtain_frame: f.index,
      curtain_azimuth_deg: r6(f.azimuthDeg),
    })),
  };
}

export interface OpencvCameras {
  format: 'curtain.phase0.cameras';
  formatVersion: 1;
  world: string;
  unit: 'm';
  cameraAxes: 'opencv: x right, y down, z forward';
  pixelOrigin: 'corner';
  pathId: string;
  width: number;
  height: number;
  K: Mat3Rows;
  frames: { index: number; azimuthDeg: number; w2c: Mat4Rows; centre: Vec3 }[];
}

export function opencvCamerasJson(path: { id: string; frames: readonly CameraFrame[] }, width: number, height: number): OpencvCameras {
  const k = intrinsics(path.frames[0]!, width, height);
  return {
    format: 'curtain.phase0.cameras',
    formatVersion: 1,
    world: WORLD_DESCRIPTION,
    unit: 'm',
    cameraAxes: 'opencv: x right, y down, z forward',
    pixelOrigin: 'corner',
    pathId: path.id,
    width,
    height,
    K: rows6(kMatrix(k)),
    frames: path.frames.map((f) => ({
      index: f.index,
      azimuthDeg: r6(f.azimuthDeg),
      w2c: rows6(opencvWorldToCamera(f)),
      centre: [r6(f.position[0] * WORLD_SCALE), r6(f.position[1] * WORLD_SCALE), r6(f.position[2] * WORLD_SCALE)],
    })),
  };
}
