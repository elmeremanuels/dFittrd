import { buildBody, buildMannequinMesh, faceUvOf } from '@curtain/mannequin';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fitNeckToHead } from './body';
import { FACE_FADE_DEG, faceOverlayGeometry, faceTextureOf, isFaceTexture } from './faceOverlay';
import { planAvatar } from './mount';
import { Figure, meshGeometry } from './scene';

const female = { category: 'dress', mannequin: { family: 'female' } };

function headFigure(): { figure: Figure; uv: Float32Array } {
  const m = buildBody({ family: 'female' });
  const mesh = fitNeckToHead(buildMannequinMesh(m, { head: 'neutral-v2' }), m).mesh;
  return { figure: new Figure(meshGeometry(mesh), new Uint32Array(0), 0, null), uv: faceUvOf(mesh)! };
}

const face = (size = 64): { size: number; rgba: Uint8ClampedArray } => ({ size, rgba: new Uint8ClampedArray(4 * size * size).fill(200) });

describe('face overlay (slice 6 spike)', () => {
  it('copies only the front of the head, fading to nothing past the fade angle', () => {
    const { figure, uv } = headFigure();
    const g = faceOverlayGeometry(figure.body.geometry, uv)!;
    const body = figure.body.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    expect(col.itemSize).toBe(4);
    expect(pos.count).toBeGreaterThan(1000);
    expect(pos.count).toBeLessThan(body.count / 2);
    for (let i = 0; i < pos.count; i++) {
      const yaw = (Math.atan2(Math.abs(nrm.getX(i)), nrm.getZ(i)) * 180) / Math.PI;
      if (yaw <= FACE_FADE_DEG[0]) expect(col.getW(i)).toBeCloseTo(1, 5);
      if (yaw >= FACE_FADE_DEG[1]) expect(col.getW(i)).toBe(0);
    }
  });

  it('is laid over the body and taken off again without touching the body or its material', () => {
    const { figure, uv } = headFigure();
    figure.setSkin('#a07e56');
    const material = figure.body.material;
    const geometry = figure.body.geometry;
    figure.setFace(face(), uv);
    expect(figure.face).not.toBeNull();
    expect(figure.group.children).toContain(figure.face);
    expect(figure.face!.material.map).toBeInstanceOf(THREE.DataTexture);
    expect(figure.face!.material.transparent).toBe(true);
    expect(figure.body.material).toBe(material);
    expect(figure.body.geometry).toBe(geometry);
    figure.setFace(null, uv);
    expect(figure.face).toBeNull();
    expect(figure.group.children).toHaveLength(2);
  });

  it('shows nothing without the face frame or with a malformed texture', () => {
    const { figure, uv } = headFigure();
    figure.setFace(face(), null);
    expect(figure.face).toBeNull();
    figure.setFace({ size: 64, rgba: new Uint8ClampedArray(10) }, uv);
    expect(figure.face).toBeNull();
    expect(isFaceTexture({ size: 8, rgba: new Uint8Array(4 * 64) })).toBe(false);
    expect(isFaceTexture(face(32))).toBe(true);
  });

  it('keeps the texture unflipped and in sRGB (row 0 is the top of the face frame)', () => {
    const t = faceTextureOf(face(32));
    expect(t.flipY).toBe(false);
    expect(t.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it('exists only on head v2: the mount plan of other heads has no face frame', () => {
    expect(faceUvOf(planAvatar(female, {}, { head: 'neutral-v2' }).avatar.mesh)).not.toBeNull();
    expect(faceUvOf(planAvatar(female, {}).avatar.mesh)).toBeNull();
  });
});
