import { BASE_SHAPE_ID, bodyShape, buildMannequin, buildMannequinMesh, cameraMatrices, transformPoint4, turntablePath, type Vec3 } from '@curtain/mannequin';
import { describe, expect, it } from 'vitest';
import {
  WORLD_SCALE,
  intrinsics,
  invertRigid,
  multiply4,
  opencvCamerasJson,
  opencvW2cToOpenglC2w,
  opencvWorldToCamera,
  openglC2wToOpencvW2c,
  openglCameraToWorld,
  projectOpencv,
  transformsJson,
  type Mat4Rows,
} from './exportPoses';

const mannequin = buildMannequin(bodyShape(BASE_SHAPE_ID));
const path = turntablePath(mannequin, 'turntable_mid', { frames: 72 });
const W = 480, H = 832;
const I4: Mat4Rows = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

function expectClose(a: Mat4Rows, b: Mat4Rows, eps = 1e-9): void {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) expect(Math.abs(a[r]![c]! - b[r]![c]!)).toBeLessThan(eps);
}

const m = (p: Vec3): Vec3 => [p[0] * WORLD_SCALE, p[1] * WORLD_SCALE, p[2] * WORLD_SCALE];

describe('pose conventions', () => {
  it('round-trips OpenCV world-to-camera and Nerfstudio camera-to-world for every frame', () => {
    for (const f of path.frames) {
      const w2c = opencvWorldToCamera(f);
      const c2w = openglCameraToWorld(f);
      expectClose(openglC2wToOpencvW2c(c2w), w2c);
      expectClose(opencvW2cToOpenglC2w(w2c), c2w);
      expectClose(multiply4(w2c, invertRigid(w2c)), I4);
    }
  });

  it('frame 0 looks at the front: camera on +Z, optical axis towards −Z', () => {
    const f = path.frames[0]!;
    const w2c = opencvWorldToCamera(f);
    const centre = invertRigid(w2c).map((row) => row[3]!);
    expect(centre[2]!).toBeGreaterThan(3); // 320 cm in front
    expect(Math.abs(centre[0]!)).toBeLessThan(1e-9);
    expect(w2c[2]![2]!).toBeLessThan(-0.99); // OpenCV z (forward) is world −Z
    // The OpenGL camera looks down its −z column: also world −Z.
    expect(openglCameraToWorld(f)[2]![2]!).toBeGreaterThan(0.99);
    // The mannequin's left (+X) appears on the image's right for a camera facing its front.
    const k = intrinsics(f, W, H);
    const left = projectOpencv(k, w2c, m([20, f.lookAt[1], 0]));
    expect(left.u).toBeGreaterThan(k.cx);
  });

  it('frame N/2 looks at the back: camera on −Z, optical axis towards +Z', () => {
    const f = path.frames[path.frames.length / 2]!;
    expect(f.azimuthDeg).toBe(180);
    const w2c = opencvWorldToCamera(f);
    const centre = invertRigid(w2c).map((row) => row[3]!);
    expect(centre[2]!).toBeLessThan(-3);
    expect(w2c[2]![2]!).toBeGreaterThan(0.99);
    // Frame N/4 is the mannequin's left side (+X).
    const side = invertRigid(opencvWorldToCamera(path.frames[path.frames.length / 4]!)).map((row) => row[3]!);
    expect(side[0]!).toBeGreaterThan(3);
  });

  it('K and [R|t] project exactly like the spike rasterizer (pixel-corner origin, y down)', () => {
    const body = buildMannequinMesh(mannequin);
    for (const f of [path.frames[0]!, path.frames[13]!, path.frames[36]!, path.frames[61]!]) {
      const k = intrinsics(f, W, H);
      const w2c = opencvWorldToCamera(f);
      const { viewProjection } = cameraMatrices(f, W / H);
      for (let v = 0; v < body.positions.length / 3; v += 997) {
        const p: Vec3 = [body.positions[3 * v]!, body.positions[3 * v + 1]!, body.positions[3 * v + 2]!];
        const [x, y, , w] = transformPoint4(viewProjection, p);
        const raster = { u: ((x / w + 1) / 2) * W, v: ((1 - y / w) / 2) * H, z: w };
        const cv = projectOpencv(k, w2c, m(p));
        expect(cv.u).toBeCloseTo(raster.u, 6);
        expect(cv.v).toBeCloseTo(raster.v, 6);
        expect(cv.z).toBeCloseTo(raster.z * WORLD_SCALE, 9);
      }
    }
    // The head is above the feet in the image (v grows downwards).
    const k = intrinsics(path.frames[0]!, W, H);
    const w2c = opencvWorldToCamera(path.frames[0]!);
    expect(projectOpencv(k, w2c, m([0, mannequin.statureCm, 0])).v).toBeLessThan(projectOpencv(k, w2c, m([0, 5, 0])).v);
  });

  it('writes the same poses into transforms.json and cameras_opencv.json', () => {
    const t = transformsJson(path, W, H, { image: (i) => `frames/${String(i).padStart(4, '0')}.png` });
    const o = opencvCamerasJson(path, W, H);
    expect(t.frames).toHaveLength(72);
    expect(t.frames[5]!.file_path).toBe('frames/0005.png');
    expect(t.camera_model).toBe('OPENCV');
    expect(t.cx).toBe(W / 2);
    expect(t.fl_x).toBeCloseTo(H / 2 / Math.tan((20 * Math.PI) / 180), 5);
    expect(o.K[0]![0]).toBe(t.fl_x);
    for (let i = 0; i < 72; i++) {
      expectClose(openglC2wToOpencvW2c(t.frames[i]!.transform_matrix), o.frames[i]!.w2c, 2e-6);
      expect(t.frames[i]!.transform_matrix[3]).toEqual([0, 0, 0, 1]);
    }
    expect(JSON.stringify(o)).not.toContain('-0,');
  });
});
