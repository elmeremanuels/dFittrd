import { describe, expect, it } from 'vitest';
import { writeGlb } from '@curtain/mannequin';
import { meshHealth, readGarmentGlb, weldVertices } from './evalMesh';

/** A glb the way other writers lay it out: one interleaved buffer view, an accessor offset, 8-bit indices, a node transform and vertex colours. */
function foreignGlb(): Uint8Array {
  // Two triangles sharing an edge; position (float32 ×3) and colour (uint8 ×4, normalized) interleaved, stride 16.
  const verts = [
    [0, 0, 0, 255, 0, 0, 255],
    [1, 0, 0, 255, 0, 0, 255],
    [0, 1, 0, 0, 0, 255, 255],
    [1, 1, 0, 0, 0, 255, 255],
  ];
  const vb = new ArrayBuffer(4 * 16);
  const dv = new DataView(vb);
  verts.forEach((v, i) => {
    for (let c = 0; c < 3; c++) dv.setFloat32(i * 16 + 4 * c, v[c]!, true);
    for (let c = 0; c < 4; c++) dv.setUint8(i * 16 + 12 + c, v[3 + c]!);
  });
  const idx = Uint8Array.from([0, 1, 2, 2, 1, 3, 0, 0]); // padded to 4 bytes
  const pad = new Uint8Array(8); // the indices start at an offset inside their view
  const bin = new Uint8Array(vb.byteLength + pad.length + idx.length);
  bin.set(new Uint8Array(vb), 0);
  bin.set(idx, vb.byteLength + pad.length);
  const json = {
    asset: { version: '2.0', generator: 'fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ children: [1], translation: [0, 1, 0] }, { mesh: 0, scale: [2, 2, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2, mode: 4 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vb.byteLength, byteStride: 16 },
      { buffer: 0, byteOffset: vb.byteLength, byteLength: pad.length + idx.length },
    ],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 0, byteOffset: 12, componentType: 5121, normalized: true, count: 4, type: 'VEC4' },
      { bufferView: 1, byteOffset: pad.length, componentType: 5121, count: 6, type: 'SCALAR' },
    ],
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true);
  o.setUint32(4, 2, true);
  o.setUint32(8, total, true);
  o.setUint32(12, jsonBytes.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  o.setUint32(20 + jsonBytes.length, bin.length, true);
  o.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(bin, 28 + jsonBytes.length);
  return out;
}

describe('readGarmentGlb', () => {
  it('reads our own writer (metres) back in cm', () => {
    const positions = [0, 100, 0, 10, 100, 0, 0, 110, 5];
    const g = readGarmentGlb(writeGlb([{ name: 'g', positions, indices: [0, 1, 2] }], { scale: 0.01 }));
    expect(g.unit).toBe('m');
    expect(Array.from(g.mesh.positions).map((v) => Math.round(v * 1000) / 1000)).toEqual(positions);
    expect(Array.from(g.mesh.indices)).toEqual([0, 1, 2]);
    expect(g.meanColorHex).toBeNull();
  });

  it('follows node transforms and reads strided, offset accessors, 8-bit indices and vertex colours', () => {
    const g = readGarmentGlb(foreignGlb());
    // child scale 2, parent translation y + 1 m, then metres → cm
    expect(Array.from(g.mesh.positions)).toEqual([0, 100, 0, 200, 100, 0, 0, 300, 0, 200, 300, 0]);
    expect(Array.from(g.mesh.indices)).toEqual([0, 1, 2, 2, 1, 3]);
    expect(g.meanColorHex).toBe('#800080');
    expect(g.generator).toBe('fixture');
  });

  it('rejects an index past the vertices and a file without triangles', () => {
    expect(() => readGarmentGlb(writeGlb([{ name: 'g', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 5] }]))).toThrow(/index out of range/);
    expect(() => readGarmentGlb(writeGlb([{ name: 'g', positions: [0, 0, 0], indices: [] }]))).toThrow();
  });
});

describe('weldVertices and meshHealth', () => {
  it('merges per-face copies so the topology is read correctly', () => {
    const soup = { positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0]), indices: Uint32Array.from([0, 1, 2, 3, 4, 5]), vertexPart: new Uint8Array(6), partNames: ['g'] };
    expect(meshHealth(soup).boundaryEdges).toBe(6);
    const welded = weldVertices(soup);
    expect(welded.positions.length / 3).toBe(4);
    const h = meshHealth(welded);
    expect(h.boundaryEdges).toBe(4);
    expect(h.withinBudget).toBe(false);
    expect(h.bboxCm).toEqual([[0, 0, 0], [1, 1, 0]]);
    expect(h.notChecked.length).toBeGreaterThan(0);
  });
});
