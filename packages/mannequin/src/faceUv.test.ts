import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildBody } from './families';
import { FACE_UV_FRAME, FACE_UV_LANDMARKS, faceUvAt, faceUvOf } from './faceUv';
import { buildMannequinMesh } from './mesh';

/** The face mesh asset the capture worker bakes with records the frame it was built for (apps/web). */
const asset = JSON.parse(readFileSync(new URL('../../../apps/web/src/features/capture/faceMeshUv.json', import.meta.url), 'utf8')) as {
  frame: typeof FACE_UV_FRAME;
  head: { eyeX: number; eyeY: number; noseTipY: number; mouthY: number };
};

describe('face frame of head v2', () => {
  it('is the frame and the landmarks the face mesh asset was built for', () => {
    expect(asset.frame).toEqual(FACE_UV_FRAME);
    expect(asset.head).toEqual(FACE_UV_LANDMARKS);
  });

  it('maps the frame corners to 0 and 1, v down', () => {
    expect(faceUvAt(FACE_UV_FRAME.x0, FACE_UV_FRAME.y1)).toEqual([0, 0]);
    expect(faceUvAt(FACE_UV_FRAME.x1, FACE_UV_FRAME.y0)).toEqual([1, 1]);
  });

  for (const family of ['female', 'male'] as const) {
    it(`gives every ${family} head vertex in the frame a uv, and no other vertex`, () => {
      const m = buildBody({ family });
      const mesh = buildMannequinMesh(m, { head: 'neutral-v2' });
      const uv = faceUvOf(mesh)!;
      expect(uv).toHaveLength((2 * mesh.positions.length) / 3);
      const head = mesh.partNames.indexOf('head');
      let inFrame = 0;
      for (let i = 0; i < mesh.vertexPart.length; i++) {
        if (mesh.vertexPart[i] !== head) expect(uv[2 * i]).toBe(-1);
        else if (uv[2 * i]! >= 0) {
          inFrame++;
          expect(uv[2 * i + 1]).toBeGreaterThanOrEqual(0);
          expect(uv[2 * i + 1]).toBeLessThanOrEqual(1);
        }
      }
      expect(inFrame).toBeGreaterThan(5000);
      // The front of the head at eye level is at the eye row of the frame.
      const { chinY, topY } = mesh.headLevels!;
      const k = (topY - chinY) / 22;
      let best = -1, bestZ = -Infinity;
      for (let i = 0; i < mesh.vertexPart.length; i++) {
        if (mesh.vertexPart[i] !== head) continue;
        const x = mesh.positions[3 * i]!, y = mesh.positions[3 * i + 1]!, z = mesh.positions[3 * i + 2]!;
        if (Math.abs(x) < 0.3 * k && Math.abs((y - chinY) / k - FACE_UV_LANDMARKS.eyeY) < 0.3 && z > bestZ) {
          bestZ = z;
          best = i;
        }
      }
      expect(uv[2 * best]).toBeCloseTo(0.5, 1);
      expect(uv[2 * best + 1]).toBeCloseTo((FACE_UV_FRAME.y1 - FACE_UV_LANDMARKS.eyeY) / (FACE_UV_FRAME.y1 - FACE_UV_FRAME.y0), 1);
    });
  }

  it('is null for a mesh without head v2', () => {
    const m = buildBody({ family: 'female' });
    expect(faceUvOf(buildMannequinMesh(m))).toBeNull();
    expect(faceUvOf(buildMannequinMesh(m, { head: 'neutral' }))).toBeNull();
  });
});
