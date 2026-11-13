import { describe, expect, it } from 'vitest';
import {
  CAMERA_PATH_IDS,
  MOTION_CLIP,
  bodyShape,
  buildMannequin,
  buildMannequinMesh,
  cameraMatrices,
  clipFrameTimes,
  motionCamera,
  poseMesh,
  posePoint,
  readGlb,
  glbFloatAccessor,
  glbIndexAccessor,
  sampleClip,
  skinWeights,
  topology,
  transformPoint4,
  turntablePaths,
  vertexNormals,
  writeGlb,
  type Vec3,
} from './index';

const mannequin = buildMannequin(bodyShape('M'));
const mesh = buildMannequinMesh(mannequin);

describe('camera paths', () => {
  const paths = turntablePaths(mannequin, { frames: 72 });

  it('are three turntables at increasing heights with frame 0 at the front and frame N/2 at the back', () => {
    expect(paths.map((p) => p.id)).toEqual([...CAMERA_PATH_IDS]);
    expect(paths[0]!.heightCm).toBeLessThan(paths[1]!.heightCm);
    expect(paths[1]!.heightCm).toBeLessThan(paths[2]!.heightCm);
    for (const p of paths) {
      expect(p.frames).toHaveLength(72);
      expect(p.frames[0]!.position[2]).toBeCloseTo(p.radiusCm, 9);
      expect(p.frames[36]!.position[2]).toBeCloseTo(-p.radiusCm, 9);
      expect(p.frames[18]!.position[0]).toBeCloseTo(p.radiusCm, 9);
      for (const f of p.frames) expect(Math.hypot(f.position[0], f.position[2])).toBeCloseTo(p.radiusCm, 9);
    }
  });

  it('keep the whole mannequin in view in every frame', () => {
    for (const p of paths) {
      for (const f of p.frames.filter((_, i) => i % 6 === 0)) {
        const { viewProjection } = cameraMatrices(f, 1);
        for (let i = 0; i < mesh.positions.length; i += 3 * 37) {
          const [x, y, , w] = transformPoint4(viewProjection, [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!]);
          expect(w).toBeGreaterThan(0);
          expect(Math.abs(x / w)).toBeLessThan(1);
          expect(Math.abs(y / w)).toBeLessThan(1);
        }
      }
    }
  });

  it('has a fixed front camera for the motion clip', () => {
    const c = motionCamera(mannequin);
    expect(c.azimuthDeg).toBe(0);
    expect(c.position[2]).toBeGreaterThan(0);
  });
});

describe('rig and motion clip', () => {
  const skin = skinWeights(mannequin, mesh);
  const wrist = mannequin.rings.find((r) => r.id === 'wrist')!.centre;
  const chest = mannequin.rings.find((r) => r.id === 'chest')!;
  const chestFront: Vec3 = [0, chest.centre[1], chest.b];
  const ankle = (side: 'l' | 'r'): Vec3 => {
    const a = mannequin.rings.find((r) => r.id === 'ankle')!.centre;
    return side === 'l' ? a : [-a[0], a[1], a[2]];
  };

  it('weights sum to one', () => {
    for (let i = 0; i < skin.weights.length; i += 2) expect(skin.weights[i]! + skin.weights[i + 1]!).toBeCloseTo(1, 6);
  });

  it('rest pose leaves the mesh unchanged', () => {
    const posed = poseMesh(mannequin, mesh, skin, { joints: {} });
    for (let i = 0; i < posed.length; i++) expect(posed[i]).toBeCloseTo(mesh.positions[i]!, 9);
  });

  it('raises the arms at 1 s, turns to the back by 4 s and steps forward at 4.6 s', () => {
    const raised = sampleClip(MOTION_CLIP, 1);
    expect(posePoint(mannequin, 'elbow_l', wrist, raised)[1]).toBeGreaterThan(wrist[1] + 30);
    const turned = sampleClip(MOTION_CLIP, 4);
    expect(posePoint(mannequin, 'spine', chestFront, turned)[2]).toBeCloseTo(-chest.b, 6);
    const step = sampleClip(MOTION_CLIP, 4.6);
    const left = posePoint(mannequin, 'knee_l', ankle('l'), step);
    const right = posePoint(mannequin, 'knee_r', ankle('r'), step);
    expect(left[2]).toBeLessThan(right[2] - 10); // facing −Z after the turn: forward is −Z
    const end = sampleClip(MOTION_CLIP, MOTION_CLIP.durationS);
    expect(end.rootTranslation![2]).toBe(-25);
  });

  it('keeps the posed mesh watertight (skinning moves vertices, not topology) and samples 145 frames', () => {
    const posed = poseMesh(mannequin, mesh, skin, sampleClip(MOTION_CLIP, 4.6));
    expect(topology({ ...mesh, positions: posed }).boundaryEdges).toBe(0);
    expect(clipFrameTimes(MOTION_CLIP)).toHaveLength(145);
    expect(sampleClip(MOTION_CLIP, -1)).toEqual(MOTION_CLIP.keyframes[0]);
  });
});

describe('glb writer', () => {
  it('writes a valid glTF 2.0 binary that reads back to the same mesh', () => {
    const bytes = writeGlb([{ name: 'M', positions: mesh.positions, normals: vertexNormals(mesh), indices: mesh.indices }], { scale: 0.01, extras: { shape: 'M' } });
    expect(bytes.byteLength % 4).toBe(0);
    const glb = readGlb(bytes);
    expect(glb.json.asset.version).toBe('2.0');
    expect(glb.json.asset.extras).toEqual({ shape: 'M' });
    const prim = glb.json.meshes[0]!.primitives[0]!;
    const pos = glbFloatAccessor(glb, prim.attributes.POSITION!);
    const idx = glbIndexAccessor(glb, prim.indices);
    expect(pos.length).toBe(mesh.positions.length);
    for (let i = 0; i < pos.length; i += 101) expect(pos[i]).toBeCloseTo(mesh.positions[i]! * 0.01, 6);
    expect(Array.from(idx)).toEqual(Array.from(mesh.indices));
    const acc = glb.json.accessors[prim.attributes.POSITION!]!;
    expect(acc.max![1]).toBeCloseTo(mannequin.statureCm / 100, 5);
    expect(acc.min![1]).toBeCloseTo(0, 5);
  });

  it('switches to 32-bit indices above 65535 vertices', () => {
    const n = 70000;
    const bytes = writeGlb([{ name: 'big', positions: new Float64Array(n * 3), indices: [0, 1, n - 1] }]);
    const glb = readGlb(bytes);
    expect(glb.json.accessors[1]!.componentType).toBe(5125);
    expect(Array.from(glbIndexAccessor(glb, 1))).toEqual([0, 1, n - 1]);
  });
});
